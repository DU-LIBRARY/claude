# Mishkāt commentary data (schema 1)

The reader loads `data/meta.json` first, then one file per book listed in `meta.books`.
Everything here is written by `tools/sync_mishkat_from_artifact.py`; do not hand-edit.
All text is stored as **segments**, never as HTML, so nothing from the source page is
ever inserted with `innerHTML`.

## `data/meta.json`

```json
{
  "schema": 1,
  "rev": 1,                                  // +1 on every sync that changes content
  "syncedAt": "2026-11-04T10:30:00Z",        // time of the last content-changing sync
  "source": {
    "title": "Mishkāt Kitāb al-Nikāḥ",
    "url": "https://claude.ai/artifact/QxF39U6v4PWEtE3JRJ8PvR",
    "version": "1793730765-58e3",            // artifact version id when known, else sha256[:12] of the page
    "sha256": "…"                            // of the saved page
  },
  "books": [
    { "id": "nikah", "file": "nikah.json", "ar": "كتاب النكاح", "en": "Kitāb al-Nikāḥ",
      "first": 3080, "last": 3092, "count": 14,          // count includes the intro section
      "source": { /* same shape as meta.source: the artifact this book was last synced from */ },
      "footer": [ /* segments: that artifact's closing note */ ] }
  ],                                         // sorted by first hadeeth number
  "footer": [ /* segments: the closing editorial note of the most recently synced artifact */ ],
  "changelog": [                             // newest first, at most 30 entries
    { "rev": 1, "at": "…", "version": "…", "book": "nikah",   // "footer": true when only/also the footer changed
      "added": ["intro", "h3080", …], "removed": [], "changed": [ { "id": "h3081", "what": ["commentaries.mirqat.paras"] } ] }
  ]
}
```

## `data/<book>.json`: an array, one object per section, in page order

```json
{
  "id": "h3080",                 // the artifact's section id ("intro" for the opening)
  "kind": "hadeeth",             // "hadeeth" | "intro"
  "book": "nikah",
  "bab": null,                   // { "ar": "…", "en": null } once the page carries bāb headings (en null until known)
  "fasl": { "n": 1, "ar": "الفصل الأول", "en": "al-Faṣl al-Awwal" },  // null for intro
  "n": 3080,                     // null for intro
  "label": "Hadeeth 3080 · al-Faṣl al-Awwal",   // the .num line as printed
  "matn": [ /* segments */ ],    // includes { "t": "[خ: ٥٠٦٦، م: ١٤٠٠]", "ref": true } runs
  "grading": [ "[٣٠٩٢] ضعيف لإرساله." ],      // every grading line found under any commentary (may be empty)
  "commentaries": [              // always exactly 3, in this order
    {
      "key": "mirqat",           // "mirqat" | "tibi" | "lamaat"
      "src": "مرقاة المفاتيح",   // the article heading
      "cite": "Mirqāt 6/237–238 · PDF p. 238–239",
      "work": "Mirqāt", "vol": 6, "pages": "237–238", "pdf": "238–239",
      "paras": [ [ /* segments */ ], … ],
      "centered": [ 2 ],                        // indices into paras printed centred (verse lines); usually []
      "editorial": [ [ /* segments */ ] ],      // extra .src lines, e.g. "Apparent misprints kept as printed: …"
      "footnotes": [ { "id": "n-h3080-M-1", "mark": "١", "body": [ /* segments */ ] } ],
      "refs": [ [ /* segments */ ] ],           // p.ref lines (takhrīj and gradings), in order
      "grading": "[٣٠٩٢] ضعيف لإرساله."        // the p.ref line that grades the hadeeth, or null
    }
  ]
}
```

## Segments

A paragraph is an array of runs. Exactly one of `t` or `fn` is set.

| Run | Meaning |
|---|---|
| `{ "t": "…" }` | plain text |
| `{ "t": "…", "b": true }` | bold: hadeeth wording quoted by the commentator |
| `{ "t": "…", "ref": true }` | a source reference such as the matn's `[خ: ٥٠٦٦]` |
| `{ "t": "…", "rtl": true }` | an Arabic run inside an English line (editorial notes) |
| `{ "fn": "n-h3080-M-1", "mark": "١" }` | a footnote reference; `fn` equals a `footnotes[].id` in the same commentary |

Flags can combine (`b` and `rtl`). Joining every run's `t` (and `mark` for `fn`) gives the text
exactly as the artifact shows it, after whitespace runs collapse to one space.

## Additions made by the parser agent (all additive; nothing above was renamed or removed)

- `commentaries[].centered`: indices of paragraphs the artifact centres (the intro's Lamaʿāt verse
  "أيها المُنكحُ الثُّريّا سُهيلاً ..."). Always present, usually `[]`. Render those paragraphs centred.
- `books[].source` and `books[].footer`: per-book provenance, so syncing a second book's artifact
  does not lose the first book's. `meta.source` / `meta.footer` keep their meaning (latest sync).
- `changelog[].book` (the book that sync touched) and optional `changelog[].footer: true`.
- `bab.en` may be `null`. Note the artifact's `<h2 class="bab">` currently carries faṣl headings
  (الفصل الثاني), which set `fasl`, not `bab`.
- A footnote can only be referenced from `paras` (never from matn, editorial, refs or other footnotes).
