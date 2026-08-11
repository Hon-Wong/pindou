/* 纯计算模块的单元测试（色彩空间 / 色差 / 降采样 / 量化 / 抖动）
 *
 * 用 macOS 自带的 JavaScriptCore 跑，不需要装 Node：
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/unit.js
 */
// jsc 的 load() 按当前工作目录解析，仓库根目录和 tests/ 下都要能跑
function loadModule(name) {
  var tried = ['js/' + name + '.js', '../js/' + name + '.js'];
  for (var i = 0; i < tried.length; i++) {
    try { load(tried[i]); return; } catch (e) {}
  }
  throw new Error('找不到模块 ' + name + '，请在仓库根目录或 tests/ 下运行');
}
['color', 'palettes', 'quantize'].forEach(loadModule);

var C = PD.color, Q = PD.quantize, P = PD.palettes;
var fails = 0;
function ok(name, cond, extra) {
  if (!cond) { fails++; print('FAIL  ' + name + (extra ? '  ' + extra : '')); }
  else print('ok    ' + name + (extra ? '  ' + extra : ''));
}

/* ---- 颜色 ---- */
ok('hexToRgb', JSON.stringify(C.hexToRgb('#FF8000')) === '[255,128,0]');
ok('rgbToHex', C.rgbToHex(255, 128, 0) === '#ff8000');
ok('hex3', JSON.stringify(C.hexToRgb('#f80')) === '[255,136,0]');
ok('hex bad', C.hexToRgb('zzz') === null);

var labW = C.rgbToLab(255, 255, 255, [0, 0, 0]);
ok('Lab white L=100', Math.abs(labW[0] - 100) < 0.01 && Math.abs(labW[1]) < 0.01 && Math.abs(labW[2]) < 0.01, JSON.stringify(labW.map(function (v) { return +v.toFixed(3); })));
var labK = C.rgbToLab(0, 0, 0, [0, 0, 0]);
ok('Lab black L=0', Math.abs(labK[0]) < 0.01);
var labR = C.rgbToLab(255, 0, 0, [0, 0, 0]);
ok('Lab red ≈ (53.24,80.09,67.20)',
  Math.abs(labR[0] - 53.24) < 0.05 && Math.abs(labR[1] - 80.09) < 0.05 && Math.abs(labR[2] - 67.20) < 0.05,
  JSON.stringify(labR.map(function (v) { return +v.toFixed(2); })));

// Lab → RGB 往返
var maxErr = 0;
[[255,255,255],[0,0,0],[255,0,0],[12,200,77],[128,128,128],[3,7,250],[200,140,60]].forEach(function (c) {
  var l = C.rgbToLab(c[0], c[1], c[2], [0,0,0]);
  var b = C.labToRgb(l[0], l[1], l[2], [0,0,0]);
  for (var i = 0; i < 3; i++) maxErr = Math.max(maxErr, Math.abs(b[i] - c[i]));
});
ok('Lab 往返误差 < 0.5', maxErr < 0.5, 'maxErr=' + maxErr.toFixed(4));

ok('deltaE2000 自身=0', C.deltaE2000(50, 10, -20, 50, 10, -20) < 1e-9);
// CIEDE2000 官方测试向量 (Sharma et al.)
var dv = [
  [[50.0000,2.6772,-79.7751],[50.0000,0.0000,-82.7485],2.0425],
  [[50.0000,3.1571,-77.2803],[50.0000,0.0000,-82.7485],2.8615],
  [[50.0000,-1.3802,-84.2814],[50.0000,0.0000,-82.7485],1.0000],
  [[60.2574,-34.0099,36.2677],[60.4626,-34.1751,39.4387],1.2644],
  [[22.7233,20.0904,-46.6940],[23.0331,14.9730,-42.5619],2.0373],
  [[2.0776,0.0795,-1.1350],[0.9033,-0.0636,-0.5514],0.9082]
];
var dOK = true, worst = 0;
dv.forEach(function (t) {
  var got = C.deltaE2000(t[0][0], t[0][1], t[0][2], t[1][0], t[1][1], t[1][2]);
  worst = Math.max(worst, Math.abs(got - t[2]));
  if (Math.abs(got - t[2]) > 0.0002) dOK = false;
});
ok('CIEDE2000 官方向量', dOK, 'maxDiff=' + worst.toFixed(6));

