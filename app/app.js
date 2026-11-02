/* Al-Ikmāl Narrator Index: offline app logic.
   Search normalisation and ranking follow the original index; the rest adds offline install,
   saved narrators, reading settings, deep links and motion. */
(function () {
  'use strict';

  const M = window.Motion || null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canAnimate = () => M && !reduceMotion.matches;
  const EASE = [0.2, 0.8, 0.2, 1];
  const $ = (id) => document.getElementById(id);

  /* ---------- storage (best effort) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ikmal-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ikmal-' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- constants ---------- */
  const CAT = {
    s: ['Companions', 'الصحابة'],
    t: ['Successors', 'التابعون'],
    sf: ['Women Companions', 'الصحابيات'],
    tf: ['Women Successors', 'التابعيات'],
    a: ['Imams of the Uṣūl', 'أئمة الأصول']
  };
  const LETTERS = ['الهمزة','الباء','التاء','الثاء','الجيم','الحاء','الخاء','الدال','الذال','الراء','الزاي','السين','الشين','الصاد','الضاد','الطاء','الظاء','العين','الغين','الفاء','القاف','الكاف','اللام','الميم','النون','الواو','الهاء','الياء'];
  const SHORT = {'الهمزة':'أ','الباء':'ب','التاء':'ت','الثاء':'ث','الجيم':'ج','الحاء':'ح','الخاء':'خ','الدال':'د','الذال':'ذ','الراء':'ر','الزاي':'ز','السين':'س','الشين':'ش','الصاد':'ص','الضاد':'ض','الطاء':'ط','الظاء':'ظ','العين':'ع','الغين':'غ','الفاء':'ف','القاف':'ق','الكاف':'ك','اللام':'ل','الميم':'م','النون':'ن','الواو':'و','الهاء':'هـ','الياء':'ي'};
  const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  const PAGE = 60;

  /* ---------- normalisation ---------- */
  const AD = /[ً-ٰٟـۖ-ۭ]/g;
  function nAr(s) {
    return s.replace(AD, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '').replace(/ﷺ/g, '')
      .replace(/[^ء-ي0-9a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function nEn(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʿʾ'‘’`]/g, '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const toLatDig = (s) => s.replace(/[٠-٩]/g, (d) => AR_DIG.indexOf(d));
  const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIG[d]);
  const fmt = (n) => n.toLocaleString('en');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function hlAr(text, qa) {
    if (!qa) return esc(text);
    let norm = ''; const map = [];
    for (let i = 0; i < text.length; i++) {
      const n = nAr(text[i]);
      if (text[i] === ' ' || !n) { if (/\s/.test(text[i])) { norm += ' '; map.push(i); } continue; }
      for (const ch of n) { norm += ch; map.push(i); }
    }
    return paint(text, norm, map, qa, true);
  }
  function hlEn(text, qe) {
    if (!qe) return esc(text);
    let norm = ''; const map = [];
    for (let i = 0; i < text.length; i++) {
      const n = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʿʾ'‘’`]/g, '').toLowerCase();
      for (const ch of n) { norm += /[a-z0-9]/.test(ch) ? ch : ' '; map.push(i); }
    }
    return paint(text, norm, map, qe, false);
  }
  function paint(text, norm, map, q, ar) {
    const marks = new Array(text.length).fill(false);
    q.split(' ').filter((w) => w.length > 1).forEach((w) => {
      let p = 0;
      while ((p = norm.indexOf(w, p)) > -1) {
        if (ar) { const a = map[p], b = map[p + w.length - 1]; for (let k = a; k <= b; k++) marks[k] = true; }
        else for (let k = p; k < p + w.length; k++) marks[map[k]] = true;
        p += w.length;
      }
    });
    let out = '', on = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] && !on) { out += '<mark>'; on = true; }
      if (!marks[i] && on) { out += '</mark>'; on = false; }
      out += esc(text[i]);
    }
    return on ? out + '</mark>' : out;
  }

  function score(o, qa, qe, num, deep) {
    if (num !== null) return (o.n === num || (o.nl && o.nl.includes(String(num)))) ? 100 : 0;
    let s = 0;
    if (qa) {
      if (o._h === qa) s = 100;
      else if (o._h.startsWith(qa)) s = 90;
      else if (o._h.includes(qa)) s = 80;
      else if (o._f.includes(qa)) s = 65;
      else {
        const ws = qa.split(' ');
        if (ws.length > 1 && ws.every((w) => o._f.includes(w) || o._h.includes(w))) s = 55;
        else if (deep && ws.every((w) => o._a.includes(w))) s = 30;
      }
    }
    if (qe) {
      if (o._en.startsWith(qe)) s = Math.max(s, 85);
      else if (o._en.includes(qe)) s = Math.max(s, 75);
      else {
        const ws = qe.split(' ');
        if (ws.every((w) => o._en.includes(w))) s = Math.max(s, 60);
        else if (deep && ws.every((w) => o._e.includes(w))) s = Math.max(s, 30);
      }
    }
    return s;
  }

  /* ---------- state ---------- */
  let DATA = [];
  let BYID = new Map();
  const st = {
    cat: 'all', letter: 'all', limit: PAGE, hits: [], qe: '', qa: '',
    lang: ['en', 'ar', 'both'].includes(store.get('lang', 'en')) ? store.get('lang', 'en') : 'en',
    saved: new Set(store.get('saved', [])),
    open: new Set()
  };

  const q = $('q'), list = $('list');

  /* ---------- segmented controls with a sliding thumb ---------- */
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

  let patternT = 0;
  /* ---------- theme & size ---------- */
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

  const langSeg = segInit($('lang'), 'l', st.lang, (v) => {
    st.lang = v; store.set('lang', v);
    list.querySelectorAll('li.open').forEach((li) => {
      const o = BYID.get(li.dataset.id);
      const inner = li.querySelector('.inner');
      inner.innerHTML = bodyHtml(o);
      wireBody(li, o);
      const body = li.querySelector('.body');
      if (canAnimate()) M.animate(inner, { opacity: [0.35, 1] }, { duration: 0.25 });
      body.style.height = 'auto';
    });
  });

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
    rz = setTimeout(() => { drawPattern(false); langSeg.place(false); themeSeg.place(false); sizeSeg.place(false); }, 120);
  });

  /* ---------- filters ---------- */
  const cats = $('cats'), lw = $('letters');
  function buildFilters() {
    const counts = { all: DATA.length };
    DATA.forEach((o) => { counts[o.c] = (counts[o.c] || 0) + 1; });
    const defs = [['all', 'All']].concat(Object.entries(CAT).map(([k, v]) => [k, v[0]]));
    cats.innerHTML = defs.map(([k, lab]) =>
      '<button type="button" class="chip" data-k="' + k + '" aria-pressed="' + (k === st.cat) + '">' +
      esc(lab) + '<span class="n">' + fmt(counts[k] || 0) + '</span></button>').join('') +
      '<button type="button" class="chip saved" data-k="saved" aria-pressed="' + (st.cat === 'saved') + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>' +
      'Saved<span class="n" id="saved-n">' + st.saved.size + '</span></button>';
    cats.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      st.cat = b.dataset.k;
      cats.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      st.limit = PAGE; run(true);
    }));

    const lc = {}; DATA.forEach((o) => { if (o.l) lc[o.l] = (lc[o.l] || 0) + 1; });
    lw.innerHTML = '<button type="button" class="chip ar" data-l="all" aria-pressed="true" lang="ar">كل الحروف</button>' +
      LETTERS.map((L) => '<button type="button" class="chip ar" data-l="' + L + '" lang="ar" title="حرف ' + L + ' · ' + (lc[L] || 0) + '" aria-label="حرف ' + L + '" aria-pressed="false">' + SHORT[L] + '</button>').join('');
    lw.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      st.letter = b.dataset.l;
      lw.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      st.limit = PAGE; run(true);
    }));

    const letters = new Set(DATA.map((o) => o.l).filter(Boolean)).size;
    const pages = DATA.map((o) => o.p);
    $('facts').innerHTML =
      '<li><b>' + fmt(DATA.length) + '</b> biographies</li>' +
      '<li><b>' + Object.keys(CAT).length + '</b> sections</li>' +
      '<li><b>' + letters + '</b> letters</li>' +
      '<li>printed pp. <b>' + Math.min(...pages) + '–' + Math.max(...pages) + '</b></li>';
  }
  function setCatUI() { cats.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === st.cat))); }
  function setLetterUI() { lw.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.l === st.letter))); }

  /* ---------- search ---------- */
  function run(animate) {
    const raw = q.value.trim();
    $('clear').hidden = !raw; $('kbd').hidden = !!raw || document.activeElement === q;
    const t = toLatDig(raw);
    const num = /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
    let qa = num === null ? nAr(raw) : '';
    if (!/[ء-ي]/.test(qa)) qa = '';
    const qe = num === null && /[a-zA-Zāīūḥṣḍṭẓ]/.test(raw) ? nEn(raw) : '';
    const deep = $('deep').checked;
    let hits = DATA.filter((o) =>
      (st.cat === 'all' || (st.cat === 'saved' ? st.saved.has(o._id) : o.c === st.cat)) &&
      (st.letter === 'all' || o.l === st.letter));
    if (raw) {
      hits = hits.map((o) => [score(o, qa, qe, num, deep), o]).filter((x) => x[0] > 0)
        .sort((a, b) => b[0] - a[0] || a[1].n - b[1].n).map((x) => x[1]);
    }
    st.hits = hits; st.qe = qe; st.qa = qa;
    render(animate);
  }

  /* ---------- rendering ---------- */
  const ICON_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';
  const ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';

  function bodyHtml(o) {
    const ar = '<p class="arb" lang="ar" dir="rtl">' + hlAr(o.art, st.qa) + '</p>';
    const en = '<p class="en">' + hlEn(o.en, st.qe) + '</p>';
    const main = st.lang === 'ar' ? ar : st.lang === 'both' ? ar + '<div class="sep" aria-hidden="true"></div>' + en : en;
    const c = CAT[o.c];
    return main + '<div class="foot"><span class="ref">Entry ' + esc(o._lab) + ' · ' + c[0] + ' · printed page ' + o.p + ' / <span lang="ar">ص ' + arNum(o.p) + '</span></span>' +
      '<button class="btn" type="button" data-act="copy">' + ICON_COPY + '<span>Copy</span></button>' +
      (navigator.share ? '<button class="btn" type="button" data-act="share">' + ICON_SHARE + '<span>Share</span></button>' :
        '<button class="btn" type="button" data-act="link">' + ICON_LINK + '<span>Copy link</span></button>') + '</div>';
  }

  function rowHtml(o) {
    const c = CAT[o.c];
    const id = o._id;
    const saved = st.saved.has(id);
    return '<li class="e" id="n' + id + '" data-id="' + id + '">' +
      '<div class="head">' +
        '<span class="num">' + esc(o._lab) + '<small>p. ' + o.p + '</small></span>' +
        '<div class="names">' +
          '<button class="opener" type="button" aria-expanded="false" aria-controls="b' + id + '"><span class="ar-name" lang="ar">' + hlAr(o.ar, st.qa) + '</span></button>' +
          '<span class="ar-full" lang="ar">' + hlAr(o.full, st.qa) + '</span>' +
          '<span class="tags"><span class="cat ' + o.c + '">' + c[0] + '</span><span class="arx" lang="ar">' + c[1] + '</span>' +
          (o.l ? '<span class="arx" lang="ar">حرف ' + o.l + '</span>' : '') + '</span>' +
        '</div>' +
        '<div class="side"><button class="star" type="button" aria-pressed="' + saved + '" aria-label="' + (saved ? 'Remove from saved' : 'Save this narrator') + '">' + ICON_STAR + '</button>' + ICON_CHEV + '</div>' +
      '</div>' +
      '<div class="body" id="b' + id + '" role="region" aria-label="Biography ' + esc(o._lab) + '" hidden><div class="inner"></div></div>' +
    '</li>';
  }

  function appendRows(from, to, animate) {
    const slice = st.hits.slice(from, to);
    if (!slice.length) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = slice.map(rowHtml).join('');
    const nodes = [...tpl.content.children];
    list.appendChild(tpl.content);
    nodes.forEach((li) => {
      if (st.open.has(li.dataset.id)) openRow(li, false);
    });
    if (animate && canAnimate()) {
      const first = nodes.slice(0, 14);
      M.animate(first, { opacity: [0, 1], y: [8, 0] }, { delay: M.stagger(0.022), duration: 0.32, ease: EASE });
    }
  }

  function render(animate) {
    list.innerHTML = '';
    appendRows(0, st.limit, animate);
    if (st.hits.length === 1 && !st.open.has(st.hits[0]._id)) {
      const li = list.firstElementChild; if (li) openRow(li, false);
    }
    const total = DATA.length, n = st.hits.length;
    $('count').innerHTML = (n === total ? '<b>' + fmt(total) + '</b> narrators' : '<b>' + fmt(n) + '</b> of ' + fmt(total) + ' narrators');
    $('morewrap').hidden = n <= st.limit;
    const empty = $('empty'); empty.hidden = n > 0;
    if (!n) renderEmpty();
  }

  function renderEmpty() {
    const acts = $('empty-actions'); acts.innerHTML = '';
    const raw = q.value.trim();
    if (st.cat === 'saved' && !raw) {
      $('empty-t').textContent = 'No saved narrators yet. Tap the star on any entry to keep it here, ready offline.';
    } else {
      $('empty-t').textContent = 'No narrator matches that search. Try fewer letters, drop the “ال”, or search inside the biographies.';
    }
    const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
    if (raw && !$('deep').checked) add('Search inside biographies', () => { $('deep').checked = true; st.limit = PAGE; run(true); });
    if (st.cat !== 'all' || st.letter !== 'all') add('Search all sections', () => { st.cat = 'all'; st.letter = 'all'; setCatUI(); setLetterUI(); st.limit = PAGE; run(true); });
    if (canAnimate()) M.animate($('empty'), { opacity: [0, 1], y: [6, 0] }, { duration: 0.3, ease: EASE });
  }

  function wireBody(li, o) {
    li.querySelectorAll('.inner [data-act]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const act = b.dataset.act;
      const text = o._lab + ' – ' + o.ar + '\n\n' + (st.lang === 'ar' ? o.art : st.lang === 'both' ? o.art + '\n\n' + o.en : o.en) +
        '\n\n— al-Ikmāl fī Asmāʾ al-Rijāl, entry ' + o._lab + ', p. ' + o.p;
      const link = location.href.split('#')[0] + '#n' + o._id;
      if (act === 'share') {
        navigator.share({ title: o.ar + ' · al-Ikmāl ' + o._lab, text }).catch(() => {});
      } else {
        const payload = act === 'link' ? link : text;
        const done = act === 'link' ? 'Link copied' : 'Entry copied';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(payload).then(() => toast(done)).catch(() => selectFallback(li));
        } else selectFallback(li);
      }
    }));
  }
  function selectFallback(li) {
    const r = document.createRange(); r.selectNodeContents(li.querySelector('.inner'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    toast('Text selected. Press Ctrl/⌘+C to copy.');
  }

  function openRow(li, animate) {
    const o = BYID.get(li.dataset.id);
    const body = li.querySelector('.body'), inner = li.querySelector('.inner');
    inner.innerHTML = bodyHtml(o); wireBody(li, o);
    li.classList.add('open');
    li.querySelector('.opener').setAttribute('aria-expanded', 'true');
    body.hidden = false;
    st.open.add(li.dataset.id);
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
    st.open.delete(li.dataset.id);
    if (animate && canAnimate()) {
      const h = body.offsetHeight;
      M.animate(body, { height: [h, 0] }, { duration: 0.28, ease: EASE }).then(() => { if (!li.classList.contains('open')) body.hidden = true; });
    } else body.hidden = true;
  }

  list.addEventListener('click', (ev) => {
    const star = ev.target.closest('.star');
    const li = ev.target.closest('li.e');
    if (!li) return;
    if (star) { toggleSaved(li, star); return; }
    if (ev.target.closest('.body')) return;
    if (getSelection().toString()) return;
    if (li.classList.contains('open')) closeRow(li, true);
    else { openRow(li, true); setHash(li.dataset.id); }
  });

  function toggleSaved(li, btn) {
    const id = li.dataset.id;
    const on = !st.saved.has(id);
    if (on) st.saved.add(id); else st.saved.delete(id);
    store.set('saved', [...st.saved]);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Remove from saved' : 'Save this narrator');
    const n = $('saved-n'); if (n) n.textContent = st.saved.size;
    if (canAnimate()) {
      M.animate(btn.querySelector('svg'), on ? { scale: [1, 1.45, 1], rotate: [0, -18, 0] } : { scale: [1, 0.8, 1] }, { duration: 0.45, ease: EASE });
      if (n) M.animate(n, { scale: [1, 1.35, 1] }, { duration: 0.35 });
    }
    toast(on ? 'Saved to this device' : 'Removed from saved');
    if (st.cat === 'saved' && !on) {
      if (canAnimate()) M.animate(li, { opacity: 0, x: -16 }, { duration: 0.22 }).then(() => run(false));
      else run(false);
    }
  }

  /* ---------- infinite scroll ---------- */
  function more() {
    if (st.hits.length <= st.limit) return;
    const from = st.limit; st.limit += PAGE;
    appendRows(from, st.limit, false);
    $('morewrap').hidden = st.hits.length <= st.limit;
  }
  $('more').addEventListener('click', more);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: '800px 0px' }).observe($('sentinel'));
  }

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, action, fn) {
    const el = $('toast'), b = $('toast-b');
    $('toast-t').textContent = msg;
    b.hidden = !action; if (action) { b.textContent = action; b.onclick = () => { fn(); hideToast(); }; }
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

  /* ---------- deep links ---------- */
  function setHash(id) {
    try { history.replaceState(null, '', '#n' + id); } catch (e) {}
  }
  function goTo(id, scroll) {
    const o = BYID.get(String(id));
    if (!o) return false;
    st.cat = 'all'; st.letter = 'all'; setCatUI(); setLetterUI();
    q.value = /^\d+$/.test(o._id) ? o._id : o.ar;
    st.open.add(o._id); st.limit = PAGE;
    run(true);
    const li = document.getElementById('n' + o._id);
    if (li && scroll) setTimeout(() => li.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' }), 60);
    return true;
  }
  function fromHash() {
    const m = location.hash.match(/^#n([\w-]+)$/);
    if (m) goTo(m[1], true);
  }
  window.addEventListener('hashchange', fromHash);

  /* ---------- inputs ---------- */
  let tmr;
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { st.limit = PAGE; st.open.clear(); run(true); }, 120); });
  q.addEventListener('focus', () => { $('kbd').hidden = true; });
  q.addEventListener('blur', () => { $('kbd').hidden = !!q.value; });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (q.value) { q.value = ''; st.open.clear(); run(true); } else q.blur(); }
    if (e.key === 'Enter') { q.blur(); }
  });
  $('deep').addEventListener('change', () => { st.limit = PAGE; run(true); });
  $('clear').addEventListener('click', () => { q.value = ''; st.limit = PAGE; st.open.clear(); run(true); q.focus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
      e.preventDefault(); q.focus(); q.select();
    }
  });
  $('random').addEventListener('click', () => {
    const pool = DATA;
    const o = pool[Math.floor(Math.random() * pool.length)];
    q.value = ''; st.open.clear();
    goTo(o._id, false);
    setHash(o._id);
    const top = $('deck').offsetTop;
    if (window.scrollY > top) window.scrollTo({ top, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    if (canAnimate()) M.animate($('random').querySelector('svg'), { rotate: [0, 180] }, { duration: 0.5, ease: EASE });
  });

  /* dialogs */
  function openDialog(d) {
    if (typeof d.showModal !== 'function') return;
    d.showModal();
    themeSeg.place(false); sizeSeg.place(false);
    if (canAnimate()) M.animate(d, { opacity: [0, 1], y: [16, 0], scale: [0.98, 1] }, { type: 'spring', stiffness: 380, damping: 32 });
  }
  $('settings').addEventListener('click', () => openDialog($('dlg-settings')));
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  /* sticky deck shadow, compact filters on phones while scrolling down, back-to-top */
  const deck = $('deck'), topBtn = $('top'), fbtn = $('filters');
  const narrow = matchMedia('(max-width: 600px)');
  let topShown = false, lastY = 0, pinnedOpen = false;
  function setCompact(on) {
    if (deck.classList.contains('compact') === on) return;
    deck.classList.toggle('compact', on);
    fbtn.setAttribute('aria-expanded', String(!on));
    fbtn.setAttribute('aria-label', on ? 'Show filters' : 'Hide filters');
    if (!on) setTimeout(() => langSeg.place(false), 30);
  }
  fbtn.addEventListener('click', () => {
    const show = deck.classList.contains('compact');
    pinnedOpen = show; setCompact(!show);
  });
  function onScroll() {
    const y = window.scrollY;
    const stuck = y > deck.offsetTop - 1 && y > 0;
    deck.classList.toggle('stuck', stuck);
    if (narrow.matches && document.activeElement !== q) {
      if (!stuck) { pinnedOpen = false; setCompact(false); }
      else if (y > lastY + 6 && !pinnedOpen) setCompact(true);
      else if (y < lastY - 40) { setCompact(false); }
      if (Math.abs(y - lastY) > 300) pinnedOpen = false;
    } else if (!narrow.matches) setCompact(false);
    lastY = y;
    const show = y > 900;
    if (show !== topShown) {
      topShown = show;
      if (show) { topBtn.hidden = false; if (canAnimate()) M.animate(topBtn, { opacity: [0, 1], scale: [0.8, 1] }, { type: 'spring', stiffness: 500, damping: 30 }); }
      else if (canAnimate()) M.animate(topBtn, { opacity: 0, scale: 0.8 }, { duration: 0.15 }).then(() => { if (!topShown) topBtn.hidden = true; });
      else topBtn.hidden = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }));

  /* ---------- offline: service worker, status, install ---------- */
  const status = $('status'), statusT = $('status-t');
  const inlineData = !!$('data').textContent.trim();
  function setStatus(s, t) { status.dataset.s = s; statusT.textContent = t; }
  function refreshStatus(ready) {
    if (!navigator.onLine) setStatus('offline', 'Offline · all entries available');
    else if (ready) setStatus('ready', 'Available offline');
    else setStatus('loading', 'Preparing offline copy…');
  }
  window.addEventListener('online', () => refreshStatus(status.dataset.ready === '1'));
  window.addEventListener('offline', () => refreshStatus(true));

  const canSW = 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.isSecureContext;
  if (inlineData && !canSW) { status.dataset.ready = '1'; refreshStatus(true); }
  if (canSW) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const markReady = () => { status.dataset.ready = '1'; refreshStatus(true); };
      navigator.serviceWorker.ready.then(markReady);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version of the index is ready.', 'Reload', () => { status.dataset.updating = '1'; nw.postMessage('skip-waiting'); });
          }
        });
      });
    }).catch(() => {
      if (inlineData) { status.dataset.ready = '1'; refreshStatus(true); }
      else setStatus('loading', 'Online only in this browser');
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !navigator.serviceWorker.controller) return;
      if (status.dataset.updating === '1') { reloading = true; location.reload(); }
    });
  } else if (!inlineData) {
    setStatus('loading', 'Open over https to save offline');
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;
  const installBtn = $('install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    if (!standalone) revealInstall();
  });
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
  if (standalone) $('offline-info').textContent = 'Installed on this device. The whole index, your saved narrators and settings work without a connection.';

  /* ---------- boot ---------- */
  function prepare(raw) {
    DATA = raw;
    DATA.forEach((o, i) => {
      o._id = o.nl && !/^\d/.test(o.nl) ? 'x' + (i + 1) : String(o.n);
      o._h = nAr(o.ar); o._f = nAr(o.full); o._e = nEn(o.en); o._a = nAr(o.art || '');
      const m = o.en.match(/^(?:\[[^\]]*\]\s*)?(?:He|She|They) (?:is|are) ([^.;]+)/);
      o._en = nEn(m ? m[1] : o.en.slice(0, 140));
      o._lab = o.nl ? o.nl : String(o.n);
      BYID.set(o._id, o);
    });
    buildFilters();
    run(true);
    fromHash();
  }

  function intro() {
    drawPattern(true);
    if (!canAnimate()) return;
    const els = [$('t-ar'), $('t-en'), $('t-meta'), $('facts')];
    M.animate(els, { opacity: [0, 1], y: [10, 0] }, { delay: M.stagger(0.07), duration: 0.6, ease: EASE });
    M.animate(deck, { opacity: [0, 1] }, { duration: 0.5, delay: 0.25 });
  }

  if (narrow.matches) q.placeholder = 'ابحث… name or number';
  const ready = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]) : Promise.resolve();
  ready.then(() => { langSeg.place(false); intro(); });

  if (inlineData) {
    prepare(JSON.parse($('data').textContent));
  } else {
    fetch('data/ikmal.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(prepare).catch(() => {
      $('empty').hidden = false;
      $('empty-t').textContent = 'The narrator list could not load. Check your connection and reload; after one successful visit it works offline.';
    });
  }
})();
