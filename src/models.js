/* Every animated thing — staff, customers, food, sprites — lives in ONE dynamic
   mesh with named index ranges. Drawing a customer is 6 uniform updates + 6 tiny
   drawElements, with no buffer rebinding at all. */
(function (g) {
  'use strict';
  const T = g.Atlas.T;

  function build() {
    const b = new g.Geom.MeshBuilder();

    /* ---- humanoid, parts built around their own pivot ---- */
    b.mark('legL'); b.box(0, -0.41, 0, 0.17, 0.82, 0.22, { tint: 0x3a4152, flat: 0.86 });
    b.box(0, -0.79, 0.02, 0.19, 0.09, 0.28, { tint: 0x22252c, flat: 0.7 });
    b.mark('legR'); b.box(0, -0.41, 0, 0.17, 0.82, 0.22, { tint: 0x3a4152, flat: 0.86 });
    b.box(0, -0.79, 0.02, 0.19, 0.09, 0.28, { tint: 0x22252c, flat: 0.7 });

    b.mark('torso');
    b.box(0, 0.33, 0, 0.52, 0.66, 0.30, { tint: 0xffffff, flat: 1.0 });
    b.box(0, 0.60, 0.153, 0.30, 0.16, 0.02, { tint: 0xf2f2f2, flat: 1.05 }); // collar
    b.box(0, 0.05, 0.153, 0.52, 0.10, 0.015, { tint: 0xe0e0e0, flat: 0.9 }); // hem

    b.mark('head');
    b.box(0, 0.16, 0, 0.30, 0.32, 0.28, { tint: 0xffffff, flat: 1.06 });
    b.box(-0.07, 0.20, 0.142, 0.055, 0.06, 0.02, { tint: 0x2a2723, flat: 1.0 });
    b.box(0.07, 0.20, 0.142, 0.055, 0.06, 0.02, { tint: 0x2a2723, flat: 1.0 });
    b.box(0, 0.09, 0.145, 0.11, 0.025, 0.015, { tint: 0xc98a76, flat: 0.95 });
    b.box(0, 0.325, 0, 0.315, 0.075, 0.295, { tint: 0x3a2c22, flat: 0.8 }); // hair

    b.mark('cap');
    b.box(0, 0.36, 0, 0.33, 0.09, 0.31, { tint: 0xffffff, flat: 1.05 });
    b.box(0, 0.325, 0.20, 0.30, 0.03, 0.12, { tint: 0xffffff, flat: 1.0 });

    b.mark('armL'); b.box(0, -0.29, 0, 0.14, 0.58, 0.16, { tint: 0xffffff, flat: 0.98 });
    b.box(0, -0.63, 0, 0.13, 0.11, 0.15, { tint: 0xe8b48f, flat: 1.0 });
    b.mark('armR'); b.box(0, -0.29, 0, 0.14, 0.58, 0.16, { tint: 0xffffff, flat: 0.98 });
    b.box(0, -0.63, 0, 0.13, 0.11, 0.15, { tint: 0xe8b48f, flat: 1.0 });

    /* ---- food & props (origin at their base, ~real scale) ---- */
    b.mark('burger');
    b.cyl(0, 0, 0, 0.085, 0.035, 10, { tint: 0xe0a860, flat: 0.85, closeBottom: true });
    b.cyl(0, 0.033, 0, 0.095, 0.026, 10, { tint: 0x5b3821, flat: 0.9 });
    b.cyl(0, 0.058, 0, 0.098, 0.012, 10, { tint: 0x7ec24a, flat: 0.95 });
    b.cyl(0, 0.068, 0, 0.088, 0.055, 10, { tint: 0xefb968, flat: 1.05, rTop: 0.062 });

    b.mark('fries');
    b.box(0, 0.055, 0, 0.10, 0.11, 0.06, { tile: T.PACK, flat: 0.95 });
    b.box(-0.02, 0.135, 0, 0.016, 0.075, 0.016, { tint: 0xf7cf5c, flat: 1.08 });
    b.box(0.012, 0.145, 0.01, 0.016, 0.09, 0.016, { tint: 0xfad973, flat: 1.1 });
    b.box(0.028, 0.128, -0.012, 0.015, 0.06, 0.015, { tint: 0xf2c44e, flat: 1.05 });

    b.mark('drink');
    b.cyl(0, 0, 0, 0.043, 0.16, 10, { tint: 0xf5f5f5, flat: 0.95, rTop: 0.055, closeBottom: true, openTop: true });
    b.cyl(0, 0.155, 0, 0.058, 0.018, 10, { tint: 0xd9d9d9, flat: 1.02 });
    b.box(0.02, 0.22, 0, 0.012, 0.12, 0.012, { tint: 0xdc3a2c, flat: 1.05 });
    b.cyl(0, 0.055, 0, 0.0445, 0.055, 10, { tint: 0xd12a20, flat: 0.98, openTop: true });

    b.mark('nuggets');
    b.box(0, 0.05, 0, 0.14, 0.10, 0.09, { tile: T.PACK, flat: 0.95 });
    b.box(-0.03, 0.115, 0, 0.05, 0.035, 0.05, { tint: 0xd8a04e, flat: 1.05 });
    b.box(0.03, 0.118, 0.012, 0.05, 0.035, 0.05, { tint: 0xe0aa58, flat: 1.05 });

    b.mark('flurry');
    b.cyl(0, 0, 0, 0.045, 0.13, 10, { tint: 0xffffff, flat: 0.95, rTop: 0.055, closeBottom: true, openTop: true });
    b.cyl(0, 0.125, 0, 0.056, 0.05, 10, { tint: 0xf6efe2, flat: 1.06, rTop: 0.02 });
    b.cyl(0, 0.02, 0, 0.0455, 0.06, 10, { tint: 0xf0d9c0, flat: 1.0, openTop: true });

    b.mark('tray');
    b.box(0, 0.012, 0, 0.44, 0.024, 0.32, { tint: 0x8a2c22, flat: 0.9 });
    b.box(0, 0.032, -0.155, 0.44, 0.04, 0.02, { tint: 0x9c332a, flat: 0.95 });
    b.box(0, 0.032, 0.155, 0.44, 0.04, 0.02, { tint: 0x9c332a, flat: 0.95 });
    b.box(-0.215, 0.032, 0, 0.02, 0.04, 0.32, { tint: 0x9c332a, flat: 0.95 });
    b.box(0.215, 0.032, 0, 0.02, 0.04, 0.32, { tint: 0x9c332a, flat: 0.95 });

    b.mark('patty');   b.cyl(0, 0, 0, 0.105, 0.026, 10, { tint: 0xffffff, flat: 1.0, closeBottom: true });
    b.mark('bun');     b.cyl(0, 0, 0, 0.085, 0.05, 10, { tint: 0xffffff, flat: 1.0, rTop: 0.07, closeBottom: true });
    b.mark('fryload'); b.box(0, 0.03, 0, 0.20, 0.06, 0.16, { tint: 0xffffff, flat: 1.0 });

    b.mark('basket');
    b.box(0, 0.05, 0, 0.24, 0.02, 0.20, { tile: T.STEEL, flat: 0.85 });
    b.box(0, 0.10, -0.10, 0.24, 0.10, 0.02, { tile: T.STEEL, flat: 0.95 });
    b.box(0, 0.10, 0.10, 0.24, 0.10, 0.02, { tile: T.STEEL, flat: 0.95 });
    b.box(-0.12, 0.10, 0, 0.02, 0.10, 0.20, { tile: T.STEEL, flat: 0.95 });
    b.box(0.12, 0.10, 0, 0.02, 0.10, 0.20, { tile: T.STEEL, flat: 0.95 });
    b.box(0, 0.13, 0.20, 0.04, 0.02, 0.20, { tile: T.STEEL, flat: 1.0 });

    /* ---- sprites ---- */
    b.mark('blob');   b.decal(0, 0, 0, 1, 1, { tile: T.SHADOW, flat: 1 });
    b.mark('quad');   b.sprite({ tile: T.BLANK, flat: 1 });
    b.mark('puff');   b.sprite({ tile: T.PUFF, flat: 1 });
    b.mark('cube');   b.box(0, 0.5, 0, 1, 1, 1, { tile: T.BLANK, flat: 1 });

    return b.build();
  }

  g.Models = { build };
})(window);