ok('textOn 白底=黑字', C.textOn(255, 255, 255) === '#000000');
ok('textOn 黑底=白字', C.textOn(0, 0, 0) === '#ffffff');

/* ---- 色卡 ---- */
var pal = P.get('mard221').colors;
ok('MARD 221 色', pal.length === 221, 'len=' + pal.length);
var codes = {}, dupe = null;
P.list().forEach(function (p) {
  var seen = {};
  p.colors.forEach(function (c) {
    if (seen[c.code]) dupe = p.id + ':' + c.code;
    seen[c.code] = 1;
    if (!/^[A-Za-z]+\d+$/.test(c.code)) dupe = dupe || ('badcode ' + p.id + ':' + c.code);
    if (!/^#[0-9A-F]{6}$/.test(c.hex)) dupe = dupe || ('badhex ' + p.id + ':' + c.code);
  });
});
ok('色号唯一且为「字母+数字」', dupe === null, dupe || '');
ok('每色都有 lab', pal.every(function (c) { return c.lab && c.lab.length === 3; }));
ok('series 解析', pal[0].series === 'A' && P.get('hama').colors[0].series === 'H');
var cnt9 = {}; pal.forEach(function (c) { cnt9[c.series] = (cnt9[c.series] || 0) + 1; });
ok('MARD 九大色系数量正确',
   JSON.stringify(cnt9) === JSON.stringify({A:26,B:32,C:29,D:26,E:24,F:25,G:21,H:23,M:15}),
   JSON.stringify(cnt9));

var csv = P.parseCSV('X1,测试白,#FFFFFF\nX2,测试黑,#000000\n# 注释\nbad line\nX2,重复,#123456');
ok('parseCSV 去重+过滤', csv.length === 2, JSON.stringify(csv));
ok('toCSV 往返', P.toCSV(P.build(csv)).split('\n').length === 2);

/* ---- 量化管线 ---- */
// 构造 64x64 的四象限纯色图（红/绿/蓝/白），带 alpha
var W = 64, H = 64;
var src = new Uint8ClampedArray(W * H * 4);
for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
  var i = (y * W + x) * 4;
  var c = (x < 32 ? (y < 32 ? [230, 30, 30] : [30, 30, 230]) : (y < 32 ? [30, 200, 30] : [250, 250, 250]));
  src[i] = c[0]; src[i + 1] = c[1]; src[i + 2] = c[2]; src[i + 3] = 255;
}

var g = Q.downsample(src, W, H, 16, 16, 'area');
ok('downsample 尺寸', g.length === 16 * 16 * 4);
ok('downsample 左上=红', Math.abs(g[0] - 230) < 1 && Math.abs(g[1] - 30) < 1, g[0] + ',' + g[1] + ',' + g[2]);
var br = ((15 * 16) + 15) * 4;
ok('downsample 右下=白', g[br] > 245 && g[br + 3] === 255);

var gN = Q.downsample(src, W, H, 16, 16, 'nearest');
var gD = Q.downsample(src, W, H, 16, 16, 'dominant');
ok('nearest 左上=红', Math.abs(gN[0] - 230) < 1);
ok('dominant 左上=红', Math.abs(gD[0] - 230) < 1);

// 马赛克：4× 后左上 4x4 应完全一致
var gm = Q.mosaic(g.slice(0), 16, 16, 4);
var same = true;
for (var yy = 0; yy < 4; yy++) for (var xx = 0; xx < 4; xx++) {
  var k = (yy * 16 + xx) * 4;
  if (Math.abs(gm[k] - gm[0]) > 1e-3) same = false;
}
ok('mosaic 块内同色', same);
ok('mosaic 1× 直通', Q.mosaic(g, 16, 16, 1) === g);

