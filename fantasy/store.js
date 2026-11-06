/* Data layer: league data (GitHub), players.json, and Firebase (auth + Firestore).
   Exposes window.FantasyStore with the same interface for the real store and the demo store (?demo). */
(function () {
  'use strict';
  const CFG = window.FANTASY_CONFIG;
  const CACHE_LEAGUE = 'duf-league-v1';
  const CACHE_DATA = 'duf-data-v1';

  const getJSON = async (url, opts = {}) => {
    const r = await fetch(url, { cache: opts.cache || 'no-cache' });
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${url}`), { status: r.status });
    return r.json();
  };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or private mode */ } };
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

  // ---------- league data ----------
  async function fixturesFrom(base, localIndex) {
    let weeks = localIndex;
    if (!weeks) {
      // the remote repo can't be listed without the API: probe week-01, week-02, … until one is missing
      weeks = [];
      for (let w = 1; w <= 60; w++) {
        try { const fx = await getJSON(`${base}fixtures/week-${String(w).padStart(2, '0')}.json`); weeks.push(fx); }
        catch (e) { if (w > 1 || e.status === 404) break; else throw e; }
      }
      return weeks;
    }
    return Promise.all(weeks.map((w) => getJSON(`${base}fixtures/week-${String(w).padStart(2, '0')}.json`).catch(() => null)));
  }
  async function leagueFrom(base, local) {
    const [config, squads, matches, goals] = await Promise.all(['league.json', 'data/squads.json', 'data/matches.json', 'data/goals.json'].map((f) => getJSON(base + f)));
    const appearances = await getJSON(base + 'data/appearances.json').catch(() => []);
    const idx = local ? await getJSON(base + 'fixtures/index.json').catch(() => null) : null;
    const fixtures = await fixturesFrom(base, local ? (idx || [1]) : null);
    return { config, squads, matches, goals, appearances, fixtures, fetched: Date.now(), source: local ? 'bundled' : 'live' };
  }
  async function loadLeague() {
    try {
      const live = await leagueFrom(CFG.leagueBase, false);
      save(CACHE_LEAGUE, live);
      return live;
    } catch (e) {
      const cached = load(CACHE_LEAGUE);
      if (cached) return { ...cached, source: 'cached' };
      return leagueFrom(CFG.localLeagueBase, true);
    }
  }
  const loadPlayers = () => getJSON('players.json');

  // ---------- Firebase store ----------
  function firebaseStore() {
    const VENDOR = ['vendor/firebase-app-compat-10.14.1.js', 'vendor/firebase-auth-compat-10.14.1.js', 'vendor/firebase-firestore-compat-10.14.1.js'];
    const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    let auth, db, user = null, known = false;
    const listeners = [];
    const api = {
      demo: false,
      get user() { return user; },
      isAdmin: () => !!user && CFG.adminEmails.map((e) => e.toLowerCase()).includes((user.email || '').toLowerCase()),
      async init() {
        const cfg = window.DUF_FIREBASE;
        if (!cfg || !cfg.apiKey) throw new Error('Firebase is not set up (fantasy/firebase-config.js).');
        for (const v of VENDOR) await loadScript(v);
        firebase.initializeApp(cfg);
        auth = firebase.auth();
        db = firebase.firestore();
        try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* another tab, or unsupported */ }
        try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) { /* ignore */ }
        auth.getRedirectResult().catch(() => {});
        auth.onAuthStateChanged((u) => { user = u; known = true; listeners.forEach((f) => f(u)); });
      },
      // late listeners get the current state straight away
      onAuth(f) { listeners.push(f); if (known) f(user); },
      async signIn() {
        const p = new firebase.auth.GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
        try { await auth.signInWithPopup(p); }
        catch (e) {
          if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(e.code || '')) return auth.signInWithRedirect(p);
          if (!/popup-closed|cancelled-popup/.test(e.code || '')) throw e;
        }
      },
      signOut: () => auth.signOut(),

      // Everything the app needs, in one go. Throws {code:'permission-denied'} for non-members.
      async loadAll() {
        const uid = user.uid;
        const [settingsDoc, pricesDoc, gwSnap, mgrSnap, sheetSnap] = await Promise.all([
          db.doc('fantasySettings/main').get(),
          db.doc('fantasySettings/prices').get(),
          db.collection('fantasyGw').get(),
          db.collection('fantasyManagers').get(),
          db.collection('fantasySheets').get(),
        ]);
        const gws = {};
        gwSnap.forEach((d) => { const v = d.data(); gws[d.id] = { gw: Number(d.id), deadline: v.deadline ? v.deadline.toMillis() : null, locked: !!v.locked }; });
        const managers = {}; mgrSnap.forEach((d) => { managers[d.id] = d.data(); });
        const sheets = {}; sheetSnap.forEach((d) => { sheets[d.id] = d.data(); });
        const entries = {};
        const now = Date.now();
        await Promise.all(Object.values(gws).map(async (g) => {
          entries[g.gw] = {};
          const passed = g.locked || (g.deadline && g.deadline <= now);
          if (passed) {
            try {
              const s = await db.collection(`fantasyGw/${g.gw}/entries`).get();
              s.forEach((d) => { entries[g.gw][d.id] = d.data(); });
              return;
            } catch (e) { /* clock skew near the deadline: fall back to our own entry */ }
          }
          const mine = await db.doc(`fantasyGw/${g.gw}/entries/${uid}`).get();
          if (mine.exists) entries[g.gw][uid] = mine.data();
        }));
        const out = {
          settings: settingsDoc.exists ? settingsDoc.data() : {},
          priceUpdates: pricesDoc.exists ? (pricesDoc.data().updates || []) : [],
          gws, managers, sheets, entries, synced: Date.now(),
        };
        save(CACHE_DATA + ':' + uid, out);
        return out;
      },
      cached() { return user ? load(CACHE_DATA + ':' + user.uid) : null; },

      saveManager: (doc) => db.doc(`fantasyManagers/${doc.uid}`).set(doc),
      saveEntry(gw, entry, uid = user.uid) {
        const d = { uid, squad: entry.squad, sub: entry.sub, captain: entry.captain, vice: entry.vice, chip: entry.chip || null, savedAt: firebase.firestore.FieldValue.serverTimestamp() };
        return db.doc(`fantasyGw/${gw}/entries/${uid}`).set(d);
      },
      deleteEntry: (gw, uid) => db.doc(`fantasyGw/${gw}/entries/${uid}`).delete(),
      // admin
      saveGw: (gw, { deadline, locked }) => db.doc(`fantasyGw/${gw}`).set({ deadline: firebase.firestore.Timestamp.fromMillis(deadline), locked: !!locked }),
      deleteGw: (gw) => db.doc(`fantasyGw/${gw}`).delete(),
      saveSettings: (patch) => db.doc('fantasySettings/main').set(patch, { merge: true }),
      savePriceUpdates: (updates) => db.doc('fantasySettings/prices').set({ updates }),
      saveSheet: (key, sheet) => db.doc(`fantasySheets/${key}`).set(sheet),
      deleteSheet: (key) => db.doc(`fantasySheets/${key}`).delete(),
      async getAllowlist() { const d = await db.doc('fantasyAccess/allowlist').get(); return d.exists ? (d.data().emails || []) : []; },
      saveAllowlist: (emails) => db.doc('fantasyAccess/allowlist').set({ emails }),
      deleteManager: (uid) => db.doc(`fantasyManagers/${uid}`).delete(),
    };
    return api;
  }

  // ---------- demo store (?demo): in memory, signed in as the admin, sample results ----------
  function demoStore() {
    const D = window.FantasyDemo;
    let data = null, user = null;
    const listeners = [];
    const api = {
      demo: true,
      get user() { return user; },
      isAdmin: () => true,
      async init(ctx) { data = D.seed(ctx); },
      onAuth(f) { listeners.push(f); setTimeout(() => { user = D.me; f(user); }, 0); },
      async signIn() { user = D.me; listeners.forEach((f) => f(user)); },
      async signOut() { user = null; listeners.forEach((f) => f(null)); },
      async loadAll() {
        const copy = JSON.parse(JSON.stringify(data));
        const now = Date.now();
        // hide other managers' teams before the deadline, as the rules do
        for (const [gw, es] of Object.entries(copy.entries)) {
          const g = copy.gws[gw];
          if (!(g && (g.locked || g.deadline <= now))) for (const uid of Object.keys(es)) if (uid !== user.uid) delete es[uid];
        }
        copy.synced = now;
        return copy;
      },
      cached: () => null,
      async saveManager(doc) { data.managers[doc.uid] = doc; },
      async saveEntry(gw, entry, uid = user.uid) {
        const g = data.gws[gw];
        if (uid === user.uid && (!g || g.locked || g.deadline <= Date.now())) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        (data.entries[gw] = data.entries[gw] || {})[uid] = { uid, squad: entry.squad, sub: entry.sub, captain: entry.captain, vice: entry.vice, chip: entry.chip || null, savedAt: Date.now() };
      },
      async deleteEntry(gw, uid) { delete (data.entries[gw] || {})[uid]; },
      async saveGw(gw, v) { data.gws[gw] = { gw: Number(gw), deadline: v.deadline, locked: !!v.locked }; data.entries[gw] = data.entries[gw] || {}; },
      async deleteGw(gw) { delete data.gws[gw]; },
      async saveSettings(p) { Object.assign(data.settings, p); },
      async savePriceUpdates(u) { data.priceUpdates = u; },
      async saveSheet(k, s) { data.sheets[k] = s; },
      async deleteSheet(k) { delete data.sheets[k]; },
      async getAllowlist() { return data.allowlist.slice(); },
      async saveAllowlist(e) { data.allowlist = e.slice(); },
      async deleteManager(uid) { delete data.managers[uid]; },
    };
    return api;
  }

  const demo = /[?&]demo\b/.test(location.search);
  window.FantasyStore = {
    demo,
    loadLeague: demo ? () => window.FantasyDemo.league() : loadLeague,
    loadPlayers,
    create: () => (demo ? demoStore() : firebaseStore()),
  };
})();
