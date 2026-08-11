/* ==========================================================
 * palettes.js — 拼豆色卡
 *
 * ⚠️ 说明：内置色卡的 HEX 为常见拼豆色卡的「近似色值」，
 *    用于配色计算与图纸标注。不同厂家、不同批次实物会有色差。
 *    如需完全对应你手上的实体色卡，请在「管理色卡」里粘贴自定义 CSV。
 * ========================================================== */
(function (global) {
  'use strict';

  var PD = global.PD || (global.PD = {});

  /* ---- Mard / 咪嘟 风格 拼豆色卡（字母+数字，90 色，近似值） ---- */
  var MARD = [
    // A 系 · 无彩色
    ['A1', '纯白', '#FFFFFF'], ['A2', '米白', '#F7F3E8'], ['A3', '象牙白', '#F2EAD3'],
    ['A4', '浅灰', '#D9D9D9'], ['A5', '银灰', '#B5B5B5'], ['A6', '中灰', '#8C8C8C'],
    ['A7', '深灰', '#5A5A5A'], ['A8', '铁灰', '#3B3F44'], ['A9', '黑色', '#1A1A1A'],
    ['A10', '纯黑', '#000000'],
    // B 系 · 黄
    ['B1', '淡黄', '#FFF9C4'], ['B2', '奶黄', '#FFF0A5'], ['B3', '柠檬黄', '#FFE95C'],
    ['B4', '中黄', '#FFD400'], ['B5', '金黄', '#FDBB2D'], ['B6', '橘黄', '#FFA61A'],
    ['B7', '芥末黄', '#D9A404'], ['B8', '土黄', '#C08A2E'], ['B9', '荧光黄', '#EAFF3D'],
    ['B10', '香槟', '#EFE0B0'],
    // C 系 · 橙 / 棕
    ['C1', '浅橙', '#FFD1A3'], ['C2', '蜜橙', '#FFB870'], ['C3', '橙色', '#FF8C1A'],
    ['C4', '深橙', '#F26A21'], ['C5', '砖橙', '#D9541E'], ['C6', '焦糖', '#A9601F'],
    ['C7', '咖啡', '#6E4426'], ['C8', '深咖', '#4A2E1E'], ['C9', '巧克力', '#3A2318'],
    ['C10', '浅棕', '#B98A5E'],
    // D 系 · 红 / 粉
    ['D1', '浅粉', '#FFE1E6'], ['D2', '樱花粉', '#FFC2CC'], ['D3', '桃粉', '#FF9DAE'],
    ['D4', '玫红', '#F2547D'], ['D5', '洋红', '#E5197B'], ['D6', '大红', '#E8262B'],
    ['D7', '正红', '#C81E27'], ['D8', '酒红', '#8E1B2E'], ['D9', '珊瑚', '#FF7361'],
    ['D10', '西瓜红', '#FF4B3E'], ['D11', '藕粉', '#E7B6BE'], ['D12', '荧光粉', '#FF4FA3'],
    // E 系 · 紫
    ['E1', '淡紫', '#E7DCF3'], ['E2', '薰衣草', '#C9B6E4'], ['E3', '浅紫', '#A98CD9'],
    ['E4', '紫色', '#8155C6'], ['E5', '深紫', '#5E3A9E'], ['E6', '葡萄紫', '#45256E'],
    ['E7', '藕荷', '#D7A9D6'], ['E8', '紫罗兰', '#9B3FA8'],
    // F 系 · 蓝
    ['F1', '淡蓝', '#DCEEFB'], ['F2', '天蓝', '#A9D8F5'], ['F3', '浅蓝', '#6EC1E4'],
    ['F4', '湖蓝', '#1FA3D8'], ['F5', '中蓝', '#1E76BC'], ['F6', '深蓝', '#17548E'],
    ['F7', '藏青', '#10305C'], ['F8', '宝蓝', '#2A3FA8'], ['F9', '青蓝', '#2FC1C9'],
    ['F10', '蒂芙尼', '#7FD8CF'], ['F11', '灰蓝', '#7A93A8'], ['F12', '午夜蓝', '#0B1B3A'],
    // G 系 · 绿
    ['G1', '淡绿', '#DFF3D8'], ['G2', '嫩绿', '#B7E39B'], ['G3', '草绿', '#7DC242'],
    ['G4', '中绿', '#46A749'], ['G5', '深绿', '#1E7A3C'], ['G6', '墨绿', '#14532B'],
    ['G7', '黄绿', '#C6DA3B'], ['G8', '荧光绿', '#66FF66'], ['G9', '薄荷绿', '#A8E6CF'],
    ['G10', '青绿', '#1FA085'], ['G11', '橄榄绿', '#6E7B3A'], ['G12', '森林绿', '#2B5D34'],
    // H 系 · 肤色 / 大地色
    ['H1', '象牙肤', '#FBE8D3'], ['H2', '浅肤', '#F6D5B8'], ['H3', '中肤', '#E9B48C'],
    ['H4', '深肤', '#C98A5E'], ['H5', '小麦', '#D9A87C'], ['H6', '米色', '#EAD9C0'],
    ['H7', '卡其', '#B7A17A'], ['H8', '沙色', '#DCC9A6'], ['H9', '驼色', '#A8794F'],
    ['H10', '棕褐', '#7A5233'],
    // S 系 · 特殊色
    ['S1', '珠光银', '#C0C4C8'], ['S2', '金色', '#D4AF37'], ['S3', '铜色', '#B87333'],
    ['S4', '透明白', '#F2F7F7'], ['S5', '夜光绿', '#C9F2C0'], ['S6', '荧光橙', '#FF7A00']
  ];

  /* ---- Hama 常用色（近似值，编号沿用 Hama 习惯并加 H 前缀） ---- */
  var HAMA = [
    ['H01', '白 White', '#FFFFFF'], ['H02', '奶油 Cream', '#FFF3D4'],
    ['H03', '黄 Yellow', '#FFD800'], ['H04', '橙 Orange', '#FF7F00'],
    ['H05', '红 Red', '#E4002B'], ['H06', '粉 Pink', '#F6A3C0'],
    ['H07', '紫 Purple', '#6B3FA0'], ['H08', '蓝 Blue', '#0057B8'],
    ['H09', '浅蓝 Light Blue', '#63C5DA'], ['H10', '绿 Green', '#00843D'],
    ['H11', '浅绿 Light Green', '#8DC63F'], ['H12', '棕 Brown', '#6B4423'],
    ['H13', '灰 Grey', '#808285'], ['H14', '黑 Black', '#1C1C1C'],
    ['H17', '青绿 Turquoise', '#00A3AD'], ['H18', '米色 Beige', '#E3C9A0'],
    ['H20', '浅棕 Light Brown', '#A9744F'], ['H21', '银灰 Silver Grey', '#C6C7C8'],
    ['H26', '淡黄 Pastel Yellow', '#FBEA9C'], ['H27', '淡蓝 Pastel Blue', '#A7C7E7'],
    ['H28', '淡绿 Pastel Green', '#B7E1A1'], ['H30', '深绿 Dark Green', '#14532B'],
    ['H31', '肤色 Flesh', '#F2C6A0'], ['H32', '淡紫 Pastel Lilac', '#C9B6E4'],
    ['H35', '深红 Burgundy', '#8E1B2E'], ['H38', '深蓝 Dark Blue', '#10305C'],
    ['H44', '亮粉 Neon Pink', '#FF4FA3'], ['H45', '亮绿 Neon Green', '#66FF66'],
    ['H46', '亮黄 Neon Yellow', '#EAFF3D'], ['H47', '亮橙 Neon Orange', '#FF7A00']
  ];

  /* ---- 基础 24 色（新手套装常见配色，通用编号） ---- */
  var BASIC = [
    ['N1', '白', '#FFFFFF'], ['N2', '浅灰', '#CCCCCC'], ['N3', '中灰', '#8C8C8C'],
    ['N4', '黑', '#1A1A1A'], ['N5', '奶黄', '#FFF0A5'], ['N6', '黄', '#FFD400'],
    ['N7', '金黄', '#FDBB2D'], ['N8', '橙', '#FF8C1A'], ['N9', '深橙', '#F26A21'],
    ['N10', '红', '#E8262B'], ['N11', '酒红', '#8E1B2E'], ['N12', '粉', '#FFC2CC'],
    ['N13', '玫红', '#F2547D'], ['N14', '浅紫', '#C9B6E4'], ['N15', '紫', '#8155C6'],
    ['N16', '深紫', '#5E3A9E'], ['N17', '天蓝', '#A9D8F5'], ['N18', '蓝', '#1E76BC'],
    ['N19', '深蓝', '#10305C'], ['N20', '青', '#2FC1C9'], ['N21', '浅绿', '#B7E39B'],
    ['N22', '绿', '#46A749'], ['N23', '深绿', '#14532B'], ['N24', '棕', '#6E4426']
  ];

  /* ---- 格子内可用的符号（黑白打印用） ---- */
  var SYMBOLS = (
    '●○◆◇■□▲△▼▽★☆✚✖◐◑◤◥◣◢♠♥♦♣☀☂⬤⬢⬡⯀' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    '0123456789' +
    'abcdefghijklmnopqrstuvwxyz'
  ).split('');

  /* ---------- 构建 ---------- */
  function build(list) {
    var C = PD.color;
    return list.map(function (e, i) {
      var rgb = C.hexToRgb(e[2]) || [0, 0, 0];
      var lab = C.rgbToLab(rgb[0], rgb[1], rgb[2], [0, 0, 0]);
      var m = /^([A-Za-z]+)/.exec(e[0]);
      return {
        idx: i,
        code: e[0],
        name: e[1],
        hex: C.rgbToHex(rgb[0], rgb[1], rgb[2]).toUpperCase(),
        rgb: rgb,
        lab: lab,
        series: m ? m[1].toUpperCase() : '#'
      };
    });
  }

  var PALETTES = {
    mard:  { id: 'mard',  name: 'Mard 咪嘟风格 90 色（近似）', colors: build(MARD) },
    hama:  { id: 'hama',  name: 'Hama 常用 30 色（近似）',      colors: build(HAMA) },
    basic: { id: 'basic', name: '基础 24 色套装',               colors: build(BASIC) }
  };

  PD.palettes = {
    all: PALETTES,
    symbols: SYMBOLS,
    build: build,

    list: function () {
      return Object.keys(PALETTES).map(function (k) { return PALETTES[k]; });
    },
    get: function (id) { return PALETTES[id] || PALETTES.mard; },

    /** 注册/覆盖自定义色卡 */
    setCustom: function (rows) {
      PALETTES.custom = { id: 'custom', name: '我的色卡（自定义）', colors: build(rows) };
      return PALETTES.custom;
    },
    hasCustom: function () { return !!PALETTES.custom; },

    /** CSV → [[code,name,hex], ...] */
    parseCSV: function (text) {
      var out = [], seen = {};
      String(text || '').split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line || /^#/.test(line)) return;
        var parts = line.split(/[,\t;]/).map(function (s) { return s.trim(); });
        var code, name, hex;
        if (parts.length >= 3) { code = parts[0]; name = parts[1]; hex = parts[2]; }
        else if (parts.length === 2) { code = parts[0]; name = parts[0]; hex = parts[1]; }
        else return;
        if (!PD.color.hexToRgb(hex)) return;
        if (!code || seen[code]) return;      // 色号必须唯一
        seen[code] = 1;
        out.push([code, name || code, hex]);
      });
      return out;
    },

    toCSV: function (colors) {
      return colors.map(function (c) { return c.code + ',' + c.name + ',' + c.hex; }).join('\n');
    }
  };
})(typeof window !== 'undefined' ? window : this);