// 透明格
var gA = new Float32Array(g);
for (var t2 = 0; t2 < 8; t2++) gA[t2 * 4 + 3] = 0;
var col = Q.collectLab(gA, 16, 16, 128, 0);
ok('collectLab 跳过透明', col.opaque === 256 - 8, 'opaque=' + col.opaque);

// K-Means 应恢复出 4 个簇
var s = Q.collectLab(g, 16, 16, 128, 0);
var km = Q.kmeans(s.lab, s.n, 4, 30, 42);
ok('kmeans k=4', km.k === 4);
ok('kmeans 簇权重按降序', km.weights[0] >= km.weights[1] && km.weights[1] >= km.weights[2]);
var km2 = Q.kmeans(s.lab, s.n, 4, 30, 42);
var det = true;
for (var q = 0; q < km.centers.length; q++) if (km.centers[q] !== km2.centers[q]) det = false;
ok('kmeans 确定性（同种子同结果）', det);

var mc = Q.medianCut(s.lab, s.n, 4);
ok('medianCut k=4', mc.k === 4, 'k=' + mc.k);

// 质心 → 色卡
var picked = Q.centersToPalette(km.centers, km.k, km.weights, pal, true);
ok('centersToPalette 返回 4 个不重复色号', picked.length === 4 && new Set(picked).size === 4,
   picked.map(function (i) { return pal[i].code + ' ' + pal[i].name; }).join(' | '));

// 完整重映射
var sub = picked.map(function (i) { return pal[i]; });
var idx = Q.remap(g, 16, 16, sub, { dither: 'none', alphaTh: 128 });
ok('remap 全部有值', Array.prototype.every.call(idx, function (v) { return v >= 0; }));
var used = {}; Array.prototype.forEach.call(idx, function (v) { used[v] = 1; });
ok('remap 用满 4 色', Object.keys(used).length === 4, Object.keys(used).join(','));
ok('remap 左上为 F 红系', /^F/.test(sub[idx[0]].code), sub[idx[0]].code + ' ' + sub[idx[0]].name);

// 透明格保持 -1
var idxA = Q.remap(gA, 16, 16, sub, { dither: 'none', alphaTh: 128 });
var neg = 0; Array.prototype.forEach.call(idxA, function (v) { if (v < 0) neg++; });
ok('remap 透明→-1', neg === 8, 'neg=' + neg);

// 抖动不应崩且不越界
['fs', 'ordered'].forEach(function (m) {
  var di = Q.remap(g, 16, 16, sub, { dither: m, amount: 0.8, alphaTh: 128 });
  var okRange = Array.prototype.every.call(di, function (v) { return v >= 0 && v < sub.length; });
  ok('remap dither=' + m + ' 索引合法', okRange);
});
var diA = Q.remap(gA, 16, 16, sub, { dither: 'fs', amount: 0.8, alphaTh: 128 });
var negA = 0; Array.prototype.forEach.call(diA, function (v) { if (v < 0) negA++; });
ok('FS 抖动不污染透明格', negA === 8, 'neg=' + negA);

// 调整
var gAdj = new Float32Array([100, 100, 100, 255]);
Q.adjust(gAdj, { brightness: 50, contrast: 0, saturation: 0, gamma: 100 });
ok('brightness +50 → +127.5', Math.abs(gAdj[0] - 227.5) < 0.6, gAdj[0].toFixed(2));
var gAdj2 = new Float32Array([250, 250, 250, 255]);
Q.adjust(gAdj2, { brightness: 100, contrast: 0, saturation: 0, gamma: 100 });
ok('亮度不越界', gAdj2[0] === 255);

// sharpen 不越界
var sh = Q.sharpen(new Float32Array(g), 16, 16, 100);
ok('sharpen 值域合法', Array.prototype.every.call(sh, function (v) { return v >= 0 && v <= 255; }));

