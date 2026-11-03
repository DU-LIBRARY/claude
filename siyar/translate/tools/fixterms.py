"""Rewrite already-written outputs so agent-invented renderings use the glossary: python3 fixterms.py"""
import json, glob, os, re
from common import *
G = {g['ar']: g for g in load_glossary()}
VAR = {}
for g in G.values():
    for v in g['var']: VAR.setdefault(v, g['ar'])
n = 0
for f in sorted(glob.glob(os.path.join(ROOT, 'work/out/p[0-9]*.json'))):
    if '.part' in f: continue
    d = json.load(open(f, encoding='utf8')); ch = False
    for ar, en in d.get('__new_terms__', []):
        can = ar if ar in G else VAR.get(ar)
        if not can: continue
        for k, v in d.items():
            if k.startswith('__'): continue
            pat = re.compile(r'(?i)\b' + re.escape(en) + r'(s?) \(' + re.escape(ar) + r'\)')
            t2 = pat.sub(lambda m: G[can]['en'] + m.group(1) + ' (' + can + ')', v['t'])
            if t2 != v['t']: v['t'] = t2; ch = True; n += 1
    if ch:
        d['__new_terms__'] = [x for x in d['__new_terms__'] if x[0] not in G and x[0] not in VAR]
        json.dump(d, open(f, 'w', encoding='utf8'), ensure_ascii=False)
print('entries changed', n)
