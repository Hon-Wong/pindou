/* ==========================================================
 * quantize.js — 降采样、马赛克、颜色量化、色卡映射、抖动
 * 所有网格数据格式：Float32Array(w*h*4)，[R,G,B,A]，0..255
 * ========================================================== */
(function (global) {
  'use strict';

  var PD = global.PD || (global.PD = {});
  var C = PD.color;
  var Q = {};

  /* ---------- 确定性随机（保证同参数结果一致） ---------- */
  Q.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ==========================================================
   * 1. 降采样：源像素 → 网格
   * ========================================================== */

  /** 面积平均（按 alpha 预乘，避免透明边缘发黑） */
  function downArea(src, sw, sh, tw, th) {
    var out = new Float32Array(tw * th * 4);
    var xr = sw / tw, yr = sh / th;
    for (var ty = 0; ty < th; ty++) {
      var y0 = Math.floor(ty * yr);
      var y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((ty + 1) * yr)));
      for (var tx = 0; tx < tw; tx++) {
        var x0 = Math.floor(tx * xr);
        var x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((tx + 1) * xr)));
        var r = 0, g = 0, b = 0, aSum = 0, n = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * sw;
          for (var x = x0; x < x1; x++) {
            var i = (row + x) << 2;
            var al = src[i + 3] / 255;
            r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al;
            aSum += al; n++;
          }
        }
        var o = (ty * tw + tx) << 2;
        if (aSum > 1e-4) { out[o] = r / aSum; out[o + 1] = g / aSum; out[o + 2] = b / aSum; }
        out[o + 3] = n ? (aSum / n) * 255 : 0;
      }
    }
    return out;
  }

  /** 最近邻：取每格中心像素 */
  function downNearest(src, sw, sh, tw, th) {
    var out = new Float32Array(tw * th * 4);
    for (var ty = 0; ty < th; ty++) {
      var sy = Math.min(sh - 1, Math.floor((ty + 0.5) * sh / th));
      for (var tx = 0; tx < tw; tx++) {
        var sx = Math.min(sw - 1, Math.floor((tx + 0.5) * sw / tw));
        var i = ((sy * sw) + sx) << 2, o = (ty * tw + tx) << 2;
        out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = src[i + 3];
      }
    }
    return out;
  }

  /** 主色/众数：先粗量化分桶取众数，再对该桶内像素求均值 —— 适合像素画与扁平插画 */
  function downDominant(src, sw, sh, tw, th) {
    var out = new Float32Array(tw * th * 4);
    var xr = sw / tw, yr = sh / th;
    var bucket = new Map();
    for (var ty = 0; ty < th; ty++) {
      var y0 = Math.floor(ty * yr);
      var y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((ty + 1) * yr)));
      for (var tx = 0; tx < tw; tx++) {
        var x0 = Math.floor(tx * xr);
        var x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((tx + 1) * xr)));
        bucket.clear();
        var aSum = 0, n = 0, best = -1, bestN = -1;
        for (var y = y0; y < y1; y++) {
          var row = y * sw;
          for (var x = x0; x < x1; x++) {
            var i = (row + x) << 2;
            var a = src[i + 3];
            aSum += a / 255; n++;
            if (a < 8) continue;
            // 每通道 5bit 分桶
            var key = ((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3);
            var rec = bucket.get(key);
            if (rec) { rec[0]++; rec[1] += src[i]; rec[2] += src[i + 1]; rec[3] += src[i + 2]; }
            else { rec = [1, src[i], src[i + 1], src[i + 2]]; bucket.set(key, rec); }
            if (rec[0] > bestN) { bestN = rec[0]; best = key; }
          }
        }
        var o = (ty * tw + tx) << 2;
        if (best >= 0) {
          var r2 = bucket.get(best);
          out[o] = r2[1] / r2[0]; out[o + 1] = r2[2] / r2[0]; out[o + 2] = r2[3] / r2[0];
        }
        out[o + 3] = n ? (aSum / n) * 255 : 0;
      }
    }
    return out;
  }

  /**
   * 边缘保留降采样：块内做一次 2-means。
   *
   * 只有当两簇势均力敌（少数派占比 ≥ MINOR_MIN）时才判定「有一条边穿过这个格子」，
   * 此时取多数派的均值，边缘就不会被平均成中间色。
   *
   * 反过来，如果少数派只占一点点（比豆子还细的线、噪点），
   * 胜者通吃会把它整个抹掉——那比平均更糟。这种情况退回普通平均，
   * 至少还能靠明暗变化透出这条线。
   */
  var MINOR_MIN = 0.25;      // 少数派低于这个占比就不算「边」
  function downEdge(src, sw, sh, tw, th) {
    var out = new Float32Array(tw * th * 4);
    var xr = sw / tw, yr = sh / th;
    var buf = new Float32Array(16 * 16 * 3);       // 块内像素缓存（k 最大 12）
    for (var ty = 0; ty < th; ty++) {
      var y0 = Math.floor(ty * yr);
      var y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((ty + 1) * yr)));
      for (var tx = 0; tx < tw; tx++) {
        var x0 = Math.floor(tx * xr);
        var x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((tx + 1) * xr)));
        var n = 0, aSum = 0, cnt = 0;
        var mr = 0, mg = 0, mb = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * sw;
          for (var x = x0; x < x1; x++) {
            var i = (row + x) << 2;
            var al = src[i + 3] / 255;
            aSum += al; cnt++;
            if (al < 0.03) continue;
            if (n < 256) {
              buf[n * 3] = src[i]; buf[n * 3 + 1] = src[i + 1]; buf[n * 3 + 2] = src[i + 2];
              mr += src[i]; mg += src[i + 1]; mb += src[i + 2];
              n++;
            }
          }
        }
        var o = (ty * tw + tx) << 2;
        out[o + 3] = cnt ? (aSum / cnt) * 255 : 0;
        if (n === 0) continue;
        mr /= n; mg /= n; mb /= n;

        // 找块内离均值最远的两个点当初始中心
        var f1 = 0, bd = -1, d, j;
        for (j = 0; j < n; j++) {
          d = (buf[j*3]-mr)*(buf[j*3]-mr) + (buf[j*3+1]-mg)*(buf[j*3+1]-mg) + (buf[j*3+2]-mb)*(buf[j*3+2]-mb);
          if (d > bd) { bd = d; f1 = j; }
        }
        if (bd < 48) {                              // 块内基本同色，直接用均值
          out[o] = mr; out[o + 1] = mg; out[o + 2] = mb;
          continue;
        }
        var f2 = 0; bd = -1;
        for (j = 0; j < n; j++) {
          d = (buf[j*3]-buf[f1*3])*(buf[j*3]-buf[f1*3])
            + (buf[j*3+1]-buf[f1*3+1])*(buf[j*3+1]-buf[f1*3+1])
            + (buf[j*3+2]-buf[f1*3+2])*(buf[j*3+2]-buf[f1*3+2]);
          if (d > bd) { bd = d; f2 = j; }
        }
        var c1r = buf[f1*3], c1g = buf[f1*3+1], c1b = buf[f1*3+2];
        var c2r = buf[f2*3], c2g = buf[f2*3+1], c2b = buf[f2*3+2];
        var s1r, s1g, s1b, n1, s2r, s2g, s2b, n2;
        for (var it = 0; it < 6; it++) {
          s1r = s1g = s1b = n1 = 0; s2r = s2g = s2b = n2 = 0;
          for (j = 0; j < n; j++) {
            var r0 = buf[j*3], g0 = buf[j*3+1], b0 = buf[j*3+2];
            var d1 = (r0-c1r)*(r0-c1r) + (g0-c1g)*(g0-c1g) + (b0-c1b)*(b0-c1b);
            var d2 = (r0-c2r)*(r0-c2r) + (g0-c2g)*(g0-c2g) + (b0-c2b)*(b0-c2b);
            if (d1 <= d2) { s1r += r0; s1g += g0; s1b += b0; n1++; }
            else { s2r += r0; s2g += g0; s2b += b0; n2++; }
          }
          if (n1) { c1r = s1r/n1; c1g = s1g/n1; c1b = s1b/n1; }
          if (n2) { c2r = s2r/n2; c2g = s2g/n2; c2b = s2b/n2; }
        }
        var minor = Math.min(n1, n2) / n;
        if (minor >= MINOR_MIN) {                   // 真·边缘：多数派胜出，边界保持锐利
          if (n1 >= n2) { out[o] = c1r; out[o+1] = c1g; out[o+2] = c1b; }
          else { out[o] = c2r; out[o+1] = c2g; out[o+2] = c2b; }
        } else {                                    // 细线/噪点：通吃会抹掉它，退回平均
          out[o] = mr; out[o + 1] = mg; out[o + 2] = mb;
        }
      }
    }
    return out;
  }

  /**
   * DPID —— Rapid, Detail-Preserving Image Downscaling
   * (Weber et al., SIGGRAPH Asia 2016)
   *
   * 普通面积平均是「一视同仁地取平均」，纹理（细线、格纹、织物、文字）
   * 因为在块内属于少数派，会被多数派的背景稀释掉，缩完就是一片糊。
   *
   * DPID 反过来用一个**反向双边滤波**：像素颜色与块内平均值差得越远，
   * 权重越大 —— 即「越不合群的像素越重要」。于是细线和纹理不会被平均掉。
   *
   *   1) 先算块内普通平均 g（引导值）
   *   2) 每个像素权重 w_i = |I_i - g|^λ
   *   3) 输出 = Σ w_i·I_i / Σ w_i
   *
   * λ = 0 时退化成普通面积平均；λ 越大纹理越突出，但噪点也会被一起放大，
   * 所以上限压在 3。块内颜色完全均匀时 Σw = 0，回退到平均值。
   */
  function downDPID(src, sw, sh, tw, th, lambda) {
    var lam = lambda == null ? 1 : lambda;
    if (lam <= 0.001) return downArea(src, sw, sh, tw, th);
    var out = new Float32Array(tw * th * 4);
    var xr = sw / tw, yr = sh / th;
    for (var ty = 0; ty < th; ty++) {
      var y0 = Math.floor(ty * yr);
      var y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((ty + 1) * yr)));
      for (var tx = 0; tx < tw; tx++) {
        var x0 = Math.floor(tx * xr);
        var x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((tx + 1) * xr)));
        var y, x, i, al;

        // 1) 引导值：按 alpha 预乘的普通平均
        var gr = 0, gg = 0, gb = 0, aSum = 0, n = 0;
        for (y = y0; y < y1; y++) {
          var row = y * sw;
          for (x = x0; x < x1; x++) {
            i = (row + x) << 2;
            al = src[i + 3] / 255;
            gr += src[i] * al; gg += src[i + 1] * al; gb += src[i + 2] * al;
            aSum += al; n++;
          }
        }
        var o = (ty * tw + tx) << 2;
        out[o + 3] = n ? (aSum / n) * 255 : 0;
        if (aSum <= 1e-4) continue;
        gr /= aSum; gg /= aSum; gb /= aSum;

        // 2) 反向双边加权：离引导值越远权重越大
        var wr = 0, wg = 0, wb = 0, wSum = 0;
        for (y = y0; y < y1; y++) {
          var row2 = y * sw;
          for (x = x0; x < x1; x++) {
            i = (row2 + x) << 2;
            al = src[i + 3] / 255;
            if (al < 0.004) continue;
            var dr = src[i] - gr, dg = src[i + 1] - gg, db = src[i + 2] - gb;
            var dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.673;   // 归一化到 0..1
            var wgt = al * Math.pow(dist, lam);
            wr += src[i] * wgt; wg += src[i + 1] * wgt; wb += src[i + 2] * wgt;
            wSum += wgt;
          }
        }
        if (wSum > 1e-6) {
          out[o] = wr / wSum; out[o + 1] = wg / wSum; out[o + 2] = wb / wSum;
        } else {                                   // 块内完全均匀，退回平均
          out[o] = gr; out[o + 1] = gg; out[o + 2] = gb;
        }
      }
    }
    return out;
  }

  /**
   * 感知优化降采样 —— Perceptually Based Downscaling of Images
   * (Öztireli & Gross, ACM TOG / SIGGRAPH 2015)
   *
   * 论文把降采样写成「让输出与原图的 SSIM 最大」的优化问题，并给出闭式解（式 7）：
   *
   *     d*ᵢ = μ_h + (σ_h / σ_l) · (lᵢ − μ_h)
   *
   * 对覆盖同一像素的各个 patch 取平均后（式 8）可整理成可直接计算的形式：
   *
   *     D = L · box(R) + box(M − R·M),   R = σ_h / σ_l
   *
   * 其中 L 是普通 box 降采样，M = box(L) 是局部均值，
   * σ_l² = box(L²) − M² 是「降采样图」的局部方差，
   * σ_h² = box(L2) − M² 是「原图」在该区域内的方差（L2 = 对原图平方做 box 降采样）。
   *
   * 论文自己的解读：这等价于一个**自适应 unsharp masking**——
   * 锐化系数 σ_h/σ_l 由局部内容决定：原图细节多而降采样后被抹平的地方
   * （σ_h 大、σ_l 小）锐化强，平坦区域 σ_h≈0 则完全不动。
   * 所以它不像固定锐化那样满图起振铃，也不像 DPID 那样需要手调强度。
   *
   * 实现上全部是输出分辨率上的 box 滤波，开销极小。
   */
  function boxBlur(a, w, h, r) {
    if (r < 1) return a;
    var tmpH = new Float32Array(a.length), out = new Float32Array(a.length);
    var x, y, i, sum, n;
    for (y = 0; y < h; y++) {                       // 横向
      for (x = 0; x < w; x++) {
        sum = 0; n = 0;
        for (i = x - r; i <= x + r; i++) {
          if (i < 0 || i >= w) continue;
          sum += a[y * w + i]; n++;
        }
        tmpH[y * w + x] = sum / n;
      }
    }
    for (x = 0; x < w; x++) {                       // 纵向
      for (y = 0; y < h; y++) {
        sum = 0; n = 0;
        for (i = y - r; i <= y + r; i++) {
          if (i < 0 || i >= h) continue;
          sum += tmpH[i * w + x]; n++;
        }
        out[y * w + x] = sum / n;
      }
    }
    return out;
  }

  function downSSIM(src, sw, sh, tw, th) {
    var PATCH = 1;                                  // 3×3 patch（论文说 patch 取得很小）
    var EPS = 1e-4, RMAX = 8;
    var n = tw * th;
    var out = new Float32Array(n * 4);

    // L：普通 box 降采样（按 alpha 预乘）；L2：对原图平方做同样的降采样
    var L = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    var L2 = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    var xr = sw / tw, yr = sh / th;
    for (var ty = 0; ty < th; ty++) {
      var y0 = Math.floor(ty * yr);
      var y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((ty + 1) * yr)));
      for (var tx = 0; tx < tw; tx++) {
        var x0 = Math.floor(tx * xr);
        var x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((tx + 1) * xr)));
        var s0 = 0, s1 = 0, s2 = 0, q0 = 0, q1 = 0, q2 = 0, aSum = 0, cnt = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * sw;
          for (var x = x0; x < x1; x++) {
            var i4 = (row + x) << 2;
            var al = src[i4 + 3] / 255;
            var r0 = src[i4] / 255, g0 = src[i4 + 1] / 255, b0 = src[i4 + 2] / 255;
            s0 += r0 * al; s1 += g0 * al; s2 += b0 * al;
            q0 += r0 * r0 * al; q1 += g0 * g0 * al; q2 += b0 * b0 * al;
            aSum += al; cnt++;
          }
        }
        var p = ty * tw + tx;
        out[(p << 2) + 3] = cnt ? (aSum / cnt) * 255 : 0;
        if (aSum > 1e-4) {
          L[0][p] = s0 / aSum; L[1][p] = s1 / aSum; L[2][p] = s2 / aSum;
          L2[0][p] = q0 / aSum; L2[1][p] = q1 / aSum; L2[2][p] = q2 / aSum;
        }
      }
    }

    for (var c = 0; c < 3; c++) {
      var Lc = L[c], L2c = L2[c];
      var LL = new Float32Array(n);
      for (var k = 0; k < n; k++) LL[k] = Lc[k] * Lc[k];

      var M = boxBlur(Lc, tw, th, PATCH);           // μ_h
      var mLL = boxBlur(LL, tw, th, PATCH);
      var mL2 = boxBlur(L2c, tw, th, PATCH);

      var R = new Float32Array(n), RM = new Float32Array(n);
      for (var j = 0; j < n; j++) {
        var mm = M[j] * M[j];
        var sl2 = Math.max(0, mLL[j] - mm);         // σ_l²
        var sh2 = Math.max(0, mL2[j] - mm);         // σ_h²
        var r = (sh2 < EPS || sl2 < EPS) ? 0 : Math.sqrt(sh2) / Math.sqrt(sl2);
        if (r > RMAX) r = RMAX;
        R[j] = r;
        RM[j] = M[j] - r * M[j];
      }
      var mR = boxBlur(R, tw, th, PATCH);
      var mRM = boxBlur(RM, tw, th, PATCH);

      for (var t2 = 0; t2 < n; t2++) {
        var v = Lc[t2] * mR[t2] + mRM[t2];
        out[(t2 << 2) + c] = v < 0 ? 0 : v > 1 ? 255 : v * 255;
      }
    }
    return out;
  }

  Q.downsample = function (src, sw, sh, tw, th, mode, param) {
    if (mode === 'nearest') return downNearest(src, sw, sh, tw, th);
    if (mode === 'dominant') return downDominant(src, sw, sh, tw, th);
    if (mode === 'edge') return downEdge(src, sw, sh, tw, th);
    if (mode === 'dpid') return downDPID(src, sw, sh, tw, th, param);
    if (mode === 'ssim') return downSSIM(src, sw, sh, tw, th);
    return downArea(src, sw, sh, tw, th);
  };

  /* ==========================================================
   * 2. 马赛克：把 m×m 个格子合并成同一个色块（格数不变）
   * ========================================================== */
  Q.mosaic = function (grid, w, h, m) {
    if (m <= 1) return grid;
    var out = new Float32Array(grid.length);
    for (var by = 0; by < h; by += m) {
      var ye = Math.min(h, by + m);
      for (var bx = 0; bx < w; bx += m) {
        var xe = Math.min(w, bx + m);
        var r = 0, g = 0, b = 0, aSum = 0, n = 0, y, x, i;
        for (y = by; y < ye; y++) for (x = bx; x < xe; x++) {
          i = (y * w + x) << 2;
          var al = grid[i + 3] / 255;
          r += grid[i] * al; g += grid[i + 1] * al; b += grid[i + 2] * al;
          aSum += al; n++;
        }
        var R = aSum > 1e-4 ? r / aSum : 0,
            G = aSum > 1e-4 ? g / aSum : 0,
            B = aSum > 1e-4 ? b / aSum : 0,
            A = n ? (aSum / n) * 255 : 0;
        for (y = by; y < ye; y++) for (x = bx; x < xe; x++) {
          i = (y * w + x) << 2;
          out[i] = R; out[i + 1] = G; out[i + 2] = B; out[i + 3] = A;
        }
      }
    }
    return out;
  };

  /* ==========================================================
   * 3. 图像微调（在网格上做，成本极低）
   * ========================================================== */
  Q.adjust = function (grid, opts) {
    var br = (opts.brightness || 0) * 2.55;              // -255..255
    var ct = (opts.contrast || 0) / 100;                 // -1..1
    var sa = 1 + (opts.saturation || 0) / 100;           // 0..2
    var gm = (opts.gamma || 100) / 100;
    if (!br && !ct && Math.abs(sa - 1) < 1e-6 && Math.abs(gm - 1) < 1e-6) return grid;
    var cf = ct >= 0 ? 1 / Math.max(1e-3, 1 - ct) : 1 + ct;   // 对比度系数
    var invG = 1 / gm;
    for (var i = 0; i < grid.length; i += 4) {
      var r = grid[i], g = grid[i + 1], b = grid[i + 2];
      if (br) { r += br; g += br; b += br; }
      if (ct) { r = (r - 128) * cf + 128; g = (g - 128) * cf + 128; b = (b - 128) * cf + 128; }
      if (Math.abs(sa - 1) > 1e-6) {
        var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = lum + (r - lum) * sa; g = lum + (g - lum) * sa; b = lum + (b - lum) * sa;
      }
      if (Math.abs(gm - 1) > 1e-6) {
        r = 255 * Math.pow(Math.max(0, r) / 255, invG);
        g = 255 * Math.pow(Math.max(0, g) / 255, invG);
        b = 255 * Math.pow(Math.max(0, b) / 255, invG);
      }
      grid[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      grid[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      grid[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    return grid;
  };

  /** 非锐化掩模（在网格上做，强化格子间边界） */
  Q.sharpen = function (grid, w, h, amount) {
    if (amount <= 0) return grid;
    var k = amount / 100 * 1.2;
    var out = new Float32Array(grid);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) << 2;
        for (var c = 0; c < 3; c++) {
          var sum = 0, n = 0;
          for (var dy = -1; dy <= 1; dy++) {
            var yy = y + dy; if (yy < 0 || yy >= h) continue;
            for (var dx = -1; dx <= 1; dx++) {
              var xx = x + dx; if (xx < 0 || xx >= w) continue;
              sum += grid[((yy * w + xx) << 2) + c]; n++;
            }
          }
          var blur = sum / n;
          var v = grid[i + c] + (grid[i + c] - blur) * k;
          out[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
    return out;
  };

  /* ==========================================================
   * 4. 颜色量化
   * ========================================================== */

  /** 从网格提取不透明格子的 Lab 采样点 */
  function collectLab(grid, w, h, alphaTh, maxSamples) {
    var total = w * h;
    var idxs = [];
    for (var p = 0; p < total; p++) if (grid[(p << 2) + 3] >= alphaTh) idxs.push(p);
    var step = 1;
    if (maxSamples && idxs.length > maxSamples) step = Math.ceil(idxs.length / maxSamples);
    var n = Math.ceil(idxs.length / step);
    var lab = new Float32Array(n * 3);
    var tmp = [0, 0, 0], j = 0;
    for (var q = 0; q < idxs.length; q += step) {
      var i = idxs[q] << 2;
      C.rgbToLab(grid[i], grid[i + 1], grid[i + 2], tmp);
      lab[j++] = tmp[0]; lab[j++] = tmp[1]; lab[j++] = tmp[2];
    }
    return { lab: lab, n: n, opaque: idxs.length };
  }
  Q.collectLab = collectLab;

  /* ----------------------------------------------------------
   * 关于「更能保留细节的量化算法」——试过，结论是不需要，记下来免得重复走弯路。
   *
   * 在 600×400 的测试图（大片渐变 + 七根鲜艳色条）上用 12 色量化：
   *   普通 K-Means           平均 ΔE2000 = 3.87，最差 6.88
   *   理论下限（每种颜色都
   *   在 221 色卡里挑最近的，
   *   不限色号预算）          平均 ΔE2000 = 3.00，最差 4.44
   *
   * 也就是说 K-Means 已经贴着色卡的物理极限了，残余误差主要来自
   * **色卡里根本没有那个颜色**，换聚类算法救不回来。
   *
   * 三种尝试都实测更差，别再试：
   *   1. 按局部对比度加权采样 —— 平滑渐变处处有小对比度、纯色块内部为零，
   *      预算全跑去渐变和边缘，而边缘恰恰是不想要的中间色；
   *   2. 按颜色箱等权投票 —— 大渐变横跨的箱子数远多于小色块，还是它赢；
   *   3. K-Means 后「合并最近的一对中心、把空出的中心放到误差最大处」——
   *      误差最大的往往是边界上的中间色，抢救它等于浪费一个色号（最差 ΔE 6.88 → 13.82）。
   *
   * 真正能提升细节的是别处：提高格数（比豆子还细的特征只能靠分辨率）、
   * 边缘保留采样（见 downEdge）、以及抖动。
   * ---------------------------------------------------------- */

  /** K-Means（Lab 空间，k-means++ 初始化，确定性） */
  Q.kmeans = function (lab, n, k, maxIter, seed) {
    if (n === 0) return { centers: new Float32Array(0), k: 0 };
    k = Math.min(k, n);
    var rnd = Q.rng(seed || 12345);
    var centers = new Float32Array(k * 3);
    var d2 = new Float64Array(n).fill(Infinity);

    // k-means++ 初始化
    var first = Math.floor(rnd() * n);
    centers[0] = lab[first * 3]; centers[1] = lab[first * 3 + 1]; centers[2] = lab[first * 3 + 2];
    for (var c = 1; c < k; c++) {
      var sum = 0, i, dl, da, db, d;
      var cl = centers[(c - 1) * 3], ca = centers[(c - 1) * 3 + 1], cb = centers[(c - 1) * 3 + 2];
      for (i = 0; i < n; i++) {
        dl = lab[i * 3] - cl; da = lab[i * 3 + 1] - ca; db = lab[i * 3 + 2] - cb;
        d = dl * dl + da * da + db * db;
        if (d < d2[i]) d2[i] = d;
        sum += d2[i];
      }
      var target = rnd() * sum, acc = 0, pick = n - 1;
      for (i = 0; i < n; i++) { acc += d2[i]; if (acc >= target) { pick = i; break; } }
      centers[c * 3] = lab[pick * 3];
      centers[c * 3 + 1] = lab[pick * 3 + 1];
      centers[c * 3 + 2] = lab[pick * 3 + 2];
    }

    // Lloyd 迭代
    var assign = new Int32Array(n);
    var sumL = new Float64Array(k), sumA = new Float64Array(k), sumB = new Float64Array(k);
    var cnt = new Float64Array(k);
    maxIter = maxIter || 24;
    for (var it = 0; it < maxIter; it++) {
      sumL.fill(0); sumA.fill(0); sumB.fill(0); cnt.fill(0);
      var moved = 0;
      for (var p = 0; p < n; p++) {
        var L = lab[p * 3], A = lab[p * 3 + 1], B = lab[p * 3 + 2];
        var best = 0, bd = Infinity;
        for (var q = 0; q < k; q++) {
          var xl = L - centers[q * 3], xa = A - centers[q * 3 + 1], xb = B - centers[q * 3 + 2];
          var dd = xl * xl + xa * xa + xb * xb;
          if (dd < bd) { bd = dd; best = q; }
        }
        if (assign[p] !== best) { assign[p] = best; moved++; }
        sumL[best] += L; sumA[best] += A; sumB[best] += B; cnt[best]++;
      }
      for (var m = 0; m < k; m++) {
        if (cnt[m] > 0) {
          centers[m * 3] = sumL[m] / cnt[m];
          centers[m * 3 + 1] = sumA[m] / cnt[m];
          centers[m * 3 + 2] = sumB[m] / cnt[m];
        }
      }
      if (moved === 0 && it > 0) break;
    }

    // 按簇大小降序返回（大簇优先分配色号，避免主色被挤掉）
    var order = [];
    for (var z = 0; z < k; z++) order.push(z);
    order.sort(function (a, b) { return cnt[b] - cnt[a]; });
    var res = new Float32Array(k * 3), weights = new Float64Array(k);
    order.forEach(function (o, t) {
      res[t * 3] = centers[o * 3]; res[t * 3 + 1] = centers[o * 3 + 1]; res[t * 3 + 2] = centers[o * 3 + 2];
      weights[t] = cnt[o];
    });
    return { centers: res, k: k, weights: weights };
  };

  /** 中位切分（Median Cut，Lab 空间） */
  Q.medianCut = function (lab, n, k) {
    if (n === 0) return { centers: new Float32Array(0), k: 0, weights: new Float64Array(0) };
    var all = new Int32Array(n);
    for (var i = 0; i < n; i++) all[i] = i;
    var boxes = [makeBox(all)];

    function makeBox(members) {
      var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (var j = 0; j < members.length; j++) {
        for (var c = 0; c < 3; c++) {
          var v = lab[members[j] * 3 + c];
          if (v < lo[c]) lo[c] = v;
          if (v > hi[c]) hi[c] = v;
        }
      }
      // Lab 中 a/b 的感知权重略低于 L，用系数平衡切分方向
      var wgt = [1.0, 0.85, 0.85];
      var ext = [(hi[0] - lo[0]) * wgt[0], (hi[1] - lo[1]) * wgt[1], (hi[2] - lo[2]) * wgt[2]];
      var axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : (ext[1] >= ext[2] ? 1 : 2);
      return { members: members, axis: axis, ext: ext[axis] };
    }

    while (boxes.length < k) {
      // 选体积最大且可切分的盒子
      var bi = -1, bv = -1;
      for (var t = 0; t < boxes.length; t++) {
        if (boxes[t].members.length < 2) continue;
        var v = boxes[t].ext * Math.log(1 + boxes[t].members.length);
        if (v > bv) { bv = v; bi = t; }
      }
      if (bi < 0) break;
      var box = boxes[bi], ax = box.axis;
      var mem = Array.prototype.slice.call(box.members);
      mem.sort(function (p, q) { return lab[p * 3 + ax] - lab[q * 3 + ax]; });
      var mid = mem.length >> 1;
      if (mid === 0 || mid === mem.length) break;
      boxes.splice(bi, 1,
        makeBox(Int32Array.from(mem.slice(0, mid))),
        makeBox(Int32Array.from(mem.slice(mid))));
    }

    boxes.sort(function (a, b) { return b.members.length - a.members.length; });
    var kk = boxes.length;
    var centers = new Float32Array(kk * 3), weights = new Float64Array(kk);
    boxes.forEach(function (b, t) {
      var sl = 0, sa = 0, sb = 0;
      for (var j = 0; j < b.members.length; j++) {
        sl += lab[b.members[j] * 3];
        sa += lab[b.members[j] * 3 + 1];
        sb += lab[b.members[j] * 3 + 2];
      }
      var m = b.members.length || 1;
      centers[t * 3] = sl / m; centers[t * 3 + 1] = sa / m; centers[t * 3 + 2] = sb / m;
      weights[t] = b.members.length;
    });
    return { centers: centers, k: kk, weights: weights };
  };

  /* ==========================================================
   * 5. 色卡匹配
   * ========================================================== */

  /** 单个 Lab → 色卡下标（CIEDE2000，精确，用于少量质心） */
  Q.nearestExact = function (L, a, b, pal, used) {
    var best = -1, bd = Infinity;
    for (var i = 0; i < pal.length; i++) {
      if (used && used[i]) continue;
      var d = C.deltaE2000(L, a, b, pal[i].lab[0], pal[i].lab[1], pal[i].lab[2]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  /**
   * 把量化质心映射到色卡，尽量不重复（贪心，按簇权重从大到小）
   * @returns 色卡下标数组（已去重）
   */
  Q.centersToPalette = function (centers, k, weights, pal, avoidDup) {
    var used = avoidDup ? new Uint8Array(pal.length) : null;
    var picked = [], seen = {};
    for (var i = 0; i < k; i++) {
      var L = centers[i * 3], a = centers[i * 3 + 1], b = centers[i * 3 + 2];
      var idx = Q.nearestExact(L, a, b, pal, used);
      if (idx < 0) idx = Q.nearestExact(L, a, b, pal, null);   // 色卡用尽则允许复用
      if (idx < 0) continue;
      if (used) used[idx] = 1;
      if (!seen[idx]) { seen[idx] = 1; picked.push(idx); }
    }
    return picked;
  };

  /* ==========================================================
   * 6. 网格 → 色卡下标（含抖动）
   * ========================================================== */

  var BAYER8 = (function () {
    var m = [
      [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
      [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
      [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
      [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]
    ];
    var f = new Float32Array(64);
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) f[y * 8 + x] = m[y][x] / 64 - 0.5;
    return f;
  })();

  /**
   * @param grid   Float32Array(w*h*4)
   * @param sub    调色板子集：[{rgb, lab}, ...]（已是最终可用色）
   * @param opts   {dither:'none'|'fs'|'ordered', amount:0..1, alphaTh}
   * @returns Int32Array(w*h)，-1 表示空格
   */
  Q.remap = function (grid, w, h, sub, opts) {
    var n = w * h;
    var out = new Int32Array(n).fill(-1);
    if (!sub.length) return out;

    var k = sub.length;
    var pl = new Float32Array(k), pa = new Float32Array(k), pb = new Float32Array(k);
    var pr = new Float32Array(k), pg = new Float32Array(k), pbl = new Float32Array(k);
    for (var i = 0; i < k; i++) {
      pl[i] = sub[i].lab[0]; pa[i] = sub[i].lab[1]; pb[i] = sub[i].lab[2];
      pr[i] = sub[i].rgb[0]; pg[i] = sub[i].rgb[1]; pbl[i] = sub[i].rgb[2];
    }
    var tmp = [0, 0, 0];
    function nearest(r, g, b) {
      C.rgbToLab(r, g, b, tmp);
      var L = tmp[0], A = tmp[1], B = tmp[2], best = 0, bd = Infinity;
      for (var q = 0; q < k; q++) {
        var dl = L - pl[q], da = A - pa[q], db = B - pb[q];
        var d = dl * dl + da * da + db * db;
        if (d < bd) { bd = d; best = q; }
      }
      return best;
    }

    var alphaTh = opts.alphaTh == null ? 128 : opts.alphaTh;
    var mode = opts.dither || 'none';
    var amt = opts.amount == null ? 0.7 : opts.amount;

    if (mode === 'ordered' && amt > 0) {
      var scale = 42 * amt;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var p = y * w + x, ii = p << 2;
          if (grid[ii + 3] < alphaTh) continue;
          var t = BAYER8[(y & 7) * 8 + (x & 7)] * scale;
          out[p] = nearest(grid[ii] + t, grid[ii + 1] + t, grid[ii + 2] + t);
        }
      }
      return out;
    }

    if (mode === 'fs' && amt > 0) {
      // Floyd–Steinberg（蛇形扫描，误差在 sRGB 空间扩散）
      var buf = new Float32Array(n * 3);
      for (var z = 0; z < n; z++) {
        buf[z * 3] = grid[(z << 2)];
        buf[z * 3 + 1] = grid[(z << 2) + 1];
        buf[z * 3 + 2] = grid[(z << 2) + 2];
      }
      for (var yy = 0; yy < h; yy++) {
        var l2r = (yy & 1) === 0;
        for (var s = 0; s < w; s++) {
          var xx = l2r ? s : (w - 1 - s);
          var pp = yy * w + xx;
          if (grid[(pp << 2) + 3] < alphaTh) continue;
          var r0 = buf[pp * 3], g0 = buf[pp * 3 + 1], b0 = buf[pp * 3 + 2];
          var idx = nearest(r0, g0, b0);
          out[pp] = idx;
          var er = (r0 - pr[idx]) * amt, eg = (g0 - pg[idx]) * amt, eb = (b0 - pbl[idx]) * amt;
          spread(buf, grid, w, h, xx + (l2r ? 1 : -1), yy, er, eg, eb, 7 / 16, alphaTh);
          spread(buf, grid, w, h, xx - (l2r ? 1 : -1), yy + 1, er, eg, eb, 3 / 16, alphaTh);
          spread(buf, grid, w, h, xx, yy + 1, er, eg, eb, 5 / 16, alphaTh);
          spread(buf, grid, w, h, xx + (l2r ? 1 : -1), yy + 1, er, eg, eb, 1 / 16, alphaTh);
        }
      }
      return out;
    }

    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var p2 = y2 * w + x2, i2 = p2 << 2;
        if (grid[i2 + 3] < alphaTh) continue;
        out[p2] = nearest(grid[i2], grid[i2 + 1], grid[i2 + 2]);
      }
    }
    return out;
  };

  function spread(buf, grid, w, h, x, y, er, eg, eb, f, alphaTh) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    var p = y * w + x;
    if (grid[(p << 2) + 3] < alphaTh) return;   // 不把误差扩散到空格里
    buf[p * 3] += er * f;
    buf[p * 3 + 1] += eg * f;
    buf[p * 3 + 2] += eb * f;
  }

  PD.quantize = Q;
})(typeof window !== 'undefined' ? window : this);
