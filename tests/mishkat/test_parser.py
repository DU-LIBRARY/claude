"""Tests for tools/sync_mishkat_from_artifact.py.

Run: python3 -m unittest discover -s tests/mishkat -p 'test_*.py'

Fixtures are saved copies of the Kitāb al-Nikāḥ artifact page: version 1793730765-58e3 (intro +
3080–3092; override with $MISHKAT_ARTIFACT) and 1793793535-584e (adds faṣl 3, bāb 1 and 3093–3100).
The tool-run tests use the first one.
The round-trip tests extract the page independently with BeautifulSoup (test-only dependency; they
are skipped if bs4 is missing) and compare it with text re-rendered from the parser's JSON segments.
"""
import collections, hashlib, importlib.util, json, os, pathlib, re, shutil, subprocess, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
TOOL = REPO / 'tools' / 'sync_mishkat_from_artifact.py'
FIXTURE = pathlib.Path(os.environ.get('MISHKAT_ARTIFACT') or HERE / 'fixtures' / 'nikah-artifact.html')

try:
    from bs4 import BeautifulSoup
except ImportError:                                   # pragma: no cover
    BeautifulSoup = None

sys.dont_write_bytecode = True                        # keep tools/ free of __pycache__
spec = importlib.util.spec_from_file_location('sync_mishkat', TOOL)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

WS = re.compile(r'[ \t\n\r\f]+')
KEYS = {'مرقاة المفاتيح': 'mirqat', 'شرح الطيبي': 'tibi', 'لمعات التنقيح': 'lamaat'}


def norm(s):
    return WS.sub(' ', s).strip()


def text(runs):
    return norm(''.join(r.get('t', r.get('mark', '')) for r in runs))


def nows(s):
    return WS.sub('', s)


FIXTURES = [FIXTURE, HERE / 'fixtures' / 'nikah-artifact-1793793535-584e.html', HERE / 'fixtures' / 'nikah-artifact-latest.html']  # latest: replaced on every sync
HTML = FIXTURE.read_text(encoding='utf-8')
BOOK, SECTIONS, FOOTER, TITLE, GAPS, PAGE = sync.parse_page(HTML)
FASL_EN = {'الفصل الأول': 'al-Faṣl al-Awwal', 'الفصل الثاني': 'al-Faṣl al-Thānī', 'الفصل الثالث': 'al-Faṣl al-Thālith'}
ORD = {'الأول': 1, 'الثاني': 2, 'الثالث': 3}
AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')


