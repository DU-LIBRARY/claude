// Unit tests for the rules engine. Run: node --test fantasy/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');
const CFG = require('../config.js');
const here = new URL('..', import.meta.url).pathname;
const read = (p) => JSON.parse(fs.readFileSync(here + p, 'utf8'));
const leagueJson = read('data/league/league.json');
const squads = read('data/league/data/squads.json');
const playersFile = read('players.json');

const NAS = 'An-Nāṣirūn', FAI = 'Al-Fāʾizūn', MUF = 'Al-Mufliḥūn', SAB = 'As-Sābiqūn';
// Week 1: everyone plays everyone once (3 rounds of 2). Scores chosen per test.
function league(scores = {}, goals = [], extraWeeks = []) {
  const pairs = [[MUF, SAB], [NAS, FAI], [NAS, MUF], [FAI, SAB], [FAI, MUF], [NAS, SAB]];
  const matches = pairs.map(([h, a], i) => ({ match: i + 1, week: 1, date: '2026-11-14', home: h, away: a, home_goals: (scores[i + 1] || [0, 0])[0], away_goals: (scores[i + 1] || [0, 0])[1] }));
  extraWeeks.forEach((w, j) => pairs.forEach(([h, a], i) => matches.push({ match: 100 * (j + 2) + i + 1, week: j + 2, date: `2026-11-${21 + 7 * j}`, home: h, away: a, home_goals: 0, away_goals: 0 })));
  return C.buildLeague({ config: leagueJson, squads, matches, goals }, playersFile);
}
const pts = (L, sheets = {}, w = 1) => C.weekPoints(L, sheets, w, CFG);

// A legal 2-3-2 + sub squad (max 3 per team):
//  GK Zaid (SAB) · DEF Furqan (NAS), Abdullah Patel (MUF) · MID Shahid (FAI), Bilal (SAB), Macci (MUF)
//  FWD Asjad (NAS), Hamza Y (FAI) · sub DEF Muhammad Rawat (SAB)
const team = (over = {}) => ({
  squad: ['Zaid Shamim', 'Muhammad Furqan', 'Abdullah Patel', 'Shahid Omarmia', 'Bilal Anees', 'Muhammad Y Macci', 'Asjad Patel', 'Hamza Yousofzai', 'Muhammad Rawat'],
  sub: 'Muhammad Rawat', captain: 'Hamza Yousofzai', vice: 'Asjad Patel', chip: null, ...over,
});
const absentAllWeek = (L, name) => {
  const s = {};
  for (const m of L.matchesOfWeek(1)) s[m.key] = { key: m.key, absent: [name] };
  return s;
};

test('name folding: a goal written loosely in the league data still scores', () => {
  const L = league({ 2: [1, 0] }, [{ match: 2, team: 'An Nasirun', scorer: 'asjad', assist: 'Muhammad Furqan', own_goal: false }]);
  const p = pts(L);
  // Asjad (FWD) 3 matches x 2 + goal 4 = 10
  assert.equal(p['Asjad Patel'].pts, 10);
  assert.equal(p['Asjad Patel'].played, 3);
  // Furqan (DEF): played 3x2, assist 3, clean sheets: all 3 matches 0 conceded -> 3x4
  assert.equal(p['Muhammad Furqan'].pts, 6 + 3 + 12);
});

test('clean sheets and goals conceded add up across the 3 matches', () => {
  // NAS concede 0 v FAI (m2), 1 v MUF (m3), 2 v SAB (m6)
  const L = league({ 2: [0, 0], 3: [0, 1], 6: [3, 2] });
  const w = pts(L)['Muhammad Furqan'];
  // 3 x played (6) + 1 clean sheet (4) + 2 conceded in m6 (-1) = 9
  assert.equal(w.pts, 9);
  assert.deepEqual(w.matches.map((m) => m.conceded), [0, 1, 2]);
  // MID gets 1 per clean sheet, no conceded penalty; FWD gets nothing for either
  const L2 = league({ 1: [0, 3] });
  assert.equal(pts(L2)['Muhammad Y Macci'].pts, 6 + 2 /* CS in m3 and m5 */);
  assert.equal(pts(L2)['Haizam Jiffry'].pts, 6);
});

