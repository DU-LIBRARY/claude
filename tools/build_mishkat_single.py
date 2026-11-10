#!/usr/bin/env python3
"""Build dist/mishkat-offline.html: the whole Mishkāt reader in one file (fonts, data, icons, Motion inlined).

Open it straight from a phone's Files app or a laptop's disk with no connection. The installable PWA in
mishkat/ uses the same index.html and app.js; this script only inlines what they reference, and drops what
needs a server (manifest, service worker, Google note sync).
"""
import base64, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / 'mishkat'
OUT = ROOT / 'dist' / 'mishkat-offline.html'

html = (APP / 'index.html').read_text(encoding='utf-8')

def font_uri(m):
    return 'url(data:font/woff2;base64,' + base64.b64encode((APP / m.group(1)).read_bytes()).decode() + ')'

html = re.sub(r'url\((fonts/[^)]+\.woff2)\)', font_uri, html)

b64 = lambda p: base64.b64encode((APP / p).read_bytes()).decode()
svg = 'data:image/svg+xml;base64,' + b64('icons/icon.svg')
html = html.replace('href="icons/icon.svg"', 'href="' + svg + '"')
html = html.replace('src="icons/icon.svg"', 'src="' + svg + '"')
html = html.replace('href="icons/apple-touch-icon.png"', 'href="data:image/png;base64,' + b64('icons/apple-touch-icon.png') + '"')
html = re.sub(r'<link rel="manifest"[^>]*>\n', '', html)
html = re.sub(r'<link rel="preload"[^>]*>\n', '', html)

def blob(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')

meta = json.loads((APP / 'data/meta.json').read_text(encoding='utf-8'))
blocks = '<script id="data-meta" type="application/json">' + blob(meta) + '</script>'
for b in meta['books']:
    data = json.loads((APP / 'data' / b['file']).read_text(encoding='utf-8'))
    blocks += '\n<script id="data-' + b['id'] + '" type="application/json">' + blob(data) + '</script>'
narr = APP / 'data/narrators.json'
if narr.exists():
    blocks += '\n<script id="data-narrators" type="application/json">' + blob(json.loads(narr.read_text(encoding='utf-8'))) + '</script>'
html = html.replace('<script id="data-meta" type="application/json"></script>', blocks)

def inline_js(path):
    return '<script>' + (APP / path).read_text(encoding='utf-8').replace('</script', '<\\/script') + '</script>'

html = html.replace('<script src="vendor/motion-11.11.17.min.js"></script>', inline_js('vendor/motion-11.11.17.min.js'))
html = html.replace('<script src="app.js"></script>', inline_js('app.js'))
# Google sync needs the hosted site (sign-in does not run from a local file), so leave it out.
html = html.replace('<script src="firebase-config.js"></script>\n', '').replace('<script src="sync.js"></script>\n', '')

# nothing may still point at a local file or the network
markup = re.sub(r'<script[^>]*>.*?</script>', '<script></script>', html, flags=re.S)
for pat, what in [(r'(?:src|href)="(?!#|data:)[^"]*"', 'src/href'), (r'url\((?!data:)[^)]*\)', 'url()')]:
    left = re.findall(pat, markup)
    assert not left, 'leftover ' + what + ': ' + repr(left[:5])
assert 'src="sync.js"' not in html and 'firebase' not in markup.lower()
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(html, encoding='utf-8')
print(f'{OUT.relative_to(ROOT)}  {OUT.stat().st_size/1e6:.2f} MB')
