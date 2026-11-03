import re, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)            # .../siyar/translate
SIYAR = os.path.dirname(ROOT)           # .../siyar
AR = 'ء-يٱ'
TASH = re.compile('[ً-ْٰـ]')
def norm(s):
    s = TASH.sub('', s)
    s = re.sub('[أإآٱ]', 'ا', s)
    s = s.replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي')
    return s
def load_glossary():
    g = []
    for l in open(os.path.join(ROOT, 'GLOSSARY.tsv'), encoding='utf8'):
        if l.startswith('#') or not l.strip(): continue
        p = l.rstrip('\n').split('\t') + ['', '', '']
        g.append({'ar': p[0], 'en': p[1], 'var': [v for v in p[2].split('|') if v], 'note': p[3]})
    return g
