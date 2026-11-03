"""python3 status.py [n]  -> validate every packet that has output, print todo list head"""
import json, os, subprocess, sys
from common import *
man = json.load(open(os.path.join(ROOT, 'work/manifest.json')))
st = json.load(open(os.path.join(ROOT, 'work/status.json'))) if os.path.exists(os.path.join(ROOT, 'work/status.json')) else {}
for m in man:
    pid = m['id']
    if st.get(pid) == 'ok': continue
    if os.path.exists(os.path.join(ROOT, 'work/out', pid + '.json')):
        r = subprocess.run([sys.executable, os.path.join(HERE, 'validate.py'), pid], capture_output=True, text=True)
        st[pid] = 'ok' if r.returncode == 0 else 'bad'
json.dump(st, open(os.path.join(ROOT, 'work/status.json'), 'w'))
ok = sum(1 for v in st.values() if v == 'ok'); bad = [k for k, v in st.items() if v == 'bad']
todo = [m for m in man if m['id'] not in st]
print(f'ok {ok}/{len(man)}; bad {bad}; todo {len(todo)} ({sum(m["chars"] for m in todo)} chars)')
n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
print(' '.join(f'{m["id"]}:{m["model"]}' for m in todo[:n]))
