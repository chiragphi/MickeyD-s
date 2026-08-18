/* The restaurant. Built once at load into four static meshes:
     opaque   — one draw call for the entire building
     emissive — unlit surfaces (menu boards, light panels, signage)
     decal    — multiply-blended contact shadows (fake AO, costs one blended pass)
     glass    — alpha-blended windows, drawn last
   Also emits collision boxes, interaction points and NPC navigation data. */
(function (g) {
  'use strict';
  const T = g.Atlas.T;

  const L = {
    W: 12, D: 9, H: 3.45,           // interior half-width, half-depth, ceiling height
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
    TABLES: [
      [-9.6, 1.4], [-9.6, 4.6], [-9.6, 7.6], [-6.0, 2.8], [-6.0, 6.4],
      [9.6, 1.4], [9.6, 4.6], [9.6, 7.6], [6.0, 2.8], [6.0, 6.4],
    ],
    PLAYER_SPAWN: [0, -2.0, Math.PI],
  };

  L.SEATS = [];
  L.TABLES.forEach((t, ti) => {
    [[-1.0, 0], [1.0, 0], [0, -1.0], [0, 1.0]].forEach((o) => {
      L.SEATS.push({ x: t[0] + o[0], z: t[1] + o[1], table: ti, taken: -1,
        yaw: Math.atan2(-o[0], -o[1]) });
    });
  });

  function build() {
    const opaque = new g.Geom.MeshBuilder();
    const emis = new g.Geom.MeshBuilder();
    const decal = new g.Geom.MeshBuilder();
    const glass = new g.Geom.MeshBuilder();
    const solids = [];
    const round = [];   // circular obstacles for NPC steering

    const solid = (x0, x1, z0, z1, h) => { solids.push({ x0, x1, z0, z1, h: h === undefined ? 3 : h }); };
    const shadow = (x, z, sx, sz, a) => decal.decal(x, 0.012, z, sx, sz, { tint: [255, 255, 255], flat: a === undefined ? 1 : a });

    const W = L.W, D = L.D, H = L.H;

    /* ---------------- floor ---------------- */
    // dining
    opaque.tiled([-W, 0, D], [W, 0, D], [W, 0, L.COUNTER_Z], [-W, 0, L.COUNTER_Z],
      { tile: T.FLOOR, rep: 1.2, tint: 0xffffff, flat: 0.9 });
    // kitchen — darker non-slip
    opaque.tiled([-W, 0, L.COUNTER_Z], [W, 0, L.COUNTER_Z], [W, 0, -D], [-W, 0, -D],
      { tile: T.TILEWALL, rep: 0.62, tint: 0xa9a29a, flat: 0.9 });
    // entry mat
    opaque.decal(0, 0.014, 7.6, 4.2, 2.4, { tile: T.CONCRETE, tint: 0x3f444c, flat: 0.95 });

    /* ---------------- ceiling ---------------- */
    opaque.tiled([-W, H, -D], [W, H, -D], [W, H, D], [-W, H, D],
      { tile: T.CEIL, rep: 1.6, tint: 0xfbfcfd, flat: 1.0 });

    /* light panels */
    for (let ix = -3; ix <= 3; ix++) {
      for (let iz = -2; iz <= 2; iz++) {
        const x = ix * 3.2, z = iz * 3.4;
        opaque.box(x, H - 0.06, z, 1.76, 0.12, 0.86, { tile: T.STEEL, tint: 0xdfe3e8, flat: 0.95 });
        emis.box(x, H - 0.145, z, 1.62, 0.05, 0.72, { tile: T.BLANK, tint: 0xfffaf0, flat: 1 });
      }
    }

    /* ---------------- walls ---------------- */
    const wallOpt = { tile: T.PANEL, rep: 1.7, tint: 0xf3f2ee, flat: 0.95 };
    const kitchenWall = { tile: T.TILEWALL, rep: 1.1, tint: 0xffffff, flat: 0.95 };

    /* Interior walls face *into* the room: the quad's visible side is the side its
       normal points at, so the point order below is the inward-facing winding. */
    const wallIn = (x0, y0, z0, x1, y1, z1, opt) => {
      // rectangle spanning the two corners, wound so the normal points inward
      if (x0 === x1) {           // wall in the YZ plane
        const inward = x0 < 0 ? 1 : -1;
        const A = [x0, y0, z0], B = [x0, y0, z1], C = [x0, y1, z1], Dd = [x0, y1, z0];
        return opaque.tiled.apply(opaque, inward > 0 ? [Dd, C, B, A, opt] : [A, B, C, Dd, opt]);
      }
      const inward = z0 < 0 ? 1 : -1; // wall in the XY plane
      const A = [x0, y0, z0], B = [x1, y0, z0], C = [x1, y1, z0], Dd = [x0, y1, z0];
      return opaque.tiled.apply(opaque, inward > 0 ? [A, B, C, Dd, opt] : [Dd, C, B, A, opt]);
    };

    // back (kitchen) wall + kitchen side walls
    wallIn(-W, 0, -D, W, H, -D, kitchenWall);
    wallIn(-W, 0, -D, -W, H, L.COUNTER_Z, kitchenWall);
    wallIn(W, 0, -D, W, H, L.COUNTER_Z, kitchenWall);

    /* dining side walls: solid below/above a long window band */
    const winY0 = 0.95, winY1 = 2.65;
    [[-W, 1], [W, -1]].forEach(([x, s]) => {
      wallIn(x, 0, L.COUNTER_Z, x, winY0, D, wallOpt);
      wallIn(x, winY1, L.COUNTER_Z, x, H, D, wallOpt);
      // window glass (drawn double-sided so it reads from the car park too)
      const gq = (z0, z1) => glass.quad(
        [x + s * 0.02, winY0, z0], [x + s * 0.02, winY0, z1],
        [x + s * 0.02, winY1, z1], [x + s * 0.02, winY1, z0],
        { tile: T.GLASS, tint: 0xffffff, flat: 1 });
      gq(L.COUNTER_Z + 0.1, D - 0.1);
      for (let z = L.COUNTER_Z + 0.1; z <= D; z += 2.0) {
        opaque.box(x - s * 0.06, (winY0 + winY1) / 2, z, 0.12, winY1 - winY0 + 0.1, 0.09,
          { tile: T.STEEL, tint: 0x8d939b, flat: 0.9 });
      }
      opaque.box(x - s * 0.09, winY0 - 0.05, (L.COUNTER_Z + D) / 2, 0.2, 0.12, D - L.COUNTER_Z,
        { tile: T.STEEL, tint: 0x9aa1a9, flat: 0.95 });
    });

    /* front wall with doorway */
    const dw = L.DOOR_W / 2;
    [[-W, -dw], [dw, W]].forEach(([a, b]) => {
      wallIn(a, 0, D, b, winY0, D, wallOpt);
      wallIn(a, winY1, D, b, H, D, wallOpt);
      wallIn(a, winY0, D, a + Math.sign(b - a) * 0.35, winY1, D, wallOpt);
      wallIn(b - Math.sign(b - a) * 0.35, winY0, D, b, winY1, D, wallOpt);
      glass.quad([a + 0.35, winY0, D - 0.02], [b - 0.35, winY0, D - 0.02],
                 [b - 0.35, winY1, D - 0.02], [a + 0.35, winY1, D - 0.02],
                 { tile: T.GLASS, tint: 0xffffff, flat: 1 });
      opaque.box((a + b) / 2, (winY0 + winY1) / 2, D - 0.06, b - a - 0.6, 0.1, 0.12,
        { tile: T.STEEL, tint: 0x8d939b, flat: 0.9 });
      for (let x = a + 2.2; x < b - 0.5; x += 2.2) {
        opaque.box(x, (winY0 + winY1) / 2, D - 0.06, 0.1, winY1 - winY0, 0.12, { tile: T.STEEL, tint: 0x8d939b, flat: 0.9 });
      }
    });
    wallIn(-dw, 2.35, D, dw, H, D, wallOpt);
    // door frame + glass doors
    opaque.box(0, 1.18, D, 0.14, 2.35, 0.16, { tile: T.STEEL, tint: 0xb03a2c, flat: 0.95 });
    [-1, 1].forEach(s => {
      opaque.box(s * (dw - 0.05), 1.18, D, 0.12, 2.35, 0.16, { tile: T.STEEL, tint: 0xb03a2c, flat: 0.95 });
      glass.quad([s > 0 ? 0.08 : -dw + 0.1, 0.1, D - 0.03], [s > 0 ? dw - 0.1 : -0.08, 0.1, D - 0.03],
        [s > 0 ? dw - 0.1 : -0.08, 2.3, D - 0.03], [s > 0 ? 0.08 : -dw + 0.1, 2.3, D - 0.03],
        { tile: T.GLASS, flat: 1 });
      opaque.box(s * 0.35, 1.15, D - 0.09, 0.05, 0.9, 0.05, { tile: T.STEEL, tint: 0xd8dade, flat: 1 });
    });
    emis.box(0, 2.5, D - 0.12, 1.1, 0.28, 0.04, { tile: T.LOGO, tint: 0xffffff, flat: 1 });

    // wall colliders
    solid(-W - 1, -W, -D - 1, D + 1); solid(W, W + 1, -D - 1, D + 1);
    solid(-W - 1, W + 1, -D - 1, -D);
    solid(-W - 1, -dw, D, D + 1); solid(dw, W + 1, D, D + 1);

    /* ---------------- service counter ---------------- */
    const cz = L.COUNTER_Z, cd = L.COUNTER_D, ch = L.COUNTER_H;
    opaque.box((L.COUNTER_X0 + L.COUNTER_X1) / 2, ch / 2, cz, L.COUNTER_X1 - L.COUNTER_X0, ch, cd,
      { tile: T.PANEL, tiles: { top: T.STEEL }, tint: 0xe8e6e1, rep: 1.4, flat: undefined });
    opaque.box((L.COUNTER_X0 + L.COUNTER_X1) / 2, ch + 0.03, cz, L.COUNTER_X1 - L.COUNTER_X0 + 0.14, 0.07, cd + 0.14,
      { tile: T.STEEL, tint: 0xcfd4d9 });
    opaque.box((L.COUNTER_X0 + L.COUNTER_X1) / 2, 0.12, cz + cd / 2 + 0.02, L.COUNTER_X1 - L.COUNTER_X0, 0.24, 0.06,
      { tile: T.BLANK, tint: 0xda291c, flat: 0.8 });
    for (let x = L.COUNTER_X0 + 1.5; x < L.COUNTER_X1; x += 1.5) {
      opaque.box(x, 0.62, cz + cd / 2 + 0.015, 0.05, 0.78, 0.02, { tile: T.BLANK, tint: 0xc8c4bc, flat: 0.86 });
    }
    opaque.box((L.COUNTER_X0 + L.COUNTER_X1) / 2, 0.99, cz + cd / 2 + 0.015, L.COUNTER_X1 - L.COUNTER_X0, 0.03, 0.02,
      { tile: T.BLANK, tint: 0xb9b5ad, flat: 0.9 });
    solid(L.COUNTER_X0 - 0.1, L.COUNTER_X1 + 0.1, cz - cd / 2 - 0.1, cz + cd / 2 + 0.1);
    shadow((L.COUNTER_X0 + L.COUNTER_X1) / 2, cz + 0.5, L.COUNTER_X1 - L.COUNTER_X0 + 1.2, 2.6, 0.85);

    /* registers */
    [-2.0, -5.2].forEach((x, i) => {
      opaque.box(x, ch + 0.16, cz - 0.05, 0.44, 0.2, 0.34, { tile: T.PANEL, tint: 0x3d434c, flat: 0.9 });
      opaque.box(x, ch + 0.34, cz - 0.14, 0.42, 0.3, 0.06, { tile: T.PANEL, tint: 0x2a2e34, flat: 0.9 });
      emis.box(x, ch + 0.34, cz - 0.185, 0.36, 0.24, 0.02, { tile: T.MENU, tint: 0xffffff, flat: 1 });
      emis.box(x, ch + 0.16, cz + 0.135, 0.30, 0.12, 0.02, { tile: T.MENU, tint: 0xdde8ff, flat: 1 });
    });

    /* pickup zone: heat lamps + trays */
    // heat lamps hang from the menu-board soffit so nothing blocks the pass
    opaque.box(3, ch + 1.02, cz - 0.16, 2.5, 0.08, 0.42, { tile: T.STEEL, tint: 0xb9bfc6 });
    [2.1, 3.9].forEach(x => opaque.box(x, ch + 1.35, cz - 0.16, 0.04, 0.6, 0.04, { tile: T.STEEL, tint: 0x9aa0a7 }));
    [2.3, 3.0, 3.7].forEach(x => emis.box(x, ch + 0.97, cz - 0.16, 0.5, 0.04, 0.3, { tile: T.BLANK, tint: 0xffb15a, flat: 1 }));
    opaque.box(3, ch + 0.09, cz + 0.06, 1.9, 0.05, 0.45, { tile: T.STEEL, tint: 0xdfe3e7 });

    /* menu boards above the counter */
    opaque.box(-3.6, 2.68, cz - 0.42, 6.7, 1.1, 0.13, { tile: T.STEEL, tint: 0xb2b8bf });
    opaque.box(-3.6, 2.68, cz - 0.365, 6.6, 1.0, 0.03, { tile: T.PANEL, tint: 0x1b1e23, flat: 0.9 });
    emis.quad([-6.85, 2.23, cz - 0.345], [-0.35, 2.23, cz - 0.345], [-0.35, 3.13, cz - 0.345], [-6.85, 3.13, cz - 0.345],
      { tile: T.MENU, tint: 0xffffff, flat: 1 });
    opaque.box(3.2, 2.68, cz - 0.42, 3.1, 1.1, 0.13, { tile: T.STEEL, tint: 0xb2b8bf });
    opaque.box(3.2, 2.68, cz - 0.365, 3.0, 1.0, 0.03, { tile: T.PANEL, tint: 0x1b1e23, flat: 0.9 });
    emis.quad([1.85, 2.26, cz - 0.345], [4.55, 2.26, cz - 0.345], [4.55, 3.10, cz - 0.345], [1.85, 3.10, cz - 0.345],
      { tile: T.MENU, tint: 0xffffff, flat: 1 });
    emis.box(-8.0, 2.62, cz - 0.3, 0.9, 0.9, 0.06, { tile: T.LOGO, tint: 0xffffff, flat: 1 });
    // crew-side order screens
    [[-4.6, 2.1], [-1.4, 2.1], [2.6, 2.1]].forEach(([x, w]) => {
      opaque.box(x, 2.30, cz - 0.62, w + 0.1, 0.86, 0.1, { tile: T.PANEL, tint: 0x2a2e34, flat: 0.9 });
      emis.quad([x + w / 2, 1.94, cz - 0.675], [x - w / 2, 1.94, cz - 0.675],
                [x - w / 2, 2.66, cz - 0.675], [x + w / 2, 2.66, cz - 0.675],
                { tile: T.MENU, tint: 0xbcd4e8, flat: 1 });
      opaque.box(x, 2.74, cz - 0.55, 0.06, 0.6, 0.06, { tile: T.STEEL, tint: 0x9aa1a9 });
    });

    /* swing gate at the open end of the counter */
    // a waist-high swing gate: it reads as a barrier but crew walk straight through
    opaque.box(6.6, 0.52, cz, 1.0, 1.04, 0.1, { tile: T.PANEL, tint: 0xe8e6e1, flat: 0.9 });
    opaque.box(6.6, 1.06, cz, 1.04, 0.05, 0.14, { tile: T.STEEL, tint: 0xc3c9cf });

    /* ---------------- kitchen equipment ---------------- */
    const steel = { tile: T.STEEL, tint: 0xffffff };

    // grill
    (function () {
      const [x, z] = L.GRILL;
      opaque.box(x, 0.45, z, 3.2, 0.9, 1.15, steel);
      opaque.box(x, 0.94, z, 3.3, 0.09, 1.25, { tile: T.BLANK, tint: 0x3a3d42, flat: 0.95 });
      opaque.box(x, 1.0, z, 3.0, 0.03, 0.95, { tile: T.BLANK, tint: 0x2c2f33, flat: 1.0 });
      opaque.box(x, 1.55, z - 0.5, 3.2, 0.1, 0.2, { tile: T.STEEL, tint: 0xcdd2d7 });
      opaque.box(x, 1.95, z - 0.45, 3.4, 0.7, 0.7, { tile: T.STEEL, tint: 0xdde1e5 }); // hood
      [-1.2, -0.4, 0.4, 1.2].forEach(o => opaque.cyl(x + o, 0.92, z + 0.62, 0.05, 0.06, 8, { tile: T.BLANK, tint: 0xd8342a, flat: 1 }));
      solid(x - 1.7, x + 1.7, z - 0.65, z + 0.65, 1.0);
      shadow(x, z, 4.2, 2.1, 0.9);
    })();

    // fryer
    (function () {
      const [x, z] = L.FRYER;
      opaque.box(x, 0.45, z, 1.9, 0.9, 1.1, steel);
      opaque.box(x, 0.93, z, 2.0, 0.08, 1.2, { tile: T.STEEL, tint: 0xc7ccd2 });
      [-0.45, 0.45].forEach(o => {
        opaque.box(x + o, 0.9, z, 0.8, 0.12, 0.7, { tile: T.BLANK, tint: 0x2b2e33, flat: 0.9 });
        opaque.box(x + o, 0.86, z, 0.72, 0.06, 0.62, { tile: T.BLANK, tint: 0xd9a83c, flat: 1.0 });
      });
      opaque.box(x, 1.9, z - 0.4, 2.1, 0.65, 0.65, { tile: T.STEEL, tint: 0xdde1e5 });
      solid(x - 1.05, x + 1.05, z - 0.62, z + 0.62, 1.0);
      shadow(x, z, 2.8, 2.0, 0.9);
    })();

    // drinks fountain
    (function () {
      const [x, z] = L.DRINKS;
      opaque.box(x, 0.45, z, 1.8, 0.9, 0.9, steel);
      opaque.box(x, 0.93, z, 1.9, 0.08, 1.0, { tile: T.STEEL, tint: 0xc7ccd2 });
      opaque.box(x, 1.62, z - 0.16, 1.7, 1.3, 0.6, { tile: T.PANEL, tint: 0x2a2d33, flat: 0.95 });
      emis.quad([x - 0.8, 1.15, z + 0.145], [x + 0.8, 1.15, z + 0.145], [x + 0.8, 2.2, z + 0.145], [x - 0.8, 2.2, z + 0.145],
        { tile: T.SODA, tint: 0xffffff, flat: 1 });
      [-0.6, -0.2, 0.2, 0.6].forEach(o => opaque.box(x + o, 1.12, z + 0.24, 0.09, 0.2, 0.14, { tile: T.STEEL, tint: 0xb6bcc3 }));
      solid(x - 1.0, x + 1.0, z - 0.55, z + 0.55, 1.0);
      shadow(x, z, 2.6, 1.8, 0.9);
    })();

    // ice cream machine
    (function () {
      const [x, z] = L.ICECREAM;
      opaque.box(x, 0.45, z, 1.2, 0.9, 0.9, steel);
      opaque.box(x, 1.6, z, 1.1, 1.4, 0.85, { tile: T.STEEL, tint: 0xeef1f4 });
      opaque.box(x, 1.35, z + 0.42, 0.5, 0.5, 0.06, { tile: T.BLANK, tint: 0x2f333a, flat: 0.95 });
      opaque.box(x, 1.02, z + 0.36, 0.1, 0.22, 0.1, { tile: T.STEEL, tint: 0xc3c9cf });
      emis.box(x, 1.62, z + 0.44, 0.34, 0.16, 0.02, { tile: T.MENU, tint: 0xbfe4ff, flat: 1 });
      solid(x - 0.65, x + 0.65, z - 0.5, z + 0.5, 1.0);
      shadow(x, z, 2.0, 1.7, 0.9);
    })();

    // prep table between counter and cook line
    opaque.box(-0.2, 0.44, -3.1, 4.6, 0.88, 0.8, steel);
    opaque.box(-0.2, 0.91, -3.1, 4.7, 0.07, 0.9, { tile: T.STEEL, tint: 0xd7dce1 });
    solid(-2.6, 2.2, -3.55, -2.65, 0.95);
    shadow(-0.2, -3.1, 5.4, 1.7, 0.9);

    // back-wall fridges and shelving
    for (let i = 0; i < 4; i++) {
      const x = -8.5 + i * 2.3;
      opaque.box(x, 1.05, -8.35, 2.0, 2.1, 1.0, { tile: T.STEEL, tint: 0xe3e7eb });
      opaque.box(x, 1.05, -7.83, 1.85, 1.9, 0.05, { tile: T.STEEL, tint: 0xb9bfc6 });
      opaque.box(x + 0.7, 1.05, -7.79, 0.06, 1.0, 0.06, { tile: T.STEEL, tint: 0x8f959c });
      solid(x - 1.0, x + 1.0, -8.9, -7.8);
    }
    for (let i = 0; i < 3; i++) {
      const x = 3.2 + i * 2.4;
      opaque.box(x, 0.9, -8.45, 2.1, 0.06, 0.85, { tile: T.STEEL, tint: 0xd2d7dc });
      opaque.box(x, 1.5, -8.45, 2.1, 0.06, 0.85, { tile: T.STEEL, tint: 0xd2d7dc });
      opaque.box(x, 2.1, -8.45, 2.1, 0.06, 0.85, { tile: T.STEEL, tint: 0xd2d7dc });
      for (let k = 0; k < 6; k++) {
        opaque.box(x - 0.8 + (k % 3) * 0.8, 1.05 + ((k / 3) | 0) * 0.6, -8.45, 0.6, 0.22, 0.5,
          { tile: T.PACK, tint: 0xffffff, flat: 0.9 });
      }
      solid(x - 1.05, x + 1.05, -8.9, -8.0);
    }

    // kitchen colour: safety stripe, extinguisher, first-aid box, condiment bottles
    opaque.decal(-2.4, 0.02, -4.35, 2.6, 0.22, { tile: T.STRIPE, tint: 0xffffff, flat: 0.95 });
    opaque.cyl(-11.5, 0.9, -6.4, 0.11, 0.55, 8, { tile: T.BLANK, tint: 0xd12a20, flat: 1.0, closeBottom: true });
    opaque.box(-11.5, 1.52, -6.4, 0.1, 0.16, 0.1, { tile: T.STEEL, tint: 0x2f333a, flat: 0.95 });
    opaque.box(-11.86, 1.55, -5.2, 0.1, 0.42, 0.5, { tile: T.BLANK, tint: 0xf2f2f2, flat: 1.0 });
    opaque.box(-11.79, 1.55, -5.2, 0.04, 0.2, 0.06, { tile: T.BLANK, tint: 0x2fa05a, flat: 1.0 });
    opaque.box(-11.79, 1.55, -5.2, 0.04, 0.06, 0.2, { tile: T.BLANK, tint: 0x2fa05a, flat: 1.0 });
    [[-1.6, 0xd12a20], [-1.35, 0xe8b23a], [-1.1, 0x8a6a3a]].forEach(([x, col]) => {
      opaque.cyl(x, 0.92, -2.95, 0.05, 0.2, 8, { tile: T.BLANK, tint: col, flat: 1.0, closeBottom: true });
      opaque.cyl(x, 1.12, -2.95, 0.02, 0.05, 6, { tile: T.BLANK, tint: 0x2a2e34, flat: 1.0 });
    });
    [[1.0, 0xd8dee4], [1.34, 0xd8dee4]].forEach(([x, col]) => {
      opaque.box(x, 0.99, -2.95, 0.3, 0.14, 0.42, { tile: T.STEEL, tint: col, flat: 1.0 });
    });
    // colour-coded prep bins under the pass
    [[-9.4, 0xd12a20], [-8.6, 0x3f7fd6], [-7.8, 0x2fa05a]].forEach(([x, col]) => {
      opaque.box(x, 0.3, -3.1, 0.7, 0.6, 0.5, { tile: T.PANEL, tint: col, flat: 0.85 });
    });

    // trash bin
    (function () {
      const [x, z] = L.TRASH;
      opaque.cyl(x, 0, z, 0.34, 0.9, 10, { tile: T.PANEL, tint: 0x4a4f57, flat: 0.85, openTop: true });
      opaque.cyl(x, 0.9, z, 0.37, 0.09, 10, { tile: T.PANEL, tint: 0x2f333a, flat: 0.95 });
      solid(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 1.0);
      shadow(x, z, 1.3, 1.3, 0.85);
    })();

    /* ---------------- dining room ---------------- */
    L.TABLES.forEach(([x, z]) => {
      opaque.cyl(x, 0.72, z, 0.62, 0.05, 12, { tile: T.WOOD, tint: 0xffffff, flat: 0.98, closeBottom: true });
      opaque.cyl(x, 0.05, z, 0.09, 0.68, 8, { tile: T.STEEL, tint: 0x8d939b, flat: 0.8 });
      opaque.cyl(x, 0, z, 0.34, 0.05, 10, { tile: T.STEEL, tint: 0x6f757c, flat: 0.7, closeBottom: true });
      shadow(x, z, 1.9, 1.9, 0.82);
      round.push({ x, z, r: 0.85 });
      solid(x - 0.6, x + 0.6, z - 0.6, z + 0.6, 0.8);

      [[-1.0, 0], [1.0, 0], [0, -1.0], [0, 1.0]].forEach(([ox, oz]) => {
        const sx = x + ox, sz = z + oz;
        opaque.box(sx, 0.44, sz, 0.42, 0.06, 0.42, { tile: T.BLANK, tint: 0xd8332a, flat: 0.9 });
        opaque.cyl(sx, 0, sz, 0.05, 0.44, 8, { tile: T.STEEL, tint: 0x8d939b, flat: 0.75 });
        opaque.cyl(sx, 0, sz, 0.19, 0.04, 8, { tile: T.STEEL, tint: 0x6f757c, flat: 0.7, closeBottom: true });
        const bx = ox !== 0 ? Math.sign(ox) * 0.19 : 0, bz = oz !== 0 ? Math.sign(oz) * 0.19 : 0;
        opaque.box(sx + bx, 0.68, sz + bz, ox !== 0 ? 0.06 : 0.42, 0.44, ox !== 0 ? 0.42 : 0.06,
          { tile: T.BLANK, tint: 0xc22e26, flat: 0.92 });
        shadow(sx, sz, 0.8, 0.8, 0.85);
        round.push({ x: sx, z: sz, r: 0.42 });
      });
    });

    // warm wood band + wall arches, the modern interior look
    [[-W + 0.06, 1], [W - 0.06, -1]].forEach(([x, sgn]) => {
      for (let z = L.COUNTER_Z + 0.4; z < D - 0.4; z += 0.34) {
        opaque.box(x + sgn * 0.05, 0.45, z, 0.1, 0.9, 0.22, { tile: T.WOOD, tint: 0xffffff, flat: 0.92 });
      }
      emis.box(x + sgn * 0.09, 3.02, 4.0, 0.03, 0.62, 0.62, { tile: T.LOGO, tint: 0xffffff, flat: 1 });
    });
    // dining bins + condiment station near the entrance
    [[-4.4, 8.0], [4.4, 8.0]].forEach(([x, z]) => {
      opaque.box(x, 0.55, z, 0.85, 1.1, 0.6, { tile: T.WOOD, tint: 0xd7c6b0, flat: 0.9 });
      opaque.box(x, 1.12, z, 0.9, 0.06, 0.65, { tile: T.PANEL, tint: 0x3b3f46, flat: 0.95 });
      opaque.box(x, 1.0, z + 0.31, 0.42, 0.3, 0.04, { tile: T.BLANK, tint: 0x22252a, flat: 0.8 });
      solid(x - 0.5, x + 0.5, z - 0.36, z + 0.36, 1.15);
      shadow(x, z, 1.6, 1.3, 0.85);
      round.push({ x, z, r: 0.65 });
    });

    // self-order kiosks
    [[-7.2, 7.4], [-5.9, 7.4]].forEach(([x, z]) => {
      opaque.box(x, 0.6, z, 0.5, 1.2, 0.3, { tile: T.PANEL, tint: 0x2a2e34, flat: 0.9 });
      opaque.box(x, 1.35, z, 0.62, 0.9, 0.22, { tile: T.PANEL, tint: 0x1e2126, flat: 0.95 });
      emis.quad([x - 0.26, 0.98, z + 0.115], [x + 0.26, 0.98, z + 0.115], [x + 0.26, 1.72, z + 0.115], [x - 0.26, 1.72, z + 0.115],
        { tile: T.MENU, tint: 0xffffff, flat: 1 });
      solid(x - 0.32, x + 0.32, z - 0.2, z + 0.2, 1.6);
      shadow(x, z, 1.1, 0.9, 0.85);
      round.push({ x, z, r: 0.45 });
    });

    // planters
    [[-4.6, 0.4], [4.6, 0.4]].forEach(([x, z]) => {
      opaque.box(x, 0.28, z, 0.55, 0.56, 0.55, { tile: T.PANEL, tint: 0x6d5647, flat: 0.9 });
      opaque.cyl(x, 0.5, z, 0.22, 0.5, 6, { tile: T.BLANK, tint: 0x3f7a3c, flat: 0.95, rTop: 0.05 });
      opaque.cyl(x, 0.75, z, 0.3, 0.45, 6, { tile: T.BLANK, tint: 0x4a8c45, flat: 1.0, rTop: 0.02 });
      solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 0.6);
      shadow(x, z, 1.2, 1.2, 0.85);
      round.push({ x, z, r: 0.5 });
    });

    /* ---------------- exterior ---------------- */
    // lot
    opaque.tiled([-34, -0.02, 34], [34, -0.02, 34], [34, -0.02, -34], [-34, -0.02, -34],
      { tile: T.CONCRETE, rep: 4, tint: 0x9aa0a8, flat: 0.9 });
    for (let i = -5; i <= 5; i++) {
      opaque.decal(i * 2.8, 0.01, 18, 0.16, 5.0, { tile: T.BLANK, tint: 0xe8d55c, flat: 0.95 });
    }
    // building shell (exterior faces of our walls, plus a roof band)
    opaque.box(0, H / 2 + 0.4, 0, W * 2 + 0.9, H + 0.8, D * 2 + 0.9,
      { tile: T.PANEL, tint: 0x8e6a52, rep: 2.2, skip: { bottom: true, top: true } });
    opaque.box(0, H + 0.45, 0, W * 2 + 1.5, 0.5, D * 2 + 1.5, { tile: T.BLANK, tint: 0xb03a2c, flat: 0.95 });
    opaque.box(0, H + 0.72, 0, W * 2 + 1.2, 0.1, D * 2 + 1.2, { tile: T.BLANK, tint: 0x2f333a, flat: 0.9 });
    emis.box(0, H + 0.45, D + 0.78, 3.4, 0.9, 0.05, { tile: T.LOGO, tint: 0xffffff, flat: 1 });

    // pylon sign
    opaque.box(-15, 3.0, 15, 0.5, 6.0, 0.5, { tile: T.STEEL, tint: 0xbfc4ca, flat: 0.9 });
    emis.box(-15, 6.6, 15, 2.6, 2.6, 0.35, { tile: T.LOGO, tint: 0xffffff, flat: 1 });
    solid(-15.4, -14.6, 14.6, 15.4);

    // parked cars
    [[-9, 16.5, 0xc0392b], [-3.5, 16.5, 0x2c6fb5], [3.5, 16.5, 0xe8e8e8], [9, 16.5, 0x2f3b45]].forEach(([x, z, col]) => {
      opaque.box(x, 0.55, z, 1.85, 0.62, 4.1, { tile: T.BLANK, tint: col, flat: 0.95 });
      opaque.box(x, 1.05, z + 0.15, 1.65, 0.55, 2.1, { tile: T.BLANK, tint: 0x2a2e34, flat: 0.9 });
      [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]].forEach(([ox, oz]) =>
        opaque.cyl(x + ox, 0.12, z + oz, 0.32, 0.16, 8, { tile: T.BLANK, tint: 0x1c1f24, flat: 0.8 }));
      shadow(x, z, 3.0, 5.2, 0.8);
      solid(x - 1.0, x + 1.0, z - 2.1, z + 2.1);
    });

    // distant skyline blocks
    const rnd = g.MathX.mulberry32(1337);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
      const d = 42 + rnd() * 22;
      const h = 3 + rnd() * 11;
      opaque.box(Math.cos(a) * d, h / 2, Math.sin(a) * d, 5 + rnd() * 7, h, 5 + rnd() * 7,
        { tile: T.PANEL, tint: [140 + rnd() * 60 | 0, 140 + rnd() * 50 | 0, 145 + rnd() * 55 | 0], flat: 0.95 });
    }
    // lot boundary so the player cannot wander into the void
    solid(-34, 34, 26, 27); solid(-34, 34, -27, -26);
    solid(-34, -33, -27, 27); solid(33, 34, -27, 27);

    return {
      opaque: opaque.build(), emis: emis.build(), decal: decal.build(), glass: glass.build(),
      solids, round, L,
    };
  }

  g.World = { build, L };
})(window);
