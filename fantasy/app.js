/* Darul Uloom Fantasy League: screens. Rules live in core.js, numbers in config.js. */
(function () {
  'use strict';
  const CFG0 = window.FANTASY_CONFIG, C = window.FantasyCore, ST = window.FantasyStore;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = C.money;
  const POSN = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
  const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

  const S = {
    tab: (location.hash.slice(1) || 'pick'), store: null, raw: null, L: null, data: null, user: null, member: null,
    draft: null, draftGw: null, pendingOut: null,
    f: { pos: 'ALL', team: 'ALL', max: '', sort: 'price', q: '' },
    pointsGw: null, pointsUid: null, chart: 'total', totwGw: null, admin: { week: null, allow: null },
    offline: !navigator.onLine,
  };
  const D = {}; // derived data, rebuilt by compute()

  // ---------- small helpers ----------
  const cfg = () => ({ ...CFG0, secondChipsFromGw: (S.data && S.data.settings && S.data.settings.secondChipsFromGw) ?? CFG0.secondChipsFromGw });
  const fmtDate = (t) => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const until = (t) => {
    const ms = t - Date.now(); if (ms <= 0) return 'passed';
    const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), d = Math.floor(h / 24);
    return d >= 2 ? `in ${d} days` : h >= 1 ? `in ${h}h ${m}m` : `in ${m}m`;
  };
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };
  const P = (n) => S.L.players[n] || { name: n, pos: 'MID', team: null, start: 0 };
  const team = (name) => S.L.teams.find((t) => t.name === name) || { name, short: '—', crest: 'shield' };
  const short = (name) => (name ? S.L.short(name) : 'No team');
  // shortest label that is unique in the league: "Lakota", "Asjad", "Abdullah L." …
  let shortNames = null;
  const surname = (n) => {
    if (!shortNames) {
      shortNames = {};
      const names = Object.keys(S.L.players);
      const cands = (x) => { const w = x.split(' '); const out = []; if (w.length > 1 && w[w.length - 1].length > 2) out.push(w[w.length - 1]); out.push(w[0]); if (w.length > 1) out.push(`${w[0]} ${w[w.length - 1][0]}.`); out.push(x); return out; };
      const all = names.map(cands);
      names.forEach((x, i) => { shortNames[x] = all[i].find((c) => all.filter((o, j) => j !== i && o.slice(0, -1).includes(c)).length === 0) || x; });
    }
    return shortNames[n] || n;
  };
  const posChip = (pos) => `<span class="pos ${pos}">${pos}</span>`;
  const chg = (v, unit = '', inverse = false, txt) => {
    if (v == null || Number.isNaN(v)) return '<div class="chg flat">&nbsp;</div>';
    if (v === 0) return `<div class="chg flat">– ${txt || 'no change'}</div>`;
    const good = inverse ? v < 0 : v > 0;
    return `<div class="chg ${good ? '' : 'down'}">${v > 0 ? '↑' : '↓'} ${esc(Math.abs(v) + unit)}${txt ? ' ' + esc(txt) : ''}</div>`;
  };
  const chgM = (v, txt) => (v == null || Number.isNaN(v) ? '' : v === 0 ? `<div class="chg flat">– ${esc(txt)}</div>` : `<div class="chg ${v > 0 ? '' : 'down'}">${v > 0 ? '↑' : '↓'} ${money(Math.abs(v))} ${esc(txt)}</div>`);
  const stat = (label, v, change, id) => `<div class="stat"${id ? ` id="${id}"` : ''}><div class="label">${esc(label)}</div><div class="v num">${v}</div>${change || '<div class="chg flat">&nbsp;</div>'}</div>`;
  const meUid = () => S.user && S.user.uid;
  const myManager = () => (S.data && S.data.managers[meUid()]) || {};

  // crest shapes from the league's team sheets, drawn small as "shirts"
  const SHAPES = {
    shield: 'M50 3 L94 15 V58 C94 86 74 104 50 115 C26 104 6 86 6 58 V15 Z',
    roundel: 'M50 13 A46 46 0 1 1 49.99 13 Z',
    octagon: 'M93.4,77.0 L68.0,102.4 L32.0,102.4 L6.6,77.0 L6.6,41.0 L32.0,15.6 L68.0,15.6 L93.4,41.0 Z',
    arch: 'M8 113 V54 C8 30 28 14 50 4 C72 14 92 30 92 54 V113 Z',
  };
  const crest = (teamName, cls = 'shirt') => {
    const t = team(teamName), d = SHAPES[t.crest] || SHAPES.shield;
    return `<svg class="${cls}" viewBox="0 0 100 118" aria-hidden="true"><path d="${d}" fill="#171412" stroke="#f2ebdd" stroke-width="5"/><path d="${d}" fill="none" stroke="#d75b6e" stroke-width="2" transform="translate(9 10) scale(.82)"/><rect x="0" y="49" width="100" height="24" fill="#9b1b30"/><text x="50" y="68" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="21" fill="#f2ebdd">${esc(t.short || '')}</text></svg>`;
  };

  // ---------- derived data ----------
  function compute() {
    const L = S.L, data = S.data, c = cfg();
    const now = Date.now();
    D.gws = Object.keys(data.gws).map(Number).sort((a, b) => a - b);
    D.passed = (g) => { const x = data.gws[g]; return !!x && (x.locked || (x.deadline != null && x.deadline <= now)); };
    D.openGw = D.gws.find((g) => !D.passed(g)) ?? null;
    D.passedGws = D.gws.filter(D.passed);
    D.lastPassed = D.passedGws[D.passedGws.length - 1] ?? null;
    D.scoredGws = D.passedGws.filter((g) => L.weeks.includes(g));
    D.priceGw = D.openGw ?? ((D.lastPassed ?? 0) + 1);
    D.prices = C.pricesAt(L, data.priceUpdates, D.priceGw);
    D.wp = {};
    for (const w of L.weeks) D.wp[w] = C.weekPoints(L, data.sheets, w, c);
    // season points + form per player
    D.season = {};
    const lastWeeks = L.weeks.slice(-c.prices.formWeeks);
    for (const n of Object.keys(L.players)) {
      D.season[n] = {
        total: L.weeks.reduce((s, w) => s + (D.wp[w][n] ? D.wp[w][n].pts : 0), 0),
        form: lastWeeks.reduce((s, w) => s + (D.wp[w][n] ? D.wp[w][n].pts : 0), 0),
        played: L.weeks.reduce((s, w) => s + (D.wp[w][n] ? D.wp[w][n].played : 0), 0),
      };
    }
    // managers, replays and results
    D.managers = Object.values(data.managers).sort((a, b) => (a.joined || 0) - (b.joined || 0) || a.uid.localeCompare(b.uid));
    D.colour = {}; D.managers.forEach((m, i) => { D.colour[m.uid] = SERIES[i % SERIES.length]; });
    D.state = {}; D.results = {}; D.scores = {};
    const upTo = D.gws.filter((g) => g <= (D.openGw ?? D.lastPassed ?? 0));
    for (const m of D.managers) {
      const entries = {};
      for (const g of D.gws) if (data.entries[g] && data.entries[g][m.uid]) entries[g] = data.entries[g][m.uid];
      if (m.uid === meUid() && S.draft && S.draftGw === D.openGw) entries[D.openGw] = S.draft;
      const st = C.replay(L, c, { entries, gws: upTo, updates: data.priceUpdates, budgetHistory: data.settings.budgetHistory });
      D.state[m.uid] = st;
      D.results[m.uid] = {}; D.scores[m.uid] = {};
      for (const g of D.scoredGws) {
        const s = st[g];
        if (!s) continue;
        const r = C.scoreTeam(L, data.sheets, s.entry, { week: g, cfg: c, hits: s.hits, weekPts: D.wp[g] });
        D.scores[m.uid][g] = r; D.results[m.uid][g] = r.total;
      }
    }
    D.table = C.leagueTable(D.managers, D.results, D.scoredGws);
    D.standings = C.standings(L);
    // ownership + captaincy from the latest gameweek whose teams are visible
    D.ownGw = D.lastPassed;
    D.own = {}; D.caps = {};
    if (D.ownGw != null) {
      const es = D.managers.map((m) => D.state[m.uid] && D.state[m.uid][D.ownGw]).filter(Boolean).map((s) => s.entry);
      D.ownCount = es.length;
      for (const e of es) { for (const n of e.squad) D.own[n] = (D.own[n] || 0) + 1; D.caps[e.captain] = (D.caps[e.captain] || 0) + 1; }
    }
  }

  // ---------- my draft for the open gameweek ----------
  function savedEntry(gw) { return (S.data.entries[gw] || {})[meUid()] || null; }
  function initDraft() {
    if (D.openGw == null) { S.draft = null; S.draftGw = null; return; }
    if (S.draftGw === D.openGw && S.draft) return;
    const saved = savedEntry(D.openGw);
    const st = (D.state[meUid()] || {});
    const prev = D.gws.filter((g) => g < D.openGw).reverse().map((g) => st[g]).find(Boolean);
    let base = saved;
    if (!base && prev) { const e = prev.entry.chip === 'fh' ? null : prev.entry; base = e || baseBeforeFreeHit(); }
    S.draft = base ? { squad: base.squad.slice(), sub: base.sub, captain: base.captain, vice: base.vice, chip: saved ? saved.chip || null : null }
      : { squad: [], sub: null, captain: null, vice: null, chip: null };
    S.draftGw = D.openGw;
    compute();
  }
  function baseBeforeFreeHit() {
    const st = D.state[meUid()] || {};
    const g = D.gws.filter((x) => x < D.openGw).reverse().map((x) => st[x]).find((s) => s && s.entry.chip !== 'fh');
    return g ? g.entry : null;
  }
  const myState = () => (D.openGw != null ? (D.state[meUid()] || {})[D.openGw] : null);
  const freeMode = () => { const s = myState(); return !s || s.first || (S.draft && (S.draft.chip === 'wc' || S.draft.chip === 'fh')); };
  const dirty = () => {
    const s = savedEntry(D.openGw), d = S.draft;
    if (!d) return false;
    if (!s) return d.squad.length > 0;
    return s.squad.join() !== d.squad.join() || s.sub !== d.sub || s.captain !== d.captain || s.vice !== d.vice || (s.chip || null) !== (d.chip || null);
  };
  function draftErrors() {
    const st = myState();
    const spending = !!st && (st.first || st.transfers > 0);
    return C.validate(S.L, cfg(), S.draft, { bank: st ? st.bank : null, spending }).map((m) => m.replace(/from (.+)$/, (x, t) => `from ${t}`));
  }
  function autoRoles() {
    const d = S.draft, L = S.L, c = cfg();
    if (d.squad.length !== c.squadSize) return;
    if (!d.sub || !d.squad.includes(d.sub) || P(d.sub).pos === 'GK' || !C.formationOf(L, c, d.squad.filter((n) => n !== d.sub))) {
      const outs = d.squad.filter((n) => P(n).pos !== 'GK').sort((a, b) => D.prices[a] - D.prices[b]);
      const ok = outs.find((n) => C.formationOf(L, c, d.squad.filter((x) => x !== n)));
      if (ok) d.sub = ok;
    }
    const st = d.squad.filter((n) => n !== d.sub).sort((a, b) => D.prices[b] - D.prices[a]);
    if (!d.captain || !st.includes(d.captain)) d.captain = st.find((n) => n !== d.vice) || null;
    if (!d.vice || !st.includes(d.vice) || d.vice === d.captain) d.vice = st.find((n) => n !== d.captain) || null;
  }
  const maxPos = () => { const c = cfg(); const m = { GK: 1, DEF: 0, MID: 0, FWD: 0 }; c.formations.forEach((f) => { const [a, b, x] = f.split('-').map(Number); m.DEF = Math.max(m.DEF, a + 1); m.MID = Math.max(m.MID, b + 1); m.FWD = Math.max(m.FWD, x + 1); }); return m; };
  function canAdd(n) {
    const d = S.draft, c = cfg(), p = P(n);
    if (!p.team) return `${n} isn't in a team yet`;
    if (d.squad.includes(n)) return 'Already in your squad';
    if (d.squad.length >= c.squadSize) return `Your squad is full (${c.squadSize})`;
    const cnt = C.counts(S.L, d.squad);
    if (cnt[p.pos] >= maxPos()[p.pos]) return p.pos === 'GK' ? 'You already have a goalkeeper' : `No room for another ${POSN[p.pos].toLowerCase()}`;
    if (d.squad.filter((x) => P(x).team === p.team).length >= c.maxPerTeam) return `Max ${c.maxPerTeam} from ${p.team}`;
    return null;
  }

  // ---------- rendering: shell ----------
  function renderWho() {
    const w = $('#who');
    if (!S.user) { w.innerHTML = ''; return; }
    const m = myManager();
    w.innerHTML = `<b>${esc(m.teamName || S.user.displayName || S.user.email)}</b><span class="muted">${esc(S.user.email || '')}</span> · <button data-act="signout">Sign out</button>`;
  }
  function renderFoot() {
    const h = (S.L && S.L.config.launch && S.L.config.launch.opening_hadith) || null;
    $('#foot').innerHTML = (h ? `<p class="ar">${esc(h.arabic)}</p><p>“${esc(h.english)}”<br><span class="src">${esc(h.narrator)} · ${esc(h.source)}</span></p>` : '') +
      '<p class="small">Play with good intention. No entry fees, no money pot and no betting: any prizes come from the teacher or a sponsor, never from the players.</p>' +
      (ST.demo ? '<p class="small"><b>Demo mode</b>: sample results, nothing is saved.</p>' : '');
  }
  function setTabs() {
    const nav = $('#tabs');
    nav.hidden = !(S.user && S.member && myManager().teamName);
    $('[data-tab="admin"]').hidden = !S.store.isAdmin();
    $$('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
  }
  function banner() {
    const b = $('#banner');
    let html = '', cls = '';
    if (S.offline && S.data) { html = `Offline · showing data from ${fmtDate(S.data.synced)}`; cls = 'info'; }
    else if (S.data && D.openGw != null && S.member) {
      const g = S.data.gws[D.openGw];
      const left = g.deadline - Date.now();
      if (!savedEntry(D.openGw) && left < cfg().reminderHoursBeforeDeadline * 3600e3) {
        html = `Your team isn't saved for Week ${D.openGw} · deadline ${until(g.deadline)}${D.state[meUid()] && D.state[meUid()][D.openGw] && !D.state[meUid()][D.openGw].first ? ' (last week’s team will be used)' : ''} <button data-act="tab" data-tab="pick">Pick team</button>` +
          (('Notification' in window) && Notification.permission === 'default' ? ' <button data-act="notify">Remind me</button>' : '');
        maybeNotify(D.openGw, g.deadline);
      }
    }
    b.className = 'banner ' + cls; b.hidden = !html; b.innerHTML = html;
  }
  function maybeNotify(gw, deadline) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const key = `duf-notified-${gw}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    const body = `Your team isn't saved for Week ${gw}. Deadline ${fmtDate(deadline)}.`;
    navigator.serviceWorker && navigator.serviceWorker.ready.then((r) => r.showNotification('Darul Uloom Fantasy', { body, icon: 'icons/icon-192.png', tag: key })).catch(() => { try { new Notification('Darul Uloom Fantasy', { body }); } catch (e) { /* ignore */ } });
  }

  function render() {
    renderWho(); setTabs(); renderFoot();
    const main = $('#main');
    if (!S.user) return gateSignIn(main);
    if (S.member === false) return gatePrivate(main);
    if (!S.data) { main.innerHTML = '<p class="muted center pad">Loading…</p>'; return; }
    if (!myManager().teamName) return gateOnboard(main);
    banner();
    const fn = { pick: viewPick, transfers: viewTransfers, points: viewPoints, league: viewLeague, stats: viewStats, fixtures: viewFixtures, admin: viewAdmin }[S.tab] || viewPick;
    main.innerHTML = fn();
    after();
  }
  function after() { if (S.tab === 'league') bindChart(); }

  // ---------- gates ----------
  function gateSignIn(main) {
    main.innerHTML = `<div class="gate"><div class="card"><img src="icons/logo-256.jpg" alt="" width="96" height="96" style="border-radius:50%"><h1>Fantasy League</h1>
      <p>Pick 9 players from the Darul Uloom Winter League, captain one, and score points from every match.</p>
      ${S.authError ? `<p class="msgs"><li>${esc(S.authError)}</li></p>` : ''}
      <button class="btn primary" data-act="signin">Sign in with Google</button>
      <p class="small muted">Private league: only invited class members can play.</p></div></div>`;
  }
  function gatePrivate(main) {
    main.innerHTML = `<div class="gate"><div class="card"><h1>This league is private.</h1>
      <p>${esc(S.user.email)} isn't on the list of players. Ask the league admin to add your Google email, then sign in again.</p>
      <button class="btn" data-act="signout">Use a different account</button></div></div>`;
  }
  function gateOnboard(main) {
    const opts = Object.values(S.L.players).sort((a, b) => a.name.localeCompare(b.name)).map((p) => `<option>${esc(p.name)}</option>`).join('');
    main.innerHTML = `<div class="gate"><div class="card"><h1>Welcome</h1><p>Choose a name for your fantasy team. Everyone in the league will see it.</p>
      <label class="f">Team name<input type="text" id="tn" maxlength="30" placeholder="e.g. Barakah Boys"></label>
      <p></p><label class="f">Do you play in the league? (optional)<select id="tp"><option value="">No / not saying</option>${opts}</select></label>
      <p class="small muted">If you pick yourself, your player card gets a “That's you!” tag.</p>
      <button class="btn primary" data-act="onboard">Start</button></div></div>`;
  }

  // ---------- pitch ----------
  function pitchLines(names) {
    const by = { GK: [], DEF: [], MID: [], FWD: [] };
    names.forEach((n) => by[P(n).pos].push(n));
    return by;
  }
  function card(n, opts = {}) {
    if (!n) return `<button class="pc empty" ${opts.act || ''}>${crest(null)}<span class="nm">${esc(opts.label || 'Add')}</span><span class="sub2">${esc(opts.pos || '')}</span></button>`;
    const p = P(n), me = myManager().player === n && opts.owner === meUid();
    const capT = opts.armband ? `<span class="cap">${opts.mult === 3 ? '3×' : 'C'}</span>` : opts.captain ? '<span class="cap">C</span>' : opts.vice ? '<span class="cap v">V</span>' : '';
    return `<button class="pc${opts.out ? ' out' : ''}" data-act="${opts.actName || 'pinfo'}" data-p="${esc(n)}" aria-label="${esc(n)}">${capT}${me ? '<span class="tag you">That’s you!</span>' : ''}${opts.swap ? `<span class="sw">${opts.swap}</span>` : ''}${crest(p.team)}<span class="nm">${esc(surname(n))}</span><span class="sub2">${opts.line != null ? opts.line : ''}</span></button>`;
  }
  function pitch(starters, sub, cardOpts, formation, subLabel = 'Sub') {
    const by = pitchLines(starters);
    const line = (arr) => `<div class="line">${arr.map((n) => card(n, cardOpts(n))).join('')}</div>`;
    return `<div class="pitch">${formation ? `<div class="form">${esc(formation)}</div>` : ''}${line(by.GK)}${line(by.DEF)}${line(by.MID)}${line(by.FWD)}</div>
      <div class="bench"><span class="lbl">${esc(subLabel)}</span>${sub ? card(sub, cardOpts(sub)) : card(null, { label: 'Sub', pos: 'Outfield' })}</div>`;
  }

  // ---------- Pick Team ----------
  function deadlineLine() {
    if (D.openGw == null) return `<p class="muted">${D.gws.length ? 'No gameweek is open right now. The admin opens the next one with a deadline.' : 'The season hasn’t opened yet: the admin sets the Gameweek 1 deadline.'}</p>`;
    const g = S.data.gws[D.openGw];
    return `<p><b>Week ${D.openGw} deadline:</b> ${fmtDate(g.deadline)} <span class="muted">(${until(g.deadline)})</span></p>`;
  }
  function budgetBar(st) {
    if (!st) return '';
    const spent = st.budget - st.bank;
    const pct = Math.max(0, Math.min(100, (spent / st.budget) * 100));
    return `<div class="budget${st.bank < 0 ? ' over' : ''}"><div class="lbl"><span>Money left</span><b class="num">${money(st.bank)} of ${money(st.budget)}</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }
  function viewPick() {
    if (D.openGw == null) return `<div class="card"><h2>Pick Team</h2>${deadlineLine()}</div>` + (D.lastPassed != null ? myLastTeam() : '');
    const d = S.draft, st = myState(), c = cfg(), L = S.L;
    const starters = d.squad.filter((n) => n !== d.sub);
    const form = C.formationOf(L, c, starters);
    const errs = d.squad.length ? draftErrors() : [];
    const fm = freeMode();
    const used = st ? st.chipsUsed : {};
    const chipsUsedBefore = {};
    for (const [k, gs] of Object.entries(used || {})) chipsUsedBefore[k] = gs.filter((g) => g < D.openGw);
    const firstGw = (() => { const s = D.state[meUid()] || {}; return D.gws.find((g) => s[g]) ?? D.openGw; })();
    const avail = C.chipsAvailable(c, chipsUsedBefore, D.openGw, firstGw);
    // empty slots in free mode
    const cnt = C.counts(L, d.squad);
    const slots = fm && d.squad.length < c.squadSize ? `<p class="small muted">Squad: ${d.squad.length}/${c.squadSize} · GK ${cnt.GK}/1 · DEF ${cnt.DEF} · MID ${cnt.MID} · FWD ${cnt.FWD}. Tap <b>+</b> in the list to add players.</p>` : '';
    const opts = (n) => ({ owner: meUid(), captain: n === d.captain, vice: n === d.vice, line: money(D.prices[n] ?? P(n).start), actName: 'pmenu' });
    return `<div class="card"><div class="rowh"><h2>Pick Team · Week ${D.openGw}</h2>${!savedEntry(D.openGw) ? '<span class="tag">Not saved yet</span>' : dirty() ? '<span class="tag">Unsaved changes</span>' : '<span class="tag soft">Saved</span>'}</div>${deadlineLine()}
      <div class="stats">${stat('Team value', money(st ? st.value : 0), chgM(st && st.value != null ? Math.round((st.value - d.squad.reduce((s, n) => s + P(n).start, 0)) * 10) / 10 : null, 'since start'))}
      ${stat('In the bank', money(st ? st.bank : c.budget), '')}
      ${stat('Transfers', fm ? '∞' : `${st ? st.transfers : 0}/${st ? st.freeAvail : 0}`, st && st.hits ? `<div class="chg down">↓ ${st.hits} pts hit</div>` : `<div class="chg flat">${fm ? 'unlimited this week' : 'made / free'}</div>`)}</div>
      ${budgetBar(st)}${slots}
      <ul class="msgs">${errs.map((e) => `<li>${esc(e)}</li>`).join('') || (d.squad.length === c.squadSize ? '<li class="ok">Team is valid ✓</li>' : '')}</ul></div>
      <div class="grid2"><div>${pitch(starters, d.sub, opts, form)}
        <div class="card" style="margin-top:14px"><h3>Chips</h3><div class="chip-list">${Object.entries(c.chips).map(([k, ch]) => `<button class="chip" data-act="chip" data-chip="${k}" aria-pressed="${d.chip === k}" ${!avail[k] && d.chip !== k ? 'disabled' : ''} title="${esc(ch.blurb)}">${esc(ch.name)}</button>`).join('')}</div>
        <p class="small muted">${d.chip ? esc(c.chips[d.chip].blurb) : 'One chip a week. Each chip once per ' + (c.secondChipsFromGw ? 'half season' : 'season') + '.'}</p></div>
        <div class="btns"><button class="btn primary" data-act="save" ${!dirty() && savedEntry(D.openGw) ? 'disabled' : ''}>Save team</button>${dirty() ? '<button class="btn" data-act="reset">Undo changes</button>' : ''}</div>
        <p class="small muted">Tap a player to make them captain or vice-captain, or swap them with the sub.${fm ? ' Changes are free this week.' : ' Change players on the Transfers screen.'}</p></div>
      <div>${playerList(fm ? 'add' : 'view')}</div></div>`;
  }
  function myLastTeam() {
    const s = (D.state[meUid()] || {})[D.lastPassed];
    if (!s) return '';
    const e = s.entry;
    return `<div class="card"><h3>Your Week ${D.lastPassed} team</h3>${pitch(e.squad.filter((n) => n !== e.sub), e.sub, (n) => ({ owner: meUid(), captain: n === e.captain, vice: n === e.vice, line: money(D.prices[n]) }), C.formationOf(S.L, cfg(), e.squad.filter((n) => n !== e.sub)))}</div>`;
  }

  // the filterable player list
  function playerList(mode, onlyPos) {
    const f = S.f, L = S.L;
    const all = Object.values(L.players);
    let rows = all.filter((p) => (onlyPos ? p.pos === onlyPos : (f.pos === 'ALL' || p.pos === f.pos)) && (f.team === 'ALL' || p.team === f.team || (f.team === 'NONE' && !p.team)) &&
      (!f.max || (D.prices[p.name] ?? p.start) <= Number(f.max)) && (!f.q || C.fold(p.name).includes(C.fold(f.q))));
    const key = { price: (p) => D.prices[p.name] ?? p.start, points: (p) => D.season[p.name].total, form: (p) => D.season[p.name].form, owned: (p) => D.own[p.name] || 0 }[f.sort] || ((p) => 0);
    rows.sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
    const d = S.draft;
    const prices = [...new Set(all.map((p) => D.prices[p.name] ?? p.start))].sort((a, b) => a - b);
    const segPos = onlyPos ? '' : `<div class="seg" role="group" aria-label="Position">${['ALL', 'GK', 'DEF', 'MID', 'FWD'].map((x) => `<button data-act="fpos" data-v="${x}" aria-pressed="${f.pos === x}">${x === 'ALL' ? 'All' : x}</button>`).join('')}</div>`;
    return `<div class="card"><div class="rowh"><h3>${mode === 'swap' ? 'Choose a replacement' : 'Players'}</h3><span class="small muted">${rows.length} shown</span></div>
      <div class="filters">${segPos}
        <select data-change="fteam" aria-label="Team"><option value="ALL">All teams</option>${L.teams.map((t) => `<option value="${esc(t.name)}" ${f.team === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}<option value="NONE" ${f.team === 'NONE' ? 'selected' : ''}>Not in a team yet</option></select>
        <select data-change="fmax" aria-label="Max price"><option value="">Any price</option>${prices.map((x) => `<option value="${x}" ${Number(f.max) === x ? 'selected' : ''}>Up to ${money(x)}</option>`).join('')}</select>
        <select data-change="fsort" aria-label="Sort"><option value="price" ${f.sort === 'price' ? 'selected' : ''}>Sort: price</option><option value="points" ${f.sort === 'points' ? 'selected' : ''}>Sort: points</option><option value="form" ${f.sort === 'form' ? 'selected' : ''}>Sort: form</option><option value="owned" ${f.sort === 'owned' ? 'selected' : ''}>Sort: ownership</option></select>
        <input type="text" data-change="fq" placeholder="Search" value="${esc(f.q)}" aria-label="Search players" style="width:110px">
      </div>
      <div class="plist"><table><thead><tr><th></th><th>Player</th><th class="n">£</th><th class="n">Pts</th><th class="n">Form</th><th></th></tr></thead><tbody>
      ${rows.map((p) => {
        const inSquad = d && d.squad.includes(p.name);
        const price = D.prices[p.name] ?? p.start, ch = Math.round((price - p.start) * 10) / 10;
        const why = mode === 'add' ? (inSquad ? null : canAdd(p.name)) : null;
        const btn = mode === 'add' ? `<button class="addb" data-act="${inSquad ? 'remove' : 'add'}" data-p="${esc(p.name)}" aria-label="${inSquad ? 'Remove' : 'Add'} ${esc(p.name)}">${inSquad ? '−' : '+'}</button>`
          : mode === 'swap' ? (inSquad ? '' : `<button class="btn small" data-act="swapin" data-p="${esc(p.name)}">In</button>`) : '';
        return `<tr class="${inSquad ? 'in' : ''}${!p.team || (mode === 'add' && why && !inSquad) ? ' dim' : ''}"><td>${posChip(p.pos)}</td>
          <td data-act="pinfo" data-p="${esc(p.name)}"><span class="pname">${esc(p.name)}</span> ${p.status === 'injured' ? '<span class="tag inj">Inj</span>' : ''}${myManager().player === p.name ? ' <span class="tag you">You</span>' : ''}<br><span class="pteam">${esc(p.team || 'Not in a team yet')}</span></td>
          <td class="n price">${money(price).replace('£', '').replace('m', '')}${ch ? `<br><span class="mv ${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '↑' : '↓'}${Math.abs(ch).toFixed(1)}</span>` : ''}</td>
          <td class="n">${D.season[p.name].total}</td><td class="n">${D.season[p.name].form}</td><td class="n">${btn}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
  }

  // ---------- Transfers ----------
  function viewTransfers() {
    if (D.openGw == null) return `<div class="card"><h2>Transfers</h2>${deadlineLine()}</div>`;
    const d = S.draft, st = myState(), c = cfg();
    if (!st || st.first) return `<div class="card"><h2>Transfers</h2>${deadlineLine()}<p>Your first squad is free, and you can change it as often as you like until the Week ${D.openGw} deadline. Build it on <b>Pick Team</b>.</p><button class="btn primary" data-act="tab" data-tab="pick">Go to Pick Team</button></div>`;
    const fm = freeMode();
    const ins = st.ins, outs = st.outs;
    const out = S.pendingOut;
    const sellOf = (n) => C.sellPrice(st.bought[n] ?? D.prices[n], D.prices[n], c.priceStep);
    const prevSt = (D.state[meUid()] || {})[D.gws.filter((g) => g < D.openGw).pop()];
    return `<div class="card"><div class="rowh"><h2>Transfers · Week ${D.openGw}</h2>${dirty() ? '<span class="tag">Unsaved</span>' : ''}</div>${deadlineLine()}
      <div class="stats">${stat('Free transfers', fm ? '∞' : String(st.freeAvail), `<div class="chg flat">${fm ? esc(c.chips[d.chip].name) + ' active' : `max ${c.maxFreeTransfers}, unused ones roll over`}</div>`)}
      ${stat('Transfers made', String(st.transfers), st.hits ? `<div class="chg down">↓ ${st.hits} pts</div>` : '<div class="chg flat">no points cost</div>')}
      ${stat('Bank after', money(st.bank), prevSt ? chgM(Math.round((st.bank - prevSt.bank) * 10) / 10, 'this week') : '')}</div>
      ${budgetBar(st)}
      ${ins.length ? `<table><thead><tr><th>Out</th><th>In</th><th class="n">Cost</th></tr></thead><tbody>${outs.map((o, i) => `<tr><td>${posChip(P(o).pos)} ${esc(o)} <span class="small muted">${money(sellOf(o))}</span></td><td>${esc(ins[i] || '')} <span class="small muted">${ins[i] ? money(D.prices[ins[i]]) : ''}</span></td><td class="n">${!fm && i >= st.freeAvail ? `−${c.transferHit} pts` : 'free'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No transfers yet this week. Tap <b>Out</b> next to a player.</p>'}
      <ul class="msgs">${(ins.length ? draftErrors() : []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      <div class="btns" style="margin-top:10px"><button class="btn primary" data-act="confirmT" ${dirty() ? '' : 'disabled'}>Confirm transfers</button>${dirty() ? '<button class="btn" data-act="reset">Undo all</button>' : ''}</div></div>
      <div class="grid2"><div class="card"><h3>Your squad</h3><table><tbody>${d.squad.map((n) => `<tr class="${out === n ? 'me' : ''}"><td>${posChip(P(n).pos)}</td><td><span class="pname">${esc(n)}</span><br><span class="pteam">${esc(P(n).team || '')} · sells for ${money(sellOf(n))}</span></td><td class="n"><button class="btn small ${out === n ? 'dark' : ''}" data-act="out" data-p="${esc(n)}">${out === n ? 'Cancel' : 'Out'}</button></td></tr>`).join('')}</tbody></table></div>
      <div>${out ? `<p><b>Replacing ${esc(out)}</b> (${POSN[P(out).pos]}, sells for ${money(sellOf(out))}). You'd have ${money(st.bank + sellOf(out))} to spend.</p>` + playerList('swap', P(out).pos) : '<div class="card muted">Pick a player to transfer out. Replacements must play the same position.</div>'}</div></div>`;
  }

  // ---------- Points ----------
  function viewPoints() {
    if (!D.scoredGws.length) return `<div class="card"><h2>Points</h2><p class="muted">${D.passedGws.length ? 'Waiting for this week’s results to be added to the league.' : 'Points appear here once the first gameweek deadline has passed and results are in.'}</p></div>`;
    const gw = S.pointsGw && D.scoredGws.includes(S.pointsGw) ? S.pointsGw : D.scoredGws[D.scoredGws.length - 1];
    const uid = S.pointsUid && D.scores[S.pointsUid] ? S.pointsUid : meUid();
    const r = (D.scores[uid] || {})[gw];
    const m = S.data.managers[uid] || {};
    const row = D.table.find((x) => x.uid === uid) || {};
    const hist = row.history || [];
    const hi = hist.findIndex((h) => h.gw === gw);
    const prevGw = D.scoredGws[D.scoredGws.indexOf(gw) - 1];
    const prevPts = prevGw != null ? (D.results[uid] || {})[prevGw] : null;
    const rank = hist[hi] ? hist[hi].rank : null, prank = hi > 0 ? hist[hi - 1].rank : null;
    const sel = `<div class="filters"><select data-change="pgw" aria-label="Gameweek">${D.scoredGws.map((g) => `<option value="${g}" ${g === gw ? 'selected' : ''}>Week ${g}</option>`).join('')}</select>
      <select data-change="puid" aria-label="Manager">${D.managers.map((x) => `<option value="${esc(x.uid)}" ${x.uid === uid ? 'selected' : ''}>${esc(x.teamName)}${x.uid === meUid() ? ' (you)' : ''}</option>`).join('')}</select></div>`;
    if (!r) return `<div class="card"><h2>Points</h2>${sel}<p class="muted">${esc(m.teamName || 'This manager')} had no team in Week ${gw}.</p></div>`;
    const xi = r.players.filter((p) => p.counted && (r.chip !== 'bb' || p.name !== (D.state[uid][gw].entry.sub))).map((p) => p.name);
    const e = D.state[uid][gw].entry;
    const bench = r.chip === 'bb' ? e.sub : (r.players.find((p) => !p.counted) || {}).name;
    const subIn = new Set(r.autoSubs.map((a) => a.in)), subOut = new Set(r.autoSubs.map((a) => a.out));
    const byName = Object.fromEntries(r.players.map((p) => [p.name, p]));
    const opts = (n) => ({ owner: uid, armband: byName[n].armband, mult: byName[n].multiplier, captain: n === e.captain && !byName[n].armband && !r.captainUsed, vice: n === e.vice && !byName[n].armband, line: String(byName[n].counted ? byName[n].total : byName[n].pts), actName: 'bd', swap: subIn.has(n) ? '↑' : subOut.has(n) ? '↓' : '', out: !byName[n].counted });
    const notes = [];
    if (r.chip) notes.push(`<b>${esc(cfg().chips[r.chip].name)}</b> played.`);
    r.autoSubs.forEach((a) => notes.push(`Auto-sub: ${esc(a.in)} came on for ${esc(a.out)} (didn’t play).`));
    if (r.captainFallback) notes.push(`${esc(e.captain)} didn’t play, so vice-captain ${esc(r.captainUsed)} got the ${r.chip === 'tc' ? 'triple' : 'double'} points.`);
    else if (!r.captainUsed) notes.push('Neither captain nor vice-captain played: no one was doubled.');
    if (r.hits) notes.push(`Transfer hit: −${r.hits} pts.`);
    if (r.provisional) notes.push('Provisional: some match sheets aren’t filled in yet, so every squad member is counted as having played.');
    return `<div class="card"><div class="rowh"><h2>Points · Week ${gw}</h2></div>${sel}
      <div class="stats">${stat('Gameweek points', r.total, prevPts != null ? chg(r.total - prevPts, '', false, 'vs last week') : '')}
      ${stat('Total points', row.history ? hist[hi].total : r.total, chg(r.total, '', false, 'this week'))}
      ${stat('Rank', rank ? `${rank}<span class="small muted">/${D.managers.length}</span>` : '–', prank ? chg(prank - rank, '', false, prank === rank ? '' : 'places') : '')}
      ${stat('Transfers', String(D.state[uid][gw].transfers), r.hits ? `<div class="chg down">↓ ${r.hits} pts hit</div>` : '<div class="chg flat">no hit</div>')}</div>
      ${notes.length ? `<ul class="msgs">${notes.map((n) => `<li class="ok">${n}</li>`).join('')}</ul>` : ''}</div>
      <div class="grid2"><div>${pitch(xi, bench, opts, C.formationOf(S.L, cfg(), xi.filter((n) => n !== (r.chip === 'bb' ? e.sub : null))), r.chip === 'bb' ? 'Sub (counts)' : 'Bench')}<p class="small muted">Tap a player for their points in each match. C = captain, V = vice. ↑ came on, ↓ went off.</p></div>
      <div class="card"><h3>Breakdown</h3><table class="bd"><thead><tr><th>Player</th><th class="n">Matches</th><th class="n">Pts</th><th class="n">×</th><th class="n">Total</th></tr></thead><tbody>
      ${r.players.map((p) => `<tr data-act="bd" data-p="${esc(p.name)}" data-uid="${esc(uid)}"><td>${posChip(P(p.name).pos)} ${esc(p.name)}${p.armband ? ' <span class="tag">C</span>' : ''}</td><td class="n">${p.played}</td><td class="n">${p.pts}</td><td class="n">${p.multiplier}</td><td class="n"><b>${p.total}</b></td></tr>`).join('')}
      ${r.hits ? `<tr><td>Transfer hit</td><td></td><td></td><td></td><td class="n down">−${r.hits}</td></tr>` : ''}
      <tr><td><b>Total</b></td><td></td><td></td><td></td><td class="n"><b>${r.total}</b></td></tr></tbody></table></div></div>`;
  }
  function breakdownSheet(n, gw) {
    const wp = (D.wp[gw] || {})[n] || { matches: [], pts: 0 };
    const p = P(n);
    const rows = wp.matches.map((m) => `<tr class="mh"><td colspan="3">${esc(short(m.home))} ${esc(m.score)} ${esc(short(m.away))} · for ${esc(short(m.team))}${m.role === 'GK' && p.pos !== 'GK' ? ' · <b>in goal</b>' : ''}${m.role !== p.pos && p.pos === 'GK' ? ' · outfield' : ''}${m.provisional ? ' · <i>no sheet yet</i>' : ''}</td></tr>` +
      m.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${l.n}</td><td class="n">${l.pts > 0 ? '+' : ''}${l.pts}</td></tr>`).join('') + `<tr><td></td><td></td><td class="n"><b>${m.pts}</b></td></tr>`).join('');
    openSheet(`<h2>${esc(n)}</h2><p>${posChip(p.pos)} ${esc(p.team || '')} · Week ${gw}</p>${rows ? `<table class="bd"><tbody>${rows}</tbody></table>` : '<p class="muted">Didn’t play this week.</p>'}<p><b>Week total: ${wp.pts}</b></p><div class="acts"><button class="btn" data-act="close">Close</button></div>`);
  }

  // ---------- League ----------
  function viewLeague() {
    const t = D.table, last = D.scoredGws[D.scoredGws.length - 1];
    const rows = t.map((r) => `<tr class="${r.uid === meUid() ? 'me' : ''}" data-act="seepts" data-uid="${esc(r.uid)}"><td class="n">${r.rank}</td><td>${r.move > 0 ? `<span class="up">↑${r.move}</span>` : r.move < 0 ? `<span class="down">↓${-r.move}</span>` : '<span class="muted">–</span>'}</td>
      <td><span class="pname">${esc(r.teamName)}</span><br><span class="pteam">${esc(r.manager)}</span></td><td class="n">${r.gw}</td><td class="n"><b>${r.total}</b></td></tr>`).join('');
    const me = t.find((r) => r.uid === meUid()) || {};
    return `<div class="stats">${stat('Your rank', me.rank ? `${me.rank}<span class="small muted">/${t.length}</span>` : '–', chg(me.move, '', false, me.move ? (Math.abs(me.move) === 1 ? 'place' : 'places') : 'since last week'))}${stat('Total points', me.total ?? 0, last != null ? chg(me.gw, '', false, `in Week ${last}`) : '')}${stat('Managers', t.length, '')}</div>
      <div class="card"><h2>League table</h2><p class="small muted">Classic league: total points across the season. ${last != null ? `GW = Week ${last}.` : ''} Tap a team to see their points.</p>
      <table><thead><tr><th class="n">#</th><th></th><th>Team</th><th class="n">GW</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${D.scoredGws.length >= 1 ? `<div class="card"><div class="rowh"><h2>Season history</h2><div class="seg"><button data-act="chart" data-v="total" aria-pressed="${S.chart === 'total'}">Points</button><button data-act="chart" data-v="rank" aria-pressed="${S.chart === 'rank'}">Rank</button></div></div>
        <div class="legend">${t.map((r) => `<span><i style="background:${D.colour[r.uid]}"></i>${esc(r.teamName)}</span>`).join('')}</div>
        <div style="position:relative" id="chartbox">${chartSvg()}<div class="tip" id="tip" hidden></div></div></div>` : ''}`;
  }
  function chartSvg() {
    const t = D.table, gws = D.scoredGws, mode = S.chart;
    // draw at the real width so text stays readable on a phone
    const W = S.cw = Math.round(Math.min(700, Math.max(300, (($('#main') || {}).clientWidth || 360) - 56))), H = W < 480 ? 240 : 300, ml = 34, mr = W < 480 ? 92 : 110, mt = 12, mb = 28;
    const iw = W - ml - mr, ih = H - mt - mb;
    const n = t.length;
    const maxV = mode === 'rank' ? n : Math.max(10, ...t.flatMap((r) => r.history.map((h) => h.total)));
    const x = (i) => ml + (gws.length === 1 ? iw / 2 : (i / (gws.length - 1)) * iw);
    const y = (v) => mode === 'rank' ? mt + ((v - 1) / Math.max(1, n - 1)) * ih : mt + ih - (v / maxV) * ih;
    const ticks = mode === 'rank' ? [...Array(n).keys()].map((i) => i + 1) : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxV));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${mode === 'rank' ? 'Rank' : 'Total points'} by week for each team">`;
    for (const v of ticks) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(23,20,18,.1)"/><text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#5d5650">${v}</text>`;
    gws.forEach((g, i) => { s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#5d5650">W${g}</text>`; });
    // direct labels at the line ends, nudged apart so they don't collide
    const ends = t.map((r) => ({ r, v: mode === 'rank' ? r.history[r.history.length - 1].rank : r.history[r.history.length - 1].total })).map((o) => ({ ...o, y: y(o.v) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const r of t) {
      const pts = r.history.map((h, i) => [x(i), y(mode === 'rank' ? h.rank : h.total)]);
      const c = D.colour[r.uid];
      s += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${c}" stroke-width="${r.uid === meUid() ? 3 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach((p) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${c}" stroke="#faf6ee" stroke-width="2"/>`; });
    }
    for (const e of ends) s += `<text x="${W - mr + 8}" y="${e.y + 4}" font-size="13" font-weight="700" fill="#171412">${esc(e.r.teamName.length > 13 ? e.r.teamName.slice(0, 12) + '…' : e.r.teamName)}</text>`;
    s += `<line id="xh" x1="0" x2="0" y1="${mt}" y2="${mt + ih}" stroke="#171412" stroke-opacity=".35" visibility="hidden"/><rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent" id="hit"/></svg>`;
    return s;
  }
  function bindChart() {
    const box = $('#chartbox'); if (!box) return;
    const svg = $('svg', box), hit = $('#hit', box), xh = $('#xh', box), tip = $('#tip', box);
    const gws = D.scoredGws, W = S.cw, ml = 34, mr = W < 480 ? 92 : 110, iw = W - ml - mr;
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      const i = gws.length === 1 ? 0 : Math.max(0, Math.min(gws.length - 1, Math.round(((px - ml) / iw) * (gws.length - 1))));
      const xx = ml + (gws.length === 1 ? iw / 2 : (i / (gws.length - 1)) * iw);
      xh.setAttribute('x1', xx); xh.setAttribute('x2', xx); xh.setAttribute('visibility', 'visible');
      const rows = D.table.map((t) => ({ t, h: t.history[i] })).sort((a, b) => a.h.rank - b.h.rank);
      tip.innerHTML = `<b>Week ${gws[i]}</b><br>` + rows.map((o) => `<span style="color:${D.colour[o.t.uid]}">●</span> ${esc(o.t.teamName)}: ${S.chart === 'rank' ? '#' + o.h.rank : o.h.total + ' pts'}`).join('<br>');
      tip.hidden = false;
      const left = (xx / W) * r.width;
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + 'px';
      tip.style.top = '8px';
    };
    const leave = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
    hit.addEventListener('mousemove', move); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true });
    hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', () => setTimeout(leave, 1500));
  }

  // ---------- Stats ----------
  function viewStats() {
    const L = S.L, c = cfg();
    const players = Object.values(L.players).filter((p) => p.team);
    const ownTxt = D.ownGw != null ? `Week ${D.ownGw} teams (${D.ownCount} managers)` : 'shown after the first deadline';
    const ownRows = players.filter((p) => D.own[p.name]).sort((a, b) => D.own[b.name] - D.own[a.name] || a.name.localeCompare(b.name));
    const capTop = Object.entries(D.caps).sort((a, b) => b[1] - a[1])[0];
    const topBy = (pos) => players.filter((p) => p.pos === pos).sort((a, b) => D.season[b.name].total - D.season[a.name].total)[0];
    const val = players.filter((p) => D.season[p.name].played > 0).map((p) => ({ p, v: D.season[p.name].total / (D.prices[p.name] || p.start) })).sort((a, b) => b.v - a.v);
    const gw = S.totwGw && L.weeks.includes(S.totwGw) ? S.totwGw : L.weeks[L.weeks.length - 1];
    const totw = gw != null ? C.teamOfTheWeek(L, c, D.wp[gw]) : null;
    // awards
    const rows = [];
    for (const m of D.managers) for (const g of D.scoredGws) {
      const r = D.scores[m.uid][g]; if (!r) continue;
      const dl = S.data.gws[g].deadline;
      rows.push({ uid: m.uid, teamName: m.teamName, gw: g, month: new Date(dl).toLocaleString('en-GB', { month: 'long', year: 'numeric' }), total: r.total, captainPts: r.captainPts, benchPoints: r.benchPoints });
    }
    const aw = C.awards(rows);
    const wk = aw.byWeek[aw.byWeek.length - 1];
    const changes = (S.data.priceUpdates || []).slice().sort((a, b) => b.gw - a.gw);
    const pRow = (p, extra) => `<tr data-act="pinfo" data-p="${esc(p.name)}"><td>${posChip(p.pos)} <span class="pname">${esc(p.name)}</span><br><span class="pteam">${esc(p.team)}</span></td><td class="n">${extra}</td></tr>`;
    return `<div class="stats">${stat('Most captained', capTop ? esc(surname(capTop[0])) : '–', capTop ? `<div class="chg flat">${capTop[1]} of ${D.ownCount} managers</div>` : '')}
      ${stat('Top scorer', (() => { const t = players.slice().sort((a, b) => D.season[b.name].total - D.season[a.name].total)[0]; return t && D.season[t.name].total ? esc(surname(t.name)) : '–'; })(), '')}
      ${stat('Best value', val[0] ? esc(surname(val[0].p.name)) : '–', val[0] ? `<div class="chg">↑ ${val[0].v.toFixed(1)} pts per £m</div>` : '')}</div>
      <div class="grid2"><div>
      <div class="card"><div class="rowh"><h2>Team of the Week</h2>${L.weeks.length ? `<select data-change="totw">${L.weeks.map((w) => `<option value="${w}" ${w === gw ? 'selected' : ''}>Week ${w}</option>`).join('')}</select>` : ''}</div>
        ${totw ? pitch(totw.players, null, (n) => ({ line: String(D.wp[gw][n].pts) }), totw.formation, 'Total ' + totw.total).replace(/<div class="bench">[\s\S]*$/, `<p class="small muted">The best legal 8 for Week ${gw}: ${totw.total} points.</p>`) : '<p class="muted">After the first results.</p>'}</div>
      <div class="card"><h2>Awards</h2>${wk ? `<h3>Week ${wk.gw}</h3><table><tbody><tr><td>Top score</td><td>${esc(wk.top.teamName)}</td><td class="n">${wk.top.total}</td></tr><tr><td>Best captain</td><td>${esc(wk.captain.teamName)}</td><td class="n">${wk.captain.captainPts}</td></tr><tr><td>Bench Regret</td><td>${esc(wk.bench.teamName)}</td><td class="n">${wk.bench.benchPoints}</td></tr></tbody></table>
        <h3 style="margin-top:12px">Season</h3><table><tbody>${aw.managerOfMonth.map((m) => `<tr><td>Manager of the Month · ${esc(m.month)}</td><td>${esc(m.winner.teamName)}</td><td class="n">${m.winner.v}</td></tr>`).join('')}
        <tr><td>Best Captain record</td><td>${esc(aw.bestCaptain.teamName)}</td><td class="n">${aw.bestCaptain.v}</td></tr><tr><td>Bench Regret</td><td>${esc(aw.benchRegret.teamName)}</td><td class="n">${aw.benchRegret.v}</td></tr></tbody></table>
        <p class="small muted">Best Captain = points from captains (with the multiplier). Bench Regret = points left on the bench.</p>` : '<p class="muted">After the first scored week.</p>'}</div>
      </div><div>
      <div class="card"><h2>Top scorer by position</h2><table><tbody>${['GK', 'DEF', 'MID', 'FWD'].map((x) => { const p = topBy(x); return p ? pRow(p, `${D.season[p.name].total} pts`) : ''; }).join('')}</tbody></table></div>
      <div class="card"><h2>Value (points per £m)</h2><h3>Best</h3><table><tbody>${val.slice(0, 5).map((o) => pRow(o.p, `${o.v.toFixed(1)}<br><span class="pteam">${D.season[o.p.name].total} pts · ${money(D.prices[o.p.name])}</span>`)).join('') || '<tr><td class="muted">After the first results.</td></tr>'}</tbody></table>
        <h3 style="margin-top:12px">Worst</h3><table><tbody>${val.slice(-5).reverse().map((o) => pRow(o.p, `${o.v.toFixed(1)}<br><span class="pteam">${D.season[o.p.name].total} pts · ${money(D.prices[o.p.name])}</span>`)).join('')}</tbody></table></div>
      <div class="card"><h2>Ownership</h2><p class="small muted">From ${ownTxt}.</p><table><tbody>${ownRows.map((p) => pRow(p, `${Math.round((D.own[p.name] / D.ownCount) * 100)}%${D.caps[p.name] ? `<br><span class="pteam">C × ${D.caps[p.name]}</span>` : ''}`)).join('') || '<tr><td class="muted">No teams visible yet.</td></tr>'}</tbody></table></div>
      <div class="card"><h2>Price changes</h2>${changes.length ? changes.map((u) => `<h3>After Week ${u.gw}</h3><table><tbody>${Object.entries(u.changes).map(([n, to]) => { const before = C.pricesAt(L, S.data.priceUpdates, u.gw)[n]; const dlt = Math.round((to - before) * 10) / 10; return `<tr data-act="pinfo" data-p="${esc(n)}"><td>${posChip(P(n).pos)} ${esc(n)}</td><td class="n">${money(before)} → <b>${money(to)}</b></td><td class="n ${dlt > 0 ? 'up' : 'down'}">${dlt > 0 ? '↑' : '↓'} ${Math.abs(dlt).toFixed(1)}</td></tr>`; }).join('')}</tbody></table>`).join('') : '<p class="muted">No price changes yet.</p>'}</div>
      </div></div>`;
  }

  // ---------- Fixtures ----------
  function viewFixtures() {
    const L = S.L, c = cfg();
    const pos = {}; D.standings.forEach((r, i) => { pos[r.team] = i + 1; });
    const played = L.matches.length > 0;
    const diff = (opp) => c.difficulty[(pos[opp] || 1) - 1] || '#999';
    const fx = L.fixtures.slice().sort((a, b) => a.week - b.week);
    const oppsOf = (f, t) => f.rounds.flatMap((r) => r.games.filter((g) => g.teams.includes(t)).map((g) => g.teams.find((x) => x !== t)));
    const table = `<table class="fdr"><thead><tr><th>Team</th>${fx.map((f) => `<th class="c">W${f.week}</th>`).join('')}</tr></thead><tbody>${L.teams.map((t) => `<tr><td>${crest(t.name, 'crest')} ${esc(t.short)}</td>${fx.map((f) => `<td class="c">${oppsOf(f, t.name).map((o) => `<span class="op" style="background:${diff(o)}">${esc(short(o))}</span>`).join('')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const list = fx.map((f) => `<div class="card"><h3>Week ${f.week}${f.date ? ' · ' + new Date(f.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</h3>
      ${f.rounds.map((r) => `<div class="fx-round"><div><b>Round ${r.round}</b><br><span class="small muted">${esc(r.kickoff || 'time tbc')}</span></div><div>${r.games.map((g) => {
        const m = L.matches.find((x) => x.week === f.week && ((x.home === g.teams[0] && x.away === g.teams[1]) || (x.home === g.teams[1] && x.away === g.teams[0])));
        const sc = m ? (m.home === g.teams[0] ? `${m.home_goals}–${m.away_goals}` : `${m.away_goals}–${m.home_goals}`) : 'v';
        return `<div class="fx-game">${crest(g.teams[0], 'crest')} ${esc(g.teams[0])} <b class="num">${sc}</b> ${esc(g.teams[1])} ${crest(g.teams[1], 'crest')} <span class="small muted">${esc(g.pitch || '')}</span></div>`;
      }).join('')}</div></div>`).join('')}</div>`).join('');
    return `<div class="card"><h2>Fixture difficulty</h2><p class="small muted">${played ? 'Colour = opponent’s place in the league table now:' : 'No results yet, so every opponent is shown as equal. Colours follow the table once games are played:'} <span class="op" style="background:${c.difficulty[0]}">1st</span> <span class="op" style="background:${c.difficulty[1]}">2nd</span> <span class="op" style="background:${c.difficulty[2]};color:#171412">3rd</span> <span class="op" style="background:${c.difficulty[3]}">4th</span></p>${played ? table : table.replace(/background:[^"]+"/g, `background:${c.difficulty[2]};color:#171412"`)}</div>
      <div class="card"><h2>League table</h2><table><thead><tr><th>#</th><th>Team</th><th class="n">P</th><th class="n">GD</th><th class="n">Pts</th></tr></thead><tbody>${D.standings.map((r, i) => `<tr><td>${i + 1}</td><td>${crest(r.team, 'crest')} ${esc(r.team)}</td><td class="n">${r.played}</td><td class="n">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="n"><b>${r.points}</b></td></tr>`).join('')}</tbody></table></div>${list}`;
  }

  // ---------- player info ----------
  function playerSheet(n) {
    const p = P(n), price = D.prices[n] ?? p.start, ch = Math.round((price - p.start) * 10) / 10;
    const weeks = S.L.weeks.map((w) => ({ w, pts: (D.wp[w][n] || {}).pts || 0, pl: (D.wp[w][n] || {}).played || 0 }));
    openSheet(`<h2>${esc(n)} ${myManager().player === n ? '<span class="tag you">That’s you!</span>' : ''}</h2>
      <p>${posChip(p.pos)} ${esc(p.team || 'Not in a team yet')}${p.status === 'injured' ? ' <span class="tag inj">Injured</span>' : ''}</p>
      ${p.news ? `<p class="muted">${esc(p.news)}</p>` : ''}
      <div class="stats">${stat('Price', money(price), chgM(ch, 'since start'))}${stat('Points', D.season[n].total, '')}${stat('Form', D.season[n].form, `<div class="chg flat">last ${cfg().prices.formWeeks} weeks</div>`)}${stat('Owned', D.ownCount ? Math.round(((D.own[n] || 0) / D.ownCount) * 100) + '%' : '–', '')}</div>
      ${weeks.length ? `<table class="bd"><thead><tr><th>Week</th><th class="n">Matches</th><th class="n">Pts</th></tr></thead><tbody>${weeks.map((x) => `<tr data-act="bdw" data-p="${esc(n)}" data-gw="${x.w}"><td>Week ${x.w}</td><td class="n">${x.pl}</td><td class="n">${x.pts}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="acts"><button class="btn" data-act="close">Close</button></div>`);
  }
  function pitchMenu(n) {
    const d = S.draft, c = cfg(), L = S.L, isSub = n === d.sub, p = P(n);
    const acts = [];
    if (!isSub) {
      if (d.captain !== n) acts.push(`<button class="btn dark" data-act="mkcap" data-p="${esc(n)}">Make captain</button>`);
      if (d.vice !== n) acts.push(`<button class="btn" data-act="mkvice" data-p="${esc(n)}">Make vice-captain</button>`);
      if (d.sub && p.pos !== 'GK') {
        const next = d.squad.filter((x) => x !== n);
        acts.push(C.formationOf(L, c, next) ? `<button class="btn" data-act="swapsub" data-p="${esc(n)}">Swap with sub (${esc(d.sub)})</button>` : `<p class="small muted">Swapping with ${esc(d.sub)} would make an illegal formation.</p>`);
      }
    } else {
      const ok = d.squad.filter((x) => x !== n && P(x).pos !== 'GK' && C.formationOf(L, c, d.squad.filter((y) => y !== x)));
      acts.push(...ok.map((x) => `<button class="btn" data-act="swapsub" data-p="${esc(x)}">Bring on for ${esc(x)}</button>`));
    }
    if (freeMode()) acts.push(`<button class="btn" data-act="remove" data-p="${esc(n)}">Remove from squad</button>`);
    else acts.push(`<button class="btn" data-act="tout" data-p="${esc(n)}">Transfer out</button>`);
    acts.push(`<button class="btn" data-act="pinfo" data-p="${esc(n)}">Player info</button>`, '<button class="btn" data-act="close">Close</button>');
    openSheet(`<h2>${esc(n)}</h2><p>${posChip(p.pos)} ${esc(p.team || '')} · ${money(D.prices[n])}${isSub ? ' · <b>substitute</b>' : ''}</p><div class="acts">${acts.join('')}</div>`);
  }
  function openSheet(html) { const s = $('#sheet'); $('.sheet-card', s).innerHTML = html; s.hidden = false; }
  function closeSheet() { $('#sheet').hidden = true; }

  // ---------- Admin ----------
  function viewAdmin() {
    if (!S.store.isAdmin()) return '<div class="card">Admin only.</div>';
    const L = S.L, c = cfg(), data = S.data;
    const now = Date.now();
    const nextGw = (D.gws[D.gws.length - 1] || 0) + 1;
    const fxFor = (g) => L.fixtures.find((f) => f.week === g);
    const sugg = (g) => C.deadlineFromFixture(fxFor(g), c.deadlineHoursBeforeKickoff);
    const dtl = (t) => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
    const gwRows = D.gws.map((g) => { const x = data.gws[g]; const st = x.locked ? 'Locked' : x.deadline <= now ? 'Deadline passed' : 'Open'; const n = Object.keys(data.entries[g] || {}).length;
      return `<tr><td><b>W${g}</b><br><span class="small muted">${st}</span></td><td><input type="datetime-local" data-gwdl="${g}" value="${dtl(x.deadline)}"></td><td class="small">${D.passed(g) ? n + ' teams' : ''}</td><td><div class="btns"><button class="btn small" data-act="gwsave" data-gw="${g}">Save</button>${x.locked ? `<button class="btn small" data-act="gwunlock" data-gw="${g}">Unlock</button>` : `<button class="btn small" data-act="gwlock" data-gw="${g}">Lock now</button>`}</div></td></tr>`; }).join('');
    const budgetNow = C.budgetAt(c, data.settings.budgetHistory, D.priceGw);
    const week = S.admin.week ?? (L.weeks[L.weeks.length - 1] ?? 1);
    const ms = L.matchesOfWeek(week);
    const priceWeek = S.admin.pweek ?? (L.weeks[L.weeks.length - 1] ?? null);
    const existing = (data.priceUpdates || []).find((u) => u.gw === priceWeek);
    const prop = priceWeek != null ? C.proposePrices(L, data.sheets, c, priceWeek, C.pricesAt(L, (data.priceUpdates || []).filter((u) => u.gw !== priceWeek), priceWeek + 1)) : [];
    const allow = S.admin.allow;
    return `<h2>Admin</h2><p class="small muted">Only you see this screen.${ST.demo ? ' Demo: changes stay in this tab.' : ''}</p>
    <details class="adm" open><summary>Match sheets</summary><div>
      <p class="small muted">Everyone is ticked as played by default: untick whoever was absent, and say who was in goal. A guest is a player who turned out for another team. Points update straight away.</p>
      <div class="filters"><select data-change="aweek">${(L.weeks.length ? L.weeks : [week]).map((w) => `<option value="${w}" ${w === week ? 'selected' : ''}>Week ${w}</option>`).join('')}</select></div>
      ${ms.length ? ms.map((m) => matchSheetForm(m)).join('') : '<p class="muted">No results for this week in the league data yet. Add them with the league skill first.</p>'}
    </div></details>
    <details class="adm"><summary>Gameweeks &amp; deadlines</summary><div>
      <p class="small muted">Teams lock at the deadline (checked by the server). Default: ${c.deadlineHoursBeforeKickoff} hour before the first kickoff in the fixtures file. Lock now also reveals everyone's teams.</p>
      <table><tbody>${gwRows}</tbody></table>
      <h3 style="margin-top:12px">Open Week ${nextGw}</h3><div class="filters"><input type="datetime-local" id="newdl" value="${dtl(sugg(nextGw))}"><button class="btn small primary" data-act="gwadd" data-gw="${nextGw}">Open Week ${nextGw}</button></div>
      ${sugg(nextGw) ? `<p class="small muted">Suggested from the Week ${nextGw} fixtures.</p>` : `<p class="small muted">No kickoff time in the Week ${nextGw} fixtures yet: enter the deadline by hand.</p>`}
    </div></details>
    <details class="adm"><summary>Budget &amp; chips</summary><div>
      <p>Budget now: <b>${money(budgetNow)}</b>. A change applies from the gameweek you choose. Existing squads stay valid; only transfers made after the change have to fit the new limit.</p>
      <div class="filters"><label class="f">New budget (£m)<input type="number" step="0.5" min="30" max="120" id="bud" value="${budgetNow}"></label><label class="f">From week<input type="number" min="1" id="budgw" value="${D.priceGw}" style="width:80px"></label><button class="btn small primary" data-act="budsave">Save budget</button></div>
      <p class="small muted">History: ${(data.settings.budgetHistory || []).map((h) => `${money(h.budget)} from W${h.fromGw}`).join(' · ') || `default ${money(c.budget)}`}</p>
      <div class="filters"><label class="f">Second set of chips from week (blank = none)<input type="number" min="2" id="chips2" value="${c.secondChipsFromGw ?? ''}" style="width:90px"></label><button class="btn small" data-act="chips2">Save</button></div>
    </div></details>
    <details class="adm"><summary>Price update</summary><div>
      <p class="small muted">Run after each week. Rises £${c.prices.step}m with ${c.prices.riseIfFormAtLeast}+ points over the last ${c.prices.formWeeks} weeks; falls £${c.prices.step}m after a blank (appearance points only). Never more than ±£${c.prices.maxMoveFromStart}m from the starting price. New prices apply from the next gameweek.</p>
      <div class="filters"><select data-change="pweek">${L.weeks.map((w) => `<option value="${w}" ${w === priceWeek ? 'selected' : ''}>After Week ${w}</option>`).join('')}</select></div>
      ${existing ? `<p class="small"><b>Already applied</b> on ${fmtDate(existing.at)} (${Object.keys(existing.changes).length} changes). Applying again replaces it.</p>` : ''}
      ${prop.length ? `<table><tbody>${prop.map((x) => `<tr><td><input type="checkbox" data-pp="${esc(x.name)}" data-to="${x.to}" checked aria-label="Apply"></td><td>${posChip(P(x.name).pos)} ${esc(x.name)}<br><span class="small muted">${esc(x.reason)}</span></td><td class="n">${money(x.from)} → <b>${money(x.to)}</b></td></tr>`).join('')}</tbody></table>
        <button class="btn primary" data-act="papply" data-gw="${priceWeek}" style="margin-top:8px">Apply ${prop.length} change${prop.length === 1 ? '' : 's'}</button>` : `<p class="muted">${priceWeek == null ? 'No results yet.' : 'No changes proposed.'}</p>`}
    </div></details>
    <details class="adm" ${allow ? 'open' : ''}><summary>Who can play (allowlist)</summary><div>
      ${allow ? `<table><tbody>${allow.map((e) => `<tr><td>${esc(e)}</td><td class="n"><button class="btn small" data-act="alrm" data-e="${esc(e)}">Remove</button></td></tr>`).join('') || '<tr><td class="muted">Nobody yet.</td></tr>'}</tbody></table>
        <div class="filters" style="margin-top:8px"><input type="email" id="aladd" placeholder="name@gmail.com"><button class="btn small primary" data-act="aladd">Add</button></div>
        <p class="small muted">Admins (${esc(c.adminEmails.join(', '))}) are always allowed.</p>` : '<button class="btn small" data-act="alload">Show the list</button>'}
    </div></details>
    <details class="adm"><summary>Managers &amp; data fixes</summary><div>
      <table><tbody>${D.managers.map((m) => `<tr><td><input type="text" data-tname="${esc(m.uid)}" value="${esc(m.teamName)}" maxlength="30"><br><span class="small muted">${esc(m.email)}${m.player ? ' · plays as ' + esc(m.player) : ''}</span></td><td class="n"><button class="btn small" data-act="tname" data-uid="${esc(m.uid)}">Rename</button></td></tr>`).join('')}</tbody></table>
      <h3 style="margin-top:12px">Edit a team</h3><p class="small muted">For fixing mistakes. You can save any manager's team for any week, even after the deadline.</p>
      <div class="filters"><select id="fxuid">${D.managers.map((m) => `<option value="${esc(m.uid)}">${esc(m.teamName)}</option>`).join('')}</select><select id="fxgw">${D.gws.map((g) => `<option>${g}</option>`).join('')}</select><button class="btn small" data-act="fxload">Load</button></div>
      <textarea id="fxjson" rows="6" placeholder='{"squad":[…9 names],"sub":"…","captain":"…","vice":"…","chip":null}'></textarea>
      <div class="btns"><button class="btn small primary" data-act="fxsave">Save team</button></div>
      <h3 style="margin-top:12px">Export</h3><div class="btns"><button class="btn small" data-act="exapp">Download appearances.json</button><button class="btn small" data-act="exall">Download full backup</button></div>
      <p class="small muted">appearances.json is the match sheets in the league's data format: commit it to <code>league/data/</code> in the skills repo to keep a copy with the results.</p>
    </div></details>`;
  }
  function matchSheetForm(m) {
    const L = S.L, sheet = C.sheetFor(L, S.data.sheets, m.key);
    const lu = C.lineups(L, m, sheet);
    const absent = new Set((sheet && sheet.absent) || []);
    const guests = (sheet && sheet.guests) || {};
    const side = (t) => {
      const own = L.squadByTeam[t] || [];
      const g = Object.keys(guests).filter((n) => guests[n] === t);
      const all = own.filter((n) => !(guests[n] && guests[n] !== t && (guests[n] === m.home || guests[n] === m.away))).concat(g);
      return `<div class="ms-team"><h3>${crest(t, 'crest')} ${esc(t)}</h3>
        <label class="f">In goal<select data-msgk="${esc(t)}"><option value="">Nobody listed</option>${all.map((n) => `<option ${lu[t].gk === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        ${all.map((n) => `<label class="pl${absent.has(n) ? ' abs' : ''}"><input type="checkbox" data-msp="${esc(n)}" ${absent.has(n) ? '' : 'checked'}> ${posChip(P(n).pos)} ${esc(n)}${guests[n] ? ' <span class="tag soft">guest</span>' : ''}</label>`).join('')}
      </div>`;
    };
    const ex = ['saves', 'penSaved', 'penMissed', 'yellow', 'red'];
    const exL = { saves: 'Saves', penSaved: 'Pens saved', penMissed: 'Pens missed', yellow: 'Yellow', red: 'Red' };
    const present = [m.home, m.away].flatMap((t) => lu[t].players);
    const others = Object.values(L.players).filter((p) => p.team && p.team !== m.home && p.team !== m.away && !guests[p.name]);
    const open = !sheet || S.admin.openKey === m.key;
    return `<details class="card ms" ${open ? 'open' : ''}><summary class="rowh" style="cursor:pointer;margin:0"><h3 style="margin:0">${esc(short(m.home))} ${m.home_goals}–${m.away_goals} ${esc(short(m.away))}</h3><span class="tag ${sheet ? 'soft' : ''}">${sheet ? (S.data.sheets[m.key] ? 'Saved ✓' : 'From file') : 'Not filled in'}</span></summary>
      <form data-ms="${esc(m.key)}" data-week="${m.week}" onsubmit="return false" style="margin-top:10px"><div class="sheetgrid">${side(m.home)}${side(m.away)}</div>
      <details style="margin-top:8px"><summary class="small"><b>Extras</b>: saves, penalties, cards (optional)</summary>
        <table class="bd"><thead><tr><th>Player</th>${ex.map((k) => `<th class="n">${exL[k]}</th>`).join('')}</tr></thead><tbody>${present.map((n) => `<tr><td>${esc(surname(n))}</td>${ex.map((k) => `<td class="n"><input type="number" min="0" max="30" style="width:52px;min-height:32px;padding:3px" data-msx="${k}" data-p="${esc(n)}" value="${(sheet && sheet[k] && sheet[k][n]) || ''}"></td>`).join('')}</tr>`).join('')}</tbody></table>
        <div class="ex-row"><span class="small">Guest:</span><select data-msguest><option value="">Add a player from another team…</option>${others.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select><select data-msguestt><option>${esc(m.home)}</option><option>${esc(m.away)}</option></select><button class="btn small" data-act="msguest" data-key="${esc(m.key)}">Add</button>
        ${Object.keys(guests).map((n) => `<button class="btn small" data-act="msunguest" data-key="${esc(m.key)}" data-p="${esc(n)}">Remove guest ${esc(surname(n))}</button>`).join('')}</div>
      </details>
      <div class="btns" style="margin-top:8px"><button class="btn primary" data-act="mssave" data-key="${esc(m.key)}">Save sheet</button></div></form></details>`;
  }
  function readSheet(key) {
    const f = $(`form[data-ms="${CSS.escape(key)}"]`);
    const m = S.L.matches.find((x) => x.key === key);
    const prev = C.sheetFor(S.L, S.data.sheets, key) || {};
    const s = { key, week: m.week, home: m.home, away: m.away, absent: [], gk: {}, guests: { ...(prev.guests || {}) }, saves: {}, penSaved: {}, penMissed: {}, yellow: {}, red: {}, done: true, updated: Date.now() };
    $$('[data-msp]', f).forEach((i) => { if (!i.checked) s.absent.push(i.dataset.msp); });
    $$('[data-msgk]', f).forEach((sel) => { s.gk[sel.dataset.msgk] = sel.value || null; });
    $$('[data-msx]', f).forEach((i) => { const v = Number(i.value); if (v > 0) s[i.dataset.msx][i.dataset.p] = v; });
    return s;
  }
  function download(name, obj) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1) + '\n'], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- actions ----------
  async function guard(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await reload(); }
    catch (e) {
      console.error(e);
      const c = (e && e.code) || '';
      toast(/permission/.test(c + e.message) ? (S.tab === 'pick' || S.tab === 'transfers' ? 'Not saved: the deadline has passed, or this gameweek is locked.' : 'Not allowed.') : (/unavailable|network/.test(c) ? 'No connection: try again when you’re online.' : 'Something went wrong: ' + (e.message || c)));
    }
  }
  async function saveDraft() {
    autoRoles(); compute();
    const errs = draftErrors();
    if (errs.length) { toast(errs[0]); render(); return; }
    const gw = D.openGw;
    await guard(() => S.store.saveEntry(gw, S.draft), `Team saved for Week ${gw} ✓`);
  }
  const A = {
    async signin() { S.authError = ''; try { await S.store.signIn(); } catch (e) { S.authError = /unauthorized-domain/.test(e.code || '') ? 'This website isn’t on the sign-in list yet (Firebase → Authentication → Settings → Authorized domains).' : 'Sign-in didn’t work. Try again.'; render(); } },
    signout() { S.store.signOut(); S.data = null; S.member = null; S.draft = null; },
    tab(el) { go(el.dataset.tab); },
    close: closeSheet,
    async onboard() {
      const tn = $('#tn').value.trim(); if (!tn) { toast('Choose a team name'); return; }
      const doc = { uid: meUid(), email: (S.user.email || '').toLowerCase(), name: S.user.displayName || '', teamName: tn.slice(0, 30), player: $('#tp').value || null, joined: Date.now() };
      await guard(() => S.store.saveManager(doc), `Welcome, ${tn}!`);
    },
    notify() { Notification.requestPermission().then(() => render()); },
    // pick team
    add(el) { const n = el.dataset.p, why = canAdd(n); if (why) { toast(why); return; } S.draft.squad.push(n); autoRoles(); compute(); render(); },
    remove(el) { const n = el.dataset.p, d = S.draft; d.squad = d.squad.filter((x) => x !== n); ['sub', 'captain', 'vice'].forEach((k) => { if (d[k] === n) d[k] = null; }); autoRoles(); closeSheet(); compute(); render(); },
    pmenu(el) { pitchMenu(el.dataset.p); },
    pinfo(el) { closeSheet(); playerSheet(el.dataset.p); },
    mkcap(el) { const d = S.draft, n = el.dataset.p; if (d.vice === n) d.vice = d.captain; d.captain = n; closeSheet(); compute(); render(); },
    mkvice(el) { const d = S.draft, n = el.dataset.p; if (d.captain === n) d.captain = d.vice; d.vice = n; closeSheet(); compute(); render(); },
    swapsub(el) {
      const d = S.draft, n = el.dataset.p, old = d.sub;
      d.sub = n;
      if (d.captain === n) d.captain = old; if (d.vice === n) d.vice = old;
      if (d.captain === d.vice) d.vice = d.squad.find((x) => x !== d.sub && x !== d.captain) || null;
      closeSheet(); compute(); render();
    },
    chip(el) { const k = el.dataset.chip; S.draft.chip = S.draft.chip === k ? null : k; if (S.draft.chip === null && !freeMode()) resetSquadIfOverFree(); compute(); render(); },
    async save() { await saveDraft(); },
    reset() { S.draft = null; S.draftGw = null; S.pendingOut = null; initDraft(); render(); },
    tout(el) { closeSheet(); S.pendingOut = el.dataset.p; go('transfers'); },
    // transfers
    out(el) { S.pendingOut = S.pendingOut === el.dataset.p ? null : el.dataset.p; render(); },
    swapin(el) {
      const d = S.draft, o = S.pendingOut, n = el.dataset.p;
      if (!o) return;
      const p = P(n);
      if (!p.team) { toast(`${n} isn't in a team yet`); return; }
      if (d.squad.filter((x) => x !== o && P(x).team === p.team).length >= cfg().maxPerTeam) { toast(`Max ${cfg().maxPerTeam} from ${p.team}`); return; }
      d.squad = d.squad.map((x) => (x === o ? n : x));
      ['sub', 'captain', 'vice'].forEach((k) => { if (d[k] === o) d[k] = n; });
      S.pendingOut = null; compute(); render();
    },
    confirmT() {
      compute();
      const st = myState(), c = cfg(), errs = draftErrors();
      if (errs.length) { toast(errs[0]); return; }
      openSheet(`<h2>Confirm transfers</h2><table><tbody>${st.outs.map((o, i) => `<tr><td class="down">↓ ${esc(o)}</td><td class="up">↑ ${esc(st.ins[i])}</td></tr>`).join('')}</tbody></table>
        <p>${st.hits ? `This costs <b>${st.hits} points</b> (${st.transfers} transfers, ${st.freeAvail} free).` : freeMode() ? 'No points cost (chip active).' : 'No points cost.'} Money left after: <b>${money(st.bank)}</b>.</p>
        <div class="acts"><button class="btn primary" data-act="doT">Confirm</button><button class="btn" data-act="close">Cancel</button></div>`);
    },
    async doT() { closeSheet(); await saveDraft(); },
    // points / league / stats
    bd(el) { breakdownSheet(el.dataset.p, S.pointsGw && D.scoredGws.includes(S.pointsGw) ? S.pointsGw : D.scoredGws[D.scoredGws.length - 1]); },
    bdw(el) { closeSheet(); breakdownSheet(el.dataset.p, Number(el.dataset.gw)); },
    seepts(el) { S.pointsUid = el.dataset.uid; go('points'); },
    chart(el) { S.chart = el.dataset.v; render(); },
    fpos(el) { S.f.pos = el.dataset.v; render(); },
    // admin
    async mssave(el) { S.admin.openKey = null; const s = readSheet(el.dataset.key); await guard(() => S.store.saveSheet(s.key, s), 'Match sheet saved ✓'); },
    async msguest(el) {
      const f = el.closest('form'), n = $('[data-msguest]', f).value, t = $('[data-msguestt]', f).value;
      if (!n) return;
      const s = readSheet(el.dataset.key); s.guests[n] = t; S.admin.openKey = el.dataset.key;
      await guard(() => S.store.saveSheet(s.key, s), `${n} added as a guest`);
    },
    async msunguest(el) { S.admin.openKey = el.dataset.key; const s = readSheet(el.dataset.key); delete s.guests[el.dataset.p]; for (const t of Object.keys(s.gk)) if (s.gk[t] === el.dataset.p) delete s.gk[t]; await guard(() => S.store.saveSheet(s.key, s), 'Guest removed'); },
    async gwsave(el) { const g = Number(el.dataset.gw), v = $(`[data-gwdl="${g}"]`).value; if (!v) { toast('Enter a deadline'); return; } await guard(() => S.store.saveGw(g, { deadline: new Date(v).getTime(), locked: S.data.gws[g].locked }), `Week ${g} saved`); },
    async gwlock(el) { const g = Number(el.dataset.gw), x = S.data.gws[g]; await guard(() => S.store.saveGw(g, { deadline: Math.min(x.deadline, Date.now()), locked: true }), `Week ${g} locked`); },
    async gwunlock(el) {
      const g = Number(el.dataset.gw), x = S.data.gws[g];
      if (x.deadline <= Date.now()) toast('Unlocked. The deadline has passed, so move it later to let managers edit again.');
      await guard(() => S.store.saveGw(g, { deadline: x.deadline, locked: false }));
    },
    async gwadd(el) { const g = Number(el.dataset.gw), v = $('#newdl').value; if (!v) { toast('Enter a deadline'); return; } await guard(() => S.store.saveGw(g, { deadline: new Date(v).getTime(), locked: false }), `Week ${g} is open`); },
    async budsave() {
      const b = Number($('#bud').value), from = Number($('#budgw').value);
      if (!(b > 0) || !(from >= 1)) { toast('Check the numbers'); return; }
      const h = (S.data.settings.budgetHistory || []).filter((x) => x.fromGw !== from).concat({ budget: b, fromGw: from }).sort((a, z) => a.fromGw - z.fromGw);
      await guard(() => S.store.saveSettings({ budgetHistory: h }), `Budget ${money(b)} from Week ${from}`);
    },
    async chips2() { const v = $('#chips2').value; await guard(() => S.store.saveSettings({ secondChipsFromGw: v ? Number(v) : null }), 'Saved'); },
    async papply(el) {
      const g = Number(el.dataset.gw), changes = {};
      $$('[data-pp]').forEach((i) => { if (i.checked) changes[i.dataset.pp] = Number(i.dataset.to); });
      const u = (S.data.priceUpdates || []).filter((x) => x.gw !== g).concat({ gw: g, at: Date.now(), changes }).sort((a, z) => a.gw - z.gw);
      await guard(() => S.store.savePriceUpdates(u), `${Object.keys(changes).length} price changes applied from Week ${g + 1}`);
    },
    async alload() { try { S.admin.allow = await S.store.getAllowlist(); render(); } catch (e) { toast('Couldn’t load the list'); } },
    async aladd() {
      const e = $('#aladd').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast('Enter a valid email'); return; }
      const list = [...new Set([...(S.admin.allow || []), e])].sort();
      await guard(() => S.store.saveAllowlist(list), `${e} can now play`); S.admin.allow = list; render();
    },
    async alrm(el) { const list = (S.admin.allow || []).filter((x) => x !== el.dataset.e); await guard(() => S.store.saveAllowlist(list), 'Removed'); S.admin.allow = list; render(); },
    async tname(el) { const uid = el.dataset.uid, v = $(`[data-tname="${CSS.escape(uid)}"]`).value.trim(); if (!v) return; await guard(() => S.store.saveManager({ ...S.data.managers[uid], teamName: v.slice(0, 30) }), 'Renamed'); },
    fxload() { const uid = $('#fxuid').value, g = Number($('#fxgw').value); const s = (D.state[uid] || {})[g]; const e = (S.data.entries[g] || {})[uid] || (s && s.entry); $('#fxjson').value = e ? JSON.stringify({ squad: e.squad, sub: e.sub, captain: e.captain, vice: e.vice, chip: e.chip || null }, null, 1) : ''; },
    async fxsave() {
      const uid = $('#fxuid').value, g = Number($('#fxgw').value);
      let e; try { e = JSON.parse($('#fxjson').value); } catch (x) { toast('That isn’t valid JSON'); return; }
      const errs = C.validate(S.L, cfg(), e); if (errs.length && !confirm(`This team has problems:\n${errs.join('\n')}\n\nSave anyway?`)) return;
      await guard(() => S.store.saveEntry(g, e, uid), `Saved ${S.data.managers[uid].teamName}'s Week ${g} team`);
    },
    exapp() { const sheets = { ...S.L.sheetsFile, ...S.data.sheets }; download('appearances.json', Object.values(sheets).sort((a, b) => (a.week - b.week) || a.key.localeCompare(b.key))); },
    exall() { download(`fantasy-backup-${new Date().toISOString().slice(0, 10)}.json`, { exported: Date.now(), ...S.data }); },
  };
  function resetSquadIfOverFree() { /* leaving a wildcard/free hit keeps the draft; transfers made now count against free transfers */ }

  const CH = {
    fteam(v) { S.f.team = v; }, fmax(v) { S.f.max = v; }, fsort(v) { S.f.sort = v; }, fq(v) { S.f.q = v; },
    pgw(v) { S.pointsGw = Number(v); }, puid(v) { S.pointsUid = v; }, totw(v) { S.totwGw = Number(v); },
    aweek(v) { S.admin.week = Number(v); }, pweek(v) { S.admin.pweek = Number(v); },
  };
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (el && A[el.dataset.act]) { ev.preventDefault(); A[el.dataset.act](el); return; }
    const tab = ev.target.closest('[data-tab]');
    if (tab && tab.closest('#tabs')) go(tab.dataset.tab);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.change && CH[el.dataset.change]) { CH[el.dataset.change](el.value); render(); }
    if (el.dataset.msp != null) el.closest('label').classList.toggle('abs', !el.checked);
  });
  let qTimer;
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.change === 'fq') { clearTimeout(qTimer); qTimer = setTimeout(() => { S.f.q = el.value; const pos = el.selectionStart; render(); const n = $('[data-change="fq"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });
  function go(tab) { S.tab = tab; history.replaceState(null, '', '#' + tab); closeSheet(); render(); window.scrollTo({ top: 0 }); }

  // ---------- loading ----------
  async function reload() {
    try {
      const keepDraft = S.draft && dirty() ? S.draft : null;
      S.data = await S.store.loadAll();
      S.member = true; S.offline = false;
      if (!S.data.settings) S.data.settings = {};
      if (S.store.isAdmin() && !S.store.demo && !S.data.settings.allowlistSeeded) {
        // first admin sign-in: save the starting allowlist from config.js
        try {
          const cur = await S.store.getAllowlist();
          const list = [...new Set([...cur, ...(CFG0.initialAllowlist || []).map((e) => e.toLowerCase())])].sort();
          await S.store.saveAllowlist(list);
          await S.store.saveSettings({ allowlistSeeded: true });
          S.data.settings.allowlistSeeded = true;
        } catch (e) { console.warn('allowlist seed', e); }
      }
      S.draft = null; S.draftGw = null;
      compute(); initDraft();
      if (keepDraft && savedEntry(D.openGw) && keepDraft.squad.join() === savedEntry(D.openGw).squad.join()) S.draft = keepDraft;
      compute();
    } catch (e) {
      const c = (e && e.code) || '';
      if (/permission-denied/.test(c)) { S.member = false; S.data = null; }
      else {
        const cached = S.store.cached();
        if (cached) { S.data = cached; S.member = true; S.offline = true; compute(); initDraft(); }
        else { S.data = null; $('#main').innerHTML = `<div class="gate"><div class="card"><h2>Can't reach the league</h2><p>${esc(navigator.onLine ? 'The database didn’t answer.' : 'You’re offline and nothing is saved on this device yet.')}</p><button class="btn" data-act="retry">Try again</button></div></div>`; return; }
      }
    }
    render();
  }
  A.retry = () => reload();

  async function start() {
    renderFoot();
    try {
      const [raw, playersFile] = await Promise.all([ST.loadLeague(), ST.loadPlayers()]);
      S.raw = raw;
      S.L = C.buildLeague(raw, playersFile);
      renderFoot();
      S.store = ST.create();
      await S.store.init({ L: S.L, cfg: CFG0, core: C });
    } catch (e) {
      console.error(e);
      $('#main').innerHTML = `<div class="gate"><div class="card"><h2>Couldn't start</h2><p>${esc(e.message || e)}</p></div></div>`;
      return;
    }
    S.store.onAuth(async (u) => { S.user = u; S.data = null; S.member = null; render(); if (u) await reload(); });
  }
  window.addEventListener('online', () => { S.offline = false; if (S.user) reload(); });
  window.addEventListener('offline', () => { S.offline = true; render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.member && !dirty()) reload(); });
  setInterval(() => { if (S.data && S.member) { const before = D.openGw; compute(); if (before !== D.openGw) { S.draft = null; S.draftGw = null; initDraft(); } banner(); } }, 60e3);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__duf = { S, D, A }; // for tests and debugging
  start();
})();
