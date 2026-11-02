#!/usr/bin/env python3
"""Build dist/al-ikmal-offline.html: the whole app in one file (fonts, data, Motion inlined).

Open it straight from a phone's Files app or a laptop's disk with no connection. The installable
PWA in app/ uses the same index.html and app.js; this script only inlines what they reference.
"""
import base64, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / 'app'
OUT = ROOT / 'dist' / 'al-ikmal-offline.html'

html = (APP / 'index.html').read_text(encoding='utf-8')

def font_uri(m):
    data = base64.b64encode((APP / m.group(1)).read_bytes()).decode()
    return 'url(data:font/woff2;base64,' + data + ')'

html = re.sub(r'url\((fonts/[^)]+\.woff2)\)', font_uri, html)

icon = base64.b64encode((APP / 'icons/apple-touch-icon.png').read_bytes()).decode()
svg = base64.b64encode((APP / 'icons/icon.svg').read_bytes()).decode()
html = html.replace('href="icons/icon.svg"', 'href="data:image/svg+xml;base64,' + svg + '"')
html = html.replace('href="icons/apple-touch-icon.png"', 'href="data:image/png;base64,' + icon + '"')
html = re.sub(r'<link rel="manifest"[^>]*>\n', '', html)
html = re.sub(r'<link rel="preload"[^>]*>\n', '', html)

data = json.loads((APP / 'data/ikmal.json').read_text(encoding='utf-8'))
blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
html = html.replace('<script id="data" type="application/json"></script>',
                    '<script id="data" type="application/json">' + blob + '</script>')

def inline_js(path):
    return '<script>' + (APP / path).read_text(encoding='utf-8').replace('</script', '<\\/script') + '</script>'

html = html.replace('<script src="vendor/motion-11.11.17.min.js"></script>', inline_js('vendor/motion-11.11.17.min.js'))
html = html.replace('<script src="app.js"></script>', inline_js('app.js'))

assert 'src="vendor' not in html and 'src="app.js"' not in html and 'url(fonts/' not in html
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(html, encoding='utf-8')
print(f'{OUT.relative_to(ROOT)}  {OUT.stat().st_size/1e6:.2f} MB')
