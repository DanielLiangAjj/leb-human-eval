#!/usr/bin/env python3
"""Pull the answers of the trial findings rating site from Supabase (standard library only).

Reads the two tables either through the Supabase REST endpoint with the service-role key (read from
--service-key-file at run time, never printed or written anywhere), or, with no key at all, from the two CSV
files the Supabase table editor exports (Table Editor > leb_evaluators > Export to CSV, same for leb_ratings):

  # who has done what so far
  python3 scripts/pull_ratings.py --url https://<ref>.supabase.co --service-key-file ~/.leb_eval_service_key --progress

  # write the answers out
  python3 scripts/pull_ratings.py --url https://<ref>.supabase.co --service-key-file ~/.leb_eval_service_key \
      --out results/2026-12-01 [--map CODE1=1 --map CODE2=2]

  # the same without a key
  python3 scripts/pull_ratings.py --evaluators-csv results/leb_evaluators_rows.csv \
      --ratings-csv results/leb_ratings_rows.csv --out results/2026-12-01

  # a rater who worked without a server sends the JSON file the finish screen downloads
  python3 scripts/pull_ratings.py --backup trial-findings-ratings-CODE.json [--backup ...] --out results/2026-12-01

Writes into --out: evaluators.csv, ratings.jsonl (raw rows), progress.json and, per rater k,
rater<k>_trials.tsv (one row per trial: the trial block's rating, the boxes marked wrong and the comment, the
answer on missing results, the time on screen) and rater<k>_findings.tsv (one row per finding: rating, boxes
marked wrong, worth, comment). When the second sheet is in use (data/statements.json exists and somebody has
rated a statement) it also writes rater<k>_statements.tsv (one row per statement: supported, a result of this
trial, comment).
Raters are numbered by sign-up order unless --map assigns numbers (then only the mapped evaluators get sheets).
scripts/score.py reads ratings.jsonl together with the key that never goes to the site.
"""
import argparse
import csv
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ITEMS = os.path.normpath(os.path.join(HERE, '..', 'data', 'items.json'))
DEFAULT_STATEMENTS = os.path.normpath(os.path.join(HERE, '..', 'data', 'statements.json'))
SHEET = 'trials'
SHEET2 = 'statements'
PAGE = 1000


def read_csv_export(path):
    """Rows of a Supabase table-editor CSV export as dicts; empty cells and 'null' become None."""
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    return [{k: (None if v in ('', 'null', 'NULL') else v) for k, v in r.items()} for r in rows]


def fail(message):
    sys.exit(f'pull_ratings: {message}')


def read_key(path):
    try:
        with open(os.path.expanduser(path), encoding='utf-8') as f:
            key = f.read().strip()
    except OSError as e:
        fail(f'cannot read the service key file ({e.strerror})')
    if not key:
        fail('the service key file is empty')
    return key


