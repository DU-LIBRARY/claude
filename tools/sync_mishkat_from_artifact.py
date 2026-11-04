#!/usr/bin/env python3
"""Pull Mishkāt commentary text from a saved copy of a shared claude.ai artifact page.

Usage:
  python3 tools/sync_mishkat_from_artifact.py saved.html [--check] [--strict]
          [--version ID] [--url URL] [--root DIR] [--no-build]

The page is third-party DATA. It is parsed with html.parser into a tree and walked with a strict
whitelist of elements; nothing from it (scripts included) is ever executed or evaluated. Text is
stored as segments (see mishkat/DATA.md), never as HTML.

Steps: parse -> validate (abort with exit 1 and write nothing on malformed input) -> diff against
mishkat/data -> if anything changed: write data/<book>.json and data/meta.json atomically, bump the
minor of VERSION in mishkat/sw.js, run tools/build_mishkat_single.py. If nothing changed it prints
exactly "Nothing to update." and touches no file. --check validates and diffs without writing.

Repo root: --root, else $MISHKAT_ROOT, else the parent of this script's directory.
Standard library only.
"""
import argparse, datetime, hashlib, json, os, pathlib, re, subprocess, sys, tempfile
from html.parser import HTMLParser

MAX_BYTES = 20 * 1024 * 1024
SCHEMA = 1
CHANGELOG_CAP = 30

# Mishkāt kitāb heading (as printed in the page's <h1>, tashkīl ignored) -> (id, English name,
# artifact URL if known). A new book is one line here.
KITAB = {
    'كتاب الإيمان': ('iman', 'Kitāb al-Īmān', None),
    'كتاب العلم': ('ilm', 'Kitāb al-ʿIlm', None),
    'كتاب الطهارة': ('tahara', 'Kitāb al-Ṭahāra', None),
    'كتاب الصلاة': ('salah', 'Kitāb al-Ṣalāh', None),
    'كتاب الجنائز': ('janaiz', 'Kitāb al-Janāʾiz', None),
    'كتاب الزكاة': ('zakah', 'Kitāb al-Zakāh', None),
    'كتاب الصوم': ('sawm', 'Kitāb al-Ṣawm', None),
    'كتاب المناسك': ('manasik', 'Kitāb al-Manāsik', None),
    'كتاب البيوع': ('buyu', 'Kitāb al-Buyūʿ', None),
    'كتاب النكاح': ('nikah', 'Kitāb al-Nikāḥ', 'https://claude.ai/artifact/QxF39U6v4PWEtE3JRJ8PvR'),
    'كتاب العتق': ('itq', 'Kitāb al-ʿItq', None),
}

# Article heading -> commentary key, the order commentaries are stored in, and the cite's work name.
COMMENTARIES = [('mirqat', 'مرقاة المفاتيح', 'Mirqāt'),
                ('tibi', 'شرح الطيبي', 'al-Ṭībī'),
                ('lamaat', 'لمعات التنقيح', 'Lamaʿāt')]
KEY_BY_SRC = {src: key for key, src, _ in COMMENTARIES}
WORK_BY_KEY = {key: work for key, _, work in COMMENTARIES}
KEY_ORDER = [key for key, _, _ in COMMENTARIES]

FASL = {1: ('الفصل الأول', 'al-Faṣl al-Awwal'),
        2: ('الفصل الثاني', 'al-Faṣl al-Thānī'),
        3: ('الفصل الثالث', 'al-Faṣl al-Thālith')}
FASL_BY_AR = {ar: n for n, (ar, _) in FASL.items()}
FASL_BY_EN = {en: n for n, (_, en) in FASL.items()}

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source',
        'track', 'wbr'}
