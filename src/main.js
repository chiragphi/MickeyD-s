/* Boot, input, the frame loop and adaptive resolution. */
(function (g) {
  'use strict';

  const canvas = document.getElementById('gl');
  const UI = g.UI;

  const Main = {
    started: false,
    renderScale: 1,
    _acc: 0,
    _fps: 60,
    _frames: 0, _fpsT: 0,
    _adaptT: 0, _slow: 0, _fast: 0,

    input: { f: 0, b: 0, l: 0, r: 0, sprint: 0, jump: 0 },
    pointerLocked: false,

    async boot() {
      /* Everything below runs inside one guard. A silent throw here used to leave
         the loading screen up forever with no clue why — which is exactly what a
         weak Chromebook would hit. Now any failure, including one we never
         anticipated, surfaces on screen with copyable diagnostics. */
      this._diag = [];
      const note = (m) => { this._diag.push(m); };
      const stall = setTimeout(() => this.fail('Loading is taking too long',
        new Error('Boot did not finish within 25 seconds.')), 25000);

      try {
        note('ua: ' + navigator.userAgent);
        note('cores: ' + (navigator.hardwareConcurrency || '?') + ' · memory: ' + (navigator.deviceMemory || '?') + 'GB');

        this.setLoad('Starting graphics…');
        try {
          this.renderer = new g.Renderer(canvas);
        } catch (e) {
          clearTimeout(stall);
          this.fail('WebGL is unavailable', e,
            'Try enabling hardware acceleration in your browser settings, then reload. ' +
            'On a managed Chromebook this may be turned off by policy.');
          return;
        }
        note('gpu: ' + (this.renderer.gpu || 'unknown'));
        note('uint32 indices: ' + this.renderer.uintIndex);

        const opts = UI.loadOpts(this.renderer.gpu);
        g.GameData.SFX.enabled = opts.sound;
        note('preset: ' + opts.quality);

        /* Drivers without 32-bit indices cap a mesh at 65 535 vertices, so those
           machines get a lighter world rather than a failed load. */
        const lite = !this.renderer.uintIndex || opts.quality === 'potato';
        note('detail: ' + (lite ? 'lite' : 'full'));

        this.setLoad('Painting textures…');
        await frame();
        this.renderer.texture(g.Atlas.build(), true);

        this.setLoad('Building the restaurant…');
        await frame();
        let world = g.World.build({ lite });
        if (world.opaque.verts > 65535 && !this.renderer.uintIndex) {
          note('rebuilding lite: ' + world.opaque.verts + ' verts over the 16-bit limit');
          world = g.World.build({ lite: true });
        }
        const models = g.Models.build();
        note('world: ' + world.opaque.verts + ' verts');

        this.setLoad('Firing up the grill…');
        await frame();
        this.game = new g.Game(this.renderer, world, models, opts);
        this.game.onToast = (m, k) => UI.toast(m, k);
        this.game.onLevel = (lvl, unlock) => {
          UI.toast(unlock ? `Level ${lvl}! Unlocked ${unlock.name} ${unlock.icon}` : `Level ${lvl}!`, 'good');
        };

        g.Net.on('sim', (v) => this.game.applySim(v));
        g.Net.on('event', (v) => this.game.applyEvent(v));

        UI.bind(this);
        this.bindInput();
        this.resize(true);

        this.stats = {
          verts: world.opaque.verts + world.emis.verts + world.decal.verts + world.glass.verts + models.verts,
          tris: world.opaque.tris + world.emis.tris + world.decal.tris + world.glass.tris + models.tris,
        };
        console.log(`[golden shift] ${this.stats.verts | 0} verts / ${this.stats.tris | 0} tris · `
          + `gpu: ${this.renderer.gpu || 'unknown'} · preset: ${opts.quality}${lite ? ' (lite)' : ''}`);

        clearTimeout(stall);
        document.getElementById('loading').classList.add('done');
        this.last = performance.now();
        requestAnimationFrame(this.loop.bind(this));
      } catch (e) {
        clearTimeout(stall);
        this.fail('Could not start the game', e);
      }
    },

    setLoad(text) {
      const el = document.getElementById('loadTxt');
      if (el) el.textContent = text;
    },

    /* Visible, copyable failure — never leave a spinner running with no reason. */
    fail(title, err, hint) {
      const detail = (err && (err.stack || err.message)) || String(err);
      const diag = (this._diag || []).concat(['error: ' + detail]).join('\n');
      const box = document.getElementById('loading');
      if (!box) return;
      box.classList.remove('done');
      box.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'max-width:560px;padding:24px;text-align:left';
      const h = document.createElement('h1');
      h.textContent = title;
      h.style.cssText = 'font-size:22px;font-weight:700;margin-bottom:10px;letter-spacing:-.02em';
      const p = document.createElement('p');
      p.textContent = hint || 'The details below help track this down.';
      p.style.cssText = 'color:#a1a1aa;font-size:14px;line-height:1.6;margin-bottom:14px';
      const pre = document.createElement('textarea');
      pre.readOnly = true;
      pre.value = diag;
      pre.style.cssText = 'width:100%;height:190px;background:#17171a;color:#d4d4d8;border:1px solid #2a2a30;'
        + 'border-radius:12px;padding:12px;font:12px ui-monospace,Menlo,monospace;resize:vertical';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;margin-top:14px';
      const copy = document.createElement('button');
      copy.textContent = 'Copy details';
      copy.style.cssText = 'padding:11px 18px;border-radius:999px;background:#fff;color:#09090b;'
        + 'font-weight:600;font-size:14px;border:0;cursor:pointer';
      copy.onclick = () => {
        pre.select();
        try { navigator.clipboard.writeText(diag); } catch (e) { document.execCommand('copy'); }
        copy.textContent = 'Copied';
      };
      const again = document.createElement('button');
      again.textContent = 'Reload';
      again.style.cssText = 'padding:11px 18px;border-radius:999px;background:#27272a;color:#fff;'
        + 'font-weight:600;font-size:14px;border:0;cursor:pointer';
      again.onclick = () => location.reload();
      row.append(copy, again);
      wrap.append(h, p, pre, row);
      box.appendChild(wrap);
      console.error('[golden shift]', title, err);
    },

    /* ---------------- lifecycle ---------------- */
    start() {
      this.started = true;
      this.game.unstick();
      this.game.paused = false;
      UI.hideAll();
      this.lockPointer();
      g.GameData.SFX.resume();
      UI.toast('Shift started — customers are on their way', 'info');
    },

    resume() {
      this.game.paused = false;
      UI.hideAll();
      this.lockPointer();
    },

    pause() {
      if (!this.started || UI.current) return;
      this.game.paused = true;
      UI.statCards(document.getElementById('pauseStats'), this.game);
      UI.show('pause');
      this.releasePointer();
      this.submit();
    },

    endShift() {
      this.game.paused = true;
      this.releasePointer();
      const gm = this.game;
      document.getElementById('overSub').textContent =
        gm.stats.served >= 20 ? 'Outstanding shift — the queue never stood a chance.'
        : gm.stats.served >= 8 ? 'Solid shift behind the counter.'
        : 'Every shift teaches you something.';
      UI.statCards(document.getElementById('overStats'), gm);
      UI.show('over');
      this.submit(true);
    },

    restart() {
      const gm = this.game;
      gm.customers.length = 0;
      gm.orders.length = 0;
      gm.hands.length = 0;
      gm.particles.length = 0;
      gm.popups.length = 0;
      gm.seats.forEach(s => { s.taken = -1; });
      Object.values(gm.stations).forEach(st => st.slots.fill(null));
      gm.stations.icecream.broken = false;
      gm.stats = { money: 0, xp: 0, level: 1, rep: 100, served: 0, missed: 0, revenue: 0, shift: 0, combo: 0, best: 0 };
      gm.player.x = gm.L.PLAYER_SPAWN[0]; gm.player.z = gm.L.PLAYER_SPAWN[1];
      gm.player.y = 0; gm.player.yaw = gm.L.PLAYER_SPAWN[2]; gm.player.pitch = 0;
      gm.unstick();
      gm.spawnTimer = 3;
      UI._last = {};
      this.start();
    },

    onJoinedRoom() {
      // A joining client mirrors the host's shift; clear the local sim.
      const gm = this.game;
      gm.customers.length = 0;
      gm.orders.length = 0;
      Object.values(gm.stations).forEach(st => st.slots.fill(null));
      if (!this.started) this.start(); else this.resume();
    },

    submit(force) {
      if (!g.Net.state.ready) return;
      const s = this.game.score();
      if (s <= 0) return;
      const now = performance.now();
      if (!force && now - (this._subT || 0) < 45000) return;
      this._subT = now;
      g.Net.submitScore(s, this.game.stats.level, this.game.stats.served).catch(() => {});
    },

    /* ---------------- input ---------------- */
    lockPointer() {
      if (document.pointerLockElement === canvas) return;
      const p = canvas.requestPointerLock && canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch (e) {} });
    },
    releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); },

    bindInput() {
      const inp = this.input;
      const keymap = {
        KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b',
        KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
      };

      addEventListener('keydown', (e) => {
        if (UI.chatOpen) return;
        if (keymap[e.code]) { inp[keymap[e.code]] = 1; e.preventDefault(); return; }
        switch (e.code) {
          case 'ShiftLeft': case 'ShiftRight': inp.sprint = 1; break;
          case 'Space': inp.jump = 1; e.preventDefault(); break;
          case 'KeyE': if (this.playing()) this.game.interact(); break;
          case 'KeyQ': if (this.playing()) this.game.dropOne(); break;
          case 'KeyT': if (this.playing()) { UI.openChat(); e.preventDefault(); } break;
          case 'F3': UI.opts.perf = !UI.opts.perf; UI.saveOpts(); e.preventDefault(); break;
          case 'Escape':
            if (UI.current === 'settings' || UI.current === 'board' || UI.current === 'multi') UI.show(UI.back || (this.started ? 'pause' : 'start'));
            else if (UI.current === 'pause') this.resume();
            else this.pause();
            break;
        }
      });

      addEventListener('keyup', (e) => {
        if (keymap[e.code]) { inp[keymap[e.code]] = 0; return; }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.sprint = 0;
        if (e.code === 'Space') inp.jump = 0;
      });

      addEventListener('blur', () => { inp.f = inp.b = inp.l = inp.r = inp.sprint = inp.jump = 0; });

      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = document.pointerLockElement === canvas;
        if (!this.pointerLocked && this.started && !UI.current && !UI.chatOpen) this.pause();
      });

      addEventListener('mousemove', (e) => {
        if (!this.pointerLocked || !this.playing()) return;
        this.game.look(e.movementX || 0, e.movementY || 0, 0.0022 * UI.opts.sens);
      });

      canvas.addEventListener('mousedown', (e) => {
        if (UI.current) return;
        if (!this.pointerLocked) { this.lockPointer(); return; }
        if (e.button === 0) this.game.interact();
        if (e.button === 2) this.game.dropOne();
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.playing()) this.pause(); });
    },

    playing() { return this.started && !this.game.paused && !UI.current && !UI.chatOpen; },

    /* ---------------- sizing ---------------- */
    resize(force) {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const s = UI.opts.scale * this.renderScale;
      const w = Math.max(320, Math.round(window.innerWidth * dpr * s));
      const h = Math.max(240, Math.round(window.innerHeight * dpr * s));
      if (force || canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
    },

    /* ---------------- loop ---------------- */
    loop(now) {
      requestAnimationFrame(this.loop.bind(this));
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25;

      this._frames++;
      this._fpsT += dt;
      if (this._fpsT >= 0.5) {
        this._fps = this._frames / this._fpsT;
        this._frames = 0; this._fpsT = 0;
      }

      if (this.playing()) this.game.update(dt, this.input);
      else if (this.started) this.game.updateParticles(0);

      this.game.render(canvas.width, canvas.height);

      if (this.started) {
        UI.hud(this.game, this._fps);
        UI.overlays(this.game);
      }

      this.adapt(dt);
    },

    /* Nudge the internal render resolution to hold ~60 FPS without ever
       touching the CSS size, so the UI stays crisp. */
    adapt(dt) {
      if (!UI.opts.adaptive || !this.playing()) return;
      this._adaptT += dt;
      if (this._adaptT < 0.5) return;
      this._adaptT = 0;
      const fps = this._fps;
      if (fps < 52 && this.renderScale > 0.55) {
        this._slow++; this._fast = 0;
        if (this._slow >= 2) { this.renderScale = Math.max(0.55, this.renderScale - 0.08); this._slow = 0; this.resize(true); }
      } else if (fps > 58.5 && this.renderScale < 1) {
        this._fast++; this._slow = 0;
        if (this._fast >= 6) { this.renderScale = Math.min(1, this.renderScale + 0.05); this._fast = 0; this.resize(true); }
      } else { this._slow = 0; this._fast = 0; }
    },
  };

  /* Yield to the browser so the loading text can repaint. Raced against a timer:
     a background or throttled tab never fires rAF, which would otherwise stall
     the whole boot indefinitely. */
  const frame = () => new Promise(r => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    try { requestAnimationFrame(() => setTimeout(fin, 0)); } catch (e) { /* ignore */ }
    setTimeout(fin, 150);
  });

  g.Main = Main;
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => Main.boot());
  else Main.boot();
})(window);
