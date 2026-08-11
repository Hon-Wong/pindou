/* ==========================================================
 * app.js — 拼豆图纸生成器 主逻辑
 * ========================================================== */
(function () {
  'use strict';

  var C = PD.color, Q = PD.quantize, P = PD.palettes;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 全局状态 ---------------- */
  var state = {
    img: null,            // HTMLImageElement
    imgName: '',
    srcW: 0, srcH: 0,
    fitCanvas: document.createElement('canvas'),
    result: null,         // { w,h,idx,sub,counts,total,order }
    highlight: -1,
    disabled: {},         // { paletteId: {code:1} } 用户手动禁用的颜色
    hover: null,
    picking: false,
    offX: 0, offY: 0,
    computeSeq: 0        // 每完成一次重算 +1，方便调试与自动化测试
  };

  var opts = {
    gridW: 64, gridH: 64, lockAspect: true, fitMode: 'cover',
    mosaic: 1, sampleMode: 'area', blur: 0, sharpen: 0,
    paletteId: 'mard', algo: 'kmeans', colors: 16,
    dither: 'none', ditherAmt: 70,
    brightness: 0, contrast: 0, saturation: 0, gamma: 100,
    bgRemove: false, bgColor: '#ffffff', bgTol: 12, alphaTh: 128
  };

  var view = {
    mode: 'chart', cell: 24, labelMode: 'code', beadShape: 'round',
    showGrid: true, showBold10: true, showRuler: true, beadMm: 5
  };

  var LS_KEY = 'pindou.v1';
  var RULER = 26;
  // 格数范围，index.html 里滑块的 min/max 要与此保持一致
  var GRID_MIN = 5, GRID_MAX = 200;

  /* ---------------- DOM ---------------- */
  var dom = {};
  ['fileInput', 'dropZone', 'thumb', 'dropHint', 'imgMeta', 'btnOpen',
   'gridW', 'gridWNum', 'gridH', 'gridHNum', 'lockAspect', 'fitMode', 'presets', 'sizeInfo',
   'mosaic', 'mosaicVal', 'sampleMode', 'blur', 'blurVal', 'sharpen', 'sharpenVal',
   'paletteSel', 'btnPalette', 'palInfo', 'algo', 'colors', 'colorsNum',
   'dither', 'ditherAmt', 'ditherAmtVal',
   'brightness', 'brightnessVal', 'contrast', 'contrastVal',
   'saturation', 'saturationVal', 'gamma', 'gammaVal',
   'bgRemove', 'bgColor', 'btnPickBg', 'bgTol', 'bgTolVal', 'alphaTh', 'alphaThVal',
   'viewMode', 'cellSize', 'cellSizeVal', 'labelMode', 'beadShape',
   'showGrid', 'showBold10', 'showRuler', 'beadMm',
   'viewport', 'mainCanvas', 'rulerTop', 'rulerLeft', 'corner', 'scroller', 'spacer',
   'emptyState', 'busy', 'hoverInfo', 'status',
   'statColors', 'statTotal', 'statSize', 'statPhysical', 'colorList', 'listSearch', 'listSort',
   'paletteModal', 'palList', 'palSearch', 'palSeries', 'palCount',
   'btnPalAll', 'btnPalNone', 'btnPalInvert', 'btnCloseModal',
   'customCsv', 'btnApplyCustom', 'btnExportPal',
   'btnExportMenu', 'exportMenu', 'btnExportChart', 'btnExportPreview', 'btnExportCSV',
   'btnCopyList', 'btnSaveSettings', 'btnLoadSettings', 'settingsInput',
   'btnPrint', 'btnReset', 'btnSample'
  ].forEach(function (id) { dom[id] = $(id); });

  /* ==========================================================
   * 色卡辅助
   * ========================================================== */
  function currentPalette() { return P.get(opts.paletteId); }

  function disabledSet() {
    if (!state.disabled[opts.paletteId]) state.disabled[opts.paletteId] = {};
    return state.disabled[opts.paletteId];
  }

  function enabledColors() {
    var d = disabledSet();
    return currentPalette().colors.filter(function (c) { return !d[c.code]; });
  }

  /* ==========================================================
   * 图片载入
   * ========================================================== */
  function loadImageFromFile(file) {
    if (!file || !/^image\//.test(file.type)) { setStatus('不是图片文件'); return; }
    var fr = new FileReader();
    fr.onload = function () { loadImageFromURL(fr.result, file.name); };
    fr.onerror = function () { setStatus('读取失败'); };
    fr.readAsDataURL(file);          // data: URL 不会污染 canvas，file:// 下也能用
  }

  function loadImageFromURL(url, name) {
    var img = new Image();
    img.onload = function () {
      state.img = img;
      state.imgName = name || '图片';
      state.srcW = img.naturalWidth; state.srcH = img.naturalHeight;
      dom.thumb.src = url; dom.thumb.hidden = false; dom.dropHint.hidden = true;
      dom.imgMeta.textContent = state.imgName + ' · ' + state.srcW + '×' + state.srcH + ' px';
      if (opts.lockAspect) syncAspect();
      state.highlight = -1;
      scheduleCompute(0);
    };
    img.onerror = function () { setStatus('图片解码失败'); };
    img.src = url;
  }

  /** 从 URL 载入图片：先取 blob 转 data URL，避免 canvas 被跨源/本地文件污染 */
  function loadImageFromPath(url, name) {
    setStatus('载入中…');
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.blob();
    }).then(function (b) {
      var fr = new FileReader();
      fr.onload = function () { loadImageFromURL(fr.result, name); };
      fr.readAsDataURL(b);
    }).catch(function () {
      loadImageFromURL(url, name);     // file:// 下 fetch 不可用，直接退回
    });
  }

  function syncAspect() {
    if (!state.srcW) return;
    var h = Math.round(opts.gridW * state.srcH / state.srcW);
    opts.gridH = Math.max(GRID_MIN, Math.min(GRID_MAX, h || GRID_MIN));
    dom.gridH.value = dom.gridHNum.value = opts.gridH;
  }

  /* ==========================================================
   * 源图 → 适配画布（cover / contain / stretch）
   * ========================================================== */
  function fitSource(gw, gh) {
    // 每格用 k×k 个源像素做面积平均，k 由原图分辨率决定
    var k = Math.max(1, Math.min(12, Math.round(Math.max(state.srcW / gw, state.srcH / gh))));
    var fw = gw * k, fh = gh * k;

    var cv = state.fitCanvas;
    cv.width = fw; cv.height = fh;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, fw, fh);

    var sw = state.srcW, sh = state.srcH;
    var sx = 0, sy = 0, ssw = sw, ssh = sh, dx = 0, dy = 0, dw = fw, dh = fh;

    if (opts.fitMode === 'cover') {
      var s = Math.max(fw / sw, fh / sh);
      ssw = fw / s; ssh = fh / s;
      sx = (sw - ssw) / 2; sy = (sh - ssh) / 2;
    } else if (opts.fitMode === 'contain') {
      var s2 = Math.min(fw / sw, fh / sh);
      dw = sw * s2; dh = sh * s2;
      dx = (fw - dw) / 2; dy = (fh - dh) / 2;
    }

    // 逐级减半以获得干净的缩小结果
    var src = progressiveDownscale(state.img, sw, sh, sx, sy, ssw, ssh, Math.round(dw), Math.round(dh));

    var blockPx = k;                                  // 一个格子对应的源像素边长
    if (opts.blur > 0) ctx.filter = 'blur(' + (opts.blur * blockPx * 0.22).toFixed(2) + 'px)';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.canvas, 0, 0, src.w, src.h, dx, dy, dw, dh);
    ctx.filter = 'none';

    return { w: fw, h: fh, data: ctx.getImageData(0, 0, fw, fh).data };
  }

  var tmpA = document.createElement('canvas'), tmpB = document.createElement('canvas');
  function progressiveDownscale(img, sw, sh, sx, sy, ssw, ssh, tw, th) {
    // 首帧最多放大到目标的 4 倍，避免超大原图吃掉几百 MB 显存
    var cw = Math.max(1, Math.min(Math.round(ssw), Math.max(tw * 4, tw)));
    var ch = Math.max(1, Math.min(Math.round(ssh), Math.max(th * 4, th)));
    var a = tmpA, b = tmpB;
    a.width = cw; a.height = ch;
    var actx = a.getContext('2d');
    actx.clearRect(0, 0, cw, ch);
    actx.imageSmoothingEnabled = true; actx.imageSmoothingQuality = 'high';
    actx.drawImage(img, sx, sy, ssw, ssh, 0, 0, cw, ch);

    var curW = cw, curH = ch, cur = a, other = b;
    while (curW > tw * 2 && curH > th * 2 && curW > 2 && curH > 2) {
      var nw = Math.max(tw, curW >> 1), nh = Math.max(th, curH >> 1);
      other.width = nw; other.height = nh;
      var octx = other.getContext('2d');
      octx.clearRect(0, 0, nw, nh);
      octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';
      octx.drawImage(cur, 0, 0, curW, curH, 0, 0, nw, nh);
      var t = cur; cur = other; other = t;
      curW = nw; curH = nh;
    }
    return { canvas: cur, w: curW, h: curH };
  }

  /** 背景色移除（在适配画布的像素上做） */
  function removeBg(data, hex, tol) {
    var rgb = C.hexToRgb(hex) || [255, 255, 255];
    var lab = C.rgbToLab(rgb[0], rgb[1], rgb[2], [0, 0, 0]);
    var t = tol * tol * 1.6;                 // 容差 → CIE76 平方阈值
    var tmp = [0, 0, 0];
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      C.rgbToLab(data[i], data[i + 1], data[i + 2], tmp);
      if (C.deltaE76sq(tmp[0], tmp[1], tmp[2], lab[0], lab[1], lab[2]) <= t) data[i + 3] = 0;
    }
  }

  /* ==========================================================
   * 主流程
   * ========================================================== */
  var computeTimer = null;
  function scheduleCompute(delay) {
    clearTimeout(computeTimer);
    if (!state.img) { render(); return; }
    dom.busy.classList.remove('hidden');
    computeTimer = setTimeout(function () {
      // 先让浏览器画出「计算中」，再做后面这段会卡住主线程的同步计算。
      // rAF 在后台标签页/不可见容器里会被节流，所以加一道超时兜底，
      // 否则转圈会一直停在那儿。
      var ran = false;
      var go = function () {
        if (ran) return;
        ran = true;
        try { compute(); }
        catch (e) { console.error(e); setStatus('计算出错：' + e.message); }
        dom.busy.classList.add('hidden');
      };
      requestAnimationFrame(go);
      setTimeout(go, 300);
    }, delay == null ? 140 : delay);
  }

  function compute() {
    var t0 = performance.now();
    var gw = opts.gridW, gh = opts.gridH;

    var fit = fitSource(gw, gh);
    if (opts.bgRemove) removeBg(fit.data, opts.bgColor, opts.bgTol);

    var grid = Q.downsample(fit.data, fit.w, fit.h, gw, gh, opts.sampleMode);
    grid = Q.mosaic(grid, gw, gh, opts.mosaic);
    Q.adjust(grid, opts);
    if (opts.sharpen > 0) grid = Q.sharpen(grid, gw, gh, opts.sharpen);

    var pal = enabledColors();
    if (!pal.length) {
      setStatus('当前色卡一个颜色都没勾选，无法配色 —— 打开「管理色卡」点「全选」即可恢复');
      return;
    }

    var want = Math.min(opts.colors, pal.length);
    var sub;

    if (opts.algo === 'direct') {
      // 先用整张色卡匹配，再按用量裁剪到 N 色
      var first = Q.remap(grid, gw, gh, pal, { dither: 'none', alphaTh: opts.alphaTh });
      var use = new Float64Array(pal.length);
      for (var i = 0; i < first.length; i++) if (first[i] >= 0) use[first[i]]++;
      var ranked = [];
      for (var j = 0; j < pal.length; j++) if (use[j] > 0) ranked.push([j, use[j]]);
      ranked.sort(function (a, b) { return b[1] - a[1]; });
      sub = ranked.slice(0, want).map(function (r) { return pal[r[0]]; });
    } else {
      var s = Q.collectLab(grid, gw, gh, opts.alphaTh, 24000);
      if (s.n === 0) { setStatus('图片全透明，试试调低透明阈值'); state.result = null; render(); return; }
      var res = opts.algo === 'mediancut'
        ? Q.medianCut(s.lab, s.n, want)
        : Q.kmeans(s.lab, s.n, want, 26, 20240815);
      var picked = Q.centersToPalette(res.centers, res.k, res.weights, pal, true);
      sub = picked.map(function (ix) { return pal[ix]; });
    }
    if (!sub.length) sub = [pal[0]];

    var idx = Q.remap(grid, gw, gh, sub, {
      dither: opts.dither,
      amount: opts.ditherAmt / 100,
      alphaTh: opts.alphaTh
    });

    // 统计并剔除未使用的颜色（重建索引）
    var counts = new Array(sub.length).fill(0), total = 0, n;
    for (n = 0; n < idx.length; n++) if (idx[n] >= 0) { counts[idx[n]]++; total++; }
    var map = new Int32Array(sub.length).fill(-1), sub2 = [], counts2 = [];
    for (n = 0; n < sub.length; n++) {
      if (counts[n] > 0) { map[n] = sub2.length; sub2.push(sub[n]); counts2.push(counts[n]); }
    }
    for (n = 0; n < idx.length; n++) if (idx[n] >= 0) idx[n] = map[idx[n]];

    state.result = {
      w: gw, h: gh, idx: idx, sub: sub2, counts: counts2, total: total,
      symbols: sub2.map(function (_, i2) { return P.symbols[i2 % P.symbols.length]; })
    };
    if (state.highlight >= sub2.length) state.highlight = -1;
    state.computeSeq++;

    setStatus('生成完成 · ' + sub2.length + ' 色 · ' + Math.round(performance.now() - t0) + ' ms');
    updateStats();
    renderColorList();
    layout();
    render();
    saveSettings();
  }

  /* ==========================================================
   * 视图布局与绘制
   * ========================================================== */
  function rulerSize() { return view.showRuler ? RULER : 0; }

  function layout() {
    var vw = dom.viewport.clientWidth, vh = dom.viewport.clientHeight;
    var R = rulerSize();
    var sw = Math.max(0, vw - R), sh = Math.max(0, vh - R);

    dom.scroller.style.left = R + 'px';
    dom.scroller.style.top = R + 'px';
    dom.scroller.style.right = 'auto';
    dom.scroller.style.bottom = 'auto';
    dom.scroller.style.width = sw + 'px';
    dom.scroller.style.height = sh + 'px';

    setCanvasSize(dom.mainCanvas, sw, sh, R, R);
    setCanvasSize(dom.rulerTop, sw, R, R, 0);
    setCanvasSize(dom.rulerLeft, R, sh, 0, R);
    dom.rulerTop.style.display = R ? 'block' : 'none';
    dom.rulerLeft.style.display = R ? 'block' : 'none';
    dom.corner.style.display = R ? 'block' : 'none';
    dom.corner.style.width = R + 'px';
    dom.corner.style.height = R + 'px';
    dom.corner.style.background = view.mode === 'chart' ? '#f6f6f8' : '#c9ccd2';

    var r = state.result;
    var gpw = r ? r.w * view.cell : 1, gph = r ? r.h * view.cell : 1;
    dom.spacer.style.width = gpw + 'px';
    dom.spacer.style.height = gph + 'px';

    var cw = dom.scroller.clientWidth, ch = dom.scroller.clientHeight;
    state.offX = gpw < cw ? Math.floor((cw - gpw) / 2) : 0;
    state.offY = gph < ch ? Math.floor((ch - gph) / 2) : 0;
  }

  function setCanvasSize(cv, w, h, left, top) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.style.left = left + 'px'; cv.style.top = top + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  var THEME = {
    chart: { paper: '#ffffff', empty: '#f0f0f3', grid: '#d3d5da', bold: '#8b919c', ruler: '#f6f6f8', rulerFg: '#4a5058', rulerLine: '#d3d5da' },
    preview: { paper: '#d8dade', empty: '#c9ccd2', grid: 'rgba(0,0,0,.08)', bold: 'rgba(0,0,0,.22)', ruler: '#c9ccd2', rulerFg: '#3d4148', rulerLine: '#aeb2ba' }
  };

  function render() {
    var r = state.result;
    dom.emptyState.classList.toggle('hidden', !!r);
    var th = THEME[view.mode];

    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = dom.mainCanvas.width / dpr, ch = dom.mainCanvas.height / dpr;
    var ctx = dom.mainCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.paper;
    ctx.fillRect(0, 0, cw, ch);
    if (!r) { drawRulers(); return; }

    var cell = view.cell;
    var sx = dom.scroller.scrollLeft, sy = dom.scroller.scrollTop;
    var ox = state.offX - sx, oy = state.offY - sy;

    var c0 = Math.max(0, Math.floor(-ox / cell));
    var c1 = Math.min(r.w - 1, Math.ceil((cw - ox) / cell));
    var r0 = Math.max(0, Math.floor(-oy / cell));
    var r1 = Math.min(r.h - 1, Math.ceil((ch - oy) / cell));
    if (c1 < c0 || r1 < r0) { drawRulers(); return; }

    var hl = state.highlight;
    var showLabel = view.labelMode !== 'none' && view.mode === 'chart' && cell >= 13;
    var both = view.labelMode === 'both' && cell >= 22;
    var fontMain = Math.max(6, Math.floor(cell * (both ? 0.34 : 0.42)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- 格子 ---
    for (var y = r0; y <= r1; y++) {
      var py = Math.round(oy + y * cell);
      for (var x = c0; x <= c1; x++) {
        var px = Math.round(ox + x * cell);
        var i = r.idx[y * r.w + x];
        if (i < 0) {
          ctx.fillStyle = th.empty;
          ctx.fillRect(px, py, cell, cell);
          continue;
        }
        var col = r.sub[i];
        var dim = hl >= 0 && i !== hl;

        if (view.mode === 'preview') {
          ctx.fillStyle = th.empty;
          ctx.fillRect(px, py, cell, cell);
          drawBead(ctx, px, py, cell, col.hex, dim);
        } else {
          ctx.fillStyle = col.hex;
          ctx.fillRect(px, py, cell, cell);
          if (dim) { ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fillRect(px, py, cell, cell); }
          if (showLabel && !dim) {
            ctx.fillStyle = C.textOn(col.rgb[0], col.rgb[1], col.rgb[2]);
            var cx = px + cell / 2, cy = py + cell / 2;
            if (both) {
              ctx.font = fontMain + 'px ui-monospace,SFMono-Regular,Menlo,monospace';
              ctx.fillText(r.symbols[i], cx, cy - cell * 0.19);
              ctx.fillText(col.code, cx, cy + cell * 0.21);
            } else {
              ctx.font = 'bold ' + fontMain + 'px ui-monospace,SFMono-Regular,Menlo,monospace';
              ctx.fillText(view.labelMode === 'symbol' ? r.symbols[i] : col.code, cx, cy);
            }
          }
        }
      }
    }

    // --- 网格线 ---
    if (view.showGrid && cell >= 4) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      for (var gx = c0; gx <= c1 + 1; gx++) {
        var X = Math.round(ox + gx * cell) + 0.5;
        ctx.moveTo(X, Math.max(0, oy + r0 * cell));
        ctx.lineTo(X, Math.min(ch, oy + (r1 + 1) * cell));
      }
      for (var gy = r0; gy <= r1 + 1; gy++) {
        var Y = Math.round(oy + gy * cell) + 0.5;
        ctx.moveTo(Math.max(0, ox + c0 * cell), Y);
        ctx.lineTo(Math.min(cw, ox + (c1 + 1) * cell), Y);
      }
      ctx.stroke();
    }
    if (view.showBold10 && cell >= 4) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = th.bold;
      ctx.beginPath();
      for (var bx = Math.floor(c0 / 10) * 10; bx <= c1 + 1; bx += 10) {
        var X2 = Math.round(ox + bx * cell) + 0.5;
        ctx.moveTo(X2, Math.max(0, oy)); ctx.lineTo(X2, Math.min(ch, oy + r.h * cell));
      }
      for (var by = Math.floor(r0 / 10) * 10; by <= r1 + 1; by += 10) {
        var Y2 = Math.round(oy + by * cell) + 0.5;
        ctx.moveTo(Math.max(0, ox), Y2); ctx.lineTo(Math.min(cw, ox + r.w * cell), Y2);
      }
      ctx.stroke();
      // 外边框
      ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, r.w * cell, r.h * cell);
    }

    // --- 悬停高亮 ---
    if (state.hover) {
      var hx = Math.round(ox + state.hover.x * cell), hy = Math.round(oy + state.hover.y * cell);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ff3b30';
      ctx.strokeRect(hx + 1, hy + 1, cell - 2, cell - 2);
    }

    drawRulers();
  }

  function drawBead(ctx, px, py, cell, hex, dim) {
    var cx = px + cell / 2, cy = py + cell / 2;
    var R = cell * 0.46, hole = cell * 0.17;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.25;
    if (view.beadShape === 'square') {
      ctx.fillStyle = hex;
      ctx.fillRect(px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88);
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = hex; ctx.fill();
    }
    if (cell >= 7) {
      ctx.beginPath(); ctx.arc(cx, cy, hole, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fill();
      // 顶部高光，让豆子有立体感
      ctx.beginPath(); ctx.arc(cx - R * 0.28, cy - R * 0.3, R * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill();
    }
    ctx.restore();
  }

  function drawRulers() {
    if (!view.showRuler) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var th = THEME[view.mode];
    var r = state.result, cell = view.cell;
    var sx = dom.scroller.scrollLeft, sy = dom.scroller.scrollTop;
    var ox = state.offX - sx, oy = state.offY - sy;

    var tw = dom.rulerTop.width / dpr, tHh = dom.rulerTop.height / dpr;
    var tctx = dom.rulerTop.getContext('2d');
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.fillStyle = th.ruler; tctx.fillRect(0, 0, tw, tHh);
    tctx.strokeStyle = th.rulerLine; tctx.lineWidth = 1;
    tctx.beginPath(); tctx.moveTo(0, tHh - 0.5); tctx.lineTo(tw, tHh - 0.5); tctx.stroke();

    var lw = dom.rulerLeft.width / dpr, lh = dom.rulerLeft.height / dpr;
    var lctx = dom.rulerLeft.getContext('2d');
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.fillStyle = th.ruler; lctx.fillRect(0, 0, lw, lh);
    lctx.strokeStyle = th.rulerLine; lctx.lineWidth = 1;
    lctx.beginPath(); lctx.moveTo(lw - 0.5, 0); lctx.lineTo(lw - 0.5, lh); lctx.stroke();
    if (!r) return;

    var step = cell >= 22 ? 1 : cell >= 12 ? 5 : 10;
    var fs = Math.min(11, Math.max(8, Math.floor(cell * 0.5)));
    tctx.font = fs + 'px ui-monospace,SFMono-Regular,Menlo,monospace';
    tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
    lctx.font = fs + 'px ui-monospace,SFMono-Regular,Menlo,monospace';
    lctx.textAlign = 'center'; lctx.textBaseline = 'middle';

    var c0 = Math.max(0, Math.floor(-ox / cell)), c1 = Math.min(r.w - 1, Math.ceil((tw - ox) / cell));
    for (var x = c0; x <= c1; x++) {
      var n = x + 1;
      if (step > 1 && n % step !== 0 && n !== 1) continue;
      var X = ox + x * cell + cell / 2;
      if (X < -10 || X > tw + 10) continue;
      tctx.fillStyle = (n % 10 === 0) ? '#c0392b' : th.rulerFg;
      tctx.fillText(String(n), X, tHh / 2);
    }
    var r0 = Math.max(0, Math.floor(-oy / cell)), r1 = Math.min(r.h - 1, Math.ceil((lh - oy) / cell));
    for (var y = r0; y <= r1; y++) {
      var m = y + 1;
      if (step > 1 && m % step !== 0 && m !== 1) continue;
      var Y = oy + y * cell + cell / 2;
      if (Y < -10 || Y > lh + 10) continue;
      lctx.fillStyle = (m % 10 === 0) ? '#c0392b' : th.rulerFg;
      lctx.fillText(String(m), lw / 2, Y);
    }
  }

  /* ==========================================================
   * 统计 / 配色清单
   * ========================================================== */
  function updateStats() {
    var r = state.result;
    if (!r) {
      dom.statColors.textContent = '0'; dom.statTotal.textContent = '0';
      dom.statSize.textContent = '—'; dom.statPhysical.textContent = '—';
      return;
    }
    dom.statColors.textContent = r.sub.length;
    dom.statTotal.textContent = r.total.toLocaleString('zh-CN');
    dom.statSize.textContent = r.w + '×' + r.h;
    var mm = view.beadMm;
    // 大尺寸时去掉小数，否则 "100.0×75.0 cm" 会撑爆这一格
    function cm(n) { var v = n * mm / 10; return v >= 100 ? String(Math.round(v)) : v.toFixed(1); }
    dom.statPhysical.textContent = cm(r.w) + '×' + cm(r.h) + ' cm';
    dom.statPhysical.className = 'sm';       // 这格字最长，缩小一档免得换行
    var boards = Math.ceil(r.w / 29) * Math.ceil(r.h / 29);
    dom.sizeInfo.textContent = '共 ' + (r.w * r.h).toLocaleString('zh-CN') + ' 格 · 约需 '
      + boards + ' 块 29×29 方板';
  }

  function sortedOrder() {
    var r = state.result;
    if (!r) return [];
    var ord = r.sub.map(function (_, i) { return i; });
    var mode = dom.listSort.value;
    if (mode === 'count') ord.sort(function (a, b) { return r.counts[b] - r.counts[a]; });
    else if (mode === 'code') ord.sort(function (a, b) { return cmpCode(r.sub[a].code, r.sub[b].code); });
    else ord.sort(function (a, b) {
      var ha = C.rgbToHsl(r.sub[a].rgb[0], r.sub[a].rgb[1], r.sub[a].rgb[2]);
      var hb = C.rgbToHsl(r.sub[b].rgb[0], r.sub[b].rgb[1], r.sub[b].rgb[2]);
      return (ha[0] - hb[0]) || (hb[2] - ha[2]);
    });
    return ord;
  }

  function cmpCode(a, b) {
    var ra = /^([A-Za-z]*)(\d*)/.exec(a), rb = /^([A-Za-z]*)(\d*)/.exec(b);
    if (ra[1] !== rb[1]) return ra[1] < rb[1] ? -1 : 1;
    return (parseInt(ra[2] || '0', 10) - parseInt(rb[2] || '0', 10));
  }

  function renderColorList() {
    var r = state.result;
    dom.colorList.innerHTML = '';
    if (!r) return;
    var kw = (dom.listSearch.value || '').trim().toLowerCase();
    var maxC = Math.max.apply(null, r.counts.concat([1]));
    var frag = document.createDocumentFragment();

    sortedOrder().forEach(function (i) {
      var col = r.sub[i];
      if (kw && (col.code + ' ' + col.name).toLowerCase().indexOf(kw) < 0) return;
      var pct = (r.counts[i] / r.total * 100);
      var el = document.createElement('div');
      el.className = 'crow' + (state.highlight === i ? ' on' : '');
      el.innerHTML =
        '<div class="sw" style="background:' + col.hex + ';color:' + C.textOn(col.rgb[0], col.rgb[1], col.rgb[2]) + '">'
          + r.symbols[i] + '</div>' +
        '<div class="info"><div class="code">' + esc(col.code) + '</div>' +
        '<div class="name">' + esc(col.name) + ' · ' + col.hex + '</div>' +
        '<div class="bar"><i style="width:' + (r.counts[i] / maxC * 100).toFixed(1) + '%;background:' + col.hex + '"></i></div></div>' +
        '<div class="cnt"><b>' + r.counts[i] + '</b><span>' + pct.toFixed(1) + '%</span></div>' +
        '<button class="kill" title="禁用此色并自动替换">🚫</button>';
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('kill')) {
          disabledSet()[col.code] = 1;
          state.highlight = -1;
          scheduleCompute(0);
          return;
        }
        state.highlight = state.highlight === i ? -1 : i;
        renderColorList();
        render();
      });
      frag.appendChild(el);
    });
    dom.colorList.appendChild(frag);

    var d = disabledSet(), off = Object.keys(d);
    if (off.length) {
      var tip = document.createElement('div');
      tip.className = 'hint';
      tip.style.marginTop = '8px';
      tip.innerHTML = '已禁用 ' + off.length + ' 个颜色 · <a href="#" id="undoDisable" style="color:var(--accent)">全部恢复</a>';
      dom.colorList.appendChild(tip);
      $('undoDisable').addEventListener('click', function (e) {
        e.preventDefault();
        state.disabled[opts.paletteId] = {};
        scheduleCompute(0);
      });
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function setStatus(s) { dom.status.textContent = s; }

  /* ==========================================================
   * 离屏渲染（导出 / 打印）
   * ========================================================== */
  function renderChartCanvas(o) {
    o = o || {};
    var r = state.result;
    if (!r) return null;
    var cell = o.cell || Math.max(14, Math.min(34, Math.floor(9000 / Math.max(r.w, r.h))));
    var R = 30;
    var pad = 24;
    var withLegend = o.legend !== false;
    var labelMode = o.labelMode || (view.labelMode === 'none' ? 'code' : view.labelMode);

    // 图例排版
    var legendCols = Math.max(1, Math.min(6, Math.floor((r.w * cell + R) / 240)));
    var legendRows = Math.ceil(r.sub.length / legendCols);
    var legendH = withLegend ? (legendRows * 26 + 56) : 0;

    var W = pad * 2 + R + r.w * cell;
    var H = pad * 2 + R + r.h * cell + legendH + 46;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    // 标题
    ctx.fillStyle = '#111';
    ctx.font = 'bold 20px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(state.imgName || '拼豆图纸', pad, pad + 20);
    ctx.fillStyle = '#666';
    ctx.font = '13px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(
      r.w + '×' + r.h + ' 格 · ' + r.sub.length + ' 色 · ' + r.total + ' 颗 · 成品约 '
      + (r.w * view.beadMm / 10).toFixed(1) + '×' + (r.h * view.beadMm / 10).toFixed(1) + ' cm · 色卡：'
      + currentPalette().name, pad, pad + 40);

    var ox = pad + R, oy = pad + 46 + R;

    // 标尺
    ctx.font = Math.min(12, Math.max(8, Math.floor(cell * 0.45))) + 'px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var step = cell >= 20 ? 1 : cell >= 12 ? 5 : 10;
    var x, y;
    for (x = 0; x < r.w; x++) {
      var n = x + 1;
      if (step > 1 && n % step !== 0 && n !== 1) continue;
      ctx.fillStyle = n % 10 === 0 ? '#c0392b' : '#555';
      ctx.fillText(String(n), ox + x * cell + cell / 2, oy - R / 2);
    }
    for (y = 0; y < r.h; y++) {
      var m = y + 1;
      if (step > 1 && m % step !== 0 && m !== 1) continue;
      ctx.fillStyle = m % 10 === 0 ? '#c0392b' : '#555';
      ctx.fillText(String(m), ox - R / 2, oy + y * cell + cell / 2);
    }

    // 格子
    var showLabel = cell >= 12 && labelMode !== 'none';
    var both = labelMode === 'both' && cell >= 22;
    var fs = Math.max(6, Math.floor(cell * (both ? 0.34 : 0.44)));
    for (y = 0; y < r.h; y++) {
      for (x = 0; x < r.w; x++) {
        var i = r.idx[y * r.w + x];
        var px = ox + x * cell, py = oy + y * cell;
        if (i < 0) { ctx.fillStyle = '#f4f4f6'; ctx.fillRect(px, py, cell, cell); continue; }
        var col = r.sub[i];
        ctx.fillStyle = col.hex; ctx.fillRect(px, py, cell, cell);
        if (showLabel) {
          ctx.fillStyle = C.textOn(col.rgb[0], col.rgb[1], col.rgb[2]);
          if (both) {
            ctx.font = fs + 'px ui-monospace,Menlo,monospace';
            ctx.fillText(r.symbols[i], px + cell / 2, py + cell / 2 - cell * 0.19);
            ctx.fillText(col.code, px + cell / 2, py + cell / 2 + cell * 0.21);
          } else {
            ctx.font = 'bold ' + fs + 'px ui-monospace,Menlo,monospace';
            ctx.fillText(labelMode === 'symbol' ? r.symbols[i] : col.code, px + cell / 2, py + cell / 2);
          }
        }
      }
    }

    // 网格线
    ctx.lineWidth = 1; ctx.strokeStyle = '#c9ccd2'; ctx.beginPath();
    for (x = 0; x <= r.w; x++) { ctx.moveTo(ox + x * cell + 0.5, oy); ctx.lineTo(ox + x * cell + 0.5, oy + r.h * cell); }
    for (y = 0; y <= r.h; y++) { ctx.moveTo(ox, oy + y * cell + 0.5); ctx.lineTo(ox + r.w * cell, oy + y * cell + 0.5); }
    ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#6b7280'; ctx.beginPath();
    for (x = 0; x <= r.w; x += 10) { ctx.moveTo(ox + x * cell + 0.5, oy); ctx.lineTo(ox + x * cell + 0.5, oy + r.h * cell); }
    for (y = 0; y <= r.h; y += 10) { ctx.moveTo(ox, oy + y * cell + 0.5); ctx.lineTo(ox + r.w * cell, oy + y * cell + 0.5); }
    ctx.stroke();
    ctx.strokeRect(ox + 0.5, oy + 0.5, r.w * cell, r.h * cell);

    // 图例
    if (withLegend) {
      var ly = oy + r.h * cell + 34;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111';
      ctx.font = 'bold 15px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('配色清单 / Color List', pad, ly - 12);
      var colW = (W - pad * 2) / legendCols;
      sortedOrder().forEach(function (idx2, k) {
        var cc = r.sub[idx2];
        var cx2 = pad + (k % legendCols) * colW;
        var cy2 = ly + Math.floor(k / legendCols) * 26 + 12;
        ctx.fillStyle = cc.hex;
        ctx.fillRect(cx2, cy2 - 9, 18, 18);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
        ctx.strokeRect(cx2 + 0.5, cy2 - 8.5, 18, 18);
        ctx.fillStyle = C.textOn(cc.rgb[0], cc.rgb[1], cc.rgb[2]);
        ctx.font = '11px ui-monospace,Menlo,monospace';
        ctx.textAlign = 'center';
        ctx.fillText(r.symbols[idx2], cx2 + 9, cy2);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#111';
        ctx.font = 'bold 12px ui-monospace,Menlo,monospace';
        ctx.fillText(cc.code, cx2 + 25, cy2 - 1);
        ctx.fillStyle = '#666';
        ctx.font = '11px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(cc.name + '  ×' + r.counts[idx2], cx2 + 25 + 34, cy2 - 1);
      });
    }
    return cv;
  }

  function renderPreviewCanvas(cell) {
    var r = state.result;
    if (!r) return null;
    cell = cell || Math.max(6, Math.min(24, Math.floor(4000 / Math.max(r.w, r.h))));
    var cv = document.createElement('canvas');
    cv.width = r.w * cell; cv.height = r.h * cell;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#e6e7ea'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (var y = 0; y < r.h; y++) {
      for (var x = 0; x < r.w; x++) {
        var i = r.idx[y * r.w + x];
        if (i < 0) continue;
        drawBead(ctx, x * cell, y * cell, cell, r.sub[i].hex, false);
      }
    }
    return cv;
  }

  /* ==========================================================
   * 导出
   * ========================================================== */
  function download(name, blobOrUrl) {
    var a = document.createElement('a');
    a.download = name;
    a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    document.body.appendChild(a); a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(a.href);
    }, 500);
  }

  function baseName() {
    return (state.imgName || 'pindou').replace(/\.[^.]+$/, '') || 'pindou';
  }

  function exportCanvas(cv, suffix) {
    if (!cv) { setStatus('还没有图纸'); return; }
    cv.toBlob(function (b) { download(baseName() + suffix + '.png', b); }, 'image/png');
  }

  function buildCSV() {
    var r = state.result;
    if (!r) return '';
    var lines = [];
    var head = ['行\\列'];
    for (var x = 1; x <= r.w; x++) head.push(x);
    lines.push(head.join(','));
    for (var y = 0; y < r.h; y++) {
      var row = [y + 1];
      for (var x2 = 0; x2 < r.w; x2++) {
        var i = r.idx[y * r.w + x2];
        row.push(i < 0 ? '' : r.sub[i].code);
      }
      lines.push(row.join(','));
    }
    lines.push('');
    lines.push('色号,颜色名,HEX,数量,占比');
    sortedOrder().forEach(function (i) {
      lines.push([r.sub[i].code, r.sub[i].name, r.sub[i].hex, r.counts[i],
        (r.counts[i] / r.total * 100).toFixed(2) + '%'].join(','));
    });
    return lines.join('\n');
  }

  function exportCSV() {
    var csv = buildCSV();
    if (!csv) { setStatus('还没有图纸'); return; }
    // BOM，保证 Excel 正确识别 UTF-8
    download(baseName() + '_色号表.csv', new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  }

  function listText() {
    var r = state.result;
    if (!r) return '';
    var out = [state.imgName + ' · ' + r.w + '×' + r.h + ' 格 · ' + r.sub.length + ' 色 · 共 ' + r.total + ' 颗',
      '色卡：' + currentPalette().name, ''];
    sortedOrder().forEach(function (i) {
      out.push(r.sub[i].code + '\t' + r.sub[i].name + '\t' + r.sub[i].hex + '\t×' + r.counts[i]);
    });
    return out.join('\n');
  }

  function printChart() {
    var cv = renderChartCanvas({ legend: true });
    if (!cv) { setStatus('还没有图纸'); return; }
    var url = cv.toDataURL('image/png');
    var w = window.open('', '_blank');
    if (!w) { setStatus('浏览器拦截了弹窗，请允许后重试'); return; }
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(baseName()) + ' 拼豆图纸</title>' +
      '<style>@page{margin:8mm}body{margin:0;padding:0}' +
      'img{width:100%;height:auto;display:block}</style></head><body>' +
      '<img src="' + url + '" onload="setTimeout(function(){window.print()},250)"></body></html>');
    w.document.close();
  }

  /* ==========================================================
   * 色卡管理弹窗
   * ========================================================== */
  function openPaletteModal() {
    dom.paletteModal.classList.remove('hidden');
    renderPalList();
    renderSeriesBar();
    dom.customCsv.value = P.toCSV(currentPalette().colors);
  }

  function renderSeriesBar() {
    var pal = currentPalette().colors;
    var series = [];
    pal.forEach(function (c) { if (series.indexOf(c.series) < 0) series.push(c.series); });
    dom.palSeries.innerHTML = '';
    series.forEach(function (s) {
      var b = document.createElement('button');
      b.textContent = s + ' 系';
      b.addEventListener('click', function () {
        var d = disabledSet();
        var allOn = pal.filter(function (c) { return c.series === s; }).every(function (c) { return !d[c.code]; });
        pal.forEach(function (c) { if (c.series === s) { if (allOn) d[c.code] = 1; else delete d[c.code]; } });
        renderPalList(); scheduleCompute(0);
      });
      dom.palSeries.appendChild(b);
    });
  }

  function renderPalList() {
    var pal = currentPalette().colors, d = disabledSet();
    var kw = (dom.palSearch.value || '').trim().toLowerCase();
    dom.palList.innerHTML = '';
    var frag = document.createDocumentFragment();
    pal.forEach(function (c) {
      if (kw && (c.code + ' ' + c.name + ' ' + c.hex).toLowerCase().indexOf(kw) < 0) return;
      var on = !d[c.code];
      var el = document.createElement('label');
      el.className = 'pchip' + (on ? ' on' : '');
      el.innerHTML = '<input type="checkbox" ' + (on ? 'checked' : '') + '>' +
        '<span class="sw" style="background:' + c.hex + '"></span>' +
        '<span class="t"><b>' + esc(c.code) + '</b><span>' + esc(c.name) + '</span></span>';
      el.querySelector('input').addEventListener('change', function (e) {
        if (e.target.checked) delete d[c.code]; else d[c.code] = 1;
        el.classList.toggle('on', e.target.checked);
        updatePalCount();
        scheduleCompute();
      });
      frag.appendChild(el);
    });
    dom.palList.appendChild(frag);
    updatePalCount();
  }

  function updatePalCount() {
    var pal = currentPalette().colors, d = disabledSet();
    var on = pal.filter(function (c) { return !d[c.code]; }).length;
    dom.palCount.textContent = '已启用 ' + on + ' / ' + pal.length;
    // 只提示上限，不去改用户设的量化色数——compute() 里会按可用色数自动收敛，
    // 这样临时「全不选/全选」之后原来的设置还在。
    dom.palInfo.textContent = currentPalette().name + ' · 可用 ' + on + ' 色'
      + (on > 0 && opts.colors > on ? '（本次最多出 ' + on + ' 色）' : '');
  }

  function rebuildPaletteSelect() {
    dom.paletteSel.innerHTML = '';
    P.list().forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.name + '（' + p.colors.length + ' 色）';
      dom.paletteSel.appendChild(o);
    });
    dom.paletteSel.value = opts.paletteId;
  }

  /* ==========================================================
   * 事件绑定
   * ========================================================== */
  function bindRange(el, valEl, key, fmt, onChange) {
    var apply = function () {
      var v = parseFloat(el.value);
      opts[key] !== undefined ? (opts[key] = v) : (view[key] = v);
      if (valEl) valEl.textContent = fmt ? fmt(v) : v;
      (onChange || scheduleCompute)();
    };
    el.addEventListener('input', apply);
    el._apply = apply;
  }

  function init() {
    rebuildPaletteSelect();
    updatePalCount();

    /* --- 图片 --- */
    dom.btnOpen.addEventListener('click', function () { dom.fileInput.click(); });
    dom.dropZone.addEventListener('click', function (e) {
      if (state.picking) return;
      dom.fileInput.click();
    });
    dom.fileInput.addEventListener('change', function () {
      if (dom.fileInput.files[0]) loadImageFromFile(dom.fileInput.files[0]);
      dom.fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      dom.dropZone.addEventListener(t, function (e) { e.preventDefault(); dom.dropZone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dom.dropZone.addEventListener(t, function (e) { e.preventDefault(); dom.dropZone.classList.remove('over'); });
    });
    dom.dropZone.addEventListener('drop', function (e) {
      e.stopPropagation();               // 否则会被下面的整页 drop 再处理一次
      if (e.dataTransfer.files[0]) loadImageFromFile(e.dataTransfer.files[0]);
    });
    // 整页拖拽 & 粘贴
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files[0]) loadImageFromFile(e.dataTransfer.files[0]);
    });
    document.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) { loadImageFromFile(items[i].getAsFile()); break; }
      }
    });

    // 在缩略图上吸取背景色
    dom.btnPickBg.addEventListener('click', function (e) {
      e.stopPropagation();
      state.picking = !state.picking;
      dom.dropZone.classList.toggle('picking', state.picking);
      setStatus(state.picking ? '点击左侧缩略图取色' : '');
    });
    dom.thumb.addEventListener('click', function (e) {
      if (!state.picking || !state.img) return;
      e.stopPropagation();
      var rect = dom.thumb.getBoundingClientRect();
      var x = Math.floor((e.clientX - rect.left) / rect.width * state.srcW);
      var y = Math.floor((e.clientY - rect.top) / rect.height * state.srcH);
      var cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      var cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(state.img, x, y, 1, 1, 0, 0, 1, 1);
      var p = cx.getImageData(0, 0, 1, 1).data;
      opts.bgColor = C.rgbToHex(p[0], p[1], p[2]);
      dom.bgColor.value = opts.bgColor;
      opts.bgRemove = true; dom.bgRemove.checked = true;
      state.picking = false;
      dom.dropZone.classList.remove('picking');
      setStatus('背景色已设为 ' + opts.bgColor);
      scheduleCompute(0);
    });

    /* --- 尺寸 --- */
    function setGridW(v) {
      opts.gridW = Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(v) || GRID_MIN));
      dom.gridW.value = dom.gridWNum.value = opts.gridW;
      if (opts.lockAspect) syncAspect();
      scheduleCompute();
    }
    function setGridH(v) {
      opts.gridH = Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(v) || GRID_MIN));
      dom.gridH.value = dom.gridHNum.value = opts.gridH;
      scheduleCompute();
    }
    dom.gridW.addEventListener('input', function () { setGridW(this.value); });
    dom.gridWNum.addEventListener('change', function () { setGridW(this.value); });
    dom.gridH.addEventListener('input', function () {
      if (opts.lockAspect) { dom.lockAspect.checked = false; opts.lockAspect = false; }
      setGridH(this.value);
    });
    dom.gridHNum.addEventListener('change', function () {
      if (opts.lockAspect) { dom.lockAspect.checked = false; opts.lockAspect = false; }
      setGridH(this.value);
    });
    dom.lockAspect.addEventListener('change', function () {
      opts.lockAspect = this.checked;
      if (opts.lockAspect) { syncAspect(); scheduleCompute(); }
    });
    dom.fitMode.addEventListener('change', function () { opts.fitMode = this.value; scheduleCompute(); });
    dom.presets.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      dom.lockAspect.checked = false; opts.lockAspect = false;
      opts.gridW = +b.dataset.w; opts.gridH = +b.dataset.h;
      dom.gridW.value = dom.gridWNum.value = opts.gridW;
      dom.gridH.value = dom.gridHNum.value = opts.gridH;
      scheduleCompute(0);
    });

    /* --- 马赛克 --- */
    bindRange(dom.mosaic, dom.mosaicVal, 'mosaic', function (v) { return v + '×'; });
    bindRange(dom.blur, dom.blurVal, 'blur', function (v) { return v.toFixed(1); });
    bindRange(dom.sharpen, dom.sharpenVal, 'sharpen', function (v) { return v + '%'; });
    dom.sampleMode.addEventListener('change', function () { opts.sampleMode = this.value; scheduleCompute(); });

    /* --- 颜色 --- */
    dom.paletteSel.addEventListener('change', function () {
      opts.paletteId = this.value;
      state.highlight = -1;
      updatePalCount();
      scheduleCompute(0);
    });
    dom.btnPalette.addEventListener('click', openPaletteModal);
    dom.algo.addEventListener('change', function () { opts.algo = this.value; scheduleCompute(); });
    function setColors(v) {
      opts.colors = Math.max(2, Math.min(64, Math.round(v) || 2));
      dom.colors.value = dom.colorsNum.value = opts.colors;
      updatePalCount();
      scheduleCompute();
    }
    dom.colors.addEventListener('input', function () { setColors(this.value); });
    dom.colorsNum.addEventListener('change', function () { setColors(this.value); });
    dom.dither.addEventListener('change', function () { opts.dither = this.value; scheduleCompute(); });
    bindRange(dom.ditherAmt, dom.ditherAmtVal, 'ditherAmt', function (v) { return v + '%'; });
    bindRange(dom.brightness, dom.brightnessVal, 'brightness');
    bindRange(dom.contrast, dom.contrastVal, 'contrast');
    bindRange(dom.saturation, dom.saturationVal, 'saturation');
    bindRange(dom.gamma, dom.gammaVal, 'gamma', function (v) { return (v / 100).toFixed(2); });
    bindRange(dom.bgTol, dom.bgTolVal, 'bgTol');
    bindRange(dom.alphaTh, dom.alphaThVal, 'alphaTh');
    dom.bgRemove.addEventListener('change', function () { opts.bgRemove = this.checked; scheduleCompute(); });
    dom.bgColor.addEventListener('input', function () { opts.bgColor = this.value; if (opts.bgRemove) scheduleCompute(); });

    /* --- 显示 --- */
    dom.viewMode.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      view.mode = b.dataset.v;
      [].forEach.call(dom.viewMode.children, function (c) { c.classList.toggle('on', c === b); });
      layout(); render(); saveSettings();
    });
    dom.cellSize.addEventListener('input', function () {
      view.cell = parseInt(this.value, 10);
      dom.cellSizeVal.textContent = view.cell + 'px';
      layout(); render(); saveSettings();
    });
    dom.labelMode.addEventListener('change', function () { view.labelMode = this.value; render(); saveSettings(); });
    dom.beadShape.addEventListener('change', function () { view.beadShape = this.value; render(); saveSettings(); });
    [['showGrid', 'showGrid'], ['showBold10', 'showBold10'], ['showRuler', 'showRuler']].forEach(function (p) {
      dom[p[0]].addEventListener('change', function () {
        view[p[1]] = this.checked; layout(); render(); saveSettings();
      });
    });
    dom.beadMm.addEventListener('change', function () {
      view.beadMm = parseFloat(this.value); updateStats(); saveSettings();
    });

    /* --- 清单 --- */
    dom.listSearch.addEventListener('input', renderColorList);
    dom.listSort.addEventListener('change', renderColorList);

    /* --- 弹窗 --- */
    dom.btnCloseModal.addEventListener('click', function () { dom.paletteModal.classList.add('hidden'); });
    dom.paletteModal.addEventListener('click', function (e) {
      if (e.target === dom.paletteModal) dom.paletteModal.classList.add('hidden');
    });
    dom.palSearch.addEventListener('input', renderPalList);
    dom.btnPalAll.addEventListener('click', function () {
      state.disabled[opts.paletteId] = {}; renderPalList(); scheduleCompute(0);
    });
    dom.btnPalNone.addEventListener('click', function () {
      var d = {}; currentPalette().colors.forEach(function (c) { d[c.code] = 1; });
      state.disabled[opts.paletteId] = d; renderPalList(); scheduleCompute(0);
    });
    dom.btnPalInvert.addEventListener('click', function () {
      var d = disabledSet(), nd = {};
      currentPalette().colors.forEach(function (c) { if (!d[c.code]) nd[c.code] = 1; });
      state.disabled[opts.paletteId] = nd; renderPalList(); scheduleCompute(0);
    });
    dom.btnApplyCustom.addEventListener('click', function () {
      var rows = P.parseCSV(dom.customCsv.value);
      if (rows.length < 2) { alert('至少需要 2 个有效颜色。格式：色号,名称,#RRGGBB'); return; }
      P.setCustom(rows);
      opts.paletteId = 'custom';
      state.disabled.custom = {};
      rebuildPaletteSelect();
      updatePalCount();
      renderPalList(); renderSeriesBar();
      try { localStorage.setItem('pindou.customCSV', dom.customCsv.value); } catch (e) {}
      scheduleCompute(0);
      setStatus('已保存自定义色卡（' + rows.length + ' 色）');
    });
    dom.btnExportPal.addEventListener('click', function () {
      download(currentPalette().id + '_色卡.csv',
        new Blob(['﻿' + P.toCSV(currentPalette().colors)], { type: 'text/csv;charset=utf-8' }));
    });

    /* --- 导出菜单 --- */
    dom.btnExportMenu.addEventListener('click', function (e) {
      e.stopPropagation(); dom.exportMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', function () { dom.exportMenu.classList.add('hidden'); });
    dom.exportMenu.addEventListener('click', function (e) { e.stopPropagation(); });

    dom.btnExportChart.addEventListener('click', function () {
      dom.exportMenu.classList.add('hidden');
      exportCanvas(renderChartCanvas({ legend: true }), '_图纸');
    });
    dom.btnExportPreview.addEventListener('click', function () {
      dom.exportMenu.classList.add('hidden');
      exportCanvas(renderPreviewCanvas(), '_预览');
    });
    dom.btnExportCSV.addEventListener('click', function () {
      dom.exportMenu.classList.add('hidden'); exportCSV();
    });
    dom.btnCopyList.addEventListener('click', function () {
      dom.exportMenu.classList.add('hidden');
      var t = listText();
      if (!t) return;
      navigator.clipboard.writeText(t)
        .then(function () { setStatus('配色清单已复制到剪贴板'); })
        .catch(function () {
          var ta = document.createElement('textarea');
          ta.value = t; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); setStatus('配色清单已复制'); } catch (e) { setStatus('复制失败'); }
          document.body.removeChild(ta);
        });
    });
    dom.btnSaveSettings.addEventListener('click', function () {
      dom.exportMenu.classList.add('hidden');
      var data = { v: 1, opts: opts, view: view, disabled: state.disabled };
      if (P.hasCustom()) data.customCSV = P.toCSV(P.get('custom').colors);
      download('pindou_参数.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    });
    dom.btnLoadSettings.addEventListener('click', function () {
      dom.exportMenu.classList.add('hidden'); dom.settingsInput.click();
    });
    dom.settingsInput.addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var d = JSON.parse(fr.result);
          if (d.customCSV) { P.setCustom(P.parseCSV(d.customCSV)); rebuildPaletteSelect(); }
          applySettings(d);
          setStatus('参数已导入');
        } catch (e) { setStatus('参数文件无法解析'); }
      };
      fr.readAsText(f);
      this.value = '';
    });

    dom.btnPrint.addEventListener('click', printChart);
    dom.btnReset.addEventListener('click', function () {
      if (!confirm('恢复所有参数为默认值？')) return;
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      location.reload();
    });

    /* --- 画布交互 --- */
    dom.scroller.addEventListener('scroll', function () { render(); });

    var drag = null;
    dom.scroller.addEventListener('mousedown', function (e) {
      if (e.button !== 0 && e.button !== 1) return;
      drag = { x: e.clientX, y: e.clientY, sl: dom.scroller.scrollLeft, st: dom.scroller.scrollTop, moved: 0 };
    });
    window.addEventListener('mousemove', function (e) {
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
        if (drag.moved > 4) {
          dom.scroller.classList.add('grabbing');
          dom.scroller.scrollLeft = drag.sl - dx;
          dom.scroller.scrollTop = drag.st - dy;
        }
        return;
      }
      updateHover(e);
    });
    window.addEventListener('mouseup', function (e) {
      if (drag && drag.moved <= 4) pickCell(e);
      drag = null;
      dom.scroller.classList.remove('grabbing');
    });
    dom.scroller.addEventListener('mouseleave', function () {
      state.hover = null; dom.hoverInfo.textContent = '—'; render();
    });
    dom.scroller.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var old = view.cell;
      var next = Math.max(6, Math.min(64, Math.round(old * (e.deltaY < 0 ? 1.15 : 0.87))));
      if (next === old) return;
      var rect = dom.scroller.getBoundingClientRect();
      var mx = e.clientX - rect.left + dom.scroller.scrollLeft - state.offX;
      var my = e.clientY - rect.top + dom.scroller.scrollTop - state.offY;
      view.cell = next;
      dom.cellSize.value = next; dom.cellSizeVal.textContent = next + 'px';
      layout();
      dom.scroller.scrollLeft = mx / old * next - (e.clientX - rect.left) + state.offX;
      dom.scroller.scrollTop = my / old * next - (e.clientY - rect.top) + state.offY;
      render(); saveSettings();
    }, { passive: false });

    function cellAt(e) {
      var r = state.result; if (!r) return null;
      var rect = dom.scroller.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return null;
      var x = Math.floor((e.clientX - rect.left + dom.scroller.scrollLeft - state.offX) / view.cell);
      var y = Math.floor((e.clientY - rect.top + dom.scroller.scrollTop - state.offY) / view.cell);
      if (x < 0 || y < 0 || x >= r.w || y >= r.h) return null;
      return { x: x, y: y };
    }
    function updateHover(e) {
      var c = cellAt(e);
      var same = (!c && !state.hover) ||
        (c && state.hover && c.x === state.hover.x && c.y === state.hover.y);
      state.hover = c;
      if (!c) { dom.hoverInfo.textContent = '—'; if (!same) render(); return; }
      var r = state.result, i = r.idx[c.y * r.w + c.x];
      dom.hoverInfo.textContent = '第 ' + (c.y + 1) + ' 行 · 第 ' + (c.x + 1) + ' 列 · '
        + (i < 0 ? '（空）' : r.sub[i].code + ' ' + r.sub[i].name + ' ' + r.sub[i].hex);
      if (!same) render();
    }
    function pickCell(e) {
      var c = cellAt(e); if (!c) return;
      var r = state.result, i = r.idx[c.y * r.w + c.x];
      state.highlight = (i >= 0 && state.highlight !== i) ? i : -1;
      renderColorList(); render();
    }

    window.addEventListener('resize', function () { layout(); render(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!dom.paletteModal.classList.contains('hidden')) dom.paletteModal.classList.add('hidden');
        else if (state.highlight >= 0) { state.highlight = -1; renderColorList(); render(); }
      }
    });

    dom.btnSample.addEventListener('click', function () {
      if (PD.sampleImage) loadImageFromURL(PD.sampleImage, '示例图片');
      else loadImageFromPath('tests/fixtures/photo_landscape.png', '示例图片');
    });

    loadSettings();
    applyURLParams();
    layout();
    render();
    if (!state.img) setStatus('准备就绪 · 打开一张图片开始');
  }

  /* ==========================================================
   * URL 参数（便于分享一份配好的链接，也用于自动化测试）
   * 例：index.html?img=xxx.png&w=64&colors=24&algo=kmeans&dither=fs&view=preview
   * ========================================================== */
  function applyURLParams() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (!q.toString()) return;

    var numOpt = { w: 'gridW', h: 'gridH', colors: 'colors', mosaic: 'mosaic',
                   blur: 'blur', sharpen: 'sharpen', alpha: 'alphaTh', ditherAmt: 'ditherAmt' };
    Object.keys(numOpt).forEach(function (k) {
      if (q.has(k)) {
        var v = parseFloat(q.get(k));
        if (isFinite(v)) opts[numOpt[k]] = v;
      }
    });
    if (q.has('h')) opts.lockAspect = false;
    ['algo', 'dither', 'fitMode', 'sampleMode'].forEach(function (k) {
      if (q.has(k)) opts[k] = q.get(k);
    });
    if (q.has('palette')) opts.paletteId = q.get('palette');
    if (q.has('view')) view.mode = q.get('view');
    if (q.has('cell')) view.cell = Math.max(6, Math.min(64, parseInt(q.get('cell'), 10) || view.cell));
    if (q.has('label')) view.labelMode = q.get('label');

    sanitize();
    syncUI();
    updatePalCount();

    if (q.get('demo') === '1' && PD.sampleImage) loadImageFromURL(PD.sampleImage, '示例图片');
    else if (q.has('img')) loadImageFromPath(q.get('img'), q.get('img').split('/').pop());
  }

  /* ==========================================================
   * 参数持久化
   * ========================================================== */
  var saveTimer = null;
  function saveSettings() {
    // 立刻序列化再延迟写入。如果等到定时器触发时才取值，
    // 期间的任何改动都会被一起写进去（比如刚点过「全不选」），
    // 下次打开就成了一个没有可用颜色的坏状态。
    var snapshot;
    try { snapshot = JSON.stringify({ opts: opts, view: view, disabled: state.disabled }); }
    catch (e) { return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(LS_KEY, snapshot); } catch (e) {}
    }, 400);
  }

  /**
   * 收敛所有可能来自外部的取值（URL 参数、localStorage、导入的 JSON）。
   * 出现非法值时回落到默认值，避免整页崩掉。
   */
  var ENUMS = {
    fitMode: ['cover', 'contain', 'stretch'],
    sampleMode: ['area', 'dominant', 'nearest'],
    algo: ['kmeans', 'mediancut', 'direct'],
    dither: ['none', 'fs', 'ordered']
  };
  var RANGES = {
    gridW: [GRID_MIN, GRID_MAX], gridH: [GRID_MIN, GRID_MAX], mosaic: [1, 10], blur: [0, 5], sharpen: [0, 100],
    colors: [2, 64], ditherAmt: [0, 100], brightness: [-100, 100], contrast: [-100, 100],
    saturation: [-100, 100], gamma: [50, 200], bgTol: [0, 100], alphaTh: [0, 255]
  };
  var DEFAULTS = JSON.parse(JSON.stringify({ opts: opts, view: view }));

  function sanitize() {
    Object.keys(RANGES).forEach(function (k) {
      var v = parseFloat(opts[k]);
      opts[k] = isFinite(v) ? C.clamp(v, RANGES[k][0], RANGES[k][1]) : DEFAULTS.opts[k];
    });
    Object.keys(ENUMS).forEach(function (k) {
      if (ENUMS[k].indexOf(opts[k]) < 0) opts[k] = DEFAULTS.opts[k];
    });
    opts.lockAspect = !!opts.lockAspect;
    opts.bgRemove = !!opts.bgRemove;
    if (!C.hexToRgb(opts.bgColor)) opts.bgColor = DEFAULTS.opts.bgColor;
    if (!P.all[opts.paletteId]) opts.paletteId = DEFAULTS.opts.paletteId;

    if (['chart', 'preview'].indexOf(view.mode) < 0) view.mode = DEFAULTS.view.mode;
    if (['code', 'symbol', 'both', 'none'].indexOf(view.labelMode) < 0) view.labelMode = DEFAULTS.view.labelMode;
    if (['round', 'square'].indexOf(view.beadShape) < 0) view.beadShape = DEFAULTS.view.beadShape;
    var cell = parseFloat(view.cell);
    view.cell = isFinite(cell) ? C.clamp(Math.round(cell), 6, 64) : DEFAULTS.view.cell;
    if ([2.6, 5, 10].indexOf(+view.beadMm) < 0) view.beadMm = DEFAULTS.view.beadMm;
    else view.beadMm = +view.beadMm;
    ['showGrid', 'showBold10', 'showRuler'].forEach(function (k) { view[k] = !!view[k]; });
    if (!state.disabled || typeof state.disabled !== 'object') state.disabled = {};

    // 一个「所有颜色都被禁用」的色卡什么也生成不了，不该跨会话保留下来，
    // 否则一打开页面就是「没有可用颜色」，看着像坏了。
    if (!enabledColors().length) state.disabled[opts.paletteId] = {};
  }

  function applySettings(d) {
    if (d.opts) Object.keys(opts).forEach(function (k) { if (d.opts[k] !== undefined) opts[k] = d.opts[k]; });
    if (d.view) Object.keys(view).forEach(function (k) { if (d.view[k] !== undefined) view[k] = d.view[k]; });
    if (d.disabled) state.disabled = d.disabled;
    sanitize();
    syncUI();
    updatePalCount();
    layout();
    if (state.img) scheduleCompute(0); else render();
  }

  function syncUI() {
    dom.gridW.value = dom.gridWNum.value = opts.gridW;
    dom.gridH.value = dom.gridHNum.value = opts.gridH;
    dom.lockAspect.checked = opts.lockAspect;
    dom.fitMode.value = opts.fitMode;
    dom.mosaic.value = opts.mosaic; dom.mosaicVal.textContent = opts.mosaic + '×';
    dom.sampleMode.value = opts.sampleMode;
    dom.blur.value = opts.blur; dom.blurVal.textContent = (+opts.blur).toFixed(1);
    dom.sharpen.value = opts.sharpen; dom.sharpenVal.textContent = opts.sharpen + '%';
    dom.paletteSel.value = opts.paletteId;
    dom.algo.value = opts.algo;
    dom.colors.value = dom.colorsNum.value = opts.colors;
    dom.dither.value = opts.dither;
    dom.ditherAmt.value = opts.ditherAmt; dom.ditherAmtVal.textContent = opts.ditherAmt + '%';
    dom.brightness.value = opts.brightness; dom.brightnessVal.textContent = opts.brightness;
    dom.contrast.value = opts.contrast; dom.contrastVal.textContent = opts.contrast;
    dom.saturation.value = opts.saturation; dom.saturationVal.textContent = opts.saturation;
    dom.gamma.value = opts.gamma; dom.gammaVal.textContent = (opts.gamma / 100).toFixed(2);
    dom.bgRemove.checked = opts.bgRemove;
    dom.bgColor.value = opts.bgColor;
    dom.bgTol.value = opts.bgTol; dom.bgTolVal.textContent = opts.bgTol;
    dom.alphaTh.value = opts.alphaTh; dom.alphaThVal.textContent = opts.alphaTh;

    dom.cellSize.value = view.cell; dom.cellSizeVal.textContent = view.cell + 'px';
    dom.labelMode.value = view.labelMode;
    dom.beadShape.value = view.beadShape;
    dom.showGrid.checked = view.showGrid;
    dom.showBold10.checked = view.showBold10;
    dom.showRuler.checked = view.showRuler;
    dom.beadMm.value = String(view.beadMm);
    [].forEach.call(dom.viewMode.children, function (c) { c.classList.toggle('on', c.dataset.v === view.mode); });
  }

  function loadSettings() {
    try {
      var csv = localStorage.getItem('pindou.customCSV');
      if (csv) { P.setCustom(P.parseCSV(csv)); rebuildPaletteSelect(); }
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { applySettings(JSON.parse(raw)); return; }
    } catch (e) {}
    syncUI();
  }

  /* ---------------- 启动 ---------------- */
  // 调试/自动化入口
  PD.app = {
    state: state, opts: opts, view: view,
    compute: compute, render: render, layout: layout,
    renderChartCanvas: renderChartCanvas, renderPreviewCanvas: renderPreviewCanvas,
    loadImageFromURL: loadImageFromURL, loadImageFromPath: loadImageFromPath,
    buildCSV: buildCSV, listText: listText,
    renderColorList: renderColorList, updateStats: updateStats,
    summary: function () {
      var r = state.result;
      if (!r) return null;
      return {
        w: r.w, h: r.h, colors: r.sub.length, total: r.total,
        empty: r.w * r.h - r.total,
        palette: opts.paletteId,
        codes: r.sub.map(function (c, i) { return c.code + ':' + r.counts[i]; })
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
