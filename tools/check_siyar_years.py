#!/usr/bin/env python3
"""List records whose fact-file death year is not mentioned anywhere in al-Dhahabi's full entry.
This only produces a list for human review; it changes nothing.
usage: python3 tools/check_siyar_years.py siyar/data/siyar.json siyar/data/full OUT.json"""
import json, re, sys, os
SI, FULL, OUT = sys.argv[1:4]
D = json.load(open(SI, encoding='utf8')); K = D['K']; S = D['S']

def norm(s):
    s = re.sub(r'[ً-ٰٟـ]', '', s)
    return s.translate(str.maketrans('أإآٱىة', 'اااايه'))

U = {'احدي':1,'احد':1,'واحد':1,'واحده':1,'اثنتين':2,'اثنين':2,'ثنتين':2,'اثنتي':2,'اثني':2,'ثنتي':2,'ثلاث':3,'ثلاثه':3,'اربع':4,'اربعه':4,
     'خمس':5,'خمسه':5,'ست':6,'سته':6,'سبع':7,'سبعه':7,'ثمان':8,'ثماني':8,'ثمانيه':8,'تسع':9,'تسعه':9}
T = {'عشر':10,'عشره':10,'عشرين':20,'ثلاثين':30,'اربعين':40,'خمسين':50,'ستين':60,'سبعين':70,'ثمانين':80,'تسعين':90}
H = {'ماىه':100,'مايه':100,'ميه':100,'ماءه':100,'مائه':100,'مئه':100,'ماتين':200,'مايتين':200,'مئتين':200,'مائتين':200,'ميتين':200}
for u, n in list(U.items()):
    for h in ('مائه', 'ماىه', 'مايه', 'ميه', 'مئه'): H[u + h] = n * 100
    H['ثلثمائه'] = 300; H['ثلثماىه'] = 300

def years(text):
    t = norm(text)
    t = re.sub(r'\s*⟦\d+:\d+⟧\s*', ' ', t); t = re.sub(r'\s*\(\d{1,2}\)', '', t)
    out = set()
    for m in re.finditer(r'(?:سنه|عام|في)\s+(?=((?:\S+\s*){1,7}))', t):
        ws = m.group(1).split()
        total = 0; pend = 0; seen = False; last_unit = None
        PLAIN = ('مائه', 'ماىه', 'مايه', 'ميه', 'مئه', 'ماءه')
        for w in ws:
            w = w.strip('،,.:;()[]-"«»!؟')
            waw = False
            if w.startswith('و') and w[1:] and (w[1:] in U or w[1:] in T or w[1:] in H): w = w[1:]; waw = True
            if w in U: pend += U[w]; last_unit = U[w]; seen = True
            elif w in T: pend += T[w]; last_unit = None; seen = True
            elif w in H:
                if w in PLAIN and not waw and last_unit is not None:
                    total += last_unit * 100; pend -= last_unit   # "...وثلاث مائة"
                else:
                    total += H[w]
                last_unit = None; seen = True
            else: break
        if seen: out.add(total + pend)
    for m in re.finditer(r'\b(\d{1,3})\b', t): out.add(int(m.group(1)))
    return out

idx = json.load(open(os.path.join(FULL, 'index.json'), encoding='utf8'))['i']
cache = {}
flags = []
for i, r in enumerate(S):
    d = r[2] or ''
    m = re.fullmatch(r'd\. (\d+)', d) or re.fullmatch(r'\d+–(\d+)', d)
    if not m: continue
    y = int(m.group(1))
    v = idx[str(i)][0]
    if v not in cache: cache[v] = json.load(open(os.path.join(FULL, 'vol%02d.json' % v), encoding='utf8'))['e']
    e = cache[v][str(i)]
    ys = years(e['h'] + '\n' + e['t'])
    if y not in ys and not (y >= 100 and (y % 100) in {x for x in ys if 0 < x < 100}):
        flags.append({'idx': i, 'name': r[0], 'ref': r[7], 'no': r[8], 'fact_file_death': d, 'years_in_text': sorted(x for x in ys if 0 < x < 800)[:25]})
json.dump(flags, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(len(flags), 'records to check')
