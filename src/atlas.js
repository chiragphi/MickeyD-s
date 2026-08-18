/* Procedural texture atlas — 512x512, 4x4 grid of 128px tiles, generated at runtime.
   Zero network requests, zero decode cost, ~1ms to build. One texture = one draw call
   for the whole static restaurant. */
(function (g) {
  'use strict';

  const SIZE = 512, GRID = 4, TILE = SIZE / GRID, PAD = 6;

  /* Tile ids (row-major). Keep in sync with the drawing code below. */
  const T = {
    BLANK: 0, FLOOR: 1, WOOD: 2, PANEL: 3,
    STEEL: 4, MENU: 5, LOGO: 6, CEIL: 7,
    TILEWALL: 8, PACK: 9, PUFF: 10, GLASS: 11,
    CONCRETE: 12, STRIPE: 13, SODA: 14, SHADOW: 15,
  };

  /* UV rect for a tile, inset by PAD so mipmaps never bleed across neighbours. */
  function rect(id) {
    const cx = (id % GRID) * TILE, cy = ((id / GRID) | 0) * TILE;
    return [(cx + PAD) / SIZE, (cy + PAD) / SIZE, (TILE - PAD * 2) / SIZE, (TILE - PAD * 2) / SIZE];
  }

  function noise(ctx, x, y, w, h, amt, alpha) {
    const img = ctx.getImageData(x, y, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amt;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
      if (alpha !== undefined) d[i + 3] = alpha;
    }
    ctx.putImageData(img, x, y);
  }

  function build() {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const x = c.getContext('2d', { alpha: true, willReadFrequently: true });
    x.imageSmoothingEnabled = true;

    /* Each drawer paints the full 128px cell including the padding ring, so the
       inset UV rect never samples an unpainted pixel. */
    const cell = (id, fn) => {
      const cx = (id % GRID) * TILE, cy = ((id / GRID) | 0) * TILE;
      x.save();
      x.beginPath(); x.rect(cx, cy, TILE, TILE); x.clip();
      x.translate(cx, cy);
      fn(x, TILE);
      x.restore();
    };

    // 0 BLANK — flat white, used for solid-colour vertex-tinted geometry.
    cell(T.BLANK, (o, s) => { o.fillStyle = '#ffffff'; o.fillRect(0, 0, s, s); });

    // 1 FLOOR — warm terrazzo-ish tile with grout line and speckle.
    cell(T.FLOOR, (o, s) => {
      o.fillStyle = '#d9d3c8'; o.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        o.fillStyle = ['#b9b0a1', '#efeade', '#8f867a', '#c6a58a'][i & 3];
        o.globalAlpha = 0.5;
        o.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
      }
      o.globalAlpha = 1;
      o.strokeStyle = '#9b9285'; o.lineWidth = 3;
      o.strokeRect(1.5, 1.5, s - 3, s - 3);
      o.strokeStyle = 'rgba(255,255,255,.45)'; o.lineWidth = 1.5;
      o.strokeRect(4, 4, s - 8, s - 8);
    });

    // 2 WOOD — table top, warm oak with grain.
    cell(T.WOOD, (o, s) => {
      o.fillStyle = '#9d6b43'; o.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        o.strokeStyle = `rgba(${60 + Math.random() * 40},${35 + Math.random() * 25},${18},${0.12 + Math.random() * 0.2})`;
        o.lineWidth = 0.6 + Math.random() * 2.2;
        o.beginPath();
        const y = Math.random() * s;
        o.moveTo(0, y);
        o.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 8, s * 0.7, y + (Math.random() - 0.5) * 8, s, y + (Math.random() - 0.5) * 5);
        o.stroke();
      }
      noise(o, 0, 0, s, s, 14);
    });

    // 3 PANEL — matte painted wall panel with a soft vertical gradient.
    cell(T.PANEL, (o, s) => {
      const gr = o.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e2e2e2');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
      noise(o, 0, 0, s, s, 8);
    });

    // 4 STEEL — brushed stainless for kitchen equipment.
    cell(T.STEEL, (o, s) => {
      const gr = o.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#e8ebee'); gr.addColorStop(0.5, '#c3c9cf'); gr.addColorStop(1, '#dfe4e8');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
      for (let i = 0; i < 150; i++) {
        o.strokeStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
        o.lineWidth = Math.random() * 1.4;
        const px = Math.random() * s;
        o.beginPath(); o.moveTo(px, 0); o.lineTo(px, s); o.stroke();
      }
      o.strokeStyle = 'rgba(90,100,110,.35)'; o.lineWidth = 2;
      o.strokeRect(3, 3, s - 6, s - 6);
    });

    // 5 MENU — backlit digital menu board.
    cell(T.MENU, (o, s) => {
      o.fillStyle = '#1a1c22'; o.fillRect(0, 0, s, s);
      const rows = [['#ffc72c', 0.30], ['#ffffff', 0.22], ['#ffffff', 0.22], ['#da291c', 0.26]];
      let yy = 6;
      rows.forEach(([col, h], i) => {
        const hh = s * h - 8;
        o.fillStyle = 'rgba(255,255,255,.05)'; o.fillRect(6, yy, s - 12, hh);
        o.fillStyle = col; o.globalAlpha = 0.9;
        o.fillRect(10, yy + 5, (s - 20) * (0.35 + (i * 0.17) % 0.5), Math.max(4, hh * 0.28));
        o.globalAlpha = 0.45;
        o.fillStyle = '#9fb3c8';
        for (let k = 0; k < 3; k++) o.fillRect(10, yy + hh * 0.5 + k * 7, (s - 24) * (0.3 + Math.random() * 0.55), 3);
        o.globalAlpha = 1;
        yy += hh + 8;
      });
    });

    // 6 LOGO — golden arches on red.
    cell(T.LOGO, (o, s) => {
      o.fillStyle = '#da291c'; o.fillRect(0, 0, s, s);
      o.strokeStyle = '#ffc72c'; o.lineWidth = s * 0.15; o.lineCap = 'round';
      o.beginPath();
      o.moveTo(s * 0.2, s * 0.78);
      o.bezierCurveTo(s * 0.2, s * 0.22, s * 0.5, s * 0.22, s * 0.5, s * 0.78);
      o.bezierCurveTo(s * 0.5, s * 0.22, s * 0.8, s * 0.22, s * 0.8, s * 0.78);
      o.stroke();
    });

    // 7 CEIL — acoustic ceiling panel.
    cell(T.CEIL, (o, s) => {
      o.fillStyle = '#f2f3f5'; o.fillRect(0, 0, s, s);
      noise(o, 0, 0, s, s, 10);
      o.strokeStyle = '#a8adb5'; o.lineWidth = 5;
      o.strokeRect(2.5, 2.5, s - 5, s - 5);
      o.strokeStyle = 'rgba(255,255,255,.85)'; o.lineWidth = 2;
      o.strokeRect(7, 7, s - 14, s - 14);
    });

    // 8 TILEWALL — small glossy wall tiles for the kitchen.
    cell(T.TILEWALL, (o, s) => {
      o.fillStyle = '#cfd6db'; o.fillRect(0, 0, s, s);
      const n = 4, t = s / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        const gr = o.createLinearGradient(ix * t, iy * t, ix * t, iy * t + t);
        gr.addColorStop(0, '#fbfdfe'); gr.addColorStop(1, '#e3e9ed');
        o.fillStyle = gr;
        o.fillRect(ix * t + 1.5, iy * t + 1.5, t - 3, t - 3);
      }
    });

    // 9 PACK — food packaging: red/yellow carton.
    cell(T.PACK, (o, s) => {
      o.fillStyle = '#e2231a'; o.fillRect(0, 0, s, s);
      o.fillStyle = '#ffc72c'; o.fillRect(0, s * 0.55, s, s * 0.45);
      o.strokeStyle = 'rgba(0,0,0,.12)'; o.lineWidth = 3; o.strokeRect(1.5, 1.5, s - 3, s - 3);
      o.fillStyle = 'rgba(255,255,255,.85)';
      o.fillRect(s * 0.18, s * 0.2, s * 0.64, s * 0.1);
    });

    // 10 PUFF — soft white sprite with a real alpha falloff, for steam and smoke.
    cell(T.PUFF, (o, s) => {
      o.clearRect(0, 0, s, s);
      const gr = o.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2 - PAD);
      gr.addColorStop(0, 'rgba(255,255,255,.95)');
      gr.addColorStop(0.45, 'rgba(255,255,255,.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
    });

    // 11 GLASS — window, translucent with a faint sheen.
    cell(T.GLASS, (o, s) => {
      const gr = o.createLinearGradient(0, 0, s, s);
      gr.addColorStop(0, 'rgba(210,235,255,.34)');
      gr.addColorStop(0.45, 'rgba(255,255,255,.16)');
      gr.addColorStop(1, 'rgba(180,215,240,.30)');
      o.clearRect(0, 0, s, s);
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
      o.strokeStyle = 'rgba(255,255,255,.5)'; o.lineWidth = 5;
      o.beginPath(); o.moveTo(s * 0.1, s); o.lineTo(s * 0.55, 0); o.stroke();
    });

    // 12 CONCRETE — parking lot asphalt.
    cell(T.CONCRETE, (o, s) => {
      o.fillStyle = '#54585e'; o.fillRect(0, 0, s, s);
      noise(o, 0, 0, s, s, 30);
    });

    // 13 STRIPE — yellow safety stripe / parking line.
    cell(T.STRIPE, (o, s) => {
      o.fillStyle = '#4a4e54'; o.fillRect(0, 0, s, s);
      o.fillStyle = '#e9c93a'; o.fillRect(s * 0.4, 0, s * 0.2, s);
      noise(o, 0, 0, s, s, 18);
    });

    // 14 SODA — beverage dispenser fascia.
    cell(T.SODA, (o, s) => {
      o.fillStyle = '#20242b'; o.fillRect(0, 0, s, s);
      const cols = ['#d1332a', '#e8a326', '#3f7fd6', '#2f9e57'];
      for (let i = 0; i < 4; i++) {
        o.fillStyle = cols[i];
        o.fillRect(6 + i * (s - 12) / 4, 8, (s - 12) / 4 - 5, s * 0.42);
        o.fillStyle = 'rgba(255,255,255,.18)';
        o.fillRect(6 + i * (s - 12) / 4, 8, (s - 12) / 4 - 5, s * 0.12);
      }
      o.fillStyle = '#9aa4b0'; o.fillRect(6, s * 0.6, s - 12, s * 0.06);
    });

    // 15 SHADOW — radial falloff used as a multiply decal for contact shadows.
    cell(T.SHADOW, (o, s) => {
      o.fillStyle = '#ffffff'; o.fillRect(0, 0, s, s);
      const gr = o.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2 - PAD);
      gr.addColorStop(0, 'rgba(40,36,32,.75)');
      gr.addColorStop(0.55, 'rgba(70,64,58,.32)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = gr; o.fillRect(0, 0, s, s);
    });

    return c;
  }

  g.Atlas = { T, rect, build, SIZE };
})(window);
