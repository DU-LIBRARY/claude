# Al-Ikmāl Narrator Index

An offline web app for the narrators of *Mishkāt al-Maṣābīḥ*, from al-Khaṭīb al-Tabrīzī's
*al-Ikmāl fī Asmāʾ al-Rijāl*: all 1,035 numbered biographies in Arabic with full English translations.

## Two ways to use it offline

| | What it is | How to use it |
|---|---|---|
| **Installable app** | `app/`: a Progressive Web App. Every file is cached on the first visit. | Host the folder over https (GitHub Pages, below). Open it once, then **Install** (Chrome, Edge, Android) or **Share → Add to Home Screen** (iPhone, iPad). It then opens full-screen with no connection. |
| **Single file** | `dist/al-ikmal-offline.html` (about 2 MB). Fonts, data and scripts are all inside. | Copy it to a phone or laptop and open it in any browser. No server or internet needed. |

## Features

- Search in Arabic with or without vowel marks, in English transliteration (`Abu Hurayra`, `ʿIkrima`), or by entry number (Arabic or Latin digits).
- Optional full-text search inside the biographies.
- Filter by section (Companions, Successors, Women Companions, Women Successors, Imams of the Uṣūl) and by letter.
- Read in English, Arabic, or both.
- **My notes** under every narrator. Notes autosave as you type into IndexedDB, with a second copy in localStorage, so they survive closing the app, going offline and restarting the device. The **My notes** filter lists annotated narrators, search also matches your notes, and Settings has **Export backup** and **Import backup** (a JSON file) for moving notes to a new phone or keeping a safe copy.
- Save narrators with the star. The **Saved** filter keeps them together on this device.
- Reading settings: light, dark or system theme, and four text sizes.
- Deep links: `…/#n433` opens entry 433. Copy, share, or copy a link to any entry.
- A random-narrator button, `/` to jump to search, and `Esc` to clear it.
- Motion with the [Motion](https://motion.dev) library: entries open with a measured height animation, lists stagger in, segmented controls slide, and the title plate draws an eight-pointed-star field. Everything respects *Reduce motion*.
- The search bar stays at the top. The filters scroll away with the page, and the filter button opens them as a dropdown. A dot on the button shows a filter is on.

## Publish with GitHub Pages

1. Merge this branch into `main`.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` deploys `app/` on every push to `main`. The site URL appears in the workflow run.

## Updating

- The data lives in `app/data/ikmal.json`, one object per biography: `n` (number), `nl` (label when unusual), `p` (printed page), `l` (letter heading), `c` (section), `ar` (heading), `full` (full name line), `art` (Arabic biography), `en` (English translation).
- After changing any file in `app/`, bump `VERSION` in `app/sw.js`. Installed copies show a **Reload** prompt for the new version.
- Rebuild the single file with `python3 tools/build_single.py`.

## Credits

The text, translation and original index design come from the shared *Al-Ikmāl Narrator Index* artifact. Source: the scanned edition of al-Ikmāl (based on the Pakistani printing of 1350 AH / 1931, collated with the al-Maktab al-Islāmī edition), pp. 5–132.

Fonts: Amiri, Source Serif 4 and IBM Plex Sans (SIL Open Font License), bundled locally. Motion 11.11.17 (MIT), bundled in `app/vendor/`.

## Syncing with the shared artifact

When the original artifact is updated, save its page HTML and run:

```
python3 tools/sync_from_artifact.py path/to/artifact.html
```

It replaces `app/data/ikmal.json`, lists which entries were added, removed or changed, bumps the
service-worker version and rebuilds the single file. Commit and push to `main`, and Pages redeploys.

## Syncing notes between devices (Google sign-in)

Notes always save on the device first. With sync on, they are also copied to your own Firebase
project and appear on every device signed in to the same Google account. For each note the newest
edit wins, deletions sync too, and edits made offline upload when the device reconnects.

One-time setup:

1. Go to https://console.firebase.google.com, choose **Create a project** (any name, Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, pick your email, **Save**.
3. **Authentication → Settings → Authorized domains → Add domain**: `du-library.github.io`.
4. **Build → Firestore Database → Create database**, pick a location near you, start in **production mode**.
5. In Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules`, **Publish**.
6. **Project settings (gear) → Your apps → Web (`</>`)**, register an app (no Hosting), and copy the `firebaseConfig` values into `app/firebase-config.js`.

The config values are not secret; the rules make sure each person can only read and write their own notes.
Sync runs on the website app only. Google sign-in can't run from the single offline file or the claude.ai page.

## Siyar Aʿlām al-Nubalāʾ (`siyar/`)

A second offline app at `…/siyar/`, in the same format as the Ikmāl index. It holds all 5,948 Siyar fact files
(`siyar/data/siyar.json`, unchanged) and, for each one, al-Dhahabī's full entry in Arabic.

- Full text: OpenITI `0748Dhahabi.SiyarAclamNubala.Shamela0010906-ara1` (Muʾassasat al-Risālah edition, ed.
  al-Arnaʾūṭ et al.), split by al-Dhahabī's entry numbers into `siyar/data/full/vol00.json` … `vol23.json`
  (vol00 = the Sīrah and the Khulafāʾ). Only OpenITI markup is removed; `⟦vol:page⟧` page markers are kept.
- Rebuild: `python3 tools/build_siyar_full.py SOURCE.mARkdown siyar/data/siyar.json siyar/data/full REPORT_DIR`,
  then `python3 tools/verify_siyar_text.py SOURCE.mARkdown siyar/data/full` (checks every entry is verbatim).
- `siyar/REVIEW.md` lists flagged matches and places where a fact file and the text may disagree. Nothing was changed.
- Sentences the source splits at printed page breaks are re-joined into one paragraph (the page tag stays inline);
  the build does this, and `python3 tools/reflow_siyar_text.py siyar/data/full` applies it to existing files.
  Only line breaks change, so the verbatim check still holds.
- After changing any file in `siyar/`, bump `VERSION` in `siyar/sw.js`; after changing the volume files, bump `TEXT_REV` too.

## Mishkāt Commentary Reader (`mishkat/`)

A third offline app at `…/mishkat/`, in the same format as the Ikmāl index. It holds the hadeeth of
*Mishkāt al-Maṣābīḥ* with three commentaries side by side: *Mirqāt al-Mafātīḥ* (al-Qārī), *Sharḥ al-Ṭībī*
and *Lamaʿāt al-Tanqīḥ* (ʿAbd al-Ḥaqq al-Dihlawī). It starts with Kitāb al-Nikāḥ: the opening of the book
and hadeeth 3080–3092. The text comes from the shared claude.ai artifact
[Mishkāt Kitāb al-Nikāḥ](https://claude.ai/artifact/QxF39U6v4PWEtE3JRJ8PvR) and is updated only when you ask for it.

| | What it is | How to use it |
|---|---|---|
| **Installable app** | `mishkat/`: a Progressive Web App. Every file is cached on the first visit. | Open `https://du-library.github.io/claude/mishkat/` once, wait for **Ready offline ✓**, then **Install** (Chrome, Edge, Android) or **Share → Add to Home Screen** (iPhone, iPad). |
| **Single file** | `dist/mishkat-offline.html` (about 0.8 MB). Fonts, data and scripts are all inside. | Copy it anywhere (USB stick, a phone's Files app) and open it. No server, no internet. Google note sync is the only thing missing. |

Features:

- Search in Arabic with or without tashkeel, or by hadeeth number (Latin or Arabic-Indic digits). Optional search inside the commentaries.
- A jump-to menu and deep links: `…/mishkat/#h3081`, `#intro`, `#h3081-tibi` (one commentary).
- Compare: one commentary at a time, all three stacked (each one folds), or side by side on wide screens (two or three columns).
- Footnotes on or off. Footnote marks and notes jump to each other. Gradings, takhrīj lines, PDF page refs and editorial notes are kept as printed.
- Arabic text size, light, dark or system theme, and a reading-progress bar.
- My notes and stars per hadeeth, saved on the device first (IndexedDB plus a localStorage copy). Export and import a JSON backup.
- Copy or share a hadeeth with its citation, e.g. `Mirqāt 6/237–238 · PDF p. 238–239`.
- A **Synced from artifact · rev · version · date** line, and **What's new** showing what the last sync added or changed.
- Notes sync with Google sign-in, like the Ikmāl app. They use the same Firebase project and the same `users/{uid}/notes`
  collection, under ids that start with `mishkat-`, so each app ignores the other's notes. `firestore.rules` is unchanged.
  Stars and settings stay on the device and in the backup.

Fonts: Amiri, Noto Naskh Arabic and IBM Plex Sans (SIL Open Font License), bundled in `mishkat/fonts/`.
The app makes no request to any other site except Google sign-in, and only when you turn sync on.

### Updating from the artifact ("sync mishkat")

Nothing updates on its own. To pull the latest version of the artifact, say **"sync mishkat"** to Claude Code
in this repository. Claude then:

1. reads the artifact with its Artifact tool (never by scraping the page) and saves the HTML to its scratchpad,
2. runs `python3 tools/sync_mishkat_from_artifact.py <saved.html> --version <artifact version id>`,
3. shows you the summary (sections added, removed and changed, and what changed in each),
4. commits and pushes to the branch.

If Claude can't read the artifact (for example, it was shared from another organization and the Artifact
tool is off), save it yourself and attach the file. On an iPhone or iPad, open the artifact link in Safari,
then **Share → Options → Web Archive → Save to Files**; on a Mac, **File → Save As → Web Archive**. The script
reads the `.webarchive` directly, takes the artifact's own frame and its version id from it, and undoes
Safari's phone-number links (page ranges like "2256–2257" turned into `tel:` links).

The script treats the page as data and never runs its scripts. It checks the shape (each hadeeth has its matn
and all three commentaries, every footnote mark has its note, the numbers have no gaps) and stops without
writing anything if the page is malformed. When content changed it writes `mishkat/data/`, bumps `VERSION`
in `mishkat/sw.js` and rebuilds `dist/mishkat-offline.html`. When nothing changed it prints
**Nothing to update.** and touches nothing. `--check` shows the diff without writing.

After a sync is pushed and Pages redeploys, an installed app sees the new version the next time it opens
online, shows **New version available · Reload**, and then works offline again with the new text.

The data format is described in `mishkat/DATA.md`. It is organised by book, so another kitāb from a new
artifact is added next to Kitāb al-Nikāḥ (add its Arabic name to the `KITAB` table in the sync script if it
is not there yet).

Tests: `python3 -m unittest discover -s tests/mishkat -p 'test_*.py'` (parser round trip, idempotency,
malformed input) and the Playwright scripts in `tests/mishkat/` (offline, single file, update, Lighthouse).