test('captain doubled; vice-captain doubled when the captain plays none of the 3 matches', () => {
  const L = league({ 2: [0, 1] }, [{ match: 2, team: FAI, scorer: 'Hamza Yousofzai', own_goal: false }]);
  const base = C.scoreTeam(L, {}, team(), { week: 1, cfg: CFG });
  const hy = base.players.find((p) => p.name === 'Hamza Yousofzai');
  assert.equal(hy.pts, 10); assert.equal(hy.multiplier, 2); assert.equal(base.captainUsed, 'Hamza Yousofzai');

  const sheets = absentAllWeek(L, 'Hamza Yousofzai');
  const r = C.scoreTeam(L, sheets, team(), { week: 1, cfg: CFG });
  assert.equal(r.captainUsed, 'Asjad Patel');
  assert.equal(r.captainFallback, true);
  assert.equal(r.players.find((p) => p.name === 'Asjad Patel').multiplier, 2);
  // if both miss, nobody is doubled
  const both = { ...sheets };
  for (const k of Object.keys(both)) both[k] = { ...both[k], absent: ['Hamza Yousofzai', 'Asjad Patel'] };
  assert.equal(C.scoreTeam(L, both, team(), { week: 1, cfg: CFG }).captainUsed, null);
});

test('auto-sub: the sub replaces a starting outfielder who missed all 3 matches', () => {
  const L = league();
  const sheets = absentAllWeek(L, 'Abdullah Patel');
  const r = C.scoreTeam(L, sheets, team(), { week: 1, cfg: CFG });
  assert.deepEqual(r.autoSubs, [{ out: 'Abdullah Patel', in: 'Muhammad Rawat' }]);
  assert.equal(r.players.find((p) => p.name === 'Muhammad Rawat').counted, true);
  assert.equal(r.players.find((p) => p.name === 'Abdullah Patel').counted, false);
});

test('auto-sub only when the formation stays legal, and never for the goalkeeper', () => {
  const L = league();
  // Hamza Y (one of 2 FWDs) missing: DEF sub would make 3-3-1, which is legal -> sub on
  let r = C.scoreTeam(L, absentAllWeek(L, 'Hamza Yousofzai'), team(), { week: 1, cfg: CFG });
  assert.equal(r.autoSubs.length, 1);
  // 4-2-1 squad (sub MID): the lone FWD missing -> 4-3-0 is illegal -> no sub
  const t421 = { squad: ['Zaid Shamim', 'Muhammad Furqan', 'Abdullah Patel', 'Ilyas Seedat', 'Umar Patel', 'Shahid Omarmia', 'Bilal Anees', 'Hamza Yousofzai', 'Adam Sayani'], sub: 'Adam Sayani', captain: 'Bilal Anees', vice: 'Shahid Omarmia', chip: null };
  assert.equal(C.formationOf(L, CFG, C.startersOf(t421)), '4-2-1');
  r = C.scoreTeam(L, absentAllWeek(L, 'Hamza Yousofzai'), t421, { week: 1, cfg: CFG });
  assert.equal(r.autoSubs.length, 0);
  // goalkeeper missing -> not replaced
  r = C.scoreTeam(L, absentAllWeek(L, 'Zaid Shamim'), team(), { week: 1, cfg: CFG });
  assert.equal(r.autoSubs.length, 0);
  // sub who didn't play himself can't come on
  const s = absentAllWeek(L, 'Abdullah Patel');
  for (const k of Object.keys(s)) s[k].absent.push('Muhammad Rawat');
  assert.equal(C.scoreTeam(L, s, team(), { week: 1, cfg: CFG }).autoSubs.length, 0);
});

test('chips: Triple Captain triples, Bench Boost counts the sub', () => {
  const L = league();
  const n = C.scoreTeam(L, {}, team(), { week: 1, cfg: CFG });
  const tc = C.scoreTeam(L, {}, team({ chip: 'tc' }), { week: 1, cfg: CFG });
  const hy = (r) => r.players.find((p) => p.name === 'Hamza Yousofzai');
  assert.equal(hy(tc).multiplier, 3);
  assert.equal(tc.total - n.total, hy(n).pts);
  const bb = C.scoreTeam(L, {}, team({ chip: 'bb' }), { week: 1, cfg: CFG });
  const rawat = n.players.find((p) => p.name === 'Muhammad Rawat').pts;
  assert.ok(rawat > 0);
  assert.equal(bb.total - n.total, rawat);
  assert.equal(n.benchPoints, rawat);
  assert.equal(bb.benchPoints, 0);
});

