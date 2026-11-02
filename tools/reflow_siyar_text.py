#!/usr/bin/env python3
"""Re-join paragraphs that the source splits in the middle of a sentence.

The OpenITI text starts a new line at most printed page breaks (and at some other points), so a
sentence running over a page came out as two half paragraphs:  "... وأشار به يوم ⟦1:5⟧" / "السقيفة؛ ...".
A line is joined to the next one (with a space; the page tag stays where it is) when it plainly
does not end a sentence:

  - it does not end in . ؟ ! : ) " » ] * (trailing page tags and footnote calls like (3) are ignored), and
  - neither line is a sub-heading (§) or a verse line (contains ' ... '), and
  - it ends at a page tag, or it has at least 4 words (short unpunctuated lines are usually
    headings such as «فصل» or «ذكر شيوخه»).

Only line breaks change; the wording is untouched (verify_siyar_text.py still passes).

usage: reflow_siyar_text.py siyar/data/full        (rewrites vol*.json and the sizes in index.json)
"""
import json, re, sys, os, glob

MK_END = re.compile(r'\s*⟦\d+:\d+⟧\s*$')
FN_END = re.compile(r'\s*\(\d{1,2}\)\s*$')
TERMINAL = set('.؟?!:)"»]*')


def _core(line):
    """Line without trailing page tags / footnote calls; and whether it ended at a page tag."""
    s, at_page = line.rstrip(), False
    while True:
        m = MK_END.search(s) or FN_END.search(s)
        if not m: break
        if MK_END.search(s): at_page = True
        s = s[:m.start()].rstrip()
    return s, at_page


def _special(line):
    return line.startswith('§ ') or ' ... ' in line


def joins(line, nxt):
    if not nxt.strip() or _special(line) or _special(nxt): return False
    core, at_page = _core(line)
    if not core or core[-1] in TERMINAL: return False
    if at_page: return True
    return len(core.split()) >= 4


def reflow(text):
    out = []
    for line in text.split('\n'):
        if out and joins(out[-1], line): out[-1] = out[-1].rstrip() + ' ' + line.lstrip()
        else: out.append(line)
    return '\n'.join(out)


if __name__ == '__main__':
    d = sys.argv[1]
    total = 0
    for f in sorted(glob.glob(os.path.join(d, 'vol*.json'))):
        vol = json.load(open(f, encoding='utf8'))
        n = 0
        for e in vol['e'].values():
            t = reflow(e['t'])
            n += e['t'].count('\n') - t.count('\n'); e['t'] = t
        with open(f, 'w', encoding='utf8') as fh: json.dump(vol, fh, ensure_ascii=False, separators=(',', ':'))
        total += n
        print(os.path.basename(f), n, 'lines joined')
    ip = os.path.join(d, 'index.json')
    idx = json.load(open(ip, encoding='utf8'))
    idx['vols'] = {k: os.path.getsize(os.path.join(d, k + '.json')) for k in idx['vols']}
    for f in glob.glob(os.path.join(d, 'vol*.json')):
        for i, e in json.load(open(f, encoding='utf8'))['e'].items(): idx['i'][i][2] = len(e['t'])
    with open(ip, 'w', encoding='utf8') as fh: json.dump(idx, fh, ensure_ascii=False, separators=(',', ':'))
    print(total, 'lines joined in all')
