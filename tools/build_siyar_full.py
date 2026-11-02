#!/usr/bin/env python3
"""Build the Siyar full-text volumes from the OpenITI text and match them to siyar.json.

Source: OpenITI 0750AH, data/0748Dhahabi/0748Dhahabi.SiyarAclamNubala/
        0748Dhahabi.SiyarAclamNubala.Shamela0010906-ara1.mARkdown
        (the primary, tagged version of the Muʾassasat al-Risālah edition, ed. al-Arnaʾūṭ et al.)

usage: python3 tools/build_siyar_full.py SOURCE.mARkdown siyar/data/siyar.json siyar/data/full REPORT_DIR

Nothing in al-Dhahabi's wording is changed. Only OpenITI markup is removed:
  - '#', '###', '~~' line markup (lines are re-joined into paragraphs)
  - msNNNN milestones, stray <span> tags
  - PageVxxPyyy markers become inline page tags written as  ⟦v:p⟧  (rendered small in the app)

OpenITI places PageVxxPyyy at the END of page yyy, so text before a marker is on that page.
"""
import json, re, sys, os, unicodedata
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reflow_siyar_text import reflow

SRC, SIYAR, OUT, REP = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True); os.makedirs(REP, exist_ok=True)

lines = open(SRC, encoding='utf8').read().split('\n')
# skip metadata header
start = next(i for i, l in enumerate(lines) if l.startswith('#META#Header#End#')) + 1
lines = lines[start:]

PAGE = re.compile(r'PageV(\d+)P(\d+)')
MS = re.compile(r'\s*\bms\d+[A-Z]?\b')
SPAN = re.compile(r'</?span[^>]*>')
HEAD_ENTRY = re.compile(r'^### (\$\$?) ?(.*)$')
NUM = re.compile(r'^(\*\s*)?([0-9٠-٩]+)\s*(?:-\s*|$)')

# ---- 1. split into blocks: sirah, khulafa (4), numbered entries ----
blocks = []          # dict(kind, header, lines, line_no)
cur = None
in_khul = numbered = False
for i, l in enumerate(lines):
    if l.startswith('### '):
        m = HEAD_ENTRY.match(l)
        if m:
            cur = dict(kind='entry', women=m.group(1) == '$$', header=m.group(2).strip(), lines=[], ln=i + start + 1, li=i)
            blocks.append(cur); continue
        if '[السيرة النبوية]' in l:
            cur = dict(kind='sirah', header='السيرة النبوية', lines=[], ln=i + start + 1, li=i); blocks.append(cur); continue
        if '[سير الخلفاء الراشدين]' in l:
            in_khul = True; cur = None; continue
        if in_khul and l.startswith('### ||  - '):
            cur = dict(kind='khalifa', header=l[len('### ||  - '):].strip().rstrip(':'), lines=[], ln=i + start + 1, li=i)
            blocks.append(cur); continue
        if l.startswith('### |PARATEXT|') or (l.startswith('### || ') and numbered) or l.strip() == '### |':
            # volume end / tabaqah heading / start of numbered part: close current entry
            if l.strip() == '### |': in_khul = False; numbered = True
            cur = dict(kind='skip', lines=[]); continue
        # sub-headings inside sirah / khulafa sections stay part of the text
        if cur is not None and cur['kind'] in ('sirah', 'khalifa'):
            cur['lines'].append(('H', l.lstrip('#').lstrip(' |').strip())); continue
        cur = dict(kind='skip', lines=[]); continue
    if cur is None: continue
    if l.startswith('# '):
        cur['lines'].append(('P', l[2:]))
    elif l.startswith('~~'):
        if cur['lines']: cur['lines'][-1] = (cur['lines'][-1][0], cur['lines'][-1][1] + ' ' + l[2:])
        else: cur['lines'].append(('P', l[2:]))
    elif l.strip() == '#':
        continue
    elif l.strip():
        # bare line (usually a lone page marker)
        if cur['lines']: cur['lines'][-1] = (cur['lines'][-1][0], cur['lines'][-1][1] + ' ' + l.strip())
        else: cur['lines'].append(('P', l.strip()))

