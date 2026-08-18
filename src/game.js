/* Gameplay: player controller, customer AI, cooking stations, economy and the
   co-op sync model (host simulates customers, everyone can cook and serve). */
(function (g) {
  'use strict';

  const { clamp, lerp, approach, angLerp, mulberry32 } = g.MathX;
  const M4 = g.M4;
  const T = g.Atlas.T;

  const ITEMS = {
    burger:  { name: 'Burger',   icon: '🍔', station: 'grill',    cook: 3.4, burn: 3.2, price: 5.50, xp: 9,  lvl: 1, color: 0xd8a45a },
    fries:   { name: 'Fries',    icon: '🍟', station: 'fryer',    cook: 4.0, burn: 3.6, price: 3.25, xp: 7,  lvl: 1, color: 0xf2c44e },
    drink:   { name: 'Cola',     icon: '🥤', station: 'drinks',   cook: 2.2, burn: 99,  price: 2.50, xp: 5,  lvl: 1, color: 0xd12a20 },
    nuggets: { name: 'Nuggets',  icon: '🍗', station: 'fryer',    cook: 5.0, burn: 3.4, price: 6.00, xp: 11, lvl: 2, color: 0xd8a04e },
    flurry:  { name: 'McFlurry', icon: '🍦', station: 'icecream', cook: 3.2, burn: 99,  price: 4.75, xp: 10, lvl: 3, color: 0xf6efe2 },
    bigmac:  { name: 'Big Mac',  icon: '🥪', station: 'grill',    cook: 5.2, burn: 3.0, price: 8.50, xp: 15, lvl: 5, color: 0xc98a4a },
  };
  const ITEM_KEYS = Object.keys(ITEMS);
  const MODEL_OF = { burger: 'burger', fries: 'fries', drink: 'drink', nuggets: 'nuggets', flurry: 'flurry', bigmac: 'burger' };

  const SHIRTS = [0xdc4a3d, 0x3d6fdc, 0x37a06a, 0xe0a72c, 0x8f4fd0, 0x2fb3c0, 0xd8567f, 0x4a5568, 0xe07a2c, 0x5d8f3a];
  const SKINS = [0xf0c8a0, 0xdca878, 0xb98055, 0x8d5a38, 0x5f3a24, 0xf6d9b8];
  const HAIRS = [0x2a1f18, 0x4a3324, 0x7a5230, 0xa8752f, 0x1a1a1a, 0x8c8c8c, 0xc0392b];

  const xpForLevel = (l) => Math.round(55 * Math.pow(l, 1.42));

  /* Wire format for customer state — index, not initial: 'entering' and 'eating'
     share a first letter. */
  const STATES = ['entering', 'queue', 'ordering', 'waiting', 'toseat', 'eating', 'leaving', 'angry'];

  /* ------------------------------------------------------------------ */
  /* tiny WebAudio SFX — synthesised, zero downloads                      */
  const SFX = (function () {
    let ctx = null, master = null, enabled = true;
    function ac() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        master = ctx.createGain();
        master.gain.value = 0.22;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function beep(freq, dur, type, vol, slide) {
      if (!enabled) return;
      const c = ac(); if (!c) return;
      const o = c.createOscillator(), gn = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), c.currentTime + dur);
      gn.gain.setValueAtTime(0.0001, c.currentTime);
      gn.gain.exponentialRampToValueAtTime(vol === undefined ? 0.5 : vol, c.currentTime + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(gn); gn.connect(master);
      o.start(); o.stop(c.currentTime + dur + 0.02);
    }
    function noise(dur, vol) {
      if (!enabled) return;
      const c = ac(); if (!c) return;
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
      const gn = c.createGain(); gn.gain.value = vol === undefined ? 0.35 : vol;
      src.connect(f); f.connect(gn); gn.connect(master);
      src.start();
    }
    return {
      set enabled(v) { enabled = v; }, get enabled() { return enabled; },
      resume() { ac(); },
      pick() { beep(660, 0.07, 'square', 0.35); },
      place() { beep(320, 0.08, 'triangle', 0.35); },
      ding() { beep(880, 0.1, 'sine', 0.5); setTimeout(() => beep(1320, 0.14, 'sine', 0.4), 70); },
      cash() { beep(760, 0.07, 'square', 0.4); setTimeout(() => beep(1140, 0.13, 'square', 0.35), 60); },
      level() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.16, 'triangle', 0.4), i * 85)); },
      bad() { beep(220, 0.22, 'sawtooth', 0.3, 90); },
      sizzle() { noise(0.5, 0.12); },
      order() { beep(520, 0.06, 'square', 0.3); setTimeout(() => beep(700, 0.09, 'square', 0.28), 55); },
      step() { noise(0.045, 0.05); },
    };
  })();

  /* ------------------------------------------------------------------ */

  class Game {
    constructor(renderer, world, models, opts) {
      this.r = renderer;
      this.world = world;
      this.L = world.L;
      this.models = models;
      this.opts = opts;
      this.rnd = mulberry32(Date.now() & 0xffff);

      this.mesh = {
        opaque: renderer.mesh(world.opaque),
        emis: renderer.mesh(world.emis),
        decal: renderer.mesh(world.decal),
        glass: renderer.mesh(world.glass),
        dyn: renderer.mesh(models),
      };
      this.R = models.ranges;

      this.player = {
        x: this.L.PLAYER_SPAWN[0], y: 0, z: this.L.PLAYER_SPAWN[1],
        vx: 0, vy: 0, vz: 0, yaw: this.L.PLAYER_SPAWN[2], pitch: 0,
        onGround: true, bob: 0, step: 0, speed: 0,
      };
      this.hands = [];
      this.handsMax = 4;

      this.stats = { money: 0, xp: 0, level: 1, rep: 100, served: 0, missed: 0, revenue: 0, shift: 0, combo: 0, best: 0 };

      this.customers = [];
      this.orders = [];
      this.nextId = 1;
      this.spawnTimer = 3;
      this.particles = [];
      this.popups = [];
      this.seats = this.L.SEATS.map(s => Object.assign({}, s, { taken: -1 }));

      this.stations = {
        grill:    { slots: [null, null, null, null], pos: this.L.GRILL,    y: 1.02 },
        fryer:    { slots: [null, null],             pos: this.L.FRYER,    y: 0.90 },
        drinks:   { slots: [null],                   pos: this.L.DRINKS,   y: 0.97 },
        icecream: { slots: [null],                   pos: this.L.ICECREAM, y: 0.97, broken: false },
      };
      this.stationSlotOffsets = {
        grill: [[-1.2, 0], [-0.4, 0], [0.4, 0], [1.2, 0]],
        fryer: [[-0.45, 0], [0.45, 0]],
        drinks: [[0, 0.3]],
        icecream: [[0, 0.36]],
      };

      this.interactables = [
        { id: 'register', x: this.L.REGISTER[0], y: 1.15, z: this.L.REGISTER[1] + 0.1, r: 2.3 },
        { id: 'pickup',   x: this.L.PICKUP[0],   y: 1.15, z: this.L.PICKUP[1] + 0.1,   r: 2.3 },
        { id: 'grill',    x: this.L.GRILL[0],    y: 1.05, z: this.L.GRILL[1] + 0.55,   r: 2.4 },
        { id: 'fryer',    x: this.L.FRYER[0],    y: 1.0,  z: this.L.FRYER[1] + 0.5,    r: 2.2 },
        { id: 'drinks',   x: this.L.DRINKS[0],   y: 1.1,  z: this.L.DRINKS[1] + 0.5,   r: 2.2 },
        { id: 'icecream', x: this.L.ICECREAM[0], y: 1.1,  z: this.L.ICECREAM[1] + 0.5, r: 2.2 },
        { id: 'trash',    x: this.L.TRASH[0],    y: 0.9,  z: this.L.TRASH[1],          r: 1.9 },
      ];
      this.focus = null;

      this.env = {
        sunDir: new Float32Array([0.42, 0.83, 0.36]),
        sunCol: new Float32Array([0.40, 0.36, 0.29]),
        skyCol: new Float32Array([0.78, 0.80, 0.85]),
        grdCol: new Float32Array([0.57, 0.55, 0.53]),
        fog: [0.66, 0.78, 0.89],
        fogK: 0.00022,
      };
      const len = Math.hypot(this.env.sunDir[0], this.env.sunDir[1], this.env.sunDir[2]);
      for (let i = 0; i < 3; i++) this.env.sunDir[i] /= len;

      this.vp = M4.create(); this.proj = M4.create(); this.viewM = M4.create();
      this._m = M4.create(); this._a = M4.create(); this._b = M4.create(); this._c = M4.create();
      this.eye = [0, 1.62, 0];
      this.paused = false;
      this.unstick();
      this.tips = [];
      this.events = [];       // outbound queue for co-op
      this.remoteCustomers = null;
      this.SFX = SFX;
      this.ITEMS = ITEMS;
      this.onToast = () => {};
      this.onLevel = () => {};
    }

    /* ---------------- helpers ---------------- */
    get isHost() { return !g.Net || !g.Net.state.room || g.Net.state.isHost; }
    get inRoom() { return !!(g.Net && g.Net.state.room); }

    unlocked() { return ITEM_KEYS.filter(k => ITEMS[k].lvl <= this.stats.level); }

    toast(msg, kind) { this.onToast(msg, kind); }

    popup(x, y, z, text, kind) {
      if (this.popups.length > 10) this.popups.shift();
      this.popups.push({ x, y, z, text, kind: kind || 'good', t: 0, life: 1.35 });
    }

    /* ---------------- input ---------------- */
    look(dx, dy, sens) {
      const p = this.player;
      p.yaw -= dx * sens;
      p.pitch = clamp(p.pitch - dy * sens, -1.45, 1.45);
    }

    /* If the player ever ends up inside a solid (spawn, teleport, a layout edit),
       nudge them to the nearest free spot instead of locking them in place. */
    unstick() {
      const p = this.player;
      if (!this.collide(p.x, p.z, 0.34)) return;
      for (let r = 0.4; r <= 6; r += 0.4) {
        for (let a = 0; a < 16; a++) {
          const t = (a / 16) * Math.PI * 2;
          const x = p.x + Math.cos(t) * r, z = p.z + Math.sin(t) * r;
          if (!this.collide(x, z, 0.34)) { p.x = x; p.z = z; return; }
        }
      }
    }

    /* ---------------- collision ---------------- */
    collide(px, pz, r) {
      const s = this.world.solids;
      for (let i = 0; i < s.length; i++) {
        const b = s[i];
        if (b.h < 0.45) continue;
        if (px > b.x0 - r && px < b.x1 + r && pz > b.z0 - r && pz < b.z1 + r) return b;
      }
      return null;
    }

    move(dt, input) {
      const p = this.player, r = 0.34;
      const sp = input.sprint ? 5.4 : 3.15;
      let fx = 0, fz = 0;
      if (input.f) fz += 1; if (input.b) fz -= 1;
      if (input.r) fx += 1; if (input.l) fx -= 1;
      const m = Math.hypot(fx, fz);
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      let wx = 0, wz = 0;
      if (m > 0) {
        fx /= m; fz /= m;
        wx = (-sy * fz + cy * fx) * sp;
        wz = (-cy * fz - sy * fx) * sp;
      }
      p.vx = approach(p.vx, wx, 14, dt);
      p.vz = approach(p.vz, wz, 14, dt);

      // vertical
      p.vy -= 21 * dt;
      if (input.jump && p.onGround) { p.vy = 5.4; p.onGround = false; SFX.step(); }
      p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }

      // axis-separated horizontal resolution
      const nx = p.x + p.vx * dt;
      if (!this.collide(nx, p.z, r)) p.x = nx; else p.vx = 0;
      const nz = p.z + p.vz * dt;
      if (!this.collide(p.x, nz, r)) p.z = nz; else p.vz = 0;

      p.x = clamp(p.x, -32, 32); p.z = clamp(p.z, -32, 25);

      const spd = Math.hypot(p.vx, p.vz);
      p.speed = spd;
      if (p.onGround && spd > 0.4) {
        p.bob += dt * spd * 1.9;
        const prev = p.step;
        p.step = Math.sin(p.bob * 2);
        if (prev < 0 && p.step >= 0) SFX.step();
      } else {
        p.bob = approach(p.bob, Math.round(p.bob / Math.PI) * Math.PI, 8, dt);
      }
      this.eye[0] = p.x;
      this.eye[1] = p.y + 1.62 + Math.sin(p.bob * 2) * 0.035 * clamp(spd / 3, 0, 1.4);
      this.eye[2] = p.z;
    }

    /* ---------------- focus / interaction ---------------- */
    updateFocus() {
      const p = this.player;
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const fx = -sy, fz = -cy;
      let best = null, bestScore = -1;
      for (const it of this.interactables) {
        const dx = it.x - p.x, dz = it.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > it.r) continue;
        const dot = (dx / (d || 1)) * fx + (dz / (d || 1)) * fz;
        if (dot < 0.30) continue;
        const score = dot * 2 - d * 0.35;
        if (score > bestScore) { bestScore = score; best = it; }
      }
      this.focus = best;
    }

    /* Which item should this station make next, based on outstanding tickets? */
    neededAt(station) {
      const want = {};
      for (const o of this.orders) {
        if (o.done) continue;
        o.items.forEach((k, i) => { if (!o.made[i]) want[k] = (want[k] || 0) + 1; });
      }
      // subtract what is already cooking or in hands
      Object.values(this.stations).forEach(st => st.slots.forEach(s => { if (s && want[s.item]) want[s.item]--; }));
      this.hands.forEach(h => { if (want[h.item]) want[h.item]--; });
      const opts = this.unlocked().filter(k => ITEMS[k].station === station);
      let bestK = null, bestN = 0;
      for (const k of opts) if ((want[k] || 0) > bestN) { bestN = want[k]; bestK = k; }
      return bestK || opts[opts.length - 1] || null;
    }

    prompt() {
      const f = this.focus;
      if (!f) return null;
      switch (f.id) {
        case 'register': {
          const c = this.customerAt('ordering');
          if (!c) return { text: 'No one waiting to order', key: null };
          if (this.orders.length >= 6) return { text: 'Too many open tickets', key: null };
          return { text: `Take ${c.name}'s order`, key: 'E' };
        }
        case 'pickup': {
          const c = this.customerAt('waiting');
          if (!c) return { text: 'No one waiting for food', key: null };
          const o = this.orders.find(o => o.cid === c.id);
          if (!o) return { text: 'No ticket', key: null };
          const need = o.items.filter((k, i) => !o.made[i]);
          const can = this.hands.some(h => need.includes(h.item) && !h.burnt);
          if (!can) return { text: `Needs ${need.map(k => ITEMS[k].icon).join(' ')}`, key: null };
          return { text: `Serve ${c.name}`, key: 'E' };
        }
        case 'trash': return { text: this.hands.length ? 'Bin the food' : 'Trash (empty hands)', key: this.hands.length ? 'E' : null };
        default: {
          const st = this.stations[f.id];
          if (!st) return null;
          if (f.id === 'icecream' && st.broken) return { text: 'Ice cream machine is broken 🙃', key: null };
          const doneIdx = st.slots.findIndex(s => s && s.t >= s.cook);
          if (doneIdx >= 0) {
            const s = st.slots[doneIdx];
            if (this.hands.length >= this.handsMax) return { text: 'Hands full', key: null };
            return { text: s.burnt ? `Take burnt ${ITEMS[s.item].name}` : `Take ${ITEMS[s.item].name} ${ITEMS[s.item].icon}`, key: 'E' };
          }
          const free = st.slots.indexOf(null);
          if (free < 0) return { text: 'Cooking…', key: null };
          const k = this.neededAt(f.id);
          if (!k) return { text: 'Nothing to make', key: null };
          return { text: `Start ${ITEMS[k].name} ${ITEMS[k].icon}`, key: 'E' };
        }
      }
    }

    customerAt(state) {
      // front-most customer in the given state
      let best = null, bestZ = 1e9;
      for (const c of this.customers) {
        if (c.state !== state) continue;
        if (c.z < bestZ) { bestZ = c.z; best = c; }
      }
      return best;
    }

    interact() {
      const f = this.focus;
      if (!f) return;
      const pr = this.prompt();
      if (!pr || !pr.key) { SFX.bad(); return; }

      if (f.id === 'register') {
        const c = this.customerAt('ordering');
        if (!c) return;
        this.takeOrder(c);
        if (!this.isHost) this.emit({ k: 'take', c: c.id });
        return;
      }
      if (f.id === 'pickup') {
        const c = this.customerAt('waiting');
        if (!c) return;
        this.serve(c);
        return;
      }
      if (f.id === 'trash') {
        if (!this.hands.length) return;
        this.hands.length = 0;
        SFX.bad();
        this.toast('Binned everything in your hands', 'warn');
        return;
      }
      const st = this.stations[f.id];
      if (!st) return;
      const doneIdx = st.slots.findIndex(s => s && s.t >= s.cook);
      if (doneIdx >= 0) {
        const s = st.slots[doneIdx];
        if (this.hands.length >= this.handsMax) return;
        this.hands.push({ item: s.item, burnt: s.burnt });
        st.slots[doneIdx] = null;
        SFX.pick();
        if (!this.isHost) this.emit({ k: 'grab', s: f.id, i: doneIdx });
        return;
      }
      const free = st.slots.indexOf(null);
      const k = this.neededAt(f.id);
      if (free < 0 || !k) return;
      this.startCook(f.id, free, k);
      if (!this.isHost) this.emit({ k: 'cook', s: f.id, i: free, it: k });
    }

    startCook(station, slot, item) {
      const st = this.stations[station];
      const def = ITEMS[item];
      st.slots[slot] = { item, t: 0, cook: def.cook, burn: def.cook + def.burn, burnt: false };
      SFX.place();
      if (station === 'grill' || station === 'fryer') SFX.sizzle();
    }

    dropOne() {
      if (!this.hands.length) return;
      this.hands.pop();
      SFX.bad();
    }

    /* ---------------- orders ---------------- */
    takeOrder(c) {
      if (c.state !== 'ordering' || this.orders.length >= 6) return;
      const pool = this.unlocked();
      const n = 1 + Math.floor(this.rnd() * Math.min(3, 1 + Math.floor(this.stats.level / 2)));
      const items = [];
      for (let i = 0; i < n; i++) items.push(pool[Math.floor(this.rnd() * pool.length)]);
      const value = items.reduce((a, k) => a + ITEMS[k].price, 0);
      const order = {
        id: this.nextId++, cid: c.id, name: c.name, color: c.shirt,
        items, made: items.map(() => false), value,
        t: 0, limit: 42 + items.length * 16, done: false,
      };
      this.orders.push(order);
      c.state = 'waiting';
      c.patience = order.limit;
      c.patienceMax = order.limit;
      c.slot = -1;
      SFX.order();
      this.toast(`Order #${order.id}: ${items.map(k => ITEMS[k].icon).join(' ')}`, 'info');
    }

    serve(c) {
      const o = this.orders.find(x => x.cid === c.id);
      if (!o) return;
      let gave = 0, burnt = 0;
      for (let i = this.hands.length - 1; i >= 0; i--) {
        const h = this.hands[i];
        const idx = o.items.findIndex((k, j) => !o.made[j] && k === h.item);
        if (idx >= 0) {
          o.made[idx] = true;
          if (h.burnt) burnt++;
          this.hands.splice(i, 1);
          gave++;
        }
      }
      if (!gave) { SFX.bad(); return; }
      SFX.pick();
      if (o.made.every(Boolean)) this.completeOrder(o, c, burnt);
      else this.toast(`Handed over ${gave} item${gave > 1 ? 's' : ''}`, 'info');
      if (!this.isHost) this.emit({ k: 'serve', c: c.id, o: o.id, m: o.made.slice(), b: burnt });
    }

    completeOrder(o, c, burnt) {
      o.done = true;
      const speed = clamp(1 - (o.t / o.limit), 0, 1);
      const patienceBonus = 1 + speed * 0.55;
      const burntPenalty = burnt ? Math.pow(0.55, burnt) : 1;
      const levelMul = 1 + (this.stats.level - 1) * 0.045;
      this.stats.combo = burnt ? 0 : this.stats.combo + 1;
      const comboMul = 1 + Math.min(this.stats.combo, 10) * 0.03;
      const pay = o.value * patienceBonus * burntPenalty * levelMul * comboMul;
      const xp = Math.round(o.items.reduce((a, k) => a + ITEMS[k].xp, 0) * (burnt ? 0.5 : 1) * (1 + speed * 0.4));

      this.stats.money += pay;
      this.stats.revenue += pay;
      this.stats.xp += xp;
      this.stats.served++;
      this.stats.rep = clamp(this.stats.rep + (burnt ? -2 : 1.6), 0, 100);
      this.stats.best = Math.max(this.stats.best, this.stats.combo);

      this.popup(c.x, 1.9, c.z, `+$${pay.toFixed(2)}`, burnt ? 'warn' : 'good');
      this.popup(c.x, 2.25, c.z, `+${xp} XP`, 'xp');
      SFX.cash();
      if (speed > 0.72 && !burnt) { this.toast(`Fast service! ×${comboMul.toFixed(2)} combo`, 'good'); }

      this.orders = this.orders.filter(x => x !== o);
      c.state = 'toseat';
      c.happy = burnt ? 0.4 : 1;
      this.checkLevel();
    }

    checkLevel() {
      let leveled = false;
      while (this.stats.xp >= xpForLevel(this.stats.level)) {
        this.stats.xp -= xpForLevel(this.stats.level);
        this.stats.level++;
        leveled = true;
        const unlock = ITEM_KEYS.find(k => ITEMS[k].lvl === this.stats.level);
        this.onLevel(this.stats.level, unlock ? ITEMS[unlock] : null);
        SFX.level();
      }
      return leveled;
    }

    /* ---------------- customers ---------------- */
    spawnCustomer() {
      const rnd = this.rnd;
      const names = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Avery', 'Rowan', 'Skyler', 'Emery', 'Reese', 'Jamie', 'Noor', 'Kai', 'Dev'];
      const c = {
        id: this.nextId++,
        name: names[Math.floor(rnd() * names.length)],
        x: this.L.SPAWN[0] + (rnd() - 0.5) * 6, z: this.L.SPAWN[1] + rnd() * 4,
        yaw: Math.PI, vx: 0, vz: 0,
        state: 'entering', slot: -1, seat: -1,
        anim: 0, patience: 60, patienceMax: 60, timer: 0,
        shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)],
        skin: SKINS[Math.floor(rnd() * SKINS.length)],
        hair: HAIRS[Math.floor(rnd() * HAIRS.length)],
        scale: 0.92 + rnd() * 0.18,
        happy: 1,
      };
      this.customers.push(c);
      return c;
    }

    steer(c, tx, tz, dt, speed) {
      let dx = tx - c.x, dz = tz - c.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) { dx /= d; dz /= d; }
      // avoid tables/chairs
      for (const o of this.world.round) {
        const ox = c.x - o.x, oz = c.z - o.z;
        const od = Math.hypot(ox, oz);
        const lim = o.r + 0.45;
        if (od < lim && od > 0.001) {
          const push = (lim - od) / lim;
          dx += (ox / od) * push * 2.4;
          dz += (oz / od) * push * 2.4;
        }
      }
      // separate from other customers
      for (const o of this.customers) {
        if (o === c) continue;
        const ox = c.x - o.x, oz = c.z - o.z;
        const od = Math.hypot(ox, oz);
        if (od < 0.75 && od > 0.001) {
          dx += (ox / od) * (0.75 - od) * 2.0;
          dz += (oz / od) * (0.75 - od) * 2.0;
        }
      }
      const m = Math.hypot(dx, dz) || 1;
      const sp = speed === undefined ? 1.55 : speed;
      c.vx = approach(c.vx, (dx / m) * sp * Math.min(1, d * 2.2), 9, dt);
      c.vz = approach(c.vz, (dz / m) * sp * Math.min(1, d * 2.2), 9, dt);
      c.x += c.vx * dt; c.z += c.vz * dt;
      const sp2 = Math.hypot(c.vx, c.vz);
      if (sp2 > 0.12) {
        c.yaw = angLerp(c.yaw, Math.atan2(-c.vx, -c.vz), Math.min(1, dt * 9));
        c.anim += dt * sp2 * 3.1;
      } else {
        c.anim = approach(c.anim, Math.round(c.anim / Math.PI) * Math.PI, 8, dt);
      }
      return d;
    }

    freeSeat() {
      const free = this.seats.filter(s => s.taken < 0);
      if (!free.length) return null;
      return free[Math.floor(this.rnd() * free.length)];
    }

    updateCustomers(dt) {
      const L = this.L;
      // queue slot assignment
      const queue = this.customers.filter(c => c.state === 'queue' || c.state === 'ordering');
      queue.sort((a, b) => a.z - b.z);
      queue.forEach((c, i) => { c.slot = Math.min(i, L.QUEUE.length - 1); });

      const waiting = this.customers.filter(c => c.state === 'waiting');
      waiting.sort((a, b) => a.z - b.z);
      waiting.forEach((c, i) => { c.slot = Math.min(i, L.PICKUP_Q.length - 1); });

      for (let i = this.customers.length - 1; i >= 0; i--) {
        const c = this.customers[i];
        switch (c.state) {
          case 'entering': {
            const d = this.steer(c, L.DOOR_IN[0], L.DOOR_IN[1], dt, 1.7);
            if (d < 0.7) c.state = 'queue';
            break;
          }
          case 'queue': {
            const q = L.QUEUE[Math.max(0, c.slot)];
            const d = this.steer(c, q[0], q[1], dt, 1.5);
            if (c.slot === 0 && d < 0.4) {
              c.state = 'ordering';
              c.patience = 45; c.patienceMax = 45;
              c.yaw = angLerp(c.yaw, Math.PI, 1);
            }
            break;
          }
          case 'ordering': {
            const q = L.QUEUE[0];
            this.steer(c, q[0], q[1], dt, 1.3);
            c.yaw = angLerp(c.yaw, Math.PI, Math.min(1, dt * 5));
            c.patience -= dt;
            if (c.patience <= 0) this.storm(c);
            break;
          }
          case 'waiting': {
            const q = L.PICKUP_Q[Math.max(0, c.slot)];
            this.steer(c, q[0], q[1], dt, 1.5);
            if (c.slot === 0) c.yaw = angLerp(c.yaw, Math.PI, Math.min(1, dt * 5));
            c.patience -= dt;
            const o = this.orders.find(o => o.cid === c.id);
            if (o) o.t += dt;
            if (c.patience <= 0) this.storm(c);
            break;
          }
          case 'toseat': {
            if (c.seat < 0) {
              const s = this.freeSeat();
              if (!s) { c.state = 'leaving'; break; }
              s.taken = c.id; c.seat = this.seats.indexOf(s);
            }
            const s = this.seats[c.seat];
            const d = this.steer(c, s.x, s.z, dt, 1.5);
            if (d < 0.3) { c.state = 'eating'; c.timer = 12 + this.rnd() * 10; c.yaw = s.yaw; }
            break;
          }
          case 'eating': {
            c.timer -= dt;
            c.vx = approach(c.vx, 0, 10, dt); c.vz = approach(c.vz, 0, 10, dt);
            c.anim = approach(c.anim, 0, 6, dt);
            if (c.timer <= 0) {
              if (this.seats[c.seat]) this.seats[c.seat].taken = -1;
              c.seat = -1;
              c.state = 'leaving';
              const tip = c.happy * (0.4 + this.rnd() * 1.6) * (1 + this.stats.level * 0.05);
              this.stats.money += tip; this.stats.revenue += tip;
              this.popup(c.x, 1.8, c.z, `tip +$${tip.toFixed(2)}`, 'good');
            }
            break;
          }
          case 'leaving': case 'angry': {
            const d = this.steer(c, L.DOOR_OUT[0], L.DOOR_OUT[1], dt, c.state === 'angry' ? 2.1 : 1.6);
            if (d < 1.0) {
              if (c.seat >= 0 && this.seats[c.seat]) this.seats[c.seat].taken = -1;
              this.customers.splice(i, 1);
            }
            break;
          }
        }
      }
    }

    storm(c) {
      c.state = 'angry';
      c.happy = 0;
      this.stats.rep = clamp(this.stats.rep - 7, 0, 100);
      this.stats.combo = 0;
      this.stats.missed++;
      this.orders = this.orders.filter(o => o.cid !== c.id);
      this.popup(c.x, 1.9, c.z, 'walked out 😠', 'bad');
      this.toast(`${c.name} got tired of waiting`, 'bad');
      SFX.bad();
    }

    spawnRate() {
      const base = 7.5 - Math.min(4.2, this.stats.level * 0.42);
      const peers = 1 + (this.inRoom ? Object.keys(g.Net.state.peers).length : 0);
      return Math.max(2.0, base / Math.sqrt(peers)) * (0.7 + this.rnd() * 0.6);
    }

    /* ---------------- stations ---------------- */
    updateStations(dt, visualOnly) {
      for (const key in this.stations) {
        const st = this.stations[key];
        for (let i = 0; i < st.slots.length; i++) {
          const s = st.slots[i];
          if (!s) continue;
          const was = s.t < s.cook;
          if (!visualOnly) s.t += dt;
          if (!visualOnly && was && s.t >= s.cook) {
            SFX.ding();
            this.toast(`${ITEMS[s.item].name} ready ${ITEMS[s.item].icon}`, 'good');
          }
          if (!visualOnly && !s.burnt && s.t >= s.burn) {
            s.burnt = true;
            this.toast(`${ITEMS[s.item].name} burnt!`, 'bad');
            SFX.bad();
          }
          if (this.opts.particles && s.t < s.burn && (key === 'grill' || key === 'fryer') && Math.random() < dt * 2.6) {
            const off = this.stationSlotOffsets[key][i];
            this.spawnPuff(st.pos[0] + off[0], st.y + 0.1, st.pos[1] + off[1], s.burnt);
          }
          if (s.burnt && this.opts.particles && Math.random() < dt * 4.5) {
            const off = this.stationSlotOffsets[key][i];
            this.spawnPuff(st.pos[0] + off[0], st.y + 0.1, st.pos[1] + off[1], true);
          }
        }
      }
      // the ice cream machine, faithfully, breaks
      if (!visualOnly && this.stats.level >= 3) {
        if (!this.stations.icecream.broken && Math.random() < dt * 0.004) {
          this.stations.icecream.broken = true;
          this.stations.icecream.fixIn = 25 + Math.random() * 30;
          this.toast('The ice cream machine is down 🍦💀', 'warn');
        } else if (this.stations.icecream.broken) {
          this.stations.icecream.fixIn -= dt;
          if (this.stations.icecream.fixIn <= 0) {
            this.stations.icecream.broken = false;
            this.toast('Ice cream machine is back!', 'good');
          }
        }
      }
    }

    spawnPuff(x, y, z, dark) {
      if (this.particles.length > 70) return;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.25, y, z: z + (Math.random() - 0.5) * 0.25,
        vy: 0.5 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.18, vz: (Math.random() - 0.5) * 0.18,
        t: 0, life: 0.8 + Math.random() * 0.5, size: 0.10 + Math.random() * 0.09,
        dark: !!dark,
      });
    }

    updateParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.t += dt;
        if (p.t >= p.life) { this.particles.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vy = approach(p.vy, 0.25, 1.2, dt);
      }
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.t += dt;
        if (p.t >= p.life) this.popups.splice(i, 1);
      }
    }

    /* ---------------- co-op ---------------- */
    emit(ev) { if (this.inRoom) g.Net.sendEvent(ev); }

    applyEvent(ev) {
      if (!this.isHost) return;
      switch (ev.k) {
        case 'take': {
          const c = this.customers.find(c => c.id === ev.c);
          if (c && c.state === 'ordering') this.takeOrder(c);
          break;
        }
        case 'cook': {
          const st = this.stations[ev.s];
          if (st && !st.slots[ev.i] && ITEMS[ev.it]) this.startCook(ev.s, ev.i, ev.it);
          break;
        }
        case 'grab': {
          const st = this.stations[ev.s];
          if (st && st.slots[ev.i] && st.slots[ev.i].t >= st.slots[ev.i].cook) st.slots[ev.i] = null;
          break;
        }
        case 'serve': {
          const o = this.orders.find(x => x.id === ev.o);
          const c = this.customers.find(x => x.id === ev.c);
          if (!o || !c) break;
          ev.m.forEach((v, i) => { if (v) o.made[i] = true; });
          if (o.made.every(Boolean)) this.completeOrder(o, c, ev.b || 0);
          break;
        }
      }
    }

    /* Compact snapshot: customers as one string, stations as one string. */
    packSim() {
      const cs = this.customers.map(c =>
        [c.id, Math.max(0, STATES.indexOf(c.state)), c.x.toFixed(2), c.z.toFixed(2), c.yaw.toFixed(2),
         (c.patience / (c.patienceMax || 1)).toFixed(2), c.anim.toFixed(1),
         c.shirt.toString(16), c.skin.toString(16), c.hair.toString(16), c.scale.toFixed(2), c.name].join(',')
      ).join(';');
      const sts = Object.keys(this.stations).map(k =>
        k + ':' + this.stations[k].slots.map(s => s ? `${s.item},${s.t.toFixed(2)},${s.cook},${s.burn},${s.burnt ? 1 : 0}` : '').join('|')
      ).join(';');
      return {
        c: cs, s: sts,
        o: this.orders.map(o => ({ i: o.id, c: o.cid, n: o.name, k: o.items.join(','), m: o.made.map(v => v ? 1 : 0).join(''), t: Math.round(o.t), l: o.limit, v: o.value })),
        st: { m: this.stats.money, x: this.stats.xp, l: this.stats.level, r: this.stats.rep, s: this.stats.served, v: this.stats.revenue, sh: this.stats.shift, cb: this.stats.combo },
        b: this.stations.icecream.broken ? 1 : 0,
      };
    }

    applySim(v) {
      if (this.isHost || !v) return;
      // customers
      const seen = {};
      if (v.c) {
        v.c.split(';').forEach(row => {
          if (!row) return;
          const f = row.split(',');
          const id = +f[0];
          seen[id] = true;
          let c = this.customers.find(x => x.id === id);
          if (!c) {
            c = { id, name: f[11] || 'Guest', x: +f[2], z: +f[3], yaw: +f[4], vx: 0, vz: 0, anim: 0, slot: -1, seat: -1,
                  shirt: parseInt(f[7], 16), skin: parseInt(f[8], 16), hair: parseInt(f[9], 16), scale: +f[10],
                  patience: 1, patienceMax: 1, happy: 1, tx: +f[2], tz: +f[3], tyaw: +f[4] };
            this.customers.push(c);
          }
          c.state = STATES[+f[1]] || 'queue';
          c.tx = +f[2]; c.tz = +f[3]; c.tyaw = +f[4];
          c.patience = +f[5]; c.patienceMax = 1;
          c.anim = +f[6];
        });
      }
      this.customers = this.customers.filter(c => seen[c.id]);
      // stations
      if (v.s) {
        v.s.split(';').forEach(part => {
          const [k, rest] = part.split(':');
          const st = this.stations[k];
          if (!st) return;
          (rest || '').split('|').forEach((cell, i) => {
            if (i >= st.slots.length) return;
            if (!cell) { st.slots[i] = null; return; }
            const f = cell.split(',');
            st.slots[i] = { item: f[0], t: +f[1], cook: +f[2], burn: +f[3], burnt: f[4] === '1' };
          });
        });
      }
      this.stations.icecream.broken = !!v.b;
      // orders
      this.orders = (v.o || []).map(o => ({
        id: o.i, cid: o.c, name: o.n, items: o.k.split(','), made: o.m.split('').map(x => x === '1'),
        t: o.t, limit: o.l, value: o.v, done: false,
        color: (this.customers.find(c => c.id === o.c) || {}).shirt || 0xcccccc,
      }));
      const prevLevel = this.stats.level;
      if (v.st) {
        this.stats.money = v.st.m; this.stats.xp = v.st.x; this.stats.level = v.st.l;
        this.stats.rep = v.st.r; this.stats.served = v.st.s; this.stats.revenue = v.st.v;
        this.stats.shift = v.st.sh; this.stats.combo = v.st.cb;
      }
      if (this.stats.level > prevLevel) { SFX.level(); this.onLevel(this.stats.level, null); }
    }

    interpolateRemote(dt) {
      for (const c of this.customers) {
        if (c.tx === undefined) continue;
        c.x = lerp(c.x, c.tx, Math.min(1, dt * 9));
        c.z = lerp(c.z, c.tz, Math.min(1, dt * 9));
        c.yaw = angLerp(c.yaw, c.tyaw, Math.min(1, dt * 9));
      }
      const peers = g.Net.state.peers;
      for (const uid in peers) {
        const p = peers[uid];
        p.ix = lerp(p.ix === undefined ? p.x : p.ix, p.x, Math.min(1, dt * 11));
        p.iy = lerp(p.iy === undefined ? p.y : p.iy, p.y, Math.min(1, dt * 11));
        p.iz = lerp(p.iz === undefined ? p.z : p.iz, p.z, Math.min(1, dt * 11));
        p.iyaw = angLerp(p.iyaw === undefined ? p.yaw : p.iyaw, p.yaw, Math.min(1, dt * 11));
        const moved = Math.hypot(p.x - p.ix, p.z - p.iz);
        p.anim = (p.anim || 0) + dt * Math.min(6, moved * 40);
      }
    }

    /* ---------------- main update ---------------- */
    update(dt, input) {
      if (this.paused) return;
      dt = Math.min(dt, 0.05);
      this.stats.shift += dt;
      this.move(dt, input);
      this.updateFocus();

      if (this.isHost) {
        this.spawnTimer -= dt;
        const cap = this.opts.maxCustomers;
        if (this.spawnTimer <= 0 && this.customers.length < cap) {
          this.spawnCustomer();
          this.spawnTimer = this.spawnRate();
        }
        this.updateCustomers(dt);
        this.updateStations(dt);
        if (this.inRoom) g.Net.sendSim(this.packSim());
      } else {
        this.updateStations(dt, true); // visuals only; the host owns the timers
      }
      if (this.inRoom) {
        this.interpolateRemote(dt);
        g.Net.sendSelf({
          x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw,
          anim: Math.round(this.player.bob * 10) % 628, hold: this.hands.length,
        });
      }
      this.updateParticles(dt);
    }

    /* ---------------- rendering ---------------- */
    drawHumanoid(px, py, pz, yaw, anim, scale, colors, opts) {
      const r = this.r, R = this.R, M = this._m, A = this._a, B = this._b, C = this._c;
      const swing = Math.sin(anim) * 0.62;
      const swing2 = Math.sin(anim + Math.PI) * 0.62;
      const bob = Math.abs(Math.sin(anim)) * 0.035;
      const sit = opts && opts.sit;
      const shirt = colors.shirt, skin = colors.skin, hair = colors.hair;
      const tint = (hex, a) => {
        const t = this._tint || (this._tint = new Float32Array(4));
        t[0] = ((hex >> 16) & 255) / 255; t[1] = ((hex >> 8) & 255) / 255; t[2] = (hex & 255) / 255; t[3] = a === undefined ? 1 : a;
        return t;
      };

      M4.fromT(A, px, py + (sit ? -0.38 : 0) + bob * scale, pz);
      M4.fromRY(B, yaw);
      M4.mul(C, A, B);
      const root = this._rootM || (this._rootM = M4.create());
      if (scale !== 1) { M4.fromS(A, scale, scale, scale); M4.mul(root, C, A); } else { root.set(C); }

      const part = (range, lx, ly, lz, rot, colHex) => {
        M4.fromT(A, lx, ly, lz);
        M4.mul(B, root, A);
        if (rot) { M4.fromRX(A, rot); M4.mul(C, B, A); } else { C.set(B); }
        r.draw(this.mesh.dyn, C, R[range], tint(colHex));
      };

      const legRot = sit ? -1.15 : swing;
      const legRot2 = sit ? -1.15 : swing2;
      part('legL', -0.13, 0.82, 0, legRot, colors.pants || 0x3a4152);
      part('legR', 0.13, 0.82, 0, legRot2, colors.pants || 0x3a4152);
      part('torso', 0, 0.82, 0, sit ? 0.06 : 0, shirt);
      part('armL', -0.32, 1.40, 0, sit ? -0.5 : swing2, opts && opts.sleeve ? opts.sleeve : shirt);
      part('armR', 0.32, 1.40, 0, sit ? -0.5 : swing, opts && opts.sleeve ? opts.sleeve : shirt);

      // head (skin-tinted); hair is a separate tinted block drawn by the caller
      M4.fromT(A, 0, 1.50 + (sit ? -0.06 : 0), 0);
      M4.mul(B, root, A);
      r.draw(this.mesh.dyn, B, R.head, tint(skin));
      if (opts && opts.cap) r.draw(this.mesh.dyn, B, R.cap, tint(opts.cap));
      return root;
    }

    render(w, h) {
      const r = this.r, R = this.R, M = this._m, A = this._a, B = this._b, C = this._c;
      const p = this.player;
      const far = this.opts.viewDistance;
      M4.persp(this.proj, this.opts.fov * Math.PI / 180, w / h, 0.06, far);
      M4.view(this.viewM, this.eye[0], this.eye[1], this.eye[2], p.yaw, p.pitch);
      M4.mul(this.vp, this.proj, this.viewM);
      this.env.fogK = this.opts.fogK;
      r.frame(this.vp, this.eye, this.env, w, h);

      const I = this._ident || (this._ident = M4.create());

      /* --- static opaque: the whole restaurant, one call --- */
      r.mode(0); r.unlit(0);
      r.draw(this.mesh.opaque, I, null, null);

      /* --- dynamic opaque --- */
      const camx = this.eye[0], camz = this.eye[2];
      const cullSq = this.opts.npcCull * this.opts.npcCull;
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const fwdx = -sy, fwdz = -cy;

      const visible = (x, z, pad) => {
        const dx = x - camx, dz = z - camz;
        const d2 = dx * dx + dz * dz;
        if (d2 > cullSq) return false;
        if (d2 < 6) return true;
        const d = Math.sqrt(d2);
        return (dx / d) * fwdx + (dz / d) * fwdz > -0.35 - (pad || 0);
      };

      for (const c of this.customers) {
        if (!visible(c.x, c.z)) continue;
        const dx = c.x - camx, dz = c.z - camz;
        // beyond ~11 m the hair block and the carried tray are sub-pixel detail
        this.drawCharacter(c, dx * dx + dz * dz < 121);
      }

      if (this.inRoom) {
        const peers = g.Net.state.peers;
        for (const uid in peers) {
          const pe = peers[uid];
          if (!visible(pe.ix, pe.iz)) continue;
          this.drawHumanoid(pe.ix, pe.iy || 0, pe.iz, pe.iyaw, pe.anim || 0, 1,
            { shirt: 0x2f3a4a, skin: 0xe8b48f, hair: 0x2a1f18, pants: 0x22262d },
            { cap: 0xda291c, sleeve: 0x2f3a4a });
          if (pe.hold) {
            M4.fromT(A, pe.ix, (pe.iy || 0) + 1.05, pe.iz);
            M4.fromRY(B, pe.iyaw);
            M4.mul(C, A, B);
            M4.fromT(A, 0, 0, -0.35);
            M4.mul(M, C, A);
            r.draw(this.mesh.dyn, M, R.tray, null);
          }
        }
      }

      /* station contents */
      this.drawStations();

      /* view model — tray with what you are carrying */
      this.drawViewModel();

      /* --- decals (multiply) --- */
      r.mode(2); r.unlit(1);
      r.draw(this.mesh.decal, I, null, null);
      const blob = this._blobT || (this._blobT = new Float32Array([1, 1, 1, 1]));
      for (const c of this.customers) {
        if (!visible(c.x, c.z)) continue;
        M4.trs(M, c.x, 0.02, c.z, 0, 0.95, 1, 0.95);
        r.draw(this.mesh.dyn, M, R.blob, blob);
      }
      if (this.inRoom) {
        const peers = g.Net.state.peers;
        for (const uid in peers) {
          const pe = peers[uid];
          if (!visible(pe.ix, pe.iz)) continue;
          M4.trs(M, pe.ix, 0.02, pe.iz, 0, 1.0, 1, 1.0);
          r.draw(this.mesh.dyn, M, R.blob, blob);
        }
      }

      /* --- emissive (unlit opaque) --- */
      r.mode(0); r.unlit(1);
      r.draw(this.mesh.emis, I, null, null);

      /* --- alpha: glass, particles, progress bars --- */
      r.mode(1);
      r.unlit(0);
      r.cull(false);
      r.draw(this.mesh.glass, I, null, null);
      r.cull(true);

      r.unlit(1);
      this.drawBars();
      if (this.opts.particles) this.drawParticles();

      r.mode(0); r.unlit(0);
    }

    drawCharacter(c, detail) {
      const sit = c.state === 'eating';
      const root = this.drawHumanoid(c.x, 0, c.z, c.yaw, c.anim, c.scale,
        { shirt: c.shirt, skin: c.skin, hair: c.hair, pants: 0x36404f }, { sit });
      // hair block
      const A = this._a, B = this._b, C = this._c, M = this._m, r = this.r;
      if (!detail) return;
      M4.fromT(A, 0, 1.825 + (sit ? -0.38 : 0), 0);
      M4.mul(B, root, A);
      M4.fromS(A, 0.315, 0.075, 0.295);
      M4.mul(C, B, A);
      M4.fromT(A, 0, -0.5, 0); // cube range is built from y=0..1
      M4.mul(M, C, A);
      const t = this._tint3 || (this._tint3 = new Float32Array(4));
      t[0] = ((c.hair >> 16) & 255) / 255; t[1] = ((c.hair >> 8) & 255) / 255; t[2] = (c.hair & 255) / 255; t[3] = 1;
      r.draw(this.mesh.dyn, M, this.R.cube, t);

      // customers who got food carry a tray away
      if (c.state === 'toseat' || c.state === 'eating') {
        M4.fromT(A, 0, 1.05 + (sit ? -0.3 : 0), -0.34);
        M4.mul(M, root, A);
        r.draw(this.mesh.dyn, M, this.R.tray, null);
        M4.fromT(A, -0.1, 1.08 + (sit ? -0.3 : 0), -0.34);
        M4.mul(M, root, A);
        r.draw(this.mesh.dyn, M, this.R.fries, null);
        M4.fromT(A, 0.11, 1.08 + (sit ? -0.3 : 0), -0.34);
        M4.mul(M, root, A);
        r.draw(this.mesh.dyn, M, this.R.drink, null);
      }
    }

    drawStations() {
      const r = this.r, R = this.R, M = this._m, A = this._a, B = this._b;
      const tint = this._tintS || (this._tintS = new Float32Array(4));
      const setT = (hex, a) => {
        tint[0] = ((hex >> 16) & 255) / 255; tint[1] = ((hex >> 8) & 255) / 255;
        tint[2] = (hex & 255) / 255; tint[3] = a === undefined ? 1 : a;
        return tint;
      };

      for (const key in this.stations) {
        const st = this.stations[key];
        const offs = this.stationSlotOffsets[key];
        for (let i = 0; i < st.slots.length; i++) {
          const s = st.slots[i];
          const off = offs[i];
          const x = st.pos[0] + off[0], z = st.pos[1] + off[1];
          if (key === 'fryer') {
            const lowered = s && s.t < s.cook;
            M4.trs(M, x, st.y + (lowered ? -0.04 : 0.16), z, 0, 1, 1, 1);
            r.draw(this.mesh.dyn, M, R.basket, setT(0xffffff));
            if (s) {
              M4.trs(M, x, st.y + (lowered ? 0.0 : 0.20), z, 0, 1, 1, 1);
              const done = clamp(s.t / s.cook, 0, 1);
              const col = s.burnt ? 0x4a3a24
                : ((Math.round(lerp(232, 217, done)) << 16) | (Math.round(lerp(226, 176, done)) << 8) | Math.round(lerp(180, 90, done)));
              r.draw(this.mesh.dyn, M, R.fryload, setT(col, 1));
            }
            continue;
          }
          if (!s) continue;
          if (key === 'grill') {
            const prog = clamp(s.t / s.cook, 0, 1);
            const cr = Math.round(lerp(196, 91, prog)), cg = Math.round(lerp(104, 56, prog)), cb = Math.round(lerp(95, 33, prog));
            const hex = s.burnt ? 0x23180f : ((cr << 16) | (cg << 8) | cb);
            M4.trs(M, x, st.y, z, 0, 1, 1, 1);
            r.draw(this.mesh.dyn, M, R.patty, setT(hex));
            if (s.item === 'bigmac') {
              M4.trs(M, x, st.y + 0.028, z, 0, 0.95, 1, 0.95);
              r.draw(this.mesh.dyn, M, R.patty, setT(hex));
            }
          } else if (key === 'drinks') {
            M4.trs(M, x, st.y, z, 0, 1, 1, 1);
            r.draw(this.mesh.dyn, M, R.drink, setT(0xffffff));
          } else if (key === 'icecream') {
            M4.trs(M, x, st.y, z, 0, 1, 1, 1);
            r.draw(this.mesh.dyn, M, R.flurry, setT(0xffffff));
          }
        }
      }
    }

    drawBars() {
      const r = this.r, R = this.R, M = this._m, A = this._a, B = this._b, C = this._c;
      const p = this.player;
      const t = this._tintB || (this._tintB = new Float32Array(4));
      const bar = (x, y, z, prog, colHex, width) => {
        const w = width || 0.5;
        // background
        M4.fromT(A, x, y, z); M4.fromRY(B, p.yaw); M4.mul(C, A, B);
        M4.fromS(A, w, 0.085, 1); M4.mul(M, C, A);
        t[0] = 0.06; t[1] = 0.07; t[2] = 0.09; t[3] = 0.75;
        r.draw(this.mesh.dyn, M, R.quad, t);
        // fill
        M4.fromT(A, x, y, z); M4.fromRY(B, p.yaw); M4.mul(C, A, B);
        M4.fromT(A, -w * (1 - prog) / 2, 0, 0.004); M4.mul(B, C, A);
        M4.fromS(A, w * prog * 0.94, 0.055, 1); M4.mul(M, B, A);
        t[0] = ((colHex >> 16) & 255) / 255; t[1] = ((colHex >> 8) & 255) / 255; t[2] = (colHex & 255) / 255; t[3] = 0.95;
        r.draw(this.mesh.dyn, M, R.quad, t);
      };

      for (const key in this.stations) {
        const st = this.stations[key];
        const offs = this.stationSlotOffsets[key];
        for (let i = 0; i < st.slots.length; i++) {
          const s = st.slots[i];
          if (!s) continue;
          const x = st.pos[0] + offs[i][0], z = st.pos[1] + offs[i][1];
          const dx = x - this.eye[0], dz = z - this.eye[2];
          if (dx * dx + dz * dz > 90) continue;
          const prog = clamp(s.t / s.cook, 0, 1);
          const over = s.t > s.cook ? clamp((s.t - s.cook) / (s.burn - s.cook), 0, 1) : 0;
          const col = s.burnt ? 0x8a2b2b : (prog < 1 ? 0xffc72c : (over > 0.6 ? 0xe8622c : 0x5fd07a));
          bar(x, st.y + 0.45, z, s.burnt ? 1 : (prog < 1 ? prog : 1 - over), col, 0.44);
        }
      }
      // patience above waiting customers
      for (const c of this.customers) {
        if (c.state !== 'ordering' && c.state !== 'waiting') continue;
        const frac = clamp(c.patience / (c.patienceMax || 1), 0, 1);
        const dx = c.x - this.eye[0], dz = c.z - this.eye[2];
        if (dx * dx + dz * dz > 160) continue;
        const col = frac > 0.5 ? 0x5fd07a : frac > 0.22 ? 0xffc72c : 0xe8443c;
        bar(c.x, 2.12 * c.scale, c.z, frac, col, 0.46);
      }
    }

    drawParticles() {
      const r = this.r, M = this._m, A = this._a, B = this._b, C = this._c;
      const p = this.player;
      const t = this._tintP || (this._tintP = new Float32Array(4));
      for (const q of this.particles) {
        const f = q.t / q.life;
        const s = q.size * (1 + f * 1.9);
        M4.fromT(A, q.x, q.y, q.z);
        M4.fromRY(B, p.yaw); M4.mul(C, A, B);
        M4.fromRX(A, p.pitch); M4.mul(B, C, A);
        M4.fromS(A, s, s, s); M4.mul(M, B, A);
        const a = Math.sin(Math.min(1, f * 3.2) * Math.PI * 0.5) * (1 - f) * (q.dark ? 0.75 : 0.55);
        if (q.dark) { t[0] = 0.22; t[1] = 0.20; t[2] = 0.19; }
        else { t[0] = 0.97; t[1] = 0.97; t[2] = 0.99; }
        t[3] = a;
        r.draw(this.mesh.dyn, M, this.R.puff, t);
      }
    }

    drawViewModel() {
      if (!this.hands.length) return;
      const r = this.r, R = this.R, M = this._m, A = this._a, B = this._b, C = this._c;
      const p = this.player;
      const bobx = Math.sin(p.bob) * 0.012 * clamp(p.speed, 0, 3);
      const boby = Math.abs(Math.cos(p.bob)) * 0.014 * clamp(p.speed, 0, 3);

      // camera world matrix
      M4.fromT(A, this.eye[0], this.eye[1], this.eye[2]);
      M4.fromRY(B, p.yaw); M4.mul(C, A, B);
      M4.fromRX(A, p.pitch); M4.mul(B, C, A);
      const cam = this._camW || (this._camW = M4.create());
      cam.set(B);

      M4.fromT(A, 0.17 + bobx, -0.42 + boby, -0.60);
      M4.mul(C, cam, A);
      M4.fromRX(A, -0.12); M4.mul(B, C, A);
      const tray = this._trayM || (this._trayM = M4.create());
      tray.set(B);
      r.draw(this.mesh.dyn, tray, R.tray, null);

      const spots = [[-0.13, 0.06], [0.13, 0.06], [-0.13, -0.07], [0.13, -0.07]];
      this.hands.forEach((h, i) => {
        const sp = spots[i % 4];
        M4.fromT(A, sp[0], 0.024, sp[1]);
        M4.mul(C, tray, A);
        const t = this._tintV || (this._tintV = new Float32Array(4));
        if (h.burnt) { t[0] = 0.33; t[1] = 0.27; t[2] = 0.22; t[3] = 1; }
        else { t[0] = 1; t[1] = 1; t[2] = 1; t[3] = 1; }
        r.draw(this.mesh.dyn, C, R[MODEL_OF[h.item]], t);
      });
    }

    /* Project a world point to normalised screen coords for DOM overlays. */
    project(x, y, z, out) {
      const m = this.vp;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0.01) return false;
      out[0] = (cx / cw * 0.5 + 0.5);
      out[1] = (1 - (cy / cw * 0.5 + 0.5));
      return out[0] > -0.2 && out[0] < 1.2 && out[1] > -0.2 && out[1] < 1.2;
    }

    score() {
      return Math.round(this.stats.revenue + this.stats.served * 6 + this.stats.level * 25);
    }
  }

  g.Game = Game;
  g.GameData = { ITEMS, ITEM_KEYS, xpForLevel, SFX };
})(window);