WS = re.compile(r'[ \t\n\r\f]+')              # HTML whitespace only: RLM, NBSP etc. are kept
TASHKEEL = re.compile('[ً-ْٰـ]')
CITE = re.compile(r'^(?P<work>.+?) (?P<vol>\d+)/(?P<pages>\d+(?:[–-]\d+)?) · PDF p\. (?P<pdf>\d+(?:[–-]\d+)?)$')
LABEL = re.compile(r'^Hadeeth (?P<n>\d+)(?: · (?P<fasl>al-Faṣl .+))?$')
GRADING = re.compile(r'^\[[0-9٠-٩]+\]')
VERSION_RE = re.compile(r"const VERSION = 'mishkat-v(\d+)\.(\d+)\.(\d+)';")


class Malformed(Exception):
    pass


# --------------------------------------------------------------------------- tree building

class Node:
    __slots__ = ('tag', 'attrs', 'children', 'line')

    def __init__(self, tag, attrs, line):
        self.tag, self.attrs, self.children, self.line = tag, dict(attrs), [], line

    def cls(self):
        return (self.attrs.get('class') or '').split()

    def has(self, c):
        return c in self.cls()

    def elements(self):
        return [c for c in self.children if isinstance(c, Node)]

    def where(self):
        bits = [self.tag]
        if self.attrs.get('id'):
            bits.append('#' + self.attrs['id'])
        if self.cls():
            bits.append('.' + '.'.join(self.cls()))
        return ''.join(bits) + f' (line {self.line})'