class RoundTripBase:
    """Mixed into one TestCase per fixture; everything is derived from the page, not hard-coded."""
    path = None

    @classmethod
    def setUpClass(cls):
        cls.html = cls.path.read_text(encoding='utf-8')
        cls.book, cls.sections, cls.footer, cls.title, cls.gaps, cls.page = sync.parse_page(cls.html)
        cls.soup = BeautifulSoup(cls.html, 'html.parser')
        cls.secs = cls.soup.select('section.h')
        cls.by_id = {s['srcId']: s for s in cls.sections}       # keyed by the page's own ids

    def test_sections_and_book(self):
        self.assertEqual([s['id'] for s in self.secs], [s['srcId'] for s in self.sections])
        # hadeeth ids are global ("h<n>"); every other section is namespaced by book
        for page_sec, s in zip(self.secs, self.sections):
            pid = page_sec['id']
            if re.fullmatch(r'h\d+', pid):
                self.assertEqual((s['id'], s['kind'], s['n']), (pid, 'hadeeth', int(pid[1:])))
            else:
                self.assertEqual(s['id'], 'nikah-' + pid)
                self.assertIsNone(s['n'])
                self.assertEqual(s['kind'], 'intro' if pid == 'intro' else 'bab')
        self.assertEqual((self.sections[0]['id'], self.sections[0]['srcId']), ('nikah-intro', 'intro'))
        nums = [int(x['id'][1:]) for x in self.secs if re.fullmatch(r'h\d+', x['id'])]
        self.assertEqual(nums, list(range(nums[0], nums[-1] + 1)))
        self.assertEqual(self.book['id'], 'nikah')
        self.assertEqual((self.book['first'], self.book['last'], self.book['count']),
                         (nums[0], nums[-1], len(self.secs)))
        m = re.search(r'Up to hadeeth (\d+)', self.soup.select_one('p.sub').get_text())
        self.assertEqual(int(m[1]), nums[-1])
        self.assertEqual(self.gaps, [])
        self.assertEqual(self.page.warnings, [])

    def test_bab_and_fasl_assignment(self):
        """Independent walk of the page: h2 headings set faṣl or bāb, labels may name the faṣl."""
        fasl, bab = None, None
        wrap = self.soup.select_one('div.wrap')
        for el in wrap.find_all(['h2', 'section'], recursive=False):
            if el.name == 'h2':
                t = norm(el.get_text())
                m = re.match(r'^\((\S+)\) (باب .+)$', t)
                if m:
                    bab, fasl = {'n': int(m[1].translate(AR_DIGITS)), 'ar': m[2], 'en': None}, None
                else:
                    self.assertIn(t, FASL_EN)
                    fasl = ORD[t.split()[1]]
                continue
            s = self.by_id[el['id']]
            label = norm(el.select_one('p.num').get_text())
            lm = re.search(r'· (al-Faṣl .+)$', label)
            if lm:
                fasl = {v: ORD[k.split()[1]] for k, v in FASL_EN.items()}[lm[1]]
            self.assertEqual(s['bab'], bab, s['id'])
            if s['kind'] == 'hadeeth':
                self.assertIsNotNone(fasl, s['id'])
                self.assertEqual(s['fasl']['n'], fasl, s['id'])
                self.assertEqual(s['fasl']['en'], list(FASL_EN.values())[fasl - 1])
            else:
                self.assertIsNone(s['fasl'], s['id'])
        self.assertEqual(self.by_id['h3080']['label'], 'Hadeeth 3080 · al-Faṣl al-Awwal')
        self.assertEqual(self.by_id['h3089']['fasl']['ar'], 'الفصل الثاني')

    def test_matn_and_label(self):
        for sec in self.secs:
            s = self.by_id[sec['id']]
            self.assertEqual(norm(sec.select_one('.matn p.num').get_text()), s['label'])
            ar = sec.select_one('.matn p.ar')
            self.assertEqual(norm(ar.get_text()), text(s['matn']), sec['id'])
            self.assertEqual([norm(x.get_text()) for x in ar.select('span.mref')],
                             [r['t'] for r in s['matn'] if r.get('ref')], sec['id'])

    def test_every_article(self):
        totals = collections.Counter()
        for sec in self.secs:
            s = self.by_id[sec['id']]
            arts = sec.select('div.cols > article')
            self.assertEqual(len(arts), 3)
            self.assertEqual([c['key'] for c in s['commentaries']], ['mirqat', 'tibi', 'lamaat'])
            coms = {c['key']: c for c in s['commentaries']}
            for art in arts:
                key = KEYS[norm(art.h3.get_text())]
                c = coms[key]
                where = f'{sec["id"]}/{key}'
                self.assertEqual(c['src'], norm(art.h3.get_text()))
                srcs = [norm(p.get_text()) for p in art.find_all('p', class_='src')]
                # cite and PDF page reference preserved
                self.assertEqual(c['cite'], srcs[0], where)
                m = re.search(r'PDF p\. (\S+)$', srcs[0])
                self.assertEqual(c['pdf'], m[1], where)
                self.assertIn(f'{c["vol"]}/{c["pages"]}', srcs[0])
                self.assertEqual([text(e) for e in c['editorial']], srcs[1:], where)
                for e, p in zip(c['editorial'], art.find_all('p', class_='src')[1:]):
                    self.assertEqual([r['t'] for r in e if r.get('rtl')],
                                     [x.get_text() for x in p.select('span[dir=rtl]')])
                paras = art.find_all('p', class_='ar')
                self.assertEqual([norm(p.get_text()) for p in paras], [text(p) for p in c['paras']], where)
                self.assertEqual([i for i, p in enumerate(paras) if 'center' in (p.get('style') or '')],
                                 c['centered'], where)
                # bold runs
                for p, jp in zip(paras, c['paras']):
                    self.assertEqual(nows(''.join(b.get_text() for b in p.find_all('b'))),
                                     nows(''.join(r['t'] for r in jp if r.get('b'))), where)
                # footnotes: none lost, all resolvable, bodies identical
                sups = art.select('sup.fn')
                fn_runs = [r for p in c['paras'] for r in p if 'fn' in r]
                lis = art.select('aside.notes li')
                self.assertEqual(len(sups), len(fn_runs), where)
                self.assertEqual(len(fn_runs), len(c['footnotes']), where)
                self.assertEqual(len(lis), len(c['footnotes']), where)
                # footnote ids follow the section id (n-intro-T-1 -> n-nikah-intro-T-1)
                ns = lambda i: i.replace(f'n-{s["srcId"]}-', f'n-{s["id"]}-', 1)
                self.assertEqual([ns(sp.a['href'][1:]) for sp in sups], [r['fn'] for r in fn_runs])
                self.assertEqual([norm(sp.get_text()) for sp in sups], [r['mark'] for r in fn_runs])
                self.assertEqual([ns(li['id']) for li in lis], [f['id'] for f in c['footnotes']])
                self.assertEqual([norm(li.get_text()) for li in lis], [text(f['body']) for f in c['footnotes']])
                ids = {f['id'] for f in c['footnotes']}
                self.assertTrue(all(r['fn'] in ids for r in fn_runs))
                # reference and grading lines
                refs = [norm(p.get_text()) for p in art.select('aside.notes p.ref')]
                self.assertEqual([text(r) for r in c['refs']], refs, where)
                grades = [r for r in refs if re.match(r'^\[[٠-٩]+\]', r)]
                self.assertEqual(c['grading'], grades[0] if grades else None, where)
                for g in grades:
                    self.assertIn(g, s['grading'])
                # nothing else in the article: character multiset of visible text matches
                visible = collections.Counter(nows(art.get_text()))
                rebuilt = collections.Counter(nows(c['src'] + c['cite']
                                                   + ''.join(text(e) for e in c['editorial'])
                                                   + ''.join(text(p) for p in c['paras'])
                                                   + ''.join(text(f['body']) for f in c['footnotes'])
                                                   + ''.join(text(r) for r in c['refs'])))
                self.assertEqual(visible, rebuilt, where)
                totals['sup'] += len(sups)
                totals['li'] += len(lis)
                totals['fn'] += len(c['footnotes'])
                totals['b'] += len(art.find_all('b'))
        self.assertEqual(totals['sup'], len(self.soup.select('sup.fn')))
        self.assertEqual(totals['li'], len(self.soup.select('aside.notes li')))
        self.assertEqual(totals['sup'], totals['fn'])
        self.assertEqual(totals['fn'], sum(len(c['footnotes']) for s in self.sections
                                           for c in s['commentaries']))
        self.assertGreater(totals['fn'], 0)
        self.assertGreater(totals['b'], 0)

    def test_grading_lines(self):
        page_grades = [norm(p.get_text()) for p in self.soup.select('p.ref')
                       if re.match(r'^\[[٠-٩]+\]', norm(p.get_text()))]
        self.assertTrue(page_grades)
        self.assertEqual(page_grades, [g for s in self.sections for g in s['grading']])
        # each grading sits under the section whose number it names
        for sec in self.secs:
            for p in sec.select('p.ref'):
                t = norm(p.get_text())
                if re.match(r'^\[[٠-٩]+\]', t):
                    self.assertIn(t, self.by_id[sec['id']]['grading'])
        self.assertEqual(self.by_id['h3092']['grading'], ['[٣٠٩٢] ضعيف لإرساله.'])
        self.assertEqual(self.by_id['h3089']['grading'], ['[٣٠٨٩] قال الشيخ: وإسناده صحيح.'])
        total_refs = sum(len(c['refs']) for s in self.sections for c in s['commentaries'])
        self.assertEqual(total_refs, len(self.soup.select('p.ref')))

    def test_footer_and_title(self):
        self.assertEqual(text(self.footer), norm(self.soup.footer.get_text()))
        self.assertEqual(self.title, 'Mishkāt Kitāb al-Nikāḥ')

    def test_segments_well_formed(self):
        def check(runs):
            self.assertTrue(runs)
            for r in runs:
                self.assertTrue(('t' in r) != ('fn' in r), r)
                self.assertTrue(set(r) <= {'t', 'b', 'ref', 'rtl', 'fn', 'mark'}, r)
                if 't' in r:
                    self.assertTrue(r['t'])
                    self.assertNotIn('  ', r['t'])
                    self.assertNotIn('<', r['t'])
        for s in self.sections:
            check(s['matn'])
            for c in s['commentaries']:
                for p in c['paras'] + c['editorial'] + c['refs'] + [f['body'] for f in c['footnotes']]:
                    check(p)


