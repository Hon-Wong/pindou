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
var pal = P.get('mard').colors;
ok('mard 90 色', pal.length === 90, 'len=' + pal.length);
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
ok('remap 左上为红系', /^D/.test(sub[idx[0]].code), sub[idx[0]].code + ' ' + sub[idx[0]].name);

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

print('');
print(fails === 0 ? '全部通过 ✅' : (fails + ' 项失败 ❌'));
