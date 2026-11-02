#!/usr/bin/env python3
"""Pull the latest narrator data from a saved copy of the shared Al-Ikmāl artifact page.

Usage: python3 tools/sync_from_artifact.py path/to/artifact.html

Reads the page's <script id="data" type="application/json"> block, checks its shape, writes
app/data/ikmal.json, bumps VERSION in app/sw.js so installed apps pick up the change, and
rebuilds dist/al-ikmal-offline.html. Prints what changed. Never runs code from the page.
"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'app/data/ikmal.json'
SW = ROOT / 'app/sw.js'
REQUIRED = {'n', 'p', 'l', 'c', 'ar', 'full', 'en', 'art'}
CATS = {'s', 't', 'sf', 'tf', 'a'}

html = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
m = re.search(r'<script id="data" type="application/json">(.*?)</script>', html, re.S)
if not m:
    sys.exit('No data block found in that page. Has the artifact changed structure?')
new = json.loads(m.group(1))
assert isinstance(new, list) and new, 'Data is not a non-empty list'
for i, o in enumerate(new):
    missing = REQUIRED - o.keys()
    assert not missing, f'Entry {i} is missing {sorted(missing)}'
    assert o['c'] in CATS, f'Entry {i} has unknown section {o["c"]!r}'

old = json.loads(DATA.read_text(encoding='utf-8'))
key = lambda o: (o['n'], o.get('nl'))
om, nm = {key(o): o for o in old}, {key(o): o for o in new}
added = [k for k in nm if k not in om]
removed = [k for k in om if k not in nm]
changed = [k for k in nm if k in om and nm[k] != om[k]]
print(f'{len(new)} entries: {len(added)} added, {len(removed)} removed, {len(changed)} changed')
for label, ks in (('added', added), ('removed', removed), ('changed', changed)):
    if ks:
        print(f'  {label}: ' + ', '.join(str(k[1] or k[0]) for k in ks[:40]) + (' …' if len(ks) > 40 else ''))
if not (added or removed or changed):
    print('Nothing to update.')
    sys.exit(0)

DATA.write_text(json.dumps(new, ensure_ascii=False), encoding='utf-8')
sw = SW.read_text(encoding='utf-8')
v = re.search(r"VERSION = 'ikmal-v(\d+)\.(\d+)\.(\d+)'", sw)
nv = f'ikmal-v{v[1]}.{int(v[2]) + 1}.0'
SW.write_text(sw.replace(v[0], f"VERSION = '{nv}'"), encoding='utf-8')
print('Service worker version ->', nv)
subprocess.run([sys.executable, str(ROOT / 'tools/build_single.py')], check=True)
