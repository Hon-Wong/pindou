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

  /* ---- MARD 咪嘟 标准 221 色 ----
   * 色号与色系结构来自公开的 MARD 官方色卡（A/B/C/D/E/F/G/H/M 九系，
   * 各系 26/32/29/26/24/25/21/23/15 色，合计 221），已用两个独立来源交叉核对。
   * HEX 为实物色卡的取样近似值：不同来源之间有几个单位的差异，
   * 不同批次的实物也会有色差，仅用于配色计算。
   */
  var MARD_SERIES = {
    A: '黄橙', B: '绿', C: '蓝青', D: '蓝紫', E: '粉玫',
    F: '红', G: '棕肤', H: '黑白', M: '大地'
  };
  var MARD = [
    // A 系 · 黄橙系（26 色）
    ['A1','#FAF4C8'], ['A2','#FFFFD5'], ['A3','#FEFF8B'], ['A4','#FBED56'], ['A5','#F4D738'], ['A6','#FEAC4C'],
    ['A7','#FE8B4C'], ['A8','#FFDA45'], ['A9','#FF995B'], ['A10','#F77C31'], ['A11','#FFDD99'], ['A12','#FE9F72'],
    ['A13','#FFC365'], ['A14','#FD543D'], ['A15','#FFF365'], ['A16','#FFFF9F'], ['A17','#FFE36E'], ['A18','#FEBE7D'],
    ['A19','#FD7C72'], ['A20','#FFD568'], ['A21','#FFE395'], ['A22','#F4F57D'], ['A23','#E6C9B7'], ['A24','#F7F8A2'],
    ['A25','#FFD67D'], ['A26','#FFC830'],
    // B 系 · 绿系（32 色）
    ['B1','#E6EE31'], ['B2','#63F347'], ['B3','#9EF780'], ['B4','#5DE035'], ['B5','#35E352'], ['B6','#65E2A6'],
    ['B7','#3DAF80'], ['B8','#1C9C4F'], ['B9','#27523A'], ['B10','#95D3C2'], ['B11','#5D722A'], ['B12','#166F41'],
    ['B13','#CAEB7B'], ['B14','#ADE946'], ['B15','#2E5132'], ['B16','#C5ED9C'], ['B17','#9BB13A'], ['B18','#E6EE49'],
    ['B19','#24B88C'], ['B20','#C2F0CC'], ['B21','#156A6B'], ['B22','#0B3C43'], ['B23','#303A21'], ['B24','#EEFCA5'],
    ['B25','#4E846D'], ['B26','#8D7A35'], ['B27','#CCE1AF'], ['B28','#9EE5B9'], ['B29','#C5E254'], ['B30','#E2FCB1'],
    ['B31','#B0E792'], ['B32','#9CAB5A'],
    // C 系 · 蓝青系（29 色）
    ['C1','#E8FFE7'], ['C2','#A9F9FC'], ['C3','#A0E2FB'], ['C4','#41CCFF'], ['C5','#01ACEB'], ['C6','#50AAF0'],
    ['C7','#3677D2'], ['C8','#0F54C0'], ['C9','#324BCA'], ['C10','#3EBCE2'], ['C11','#28DDDE'], ['C12','#1C334D'],
    ['C13','#CDE8FF'], ['C14','#D5FDFF'], ['C15','#22C4C6'], ['C16','#1557A8'], ['C17','#04D1F6'], ['C18','#1D3344'],
    ['C19','#1887A2'], ['C20','#176DAF'], ['C21','#BEDDFF'], ['C22','#67B4BE'], ['C23','#C8E2FF'], ['C24','#7CC4FF'],
    ['C25','#A9E5E5'], ['C26','#3CAED8'], ['C27','#D3DFFA'], ['C28','#BBCFED'], ['C29','#34488E'],
    // D 系 · 蓝紫系（26 色）
    ['D1','#AEB4F2'], ['D2','#858EDD'], ['D3','#2F54AF'], ['D4','#182A84'], ['D5','#B843C5'], ['D6','#AC7BDE'],
    ['D7','#8854B3'], ['D8','#E2D3FF'], ['D9','#D5B9F8'], ['D10','#361851'], ['D11','#B9BAE1'], ['D12','#DE9AD4'],
    ['D13','#B90095'], ['D14','#8B279B'], ['D15','#2F1F90'], ['D16','#E3E1EE'], ['D17','#C4D4F6'], ['D18','#A45EC7'],
    ['D19','#D8C3D7'], ['D20','#9C32B2'], ['D21','#9A009B'], ['D22','#333A95'], ['D23','#EBDAFC'], ['D24','#7786E5'],
    ['D25','#494FC7'], ['D26','#DFC2F8'],
    // E 系 · 粉玫系（24 色）
    ['E1','#FDD3CC'], ['E2','#FEC0DF'], ['E3','#FFB7E7'], ['E4','#E8649E'], ['E5','#F551A2'], ['E6','#F13D74'],
    ['E7','#C63478'], ['E8','#FFDBE9'], ['E9','#E970CC'], ['E10','#D33793'], ['E11','#FCDDD2'], ['E12','#F78FC3'],
    ['E13','#B5006D'], ['E14','#FFD1BA'], ['E15','#F8C7C9'], ['E16','#FFF3EB'], ['E17','#FFE2EA'], ['E18','#FFC7DB'],
    ['E19','#FEBAD5'], ['E20','#D8C7D1'], ['E21','#BD9DA1'], ['E22','#B785A1'], ['E23','#937A8D'], ['E24','#E1BCE8'],
    // F 系 · 红系（25 色）
    ['F1','#FD957B'], ['F2','#FC3D46'], ['F3','#F74941'], ['F4','#FC283C'], ['F5','#E7002F'], ['F6','#943630'],
    ['F7','#971937'], ['F8','#BC0028'], ['F9','#E2677A'], ['F10','#8A4526'], ['F11','#5A2121'], ['F12','#FD4E6A'],
    ['F13','#F35744'], ['F14','#FFA9AD'], ['F15','#D30022'], ['F16','#FEC2A6'], ['F17','#E69C79'], ['F18','#D37C46'],
    ['F19','#C1444A'], ['F20','#CD9391'], ['F21','#F7B4C6'], ['F22','#FDC0D0'], ['F23','#F67E66'], ['F24','#E698AA'],
    ['F25','#E54B4F'],
    // G 系 · 棕肤系（21 色）
    ['G1','#FFE2CE'], ['G2','#FFC4AA'], ['G3','#F4C3A5'], ['G4','#E1B383'], ['G5','#EDB045'], ['G6','#E99C17'],
    ['G7','#9D5B3E'], ['G8','#753832'], ['G9','#E6B483'], ['G10','#D98C39'], ['G11','#E0C593'], ['G12','#FFC890'],
    ['G13','#B7714A'], ['G14','#8D614C'], ['G15','#FCF9E0'], ['G16','#F2D9BA'], ['G17','#78524B'], ['G18','#FFE4CC'],
    ['G19','#E07935'], ['G20','#A94023'], ['G21','#B88558'],
    // H 系 · 黑白系（23 色）
    ['H1','#FDFBFF'], ['H2','#FEFFFF'], ['H3','#B6B1BA'], ['H4','#89858C'], ['H5','#48464E'], ['H6','#2F2B2F'],
    ['H7','#000000'], ['H8','#E7D6DB'], ['H9','#EDEDED'], ['H10','#EEE9EA'], ['H11','#CECDD5'], ['H12','#FFF5ED'],
    ['H13','#F5ECD2'], ['H14','#CFD7D3'], ['H15','#98A6A8'], ['H16','#1D1414'], ['H17','#F1EDED'], ['H18','#FFFDF0'],
    ['H19','#F6EFE2'], ['H20','#949FA3'], ['H21','#FFFBE1'], ['H22','#CACAD4'], ['H23','#9A9D94'],
    // M 系 · 大地系（15 色）
    ['M1','#BCC6B8'], ['M2','#8AA386'], ['M3','#697D80'], ['M4','#E3D2BC'], ['M5','#D0CCAA'], ['M6','#B0A782'],
    ['M7','#B4A497'], ['M8','#B38281'], ['M9','#A58767'], ['M10','#C5B2BC'], ['M11','#9F7594'], ['M12','#644749'],
    ['M13','#D19066'], ['M14','#C77362'], ['M15','#757D78']
  ].map(function (e) {
    return [e[0], MARD_SERIES[e[0][0]] + '系', e[1]];
  });

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
    mard221: { id: 'mard221', name: 'MARD 咪嘟 标准 221 色', colors: build(MARD) },
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

    /* ---------- 自定义色卡（可存多张） ---------- */

    /** 保存一张自定义色卡；不给 id 就新建，给了就覆盖 */
    saveCustom: function (name, rows, id) {
      if (!id) {
        var n = 1;
        while (PALETTES['custom' + n]) n++;
        id = 'custom' + n;
      }
      PALETTES[id] = { id: id, name: (name || '我的色卡').slice(0, 40), colors: build(rows), custom: true };
      return PALETTES[id];
    },

    removeCustom: function (id) {
      if (PALETTES[id] && PALETTES[id].custom) { delete PALETTES[id]; return true; }
      return false;
    },

    customList: function () {
      return Object.keys(PALETTES).filter(function (k) { return PALETTES[k].custom; })
        .map(function (k) { return PALETTES[k]; });
    },

    isCustom: function (id) { return !!(PALETTES[id] && PALETTES[id].custom); },

    /**
     * 宽松解析色卡文本 → [[code,name,hex], ...]
     * 兼容逗号/制表符/分号/多空格分隔，HEX 带不带 # 都行，
     * 也兼容「色号 名称 色值」和「色号 色值」两列的写法。
     */
    parseCSV: function (text) {
      var out = [], seen = {};
      String(text || '').split(/\r?\n/).forEach(function (line) {
        line = line.replace(/^﻿/, '').trim();
        if (!line) return;
        if (/^(#|\/\/)/.test(line) && !/#[0-9a-fA-F]{6}\b/.test(line)) return;   // 注释行
        // 先按常见分隔符切；只有一列时再退回按空白切
        var parts = line.split(/[,\t;|]/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (parts.length < 2) parts = line.split(/\s{1,}/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (parts.length < 2) return;

        // HEX 取最后一个能解析成颜色的字段，其余按 [色号, 名称...] 处理
        var hexIdx = -1;
        for (var i = parts.length - 1; i >= 0; i--) {
          if (PD.color.hexToRgb(parts[i])) { hexIdx = i; break; }
        }
        if (hexIdx <= 0) return;
        var hex = parts[hexIdx];
        var code = parts[0];
        var name = parts.slice(1, hexIdx).join(' ').trim() || code;
        if (!code || seen[code]) return;      // 色号必须唯一
        seen[code] = 1;
        out.push([code, name, hex]);
      });
      return out;
    },

    /** 模板 CSV，给用户照着填自己的色卡 */
    templateCSV: function () {
      return [
        '# 拼豆色卡模板 —— 每行一个颜色：色号,名称,色值',
        '# 色值支持 #RRGGBB 或 RRGGBB；分隔符逗号/制表符/空格都行',
        '# 以 # 开头的是注释行，会被忽略',
        'A1,纯白,#FFFFFF',
        'A9,黑色,#1A1A1A',
        'B4,中黄,#FFD400',
        'D6,大红,#E8262B',
        'F5,中蓝,#1E76BC',
        'G4,中绿,#46A749'
      ].join('\n');
    },

    toCSV: function (colors) {
      return colors.map(function (c) { return c.code + ',' + c.name + ',' + c.hex; }).join('\n');
    }
  };
})(typeof window !== 'undefined' ? window : this);
