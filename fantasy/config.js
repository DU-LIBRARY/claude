/* Darul Uloom Fantasy League: every rule and scoring value lives here.
   Change a number, bump VERSION in sw.js, push, and the app picks it up.
   The budget can also be changed from the Admin screen (that value wins over `budget` below). */
(function (root) {
  const CONFIG = {
    // Who runs the league. Must match the emails in fflAdmin() in firestore.rules.
    adminEmails: ['zsteal94@gmail.com', 'zabowath37@gmail.com'],
    // Starting allowlist. Saved to the database the first time the admin signs in;
    // after that, add and remove people on the Admin screen (this list is then ignored).
    initialAllowlist: [
      'ai8power12345@gmail.com',   // Abdullah Patel
      'huzayfahqureshi@gmail.com',
      'zabowath37@gmail.com',      // Ziyaad (also the Firebase console account)
      'jamz7bholat@gmail.com',
      'adamsayani123@gmail.com',
      'bilalanees54@gmail.com',
    ],

    // Where the league data is read from (the public du-library/skills repo).
    // Falls back to the copy bundled in data/league/ when offline on a first visit.
    leagueBase: 'https://raw.githubusercontent.com/du-library/skills/main/league/',
    localLeagueBase: 'data/league/',

    // ---- squad ----
    budget: 55.0,            // £m. Default only: the Admin screen value is used once set.
    squadSize: 9,            // 8 starters + 1 substitute
    starters: 8,
    maxPerTeam: 3,
    priceStep: 0.5,
    // DEF-MID-FWD, with exactly 1 GK on top
    formations: ['2-3-2', '3-2-2', '2-4-1', '3-3-1', '4-2-1', '2-2-3'],
    minByPos: { GK: 1, DEF: 2, MID: 2, FWD: 1 },

    // ---- deadline ----
    deadlineHoursBeforeKickoff: 1,
    reminderHoursBeforeDeadline: 6,

    // ---- transfers ----
    freeTransfersPerWeek: 1,
    maxFreeTransfers: 3,
    transferHit: 4,          // points per extra transfer

    // ---- chips ----
    chips: {
      wc: { name: 'Wildcard', short: 'WC', blurb: 'Unlimited free transfers this week.' },
      tc: { name: 'Triple Captain', short: 'TC', blurb: 'Your captain’s points are tripled.' },
      bb: { name: 'Bench Boost', short: 'BB', blurb: 'Your substitute’s points count too.' },
      fh: { name: 'Free Hit', short: 'FH', blurb: 'Unlimited transfers for one week, then your squad goes back.' },
    },
    // A second set of chips from this gameweek on (set it from Admin; null = one set for the season).
    secondChipsFromGw: null,

    captainMultiplier: 2,
    tripleCaptainMultiplier: 3,

    // ---- points per match (added up over every match a player plays in the week) ----
    scoring: {
      played:          { GK: 2,  DEF: 2,  MID: 2,  FWD: 2 },
      goal:            { GK: 6,  DEF: 6,  MID: 5,  FWD: 4 },
      assist:          { GK: 3,  DEF: 3,  MID: 3,  FWD: 3 },
      cleanSheet:      { GK: 4,  DEF: 4,  MID: 1,  FWD: 0 },
      per2Conceded:    { GK: -1, DEF: -1, MID: 0,  FWD: 0 },
      per3Saves:       { GK: 1,  DEF: 0,  MID: 0,  FWD: 0 },
      penaltySaved:    { GK: 5,  DEF: 0,  MID: 0,  FWD: 0 },
      penaltyMissed:   { GK: -2, DEF: -2, MID: -2, FWD: -2 },
      yellowCard:      { GK: -1, DEF: -1, MID: -1, FWD: -1 },
      redCard:         { GK: -3, DEF: -3, MID: -3, FWD: -3 },
      ownGoal:         { GK: -2, DEF: -2, MID: -2, FWD: -2 },
    },
    // A listed goalkeeper who plays outfield in a match scores with this table for that match.
    outfieldTableForKeepers: 'DEF',

    // ---- form-based price updates (Admin runs them after each week) ----
    prices: {
      formWeeks: 2,              // look at the last 2 weeks
      riseIfFormAtLeast: 20,     // points over those weeks
      fallIfReturnsAtMost: 0,    // "blanked": no points beyond appearance points
      step: 0.5,
      maxMoveFromStart: 1.0,     // never more than ±£1.0m from the starting price
    },

    // Difficulty colours for the fixtures screen, by the opponent's league position (1st = hardest).
    difficulty: ['#9b1b30', '#d75b6e', '#b8b0a2', '#2f8f5b'],
  };
  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
  else root.FANTASY_CONFIG = CONFIG;
})(this);
