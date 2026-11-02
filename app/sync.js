/* Sync personal notes between devices with Google sign-in (Firebase Auth + Firestore).
   Notes are always saved on the device first (see app.js); this file copies them to
   users/{uid}/notes/{entryId} and pulls changes from other devices. For each note the
   newest edit wins, and deletions sync as empty notes. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const grp = $('sync-grp');
  if (!grp) return;
  const cfg = window.IKMAL_FIREBASE;
  const box = $('sync-box');
  const httpsOK = /^https?:$/.test(location.protocol) && window.isSecureContext;

  function view(html) { box.innerHTML = html; }
  if (!httpsOK) { view('<p>Sync works in the website version of the app.</p>'); return; }
  if (!cfg || !cfg.apiKey) { view('<p>Sync between devices is not set up yet.</p>'); return; }

  const VENDOR = ['vendor/firebase-app-compat-10.14.1.js', 'vendor/firebase-auth-compat-10.14.1.js', 'vendor/firebase-firestore-compat-10.14.1.js'];
  const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

  let auth, db, user = null, col = null, unsub = null, lastSync = 0, busy = false, errMsg = '';
  const N = () => window.IkmalNotes;
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render() {
    if (busy) { view('<p>Signing in…</p>'); return; }
    if (!user) {
      view('<p>Sign in with the same Google account on each phone, tablet or computer, and your notes stay the same on all of them. Notes still save on this device when you are offline.</p>' +
        (errMsg ? '<p class="sync-err">' + esc(errMsg) + '</p>' : '') +
        '<div class="row-btns"><button class="btn primary" type="button" id="sync-in">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="currentColor" opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="currentColor" opacity=".6" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/><path fill="currentColor" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg>' +
        'Sign in with Google</button></div>');
      $('sync-in').onclick = signIn;
      return;
    }
    const state = !navigator.onLine ? 'Offline. Changes will sync when you reconnect.' : lastSync ? 'Synced at ' + fmtTime(lastSync) + '.' : 'Syncing…';
    view('<p>Signed in as <b>' + esc(user.email || user.displayName || 'your Google account') + '</b>. ' + state + '</p>' +
      (errMsg ? '<p class="sync-err">' + esc(errMsg) + '</p>' : '') +
      '<div class="row-btns"><button class="btn" type="button" id="sync-now">Sync now</button><button class="btn" type="button" id="sync-out">Sign out</button></div>');
    $('sync-now').onclick = () => reconcileFromServer();
    $('sync-out').onclick = () => auth.signOut();
  }
  function setPill() {
    const t = $('status-t'); if (!t || !user) return;
    if (navigator.onLine && lastSync) t.textContent = 'Available offline · notes synced';
  }

  async function signIn() {
    errMsg = ''; busy = true; render();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(e.code || '')) {
        try { await auth.signInWithRedirect(provider); return; } catch (e2) { errMsg = message(e2); }
      } else if (!/popup-closed|cancelled-popup/.test(e.code || '')) errMsg = message(e);
    }
    busy = false; render();
  }
  function message(e) {
    const c = (e && e.code) || '';
    if (c.includes('unauthorized-domain')) return 'This website is not on the sign-in allow list yet. In Firebase, add it under Authentication → Settings → Authorized domains.';
    if (c.includes('network')) return 'No connection. Try again when you are online.';
    if (c.includes('permission-denied')) return 'The cloud database refused access. Check that the Firestore rules from firestore.rules are published.';
    return 'Sign-in did not work (' + (c || 'unknown error') + '). Try again.';
  }

  function push(rec) {
    if (!col || !rec || !rec.id) return Promise.resolve();
    const lab = N().label(rec.id);
    return col.doc(rec.id).set({ text: rec.text || '', updated: rec.updated || Date.now(), entry: String(lab.entry), name: lab.name })
      .then(() => { lastSync = Date.now(); errMsg = ''; render(); setPill(); })
      .catch((e) => { errMsg = message(e); render(); });
  }

  // Bring both sides level: newer remote copies come down, newer local copies go up.
  function reconcile(remote) {
    let changed = false;
    remote.forEach((r, id) => { if (N().applyRemote(id, r)) changed = true; });
    const ups = [];
    N().records().forEach((l) => {
      const r = remote.get(l.id);
      if (!r || (Number(r.updated) || 0) < (l.updated || 0)) ups.push(push(l));
    });
    if (changed) N().refresh();
    return Promise.all(ups).then(() => { lastSync = Date.now(); render(); setPill(); });
  }
  function reconcileFromServer() {
    if (!col) return;
    col.get({ source: 'server' }).then((snap) => {
      const remote = new Map(); snap.forEach((d) => remote.set(d.id, d.data()));
      return reconcile(remote);
    }).catch((e) => { errMsg = message(e); render(); });
  }

  function start(u) {
    user = u; errMsg = '';
    if (unsub) { unsub(); unsub = null; }
    col = null; lastSync = 0;
    if (!u) { N().onLocalSave = null; render(); return; }
    col = db.collection('users').doc(u.uid).collection('notes');
    N().onLocalSave = (rec) => { if (navigator.onLine) push(rec); };
    render();
    unsub = col.onSnapshot({ includeMetadataChanges: false }, (snap) => {
      if (snap.metadata.fromCache) return;
      const remote = new Map(); snap.forEach((d) => remote.set(d.id, d.data()));
      reconcile(remote);
    }, (e) => { errMsg = message(e); render(); });
  }

  window.addEventListener('online', () => { render(); reconcileFromServer(); });
  window.addEventListener('offline', render);

  view('<p>Connecting…</p>');
  (async () => {
    try {
      for (const v of VENDOR) await load(v);
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.firestore();
      try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
      auth.getRedirectResult().catch((e) => { errMsg = message(e); render(); });
      const waitNotes = () => new Promise((r) => { const t = setInterval(() => { if (N() && N().records) { clearInterval(t); r(); } }, 50); });
      await waitNotes();
      auth.onAuthStateChanged(start);
    } catch (e) {
      view('<p>Sync could not start on this device. Your notes are still saved here.</p>');
    }
  })();
})();