// 大网格性能
var BW = 128, BH = 128;
var big = new Float32Array(BW * BH * 4);
var rnd = Q.rng(7);
for (var p2 = 0; p2 < BW * BH; p2++) {
  big[p2 * 4] = rnd() * 255; big[p2 * 4 + 1] = rnd() * 255; big[p2 * 4 + 2] = rnd() * 255; big[p2 * 4 + 3] = 255;
}
var t0 = Date.now();
var bs = Q.collectLab(big, BW, BH, 128, 24000);
var bk = Q.kmeans(bs.lab, bs.n, 32, 26, 1);
var bp = Q.centersToPalette(bk.centers, bk.k, bk.weights, pal, true);
var bi = Q.remap(big, BW, BH, bp.map(function (i) { return pal[i]; }), { dither: 'fs', amount: 0.7, alphaTh: 128 });
var ms = Date.now() - t0;
ok('128×128 / 32 色 全流程 < 3000ms', ms < 3000, ms + 'ms, 用色 ' + new Set(Array.prototype.slice.call(bi)).size);

/* ---- DPID 纹理保留（Weber et al., SIGGRAPH Asia 2016）----
 * 指标先定死：「细线贡献度」= 输出从背景色朝细线色移动了多少百分比。
 * 面积平均是线性平均，贡献度必然≈细线的面积占比；
 * DPID 的全部意义就是把这个贡献度显著抬上去，否则细线就被稀释没了。 */
var LW = 800, LH = 200, BG = 245, LINE = 26;
var lineSrc = new Uint8ClampedArray(LW * LH * 4);
for (var ly = 0; ly < LH; ly++) {
  for (var lx = 0; lx < LW; lx++) {
    var li = (ly * LW + lx) * 4;
    var v = (ly % 7 === 0) ? LINE : BG;
    lineSrc[li] = lineSrc[li + 1] = lineSrc[li + 2] = v;
    lineSrc[li + 3] = 255;
  }
}
function featureContribution(mode, lam) {
  var g = Q.downsample(lineSrc, LW, LH, 80, 20, mode, lam);
  var sum = 0, n = 80 * 20;
  for (var p = 0; p < n; p++) sum += g[p * 4];
  var mean = sum / n;
  return (BG - mean) / (BG - LINE);          // 0 = 细线完全消失，1 = 完全由细线主导
}
var fcArea = featureContribution('area');
var fcD0   = featureContribution('dpid', 0);
var fcD05  = featureContribution('dpid', 0.5);
var fcD1   = featureContribution('dpid', 1);
var fcD2   = featureContribution('dpid', 2);
ok('面积平均下细线贡献度≈其面积占比（1/7≈14%）',
   Math.abs(fcArea - 1 / 7) < 0.04, (fcArea * 100).toFixed(1) + '%');
ok('DPID λ=0 与面积平均完全一致',
   Math.abs(fcD0 - fcArea) < 1e-6, (fcD0 * 100).toFixed(1) + '%');
ok('DPID λ=1 让细线贡献度提高 3 倍以上',
   fcD1 > fcArea * 3, (fcArea * 100).toFixed(1) + '% → ' + (fcD1 * 100).toFixed(1) + '%');
ok('细线贡献度随 λ 单调递增',
   fcD0 < fcD05 && fcD05 < fcD1 && fcD1 < fcD2,
   [fcD0, fcD05, fcD1, fcD2].map(function (v) { return (v * 100).toFixed(0) + '%'; }).join(' → '));

// 均匀区域不该被 DPID 变出花样来
var flatSrc = new Uint8ClampedArray(200 * 200 * 4);
for (var q2 = 0; q2 < 200 * 200; q2++) {
  flatSrc[q2*4] = 120; flatSrc[q2*4+1] = 90; flatSrc[q2*4+2] = 200; flatSrc[q2*4+3] = 255;
}
var flatOut = Q.downsample(flatSrc, 200, 200, 20, 20, 'dpid', 1);
var flatOK = true;
for (var q3 = 0; q3 < 400; q3++) {
  if (Math.abs(flatOut[q3*4] - 120) > 0.5 || Math.abs(flatOut[q3*4+1] - 90) > 0.5) flatOK = false;
}
ok('纯色区域经 DPID 后原样输出（不会凭空造出噪点）', flatOK);

