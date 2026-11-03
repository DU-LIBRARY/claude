"""Build work packets. python3 prep.py [--limit-chars 30000]"""
import json, glob, os, sys
from common import *
LIM = 30000; OPUS_ENTRY = 8000; MAX = 20000
packets = []; cur = []; cs = 0
def flush():
    global cur, cs
    if cur: packets.append(cur); cur = []; cs = 0
for f in sorted(glob.glob(os.path.join(SIYAR, 'data/full/vol*.json'))):
    vol = os.path.basename(f)[:-5]
    for k, v in json.load(open(f, encoding='utf8'))['e'].items():
        n = len(v['t'])
        if n >= MAX: continue
        e = {'key': k, 'vol': vol, 'h': v['h'], 't': v['t'], 'chars': n}
        if n >= OPUS_ENTRY:
            flush(); packets.append([e]); continue
        if cs + n > LIM: flush()
        cur.append(e); cs += n
flush()
man = []
for i, p in enumerate(packets):
    pid = 'p%04d' % i
    chars = sum(e['chars'] for e in p)
    model = 'opus' if any(e['chars'] >= OPUS_ENTRY for e in p) else 'sonnet'
    json.dump(p, open(os.path.join(ROOT, 'work/in', pid + '.json'), 'w', encoding='utf8'), ensure_ascii=False)
    man.append({'id': pid, 'vol': p[0]['vol'], 'n': len(p), 'chars': chars, 'model': model})
json.dump(man, open(os.path.join(ROOT, 'work/manifest.json'), 'w'), indent=0)
print(len(man), 'packets;', sum(1 for m in man if m['model'] == 'opus'), 'opus;', sum(m['chars'] for m in man), 'chars')