@unittest.skipUnless(BeautifulSoup, 'bs4 not installed (test-only dependency)')
class RoundTripFirstPage(RoundTripBase, unittest.TestCase):
    path = FIXTURES[0]


@unittest.skipUnless(BeautifulSoup, 'bs4 not installed (test-only dependency)')
class RoundTripSecondPage(RoundTripBase, unittest.TestCase):
    path = FIXTURES[1]

    def test_bab_one_and_third_fasl(self):
        b = self.by_id
        for n in range(3093, 3098):
            self.assertEqual(b[f'h{n}']['fasl']['n'], 3, n)
            self.assertEqual(b[f'h{n}']['fasl']['en'], 'al-Faṣl al-Thālith')
            self.assertIsNone(b[f'h{n}']['bab'], n)
        bab = {'n': 1, 'ar': 'باب النظر إلى المخطوبة وبيان العورات', 'en': None}
        s = b['b1']
        self.assertEqual((s['id'], s['srcId'], s['kind'], s['n'], s['fasl']), ('nikah-b1', 'b1', 'bab', None, None))
        self.assertEqual(s['bab'], bab)
        self.assertEqual(s['label'], 'Opening of Bāb 1')
        self.assertEqual(text(s['matn']), bab['ar'])
        self.assertEqual([f['id'] for c in s['commentaries'] for f in c['footnotes']], ['n-nikah-b1-L-1'])
        self.assertEqual([r['fn'] for c in s['commentaries'] for p in c['paras'] for r in p if 'fn' in r],
                         ['n-nikah-b1-L-1'])
        for n in (3098, 3099, 3100):
            self.assertEqual(b[f'h{n}']['bab'], bab, n)
            self.assertEqual(b[f'h{n}']['fasl']['n'], 1, n)
        self.assertIsNone(b['h3092']['bab'])
        self.assertEqual([x['id'] for x in self.sections][-4:], ['nikah-b1', 'h3098', 'h3099', 'h3100'])

    def test_first_page_sections_unchanged(self):
        """The new page only appends: every section of the earlier page is identical in it."""
        mine = {s['id']: s for s in self.sections}
        for s in SECTIONS:
            self.assertEqual(mine[s['id']], s, s['id'])


