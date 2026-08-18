/* The restaurant, built once at load into four static meshes:
     opaque   — one draw call for the entire building, patio, car park and skyline
     emissive — unlit surfaces (signage, light panels, menu boards)
     decal    — multiply-blended contact shadows
     glass    — alpha-blended windows, drawn last

   Styling rules the whole build follows, so it reads as one deliberate place
   rather than a pile of boxes:
     · a loud primary palette — diner red, warm yellow, white, chrome
     · every coloured volume gets a white or chrome trim strip on its edge
     · repeated motifs: the red/white check appears on the base course, the
       counter front and the umbrellas
     · clear scale hierarchy — one hero prop (the rooftop burger), big signage,
       medium fixtures, small props */
(function (g) {
  'use strict';
  const T = g.Atlas.T;

  /* palette (0xRRGGBB, multiplied against the texture) */
  const C = {
    red: 0xe01b22, redDark: 0xa8161c, redLite: 0xf4565b,
    yellow: 0xffc72c, yellowDeep: 0xf0a91a,
    white: 0xffffff, cream: 0xf7f2e7, bone: 0xe9e3d5,
    chrome: 0xdfe6ec, steel: 0xb4bec8, dark: 0x232830, slate: 0x3c4553,
    green: 0x4fb23f, greenDark: 0x2f7a28, greenLite: 0x7fd464,
    wood: 0xc08a4e, trunk: 0x7a5433,
  };

  const L = {
    W: 12, D: 9, H: 3.45,
    COUNTER_Z: -1, COUNTER_X0: -9, COUNTER_X1: 6, COUNTER_H: 1.05, COUNTER_D: 0.75,
    DOOR_X: 0, DOOR_W: 3.2,
    REGISTER: [-2.0, -1.0],
    PICKUP: [3.0, -1.0],
    GRILL: [-6.5, -5.4],
    FRYER: [-2.4, -5.4],
    DRINKS: [1.6, -5.5],
    ICECREAM: [5.4, -5.5],
    TRASH: [-10.2, -3.6],
    QUEUE: [[-2, 0.6], [-2, 1.85], [-2, 3.1], [-2, 4.35], [-2, 5.6], [-2, 6.85]],
    PICKUP_Q: [[3, 0.6], [3, 1.85], [3, 3.1]],
    DOOR_IN: [0, 8.2], DOOR_OUT: [0, 12.5], SPAWN: [0, 17],
    BOOTHS: [
      [-10.5, 1.5], [-10.5, 5.0], [-10.5, 8.0],
      [10.5, 1.5], [10.5, 5.0], [10.5, 8.0],
    ],
    TABLES: [[-6.2, 2.6], [-6.2, 6.4], [6.2, 2.6], [6.2, 6.4]],
    PLAYER_SPAWN: [0, -2.0, Math.PI],
  };

  /* Seats drive the customer AI, so they are declared once here and the geometry
     is built to match — never the other way round. */
  L.SEATS = [];
  L.BOOTHS.forEach((t, ti) => {
    [[0, -1.05], [0, 1.05]].forEach((o) => {
      L.SEATS.push({ x: t[0] + o[0], z: t[1] + o[1], booth: ti, taken: -1,
        yaw: Math.atan2(-o[0], -o[1]) });
    });
  });
  L.TABLES.forEach((t, ti) => {
    [[-0.95, 0], [0.95, 0], [0, -0.95], [0, 0.95]].forEach((o) => {
      L.SEATS.push({ x: t[0] + o[0], z: t[1] + o[1], table: ti, taken: -1,
        yaw: Math.atan2(-o[0], -o[1]) });
    });
  });

  function build() {
    const op = new g.Geom.MeshBuilder();
    const em = new g.Geom.MeshBuilder();
    const dc = new g.Geom.MeshBuilder();
    const gl = new g.Geom.MeshBuilder();
    const solids = [];
    const round = [];
    const rnd = g.MathX.mulberry32(20260818);

    const solid = (x0, x1, z0, z1, h) => solids.push({ x0, x1, z0, z1, h: h === undefined ? 3 : h });
    const shade = (x, z, sx, sz, a) => dc.decal(x, 0.013, z, sx, sz, { tint: C.white, flat: a === undefined ? 1 : a });
    const W = L.W, D = L.D, H = L.H;

    /* A box plus a thin trim strip along its top edge — the detail that stops
       every volume from reading as a bare block. */
    function capped(b, x, y, z, sx, sy, sz, opt, trimCol, trimH) {
      b.box(x, y, z, sx, sy, sz, opt);
      const th = trimH || 0.07;
      b.box(x, y + sy / 2 + th / 2, z, sx + 0.06, th, sz + 0.06,
        { tile: T.CHROME, tint: trimCol === undefined ? C.chrome : trimCol });
    }

    /* ══════════════════════════ interior ══════════════════════════ */

    const cz = L.COUNTER_Z, cd = L.COUNTER_D, ch = L.COUNTER_H;
    const cmid = (L.COUNTER_X0 + L.COUNTER_X1) / 2, clen = L.COUNTER_X1 - L.COUNTER_X0;
    const winY0 = 1.05, winY1 = 2.62;
    const DADO_H = 1.02;                      // height of the check wainscot

    /* ---- floors ---- */
    op.tiled([-W, 0, D], [W, 0, D], [W, 0, cz], [-W, 0, cz],
      { tile: T.TERRAZZO, rep: 1.15, tint: C.white, flat: 0.98 });
    op.tiled([-W, 0, cz], [W, 0, cz], [W, 0, -D], [-W, 0, -D],
      { tile: T.QUARRY, rep: 0.95, tint: C.white, flat: 0.94 });
    // red inlay border tracing the dining room, and a check runner at the door
    [[-W + 0.55, 1], [W - 0.55, -1]].forEach(([x]) => {
      op.decal(x, 0.014, (cz + D) / 2, 0.3, D - cz, { tile: T.BLANK, tint: C.red, flat: 1.0 });
    });
    op.decal(0, 0.014, D - 0.55, W * 2 - 1.1, 0.3, { tile: T.BLANK, tint: C.red, flat: 1.0 });
    op.decal(0, 0.014, cz + 0.55, W * 2 - 1.1, 0.3, { tile: T.BLANK, tint: C.red, flat: 1.0 });
    op.decal(0, 0.016, 7.7, 4.6, 2.6, { tile: T.CHECKER, rep: 0.55, tint: C.white, flat: 0.95 });

    /* ---- ceiling: white panels, exposed red beams, pendant lights ---- */
    op.tiled([-W, H, -D], [W, H, D], [W, H, D], [-W, H, D], { tile: T.CEIL, rep: 1.6, tint: C.white, flat: 1.0 });
    op.tiled([-W, H, -D], [W, H, -D], [W, H, D], [-W, H, D],
      { tile: T.CEIL, rep: 1.6, tint: C.white, flat: 1.0 });
    for (let z = -7.5; z <= 8; z += 2.6) {
      op.box(0, H - 0.13, z, W * 2, 0.26, 0.24, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      op.box(0, H - 0.27, z, W * 2, 0.06, 0.3, { tile: T.CHROME, tint: C.chrome });
    }
    for (let ix = -3; ix <= 3; ix++) for (let iz = -2; iz <= 2; iz++) {
      const x = ix * 3.2, z = iz * 3.4;
      op.box(x, H - 0.06, z, 1.76, 0.12, 0.86, { tile: T.CHROME, tint: C.chrome, flat: 1.0 });
      em.box(x, H - 0.145, z, 1.62, 0.05, 0.72, { tile: T.BLANK, tint: 0xfff8ea, flat: 1 });
    }
    /* pendants over the booths */
    L.BOOTHS.forEach(([bx, bz]) => {
      op.cyl(bx, H - 0.78, bz, 0.025, 0.78, 6, { tile: T.CHROME, tint: C.chrome, flat: 0.9 });
      op.cyl(bx, H - 0.95, bz, 0.28, 0.2, 10, { tile: T.BLANK, tint: C.red, flat: 1.05, rTop: 0.1 });
      em.cyl(bx, H - 0.99, bz, 0.24, 0.05, 10, { tile: T.NEON, tint: C.white, flat: 1 });
    });

    /* ---- walls ---- */
    const wallIn = (x0, y0, z0, x1, y1, z1, opt) => {
      if (x0 === x1) {
        const A = [x0, y0, z0], B = [x0, y0, z1], Cc = [x0, y1, z1], Dd = [x0, y1, z0];
        return op.tiled.apply(op, x0 < 0 ? [Dd, Cc, B, A, opt] : [A, B, Cc, Dd, opt]);
      }
      const A = [x0, y0, z0], B = [x1, y0, z0], Cc = [x1, y1, z0], Dd = [x0, y1, z0];
      return op.tiled.apply(op, z0 < 0 ? [A, B, Cc, Dd, opt] : [Dd, Cc, B, A, opt]);
    };

    const wallW = { tile: T.PANEL, rep: 1.8, tint: C.cream, flat: 1.0 };
    const wallK = { tile: T.TILEWALL, rep: 1.05, tint: C.white, flat: 1.0 };
    const dado  = { tile: T.CHECKER, rep: 0.51, tint: C.white, flat: 1.0 };

    wallIn(-W, 0, -D, W, H, -D, wallK);
    wallIn(-W, 0, -D, -W, H, cz, wallK);
    wallIn(W, 0, -D, W, H, cz, wallK);
    // red band and chrome rail around the kitchen
    [[-W + 0.03, 1], [W - 0.03, -1]].forEach(([x, sg]) => {
      op.box(x, H - 0.2, (cz - D) / 2, 0.07, 0.4, D + cz, { tile: T.BLANK, tint: C.red, flat: 1.0 });
    });
    op.box(0, H - 0.2, -D + 0.04, W * 2, 0.4, 0.08, { tile: T.BLANK, tint: C.red, flat: 1.0 });

    /* dining side walls: check dado, chrome rail, glazing, red header */
    [[-W, 1], [W, -1]].forEach(([x, sg]) => {
      wallIn(x, 0, cz, x, DADO_H, D, dado);
      wallIn(x, DADO_H, cz, x, winY1, D, wallW);
      wallIn(x, winY1, cz, x, H - 0.4, D, wallW);
      op.box(x - sg * 0.055, DADO_H + 0.03, (cz + D) / 2, 0.12, 0.1, D - cz, { tile: T.CHROME, tint: C.chrome });
      op.box(x - sg * 0.05, H - 0.2, (cz + D) / 2, 0.11, 0.4, D - cz, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      op.box(x - sg * 0.06, H - 0.42, (cz + D) / 2, 0.13, 0.07, D - cz, { tile: T.CHROME, tint: C.chrome });
      gl.quad([x + sg * 0.02, winY0, cz + 0.1], [x + sg * 0.02, winY0, D - 0.1],
              [x + sg * 0.02, winY1, D - 0.1], [x + sg * 0.02, winY1, cz + 0.1],
              { tile: T.GLASS, tint: C.white, flat: 1 });
      for (let z = cz + 0.1; z <= D; z += 2.0) {
        op.box(x - sg * 0.055, (winY0 + winY1) / 2, z, 0.12, winY1 - winY0 + 0.1, 0.1, { tile: T.CHROME, tint: C.steel });
      }
      op.box(x - sg * 0.08, winY0 - 0.06, (cz + D) / 2, 0.18, 0.12, D - cz, { tile: T.CHROME, tint: C.chrome });
    });

    /* front wall */
    const dw = L.DOOR_W / 2;
    [[-W, -dw], [dw, W]].forEach(([a, b]) => {
      const sg = Math.sign(b - a);
      wallIn(a, 0, D, b, DADO_H, D, dado);
      wallIn(a, DADO_H, D, b, winY0, D, wallW);
      wallIn(a, winY1, D, b, H - 0.4, D, wallW);
      wallIn(a, winY0, D, a + sg * 0.35, winY1, D, wallW);
      wallIn(b - sg * 0.35, winY0, D, b, winY1, D, wallW);
      gl.quad([a + 0.35, winY0, D - 0.02], [b - 0.35, winY0, D - 0.02],
              [b - 0.35, winY1, D - 0.02], [a + 0.35, winY1, D - 0.02],
              { tile: T.GLASS, tint: C.white, flat: 1 });
      op.box((a + b) / 2, DADO_H + 0.03, D - 0.055, b - a, 0.1, 0.12, { tile: T.CHROME, tint: C.chrome });
      op.box((a + b) / 2, H - 0.2, D - 0.05, b - a, 0.4, 0.11, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      op.box((a + b) / 2, H - 0.42, D - 0.06, b - a, 0.07, 0.13, { tile: T.CHROME, tint: C.chrome });
      for (let x = a + 2.2; x < b - 0.5; x += 2.2) {
        op.box(x, (winY0 + winY1) / 2, D - 0.055, 0.11, winY1 - winY0, 0.11, { tile: T.CHROME, tint: C.steel });
      }
    });
    wallIn(-dw, 2.35, D, dw, H - 0.4, D, wallW);
    op.box(0, H - 0.2, D - 0.05, dw * 2, 0.4, 0.11, { tile: T.BLANK, tint: C.red, flat: 1.0 });

    /* doors */
    op.box(0, 1.18, D, 0.15, 2.35, 0.17, { tile: T.CHROME, tint: C.red });
    [-1, 1].forEach(sg => {
      op.box(sg * (dw - 0.05), 1.18, D, 0.13, 2.35, 0.17, { tile: T.CHROME, tint: C.red });
      gl.quad([sg > 0 ? 0.09 : -dw + 0.1, 0.1, D - 0.03], [sg > 0 ? dw - 0.1 : -0.09, 0.1, D - 0.03],
              [sg > 0 ? dw - 0.1 : -0.09, 2.3, D - 0.03], [sg > 0 ? 0.09 : -dw + 0.1, 2.3, D - 0.03],
              { tile: T.GLASS, tint: C.white, flat: 1 });
      op.box(sg * 0.36, 1.15, D - 0.1, 0.06, 0.95, 0.06, { tile: T.CHROME, tint: C.chrome });
    });
    em.box(0, 2.52, D - 0.16, 2.1, 0.34, 0.02, { tile: T.SIGN_OPEN, tint: C.white, flat: 1 });

    solid(-W - 1, -W, -D - 1, D + 1); solid(W, W + 1, -D - 1, D + 1);
    solid(-W - 1, W + 1, -D - 1, -D);
    solid(-W - 1, -dw, D, D + 1); solid(dw, W + 1, D, D + 1);

    /* ---- service counter ---- */
    op.box(cmid, ch / 2, cz, clen, ch, cd, { tile: T.PANEL, tint: C.white, rep: 1.4 });
    op.box(cmid, 0.34, cz + cd / 2 + 0.02, clen, 0.62, 0.06, { tile: T.CHECKER, rep: 0.52, tint: C.white, flat: 1.0 });
    op.box(cmid, 0.67, cz + cd / 2 + 0.03, clen, 0.08, 0.09, { tile: T.CHROME, tint: C.chrome });
    op.box(cmid, 0.05, cz + cd / 2 + 0.03, clen, 0.1, 0.09, { tile: T.CHROME, tint: C.steel });
    op.box(cmid, ch + 0.045, cz, clen + 0.18, 0.09, cd + 0.18, { tile: T.CHROME, tint: C.chrome });
    // tray rail on the customer side
    op.box(cmid, 0.92, cz + cd / 2 + 0.14, clen, 0.05, 0.22, { tile: T.CHROME, tint: C.chrome });
    [-8.4, -5.6, -2.8, 0, 2.8, 5.4].forEach(x =>
      op.box(x, 0.79, cz + cd / 2 + 0.2, 0.06, 0.22, 0.06, { tile: T.CHROME, tint: C.steel }));
    solid(L.COUNTER_X0 - 0.1, L.COUNTER_X1 + 0.1, cz - cd / 2 - 0.1, cz + cd / 2 + 0.35);
    shade(cmid, cz + 0.5, clen + 1.2, 2.6, 0.85);

    /* registers */
    [-2.0, -5.2].forEach(x => {
      op.box(x, ch + 0.17, cz - 0.05, 0.46, 0.22, 0.36, { tile: T.PANEL, tint: C.dark, flat: 0.95 });
      op.box(x, ch + 0.29, cz - 0.05, 0.5, 0.04, 0.4, { tile: T.CHROME, tint: C.chrome });
      op.box(x, ch + 0.36, cz - 0.14, 0.44, 0.32, 0.07, { tile: T.PANEL, tint: C.dark, flat: 0.95 });
      em.box(x, ch + 0.36, cz - 0.185, 0.37, 0.25, 0.02, { tile: T.MENU, tint: C.white, flat: 1 });
      em.box(x, ch + 0.17, cz + 0.135, 0.31, 0.13, 0.02, { tile: T.MENU, tint: 0xdde8ff, flat: 1 });
      // ORDER HERE marker above each till
      op.box(x, 2.02, cz + 0.1, 0.9, 0.28, 0.06, { tile: T.CHROME, tint: C.chrome });
      em.box(x, 2.02, cz + 0.14, 0.82, 0.2, 0.02, { tile: T.SIGN_MENU, tint: C.white, flat: 1 });
      op.cyl(x, 2.16, cz + 0.1, 0.02, 1.29, 4, { tile: T.CHROME, tint: C.steel, flat: 0.95 });
    });

    /* pickup pass */
    op.box(3, ch + 1.02, cz - 0.16, 2.5, 0.09, 0.44, { tile: T.CHROME, tint: C.chrome });
    [2.1, 3.9].forEach(x => op.box(x, ch + 1.35, cz - 0.16, 0.05, 0.6, 0.05, { tile: T.CHROME, tint: C.steel }));
    [2.3, 3.0, 3.7].forEach(x => em.box(x, ch + 0.97, cz - 0.16, 0.5, 0.05, 0.3, { tile: T.NEON, tint: C.white, flat: 1 }));
    op.box(3, ch + 0.1, cz + 0.06, 1.9, 0.06, 0.45, { tile: T.CHROME, tint: C.chrome });

    /* menu boards + crew screens */
    const board = (x, w) => {
      op.box(x, 2.68, cz - 0.42, w + 0.16, 1.2, 0.14, { tile: T.CHROME, tint: C.chrome });
      op.box(x, 2.68, cz - 0.37, w, 1.04, 0.04, { tile: T.PANEL, tint: C.dark, flat: 0.9 });
      em.quad([x - w / 2 + 0.05, 2.22, cz - 0.345], [x + w / 2 - 0.05, 2.22, cz - 0.345],
              [x + w / 2 - 0.05, 3.14, cz - 0.345], [x - w / 2 + 0.05, 3.14, cz - 0.345],
              { tile: T.MENU, tint: C.white, flat: 1 });
      op.box(x, 3.34, cz - 0.42, w + 0.22, 0.16, 0.2, { tile: T.BLANK, tint: C.red, flat: 1.0 });
    };
    board(-3.6, 6.6);
    board(3.2, 3.0);
    em.box(-8.0, 2.68, cz - 0.32, 0.95, 0.95, 0.06, { tile: T.LOGO, tint: C.white, flat: 1 });
    [[-4.6, 2.1], [-1.4, 2.1], [2.6, 2.1]].forEach(([x, w]) => {
      op.box(x, 2.30, cz - 0.62, w + 0.12, 0.88, 0.1, { tile: T.PANEL, tint: C.dark, flat: 0.9 });
      em.quad([x + w / 2, 1.94, cz - 0.675], [x - w / 2, 1.94, cz - 0.675],
              [x - w / 2, 2.66, cz - 0.675], [x + w / 2, 2.66, cz - 0.675],
              { tile: T.MENU, tint: 0xbcd4e8, flat: 1 });
      op.box(x, 2.74, cz - 0.55, 0.07, 0.6, 0.07, { tile: T.CHROME, tint: C.steel });
    });

    op.box(6.6, 0.52, cz, 1.0, 1.04, 0.1, { tile: T.PANEL, tint: C.white });
    op.box(6.6, 1.07, cz, 1.06, 0.06, 0.15, { tile: T.CHROME, tint: C.chrome });

    /* ---- booths ---- */
    L.BOOTHS.forEach(([bx, bz]) => {
      const sg = Math.sign(bx);
      const wx = bx + sg * 1.35;                     // against the wall
      const ix = bx - sg * 1.15;                     // aisle end
      // benches, facing each other across the table
      [-1, 1].forEach(d => {
        const sz = bz + d * 1.05;
        op.box(bx, 0.45, sz, 2.3, 0.14, 0.62, { tile: T.BLANK, tint: C.red, flat: 1.0 });
        op.box(bx, 0.53, sz, 2.34, 0.05, 0.66, { tile: T.CHROME, tint: C.chrome });
        op.box(bx, 0.22, sz, 2.2, 0.44, 0.5, { tile: T.PANEL, tint: C.white, flat: 0.92 });
        // high back
        op.box(bx, 0.85, sz + d * 0.42, 2.3, 0.94, 0.2, { tile: T.BLANK, tint: C.red, flat: 1.0 });
        op.box(bx, 1.34, sz + d * 0.42, 2.36, 0.08, 0.26, { tile: T.CHROME, tint: C.chrome });
        op.box(bx, 0.62, sz + d * 0.42, 2.3, 0.06, 0.24, { tile: T.BLANK, tint: C.redDark, flat: 0.95 });
        shade(bx, sz, 2.6, 1.1, 0.84);
        round.push({ x: bx, z: sz, r: 0.75 });
      });
      // table
      op.box(bx, 0.72, bz, 1.9, 0.07, 0.86, { tile: T.WOOD, tint: C.white, flat: 1.0 });
      op.box(bx, 0.765, bz, 1.96, 0.035, 0.92, { tile: T.CHROME, tint: C.chrome });
      op.cyl(bx, 0, bz, 0.07, 0.7, 8, { tile: T.CHROME, tint: C.steel, flat: 0.88 });
      op.cyl(bx, 0, bz, 0.28, 0.05, 10, { tile: T.CHROME, tint: C.steel, flat: 0.82, closeBottom: true });
      // condiment caddy
      op.box(bx + 0.6, 0.8, bz, 0.16, 0.1, 0.3, { tile: T.CHROME, tint: C.chrome });
      op.cyl(bx + 0.6, 0.84, bz - 0.06, 0.03, 0.11, 6, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      op.cyl(bx + 0.6, 0.84, bz + 0.06, 0.03, 0.11, 6, { tile: T.BLANK, tint: C.yellow, flat: 1.05 });
      // end divider onto the aisle
      op.box(ix, 0.8, bz, 0.16, 1.6, 2.9, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.box(ix, 1.63, bz, 0.22, 0.1, 2.96, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      op.box(ix, 1.2, bz, 0.2, 0.5, 0.5, { tile: T.CHROME, tint: C.chrome });
      solid(Math.min(ix, wx) - 0.12, Math.max(ix, wx) + 0.12, bz - 1.55, bz + 1.55, 1.2);
      round.push({ x: ix, z: bz, r: 0.7 });
      shade(bx, bz, 3.0, 3.4, 0.8);
    });

    /* ---- round tables ---- */
    L.TABLES.forEach(([x, z]) => {
      op.cyl(x, 0.72, z, 0.62, 0.06, 12, { tile: T.WOOD, tint: C.white, flat: 1.0, closeBottom: true });
      op.cyl(x, 0.775, z, 0.65, 0.035, 12, { tile: T.CHROME, tint: C.chrome, flat: 1.0 });
      op.cyl(x, 0.05, z, 0.09, 0.68, 8, { tile: T.CHROME, tint: C.steel, flat: 0.88 });
      op.cyl(x, 0, z, 0.34, 0.06, 10, { tile: T.CHROME, tint: C.steel, flat: 0.82, closeBottom: true });
      op.box(x, 0.82, z, 0.14, 0.12, 0.26, { tile: T.CHROME, tint: C.chrome });
      shade(x, z, 1.9, 1.9, 0.82);
      round.push({ x, z, r: 0.85 });
      solid(x - 0.6, x + 0.6, z - 0.6, z + 0.6, 0.8);

      [[-0.95, 0], [0.95, 0], [0, -0.95], [0, 0.95]].forEach(([ox, oz]) => {
        const sx = x + ox, sz = z + oz;
        op.box(sx, 0.44, sz, 0.46, 0.1, 0.46, { tile: T.BLANK, tint: C.red, flat: 1.0 });
        op.box(sx, 0.5, sz, 0.5, 0.04, 0.5, { tile: T.CHROME, tint: C.chrome });
        op.cyl(sx, 0, sz, 0.055, 0.42, 8, { tile: T.CHROME, tint: C.steel, flat: 0.85 });
        op.cyl(sx, 0, sz, 0.19, 0.05, 8, { tile: T.CHROME, tint: C.steel, flat: 0.8, closeBottom: true });
        const bx2 = ox !== 0 ? Math.sign(ox) * 0.2 : 0, bz2 = oz !== 0 ? Math.sign(oz) * 0.2 : 0;
        op.box(sx + bx2, 0.74, sz + bz2, ox !== 0 ? 0.09 : 0.46, 0.5, oz !== 0 ? 0.09 : 0.46,
          { tile: T.BLANK, tint: C.red, flat: 1.0 });
        op.box(sx + bx2, 1.0, sz + bz2, ox !== 0 ? 0.13 : 0.5, 0.06, oz !== 0 ? 0.13 : 0.5,
          { tile: T.CHROME, tint: C.chrome });
        shade(sx, sz, 0.85, 0.85, 0.85);
        round.push({ x: sx, z: sz, r: 0.42 });
      });
    });

    /* ---- lobby fittings ---- */
    /* self-serve drinks station */
    (function lobbyDrinks() {
      const x = -8.6, z = 7.9;
      op.box(x, 0.45, z, 2.4, 0.9, 0.72, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.box(x, 0.92, z, 2.5, 0.08, 0.8, { tile: T.CHROME, tint: C.chrome });
      op.box(x, 0.3, z + 0.38, 2.4, 0.5, 0.05, { tile: T.CHECKER, rep: 0.5, tint: C.white, flat: 1.0 });
      op.box(x, 1.72, z - 0.16, 2.3, 1.5, 0.5, { tile: T.PANEL, tint: C.dark, flat: 0.95 });
      em.quad([x - 1.1, 1.15, z + 0.095], [x + 1.1, 1.15, z + 0.095],
              [x + 1.1, 2.4, z + 0.095], [x - 1.1, 2.4, z + 0.095], { tile: T.SODA, tint: C.white, flat: 1 });
      op.box(x, 2.5, z - 0.16, 2.4, 0.14, 0.56, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      [-0.8, -0.27, 0.27, 0.8].forEach(o => {
        op.box(x + o, 1.14, z + 0.2, 0.11, 0.22, 0.16, { tile: T.CHROME, tint: C.chrome });
        op.box(x + o, 0.96, z + 0.16, 0.24, 0.03, 0.24, { tile: T.CHROME, tint: C.steel });
      });
      solid(x - 1.3, x + 1.3, z - 0.45, z + 0.45, 1.2);
      shade(x, z, 3.2, 1.8, 0.85);
      round.push({ x, z, r: 1.35 });
    })();

    /* condiment + napkin station and bins */
    [[-4.3, 8.1], [4.3, 8.1]].forEach(([x, z]) => {
      op.box(x, 0.48, z, 1.5, 0.96, 0.6, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.box(x, 0.98, z, 1.58, 0.07, 0.68, { tile: T.CHROME, tint: C.chrome });
      op.box(x, 0.3, z + 0.32, 1.5, 0.5, 0.05, { tile: T.CHECKER, rep: 0.5, tint: C.white, flat: 1.0 });
      op.box(x - 0.42, 1.09, z, 0.4, 0.16, 0.34, { tile: T.CHROME, tint: C.chrome });
      op.cyl(x + 0.1, 1.02, z, 0.055, 0.2, 6, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      op.cyl(x + 0.3, 1.02, z, 0.055, 0.2, 6, { tile: T.BLANK, tint: C.yellow, flat: 1.05 });
      op.box(x, 1.55, z - 0.24, 1.2, 0.9, 0.1, { tile: T.PANEL, tint: C.dark, flat: 0.95 });
      em.box(x, 1.55, z - 0.19, 1.1, 0.78, 0.02, { tile: T.LOGO, tint: C.white, flat: 1 });
      solid(x - 0.8, x + 0.8, z - 0.36, z + 0.36, 1.2);
      shade(x, z, 2.2, 1.4, 0.85);
      round.push({ x, z, r: 0.85 });
    });

    /* waste stations with swing tops */
    [[-1.9, 8.2], [1.9, 8.2]].forEach(([x, z]) => {
      op.box(x, 0.5, z, 0.78, 1.0, 0.62, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.box(x, 1.03, z, 0.84, 0.08, 0.68, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      op.box(x, 0.62, z + 0.32, 0.5, 0.42, 0.06, { tile: T.BLANK, tint: C.dark, flat: 0.85 });
      op.box(x, 0.2, z + 0.32, 0.78, 0.4, 0.05, { tile: T.CHECKER, rep: 0.5, tint: C.white, flat: 1.0 });
      solid(x - 0.42, x + 0.42, z - 0.36, z + 0.36, 1.1);
      shade(x, z, 1.4, 1.2, 0.85);
      round.push({ x, z, r: 0.55 });
    });

    /* self-order kiosks */
    [[-7.0, 5.6], [-7.0, 4.1]].forEach(([x, z]) => {
      op.box(x, 0.6, z, 0.56, 1.2, 0.34, { tile: T.PANEL, tint: C.dark, flat: 0.9 });
      op.box(x, 1.36, z, 0.7, 0.96, 0.26, { tile: T.PANEL, tint: C.dark, flat: 0.95 });
      op.box(x, 1.88, z, 0.76, 0.09, 0.32, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      em.quad([x - 0.29, 0.98, z + 0.135], [x + 0.29, 0.98, z + 0.135],
              [x + 0.29, 1.76, z + 0.135], [x - 0.29, 1.76, z + 0.135], { tile: T.MENU, tint: C.white, flat: 1 });
      solid(x - 0.36, x + 0.36, z - 0.22, z + 0.22, 1.6);
      shade(x, z, 1.2, 1.0, 0.85);
      round.push({ x, z, r: 0.5 });
    });

    /* framed wall art on the dining walls */
    [[-W + 0.09, 1, 3.0], [-W + 0.09, 1, 6.6], [W - 0.09, -1, 3.0], [W - 0.09, -1, 6.6]].forEach(([x, sg, z]) => {
      op.box(x, 1.85, z, 0.09, 1.1, 1.5, { tile: T.CHROME, tint: C.chrome });
      em.quad(sg > 0 ? [x + 0.05, 1.4, z - 0.62] : [x - 0.05, 1.4, z + 0.62],
              sg > 0 ? [x + 0.05, 1.4, z + 0.62] : [x - 0.05, 1.4, z - 0.62],
              sg > 0 ? [x + 0.05, 2.3, z + 0.62] : [x - 0.05, 2.3, z - 0.62],
              sg > 0 ? [x + 0.05, 2.3, z - 0.62] : [x - 0.05, 2.3, z + 0.62],
              { tile: z > 5 ? T.LOGO : T.SIGN_MENU, tint: C.white, flat: 1 });
    });

    /* lobby planters */
    [[-4.9, 0.2], [4.9, 0.2], [-11.0, 9.0 - 0.6], [11.0, 9.0 - 0.6]].forEach(([x, z]) => {
      op.box(x, 0.3, z, 0.66, 0.6, 0.66, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.box(x, 0.61, z, 0.72, 0.07, 0.72, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      op.cyl(x, 0.6, z, 0.28, 0.5, 6, { tile: T.LEAF, tint: C.green, flat: 1.0, rTop: 0.06 });
      op.cyl(x, 0.86, z, 0.34, 0.5, 6, { tile: T.LEAF, tint: C.greenLite, flat: 1.06, rTop: 0.03 });
      solid(x - 0.36, x + 0.36, z - 0.36, z + 0.36, 0.7);
      shade(x, z, 1.4, 1.4, 0.85);
      round.push({ x, z, r: 0.55 });
    });

    /* ---- kitchen ---- */
    const steel = { tile: T.CHROME, tint: C.chrome };

    (function grill() {
      const [x, z] = L.GRILL;
      capped(op, x, 0.45, z, 3.2, 0.9, 1.15, steel, C.chrome);
      op.box(x, 1.0, z, 3.0, 0.05, 0.95, { tile: T.BLANK, tint: 0x2b2f35, flat: 0.95 });
      op.box(x, 1.55, z - 0.5, 3.2, 0.1, 0.2, { tile: T.CHROME, tint: C.chrome });
      op.box(x, 1.95, z - 0.45, 3.4, 0.7, 0.7, { tile: T.CHROME, tint: C.chrome });
      op.box(x, 2.32, z - 0.45, 3.5, 0.08, 0.8, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      [-1.2, -0.4, 0.4, 1.2].forEach(o => op.cyl(x + o, 0.93, z + 0.62, 0.055, 0.06, 8, { tile: T.BLANK, tint: C.red, flat: 1.0 }));
      // hanging utensil rail
      op.box(x, 1.62, z - 0.02, 2.6, 0.04, 0.04, { tile: T.CHROME, tint: C.chrome });
      [-0.9, -0.3, 0.3, 0.9].forEach(o => op.box(x + o, 1.44, z - 0.02, 0.12, 0.34, 0.03, { tile: T.CHROME, tint: C.steel }));
      solid(x - 1.7, x + 1.7, z - 0.65, z + 0.65, 1.0);
      shade(x, z, 4.2, 2.1, 0.9);
    })();

    (function fryer() {
      const [x, z] = L.FRYER;
      capped(op, x, 0.45, z, 1.9, 0.9, 1.1, steel, C.chrome);
      [-0.45, 0.45].forEach(o => {
        op.box(x + o, 0.92, z, 0.8, 0.1, 0.7, { tile: T.BLANK, tint: 0x2b2f35, flat: 0.9 });
        op.box(x + o, 0.88, z, 0.72, 0.06, 0.62, { tile: T.BLANK, tint: 0xd9a83c, flat: 1.0 });
      });
      op.box(x, 1.9, z - 0.4, 2.1, 0.65, 0.65, { tile: T.CHROME, tint: C.chrome });
      op.box(x, 2.25, z - 0.4, 2.2, 0.08, 0.75, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      solid(x - 1.05, x + 1.05, z - 0.62, z + 0.62, 1.0);
      shade(x, z, 2.8, 2.0, 0.9);
    })();

    (function drinks() {
      const [x, z] = L.DRINKS;
      capped(op, x, 0.45, z, 1.8, 0.9, 0.9, steel, C.chrome);
      op.box(x, 1.62, z - 0.16, 1.7, 1.3, 0.6, { tile: T.PANEL, tint: C.dark, flat: 0.95 });
      em.quad([x - 0.8, 1.15, z + 0.145], [x + 0.8, 1.15, z + 0.145],
              [x + 0.8, 2.2, z + 0.145], [x - 0.8, 2.2, z + 0.145], { tile: T.SODA, tint: C.white, flat: 1 });
      op.box(x, 2.34, z - 0.16, 1.8, 0.12, 0.66, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      [-0.6, -0.2, 0.2, 0.6].forEach(o => op.box(x + o, 1.12, z + 0.24, 0.1, 0.2, 0.15, { tile: T.CHROME, tint: C.steel }));
      solid(x - 1.0, x + 1.0, z - 0.55, z + 0.55, 1.0);
      shade(x, z, 2.6, 1.8, 0.9);
    })();

    (function icecream() {
      const [x, z] = L.ICECREAM;
      capped(op, x, 0.45, z, 1.2, 0.9, 0.9, steel, C.chrome);
      op.box(x, 1.6, z, 1.1, 1.4, 0.85, { tile: T.CHROME, tint: C.white });
      op.box(x, 2.34, z, 1.18, 0.1, 0.92, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      op.box(x, 1.35, z + 0.42, 0.52, 0.52, 0.06, { tile: T.PANEL, tint: C.dark, flat: 0.95 });
      op.box(x, 1.02, z + 0.36, 0.1, 0.22, 0.1, { tile: T.CHROME, tint: C.steel });
      em.box(x, 1.62, z + 0.44, 0.36, 0.17, 0.02, { tile: T.MENU, tint: 0xbfe4ff, flat: 1 });
      solid(x - 0.65, x + 0.65, z - 0.5, z + 0.5, 1.0);
      shade(x, z, 2.0, 1.7, 0.9);
    })();

    capped(op, -0.2, 0.44, -3.1, 4.6, 0.88, 0.8, steel, C.chrome);
    solid(-2.6, 2.2, -3.55, -2.65, 0.95);
    shade(-0.2, -3.1, 5.4, 1.7, 0.9);

    for (let i = 0; i < 4; i++) {
      const x = -8.5 + i * 2.3;
      op.box(x, 1.05, -8.35, 2.0, 2.1, 1.0, { tile: T.CHROME, tint: C.white });
      op.box(x, 1.05, -7.83, 1.85, 1.9, 0.05, { tile: T.CHROME, tint: C.steel });
      op.box(x, 2.16, -8.35, 2.06, 0.1, 1.06, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      op.box(x + 0.7, 1.05, -7.78, 0.07, 1.0, 0.07, { tile: T.CHROME, tint: C.chrome });
      solid(x - 1.0, x + 1.0, -8.9, -7.8);
    }
    for (let i = 0; i < 3; i++) {
      const x = 3.2 + i * 2.4;
      [0.9, 1.5, 2.1].forEach(y => op.box(x, y, -8.45, 2.1, 0.06, 0.85, { tile: T.CHROME, tint: C.chrome }));
      for (let k = 0; k < 6; k++) {
        op.box(x - 0.8 + (k % 3) * 0.8, 1.05 + ((k / 3) | 0) * 0.6, -8.45, 0.6, 0.22, 0.5,
          { tile: T.PACK, tint: C.white, flat: 0.95 });
      }
      solid(x - 1.05, x + 1.05, -8.9, -8.0);
    }

    (function bin() {
      const [x, z] = L.TRASH;
      op.cyl(x, 0, z, 0.34, 0.9, 10, { tile: T.PANEL, tint: C.slate, flat: 0.9 });
      op.cyl(x, 0.9, z, 0.37, 0.1, 10, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      solid(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 1.0);
      shade(x, z, 1.3, 1.3, 0.85);
    })();

    op.decal(-2.4, 0.02, -4.35, 2.6, 0.22, { tile: T.STRIPE, tint: C.yellow, flat: 0.95 });
    op.cyl(-11.5, 0.9, -6.4, 0.11, 0.55, 8, { tile: T.BLANK, tint: C.red, flat: 1.0, closeBottom: true });
    op.box(-11.5, 1.52, -6.4, 0.1, 0.16, 0.1, { tile: T.CHROME, tint: C.dark });
    op.box(-11.86, 1.55, -5.2, 0.1, 0.42, 0.5, { tile: T.BLANK, tint: C.white, flat: 1.0 });
    op.box(-11.79, 1.55, -5.2, 0.04, 0.2, 0.06, { tile: T.BLANK, tint: C.green, flat: 1.0 });
    op.box(-11.79, 1.55, -5.2, 0.04, 0.06, 0.2, { tile: T.BLANK, tint: C.green, flat: 1.0 });
    // kitchen clock
    op.cyl(0.5, 0, -8.86, 0.26, 0.06, 12, { tile: T.CHROME, tint: C.chrome, flat: 1.0 });
    em.box(0.5, 2.7, -8.82, 0.44, 0.44, 0.03, { tile: T.BLANK, tint: 0xf4f6f8, flat: 1 });
    [[-1.6, C.red], [-1.35, C.yellow], [-1.1, 0x8a6a3a]].forEach(([x, col]) => {
      op.cyl(x, 0.92, -2.95, 0.05, 0.2, 8, { tile: T.BLANK, tint: col, flat: 1.0, closeBottom: true });
      op.cyl(x, 1.12, -2.95, 0.02, 0.05, 6, { tile: T.BLANK, tint: C.dark, flat: 1.0 });
    });
    [[-9.4, C.red], [-8.6, 0x3f7fd6], [-7.8, C.green]].forEach(([x, col]) => {
      op.box(x, 0.3, -3.1, 0.7, 0.6, 0.5, { tile: T.PANEL, tint: col, flat: 0.9 });
      op.box(x, 0.62, -3.1, 0.74, 0.05, 0.54, { tile: T.CHROME, tint: C.chrome });
    });

    /* ══════════════════════════ shared props ══════════════════════════ */

    function planter(b, x, z, s) {
      s = s || 1;
      b.box(x, 0.3 * s, z, 0.62 * s, 0.6 * s, 0.62 * s, { tile: T.BLANK, tint: C.cream, flat: 0.95 });
      b.box(x, 0.61 * s, z, 0.68 * s, 0.07 * s, 0.68 * s, { tile: T.BLANK, tint: C.red, flat: 1.0 });
      b.cyl(x, 0.6 * s, z, 0.26 * s, 0.5 * s, 6, { tile: T.LEAF, tint: C.green, flat: 1.0, rTop: 0.06 * s });
      b.cyl(x, 0.85 * s, z, 0.32 * s, 0.48 * s, 6, { tile: T.LEAF, tint: C.greenLite, flat: 1.05, rTop: 0.03 * s });
      shade(x, z, 1.3 * s, 1.3 * s, 0.85);
    }

    function tree(x, z, s) {
      s = s || 1;
      op.cyl(x, 0, z, 0.17 * s, 1.5 * s, 6, { tile: T.TRUNK, tint: C.trunk, flat: 0.9 });
      op.cyl(x, 1.25 * s, z, 1.25 * s, 1.5 * s, 7, { tile: T.LEAF, tint: C.greenDark, flat: 0.95, rTop: 0.7 * s });
      op.cyl(x, 2.35 * s, z, 0.95 * s, 1.3 * s, 7, { tile: T.LEAF, tint: C.green, flat: 1.05, rTop: 0.45 * s });
      op.cyl(x, 3.3 * s, z, 0.6 * s, 1.1 * s, 6, { tile: T.LEAF, tint: C.greenLite, flat: 1.12, rTop: 0.04 * s });
      shade(x, z, 2.8 * s, 2.8 * s, 0.72);
      solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
      round.push({ x, z, r: 0.6 });
    }

    function bush(x, z, s) {
      s = s || 1;
      op.cyl(x, 0, z, 0.55 * s, 0.5 * s, 6, { tile: T.LEAF, tint: C.greenDark, flat: 0.95, rTop: 0.5 * s });
      op.cyl(x, 0.42 * s, z, 0.45 * s, 0.42 * s, 6, { tile: T.LEAF, tint: C.green, flat: 1.08, rTop: 0.16 * s });
      shade(x, z, 1.5 * s, 1.5 * s, 0.78);
      round.push({ x, z, r: 0.55 * s });
    }

    function column(x, z, h) {
      op.cyl(x, 0, z, 0.26, 0.16, 10, { tile: T.CHROME, tint: C.chrome, flat: 0.85 });
      op.cyl(x, 0.14, z, 0.21, h - 0.42, 10, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.cyl(x, h - 0.3, z, 0.26, 0.16, 10, { tile: T.CHROME, tint: C.chrome, flat: 1.05 });
      op.cyl(x, h - 0.16, z, 0.23, 0.16, 10, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      solid(x - 0.26, x + 0.26, z - 0.26, z + 0.26);
      shade(x, z, 1.0, 1.0, 0.8);
      round.push({ x, z, r: 0.4 });
    }

    function umbrella(x, z) {
      op.cyl(x, 0, z, 0.055, 2.25, 8, { tile: T.CHROME, tint: C.chrome, flat: 0.9 });
      op.cyl(x, 1.9, z, 1.45, 0.62, 8, { tile: T.AWNING, tint: C.white, flat: 1.06, rTop: 0.06 });
      op.cyl(x, 1.86, z, 1.48, 0.09, 8, { tile: T.BLANK, tint: C.white, flat: 1.0 });
      op.cyl(x, 2.52, z, 0.07, 0.16, 6, { tile: T.CHROME, tint: C.chrome, flat: 1.1 });
      shade(x, z, 3.0, 3.0, 0.72);
    }

    function patioSet(x, z, y) {
      y = y || 0;
      op.at(x, y, z, 0, (b) => {
        b.cyl(0, 0.7, 0, 0.58, 0.06, 10, { tile: T.WOOD, tint: C.white, flat: 1.0, closeBottom: true });
        b.cyl(0, 0.755, 0, 0.6, 0.03, 10, { tile: T.CHROME, tint: C.chrome, flat: 1.0 });
        b.cyl(0, 0, 0, 0.07, 0.7, 8, { tile: T.CHROME, tint: C.steel, flat: 0.85 });
        b.cyl(0, 0, 0, 0.3, 0.05, 10, { tile: T.CHROME, tint: C.steel, flat: 0.8, closeBottom: true });
        [0, Math.PI * 0.66, Math.PI * 1.33].forEach(a => {
          const cx = Math.cos(a) * 1.05, cz = Math.sin(a) * 1.05;
          b.at(cx, 0, cz, -a, (q) => {
            q.box(0, 0.42, 0, 0.44, 0.08, 0.44, { tile: T.BLANK, tint: C.red, flat: 1.0 });
            q.box(0, 0.47, 0, 0.48, 0.035, 0.48, { tile: T.CHROME, tint: C.chrome });
            q.box(0.19, 0.7, 0, 0.07, 0.48, 0.44, { tile: T.BLANK, tint: C.red, flat: 1.0 });
            q.cyl(0, 0, 0, 0.05, 0.4, 6, { tile: T.CHROME, tint: C.steel, flat: 0.8 });
            q.cyl(0, 0, 0, 0.17, 0.04, 6, { tile: T.CHROME, tint: C.steel, flat: 0.78, closeBottom: true });
          });
        });
      });
      umbrella(x, z);
      round.push({ x, z, r: 1.5 });
      solid(x - 0.7, x + 0.7, z - 0.7, z + 0.7, 0.8);
    }

    function fenceRun(x0, z0, x1, z1, y) {
      y = y || 0;
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(len / 1.5));
      const ang = Math.atan2(dz, dx);
      for (let i = 0; i <= n; i++) {
        const px = x0 + dx * (i / n), pz = z0 + dz * (i / n);
        op.box(px, y + 0.5, pz, 0.13, 1.0, 0.13, { tile: T.PANEL, tint: C.white, flat: 1.0 });
        op.box(px, y + 1.03, pz, 0.19, 0.09, 0.19, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      }
      op.at((x0 + x1) / 2, 0, (z0 + z1) / 2, -ang, (b) => {
        [0.36, 0.76].forEach(h => b.box(0, y + h, 0, len, 0.1, 0.07, { tile: T.PANEL, tint: C.white, flat: 1.0 }));
      });
      solid(Math.min(x0, x1) - 0.12, Math.max(x0, x1) + 0.12, Math.min(z0, z1) - 0.12, Math.max(z0, z1) + 0.12, 1.0);
    }

    function car(x, z, col, rot) {
      op.at(x, 0, z, rot || 0, (b) => {
        // lower body, sitting on its wheels, with a bonnet and boot either end
        b.box(0, 0.66, 0, 1.86, 0.62, 4.2, { tile: T.BLANK, tint: col, flat: 1.0 });
        b.box(0, 0.99, 0, 1.9, 0.07, 4.24, { tile: T.CHROME, tint: C.chrome });
        // cabin, inset and shorter than the body so it reads as a car not a slab
        b.box(0, 1.34, 0.15, 1.62, 0.62, 2.0, { tile: T.BLANK, tint: col, flat: 1.05 });
        b.box(0, 1.30, 0.15, 1.66, 0.42, 2.04, { tile: T.BLANK, tint: 0x25303f, flat: 0.95 });
        b.box(0, 1.66, 0.15, 1.5, 0.1, 1.86, { tile: T.BLANK, tint: col, flat: 1.12 });
        // lamps, grille and plate
        b.box(-0.62, 0.78, 2.11, 0.5, 0.2, 0.06, { tile: T.NEON, tint: C.white, flat: 1.15 });
        b.box(0.62, 0.78, 2.11, 0.5, 0.2, 0.06, { tile: T.NEON, tint: C.white, flat: 1.15 });
        b.box(0, 0.6, 2.12, 1.3, 0.22, 0.05, { tile: T.DOTS, tint: C.steel, flat: 1.0 });
        b.box(-0.62, 0.78, -2.11, 0.5, 0.2, 0.06, { tile: T.BLANK, tint: 0xd8332a, flat: 1.1 });
        b.box(0.62, 0.78, -2.11, 0.5, 0.2, 0.06, { tile: T.BLANK, tint: 0xd8332a, flat: 1.1 });
        b.box(0, 0.55, -2.12, 0.7, 0.16, 0.05, { tile: T.BLANK, tint: C.white, flat: 1.05 });
        // wheels: a Y-axis cylinder rolled onto its side
        [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]].forEach(([ox, oz]) => {
          b.atE(ox, 0.37, oz, 0, 0, Math.PI / 2, (q) => {
            q.cyl(0, -0.1, 0, 0.37, 0.2, 10, { tile: T.BLANK, tint: 0x191c22, flat: 0.9, closeBottom: true });
            q.cyl(0, -0.11, 0, 0.19, 0.22, 10, { tile: T.CHROME, tint: C.chrome, flat: 1.05, closeBottom: true });
          });
          b.box(ox * 1.0, 0.72, oz, 0.12, 0.5, 0.9, { tile: T.BLANK, tint: 0x1c2028, flat: 0.75 });
        });
      });
      shade(x, z, 3.2, 5.4, 0.78);
      const w = Math.abs(Math.cos(rot || 0)) * 1.0 + Math.abs(Math.sin(rot || 0)) * 2.2;
      const d = Math.abs(Math.cos(rot || 0)) * 2.2 + Math.abs(Math.sin(rot || 0)) * 1.0;
      solid(x - w, x + w, z - d, z + d);
    }

    /* the hero prop — an oversized burger on the roof, the thing you see first */
    function bigBurger(x, y, z, s) {
      op.at(x, y, z, 0, (b) => {
        b.cyl(0, 0, 0, 1.5 * s, 0.34 * s, 14, { tile: T.BLANK, tint: 0xe8b96a, flat: 1.0, closeBottom: true });
        b.cyl(0, 0.32 * s, 0, 1.62 * s, 0.22 * s, 14, { tile: T.BLANK, tint: 0x63381f, flat: 0.98 });
        b.cyl(0, 0.52 * s, 0, 1.72 * s, 0.1 * s, 14, { tile: T.BLANK, tint: 0x6fc23f, flat: 1.08 });
        b.cyl(0, 0.60 * s, 0, 1.55 * s, 0.12 * s, 4, { tile: T.BLANK, tint: 0xffb62e, flat: 1.1 });
        b.cyl(0, 0.70 * s, 0, 1.58 * s, 0.34 * s, 14, { tile: T.BLANK, tint: 0xf0c073, flat: 1.05, rTop: 1.34 * s });
        b.cyl(0, 1.02 * s, 0, 1.34 * s, 0.34 * s, 14, { tile: T.BLANK, tint: 0xf2c67b, flat: 1.12, rTop: 0.62 * s });
        // sesame seeds
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + i * 0.7;
          const rr = (0.45 + (i % 3) * 0.24) * s;
          b.box(Math.cos(a) * rr, (1.30 - (rr / s) * 0.16) * s, Math.sin(a) * rr,
            0.13 * s, 0.05 * s, 0.09 * s, { tile: T.BLANK, tint: 0xfff2d0, flat: 1.18 });
        }
      });
    }

    /* ══════════════════════════ exterior ══════════════════════════ */

    const EX = W + 0.45, EZ = D + 0.45;
    const EW = W + 0.02, ED = D + 0.02;   // outside faces, coplanar with the inside walls
    const DADO = 0.9;

    /* Outward-facing wall quads. Building the outside in bands — rather than as one
       solid box — is what lets the windows and the doorway actually read as openings
       from the car park instead of the shell blanking them off. */
    const outQ = (x0, y0, z0, x1, y1, z1, opt) => {
      if (x0 === x1) {
        const A = [x0, y0, z0], B = [x0, y0, z1], Cc = [x0, y1, z1], Dd = [x0, y1, z0];
        return op.tiled.apply(op, x0 > 0 ? [Dd, Cc, B, A, opt] : [A, B, Cc, Dd, opt]);
      }
      const A = [x0, y0, z0], B = [x1, y0, z0], Cc = [x1, y1, z0], Dd = [x0, y1, z0];
      return op.tiled.apply(op, z0 > 0 ? [A, B, Cc, Dd, opt] : [Dd, Cc, B, A, opt]);
    };

    const checkOut = { tile: T.CHECKER, rep: 0.62, tint: C.white, flat: 1.0 };
    const stucOut = { tile: T.STUCCO, rep: 2.0, tint: C.bone, flat: 1.0 };

    /* front elevation: check base, glazing either side of the doorway */
    [[-EW, -dw], [dw, EW]].forEach(([a, b]) => {
      const sg = Math.sign(b - a);
      outQ(a, 0, ED, b, DADO, ED, checkOut);
      outQ(a, DADO, ED, b, winY0, ED, stucOut);
      outQ(a, winY1, ED, b, 3.02, ED, stucOut);
      outQ(a, winY0, ED, a + sg * 0.35, winY1, ED, stucOut);
      outQ(b - sg * 0.35, winY0, ED, b, winY1, ED, stucOut);
    });
    outQ(-dw, 2.35, ED, dw, 3.02, ED, stucOut);

    /* side elevations: solid over the kitchen, glazed over the dining room */
    [-EW, EW].forEach(x => {
      outQ(x, 0, -ED, x, DADO, L.COUNTER_Z, checkOut);
      outQ(x, 0, L.COUNTER_Z, x, DADO, ED, checkOut);
      outQ(x, DADO, L.COUNTER_Z, x, winY0, ED, stucOut);
      outQ(x, winY1, L.COUNTER_Z, x, 3.02, ED, stucOut);
      if (x < 0) {
        // leave a gap for the drive-thru collection window
        outQ(x, DADO, -ED, x, 1.0, L.COUNTER_Z, stucOut);
        outQ(x, 1.0, -ED, x, 2.3, -4.5, stucOut);
        outQ(x, 1.0, -2.5, x, 2.3, L.COUNTER_Z, stucOut);
        outQ(x, 2.3, -ED, x, 3.02, L.COUNTER_Z, stucOut);
      } else {
        outQ(x, DADO, -ED, x, 3.02, L.COUNTER_Z, stucOut);
      }
    });

    /* rear elevation */
    outQ(-EW, 0, -ED, EW, DADO, -ED, checkOut);
    outQ(-EW, DADO, -ED, EW, 3.02, -ED, stucOut);

    op.box(0, 0.95, 0, EW * 2 + 0.07, 0.09, ED * 2 + 0.07, { tile: T.CHROME, tint: C.chrome, skip: { top: true, bottom: true } });
    op.box(0, 3.02, 0, EX * 2 + 0.08, 0.12, EZ * 2 + 0.08, { tile: T.CHROME, tint: C.chrome, skip: { top: true, bottom: true } });
    op.box(0, 3.62, 0, EX * 2 + 0.3, 1.1, EZ * 2 + 0.3, { tile: T.ROOF, rep: 1.4, tint: C.red, skip: { top: true, bottom: true } });
    op.box(0, 4.24, 0, EX * 2 + 0.55, 0.18, EZ * 2 + 0.55, { tile: T.CHROME, tint: C.chrome });
    op.box(0, 4.4, 0, EX * 2, 0.14, EZ * 2, { tile: T.BLANK, tint: 0x8d97a3, flat: 0.9 });

    /* rooftop plant */
    [[-7, -5], [-7, 2], [6, -4]].forEach(([x, z]) => {
      op.box(x, 4.85, z, 2.2, 0.8, 1.6, { tile: T.CHROME, tint: C.steel, flat: 0.95 });
      op.box(x, 5.29, z, 2.3, 0.1, 1.7, { tile: T.CHROME, tint: C.chrome });
    });

    /* entrance parapet, the big sign and the hero burger */
    op.box(0, 5.4, EZ - 0.35, 13.0, 2.1, 1.1, { tile: T.PANEL, tint: C.white, flat: 1.0 });
    op.box(0, 6.5, EZ - 0.35, 13.4, 0.24, 1.35, { tile: T.CHROME, tint: C.chrome });
    op.box(0, 4.4, EZ - 0.35, 13.4, 0.26, 1.35, { tile: T.BLANK, tint: C.red, flat: 1.05 });
    op.box(0, 5.42, EZ + 0.24, 11.6, 1.5, 0.1, { tile: T.BLANK, tint: C.red, flat: 1.0 });
    em.quad([-5.6, 4.75, EZ + 0.30], [5.6, 4.75, EZ + 0.30], [5.6, 6.1, EZ + 0.30], [-5.6, 6.1, EZ + 0.30],
      { tile: T.SIGN_NAME, tint: C.white, flat: 1 });
    em.quad([5.6, 4.75, EZ - 0.92], [-5.6, 4.75, EZ - 0.92], [-5.6, 6.1, EZ - 0.92], [5.6, 6.1, EZ - 0.92],
      { tile: T.SIGN_NAME, tint: C.white, flat: 1 });
    op.cyl(0, 6.5, EZ - 0.35, 2.1, 0.5, 14, { tile: T.BLANK, tint: C.red, flat: 1.05 });
    op.cyl(0, 6.94, EZ - 0.35, 2.2, 0.12, 14, { tile: T.CHROME, tint: C.chrome, flat: 1.1 });
    bigBurger(0, 7.05, EZ - 0.35, 1.15);

    /* entrance canopy on white columns */
    const canZ0 = EZ, canZ1 = EZ + 3.6;
    op.box(0, 3.42, (canZ0 + canZ1) / 2, 19.0, 0.34, canZ1 - canZ0, { tile: T.ROOF, rep: 1.6, tint: C.red });
    op.box(0, 3.63, (canZ0 + canZ1) / 2, 19.4, 0.12, canZ1 - canZ0 + 0.4, { tile: T.CHROME, tint: C.chrome });
    op.box(0, 3.2, (canZ0 + canZ1) / 2, 19.0, 0.12, canZ1 - canZ0, { tile: T.PANEL, tint: C.white, flat: 1.0 });
    for (let i = 0; i < 8; i++) {
      op.box(-8.4 + i * 2.4, 3.24, canZ1 - 0.05, 1.7, 0.4, 0.14, { tile: T.CHECKER, rep: 0.42, tint: C.white, flat: 1.0 });
    }
    [-8.8, -5.4, 5.4, 8.8].forEach(x => column(x, canZ1 - 0.5, 3.24));
    [-8.8, 8.8].forEach(x => column(x, canZ0 + 0.5, 3.24));

    /* sidewalk + patio deck */
    op.tiled([-16, 0.02, canZ1 + 3.2], [16, 0.02, canZ1 + 3.2], [16, 0.02, -EZ - 3], [-16, 0.02, -EZ - 3],
      { tile: T.CONCRETE, rep: 2.0, tint: C.white, flat: 0.95 });
    op.box(0, 0.09, (canZ0 + canZ1 + 1.4) / 2, 18.4, 0.18, canZ1 - canZ0 + 1.4, { tile: T.DECK, rep: 1.1, tint: C.white, flat: 1.0 });
    op.box(0, 0.19, canZ1 + 0.68, 18.6, 0.06, 0.16, { tile: T.BLANK, tint: C.red, flat: 1.05 });

    patioSet(-7.0, canZ1 - 1.6, 0.18);
    patioSet(-3.6, canZ1 + 0.1, 0.18);
    patioSet(3.6, canZ1 + 0.1, 0.18);
    patioSet(7.0, canZ1 - 1.6, 0.18);

    fenceRun(-9.4, canZ1 + 1.1, -2.1, canZ1 + 1.1, 0.18);
    fenceRun(2.1, canZ1 + 1.1, 9.4, canZ1 + 1.1, 0.18);
    fenceRun(-9.4, canZ0 - 0.2, -9.4, canZ1 + 1.1, 0.18);
    fenceRun(9.4, canZ0 - 0.2, 9.4, canZ1 + 1.1, 0.18);

    [-10.6, 10.6].forEach(x => { planter(op, x, canZ1 - 0.4, 1.15); planter(op, x, canZ0 + 1.2, 1.15); });
    planter(op, -2.6, canZ1 + 1.9, 1.0);
    planter(op, 2.6, canZ1 + 1.9, 1.0);

    /* lawns and landscaping */
    const lawn = (x0, x1, z0, z1) => op.tiled([x0, 0.03, z1], [x1, 0.03, z1], [x1, 0.03, z0], [x0, 0.03, z0],
      { tile: T.GRASS, rep: 2.4, tint: C.white, flat: 1.0 });
    lawn(-30, -16.2, -14, 36);
    lawn(16.2, 30, -14, 36);
    lawn(-16, 16, canZ1 + 3.4, canZ1 + 6.4);
    lawn(-30, 30, -22, -12.2);
    [[-16.1, 1], [16.1, -1]].forEach(([x, s]) => {
      for (let z = -13; z < 35; z += 1.4) op.box(x, 0.09, z, 0.34, 0.16, 1.4, { tile: T.CURB, tint: C.white, flat: 1.0 });
    });

    [[-19, 14], [-22, 6], [-19, -2], [-21, -9], [19, 14], [22, 6], [19, -2], [21, -9],
     [-24, 20], [24, 20], [-13, 20.5], [13, 20.5]].forEach(([x, z], i) => tree(x, z, 0.85 + (i % 3) * 0.16));
    [[-17.4, 10], [-17.4, 2], [-17.4, -6], [17.4, 10], [17.4, 2], [17.4, -6],
     [-11, canZ1 + 4.6], [-5, canZ1 + 4.6], [5, canZ1 + 4.6], [11, canZ1 + 4.6]]
      .forEach(([x, z], i) => bush(x, z, 0.85 + (i % 2) * 0.2));

    /* car park */
    const lotZ0 = canZ1 + 6.6, lotZ1 = 34;
    op.tiled([-16, 0.01, lotZ1], [16, 0.01, lotZ1], [16, 0.01, lotZ0], [-16, 0.01, lotZ0],
      { tile: T.ASPHALT, rep: 3.0, tint: C.white, flat: 0.95 });
    const rowA = lotZ0 + 3.0, rowB = lotZ0 + 11.5;
    for (let i = -5; i <= 5; i++) {
      op.decal(i * 2.8, 0.025, rowA, 0.16, 5.4, { tile: T.BLANK, tint: 0xf2ead2, flat: 1.0 });
      op.decal(i * 2.8, 0.025, rowB, 0.16, 5.4, { tile: T.BLANK, tint: 0xf2ead2, flat: 1.0 });
    }
    op.decal(0, 0.022, (rowA + rowB) / 2, 30, 0.18, { tile: T.BLANK, tint: 0xe8dfc4, flat: 1.0 });
    car(-9.8, rowA, 0xd8352b, 0);
    car(-4.2, rowA, 0x2f6fc4, 0);
    car(4.2, rowA, 0xf2f4f6, 0);
    car(12.6, rowA, 0x33383f, 0);
    car(-7.0, rowB, 0x3fae62, Math.PI);
    car(1.4, rowB, 0xe8a72c, Math.PI);
    car(9.8, rowB, 0x7a4fd0, Math.PI);
    [[-15.2, rowA], [15.2, rowA], [-15.2, rowB + 2], [15.2, rowB + 2]].forEach(([x, z]) => {
      op.cyl(x, 0.02, z, 0.11, 4.6, 8, { tile: T.CHROME, tint: C.steel, flat: 0.9 });
      op.box(x, 4.8, z, 0.9, 0.26, 0.5, { tile: T.CHROME, tint: C.chrome });
      em.box(x, 4.63, z, 0.78, 0.08, 0.4, { tile: T.NEON, tint: C.white, flat: 1 });
      solid(x - 0.2, x + 0.2, z - 0.2, z + 0.2);
    });

    /* drive-thru on the kitchen side */
    op.tiled([-22.5, 0.015, 18], [-16.6, 0.015, 18], [-16.6, 0.015, -12], [-22.5, 0.015, -12],
      { tile: T.ASPHALT, rep: 3.0, tint: C.white, flat: 0.95 });
    for (let z = -10; z < 17; z += 3.2) {
      op.decal(-19.5, 0.03, z, 0.22, 1.7, { tile: T.BLANK, tint: 0xf2ead2, flat: 1.0 });
    }
    (function driveThru() {
      const x = -18.2, z = 7.5;
      op.box(x, 1.35, z, 0.35, 2.7, 2.6, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.box(x, 2.78, z, 0.55, 0.26, 2.9, { tile: T.BLANK, tint: C.red, flat: 1.05 });
      em.quad([x + 0.19, 0.9, z + 1.1], [x + 0.19, 0.9, z - 1.1], [x + 0.19, 2.4, z - 1.1], [x + 0.19, 2.4, z + 1.1],
        { tile: T.MENU, tint: C.white, flat: 1 });
      em.quad([x - 0.19, 1.2, z - 1.1], [x - 0.19, 1.2, z + 1.1], [x - 0.19, 2.3, z + 1.1], [x - 0.19, 2.3, z - 1.1],
        { tile: T.SIGN_MENU, tint: C.white, flat: 1 });
      solid(x - 0.4, x + 0.4, z - 1.4, z + 1.4);
      // overhead DRIVE THRU gantry
      op.cyl(-16.9, 0, 13.5, 0.14, 4.4, 8, { tile: T.CHROME, tint: C.steel, flat: 0.9 });
      op.cyl(-21.8, 0, 13.5, 0.14, 4.4, 8, { tile: T.CHROME, tint: C.steel, flat: 0.9 });
      op.box(-19.35, 4.7, 13.5, 5.4, 1.3, 0.36, { tile: T.PANEL, tint: C.white, flat: 1.0 });
      op.box(-19.35, 5.45, 13.5, 5.7, 0.2, 0.5, { tile: T.CHROME, tint: C.chrome });
      em.quad([-21.9, 4.2, 13.31], [-16.8, 4.2, 13.31], [-16.8, 5.2, 13.31], [-21.9, 5.2, 13.31],
        { tile: T.SIGN_DRIVE, tint: C.white, flat: 1 });
      em.quad([-16.8, 4.2, 13.69], [-21.9, 4.2, 13.69], [-21.9, 5.2, 13.69], [-16.8, 5.2, 13.69],
        { tile: T.SIGN_DRIVE, tint: C.white, flat: 1 });
      solid(-17.1, -16.7, 13.3, 13.7); solid(-22.0, -21.6, 13.3, 13.7);
      // collection window in the west wall
      op.box(-EX - 0.1, 1.55, -3.5, 0.25, 1.5, 2.0, { tile: T.CHROME, tint: C.chrome });
      gl.quad([-EX - 0.24, 1.0, -4.4], [-EX - 0.24, 1.0, -2.6], [-EX - 0.24, 2.2, -2.6], [-EX - 0.24, 2.2, -4.4],
        { tile: T.GLASS, tint: C.white, flat: 1 });
      op.box(-EX - 0.35, 3.0, -3.5, 0.9, 0.2, 2.6, { tile: T.ROOF, tint: C.red, flat: 1.05 });
    })();

    /* pylon sign by the road */
    op.box(-14.6, 0.12, 20.5, 1.6, 0.24, 1.6, { tile: T.CONCRETE, tint: C.white, flat: 0.95 });
    op.cyl(-14.6, 0.2, 20.5, 0.34, 6.4, 8, { tile: T.CHROME, tint: C.chrome, flat: 0.95 });
    op.box(-14.6, 7.4, 20.5, 3.6, 2.2, 0.5, { tile: T.PANEL, tint: C.white, flat: 1.0 });
    op.box(-14.6, 8.6, 20.5, 3.9, 0.26, 0.7, { tile: T.CHROME, tint: C.chrome });
    op.box(-14.6, 6.2, 20.5, 3.9, 0.24, 0.7, { tile: T.BLANK, tint: C.red, flat: 1.05 });
    em.box(-14.6, 7.4, 20.5, 3.3, 1.7, 0.56, { tile: T.LOGO, tint: C.white, flat: 1 });
    em.box(-14.6, 9.6, 20.5, 2.0, 1.6, 0.34, { tile: T.SIGN_OPEN, tint: C.white, flat: 1 });
    solid(-15.4, -13.8, 19.7, 21.3);

    /* ground plane and low-poly skyline */
    op.quad([-95, -0.04, 95], [95, -0.04, 95], [95, -0.04, -95], [-95, -0.04, -95],
      { tile: T.BLANK, tint: 0x63b04c, flat: 1.0 });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rnd() * 0.22;
      const d = 52 + rnd() * 26;
      const h = 4 + rnd() * 13;
      op.box(Math.cos(a) * d, h / 2, Math.sin(a) * d, 6 + rnd() * 7, h, 6 + rnd() * 7,
        { tile: T.PANEL, tint: [150 + rnd() * 55 | 0, 158 + rnd() * 50 | 0, 172 + rnd() * 50 | 0], flat: 1.0 });
      op.box(Math.cos(a) * d, h + 0.3, Math.sin(a) * d, 6.6 + rnd() * 7, 0.5, 6.6 + rnd() * 7,
        { tile: T.BLANK, tint: 0xb9c2cc, flat: 1.0 });
    }

    /* chunky low-poly clouds */
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2 + rnd();
      const d = 34 + rnd() * 30;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 20 + rnd() * 12;
      const s = 2.4 + rnd() * 2.2;
      op.box(cx, cy, cz, s * 3.1, s * 1.05, s * 2.3, { tile: T.BLANK, tint: C.white, flat: 1.15 });
      op.box(cx - s * 0.75, cy + s * 0.5, cz + s * 0.25, s * 1.7, s * 1.0, s * 1.5, { tile: T.BLANK, tint: C.white, flat: 1.2 });
      op.box(cx + s * 0.8, cy + s * 0.42, cz - s * 0.2, s * 1.4, s * 0.85, s * 1.3, { tile: T.BLANK, tint: C.white, flat: 1.18 });
    }

    /* keep the player inside a sane area */
    solid(-31, 31, 37, 38); solid(-31, 31, -25, -24);
    solid(-31, -30, -25, 38); solid(30, 31, -25, 38);

    return {
      opaque: op.build(), emis: em.build(), decal: dc.build(), glass: gl.build(),
      solids, round, L,
    };
  }

  g.World = { build, L, C };
})(window);
