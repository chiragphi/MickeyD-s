/* Firebase layer: anonymous auth, friend codes, friends-only co-op rooms,
   realtime player sync and the leaderboard.

   The SDK is loaded lazily via dynamic import the first time multiplayer is
   switched on, so a solo player never pays for it — no network, no parse cost.
   Everything degrades to fully-playable offline solo if Firebase is absent. */
(function (g) {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const CFG_KEY = 'mcd.firebase.cfg';
  const NAME_KEY = 'mcd.name';

  const state = {
    ready: false, loading: false, error: null,
    uid: null, name: null, code: null,
    friends: [], invites: [], online: {},
    room: null, isHost: true, hostUid: null,
    friendRooms: {},        // friendUid -> room code they are hosting, if any
    peers: {},          // uid -> {name, x, y, z, yaw, anim, hold, t, ix, iz, iyaw}
    members: {},
    lastError: null,
  };

  const cbs = { sim: null, event: null, change: null, chat: null };
  let fb = null;        // { app, auth, db, fns... }
  let refs = {};        // live listener detach functions
  let sendTimer = 0;

  const notify = () => { if (cbs.change) cbs.change(state); };

  /* ---------- config ----------
     Resolution order: a project the player pasted in (their browser only), then
     window.FIREBASE_CONFIG for self-hosting, then /api/config which reads the
     deployment's environment variables. Nothing is hardcoded in the source. */
  let remoteCfg;          // undefined = not fetched, null = none available

  function localConfig() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    if (g.FIREBASE_CONFIG && g.FIREBASE_CONFIG.apiKey) return g.FIREBASE_CONFIG;
    return null;
  }

  async function fetchRemoteConfig() {
    if (remoteCfg !== undefined) return remoteCfg;
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      remoteCfg = j && j.configured && j.config && j.config.apiKey ? j.config : null;
    } catch (e) {
      remoteCfg = null;
    }
    return remoteCfg;
  }

  async function resolveConfig() {
    return localConfig() || await fetchRemoteConfig();
  }

  /* Synchronous view, for UI that only needs to know whether anything is known yet. */
  function getConfig() { return localConfig() || remoteCfg || null; }

  function setConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  /* true once we know a project is reachable; the UI awaits ready() before
     deciding whether to show the setup panel. */
  async function ready() { return !!(await resolveConfig()); }

  function clearConfig() { localStorage.removeItem(CFG_KEY); }

  function parseConfig(text) {
    const t = String(text).trim();
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
    // Accept a pasted `const firebaseConfig = { ... };` snippet.
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not find a config object in that text.');
    const body = m[0]
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(body);
  }

  /* ---------- boot ---------- */
  async function connect() {
    if (state.ready) return true;
    if (state.loading) return false;
    state.loading = true; notify();
    const cfg = await resolveConfig();
    state.loading = false;
    if (!cfg) { state.error = 'no-config'; notify(); return false; }
    if (!cfg.databaseURL) { state.error = 'Config is missing databaseURL (enable Realtime Database).'; notify(); return false; }
    state.loading = true; state.error = null; notify();
    try {
      const [appMod, authMod, dbMod] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        import(SDK + 'firebase-auth.js'),
        import(SDK + 'firebase-database.js'),
      ]);
      const app = appMod.initializeApp(cfg);
      const auth = authMod.getAuth(app);
      const db = dbMod.getDatabase(app);
      fb = {
        app, auth, db,
        ...authMod, ...dbMod,
        signInAnonymously: authMod.signInAnonymously,
      };
      const cred = await authMod.signInAnonymously(auth);
      state.uid = cred.user.uid;
      state.name = localStorage.getItem(NAME_KEY) || ('Crew' + (1000 + Math.floor(Math.random() * 9000)));
      state.ready = true; state.loading = false;
      await ensureProfile();
      watchSocial();
      notify();
      return true;
    } catch (e) {
      state.loading = false;
      state.error = friendlyError(e);
      console.warn('[net]', e);
      notify();
      return false;
    }
  }

  function friendlyError(e) {
    const m = String(e && (e.code || e.message) || e);
    if (/admin-restricted|operation-not-allowed/.test(m)) return 'Anonymous sign-in is disabled — enable it in Firebase Auth → Sign-in method.';
    if (/permission_denied|PERMISSION_DENIED/i.test(m)) return 'Database rules rejected the request — publish firebase.rules.json.';
    if (/Failed to fetch|NetworkError|network-request-failed/i.test(m)) return 'Network unavailable.';
    return m;
  }

  /* ---------- profile & friend codes ---------- */
  function makeCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  async function ensureProfile() {
    const { ref, get, set, update, serverTimestamp } = fb;
    const pRef = ref(fb.db, 'players/' + state.uid);
    const snap = await get(pRef);
    let code = snap.exists() ? snap.val().code : null;
    if (!snap.exists()) {
      for (let tries = 0; tries < 6 && !code; tries++) {
        const c = makeCode();
        const cRef = ref(fb.db, 'codes/' + c);
        const cs = await get(cRef);
        if (!cs.exists()) { await set(cRef, state.uid); code = c; }
      }
      await set(pRef, { name: state.name, code, level: 1, xp: 0, best: 0, served: 0, updated: serverTimestamp() });
    } else {
      const v = snap.val();
      state.name = localStorage.getItem(NAME_KEY) || v.name || state.name;
      await update(pRef, { name: state.name, updated: serverTimestamp() });
    }
    state.code = code;

    // presence
    const sRef = ref(fb.db, 'status/' + state.uid);
    fb.onDisconnect(sRef).set({ online: false, at: serverTimestamp() });
    await set(sRef, { online: true, name: state.name, at: serverTimestamp() });
  }

  async function setName(name) {
    state.name = String(name || '').slice(0, 16).trim() || 'Crew';
    localStorage.setItem(NAME_KEY, state.name);
    if (!state.ready) { notify(); return; }
    await fb.update(fb.ref(fb.db, 'players/' + state.uid), { name: state.name });
    await fb.update(fb.ref(fb.db, 'status/' + state.uid), { name: state.name });
    if (state.room) await fb.update(fb.ref(fb.db, `rooms/${state.room}/members/${state.uid}`), { name: state.name });
    notify();
  }

  function watchSocial() {
    const { ref, onValue } = fb;
    detach('friends'); detach('invites');
    refs.friends = onValue(ref(fb.db, 'friends/' + state.uid), (s) => {
      const v = s.val() || {};
      state.friends = Object.keys(v).map(uid => ({ uid, name: v[uid].name || 'Crew', since: v[uid].since }));
      state.friends.forEach(f => watchStatus(f.uid));
      /* Someone added while a kitchen is already open would otherwise be missing
         from its allow-list and be refused at the door. */
      if (state.room && state.isHost) refreshAllow();
      notify();
    });
    refs.invites = onValue(ref(fb.db, 'invites/' + state.uid), (s) => {
      const v = s.val() || {};
      state.invites = Object.keys(v).map(uid => ({ uid, name: v[uid].name || 'Crew' }));
      notify();
    });
  }

  const statusWatched = {};
  function watchStatus(uid) {
    if (statusWatched[uid]) return;
    statusWatched[uid] = true;
    fb.onValue(fb.ref(fb.db, 'status/' + uid), (s) => {
      const v = s.val();
      state.online[uid] = !!(v && v.online);
      notify();
    });
    // a friend's open kitchen, so it can be joined without passing a code around
    fb.onValue(fb.ref(fb.db, 'players/' + uid + '/room'), (s) => {
      const code = s.val();
      if (code) state.friendRooms[uid] = code; else delete state.friendRooms[uid];
      notify();
    });
  }

  /* Send a friend request by code. The other side accepts to create the link. */
  async function requestFriend(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) throw new Error('Friend codes are 6 characters.');
    if (code === state.code) throw new Error("That's your own code.");
    const snap = await fb.get(fb.ref(fb.db, 'codes/' + code));
    if (!snap.exists()) throw new Error('No player with that code.');
    const uid = snap.val();
    if (state.friends.some(f => f.uid === uid)) throw new Error('Already friends.');
    await fb.set(fb.ref(fb.db, `invites/${uid}/${state.uid}`), { name: state.name, ts: fb.serverTimestamp() });
    return uid;
  }

  async function acceptInvite(uid, name) {
    const { ref, set, remove, serverTimestamp } = fb;
    await set(ref(fb.db, `friends/${state.uid}/${uid}`), { name: name || 'Crew', since: serverTimestamp() });
    await set(ref(fb.db, `friends/${uid}/${state.uid}`), { name: state.name, since: serverTimestamp() });
    await remove(ref(fb.db, `invites/${state.uid}/${uid}`));
  }

  async function declineInvite(uid) { await fb.remove(fb.ref(fb.db, `invites/${state.uid}/${uid}`)); }

  async function removeFriend(uid) {
    await fb.remove(fb.ref(fb.db, `friends/${state.uid}/${uid}`));
    await fb.remove(fb.ref(fb.db, `friends/${uid}/${state.uid}`));
  }

  /* ---------- rooms (friends only) ---------- */
  function detach(k) { if (refs[k]) { try { refs[k](); } catch (e) {} refs[k] = null; } }

  /* The allow-list is the host's friend list, so only friends can ever join.
     Database rules enforce the same check server-side. */
  async function createRoom() {
    if (!state.ready) throw new Error('Not connected.');
    const code = makeCode();
    /* Read the friends list straight from the database rather than trusting the
       local cache, so a kitchen opened before the listener has caught up still
       admits everyone it should. */
    const allow = { [state.uid]: true };
    try {
      const fs = await fb.get(fb.ref(fb.db, 'friends/' + state.uid));
      const v = fs.val() || {};
      Object.keys(v).forEach(uid => { allow[uid] = true; });
    } catch (e) { /* fall back to the cache below */ }
    state.friends.forEach(f => { allow[f.uid] = true; });
    await fb.set(fb.ref(fb.db, 'rooms/' + code), {
      host: state.uid, hostName: state.name, created: fb.serverTimestamp(), open: true,
      allow,
      members: { [state.uid]: { name: state.name, host: true, t: fb.serverTimestamp() } },
    });
    fb.onDisconnect(fb.ref(fb.db, 'rooms/' + code)).remove();
    // advertise it to friends, and retract it if this tab goes away
    const meRef = fb.ref(fb.db, 'players/' + state.uid);
    await fb.update(meRef, { room: code });
    fb.onDisconnect(meRef).update({ room: null });
    await enterRoom(code, true);
    return code;
  }

  async function joinRoom(code) {
    if (!state.ready) throw new Error('Not connected.');
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const snap = await fb.get(fb.ref(fb.db, 'rooms/' + code));
    if (!snap.exists()) throw new Error('No open kitchen with that code.');
    const v = snap.val();
    if (!v.allow || !v.allow[state.uid]) throw new Error('Friends only — ask the host to add your friend code first.');
    await fb.set(fb.ref(fb.db, `rooms/${code}/members/${state.uid}`), { name: state.name, host: false, t: fb.serverTimestamp() });
    await enterRoom(code, false, v.host);
    return code;
  }

  async function enterRoom(code, isHost, hostUid) {
    state.room = code;
    state.isHost = isHost;
    state.hostUid = isHost ? state.uid : hostUid;
    state.peers = {};

    const meRef = fb.ref(fb.db, `rooms/${code}/players/${state.uid}`);
    fb.onDisconnect(meRef).remove();
    fb.onDisconnect(fb.ref(fb.db, `rooms/${code}/members/${state.uid}`)).remove();

    detach('players'); detach('sim'); detach('ev'); detach('members');

    refs.players = fb.onValue(fb.ref(fb.db, `rooms/${code}/players`), (s) => {
      const v = s.val() || {};
      const now = performance.now();
      Object.keys(v).forEach(uid => {
        if (uid === state.uid) return;
        const d = v[uid];
        let p = state.peers[uid];
        if (!p) p = state.peers[uid] = { name: d.n, x: d.x, y: d.y || 0, z: d.z, yaw: d.r, ix: d.x, iy: d.y || 0, iz: d.z, iyaw: d.r };
        p.name = d.n; p.x = d.x; p.y = d.y || 0; p.z = d.z; p.yaw = d.r;
        p.anim = d.a; p.hold = d.h; p.t = now;
      });
      Object.keys(state.peers).forEach(uid => { if (!v[uid]) delete state.peers[uid]; });
      notify();
    });

    refs.members = fb.onValue(fb.ref(fb.db, `rooms/${code}/members`), (s) => {
      state.members = s.val() || {};
      // Host left → room is gone.
      if (state.room && !state.isHost && !state.members[state.hostUid]) leaveRoom('The host closed the kitchen.');
      notify();
    });

    if (!isHost) {
      refs.sim = fb.onValue(fb.ref(fb.db, `rooms/${code}/sim`), (s) => {
        const v = s.val();
        if (v && cbs.sim) cbs.sim(v);
      });
    } else {
      refs.ev = fb.onChildAdded(fb.ref(fb.db, `rooms/${code}/ev`), (s) => {
        const v = s.val();
        fb.remove(s.ref);
        if (v && v.by !== state.uid && cbs.event) cbs.event(v);
      });
    }
    refs.chat = fb.onChildAdded(fb.query(fb.ref(fb.db, `rooms/${code}/chat`), fb.limitToLast(12)), (s) => {
      const v = s.val();
      if (v && cbs.chat) cbs.chat(v);
    });
    notify();
  }

  async function leaveRoom(reason) {
    const code = state.room;
    state.room = null; state.peers = {}; state.members = {};
    const wasHost = state.isHost;
    state.isHost = true; state.hostUid = state.uid;
    ['players', 'sim', 'ev', 'members', 'chat'].forEach(detach);
    notify();
    if (!code || !state.ready) return;
    try {
      await fb.update(fb.ref(fb.db, 'players/' + state.uid), { room: null });
      if (wasHost) await fb.remove(fb.ref(fb.db, 'rooms/' + code));
      else {
        await fb.remove(fb.ref(fb.db, `rooms/${code}/players/${state.uid}`));
        await fb.remove(fb.ref(fb.db, `rooms/${code}/members/${state.uid}`));
      }
    } catch (e) { /* room may already be gone */ }
    if (reason && cbs.chat) cbs.chat({ sys: true, m: reason });
  }

  /* Refresh the allow-list after making new friends mid-session. */
  async function refreshAllow() {
    if (!state.room || !state.isHost) return;
    const allow = { [state.uid]: true };
    state.friends.forEach(f => { allow[f.uid] = true; });
    await fb.set(fb.ref(fb.db, `rooms/${state.room}/allow`), allow);
  }

  /* ---------- realtime traffic ---------- */
  /* One small write per tick; ~12 Hz keeps a co-op session well under Firebase's
     free-tier bandwidth while interpolation hides the gaps. */
  function sendSelf(p) {
    if (!state.room || !state.ready) return;
    const now = performance.now();
    if (now - sendTimer < 80) return;
    sendTimer = now;
    fb.set(fb.ref(fb.db, `rooms/${state.room}/players/${state.uid}`), {
      n: state.name,
      x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100,
      r: Math.round(p.yaw * 100) / 100, a: p.anim | 0, h: p.hold | 0,
    }).catch(() => {});
  }

  let simTimer = 0;
  function sendSim(payload, minInterval) {
    if (!state.room || !state.isHost || !state.ready) return;
    const now = performance.now();
    if (now - simTimer < (minInterval || 160)) return;
    simTimer = now;
    fb.set(fb.ref(fb.db, `rooms/${state.room}/sim`), payload).catch(() => {});
  }

  function sendEvent(ev) {
    if (!state.room || !state.ready) return;
    ev.by = state.uid;
    fb.push(fb.ref(fb.db, `rooms/${state.room}/ev`), ev).catch(() => {});
  }

  function sendChat(m) {
    if (!state.room || !state.ready) return;
    fb.push(fb.ref(fb.db, `rooms/${state.room}/chat`), { n: state.name, m: String(m).slice(0, 90), t: fb.serverTimestamp() }).catch(() => {});
  }

  /* ---------- leaderboard ---------- */
  async function submitScore(score, level, served) {
    if (!state.ready) return;
    score = Math.round(score);
    const lRef = fb.ref(fb.db, 'leaderboard/' + state.uid);
    const snap = await fb.get(lRef);
    const prev = snap.exists() ? (snap.val().score || 0) : 0;
    if (score > prev) {
      await fb.set(lRef, { name: state.name, score, level, served: served | 0, ts: fb.serverTimestamp() });
    }
    await fb.update(fb.ref(fb.db, 'players/' + state.uid), { best: Math.max(prev, score), level, served: served | 0 });
  }

  async function leaderboard(scope) {
    if (!state.ready) return [];
    const q = fb.query(fb.ref(fb.db, 'leaderboard'), fb.orderByChild('score'), fb.limitToLast(60));
    const snap = await fb.get(q);
    const out = [];
    snap.forEach(ch => { out.push(Object.assign({ uid: ch.key }, ch.val())); });
    out.sort((a, b) => b.score - a.score);
    if (scope === 'friends') {
      const ok = new Set(state.friends.map(f => f.uid));
      ok.add(state.uid);
      return out.filter(r => ok.has(r.uid)).slice(0, 25);
    }
    return out.slice(0, 25);
  }

  g.Net = {
    state, connect, getConfig, resolveConfig, setConfig, clearConfig, parseConfig,
    setName, requestFriend, acceptInvite, declineInvite, removeFriend,
    createRoom, joinRoom, leaveRoom, refreshAllow,
    sendSelf, sendSim, sendEvent, sendChat,
    submitScore, leaderboard, ready,
    on(k, fn) { cbs[k] = fn; },
    get configured() { return !!getConfig(); },
    get usingOwnProject() { return !!localConfig(); },
  };
})(window);