blocks = [b for b in blocks if b['kind'] != 'skip']

# ---- 2. page bookkeeping: page of a position = next marker at/after it ----
# next page marker at or after each raw line (a marker inside the heading line counts)
pg_next = [None] * (len(lines) + 1)
for li in range(len(lines) - 1, -1, -1):
    m = PAGE.search(lines[li])
    pg_next[li] = (int(m.group(1)), int(m.group(2))) if m else pg_next[li + 1]

def clean(t):
    t = SPAN.sub('', t)
    t = MS.sub('', t)
    t = PAGE.sub(lambda m: '⟦%d:%d⟧' % (int(m.group(1)), int(m.group(2))), t)
    t = re.sub(r'[ \t]{2,}', ' ', t).strip()
    return t

for bi, b in enumerate(blocks):
    v, p = pg_next[b['li']] if pg_next[b['li']] else (None, None)
    b['vol'], b['page'] = v, p
    paras = []
    for kind, t in b['lines']:
        c = clean(t)
        if not c: continue
        paras.append(('§ ' + c) if kind == 'H' else c)
    b['text'] = reflow('\n'.join(paras))   # re-join sentences split at page breaks
    pages = [(int(a), int(c)) for a, c in re.findall(r'⟦(\d+):(\d+)⟧', b['text'])]
    b['last'] = pages[-1] if pages else (v, p)
    if b['kind'] == 'entry':
        h = clean(b['header'])
        m = NUM.match(h)
        b['no'] = m.group(2).translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')) if m else None
        b['star'] = bool(m and m.group(1))
        b['hclean'] = h

entries = [b for b in blocks if b['kind'] == 'entry']
print('blocks:', len(blocks), 'numbered entries:', len(entries),
      'sirah:', sum(b['kind'] == 'sirah' for b in blocks), 'khulafa:', sum(b['kind'] == 'khalifa' for b in blocks))

# ---- 3. match to siyar.json by (vol, entry no) then check page ----
D = json.load(open(SIYAR, encoding='utf8'))
K = D['K']; S = D['S']
iREF, iNO, iLEAD = K.index('ref'), K.index('no'), K.index('n')

def norm(s):
    s = unicodedata.normalize('NFKC', s or '')
    s = re.sub(r'[ً-ٰٟـ]', '', s)
    s = s.translate(str.maketrans('أإآٱىةؤئ', 'ااااىهوي'))
    s = re.sub(r'[^ء-ي ]', ' ', s)
    return ' '.join(s.split())

by_key = defaultdict(list)
for e in entries: by_key[(e['vol'], e['no'])].append(e)

def name_overlap(lead, head):
    a = set(w for w in norm(lead).split() if len(w) > 2 and w not in ('ابن', 'بن', 'ابو', 'عبد', 'بنت', 'الله'))
    b = set(norm(head).split())
    return len(a & b) / max(1, len(a))

