/* Darul Uloom Fantasy League: the rules engine.
   Pure functions only (no DOM, no network), shared by the app and the unit tests.
   Every point is computed from the league data (league.json, squads, matches, goals)
   plus the admin's match sheets. Nothing here is typed in by hand. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FantasyCore = factory();
})(this, function () {
  'use strict';

  // ---------- names (same folding as the league scripts' lib.mjs) ----------
  const fold = (s) => String(s ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[ʾʿ'’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

  const POS = ['GK', 'DEF', 'MID', 'FWD'];
  const round1 = (x) => Math.round(x * 10) / 10;
  const money = (x) => '£' + (Math.round(x * 10) / 10).toFixed(1) + 'm';

  // ---------- league index ----------
  // raw: { config (league.json), squads, matches, goals, fixtures: [week json…], appearances: [sheet…] }
  // playersFile: fantasy/players.json
  function buildLeague(raw, playersFile) {
    const config = raw.config || raw.league || {};
    const teams = config.teams || [];
    const squads = raw.squads || [];
    const players = {};
    for (const p of playersFile.players || []) players[p.name] = { name: p.name, team: p.team ?? null, pos: p.pos, start: p.price, status: p.status || null, news: p.news || '' };
    // anyone in the league squads but missing from players.json still scores (priced at the floor, flagged)
    for (const s of squads) {
      if (!players[s.player]) players[s.player] = { name: s.player, team: s.team, pos: 'MID', start: 4.0, status: null, news: 'Not priced yet', unpriced: true };
      else players[s.player].team = s.team; // squads.json is the source of truth for teams
    }
    const squadByTeam = {};
    for (const t of teams) squadByTeam[t.name] = [];
    for (const s of squads) (squadByTeam[s.team] = squadByTeam[s.team] || []).push(s.player);

    const L = { config, teams, players, squadByTeam, matches: [], goals: [], fixtures: (raw.fixtures || []).filter(Boolean), weeks: [] };
    L.short = (team) => (teams.find((t) => t.name === team) || {}).short || String(team).slice(0, 3).toUpperCase();
    L.resolveTeam = (name) => {
      const k = fold(name);
      const t = teams.find((x) => fold(x.name) === k || fold(x.short) === k || fold(x.crest_text) === k);
      return t ? t.name : null;
    };
    L.resolvePlayer = (name, team) => {
      if (!name) return null;
      const k = fold(name);
      const tryPool = (pool) => {
        const exact = pool.find((n) => fold(n) === k);
        if (exact) return exact;
        const pre = pool.filter((n) => fold(n).startsWith(k));
        return pre.length === 1 ? pre[0] : null;
      };
      return (team && tryPool(squadByTeam[team] || [])) || tryPool(Object.keys(players));
    };

    L.matches = (raw.matches || []).map((m) => ({
      match: Number(m.match), week: Number(m.week), date: String(m.date || '').slice(0, 10),
      home: L.resolveTeam(m.home) || m.home, away: L.resolveTeam(m.away) || m.away,
      home_goals: Number(m.home_goals), away_goals: Number(m.away_goals),
    })).sort((a, b) => a.week - b.week || a.date.localeCompare(b.date) || a.match - b.match);

    // Match sheets are keyed by week + the two teams (not the match id, which the league
    // scripts renumber when a week is corrected with --replace).
    const seen = {};
    for (const m of L.matches) {
      const pair = [L.short(m.home), L.short(m.away)].sort().join('-');
      const base = `w${m.week}-${pair}`;
      seen[base] = (seen[base] || 0) + 1;
      m.key = seen[base] > 1 ? `${base}-${seen[base]}` : base;
    }
    const byId = Object.fromEntries(L.matches.map((m) => [m.match, m]));
    L.goals = (raw.goals || []).map((g) => {
      const m = byId[Number(g.match)];
      const team = L.resolveTeam(g.team) || g.team;
      const og = !!g.own_goal && g.own_goal !== 'false';
      const other = m ? (team === m.home ? m.away : m.home) : null;
      return {
        match: Number(g.match), team, own_goal: og,
        scorer: L.resolvePlayer(g.scorer, og ? other : team),
        assist: og ? null : L.resolvePlayer(g.assist, team),
      };
    }).filter((g) => byId[g.match]);
    L.weeks = [...new Set(L.matches.map((m) => m.week))].sort((a, b) => a - b);
    L.matchesOfWeek = (w) => L.matches.filter((m) => m.week === w);
    L.goalsOf = (id) => L.goals.filter((g) => g.match === id);
    L.sheetsFile = {};
    for (const s of raw.appearances || []) if (s && s.key) L.sheetsFile[s.key] = s;
    return L;
  }

  // Firestore sheets (live) win over the appearances.json copy in the league repo.
  const sheetFor = (L, sheets, key) => (sheets && sheets[key]) || L.sheetsFile[key] || null;

  // ---------- who played in a match ----------
  // Default: every squad member played, the team's listed GK kept goal. The sheet records
  // absentees, who was in goal, and "guests" (a player who turned out for another team).
  function lineups(L, m, sheet) {
    const s = sheet || {};
    const absent = new Set(s.absent || []);
    const guests = s.guests || {};
    const out = {};
    for (const t of [m.home, m.away]) {
      const own = (L.squadByTeam[t] || []).filter((n) => !absent.has(n) && !(guests[n] && guests[n] !== t && (guests[n] === m.home || guests[n] === m.away)));
      const visiting = Object.keys(guests).filter((n) => guests[n] === t && !absent.has(n) && !own.includes(n));
      const players = own.concat(visiting);
      let gk;
      if (s.gk && Object.prototype.hasOwnProperty.call(s.gk, t)) gk = players.includes(s.gk[t]) ? s.gk[t] : null;
      else gk = own.find((n) => L.players[n] && L.players[n].pos === 'GK') || null;
      out[t] = { players, gk };
    }
    return out;
  }

  const LABELS = {
    played: 'Played', goal: 'Goals', assist: 'Assists', cleanSheet: 'Clean sheet', per2Conceded: 'Goals conceded',
    per3Saves: 'Saves', penaltySaved: 'Penalty saved', penaltyMissed: 'Penalty missed', yellowCard: 'Yellow card', redCard: 'Red card', ownGoal: 'Own goal',
  };

  // Points for one player in one match. role = the scoring table used (GK if he kept goal).
  function matchPoints(L, cfg, m, lu, sheet, name) {
    const team = [m.home, m.away].find((t) => lu[t].players.includes(name));
    if (!team) return null;
    const opp = team === m.home ? m.away : m.home;
    const p = L.players[name] || { pos: 'MID' };
    const role = lu[team].gk === name ? 'GK' : (p.pos === 'GK' ? (cfg.outfieldTableForKeepers || 'DEF') : p.pos);
    const conceded = team === m.home ? m.away_goals : m.home_goals;
    const gs = L.goalsOf(m.match);
    const s = sheet || {};
    const n = (map) => Number((map || {})[name] || 0);
    const stats = {
      played: 1,
      goal: gs.filter((g) => !g.own_goal && g.scorer === name).length,
      assist: gs.filter((g) => !g.own_goal && g.assist === name).length,
      cleanSheet: conceded === 0 ? 1 : 0,
      per2Conceded: Math.floor(conceded / 2),
      per3Saves: Math.floor(n(s.saves) / 3),
      penaltySaved: n(s.penSaved),
      penaltyMissed: n(s.penMissed),
      yellowCard: n(s.yellow),
      redCard: n(s.red),
      ownGoal: gs.filter((g) => g.own_goal && g.scorer === name).length,
    };
    const sc = cfg.scoring;
    const lines = [];
    let pts = 0;
    for (const k of Object.keys(sc)) {
      const per = sc[k][role] || 0;
      const v = stats[k] * per;
      if (stats[k] && (v || k === 'played')) lines.push({ k, label: LABELS[k] || k, n: stats[k], pts: v });
      pts += v;
    }
    return { key: m.key, match: m.match, team, opp, role, score: `${m.home_goals}-${m.away_goals}`, home: m.home, away: m.away, conceded, saves: n(s.saves), lines, pts, provisional: !sheet };
  }

  // Every player's points for a week: { name: { pts, played, matches:[…], provisional } }
  function weekPoints(L, sheets, week, cfg) {
    const res = {};
    for (const n of Object.keys(L.players)) res[n] = { name: n, pts: 0, played: 0, matches: [], provisional: false, appearancePts: 0 };
    for (const m of L.matchesOfWeek(week)) {
      const sheet = sheetFor(L, sheets, m.key);
      const lu = lineups(L, m, sheet);
      for (const t of [m.home, m.away]) for (const n of lu[t].players) {
        const mp = matchPoints(L, cfg, m, lu, sheet, n);
        if (!mp) continue;
        const r = res[n] || (res[n] = { name: n, pts: 0, played: 0, matches: [], provisional: false, appearancePts: 0 });
        r.matches.push(mp); r.pts += mp.pts; r.played++;
        r.appearancePts += (mp.lines.find((l) => l.k === 'played') || { pts: 0 }).pts;
        if (mp.provisional) r.provisional = true;
      }
    }
    return res;
  }

  // ---------- squad shape ----------
  function counts(L, names) {
    const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const n of names) { const p = L.players[n]; if (p) c[p.pos]++; }
    return c;
  }
  // '3-3-1' if `starters` is a legal starting 8, else null
  function formationOf(L, cfg, starters) {
    if (starters.length !== cfg.starters) return null;
    const c = counts(L, starters);
    const f = `${c.DEF}-${c.MID}-${c.FWD}`;
    return c.GK === 1 && cfg.formations.includes(f) ? f : null;
  }
  const startersOf = (entry) => entry.squad.filter((n) => n !== entry.sub);

  // Validation messages for a squad (budget is checked separately with the money from replay()).
  function validate(L, cfg, entry, opts = {}) {
    const errs = [];
    const sq = entry.squad || [];
    const teamShort = (t) => t;
    if (new Set(sq).size !== sq.length) errs.push('A player is in your squad twice');
    if (sq.length < cfg.squadSize) errs.push(`Pick ${cfg.squadSize - sq.length} more player${cfg.squadSize - sq.length === 1 ? '' : 's'}`);
    if (sq.length > cfg.squadSize) errs.push(`Only ${cfg.squadSize} players allowed`);
    const byTeam = {};
    for (const n of sq) {
      const p = L.players[n];
      if (!p) { errs.push(`${n} isn't in the player list`); continue; }
      if (!p.team) errs.push(`${n} isn't in a team yet`);
      else byTeam[p.team] = (byTeam[p.team] || 0) + 1;
    }
    for (const [t, k] of Object.entries(byTeam)) if (k > cfg.maxPerTeam) errs.push(`Max ${cfg.maxPerTeam} from ${teamShort(t)}`);
    const c = counts(L, sq);
    if (c.GK > 1) errs.push('Only 1 goalkeeper allowed');
    if (sq.length === cfg.squadSize) {
      if (c.GK === 0) errs.push('You need a goalkeeper');
      if (!entry.sub || !sq.includes(entry.sub)) errs.push('Choose a substitute');
      else if (L.players[entry.sub] && L.players[entry.sub].pos === 'GK') errs.push('The substitute must be an outfield player');
      else if (!formationOf(L, cfg, startersOf(entry))) {
        const s = counts(L, startersOf(entry));
        errs.push(`${s.DEF}-${s.MID}-${s.FWD} isn't an allowed formation (${cfg.formations.join(', ')})`);
      }
      const st = startersOf(entry);
      if (!entry.captain || !st.includes(entry.captain)) errs.push('Choose a captain from your starting 8');
      if (!entry.vice || !st.includes(entry.vice)) errs.push('Choose a vice-captain from your starting 8');
      else if (entry.vice === entry.captain) errs.push('Captain and vice-captain must be different players');
    }
    if (opts.bank != null && opts.bank < -1e-9 && opts.spending) errs.push(`Over budget by ${money(-opts.bank)}`);
    return errs;
  }

  // ---------- THE scoring function ----------
  // scoreTeam(L, sheets, entry, { week, cfg, hits }) → points for one manager's team in one week.
  // entry: { squad:[9 names], sub, captain, vice, chip: null|'wc'|'tc'|'bb'|'fh' }
  function scoreTeam(L, sheets, entry, opts) {
    const cfg = opts.cfg;
    const wp = opts.weekPts || weekPoints(L, sheets, opts.week, cfg);
    const P = (n) => wp[n] || { pts: 0, played: 0, matches: [] };
    const bb = entry.chip === 'bb';
    let xi = startersOf(entry);
    const autoSubs = [];
    // Auto-sub: the first starting outfielder who played in none of the week's matches is
    // replaced by the sub (if the sub played and the formation stays legal). Keepers are never replaced.
    if (!bb && entry.sub && P(entry.sub).played > 0) {
      for (const n of xi) {
        const p = L.players[n];
        if (!p || p.pos === 'GK' || P(n).played > 0) continue;
        const next = xi.map((x) => (x === n ? entry.sub : x));
        if (formationOf(L, cfg, next)) { autoSubs.push({ out: n, in: entry.sub }); xi = next; break; }
      }
    }
    const counted = bb ? entry.squad.slice() : xi;
    const mult = entry.chip === 'tc' ? cfg.tripleCaptainMultiplier : cfg.captainMultiplier;
    let cap = null;
    if (entry.captain && xi.includes(entry.captain) && P(entry.captain).played > 0) cap = entry.captain;
    else if (entry.vice && xi.includes(entry.vice) && P(entry.vice).played > 0) cap = entry.vice;
    const players = entry.squad.map((n) => {
      const isCounted = counted.includes(n);
      const m = n === cap ? mult : (isCounted ? 1 : 0);
      return { name: n, pts: P(n).pts, played: P(n).played, multiplier: m, total: P(n).pts * m, counted: isCounted, starter: xi.includes(n),
        captain: n === entry.captain, vice: n === entry.vice, armband: n === cap, provisional: !!P(n).provisional, matches: P(n).matches };
    });
    const gross = players.reduce((s, p) => s + p.total, 0);
    const hits = opts.hits || 0;
    const bench = players.filter((p) => !p.counted).reduce((s, p) => s + p.pts, 0);
    return {
      week: opts.week, chip: entry.chip || null, players, autoSubs, captainUsed: cap,
      captainFallback: !!(cap && cap !== entry.captain),
      captainPts: cap ? P(cap).pts * mult : 0,
      gross, hits, total: gross - hits, benchPoints: bench,
      provisional: players.some((p) => p.counted && p.provisional),
    };
  }

  // ---------- money ----------
  const floorStep = (x, step) => Math.floor(x / step + 1e-9) * step;
  // FPL selling price: purchase price plus half of any rise, rounded down to £0.5m.
  function sellPrice(bought, now, step = 0.5) {
    if (bought == null) return now;
    if (now <= bought) return now;
    return round1(bought + floorStep((now - bought) / 2, step));
  }
  // Player prices in force for a gameweek. Updates run after week k apply from week k+1.
  function pricesAt(L, updates, gw) {
    const pr = {};
    for (const [n, p] of Object.entries(L.players)) pr[n] = p.start;
    for (const u of (updates || []).slice().sort((a, b) => a.gw - b.gw)) {
      if (u.gw >= gw) continue;
      for (const [n, v] of Object.entries(u.changes || {})) pr[n] = v;
    }
    return pr;
  }
  // Budget in force for a gameweek: the latest admin change with fromGw <= gw.
  function budgetAt(cfg, history, gw) {
    let b = cfg.budget;
    for (const h of (history || []).slice().sort((a, b2) => a.fromGw - b2.fromGw)) if (h.fromGw <= gw) b = h.budget;
    return b;
  }

  // ---------- season replay: transfers, hits, money, chips ----------
  // entries: { gw: entry } for one manager. gws: every gameweek number up to the one wanted.
  // Missing weeks carry the previous squad forward. Returns { gw: state }.
  function replay(L, cfg, { entries, gws, updates, budgetHistory }) {
    const out = {};
    let owned = null, bought = {}, realized = 0, ft = 0, base = null;
    const used = {}; // chip -> [gw]
    for (const gw of gws.slice().sort((a, b) => a - b)) {
      const own = entries[gw];
      const e = own || (base ? { squad: base.squad.slice(), sub: base.sub, captain: base.captain, vice: base.vice, chip: null, carried: true } : null);
      if (!e) { out[gw] = null; continue; }
      const prices = pricesAt(L, updates, gw);
      const budget = budgetAt(cfg, budgetHistory, gw);
      let ins = [], outs = [], hits = 0, freeAvail, nb = bought, nr = realized;
      if (!owned) {
        freeAvail = Infinity;
        nb = {}; for (const n of e.squad) nb[n] = prices[n];
      } else {
        freeAvail = (e.chip === 'wc' || e.chip === 'fh') ? Infinity : ft;
        ins = e.squad.filter((n) => !owned.includes(n));
        outs = owned.filter((n) => !e.squad.includes(n));
        if (e.chip !== 'wc' && e.chip !== 'fh') hits = Math.max(0, ins.length - ft) * cfg.transferHit;
        nb = {}; nr = realized;
        for (const n of e.squad) nb[n] = owned.includes(n) ? bought[n] : prices[n];
        for (const n of outs) nr += sellPrice(bought[n], prices[n], cfg.priceStep) - bought[n];
      }
      const cost = e.squad.reduce((s, n) => s + (nb[n] ?? prices[n] ?? 0), 0);
      const bank = round1(budget - cost + nr);
      const value = round1(e.squad.reduce((s, n) => s + (prices[n] ?? 0), 0));
      const sellValue = round1(e.squad.reduce((s, n) => s + sellPrice(nb[n], prices[n], cfg.priceStep), 0));
      if (e.chip) (used[e.chip] = used[e.chip] || []).push(gw);
      const ftNext = !owned ? cfg.freeTransfersPerWeek
        : (e.chip === 'wc' || e.chip === 'fh') ? Math.min(cfg.maxFreeTransfers, ft + cfg.freeTransfersPerWeek)
          : Math.min(cfg.maxFreeTransfers, Math.max(0, ft - ins.length) + cfg.freeTransfersPerWeek);
      out[gw] = { gw, entry: e, ins, outs, transfers: ins.length, freeAvail, hits, bank, value, sellValue, budget, bought: nb, prices, ftNext, chipsUsed: JSON.parse(JSON.stringify(used)), first: !owned };
      ft = ftNext;
      if (e.chip !== 'fh') { owned = e.squad.slice(); bought = nb; realized = nr; base = e; }
    }
    return out;
  }

  // Chips still available in a gameweek, given chips used before it.
  function chipsAvailable(cfg, usedBefore, gw, firstGw) {
    const half = (g) => (cfg.secondChipsFromGw && g >= cfg.secondChipsFromGw ? 2 : 1);
    const res = {};
    for (const c of Object.keys(cfg.chips)) {
      const usedThisHalf = (usedBefore[c] || []).some((g) => g < gw && half(g) === half(gw));
      res[c] = !usedThisHalf && !((c === 'wc' || c === 'fh') && gw === firstGw);
    }
    return res;
  }

  // ---------- form-based price updates ----------
  function proposePrices(L, sheets, cfg, week, current) {
    const R = cfg.prices;
    const weeks = L.weeks.filter((w) => w <= week).slice(-R.formWeeks);
    const per = weeks.map((w) => weekPoints(L, sheets, w, cfg));
    const out = [];
    for (const [n, p] of Object.entries(L.players)) {
      if (!p.team) continue;
      const form = per.reduce((s, wp) => s + (wp[n] ? wp[n].pts : 0), 0);
      const appear = per.reduce((s, wp) => s + (wp[n] ? wp[n].appearancePts : 0), 0);
      const returns = form - appear;
      const from = current[n] ?? p.start;
      let to = from, reason = '';
      if (form >= R.riseIfFormAtLeast) { to = from + R.step; reason = `${form} pts in the last ${weeks.length} week${weeks.length === 1 ? '' : 's'}`; }
      else if (returns <= R.fallIfReturnsAtMost) { to = from - R.step; reason = form ? 'blanked: appearance points only' : 'blanked: no points'; }
      to = round1(Math.min(p.start + R.maxMoveFromStart, Math.max(p.start - R.maxMoveFromStart, to)));
      if (to !== from) out.push({ name: n, from, to, form, returns, reason });
    }
    return out.sort((a, b) => (b.to - b.from) - (a.to - a.from) || b.form - a.form);
  }

  // ---------- Team of the Week: best legal 8 (formation + max per team) ----------
  function teamOfTheWeek(L, cfg, wp) {
    const pool = (pos) => Object.values(L.players).filter((p) => p.pos === pos && p.team && wp[p.name] && wp[p.name].played > 0)
      .sort((a, b) => wp[b.name].pts - wp[a.name].pts || a.name.localeCompare(b.name));
    const combos = (arr, k) => {
      const res = [];
      const rec = (i, acc) => { if (acc.length === k) { res.push(acc.slice()); return; } for (let j = i; j < arr.length; j++) { acc.push(arr[j]); rec(j + 1, acc); acc.pop(); } };
      rec(0, []); return res;
    };
    let best = null;
    const gks = pool('GK').slice(0, 4);
    for (const f of cfg.formations) {
      const [d, m, fw] = f.split('-').map(Number);
      const D = pool('DEF').slice(0, d + 4), M = pool('MID').slice(0, m + 4), F = pool('FWD').slice(0, fw + 4);
      if (D.length < d || M.length < m || F.length < fw || !gks.length) continue;
      const cd = combos(D, d), cm = combos(M, m), cf = combos(F, fw);
      for (const g of gks) for (const a of cd) for (const b of cm) for (const c of cf) {
        const xi = [g, ...a, ...b, ...c];
        const byT = {}; let ok = true;
        for (const p of xi) { byT[p.team] = (byT[p.team] || 0) + 1; if (byT[p.team] > cfg.maxPerTeam) { ok = false; break; } }
        if (!ok) continue;
        const tot = xi.reduce((s, p) => s + wp[p.name].pts, 0);
        if (!best || tot > best.total) best = { total: tot, formation: f, players: xi.map((p) => p.name) };
      }
    }
    return best;
  }

  // ---------- real league table (same rules as the league scripts) ----------
  function standings(L, upToWeek) {
    const pts = (L.config.points) || { win: 3, draw: 1, loss: 0 };
    const t = {};
    for (const tm of L.teams) t[tm.name] = { team: tm.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
    for (const m of L.matches) {
      if (upToWeek != null && m.week > upToWeek) continue;
      const h = t[m.home], a = t[m.away], hg = m.home_goals, ag = m.away_goals;
      if (!h || !a) continue;
      h.played++; a.played++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
      if (hg > ag) { h.won++; a.lost++; h.points += pts.win; a.points += pts.loss; }
      else if (hg < ag) { a.won++; h.lost++; a.points += pts.win; h.points += pts.loss; }
      else { h.drawn++; a.drawn++; h.points += pts.draw; a.points += pts.draw; }
    }
    const rows = Object.values(t);
    rows.forEach((r) => { r.gd = r.gf - r.ga; });
    return rows.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
  }

  // Deadline from a fixtures/week-NN.json: N hours before the earliest kickoff (local time).
  function deadlineFromFixture(fx, hours) {
    if (!fx || !fx.date) return null;
    const ks = (fx.rounds || []).map((r) => r.kickoff).filter((k) => /^\d{1,2}:\d{2}/.test(k || '')).sort();
    if (!ks.length) return null;
    const [h, mi] = ks[0].split(':').map(Number);
    const d = new Date(`${fx.date}T00:00:00`);
    d.setHours(h, mi, 0, 0);
    return d.getTime() - hours * 3600e3;
  }

  // ---------- mini-league ----------
  // results: { uid: { gw: total } } → rows with totals, ranks and movement since last week
  function leagueTable(managers, results, gws) {
    const done = gws.slice().sort((a, b) => a - b);
    const last = done[done.length - 1], prev = done[done.length - 2];
    const totalTo = (uid, g) => done.filter((x) => x <= g).reduce((s, x) => s + ((results[uid] || {})[x] || 0), 0);
    const rankAt = (g) => {
      const arr = managers.map((m) => ({ uid: m.uid, t: g == null ? 0 : totalTo(m.uid, g), name: m.teamName || '' }))
        .sort((a, b) => b.t - a.t || a.name.localeCompare(b.name));
      const r = {}; arr.forEach((x, i) => { r[x.uid] = (i > 0 && arr[i - 1].t === x.t) ? r[arr[i - 1].uid] : i + 1; }); return r;
    };
    const now = rankAt(last), before = prev != null ? rankAt(prev) : null;
    return managers.map((m) => ({
      uid: m.uid, teamName: m.teamName, manager: m.name || '',
      gw: last != null ? ((results[m.uid] || {})[last] || 0) : 0,
      total: last != null ? totalTo(m.uid, last) : 0,
      rank: now[m.uid], move: before ? before[m.uid] - now[m.uid] : 0,
      history: done.map((g) => ({ gw: g, total: totalTo(m.uid, g), rank: rankAt(g)[m.uid] })),
    })).sort((a, b) => a.rank - b.rank || a.teamName.localeCompare(b.teamName));
  }

  // rows: [{ uid, teamName, gw, month, total, captainPts, benchPoints }]
  function awards(rows) {
    const top = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a))[0] || null;
    const sum = (key) => {
      const s = {};
      for (const r of rows) { s[r.uid] = s[r.uid] || { uid: r.uid, teamName: r.teamName, v: 0 }; s[r.uid].v += r[key]; }
      return Object.values(s);
    };
    const months = {};
    for (const r of rows) {
      if (!r.month) continue;
      const m = (months[r.month] = months[r.month] || {});
      m[r.uid] = m[r.uid] || { uid: r.uid, teamName: r.teamName, v: 0 }; m[r.uid].v += r.total;
    }
    return {
      managerOfMonth: Object.entries(months).sort().map(([month, m]) => ({ month, winner: top(Object.values(m), (x) => x.v) })),
      bestCaptain: top(sum('captainPts'), (x) => x.v),
      benchRegret: top(sum('benchPoints'), (x) => x.v),
      byWeek: [...new Set(rows.map((r) => r.gw))].sort((a, b) => a - b).map((gw) => {
        const w = rows.filter((r) => r.gw === gw);
        return { gw, top: top(w, (r) => r.total), captain: top(w, (r) => r.captainPts), bench: top(w, (r) => r.benchPoints) };
      }),
    };
  }

  return {
    fold, money, round1, POS, buildLeague, sheetFor, lineups, matchPoints, weekPoints, counts, formationOf, startersOf,
    validate, scoreTeam, sellPrice, pricesAt, budgetAt, replay, chipsAvailable, proposePrices, teamOfTheWeek,
    standings, deadlineFromFixture, leagueTable, awards,
  };
});