class TreeBuilder(HTMLParser):
    """Builds a plain element tree. Strict: a stray or mismatched end tag is an error."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root', {}, 0)
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.getpos()[0])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs, self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        top = self.stack[-1]
        if top.tag != tag:
            raise Malformed(f'line {self.getpos()[0]}: </{tag}> does not close <{top.where()}>')
        self.stack.pop()

    def handle_data(self, data):
        # script/style bodies arrive here too; they are stored as inert text and never read.
        self.stack[-1].children.append(data)


def parse_tree(html):
    tb = TreeBuilder()
    tb.feed(html)
    tb.close()
    if len(tb.stack) > 1:
        raise Malformed('page is truncated: unclosed ' + ' > '.join(n.where() for n in tb.stack[1:]))
    return tb.root


def find_all(node, pred):
    out = []
    for c in node.elements():
        if pred(c):
            out.append(c)
        out.extend(find_all(c, pred))
    return out


def plain_text(node):
    """Text of a node that may contain only text (no child elements)."""
    for c in node.children:
        if isinstance(c, Node):
            raise Malformed(f'unexpected <{c.tag}> inside {node.where()}')
    return WS.sub(' ', ''.join(node.children)).strip()


def check_blank(node, s):
    if isinstance(s, str) and s.strip():
        raise Malformed(f'unexpected text {s.strip()[:40]!r} directly inside {node.where()}')


# --------------------------------------------------------------------------- segments

def runs_of(node, allow, ctx):
    """Inline content of a paragraph-like node -> list of runs. `allow` is a subset of
    {'b', 'ref', 'rtl', 'fn'}. Any other element is an error, so no text can be dropped silently."""
    out = []

    def walk(n, flags):
        for c in n.children:
            if isinstance(c, str):
                if c:
                    out.append(dict(flags, t=c))
                continue
            if c.tag == 'b' and 'b' in allow:
                walk(c, dict(flags, b=True))
            elif c.tag == 'span' and c.has('mref') and 'ref' in allow:
                walk(c, dict(flags, ref=True))
            elif c.tag == 'span' and not c.cls() and c.attrs.get('dir') == 'rtl' and 'rtl' in allow:
                walk(c, dict(flags, rtl=True))
            elif c.tag == 'sup' and c.has('fn') and 'fn' in allow:
                kids = [k for k in c.children if not (isinstance(k, str) and not k.strip())]
                if len(kids) != 1 or not isinstance(kids[0], Node) or kids[0].tag != 'a':
                    raise Malformed(f'{ctx}: footnote marker {c.where()} must hold exactly one <a>')
                a = kids[0]
                href = a.attrs.get('href') or ''
                if not href.startswith('#') or len(href) < 2:
                    raise Malformed(f'{ctx}: footnote link {a.where()} has bad href {href!r}')
                mark = plain_text(a)
                if not mark:
                    raise Malformed(f'{ctx}: footnote link {a.where()} has no mark')
                out.append({'fn': href[1:], 'mark': mark})
            else:
                raise Malformed(f'{ctx}: unexpected <{c.where()}> inside a paragraph')

    walk(node, {})
    return normalise(out)


FLAG_ORDER = ('b', 'ref', 'rtl')


def normalise(runs):
    """Collapse HTML whitespace (across run boundaries too), trim the ends, merge equal neighbours.
    Each run gets a stable key order: t, then flags in FLAG_ORDER; or fn, mark."""
    res = []
    for r in runs:
        if 'fn' in r:
            res.append({'fn': r['fn'], 'mark': r['mark']})
            continue
        t = WS.sub(' ', r['t'])
        if t.startswith(' ') and (not res or ('t' in res[-1] and res[-1]['t'].endswith(' '))):
            t = t[1:]
        if not t:
            continue
        run = {'t': t}
        for f in FLAG_ORDER:
            if r.get(f):
                run[f] = True
        if res and 't' in res[-1] and {k: v for k, v in res[-1].items() if k != 't'} == \
                {k: v for k, v in run.items() if k != 't'}:
            res[-1]['t'] += t
        else:
            res.append(run)
    # trim leading/trailing space of the paragraph
    while res and 't' in res[0] and res[0]['t'].startswith(' '):
        res[0]['t'] = res[0]['t'].lstrip(' ')
        if not res[0]['t']:
            res.pop(0)
    while res and 't' in res[-1] and res[-1]['t'].endswith(' '):
        res[-1]['t'] = res[-1]['t'].rstrip(' ')
        if not res[-1]['t']:
            res.pop()
    return res


def seg_text(runs):
    return ''.join(r.get('t', r.get('mark', '')) for r in runs)


# --------------------------------------------------------------------------- page -> model

class Page:
    def __init__(self):
        self.warnings = []

    def warn(self, msg):
        self.warnings.append(msg)


def parse_cite(text, key, ctx, page):
    m = CITE.match(text)
    if not m:
        raise Malformed(f'{ctx}: cannot parse citation {text!r}')
    if m['work'] != WORK_BY_KEY[key]:
        page.warn(f'{ctx}: citation names {m["work"]!r}, expected {WORK_BY_KEY[key]!r}')
    return {'cite': text, 'work': m['work'], 'vol': int(m['vol']), 'pages': m['pages'], 'pdf': m['pdf']}


def parse_article(art, sec_id, page):
    ctx = f'{sec_id} {art.where()}'
    els = art.elements()
    for c in art.children:
        check_blank(art, c)
    if not els or els[0].tag != 'h3':
        raise Malformed(f'{ctx}: article does not start with an <h3> heading')
    src = plain_text(els[0])
    if src not in KEY_BY_SRC:
        raise Malformed(f'{ctx}: unknown commentary heading {src!r} (known: {", ".join(KEY_BY_SRC)})')
    key = KEY_BY_SRC[src]
    ctx = f'{sec_id}/{key}'
    com = {'key': key, 'src': src}
    cite = None
    paras, centered, editorial, footnotes, refs = [], [], [], [], []
    for el in els[1:]:
        if el.tag == 'p' and el.has('src'):
            if cite is None:
                cite = parse_cite(plain_text(el), key, ctx, page)
            else:
                ed = runs_of(el, {'b', 'rtl'}, ctx + ' editorial')
                if not ed:
                    raise Malformed(f'{ctx}: empty editorial line {el.where()}')
                editorial.append(ed)
        elif el.tag == 'p' and el.has('ar'):
            if cite is None:
                raise Malformed(f'{ctx}: paragraph before the citation line')
            p = runs_of(el, {'b', 'fn', 'rtl'}, ctx)
            if not p:
                raise Malformed(f'{ctx}: empty paragraph {el.where()}')
            style = WS.sub('', el.attrs.get('style') or '')
            if style:
                if style.rstrip(';') == 'text-align:center':
                    centered.append(len(paras))
                else:
                    raise Malformed(f'{ctx}: unexpected paragraph style {style!r}')
            paras.append(p)
        elif el.tag == 'aside' and el.has('notes'):
            for c in el.children:
                check_blank(el, c)
            for sub in el.elements():
                if sub.tag == 'ol':
                    for c in sub.children:
                        check_blank(sub, c)
                    for li in sub.elements():
                        if li.tag != 'li' or not li.attrs.get('id'):
                            raise Malformed(f'{ctx}: unexpected {li.where()} in footnote list')
                        body = runs_of(li, {'b', 'rtl'}, ctx + ' footnote ' + li.attrs['id'])
                        if not body:
                            raise Malformed(f'{ctx}: empty footnote {li.attrs["id"]}')
                        footnotes.append({'id': li.attrs['id'], 'body': body})
                elif sub.tag == 'p' and sub.has('ref'):
                    r = runs_of(sub, {'b', 'rtl'}, ctx + ' ref')
                    if not r:
                        raise Malformed(f'{ctx}: empty reference line')
                    refs.append(r)
                else:
                    raise Malformed(f'{ctx}: unexpected {sub.where()} in notes')
        else:
            raise Malformed(f'{ctx}: unexpected {el.where()} in commentary')
    if cite is None:
        raise Malformed(f'{ctx}: commentary has no citation line')
    if not paras:
        raise Malformed(f'{ctx}: commentary has no paragraphs')

    # footnote cross-references, all within this commentary
    refs_used = [r for p in paras for r in p if 'fn' in r]
    by_id = {}
    for f in footnotes:
        if f['id'] in by_id:
            raise Malformed(f'{ctx}: duplicate footnote id {f["id"]}')
        by_id[f['id']] = f
    dangling = [r['fn'] for r in refs_used if r['fn'] not in by_id]
    if dangling:
        raise Malformed(f'{ctx}: footnote reference(s) with no footnote: {", ".join(dangling)}')
    used = {r['fn'] for r in refs_used}
    orphans = [f['id'] for f in footnotes if f['id'] not in used]
    if orphans:
        raise Malformed(f'{ctx}: footnote(s) never referenced (orphans): {", ".join(orphans)}')
    seen = set()
    marks = {}
    for r in refs_used:
        if r['fn'] in marks and marks[r['fn']] != r['mark']:
            raise Malformed(f'{ctx}: footnote {r["fn"]} is marked both {marks[r["fn"]]} and {r["mark"]}')
        marks[r['fn']] = r['mark']
        if r['fn'] in seen:
            page.warn(f'{ctx}: footnote {r["fn"]} is referenced more than once')
        seen.add(r['fn'])
    # store footnotes in reference order? No: keep page order, which is what the reader sees.
    fns = [{'id': f['id'], 'mark': marks[f['id']], 'body': f['body']} for f in footnotes]
    order = [r['fn'] for r in refs_used]
    if [f['id'] for f in footnotes] != list(dict.fromkeys(order)):
        page.warn(f'{ctx}: footnotes are listed in a different order from their markers')

    gradings = [seg_text(r) for r in refs if GRADING.match(seg_text(r))]
    if len(gradings) > 1:
        page.warn(f'{ctx}: more than one grading line; the first is used as the commentary grading')
    com.update(cite)
    com.update({'paras': paras, 'centered': centered, 'editorial': editorial, 'footnotes': fns,
                'refs': refs, 'grading': gradings[0] if gradings else None})
    return com


def parse_section(sec, state, book_id, page):
    sid = sec.attrs.get('id') or ''
    if not (sid == 'intro' or re.fullmatch(r'h\d+', sid)):
        raise Malformed(f'{sec.where()}: unexpected section id {sid!r}')
    for c in sec.children:
        check_blank(sec, c)
    els = sec.elements()
    if len(els) != 2 or not (els[0].tag == 'div' and els[0].has('matn')) or \
            not (els[1].tag == 'div' and els[1].has('cols')):
        raise Malformed(f'{sid}: section must hold div.matn then div.cols, found '
                        + ', '.join(e.where() for e in els))
    matn_div, cols = els
    for c in matn_div.children:
        check_blank(matn_div, c)
    num = [e for e in matn_div.elements() if e.tag == 'p' and e.has('num')]
    ar = [e for e in matn_div.elements() if e.tag == 'p' and e.has('ar')]
    extra = [e for e in matn_div.elements() if e not in num and e not in ar]
    if extra or len(num) != 1 or len(ar) != 1:
        raise Malformed(f'{sid}: matn must hold one p.num and one p.ar')
    label = plain_text(num[0])
    matn = runs_of(ar[0], {'b', 'ref'}, sid + ' matn')
    if not matn:
        raise Malformed(f'{sid}: empty matn')

    if sid == 'intro':
        kind, n, fasl = 'intro', None, None
    else:
        m = LABEL.match(label)
        if not m:
            raise Malformed(f'{sid}: cannot read the label {label!r}')
        n = int(m['n'])
        if f'h{n}' != sid:
            raise Malformed(f'{sid}: label says hadeeth {n}')
        kind = 'hadeeth'
        if m['fasl']:
            if m['fasl'] not in FASL_BY_EN:
                raise Malformed(f'{sid}: unknown faṣl {m["fasl"]!r}')
            fn_ = FASL_BY_EN[m['fasl']]
            if state['fasl'] and state['fasl'] != fn_:
                page.warn(f'{sid}: label says faṣl {fn_} but the last heading said faṣl {state["fasl"]}')
            state['fasl'] = fn_
        if state['fasl'] is None:
            page.warn(f'{sid}: no faṣl known yet')
            fasl = None
        else:
            fasl = {'n': state['fasl'], 'ar': FASL[state['fasl']][0], 'en': FASL[state['fasl']][1]}

    for c in cols.children:
        check_blank(cols, c)
    arts = cols.elements()
    bad = [a for a in arts if a.tag != 'article']
    if bad:
        raise Malformed(f'{sid}: unexpected {bad[0].where()} among the commentaries')
    coms = [parse_article(a, sid, page) for a in arts]
    keys = [c['key'] for c in coms]
    if sorted(keys) != sorted(KEY_ORDER) or len(keys) != 3:
        missing = [k for k in KEY_ORDER if k not in keys]
        dup = sorted({k for k in keys if keys.count(k) > 1})
        raise Malformed(f'{sid}: needs exactly 3 commentaries ({", ".join(KEY_ORDER)}); '
                        f'found {len(keys)}' + (f', missing {", ".join(missing)}' if missing else '')
                        + (f', duplicated {", ".join(dup)}' if dup else ''))
    if keys != KEY_ORDER:
        page.warn(f'{sid}: commentaries reordered from {keys}')
        coms.sort(key=lambda c: KEY_ORDER.index(c['key']))
    grading = [c['grading'] for c in coms if c['grading']]
    for g in grading:
        gm = re.match(r'^\[([0-9٠-٩]+)\]', g)
        gn = int(gm[1].translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')))
        if n is not None and gn != n:
            page.warn(f'{sid}: grading line names hadeeth {gn}')
    return {'id': sid, 'kind': kind, 'book': book_id, 'bab': state['bab'], 'fasl': fasl, 'n': n,
            'label': label, 'matn': matn, 'grading': grading, 'commentaries': coms}


def parse_page(html):
    """Returns (book, sections, footer, title, page). Raises Malformed."""
    page = Page()
    root = parse_tree(html)
    titles = find_all(root, lambda n: n.tag == 'title')
    title = plain_text(titles[0]) if titles else None
    wraps = find_all(root, lambda n: n.tag == 'div' and n.has('wrap'))
    if len(wraps) != 1:
        raise Malformed(f'expected one div.wrap, found {len(wraps)}')
    wrap = wraps[0]
    h1 = find_all(wrap, lambda n: n.tag == 'h1')
    if len(h1) != 1:
        raise Malformed('expected one <h1> with the kitāb name')
    kitab = plain_text(h1[0])
    norm = TASHKEEL.sub('', kitab)
    known = {TASHKEEL.sub('', k): v for k, v in KITAB.items()}
    if norm not in known:
        raise Malformed(f'unknown kitāb {kitab!r}: add a line for it to KITAB in {pathlib.Path(__file__).name}')
    book_id, book_en, book_url = known[norm]
    book = {'id': book_id, 'ar': kitab, 'en': book_en, 'url': book_url}

    nav_ids = None
    sub = None
    sections, footer = [], None
    state = {'fasl': None, 'bab': None}
    for c in wrap.children:
        check_blank(wrap, c)
    for el in wrap.elements():
        if el.tag == 'header':
            subs = find_all(el, lambda n: n.tag == 'p' and n.has('sub'))
            sub = plain_text(subs[0]) if subs else None
        elif el.tag == 'nav':
            nav_ids = [o.attrs.get('value') for o in find_all(el, lambda n: n.tag == 'option')]
        elif el.tag == 'section' and el.has('h'):
            sections.append(parse_section(el, state, book_id, page))
        elif el.tag == 'h2' and el.has('bab'):
            head = plain_text(el)
            if TASHKEEL.sub('', head) in {TASHKEEL.sub('', k) for k in FASL_BY_AR}:
                state['fasl'] = {TASHKEEL.sub('', k): v for k, v in FASL_BY_AR.items()}[TASHKEEL.sub('', head)]
            elif head.startswith('الفصل'):
                raise Malformed(f'unknown faṣl heading {head!r}')
            else:
                state['bab'] = {'ar': head, 'en': None}
                state['fasl'] = None
        elif el.tag == 'footer':
            if footer is not None:
                raise Malformed('more than one <footer>')
            footer = runs_of(el, {'b', 'rtl'}, 'footer')
        elif el.tag == 'script':
            pass                                    # never read, never run
        else:
            raise Malformed(f'unexpected {el.where()} in the page body')
    if not sections:
        raise Malformed('no sections found')
    if footer is None:
        raise Malformed('no <footer>: the page looks truncated')
    ids = [s['id'] for s in sections]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        raise Malformed('duplicate section ids: ' + ', '.join(dups))
    fn_ids = [f['id'] for s in sections for c in s['commentaries'] for f in c['footnotes']]
    fdups = sorted({i for i in fn_ids if fn_ids.count(i) > 1})
    if fdups:
        raise Malformed('duplicate footnote ids: ' + ', '.join(fdups))
    if nav_ids is not None and nav_ids != ids:
        missing = [i for i in nav_ids if i not in ids]
        extra = [i for i in ids if i not in nav_ids]
        raise Malformed('the page menu and the sections disagree'
                        + (f'; menu lists missing sections {", ".join(missing)}' if missing else '')
                        + (f'; sections not in the menu {", ".join(extra)}' if extra else '')
                        + ('' if missing or extra else '; order differs'))
    nums = [s['n'] for s in sections if s['n'] is not None]
    if nums != sorted(nums):
        raise Malformed('hadeeth numbers are out of order')
    gaps = sorted(set(range(nums[0], nums[-1] + 1)) - set(nums)) if nums else []
    if sub and nums:
        m = re.search(r'Up to hadeeth (\d+)', sub)
        if m and int(m[1]) != nums[-1]:
            page.warn(f'page header says up to {m[1]} but the last section is {nums[-1]}')
    book.update({'first': nums[0] if nums else None, 'last': nums[-1] if nums else None,
                 'count': len(sections)})
    return book, sections, footer, title, gaps, page


# --------------------------------------------------------------------------- diff + write

def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n'


def what_changed(old, new):
    parts = []
    for k in ('kind', 'book', 'bab', 'fasl', 'n', 'label', 'matn', 'grading'):
        if old.get(k) != new.get(k):
            parts.append(k)
    oc = {c['key']: c for c in old.get('commentaries', [])}
    for c in new['commentaries']:
        o = oc.get(c['key'])
        if o is None:
            parts.append(f'commentaries.{c["key"]}')
            continue
        for k in ('src', 'cite', 'paras', 'centered', 'editorial', 'footnotes', 'refs', 'grading'):
            if k == 'cite':
                if any(o.get(x) != c.get(x) for x in ('cite', 'work', 'vol', 'pages', 'pdf')):
                    parts.append(f'commentaries.{c["key"]}.cite')
            elif o.get(k) != c.get(k):
                parts.append(f'commentaries.{c["key"]}.{k}')
    if [c['key'] for c in old.get('commentaries', [])] != [c['key'] for c in new['commentaries']]:
        parts.append('commentaries')
    if not parts and old != new:
        parts.append('other')
    return parts


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def load_json(path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except ValueError as e:
        raise SystemExit(f'error: {path} is not valid JSON ({e}); fix or remove it first')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('saved', help='the saved artifact page (.html)')
    ap.add_argument('--check', action='store_true', help='validate and diff only; write nothing')
    ap.add_argument('--strict', action='store_true', help='treat gaps in hadeeth numbers as errors')
    ap.add_argument('--version', help='artifact version id (default: sha256[:12] of the page)')
    ap.add_argument('--url', help='artifact URL (default: from KITAB, else the previous sync)')
    ap.add_argument('--root', help='repo root (default: $MISHKAT_ROOT or the parent of tools/)')
    ap.add_argument('--no-build', action='store_true', help='do not run tools/build_mishkat_single.py')
    args = ap.parse_args(argv)

    root = pathlib.Path(args.root or os.environ.get('MISHKAT_ROOT') or
                        pathlib.Path(__file__).resolve().parent.parent).resolve()
    data_dir = root / 'mishkat' / 'data'
    sw_path = root / 'mishkat' / 'sw.js'

    src = pathlib.Path(args.saved)
    try:
        size = src.stat().st_size
    except OSError as e:
        print(f'error: cannot read {src}: {e}', file=sys.stderr)
        return 1
    if size > MAX_BYTES:
        print(f'error: {src} is {size / 1e6:.1f} MB; pages over 20 MB are rejected', file=sys.stderr)
        return 1
    raw = src.read_bytes()
    try:
        html = raw.decode('utf-8')
    except UnicodeDecodeError as e:
        print(f'error: {src} is not UTF-8 ({e})', file=sys.stderr)
        return 1
    sha = hashlib.sha256(raw).hexdigest()

    try:
        book, sections, footer, title, gaps, page = parse_page(html)
    except Malformed as e:
        print(f'error: {e}\nNothing was written.', file=sys.stderr)
        return 1
    for w in page.warnings:
        print('WARNING:', w)
    if gaps:
        msg = 'hadeeth numbers are not contiguous; missing ' + ', '.join(map(str, gaps))
        if args.strict:
            print(f'error: {msg}\nNothing was written.', file=sys.stderr)
            return 1
        print('WARNING:', msg)

    # ---- diff
    book_path = data_dir / f'{book["id"]}.json'
    meta_path = data_dir / 'meta.json'
    old = load_json(book_path) or []
    meta = load_json(meta_path)
    new_text = dumps(sections)
    om = {s['id']: s for s in old}
    nm = {s['id']: s for s in sections}
    added = [i for i in nm if i not in om]
    removed = [i for i in om if i not in nm]
    changed = [{'id': i, 'what': what_changed(om[i], nm[i])} for i in nm if i in om and om[i] != nm[i]]
    old_entry = next((b for b in (meta or {}).get('books', []) if b['id'] == book['id']), None)
    old_footer = old_entry.get('footer', meta.get('footer')) if old_entry else None
    footer_changed = old_entry is not None and old_footer != footer

    content_same = (not added and not removed and not changed and not footer_changed
                    and old_entry is not None and book_path.exists()
                    and book_path.read_text(encoding='utf-8') == new_text)
    if content_same:
        print('Nothing to update.')
        return 0

    print(f'{len(sections)} sections: {len(added)} added, {len(removed)} removed, {len(changed)} changed')
    if added:
        print('  added: ' + ', '.join(added))
    if removed:
        print('  removed: ' + ', '.join(removed))
    if changed:
        print('  changed: ' + ', '.join(f'{c["id"]} ({", ".join(c["what"])})' for c in changed))
    if footer_changed:
        print('  footer changed')
    if old_entry is None and not added:
        print('  book entry missing from meta.json; it will be added')

    # sw.js is checked before anything is written
    sw_text = sw_path.read_text(encoding='utf-8') if sw_path.exists() else None
    if sw_text is not None and not VERSION_RE.search(sw_text):
        print(f"error: {sw_path} has no line like const VERSION = 'mishkat-vX.Y.Z';\nNothing was written.",
              file=sys.stderr)
        return 1

    if args.check:
        print('(--check: nothing written)')
        return 0

    # ---- meta
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    version = args.version or sha[:12]
    url = args.url or book['url'] or (old_entry or {}).get('source', {}).get('url') \
        or ((meta or {}).get('source') or {}).get('url')
    source = {'title': title, 'url': url, 'version': version, 'sha256': sha}
    entry = {'id': book['id'], 'file': book_path.name, 'ar': book['ar'], 'en': book['en'],
             'first': book['first'], 'last': book['last'], 'count': book['count'],
             'source': source, 'footer': footer}
    books = [b for b in (meta or {}).get('books', []) if b['id'] != book['id']] + [entry]
    books.sort(key=lambda b: (b['first'] is None, b['first'] or 0, b['id']))
    rev = (meta or {}).get('rev', 0) + 1
    log = {'rev': rev, 'at': now, 'version': version, 'book': book['id'],
           'added': added, 'removed': removed, 'changed': changed}
    if footer_changed:
        log['footer'] = True
    new_meta = {'schema': SCHEMA, 'rev': rev, 'syncedAt': now, 'source': source, 'books': books,
                'footer': footer,
                'changelog': ([log] + (meta or {}).get('changelog', []))[:CHANGELOG_CAP]}

    atomic_write(book_path, new_text)
    atomic_write(meta_path, dumps(new_meta))
    print(f'Wrote {book_path.relative_to(root)} and {meta_path.relative_to(root)} (rev {rev}, version {version})')

    if sw_text is None:
        print(f'WARNING: {sw_path.relative_to(root)} does not exist yet; VERSION not bumped')
    else:
        v = VERSION_RE.search(sw_text)
        nv = f'mishkat-v{v[1]}.{int(v[2]) + 1}.0'
        atomic_write(sw_path, sw_text.replace(v[0], f"const VERSION = '{nv}';", 1))
        print('Service worker version ->', nv)

    build = root / 'tools' / 'build_mishkat_single.py'
    if args.no_build:
        pass
    elif not build.exists():
        print(f'WARNING: {build.relative_to(root)} does not exist yet; single-file build skipped')
    else:
        env = dict(os.environ, MISHKAT_ROOT=str(root))
        r = subprocess.run([sys.executable, str(build)], cwd=root, env=env)
        if r.returncode:
            print(f'error: {build.name} failed (exit {r.returncode}); data was written', file=sys.stderr)
            return r.returncode
    return 0


if __name__ == '__main__':
    sys.exit(main())
