/* Tiny WebGL1 renderer: one shader, one texture, gouraud lighting + vertex AO,
   vertex fog, and three blend modes. No shadow maps, no post-processing, no
   render targets — nothing that makes an integrated GPU cry. */
(function (g) {
  'use strict';

  const STRIDE = 36;

  const VS = `
precision mediump float;
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aUV;
attribute vec4 aCol;
uniform mat4 uVP;
uniform mat4 uM;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGrdCol;
uniform float uFogK;
varying vec2 vUV;
varying vec3 vLight;
varying vec3 vTint;
varying float vFog;
void main(){
  vec4 wp = uM * vec4(aPos, 1.0);
  vec3 n = normalize((uM * vec4(aNrm, 0.0)).xyz);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 hemi = mix(uGrdCol, uSkyCol, n.y * 0.5 + 0.5);
  vLight = (hemi + uSunCol * ndl) * aCol.a;
  vTint = aCol.rgb;
  vUV = aUV;
  gl_Position = uVP * wp;
  float d = length(wp.xyz - uEye);
  vFog = 1.0 - exp(-d * d * uFogK);
}`;

  const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uFogCol;
uniform float uUnlit;
uniform vec4 uMul;
uniform float uAlphaCut;
varying vec2 vUV;
varying vec3 vLight;
varying vec3 vTint;
varying float vFog;
void main(){
  vec4 t = texture2D(uTex, vUV);
  if (t.a < uAlphaCut) discard;
  vec3 c = t.rgb * vTint * uMul.rgb;
  c *= mix(vLight, vec3(1.0), uUnlit);
  c = mix(c, uFogCol, clamp(vFog, 0.0, 1.0));
  gl_FragColor = vec4(c, t.a * uMul.a);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  class Renderer {
    constructor(canvas) {
      const opts = {
        alpha: false, antialias: false, depth: true, stencil: false,
        powerPreference: 'low-power', preserveDrawingBuffer: false,
        desynchronized: true, failIfMajorPerformanceCaveat: false,
      };
      const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('WebGL is not available in this browser.');
      this.gl = gl;
      this.canvas = canvas;
      this.uintIndex = !!gl.getExtension('OES_element_index_uint');

      // Vertex shader needs the eye position for fog; inject the uniform up front.
      const vs = VS.replace('uniform float uFogK;', 'uniform float uFogK;\nuniform vec3 uEye;');
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.bindAttribLocation(p, 1, 'aNrm');
      gl.bindAttribLocation(p, 2, 'aUV');
      gl.bindAttribLocation(p, 3, 'aCol');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
      this.prog = p;
      gl.useProgram(p);

      this.u = {};
      ['uVP', 'uM', 'uSunDir', 'uSunCol', 'uSkyCol', 'uGrdCol', 'uFogK', 'uEye',
        'uTex', 'uFogCol', 'uUnlit', 'uMul', 'uAlphaCut'].forEach(k => { this.u[k] = gl.getUniformLocation(p, k); });

      for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
      gl.uniform1i(this.u.uTex, 0);

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clearColor(0.62, 0.76, 0.88, 1);

      this._mul = new Float32Array([1, 1, 1, 1]);
      this._fog = new Float32Array([0.62, 0.76, 0.88]);
      this._mode = -1;
      this._bound = null;
      this._unlit = -1;
      this._cut = -1;
      this.drawCalls = 0;
      this.tris = 0;

      const info = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '') : '';
    }

    texture(canvas, mip) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      if (mip !== false) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t);
      return t;
    }

    mesh(built, dynamic) {
      const gl = this.gl;
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, built.data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      let index = built.index;
      if (built.big && !this.uintIndex) throw new Error('Mesh too large for 16-bit indices.');
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      const m = {
        vbo, ibo, count: index.length, ranges: built.ranges, verts: built.verts, tris: built.tris,
        type: built.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        bytes: built.big ? 4 : 2,
      };
      this._bound = null;
      return m;
    }

    bind(m) {
      if (this._bound === m) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 24);
      gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE, 32);
      this._bound = m;
    }

    /* mode: 0 opaque, 1 alpha blend, 2 multiply (decals/shadows), 3 additive */
    mode(m) {
      if (this._mode === m) return;
      const gl = this.gl;
      this._mode = m;
      if (m === 0) {
        gl.disable(gl.BLEND); gl.depthMask(true);
        gl.uniform3fv(this.u.uFogCol, this._fog);
      } else {
        gl.enable(gl.BLEND); gl.depthMask(false);
        if (m === 1) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        else if (m === 2) { gl.blendFunc(gl.DST_COLOR, gl.ZERO); gl.uniform3f(this.u.uFogCol, 1, 1, 1); }
        else gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        if (m !== 2) gl.uniform3fv(this.u.uFogCol, this._fog);
      }
    }

    unlit(v) {
      if (this._unlit === v) return;
      this._unlit = v;
      this.gl.uniform1f(this.u.uUnlit, v);
    }

    alphaCut(v) {
      if (this._cut === v) return;
      this._cut = v;
      this.gl.uniform1f(this.u.uAlphaCut, v);
    }

    frame(vp, eye, env, w, h) {
      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      this._fog[0] = env.fog[0]; this._fog[1] = env.fog[1]; this._fog[2] = env.fog[2];
      gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.u.uVP, false, vp);
      gl.uniform3f(this.u.uEye, eye[0], eye[1], eye[2]);
      gl.uniform3fv(this.u.uSunDir, env.sunDir);
      gl.uniform3fv(this.u.uSunCol, env.sunCol);
      gl.uniform3fv(this.u.uSkyCol, env.skyCol);
      gl.uniform3fv(this.u.uGrdCol, env.grdCol);
      gl.uniform1f(this.u.uFogK, env.fogK);
      this._mode = -1; this._unlit = -1; this._cut = -1; this._cull = null;
      this.mode(0); this.unlit(0); this.alphaCut(0.02); this.cull(true);
      this.drawCalls = 0; this.tris = 0;
    }

    cull(on) {
      if (this._cull === on) return;
      this._cull = on;
      if (on) this.gl.enable(this.gl.CULL_FACE); else this.gl.disable(this.gl.CULL_FACE);
    }

    draw(mesh, model, range, mul) {
      const gl = this.gl;
      this.bind(mesh);
      gl.uniformMatrix4fv(this.u.uM, false, model);
      const m = mul || this._mul;
      gl.uniform4f(this.u.uMul, m[0], m[1], m[2], m[3]);
      const start = range ? range.start : 0;
      const count = range ? range.count : mesh.count;
      gl.drawElements(gl.TRIANGLES, count, mesh.type, start * mesh.bytes);
      this.drawCalls++; this.tris += count / 3;
    }
  }

  g.Renderer = Renderer;
})(window);