test('a goalkeeper switching teams for a match scores for the side he kept goal for', () => {
  // m1 MUF 0-3 SAB. Hamza Lakota (NAS keeper) guests in goal for MUF in m1; NAS don't play m1.
  const L = league({ 1: [0, 3], 2: [0, 0] });
  const m1 = L.matchesOfWeek(1)[0];
  const sheets = { [m1.key]: { key: m1.key, guests: { 'Hamza Lakota': MUF }, gk: { [MUF]: 'Hamza Lakota' } } };
  const w = pts(L, sheets)['Hamza Lakota'];
  assert.equal(w.played, 4); // his 3 NAS matches + the guest match
  const g = w.matches.find((m) => m.key === m1.key);
  assert.equal(g.team, MUF); assert.equal(g.role, 'GK'); assert.equal(g.conceded, 3);
  assert.equal(g.pts, 2 - 1); // played, -1 for 2 conceded, no clean sheet
  // MUF's own listed keeper did not keep goal in m1, so he scores from the outfield (DEF) table there
  const saf = pts(L, sheets)['Safwan Abdul M'].matches.find((m) => m.key === m1.key);
  assert.equal(saf.role, 'DEF');
  // and an outfielder named in goal scores as a GK for that match
  const s2 = { [m1.key]: { key: m1.key, gk: { [SAB]: 'Bilal Anees' }, saves: { 'Bilal Anees': 7 } } };
  const b = pts(L, s2)['Bilal Anees'].matches.find((m) => m.key === m1.key);
  assert.equal(b.role, 'GK'); assert.equal(b.pts, 2 + 4 + 2); // played, clean sheet, 7 saves -> 2
});

test('transfer hits: 1 free a week, roll over to max 3, -4 for each extra', () => {
  const L = league({}, [], [1, 2, 3, 4]);
  const t1 = team();
  const swap = (e, out, inn) => ({ ...e, squad: e.squad.map((n) => (n === out ? inn : n)) });
  const t2 = swap(swap(t1, 'Muhammad Rawat', 'Umar Patel'), 'Bilal Anees', 'Jameel Bholat'); // 2 transfers, 1 free
  t2.sub = 'Umar Patel';
  const st = C.replay(L, CFG, { entries: { 1: t1, 2: t2 }, gws: [1, 2, 3, 4, 5] });
  assert.equal(st[1].hits, 0); assert.equal(st[1].freeAvail, Infinity);
  assert.equal(st[2].freeAvail, 1); assert.equal(st[2].transfers, 2); assert.equal(st[2].hits, 4);
  assert.equal(st[3].freeAvail, 1); // used everything, +1
  assert.equal(st[4].freeAvail, 2); // rolled
  assert.equal(st[5].freeAvail, 3);
  const st2 = C.replay(L, CFG, { entries: { 1: t1 }, gws: [1, 2, 3, 4, 5, 6] });
  assert.equal(st2[6].freeAvail, 3); // capped at 3
  // the hit comes off the week's score
  const r = C.scoreTeam(L, {}, t2, { week: 2, cfg: CFG, hits: st[2].hits });
  assert.equal(r.total, r.gross - 4);
});

test('Wildcard: no hits; Free Hit: no hits and the squad goes back next week', () => {
  const L = league({}, [], [1, 2]);
  const t1 = team();
  const many = { ...t1, squad: ['Hamza Lakota', 'Ilyas Seedat', 'Umar Patel', 'Jameel Bholat', 'Saifullah Salloo', 'Adam Sayani', 'Huzayfah Qureshi', 'Yusuf Kassam', 'Muhammad Rawat'], captain: 'Jameel Bholat', vice: 'Adam Sayani' };
  const wc = C.replay(L, CFG, { entries: { 1: t1, 2: { ...many, chip: 'wc' } }, gws: [1, 2, 3] });
  assert.equal(wc[2].hits, 0); assert.equal(wc[3].entry.squad.join(), many.squad.join());
  const fh = C.replay(L, CFG, { entries: { 1: t1, 2: { ...many, chip: 'fh' } }, gws: [1, 2, 3] });
  assert.equal(fh[2].hits, 0);
  assert.equal(fh[3].entry.squad.join(), t1.squad.join()); // reverted
  assert.equal(fh[3].transfers, 0);
});

test('chips: one of each per half season, wildcard/free hit not in your first week', () => {
  const cfg = { ...CFG, secondChipsFromGw: 6 };
  assert.equal(C.chipsAvailable(cfg, {}, 1, 1).wc, false);
  assert.equal(C.chipsAvailable(cfg, {}, 1, 1).tc, true);
  assert.equal(C.chipsAvailable(cfg, { tc: [2] }, 4, 1).tc, false);
  assert.equal(C.chipsAvailable(cfg, { tc: [2] }, 6, 1).tc, true);
});

