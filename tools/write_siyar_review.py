#!/usr/bin/env python3
"""Write siyar/REVIEW.md from the match report and the death-year check (lists only; nothing is changed)."""
import json, re, sys, os
REP, YEARS, SI, FULL, OUT = sys.argv[1:6]
r = json.load(open(REP, encoding='utf8')); ys = json.load(open(YEARS, encoding='utf8'))
D = json.load(open(SI, encoding='utf8')); S = D['S']
idx = json.load(open(os.path.join(FULL, 'index.json'), encoding='utf8'))['i']
cache = {}
def text(i):
    v = idx[str(i)][0]
    if v not in cache: cache[v] = json.load(open(os.path.join(FULL, 'vol%02d.json' % v), encoding='utf8'))['e']
    return cache[v][str(i)]
KW = re.compile(r'(مات|توفي|توفى|وفاته|قتل|استشهد|استشهاد|هلك|المتوفى|عاش|ولد)')
def excerpts(t, n=4):
    out = []
    for para in t.split('\n'):
        for s in re.split(r'(?<=[.؟!])\s+', para):
            if KW.search(s): out.append(s.strip()[:260])
    return out[:n]
L = []
L.append('# Siyar: matching and review lists\n')
L.append('Source: OpenITI `0748Dhahabi.SiyarAclamNubala.Shamela0010906-ara1` (Muʾassasat al-Risālah edition, ed. al-Arnaʾūṭ et al.), the primary tagged version, whose page numbers (`vol:page`, three-digit) match those in `siyar.json`.\n')
L.append('## 1. Matching\n')
L.append(f"- Fact files: **{r['records']}**. Matched to a text block: **{r['matched']}**. Unmatched: **{len(r['unmatched'])}**. Text entries left over: **{len(r['text_entries_without_record'])}**.")
L.append(f"- The 5,943 numbered biographies were matched on volume and al-Dhahabī's entry number, then checked on the starting page. Every one starts on the page given in its fact file.")
L.append("- The Prophet ﷺ is matched to the Sīrah section, and the four Khulafāʾ to the four sections of *Siyar al-Khulafāʾ al-Rāshidīn*. Note from the edition's own description: the Sīrah was added by the editors from al-Dhahabī's *Tārīkh al-Islām*, following his instruction, and the Khulafāʾ volume was compiled by the editors on his method (Bashshār ʿAwwād's introduction, p. 7). Neither section has printed page numbers in the OpenITI text (`PageV00P000`), so these five full entries have no page tags.")
L.append("- Known gap in the digital text (from its OpenITI record): part of pages 1:376 and 1:385 is missing.\n")
L.append('### Matches flagged for a check (%d)\n' % len(r['doubtful']))
L.append('Volume, entry number and page all agree. They are flagged only because the heading names the person indirectly, so the name check could not confirm the match.\n')
L.append('| # | Fact file | ref · no. | Heading in the text | Why |\n|---|---|---|---|---|')
for d in r['doubtful']:
    L.append(f"| {d['idx']} | {d['name']} | {d['ref']} · {d['no']} | {d['text_heading'].replace('|','/')} | {'; '.join(d['why'])} |")
L.append('\n### Repeated entry numbers in the edition\n')
L.append('The edition numbers some biographies twice. The second one is marked with an asterisk and is often a short notice marked (تقدم) or (مكرر). Each fact file was matched to the copy on its own page.\n')
L.append('## 2. Fact file vs. text: things to check (nothing was changed)\n')
L.append('### Classification\n')
L.append('- **al-Najāshī** (record 89, 1:428 · no. 85): the fact file has the Ṣaḥābah field and «raḍiyallāhu ʿanhu». al-Dhahabī\'s verdict in the entry: «وكان ممن حسن إسلامه، ولم يهاجر، ولا له رؤية، فهو تابعي من وجه، صاحب من وجه».\n')
L.append('### Death year not found in the entry (%d)\n' % len(ys))
L.append('A script read every number written out after سنة / عام / في in each full entry, including years where al-Dhahabī leaves out the hundreds. These are the records whose fact-file death year (single year, or the second year of a range) was not among them. Many are cases where al-Dhahabī gives an event (Uḥud, Yamāmah) or a "some years after" (نيف) rather than a year. Some may be real disagreements. The sentences shown are al-Dhahabī\'s own, quoted from the entry so you can judge.\n')
for x in ys:
    i = x['idx']; e = text(i)
    L.append(f"**{i}. {x['name']}** — {x['ref']} · no. {x['no']} — fact file: `{x['fact_file_death']}`  ")
    ex = excerpts(e['t'])
    for s in ex: L.append(f"  - <span dir=\"rtl\">{s}</span>")
    if not ex: L.append('  - (no sentence about death or birth found in the entry)')
    L.append('')
open(OUT, 'w', encoding='utf8').write('\n'.join(L))
print('wrote', OUT)