class Rest:
    """Minimal PostgREST reader with Range paging."""

    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.key = key
        self.bearer = True

    def _get(self, path, start):
        headers = {'apikey': self.key, 'Accept': 'application/json', 'Range-Unit': 'items',
                   'Range': f'{start}-{start + PAGE - 1}'}
        if self.bearer:
            headers['Authorization'] = f'Bearer {self.key}'
        req = urllib.request.Request(self.url + path, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def table(self, name, order):
        rows, start = [], 0
        while True:
            try:
                chunk = self._get(f'/rest/v1/{name}?select=*&order={order}', start)
            except urllib.error.HTTPError as e:
                if e.code == 416:  # asked past the last row
                    break
                if e.code == 401 and self.bearer and not self.key.startswith('eyJ'):
                    self.bearer = False  # newer non-JWT secret keys go in the apikey header only
                    continue
                body = e.read().decode('utf-8', 'replace')[:300].replace(self.key, '***')
                fail(f'reading {name} failed: HTTP {e.code} {body}')
            except urllib.error.URLError as e:
                fail(f'reading {name} failed: {e.reason}')
            if not isinstance(chunk, list):
                fail(f'reading {name} returned something unexpected')
            rows.extend(chunk)
            if len(chunk) < PAGE:
                break
            start += PAGE
        return rows


def clean(text):
    """One line of plain text for a TSV cell."""
    return ' '.join(str(text if text is not None else '').split())


def load_items(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    sheet = next((s for s in data['sheets'] if s['id'] == SHEET), None)
    if sheet is None:
        fail(f'{path} has no sheet named {SHEET}')
    return sorted(sheet['items'], key=lambda it: it['id'])


def load_statements(path):
    """The trials of the second sheet (each with its statements), or [] when the file is not there."""
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return sorted(json.load(f)['sheet']['items'], key=lambda it: it['id'])


def read_backups(paths):
    """Evaluators and ratings from the JSON files the finish screen downloads."""
    evaluators, ratings = [], []
    for path in paths:
        with open(path, encoding='utf-8') as f:
            b = json.load(f)
        evaluators.append({'code': b['code'], 'name': b.get('name'), 'email': b.get('email'),
                           'created_at': b.get('exported_at'), 'last_seen': b.get('exported_at'), 'completed_at': None})
        for a in b.get('answers', []):
            ratings.append({'code': b['code'], 'sheet': a['sheet'], 'item_id': a['item_id'], 'answer': a['answer'],
                            'elapsed_ms': a.get('elapsed_ms'), 'client_ts': a.get('client_ts'), 'app_version': a.get('app_version')})
    return evaluators, ratings


def assign_raters(evaluators, mapping):
    codes = {e['code'] for e in evaluators}
    if mapping:
        out = {}
        for entry in mapping:
            code, sep, k = entry.partition('=')
            code = code.strip().upper()
            if not sep or not k.strip().isdigit() or int(k) < 1:
                fail(f'--map expects CODE=K with K a positive number, got {entry!r}')
            if code not in codes:
                print(f'warning: --map code {code} is not in the evaluators table', file=sys.stderr)
            out[code] = int(k)
        if len(set(out.values())) != len(out):
            fail('--map gives the same rater number to two codes')
        return out
    ordered = sorted(evaluators, key=lambda e: (e.get('created_at') or '', e['code']))
    return {e['code']: i + 1 for i, e in enumerate(ordered)}


def write_tsv(path, header, rows):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f, delimiter='\t', lineterminator='\r\n')
        writer.writerow(header)
        writer.writerows(rows)


def summarise(evaluators, ratings, raters, items, statements=()):
    known = {it['id'] for it in items}
    n_findings = {it['id']: len(it['findings']) for it in items}
    known2 = {it['id'] for it in statements}
    n_statements = {it['id']: len(it['statements']) for it in statements}
    done, done2 = {}, {}
    for r in ratings:
        if r.get('sheet') == SHEET and r.get('item_id') in known:
            done.setdefault(r['code'], set()).add(r['item_id'])
        elif r.get('sheet') == SHEET2 and r.get('item_id') in known2:
            done2.setdefault(r['code'], set()).add(r['item_id'])
    people = []
    for e in sorted(evaluators, key=lambda e: (raters.get(e['code'], 10 ** 6), e.get('created_at') or '')):
        mine = done.get(e['code'], set())
        person = {'rater': raters.get(e['code']), 'code': e['code'], 'name': e.get('name'),
                  'created_at': e.get('created_at'), 'last_seen': e.get('last_seen'), 'completed_at': e.get('completed_at'),
                  'trials': len(mine), 'findings': sum(n_findings[i] for i in mine), 'all_answered': len(mine) == len(known)}
        if done2:   # the second sheet is in use
            mine2 = done2.get(e['code'], set())
            person.update({'statement_trials': len(mine2), 'statements': sum(n_statements[i] for i in mine2)})
        people.append(person)
    out = {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
           'trials': len(known), 'findings': sum(n_findings.values()), 'evaluators': people}
    if done2:
        out.update({'statement_trials': len(known2), 'statements': sum(n_statements.values())})
    return out


def print_progress(summary):
    print(f"{'rater':<6}{'code':<12}{'name':<26}{'trials':>10}{'findings':>11}  status")
    for p in summary['evaluators']:
        if p['completed_at']:
            status = f"finished {p['completed_at'][:16]}"
        elif p['all_answered']:
            status = 'all answered, finish not recorded'
        else:
            status = f"in progress (last seen {(p['last_seen'] or '-')[:16]})"
        rater = str(p['rater']) if p['rater'] else '-'
        second = f"  statements {p['statements']}/{summary['statements']}" if 'statements' in summary else ''
        print(f"{rater:<6}{p['code']:<12}{(p['name'] or '')[:24]:<26}{p['trials']:>6}/{summary['trials']:<3}{p['findings']:>7}/{summary['findings']:<3}  {status}{second}")
    if not summary['evaluators']:
        print('(no evaluators yet)')


def main():
    ap = argparse.ArgumentParser(description='Pull the ratings of the trial findings site.')
    ap.add_argument('--url', help='Supabase project URL, https://<ref>.supabase.co')
    ap.add_argument('--service-key-file', help='file holding the service-role key (read, never printed)')
    ap.add_argument('--evaluators-csv', help='CSV export of the leb_evaluators table (no key needed)')
    ap.add_argument('--ratings-csv', help='CSV export of the leb_ratings table')
    ap.add_argument('--backup', action='append', default=[], help='JSON file downloaded from the finish screen (repeatable)')
    ap.add_argument('--out', help='output folder, for example results/2026-12-01')
    ap.add_argument('--map', action='append', default=[], metavar='CODE=K', help='rater number for a code (repeatable)')
    ap.add_argument('--progress', action='store_true', help='only print how far each evaluator is')
    ap.add_argument('--items', default=DEFAULT_ITEMS, help=argparse.SUPPRESS)
    ap.add_argument('--statements-items', default=DEFAULT_STATEMENTS, help=argparse.SUPPRESS)
    a = ap.parse_args()
    if not a.progress and not a.out:
        ap.error('--out is required unless --progress is given')

    items = load_items(a.items)
    statements = load_statements(a.statements_items)
    if a.backup:
        evaluators, ratings = read_backups(a.backup)
    elif a.evaluators_csv or a.ratings_csv:
        if not (a.evaluators_csv and a.ratings_csv):
            ap.error('give both --evaluators-csv and --ratings-csv')
        evaluators = read_csv_export(a.evaluators_csv)
        ratings = read_csv_export(a.ratings_csv)
        for r in ratings:
            if isinstance(r.get('answer'), str):
                r['answer'] = json.loads(r['answer'])
            elif not r.get('answer'):
                r['answer'] = {}
            for k in ('id', 'elapsed_ms'):
                if r.get(k) not in (None, ''):
                    r[k] = int(float(r[k]))
        evaluators.sort(key=lambda e: (e.get('created_at') or '', e['code']))
        ratings.sort(key=lambda r: r.get('id') or 0)
    else:
        if not (a.url and a.service_key_file):
            ap.error('give --url and --service-key-file, or the two CSV exports, or --backup files')
        rest = Rest(a.url, read_key(a.service_key_file))
        evaluators = rest.table('leb_evaluators', 'created_at.asc')
        ratings = rest.table('leb_ratings', 'id.asc')
    raters = assign_raters(evaluators, a.map)
    summary = summarise(evaluators, ratings, raters, items, statements)
    if a.progress:
        print_progress(summary)
        return

    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'evaluators.csv'), 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        cols = ['code', 'name', 'email', 'created_at', 'last_seen', 'completed_at']
        writer.writerow(['rater'] + cols)
        for e in sorted(evaluators, key=lambda e: (e.get('created_at') or '', e['code'])):
            writer.writerow([raters.get(e['code'], '')] + [e.get(c) if e.get(c) is not None else '' for c in cols])
    with open(os.path.join(a.out, 'ratings.jsonl'), 'w', encoding='utf-8') as f:
        for r in ratings:
            f.write(json.dumps({**r, 'rater': raters.get(r['code'])}, ensure_ascii=False) + '\n')

    by_code, by_code2 = {}, {}
    for r in ratings:
        if r.get('sheet') == SHEET:
            by_code.setdefault(r['code'], {})[r['item_id']] = r
        elif r.get('sheet') == SHEET2:
            by_code2.setdefault(r['code'], {})[r['item_id']] = r
    written = []
    for code, k in sorted(raters.items(), key=lambda kv: kv[1]):
        mine = by_code.get(code, {})
        trials, findings = [], []
        for it in items:
            r = mine.get(it['id'])
            ans = (r or {}).get('answer') or {}
            g, m = ans.get('glance') or {}, ans.get('missing') or {}
            secs = round(r['elapsed_ms'] / 1000) if r and r.get('elapsed_ms') is not None else ''
            trials.append([it['id'], clean(it['title']), it.get('year') or '', len(it['findings']), it.get('not_shown') or 0,
                           g.get('rating') or '', ' '.join(g.get('wrong') or []), clean(g.get('note')),
                           m.get('rating') or '', clean(m.get('text')), secs])
            for f in it['findings']:
                x = (ans.get('findings') or {}).get(f['id']) or {}
                findings.append([f['id'], it['id'], clean(f['p']['text']), clean(f['i']['text']), clean(f['c']['text']),
                                 clean(f['o']['text']), f['direction'], x.get('rating') or '', ' '.join(x.get('wrong') or []),
                                 'yes' if x.get('no_result') else '', x.get('worth') or '', clean(x.get('note'))])
        write_tsv(os.path.join(a.out, f'rater{k}_trials.tsv'),
                  ['trial', 'title', 'year', 'findings shown', 'findings not shown', 'trial block', 'trial boxes marked wrong',
                   'trial comment', 'missing', 'missing text', 'seconds'], trials)
        write_tsv(os.path.join(a.out, f'rater{k}_findings.tsv'),
                  ['finding', 'trial', 'population', 'intervention', 'comparator', 'outcome', 'direction', 'rating',
                   'boxes marked wrong', 'no result between these groups', 'worth', 'comment'], findings)
        if statements and by_code2:
            mine2, rows2 = by_code2.get(code, {}), []
            for it in statements:
                r = mine2.get(it['id'])
                given = ((r or {}).get('answer') or {}).get('statements') or {}
                secs = round(r['elapsed_ms'] / 1000) if r and r.get('elapsed_ms') is not None else ''
                for s in it['statements']:
                    x = given.get(s['id']) or {}
                    rows2.append([s['id'], it['id'], clean(s['text']), s['where'], clean(s['sentence']),
                                  x.get('support') or '', x.get('result') or '', clean(x.get('note')), secs])
            write_tsv(os.path.join(a.out, f'rater{k}_statements.tsv'),
                      ['statement', 'trial', 'text', 'read from', 'sentence', 'supported by the abstract',
                       'a result of this trial', 'comment', 'seconds on the trial'], rows2)
        written.append(k)

    with open(os.path.join(a.out, 'progress.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print_progress(summary)
    print(f"wrote {len(evaluators)} evaluators, {len(ratings)} ratings and sheets for rater(s) {', '.join(map(str, written)) or 'none'} to {a.out}")


if __name__ == '__main__':
    main()