def snapshot(root):
    out = {}
    for p in sorted(pathlib.Path(root).rglob('*')):
        if p.is_file() and '__pycache__' not in p.parts:
            out[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


class ToolRuns(unittest.TestCase):
    """Runs the tool as a subprocess against a temporary copy of mishkat/ and tools/."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix='mishkat-test-'))
        self.root = self.tmp / 'repo'
        self.root.mkdir()
        shutil.copytree(REPO / 'mishkat', self.root / 'mishkat',
                        ignore=shutil.ignore_patterns('data'))
        shutil.copytree(REPO / 'tools', self.root / 'tools', ignore=shutil.ignore_patterns('__pycache__'))
        sw = self.root / 'mishkat' / 'sw.js'
        if not sw.exists():
            sw.write_text("const VERSION = 'mishkat-v1.0.0';\nconst ASSETS = [];\n", encoding='utf-8')
        # stub the single-file build so the test checks it is triggered (only on change)
        (self.root / 'tools' / 'build_mishkat_single.py').write_text(
            'import os, pathlib\n'
            'p = pathlib.Path(os.environ["MISHKAT_ROOT"]) / "build-marker"\n'
            'p.write_text(p.read_text() + "x" if p.exists() else "x")\n'
            'print("BUILD-RAN")\n', encoding='utf-8')
        self.html = self.tmp / 'page.html'
        self.html.write_text(HTML, encoding='utf-8')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_tool(self, *args, html=None):
        env = dict(os.environ, MISHKAT_ROOT=str(self.root))
        env.pop('PYTHONUNBUFFERED', None)                   # stdout block-buffered, as in a pipe
        r = subprocess.run([sys.executable, str(self.root / 'tools' / TOOL.name), str(html or self.html), *args],
                           capture_output=True, text=True, env=env)
        return r

    def version(self):
        sw = (self.root / 'mishkat' / 'sw.js').read_text(encoding='utf-8')
        return re.search(r"mishkat-v[\d.]+", sw)[0]

    def meta(self):
        return json.loads((self.root / 'mishkat' / 'data' / 'meta.json').read_text(encoding='utf-8'))

    def marker(self):
        p = self.root / 'build-marker'
        return p.read_text() if p.exists() else ''

    def test_idempotent_then_one_change(self):
        v0 = self.version()
        r1 = self.run_tool('--version', 'test-1')
        self.assertEqual(r1.returncode, 0, r1.stderr)
        self.assertIn('14 sections: 14 added, 0 removed, 0 changed', r1.stdout)
        # summary, writes and VERSION bump are printed before the build's own output
        self.assertLess(r1.stdout.index('14 sections:'), r1.stdout.index('BUILD-RAN'))
        self.assertLess(r1.stdout.index('Service worker version'), r1.stdout.index('BUILD-RAN'))
        v1 = self.version()
        self.assertNotEqual(v0, v1)
        self.assertEqual(self.marker(), 'x')
        m1 = self.meta()
        self.assertEqual(m1['rev'], 1)
        for f in ('nikah.json', 'meta.json'):                # not mkstemp's 0600
            self.assertTrue((self.root / 'mishkat' / 'data' / f).stat().st_mode & 0o004, f)
        self.assertEqual(m1['source']['version'], 'test-1')
        self.assertEqual([b['id'] for b in m1['books']], ['nikah'])
        snap = snapshot(self.root)

        r2 = self.run_tool('--version', 'test-2')
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertEqual(r2.stdout.strip(), 'Nothing to update.')
        self.assertEqual(self.version(), v1)
        self.assertEqual(snapshot(self.root), snap)          # byte-identical, no rebuild

        mutated = self.tmp / 'mutated.html'
        mutated.write_text(HTML.replace('أي امتحاناً وبلية', 'أي امتحاناً وبليّة', 1), encoding='utf-8')
        r3 = self.run_tool(html=mutated)
        self.assertEqual(r3.returncode, 0, r3.stderr)
        self.assertIn('14 sections: 0 added, 0 removed, 1 changed', r3.stdout)
        self.assertIn('changed: h3085 (commentaries.mirqat.paras)', r3.stdout)
        major, minor, _ = map(int, v1.split('-v')[1].split('.'))
        self.assertEqual(self.version(), f'mishkat-v{major}.{minor + 1}.0')
        m3 = self.meta()
        self.assertEqual(m3['rev'], 2)
        self.assertEqual(m3['changelog'][0]['rev'], 2)
        self.assertEqual(m3['changelog'][0]['changed'], [{'id': 'h3085', 'what': ['commentaries.mirqat.paras']}])
        self.assertEqual(m3['changelog'][1]['rev'], 1)
        self.assertEqual(m3['source']['version'], hashlib.sha256(mutated.read_bytes()).hexdigest()[:12])
        self.assertEqual(self.marker(), 'xx')
        data = (self.root / 'mishkat' / 'data' / 'nikah.json').read_text(encoding='utf-8')
        self.assertTrue(data.endswith('\n') and 'وبليّة' in data and '\\u' not in data)

    def test_check_writes_nothing(self):
        before = snapshot(self.root)
        r = self.run_tool('--check')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('14 added', r.stdout)
        self.assertEqual(snapshot(self.root), before)

    def webarchive(self, html_text, version='1793999999-abcd'):
        """A Safari .webarchive like the iPhone's "Save to Files": claude.ai page + the artifact frame."""
        import plistlib
        frame = {'WebResourceURL': f'https://c1f8bf44-7350-48e6-a68c-60d26754bf9a.frame.claudeusercontent.com/_f/{version}/',
                 'WebResourceMIMEType': 'text/html', 'WebResourceTextEncodingName': 'UTF-8',
                 'WebResourceData': html_text.encode('utf-8')}
        arc = {'WebMainResource': {'WebResourceURL': 'https://claude.ai/artifact/x', 'WebResourceMIMEType': 'text/html',
                                   'WebResourceData': b'<!doctype html><title>claude.ai</title>'},
               'WebSubframeArchives': [{'WebMainResource': frame}]}
        p = self.tmp / 'page.webarchive'
        p.write_bytes(plistlib.dumps(arc, fmt=plistlib.FMT_BINARY))
        return p

    def test_webarchive_with_safari_phone_links(self):
        cite = 'Mirqāt 6/242 · PDF p. 243'
        self.assertIn(cite, HTML)
        safari = HTML.replace(cite, 'Mirqāt 6/242 · PDF p. <a href="tel:243">243</a>', 1)
        r = self.run_tool(html=self.webarchive(safari))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('from a .webarchive (version 1793999999-abcd)', r.stdout)
        self.assertIn('14 sections: 14 added, 0 removed, 0 changed', r.stdout)
        self.assertEqual(self.meta()['source']['version'], '1793999999-abcd')
        r2 = self.run_tool('--version', '1793999999-abcd')            # the plain page gives the same data
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertIn('Nothing to update.', r2.stdout)

    def test_webarchive_other_links_still_rejected(self):
        cite = 'Mirqāt 6/242 · PDF p. 243'
        for link in ('<a href="https://example.com/">243</a>', '<a href="tel:243"><b>243</b></a>'):
            bad = HTML.replace(cite, 'Mirqāt 6/242 · PDF p. ' + link, 1)
            before = snapshot(self.root)
            r = self.run_tool(html=self.webarchive(bad))
            self.assertNotEqual(r.returncode, 0, r.stdout)
            self.assertIn('unexpected <a', r.stderr)
            self.assertEqual(snapshot(self.root), before)

    def test_not_a_webarchive(self):
        p = self.tmp / 'junk.webarchive'
        p.write_bytes(b'bplist00garbage')
        r = self.run_tool(html=p)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('Nothing was written.', r.stderr)

    def test_second_book_is_added_not_overwritten(self):
        self.assertEqual(self.run_tool().returncode, 0)
        # another book's page holding only its opening section
        other = HTML.replace('<h1 dir="rtl">كتاب النكاح</h1>', '<h1 dir="rtl">كتاب البيوع</h1>')
        other = re.sub(r'<section class="h" id="h\d+">.*?</section>', '', other, flags=re.S)
        other = re.sub(r'<option value="h\d+">\d+</option>', '', other)
        other = re.sub(r'<h2 class="bab"[^>]*>.*?</h2>', '', other)
        p = self.tmp / 'other.html'
        p.write_text(other, encoding='utf-8')
        r = self.run_tool(html=p)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('added: buyu-intro', r.stdout)
        m = self.meta()
        self.assertEqual(sorted(b['id'] for b in m['books']), ['buyu', 'nikah'])
        data = self.root / 'mishkat' / 'data'
        nikah = json.loads((data / 'nikah.json').read_text(encoding='utf-8'))
        buyu = json.loads((data / 'buyu.json').read_text(encoding='utf-8'))
        self.assertEqual(len(nikah), 14)
        self.assertEqual([s['id'] for s in buyu], ['buyu-intro'])
        self.assertEqual(buyu[0]['srcId'], 'intro')
        self.assertTrue(all(f['id'].startswith('n-buyu-intro-')
                            for c in buyu[0]['commentaries'] for f in c['footnotes']))
        # syncing nikah again is still a no-op
        self.assertEqual(self.run_tool().stdout.strip(), 'Nothing to update.')

    def test_id_collision_across_books_aborts(self):
        self.assertEqual(self.run_tool().returncode, 0)
        other = HTML.replace('<h1 dir="rtl">كتاب النكاح</h1>', '<h1 dir="rtl">كتاب البيوع</h1>')
        p = self.tmp / 'other.html'
        p.write_text(other, encoding='utf-8')
        before = snapshot(self.root)
        r = self.run_tool(html=p)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ids already used by book 'nikah': h3080", r.stderr)
        self.assertIn('Nothing was written.', r.stderr)
        self.assertEqual(snapshot(self.root), before)

    def test_gap_is_warning_unless_strict(self):
        gapped = re.sub(r'<section class="h" id="h3085">.*?</section>', '', HTML, flags=re.S)
        gapped = gapped.replace('<option value="h3085">3085</option>', '')
        p = self.tmp / 'gap.html'
        p.write_text(gapped, encoding='utf-8')
        r = self.run_tool('--check', html=p)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('WARNING: hadeeth numbers are not contiguous; missing 3085', r.stdout)
        before = snapshot(self.root)
        r = self.run_tool('--strict', html=p)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(snapshot(self.root), before)

    # ---- malformed input: non-zero exit and nothing written (both on a fresh tree and a synced one)
    def assert_rejected(self, html_text, needle):
        p = self.tmp / 'bad.html'
        p.write_text(html_text, encoding='utf-8')
        for _ in ('fresh', 'synced'):
            before = snapshot(self.root)
            r = self.run_tool(html=p)
            self.assertNotEqual(r.returncode, 0, r.stdout)
            self.assertIn(needle, r.stderr)
            self.assertIn('Nothing was written.', r.stderr)
            self.assertEqual(snapshot(self.root), before)
            self.assertEqual(self.run_tool().returncode, 0)       # now repeat against synced data

    def test_missing_commentary(self):
        bad = re.sub(r'(<section class="h" id="h3083">.*?)<article><h3>لمعات التنقيح</h3>.*?</article>',
                     r'\1', HTML, count=1, flags=re.S)
        self.assertNotEqual(bad, HTML)
        self.assert_rejected(bad, 'h3083: needs exactly 3 commentaries')

    def test_empty_commentary_without_note(self):
        # "No comment on this hadeeth." makes an empty commentary legitimate; with no note at all it is broken
        def strip(m):
            sec = re.sub(r'<p class="ar">.*?</p>', '', m.group(0), flags=re.S)
            return re.sub(r'<aside class="notes".*?</aside>', '', sec, flags=re.S)
        bad = re.sub(r'<section class="h" id="h3083">.*?</section>', strip, HTML, count=1, flags=re.S)
        self.assertNotEqual(bad, HTML)
        self.assert_rejected(bad, 'commentary has no paragraphs and no editorial note')

    def test_dangling_footnote_ref(self):
        bad = HTML.replace('href="#n-h3080-M-1"', 'href="#n-h3080-M-9"', 1)
        self.assert_rejected(bad, 'footnote reference(s) with no footnote: n-h3080-M-9')

    def test_orphan_footnote(self):
        bad = HTML.replace('<sup class="fn"><a href="#n-h3080-T-1">١</a></sup>', '', 1)
        self.assert_rejected(bad, 'never referenced (orphans): n-h3080-T-1')

    def test_script_inside_paragraph(self):
        bad = HTML.replace('أي امتحاناً وبلية', 'أي امتحاناً<script>alert(1)</script> وبلية', 1)
        self.assert_rejected(bad, 'unexpected <script')

    def test_unknown_inline_tag(self):
        bad = HTML.replace('أي امتحاناً وبلية', 'أي <i>امتحاناً</i> وبلية', 1)
        self.assert_rejected(bad, 'unexpected <i')

    def test_deep_nesting(self):
        deep = '<div>' * 200000 + '</div>' * 200000
        bad = HTML.replace('<footer>', deep + '<footer>', 1)
        self.assert_rejected(bad, 'nested more than 200 deep')
        with self.assertRaises(sync.Malformed):              # in-process too: no RecursionError
            sync.parse_page(bad)

    def test_bidi_override_rejected(self):
        for ch in ('\u202e', '\u202a', '\u2066', '\u2069'):
            bad = HTML.replace('أي امتحاناً وبلية', 'أي امتحاناً' + ch + ' وبلية', 1)
            with self.assertRaises(sync.Malformed) as cm:
                sync.parse_page(bad)
            self.assertIn(f'U+{ord(ch):04X}', str(cm.exception))
            self.assertIn('h3085/mirqat', str(cm.exception))
        bad = HTML.replace('أي امتحاناً وبلية', 'أي امتحاناً\u202e وبلية', 1)
        self.assert_rejected(bad, 'bidi control character U+202E')

    def test_bidi_marks_kept(self):
        # U+200F is used by the data around "/"; U+200E and U+061C are allowed too
        self.assertIn('\u200f', json.dumps(SECTIONS, ensure_ascii=False))
        ok = HTML.replace('أي امتحاناً وبلية', 'أي امتحاناً\u200e\u061c وبلية', 1)
        sync.parse_page(ok)

    def test_tashkeel_matches_app(self):
        for cp in [*range(0x610, 0x61B), *range(0x64B, 0x660), 0x670, *range(0x6D6, 0x6EE), 0x640]:
            self.assertEqual(sync.TASHKEEL.sub('', 'ك' + chr(cp) + 'ت'), 'كت', hex(cp))
        self.assertEqual(sync.TASHKEEL.sub('', 'كِتَابُ النِّكَاحِ'), 'كتاب النكاح')

    def test_update_to_second_page(self):
        self.assertEqual(self.run_tool('--version', 'v1').returncode, 0)
        r = self.run_tool('--version', 'v2', html=FIXTURES[1])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('23 sections: 9 added, 0 removed, 0 changed', r.stdout)
        self.assertIn('added: h3093, h3094, h3095, h3096, h3097, nikah-b1, h3098, h3099, h3100', r.stdout)
        m = self.meta()
        self.assertEqual((m['rev'], m['books'][0]['last'], m['books'][0]['count']), (2, 3100, 23))
        self.assertEqual(self.run_tool('--version', 'v2', html=FIXTURES[1]).stdout.strip(), 'Nothing to update.')

    def test_bab_opening_without_heading(self):
        second = FIXTURES[1].read_text(encoding='utf-8')
        bad = second.replace('<h2 class="bab" dir="rtl">(١) باب النظر إلى المخطوبة وبيان العورات</h2>', '', 1)
        self.assertNotEqual(bad, second)
        self.assert_rejected(bad, 'b1: bāb opening without a matching')

    def test_unrecognised_heading(self):
        bad = HTML.replace('<h2 class="bab" dir="rtl">الفصل الثاني</h2>', '<h2 class="bab" dir="rtl">عنوان آخر</h2>', 1)
        self.assert_rejected(bad, 'unrecognised heading')

    def test_truncated(self):
        self.assert_rejected(HTML[:len(HTML) // 2], 'truncated')

    def test_truncated_at_section_boundary(self):
        cut = HTML.index('<section class="h" id="h3090">')
        self.assert_rejected(HTML[:cut] + '</div></body></html>', 'truncated')

    def test_unknown_kitab(self):
        bad = HTML.replace('<h1 dir="rtl">كتاب النكاح</h1>', '<h1 dir="rtl">كتاب مجهول</h1>')
        self.assert_rejected(bad, 'unknown kitāb')

    def test_unparseable_cite(self):
        bad = HTML.replace('Mirqāt 6/242 · PDF p. 243', 'Mirqāt six', 1)
        self.assert_rejected(bad, 'cannot parse citation')

    def test_oversized(self):
        p = self.tmp / 'huge.html'
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(HTML)
            fh.write(' ' * (21 * 1024 * 1024))
        before = snapshot(self.root)
        r = self.run_tool(html=p)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('over 20 MB', r.stderr)
        self.assertEqual(snapshot(self.root), before)


if __name__ == '__main__':
    unittest.main()