// 透明处理与普通模式一致
var alphaSrc = new Uint8ClampedArray(40 * 40 * 4);
for (var q4 = 0; q4 < 40 * 40; q4++) {
  alphaSrc[q4*4] = 200; alphaSrc[q4*4+1] = 60; alphaSrc[q4*4+2] = 60;
  alphaSrc[q4*4+3] = (q4 % 40) < 20 ? 255 : 0;
}
var aOut = Q.downsample(alphaSrc, 40, 40, 8, 8, 'dpid', 1);
var leftOpaque = aOut[3] > 200, rightClear = aOut[(4) * 4 + 3] < 40;
ok('DPID 正确处理透明区', leftOpaque && rightClear,
   '左半 alpha=' + aOut[3].toFixed(0) + '，右半 alpha=' + aOut[16 + 3].toFixed(0));

/* ---- 感知优化降采样（Öztireli & Gross, SIGGRAPH 2015）----
 * 论文的核心主张是「让输出的局部对比度等于原图的局部对比度」（σ_x = σ_h）。
 * 所以指标就是标准差保留率：普通 box 降采样会让 std 随格数减少而塌陷，
 * 这正是「格子一少纹理就没了」的根因；本方法应当把 std 稳住。 */
var TW = 600, TH = 600;
var texSrc = new Uint8ClampedArray(TW * TH * 4);
(function () {
  var f = [[3,40],[7,30],[17,22],[41,14]];
  for (var y = 0; y < TH; y++) {
    for (var x = 0; x < TW; x++) {
      var v = 128;
      for (var k = 0; k < f.length; k++) {
        v += Math.sin(x / f[k][0] + Math.cos(y / (f[k][0] * 1.3)) * 2.1) * f[k][1] * 0.5
           + Math.cos(y / f[k][0] * 1.1 + Math.sin(x / (f[k][0] * 0.9)) * 1.7) * f[k][1] * 0.5;
      }
      v = Math.max(0, Math.min(255, v));
      var i = (y * TW + x) * 4;
      texSrc[i] = texSrc[i+1] = texSrc[i+2] = v; texSrc[i+3] = 255;
    }
  }
})();
function stdOf(arr, n) {
  var m = 0, p;
  for (p = 0; p < n; p++) m += arr[p * 4];
  m /= n;
  var s2 = 0;
  for (p = 0; p < n; p++) { var d = arr[p * 4] - m; s2 += d * d; }
  return Math.sqrt(s2 / n);
}
var srcStd = stdOf(texSrc, TW * TH);
function stdAt(mode, g) { return stdOf(Q.downsample(texSrc, TW, TH, g, g, mode, 1), g * g); }

var a40 = stdAt('area', 40), s40 = stdAt('ssim', 40);
var a20 = stdAt('area', 20), s20 = stdAt('ssim', 20);
ok('面积平均确实会随格数减少而丢纹理（复现问题本身）',
   a40 < srcStd * 0.7 && a20 < a40,
   '原图 std=' + srcStd.toFixed(1) + ' → 40×40 时 ' + a40.toFixed(1) + ' → 20×20 时 ' + a20.toFixed(1));
ok('感知优化在 40×40 保住 ≥85% 的局部对比度',
   s40 > srcStd * 0.85, srcStd.toFixed(1) + ' → ' + s40.toFixed(1)
   + '（面积平均只有 ' + a40.toFixed(1) + '）');
ok('格数减到 20×20 仍然保住 ≥85%',
   s20 > srcStd * 0.85, srcStd.toFixed(1) + ' → ' + s20.toFixed(1)
   + '（面积平均只有 ' + a20.toFixed(1) + '）');
