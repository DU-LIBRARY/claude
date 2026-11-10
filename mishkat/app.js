/* Mishkāt Commentary Reader: offline app logic.
   Everything from the data files is rendered through DOM APIs (createElement / textContent);
   nothing from the data ever goes through innerHTML. Conventions follow app/app.js (Al-Ikmāl). */
(function () {
  'use strict';

  const M = window.Motion || null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canAnimate = () => M && !reduceMotion.matches;
  const EASE = [0.2, 0.8, 0.2, 1];
  const SPRING = { type: 'spring', stiffness: 520, damping: 40 };
  const $ = (id) => document.getElementById(id);
  const wideMQ = window.matchMedia('(min-width: 1000px)');
  const isWide = () => wideMQ.matches;

  /* ---------- storage (best effort) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mishkat-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mishkat-' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- small DOM helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  const ICONS = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>'
  };
  function icon(name) { const t = document.createElement('template'); t.innerHTML = ICONS[name]; return t.content.firstChild; }

  const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  const toLatDig = (s) => s.replace(/[٠-٩]/g, (d) => AR_DIG.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIG[d]);

  /* ---------- Arabic-aware normalisation ----------
     Strips harakat (U+064B-065F, U+0670), tatweel, Quranic marks (U+06D6-06ED); folds alif forms,
     alif maqsura, ta marbuta and hamza carriers; Arabic-Indic digits become Latin; Latin loses accents. */
  const DIAC = /[ؐ-ًؚ-ٰٟـۖ-ۭ​-‏؜︀-️]/;
  const FOLD = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ی': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي', 'ء': '', 'ک': 'ك', 'ﷺ': '', 'ʿ': '', 'ʾ': '', '’': '', '‘': '', "'": '' };
  function normChar(c) {
    if (DIAC.test(c)) return '';
    if (c in FOLD) return FOLD[c];
    if (c >= '٠' && c <= '٩') return String(AR_DIG.indexOf(c));
    if (c >= '۰' && c <= '۹') return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
    if (/[\p{L}\p{N}]/u.test(c)) {
      if (c < '؀' || c > 'ۿ') return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      return c;
    }
    return ' ';
  }
  /* normalised string plus a map from each normalised character back to its index in the original */
  function normMap(text) {
    let s = ''; const map = [];
    for (let i = 0; i < text.length; i++) {
      const n = normChar(text[i]);
      if (n === '') continue;
      if (n === ' ') { if (s === '' || s[s.length - 1] === ' ') continue; s += ' '; map.push(i); continue; }
      for (const ch of n) { s += ch; map.push(i); }
    }
    return { s, map };
  }
  const norm = (t) => normMap(t).s.trim();

  function findRanges(text, words) {
    if (!words || !words.length) return [];
    const { s, map } = normMap(text);
    const out = [];
    words.forEach((w) => {
      let p = 0;
      while (w && (p = s.indexOf(w, p)) > -1) {
        let a = map[p], b = map[p + w.length - 1] + 1;
        while (b < text.length && DIAC.test(text[b])) b++;
        out.push([a, b]); p += w.length;
      }
    });
    out.sort((x, y) => x[0] - y[0]);
    const merged = [];
    out.forEach((r) => { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push(r.slice()); });
    return merged;
  }
  /* append text to parent, wrapping the matches in <mark> */
  function appendHL(parent, text, words, ranges) {
    const rs = ranges || findRanges(text, words);
    if (!rs.length) { parent.appendChild(document.createTextNode(text)); return; }
    let pos = 0;
    rs.forEach(([a, b]) => {
      if (a > pos) parent.appendChild(document.createTextNode(text.slice(pos, a)));
      parent.appendChild(el('mark', '', text.slice(a, b)));
      pos = b;
    });
    if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
  }

  /* ---------- segments ---------- */
  const segText = (runs, opts) => (runs || []).map((r) => (r.fn != null ? '' : (opts && opts.noRef && r.ref ? '' : r.t))).join('').replace(/\s+/g, ' ').trim();

  function renderRuns(parent, runs, ctx) {
    const words = ctx && ctx.words;
    (runs || []).forEach((r) => {
      if (r.fn != null) {
        const sup = el('sup', 'fn'), a = el('a', '', r.mark);
        a.href = '#' + r.fn; a.id = 'r-' + r.fn; a.setAttribute('aria-label', 'Footnote ' + toLatDig(r.mark));
        sup.appendChild(a); parent.appendChild(sup); return;
      }
      if (r.b || r.ref || r.rtl) {
        const n = el(r.b ? 'b' : 'span', r.ref ? 'mref' : '');
        if (r.rtl) { n.dir = 'rtl'; n.lang = 'ar'; }
        if (r.ref) n.appendChild(document.createTextNode(r.t)); else appendHL(n, r.t, words);
        parent.appendChild(n);
      } else appendHL(parent, r.t, words);
    });
  }

  /* ---------- grading ---------- */
  function gradeShort(line) {
    return line.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/^قال\s+الشيخ\s*:?\s*/, '').replace(/[.\s]+$/, '');
  }
  function gradeType(t) {
    if (/موضوع|منكر|باطل|ضعيف جد/.test(t)) return 'bad';
    if (/ضعيف|لين|مرسل|منقطع/.test(t)) return 'weak';
    if (/صحيح|حسن|جيد|قوي/.test(t)) return 'good';
    return 'neutral';
  }
  // the chip shows only the verdict ("صحيح", "ضعيف لإرساله"); the full line stays printed under the commentary
  const gradeVerdict = (line) => gradeShort(line).split(/\s*[،,.]\s+|\s*[،,]\s*|\s+(?=انظر|رواه|وانظر|وقد)/)[0].replace(/[.\s]+$/, '');
  const isGrade = (line) => gradeType(gradeShort(line)) !== 'neutral';
  function gradeChip(line) {
    const t = gradeVerdict(line);
    const c = el('span', 'gr', t); c.lang = 'ar'; c.dir = 'rtl'; c.dataset.t = gradeType(t); c.title = line;
    return c;
  }

  /* ---------- personal notes ----------
     IndexedDB (durable) mirrored to localStorage; newest copy of each note wins; deletions are tombstones.
     Record ids are 'mishkat-<sectionId>' because the cloud collection is shared with the Al-Ikmāl app. */
  let patternT = 0;
  const PFX = 'mishkat-';
  const notes = new Map();
  const NOTES_LS = 'mishkat-notes';
  const tombs = new Map();
  let idb = null;
  function idbOpen() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open('mishkat', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('notes', { keyPath: 'id' });
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
  }
  function idbAll(db) {
    return new Promise((res) => {
      try { const r = db.transaction('notes').objectStore('notes').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); } catch (e) { res([]); }
    });
  }
  function idbPut(rec) {
    if (!idb) return Promise.resolve(false);
    return new Promise((res) => {
      try {
        const tx = idb.transaction('notes', 'readwrite');
        tx.objectStore('notes').put({ id: rec.id, text: rec.text || '', updated: rec.updated || Date.now() });
        tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false);
      } catch (e) { res(false); }
    });
  }
  function lsNotes() { try { return JSON.parse(localStorage.getItem(NOTES_LS) || '{}'); } catch (e) { return {}; } }
  function lsWrite() {
    try {
      const o = {}; notes.forEach((v, k) => { o[k] = v; });
      tombs.forEach((u, k) => { if (!notes.has(k)) o[k] = { text: '', updated: u }; });
      localStorage.setItem(NOTES_LS, JSON.stringify(o)); return true;
    } catch (e) { return false; }
  }
  const stamp = (id) => Math.max(notes.has(id) ? notes.get(id).updated || 0 : 0, tombs.get(id) || 0);
  function mergeNote(id, rec) {
    if (!rec || typeof rec.text !== 'string') return false;
    const u = Number(rec.updated) || 0;
    if (stamp(id) >= u && (notes.has(id) || tombs.has(id))) return false;
    if (rec.text.trim()) { notes.set(id, { text: rec.text, updated: u || Date.now() }); tombs.delete(id); }
    else { notes.delete(id); tombs.set(id, u || Date.now()); }
    return true;
  }
  function allRecords() {
    const out = [];
    notes.forEach((v, k) => out.push({ id: k, text: v.text, updated: v.updated }));
    tombs.forEach((u, k) => { if (!notes.has(k)) out.push({ id: k, text: '', updated: u }); });
    return out;
  }
  async function loadNotes() {
    const ls = lsNotes();
    Object.keys(ls).forEach((k) => { if (k.startsWith(PFX)) mergeNote(k, ls[k]); });
    if ('indexedDB' in window) {
      idb = await idbOpen();
      if (idb) {
        const rows = await idbAll(idb);
        rows.forEach((r) => { if (String(r.id).startsWith(PFX)) mergeNote(r.id, r); });
        const have = new Set(rows.map((r) => r.id));
        allRecords().forEach((r) => { if (!have.has(r.id)) idbPut(r); });
      }
    }
    lsWrite();
  }
  let persistAsked = false;
  async function askPersist() {
    if (persistAsked) return; persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
  }
  const noteId = (sid) => PFX + sid;
  async function saveNote(sid, text) {
    const id = noteId(sid);
    const rec = { id, text: text.replace(/\s+$/, ''), updated: Date.now() };
    if (rec.text.trim()) { notes.set(id, { text: rec.text, updated: rec.updated }); tombs.delete(id); }
    else { notes.delete(id); tombs.set(id, rec.updated); }
    const a = await idbPut(rec), b = lsWrite();
    askPersist();
    updateNoteMarks(sid);
    if (window.IkmalNotes && window.IkmalNotes.onLocalSave) { try { window.IkmalNotes.onLocalSave(rec); } catch (e) {} }
    return a || b;
  }
  /* Bridge for sync.js (same shape as the Al-Ikmāl app) */
  function installBridge() {
  window.IkmalNotes = {
    records: allRecords,
    label: (id) => {
      const s = BYID.get(String(id).slice(PFX.length));
      const entry = s ? numLabel(s) : String(id);
      return { entry, name: 'Mishkāt ' + entry };
    },
    applyRemote(id, rec) {
      if (typeof id !== 'string' || !id.startsWith(PFX)) return false;
      const sid = id.slice(PFX.length);
      if (!BYID.has(sid)) return false;
      const prev = notes.get(id), prevText = prev ? prev.text : '';
      if (!mergeNote(id, rec)) return false;
      const cur = notes.get(id);
      idbPut(cur ? { id, text: cur.text, updated: cur.updated } : { id, text: '', updated: tombs.get(id) });
      lsWrite(); updateNoteMarks(sid);
      const t = document.getElementById('note-' + sid);
      if (t && t.value.replace(/\s+$/, '') === prevText && !pending.has(sid)) {
        const focused = document.activeElement === t, pos = t.selectionStart;
        t.value = cur ? cur.text : '';
        if (focused) { try { t.setSelectionRange(Math.min(pos, t.value.length), Math.min(pos, t.value.length)); } catch (e) {} }
        const s2 = t.parentNode.querySelector('.note-st');
        if (s2) s2.textContent = cur ? 'Updated from another device ' + when(cur.updated) : 'Deleted on another device';
        autosize(t);
      }
      return true;
    },
    refresh() { if (BOOKS.length) { buildChips(); runSearch(false); } },
    onLocalSave: null
  };
  }

  /* ---------- state ---------- */
  let META = null, BOOKS = [], SECTIONS = [], BYID = new Map();
  const st = {
    filter: 'all', words: [], qn: '', num: null, hits: [],
    saved: new Set(store.get('saved', [])),
    mode: ['one', 'stack', 'side'].includes(store.get('mode', 'stack')) ? store.get('mode', 'stack') : 'stack',
    tab: ['mirqat', 'tibi', 'lamaat'].includes(store.get('tab', 'mirqat')) ? store.get('tab', 'mirqat') : 'mirqat',
    fn: store.get('fn', '1') !== '0' && store.get('fn', true) !== false,
    size: Math.min(28, Math.max(15, parseInt(store.get('size', 19), 10) || 19)),
    cur: null, sideOK: false, collapsed: new Set()
  };
  const KEYS = ['mirqat', 'tibi', 'lamaat'];
  const AR_SHORT = { mirqat: 'مرقاة', tibi: 'الطيبي', lamaat: 'اللمعات' };
  const EN_SHORT = { mirqat: 'Mirqāt', tibi: 'al-Ṭībī', lamaat: 'Lamaʿāt' };
  const q = $('q'), list = $('list');

  const isBab = (s) => s.kind === 'bab' && s.bab;
  const numLabel = (s) => (s.n != null ? String(s.n) : isBab(s) ? 'Bāb ' + s.bab.n : 'Opening');
  const titleOf = (s) => (s.n != null ? 'Hadeeth ' + s.n : isBab(s) ? 'Opening of Bāb ' + s.bab.n : 'Opening of the book');
  // faṣl numbering restarts in every bāb, so a faṣl is identified by book + bāb + faṣl
  const faslKey = (s) => s._book.id + ':' + (s.bab ? s.bab.n : 0) + ':' + s.fasl.n;

  /* ---------- segmented controls with a sliding thumb (translateX only; columns are equal width) ---------- */
  function makeSeg(root, attr, value, onPick, sel) {
    sel = sel || 'aria-pressed';
    const thumb = root.querySelector('.thumb');
    let btns = [...root.querySelectorAll('button')], lastX = null;
    const cur = () => btns.find((b) => b.getAttribute(sel) === 'true');
    function place(animate) {
      const b = cur();
      if (!b || !b.offsetWidth) return;
      const x = b.offsetLeft - 3;
      thumb.style.width = b.offsetWidth + 'px';
      if (animate && canAnimate() && lastX !== null && lastX !== x) M.animate(thumb, { x: [lastX, x] }, SPRING);
      else thumb.style.transform = 'translateX(' + x + 'px)';
      lastX = x;
    }
    function set(v, animate) {
      btns.forEach((b) => { const on = b.dataset[attr] === String(v); b.setAttribute(sel, String(on)); if (sel === 'aria-selected') b.tabIndex = on ? 0 : -1; });
      place(animate);
    }
    btns.forEach((b) => b.addEventListener('click', () => { set(b.dataset[attr], true); onPick(b.dataset[attr]); }));
    if ('ResizeObserver' in window) new ResizeObserver(() => place(false)).observe(root);
    set(value, false);
    return { set, place, root };
  }
  /* press feedback on every button */
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button, .chip, .pn a');
    if (!b || !canAnimate() || b.disabled) return;
    M.animate(b, { scale: [1, 0.94, 1] }, { duration: 0.3, ease: EASE });
  }, { passive: true });

  /* ---------- theme, size, footnotes ---------- */
  function applyTheme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
    const dark = v === 'dark' || (v !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f1311' : '#f5f6f2'));
    drawPattern(false);
  }
  const themeV = store.get('theme', 'system');
  applyTheme(themeV);
  const themeSeg = makeSeg($('theme'), 'v', themeV, (v) => { store.set('theme', v); applyTheme(v); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.get('theme', 'system')));

  function setSize(n) {
    st.size = Math.min(28, Math.max(15, n));
    document.documentElement.style.setProperty('--ar-size', st.size + 'px');
    store.set('size', st.size);
    $('set-size').textContent = st.size + ' px';
    $('sz-down').disabled = $('set-sm').disabled = st.size <= 15;
    $('sz-up').disabled = $('set-lg').disabled = st.size >= 28;
  }
  function setFn(on, quiet) {
    st.fn = on; store.set('fn', on ? '1' : '0');
    document.documentElement.classList.toggle('nofn', !on);
    $('fn-toggle').setAttribute('aria-pressed', String(on));
    $('fn-toggle').title = on ? 'Footnotes shown (tap to hide)' : 'Footnotes hidden (tap to show)';
    $('fn-toggle').setAttribute('aria-label', on ? 'Hide footnotes' : 'Show footnotes');
    $('set-fn').checked = on;
    if (!quiet && st.cur) toast(on ? 'Footnotes shown' : 'Footnotes hidden');
  }
  setSize(st.size); setFn(st.fn, true);
  $('sz-down').addEventListener('click', () => setSize(st.size - 1));
  $('sz-up').addEventListener('click', () => setSize(st.size + 1));
  $('set-sm').addEventListener('click', () => setSize(st.size - 1));
  $('set-lg').addEventListener('click', () => setSize(st.size + 1));
  $('fn-toggle').addEventListener('click', () => setFn(!st.fn));
  $('set-fn').addEventListener('change', (e) => setFn(e.target.checked, true));

  /* ---------- ornament: a field of eight-pointed stars ---------- */
  function drawPattern(reveal) {
    const cv = $('pattern'); if (!cv) return;
    const r = cv.getBoundingClientRect(); if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const gold = cs.getPropertyValue('--gold').trim() || '#9a7a2c', accent = cs.getPropertyValue('--accent').trim() || '#1d5a47';
    const cell = 56, R = 18, cols = Math.ceil(r.width / cell) + 1, rows = Math.ceil(r.height / cell) + 1;
    const start = performance.now(), dur = reveal && !reduceMotion.matches ? 1400 : 0;
    cancelAnimationFrame(patternT);
    function star(cx, cy, s, rot) {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = rot + (i * Math.PI) / 8, rad = i % 2 ? s * 0.62 : s; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
      ctx.closePath();
    }
    function frame(now) {
      const t = dur ? Math.min(1, (now - start) / dur) : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const cx = x * cell + (y % 2 ? cell / 2 : 0), cy = y * cell;
        const d = (cols - x) / cols * 0.6 + (y / rows) * 0.4;
        const k = Math.max(0, Math.min(1, (t - d * 0.55) / 0.45)); if (!k) continue;
        const e = 1 - Math.pow(1 - k, 3);
        star(cx, cy, R * (0.6 + 0.4 * e), Math.PI / 8 * (1 - e));
        ctx.lineWidth = 1; ctx.strokeStyle = (x + y) % 3 === 0 ? gold : accent; ctx.globalAlpha = 0.22 * e; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (t < 1) patternT = requestAnimationFrame(frame);
    }
    patternT = requestAnimationFrame(frame);
  }
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => drawPattern(false), 120); });

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, action, fn, sticky) {
    const t = $('toast'), b = $('toast-b');
    $('toast-t').textContent = msg;
    b.hidden = !action; if (action) { b.textContent = action; b.onclick = () => { fn(); hideToast(); }; }
    const host = document.querySelector('dialog[open]') || document.body;
    if (t.parentNode !== host) { host.appendChild(t); t.hidden = true; }
    const was = !t.hidden; t.hidden = false;
    if (!was && canAnimate()) M.animate(t, { opacity: [0, 1], y: [14, 0], scale: [0.97, 1] }, { type: 'spring', stiffness: 420, damping: 30 });
    clearTimeout(toastT);
    if (!sticky) toastT = setTimeout(hideToast, action ? 9000 : 1900);
  }
  function hideToast() {
    const t = $('toast'); if (t.hidden) return;
    if (canAnimate()) M.animate(t, { opacity: 0, y: 10 }, { duration: 0.2 }).then(() => { t.hidden = true; t.style.opacity = ''; t.style.transform = 'translateX(-50%)'; });
    else t.hidden = true;
  }

  /* ---------- data ---------- */
  function prepare() {
    SECTIONS = []; BYID = new Map();
    BOOKS.forEach(({ book, items }) => items.forEach((s) => {
      s._book = book;
      s._lab = numLabel(s);
      s._matn = segText(s.matn, { noRef: true });
      s._first = (() => { const w = s._matn.split(' '); return w.slice(0, 11).join(' ') + (w.length > 11 ? ' …' : ''); })();
      s._m = norm(s._matn);
      s._en = norm([s.label, s.fasl && s.fasl.en, (s.commentaries || []).map((c) => c.cite).join(' ')].join(' '));
      s._cs = null;
      const g = [];
      (s.grading || []).forEach((l) => { if (isGrade(l) && !g.includes(l)) g.push(l); });
      s._grades = g;
      SECTIONS.push(s); BYID.set(s.id, s);
    }));
  }
  function commentText(c) {
    const parts = [];
    (c.editorial || []).forEach((p) => parts.push(segText(p)));
    (c.paras || []).forEach((p) => parts.push(segText(p)));
    (c.footnotes || []).forEach((f) => parts.push(segText(f.body)));
    (c.refs || []).forEach((p) => parts.push(segText(p)));
    return parts;
  }
  function deepIndex(s) {
    if (!s._cs) s._cs = (s.commentaries || []).map((c) => ({ key: c.key, parts: commentText(c) , n: null })).map((o) => { o.n = norm(o.parts.join(' ')); return o; });
    return s._cs;
  }

  /* ---------- list: filters and search ---------- */
  function buildChips() {
    const host = $('chips'); host.textContent = '';
    const defs = [['all', 'All', SECTIONS.length], ['saved', 'Saved', st.saved.size], ['notes', 'With notes', [...notes.keys()].filter((k) => BYID.has(k.slice(PFX.length))).length]];
    const fasls = new Map();
    const manyBabs = new Set(SECTIONS.filter((s) => s.fasl).map((s) => (s.bab ? s.bab.n : 0))).size > 1;
    SECTIONS.forEach((s) => { if (s.fasl) fasls.set(faslKey(s), (manyBabs && s.bab ? 'باب ' + arNum(s.bab.n) + ' · ' : '') + s.fasl.ar); });
    if (fasls.size > 1) fasls.forEach((f, k) => defs.push(['f:' + k, f, SECTIONS.filter((s) => s.fasl && faslKey(s) === k).length, true]));
    defs.forEach(([k, label, n, ar]) => {
      const b = el('button', 'chip' + (ar ? ' ar' : ''));
      b.type = 'button'; b.dataset.k = k; b.setAttribute('aria-pressed', String(st.filter === k));
      if (k === 'saved') b.appendChild(icon('star'));
      if (k === 'notes') b.appendChild(icon('note'));
      if (ar) b.lang = 'ar';
      b.appendChild(document.createTextNode(label));
      const c = el('span', 'n', String(n)); c.id = 'chip-n-' + k.replace(/\W/g, '_'); b.appendChild(c);
      b.addEventListener('click', () => {
        st.filter = k;
        host.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        runSearch(true);
      });
      host.appendChild(b);
    });
  }
  function refreshChipCounts() {
    const s = document.getElementById('chip-n-saved'); if (s) s.textContent = st.saved.size;
    const n = document.getElementById('chip-n-notes'); if (n) n.textContent = [...notes.keys()].filter((k) => BYID.has(k.slice(PFX.length))).length;
  }
  function inFilter(s) {
    const f = st.filter;
    if (f === 'all') return true;
    if (f === 'saved') return st.saved.has(s.id);
    if (f === 'notes') return notes.has(noteId(s.id));
    if (f.startsWith('f:')) return s.fasl && f === 'f:' + faslKey(s);
    return true;
  }
  function snippet(s, key, words) {
    const c = s.commentaries.find((x) => x.key === key); if (!c) return null;
    const parts = commentText(c);
    for (const p of parts) {
      const rs = findRanges(p, words);
      if (!rs.length) continue;
      let a = Math.max(0, rs[0][0] - 55), b = Math.min(p.length, rs[0][1] + 95);
      if (a > 0) { const sp = p.indexOf(' ', a); if (sp > -1 && sp < rs[0][0]) a = sp + 1; }
      if (b < p.length) { const sp = p.lastIndexOf(' ', b); if (sp > rs[0][1]) b = sp; }
      const ex = p.slice(a, b);
      return { text: (a > 0 ? '… ' : '') + ex + (b < p.length ? ' …' : ''), words };
    }
    return null;
  }
  function runSearch(animate) {
    const raw = q.value.trim();
    $('clear').hidden = !raw; $('kbd').hidden = !!raw || document.activeElement === q;
    const t = toLatDig(raw);
    st.num = /^\d+$/.test(t) ? t : null;
    const qn = st.num === null ? norm(raw) : '';
    const words = qn ? qn.split(' ').filter((w) => w.length > 1 || qn.length === 1) : [];
    st.qn = qn; st.words = words;
    const deep = $('deep').checked;
    const base = SECTIONS.filter(inFilter);
    let hits;
    if (!raw) hits = base.map((s) => ({ s }));
    else {
      hits = [];
      base.forEach((s, i) => {
        let score = 0, hit = null;
        if (st.num !== null) {
          const ns = s.n != null ? String(s.n) : '';
          if (ns === st.num) score = 100; else if (ns && ns.startsWith(st.num)) score = 80; else if (ns && ns.includes(st.num)) score = 60;
        } else if (qn) {
          if (s._m.includes(qn)) score = 90;
          else if (words.length > 1 && words.every((w) => s._m.includes(w))) score = 70;
          if (!score && s._en.includes(qn) && /[a-z]/.test(qn)) score = 45;
          if (deep && !score) {
            for (const c of deepIndex(s)) {
              if (c.n.includes(qn) || (words.length > 1 && words.every((w) => c.n.includes(w)))) { score = 40; hit = { key: c.key }; break; }
            }
          }
          const n = notes.get(noteId(s.id));
          if (n && norm(n.text).includes(qn) && score < 50) { score = 50; hit = { note: true }; }
        }
        if (score) hits.push({ s, score, hit, i });
      });
      hits.sort((a, b) => b.score - a.score || a.i - b.i);
      hits.forEach((h) => { if (h.hit && h.hit.key) h.hit.snip = snippet(h.s, h.hit.key, words); });
    }
    st.hits = hits;
    renderList(animate);
    const total = SECTIONS.length, n = hits.length;
    $('count').textContent = '';
    if (n === total && !raw && st.filter === 'all') { const b = el('b', '', String(total)); $('count').append(b, ' sections'); }
    else { const b = el('b', '', String(n)); $('count').append(b, ' of ' + total + ' sections'); }
  }

  let ghN = 0;
  function groupHeading(cls, ar, en) {
    const h = el(cls === 'book' ? 'h2' : 'h3', 'gh ' + cls); h.id = 'gh-' + (++ghN);
    const a = el('span', 'ar', ar); a.lang = 'ar'; a.dir = 'rtl';
    h.append(el('span', 'en', en || ''), a);
    return h;
  }
  function rowFor(h) {
    const s = h.s;
    const li = el('li', 'e'); li.dataset.id = s.id; li.id = 'row-' + s.id;
    if (st.cur === s.id) li.classList.add('cur');
    const a = el('a', 'rowlink'); a.href = '#' + s.id;
    a.setAttribute('aria-label', titleOf(s));
    const num = el('span', 'num' + (s.n == null ? ' intro' : ''), s._lab);
    const snip = el('span', 'snip'); snip.lang = 'ar'; snip.dir = 'rtl';
    if (st.words.length && s._m.includes(st.qn || '\u0000')) appendHL(snip, s._first, st.words); else snip.textContent = s._first;
    a.append(num, snip);
    const tags = el('span', 'tags');
    if (s._grades[0]) tags.appendChild(gradeChip(s._grades[0]));
    const nt = notes.has(noteId(s.id));
    if (nt) { const m = el('span', 'mk'); m.append(icon('note'), 'Note'); m.dataset.k = 'note'; tags.appendChild(m); }
    a.appendChild(tags);
    if (h.hit && h.hit.snip) {
      const d = el('span', 'hit'); d.lang = 'ar';
      appendHL(d, h.hit.snip.text, h.hit.snip.words);
      d.appendChild(el('b', '', EN_SHORT[h.hit.key]));
      a.appendChild(d);
    } else if (h.hit && h.hit.note) {
      const d = el('span', 'hit'); d.style.fontFamily = 'var(--ui)'; d.style.direction = 'ltr'; d.style.textAlign = 'left';
      d.appendChild(document.createTextNode('In your note: '));
      const tx = notes.get(noteId(s.id)).text;
      const rs = findRanges(tx, st.words), at = rs.length ? Math.max(0, rs[0][0] - 30) : 0;
      appendHL(d, tx.slice(at, at + 120), st.words);
      a.appendChild(d);
    }
    li.appendChild(a);
    const star = el('button', 'star'); star.type = 'button';
    const on = st.saved.has(s.id);
    star.setAttribute('aria-pressed', String(on)); star.setAttribute('aria-label', (on ? 'Remove from saved: ' : 'Save: ') + titleOf(s));
    star.appendChild(icon('star'));
    li.appendChild(star);
    return li;
  }
  function renderList(animate) {
    list.textContent = ''; ghN = 0;
    const grouped = !q.value.trim();
    const frag = document.createDocumentFragment();
    let lastBook = null, lastFasl = null, lastBab = null, ol = null;
    const rows = [];
    // every group is its own <section> with a real heading and its own <ol>, so the list markup stays valid
    function group(heading, label) {
      const sec = el('section', 'lg');
      if (heading) { sec.setAttribute('aria-labelledby', heading.id); sec.appendChild(heading); } else sec.setAttribute('aria-label', label);
      ol = el('ol', 'list'); sec.appendChild(ol); frag.appendChild(sec);
    }
    if (!grouped) group(null, 'Search results');
    st.hits.forEach((h) => {
      const s = h.s;
      if (grouped) {
        let fresh = !ol;
        if (s._book.id !== lastBook) { lastBook = s._book.id; lastFasl = null; lastBab = null; frag.appendChild(groupHeading('book', s._book.ar, s._book.en)); fresh = true; }
        const bk = s.bab ? s.bab.n : null;
        const fk = s.fasl ? faslKey(s) : null;
        if (bk && bk !== lastBab) {
          lastBab = bk; lastFasl = null; fresh = false;
          // An untitled bāb (printed as "باب" alone) is shown with its number.
          const untitled = s.bab.ar === 'باب';
          group(groupHeading('bab', untitled ? 'باب ' + arNum(s.bab.n) : s.bab.ar, s.bab.en || (untitled ? 'Bāb ' + s.bab.n + ' (untitled in the print)' : '')));
        }
        if (fk && fk !== lastFasl) { lastFasl = fk; group(groupHeading('fasl', s.fasl.ar, s.fasl.en)); fresh = false; }
        if (fresh) group(null, s._book.en + ': opening');
      }
      const li = rowFor(h); rows.push(li); ol.appendChild(li);
    });
    list.appendChild(frag);
    const empty = $('empty'); empty.hidden = st.hits.length > 0;
    if (!st.hits.length) renderEmpty();
    if (animate && canAnimate()) M.animate(rows.slice(0, 14), { opacity: [0, 1], y: [8, 0] }, { delay: M.stagger(0.025), duration: 0.34, ease: EASE });
  }
  function renderEmpty() {
    const acts = $('empty-actions'); acts.textContent = '';
    const raw = q.value.trim();
    $('empty-t').textContent = st.filter === 'notes' && !raw ? 'No notes yet. Open a hadeeth and write in “My notes”.'
      : st.filter === 'saved' && !raw ? 'Nothing saved yet. Tap the star on any hadeeth to keep it here.'
      : 'No hadeeth matches that. Try fewer letters, a hadeeth number, or search inside the commentaries.';
    const add = (label, fn) => { const b = el('button', 'btn', label); b.type = 'button'; b.onclick = fn; acts.appendChild(b); };
    if (raw && !$('deep').checked) add('Search inside commentaries', () => { $('deep').checked = true; runSearch(true); });
    if (st.filter !== 'all') add('Show all sections', () => { st.filter = 'all'; buildChips(); runSearch(true); });
    if (canAnimate()) M.animate($('empty'), { opacity: [0, 1], y: [6, 0] }, { duration: 0.3, ease: EASE });
  }
  let tmr;
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => runSearch(true), 120); });
  q.addEventListener('focus', () => { $('kbd').hidden = true; });
  q.addEventListener('blur', () => { $('kbd').hidden = !!q.value; });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (q.value) { q.value = ''; runSearch(true); } else q.blur(); }
    if (e.key === 'Enter') { const f = st.hits[0]; if (f && q.value.trim()) { q.blur(); go(f.s.id); } }
  });
  $('deep').addEventListener('change', () => runSearch(true));
  $('clear').addEventListener('click', () => { q.value = ''; runSearch(true); q.focus(); });

  /* ---------- stars and note marks ---------- */
  function setStar(sid, on) {
    if (on) st.saved.add(sid); else st.saved.delete(sid);
    store.set('saved', [...st.saved]);
    const s = BYID.get(sid);
    const li = document.getElementById('row-' + sid);
    if (li) { const b = li.querySelector('.star'); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', (on ? 'Remove from saved: ' : 'Save: ') + titleOf(s)); if (on && canAnimate()) M.animate(b.querySelector('svg'), { scale: [1, 1.45, 1], rotate: [0, -18, 0] }, { duration: 0.45, ease: EASE }); }
    syncStarR();
    refreshChipCounts();
    toast(on ? 'Saved to this device' : 'Removed from saved');
    if (st.filter === 'saved' && !on) runSearch(false);
  }
  function syncStarR() {
    const b = $('star-r'), on = st.cur && st.saved.has(st.cur);
    b.setAttribute('aria-pressed', String(!!on));
    b.setAttribute('aria-label', on ? 'Remove from saved' : 'Save this section');
    b.title = on ? 'Saved (tap to remove)' : 'Save this section';
  }
  list.addEventListener('click', (ev) => {
    const star = ev.target.closest('.star');
    if (star) { ev.preventDefault(); const li = star.closest('li.e'); setStar(li.dataset.id, !st.saved.has(li.dataset.id)); return; }
    const a = ev.target.closest('a.rowlink');
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
    const li = a.closest('li.e');
    if (isWide()) { ev.preventDefault(); go(li.dataset.id, true); return; }
    flipFrom = { id: li.dataset.id, num: a.querySelector('.num').getBoundingClientRect(), txt: a.querySelector('.snip').getBoundingClientRect() };
    cameFromList = true;
  });
  $('star-r').addEventListener('click', () => { if (st.cur) setStar(st.cur, !st.saved.has(st.cur)); });

  function updateNoteMarks(sid) {
    const li = document.getElementById('row-' + sid);
    if (li) {
      const tags = li.querySelector('.tags'), mk = tags.querySelector('[data-k="note"]'), has = notes.has(noteId(sid));
      if (has && !mk) { const m = el('span', 'mk'); m.append(icon('note'), 'Note'); m.dataset.k = 'note'; tags.appendChild(m); }
      if (!has && mk) mk.remove();
    }
    refreshChipCounts();
    const c = $('notes-count'); if (c) c.textContent = notesSummary();
  }
  function notesSummary() {
    const n = [...notes.keys()].filter((k) => k.startsWith(PFX)).length;
    return n ? n + (n === 1 ? ' note' : ' notes') + ' saved on this device.' : 'No notes yet.';
  }
  function when(t) {
    const d = new Date(t), now = new Date();
    return d.toDateString() === now.toDateString() ? 'today at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'on ' + d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight + 2, 72) + 'px'; }

  /* ---------- reader ---------- */
  const rd = $('rd'), main = $('reader-main');
  let flipFrom = null, cameFromList = false;

  function cite(s, c) {
    return '— Mishkāt al-Maṣābīḥ ' + (s.n != null ? s.n : isBab(s) ? '(opening of Bāb ' + s.bab.n + ', ' + s._book.en + ')' : '(opening of ' + s._book.en + ')') + (c ? ' · ' + c.cite : '');
  }
  function linkTo(s, c) { return location.href.split('#')[0] + '#' + s.id + (c ? '-' + c.key : ''); }

  function buildMatn(s) {
    const box = el('section', 'matn'); box.setAttribute('aria-label', 'Hadeeth text');
    const top = el('div', 'matn-top');
    top.appendChild(el('p', 'num-l', s.label || titleOf(s)));
    if (s._grades.length) { const g = el('div', 'matn-gr'); s._grades.forEach((l) => g.appendChild(gradeChip(l))); top.appendChild(g); }
    box.appendChild(top);
    const p = el('p', 'matn-ar'); p.lang = 'ar'; p.dir = 'rtl'; p.id = 'matn-' + s.id;
    renderRuns(p, s.matn, { words: st.words });
    box.appendChild(p);
    const nr = buildNarrators(s);
    if (nr) box.appendChild(nr);
    return box;
  }

  /* ---------- narrators: each hadeeth's isnād, with the full al-Ikmāl entry for every narrator ----------
     data/narrators.json is built by tools/build_mishkat_narrators.py from a hand-checked map and
     app/data/ikmal.json. The entry is shown here the way the Al-Ikmāl app shows it, and shares its
     English / Arabic / both choice (localStorage "ikmal-lang"). */
  let NARR = null;
  const IK_CAT = {
    s: ['Companions', 'الصحابة'], t: ['Successors', 'التابعون'], sf: ['Women Companions', 'الصحابيات'],
    tf: ['Women Successors', 'التابعيات'], a: ['Imams of the Uṣūl', 'أئمة الأصول']
  };
  const ikLang = {
    get() { try { const v = JSON.parse(localStorage.getItem('ikmal-lang')); return ['en', 'ar', 'both'].includes(v) ? v : 'en'; } catch (e) { return 'en'; } },
    set(v) { try { localStorage.setItem('ikmal-lang', JSON.stringify(v)); } catch (e) {} }
  };
  /* the reader's own note on this narrator in Al-Ikmāl (same site, so the same localStorage), shown read-only */
  function ikNote(id) {
    try { const r = JSON.parse(localStorage.getItem('ikmal-notes') || '{}')[id]; return r && r.text && r.text.trim() ? r : null; } catch (e) { return null; }
  }
  const narrChain = (s) => (NARR && NARR.hadeeth[s.id]) || [];
  const narrPerson = (key) => {
    const p = NARR.people[key];
    return { key, p, e: p && p.n != null ? NARR.ikmal[String(p.n)] : null };
  };
  const ikLab = (e) => (e.nl ? e.nl : String(e.n));

  function narrChip(s, key, i, current) {
    const { p, e } = narrPerson(key);
    const b = el('button', 'narr-chip' + (e ? ' c-' + e.c : ' none')); b.type = 'button';
    const nm = el('span', 'ar', p.as); nm.lang = 'ar'; nm.dir = 'rtl'; b.appendChild(nm);
    if (p.check) b.appendChild(el('small', '', 'check'));
    b.setAttribute('aria-label', (e ? e.full : p.as) + (e ? ', al-Ikmāl entry ' + ikLab(e) : ', not in al-Ikmāl'));
    if (current != null) b.setAttribute('aria-current', String(i === current));
    b.addEventListener('click', (ev) => { ev.preventDefault(); openNarrator(s, i); });
    return b;
  }

  function buildNarrators(s) {
    const chain = narrChain(s);
    if (!chain.length) return null;
    const wrap = el('div', 'narr');
    wrap.appendChild(el('span', 'narr-l', chain.length > 1 ? 'Narrators' : 'Narrator'));
    const row = el('div', 'narr-row'); row.setAttribute('role', 'list');
    chain.forEach((key, i) => {
      if (i) { const a = el('span', 'narr-sep', '←'); a.setAttribute('aria-hidden', 'true'); row.appendChild(a); }
      const c = narrChip(s, key, i); c.setAttribute('role', 'listitem');
      row.appendChild(c);
    });
    wrap.appendChild(row);
    return wrap;
  }

  let narrState = null;
  function openNarrator(s, i) {
    const d = $('dlg-narr');
    narrState = { s, i };
    renderNarrator();
    if (!d.open) openDialog(d);
    const x = d.querySelector('.ik-x'); if (x) x.focus();
  }

  function renderNarrator() {
    const { s, i } = narrState;
    const chain = narrChain(s), { p, e } = narrPerson(chain[i]);
    const f = $('ik'); f.textContent = '';
    const close = () => $('dlg-narr').close();

    const top = el('div', 'ik-top');
    top.appendChild(el('span', 'ik-ctx', (chain.length > 1 ? 'Narrator ' + (i + 1) + ' of ' + chain.length + ' · ' : '') +
      (s.n != null ? 'Hadeeth ' + s.n : titleOf(s)) + ' · from al-Ikmāl'));
    const x = el('button', 'ik-x'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
    x.appendChild(el('span', '', '✕')); x.addEventListener('click', close);
    top.appendChild(x);
    f.appendChild(top);

    if (chain.length > 1) {
      const ch = el('div', 'ik-chain'); ch.setAttribute('aria-label', 'Narrators of this hadeeth');
      chain.forEach((key, k) => {
        if (k) { const a = el('span', 'narr-sep', '←'); a.setAttribute('aria-hidden', 'true'); ch.appendChild(a); }
        ch.appendChild(narrChip(s, key, k, i));
      });
      f.appendChild(ch);
    }

    const head = el('div', 'ik-head');
    const num = el('span', 'ik-num');
    if (e) { num.appendChild(document.createTextNode(ikLab(e))); num.appendChild(el('small', '', 'p. ' + e.p)); }
    head.appendChild(num);
    const names = el('div', 'ik-names');
    const h = el('h2', 'ik-name', e ? e.ar : p.as); h.id = 'ik-name'; h.lang = 'ar'; h.dir = 'rtl';
    names.appendChild(h);
    if (e) {
      const full = el('span', 'ik-full', e.full); full.lang = 'ar'; full.dir = 'rtl'; names.appendChild(full);
      const tags = el('span', 'ik-tags'), c = IK_CAT[e.c] || ['', ''];
      tags.appendChild(el('span', 'ik-cat ' + e.c, c[0]));
      const ax = el('span', 'arx', c[1]); ax.lang = 'ar'; tags.appendChild(ax);
      if (e.l) { const lx = el('span', 'arx', 'حرف ' + e.l); lx.lang = 'ar'; tags.appendChild(lx); }
      names.appendChild(tags);
    }
    head.appendChild(names);
    f.appendChild(head);

    const body = el('div', 'ik-body');
    if (p.check) body.appendChild(el('p', 'ik-note warn', 'Check this one: the link to al-Ikmāl is uncertain. ' + (p.note || '')));
    else if (p.note) body.appendChild(el('p', 'ik-note', p.note));
    if (e) {
      const lang = el('div', 'seg ik-lang'); lang.setAttribute('role', 'group'); lang.setAttribute('aria-label', 'Language of the biography');
      const th = el('span', 'thumb'); th.setAttribute('aria-hidden', 'true'); lang.appendChild(th);
      [['en', 'English'], ['ar', 'العربية'], ['both', 'Both']].forEach(([v, t]) => {
        const b = el('button'); b.type = 'button'; b.dataset.v = v;
        if (v === 'ar') { const a = el('span', 'ar', t); a.lang = 'ar'; b.appendChild(a); } else b.textContent = t;
        lang.appendChild(b);
      });
      body.appendChild(lang);
      const text = el('div', 'ik-text'); text.style.display = 'grid'; text.style.gap = '14px';
      const fill = (v) => {
        text.textContent = '';
        const ar = el('p', 'ik-ar', e.art); ar.lang = 'ar'; ar.dir = 'rtl';
        const en = el('p', 'ik-en', e.en);
        if (v === 'ar') text.appendChild(ar);
        else if (v === 'both') { text.appendChild(ar); const sp = el('div', 'ik-sep'); sp.setAttribute('aria-hidden', 'true'); text.appendChild(sp); text.appendChild(en); }
        else text.appendChild(en);
      };
      fill(ikLang.get());
      body.appendChild(text);
      requestAnimationFrame(() => makeSeg(lang, 'v', ikLang.get(), (v) => { ikLang.set(v); fill(v); }));
      const mine = ikNote(e.id);
      if (mine) {
        const m = el('div', 'ik-mine');
        m.appendChild(el('span', 'lbl', 'Your note in al-Ikmāl'));
        const t = el('p', '', mine.text); t.dir = 'auto'; m.appendChild(t);
        body.appendChild(m);
      }
    } else {
      body.appendChild(el('p', 'ik-en', p.key === 'unnamed_sahabi'
        ? 'The narrator is not named in the hadeeth, so there is no entry for him in al-Ikmāl.'
        : 'This narrator is named in the isnād but has no entry of his or her own in al-Ikmāl.'));
    }
    f.appendChild(body);

    const foot = el('div', 'ik-foot');
    if (e) {
      const ref = el('span', 'ref', 'al-Ikmāl entry ' + ikLab(e) + ' · ' + (IK_CAT[e.c] || [''])[0] + ' · printed page ' + e.p + ' / ');
      const pa = el('span', '', 'ص ' + arNum(e.p)); pa.lang = 'ar'; ref.appendChild(pa);
      foot.appendChild(ref);
      const cp = el('button', 'btn small'); cp.type = 'button'; cp.appendChild(icon('copy')); cp.appendChild(el('span', '', 'Copy'));
      cp.addEventListener('click', () => {
        const v = ikLang.get(), t = v === 'ar' ? e.art : v === 'both' ? e.art + '\n\n' + e.en : e.en;
        copyText(ikLab(e) + ' – ' + e.ar + '\n\n' + t + '\n\n— al-Ikmāl fī Asmāʾ al-Rijāl, entry ' + ikLab(e) + ', p. ' + e.p, 'Copied');
      });
      foot.appendChild(cp);
    } else foot.appendChild(el('span', 'ref', 'Not in al-Ikmāl'));
    if (chain.length > 1) {
      const pv = el('button', 'btn small', 'Previous'); pv.type = 'button'; pv.disabled = i === 0;
      pv.addEventListener('click', () => { narrState.i = i - 1; renderNarrator(); });
      const nx = el('button', 'btn small', 'Next'); nx.type = 'button'; nx.disabled = i === chain.length - 1;
      nx.addEventListener('click', () => { narrState.i = i + 1; renderNarrator(); });
      foot.append(pv, nx);
    }
    f.appendChild(foot);
    $('dlg-narr').scrollTop = 0;
  }
  function buildCm(s, c) {
    const cm = el('article', 'cm'); cm.id = s.id + '-' + c.key; cm.dataset.key = c.key;
    cm.dataset.open = String(!st.collapsed.has(c.key));
    const head = el('div', 'cm-h');
    const t = el('button', 'cm-t'); t.type = 'button';
    t.setAttribute('aria-expanded', String(!st.collapsed.has(c.key))); t.setAttribute('aria-controls', cm.id + '-body');
    const h = el('h2'); const ar = el('span', 'cm-src', c.src); ar.lang = 'ar'; ar.dir = 'rtl';
    h.append(ar, el('span', 'cm-cite', c.cite)); t.append(h, icon('chev'));
    head.appendChild(t);
    const act = el('div', 'cm-act');
    const cp = el('button', 'icon-btn'); cp.type = 'button'; cp.dataset.act = 'copy'; cp.setAttribute('aria-label', 'Copy ' + EN_SHORT[c.key] + ' with citation'); cp.title = 'Copy with citation'; cp.appendChild(icon('copy'));
    act.appendChild(cp);
    if (navigator.share) { const sh = el('button', 'icon-btn'); sh.type = 'button'; sh.dataset.act = 'share'; sh.setAttribute('aria-label', 'Share ' + EN_SHORT[c.key]); sh.title = 'Share'; sh.appendChild(icon('share')); act.appendChild(sh); }
    head.appendChild(act);
    cm.appendChild(head);
    const body = el('div', 'cm-body'); body.id = cm.id + '-body';
    const inner = el('div', 'cm-in');
    (c.editorial || []).forEach((p) => { const e = el('p', 'cm-ed'); renderRuns(e, p); inner.appendChild(e); });
    const centered = new Set(c.centered || []);
    (c.paras || []).forEach((p, i) => {
      const e = el('p', 'cm-p' + (centered.has(i) ? ' center' : '')); e.lang = 'ar'; e.dir = 'rtl';
      renderRuns(e, p, { words: st.words }); inner.appendChild(e);
    });
    if ((c.footnotes || []).length) {
      const aside = el('aside', 'notes'); aside.dir = 'rtl'; aside.setAttribute('aria-label', 'Footnotes: ' + EN_SHORT[c.key]);
      const ol = el('ol');
      c.footnotes.forEach((f) => {
        const li = el('li'); li.id = f.id; li.lang = 'ar';
        renderRuns(li, f.body, { words: st.words });
        const back = el('a', 'fnback', ' رجوع'); back.href = '#r-' + f.id; back.setAttribute('aria-label', 'Back to the text'); back.title = 'Back to the text';
        li.appendChild(back); ol.appendChild(li);
      });
      aside.appendChild(ol); inner.appendChild(aside);
    }
    const refs = c.refs || [];
    if (refs.length || c.grading) {
      const rb = el('div', 'cm-refs');
      refs.forEach((r) => {
        const txt = segText(r);
        const isG = c.grading && txt === c.grading.replace(/\s+/g, ' ').trim();
        const p = el('p', 'cm-ref' + (isG ? ' grade ' + gradeType(gradeShort(txt)).replace('weak', '').replace('neutral', '') : '')); p.lang = 'ar'; p.dir = 'rtl';
        renderRuns(p, r); rb.appendChild(p);
      });
      if (c.grading && !refs.some((r) => segText(r) === c.grading.replace(/\s+/g, ' ').trim())) {
        const p = el('p', 'cm-ref grade', c.grading); p.lang = 'ar'; p.dir = 'rtl'; rb.appendChild(p);
      }
      inner.appendChild(rb);
    }
    body.appendChild(inner); cm.appendChild(body);
    return cm;
  }
  function buildNotes(s) {
    const box = el('section', 'mynotes'); box.id = 'mynotes';
    const lab = el('label', 'mynotes-h'); lab.htmlFor = 'note-' + s.id; lab.append(icon('note'), el('span', '', 'My notes'));
    const t = el('textarea', 'note'); t.id = 'note-' + s.id; t.rows = 2; t.dir = 'auto'; t.maxLength = NOTE_MAX;
    t.placeholder = 'Write your own notes on this ' + (s.n != null ? 'hadeeth' : 'section') + '. They stay on this device, even offline.';
    const n = notes.get(noteId(s.id)); t.value = n ? n.text : '';
    const stt = el('span', 'note-st'); stt.setAttribute('aria-live', 'polite');
    if (n) stt.textContent = 'Saved ' + when(n.updated);
    const ct = el('span', 'note-ct'); ct.setAttribute('aria-live', 'off');
    const upd = () => { const n = t.value.length; ct.hidden = n < NOTE_MAX - 5000; ct.textContent = n.toLocaleString('en') + ' / ' + NOTE_MAX.toLocaleString('en'); ct.classList.toggle('near', n >= NOTE_MAX - 500); };
    upd(); t.addEventListener('input', upd);
    box.append(lab, t, stt, ct);
    requestAnimationFrame(() => autosize(t));
    t.addEventListener('input', () => {
      autosize(t); stt.textContent = 'Saving…'; stt.classList.remove('err');
      clearTimeout(pending.get(s.id)); pending.set(s.id, setTimeout(() => flushNote(t), 500));
    });
    t.addEventListener('blur', () => flushNote(t));
    return box;
  }
  const NOTE_MAX = 45000;
  const pending = new Map();
  function flushNote(t) {
    const sid = t.id.slice(5);
    clearTimeout(pending.get(sid)); pending.delete(sid);
    const cur = notes.get(noteId(sid));
    if ((cur ? cur.text : '') === t.value.replace(/\s+$/, '')) return;
    const stt = t.parentNode.querySelector('.note-st');
    saveNote(sid, t.value).then((ok) => {
      if (!stt) return;
      stt.textContent = ok ? (t.value.trim() ? 'Saved ' + when(Date.now()) : 'Note deleted') : 'Could not save. Storage may be full or blocked.';
      stt.classList.toggle('err', !ok);
      if (ok && canAnimate()) M.animate(stt, { opacity: [0.3, 1] }, { duration: 0.3 });
    });
  }
  function flushAll() { document.querySelectorAll('textarea.note').forEach(flushNote); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
  window.addEventListener('pagehide', flushAll);

  function neighbours(s) {
    const i = SECTIONS.indexOf(s);
    return { prev: SECTIONS[i - 1] || null, next: SECTIONS[i + 1] || null };
  }
  function buildPN(s) {
    const { prev, next } = neighbours(s);
    const nav = el('nav', 'pn'); nav.setAttribute('aria-label', 'Previous and next');
    const mk = (t, dir, cls) => {
      const a = el('a', cls);
      if (t) { a.href = '#' + t.id; a.append(el('small', '', dir === 'p' ? 'Previous' : 'Next'), el('b', '', titleOf(t))); a.dataset.go = t.id; }
      else { a.setAttribute('aria-disabled', 'true'); a.tabIndex = -1; a.setAttribute('aria-hidden', 'true'); }
      return a;
    };
    nav.append(mk(prev, 'p', 'p'), mk(next, 'n', 'n'));
    return nav;
  }

  function renderReader(s) {
    flushAll();
    main.textContent = '';
    const frag = document.createDocumentFragment();
    frag.appendChild(buildMatn(s));
    // tabs (One mode)
    const tw = el('div', 'tabs-wrap');
    const tl = el('div', 'seg tabs'); tl.id = 'tabs'; tl.setAttribute('role', 'tablist'); tl.setAttribute('aria-label', 'Commentary');
    tl.appendChild(el('span', 'thumb')); tl.lastChild.setAttribute('aria-hidden', 'true');
    s.commentaries.forEach((c) => {
      const b = el('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.v = c.key; b.id = 'tab-' + c.key;
      b.setAttribute('aria-controls', s.id + '-' + c.key); b.setAttribute('aria-selected', 'false');
      const ar = el('span', 'ar', AR_SHORT[c.key]); ar.lang = 'ar'; ar.dir = 'rtl';
      b.append(ar, el('small', '', EN_SHORT[c.key]));
      tl.appendChild(b);
    });
    tw.appendChild(tl); frag.appendChild(tw);
    const stack = el('div', 'stack'); stack.id = 'stack';
    s.commentaries.forEach((c) => stack.appendChild(buildCm(s, c)));
    frag.appendChild(stack);
    frag.appendChild(buildNotes(s));
    frag.appendChild(buildPN(s));
    main.appendChild(frag);
    st.tabSeg = makeSeg(tl, 'v', st.tab, (v) => { st.tab = v; store.set('tab', v); applyMode(); const cm = document.getElementById(s.id + '-' + v); if (cm && canAnimate()) M.animate(cm, { opacity: [0, 1], y: [8, 0] }, { duration: 0.3, ease: EASE }); }, 'aria-selected');
    tl.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const bs = [...tl.querySelectorAll('button')], i = bs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      bs[j].focus(); bs[j].click();
    });
    applyMode();
    // header
    $('rt-num').textContent = titleOf(s);
    const sub = $('rt-sub'); sub.textContent = '';
    if (s.fasl) { sub.className = 'ar'; sub.lang = 'ar'; sub.dir = 'rtl'; sub.textContent = s.fasl.ar; sub.style.textAlign = 'left'; }
    else { sub.className = ''; sub.removeAttribute('lang'); sub.dir = 'ltr'; sub.textContent = s._book.en; }
    const { prev, next } = neighbours(s);
    $('prev').disabled = !prev; $('next').disabled = !next;
    document.title = titleOf(s) + ' · Mishkāt';
  }

  /* mode: one / stacked / side-by-side */
  function effectiveMode() { return st.mode === 'side' && !st.sideOK ? 'stack' : st.mode; }
  function applyMode() {
    const m = effectiveMode();
    rd.dataset.mode = m;
    const w = $('reader').clientWidth;
    rd.style.setProperty('--cols', w >= 1200 ? 3 : 2);
    rd.style.setProperty('--span3', w >= 1200 ? 'auto' : '1 / -1');
    const tw = main.querySelector('.tabs-wrap'); if (tw) tw.hidden = m !== 'one';
    main.querySelectorAll('.cm').forEach((cm) => {
      const key = cm.dataset.key, body = cm.querySelector('.cm-body');
      const open = m === 'stack' ? !st.collapsed.has(key) : true;
      cm.hidden = m === 'one' && key !== st.tab;
      if (m === 'one') { cm.setAttribute('role', 'tabpanel'); cm.setAttribute('aria-labelledby', 'tab-' + key); }
      else { cm.removeAttribute('role'); cm.removeAttribute('aria-labelledby'); }
      cm.dataset.open = String(open); body.hidden = !open; body.style.height = '';
      cm.querySelector('.cm-t').setAttribute('aria-expanded', String(open));
      cm.querySelector('.cm-t').disabled = false;
    });
    const tabs = main.querySelector('#tabs');
    if (tabs) { main.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === st.tab))); if (st.tabSeg) st.tabSeg.set(st.tab, false); }
    modeSeg.set(st.mode, false);
  }
  const modeSeg = makeSeg($('mode'), 'v', st.mode, (v) => {
    st.mode = v; store.set('mode', v);
    applyMode();
    if (canAnimate()) M.animate(main.querySelectorAll('.cm:not([hidden])'), { opacity: [0.2, 1], y: [10, 0] }, { delay: M.stagger(0.05), duration: 0.35, ease: EASE });
  });
  let lastSideW = -1;
  function measureSide() {
    const w = $('reader').clientWidth;
    if (w === lastSideW) return;
    const wasCols = lastSideW >= 1200, hadOK = st.sideOK;
    lastSideW = w;
    const ok = w >= 900;
    st.sideOK = ok;
    $('mode-side').hidden = !ok;
    if (ok !== hadOK || (w >= 1200) !== wasCols) { if (st.cur) applyMode(); }
    modeSeg.place(false);
  }
  if ('ResizeObserver' in window) new ResizeObserver(() => measureSide()).observe($('reader'));

  function setOpen(cm, open, animate) {
    const key = cm.dataset.key, body = cm.querySelector('.cm-body'), inner = cm.querySelector('.cm-in');
    if (open) st.collapsed.delete(key); else st.collapsed.add(key);
    cm.dataset.open = String(open); cm.querySelector('.cm-t').setAttribute('aria-expanded', String(open));
    if (open) {
      body.hidden = false;
      if (animate && canAnimate()) {
        const h = inner.offsetHeight; body.style.height = '0px'; body.style.willChange = 'height';
        M.animate(body, { height: [0, h] }, { duration: Math.min(0.55, 0.28 + h / 4000), ease: EASE }).then(() => { body.style.height = 'auto'; body.style.willChange = ''; });
        M.animate(inner, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.35, delay: 0.05, ease: EASE });
      } else body.style.height = 'auto';
    } else if (animate && canAnimate()) {
      const h = body.offsetHeight; body.style.willChange = 'height';
      M.animate(body, { height: [h, 0] }, { duration: 0.28, ease: EASE }).then(() => { body.style.willChange = ''; if (cm.dataset.open === 'false') body.hidden = true; });
    } else body.hidden = true;
  }

  function pulse(node) {
    node.classList.remove('pulse'); void node.offsetWidth; node.classList.add('pulse');
    setTimeout(() => node.classList.remove('pulse'), 1600);
  }
  function scrollTo(node, block) { node.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: block || 'start' }); }

  /* clicks inside the reader: collapse, copy/share, footnote jumps, prev/next */
  main.addEventListener('click', (ev) => {
    const t = ev.target;
    const act = t.closest('[data-act]');
    if (act) {
      const cm = act.closest('.cm'), s = BYID.get(st.cur), c = s.commentaries.find((x) => x.key === cm.dataset.key);
      const text = c.paras.map((p) => segText(p)).join('\n\n') + '\n\n' + cite(s, c) + '\n' + linkTo(s, c);
      if (act.dataset.act === 'share') shareText(EN_SHORT[c.key] + ' · ' + titleOf(s), text); else copyText(text, 'Copied with citation');
      return;
    }
    const tog = t.closest('.cm-t');
    if (tog) { if (rd.dataset.mode === 'stack') { const cm = tog.closest('.cm'); setOpen(cm, cm.dataset.open === 'false', true); } return; }
    const a = t.closest('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (a.dataset.go) { ev.preventDefault(); go(a.dataset.go, true); return; }
    if (/^(r-)?n-/.test(id)) { ev.preventDefault(); jumpToNote(id); }
  });
  function jumpToNote(id) {
    const node = document.getElementById(id); if (!node) return;
    const cm = node.closest('.cm');
    if (!st.fn) setFn(true, true);
    if (cm) {
      if (rd.dataset.mode === 'one' && cm.hidden) { st.tab = cm.dataset.key; store.set('tab', st.tab); applyMode(); }
      if (cm.dataset.open === 'false') setOpen(cm, true, false);
    }
    if (!node.matches('a')) node.tabIndex = -1;
    scrollTo(node, 'center'); pulse(node);
    node.focus({ preventScroll: true });
  }

  /* copy / share */
  async function copyText(text, msg) {
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) {}
    if (!ok) {
      const ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
    }
    toast(ok ? msg : 'Could not copy. Select the text and copy it by hand.');
  }
  function shareText(title, text) {
    if (navigator.share) navigator.share({ title, text }).catch(() => {});
    else copyText(text, 'Copied with citation');
  }
  function sectionText(s) {
    const lines = [segText(s.matn)];
    if (s._grades.length) lines.push(s._grades.map(gradeShort).join(' · '));
    return lines.join('\n') + '\n\n' + cite(s) + '\n' + linkTo(s);
  }
  $('share-r').addEventListener('click', () => {
    const s = BYID.get(st.cur); if (!s) return;
    if (navigator.share && !/^file:/.test(location.protocol)) shareText(titleOf(s), sectionText(s)); else copyText(sectionText(s), 'Copied with citation');
  });

  /* ---------- routing ---------- */
  /* '#intro' (the old id) stays a deep link to the first book's opening section; any other id is used as is. */
  function resolveId(x) {
    if (BYID.has(x)) return x;
    if (x === 'intro') { const i = SECTIONS.find((v) => v.kind === 'intro'); return i ? i.id : null; }
    return null;
  }
  function parseHash() {
    let h = location.hash.slice(1);
    try { h = decodeURIComponent(h); } catch (e) {}
    if (!h) return null;
    let id = resolveId(h);
    if (id) return { sid: id };
    let m = h.match(/^(.+)-(mirqat|tibi|lamaat)$/);
    if (m && (id = resolveId(m[1]))) return { sid: id, key: m[2] };
    m = h.match(/^(r-)?n-(.+)-([MTL])-(\d+)$/);
    if (m && (id = resolveId(m[2]))) return { sid: id, key: { M: 'mirqat', T: 'tibi', L: 'lamaat' }[m[3]], fn: (m[1] || '') + 'n-' + id + '-' + m[3] + '-' + m[4] };
    return null;
  }
  function go(hash, replace) {
    const target = '#' + hash;
    if (replace || location.hash === target) {
      if (location.hash !== target) { try { history.replaceState(null, '', hash ? target : location.pathname + location.search); } catch (e) {} }
      route();
    } else location.hash = hash;
  }
  let homeScroll = 0, lastView = 'home';
  function setView(v) {
    const app = $('app');
    if (v === 'read' && lastView === 'home' && !isWide()) homeScroll = window.scrollY;
    app.dataset.view = v;
    $('skip').href = v === 'read' || isWide() ? '#reader-main' : '#q';
    if (v === 'home' && lastView === 'read' && !isWide()) window.scrollTo(0, homeScroll);
    lastView = v;
  }
  function markCurrent() {
    document.querySelectorAll('li.e.cur').forEach((x) => x.classList.remove('cur'));
    const li = st.cur && document.getElementById('row-' + st.cur);
    if (li) { li.classList.add('cur'); if (isWide()) li.scrollIntoView({ block: 'nearest' }); }
  }
  function route() {
    if (!SECTIONS.length) return;
    const p = parseHash();
    if (!p) {
      if (isWide()) { try { history.replaceState(null, '', '#' + SECTIONS[0].id); } catch (e) {} openSection({ sid: SECTIONS[0].id }); return; }
      const prevCur = st.cur, wasRead = lastView === 'read';
      st.cur = null; setView('home'); markCurrent(); document.title = 'Mishkāt Commentary Reader';
      if (wasRead && prevCur) { const a = document.querySelector('#row-' + CSS.escape(prevCur) + ' a'); if (a) a.focus({ preventScroll: true }); }
      return;
    }
    openSection(p);
  }
  function openSection(p) {
    const s = BYID.get(p.sid);
    const changed = st.cur !== s.id || !main.firstChild || main.firstChild.className === 'welcome';
    const wasHome = lastView === 'home';
    st.cur = s.id;
    if (changed) renderReader(s);
    syncStarR();
    setView('read');
    measureSide();
    if (p.key) {
      st.tab = p.key; store.set('tab', p.key); applyMode();
      if (rd.dataset.mode === 'stack') { const cm = document.getElementById(s.id + '-' + p.key); if (cm && cm.dataset.open === 'false') setOpen(cm, true, false); }
    }
    markCurrent();
    const fresh = changed;
    if (fresh) {
      if (!isWide()) main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      animateIn(s, wasHome);
    }
    if (p.fn || p.key) {
      setTimeout(() => {
        if (p.fn) jumpToNote(p.fn); else { const cm = document.getElementById(s.id + '-' + p.key); if (cm) { scrollTo(cm); pulse(cm.querySelector('.cm-t')); } }
      }, fresh && canAnimate() ? 380 : 30);
    } else if (fresh && st.words.length && !st.num) {
      setTimeout(() => { const mk = main.querySelector('mark'); if (mk) mk.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' }); }, 420);
    }
    flipFrom = null;
  }
  function animateIn(s, fromList) {
    if (!canAnimate()) return;
    const f = flipFrom && flipFrom.id === s.id && fromList && !isWide() ? flipFrom : null;
    const parts = [...main.querySelectorAll(':scope > section.matn ~ *')];
    const matnBox = main.querySelector('.matn');
    if (f) {
      const num = $('rt-num').getBoundingClientRect(), txt = main.querySelector('.matn-ar').getBoundingClientRect();
      const nEl = $('rt-num'), tEl = main.querySelector('.matn-ar');
      nEl.style.transformOrigin = 'left center'; tEl.style.transformOrigin = 'right top';
      M.animate(nEl, { x: [f.num.left - num.left, 0], y: [f.num.top - num.top, 0], scale: [0.85, 1] }, { type: 'spring', stiffness: 300, damping: 30 });
      const tx = f.txt.right - txt.right, ty = f.txt.top - txt.top;
      M.animate(tEl, { x: [tx, 0], y: [ty, 0], scale: [0.86, 1], opacity: [0.5, 1] }, { type: 'spring', stiffness: 260, damping: 30 });
      M.animate(matnBox, { opacity: [0.4, 1] }, { duration: 0.35 });
      M.animate(parts, { opacity: [0, 1], y: [14, 0] }, { delay: M.stagger(0.06, { startDelay: 0.12 }), duration: 0.4, ease: EASE });
    } else {
      M.animate([matnBox, ...parts], { opacity: [0, 1], y: [10, 0] }, { delay: M.stagger(0.05), duration: 0.35, ease: EASE });
    }
  }
  window.addEventListener('hashchange', route);
  wideMQ.addEventListener('change', () => { route(); drawPattern(false); });

  function back() {
    if (cameFromList && history.length > 1) { cameFromList = false; history.back(); }
    else { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} route(); }
  }
  $('back').addEventListener('click', back);
  function step(d) {
    const s = BYID.get(st.cur); if (!s) return;
    const n = SECTIONS[SECTIONS.indexOf(s) + d]; if (n) go(n.id, true);
  }
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('sbtoggle').addEventListener('click', () => {
    const hide = !document.body.classList.contains('nosb');
    document.body.classList.toggle('nosb', hide); store.set('sb', hide ? '0' : '1');
    $('sbtoggle').setAttribute('aria-pressed', String(hide)); $('sbtoggle').setAttribute('aria-label', hide ? 'Show the list' : 'Hide the list');
  });
  if (store.get('sb', '1') === '0') { document.body.classList.add('nosb'); $('sbtoggle').setAttribute('aria-pressed', 'true'); $('sbtoggle').setAttribute('aria-label', 'Show the list'); }

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === '/') {
      e.preventDefault();
      if (!isWide() && lastView === 'read') { back(); setTimeout(() => { q.focus(); q.select(); }, 60); } else { q.focus(); q.select(); }
    } else if (e.key === 'n' && st.cur) step(1);
    else if (e.key === 'p' && st.cur) step(-1);
  });

  /* ---------- reading progress + scroll furniture ---------- */
  const prog = $('prog'), topBtn = $('top'), deck = $('deck');
  let ticking = false, topShown = false;
  let padTop = 0;
  const readPad = () => { padTop = parseFloat(getComputedStyle(document.documentElement).paddingTop) || 0; };
  readPad();
  window.addEventListener('resize', readPad, { passive: true });
  function update() {
    ticking = false;
    // reads
    const reading = $('app').dataset.view === 'read' || isWide();
    const r = reading ? rd.getBoundingClientRect() : null;
    const ih = window.innerHeight, y = window.scrollY;
    const deckTop = deck.getBoundingClientRect().top, sideTop = $('side').scrollTop, wide = isWide();
    // writes
    if (r) {
      const total = r.height - ih;
      const p = total > 0 ? Math.max(0, Math.min(1, -r.top / total)) : 0;
      prog.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }
    const show = y > 900;
    if (show !== topShown) {
      topShown = show;
      if (show) { topBtn.hidden = false; if (canAnimate()) M.animate(topBtn, { opacity: [0, 1], scale: [0.8, 1] }, { type: 'spring', stiffness: 500, damping: 30 }); }
      else if (canAnimate()) M.animate(topBtn, { opacity: 0, scale: 0.8 }, { duration: 0.15 }).then(() => { if (!topShown) topBtn.hidden = true; });
      else topBtn.hidden = true;
    }
    deck.classList.toggle('stuck', deckTop <= padTop + 1 && (wide ? sideTop > 0 : y > 0));
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  $('side').addEventListener('scroll', onScroll, { passive: true });
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }));

  /* ---------- dialogs ---------- */
  function openDialog(d) {
    if (typeof d.showModal !== 'function') return;
    d.showModal();
    themeSeg.place(false);
    if (canAnimate()) M.animate(d, { opacity: [0, 1], y: [16, 0], scale: [0.98, 1] }, { type: 'spring', stiffness: 380, damping: 32 });
  }
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  $('settings').addEventListener('click', () => openDialog($('dlg-settings')));

  function buildJump() {
    const g = $('jump-grid'); g.textContent = '';
    let lastF = null;
    SECTIONS.forEach((s) => {
      const fk = s.fasl ? faslKey(s) : null;
      if (s.n != null && fk !== lastF) { lastF = fk; if (fk) { const l = el('div', 'lbl', (s.bab ? 'Bāb ' + s.bab.n + ' · ' : '') + s.fasl.en); l.style.gridColumn = '1/-1'; l.style.marginTop = '6px'; g.appendChild(l); } }
      if (s.n == null) lastF = null;
      const a = el('a', s.n == null ? 'wide' : '', s.n == null ? (isBab(s) ? 'Opening of Bāb ' + s.bab.n : 'Opening of ' + s._book.en) : String(s.n));
      a.href = '#' + s.id; a.dataset.id = s.id; a.title = titleOf(s);
      g.appendChild(a);
    });
  }
  function openJump() {
    $('jump-grid').querySelectorAll('a').forEach((a) => { if (a.dataset.id === st.cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    openDialog($('dlg-jump'));
    const c = $('jump-grid').querySelector('[aria-current]'); if (c) c.focus();
  }
  $('jump-home').addEventListener('click', openJump);
  $('jump-r').addEventListener('click', openJump);
  $('jump-grid').addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault(); $('dlg-jump').close();
    if (!isWide()) cameFromList = lastView === 'home' ? true : cameFromList;
    go(a.dataset.id, isWide() || lastView === 'read');
  });

  /* ---------- synced line and "what's new" ---------- */
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; } }
  function buildMetaUI() {
    const src = META.source || {};
    const line = $('syncline'); line.textContent = '';
    line.appendChild(el('span', '', 'Synced from artifact · rev ' + META.rev + ' · ' + (src.version || '') + ' · ' + fmtDate(META.syncedAt)));
    const b = el('button', 'linkbtn', "What's new"); b.type = 'button';
    if (store.get('seenRev', null) !== null && store.get('seenRev', 0) < META.rev) b.appendChild(el('span', 'dot'));
    if (store.get('seenRev', null) === null) store.set('seenRev', META.rev);
    b.addEventListener('click', openWN); line.appendChild(b);
    $('content-info').textContent = 'Synced from artifact · rev ' + META.rev + ' · ' + (src.version || '') + ' · ' + fmtDate(META.syncedAt) + '.';
    $('open-wn').onclick = () => { $('dlg-settings').close(); openWN(); };
    const f = $('facts'); f.textContent = '';
    const li = (b, t) => { const x = el('li'); x.append(el('b', '', b), t); f.appendChild(x); };
    li(String(SECTIONS.length), ' sections');
    const nums = SECTIONS.filter((s) => s.n != null).map((s) => s.n);
    if (nums.length) li(Math.min(...nums) + '–' + Math.max(...nums), ' hadeeth');
    li('3', ' commentaries');
    const ab = $('about-p'); ab.hidden = BOOKS.some(({ book }) => book.footer && book.footer.length) || !!(META.footer && META.footer.length); ab.parentNode.querySelectorAll('.foot-dyn').forEach((n) => n.remove());
    BOOKS.forEach(({ book }) => {
      if (book.footer && book.footer.length) { const p = el('p', 'foot-dyn'); renderRuns(p, book.footer); ab.after(p); }
    });
    if (!BOOKS.some(({ book }) => book.footer && book.footer.length) && META.footer && META.footer.length) { const p = el('p', 'foot-dyn'); renderRuns(p, META.footer); ab.after(p); }
  }
  const lab = (id) => { const s = BYID.get(id); return s ? (s.n != null ? String(s.n) : 'Opening') : id; };
  function openWN() {
    store.set('seenRev', META.rev);
    const dot = $('syncline').querySelector('.dot'); if (dot) dot.remove();
    const host = $('wn-body'); host.textContent = '';
    const c = (META.changelog || [])[0];
    if (!c) host.appendChild(el('p', '', 'No changes recorded yet.'));
    else {
      host.appendChild(el('p', '', 'Rev ' + c.rev + ' · ' + fmtDate(c.at) + ' · ' + (c.version || '') + (c.book ? ' · ' + c.book : '')));
      const grp = (title, ids, extra) => {
        if (!ids.length) return;
        const g = el('div', 'grp'); g.appendChild(el('span', 'lbl', title + ' (' + ids.length + ')'));
        const l = el('div', 'wn-list');
        ids.forEach((id) => {
          const hid = typeof id === 'string' ? id : id.id;
          const n = BYID.has(hid) ? el('a', '', lab(hid)) : el('span', '', lab(hid));
          if (BYID.has(hid)) { n.href = '#' + hid; n.dataset.id = hid; }
          if (typeof id !== 'string' && id.what) n.title = id.what.join(', ');
          l.appendChild(n);
        });
        g.appendChild(l); host.appendChild(g);
        if (extra) g.appendChild(el('p', '', extra));
      };
      grp('Added', c.added || []); grp('Removed', c.removed || []); grp('Changed', c.changed || []);
      if (c.footer) host.appendChild(el('p', '', 'The closing note changed.'));
      if (!(c.added || []).length && !(c.removed || []).length && !(c.changed || []).length && !c.footer) host.appendChild(el('p', '', 'No changes in this sync.'));
    }
    openDialog($('dlg-wn'));
  }
  $('wn-body').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-id]'); if (!a) return;
    e.preventDefault(); $('dlg-wn').close();
    if (!isWide() && lastView === 'home') cameFromList = true;
    go(a.dataset.id, isWide() || lastView === 'read');
  });

  /* ---------- offline: service worker, status, install ---------- */
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const status = $('status'), statusT = $('status-text'), live = $('status-live');
  const singleFile = !!$('data-meta').textContent.trim();
  // The single-file build never registers a service worker, even when it is served over http(s).
  const canSW = !singleFile && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.isSecureContext;
  const ss = { ready: false, error: false, progress: null, version: '', announced: '' };
  function announce(key, text) { if (ss.announced !== key) { ss.announced = key; live.textContent = text; } }
  /* the only writer of the status text; the visible text is not a live region, only `live` is */
  function refreshStatus() {
    let s = 'loading', t;
    if (singleFile) { s = navigator.onLine ? 'ready' : 'offline'; t = 'Offline copy · works anywhere'; }
    else if (ss.ready) {
      s = navigator.onLine ? 'ready' : 'offline';
      t = navigator.onLine ? 'Ready offline ✓' : 'Offline · all sections available';
      announce('ready', 'Ready offline');
    } else if (ss.error) { t = 'Couldn’t save for offline — will retry when online'; announce('error', t); }
    else if (ss.progress) { t = 'Saving for offline… ' + ss.progress.done + '/' + ss.progress.total; announce('saving', 'Saving for offline'); }
    else if (!canSW) t = 'serviceWorker' in navigator ? 'Open over https to save offline' : 'Online only in this browser';
    else t = 'Preparing offline copy…';
    status.dataset.s = s;
    status.dataset.ready = (ss.ready || singleFile) ? '1' : '';
    if (statusT.textContent !== t) statusT.textContent = t;
    const pb = $('pbar');
    if (ss.progress && !ss.ready && !singleFile) { pb.hidden = false; $('pbar-i').style.transform = 'scaleX(' + (ss.progress.done / ss.progress.total) + ')'; } else pb.hidden = true;
  }
  window.addEventListener('online', () => { refreshStatus(); retryOffline(); }); window.addEventListener('offline', refreshStatus);
  function markReady(v) {
    ss.ready = true; ss.error = false; if (v) ss.version = v;
    $('offline-info').textContent = singleFile
      ? 'This file holds the whole reader (text, fonts and icons). Keep it anywhere and open it with no connection.'
      : (standalone ? 'Installed on this device. ' : '') + 'The whole reader (all text, fonts and icons) is stored on this device' + (ss.version ? ' (' + ss.version + ')' : '') + ' and works without a connection.';
    refreshStatus(); askPersist();
  }
  let swReg = null, swWired = false;
  function retryOffline() {
    if (!canSW || ss.ready || !ss.error || !navigator.onLine) return;
    ss.error = false; ss.announced = ''; refreshStatus();
    registerSW().then(() => { if (swReg) swReg.update().catch(() => {}); });
  }
  function registerSW() {
    return navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      swReg = reg;
      const askStatus = () => { const w = reg.active || navigator.serviceWorker.controller; if (w) w.postMessage({ type: 'status' }); };
      navigator.serviceWorker.ready.then(askStatus);
      if (swWired) return;
      swWired = true;
      const showUpdate = (w) => toast('New version available', 'Reload', () => { status.dataset.updating = '1'; w.postMessage('skip-waiting'); }, true);
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw); });
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) { reg.update().catch(() => {}); retryOffline(); } });
    }).catch(() => { ss.error = true; refreshStatus(); });
  }
  if (singleFile) markReady();
  else if (canSW) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'progress' || d.type === 'status') {
        ss.progress = { done: d.done, total: d.total };
        if (d.total && d.done >= d.total) markReady(d.version); else { ss.error = false; refreshStatus(); }
      } else if (d.type === 'error') { ss.error = true; refreshStatus(); }
    });
    if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();
    registerSW();
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !navigator.serviceWorker.controller) return;
      if (status.dataset.updating === '1') { reloading = true; location.reload(); }
    });
    refreshStatus();
  } else refreshStatus();

  let deferred = null;
  const installBtn = $('install');
  function revealInstall() {
    if (!installBtn.hidden) return;
    installBtn.hidden = false;
    if (canAnimate()) M.animate(installBtn, { opacity: [0, 1], scale: [0.9, 1] }, { type: 'spring', stiffness: 420, damping: 26 });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone) revealInstall(); });
  if (isIOS && !standalone && canSW) revealInstall();
  installBtn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => null); deferred = null;
      if (r && r.outcome === 'accepted') installBtn.hidden = true;
    } else if (isIOS) openDialog($('dlg-ios'));
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('Installed. Open it from your home screen.'); });

  /* ---------- note sync: Firebase is only loaded after the user turns sync on ---------- */
  const syncFlag = { get() { try { return localStorage.getItem('mishkat-sync') === '1'; } catch (e) { return false; } },
    set(on) { try { if (on) localStorage.setItem('mishkat-sync', '1'); else localStorage.removeItem('mishkat-sync'); } catch (e) {} } };
  const syncOK = !singleFile && /^https?:$/.test(location.protocol) && window.isSecureContext;
  let syncLoading = false;
  const loadScript = (src) => new Promise((res, rej) => { const e = document.createElement('script'); e.src = src; e.onload = res; e.onerror = rej; document.head.appendChild(e); });
  async function loadSync() {
    if (syncLoading) return; syncLoading = true;
    try { await loadScript('firebase-config.js'); await loadScript('sync.js'); }
    catch (e) { syncLoading = false; $('sync-box').textContent = 'Sync could not load. Try again when you are online.'; }
  }
  function syncUI() {
    const on = $('sync-on'), off = $('sync-off'), box = $('sync-box');
    if (!syncOK) { on.hidden = off.hidden = true; return; }
    const set = syncFlag.get();
    on.hidden = set; off.hidden = !set;
    if (!set) { box.textContent = ''; box.appendChild(el('p', '', 'Keep your notes the same on every device with your Google account. Google’s sign-in code is only loaded after you turn this on.')); }
  }
  $('sync-on').addEventListener('click', () => {
    syncFlag.set(true); syncUI();
    $('sync-box').textContent = ''; $('sync-box').appendChild(el('p', '', 'Connecting…'));
    loadSync();
  });
  $('sync-off').addEventListener('click', async () => {
    flushAll(); syncFlag.set(false);
    try { if (window.firebase && firebase.auth) await firebase.auth().signOut(); } catch (e) {}
    if (window.IkmalNotes) window.IkmalNotes.onLocalSave = null;
    toast('Note sync turned off. Reloading…');
    setTimeout(() => location.reload(), 500);
  });

  /* ---------- backup ---------- */
  $('notes-export').addEventListener('click', () => {
    flushAll();
    const o = {};
    notes.forEach((v, k) => { const s = BYID.get(k.slice(PFX.length)); o[k] = { text: v.text, updated: v.updated, entry: s ? numLabel(s) : k, name: s ? 'Mishkāt ' + numLabel(s) : '' }; });
    const j = { app: 'mishkat-backup', version: 1, exported: new Date().toISOString(), notes: o, stars: [...st.saved],
      settings: { theme: store.get('theme', 'system'), size: st.size, footnotes: st.fn, mode: st.mode, tab: st.tab } };
    const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mishkat-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup file created');
  });
  $('notes-import').addEventListener('click', () => $('notes-file').click());
  $('notes-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== 'mishkat-backup' || typeof j.notes !== 'object') throw new Error('format');
      let n = 0;
      for (const [k, v] of Object.entries(j.notes)) {
        if (!k.startsWith(PFX) || !BYID.has(k.slice(PFX.length)) || !mergeNote(k, v)) continue;
        const cur = notes.get(k), rec = cur ? { id: k, text: cur.text, updated: cur.updated } : { id: k, text: '', updated: tombs.get(k) };
        await idbPut(rec);
        if (window.IkmalNotes && window.IkmalNotes.onLocalSave) { try { window.IkmalNotes.onLocalSave(rec); } catch (e2) {} }
        n++;
      }
      let stars = 0;
      (Array.isArray(j.stars) ? j.stars : []).forEach((id) => { if (BYID.has(id) && !st.saved.has(id)) { st.saved.add(id); stars++; } });
      if (stars) store.set('saved', [...st.saved]);
      const s = j.settings || {};
      if (['system', 'light', 'dark'].includes(s.theme)) { store.set('theme', s.theme); applyTheme(s.theme); themeSeg.set(s.theme, false); }
      if (Number.isFinite(s.size)) setSize(s.size);
      if (typeof s.footnotes === 'boolean') setFn(s.footnotes, true);
      if (['one', 'stack', 'side'].includes(s.mode)) { st.mode = s.mode; store.set('mode', s.mode); }
      lsWrite(); askPersist();
      buildChips(); runSearch(false);
      if (st.cur) { const cs = st.cur; st.cur = null; openSection({ sid: cs }); }
      $('notes-count').textContent = notesSummary();
      toast(n || stars ? 'Restored ' + n + (n === 1 ? ' note' : ' notes') + (stars ? ' and ' + stars + ' saved' : '') : 'Everything was already up to date');
    } catch (err) { toast('That file is not a Mishkāt backup.'); }
  });
  $('content-info').textContent = '';

  /* ---------- boot ---------- */
  async function loadJSON(id, url) {
    const n = document.getElementById('data-' + id);
    if (n && n.textContent.trim()) return JSON.parse(n.textContent);
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  /* older builds called the opening section 'intro'; carry its note and star over to its current id */
  function migrateIds() {
    const first = SECTIONS.find((v) => v.kind === 'intro');
    if (!first || first.id === 'intro' || BYID.has('intro')) return;
    const old = PFX + 'intro', now = noteId(first.id);
    if (notes.has(old) && !notes.has(now)) {
      const rec = notes.get(old); notes.set(now, rec); notes.delete(old);
      tombs.set(old, Date.now()); idbPut({ id: now, text: rec.text, updated: rec.updated }); idbPut({ id: old, text: '', updated: tombs.get(old) }); lsWrite();
    }
    if (st.saved.has('intro')) { st.saved.delete('intro'); st.saved.add(first.id); store.set('saved', [...st.saved]); }
  }
  async function boot() {
    const ready = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]) : Promise.resolve();
    ready.then(() => { themeSeg.place(false); modeSeg.place(false); intro(); });
    const notesReady = loadNotes().catch(() => {});
    try {
      META = await loadJSON('meta', 'data/meta.json');
      BOOKS = await Promise.all((META.books || []).map(async (b) => ({ book: b, items: await loadJSON(b.id, 'data/' + b.file) })));
      // narrators are extra: the reader still works without them
      NARR = await loadJSON('narrators', 'data/narrators.json').catch(() => null);
    } catch (e) {
      $('empty').hidden = false;
      $('empty-t').textContent = 'The text could not load. Check your connection and reload; after one successful visit it works offline.';
      return;
    }
    await notesReady;
    prepare();
    buildMetaUI(); buildChips(); buildJump();
    $('notes-count').textContent = notesSummary();
    migrateIds();
    runSearch(true);
    measureSide();
    route();
    onScroll();
    installBridge(); // only now: sync.js waits for window.IkmalNotes, and it must see loaded data and notes
    syncUI(); if (syncOK && syncFlag.get()) loadSync();
  }
  function intro() {
    drawPattern(true);
    if (!canAnimate()) return;
    M.animate([$('t-ar'), $('t-en'), $('t-meta'), $('syncline'), $('facts')], { opacity: [0, 1], y: [10, 0] }, { delay: M.stagger(0.07), duration: 0.6, ease: EASE });
    M.animate(deck, { opacity: [0, 1] }, { duration: 0.5, delay: 0.25 });
  }
  boot();
})();
