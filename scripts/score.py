#!/usr/bin/env python3
"""Score the clinicians' ratings against the key (standard library only).

  python3 scripts/score.py --ratings results/2026-12-01/ratings.jsonl --key <path to key.json> [--out report.md]

ratings.jsonl is written by scripts/pull_ratings.py. The key (which record each shown finding is, with its status in
the base) is written by scripts/clinician_site.py of the evidence base and is kept outside this site.
The report gives, per rater: the share of findings read correctly, for the findings that pass the base's checks and for
the ones the checks hold; how often each box (each field the pipeline wrote down) was marked wrong, for the findings and
for the trial block; the share worth having; the answer on missing results; the time taken.
With two raters it adds their agreement (raw and Cohen's kappa).
"""
import argparse
import collections
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ITEMS = os.path.normpath(os.path.join(HERE, '..', 'data', 'items.json'))
# The boxes of a finding (assets/trial.js, FINDING_PARTS) and of the trial block.
PARTS = [('p', 'population'), ('i', 'intervention'), ('ki', 'standard name of the intervention'), ('c', 'comparator'),
         ('kc', 'standard name of the comparator'), ('o', 'outcome'), ('ko', 'standard name of the outcome'), ('d', 'direction'),
         ('u', 'the measure itself (outcome named as a reduction)'), ('t', 'time point'), ('h', 'primary outcome'),
         ('s', 'how the abstract words it'), ('nv', 'values in each group'), ('ne', 'estimate'), ('np', 'P value'), ('q', 'sentence')]
TRIAL_PARTS = [('design', 'design'), ('condition', 'condition'), ('kcond', 'standard name of the condition'), ('population', 'participants'),
               ('n', 'number of participants'), ('arm', 'groups (each one)'), ('outcome', 'outcomes (each one)'),
               ('subgroup', 'subgroups (each one)'), ('reg', 'registration')]


def shown_finding(f):
    """Boxes shown on a finding's card (the same rule as findingKeys in assets/trial.js)."""
    keys = ['p', 'i', 'c', 'o', 'd', 'h', 's', 'q']
    keys += ['ki'] if f['i'].get('codes') else []
    keys += ['kc'] if f['c'].get('codes') else []
    keys += ['ko'] if f['o'].get('code') else []
    keys += ['u'] if f.get('underlying') else []
    keys += ['t'] if f.get('time') else []
    return keys + [n['key'] for n in f.get('numbers') or []]


def shown_trial(item):
    """Boxes shown in the trial block, as (kind, key)."""
    t = item.get('trial') or {}
    out = [('design', 'design'), ('population', 'population')]
    if t.get('condition'):
        out.append(('condition', 'condition'))
        if t['condition'].get('code'):
            out.append(('kcond', 'kcond'))
    if t.get('n'):
        out.append(('n', 'n'))
    if t.get('registration'):
        out.append(('reg', 'reg'))
    out += [('arm', f"arm:{a['id']}") for a in t.get('arms') or []]
    out += [('outcome', f"outcome:{o['id']}") for o in t.get('outcomes') or []]
    out += [('subgroup', f"subgroup:{s['id']}") for s in t.get('subgroups') or []]
    return out


def wilson(k, n, z=1.96):
    """95% Wilson interval for k of n, as two shares."""
    if n == 0:
        return (float('nan'), float('nan'))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def pct(k, n):
    return f'{k} of {n} ({100 * k / n:.1f}%)' if n else '0 of 0'


def pct_ci(k, n):
    if not n:
        return '0 of 0'
    lo, hi = wilson(k, n)
    return f'{k} of {n} ({100 * k / n:.1f}%, 95% interval {100 * lo:.1f} to {100 * hi:.1f})'


