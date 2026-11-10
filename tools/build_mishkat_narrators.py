#!/usr/bin/env python3
"""Build mishkat/data/narrators.json from tools/mishkat_narrators_map.py and app/data/ikmal.json.

  python3 tools/build_mishkat_narrators.py [--check]

Validates before writing anything (exit 1 on any problem):
  * every hadeeth in every book listed in mishkat/data/meta.json has an entry in HADEETH
  * every key used is in PEOPLE, every al-Ikmāl number exists in ikmal.json
  * each named narrator appears in the opening of that hadeeth's matn (a guard against slips in
    the hand-made map); mismatches are listed and abort the build.

Output (schema 1):
  { "schema": 1,
    "people":  { key: { "n": 510 | null, "as": "عبد الله بن مسعود", "note": str | null, "check": bool } },
    "hadeeth": { "h3080": [key, …] },          // isnād order
    "ikmal":   { "510": { …the full al-Ikmāl entry, exactly as in app/data/ikmal.json…,
                          "id": "510" } } }   // plus "id": the entry's link id in al-Ikmāl (app/#n<id>)

Standard library only.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import mishkat_narrators_map as M  # noqa: E402

DIAC = re.compile(r'[ؐ-ًؚ-ٰٟۖ-ۭـ‌-‏]')
FOLD = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي'})
def norm(t): return re.sub(r'\s+', ' ', DIAC.sub('', t).translate(FOLD)).strip()

# Words that are not distinctive enough to prove a name is in the matn.
COMMON = {'عبد', 'الله', 'بن', 'ابن', 'بنت', 'ابو', 'ابي', 'ام', 'رسول', 'من', 'اصحاب', 'ﷺ', 'الانصاري',
          'الرحمن', 'مولي', 'لصفيه', 'مولاه', 'ابيه', 'جده'}


def main():
    check_only = '--check' in sys.argv
    errors = []
    ikmal_list = json.loads((ROOT / 'app/data/ikmal.json').read_text('utf-8'))
    ikmal = {e['n']: e for e in ikmal_list}
    # The id al-Ikmāl uses in its links (#n<id>), worked out exactly as app/app.js does.
    ikmal_id = {e['n']: ('x%d' % (i + 1) if e.get('nl') and not e['nl'][0].isdigit() else str(e['n']))
                for i, e in enumerate(ikmal_list)}
    meta = json.loads((ROOT / 'mishkat/data/meta.json').read_text('utf-8'))
    hadeeth = []
    for b in meta['books']:
        for s in json.loads((ROOT / 'mishkat/data' / b['file']).read_text('utf-8')):
            if s['kind'] == 'hadeeth':
                hadeeth.append(s)

    for key, (n, name, note) in M.PEOPLE.items():
        if n is not None and n not in ikmal:
            errors.append(f'{key}: al-Ikmāl entry {n} does not exist')
    for key in M.CHECK:
        if key not in M.PEOPLE:
            errors.append(f'CHECK lists unknown key {key}')

    out, prev = {}, None
    for s in hadeeth:
        n = s['n']
        if n not in M.HADEETH:
            errors.append(f'{n}: no entry in HADEETH'); prev = []; continue
        chain = M.HADEETH[n]
        if chain == '=prev':
            if prev is None:
                errors.append(f'{n}: "=prev" on the first hadeeth')
            chain = list(prev or [])
        for key in chain:
            if key not in M.PEOPLE:
                errors.append(f'{n}: unknown key {key}')
        out['h%d' % n] = chain
        prev = chain

        # guard: the people of a hadeeth must be named in its matn (pronoun chains are inherited, skip)
        if M.HADEETH[n] != '=prev':
            text = norm(''.join(r.get('t', '') for r in s['matn'] if not r.get('ref')))
            for key in chain:
                if key not in M.PEOPLE or key in ('shuayb', 'muawiya_hayda', 'salim_utba', 'utba_uwaym',
                                                  'hajjaj_malik', 'hakim_muawiya', 'fayruz') and key in chain[1:]:
                    continue  # "عن أبيه / عن جده": named only by relation
                if key == 'ibn_amr' and chain[:1] == ['amr_shuayb'] or (n, key) in M.IMPLIED:
                    continue
                words = [w for w in norm(M.PEOPLE[key][1]).split() if w not in COMMON and len(w) > 2]
                if words and not any(w in text for w in words):
                    errors.append(f'{n}: "{M.PEOPLE[key][1]}" ({key}) is not named in the matn')

    extra = sorted(set(M.HADEETH) - {s['n'] for s in hadeeth})
    if extra:
        errors.append('HADEETH has numbers that are not in the data: %s' % extra)

    if errors:
        print('Narrator map has problems; nothing written:', file=sys.stderr)
        for e in errors:
            print('  ' + e, file=sys.stderr)
        sys.exit(1)

    used = {k for chain in out.values() for k in chain}
    people = {k: {'n': M.PEOPLE[k][0], 'as': M.PEOPLE[k][1], 'note': M.PEOPLE[k][2], 'check': k in M.CHECK}
              for k in sorted(used)}
    nums = sorted({p['n'] for p in people.values() if p['n'] is not None})
    data = {'schema': 1, 'people': people, 'hadeeth': out,
            'ikmal': {str(i): dict(ikmal[i], id=ikmal_id[i]) for i in nums}}

    linked = sum(1 for c in out.values() if any(people[k]['n'] for k in c))
    print(f'{len(out)} hadeeth · {len(people)} people · {len(nums)} al-Ikmāl entries · '
          f'{linked} hadeeth with at least one linked narrator · '
          f'{sum(1 for c in out.values() if not c)} with no named narrator')
    if check_only:
        return
    dst = ROOT / 'mishkat/data/narrators.json'
    dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', 'utf-8')
    print('wrote', dst.relative_to(ROOT), f'({dst.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