test('money: selling price keeps half the rise (rounded down to £0.5m); budget changes keep old squads valid', () => {
  assert.equal(C.sellPrice(6.0, 7.0), 6.5);
  assert.equal(C.sellPrice(6.0, 6.5), 6.0);
  assert.equal(C.sellPrice(6.0, 5.5), 5.5);
  const L = league({}, [], [1]);
  const t1 = team(); // costs 5+8.5+8+6.5+6.5+6+9+10+4 = 63.5 > 55
  const st = C.replay(L, CFG, { entries: { 1: t1 }, gws: [1] });
  assert.equal(st[1].bank, -8.5);
  assert.ok(C.validate(L, CFG, t1, { bank: st[1].bank, spending: true }).includes('Over budget by £8.5m'));
  // budget raised from GW2 -> squad carried over, bank goes up, nothing invalid
  const st2 = C.replay(L, CFG, { entries: { 1: t1 }, gws: [1, 2], budgetHistory: [{ budget: 70, fromGw: 2 }] });
  assert.equal(st2[2].bank, 6.5);
  // price rise after week 1 applies from GW2
  const up = [{ gw: 1, changes: { 'Hamza Yousofzai': 10.5 } }];
  assert.equal(C.pricesAt(L, up, 1)['Hamza Yousofzai'], 10.0);
  assert.equal(C.pricesAt(L, up, 2)['Hamza Yousofzai'], 10.5);
});

test('squad validation messages', () => {
  const L = league();
  assert.deepEqual(C.validate(L, CFG, team()), []);
  const four = team({ squad: ['Zaid Shamim', 'Muhammad Furqan', 'Abdullah Patel', 'Shahid Omarmia', 'Adam Sayani', 'Jameel Bholat', 'Ismail Daudi', 'Hamza Yousofzai', 'Muhammad Rawat'], captain: 'Hamza Yousofzai', vice: 'Shahid Omarmia' });
  assert.ok(C.validate(L, CFG, four).includes('Max 3 from Al-Fāʾizūn'));
  assert.ok(C.validate(L, CFG, team({ sub: 'Zaid Shamim' })).includes('The substitute must be an outfield player'));
  assert.ok(C.validate(L, CFG, team({ squad: [...team().squad.slice(0, 8), 'Ziyaad'], sub: 'Ziyaad' })).includes('Ziyaad isn’t in a team yet'.replace('’', "'")));
});

test('form-based price update: rise, fall, capped at ±£1.0m from the start', () => {
  const goals = [1, 2, 3, 4].map(() => ({ match: 2, team: FAI, scorer: 'Hamza Yousofzai', own_goal: false }));
  const L = league({ 2: [0, 4] }, goals);
  const prop = C.proposePrices(L, {}, CFG, 1, {});
  const hy = prop.find((p) => p.name === 'Hamza Yousofzai');
  assert.equal(hy.to, 10.5); // 3 x played (6) + 4 goals (16) = 22 >= 20
  const blank = prop.find((p) => p.name === 'Haizam Jiffry'); // FWD, no goals: appearance points only
  assert.equal(blank.to, 9.0);
  const capped = C.proposePrices(L, {}, CFG, 1, { 'Haizam Jiffry': 8.5 });
  assert.equal(capped.find((p) => p.name === 'Haizam Jiffry'), undefined); // already -1.0
});

test('Team of the Week is a legal 8', () => {
  const L = league({ 2: [2, 0] }, [{ match: 2, team: NAS, scorer: 'Asjad Patel' }, { match: 2, team: NAS, scorer: 'Hanzala Salloo' }]);
  const t = C.teamOfTheWeek(L, CFG, pts(L));
  assert.equal(t.players.length, 8);
  assert.ok(CFG.formations.includes(t.formation));
  const byT = {}; t.players.forEach((n) => { byT[L.players[n].team] = (byT[L.players[n].team] || 0) + 1; });
  assert.ok(Math.max(...Object.values(byT)) <= 3);
  assert.ok(t.players.includes('Hanzala Salloo'));
});

test('mini-league table: totals, gameweek points and movement', () => {
  const ms = [{ uid: 'a', teamName: 'A' }, { uid: 'b', teamName: 'B' }];
  const rows = C.leagueTable(ms, { a: { 1: 50, 2: 10 }, b: { 1: 40, 2: 30 } }, [1, 2]);
  assert.equal(rows[0].uid, 'b'); assert.equal(rows[0].total, 70); assert.equal(rows[0].move, 1); assert.equal(rows[1].move, -1);
  assert.equal(rows[0].gw, 30);
});

test('deadline is 1 hour before the first kickoff', () => {
  const d = C.deadlineFromFixture({ date: '2026-11-14', rounds: [{ kickoff: '14:30' }, { kickoff: '14:00' }] }, 1);
  assert.equal(new Date(d).getHours(), 13);
  assert.equal(C.deadlineFromFixture({ date: null, rounds: [] }, 1), null);
});