ok('感知优化不受格数影响而塌陷（这正是要解决的问题）',
   Math.abs(s20 - s40) < srcStd * 0.15, s40.toFixed(1) + ' vs ' + s20.toFixed(1));

// 纯色区不能被动
var flat2 = new Uint8ClampedArray(200 * 200 * 4);
for (var z2 = 0; z2 < 200 * 200; z2++) {
  flat2[z2*4] = 120; flat2[z2*4+1] = 90; flat2[z2*4+2] = 200; flat2[z2*4+3] = 255;
}
var fo2 = Q.downsample(flat2, 200, 200, 20, 20, 'ssim');
var flatOK2 = true;
for (var z3 = 0; z3 < 400; z3++) {
  if (Math.abs(fo2[z3*4] - 120) > 1 || Math.abs(fo2[z3*4+1] - 90) > 1) flatOK2 = false;
}
ok('感知优化下纯色区原样输出（不会无中生有）', flatOK2);

// 平滑渐变不该被搞出振铃
var gr2 = new Uint8ClampedArray(400 * 100 * 4);
for (var gy2 = 0; gy2 < 100; gy2++) for (var gx2 = 0; gx2 < 400; gx2++) {
  var gi = (gy2 * 400 + gx2) * 4, gv = Math.round(30 + gx2 * 0.5);
  gr2[gi] = gr2[gi+1] = gr2[gi+2] = gv; gr2[gi+3] = 255;
}
var go2 = Q.downsample(gr2, 400, 100, 40, 10, 'ssim');
var ga2 = Q.downsample(gr2, 400, 100, 40, 10, 'area');
var maxDev = 0;
for (var z4 = 0; z4 < 400; z4++) maxDev = Math.max(maxDev, Math.abs(go2[z4*4] - ga2[z4*4]));
ok('平滑渐变不会被搞出振铃（与面积平均偏差 < 5）', maxDev < 5, '最大偏差 ' + maxDev.toFixed(2));

/* ---- 抖动：突破离散色卡的唯一手段 ----
 * 拼豆色卡是离散的，一片渐变往往只途经十来颗珠子的颜色，这是「用色偏少」的根因。
 * 抖动用邻近色交错，让肉眼在一定距离外自动混色。
 * 所以指标必须按「3×3 局部平均」量 —— 逐格比反而会变差，那是抖动的代价而非缺陷。
 * 基准是量化前的连续网格（真值），不能拿另一次量化结果当基准。 */
var FW2 = 320, FH2 = 240;
var fSrc = new Uint8ClampedArray(FW2 * FH2 * 4);
for (var fy = 0; fy < FH2; fy++) {
  for (var fx = 0; fx < FW2; fx++) {
    var fi = (fy * FW2 + fx) * 4, ft = fy / FH2, fr, fg, fb;
    if (ft < 0.45) { var fk = ft / 0.45; fr = 110 + 80*fk; fg = 160 + 60*fk; fb = 230 - 30*fk; }
    else { var fk2 = (ft - 0.45) / 0.55; fr = 90 - 30*fk2; fg = 135 - 40*fk2; fb = 65 - 25*fk2; }
    if ((fx-240)*(fx-240) + (fy-45)*(fy-45) < 900) { fr = 255; fg = 238; fb = 120; }
    if (fx > 75 && fx < 130 && fy > 150 && fy < 210) { fr = 210; fg = 60; fb = 55; }
    fSrc[fi] = fr; fSrc[fi+1] = fg; fSrc[fi+2] = fb; fSrc[fi+3] = 255;
  }
}
var GW2 = 48, GH2 = 36;
var truth = Q.downsample(fSrc, FW2, FH2, GW2, GH2, 'area');   // 量化前的连续网格 = 真值
var mp = P.get('mard221').colors;
var st2 = Q.collectLab(truth, GW2, GH2, 128, 24000);
var km2 = Q.kmeans(st2.lab, st2.n, 24, 26, 20240815);
var sub2 = Q.centersToPalette(km2.centers, km2.k, km2.weights, mp, true)
            .map(function (i) { return mp[i]; });
