#!/usr/bin/env python3
"""Independent check that the full entries reproduce the OpenITI text exactly (letters, digits and punctuation),
ignoring only OpenITI markup. usage: verify_siyar_text.py SOURCE.mARkdown siyar/data/full"""
import json, re, sys, os, glob
src = open(sys.argv[1], encoding='utf8').read()
src = src[src.index('#META#Header#End#') + len('#META#Header#End#'):]
def strip_src(s):
    s = re.sub(r'PageV\d+P\d+', '', s); s = re.sub(r'\bms\d+[A-Z]?\b', '', s); s = re.sub(r'</?span[^>]*>', '', s)
    s = re.sub(r'^### .*$', '', s, flags=re.M)          # headings (entry headings compared separately)
    s = re.sub(r'^(# |~~|#$)', '', s, flags=re.M)
    return re.sub(r'\s+', '', s)
def strip_out(s):
    s = re.sub(r'⟦\d+:\d+⟧', '', s); s = re.sub(r'^§ .*$', '', s, flags=re.M)
    return re.sub(r'\s+', '', s)
full = strip_src(src)
bad = 0; n = 0; tot = 0
for f in sorted(glob.glob(os.path.join(sys.argv[2], 'vol*.json'))):
    for i, e in json.load(open(f, encoding='utf8'))['e'].items():
        t = strip_out(e['t']); n += 1; tot += len(t)
        if t and t not in full: bad += 1; print('NOT FOUND verbatim:', i, e['h'][:50])
print(n, 'entries checked;', bad, 'not found verbatim in the source; chars', tot, 'of', len(full))
