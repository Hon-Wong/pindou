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
    cropMode: false,
    rawW: 0, rawH: 0,
    offX: 0, offY: 0,
    computeSeq: 0        // 每完成一次重算 +1，方便调试与自动化测试
  };

  var opts = {
    gridW: 64, gridH: 64, lockAspect: true, fitMode: 'cover',
    rotate: 0, flipH: false, flipV: false, crop: null,
    mosaic: 1, sampleMode: 'ssim', blur: 0, sharpen: 0, texture: 100,
    paletteId: 'mard221', algo: 'kmeans', colors: 16,
    dither: 'none', ditherAmt: 70,
    brightness: 0, contrast: 0, saturation: 0, gamma: 100,
    bgRemove: false, bgColor: '#ffffff', bgTol: 12, alphaTh: 128
  };

  var view = {
    mode: 'chart', cell: 24, labelMode: 'code', beadShape: 'round',
    showGrid: true, boldEvery: 10, showRuler: true, beadMm: 5,
    ironLevel: 1, side: 'front', ironBoth: true, finish: 'paper', glitterTint: 'silver',
    theme: 'purple', focus: false, immersive: false
  };

  var LS_KEY = 'pindou.v1';
  var RULER = 26;
  // 格数范围，index.html 里滑块的 min/max 要与此保持一致
  var GRID_MIN = 5, GRID_MAX = 200;

  /* ---------------- DOM ---------------- */
  var dom = {};
  ['fileInput', 'dropZone', 'thumb', 'dropHint', 'imgMeta', 'btnOpen',
   'cropStage', 'cropBox', 'cropInfo', 'imgTools', 'btnRotL', 'btnRotR',
   'btnFlipH', 'btnFlipV', 'btnCrop', 'btnCropReset', 'scenePresets',
   'gridW', 'gridWNum', 'gridH', 'gridHNum', 'lockAspect', 'fitMode', 'presets', 'sizeInfo',
   'mosaic', 'mosaicVal', 'sampleMode', 'blur', 'blurVal', 'sharpen', 'sharpenVal',
   'texture', 'textureVal', 'textureRow', 'textureHint',
   'paletteSel', 'btnPalette', 'palInfo', 'algo', 'colors', 'colorsNum',
   'dither', 'ditherAmt', 'ditherAmtVal',
   'brightness', 'brightnessVal', 'contrast', 'contrastVal',
   'saturation', 'saturationVal', 'gamma', 'gammaVal',
   'bgRemove', 'bgColor', 'btnPickBg', 'bgTol', 'bgTolVal', 'alphaTh', 'alphaThVal',
   'viewMode', 'cellSize', 'cellSizeVal', 'labelMode', 'beadShape',
   'showGrid', 'boldEvery', 'showRuler', 'beadMm',
   'btnClearHl', 'btnUndo', 'btnRedo', 'footVer', 'btnFull', 'btnFocus', 'immersiveExit',
   'ironLevel', 'sideView', 'ironBoth', 'themeDots', 'finish', 'glitterTint', 'tintRow',
   'btnFeedback', 'feedbackModal', 'fbClose', 'fbType', 'fbText', 'fbContact',
   'fbDiag', 'fbIncludeDiag', 'fbPrivacy', 'fbStatus', 'fbSend', 'fbCopy',
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
      state.rawW = img.naturalWidth; state.rawH = img.naturalHeight;
      // 新图片就重置几何变换，否则会莫名其妙套用上一张的裁剪框
      opts.rotate = 0; opts.flipH = false; opts.flipV = false; opts.crop = null;
      setCropMode(false);
      dom.cropStage.hidden = false; dom.dropHint.hidden = true;
      dom.imgTools.hidden = false;
      updateSource();
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
   * 旋转 / 翻转 / 裁剪
   *
   * rotatedCanvas()：只做旋转+翻转，缩略图显示的就是它，
   *                  所以裁剪框的坐标可以直接用它的归一化坐标。
   * sourceCanvas() ：在此基础上再裁剪，是后续所有处理的真正输入。
   * ========================================================== */
  // 缓存键直接比对图片对象本身，而不是自增计数器：
  // 计数器一旦哪条路径忘了 +1，就会悄悄拿上一张图的结果继续算。
  var layerCv = document.createElement('canvas');   // 预览贴纹理用的中间图层
  var rotCache = { img: null, rotate: -1, flipH: null, flipV: null, canvas: null };
  var cropCache = { base: null, crop: '', canvas: null };

  function rotatedCanvas() {
    if (rotCache.canvas && rotCache.img === state.img
        && rotCache.rotate === opts.rotate
        && rotCache.flipH === opts.flipH && rotCache.flipV === opts.flipV) {
      return rotCache.canvas;
    }
    var img = state.img, iw = img.naturalWidth, ih = img.naturalHeight;
    var swap = (opts.rotate === 90 || opts.rotate === 270);
    var w = swap ? ih : iw, h = swap ? iw : ih;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.translate(w / 2, h / 2);
    // 先 scale 后 rotate：翻转作用在「旋转之后」的画面上，
    // 这样转过 90° 再点水平翻转，看到的也是水平翻转。
    ctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
    ctx.rotate(opts.rotate * Math.PI / 180);
    ctx.drawImage(img, -iw / 2, -ih / 2);
    rotCache = { img: img, rotate: opts.rotate, flipH: opts.flipH, flipV: opts.flipV, canvas: cv };
    return cv;
  }

  function sourceCanvas() {
    var rc = rotatedCanvas();
    if (!opts.crop) return rc;
    var k = [opts.crop.x, opts.crop.y, opts.crop.w, opts.crop.h].join(',');
    if (cropCache.canvas && cropCache.base === rc && cropCache.crop === k) return cropCache.canvas;
    var c = opts.crop;
    var x = Math.round(c.x * rc.width), y = Math.round(c.y * rc.height);
    var w = Math.max(1, Math.round(c.w * rc.width)), h = Math.max(1, Math.round(c.h * rc.height));
    x = Math.max(0, Math.min(rc.width - 1, x));
    y = Math.max(0, Math.min(rc.height - 1, y));
    w = Math.min(w, rc.width - x); h = Math.min(h, rc.height - y);
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(rc, x, y, w, h, 0, 0, w, h);
    cropCache = { base: rc, crop: k, canvas: cv };
    return cv;
  }

  /** 旋转/翻转后把裁剪框跟着变换，免得辛苦框好的区域被清掉 */
  function mapCrop(fn) {
    if (opts.crop) opts.crop = fn(opts.crop);
  }
  function rotateCropCW(c) { return { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w }; }
  function rotateCropCCW(c) { return { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w }; }

  /** 重新计算有效源尺寸（旋转/裁剪之后的），并同步比例锁定 */
  function updateSource() {
    if (!state.img) return;
    var sc = sourceCanvas();
    state.srcW = sc.width; state.srcH = sc.height;
    if (opts.lockAspect) syncAspect();
    refreshImgUI();
  }

  function refreshImgUI() {
    if (!state.img) return;
    var rc = rotatedCanvas();
    // 缩略图显示旋转后的样子；大图先缩小一版，避免 dataURL 过大
    var maxW = 420;
    var s = Math.min(1, maxW / rc.width);
    var pv = document.createElement('canvas');
    pv.width = Math.max(1, Math.round(rc.width * s));
    pv.height = Math.max(1, Math.round(rc.height * s));
    var px = pv.getContext('2d');
    px.imageSmoothingEnabled = true; px.imageSmoothingQuality = 'high';
    px.drawImage(rc, 0, 0, pv.width, pv.height);
    dom.thumb.src = pv.toDataURL('image/png');

    dom.imgMeta.textContent = state.imgName + ' · ' + rc.width + '×' + rc.height + ' px'
      + (opts.rotate ? ' · 已旋转 ' + opts.rotate + '°' : '')
      + (opts.flipH || opts.flipV ? ' · 已翻转' : '');

    if (opts.crop) {
      var cw = Math.round(opts.crop.w * rc.width), chh = Math.round(opts.crop.h * rc.height);
      dom.cropInfo.hidden = false;
      dom.cropInfo.textContent = '已裁剪：' + cw + '×' + chh + ' px（占原图 '
        + Math.round(opts.crop.w * opts.crop.h * 100) + '%）';
    } else {
      dom.cropInfo.hidden = true;
    }
    dom.btnFlipH.classList.toggle('on', !!opts.flipH);
    dom.btnFlipV.classList.toggle('on', !!opts.flipV);
    dom.btnCropReset.disabled = !opts.crop;
    syncCropBox();
  }

  /* ==========================================================
   * 源图 → 适配画布（cover / contain / stretch）
   * ========================================================== */
  function fitSource(gw, gh) {
    // 尺寸直接问 sourceCanvas() 要，不读 state.srcW/srcH：
    // 那两个值是给「比例锁定」和界面显示用的可变状态，
    // 一旦和真正要绘制的画布不同步，裁剪区域就会算错。
    var src = sourceCanvas();
    var sw = src.width, sh = src.height;

    // 每格用 k×k 个源像素来采样。
    //
    // k 的上限必须按「中间图总像素」来卡，不能按倍数卡死。
    // 之前写成固定 min(k, 12)，格数一少就等于先让浏览器把原图缩成一张小图，
    // 而那是普通低通滤波——纹理在采样算法看到它之前就已经被抹平了。
    // 格子越少糊得越狠：20×5 格时 DPID 的细线保留度只剩 12.6%，
    // 比什么都不做（面积平均 14.3%）还差。
    var MAX_PX = 4e6;                                   // 中间图最多 400 万像素
    var kMax = Math.max(1, Math.floor(Math.sqrt(MAX_PX / Math.max(1, gw * gh))));
    var k = Math.max(1, Math.min(kMax, Math.round(Math.max(sw / gw, sh / gh))));
    var fw = gw * k, fh = gh * k;

    var cv = state.fitCanvas;
    cv.width = fw; cv.height = fh;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, fw, fh);

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
    var down = progressiveDownscale(src, sw, sh, sx, sy, ssw, ssh, Math.round(dw), Math.round(dh));

    var blockPx = k;                                  // 一个格子对应的源像素边长
    if (opts.blur > 0) ctx.filter = 'blur(' + (opts.blur * blockPx * 0.22).toFixed(2) + 'px)';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(down.canvas, 0, 0, down.w, down.h, dx, dy, dw, dh);
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
   * 裁剪框交互（用 Pointer Events，鼠标和触屏同一套代码）
   * ========================================================== */
  function setCropMode(on) {
    state.cropMode = !!on && !!state.img;
    dom.btnCrop.classList.toggle('on', state.cropMode);
    dom.cropStage.classList.toggle('cropping', state.cropMode);
    dom.cropBox.hidden = !state.cropMode;
    if (state.cropMode) {
      if (!opts.crop) opts.crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      syncCropBox();
      setStatus('拖动框选要保留的区域；再点一次「裁剪」结束');
    } else {
      setStatus('');
    }
  }

  function syncCropBox() {
    if (!opts.crop || dom.cropBox.hidden) return;
    var c = opts.crop;
    dom.cropBox.style.left = (c.x * 100) + '%';
    dom.cropBox.style.top = (c.y * 100) + '%';
    dom.cropBox.style.width = (c.w * 100) + '%';
    dom.cropBox.style.height = (c.h * 100) + '%';
  }

  function initCropDrag() {
    var drag = null;
    var MIN = 0.04;                       // 裁剪框最小占比，防止缩成一条线

    function pos(e) {
      var r = dom.thumb.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
      };
    }

    dom.cropStage.addEventListener('pointerdown', function (e) {
      if (!state.cropMode) return;
      e.preventDefault(); e.stopPropagation();
      var handle = e.target.dataset ? e.target.dataset.h : null;
      var p = pos(e);
      if (!handle && e.target !== dom.cropBox) {
        // 在空白处按下 = 重新拉一个新框
        opts.crop = { x: p.x, y: p.y, w: MIN, h: MIN };
        handle = 'se';
      }
      drag = { handle: handle, start: p, orig: Object.assign({}, opts.crop) };
      dom.cropStage.setPointerCapture(e.pointerId);
    });

    dom.cropStage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      e.preventDefault();
      var p = pos(e), o = drag.orig;
      var dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      var c;
      if (!drag.handle) {                                   // 整体移动
        c = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
        c.x = Math.max(0, Math.min(1 - c.w, c.x));
        c.y = Math.max(0, Math.min(1 - c.h, c.y));
      } else {
        var x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
        if (drag.handle.indexOf('w') >= 0) x1 = Math.min(x2 - MIN, Math.max(0, o.x + dx));
        if (drag.handle.indexOf('e') >= 0) x2 = Math.max(x1 + MIN, Math.min(1, o.x + o.w + dx));
        if (drag.handle.indexOf('n') >= 0) y1 = Math.min(y2 - MIN, Math.max(0, o.y + dy));
        if (drag.handle.indexOf('s') >= 0) y2 = Math.max(y1 + MIN, Math.min(1, o.y + o.h + dy));
        c = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      opts.crop = c;
      syncCropBox();
    });

    function end(e) {
      if (!drag) return;
      drag = null;
      try { dom.cropStage.releasePointerCapture(e.pointerId); } catch (err) {}
      updateSource();
      scheduleCompute(0);
      commit();
    }
    dom.cropStage.addEventListener('pointerup', end);
    dom.cropStage.addEventListener('pointercancel', end);
  }

  /* ==========================================================
   * 场景预设
   * ========================================================== */
  var SCENES = {
    photo: { label: '照片',
      sampleMode: 'ssim', algo: 'kmeans', colors: 24, dither: 'fs', ditherAmt: 55,
      mosaic: 1, blur: 0, sharpen: 15, contrast: 6, saturation: 8, gamma: 100 },
    // 动漫/插画：大片平涂 + 细线稿。用众数采样保住平涂区不糊，
    // 关掉抖动免得干净色块被打成噪点，锐化把线条拉回来，饱和度补一点。
    anime: { label: '动漫插画',
      sampleMode: 'dominant', algo: 'kmeans', colors: 20, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 38, contrast: 10, saturation: 18, gamma: 100 },
    pixel: { label: '像素画',
      sampleMode: 'dominant', algo: 'direct', colors: 32, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 0, contrast: 0, saturation: 0, gamma: 100 },
    flat:  { label: '扁平 Logo',
      sampleMode: 'dominant', algo: 'kmeans', colors: 8, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 0, contrast: 0, saturation: 0, gamma: 100 },
    mono:  { label: '单色剪影',
      sampleMode: 'area', algo: 'kmeans', colors: 2, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 20, contrast: 35, saturation: -100, gamma: 100 },
    // 拼豆色卡是离散的，逼近原图只能靠抖动让邻近色在视觉上混合。
    // 实测 3×3 局部平均 ΔE2000：不抖动 5.69 → FS 抖动 2.99。
    fidelity: { label: '最大保真',
      sampleMode: 'ssim', algo: 'kmeans', colors: 48, dither: 'fs', ditherAmt: 85,
      mosaic: 1, blur: 0, sharpen: 8, contrast: 0, saturation: 0, gamma: 100 }
  };

  function applyScene(id) {
    var s = SCENES[id];
    if (!s) return;
    Object.keys(s).forEach(function (k) { if (k !== 'label') opts[k] = s[k]; });
    state.scene = id;
    [].forEach.call(dom.scenePresets.children, function (b) {
      b.classList.toggle('on', b.dataset.p === id);
    });
    syncUI();
    updatePalCount();
    setStatus('已套用预设：' + s.label);
    scheduleCompute(0);
    commit();
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
    if (state.img) {                       // 让显示用的源尺寸始终跟着真实画布走
      var sc0 = sourceCanvas();
      state.srcW = sc0.width; state.srcH = sc0.height;
    }

    var fit = fitSource(gw, gh);
    if (opts.bgRemove) removeBg(fit.data, opts.bgColor, opts.bgTol);

    var grid = Q.downsample(fit.data, fit.w, fit.h, gw, gh, opts.sampleMode, opts.texture / 100);
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

    // 把没抢到格子的色号槽位补给误差最大的区域，别浪费色彩预算
    sub = Q.refinePalette(grid, gw, gh, pal, sub, want, opts.alphaTh);

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
    commitLater();
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
    // 有表面工艺时，豆子先画到独立图层，贴完纹理（source-atop）再合成，
    // 这样纹理只落在豆子上，不会糊到空格和底板
    var ironP = IRON[effIronLevel()] || IRON[1];
    var useLayer = view.mode === 'preview'
      && (ironP.blur > 0 || ironP.sheet > 0 || (FINISH[view.finish] && FINISH[view.finish].tex));
    var g = ctx;
    if (useLayer) {
      if (layerCv.width !== dom.mainCanvas.width || layerCv.height !== dom.mainCanvas.height) {
        layerCv.width = dom.mainCanvas.width; layerCv.height = dom.mainCanvas.height;
      }
      g = layerCv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cw, ch);
    }
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
        var i = r.idx[y * r.w + (mirrored() && view.mode === 'preview' ? r.w - 1 - x : x)];
        if (i < 0) {
          ctx.fillStyle = th.empty;
          ctx.fillRect(px, py, cell, cell);
          continue;
        }
        var col = r.sub[i];
        var dim = hl >= 0 && i !== hl;

        if (view.mode === 'preview') {
          ctx.fillStyle = th.empty;
          ctx.fillRect(px, py, cell, cell);       // 底板画在主画布
          drawBead(g, px, py, cell, col.hex, dim, effIronLevel());
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

    if (useLayer) {
      fuseLayer(g, layerCv, cw, ch, cell, effIronLevel());
      applyFinish(g, layerCv, cw, ch, cell, ox, oy);
      ctx.drawImage(layerCv, 0, 0, cw, ch);
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
    // 加粗线和外框都归「显示网格线」这个总开关管：关掉就该一条不剩
    if (view.showGrid && view.boldEvery && cell >= 4) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = th.bold;
      ctx.beginPath();
      var BE = view.boldEvery;
      for (var bx = Math.floor(c0 / BE) * BE; bx <= c1 + 1; bx += BE) {
        var X2 = Math.round(ox + bx * cell) + 0.5;
        ctx.moveTo(X2, Math.max(0, oy)); ctx.lineTo(X2, Math.min(ch, oy + r.h * cell));
      }
      for (var by = Math.floor(r0 / BE) * BE; by <= r1 + 1; by += BE) {
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

  /* ==========================================================
   * 表面工艺（垫不同材料熨烫留下的质感）
   *
   * 原理是「垫什么材料，冷却后豆子就留什么纹理」。以下为示意渲染，
   * 真实观感还取决于豆子品牌、温度和按压力度。
   * 参数含义：gloss 高光倍率，tex 叠加的纹理种类。
   * ========================================================== */
  var FINISH = {
    paper:    { label: '烘焙纸（标准）',   gloss: 1.0,  tex: null },
    gloss:    { label: '亮面 / 镜面',      gloss: 2.0,  tex: 'gloss' },
    towel:    { label: '毛巾（毛茸茸）',   gloss: 0.35, tex: 'towel' },
    loofah:   { label: '搓澡巾（细网哑光）', gloss: 0.5, tex: 'loofah' },
    mesh:     { label: '网格压纹',         gloss: 0.8,  tex: 'mesh' },
    waffle:   { label: '华夫格',           gloss: 0.8,  tex: 'waffle' },
    crumpled: { label: '褶皱做旧',         gloss: 0.7,  tex: 'crumpled' },
    glitter:  { label: '格利特闪粉',       gloss: 1.2,  tex: 'glitter' },
    velvet:   { label: '绒面（哑光丝绒）', gloss: 0.2,  tex: 'velvet' }
  };
  var TINTS = {
    silver: ['#ffffff', '#dfe6ee', '#b9c6d6'],
    gold:   ['#fff3c4', '#ffd24a', '#c99a1e'],
    pink:   ['#ffffff', '#ffc7e0', '#ff8ec0'],
    multi:  ['#ff7ab8', '#7ad9ff', '#ffe27a', '#9dff9d', '#c9a0ff']
  };

  var texCache = {};
  /**
   * 生成可平铺的纹理。用固定种子保证每次一致；
   * 所有随机图元都做 3×3 环绕绘制，否则平铺时会看到明显接缝。
   */
  function finishPattern(ctx, kind, cell) {
    var u = Math.max(6, Math.round(cell));            // 纹理特征随格子大小缩放
    var key = kind + '@' + u + '@' + view.glitterTint;
    if (texCache[key]) return texCache[key];

    var T = Math.max(160, u * 8);
    var cv = document.createElement('canvas');
    cv.width = cv.height = T;
    var c = cv.getContext('2d');
    var rnd = Q.rng(20260811);
    var i, x, y, r;

    // 环绕绘制：把图元在 3×3 个偏移位置各画一遍，平铺后无缝
    function wrap(fn) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          c.save(); c.translate(dx * T, dy * T); fn(); c.restore();
        }
      }
    }
    function dot(cx, cy, rr, style) {
      wrap(function () {
        c.beginPath(); c.arc(cx, cy, rr, 0, 6.283); c.fillStyle = style; c.fill();
      });
    }

    if (kind === 'towel') {                       // 毛圈绒感：大小不一的软绒球
      var n = Math.round(T * T / (u * u) * 6);
      for (i = 0; i < n; i++) {
        x = rnd() * T; y = rnd() * T; r = u * (0.06 + rnd() * 0.16);
        var lit = rnd() < 0.5;
        var g0 = c.createRadialGradient(x, y, 0, x, y, r);
        g0.addColorStop(0, lit ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.28)');
        g0.addColorStop(1, 'rgba(0,0,0,0)');
        (function (gg, xx, yy, rr) {
          wrap(function () { c.beginPath(); c.arc(xx, yy, rr, 0, 6.283); c.fillStyle = gg; c.fill(); });
        })(g0, x, y, r);
      }
    } else if (kind === 'loofah') {               // 搓澡巾：清晰的斜向细网
      var step = Math.max(3, u * 0.34);
      c.lineWidth = Math.max(1, u * 0.07);
      for (i = -T; i < T * 2; i += step) {
        c.strokeStyle = 'rgba(0,0,0,.16)';
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i + T, T); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.15)';
        c.beginPath(); c.moveTo(i + c.lineWidth, 0); c.lineTo(i + T + c.lineWidth, T); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.13)';
        c.beginPath(); c.moveTo(i, T); c.lineTo(i + T, 0); c.stroke();
      }
    } else if (kind === 'mesh') {                 // 网布：规整方格压痕
      var g1 = Math.max(4, u * 0.45);
      c.lineWidth = Math.max(1, g1 / 5);
      for (i = 0; i <= T; i += g1) {
        c.strokeStyle = 'rgba(0,0,0,.22)';
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i, T); c.moveTo(0, i); c.lineTo(T, i); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.18)';
        c.beginPath();
        c.moveTo(i + c.lineWidth, 0); c.lineTo(i + c.lineWidth, T);
        c.moveTo(0, i + c.lineWidth); c.lineTo(T, i + c.lineWidth); c.stroke();
      }
    } else if (kind === 'waffle') {               // 华夫格：粗方格 + 立体内凹
      var w = Math.max(12, u * 1.6);
      for (y = 0; y < T; y += w) for (x = 0; x < T; x += w) {
        var gr = c.createLinearGradient(x, y, x + w, y + w);
        gr.addColorStop(0, 'rgba(255,255,255,.22)');
        gr.addColorStop(0.5, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(0,0,0,.26)');
        c.fillStyle = gr;
        c.fillRect(x + 1, y + 1, w - 2, w - 2);
      }
      c.strokeStyle = 'rgba(0,0,0,.30)';
      c.lineWidth = Math.max(2, w / 7);
      for (i = 0; i <= T; i += w) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i, T); c.moveTo(0, i); c.lineTo(T, i); c.stroke();
      }
    } else if (kind === 'crumpled') {             // 褶皱：随机长折痕
      c.lineCap = 'round';
      for (i = 0; i < 70; i++) {
        var sx = rnd() * T, sy = rnd() * T;
        var pts = [[sx, sy]];
        for (var k = 0; k < 3; k++) {
          sx += (rnd() - 0.5) * T * 0.5; sy += (rnd() - 0.5) * T * 0.5;
          pts.push([sx, sy]);
        }
        var lw = u * (0.04 + rnd() * 0.14);
        var st = rnd() < 0.5 ? 'rgba(255,255,255,.20)' : 'rgba(0,0,0,.22)';
        (function (pp, ww, ss) {
          wrap(function () {
            c.beginPath(); c.moveTo(pp[0][0], pp[0][1]);
            for (var j = 1; j < pp.length; j++) c.lineTo(pp[j][0], pp[j][1]);
            c.lineWidth = ww; c.strokeStyle = ss; c.stroke();
          });
        })(pts, lw, st);
      }
    } else if (kind === 'glitter') {              // 格利特：稀疏亮片 + 十字星
      var tint = TINTS[view.glitterTint] || TINTS.silver;
      var nn = Math.round(T * T / (u * u) * 1.6);
      for (i = 0; i < nn; i++) {
        x = rnd() * T; y = rnd() * T; r = u * (0.04 + rnd() * 0.10);
        c.globalAlpha = 0.45 + rnd() * 0.5;
        dot(x, y, r, tint[(rnd() * tint.length) | 0]);
      }
      c.globalAlpha = 1;
      var stars = Math.max(6, Math.round(T * T / (u * u) * 0.12));
      for (i = 0; i < stars; i++) {
        x = rnd() * T; y = rnd() * T; r = u * (0.18 + rnd() * 0.22);
        (function (xx, yy, rr) {
          wrap(function () {
            c.strokeStyle = 'rgba(255,255,255,.9)';
            c.lineWidth = Math.max(1, rr / 5);
            c.beginPath();
            c.moveTo(xx - rr, yy); c.lineTo(xx + rr, yy);
            c.moveTo(xx, yy - rr); c.lineTo(xx, yy + rr);
            c.stroke();
          });
        })(x, y, r);
      }
    } else if (kind === 'velvet') {               // 绒面：压暗 + 极细绒毛
      c.fillStyle = 'rgba(0,0,0,.18)';
      c.fillRect(0, 0, T, T);
      c.lineWidth = 1;
      for (i = 0; i < T * T / 26; i++) {
        x = rnd() * T; y = rnd() * T;
        var a = rnd() * 6.283, len = 1 + rnd() * (u * 0.12);
        c.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)';
        c.beginPath(); c.moveTo(x, y);
        c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
      }
    } else if (kind === 'gloss') {                // 亮面：窄而强的斜向高光带，避免整体发白
      var lg = c.createLinearGradient(0, 0, T, T);
      lg.addColorStop(0.00, 'rgba(255,255,255,0)');
      lg.addColorStop(0.16, 'rgba(255,255,255,.30)');
      lg.addColorStop(0.24, 'rgba(255,255,255,0)');
      lg.addColorStop(0.55, 'rgba(0,0,0,.10)');
      lg.addColorStop(0.70, 'rgba(255,255,255,.22)');
      lg.addColorStop(0.78, 'rgba(255,255,255,0)');
      lg.addColorStop(1.00, 'rgba(0,0,0,.08)');
      c.fillStyle = lg; c.fillRect(0, 0, T, T);
    }
    var pat = ctx.createPattern(cv, 'repeat');
    texCache[key] = pat;
    return pat;
  }

  // 各纹理该用的混合模式：闪粉要叠加发光，绒面要压暗，亮面要提亮
  var BLEND = {
    towel: 'overlay', loofah: 'overlay', mesh: 'overlay', waffle: 'overlay',
    crumpled: 'overlay', velvet: 'multiply', gloss: 'screen', glitter: 'lighter'
  };
  var TEX_ALPHA = { glitter: 0.9, gloss: 0.95 };

  var maskCv = document.createElement('canvas');
  /**
   * 把表面工艺叠到「只画了豆子」的图层上。
   *
   * 两点关键：
   * 1) 纹理原点跟着网格走（translate(ox, oy)），否则拖动画布时纹理会钉在屏幕上不动。
   * 2) Canvas2D 没法同时用混合模式和 source-atop，所以先备份豆子图层的 alpha 当蒙版，
   *    按混合模式铺完纹理后再用 destination-in 裁一次，纹理才不会糊到空格和底板上。
   */
  function applyFinish(g, layer, cssW, cssH, cell, ox, oy) {
    var f = FINISH[view.finish];
    if (!f || !f.tex) return;

    if (maskCv.width !== layer.width || maskCv.height !== layer.height) {
      maskCv.width = layer.width; maskCv.height = layer.height;
    }
    var m = maskCv.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, layer.width, layer.height);
    m.drawImage(layer, 0, 0);

    var pat = finishPattern(g, f.tex, cell);
    g.save();
    g.globalCompositeOperation = BLEND[f.tex] || 'source-over';
    g.globalAlpha = TEX_ALPHA[f.tex] == null ? 1 : TEX_ALPHA[f.tex];
    g.translate(ox, oy);                       // ← 纹理跟着网格一起滚动
    g.fillStyle = pat;
    g.fillRect(-ox - 2, -oy - 2, cssW + 4, cssH + 4);
    g.restore();

    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskCv, 0, 0);
    g.restore();
  }

  /**
   * 熨烫程度对应的外观参数。
   *
   * 关键在于「颗粒感随熨烫程度递减」：
   *   0 生豆 —— 一颗颗独立的圆柱，能看到侧壁和颗粒之间的缝
   *   1 轻烫 —— 外缘熔合、中心留孔（标准做法），边界仍清晰
   *   2 中烫 —— 半熔，边界变软、孔缩小，开始方形化
   *   3 重烫 —— 全熔，孔封死、**颗粒边界基本消失**，成为一整片光亮的塑料板
   *
   * 所以 3 档不再画单颗高光、描边和孔——此时相邻方块本来就严丝合缝地连成一片。
   * 模糊只用来做轻微的边界渗色（真实全熔的颜色分区仍然清晰，糊过头就失真了），
   * 再加一道贯穿整片的镜面光带。
   *
   * 字段：fill 占格比例 / round 圆角 / hole 孔径 / gloss 单颗高光 /
   *      edge 颗粒描边 / wall 圆柱侧壁暗部 / blur 熔合模糊(按格子比例) /
   *      sheet 整片镜面光强度
   */
  var IRON = [
    { fill: 0.86, round: 0.50, hole: 0.200, gloss: 0.13, edge: 0.22, wall: 0.34, blur: 0,    sheet: 0    },
    { fill: 1.00, round: 0.42, hole: 0.160, gloss: 0.16, edge: 0.14, wall: 0.12, blur: 0,    sheet: 0    },
    { fill: 1.00, round: 0.22, hole: 0.075, gloss: 0.18, edge: 0.06, wall: 0,    blur: 0.03, sheet: 0.07 },
    { fill: 1.00, round: 0.02, hole: 0,     gloss: 0,    edge: 0,    wall: 0,    blur: 0.07, sheet: 0.18 }
  ];

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 把颜色压暗，用来画圆柱侧壁 */
  function shade(hex, k) {
    var c = C.hexToRgb(hex) || [0, 0, 0];
    return C.rgbToHex(c[0] * k, c[1] * k, c[2] * k);
  }

  function drawBead(ctx, px, py, cell, hex, dim, lvl) {
    var p = IRON[lvl == null ? view.ironLevel : lvl] || IRON[1];
    var cx = px + cell / 2, cy = py + cell / 2;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.25;

    var size = cell * p.fill, off = (cell - size) / 2;
    var isRound = p.round >= 0.48;

    // 圆柱侧壁：生豆状态下沿底部露出一圈暗色，才看得出是「立着的柱子」而不是平面圆点
    if (p.wall > 0 && cell >= 7) {
      ctx.fillStyle = shade(hex, 1 - p.wall);
      if (isRound) {
        ctx.beginPath();
        ctx.arc(cx, cy + size * 0.10, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        roundRect(ctx, px + off, py + off + size * 0.08, size, size, size * p.round);
        ctx.fill();
      }
    }

    ctx.fillStyle = hex;
    if (isRound) { ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.fill(); }
    else { roundRect(ctx, px + off, py + off, size, size, size * p.round); ctx.fill(); }

    if (cell >= 6) {
      if (p.hole > 0) {
        var hr = cell * p.hole;
        ctx.beginPath(); ctx.arc(cx, cy, hr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,' + (0.28 + p.wall * 0.4).toFixed(3) + ')'; ctx.fill();
        // 孔内壁高光，进一步强化「这是个通孔」
        if (p.wall > 0) {
          ctx.beginPath();
          ctx.arc(cx, cy - hr * 0.25, hr * 0.72, Math.PI * 0.15, Math.PI * 0.85);
          ctx.strokeStyle = 'rgba(255,255,255,.16)';
          ctx.lineWidth = Math.max(0.6, cell * 0.025);
          ctx.stroke();
        }
      }
      var gm = (FINISH[view.finish] || FINISH.paper).gloss;
      if (p.gloss * gm > 0.01) {
        ctx.beginPath();
        ctx.arc(cx - size * 0.16, cy - size * 0.18, size * (p.hole > 0 ? 0.26 : 0.34), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.6, p.gloss * gm).toFixed(3) + ')';
        ctx.fill();
      }
      if (p.edge > 0.04) {                      // 颗粒描边：熔得越透越淡，全熔时完全没有
        ctx.strokeStyle = 'rgba(0,0,0,' + (p.edge * 0.7).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.5, cell * 0.03);
        if (isRound) { ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.stroke(); }
        else { roundRect(ctx, px + off, py + off, size, size, size * p.round); ctx.stroke(); }
      }
    }
    ctx.restore();
  }

  /**
   * 熔合后处理：整层做一次模糊，让相邻颗粒的颜色在边界混合，
   * 颗粒边界随之消失——这正是全熔成品「看不出一颗颗豆子」的原因。
   * 再叠一道贯穿整片的镜面光带。
   */
  var blurCv = document.createElement('canvas');
  function fuseLayer(g, layer, cssW, cssH, cell, lvl) {
    var p = IRON[lvl] || IRON[1];
    if (p.blur > 0) {
      var rad = Math.max(0.6, cell * p.blur);
      if (blurCv.width !== layer.width || blurCv.height !== layer.height) {
        blurCv.width = layer.width; blurCv.height = layer.height;
      }
      var b = blurCv.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, layer.width, layer.height);
      b.drawImage(layer, 0, 0);

      var scale = layer.width / Math.max(1, cssW);   // 换算到设备像素
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, layer.width, layer.height);
      g.filter = 'blur(' + (rad * scale).toFixed(2) + 'px)';
      g.drawImage(blurCv, 0, 0);
      g.filter = 'none';
      g.restore();
    }
    if (p.sheet > 0) {
      g.save();
      g.globalCompositeOperation = 'source-atop';
      var lg = g.createLinearGradient(0, 0, cssW, cssH);
      lg.addColorStop(0.00, 'rgba(255,255,255,' + (p.sheet * 1.1).toFixed(3) + ')');
      lg.addColorStop(0.30, 'rgba(255,255,255,0)');
      lg.addColorStop(0.52, 'rgba(255,255,255,' + (p.sheet * 1.5).toFixed(3) + ')');
      lg.addColorStop(0.62, 'rgba(255,255,255,0)');
      lg.addColorStop(1.00, 'rgba(0,0,0,' + (p.sheet * 0.5).toFixed(3) + ')');
      g.fillStyle = lg;
      g.fillRect(0, 0, cssW, cssH);
      g.restore();
    }
  }

  /** 反面看到的是镜像；单面熨烫时反面仍是生豆的样子 */
  function effIronLevel() {
    if (view.side === 'back' && !view.ironBoth) return 0;
    return view.ironLevel;
  }
  function mirrored() { return view.side === 'back'; }

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
      tctx.fillStyle = (view.boldEvery && n % view.boldEvery === 0) ? '#c0392b' : th.rulerFg;
      tctx.fillText(String(n), X, tHh / 2);
    }
    var r0 = Math.max(0, Math.floor(-oy / cell)), r1 = Math.min(r.h - 1, Math.ceil((lh - oy) / cell));
    for (var y = r0; y <= r1; y++) {
      var m = y + 1;
      if (step > 1 && m % step !== 0 && m !== 1) continue;
      var Y = oy + y * cell + cell / 2;
      if (Y < -10 || Y > lh + 10) continue;
      lctx.fillStyle = (view.boldEvery && m % view.boldEvery === 0) ? '#c0392b' : th.rulerFg;
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
    var mode = dom.listSort.value || 'code';
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
    dom.btnClearHl.hidden = !(r && state.highlight >= 0);
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
          commit();
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
      ctx.fillStyle = (view.boldEvery && n % view.boldEvery === 0) ? '#c0392b' : '#555';
      ctx.fillText(String(n), ox + x * cell + cell / 2, oy - R / 2);
    }
    for (y = 0; y < r.h; y++) {
      var m = y + 1;
      if (step > 1 && m % step !== 0 && m !== 1) continue;
      ctx.fillStyle = (view.boldEvery && m % view.boldEvery === 0) ? '#c0392b' : '#555';
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
    if (view.showGrid) {
      ctx.lineWidth = 1; ctx.strokeStyle = '#c9ccd2'; ctx.beginPath();
      for (x = 0; x <= r.w; x++) { ctx.moveTo(ox + x * cell + 0.5, oy); ctx.lineTo(ox + x * cell + 0.5, oy + r.h * cell); }
      for (y = 0; y <= r.h; y++) { ctx.moveTo(ox, oy + y * cell + 0.5); ctx.lineTo(ox + r.w * cell, oy + y * cell + 0.5); }
      ctx.stroke();
      if (view.boldEvery) {
        var be = view.boldEvery;
        ctx.lineWidth = 2; ctx.strokeStyle = '#6b7280'; ctx.beginPath();
        for (x = 0; x <= r.w; x += be) { ctx.moveTo(ox + x * cell + 0.5, oy); ctx.lineTo(ox + x * cell + 0.5, oy + r.h * cell); }
        for (y = 0; y <= r.h; y += be) { ctx.moveTo(ox, oy + y * cell + 0.5); ctx.lineTo(ox + r.w * cell, oy + y * cell + 0.5); }
        ctx.stroke();
      }
      ctx.strokeRect(ox + 0.5, oy + 0.5, r.w * cell, r.h * cell);
    }

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

    var f = FINISH[view.finish];
    var ip = IRON[effIronLevel()] || IRON[1];
    var needLay = (f && f.tex) || ip.blur > 0 || ip.sheet > 0;
    var lay = needLay ? document.createElement('canvas') : null;
    var g2 = ctx;
    if (lay) { lay.width = cv.width; lay.height = cv.height; g2 = lay.getContext('2d'); }

    for (var y = 0; y < r.h; y++) {
      for (var x = 0; x < r.w; x++) {
        var i = r.idx[y * r.w + (mirrored() ? r.w - 1 - x : x)];
        if (i < 0) continue;
        drawBead(g2, x * cell, y * cell, cell, r.sub[i].hex, false, effIronLevel());
      }
    }
    if (lay) {
      fuseLayer(g2, lay, cv.width, cv.height, cell, effIronLevel());
      applyFinish(g2, lay, cv.width, cv.height, cell, 0, 0);
      ctx.drawImage(lay, 0, 0);
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

    /* --- 旋转 / 翻转 / 裁剪 --- */
    function rot(delta) {
      if (!state.img) return;
      opts.rotate = ((opts.rotate + delta) % 360 + 360) % 360;
      mapCrop(delta > 0 ? rotateCropCW : rotateCropCCW);
      updateSource(); scheduleCompute(0); commit();
    }
    dom.btnRotR.addEventListener('click', function () { rot(90); });
    dom.btnRotL.addEventListener('click', function () { rot(-90); });
    dom.btnFlipH.addEventListener('click', function () {
      if (!state.img) return;
      opts.flipH = !opts.flipH;
      mapCrop(function (c) { return { x: 1 - (c.x + c.w), y: c.y, w: c.w, h: c.h }; });
      updateSource(); scheduleCompute(0);
    });
    dom.btnFlipV.addEventListener('click', function () {
      if (!state.img) return;
      opts.flipV = !opts.flipV;
      mapCrop(function (c) { return { x: c.x, y: 1 - (c.y + c.h), w: c.w, h: c.h }; });
      updateSource(); scheduleCompute(0);
    });
    dom.btnCrop.addEventListener('click', function () { setCropMode(!state.cropMode); });
    dom.btnCropReset.addEventListener('click', function () {
      opts.crop = null; setCropMode(false); updateSource(); scheduleCompute(0); commit();
    });
    initCropDrag();

    /* --- 场景预设 --- */
    dom.scenePresets.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) applyScene(b.dataset.p);
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
    // 数字框不吸附到 5 的倍数：滑块给的是常用档位，手输才是精确控制
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
    bindRange(dom.texture, dom.textureVal, 'texture', function (v) { return (v / 100).toFixed(2); });
    dom.sampleMode.addEventListener('change', function () {
      opts.sampleMode = this.value;
      dom.textureRow.hidden = opts.sampleMode !== 'dpid';
      dom.textureHint.hidden = opts.sampleMode !== 'dpid';
      scheduleCompute();
    });

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
    [['showGrid', 'showGrid'], ['showRuler', 'showRuler']].forEach(function (p) {
      dom[p[0]].addEventListener('change', function () {
        view[p[1]] = this.checked;
        if (p[1] === 'showGrid') {
          [].forEach.call(dom.boldEvery.children, function (b) { b.disabled = !view.showGrid; });
          dom.boldEvery.classList.toggle('disabled', !view.showGrid);
        }
        layout(); render(); saveSettings(); commit();
      });
    });
    dom.beadMm.addEventListener('change', function () {
      view.beadMm = parseFloat(this.value); updateStats(); saveSettings(); commit();
    });
    dom.ironLevel.addEventListener('change', function () {
      view.ironLevel = parseInt(this.value, 10) || 0;
      if (view.mode !== 'preview') {          // 调熨烫自然是想看成品
        view.mode = 'preview';
        [].forEach.call(dom.viewMode.children, function (b) {
          b.classList.toggle('on', b.dataset.v === 'preview');
        });
        layout();
      }
      render(); saveSettings(); commit();
    });
    dom.finish.addEventListener('change', function () {
      view.finish = this.value;
      dom.tintRow.hidden = view.finish !== 'glitter';
      if (view.mode !== 'preview') {
        view.mode = 'preview';
        [].forEach.call(dom.viewMode.children, function (b) {
          b.classList.toggle('on', b.dataset.v === 'preview');
        });
        layout();
      }
      render(); saveSettings(); commit();
    });
    dom.glitterTint.addEventListener('change', function () {
      view.glitterTint = this.value; render(); saveSettings(); commit();
    });
    dom.sideView.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      view.side = b.dataset.s;
      [].forEach.call(dom.sideView.children, function (c) { c.classList.toggle('on', c === b); });
      render(); saveSettings(); commit();
    });
    dom.ironBoth.addEventListener('change', function () {
      view.ironBoth = this.checked; render(); saveSettings(); commit();
    });
    dom.themeDots.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      applyTheme(b.dataset.t); saveSettings();
    });
    dom.btnFocus.addEventListener('click', function () { setFocus(!view.focus); });
    dom.btnFull.addEventListener('click', toggleFullscreen);
    dom.immersiveExit.addEventListener('click', function () { toggleFullscreen(); });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        // 用户按 Esc 或系统手势退出了真全屏，沉浸模式也要跟着退出
        if (!fsElement() && view.immersive) setImmersive(false);
        setTimeout(function () { layout(); render(); }, 60);
      });
    });

    dom.boldEvery.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      view.boldEvery = +b.dataset.n;
      [].forEach.call(dom.boldEvery.children, function (c) { c.classList.toggle('on', c === b); });
      render(); saveSettings(); commit();
    });

    /* --- 清单 --- */
    dom.btnClearHl.addEventListener('click', function () {
      state.highlight = -1; renderColorList(); render();
    });
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
      var og = Object.assign({}, opts);
      delete og.rotate; delete og.flipH; delete og.flipV; delete og.crop;
      var data = { v: 1, opts: og, view: view, disabled: state.disabled };
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

    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);
    dom.btnPrint.addEventListener('click', printChart);
    dom.btnReset.addEventListener('click', function () {
      if (!confirm('恢复所有参数为默认值？')) return;
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      location.reload();
    });

    /* --- 画布交互 --- */
    dom.scroller.addEventListener('scroll', function () { render(); });

    /* --- 画布交互：平移 / 缩放 / 取色，鼠标与触屏统一走 Pointer Events ---
     *
     * .scroller 上设了 touch-action:none，浏览器不再接管手势，
     * 单指平移因此要自己实现，换来的是双指捏合能稳定拿到两个 pointer。
     * 之前用 mousedown/mousemove，触屏上依赖兼容性鼠标事件，双指必然收不到。 */
    var pts = new Map();          // 当前按下的指针
    var pan = null;               // 单指/鼠标平移状态
    var pinch = null;             // 双指缩放状态

    function midOf(a) {
      return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2,
               d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) };
    }
    function zoomTo(next, cx, cy, from) {
      next = Math.max(6, Math.min(64, Math.round(next)));
      if (next === view.cell) return;
      var rect = dom.scroller.getBoundingClientRect();
      var mx = cx - rect.left + from.sl - state.offX;
      var my = cy - rect.top + from.st - state.offY;
      var old = from.cell;
      view.cell = next;
      dom.cellSize.value = next; dom.cellSizeVal.textContent = next + 'px';
      layout();
      dom.scroller.scrollLeft = mx / old * next - (cx - rect.left) + state.offX;
      dom.scroller.scrollTop = my / old * next - (cy - rect.top) + state.offY;
      render();
    }

    dom.scroller.addEventListener('pointerdown', function (e) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { dom.scroller.setPointerCapture(e.pointerId); } catch (err) {}
      if (pts.size === 1) {
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY,
                sl: dom.scroller.scrollLeft, st: dom.scroller.scrollTop, moved: 0 };
        pinch = null;
      } else if (pts.size === 2) {
        pan = null;
        var m = midOf([].slice.call(pts.values()));
        pinch = { dist: m.d, cell: view.cell,
                  sl: dom.scroller.scrollLeft, st: dom.scroller.scrollTop };
      }
    });

    dom.scroller.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) {                 // 没按下 —— 鼠标悬停
        if (e.pointerType === 'mouse') updateHover(e);
        return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size >= 2 && pinch) {
        var m = midOf([].slice.call(pts.values()));
        if (pinch.dist > 10) {
          zoomTo(pinch.cell * m.d / pinch.dist, m.x, m.y,
                 { sl: pinch.sl, st: pinch.st, cell: pinch.cell });
        }
        return;
      }
      if (pan && pan.id === e.pointerId) {
        var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        pan.moved = Math.max(pan.moved, Math.abs(dx) + Math.abs(dy));
        if (pan.moved > 4) {
          dom.scroller.classList.add('grabbing');
          dom.scroller.scrollLeft = pan.sl - dx;
          dom.scroller.scrollTop = pan.st - dy;
        }
        if (e.pointerType === 'mouse') updateHover(e);
      }
    });

    function endPointer(e) {
      var wasPan = pan && pan.id === e.pointerId;
      var moved = wasPan ? pan.moved : 99;
      pts.delete(e.pointerId);
      try { dom.scroller.releasePointerCapture(e.pointerId); } catch (err) {}
      dom.scroller.classList.remove('grabbing');
      if (pinch && pts.size < 2) { pinch = null; saveSettings(); }
      if (wasPan) {
        pan = null;
        if (moved <= 4 && e.type === 'pointerup') pickCell(e);
      }
      if (pts.size === 1 && !pan) {                // 双指抬起一只，剩下那只接着平移
        var only = [].slice.call(pts.entries())[0];
        pan = { id: only[0], x: only[1].x, y: only[1].y,
                sl: dom.scroller.scrollLeft, st: dom.scroller.scrollTop, moved: 99 };
      }
    }
    dom.scroller.addEventListener('pointerup', endPointer);
    dom.scroller.addEventListener('pointercancel', endPointer);
    dom.scroller.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse' && !pts.size) {
        state.hover = null; dom.hoverInfo.textContent = '—'; render();
      }
    });

    // iOS Safari 上双指默认会缩放整个页面，必须在 touchmove 里拦掉
    dom.scroller.addEventListener('touchmove', function (e) {
      if (e.touches.length > 1) e.preventDefault();
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
      var c = cellAt(e);
      // 点到网格外或点到空格 —— 都视为「取消高亮，显示全部」
      if (!c) {
        if (state.highlight >= 0) { state.highlight = -1; renderColorList(); render(); }
        return;
      }
      var r = state.result, i = r.idx[c.y * r.w + c.x];
      state.highlight = (i >= 0 && state.highlight !== i) ? i : -1;
      renderColorList(); render();
    }

    window.addEventListener('resize', function () { layout(); render(); });
    window.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') {
        if (view.immersive && !fsElement()) { toggleFullscreen(); return; }
        if (!dom.feedbackModal.classList.contains('hidden')) dom.feedbackModal.classList.add('hidden');
        else if (!dom.paletteModal.classList.contains('hidden')) dom.paletteModal.classList.add('hidden');
        else if (state.cropMode) setCropMode(false);
        else if (state.highlight >= 0) { state.highlight = -1; renderColorList(); render(); }
        return;
      }
      if (!state.img) return;
      var SCENE_KEYS = { '1': 'photo', '2': 'anime', '3': 'pixel', '4': 'flat', '5': 'mono', '6': 'fidelity' };
      if (SCENE_KEYS[e.key]) { applyScene(SCENE_KEYS[e.key]); return; }
      if (e.key === '[') { dom.btnRotL.click(); return; }
      if (e.key === ']') { dom.btnRotR.click(); return; }
      if (e.key === 'c' || e.key === 'C') { setCropMode(!state.cropMode); return; }
      if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); return; }
      if (e.key === '\\') { setFocus(!view.focus); return; }
      if (e.key === 'v' || e.key === 'V') {           // 图纸 / 预览 切换
        view.mode = view.mode === 'chart' ? 'preview' : 'chart';
        [].forEach.call(dom.viewMode.children, function (b) {
          b.classList.toggle('on', b.dataset.v === view.mode);
        });
        layout(); render(); saveSettings();
      }
    });

    dom.btnFeedback.addEventListener('click', openFeedback);
    dom.fbClose.addEventListener('click', function () { dom.feedbackModal.classList.add('hidden'); });
    dom.feedbackModal.addEventListener('click', function (e) {
      if (e.target === dom.feedbackModal) dom.feedbackModal.classList.add('hidden');
    });
    dom.fbSend.addEventListener('click', sendFeedback);
    dom.fbCopy.addEventListener('click', function () {
      var t = feedbackText();
      navigator.clipboard.writeText(t)
        .then(function () { dom.fbStatus.textContent = '已复制到剪贴板'; })
        .catch(function () { dom.fbStatus.textContent = '复制失败，请手动选中上面的内容'; });
    });
    dom.footVer.textContent = 'v' + FEEDBACK.version;

    dom.btnSample.addEventListener('click', function () {
      if (PD.sampleImage) loadImageFromURL(PD.sampleImage, '示例图片');
      else loadImageFromPath('tests/fixtures/photo_landscape.png', '示例图片');
    });

    loadSettings();
    applyURLParams();
    layout();
    render();
    commit();                       // 记下初始状态，撤销才有底可回
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
                   blur: 'blur', sharpen: 'sharpen', alpha: 'alphaTh', ditherAmt: 'ditherAmt',
                   texture: 'texture' };
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
    if (q.has('iron')) view.ironLevel = parseInt(q.get('iron'), 10);
    if (q.has('finish')) view.finish = q.get('finish');
    if (q.has('tint')) view.glitterTint = q.get('tint');
    if (q.has('side')) view.side = q.get('side');
    if (q.has('theme')) view.theme = q.get('theme');
    if (q.has('rotate')) opts.rotate = parseInt(q.get('rotate'), 10);
    if (q.has('bold')) view.boldEvery = parseInt(q.get('bold'), 10);

    sanitize();
    syncUI();
    updatePalCount();

    if (q.get('demo') === '1' && PD.sampleImage) loadImageFromURL(PD.sampleImage, '示例图片');
    else if (q.has('img')) loadImageFromPath(q.get('img'), q.get('img').split('/').pop());
  }

  /* ==========================================================
   * 主题 / 专注 / 全屏
   * ========================================================== */
  var THEMES = ['purple', 'blue', 'teal', 'rose', 'amber', 'light'];
  var THEME_BG = {
    purple: '#12101a', blue: '#0f1216', teal: '#0c1414',
    rose: '#171014', amber: '#15110b', light: '#f4f5f8'
  };

  function applyTheme(id) {
    if (THEMES.indexOf(id) < 0) id = 'purple';
    view.theme = id;
    document.documentElement.setAttribute('data-theme', id);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', THEME_BG[id]);
    if (dom.themeDots) {
      [].forEach.call(dom.themeDots.children, function (b) {
        b.classList.toggle('on', b.dataset.t === id);
      });
    }
    // 主题换了，画布的纸面/板面颜色也要跟着重画
    if (dom.mainCanvas) { layout(); render(); }
  }

  function setFocus(on) {
    view.focus = !!on;
    document.body.classList.toggle('focus-mode', view.focus);
    dom.btnFocus.classList.toggle('on', view.focus);
    setTimeout(function () { layout(); render(); }, 30);
    saveSettings();
  }

  /**
   * 全屏 / 沉浸模式。
   *
   * iOS Safari 不支持非 video 元素的 Fullscreen API（requestFullscreen 根本不存在），
   * 所以不能只依赖它。这里的做法是：能进真全屏就进，同时**始终**切换一套纯 CSS 的
   * 沉浸模式（隐藏顶栏/面板/页脚，画布铺满 100dvh，右上角浮一个退出按钮）。
   * 这样 iPhone 上也有等效的全屏体验。
   */
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function setImmersive(on) {
    view.immersive = !!on;
    document.body.classList.toggle('immersive', view.immersive);
    dom.btnFull.classList.toggle('on', view.immersive);
    // 100dvh 生效、面板消失之后要重排一次画布
    setTimeout(function () { layout(); render(); }, 60);
    setTimeout(function () { layout(); render(); }, 320);
  }

  function toggleFullscreen() {
    var want = !view.immersive;
    if (want) {
      var el = document.documentElement;
      var fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (fn) {
        try {
          var r = fn.call(el);
          if (r && r.catch) r.catch(function () {});   // 被拒绝也没关系，CSS 沉浸模式照样生效
        } catch (e) {}
      }
      setImmersive(true);
      setStatus('沉浸模式 · 按 F 或 Esc 退出');
    } else {
      if (fsElement()) {
        try { (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document); }
        catch (e) {}
      }
      setImmersive(false);
      setStatus('');
    }
  }

  /* ==========================================================
   * 撤销 / 重做
   *
   * 存的是「整份参数快照」而不是操作日志：动作种类多（禁色、预设、旋转、
   * 裁剪、滑块…），逐个写反向操作既啰嗦又容易漏，快照最省心也最不会错。
   * 快照很小（几百字节的 JSON），存 50 步也无所谓。
   * ========================================================== */
  var hist = { stack: [], idx: -1, max: 50, muted: false, timer: null };

  function snapKey() {
    return JSON.stringify({ opts: opts, view: view, disabled: state.disabled });
  }

  /** 立刻记一步（用于禁色、预设、旋转这类离散操作） */
  function commit() {
    if (hist.muted) return;
    clearTimeout(hist.timer);
    var k = snapKey();
    if (hist.idx >= 0 && hist.stack[hist.idx] === k) return;
    hist.stack = hist.stack.slice(0, hist.idx + 1);
    hist.stack.push(k);
    if (hist.stack.length > hist.max) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    updateUndoUI();
  }

  /** 拖滑块时用：安静一会儿再记，整段拖动合成一步 */
  function commitLater() {
    if (hist.muted) return;
    clearTimeout(hist.timer);
    hist.timer = setTimeout(commit, 650);
  }

  function updateUndoUI() {
    dom.btnUndo.disabled = hist.idx <= 0;
    dom.btnRedo.disabled = hist.idx >= hist.stack.length - 1;
  }

  function applySnapshot(str) {
    var d;
    try { d = JSON.parse(str); } catch (e) { return; }
    hist.muted = true;
    Object.keys(opts).forEach(function (k) { if (d.opts[k] !== undefined) opts[k] = d.opts[k]; });
    Object.keys(view).forEach(function (k) { if (d.view[k] !== undefined) view[k] = d.view[k]; });
    state.disabled = d.disabled || {};
    sanitize();
    syncUI();
    updatePalCount();
    if (state.img) { updateSource(); scheduleCompute(0); } else { layout(); render(); }
    hist.muted = false;
    updateUndoUI();
  }

  function undo() {
    if (hist.idx <= 0) return;
    clearTimeout(hist.timer);
    hist.idx--;
    applySnapshot(hist.stack[hist.idx]);
    setStatus('已撤销');
  }
  function redo() {
    if (hist.idx >= hist.stack.length - 1) return;
    hist.idx++;
    applySnapshot(hist.stack[hist.idx]);
    setStatus('已重做');
  }

  /* ==========================================================
   * 反馈
   * ========================================================== */
  var FEEDBACK = {
    // 填上表单服务的接收地址（Formspree / Basin / Tally 等）后，
    // 反馈会直接提交到后台，来访 IP 由该服务在服务端记录。
    // 留空则退回到「打开预填好的 GitHub Issue」。
    endpoint: '',
    repo: 'Hon-Wong/pindou',
    version: '2026.08.11'
  };

  /** 采集随反馈一起提交的环境信息；内容会原样展示给用户看过再发 */
  function collectDiagnostics() {
    var nav = navigator, scr = window.screen || {};
    var r = state.result;
    var d = {
      时间: new Date().toISOString(),
      版本: FEEDBACK.version,
      页面: location.href.split('?')[0],
      浏览器: nav.userAgent,
      平台: nav.platform || '',
      语言: nav.language,
      时区: (function () {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; }
      })(),
      屏幕: (scr.width || 0) + '×' + (scr.height || 0) + ' @' + (window.devicePixelRatio || 1) + 'x',
      窗口: window.innerWidth + '×' + window.innerHeight,
      触屏: ('ontouchstart' in window) || nav.maxTouchPoints > 0 ? '是' : '否',
      当前图片: state.img ? (state.rawW + '×' + state.rawH + ' px') : '未载入',
      当前参数: state.img ? {
        格数: opts.gridW + '×' + opts.gridH,
        色卡: opts.paletteId, 色数: opts.colors, 算法: opts.algo,
        抖动: opts.dither, 马赛克: opts.mosaic, 采样: opts.sampleMode,
        旋转: opts.rotate, 裁剪: opts.crop ? '有' : '无'
      } : null,
      当前结果: r ? (r.w + '×' + r.h + ' / ' + r.sub.length + ' 色 / ' + r.total + ' 颗') : '无'
    };
    return d;
  }

  function openFeedback() {
    dom.fbStatus.textContent = '';
    dom.fbDiag.textContent = JSON.stringify(collectDiagnostics(), null, 2);
    dom.fbPrivacy.innerHTML = FEEDBACK.endpoint
      ? '提交后由表单服务接收，<b>服务端会记录你的 IP 地址</b>用于识别重复反馈与滥用。'
        + '以上信息你可以先看一遍，不想带就取消勾选。联系方式选填。'
      : '当前未配置表单服务，点发送会打开 <b>GitHub Issue</b> 并预填好内容（需要 GitHub 账号）；'
        + '也可以点「复制内容」自己发给作者。';
    dom.feedbackModal.classList.remove('hidden');
    setTimeout(function () { dom.fbText.focus(); }, 50);
  }

  function feedbackPayload() {
    var body = {
      type: dom.fbType.value,
      typeLabel: dom.fbType.options[dom.fbType.selectedIndex].text,
      message: dom.fbText.value.trim(),
      contact: dom.fbContact.value.trim()
    };
    if (dom.fbIncludeDiag.checked) body.diagnostics = collectDiagnostics();
    return body;
  }

  function feedbackText() {
    var p = feedbackPayload();
    var out = ['类型：' + p.typeLabel, '', p.message, ''];
    if (p.contact) out.push('联系方式：' + p.contact, '');
    if (p.diagnostics) {
      out.push('---', '环境信息：', '```json', JSON.stringify(p.diagnostics, null, 2), '```');
    }
    return out.join('\n');
  }

  function sendFeedback() {
    var msg = dom.fbText.value.trim();
    if (msg.length < 5) { dom.fbStatus.textContent = '⚠️ 请先写点具体内容（至少 5 个字）'; return; }
    dom.fbSend.disabled = true;
    dom.fbStatus.textContent = '发送中…';

    if (!FEEDBACK.endpoint) {
      var url = 'https://github.com/' + FEEDBACK.repo + '/issues/new?title='
        + encodeURIComponent('[反馈] ' + msg.slice(0, 40))
        + '&body=' + encodeURIComponent(feedbackText());
      window.open(url, '_blank', 'noopener');
      dom.fbStatus.textContent = '已打开 GitHub Issue 页面，确认后点 Submit 即可。';
      dom.fbSend.disabled = false;
      return;
    }

    fetch(FEEDBACK.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(feedbackPayload())
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      dom.fbStatus.textContent = '✅ 已收到，谢谢！';
      dom.fbText.value = '';
      setTimeout(function () { dom.feedbackModal.classList.add('hidden'); }, 1200);
    }).catch(function (e) {
      dom.fbStatus.textContent = '❌ 发送失败（' + e.message + '），可以点「复制内容」手动发给作者。';
    }).then(function () { dom.fbSend.disabled = false; });
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
    try {
      // 旋转/翻转/裁剪属于「当前这张图」，不跟着参数走，
      // 否则下次打开换了张图还套着上一张的裁剪框
      var geomFree = Object.assign({}, opts);
      delete geomFree.rotate; delete geomFree.flipH; delete geomFree.flipV; delete geomFree.crop;
      snapshot = JSON.stringify({ opts: geomFree, view: view, disabled: state.disabled });
    } catch (e) { return; }
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
    sampleMode: ['ssim', 'area', 'dpid', 'edge', 'dominant', 'nearest'],
    algo: ['kmeans', 'mediancut', 'direct'],
    dither: ['none', 'fs', 'ordered']
  };
  var RANGES = {
    gridW: [GRID_MIN, GRID_MAX], gridH: [GRID_MIN, GRID_MAX], mosaic: [1, 10], blur: [0, 5], sharpen: [0, 100],
    colors: [2, 64], ditherAmt: [0, 100], texture: [0, 300], brightness: [-100, 100], contrast: [-100, 100],
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
    if ([0, 90, 180, 270].indexOf(+opts.rotate) < 0) opts.rotate = 0; else opts.rotate = +opts.rotate;
    opts.flipH = !!opts.flipH; opts.flipV = !!opts.flipV;
    var cr = opts.crop;
    if (cr && ['x', 'y', 'w', 'h'].every(function (k) { return isFinite(cr[k]); })
        && cr.w > 0.01 && cr.h > 0.01 && cr.x >= 0 && cr.y >= 0
        && cr.x + cr.w <= 1.001 && cr.y + cr.h <= 1.001) {
      opts.crop = { x: +cr.x, y: +cr.y, w: +cr.w, h: +cr.h };
    } else {
      opts.crop = null;
    }
    if (!C.hexToRgb(opts.bgColor)) opts.bgColor = DEFAULTS.opts.bgColor;
    if (!P.all[opts.paletteId]) opts.paletteId = DEFAULTS.opts.paletteId;

    if (['chart', 'preview'].indexOf(view.mode) < 0) view.mode = DEFAULTS.view.mode;
    if (['code', 'symbol', 'both', 'none'].indexOf(view.labelMode) < 0) view.labelMode = DEFAULTS.view.labelMode;
    if (['round', 'square'].indexOf(view.beadShape) < 0) view.beadShape = DEFAULTS.view.beadShape;
    var cell = parseFloat(view.cell);
    view.cell = isFinite(cell) ? C.clamp(Math.round(cell), 6, 64) : DEFAULTS.view.cell;
    if ([0, 1, 2, 3].indexOf(+view.ironLevel) < 0) view.ironLevel = 1; else view.ironLevel = +view.ironLevel;
    if (['front', 'back'].indexOf(view.side) < 0) view.side = 'front';
    if (!FINISH[view.finish]) view.finish = 'paper';
    if (!TINTS[view.glitterTint]) view.glitterTint = 'silver';
    view.ironBoth = !!view.ironBoth;
    view.focus = !!view.focus;
    view.immersive = false;   // 沉浸模式不跨会话保留，免得打开就一脸懵
    if (THEMES.indexOf(view.theme) < 0) view.theme = 'purple';
    if ([2.6, 5, 10].indexOf(+view.beadMm) < 0) view.beadMm = DEFAULTS.view.beadMm;
    else view.beadMm = +view.beadMm;
    ['showGrid', 'showRuler'].forEach(function (k) { view[k] = !!view[k]; });
    if ([0, 5, 10].indexOf(+view.boldEvery) < 0) view.boldEvery = 10; else view.boldEvery = +view.boldEvery;
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
    dom.texture.value = opts.texture;
    dom.textureVal.textContent = (opts.texture / 100).toFixed(2);
    dom.textureRow.hidden = opts.sampleMode !== 'dpid';
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
    [].forEach.call(dom.boldEvery.children, function (b) {
      b.classList.toggle('on', +b.dataset.n === view.boldEvery);
      b.disabled = !view.showGrid;
    });
    dom.boldEvery.classList.toggle('disabled', !view.showGrid);
    dom.showRuler.checked = view.showRuler;
    dom.beadMm.value = String(view.beadMm);
    dom.ironLevel.value = String(view.ironLevel);
    dom.finish.value = view.finish;
    dom.glitterTint.value = view.glitterTint;
    dom.tintRow.hidden = view.finish !== 'glitter';
    dom.ironBoth.checked = view.ironBoth;
    [].forEach.call(dom.sideView.children, function (b) {
      b.classList.toggle('on', b.dataset.s === view.side);
    });
    applyTheme(view.theme);
    document.body.classList.toggle('focus-mode', !!view.focus);
    dom.btnFocus.classList.toggle('on', !!view.focus);
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