sub2 = Q.refinePalette(truth, GW2, GH2, mp, sub2, 24, 128);

function localDeltaE(idx) {
  var tot = 0, n = 0;
  for (var by = 0; by + 3 <= GH2; by += 3) {
    for (var bx = 0; bx + 3 <= GW2; bx += 3) {
      var ar=0, ag=0, ab=0, br=0, bg=0, bb=0, c3=0;
      for (var dy = 0; dy < 3; dy++) for (var dx = 0; dx < 3; dx++) {
        var p4 = (by+dy) * GW2 + (bx+dx), q4 = idx[p4];
        if (q4 < 0) continue;
        ar += truth[p4*4]; ag += truth[p4*4+1]; ab += truth[p4*4+2];
        br += sub2[q4].rgb[0]; bg += sub2[q4].rgb[1]; bb += sub2[q4].rgb[2];
        c3++;
      }
      if (!c3) continue;
      var la = C.rgbToLab(ar/c3, ag/c3, ab/c3, [0,0,0]);
      var lb = C.rgbToLab(br/c3, bg/c3, bb/c3, [0,0,0]);
      tot += C.deltaE2000(la[0],la[1],la[2], lb[0],lb[1],lb[2]);
      n++;
    }
  }
  return n ? tot / n : 999;
}
function perCellDeltaE(idx) {
  var tmp2 = [0,0,0], tot = 0, n = 0;
  for (var p5 = 0; p5 < GW2*GH2; p5++) {
    var q5 = idx[p5];
    if (q5 < 0) continue;
    C.rgbToLab(truth[p5*4], truth[p5*4+1], truth[p5*4+2], tmp2);
    tot += C.deltaE2000(tmp2[0],tmp2[1],tmp2[2], sub2[q5].lab[0],sub2[q5].lab[1],sub2[q5].lab[2]);
    n++;
  }
  return n ? tot / n : 999;
}
var idxNone = Q.remap(truth, GW2, GH2, sub2, { dither: 'none', alphaTh: 128 });
var idxFs   = Q.remap(truth, GW2, GH2, sub2, { dither: 'fs', amount: 0.85, alphaTh: 128 });
var lNone = localDeltaE(idxNone), lFs = localDeltaE(idxFs);
var cNone2 = perCellDeltaE(idxNone), cFs = perCellDeltaE(idxFs);
// 提升幅度依图而异（实测 17%~47%），所以只断言「确有提升」，不锁死具体数字 ——
// 上一版按某张图量到的 47% 定了 30% 的门槛，换张图就挂了，那是拿测试凑结论。
ok('抖动提升观感保真度（3×3 局部平均 ΔE2000 下降）',
   lFs < lNone * 0.92,
   '不抖动 ' + lNone.toFixed(2) + ' → Floyd–Steinberg ' + lFs.toFixed(2)
   + '（提升 ' + Math.round((1 - lFs / lNone) * 100) + '%）');
ok('逐格误差反而变大 —— 这是抖动的代价，不是缺陷',
   cFs > cNone2,
   '逐格 ΔE：不抖动 ' + cNone2.toFixed(2) + ' → 抖动 ' + cFs.toFixed(2));

// 色卡离散性造成的天花板
var full = Q.remap(truth, GW2, GH2, mp, { dither: 'none', alphaTh: 128 });
var usedFull = {};
for (var p6 = 0; p6 < GW2*GH2; p6++) if (full[p6] >= 0) usedFull[full[p6]] = 1;
ok('整卡直配的用色数就是这张图的色彩天花板',
   Object.keys(usedFull).length < mp.length * 0.2,
   '221 色卡里只有 ' + Object.keys(usedFull).length + ' 色被用到 —— 「用色偏少」源于色卡离散，不是算法保守');

print('');
print(fails === 0 ? '全部通过 ✅' : (fails + ' 项失败 ❌'));
