"""python3 validate.py <packet-id>   (merges <id>.part*.json into <id>.json first)"""
import sys, re, json, glob, os
from common import *
pid = sys.argv[1]
src = {e['key']: e for e in json.load(open(os.path.join(ROOT, 'work/in', pid + '.json'), encoding='utf8'))}
outp = os.path.join(ROOT, 'work/out', pid + '.json')
parts = sorted(glob.glob(os.path.join(ROOT, 'work/out', pid + '.part*.json')))
out = {}
if os.path.exists(outp): out.update(json.load(open(outp, encoding='utf8')))
for p in parts: out.update(json.load(open(p, encoding='utf8')))
if parts: json.dump(out, open(outp, 'w', encoding='utf8'), ensure_ascii=False)
G = load_glossary()
canon = {g['ar']: g for g in G}
newt = {a: e for a, e in out.get('__new_terms__', [])}
errs, warns = [], []
def E(k, m): errs.append(f'ERROR [{k}] {m}')
def W(k, m): warns.append(f'WARN  [{k}] {m}')
MARK = re.compile(r'⟦[^⟧]*⟧'); FN = re.compile(r'\(\d{1,2}\)')
ARRUN = re.compile(r'[%s][%sً-ْٰ\s،؛:\-–]*[%sً-ْٰ]|[%s]' % (AR, AR, AR, AR))
BR = re.compile(r'\(([^()]*[%s][^()]*)\)' % AR)
# glossary regex (advisory)
def forms(g):
    fs = {g['ar']} | set(g['var'])
    for f in list(fs):
        n = norm(f)
        fs.add(n)
        if n.startswith('ال'): fs.add(n[2:])
        else: fs.add('ال' + n)
    return {norm(f) for f in fs}
GR = []
for g in G:
    alts = '|'.join(sorted(map(re.escape, forms(g)), key=len, reverse=True))
    GR.append((g, re.compile(r'(?<![%s])[وفبلك]{0,2}(?:%s)(?:ه|ها|هم|ا|ان|ين|ون|ات|ي)?(?![%s])' % (AR, alts, AR))))
def en_ok(before, en):
    b = before.lower().rstrip()
    e = en.lower(); e2 = e[4:] if e.startswith('the ') else e
    for c in {e, e2}:
        for suf in ('', 's', 'es', 'ies'):
            cc = c[:-1] + 'ies' if suf == 'ies' and c.endswith('y') else c + (suf if suf != 'ies' else '')
            if b.endswith(cc): return True
    return False
for k in src:
    if k not in out: E(k, 'missing from output'); continue
    s, o = src[k], out[k]
    if not isinstance(o, dict) or 'h' not in o or 't' not in o: E(k, 'needs h and t'); continue
    for kk in out:
        pass
    # heading
    sh, oh = s['h'], o['h']
    m1 = re.match(r'^(\d+)(?= |$)', sh); m2 = re.match(r'^(\d+)(?= |$)', oh)
    if m1 and (not m2 or m1.group(1) != m2.group(1)): E(k, f'heading number missing/changed: {oh!r}')
    if ' - ' in sh[:12] and ' - ' not in oh[:14] : E(k, f'heading separator lost: {oh!r}')
    if sh.count('*') != oh.count('*'): E(k, 'heading asterisks differ')
    g1 = re.findall(r'\(([^()]*)\)\s*$', sh); g2 = re.findall(r'\(([^()]*)\)\s*$', oh)
    if g1 != g2: E(k, f'heading grading letters differ: src {g1} out {g2}')
    # lines
    sl, ol = s['t'].split('\n'), o['t'].split('\n')
    if len(sl) != len(ol):
        E(k, f'line count {len(ol)} != {len(sl)}')
        continue
    ratio_bad = 0
    for i, (a, b) in enumerate(zip(sl, ol), 1):
        tag = f'{k} l{i}'
        if MARK.findall(a) != MARK.findall(b): E(tag, f'page markers differ: {MARK.findall(a)} vs {MARK.findall(b)}')
        if FN.findall(a) != FN.findall(b): E(tag, f'footnote markers differ: {FN.findall(a)} vs {FN.findall(b)}')
        na = norm(a)
        # arabic runs in output
        brs = []
        for m in BR.finditer(b):
            inner = m.group(1).strip()
            if re.search('[A-Za-z]', inner): continue          # mixed, not a pure bracket
            brs.append((m.start(), m.group(0), inner))
        for _, whole, inner in brs:
            if inner in canon or inner in newt: continue
            if norm(inner) in na: continue                  # verbatim from source (sigla etc.)
            E(tag, f'bracketed Arabic not in glossary: {whole}')
        brspans = [(st, st + len(w)) for st, w, _ in brs]
        for m in re.finditer(r'[%s][%sً-ْٰ\s،؛:\-–.!؟]*' % (AR, AR), b):
            if any(st <= m.start() < en for st, en in brspans): continue
            run = norm(m.group(0)).strip(' ،؛:-–.!؟')
            if run and run not in na: E(tag, f'Arabic in output not found in source line: {m.group(0).strip()!r}')
        # bracket english precedes
        for st, whole, inner in brs:
            if inner in canon:
                before = b[:st]
                if not en_ok(before, canon[inner]['en']):
                    E(tag, f'rendering mismatch: "{before[-40:]}" + {whole}; glossary says "{canon[inner]["en"]}"')
        # glossary coverage (advisory)
        have = {inner for _, _, inner in brs}
        for g, rx in GR:
            if g['ar'] in ('السنة', 'الحسن'): continue   # collide with 'year' / the name al-Ḥasan; checked only when bracketed
            if rx.search(na) and g['ar'] not in have and not any(norm(x) == norm(g['ar']) for x in have):
                if rx.search(norm(re.sub(r'\([^()]*[A-Za-z][^()]*\)', '', b))): continue   # term kept verbatim in an Arabic chain/list
                W(tag, f'source has «{g["ar"]}» ({g["en"]}) but output has no bracket for it')
        # untranslated / omitted
        lat = len(re.findall(r'[A-Za-z]', b)); arw = len(re.findall(r'[%s]+' % AR, a))
        if arw >= 4 and lat < 3: W(tag, 'line looks untranslated')
        if arw >= 25 and lat < 0.12 * len(a) and not re.search(r'[:：]', b[:40]): pass
    # whole-entry length check
    tl = len(re.findall(r'[A-Za-z]', o['t'])); al = len(re.findall(r'[%s]' % AR, s['t']))
    if al > 400 and tl < 0.15 * al: W(k, f'English looks short ({tl} latin vs {al} arabic letters): possible omission, or mostly chains')
for k in out:
    if k not in src and k != '__new_terms__': E(k, 'extra key')
for m in errs[:(10**6 if "--all" in sys.argv else 60)]: print(m)
for m in warns[:(10**6 if "--all" in sys.argv else 40)]: print(m)
print(f'{pid}: {len(src)} entries; {len(errs)} errors; {len(warns)} warnings' + (' (showing first 60/40)' if len(errs) > 60 or len(warns) > 40 else ''))
sys.exit(1 if errs else 0)
