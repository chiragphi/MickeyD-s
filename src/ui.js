/* All DOM: HUD, menus, settings, multiplayer panels, leaderboard.
   HUD text is only rewritten when a value actually changes — no per-frame
   layout thrash, which matters a lot more on a Chromebook than it looks. */
(function (g) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const PRESETS = {
    potato: { scale: 0.55, maxCustomers: 6,  particles: false, viewDistance: 45,  npcCull: 20, fogK: 0.00075 },
    low:    { scale: 0.70, maxCustomers: 9,  particles: false, viewDistance: 62,  npcCull: 26, fogK: 0.00045 },
    medium: { scale: 0.85, maxCustomers: 14, particles: true,  viewDistance: 88,  npcCull: 33, fogK: 0.00026 },
    high:   { scale: 1.00, maxCustomers: 20, particles: true,  viewDistance: 130, npcCull: 46, fogK: 0.00016 },
  };
  const QKEYS = ['potato', 'low', 'medium', 'high'];
  const QLABEL = { potato: 'Potato', low: 'Low', medium: 'Medium', high: 'High' };
  const SET_KEY = 'mcd.settings';

  function detectPreset(gpu) {
    const s = (gpu || '').toLowerCase();
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if (/swiftshader|llvmpipe|software/.test(s)) return 'potato';
    if (/mali|adreno|powervr|intel.*(hd|uhd) graphics (4|5|6)/.test(s)) return 'low';
    if (cores <= 2 || mem <= 2) return 'low';
    if (/intel/.test(s) && mem <= 4) return 'low';
    if (cores >= 8 && mem >= 8 && /nvidia|radeon|apple|arc/.test(s)) return 'high';
    return 'medium';
  }

  const UI = {
    opts: null, game: null, main: null,
    _last: {}, _toasts: [], _popEls: [], _tagEls: [],
    chatOpen: false,

    /* -------------------- settings -------------------- */
    loadOpts(gpu) {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(SET_KEY) || '{}'); } catch (e) {}
      const quality = saved.quality || detectPreset(gpu);
      const o = Object.assign({
        quality, fov: 75, sens: 1, sound: true, adaptive: true, perf: false,
      }, PRESETS[quality] || PRESETS.medium, saved);
      o.quality = quality;
      this.opts = o;
      return o;
    },

    saveOpts() {
      try { localStorage.setItem(SET_KEY, JSON.stringify(this.opts)); } catch (e) {}
    },

    applyPreset(q) {
      Object.assign(this.opts, PRESETS[q], { quality: q });
      this.saveOpts();
      this.syncSettings();
      if (this.main) this.main.resize(true);
    },

    seg(container, values, current, onPick, label) {
      container.innerHTML = '';
      values.forEach(v => {
        const b = el('button', current === v.k ? 'on' : '', v.n);
        b.onclick = () => { onPick(v.k); };
        container.appendChild(b);
      });
    },

    syncSettings() {
      const o = this.opts;
      this.seg($('segQuality'), QKEYS.map(k => ({ k, n: QLABEL[k] })), o.quality, (k) => this.applyPreset(k));
      this.seg($('segAdaptive'), [{ k: true, n: 'On' }, { k: false, n: 'Off' }], o.adaptive,
        (k) => { o.adaptive = k; this.saveOpts(); this.syncSettings(); });
      this.seg($('segParticles'), [{ k: true, n: 'On' }, { k: false, n: 'Off' }], o.particles,
        (k) => { o.particles = k; this.saveOpts(); this.syncSettings(); });
      this.seg($('segSound'), [{ k: true, n: 'On' }, { k: false, n: 'Off' }], o.sound,
        (k) => { o.sound = k; g.GameData.SFX.enabled = k; this.saveOpts(); this.syncSettings(); });
      $('rngScale').value = Math.round(o.scale * 100); $('scaleVal').textContent = Math.round(o.scale * 100) + '%';
      $('rngFov').value = o.fov; $('fovVal').textContent = o.fov + '°';
      $('rngCrowd').value = o.maxCustomers; $('crowdVal').textContent = o.maxCustomers;
      $('rngSens').value = Math.round(o.sens * 100); $('sensVal').textContent = o.sens.toFixed(2);
    },

    /* -------------------- screens -------------------- */
    show(id) {
      ['start', 'pause', 'settings', 'multi', 'board', 'over'].forEach(s => $(s).classList.toggle('on', s === id));
      this.current = id || null;
      document.body.classList.toggle('hud-hide', !!id);
      if (id) this.closeChat();
    },

    hideAll() { this.show(null); },

    /* -------------------- toasts -------------------- */
    toast(msg, kind) {
      const t = el('div', 'toast ' + (kind || 'info'), msg);
      $('toasts').appendChild(t);
      this._toasts.push(t);
      while (this._toasts.length > 4) { const old = this._toasts.shift(); old.classList.add('out'); setTimeout(() => old.remove(), 320); }
      setTimeout(() => {
        const i = this._toasts.indexOf(t);
        if (i >= 0) { this._toasts.splice(i, 1); t.classList.add('out'); setTimeout(() => t.remove(), 320); }
      }, 3400);
    },

    /* -------------------- HUD -------------------- */
    initHud() {
      const h = $('hands');
      h.innerHTML = '';
      for (let i = 0; i < 4; i++) h.appendChild(el('div', 'slot empty'));
    },

    hud(gm, fps) {
      const s = gm.stats, L = this._last;
      const money = '$' + s.money.toFixed(2);
      if (money !== L.money) { $('money').textContent = money; L.money = money; }

      const need = g.GameData.xpForLevel(s.level);
      const lv = 'Level ' + s.level;
      if (lv !== L.lv) { $('lvl').innerHTML = 'Level <b>' + s.level + '</b>'; L.lv = lv; }
      const xt = Math.floor(s.xp) + ' / ' + need + ' XP';
      if (xt !== L.xt) { $('xptxt').textContent = xt; $('xpbar').style.width = clamp(s.xp / need * 100, 0, 100) + '%'; L.xt = xt; }

      const stars = Math.round(s.rep / 20 * 2) / 2;
      const rs = '★★★★★'.slice(0, Math.max(1, Math.round(stars))) + '☆☆☆☆☆'.slice(0, 5 - Math.max(1, Math.round(stars)));
      if (rs !== L.rs) { $('repstars').textContent = rs; $('repnum').textContent = (s.rep / 20).toFixed(1); L.rs = rs; }

      const mm = Math.floor(s.shift / 60), ss = Math.floor(s.shift % 60);
      const clock = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
      if (clock !== L.clock) { $('clock').textContent = clock; L.clock = clock; }

      if (s.combo !== L.combo) {
        $('combopill').style.display = s.combo > 1 ? 'flex' : 'none';
        $('combo').textContent = '×' + s.combo;
        L.combo = s.combo;
      }

      // hands
      const hsig = gm.hands.map(h => h.item + (h.burnt ? '!' : '')).join(',');
      if (hsig !== L.hsig) {
        const slots = $('hands').children;
        for (let i = 0; i < 4; i++) {
          const it = gm.hands[i];
          const sl = slots[i];
          sl.className = 'slot ' + (it ? (it.burnt ? 'filled burnt' : 'filled') : 'empty');
          sl.textContent = it ? g.GameData.ITEMS[it.item].icon : '';
          if (it && (!L.hsig || i >= (L.hsig ? L.hsig.split(',').filter(Boolean).length : 0))) {
            sl.classList.add('pop'); setTimeout(() => sl.classList.remove('pop'), 180);
          }
        }
        L.hsig = hsig;
      }

      // tickets
      const tsig = gm.orders.map(o => o.id + o.made.map(m => m ? 1 : 0).join('')).join('|');
      const box = $('tickets');
      if (tsig !== L.tsig) {
        box.innerHTML = '';
        gm.orders.forEach(o => {
          const t = el('div', 'ticket');
          t.style.setProperty('--c', '#' + (o.color || 0xcccccc).toString(16).padStart(6, '0'));
          const th = el('div', 'th');
          th.appendChild(el('div', 'nm', o.name));
          th.appendChild(el('div', 'no', '#' + o.id));
          t.appendChild(th);
          const items = el('div', 'items');
          o.items.forEach((k, i) => {
            const c = el('div', 'chip' + (o.made[i] ? ' made' : ''), g.GameData.ITEMS[k].icon);
            items.appendChild(c);
          });
          t.appendChild(items);
          const bar = el('div', 'bar'); const fill = el('i'); bar.appendChild(fill); t.appendChild(bar);
          t._fill = fill; t._o = o;
          box.appendChild(t);
        });
        L.tsig = tsig;
      }
      for (const t of box.children) {
        const o = t._o; if (!o) continue;
        const cust = gm.customers.find(c => c.id === o.cid);
        const frac = cust ? clamp(cust.patience / (cust.patienceMax || 1), 0, 1) : 1;
        t._fill.style.width = (frac * 100) + '%';
        t.classList.toggle('warn', frac <= 0.5 && frac > 0.22);
        t.classList.toggle('crit', frac <= 0.22);
      }

      // prompt + crosshair
      const pr = gm.prompt();
      const cross = $('cross'), prompt = $('prompt');
      if (pr) {
        const key = pr.key ? 1 : 0;
        if (L.prtxt !== pr.text || L.prkey !== key) {
          $('prompttxt').textContent = pr.text;
          $('promptkey').style.display = pr.key ? '' : 'none';
          L.prtxt = pr.text; L.prkey = key;
        }
        prompt.classList.add('on');
        prompt.classList.toggle('dead', !pr.key);
        cross.className = pr.key ? 'hot' : 'dead';
      } else {
        prompt.classList.remove('on');
        cross.className = '';
        L.prtxt = null;
      }

      // perf
      if (this.opts.perf) {
        $('perf').classList.add('on');
        const r = gm.r;
        $('perf').textContent = `${fps | 0} fps · ${r.drawCalls} draws · ${(r.tris / 1000).toFixed(1)}k tris · ${(this.main.renderScale * 100) | 0}%`;
      } else $('perf').classList.remove('on');

      // room pill
      const room = g.Net && g.Net.state.room;
      if (room !== L.room) {
        $('roompill').style.display = room ? 'flex' : 'none';
        $('roomcode').textContent = room || '—';
        L.room = room;
      }
      if (room) {
        const n = Object.keys(g.Net.state.peers).length;
        if (n !== L.peers) {
          const p = $('peers'); p.innerHTML = '';
          for (let i = 0; i <= n; i++) p.appendChild(el('div', 'peerdot'));
          L.peers = n;
        }
      }
    },

    /* world-space overlays: money popups and co-op name tags */
    overlays(gm) {
      const out = [0, 0];
      const W = window.innerWidth, H = window.innerHeight;
      const layer = $('popups');
      while (this._popEls.length < gm.popups.length) {
        const d = el('div', 'pop'); layer.appendChild(d); this._popEls.push(d);
      }
      this._popEls.forEach((d, i) => {
        const p = gm.popups[i];
        if (!p) { d.style.display = 'none'; return; }
        const rise = p.t * 0.75;
        if (!gm.project(p.x, p.y + rise, p.z, out)) { d.style.display = 'none'; return; }
        d.style.display = '';
        d.className = 'pop ' + p.kind;
        if (d.textContent !== p.text) d.textContent = p.text;
        d.style.left = (out[0] * W) + 'px';
        d.style.top = (out[1] * H) + 'px';
        d.style.opacity = clamp(1 - p.t / p.life, 0, 1);
      });

      const peers = g.Net && g.Net.state.room ? Object.keys(g.Net.state.peers) : [];
      const tags = $('nametags');
      while (this._tagEls.length < peers.length) { const d = el('div', 'tag'); tags.appendChild(d); this._tagEls.push(d); }
      this._tagEls.forEach((d, i) => {
        const uid = peers[i];
        if (!uid) { d.style.display = 'none'; return; }
        const p = g.Net.state.peers[uid];
        if (!gm.project(p.ix, (p.iy || 0) + 2.15, p.iz, out)) { d.style.display = 'none'; return; }
        d.style.display = '';
        if (d.textContent !== p.name) d.textContent = p.name || 'Crew';
        d.style.left = (out[0] * W) + 'px';
        d.style.top = (out[1] * H) + 'px';
      });
    },

    /* -------------------- chat -------------------- */
    openChat() {
      if (!g.Net || !g.Net.state.room) return;
      this.chatOpen = true;
      $('chat').classList.add('on');
      $('chatinput').focus();
      if (this.main) this.main.releasePointer();
    },
    closeChat() {
      this.chatOpen = false;
      $('chat').classList.remove('on');
      $('chatinput').blur();
    },
    chatLine(v) {
      const log = $('chatlog');
      const d = el('div', 'cm' + (v.sys ? ' sys' : ''));
      if (v.sys) d.textContent = v.m;
      else { const b = el('b', '', (v.n || 'Crew') + ': '); d.appendChild(b); d.appendChild(document.createTextNode(v.m)); }
      log.appendChild(d);
      while (log.children.length > 5) log.firstChild.remove();
      $('chat').classList.add('on');
      clearTimeout(this._chatT);
      this._chatT = setTimeout(() => { if (!this.chatOpen) $('chat').classList.remove('on'); }, 6000);
    },

    /* -------------------- multiplayer panels -------------------- */
    /* The project config is resolved asynchronously from /api/config, so there is
       nothing to gate on synchronously — asking Net.configured before it has been
       fetched always says no, which is what made a perfectly healthy project look
       like it was never set up. Always attempt the connection and let it report. */
    async connect(silent) {
      const badge = $('netBadge');
      if (this._connecting) return this._connecting;
      badge.textContent = 'Connecting…'; badge.className = 'badge';
      this._checked = false;
      this.renderNet();

      this._connecting = (async () => {
        const ok = await g.Net.connect();
        this._checked = true;
        this._connecting = null;
        badge.textContent = ok ? 'Online' : (g.Net.state.error === 'no-config' ? 'Not set up' : 'Offline');
        badge.className = 'badge' + (ok ? ' live' : '');
        if (!ok && !silent && g.Net.state.error && g.Net.state.error !== 'no-config') {
          $('cfgErr').className = 'err';
          $('cfgErr').textContent = g.Net.state.error;
        }
        this.renderNet();
        return ok;
      })();
      return this._connecting;
    },

    renderNet() {
      const st = g.Net.state;
      const on = st.ready;
      const checking = !!this._connecting || (!on && !this._checked);
      $('kitchenOffline').style.display = on ? 'none' : '';
      $('kitchenOnline').style.display = on ? '' : 'none';
      $('friendsOffline').style.display = on ? 'none' : '';
      $('friendsOnline').style.display = on ? '' : 'none';
      $('netBadge').textContent = on ? 'Online' : checking ? 'Connecting…'
        : (st.error === 'no-config' ? 'Not set up' : 'Offline');
      $('netBadge').className = 'badge' + (on ? ' live' : '');
      [['kitchenOffline'], ['friendsOffline']].forEach(([id]) => {
        const box = $(id);
        const msg = box.querySelector('.msg');
        if (msg) {
          msg.textContent = checking ? 'Checking for a multiplayer server…'
            : st.error === 'no-config'
              ? 'No multiplayer server is configured for this site. You can point the game at your own Firebase project instead.'
              : st.error
                ? 'Could not reach the multiplayer server: ' + st.error
                : 'Not connected.';
        }
      });
      if (!on) return;

      $('myCode').textContent = st.code || '——————';
      if (document.activeElement !== $('inName')) $('inName').value = st.name || '';

      // friends
      const fl = $('friendList'); fl.innerHTML = '';
      if (!st.friends.length) fl.appendChild(el('div', 'empty', 'No friends yet. Share your code above, or add theirs.'));
      st.friends.forEach(f => {
        const hosting = st.friendRooms[f.uid];
        const it = el('div', 'item');
        const d = el('div', 'dot' + (st.online[f.uid] ? ' on' : ''));
        const g1 = el('div', 'grow');
        g1.appendChild(el('div', 'nm', f.name));
        g1.appendChild(el('div', 'meta', hosting ? 'In a kitchen · ' + hosting
          : st.online[f.uid] ? 'Online' : 'Offline'));
        it.append(d, g1);
        if (hosting && !st.room) {
          const join = el('button', 'btn sm primary', 'Join');
          join.onclick = async () => {
            join.disabled = true; join.textContent = 'Joining…';
            try {
              await g.Net.joinRoom(hosting);
              this.toast('Joined ' + f.name + "'s kitchen", 'good');
              this.main.onJoinedRoom();
            } catch (e) {
              join.disabled = false; join.textContent = 'Join';
              $('friendErr').className = 'err';
              $('friendErr').textContent = e.message || String(e);
            }
          };
          it.appendChild(join);
        }
        const rm = el('button', 'btn sm ghost', 'Remove');
        rm.onclick = async () => { await g.Net.removeFriend(f.uid); g.Net.refreshAllow(); };
        it.appendChild(rm);
        fl.appendChild(it);
      });

      // invites
      const il = $('inviteList'); il.innerHTML = '';
      $('invCount').style.display = st.invites.length ? '' : 'none';
      $('invCount').textContent = st.invites.length;
      if (!st.invites.length) il.appendChild(el('div', 'empty', 'No pending requests.'));
      st.invites.forEach(iv => {
        const it = el('div', 'item');
        const g1 = el('div', 'grow');
        g1.appendChild(el('div', 'nm', iv.name));
        g1.appendChild(el('div', 'meta', 'wants to be crew'));
        const ac = el('button', 'btn sm primary', 'Accept');
        ac.onclick = async () => { await g.Net.acceptInvite(iv.uid, iv.name); g.Net.refreshAllow(); };
        const dc = el('button', 'btn sm ghost', 'Decline');
        dc.onclick = () => g.Net.declineInvite(iv.uid);
        it.append(g1, ac, dc);
        il.appendChild(it);
      });

      // room
      $('roomBox').style.display = st.room ? '' : 'none';
      $('curRoom').textContent = st.room || '——————';
      const ml = $('roomMembers'); ml.innerHTML = '';
      Object.keys(st.members || {}).forEach(uid => {
        const m = st.members[uid];
        const it = el('div', 'item' + (uid === st.uid ? ' me' : ''));
        it.appendChild(el('div', 'dot on'));
        const g1 = el('div', 'grow');
        g1.appendChild(el('div', 'nm', m.name + (uid === st.uid ? ' (you)' : '')));
        g1.appendChild(el('div', 'meta', m.host ? 'Host — runs the customer sim' : 'Crew'));
        it.appendChild(g1);
        ml.appendChild(it);
      });
      $('btnHost').disabled = !!st.room;
      $('btnJoin').disabled = !!st.room;
      const hostingFriends = st.friends.filter(f => st.friendRooms[f.uid]);
      const hint = $('friendHosting');
      if (hint) {
        hint.style.display = (!st.room && hostingFriends.length) ? '' : 'none';
        hint.textContent = hostingFriends.length
          ? hostingFriends.map(f => f.name).join(', ') + (hostingFriends.length > 1 ? ' have' : ' has')
            + ' a kitchen open — join from the Friends tab'
          : '';
      }
    },

    async renderBoard(scope) {
      const list = $('boardList');
      list.innerHTML = '';
      if (!g.Net.state.ready) {
        list.appendChild(el('div', 'empty', 'Connect a Firebase project in Multiplayer → Connection to use the leaderboard.'));
        return;
      }
      list.appendChild(el('div', 'empty', 'Loading…'));
      try {
        const rows = await g.Net.leaderboard(scope);
        list.innerHTML = '';
        if (!rows.length) {
          list.appendChild(el('div', 'empty', scope === 'friends'
            ? 'No friend scores yet. Finish a shift to post yours.'
            : 'No scores posted yet — be the first.'));
          return;
        }
        rows.forEach((r, i) => {
          const it = el('div', 'item' + (r.uid === g.Net.state.uid ? ' me' : ''));
          it.appendChild(el('div', 'rank' + (i < 3 ? ' g' + (i + 1) : ''), '#' + (i + 1)));
          const g1 = el('div', 'grow');
          g1.appendChild(el('div', 'nm', r.name || 'Crew'));
          g1.appendChild(el('div', 'meta', `Level ${r.level || 1} · ${r.served || 0} served`));
          it.appendChild(g1);
          const sc = el('div', '', String(r.score));
          sc.style.cssText = 'font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums';
          it.appendChild(sc);
          list.appendChild(it);
        });
      } catch (e) {
        list.innerHTML = '';
        list.appendChild(el('div', 'empty', 'Could not load the leaderboard: ' + (e.message || e)));
      }
    },

    statCards(target, gm) {
      const s = gm.stats;
      const rows = [
        ['$' + s.revenue.toFixed(2), 'Revenue'],
        [s.served, 'Served'],
        [s.level, 'Level'],
        [(s.rep / 20).toFixed(1) + '★', 'Rating'],
        [s.best, 'Best streak'],
        [gm.score(), 'Score'],
      ];
      target.innerHTML = '';
      rows.forEach(([v, k]) => {
        const d = el('div', 'stat');
        d.appendChild(el('div', 'v', String(v)));
        d.appendChild(el('div', 'k', k));
        target.appendChild(d);
      });
    },

    /* -------------------- wiring -------------------- */
    bind(main) {
      this.main = main;
      const opts = this.opts;

      $('btnSolo').onclick = () => main.start();
      $('btnMulti').onclick = () => { this.show('multi'); this.connect(true); };
      $('btnMulti1').onclick = () => { this.show('multi'); this.connect(true); };
      $('btnSettings0').onclick = () => { this.back = 'start'; this.show('settings'); };
      $('btnSettings1').onclick = () => { this.back = 'pause'; this.show('settings'); };
      $('btnCloseSettings').onclick = () => this.show(this.back || 'start');
      $('btnBoard0').onclick = () => { this.back = 'start'; this.show('board'); this.connect(true).then(() => this.renderBoard(this.boardScope || 'friends')); };
      $('btnBoard1').onclick = () => { this.back = 'pause'; this.show('board'); this.renderBoard(this.boardScope || 'friends'); };
      $('btnBoard2').onclick = () => { this.back = 'over'; this.show('board'); this.renderBoard(this.boardScope || 'friends'); };
      $('btnCloseBoard').onclick = () => this.show(this.back || 'start');
      $('btnRefreshBoard').onclick = () => this.renderBoard(this.boardScope || 'friends');
      $('btnCloseMulti').onclick = () => this.show(main.started ? 'pause' : 'start');
      $('btnResume').onclick = () => main.resume();
      $('btnQuit').onclick = () => main.endShift();
      $('btnAgain').onclick = () => main.restart();

      $('boardTabs').onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        [...$('boardTabs').children].forEach(c => c.classList.toggle('on', c === b));
        this.boardScope = b.dataset.scope;
        this.renderBoard(this.boardScope);
      };
      document.querySelector('#multi .tabs').onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        [...b.parentNode.children].forEach(c => c.classList.toggle('on', c === b));
        ['paneKitchen', 'paneFriends', 'paneSetup'].forEach(p => $(p).classList.toggle('on', p === b.dataset.pane));
      };

      const rng = (id, fn) => { const e = $(id); e.oninput = () => { fn(+e.value); this.saveOpts(); this.syncSettings(); }; };
      rng('rngScale', v => { opts.scale = v / 100; main.resize(true); });
      rng('rngFov', v => { opts.fov = v; });
      rng('rngCrowd', v => { opts.maxCustomers = v; });
      rng('rngSens', v => { opts.sens = v / 100; });

      /* ---- multiplayer ---- */
      $('inCfg').value = (() => { const c = g.Net.getConfig(); return c ? JSON.stringify(c, null, 2) : ''; })();
      $('btnSaveCfg').onclick = async () => {
        $('cfgErr').textContent = '';
        try {
          const cfg = g.Net.parseConfig($('inCfg').value);
          if (!cfg.apiKey || !cfg.databaseURL) throw new Error('Config needs at least apiKey and databaseURL.');
          g.Net.setConfig(cfg);
          $('cfgErr').textContent = 'Saved. Connecting…';
          $('cfgErr').className = 'err ok';
          const ok = await this.connect();
          $('cfgErr').className = 'err' + (ok ? ' ok' : '');
          $('cfgErr').textContent = ok ? 'Connected.' : (g.Net.state.error || 'Could not connect.');
        } catch (e) {
          $('cfgErr').className = 'err';
          $('cfgErr').textContent = e.message || String(e);
        }
      };
      $('btnClearCfg').onclick = () => {
        g.Net.clearConfig(); $('inCfg').value = '';
        $('cfgErr').className = 'err ok';
        $('cfgErr').textContent = 'Cleared — the site\'s own project will be used again. Reload to apply.';
      };
      ['btnRetryNet', 'btnRetryNet2'].forEach(id => {
        const b = $(id);
        if (b) b.onclick = () => this.connect(false);
      });
      $('btnName').onclick = () => g.Net.setName($('inName').value);
      $('inName').onkeydown = (e) => { if (e.key === 'Enter') g.Net.setName($('inName').value); };
      $('btnCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(g.Net.state.code || ''); $('btnCopy').textContent = 'Copied'; setTimeout(() => $('btnCopy').textContent = 'Copy', 1200); };
      $('btnCopyRoom').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(g.Net.state.room || ''); $('btnCopyRoom').textContent = 'Copied'; setTimeout(() => $('btnCopyRoom').textContent = 'Copy', 1200); };
      $('btnAddFriend').onclick = async () => {
        $('friendErr').className = 'err'; $('friendErr').textContent = '';
        try {
          await g.Net.requestFriend($('inFriend').value);
          $('friendErr').className = 'err ok';
          $('friendErr').textContent = 'Request sent — they need to accept it.';
          $('inFriend').value = '';
        } catch (e) { $('friendErr').textContent = e.message || String(e); }
      };
      $('btnHost').onclick = async () => {
        $('roomErr').textContent = '';
        $('btnHost').disabled = true;
        try {
          const code = await g.Net.createRoom();
          this.toast('Kitchen ' + code + ' is open — friends can join from their Friends tab', 'good');
          this.renderNet();
        } catch (e) { $('roomErr').textContent = e.message || String(e); }
        $('btnHost').disabled = !!g.Net.state.room;
      };
      // opening a kitchen, or joining one, should drop you straight into the shift
      $('btnPlayRoom').onclick = () => this.main.onJoinedRoom();
      $('btnJoin').onclick = async () => {
        $('roomErr').textContent = '';
        try {
          const code = await g.Net.joinRoom($('inRoom').value);
          this.toast('Joined kitchen ' + code, 'good');
          main.onJoinedRoom();
        } catch (e) { $('roomErr').textContent = e.message || String(e); }
      };
      $('btnLeave').onclick = () => g.Net.leaveRoom();

      $('chatinput').onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const v = $('chatinput').value.trim();
          if (v) g.Net.sendChat(v);
          $('chatinput').value = '';
          this.closeChat();
        } else if (e.key === 'Escape') { $('chatinput').value = ''; this.closeChat(); }
      };

      document.querySelectorAll('[data-goto]').forEach(b => {
        b.onclick = () => {
          const pane = b.dataset.goto;
          [...document.querySelectorAll('#multi .tabs button')].forEach(t => t.classList.toggle('on', t.dataset.pane === pane));
          ['paneKitchen', 'paneFriends', 'paneSetup'].forEach(pn => $(pn).classList.toggle('on', pn === pane));
        };
      });

      g.Net.on('change', () => { if (this.current === 'multi') this.renderNet(); });
      g.Net.on('chat', (v) => this.chatLine(v));

      this.syncSettings();
      this.initHud();
      this.connect(true);
    },
  };

  g.UI = UI;
  g.UI.PRESETS = PRESETS;
})(window);