def kappa(pairs):
    """Raw agreement and Cohen's kappa for a list of (label of rater 1, label of rater 2)."""
    n = len(pairs)
    if not n:
        return None
    po = sum(a == b for a, b in pairs) / n
    ca, cb = collections.Counter(a for a, _ in pairs), collections.Counter(b for _, b in pairs)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    return {'n': n, 'agree': po, 'kappa': (po - pe) / (1 - pe) if pe < 1 else float('nan')}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ratings', required=True)
    ap.add_argument('--key', required=True)
    ap.add_argument('--items', default=DEFAULT_ITEMS)
    ap.add_argument('--out')
    a = ap.parse_args()
    key = json.load(open(a.key, encoding='utf-8'))
    items = {it['id']: it for s in json.load(open(a.items, encoding='utf-8'))['sheets'] if s['id'] == 'trials' for it in s['items']}
    fkey = {fid: {**f, 'trial': tid, 'stratum': t['stratum']} for tid, t in key['trials'].items() for fid, f in t['findings'].items()}
    rows = [json.loads(line) for line in open(a.ratings, encoding='utf-8') if line.strip()]
    rows = [r for r in rows if r.get('sheet') == 'trials' and r.get('item_id') in items and r.get('rater')]
    raters = sorted({r['rater'] for r in rows})
    if not raters:
        sys.exit('score: no ratings of numbered raters in the file')
    by = {k: {r['item_id']: r for r in rows if r['rater'] == k} for k in raters}
    out = [f'# Clinicians\' ratings of the sample {key.get("name", "")} (drawn {key.get("drawn", "")})', '',
           f'{len(items)} trials, {len(fkey)} findings shown ({sum(f["status"] == "COMMIT" for f in fkey.values())} pass the base\'s checks, '
           f'{sum(f["status"] != "COMMIT" for f in fkey.values())} are held). Raters: {", ".join(map(str, raters))}.', '']
    labels = {}
    for k in raters:
        f_rated = {}
        for tid, r in by[k].items():
            for fid, x in ((r.get('answer') or {}).get('findings') or {}).items():
                if fid in fkey and x.get('rating'):
                    f_rated[fid] = x
        labels[k] = f_rated
        out += [f'## Rater {k}', '', f'Trials rated: {len(by[k])} of {len(items)}. Findings rated: {len(f_rated)} of {len(fkey)}.', '']
        out += ['| Findings | Rated | Correct | Not correct | Unsure | Correct, unsure left out |', '|---|---|---|---|---|---|']
        for name, test in (('Pass the checks (in the base)', lambda f: f['status'] == 'COMMIT'), ('Held by a check', lambda f: f['status'] != 'COMMIT'),
                           ('All', lambda f: True)):
            xs = [x for fid, x in f_rated.items() if test(fkey[fid])]
            c = collections.Counter(x['rating'] for x in xs)
            sure = c['correct'] + c['not correct']
            out.append(f'| {name} | {len(xs)} | {pct_ci(c["correct"], len(xs))} | {c["not correct"]} | {c["unsure"]} | {pct(c["correct"], sure)} |')
        out += ['', 'Records of one trial are not independent, so the real intervals are somewhat wider.', '']
        passing = [(fid, x) for fid, x in f_rated.items() if fkey[fid]['status'] == 'COMMIT']
        out += ['| Passing findings by | Rated | Correct |', '|---|---|---|']
        groups = [('Period: ' + s, lambda f, s=s: f['stratum'] == s) for s in sorted({f['stratum'] for f in fkey.values()})]
        groups += [('Headline finding', lambda f: f['headline']), ('Other finding', lambda f: not f['headline']),
                   ('All participants', lambda f: not f['subgroup']), ('Subgroup', lambda f: f['subgroup'])]
        groups += [('Direction: ' + d, lambda f, d=d: f['direction'] == d) for d in sorted({f['direction'] for f in fkey.values()})]
        for name, test in groups:
            xs = [x for fid, x in passing if test(fkey[fid])]
            out.append(f'| {name} | {len(xs)} | {pct(sum(x["rating"] == "correct" for x in xs), len(xs))} |')
        sizes = (key.get('frame') or {}).get('strata') or {}
        if sizes:
            num = den = 0.0
            for s, n_s in sizes.items():
                xs = [x for fid, x in passing if fkey[fid]['stratum'] == s]
                if xs:
                    num += n_s * sum(x['rating'] == 'correct' for x in xs) / len(xs)
                    den += n_s
            if den:
                out += ['', f'Weighted by the number of papers of each period in the base: {100 * num / den:.1f}% correct '
                            '(the sample takes the same number of trials from each period, the base does not).']
        bad = [x for _, x in passing if x['rating'] == 'not correct']
        fitem = {f['id']: f for it in items.values() for f in it['findings']}
        out += ['', f'Each box of the passing findings: how often it was shown, and how often it was marked wrong '
                    f'({len(bad)} findings were rated "something is wrong"; a finding can have several boxes marked). '
                    'A box marked on a finding rated unsure is counted apart.', '',
                '| Box | Shown | Marked wrong | Right | Marked on an unsure finding |', '|---|---|---|---|---|']
        for p, name in PARTS:
            shown = [(fid, x) for fid, x in passing if p in shown_finding(fitem[fid])]
            wrong = sum(p in (x.get('wrong') or []) and x['rating'] == 'not correct' for _, x in shown)
            doubt = sum(p in (x.get('wrong') or []) and x['rating'] == 'unsure' for _, x in shown)
            if shown:
                out.append(f'| {name} | {len(shown)} | {wrong} | {100 * (len(shown) - wrong) / len(shown):.1f}% | {doubt} |')
        out.append(f'| the sentence reports no result between these two groups | {len(passing)} | {sum(bool(x.get("no_result")) for x in bad)} | | |')
        ok = [x for _, x in passing if x['rating'] != 'not correct']
        w = collections.Counter(x.get('worth') for x in ok)
        out += ['', f'Worth having, of the {len(ok)} passing findings not rated wrong: yes {pct(w["yes"], len(ok))}, no {pct(w["no"], len(ok))}, unsure {w["unsure"]}.', '']
        out += ['Each box of the trial block:', '', '| Box | Shown | Marked wrong | Right |', '|---|---|---|---|']
        for kind, name in TRIAL_PARTS:
            n_shown = n_wrong = 0
            for tid, r in by[k].items():
                gl = (r.get('answer') or {}).get('glance') or {}
                marks = set(gl.get('wrong') or []) if gl.get('rating') == 'not correct' else set()
                for kd, key_ in shown_trial(items[tid]):
                    if kd == kind:
                        n_shown += 1
                        n_wrong += key_ in marks
            if n_shown:
                out.append(f'| {name} | {n_shown} | {n_wrong} | {100 * (n_shown - n_wrong) / n_shown:.1f}% |')
        gl_all = [(r.get('answer') or {}).get('glance') or {} for r in by[k].values()]
        out += ['', f'Trials where a group was said to be missing: {sum("arm_missing" in (g_.get("wrong") or []) for g_ in gl_all)}; '
                    f'an outcome: {sum("outcome_missing" in (g_.get("wrong") or []) for g_ in gl_all)}.', '']
        g = collections.Counter(((r.get('answer') or {}).get('glance') or {}).get('rating') for r in by[k].values())
        m = collections.Counter(((r.get('answer') or {}).get('missing') or {}).get('rating') for r in by[k].values())
        n_t = len(by[k])
        out += [f'The trial block as a whole: all correct {pct(g["correct"], n_t)}, something wrong {g["not correct"]}, unsure {g["unsure"]}.',
                f'Anything missing: nothing {pct(m["no"], n_t)}, something {m["yes"]}, unsure {m["unsure"]}.', '']
        missing = [(tid, ((r.get('answer') or {}).get('missing') or {}).get('text')) for tid, r in sorted(by[k].items())
                   if ((r.get('answer') or {}).get('missing') or {}).get('rating') == 'yes']
        if missing:
            out += ['Results named as missing (to check by hand against the findings not shown):', '']
            out += [f'- {tid} ({items[tid].get("not_shown") or 0} not shown): {text}' for tid, text in missing] + ['']
        secs = [r['elapsed_ms'] / 1000 for r in by[k].values() if r.get('elapsed_ms')]
        if secs:
            out += [f'Time on screen: {sum(secs) / 3600:.1f} hours in all, median {statistics.median(secs) / 60:.1f} minutes per trial.', '']
    if len(raters) >= 2:
        k1, k2 = raters[:2]
        both = sorted(set(labels[k1]) & set(labels[k2]))
        out += [f'## Agreement between raters {k1} and {k2}', '', '| Answer | Rated by both | Same answer | Cohen\'s kappa |', '|---|---|---|---|']

        def line(name, pairs):
            r = kappa(pairs)
            out.append(f'| {name} | {r["n"]} | {100 * r["agree"]:.1f}% | {r["kappa"]:.2f} |' if r else f'| {name} | 0 | | |')
        line('Finding read correctly (correct, not correct, unsure)', [(labels[k1][f]['rating'], labels[k2][f]['rating']) for f in both])
        line('Finding read correctly (correct against anything else)', [(labels[k1][f]['rating'] == 'correct', labels[k2][f]['rating'] == 'correct') for f in both])
        line('The same, passing findings only', [(labels[k1][f]['rating'] == 'correct', labels[k2][f]['rating'] == 'correct') for f in both if fkey[f]['status'] == 'COMMIT'])
        line('Worth having (where both answered)', [(labels[k1][f].get('worth'), labels[k2][f].get('worth')) for f in both
                                                    if labels[k1][f].get('worth') and labels[k2][f].get('worth')])
        trials = sorted(set(by[k1]) & set(by[k2]))
        for part, name in (('glance', 'The trial block'), ('missing', 'Anything missing')):
            line(name, [(((by[k1][t].get('answer') or {}).get(part) or {}).get('rating'), ((by[k2][t].get('answer') or {}).get(part) or {}).get('rating')) for t in trials])
        passing = [f for f in both if fkey[f]['status'] == 'COMMIT']
        n = len(passing)
        bo = sum(labels[k1][f]['rating'] == 'correct' and labels[k2][f]['rating'] == 'correct' for f in passing)
        ei = sum(labels[k1][f]['rating'] == 'correct' or labels[k2][f]['rating'] == 'correct' for f in passing)
        out += ['', f'Passing findings both raters call correct: {pct_ci(bo, n)}. At least one rater: {pct(ei, n)}.',
                'The findings on which the two differ go to a third reader, and the resolved labels are the final ones.', '']
    text = '\n'.join(out) + '\n'
    if a.out:
        open(a.out, 'w', encoding='utf-8').write(text)
        print(f'written to {a.out}')
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
