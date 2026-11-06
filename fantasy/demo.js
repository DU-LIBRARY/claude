/* Demo data for ?demo: the real teams, squads and prices with made-up results, so every
   screen can be tried (and screenshotted) without signing in. Nothing is saved anywhere. */
(function () {
  'use strict';
  const DAY = 864e5;
  // small seeded random generator so the demo looks the same every time
  let rs = 7;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return (rs - 1) / 2147483646; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const now = Date.now();
  const gwDeadline = { 1: now - 13 * DAY, 2: now - 6 * DAY, 3: now + 3 * 3600e3 };
  const ymd = (t) => new Date(t).toISOString().slice(0, 10);

  async function league() {
    const base = window.FANTASY_CONFIG.localLeagueBase;
    const get = (f) => fetch(base + f).then((r) => r.json());
    const [config, squads, fx1, players] = await Promise.all([get('league.json'), get('data/squads.json'), get('fixtures/week-01.json'), fetch('players.json').then((r) => r.json())]);
    const price = Object.fromEntries(players.players.map((p) => [p.name, p]));
    const pairs = fx1.rounds.flatMap((r) => r.games.map((g) => g.teams));
    const matches = [], goals = [];
    let id = 1;
    for (const w of [1, 2]) {
      const date = ymd(gwDeadline[w] + 3600e3);
      for (const [h, a] of pairs) {
        const hg = Math.floor(rnd() * 4), ag = Math.floor(rnd() * 3);
        matches.push({ match: id, week: w, date, home: h, away: a, home_goals: hg, away_goals: ag });
        for (const [team, n] of [[h, hg], [a, ag]]) {
          const sq = squads.filter((s) => s.team === team).map((s) => s.player);
          // better and more attacking players score more often
          const weight = (n2) => { const p = price[n2] || { pos: 'MID', price: 5 }; return p.price * ({ GK: 0.1, DEF: 0.6, MID: 1, FWD: 1.6 }[p.pos]); };
          const draw = () => { const tot = sq.reduce((s, x) => s + weight(x), 0); let r = rnd() * tot; for (const x of sq) { r -= weight(x); if (r <= 0) return x; } return sq[0]; };
          for (let i = 0; i < n; i++) {
            const scorer = draw();
            let assist = rnd() < 0.7 ? draw() : null;
            if (assist === scorer) assist = null;
            goals.push({ match: id, team, scorer, assist, own_goal: false });
          }
        }
        id++;
      }
    }
    const fixtures = [1, 2, 3, 4].map((w) => ({ ...fx1, week: w, date: ymd((gwDeadline[w] || gwDeadline[3] + (w - 3) * 7 * DAY) + 3600e3),
      rounds: fx1.rounds.map((r, i) => ({ ...r, kickoff: ['14:00', '14:25', '14:50'][i], games: fx1.rounds[(i + w - 1) % 3].games })) }));
    return { config, squads, matches, goals, appearances: [], fixtures, fetched: now, source: 'demo' };
  }

  const me = { uid: 'me', email: 'you@example.com', displayName: 'You (demo)' };
  const MANAGERS = [
    ['me', 'Crimson Crescent', 'You', 'Muhammad Sharaf'],
    ['m2', 'Barakah Boys', 'Yusuf'],
    ['m3', 'Ikhlas XI', 'Bilal'],
    ['m4', 'Nasr FC', 'Zaid'],
    ['m5', 'Fajr Risers', 'Hamza'],
    ['m6', 'Sabr United', 'Adam'],
  ];

  // a random legal squad inside the budget
  function randomSquad(ctx) {
    const { L, cfg, core } = ctx;
    const by = (pos) => Object.values(L.players).filter((p) => p.pos === pos && p.team);
    for (let tries = 0; tries < 5000; tries++) {
      const f = pick(cfg.formations).split('-').map(Number);
      const want = { GK: 1, DEF: f[0], MID: f[1], FWD: f[2] };
      const subPos = pick(['DEF', 'MID', 'FWD']);
      want[subPos]++;
      const squad = [];
      for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
        const pool = by(pos).slice().sort(() => rnd() - 0.5);
        squad.push(...pool.slice(0, want[pos]).map((p) => p.name));
      }
      const cost = squad.reduce((s, n) => s + L.players[n].start, 0);
      const subs = squad.filter((n) => L.players[n].pos === subPos);
      const sub = subs[subs.length - 1];
      const st = squad.filter((n) => n !== sub).sort((a, b) => L.players[b].start - L.players[a].start);
      const e = { squad, sub, captain: st[0], vice: st[1], chip: null };
      if (cost <= cfg.budget && cost >= cfg.budget - 4 && !core.validate(L, cfg, e).length) return e;
    }
    throw new Error('no demo squad');
  }

  function seed(ctx) {
    const { L, core, cfg } = ctx;
    const managers = {}, entries = { 1: {}, 2: {}, 3: {} };
    for (const [uid, teamName, name, player] of MANAGERS) {
      managers[uid] = { uid, email: uid === 'me' ? me.email : `${name.toLowerCase()}@example.com`, name, teamName, player: player || null, joined: now - 20 * DAY };
      const e1 = randomSquad(ctx);
      if (uid === 'me') e1.chip = null;
      entries[1][uid] = { uid, ...e1, savedAt: gwDeadline[1] - DAY };
      // week 2: one or two transfers (same position, still legal), a chip for some
      let e2 = { ...e1, squad: e1.squad.slice() };
      const swaps = uid === 'm3' ? 2 : 1;
      for (let k = 0; k < swaps; k++) {
        for (let t = 0; t < 200; t++) {
          const out = pick(e2.squad.filter((n) => n !== e2.captain && n !== e2.vice && n !== e2.sub));
          const inn = pick(Object.values(L.players).filter((p) => p.team && p.pos === L.players[out].pos && !e2.squad.includes(p.name))).name;
          const next = { ...e2, squad: e2.squad.map((n) => (n === out ? inn : n)) };
          const st = core.replay(L, cfg, { entries: { 1: e1, 2: next }, gws: [1, 2] });
          if (!core.validate(L, cfg, next, { bank: st[2].bank, spending: true }).length) { e2 = next; break; }
        }
      }
      if (uid === 'm2') e2.chip = 'tc';
      if (uid === 'm5') e2.chip = 'bb';
      entries[2][uid] = { uid, ...e2, savedAt: gwDeadline[2] - DAY };
      if (uid !== 'me' && uid !== 'm6') entries[3][uid] = { uid, ...e2, chip: null, savedAt: now - 3600e3 };
    }
    // match sheets: week 1 filled in (a few absentees, a stand-in keeper), week 2 only partly
    const sheets = {};
    const w1 = L.matchesOfWeek(1), w2 = L.matchesOfWeek(2);
    w1.forEach((m, i) => {
      const s = { key: m.key, week: 1, absent: [], gk: {}, saves: {}, yellow: {}, done: true, updated: gwDeadline[1] + DAY };
      if (i === 1) s.absent.push(L.squadByTeam[m.home][4]);
      if (i === 3) { s.gk[m.away] = L.squadByTeam[m.away][2]; }
      const gk = Object.values(L.players).find((p) => p.team === m.home && p.pos === 'GK');
      if (gk) s.saves[gk.name] = 2 + (i % 4);
      if (i === 4) s.yellow[L.squadByTeam[m.away][1]] = 1;
      sheets[m.key] = s;
    });
    w2.slice(0, 4).forEach((m, i) => { sheets[m.key] = { key: m.key, week: 2, absent: i === 0 ? [L.squadByTeam[m.away][6]] : [], gk: {}, done: true, updated: gwDeadline[2] + DAY }; });
    const prop = core.proposePrices(L, sheets, cfg, 1, {});
    const priceUpdates = [{ gw: 1, at: gwDeadline[1] + 2 * DAY, changes: Object.fromEntries(prop.map((p) => [p.name, p.to])) }];
    const gws = {};
    for (const g of [1, 2, 3]) gws[g] = { gw: g, deadline: gwDeadline[g], locked: false };
    return {
      settings: { budgetHistory: [{ budget: cfg.budget, fromGw: 1 }], secondChipsFromGw: null },
      priceUpdates, gws, managers, sheets, entries,
      allowlist: MANAGERS.map(([, , n]) => `${n.toLowerCase()}@example.com`),
    };
  }

  window.FantasyDemo = { league, seed, me };
})();
