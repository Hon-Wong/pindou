/* ==========================================================
 * color.js — 色彩空间转换与色差计算
 * sRGB ↔ Lab(D65)、CIE76 / CIEDE2000 色差、对比度
 * ========================================================== */
(function (global) {
  'use strict';

  var PD = global.PD || (global.PD = {});
  var C = {};

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  C.clamp = clamp;

  /* ---------- HEX ↔ RGB ---------- */
  C.hexToRgb = function (hex) {
    var h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  C.rgbToHex = function (r, g, b) {
    function t(v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }
    return '#' + t(r) + t(g) + t(b);
  };

  /* ---------- sRGB 传递函数 ---------- */
  function srgbToLinear(c) { // c ∈ [0,1]
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }
  C.srgbToLinear = srgbToLinear;
  C.linearToSrgb = linearToSrgb;

  // 0..255 整数的线性化查表，热路径提速
  var LIN = new Float64Array(256);
  for (var i = 0; i < 256; i++) LIN[i] = srgbToLinear(i / 255);

  /* ---------- RGB → Lab (D65 / 2°) ---------- */
  var Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  var EPS = 216 / 24389, KAP = 24389 / 27;

  function f_(t) { return t > EPS ? Math.cbrt(t) : (KAP * t + 16) / 116; }

  C.rgbToLab = function (r, g, b, out) {
    out = out || new Array(3);
    var R, G, B;
    if ((r | 0) === r && (g | 0) === g && (b | 0) === b && r >= 0 && r < 256 && g >= 0 && g < 256 && b >= 0 && b < 256) {
      R = LIN[r]; G = LIN[g]; B = LIN[b];
    } else {
      R = srgbToLinear(clamp(r, 0, 255) / 255);
      G = srgbToLinear(clamp(g, 0, 255) / 255);
      B = srgbToLinear(clamp(b, 0, 255) / 255);
    }
    var X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / Xn;
    var Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) / Yn;
    var Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / Zn;
    var fx = f_(X), fy = f_(Y), fz = f_(Z);
    out[0] = 116 * fy - 16;
    out[1] = 500 * (fx - fy);
    out[2] = 200 * (fy - fz);
    return out;
  };

  /* ---------- Lab → RGB ---------- */
  C.labToRgb = function (L, a, bb, out) {
    out = out || new Array(3);
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
    function inv(t) { var t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAP; }
    var X = inv(fx) * Xn;
    var Y = (L > KAP * EPS ? Math.pow((L + 16) / 116, 3) : L / KAP) * Yn;
    var Z = inv(fz) * Zn;
    var R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
    var G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
    var B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    out[0] = clamp(linearToSrgb(R) * 255, 0, 255);
    out[1] = clamp(linearToSrgb(G) * 255, 0, 255);
    out[2] = clamp(linearToSrgb(B) * 255, 0, 255);
    return out;
  };

  /* ---------- 色差 ---------- */
  // CIE76 平方距离（最快，用于逐像素匹配）
  C.deltaE76sq = function (l1, a1, b1, l2, a2, b2) {
    var dl = l1 - l2, da = a1 - a2, db = b1 - b2;
    return dl * dl + da * da + db * db;
  };

  // CIEDE2000（精确，用于少量的调色板匹配）
  C.deltaE2000 = function (L1, a1, b1, L2, a2, b2) {
    var kL = 1, kC = 1, kH = 1;
    var C1 = Math.sqrt(a1 * a1 + b1 * b1);
    var C2 = Math.sqrt(a2 * a2 + b2 * b2);
    var Cb = (C1 + C2) / 2;
    var Cb7 = Math.pow(Cb, 7);
    var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625))); // 25^7
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1);
    var C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = (b1 === 0 && a1p === 0) ? 0 : Math.atan2(b1, a1p);
    var h2p = (b2 === 0 && a2p === 0) ? 0 : Math.atan2(b2, a2p);
    if (h1p < 0) h1p += 2 * Math.PI;
    if (h2p < 0) h2p += 2 * Math.PI;

    var dLp = L2 - L1;
    var dCp = C2p - C1p;
    var dhp;
    if (C1p * C2p === 0) dhp = 0;
    else {
      dhp = h2p - h1p;
      if (dhp > Math.PI) dhp -= 2 * Math.PI;
      else if (dhp < -Math.PI) dhp += 2 * Math.PI;
    }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2);

    var Lbp = (L1 + L2) / 2;
    var Cbp = (C1p + C2p) / 2;
    var hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else {
      var dh = Math.abs(h1p - h2p);
      if (dh <= Math.PI) hbp = (h1p + h2p) / 2;
      else if (h1p + h2p < 2 * Math.PI) hbp = (h1p + h2p + 2 * Math.PI) / 2;
      else hbp = (h1p + h2p - 2 * Math.PI) / 2;
    }
    var T = 1 - 0.17 * Math.cos(hbp - Math.PI / 6)
              + 0.24 * Math.cos(2 * hbp)
              + 0.32 * Math.cos(3 * hbp + Math.PI / 30)
              - 0.20 * Math.cos(4 * hbp - 63 * Math.PI / 180);
    var dTheta = (30 * Math.PI / 180) * Math.exp(-Math.pow((hbp * 180 / Math.PI - 275) / 25, 2));
    var Cbp7 = Math.pow(Cbp, 7);
    var Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
    var Lbp50 = (Lbp - 50) * (Lbp - 50);
    var Sl = 1 + (0.015 * Lbp50) / Math.sqrt(20 + Lbp50);
    var Sc = 1 + 0.045 * Cbp;
    var Sh = 1 + 0.015 * Cbp * T;
    var Rt = -Math.sin(2 * dTheta) * Rc;

    var tL = dLp / (kL * Sl), tC = dCp / (kC * Sc), tH = dHp / (kH * Sh);
    return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
  };

  /* ---------- 亮度 / 文字对比色 ---------- */
  C.relLuminance = function (r, g, b) {
    return 0.2126 * LIN[Math.round(clamp(r, 0, 255))] +
           0.7152 * LIN[Math.round(clamp(g, 0, 255))] +
           0.0722 * LIN[Math.round(clamp(b, 0, 255))];
  };

  // 在给定底色上返回可读性最好的文字颜色
  C.textOn = function (r, g, b) {
    var L = C.relLuminance(r, g, b);
    var cWhite = 1.05 / (L + 0.05);
    var cBlack = (L + 0.05) / 0.05;
    return cWhite >= cBlack ? '#ffffff' : '#000000';
  };

  /* ---------- HSL（仅用于排序/饱和度调整） ---------- */
  C.rgbToHsl = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2, d = max - min;
    if (d > 1e-9) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  };

  PD.color = C;
})(typeof window !== 'undefined' ? window : this);
