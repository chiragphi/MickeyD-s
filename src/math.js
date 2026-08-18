/* Minimal math: mat4 / vec helpers. All matrices are column-major Float32Array(16). */
(function (g) {
  'use strict';

  const M4 = {
    create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },

    ident(o) {
      o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
      o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
      return o;
    },

    mul(o, a, b) { // o = a * b
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return o;
    },

    persp(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
      o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
      return o;
    },

    /* First-person view matrix: rotX(pitch) * rotY(yaw) * translate(-eye) */
    view(o, ex, ey, ez, yaw, pitch) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      // R = Rx * Ry  (row-major thinking, stored column-major)
      const r00 = cy, r01 = 0, r02 = -sy;
      const r10 = sp * sy, r11 = cp, r12 = sp * cy;
      const r20 = cp * sy, r21 = -sp, r22 = cp * cy;
      o[0] = r00; o[1] = r10; o[2] = r20; o[3] = 0;
      o[4] = r01; o[5] = r11; o[6] = r21; o[7] = 0;
      o[8] = r02; o[9] = r12; o[10] = r22; o[11] = 0;
      o[12] = -(r00 * ex + r01 * ey + r02 * ez);
      o[13] = -(r10 * ex + r11 * ey + r12 * ez);
      o[14] = -(r20 * ex + r21 * ey + r22 * ez);
      o[15] = 1;
      return o;
    },

    /* translate * rotateY * scale — the common case for props */
    trs(o, x, y, z, ry, sx, sy, sz) {
      const c = Math.cos(ry), s = Math.sin(ry);
      o[0] = c * sx; o[1] = 0; o[2] = -s * sx; o[3] = 0;
      o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0;
      o[8] = s * sz; o[9] = 0; o[10] = c * sz; o[11] = 0;
      o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
      return o;
    },

    fromT(o, x, y, z) { M4.ident(o); o[12] = x; o[13] = y; o[14] = z; return o; },

    fromRX(o, a) {
      const c = Math.cos(a), s = Math.sin(a);
      M4.ident(o); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o;
    },

    fromRY(o, a) {
      const c = Math.cos(a), s = Math.sin(a);
      M4.ident(o); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o;
    },

    fromRZ(o, a) {
      const c = Math.cos(a), s = Math.sin(a);
      M4.ident(o); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o;
    },

    fromS(o, x, y, z) { M4.ident(o); o[0] = x; o[5] = y; o[10] = z; return o; },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  /* Frame-rate independent exponential approach. */
  const approach = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
  const angLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  };

  /* Deterministic PRNG so hosts and clients can agree on cosmetic details. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  g.M4 = M4;
  g.MathX = { clamp, lerp, smooth, approach, angLerp, mulberry32 };
})(window);
