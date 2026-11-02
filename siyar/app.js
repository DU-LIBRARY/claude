/* Siyar Aʿlām al-Nubalāʾ reader: offline app logic.
   Same structure as the Ikmāl index (sticky search, filter dropdown, measured-height cards, Motion),
   with a view stack for place lists, lazy volume loading and full-text search. */
(function () {
  'use strict';

  const M = window.Motion || null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canAnimate = () => M && !reduceMotion.matches;
  const EASE = [0.2, 0.8, 0.2, 1];
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('siyar-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('siyar-' + k, JSON.stringify(v)); } catch (e) {} }
  };

  const PAGE = 60, CHUNK = 150, NVOL = 24;
  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const RUMUZ = {'ع':'all six books','خ':'al-Bukhārī','م':'Muslim','د':'Abū Dāwūd','ت':'al-Tirmidhī','س':'al-Nasāʾī','ق':'Ibn Mājah','4':'the four Sunan','خت':'al-Bukhārī (taʿlīq)','بخ':'al-Adab al-Mufrad','مد':'Abū Dāwūd, al-Marāsīl','كن':'al-Nasāʾī, Musnad ʿAlī','ل':'Abū Dāwūd, al-Masāʾil','عخ':'al-Bukhārī, Khalq Afʿāl al-ʿIbād','ر':'al-Bukhārī, Juzʾ al-Qirāʾah','ي':'al-Bukhārī, Raf‘ al-Yadayn','قد':'Abū Dāwūd, al-Qadar','فق':'Ibn Mājah, al-Tafsīr','سي':'al-Nasāʾī, ʿAmal al-Yawm','تم':'al-Tirmidhī, al-Shamāʾil','ص':'al-Nasāʾī, Khaṣāʾiṣ ʿAlī'};
  const NOTE_SIRAH = 'This Sīrah volume was added by the editors from al-Dhahabī’s Tārīkh al-Islām, following his own instruction.';
  const NOTE_KHULAFA = 'The Siyar al-Khulafāʾ al-Rāshidīn volume was compiled by the editors on al-Dhahabī’s method, as Bashshār ʿAwwād explains in his introduction.';

  /* ---------- Arabic normalisation (one table-driven pass, keeps a map back to the original) ---------- */
  const T = new Uint16Array(65536);
  (function () {
    T.fill(32);
    for (let c = 0x30; c <= 0x39; c++) T[c] = c;
    for (let c = 0x61; c <= 0x7a; c++) T[c] = c;
    for (let c = 0x41; c <= 0x5a; c++) T[c] = c + 32;
    for (let c = 0x621; c <= 0x64a; c++) T[c] = c;
    [0x625, 0x623, 0x622, 0x671].forEach((c) => { T[c] = 0x627; });
    T[0x649] = 0x64a; T[0x629] = 0x647; T[0x624] = 0x648; T[0x626] = 0x64a; T[0x621] = 0;
    for (let c = 0x64b; c <= 0x65f; c++) T[c] = 0;
    T[0x670] = 0; T[0x640] = 0;
    for (let c = 0x6d6; c <= 0x6ed; c++) T[c] = 0;
    T[0xfdfa] = 0;
    [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0xfeff].forEach((c) => { T[c] = 0; });
    for (let c = 0x202a; c <= 0x202e; c++) T[c] = 0;
    for (let c = 0x2066; c <= 0x2069; c++) T[c] = 0;
    for (let i = 0; i < 10; i++) { T[0x660 + i] = 0x30 + i; T[0x6f0 + i] = 0x30 + i; }
    T[0x6a9] = 0x643; T[0x6cc] = 0x64a; T[0x6be] = 0x647; T[0x6c1] = 0x647; T[0x6d5] = 0x647;
  })();
  let BUF = new Uint16Array(1 << 16), MAP = new Int32Array(1 << 16);
  const dec = new TextDecoder('utf-16le');
  /* Returns the normalised string; MAP[k] is the index in `text` of normalised char k (valid until the next call). */
  function norm(text) {
    const L = text.length;
    if (BUF.length < L + 2) { BUF = new Uint16Array(L + 1024); MAP = new Int32Array(L + 1024); }
    let n = 0, i = 0, sp = true;
    while (i < L) {
      const c = text.charCodeAt(i);
      if (c === 0x27e6) { // ⟦vol:page⟧ page marker acts as a space
        const j = text.indexOf('⟧', i);
        if (!sp) { BUF[n] = 32; MAP[n] = i; n++; sp = true; }
        i = j < 0 ? L : j + 1; continue;
      }
      if (c === 40) { // (12) footnote call number acts as a space
        let j = i + 1;
        while (j < L && j - i - 1 < 3) { const d = text.charCodeAt(j); if (d < 48 || d > 57) break; j++; }
        if (j > i + 1 && text.charCodeAt(j) === 41) {
          if (!sp) { BUF[n] = 32; MAP[n] = i; n++; sp = true; }
          i = j + 1; continue;
        }
      }
      const o = T[c];
      if (o === 0) { i++; continue; }
      if (o === 32) { if (!sp) { BUF[n] = 32; MAP[n] = i; n++; sp = true; } i++; continue; }
      BUF[n] = o; MAP[n] = i; n++; sp = false; i++;
    }
    if (n && BUF[n - 1] === 32) n--;
    return n ? dec.decode(BUF.subarray(0, n)) : '';
  }
  const nAr = norm;
  function nEn(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʿʾ'‘’`]/g, '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const isDiac = (c) => (c >= 0x64b && c <= 0x65f) || c === 0x670 || c === 0x640 || (c >= 0x6d6 && c <= 0x6ed);
  const ESCM = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCM[c]);
  const fmt = (n) => n.toLocaleString('en');
  const toLatDig = (s) => s.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  /* highlight: wraps matches of the (normalised) query in <mark>, mapping back through diacritics */
  function hlAr(text, qa, phrase) {
    if (!qa || !text) return esc(text || '');
    const s = norm(text);
    const words = phrase ? [qa] : qa.split(' ').filter((w) => w.length > 1);
    let marks = null;
    for (const w of words) {
      let p = 0;
      while ((p = s.indexOf(w, p)) > -1) {
        if (!marks) marks = new Uint8Array(text.length);
        const a = MAP[p]; let b = MAP[p + w.length - 1];
        while (b + 1 < text.length && isDiac(text.charCodeAt(b + 1))) b++;
        for (let k = a; k <= b; k++) marks[k] = 1;
        p += w.length;
      }
    }
    if (!marks) return esc(text);
    let out = '', on = false, run = '';
    for (let i = 0; i < text.length; i++) {
      if (marks[i] !== (on ? 1 : 0)) { out += on ? '<mark>' + esc(run) + '</mark>' : esc(run); run = ''; on = !on; }
      run += text[i];
    }
    return out + (on ? '<mark>' + esc(run) + '</mark>' : esc(run));
  }
  function hlEn(text, qe) {
    if (!qe) return esc(text);
    let nn = '', map = [];
    for (let i = 0; i < text.length; i++) {
      const n = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʿʾ'‘’`]/g, '').toLowerCase();
      for (const ch of n) { nn += /[a-z0-9]/.test(ch) ? ch : ' '; map.push(i); }
    }
    const marks = new Array(text.length).fill(false);
    qe.split(' ').filter((w) => w.length > 1).forEach((w) => {
      let p = 0;
      while ((p = nn.indexOf(w, p)) > -1) { for (let k = p; k < p + w.length; k++) marks[map[k]] = true; p += w.length; }
    });
    let out = '', on = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] && !on) { out += '<mark>'; on = true; }
      if (!marks[i] && on) { out += '</mark>'; on = false; }
      out += esc(text[i]);
    }
    return on ? out + '</mark>' : out;
  }

  /* ---------- state ---------- */
  let DATA = [], PL = {}, FIELDS = [], MADS = [], INDEX = null;
  const BORN = new Map(), DIED = new Map();
  const BYVOL = [];
  const st = { fld: null, mad: null, vol: null, cent: null, deep: false, limit: PAGE, hits: [], qa: '', qe: '', open: new Set(), ft: false, ftq: '', snips: new Map() };
  const q = $('q'), list = $('list');

  /* ---------- segmented controls ---------- */
  function segInit(el, attr, value, onPick) {
    const thumb = el.querySelector('.thumb');
    const btns = [...el.querySelectorAll('button')];
    function place(animate) {
      const b = btns.find((x) => x.getAttribute('aria-pressed') === 'true');
      if (!b || !b.offsetWidth) return;
      const x = b.offsetLeft, w = b.offsetWidth;
      if (animate && canAnimate()) M.animate(thumb, { x, width: w }, { type: 'spring', stiffness: 520, damping: 40 });
      else { thumb.style.width = w + 'px'; thumb.style.transform = 'translateX(' + x + 'px)'; }
    }
    function set(v, animate) {
      btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(v))));
      place(animate);
    }
    btns.forEach((b) => b.addEventListener('click', () => { set(b.dataset[attr], true); onPick(b.dataset[attr]); }));
    set(value, false);
    return { set, place };
  }

  /* ---------- theme & size ---------- */
  let patternT = 0;
  function applyTheme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
    else delete document.documentElement.dataset.theme;
    const dark = v === 'dark' || (v !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f1311' : '#f5f6f2'));
    drawPattern(false);
  }
  const themeV = store.get('theme', 'system');
  const sizeV = String(store.get('size', '1'));
  document.documentElement.style.setProperty('--scale', sizeV);
  applyTheme(themeV);
  const themeSeg = segInit($('theme'), 'v', themeV, (v) => { store.set('theme', v); applyTheme(v); });
  const sizeSeg = segInit($('size'), 'v', sizeV, (v) => { store.set('size', v); document.documentElement.style.setProperty('--scale', v); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.get('theme', 'system')));

  /* ---------- ornament: a field of eight-pointed stars ---------- */
  function drawPattern(reveal) {
    const cv = $('pattern');
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const gold = cs.getPropertyValue('--gold').trim() || '#9a7a2c';
    const accent = cs.getPropertyValue('--accent').trim() || '#1d5a47';
    const cell = 56, R = 18;
    const cols = Math.ceil(r.width / cell) + 1, rows = Math.ceil(r.height / cell) + 1;
    const start = performance.now();
    const dur = reveal && !reduceMotion.matches ? 1400 : 0;
    cancelAnimationFrame(patternT);
    function star(cx, cy, s, rot) {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = rot + (i * Math.PI) / 8;
        const rad = i % 2 ? s * 0.62 : s;
        ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      ctx.closePath();
    }
    function frame(now) {
      const t = dur ? Math.min(1, (now - start) / dur) : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const cx = x * cell + (y % 2 ? cell / 2 : 0), cy = y * cell;
        const d = (cols - x) / cols * 0.6 + (y / rows) * 0.4;
        const k = Math.max(0, Math.min(1, (t - d * 0.55) / 0.45));
        if (!k) continue;
        const e = 1 - Math.pow(1 - k, 3);
        star(cx, cy, R * (0.6 + 0.4 * e), Math.PI / 8 * (1 - e));
        ctx.lineWidth = 1;
        ctx.strokeStyle = (x + y) % 3 === 0 ? gold : accent;
        ctx.globalAlpha = 0.22 * e;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (t < 1) patternT = requestAnimationFrame(frame);
    }
    patternT = requestAnimationFrame(frame);
  }
  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { drawPattern(false); themeSeg.place(false); sizeSeg.place(false); }, 120);
  });

  /* ---------- helpers on records ---------- */
  const centName = (c) => ORD[c] ? ORD[c][0].toUpperCase() + ORD[c].slice(1) + ' century' : '';
  function ceDates(d) {
    if (/BH/.test(d)) return '≈ 570–632 CE';
    if (/CE/.test(d)) return '';
    const nums = d.match(/\d{2,4}/g); if (!nums) return '';
    const conv = nums.map((n) => Math.round(+n * 0.970229 + 621.57));
    const pre = /^b\./.test(d) ? 'b. ' : /^d\./.test(d) ? 'd. ' : '';
    return '≈ ' + pre + conv.join('–') + ' CE';
  }
  const datesText = (o) => o.d ? o.d + (/CE|AH|BH/.test(o.d) ? '' : ' AH') : '';
  const isRefNum = (o) => /^\d+:\d+$/.test(o.ref);
  const refText = (o) => isRefNum(o) ? o.ref + (o.no ? ' · no. ' + o.no : '') : o.ref;
  const shortName = (o) => o.en || o.n;
  const placeName = (k) => PL[k] ? PL[k][0] : '';

  /* ---------- filters ---------- */
  const FIELD_ORDER = [0, 1, 2, 8, 10, 13, 3, 4, 5, 6, 7, 9, 11, 12];
  function pass(o) {
    return (st.fld === null || o.f.includes(st.fld)) && (st.mad === null || o.m.includes(st.mad)) &&
      (st.vol === null || o.vol === st.vol) && (st.cent === null || o.c === st.cent);
  }
  function chipRow(el, items, key) {
    el.innerHTML = items.map((it) =>
      '<button type="button" class="chip' + (it.cls ? ' ' + it.cls : '') + '" data-k="' + it.k + '" aria-pressed="' + (String(st[key]) === String(it.k)) + '">' + esc(it.label) +
      (it.n !== undefined ? '<span class="n">' + fmt(it.n) + '</span>' : '') + '</button>').join('');
    el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.k === 'all' ? null : Number(b.dataset.k);
      st[key] = v; stopPlay();
      syncChips(); st.limit = PAGE; run(true); updateBadge();
    }));
  }
  function syncChips() {
    setCentBar();
    [['f-field', 'fld'], ['f-mad', 'mad'], ['f-vol', 'vol'], ['f-cent', 'cent']].forEach(([id, key]) => {
      $(id).querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === (st[key] === null ? 'all' : String(st[key])))));
    });
  }
  function buildFilters() {
    const fc = {}, mc = {}, vc = {}, cc = {};
    DATA.forEach((o) => {
      o.f.forEach((i) => { fc[i] = (fc[i] || 0) + 1; }); o.m.forEach((i) => { mc[i] = (mc[i] || 0) + 1; });
      vc[o.vol] = (vc[o.vol] || 0) + 1; if (o.c) cc[o.c] = (cc[o.c] || 0) + 1;
    });
    chipRow($('f-field'), [{ k: 'all', label: 'All', n: DATA.length }].concat(FIELD_ORDER.map((i) => ({ k: i, label: FIELDS[i], n: fc[i] || 0 }))), 'fld');
    chipRow($('f-mad'), [{ k: 'all', label: 'Any' }].concat(MADS.map((m, i) => ({ k: i, label: m, n: mc[i] || 0 }))), 'mad');
    const vols = [{ k: 'all', label: 'All' }, { k: 0, label: 'Sīrah & Khulafāʾ', n: vc[0] || 0 }];
    for (let v = 1; v < NVOL; v++) vols.push({ k: v, label: String(v), n: vc[v] || 0, cls: 'sm' });
    chipRow($('f-vol'), vols, 'vol');
    const cents = [{ k: 'all', label: 'All' }];
    for (let c = 1; c <= 7; c++) cents.push({ k: c, label: ORD[c][0].toUpperCase() + ORD[c].slice(1), n: cc[c] || 0 });
    chipRow($('f-cent'), cents, 'cent');
    const used = new Set(); DATA.forEach((o) => { if (o.o) used.add(o.o); if (o.dp) used.add(o.dp); });
    $('facts').innerHTML = '<li><b>' + fmt(DATA.length) + '</b> entries</li><li><b>' + NVOL + '</b> volumes</li><li><b>' + used.size + '</b> places</li><li><b>7</b> centuries AH</li>';
  }
  function filtersActive() { return st.fld !== null || st.mad !== null || st.vol !== null || st.cent !== null; }
  function updateBadge() {
    $('fbadge').hidden = !filtersActive(); $('reset').hidden = !filtersActive();
    fbtn.classList.toggle('on', !homeVisible && filtersActive());
  }
  $('reset').addEventListener('click', () => { st.fld = st.mad = st.vol = st.cent = null; stopPlay(); syncChips(); st.limit = PAGE; run(true); updateBadge(); });

  /* century playback */
  let playT = null;
  function setCentBar() { $('cent-fill').style.width = (st.cent ? st.cent / 7 * 100 : 0) + '%'; }
  function stopPlay() {
    if (!playT) return;
    clearInterval(playT); playT = null;
    $('play').setAttribute('aria-pressed', 'false'); $('play').querySelector('span').textContent = 'Play';
  }
  function stepCentury() {
    st.cent = st.cent === null || st.cent >= 7 ? 1 : st.cent + 1;
    syncChips(); setCentBar(); st.limit = PAGE; run(true); updateBadge();
    const chip = $('f-cent').querySelector('.chip[aria-pressed="true"]');
    if (chip) {
      chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
      if (canAnimate()) M.animate(chip, { scale: [1, 1.14, 1] }, { duration: 0.45, ease: EASE });
    }
    if (canAnimate()) M.animate($('cent-fill'), { opacity: [0.4, 1] }, { duration: 0.4 });
    if (st.cent >= 7) { clearInterval(playT); playT = setTimeout(stopPlay, 1600); }
  }
  $('play').addEventListener('click', () => {
    if (playT) { stopPlay(); return; }
    $('play').setAttribute('aria-pressed', 'true'); $('play').querySelector('span').textContent = 'Stop';
    if (st.ft) cancelFT();
    st.cent = null; stepCentury();
    playT = setInterval(stepCentury, 1700);
  });

  /* ---------- search ---------- */
  function parseRef(t) {
    const m = t.match(/^(\d{1,2})\s*[:：.\/]\s*(\d{1,4})$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }
  function score(o, qa, qe) {
    let s = 0;
    if (qa) {
      if (o._h === qa) s = 100;
      else if (o._h.startsWith(qa)) s = 90;
      else if (o._h.includes(qa)) s = 80;
      else if (o._l.includes(qa)) s = 65;
      else {
        const ws = qa.split(' ');
        if (ws.length > 1 && ws.every((w) => o._h.includes(w) || o._l.includes(w))) s = 55;
      }
    }
    if (qe) {
      if (o._en && o._en.startsWith(qe)) s = Math.max(s, 85);
      else if (o._en && o._en.includes(qe)) s = Math.max(s, 75);
      else {
        const ws = qe.split(' ');
        if (o._en && ws.every((w) => o._en.includes(w))) s = Math.max(s, 60);
        else if (o._pl && ws.every((w) => o._pl.includes(w))) s = Math.max(s, 40);
        else if (o._st && ws.every((w) => o._st.includes(w))) s = Math.max(s, 30);
      }
    }
    return s;
  }
  function run(animate) {
    if (st.ft) cancelFT(true);
    const raw = q.value.trim();
    $('clear').hidden = !raw; $('kbd').hidden = !!raw || document.activeElement === q;
    const t = toLatDig(raw);
    const num = /^\d+$/.test(t) ? Number(t) : null;
    const ref = parseRef(t);
    let qa = num === null && !ref ? nAr(raw) : '';
    if (!/[ء-ي]/.test(qa)) qa = '';
    const qe = num === null && !ref && /[a-zA-Zāīūḥṣḍṭẓ]/.test(raw) ? nEn(raw) : '';
    let hits = DATA.filter(pass);
    if (num !== null) hits = hits.filter((o) => o.no === String(num));
    else if (ref) {
      const [v, p] = ref;
      const exact = hits.filter((o) => o.rv === v && o.rp === p);
      if (exact.length) hits = exact;
      else { // the entry that contains this printed page: the last one starting on or before it
        let best = null;
        (BYVOL[v] || []).forEach((o) => { if (o.rp <= p && pass(o) && (!best || o.rp >= best.rp)) best = o; });
        hits = best ? [best] : [];
      }
    } else if (raw) {
      hits = hits.map((o) => [score(o, qa, qe), o]).filter((x) => x[0] > 0)
        .sort((a, b) => b[0] - a[0] || a[1].i - b[1].i).map((x) => x[1]);
    }
    st.hits = hits; st.qe = qe; st.qa = qa; st.snips = new Map();
    updateBadge(); updateFtBar();
    render(animate);
  }

  /* ---------- rendering of rows ---------- */
  const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const ICON_GO = '<svg class="go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  const ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';

  function fieldTag(o) {
    if (!o.f.length) return '';
    return '<span class="fld' + o.f[0] + '"><span class="dot"></span>' + esc(o.f.map((i) => FIELDS[i]).join(' · ')) + '</span>';
  }
  function rowHtml(o, kind, role) {
    const sn = kind === 'ft' ? st.snips.get(o.i) : null;
    const num = o.no ? esc(o.no) : '·';
    const small = isRefNum(o) ? o.ref : '';
    const tags = [];
    if (o.d) tags.push('<span>' + esc(datesText(o)) + '</span>');
    if (o.c) tags.push('<span>' + o.c + ({1:'st',2:'nd',3:'rd'}[o.c] || 'th') + ' c. AH</span>');
    const ft = fieldTag(o); if (ft) tags.push(ft);
    if (o.m.length) tags.push('<span>' + esc(o.m.map((i) => MADS[i]).join(' · ')) + '</span>');
    if (role) tags.unshift('<b class="bd">' + role + '</b>');
    const hlq = kind === 'list' || kind === 'ft';
    return '<li class="e" data-i="' + o.i + '"' + (kind === 'ft' ? ' data-ft="1"' : '') + '>' +
      '<div class="head">' +
        '<span class="num">' + num + '<small>' + small + '</small></span>' +
        '<div class="names">' +
          '<button class="opener" type="button" aria-expanded="false"><span class="ar-name" lang="ar" dir="rtl">' + (hlq ? hlAr(o.n, st.qa) : esc(o.n)) + '</span></button>' +
          (o.en ? '<span class="en-name" dir="ltr">' + (hlq ? hlEn(o.en, st.qe) : esc(o.en)) + '</span>' : '') +
          '<span class="ar-full" lang="ar" dir="rtl">' + (hlq ? hlAr(o.lead, st.qa) : esc(o.lead)) + '</span>' +
          '<span class="tags">' + tags.join('') + '</span>' +
          (sn ? '<div class="snip" lang="ar" dir="rtl">' + sn.html + '</div><div class="snip-m"><span class="pg">' + esc(sn.pg) + '</span>' + (sn.n > 1 ? '<span>' + sn.n + ' matches in this entry</span>' : '') + '</div>' : '') +
        '</div>' +
        '<div class="side">' + (kind === 'nav' ? ICON_GO : ICON_CHEV) + '</div>' +
      '</div>' +
      '<div class="body" role="region" aria-label="Entry ' + esc(o.no || o.ref) + '" hidden><div class="inner"></div></div>' +
    '</li>';
  }

  function appendRows(from, to, animate) {
    const slice = st.hits.slice(from, to);
    if (!slice.length) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = slice.map((o) => rowHtml(o, st.ft ? 'ft' : 'list')).join('');
    const nodes = [...tpl.content.children];
    list.appendChild(tpl.content);
    nodes.forEach((li) => { if (st.open.has(li.dataset.i)) openRow(li, false); });
    if (animate && canAnimate()) {
      M.animate(nodes.slice(0, 14), { opacity: [0, 1], y: [8, 0] }, { delay: M.stagger(0.022), duration: 0.32, ease: EASE });
    }
  }
  function render(animate) {
    list.innerHTML = '';
    appendRows(0, st.limit, animate);
    if (st.hits.length === 1 && !st.open.has(String(st.hits[0].i)) && !st.ft) {
      const li = list.firstElementChild; if (li) openRow(li, false);
    }
    updateCount();
    const empty = $('empty'); empty.hidden = st.hits.length > 0 || st.ft;
    if (!st.hits.length && !st.ft) renderEmpty();
  }
  function updateCount() {
    const total = DATA.length, n = st.hits.length;
    $('count').innerHTML = st.ft ? '<b>' + fmt(n) + '</b> ' + (n === 1 ? 'entry' : 'entries') + ' found' : (n === total ? '<b>' + fmt(total) + '</b> entries' : '<b>' + fmt(n) + '</b> of ' + fmt(total) + ' entries');
    $('morewrap').hidden = n <= st.limit;
  }
  function renderEmpty() {
    const acts = $('empty-actions'); acts.innerHTML = '';
    $('empty-t').textContent = 'No entry matches that search. Try fewer letters, drop the “ال”, clear the filters, or search inside the entries.';
    const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
    if (q.value.trim() && !st.deep) add('Search inside entries', () => { $('deep').checked = true; setDeep(true); startFT(); });
    if (filtersActive()) add('Clear filters', () => $('reset').click());
    if (canAnimate()) M.animate($('empty'), { opacity: [0, 1], y: [6, 0] }, { duration: 0.3, ease: EASE });
  }

  /* ---------- opening and closing cards ---------- */
  function openRow(li, animate) {
    const o = DATA[li.dataset.i];
    const body = li.querySelector('.body'), inner = li.querySelector('.inner');
    inner.innerHTML = bodyHtml(o); wireBody(li, o);
    li.classList.add('open');
    li.querySelector('.opener').setAttribute('aria-expanded', 'true');
    body.hidden = false;
    if (li.closest('#list')) st.open.add(li.dataset.i);
    if (animate && canAnimate()) {
      const h = inner.offsetHeight;
      body.style.height = '0px';
      M.animate(body, { height: [0, h] }, { duration: Math.min(0.55, 0.28 + h / 3000), ease: EASE }).then(() => { body.style.height = 'auto'; });
      M.animate(inner, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.35, delay: 0.05, ease: EASE });
    } else body.style.height = 'auto';
  }
  function closeRow(li, animate) {
    const body = li.querySelector('.body');
    li.classList.remove('open');
    li.querySelector('.opener').setAttribute('aria-expanded', 'false');
    st.open.delete(li.dataset.i);
    if (animate && canAnimate()) {
      const h = body.offsetHeight;
      M.animate(body, { height: [h, 0] }, { duration: 0.28, ease: EASE }).then(() => { if (!li.classList.contains('open')) body.hidden = true; });
    } else body.hidden = true;
  }
  list.addEventListener('click', (ev) => {
    const li = ev.target.closest('li.e');
    if (!li) return;
    const pb = ev.target.closest('.placebtn');
    if (pb) { pushView({ t: 'place', k: pb.dataset.place }); return; }
    if (ev.target.closest('.body')) return;
    if (getSelection().toString()) return;
    if (li.classList.contains('open')) closeRow(li, true); else openRow(li, true);
  });

  function nameList(arr) { return '<ul class="nlist">' + arr.map((x) => '<li lang="ar" dir="rtl">' + esc(x) + '</li>').join('') + '</ul>'; }
  function placeBtn(k) {
    if (!k || !PL[k]) return '';
    const p = PL[k];
    return '<button type="button" class="placebtn" data-place="' + esc(k) + '">' + esc(p[0]) + '</button> <span class="sub">' + esc(p[3] || '') + '</span><span class="pl-ar" lang="ar" dir="rtl">' + esc(p[5] || '') + '</span>';
  }
  function bodyHtml(o) {
    const sirah = o.i === 0;
    const names = o.rz ? o.rz.split(/[،,\s]+/).filter(Boolean).map((p) => RUMUZ[p.replace(/[()]/g, '')]).filter(Boolean) : [];
    const chips = ['<span class="chip-s src">' + esc(refText(o)) + '</span>'];
    if (names.length) chips.push('<span class="chip-s" title="al-Dhahabī’s code (' + esc(o.rz) + ')">Narrated in: ' + esc(names.join(', ')) + '</span>');
    if (o.rz && !names.length) chips.push('<span class="chip-s" lang="ar" dir="rtl">' + esc(o.rz) + '</span>');
    if (o.est) chips.push('<span class="chip-s warn">Death year estimated from his ṭabaqah</span>');
    if (o.oap) chips.push('<span class="chip-s warn">Place inferred</span>');
    const ce = o.d ? ceDates(o.d) : '';
    const story = o.st ? '<h3>' + (o.sl === 'ar' ? 'From the entry' : 'A story from the entry') + '</h3><p class="story' + (o.sl === 'ar' ? ' ar' : '') + '"' + (o.sl === 'ar' ? ' lang="ar" dir="rtl"' : '') + '>' + esc(o.st) + '</p><p class="story-src">' + (o.sl === 'ar' ? 'Quoted as al-Dhahabī gives it.' : 'Summarised in English from al-Dhahabī’s entry.') + '</p>' : '';
    const sub = FIELDS && o.f.length ? o.f.map((i) => FIELDS[i]).join(' · ') : '';
    const kv = '<dl class="kv">' +
      '<dt>Dates</dt><dd>' + (o.d ? esc(datesText(o)) + (ce ? '<br><span class="sub">' + ce + '</span>' : '') : '<span class="sub">Not given in the entry</span>') + '</dd>' +
      '<dt>From</dt><dd>' + (o.o && PL[o.o] ? placeBtn(o.o) : '<span class="sub">Not recorded</span>') + '</dd>' +
      '<dt>Died in</dt><dd>' + (o.dp && PL[o.dp] ? placeBtn(o.dp) : '<span class="sub">Not recorded</span>') + '</dd>' +
      (sub ? '<dt>Field</dt><dd>' + esc(sub) + '</dd>' : '') +
      (o.m.length ? '<dt>Madhhab</dt><dd>' + esc(o.m.map((i) => MADS[i]).join(' · ')) + '</dd>' : '') + '</dl>';
    const vol = o.vol;
    const kb = o.chars >= 1e6 ? (o.chars / 1e6).toFixed(1) + 'M characters' : Math.max(1, Math.round(o.chars / 1000)) + 'k characters';
    return '<div class="ff">' +
      '<h2>' + (o.en ? esc(o.en) : '<span lang="ar" dir="rtl" style="font-family:var(--ar)">' + esc(o.n) + '</span>') + (o.hon ? '<span class="hon">' + esc(o.hon) + '</span>' : '') + '</h2>' +
      (o.en ? '<div class="fullar" lang="ar" dir="rtl">' + esc(o.n) + '</div>' : '') +
      (o.lead ? '<p class="leadar" lang="ar" dir="rtl">' + esc(o.lead) + '</p>' : '') +
      '<div class="chips">' + chips.join('') + '</div>' + kv +
      (o.tea.length && !sirah ? '<h3>Teachers <small>a few of the main ones</small></h3>' + nameList(o.tea) : '') +
      (o.stu.length ? '<h3>' + (sirah ? 'His Companions' : 'Students <small>a few of the main ones</small>') + '</h3>' + nameList(o.stu) : '') +
      (o.bk.length ? '<h3>Books</h3>' + nameList(o.bk) : '') + story +
      '<section class="fe"><button class="fe-toggle" type="button" aria-expanded="false"><span>Full entry</span><small>vol. ' + vol + ' · ' + kb + '</small>' + ICON_CHEV + '</button>' +
      '<div class="fe-body" hidden><div class="fe-inner"></div></div></section>' +
      '<div class="foot"><span class="ref">' + esc(refText(o)) + '</span>' +
      (navigator.share ? '<button class="btn" type="button" data-act="share">' + ICON_SHARE + '<span>Share</span></button>' : '') +
      '<button class="btn" type="button" data-act="link">' + ICON_LINK + '<span>Copy link</span></button></div>' +
      '</div>';
  }
  function wireBody(li, o) {
    initFull(li.querySelector('.fe'), o, li.dataset.ft ? st.ftq : '');
    li.querySelectorAll('.inner [data-act]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const link = location.href.split('#')[0] + '#i' + o.i;
      if (b.dataset.act === 'share') navigator.share({ title: shortName(o), text: shortName(o) + ' · Siyar ' + refText(o), url: link }).catch(() => {});
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => toast('Link copied')).catch(() => toast(link));
      else toast(link);
    }));
  }

  /* ---------- volumes: fetch, parse, small in-memory cache ---------- */
  const volMem = new Map(); // v -> {e}, most recent last
  const volPending = new Map();
  const volName = (v) => 'vol' + String(v).padStart(2, '0');
  async function fetchBytes(url, total, onProg, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (!r.body || !r.body.getReader) { const b = await r.arrayBuffer(); if (onProg) onProg(b.byteLength, b.byteLength); return new Uint8Array(b); }
    const rd = r.body.getReader(); const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (onProg) onProg(got, total);
    }
    const out = new Uint8Array(got); let p = 0;
    parts.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }
  async function loadVol(v, opt) {
    opt = opt || {};
    if (volMem.has(v)) { const d = volMem.get(v); volMem.delete(v); volMem.set(v, d); return d; }
    let pr = volPending.get(v);
    if (!pr) {
      pr = (async () => {
        const bytes = await fetchBytes('data/full/' + volName(v) + '.json', INDEX.vols[volName(v)], opt.onProg, opt.signal);
        return JSON.parse(new TextDecoder().decode(bytes));
      })();
      volPending.set(v, pr);
      pr.then(() => volPending.delete(v), () => volPending.delete(v));
    }
    const d = await pr;
    if (opt.keep !== false) {
      volMem.set(v, d);
      while (volMem.size > 3) volMem.delete(volMem.keys().next().value);
    }
    return d;
  }

  /* ---------- full entry ---------- */
  const TOKEN = /⟦(\d+):(\d+)⟧/g;
  const FN = /\s*\(\d{1,2}\)/g; // edition footnote call numbers: not displayed (the data is untouched)
  function textSeg(t, qa) { return qa ? hlAr(t, qa, true) : esc(t); }
  function inline(t, qa) {
    let out = '', last = 0, m; TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(t))) {
      out += textSeg(t.slice(last, m.index), qa);
      out += '<span class="pg" dir="ltr" title="Printed page ' + m[1] + ':' + m[2] + '">' + m[1] + ':' + m[2] + '</span>';
      last = TOKEN.lastIndex;
    }
    return out + textSeg(t.slice(last), qa);
  }
  function parHtml(p, qa, head) {
    p = p.replace(FN, '');
    if (p.startsWith('§ ')) return '<h4 class="sec" lang="ar" dir="rtl">' + inline(p.slice(2), qa) + '</h4>';
    if (p.includes(' ... ')) {
      return '<p class="ap vs" lang="ar" dir="rtl">' + p.split(' ... ').map((x, i) => (i ? '<span class="vsep"> ... </span>' : '') + '<span class="hm">' + inline(x, qa) + '</span>').join('') + '</p>';
    }
    return '<p class="ap' + (head ? ' hd' : '') + '" lang="ar" dir="rtl">' + inline(p, qa) + '</p>';
  }
  function setHeight(body, from, to, dur) {
    if (canAnimate() && Math.abs(to - from) > 2) {
      body.style.height = from + 'px';
      return M.animate(body, { height: [from, to] }, { duration: dur || 0.4, ease: EASE }).then(() => { body.style.height = 'auto'; });
    }
    body.style.height = 'auto'; return Promise.resolve();
  }
  function initFull(sec, o, ftq) {
    const btn = sec.querySelector('.fe-toggle'), body = sec.querySelector('.fe-body'), inner = sec.querySelector('.fe-inner');
    let state = 'idle', loaded = false;
    const cap = () => Math.round(window.innerHeight * 1.1);
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (state === 'open' || state === 'loading') { // collapse
        btn.setAttribute('aria-expanded', 'false');
        if (state === 'loading') { state = 'idle'; if (sec._abort) sec._abort.abort(); }
        else state = 'idle';
        const h = body.offsetHeight;
        if (canAnimate()) M.animate(body, { height: [h, 0] }, { duration: 0.3, ease: EASE }).then(() => { if (state === 'idle') body.hidden = true; });
        else body.hidden = true;
        return;
      }
      btn.setAttribute('aria-expanded', 'true');
      body.hidden = false;
      if (loaded) { state = 'open'; const h = Math.min(inner.offsetHeight, cap()); setHeight(body, 0, h, 0.4); return; }
      state = 'loading';
      const ctl = new AbortController(); sec._abort = ctl;
      const render = async () => {
        inner.innerHTML = '<div class="loader"><span class="spin"></span><div><b>Loading volume ' + o.vol + '…</b><div class="bar-track"><i></i></div><span class="pct">Preparing</span></div></div>';
        const fill = inner.querySelector('.bar-track i'), pct = inner.querySelector('.pct');
        setHeight(body, 0, inner.offsetHeight, 0.3);
        try {
          const vd = await loadVol(o.vol, { signal: ctl.signal, onProg: (g, t) => { const f = t ? Math.min(1, g / t) : 0; fill.style.width = (f * 100).toFixed(0) + '%'; pct.textContent = (g / 1048576).toFixed(1) + ' of ' + (t / 1048576).toFixed(1) + ' MB'; } });
          if (state !== 'loading') return;
          const e = vd.e[String(o.i)];
          if (!e) throw new Error('This entry is not in the volume file.');
          const from = body.offsetHeight;
          buildFullText(inner, o, e, ftq);
          loaded = true; state = 'open';
          const to = Math.min(inner.offsetHeight, cap());
          await setHeight(body, from, to, 0.45);
          if (ftq) { const mk = inner.querySelector('mark'); if (mk) mk.scrollIntoView({ block: 'center', behavior: 'auto' }); }
        } catch (err) {
          if (state !== 'loading') return;
          state = 'open';
          const off = !navigator.onLine;
          inner.innerHTML = '<div class="fe-err"><span>' + (off ? 'This volume is not stored on this device yet. Connect to the internet, or use “Download everything for offline” in Settings.' : 'The volume could not be loaded (' + esc(err.message || 'error') + ').') + '</span><span><button class="btn" type="button">Try again</button></span></div>';
          inner.querySelector('button').addEventListener('click', (e2) => { e2.stopPropagation(); state = 'loading'; render(); });
          body.style.height = 'auto';
        }
      };
      render();
    });
  }
  function buildFullText(inner, o, e, ftq) {
    const paras = [e.h].concat(e.t.split('\n'));
    inner.innerHTML = '';
    const notes = [];
    if (o.i === 0) notes.push(['', NOTE_SIRAH]);
    if (o.i >= 1 && o.i <= 4) notes.push(['', NOTE_KHULAFA]);
    if (o.st2 === 'd') notes.push(['warn', 'Match flagged for review: this text was matched to the entry automatically and the match is doubtful.']);
    notes.forEach(([c, t]) => { const n = document.createElement('p'); n.className = 'fe-note ' + c; n.textContent = t; inner.appendChild(n); });
    const box = document.createElement('div'); box.className = 'fe-text'; inner.appendChild(box);
    const sent = document.createElement('div'); sent.className = 'fe-more'; inner.appendChild(sent);
    let upto = 0;
    // when opened from a full-text hit, render far enough to show the first match
    let first = Math.min(paras.length, CHUNK);
    if (ftq) {
      for (let k = 0; k < paras.length; k++) {
        if (norm(paras[k].replace(FN, '')).includes(ftq)) { first = Math.max(first, Math.min(paras.length, k + 25)); break; }
      }
    }
    function more(n) {
      const end = Math.min(paras.length, upto + n);
      if (upto >= end) return;
      let html = '';
      for (let k = upto; k < end; k++) if (paras[k] !== '') html += parHtml(paras[k], ftq, k === 0);
      box.insertAdjacentHTML('beforeend', html);
      upto = end;
      if (upto >= paras.length) { if (io) io.disconnect(); sent.remove(); if (paras.length > CHUNK) box.insertAdjacentHTML('afterend', '<div class="fe-end">End of entry · ' + fmt(paras.length) + ' paragraphs</div>'); }
      else if (io) { io.unobserve(sent); io.observe(sent); }
    }
    let io = null;
    if ('IntersectionObserver' in window) io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(CHUNK); }, { rootMargin: '1500px 0px' });
    more(first);
    if (io && upto < paras.length) io.observe(sent);
  }

  /* ---------- infinite scroll for the main list ---------- */
  function more() {
    if (st.hits.length <= st.limit) return;
    const from = st.limit; st.limit += PAGE;
    appendRows(from, st.limit, false);
    $('morewrap').hidden = st.hits.length <= st.limit;
  }
  $('more').addEventListener('click', more);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !$('v-home').hidden) more(); }, { rootMargin: '800px 0px' }).observe($('sentinel'));
  }

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, action, fn) {
    const el = $('toast'), b = $('toast-b');
    $('toast-t').textContent = msg;
    b.hidden = !action; if (action) { b.textContent = action; b.onclick = () => { fn(); hideToast(); }; }
    const host = document.querySelector('dialog[open]') || document.body;
    if (el.parentNode !== host) { host.appendChild(el); el.hidden = true; }
    const was = !el.hidden;
    el.hidden = false;
    if (!was && canAnimate()) M.animate(el, { opacity: [0, 1], y: [14, 0], scale: [0.97, 1] }, { type: 'spring', stiffness: 420, damping: 30 });
    clearTimeout(toastT);
    toastT = setTimeout(hideToast, action ? 9000 : 1800);
  }
  function hideToast() {
    const el = $('toast');
    if (el.hidden) return;
    if (canAnimate()) M.animate(el, { opacity: 0, y: 10 }, { duration: 0.2 }).then(() => { el.hidden = true; el.style.opacity = ''; el.style.transform = 'translateX(-50%)'; });
    else el.hidden = true;
  }

  /* ---------- view stack: home -> place list -> person ... with browser history ---------- */
  const stack = $('stack'), homeEl = $('v-home');
  const nav = [{ desc: { t: 'home' }, el: homeEl, scroll: 0 }];
  try { history.scrollRestoration = 'manual'; } catch (e) {}
  const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>';
  function labelOf(entry) {
    const d = entry.desc;
    if (d.t === 'home') return q.value.trim() || filtersActive() ? 'results' : 'the list';
    if (d.t === 'place') return placeName(d.k) || 'places';
    return DATA[d.i] ? shortName(DATA[d.i]) : 'entry';
  }
  const hashOf = (d) => d.t === 'rec' ? '#i' + d.i : d.t === 'place' ? '#p=' + encodeURIComponent(d.k) : location.pathname + location.search;
  function navbar() {
    const prev = nav[nav.length - 1];
    const div = document.createElement('div'); div.className = 'navbar';
    div.innerHTML = '<div class="wrap"><button class="back" type="button">' + ICON_BACK + '<span>Back to ' + esc(labelOf(prev)) + '</span></button></div>';
    div.querySelector('.back').addEventListener('click', () => { if (nav.length > 1) history.back(); });
    return div;
  }
  function buildRecView(d) {
    const o = DATA[d.i];
    const el = document.createElement('div'); el.className = 'view';
    el.appendChild(navbar());
    const main = document.createElement('main'); main.className = 'wrap';
    main.innerHTML = '<ol class="list">' + rowHtml(o, 'rec') + '</ol>';
    el.appendChild(main);
    const li = main.querySelector('li');
    main.addEventListener('click', (ev) => {
      const pb = ev.target.closest('.placebtn');
      if (pb) { pushView({ t: 'place', k: pb.dataset.place }); return; }
      if (ev.target.closest('.body')) return;
      if (li.classList.contains('open')) closeRow(li, true); else openRow(li, true);
    });
    stack.appendChild(el);
    openRow(li, false);
    return el;
  }
  function buildPlaceView(d) {
    const k = d.k, p = PL[k] || [k, 0, 0, '', 0, ''];
    const born = BORN.get(k) || [], died = DIED.get(k) || [];
    const all = [...new Set(born.concat(died))].sort((a, b) => a - b);
    const el = document.createElement('div'); el.className = 'view';
    el.appendChild(navbar());
    const main = document.createElement('main'); main.className = 'wrap';
    main.innerHTML = '<div class="pv-head"><h1>People of ' + esc(p[0]) + '</h1><span class="ar" lang="ar" dir="rtl">' + esc(p[5] || '') + '</span><p>' + esc(p[3] || '') + ' · <span class="cnt"></span></p></div>' +
      '<div class="pv-opts"><div class="seg" role="group" aria-label="Show"><span class="thumb" aria-hidden="true"></span>' +
      '<button type="button" data-m="all" aria-pressed="true">All ' + all.length + '</button><button type="button" data-m="born" aria-pressed="false">Born ' + born.length + '</button><button type="button" data-m="died" aria-pressed="false">Died ' + died.length + '</button></div></div>' +
      '<ol class="list"></ol><div class="more"><button type="button" hidden>Show more</button></div>';
    el.appendChild(main);
    stack.appendChild(el);
    const ol = main.querySelector('ol'), moreBtn = main.querySelector('.more button'), cnt = main.querySelector('.cnt');
    let ids = all, shown = 0, mode = d.m || 'all';
    const bornSet = new Set(born), diedSet = new Set(died);
    function fill(animate) {
      ol.innerHTML = ''; shown = 0; add(animate);
      cnt.textContent = ids.length + (ids.length === 1 ? ' person' : ' people');
    }
    function add(animate) {
      const sl = ids.slice(shown, shown + PAGE); shown += sl.length;
      const tpl = document.createElement('template');
      tpl.innerHTML = sl.map((i) => { const role = bornSet.has(i) && diedSet.has(i) ? 'Born & died here' : bornSet.has(i) ? 'Born here' : 'Died here'; return rowHtml(DATA[i], 'nav', role); }).join('');
      const nodes = [...tpl.content.children]; ol.appendChild(tpl.content);
      if (animate && canAnimate()) M.animate(nodes.slice(0, 14), { opacity: [0, 1], y: [8, 0] }, { delay: M.stagger(0.022), duration: 0.32, ease: EASE });
      moreBtn.hidden = shown >= ids.length;
    }
    const seg = segInit(main.querySelector('.seg'), 'm', mode, (m) => {
      mode = m; d.m = m;
      ids = m === 'born' ? born : m === 'died' ? died : all; fill(true);
    });
    ids = mode === 'born' ? born : mode === 'died' ? died : all;
    el._seg = seg;
    fill(false);
    moreBtn.addEventListener('click', () => add(false));
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && !el.hidden) { if (shown < ids.length) add(false); } }, { rootMargin: '800px 0px' }).observe(moreBtn.parentNode);
    ol.addEventListener('click', (ev) => {
      const li = ev.target.closest('li.e'); if (!li) return;
      pushView({ t: 'rec', i: Number(li.dataset.i) });
    });
    return el;
  }
  function pushView(desc, fromPop) {
    if (desc.t === 'rec' && !DATA[desc.i]) return;
    if (desc.t === 'place' && !PL[desc.k]) return;
    closePanel(true); stopPlay();
    const top = nav[nav.length - 1];
    top.scroll = window.scrollY;
    const el = desc.t === 'rec' ? buildRecView(desc) : buildPlaceView(desc);
    top.el.hidden = true;
    nav.push({ desc, el, scroll: 0 });
    window.scrollTo(0, 0);
    if (el._seg) el._seg.place(false);
    if (!fromPop) { try { history.pushState({ d: nav.length - 1, desc }, '', hashOf(desc)); } catch (e) {} }
    if (canAnimate()) M.animate(el, { opacity: [0, 1], x: [24, 0] }, { duration: 0.32, ease: EASE });
  }
  function popView() {
    if (nav.length < 2) return;
    const gone = nav.pop(), prev = nav[nav.length - 1];
    prev.el.hidden = false;
    window.scrollTo(0, prev.scroll);
    const done = () => gone.el.remove();
    gone.el.style.position = 'absolute'; gone.el.style.inset = '0 0 auto'; gone.el.style.width = '100%';
    if (canAnimate()) M.animate(gone.el, { opacity: [1, 0], x: [0, 20] }, { duration: 0.2 }).then(done); else done();
    if (prev.el === homeEl) { drawPattern(false); }
    else if (prev.el._seg) prev.el._seg.place(false);
  }
  window.addEventListener('popstate', (e) => {
    if (!e.state || typeof e.state.d !== 'number') return; // fragment navigation: handled by hashchange
    const d = e.state.d;
    while (nav.length - 1 > d) popView();
    if (nav.length - 1 < d && e.state.desc) pushView(e.state.desc, true);
  });
  function parseHash(h) {
    let m = h.match(/^#i(\d+)$/); if (m && DATA[Number(m[1])]) return { t: 'rec', i: Number(m[1]) };
    m = h.match(/^#p=(.+)$/); if (m) { try { const k = decodeURIComponent(m[1]); if (PL[k]) return { t: 'place', k }; } catch (e) {} }
    return null;
  }
  window.addEventListener('hashchange', () => { if (history.state && typeof history.state.d === 'number') return; const d = parseHash(location.hash); if (d) { try { history.replaceState({ d: nav.length - 1, desc: nav[nav.length - 1].desc }, '', location.href); } catch (e) {} pushView(d); } });

  /* ---------- inputs ---------- */
  let tmr;
  q.addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => { st.limit = PAGE; st.open.clear(); run(true); }, 120);
  });
  q.addEventListener('focus', () => { $('kbd').hidden = true; });
  q.addEventListener('blur', () => { $('kbd').hidden = !!q.value; });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (q.value) { q.value = ''; st.open.clear(); run(true); } else q.blur(); }
    if (e.key === 'Enter') {
      clearTimeout(tmr);
      if (st.deep) { e.preventDefault(); startFT(); }
      q.blur();
    }
  });
  $('clear').addEventListener('click', () => { q.value = ''; st.limit = PAGE; st.open.clear(); run(true); q.focus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]') && nav.length === 1) {
      e.preventDefault(); q.focus(); q.select();
    } else if (e.key === 'Escape' && nav.length > 1 && !document.querySelector('dialog[open]') && !panelOpen) history.back();
  });
  $('random').addEventListener('click', () => {
    if (!DATA.length) return;
    pushView({ t: 'rec', i: Math.floor(Math.random() * DATA.length) });
    if (canAnimate()) M.animate($('random').querySelector('svg'), { rotate: [0, 180] }, { duration: 0.5, ease: EASE });
  });

  /* ---------- full-text search ---------- */
  let ftToken = 0, ftCtl = null;
  function setDeep(on) {
    st.deep = on; $('deep').checked = on;
    if (!on) cancelFT(true);
    updateFtBar();
  }
  $('deep').addEventListener('change', () => { setDeep($('deep').checked); if (!st.deep) { st.limit = PAGE; run(true); } });
  function updateFtBar(msg) {
    const bar = $('ftbar');
    bar.hidden = !st.deep;
    if (!st.deep) return;
    if (msg !== undefined) { $('ft-t').innerHTML = msg; return; }
    if (!st.ft) {
      const qa = nAr(q.value);
      $('ft-t').innerHTML = /[ء-ي]/.test(qa) ? 'Press Enter to search the text of every entry' + (st.vol !== null || filtersActive() ? ' within the current filters' : '') + '.' : 'Type Arabic words, then press Enter to search inside the entries.';
      $('ft-go').hidden = false; $('ft-stop').hidden = true; $('ft-track').hidden = true;
    }
  }
  function cancelFT(silent) {
    ftToken++;
    if (ftCtl) { try { ftCtl.abort(); } catch (e) {} ftCtl = null; }
    const was = st.ft; st.ft = false;
    if (was && !silent) { $('ft-stop').hidden = true; $('ft-go').hidden = false; }
    if (silent) { $('ft-track').hidden = true; $('ft-stop').hidden = true; $('ft-go').hidden = false; }
  }
  $('ft-go').addEventListener('click', () => startFT());
  $('ft-stop').addEventListener('click', () => {
    const n = st.hits.length; ftToken++; if (ftCtl) { try { ftCtl.abort(); } catch (e) {} ftCtl = null; }
    $('ft-stop').hidden = true; $('ft-go').hidden = false; $('ft-track').hidden = true;
    updateFtBar('Search cancelled. <b>' + fmt(n) + '</b> ' + (n === 1 ? 'entry' : 'entries') + ' found so far.');
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  async function startFT() {
    const qa = nAr(q.value);
    if (!/[ء-ي]/.test(qa) || qa.length < 2) { updateFtBar(); toast('Type at least two Arabic letters'); return; }
    ftToken++; const my = ftToken;
    if (ftCtl) { try { ftCtl.abort(); } catch (e) {} }
    ftCtl = new AbortController();
    st.ft = true; st.ftq = qa; st.hits = []; st.snips = new Map(); st.open.clear(); st.limit = PAGE;
    list.innerHTML = ''; $('empty').hidden = true; updateCount();
    $('ft-go').hidden = true; $('ft-stop').hidden = false; $('ft-track').hidden = false; $('ft-fill').style.width = '0%';
    // volumes in scope
    const byVol = new Map();
    DATA.forEach((o) => { if (pass(o)) { if (!byVol.has(o.vol)) byVol.set(o.vol, new Set()); byVol.get(o.vol).add(String(o.i)); } });
    const vols = [...byVol.keys()].sort((a, b) => a - b);
    let shownN = 0;
    const flush = () => {
      if (shownN < st.hits.length && shownN < st.limit) {
        const from = shownN; shownN = Math.min(st.hits.length, st.limit); appendRows(from, shownN, from === 0);
      }
      updateCount();
    };
    for (let vi = 0; vi < vols.length; vi++) {
      if (my !== ftToken) return;
      const v = vols[vi], ids = byVol.get(v);
      updateFtBar('Searching volume <b>' + (vi + 1) + '</b> of ' + vols.length + '… <span class="sub">(' + fmt(st.hits.length) + ' found)</span>');
      $('ft-fill').style.width = (vi / vols.length * 100).toFixed(1) + '%';
      let vd;
      try {
        vd = volMem.get(v) || await loadVol(v, { keep: false, signal: ftCtl.signal });
      } catch (err) {
        if (my !== ftToken) return;
        st.ft = false;
        $('ft-stop').hidden = true; $('ft-go').hidden = false; $('ft-track').hidden = true;
        updateFtBar('Volume ' + v + ' could not be loaded' + (navigator.onLine ? '' : ' (offline and not downloaded yet; see Settings)') + '. <b>' + fmt(st.hits.length) + '</b> found before that.');
        return;
      }
      let t0 = performance.now();
      for (const key of ids) {
        const e = vd.e[key]; if (!e) continue;
        const s = norm(e.t);
        let p = s.indexOf(qa);
        if (p < 0) { if (performance.now() - t0 > 30) { await tick(); if (my !== ftToken) return; t0 = performance.now(); } continue; }
        let n = 0, p2 = p; while (p2 > -1) { n++; p2 = s.indexOf(qa, p2 + qa.length); }
        // snippet around the first match (MAP is still valid for this entry)
        let a = Math.max(0, p - 55), b = Math.min(s.length, p + qa.length + 55);
        if (a > 0) { const sp = s.indexOf(' ', a); if (sp > -1 && sp < p) a = sp + 1; }
        if (b < s.length) { const sp = s.lastIndexOf(' ', b); if (sp > p + qa.length) b = sp; }
        const oa = MAP[a]; let ob = MAP[b - 1];
        while (ob + 1 < e.t.length && isDiac(e.t.charCodeAt(ob + 1))) ob++;
        const posOrig = MAP[p];
        let pg = DATA[key].ref;
        const mk = e.t.lastIndexOf('⟦', posOrig);
        if (mk > -1) { const mm = /^⟦(\d+:\d+)⟧/.exec(e.t.slice(mk, mk + 16)); if (mm) pg = mm[1]; }
        const raw = e.t.slice(oa, ob + 1).replace(/⟦[^⟧]*⟧/g, ' ').replace(FN, '').trim();
        st.snips.set(Number(key), { html: (a > 0 ? '… ' : '') + hlAr(raw, qa, true) + (b < s.length ? ' …' : ''), n, pg });
        st.hits.push(DATA[key]);
        if (performance.now() - t0 > 30) { flush(); await tick(); if (my !== ftToken) return; t0 = performance.now(); }
      }
      st.hits.sort((x, y) => x.i - y.i);
      // keep rendered rows in order: re-render when new hits landed before already shown ones
      shownN = 0; list.innerHTML = ''; flush();
    }
    if (my !== ftToken) return;
    $('ft-fill').style.width = '100%';
    st.ft = true; // results stay "full-text" until the query changes
    $('ft-stop').hidden = true; $('ft-go').hidden = false; $('ft-track').hidden = true;
    const n = st.hits.length;
    updateFtBar(n ? 'Found <b>' + fmt(n) + '</b> ' + (n === 1 ? 'entry' : 'entries') + ' with “' + esc(q.value.trim()) + '” in the text.' : 'No entry contains that phrase. Try fewer words.');
    updateCount();
    if (!n) { $('empty').hidden = false; $('empty-actions').innerHTML = ''; $('empty-t').textContent = 'No entry text contains that phrase.'; }
  }

  /* ---------- sticky deck and filter dropdown (as in the Ikmāl index) ---------- */
  const deck = $('deck'), topBtn = $('top'), fbtn = $('filters');
  const fold = $('fold'), home = $('filters-home'), panel = $('panel'), panelIn = $('panel-in');
  let topShown = false, panelOpen = false, homeVisible = true;
  function openPanel() {
    if (panelOpen) return;
    panelOpen = true;
    home.style.minHeight = home.offsetHeight + 'px';
    panelIn.appendChild(fold);
    panel.hidden = false;
    fbtn.setAttribute('aria-expanded', 'true'); fbtn.setAttribute('aria-label', 'Hide filters');
    if (canAnimate()) M.animate(panel, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.22, ease: EASE });
  }
  function closePanel(instant) {
    if (!panelOpen) return;
    panelOpen = false;
    fbtn.setAttribute('aria-expanded', 'false'); fbtn.setAttribute('aria-label', 'Show filters');
    const done = () => { panel.hidden = true; panel.style.opacity = ''; panel.style.transform = ''; home.appendChild(fold); home.style.minHeight = ''; };
    if (!instant && canAnimate()) M.animate(panel, { opacity: 0, y: -6 }, { duration: 0.16 }).then(done); else done();
  }
  fbtn.addEventListener('click', () => {
    if (panelOpen) { closePanel(); return; }
    if (homeVisible) { if (canAnimate()) M.animate(fold, { opacity: [0.4, 1] }, { duration: 0.4 }); return; }
    openPanel();
  });
  document.addEventListener('pointerdown', (e) => { if (panelOpen && !panel.contains(e.target) && !fbtn.contains(e.target)) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(); });
  fold.addEventListener('click', (e) => {
    if (!panelOpen || !e.target.closest('.chip')) return;
    requestAnimationFrame(() => {
      const y = home.getBoundingClientRect().bottom + window.scrollY - deck.offsetHeight - (parseFloat(getComputedStyle(document.documentElement).paddingTop) || 0);
      if (window.scrollY > y) window.scrollTo({ top: y, behavior: 'auto' });
    });
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { es.forEach((e) => { deck.classList.toggle('stuck', !e.isIntersecting); }); }, { threshold: 0 }).observe($('deck-top'));
    new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (homeEl.hidden) return;
        homeVisible = e.isIntersecting;
        fbtn.classList.toggle('on', !homeVisible && filtersActive());
        if (homeVisible && panelOpen) closePanel(true);
      });
    }, { rootMargin: '-120px 0px 0px 0px' }).observe(home);
  }
  function onScroll() {
    const show = window.scrollY > 900;
    if (show !== topShown) {
      topShown = show;
      if (show) { topBtn.hidden = false; if (canAnimate()) M.animate(topBtn, { opacity: [0, 1], scale: [0.8, 1] }, { type: 'spring', stiffness: 500, damping: 30 }); }
      else if (canAnimate()) M.animate(topBtn, { opacity: 0, scale: 0.8 }, { duration: 0.15 }).then(() => { if (!topShown) topBtn.hidden = true; });
      else topBtn.hidden = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }));

  /* ---------- dialogs ---------- */
  function openDialog(d) {
    if (typeof d.showModal !== 'function') return;
    d.showModal();
    themeSeg.place(false); sizeSeg.place(false);
    if (canAnimate()) M.animate(d, { opacity: [0, 1], y: [16, 0], scale: [0.98, 1] }, { type: 'spring', stiffness: 380, damping: 32 });
  }
  $('settings').addEventListener('click', () => { openDialog($('dlg-settings')); refreshDl(); });
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  /* ---------- offline: service worker, volume downloads, status ---------- */
  const status = $('status'), statusT = $('status-t');
  let swReady = false, storedVols = 0;
  function setStatus(s, t) { status.dataset.s = s; statusT.textContent = t; }
  function refreshStatus() {
    if (!swReady) { setStatus('loading', navigator.onLine ? 'Preparing offline copy…' : 'Offline'); return; }
    const full = storedVols >= NVOL;
    if (!navigator.onLine) setStatus('offline', 'Offline · ' + (full ? 'full text stored' : storedVols + ' of ' + NVOL + ' volumes stored'));
    else setStatus('ready', 'Available offline' + (full ? ' · full text' : ''));
    status.title = storedVols + ' of ' + NVOL + ' volume files stored for offline reading';
  }
  window.addEventListener('online', refreshStatus);
  window.addEventListener('offline', refreshStatus);

  async function cachedVols() {
    const have = new Set();
    try {
      for (const k of await caches.keys()) {
        if (!k.startsWith('siyar-vols-')) continue;
        const c = await caches.open(k);
        for (const r of await c.keys()) { const m = r.url.match(/vol(\d+)\.json$/); if (m) have.add(Number(m[1])); }
      }
    } catch (e) {}
    return have;
  }
  async function refreshDl() {
    const have = await cachedVols();
    storedVols = have.size; refreshStatus();
    let bytes = 0; have.forEach((v) => { bytes += INDEX.vols[volName(v)] || 0; });
    const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
    let txt = '<b>' + have.size + ' of ' + NVOL + '</b> volumes stored (' + mb(bytes) + ').';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        txt += ' This site uses ' + mb(est.usage || 0) + ' of the device storage' + (est.quota ? ' (quota ' + (est.quota / 1073741824).toFixed(1) + ' GB)' : '') + '.';
      }
      if (navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()) txt += ' Storage is marked persistent.';
    } catch (e) {}
    $('dl-state').innerHTML = txt;
    $('dl-go').disabled = have.size >= NVOL;
    $('dl-go').textContent = have.size >= NVOL ? 'Everything is downloaded' : 'Download everything for offline';
    $('dl-rm').disabled = !have.size;
  }
  let dlCtl = null;
  $('dl-go').addEventListener('click', async () => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) { toast('Offline setup is not finished yet. Try again in a moment.'); return; }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    const have = await cachedVols();
    dlCtl = new AbortController();
    $('dl-prog').hidden = false; $('dl-go').hidden = true; $('dl-stop').hidden = false;
    let total = 0, done = 0;
    for (let v = 0; v < NVOL; v++) if (!have.has(v)) total += INDEX.vols[volName(v)];
    const fill = $('dl-fill'), t = $('dl-t');
    let fails = 0, vi = 0;
    for (let v = 0; v < NVOL; v++) {
      if (have.has(v)) continue;
      vi++;
      let last = 0;
      try {
        await fetchBytes('data/full/' + volName(v) + '.json', INDEX.vols[volName(v)], (g) => { done += g - last; last = g; fill.style.width = Math.min(100, done / total * 100).toFixed(1) + '%'; t.textContent = 'Volume ' + (v + 1) + ' of ' + NVOL + ' · ' + (done / 1048576).toFixed(1) + ' of ' + (total / 1048576).toFixed(1) + ' MB'; }, dlCtl.signal);
      } catch (err) {
        if (dlCtl.signal.aborted) break;
        fails++; done += INDEX.vols[volName(v)] - last;
      }
    }
    const aborted = dlCtl.signal.aborted; dlCtl = null;
    $('dl-go').hidden = false; $('dl-stop').hidden = true;
    await refreshDl();
    $('dl-prog').hidden = aborted ? false : true;
    toast(aborted ? 'Download cancelled' : fails ? fails + ' volume(s) failed. Try again.' : 'Everything is stored for offline use');
  });
  $('dl-stop').addEventListener('click', () => { if (dlCtl) dlCtl.abort(); });
  $('dl-rm').addEventListener('click', async () => {
    try { for (const k of await caches.keys()) if (k.startsWith('siyar-vols-')) await caches.delete(k); } catch (e) {}
    volMem.clear();
    $('dl-prog').hidden = true;
    await refreshDl();
    toast('Downloaded volumes removed');
  });

  const canSW = 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.isSecureContext;
  if (canSW) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const markReady = () => { swReady = true; refreshStatus(); if (INDEX) cachedVols().then((h) => { storedVols = h.size; refreshStatus(); }); };
      navigator.serviceWorker.ready.then(markReady);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version of the reader is ready.', 'Reload', () => { status.dataset.updating = '1'; nw.postMessage('skip-waiting'); });
          }
        });
      });
    }).catch(() => setStatus('loading', 'Online only in this browser'));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !navigator.serviceWorker.controller) return;
      if (status.dataset.updating === '1') { reloading = true; location.reload(); }
    });
  } else setStatus('loading', 'Open over https to save offline');

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;
  const installBtn = $('install');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone) revealInstall(); });
  function revealInstall() {
    if (!installBtn.hidden) return;
    installBtn.hidden = false;
    if (canAnimate()) M.animate(installBtn, { opacity: [0, 1], scale: [0.9, 1] }, { type: 'spring', stiffness: 420, damping: 26 });
  }
  if (isIOS && !standalone && canSW) revealInstall();
  installBtn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => null);
      deferred = null;
      if (r && r.outcome === 'accepted') installBtn.hidden = true;
    } else if (isIOS) openDialog($('dlg-ios'));
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('Installed. Open it from your home screen.'); });

  /* ---------- boot ---------- */
  function prepare(raw, idx) {
    INDEX = idx; PL = raw.P; FIELDS = raw.F; MADS = raw.M;
    const K = raw.K;
    DATA = raw.S.map((r, i) => {
      const o = {}; K.forEach((k, j) => { o[k] = r[j]; });
      o.i = i; o.f = o.f || []; o.m = o.m || []; o.tea = o.tea || []; o.stu = o.stu || []; o.bk = o.bk || [];
      const ix = idx.i[String(i)] || [0, 'm', 0];
      o.vol = ix[0]; o.st2 = ix[1]; o.chars = ix[2];
      o._h = nAr(o.n); o._l = nAr(o.lead || '');
      o._en = o.en ? nEn(o.en) : '';
      o._st = o.st && o.sl !== 'ar' ? nEn(o.st) : '';
      o._pl = nEn((PL[o.o] ? PL[o.o][0] : '') + ' ' + (PL[o.dp] ? PL[o.dp][0] : ''));
      const m = /^(\d+):(\d+)$/.exec(o.ref || ''); o.rv = m ? Number(m[1]) : null; o.rp = m ? Number(m[2]) : null;
      if (m) (BYVOL[o.rv] = BYVOL[o.rv] || []).push(o);
      if (o.o) { if (!BORN.has(o.o)) BORN.set(o.o, []); BORN.get(o.o).push(i); }
      if (o.dp) { if (!DIED.has(o.dp)) DIED.set(o.dp, []); DIED.get(o.dp).push(i); }
      return o;
    });
    buildFilters();
    run(true);
    const d = parseHash(location.hash);
    try { history.replaceState({ d: 0, desc: { t: 'home' } }, '', location.pathname + location.search); } catch (e) {}
    if (d) pushView(d);
    cachedVols().then((h) => { storedVols = h.size; refreshStatus(); });
  }
  function intro() {
    drawPattern(true);
    if (!canAnimate()) return;
    M.animate([$('t-ar'), $('t-en'), $('t-meta'), $('facts')], { opacity: [0, 1], y: [10, 0] }, { delay: M.stagger(0.07), duration: 0.6, ease: EASE });
    M.animate(deck, { opacity: [0, 1] }, { duration: 0.5, delay: 0.25 });
  }
  if (matchMedia('(max-width: 600px)').matches) q.placeholder = 'ابحث… name, 42, 12:345';
  const ready = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]) : Promise.resolve();
  ready.then(() => { intro(); });

  Promise.all([
    fetch('data/siyar.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch('data/full/index.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  ]).then(([raw, idx]) => prepare(raw, idx)).catch(() => {
    $('empty').hidden = false;
    $('empty-t').textContent = 'The entry list could not load. Check your connection and reload; after one successful visit it works offline.';
  });
  window.__siyar = { get data() { return DATA; }, st, nav };
})();
