# Siyar Aʿlām al-Nubalāʾ: English translation brief

You are translating al-Dhahabī's *Siyar Aʿlām al-Nubalāʾ* (biographies) into English. Input: a packet JSON file (a list of entries `{key, vol, h, t}`). Output: a JSON file `{"<key>": {"h": "...", "t": "..."}}` for every entry. Quality bar: publishable; the output will NOT be proofread by anyone afterwards, so be exact and consistent.

## Hard structure rules (the validator enforces these)
1. `t` has exactly the same number of lines (`\n`-separated) as the source `t`. Line N of the English translates line N of the Arabic. Empty lines stay empty. Never merge, split or reorder lines, even when a sentence continues across lines (a page marker may sit between the halves): translate each line so that it reads correctly in sequence.
2. Keep every page marker `⟦12:620⟧` exactly where it stands (same line, same position relative to the surrounding words). Keep footnote markers `(1)`, `(2)`… exactly. Keep editorial brackets `[ ]` (translate their content).
3. `h` is the heading. Keep the number, the ` - ` separator, the `*` and the grading letters in parentheses unchanged (e.g. `(ع)`, `(خ، م)`), and transliterate the name.
4. Output valid JSON. Write with a script (Python `json.dump(..., ensure_ascii=False)`), never hand-escape.

## Terminology (most important)
- `GLOSSARY.tsv` lists every technical term. At EVERY occurrence, write the glossary English followed by the canonical Arabic in brackets: `reliable (ثقة)`, `the Imam (الإمام)`, `hadith scholar (المحدث)`. The bracket always contains the canonical Arabic exactly as in column 1, never the inflected form from the source. Match inflected/plural/prefixed forms (listed variants and any other morphology) to the same rendering, singular or plural as the sentence needs (`hadith scholars (المحدث)`).
- Use the glossary term only when the word is used as a technical term. Do not bracket the same word inside a personal name (al-Ḥasan, Ṣāliḥ, ʿAlī, Thiqah…), or in its ordinary sense.
- Bracket technical terms only. Never bracket names, places, ordinary words, or anything not in the glossary, unless you hit a genuinely technical term that is missing from the glossary. In that case use a consistent plain English rendering with the Arabic in brackets, and record it in `new_terms` (see below). Do this sparingly.
- Do not add explanatory glosses, footnotes or your own commentary. Translate; do not interpret.
- `NAMES.tsv` fixes the English form of frequently cited figures; use exactly those forms. 
- A verdict such as «ثقة» must be rendered with the same English word every time in any context (e.g. `Ibn Maʿīn said: reliable (ثقة)`). Never vary wording for style: consistency beats elegance. Register: plain, accurate, modern scholarly English.

## Names, places, dates
- Transliteration (ALA-LC style, no ʾ at the start of a word): ʿ for ع, ʾ for ء inside a word, ā ī ū, ḥ ṣ ḍ ṭ ẓ, dh th kh sh gh, ah for ة (Ḥamzah, Fāṭimah). Articles: `al-` always lower case, hyphenated, never assimilated (al-Shāfiʿī, al-Nasāʾī). `ibn` / `bint` lower case inside a name, `Ibn` at the start of a name. `Abū` is always written Abū (except inside `Ibn Abī …` / `bint Abī …`). Compounds: ʿAbd Allāh, ʿAbd al-Raḥmān, ʿUbayd Allāh. Capitalise the first letter of each name part except ibn/bint/al-.
- Names and nisbas are never translated or bracketed. The kunyah/lineage in the opening lines is transliterated too.
- Well-known places use their usual English forms: Mecca, Medina, Basra, Kufa, Baghdad, Damascus, Cairo, Egypt, Syria (for al-Shām), Iraq, Khurasan, Nishapur, Jerusalem, Wasit, Isfahan, Harran, Mosul, Aleppo, Yemen, the Hijaz, Andalusia. Others: transliterate.
- Dates: Hijri, in digits: `in 42 AH`, `in the year 130 AH`, `some years after 90 AH` for `نيف وتسعين`: translate the wording faithfully, digits for the number. Where only the tens/units are given without hundreds, keep as given (`in the year 42`). Months: Muḥarram, Ṣafar, Rabīʿ al-Awwal, Rabīʿ al-Ākhir, Jumādā al-Ūlā, Jumādā al-Ākhirah, Rajab, Shaʿbān, Ramaḍān, Shawwāl, Dhū al-Qaʿdah, Dhū al-Ḥijjah. Ages: `aged 70`.
- Praise formulas: `صلى الله عليه وسلم` → ﷺ ; `رضي الله عنه` → (may Allah be pleased with him) (her / them / both of them as needed); `رحمه الله` → (may Allah have mercy on him); `تعالى` after Allah → (Exalted is He) only if present in the source. Allah = Allah.
- `قلت:` is al-Dhahabī’s own voice: always `I say:`.
- `قال/وقال/روى X` → `X said` / `X narrated`; `سمعت` → `I heard`; `حدثنا/أخبرنا` inside prose → `X narrated to us` / `X informed us`.

## What stays in Arabic (do not translate)
- Lists of teachers and students and every transmission chain. Keep the Arabic verbatim, translating only the lead-in: 
  `حدث عن: ا، ب، ج.` → `He narrated from: ا، ب، ج.`
  `حدث عنه: ...` → `Narrating from him: ...`
  `روى عنه: ...` → `Narrating from him: ...`
  `وروى: فلان، عن فلان، عن فلان، قال:` (an isnād, ≥2 links) → keep the chain verbatim in Arabic, then the translated matn: `وروى: فلان، عن فلان، عن فلان، قال: ` + English of what follows. If the sentence begins `Narrated:` use `He narrated:`.
- A single `X said:` / `X narrated from Y` is NOT a chain; translate and transliterate it.
- Everything else (anecdotes, reports, verdicts, poetry, dates, narrative, al-Dhahabī’s comments) is translated in full. Do not abridge or omit anything.
- Qurʾān quotation: give the meaning in English in quotation marks followed by the reference, e.g. “…” (Qurʾān 2:255). Hadith matn: translate faithfully. Poetry: translate faithfully into plain English on the same line(s).
- Quranic/hadith wording inside quotation marks keeps its quotation marks. Keep the source’s punctuation style roughly (dashes, colons).

## Workflow
1. Read `PROMPT.md`, `GLOSSARY.tsv`, `NAMES.tsv` (once).
2. Read your packet from `translate/work/in/<id>.json`. Translate entry by entry. Write the result with a Python script to `translate/work/out/<id>.json` (optionally add a top-level key `"__new_terms__": [["Arabic","English"], …]` for the sparing cases above).
3. Run `python3 translate/tools/validate.py <id>`; fix every ERROR and read every WARN and decide (a WARN is usually a glossary term in the source that you did not bracket, or a bracket that is not in the glossary). Re-run until there are no ERRORs and every WARN is justified. 
4. Final reply: one line stating the packet id, entry count, and the validator’s last status. Nothing else.