matched, unmatched, doubtful = {}, [], []
used = set()
khul = [b for b in blocks if b['kind'] == 'khalifa']
sirah = [b for b in blocks if b['kind'] == 'sirah']
for i, r in enumerate(S):
    ref = r[iREF]
    if ref == 'al-Sīrah al-Nabawiyyah':
        if sirah: matched[i] = sirah[0]; used.add(id(sirah[0]))
        else: unmatched.append((i, 'no sirah block'))
        continue
    if ref == 'Siyar al-Khulafāʾ al-Rāshidīn':
        # match by order of the four khulafa sections; verify name
        k = sum(1 for x in S[:i] if x[iREF] == ref)
        b = khul[k] if k < len(khul) else None
        if b and name_overlap(r[iLEAD], b['header']) >= .34:
            matched[i] = b; used.add(id(b))
        else: unmatched.append((i, 'khalifa section not found'))
        continue
    m = re.match(r'^(\d+):(\d+)$', ref or '')
    if not m: unmatched.append((i, 'no vol:page in fact file (%r)' % ref)); continue
    v, p = int(m.group(1)), int(m.group(2))
    cands = [e for e in by_key.get((v, str(r[iNO]).strip()), []) if id(e) not in used]
    if not cands:
        unmatched.append((i, 'no entry %s in vol %d' % (r[iNO], v))); continue
    # prefer the candidate on the same page
    cands.sort(key=lambda e: (e['page'] != p, abs((e['page'] or 0) - p)))
    e = cands[0]
    used.add(id(e)); matched[i] = e
    reasons = []
    if e['page'] != p: reasons.append('page differs: fact file %d:%d, text starts %s:%s' % (v, p, e['vol'], e['page']))
    ov = name_overlap(r[iLEAD], e['hclean'] + ' ' + ' '.join(e['text'].split('\n')[:2]))
    if ov < .34: reasons.append('name overlap low (%.2f)' % ov)
    if reasons and len(by_key[(v, str(r[iNO]).strip())]) > 1: reasons.append('entry number %s occurs %d times in vol %d' % (r[iNO], len(by_key[(v, str(r[iNO]).strip())]), v))
    if reasons: doubtful.append((i, reasons))

orphans = [b for b in blocks if id(b) not in used]
print('matched', len(matched), 'unmatched', len(unmatched), 'doubtful', len(doubtful), 'text blocks unused', len(orphans))

# ---- 4. write volumes + index ----
vols = defaultdict(dict)
index = {}
for i, b in matched.items():
    v = 0 if b['kind'] in ('sirah', 'khalifa') else b['vol']
    head = b['hclean'] if b['kind'] == 'entry' else b['header']
    vols[v][str(i)] = {'h': head, 't': b['text']}
    status = 'd' if any(d[0] == i for d in doubtful) else 'm'
    index[str(i)] = [v, status, len(b['text'])]
for v, ents in sorted(vols.items()):
    with open(os.path.join(OUT, 'vol%02d.json' % v), 'w', encoding='utf8') as f:
        json.dump({'v': v, 'e': ents}, f, ensure_ascii=False, separators=(',', ':'))
sizes = {('vol%02d' % v): os.path.getsize(os.path.join(OUT, 'vol%02d.json' % v)) for v in vols}
with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf8') as f:
    json.dump({'src': 'OpenITI 0748Dhahabi.SiyarAclamNubala.Shamela0010906-ara1', 'vols': sizes, 'i': index}, f,
              ensure_ascii=False, separators=(',', ':'))

# ---- 5. reports ----
def rec(i):
    r = S[i]
    return {'idx': i, 'name': r[iLEAD], 'ref': r[iREF], 'no': r[iNO], 'en': r[K.index('en')] if False else None}
rep = {
    'source': 'OpenITI/0750AH data/0748Dhahabi/0748Dhahabi.SiyarAclamNubala/0748Dhahabi.SiyarAclamNubala.Shamela0010906-ara1.mARkdown',
    'records': len(S), 'matched': len(matched), 'matched_clean': len(matched) - len(doubtful),
    'unmatched': [dict(idx=i, name=S[i][iLEAD], ref=S[i][iREF], no=S[i][iNO], why=w) for i, w in unmatched],
    'doubtful': [dict(idx=i, name=S[i][iLEAD], ref=S[i][iREF], no=S[i][iNO],
                      text_heading=matched[i]['hclean'] if matched[i]['kind'] == 'entry' else matched[i]['header'],
                      text_starts='%s:%s' % (matched[i]['vol'], matched[i]['page']), why=w) for i, w in doubtful],
    'text_entries_without_record': [dict(heading=b.get('hclean', b.get('header')), at='%s:%s' % (b['vol'], b['page']), src_line=b['ln']) for b in orphans],
}
json.dump(rep, open(os.path.join(REP, 'match_report.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in rep.items()}, ensure_ascii=False))
