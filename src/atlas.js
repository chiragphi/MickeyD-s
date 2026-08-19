/* Procedural texture atlas — 1024x1024, an 8x8 grid of 128px tiles, painted onto a
   canvas at boot in a few milliseconds. Zero network requests, zero decode cost, and
   one texture for the entire game so the world stays a single draw call.

   The palette is deliberately loud: saturated diner red, warm yellow, clean white and
   bright chrome. Flat, high-contrast tiles read far better on low-end hardware than
   noisy "realistic" ones, and they hold up at any distance. */
(function (g) {
  'use strict';

  const SIZE = 1024, GRID = 8, TILE = 128, PAD = 7;

  const T = {
    BLANK: 0, TERRAZZO: 1, WOOD: 2, PANEL: 3, CHROME: 4, MENU: 5, LOGO: 6, CEIL: 7,
    TILEWALL: 8, PACK: 9, PUFF: 10, GLASS: 11, ASPHALT: 12, STRIPE: 13, SODA: 14, SHADOW: 15,
    CHECKER: 16, GRASS: 17, LEAF: 18, BRICK: 19, SIGN: 20, QUARRY: 21, CONCRETE: 22, AWNING: 23,
    CHECKER_BIG: 24, DOTS: 25, STUCCO: 26, TRUNK: 27, DECK: 28, NEON: 29, ROOF: 30, CURB: 31,
    SIGN_NAME: 32, SIGN_DRIVE: 33, SIGN_OPEN: 34, SIGN_MENU: 35,
    CHECKER_BW: 36, TERRAZZO_RED: 37, PANEL_RED: 38, MARBLE: 39,
  };

  /* Palette — every tile pulls from here so the whole world stays in one key. */
  const P = {
    red: '#e01b22', redDark: '#b3141a', redLite: '#f2464b',
    yellow: '#ffc72c', yellowDark: '#e0a413',
    white: '#ffffff', cream: '#f6f1e6', bone: '#e8e2d4',
    chrome: '#dfe6ec', chromeDark: '#a8b4be',
    ink: '#1b1f26', slate: '#39414d',
    green: '#4caf3f', greenDark: '#357c2c', greenLite: '#77d05f',
    wood: '#c08a4e', woodDark: '#8a5c2e',
  };

  function rect(id) {
    const cx = (id % GRID) * TILE, cy = ((id / GRID) | 0) * TILE;
    return [(cx + PAD) / SIZE, (cy + PAD) / SIZE, (TILE - PAD * 2) / SIZE, (TILE - PAD * 2) / SIZE];
  }

  function speckle(o, s, colors, n, size, alpha) {
    o.globalAlpha = alpha === undefined ? 0.5 : alpha;
    for (let i = 0; i < n; i++) {
      o.fillStyle = colors[i % colors.length];
      const w = size * (0.6 + Math.random() * 0.9);
      o.fillRect(Math.random() * s, Math.random() * s, w, w);
    }
    o.globalAlpha = 1;
  }

  function build(targetSize) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const x = c.getContext('2d', { alpha: true, willReadFrequently: false });

    const cell = (id, fn) => {
      const cx = (id % GRID) * TILE, cy = ((id / GRID) | 0) * TILE;
      x.save();
      x.beginPath(); x.rect(cx, cy, TILE, TILE); x.clip();
      x.translate(cx, cy);
      fn(x, TILE);
      x.restore();
    };
    const fill = (o, s, col) => { o.fillStyle = col; o.fillRect(0, 0, s, s); };

    /* 0 — flat white, the workhorse for vertex-tinted solids */
    cell(T.BLANK, (o, s) => fill(o, s, P.white));

    /* 1 — cream terrazzo, the dining room floor */
    cell(T.TERRAZZO, (o, s) => {
      fill(o, s, P.cream);
      speckle(o, s, ['#c8beac', '#ffffff', '#d8b48c', '#a8a094', P.red], 240, 3, 0.42);
      o.strokeStyle = 'rgba(160,150,132,.55)'; o.lineWidth = 2.5;
      o.strokeRect(1.25, 1.25, s - 2.5, s - 2.5);
    });

    /* 2 — warm oak for table tops and deck furniture */
    cell(T.WOOD, (o, s) => {
      fill(o, s, P.wood);
      for (let i = 0; i < 26; i++) {
        o.strokeStyle = `rgba(120,78,36,${0.10 + Math.random() * 0.20})`;
        o.lineWidth = 1 + Math.random() * 2.6;
        const y = Math.random() * s;
        o.beginPath(); o.moveTo(0, y);
        o.bezierCurveTo(s * 0.35, y + (Math.random() - 0.5) * 7, s * 0.7, y + (Math.random() - 0.5) * 7, s, y + (Math.random() - 0.5) * 4);
        o.stroke();
      }
    });

    /* 3 — clean painted wall panel */
    cell(T.PANEL, (o, s) => {
      const gr = o.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, P.white); gr.addColorStop(1, '#eceef0');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
    });

    /* 4 — bright chrome, the trim language of the whole build */
    cell(T.CHROME, (o, s) => {
      const gr = o.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.34, P.chrome);
      gr.addColorStop(0.52, '#93a2ae'); gr.addColorStop(0.7, P.chrome); gr.addColorStop(1, '#ffffff');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        o.strokeStyle = `rgba(255,255,255,${Math.random() * 0.4})`;
        o.lineWidth = Math.random() * 1.6;
        const px = Math.random() * s;
        o.beginPath(); o.moveTo(px, 0); o.lineTo(px, s); o.stroke();
      }
    });

    /* 5 — backlit menu board */
    cell(T.MENU, (o, s) => {
      fill(o, s, '#15181e');
      const rows = [[P.yellow, 0.30], ['#ffffff', 0.23], ['#ffffff', 0.23], [P.red, 0.24]];
      let yy = 5;
      rows.forEach(([col, h], i) => {
        const hh = s * h - 7;
        o.fillStyle = 'rgba(255,255,255,.05)'; o.fillRect(5, yy, s - 10, hh);
        o.fillStyle = col;
        o.fillRect(9, yy + 4, (s - 18) * (0.34 + (i * 0.19) % 0.5), Math.max(5, hh * 0.30));
        o.globalAlpha = 0.5; o.fillStyle = '#b9cbdd';
        for (let k = 0; k < 3; k++) o.fillRect(9, yy + hh * 0.52 + k * 7, (s - 22) * (0.28 + Math.random() * 0.58), 3);
        o.globalAlpha = 1;
        yy += hh + 7;
      });
    });

    /* 6 — golden arches on red */
    cell(T.LOGO, (o, s) => {
      fill(o, s, P.red);
      o.strokeStyle = P.yellow; o.lineWidth = s * 0.155; o.lineCap = 'round';
      o.beginPath();
      o.moveTo(s * 0.2, s * 0.79);
      o.bezierCurveTo(s * 0.2, s * 0.21, s * 0.5, s * 0.21, s * 0.5, s * 0.79);
      o.bezierCurveTo(s * 0.5, s * 0.21, s * 0.8, s * 0.21, s * 0.8, s * 0.79);
      o.stroke();
    });

    /* 7 — ceiling panel with a crisp grid line */
    cell(T.CEIL, (o, s) => {
      fill(o, s, '#fbfcfd');
      o.strokeStyle = '#c4ccd4'; o.lineWidth = 5;
      o.strokeRect(2.5, 2.5, s - 5, s - 5);
      o.strokeStyle = 'rgba(255,255,255,.9)'; o.lineWidth = 2;
      o.strokeRect(7, 7, s - 14, s - 14);
    });

    /* 8 — glossy white subway tile for the kitchen walls */
    cell(T.TILEWALL, (o, s) => {
      fill(o, s, '#c9d3da');
      const n = 4, t = s / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        const gr = o.createLinearGradient(0, iy * t, 0, iy * t + t);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e4eaee');
        o.fillStyle = gr;
        o.fillRect(ix * t + 1.5, iy * t + 1.5, t - 3, t - 3);
      }
    });

    /* 9 — fries carton */
    cell(T.PACK, (o, s) => {
      fill(o, s, P.red);
      o.fillStyle = P.yellow; o.fillRect(0, s * 0.56, s, s * 0.44);
      o.fillStyle = 'rgba(255,255,255,.9)'; o.fillRect(s * 0.16, s * 0.18, s * 0.68, s * 0.12);
      o.strokeStyle = 'rgba(0,0,0,.12)'; o.lineWidth = 3; o.strokeRect(1.5, 1.5, s - 3, s - 3);
    });

    /* 10 — soft alpha puff for steam and smoke */
    cell(T.PUFF, (o, s) => {
      o.clearRect(0, 0, s, s);
      const gr = o.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2 - PAD);
      gr.addColorStop(0, 'rgba(255,255,255,.95)');
      gr.addColorStop(0.45, 'rgba(255,255,255,.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
    });

    /* 11 — window glass */
    cell(T.GLASS, (o, s) => {
      o.clearRect(0, 0, s, s);
      const gr = o.createLinearGradient(0, 0, s, s);
      gr.addColorStop(0, 'rgba(198,232,255,.32)');
      gr.addColorStop(0.45, 'rgba(255,255,255,.14)');
      gr.addColorStop(1, 'rgba(172,214,245,.28)');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
      o.strokeStyle = 'rgba(255,255,255,.55)'; o.lineWidth = 6;
      o.beginPath(); o.moveTo(s * 0.08, s); o.lineTo(s * 0.55, 0); o.stroke();
      o.lineWidth = 3;
      o.beginPath(); o.moveTo(s * 0.42, s); o.lineTo(s * 0.86, 0); o.stroke();
    });

    /* 12 — car park asphalt */
    cell(T.ASPHALT, (o, s) => {
      fill(o, s, '#4a5058');
      speckle(o, s, ['#3a4048', '#5c636c', '#2f353c'], 300, 3, 0.5);
    });

    /* 13 — painted bay line on asphalt */
    cell(T.STRIPE, (o, s) => {
      fill(o, s, '#4a5058');
      speckle(o, s, ['#3a4048', '#5c636c'], 120, 3, 0.4);
      o.fillStyle = '#f2ead2'; o.fillRect(s * 0.42, 0, s * 0.16, s);
    });

    /* 14 — beverage dispenser fascia */
    cell(T.SODA, (o, s) => {
      fill(o, s, '#1c2027');
      const cols = [P.red, '#f0a52a', '#3f86e0', '#3aa85e'];
      for (let i = 0; i < 4; i++) {
        o.fillStyle = cols[i];
        o.fillRect(6 + i * (s - 12) / 4, 8, (s - 12) / 4 - 5, s * 0.44);
        o.fillStyle = 'rgba(255,255,255,.22)';
        o.fillRect(6 + i * (s - 12) / 4, 8, (s - 12) / 4 - 5, s * 0.13);
      }
      o.fillStyle = P.chromeDark; o.fillRect(6, s * 0.62, s - 12, s * 0.07);
    });

    /* 15 — radial falloff used as a multiply decal for contact shadows */
    cell(T.SHADOW, (o, s) => {
      fill(o, s, P.white);
      const gr = o.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2 - PAD);
      gr.addColorStop(0, 'rgba(52,46,40,.72)');
      gr.addColorStop(0.55, 'rgba(88,80,72,.30)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
    });

    /* 16 — the signature red/white check, 4x4 per tile */
    cell(T.CHECKER, (o, s) => {
      const n = 4, t = s / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        o.fillStyle = ((ix + iy) & 1) ? P.red : P.white;
        o.fillRect(ix * t, iy * t, t + 0.5, t + 0.5);
      }
    });

    /* 24 — the same check at 2x2, for larger surfaces */
    cell(T.CHECKER_BIG, (o, s) => {
      const n = 2, t = s / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        o.fillStyle = ((ix + iy) & 1) ? P.red : P.white;
        o.fillRect(ix * t, iy * t, t + 0.5, t + 0.5);
      }
    });

    /* 17 — stylised lawn */
    cell(T.GRASS, (o, s) => {
      fill(o, s, P.green);
      speckle(o, s, ['#5cba48', '#43a038', '#66c352'], 260, 4, 0.30);
    });

    /* 18 — foliage, lighter on top so canopies catch the light */
    cell(T.LEAF, (o, s) => {
      fill(o, s, P.greenDark);
      speckle(o, s, [P.green, P.greenLite, '#2c6b24'], 200, 7, 0.7);
    });

    /* 19 — red brick with pale mortar */
    cell(T.BRICK, (o, s) => {
      fill(o, s, '#d9d2c4');
      const rows = 4, h = s / rows;
      for (let r = 0; r < rows; r++) {
        const off = (r & 1) ? -s / 8 : 0;
        for (let i = -1; i < 4; i++) {
          o.fillStyle = ['#b8352c', '#a82e26', '#c44036', '#9e2a22'][(r + i + 8) % 4];
          o.fillRect(off + i * (s / 4) + 2, r * h + 2, s / 4 - 4, h - 4);
        }
      }
    });

    /* 20 — blank sign face with a red border and a chrome inner line */
    cell(T.SIGN, (o, s) => {
      fill(o, s, P.white);
      o.strokeStyle = P.red; o.lineWidth = 12; o.strokeRect(6, 6, s - 12, s - 12);
      o.strokeStyle = P.yellow; o.lineWidth = 4; o.strokeRect(15, 15, s - 30, s - 30);
    });

    /* 21 — red quarry tile, the classic commercial kitchen floor */
    cell(T.QUARRY, (o, s) => {
      fill(o, s, '#8f8378');
      const n = 3, t = s / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        o.fillStyle = ['#b5726a', '#a96a62', '#bd7d74'][(ix + iy) % 3];
        o.fillRect(ix * t + 2.5, iy * t + 2.5, t - 5, t - 5);
      }
      speckle(o, s, ['#9c625b', '#c98d84'], 90, 3, 0.35);
    });

    /* 22 — pale sidewalk concrete */
    cell(T.CONCRETE, (o, s) => {
      fill(o, s, '#cfcabf');
      speckle(o, s, ['#bdb8ad', '#e0dbd1'], 160, 3, 0.45);
      o.strokeStyle = 'rgba(150,145,136,.6)'; o.lineWidth = 3;
      o.strokeRect(1.5, 1.5, s - 3, s - 3);
    });

    /* 23 — red/white awning stripe for umbrellas and canopies */
    cell(T.AWNING, (o, s) => {
      fill(o, s, P.white);
      o.fillStyle = P.red;
      o.fillRect(0, 0, s * 0.5, s);
    });

    /* 25 — perforated chrome, for stools and railing detail */
    cell(T.DOTS, (o, s) => {
      fill(o, s, P.chrome);
      o.fillStyle = 'rgba(120,132,144,.55)';
      for (let iy = 0; iy < 6; iy++) for (let ix = 0; ix < 6; ix++) {
        o.beginPath(); o.arc((ix + 0.5) * s / 6, (iy + 0.5) * s / 6, s * 0.035, 0, 6.284); o.fill();
      }
    });

    /* 26 — cream stucco for the outside walls */
    cell(T.STUCCO, (o, s) => {
      fill(o, s, P.bone);
      speckle(o, s, ['#d8d1c2', '#f2ede1'], 260, 4, 0.4);
    });

    /* 27 — tree trunk bark */
    cell(T.TRUNK, (o, s) => {
      fill(o, s, '#7a5433');
      for (let i = 0; i < 14; i++) {
        o.fillStyle = `rgba(${50 + Math.random() * 30},${34 + Math.random() * 20},${18},${0.3})`;
        o.fillRect(Math.random() * s, 0, 2 + Math.random() * 5, s);
      }
    });

    /* 28 — patio decking boards */
    cell(T.DECK, (o, s) => {
      fill(o, s, '#c9a06a');
      for (let i = 0; i < 4; i++) {
        o.fillStyle = ['#c49a63', '#d3ab74', '#bd9159', '#cda36c'][i];
        o.fillRect(0, i * s / 4 + 1.5, s, s / 4 - 3);
      }
    });

    /* 29 — warm glowing strip for signage edges */
    cell(T.NEON, (o, s) => {
      const gr = o.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#fff6d6'); gr.addColorStop(0.5, '#ffd45e'); gr.addColorStop(1, '#fff6d6');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
    });

    /* 30 — standing-seam metal roof */
    cell(T.ROOF, (o, s) => {
      fill(o, s, P.red);
      o.fillStyle = 'rgba(0,0,0,.16)';
      for (let i = 0; i < 4; i++) o.fillRect(i * s / 4, 0, 4, s);
      o.fillStyle = 'rgba(255,255,255,.20)';
      for (let i = 0; i < 4; i++) o.fillRect(i * s / 4 + 5, 0, 3, s);
    });

    /* 31 — painted kerb */
    cell(T.CURB, (o, s) => {
      fill(o, s, '#d9d4c8');
      o.fillStyle = P.yellow; o.fillRect(0, s * 0.34, s, s * 0.32);
      speckle(o, s, ['#c6c1b5'], 60, 3, 0.3);
    });

    /* 36 — the diner checkerboard, 2x2 so the squares stay big and chunky */
    cell(T.CHECKER_BW, (o, s) => {
      const n = 2, t = s / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        o.fillStyle = ((ix + iy) & 1) ? '#22242a' : '#f7f5f0';
        o.fillRect(ix * t, iy * t, t + 0.5, t + 0.5);
      }
      o.globalAlpha = 0.10;
      for (let i = 0; i < 60; i++) {
        o.fillStyle = i & 1 ? '#000' : '#fff';
        o.fillRect(Math.random() * s, Math.random() * s, 3, 3);
      }
      o.globalAlpha = 1;
    });

    /* 37 — red speckled terrazzo for floor borders */
    cell(T.TERRAZZO_RED, (o, s) => {
      fill(o, s, '#b8232a');
      speckle(o, s, ['#8e161c', '#d94b50', '#ffffff', '#f0c0c2'], 200, 3, 0.35);
    });

    /* 38 — deep red wall panel with a subtle sheen */
    cell(T.PANEL_RED, (o, s) => {
      const gr = o.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#e8262d'); gr.addColorStop(1, '#c0161c');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
    });

    /* 39 — pale marble for counter tops */
    cell(T.MARBLE, (o, s) => {
      fill(o, s, '#f2efe9');
      for (let i = 0; i < 12; i++) {
        o.strokeStyle = `rgba(150,146,138,${0.10 + Math.random() * 0.16})`;
        o.lineWidth = 0.8 + Math.random() * 2;
        o.beginPath();
        const y = Math.random() * s;
        o.moveTo(0, y);
        o.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 30, s * 0.7, y + (Math.random() - 0.5) * 30, s, y + (Math.random() - 0.5) * 18);
        o.stroke();
      }
      speckle(o, s, ['#e2ded4', '#ffffff'], 90, 3, 0.3);
    });

    /* ---- lettered signs ----
       A square tile stretched across a wide board squashes its artwork, so the text
       is drawn pre-narrowed by the board's aspect and comes out correctly proportioned
       once applied. */
    const lettered = (id, text, opt) => cell(id, (o, s) => {
      const O = opt || {};
      fill(o, s, O.bg || P.white);
      if (O.border !== false) {
        o.strokeStyle = O.borderCol || P.red; o.lineWidth = 11;
        o.strokeRect(5.5, 5.5, s - 11, s - 11);
      }
      o.save();
      o.translate(s / 2, s / 2);
      o.scale(1 / (O.aspect || 4), 1);
      o.textAlign = 'center'; o.textBaseline = 'middle';
      o.font = `900 ${O.size || 68}px Impact, "Haettenschweiler", "Arial Black", system-ui, sans-serif`;
      if (O.shadow !== false) {
        o.fillStyle = 'rgba(0,0,0,.22)';
        o.fillText(text, 10, 7);
      }
      o.fillStyle = O.fg || P.red;
      o.fillText(text, 0, 2);
      if (O.outline) { o.lineWidth = 5; o.strokeStyle = O.outline; o.strokeText(text, 0, 2); }
      o.restore();
    });

    lettered(T.SIGN_NAME,  'GOLDEN SHIFT', { aspect: 4.6, size: 74, fg: P.red, outline: P.yellow });
    lettered(T.SIGN_DRIVE, 'DRIVE THRU',   { aspect: 3.4, size: 62, bg: P.red, fg: P.white, borderCol: P.yellow });
    lettered(T.SIGN_OPEN,  'OPEN 24 HRS',  { aspect: 3.2, size: 54, bg: P.ink, fg: P.yellow, borderCol: P.yellow });
    lettered(T.SIGN_MENU,  'ORDER HERE',   { aspect: 3.0, size: 56, bg: P.yellow, fg: P.ink, borderCol: P.red });

    /* UVs are normalised, so a smaller atlas needs no other change. */
    if (targetSize && targetSize < SIZE) {
      const small = document.createElement('canvas');
      small.width = small.height = targetSize;
      small.getContext('2d').drawImage(c, 0, 0, targetSize, targetSize);
      return small;
    }
    return c;
  }

  g.Atlas = { T, P, rect, build, SIZE };
})(window);
