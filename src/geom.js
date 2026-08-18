/* Geometry builder. Everything in the game is procedural low-poly geometry packed
   into a handful of interleaved buffers, so the whole restaurant renders in ~2 draw calls.

   Vertex layout (36 bytes, interleaved):
     pos   3 x float32   @ 0
     nrm   3 x float32   @ 12
     uv    2 x float32   @ 24   (already mapped into the atlas tile)
     col   4 x uint8     @ 32   (rgb tint, a = baked ambient occlusion) */
(function (g) {
  'use strict';

  const STRIDE = 36, FLOATS = 8;
  const A = g.Atlas;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function mulM(o, a, b) {
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4]     = b0 * a[0] + b1 * a[4] + b2 * a[8]  + b3 * a[12];
      o[i * 4 + 1] = b0 * a[1] + b1 * a[5] + b2 * a[9]  + b3 * a[13];
      o[i * 4 + 2] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
      o[i * 4 + 3] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];
    }
    return o;
  }

  function toRGB(c) {
    if (c === undefined) return [255, 255, 255];
    if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    return c;
  }

  /* Cheap baked AO: geometry gets darker near the floor, downward faces darker still.
     Costs nothing at runtime and grounds every object convincingly. */
  function autoAO(y, ny) {
    let a = 0.62 + 0.38 * clamp(y / 0.8, 0, 1);
    if (ny < -0.4) a *= 0.7;
    else if (ny > 0.7) a *= 1.0;
    else a *= 0.94;
    return a;
  }

  class MeshBuilder {
    constructor() {
      this.pos = []; this.nrm = []; this.uv = []; this.col = [];
      this.idx = []; this.n = 0;
      this.ranges = {};
      this._markName = null; this._markStart = 0;
      this.mat = null;          // current transform, applied as vertices are emitted
      this._stack = [];
    }

    /* Full euler placement, for the few props that need an axis other than Y —
       wheels, angled panels, radial fittings. */
    atE(x, y, z, rx, ry, rz, fn, sc) {
      const M = g.M4, t = new Float32Array(16), a = new Float32Array(16), b = new Float32Array(16);
      M.fromT(t, x, y, z);
      M.fromRY(a, ry || 0); M.mul(b, t, a);
      M.fromRX(a, rx || 0); M.mul(t, b, a);
      M.fromRZ(a, rz || 0); M.mul(b, t, a);
      if (sc !== undefined && sc !== 1) { M.fromS(a, sc, sc, sc); M.mul(t, b, a); } else { t.set(b); }
      const prev = this.mat;
      this.mat = prev ? mulM(new Float32Array(16), prev, t) : t;
      this._stack.push(prev);
      fn(this);
      this.mat = this._stack.pop();
      return this;
    }

    /* Run fn with a translate+rotateY(+scale) transform applied to everything it
       emits. Lets the world use angled roofs, tilted signs and radial props while
       every builder primitive stays axis-aligned and simple. */
    at(x, y, z, ry, fn, sx, sy, sz) {
      const c = Math.cos(ry || 0), s2 = Math.sin(ry || 0);
      const m = new Float32Array([
        c * (sx === undefined ? 1 : sx), 0, -s2 * (sx === undefined ? 1 : sx), 0,
        0, (sy === undefined ? 1 : sy), 0, 0,
        s2 * (sz === undefined ? 1 : sz), 0, c * (sz === undefined ? 1 : sz), 0,
        x, y, z, 1,
      ]);
      const prev = this.mat;
      this.mat = prev ? mulM(new Float32Array(16), prev, m) : m;
      this._stack.push(prev);
      fn(this);
      this.mat = this._stack.pop();
      return this;
    }

    mark(name) {
      if (this._markName) this.endMark();
      this._markName = name; this._markStart = this.idx.length;
    }

    endMark() {
      if (!this._markName) return;
      this.ranges[this._markName] = { start: this._markStart, count: this.idx.length - this._markStart };
      this._markName = null;
    }

    vert(x, y, z, nx, ny, nz, u, v, r, gg, b, ao) {
      const m = this.mat;
      if (m) {
        const px = m[0] * x + m[4] * y + m[8] * z + m[12];
        const py = m[1] * x + m[5] * y + m[9] * z + m[13];
        const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
        let tx = m[0] * nx + m[4] * ny + m[8] * nz;
        let ty = m[1] * nx + m[5] * ny + m[9] * nz;
        let tz = m[2] * nx + m[6] * ny + m[10] * nz;
        const l = Math.hypot(tx, ty, tz) || 1;
        x = px; y = py; z = pz; nx = tx / l; ny = ty / l; nz = tz / l;
      }
      this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v);
      this.col.push(r, gg, b, clamp(Math.round(ao * 255), 0, 255));
      return this.n++;
    }

    /* One textured quad. p0..p3 counter-clockwise when viewed from the front. */
    quad(p0, p1, p2, p3, o) {
      o = o || {};
      const tile = o.tile === undefined ? A.T.BLANK : o.tile;
      const R = A.rect(tile);
      const [r, gg, b] = toRGB(o.tint);
      const mul = o.ao === undefined ? 1 : o.ao;
      const flipV = o.flipV;

      let ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      let bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const uvs = flipV === false
        ? [[0, 0], [1, 0], [1, 1], [0, 1]]
        : [[0, 1], [1, 1], [1, 0], [0, 0]];
      const pts = [p0, p1, p2, p3];
      const base = this.n;
      for (let i = 0; i < 4; i++) {
        const p = pts[i], t = uvs[i];
        const ao = (o.flat !== undefined ? o.flat : autoAO(p[1], ny)) * mul * (o.corners ? o.corners[i] : 1);
        this.vert(p[0], p[1], p[2], nx, ny, nz, R[0] + t[0] * R[2], R[1] + t[1] * R[3], r, gg, b, ao);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      return this;
    }

    /* A quad subdivided into cells so a tiling texture repeats without needing
       texture-wrap (impossible inside an atlas). rep = metres per texture tile. */
    tiled(p0, p1, p2, p3, o) {
      const rep = o.rep || 0;
      const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      const nu = rep > 0 ? clamp(Math.round(w / rep), 1, 32) : 1;
      const nv = rep > 0 ? clamp(Math.round(h / rep), 1, 32) : 1;
      if (nu === 1 && nv === 1) return this.quad(p0, p1, p2, p3, o);
      const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
          const e0 = lerp3(p0, p1, u0), e1 = lerp3(p0, p1, u1);
          const f0 = lerp3(p3, p2, u0), f1 = lerp3(p3, p2, u1);
          this.quad(lerp3(e0, f0, v0), lerp3(e1, f1, v0), lerp3(e1, f1, v1), lerp3(e0, f0, v1), o);
        }
      }
      return this;
    }

    /* Axis-aligned box. opts.tiles = {top, side, bottom} tile overrides,
       opts.skip = {top,bottom,px,nx,pz,nz} to drop hidden faces. */
    box(cx, cy, cz, sx, sy, sz, opts) {
      const o = opts || {};
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
      const tiles = o.tiles || {};
      const skip = o.skip || {};
      const base = { tint: o.tint, ao: o.ao, rep: o.rep, flat: o.flat };
      const f = (t) => Object.assign({}, base, { tile: t === undefined ? (o.tile === undefined ? A.T.BLANK : o.tile) : t });

      if (!skip.pz) this.tiled([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], f(tiles.side));
      if (!skip.nz) this.tiled([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], f(tiles.side));
      if (!skip.px) this.tiled([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], f(tiles.side));
      if (!skip.nx) this.tiled([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], f(tiles.side));
      if (!skip.top) this.tiled([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], f(tiles.top));
      if (!skip.bottom) this.tiled([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], f(tiles.bottom));
      return this;
    }

    /* Low-poly cylinder (default 8 sides — plenty at gameplay distance). */
    cyl(cx, cy, cz, r, h, seg, opts) {
      const o = opts || {};
      seg = seg || 8;
      const tile = o.tile === undefined ? A.T.BLANK : o.tile;
      const R = A.rect(tile);
      const [cr, cg, cb] = toRGB(o.tint);
      const mul = o.ao === undefined ? 1 : o.ao;
      const rt = o.rTop === undefined ? r : o.rTop;
      const y0 = cy, y1 = cy + h;

      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const p0 = [cx + c0 * r, y0, cz + s0 * r], p1 = [cx + c1 * r, y0, cz + s1 * r];
        const p2 = [cx + c1 * rt, y1, cz + s1 * rt], p3 = [cx + c0 * rt, y1, cz + s0 * rt];
        this.quad(p0, p1, p2, p3, { tile, tint: o.tint, ao: mul, flat: o.flat });
      }
      if (!o.openTop) {
        const base = this.n;
        const aoT = (o.flat !== undefined ? o.flat : autoAO(y1, 1)) * mul;
        this.vert(cx, y1, cz, 0, 1, 0, R[0] + 0.5 * R[2], R[1] + 0.5 * R[3], cr, cg, cb, aoT);
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          this.vert(cx + c * rt, y1, cz + s * rt, 0, 1, 0,
            R[0] + (0.5 + c * 0.5) * R[2], R[1] + (0.5 + s * 0.5) * R[3], cr, cg, cb, aoT);
        }
        for (let i = 0; i < seg; i++) this.idx.push(base, base + 1 + i, base + 2 + i);
      }
      if (o.closeBottom) {
        const base = this.n;
        const aoB = (o.flat !== undefined ? o.flat : autoAO(y0, -1)) * mul;
        this.vert(cx, y0, cz, 0, -1, 0, R[0] + 0.5 * R[2], R[1] + 0.5 * R[3], cr, cg, cb, aoB);
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          this.vert(cx + c * r, y0, cz + s * r, 0, -1, 0,
            R[0] + (0.5 + c * 0.5) * R[2], R[1] + (0.5 + s * 0.5) * R[3], cr, cg, cb, aoB);
        }
        for (let i = 0; i < seg; i++) this.idx.push(base, base + 2 + i, base + 1 + i);
      }
      return this;
    }

    /* Flat horizontal decal slightly above the floor (contact shadows, mats). */
    decal(cx, y, cz, sx, sz, opts) {
      const o = Object.assign({ tile: A.T.SHADOW, flat: 1 }, opts || {});
      return this.quad(
        [cx - sx / 2, y, cz + sz / 2], [cx + sx / 2, y, cz + sz / 2],
        [cx + sx / 2, y, cz - sz / 2], [cx - sx / 2, y, cz - sz / 2], o);
    }

    /* Unit quad in XY facing +Z, origin centred — billboards, bars, sprites. */
    sprite(opts) {
      return this.quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0],
        Object.assign({ flat: 1 }, opts || {}));
    }

    build() {
      this.endMark();
      const n = this.n;
      const buf = new ArrayBuffer(n * STRIDE);
      const f = new Float32Array(buf), u = new Uint8Array(buf);
      for (let i = 0; i < n; i++) {
        const fo = i * FLOATS + i; // 9 float-slots per vertex (8 floats + 1 packed colour word)
        f[fo] = this.pos[i * 3]; f[fo + 1] = this.pos[i * 3 + 1]; f[fo + 2] = this.pos[i * 3 + 2];
        f[fo + 3] = this.nrm[i * 3]; f[fo + 4] = this.nrm[i * 3 + 1]; f[fo + 5] = this.nrm[i * 3 + 2];
        f[fo + 6] = this.uv[i * 2]; f[fo + 7] = this.uv[i * 2 + 1];
        const bo = i * STRIDE + 32;
        u[bo] = this.col[i * 4]; u[bo + 1] = this.col[i * 4 + 1];
        u[bo + 2] = this.col[i * 4 + 2]; u[bo + 3] = this.col[i * 4 + 3];
      }
      const big = n > 65535;
      const idx = big ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
      return { data: buf, index: idx, big, verts: n, tris: this.idx.length / 3, ranges: this.ranges };
    }
  }

  g.Geom = { MeshBuilder, STRIDE, autoAO };
})(window);
