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
