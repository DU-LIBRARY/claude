# Darul Uloom Fantasy League

A private fantasy football game for the class, played alongside the Darul Uloom Winter League.
Address once `main` is published: **https://du-library.github.io/claude/fantasy/**.
To try it without signing in, add `?demo` to the address. Demo mode uses made-up results and saves nothing.

Points are always worked out from the league data in `du-library/skills` → `league/`. When you add a
week's results with the league skill and push them to `main`, fantasy points update automatically.

## One-time setup (5 minutes)

The app uses the same Firebase project as the Al-Ikmāl app (`on-device-syncing`), so Google sign-in
and `du-library.github.io` are already set up. Two steps are left:

1. **Publish the rules.** Firebase console → **Firestore Database → Rules**. Replace everything with
   the contents of [`/firestore.rules`](../firestore.rules), then **Publish**. The notes rules for the
   Al-Ikmāl app are included unchanged.
2. **Sign in once as an admin.** Open the app and sign in with `zsteal94@gmail.com` or `zabowath37@gmail.com`
   (both are admins; `zabowath37@gmail.com` is also the Firebase console account, so publish the rules from it). The first time,
   the app saves the starting list of players' emails (from `config.js`). Then open
   **Admin → Gameweeks & deadlines** and open Week 1 with its deadline.

The admin emails are written in two places: `adminEmails` in `config.js`, and `fflAdmin()` in
`firestore.rules`. If you ever change them, change both and publish the rules again.

## Adding a manager's email

**Admin → Who can play (allowlist) → Show the list**. Type their Google email and tap **Add**.
They can sign in straight away. Anyone not on the list sees "This league is private." Remove someone
the same way. Their past teams stay, but they can't sign in any more.

The first time a manager signs in, they choose a team name. They can also say which league player they
are, which puts a "That's you!" tag on that player's card.

## Filling in the weekly match sheet

Do this after the week's results are in the league data (the league skill's `add-week` step, pushed to `main`).

1. **Admin → Match sheets** and pick the week. Each match opens with both squads.
2. **Everyone is ticked as "played" by default.** Untick only the players who were absent.
3. **In goal:** pick who kept goal for each team. It defaults to the team's listed keeper. Anyone
   picked here scores as a goalkeeper for that match. A listed keeper who played outfield scores as a defender.
4. **Extras** (optional): saves, penalties saved or missed, yellow and red cards.
5. **Guest:** if a player turned out for another team (for example a keeper lent to the other side),
   add him as a guest for that team. He then scores for that team's result in that match.
6. Tap **Save sheet**. Points update for everyone immediately.

Until a sheet is saved, everyone in the squad counts as having played, and the Points screen marks the
week as *provisional*. Goals and assists always come from `goals.json`, never from the sheet.

To keep a copy alongside the results, use **Admin → Managers & data fixes → Download appearances.json**
and commit it to `league/data/appearances.json` in the skills repo. The app reads that file too.
Sheets saved in the app take priority.

## Running the price update

After each week's sheets are in: **Admin → Price update → After Week N**. The app suggests:

- **+£0.5m** for players with 20+ points over the last 2 weeks;
- **−£0.5m** for players who blanked (appearance points only, or didn't play);
- never more than ±£1.0m away from the starting price.

Untick any change you don't want, then tap **Apply**. New prices apply from the next gameweek. They
show with ↑/↓ in the player list and under **Stats → Price changes**. Running it again for the same week
replaces the earlier run. A manager selling a player gets back the purchase price plus half of any rise,
rounded down to £0.5m.

## Other admin jobs

- **Deadlines:** the suggested time is 1 hour before the first kickoff in `fixtures/week-NN.json`.
  You can change it. **Lock now** freezes teams and reveals everyone's squads immediately. **Unlock**
  reopens a week, but you also need to move the deadline later.
- **Budget:** starts at £55.0m. A change applies from the week you choose. Existing squads stay valid,
  and only transfers made after the change must fit the new limit.
- **Second set of chips:** set the week the second half of the season starts.
- **Fix data:** rename teams, or load, edit and save any manager's team for any week.

## Rules in one place

Everything numeric is in [`config.js`](config.js): the scoring table, formations, squad limits,
transfers, chips, price-update thresholds and the default budget. Starting prices and positions are in
[`players.json`](players.json), keyed by the exact names in `squads.json`. Ziyaad and Muhammad Suriya
have `team: null`, so they can't be picked yet. When they join a team, add them to `squads.json` with
the league skill, and they become available with the prices already set.

After changing any file here, bump `VERSION` in `sw.js` so installed copies update.

## Files

| File | What it does |
|---|---|
| `core.js` | The rules engine, pure functions only. `scoreTeam(league, sheets, team, opts)` gives a team's points. Also handles auto-subs, captaincy, chips, the transfer/money replay, price updates and Team of the Week. |
| `config.js` | All rules and scoring values. |
| `players.json` | Positions and starting prices. |
| `store.js` | League data (live from GitHub, with an offline fallback) and Firebase. |
| `app.js`, `index.html`, `styles.css` | The screens. |
| `demo.js` | Sample data for `?demo`. |
| `data/league/` | Bundled copy of the league data, used only offline on a first visit. Refresh it with `tools/sync-league.sh ../skills/league`. |

## Tests

```
node --test fantasy/tests/core.test.mjs
```
These cover scoring, captain fallback, auto-subs, chips, transfer hits, clean sheets across 3 matches, a
keeper switching teams, prices and validation.

The Firestore rules test (`tests/rules.test.mjs`) runs against the emulator. It needs Java and
`npm i firebase-tools @firebase/rules-unit-testing firebase`, then:
```
npx firebase emulators:exec --only firestore --project demo-duf "node fantasy/tests/rules.test.mjs firestore.rules"
```

## Notifications

When the deadline is less than 6 hours away and your team for that week isn't saved, a banner shows at
the top. Tap **Remind me** to also get a phone or browser notification when you open the app in that
window. The app has no server, so it can't send a push notification while it's closed.
