# Trial findings, clinician rating site

A static site where clinicians rate what the living evidence base read from the abstracts of randomized
trials. One screen per trial: the abstract on the left; on the right everything that was read from it.
First the trial as a whole (design, condition, participants, their number, each group with its size, each
outcome, subgroups, registration number), then every finding laid out as PICO (population, intervention,
comparator, outcome, each with the standard name it was coded to) with its direction, time point, wording,
primary-outcome flag, numbers and source sentence, and a last question on whether the abstract states a
result that is not in the list. Every field is a box; a click marks it as wrong, and a comment is required
whenever something is wrong or the rater is unsure. Each evaluator rates every
trial, in an order seeded by their personal code, over as many sittings as they like, and can resume
on any device with the code. Answers are saved on every Next to a Supabase project and pulled with
`scripts/pull_ratings.py`; `scripts/score.py` turns them into the numbers for the paper.

Live: <https://danielliangajj.github.io/leb-human-eval/> (answers go to the Supabase project shared with the outcome
taxonomy rating site, in the tables `leb_evaluators` and `leb_ratings`).

The site never shows whether a finding passed the base's checks, which check held it, or any
confidence: the clinicians rate blind. The key that says which record each finding is stays in the
evidence base repository (`docs/evaluation/clinician_50/key.json`) and must not be copied here.

The sample of 2026-11-17 (`clinician_50`): 50 trials, 10 per period (before 2000, 2000s, 2010s, 2020s,
indexed since May 2026), drawn in a fixed hash order from the 24,642 papers the base reads as randomized
trials; 245 findings (at most 8 per trial; 3 trials have none). About 4.5 hours per evaluator, since every
field is checked (`--max-per-trial 5` in the export gives 188 findings and about 4 hours).

## Run it locally

```
cd leb-human-eval
python3 -m http.server 8000
```

Open <http://localhost:8000/>. With the empty values in `config.js` the site runs in **local-only
mode**: everything works, answers stay in the browser's localStorage, a yellow banner says so, and the
finish screen insists on downloading the answers as JSON (which `scripts/pull_ratings.py --backup` reads).

To test against a real project without touching `config.js`, create `config.local.js` (git-ignored)
next to it with the same two exports; it overrides `config.js` everywhere except on GitHub Pages:

```js
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon public key>';
export const STATEMENTS_SHEET = true;   // optional: show the second sheet locally
```

To start over as a tester, clear the site's storage in the browser (all keys start with `leb:`).

## Configure Supabase

One-time setup, described step by step in `supabase/README.md`: paste `supabase/schema.sql` into the
SQL editor of a Supabase project and run it, copy the Project URL and the anon public key into
`config.js`, commit and push. Every table and function carries the prefix `leb_`, so the project that
serves the outcome taxonomy rating site can be reused. The anon key is public by design; the tables are
closed to it and the four functions in `schema.sql` are the only way in.

## Publish

The same way as the taxonomy site: a public GitHub repository with Pages serving the main branch (the
account's plan does not serve Pages from a private repository). `data/items.json` holds the text of 50
PubMed abstracts; the pages carry `noindex`. A push to `main` redeploys within a minute or two.

## Pull and score the results

```
# who has done what
python3 scripts/pull_ratings.py --url https://<project-ref>.supabase.co --service-key-file ~/.leb_eval_service_key --progress

# write the answers out
python3 scripts/pull_ratings.py --url https://<project-ref>.supabase.co --service-key-file ~/.leb_eval_service_key \
    --out results/2026-12-01 --map <CODE1>=1 --map <CODE2>=2

# the numbers: share read correctly (passing and held findings), what was wrong, worth, agreement
python3 scripts/score.py --ratings results/2026-12-01/ratings.jsonl \
    --key ../living-evidence-base/docs/evaluation/clinician_50/key.json --out results/2026-12-01/report.md
```

The service-role key is read from the file at run time and never printed or written; keep that file
outside the repository. Without a key, export the two tables as CSV from the Supabase table editor and
pass `--evaluators-csv` and `--ratings-csv`. `results/` is git-ignored.

## Answer format

One answer per evaluator and trial (`leb_ratings.answer`, jsonb, sheet `trials`, item id `T01` to `T50`),
with `elapsed_ms` (time on screen before Next, summed over visits), `client_ts` (browser time, ISO) and
`app_version` (`APP_VERSION` in `assets/state.js`; bump it when the format changes). When the same trial
is saved twice, the copy with the later `client_ts` wins.

```json
{
  "glance":   {"rating": "correct" | "not correct" | "unsure",
               "wrong": ["arm:A2", "n", "outcome_missing"],
               "note": "..."},
  "findings": {"T07a": {"rating": "correct" | "not correct" | "unsure",
                        "wrong": ["c", "ko", "t"],
                        "no_result": false,
                        "worth": "yes" | "no" | "unsure" | null,
                        "note": "..."}},
  "missing":  {"rating": "no" | "yes" | "unsure", "text": "..."}
}
```

- `glance` is the trial block. "correct" means every box is what the abstract states. `wrong` lists the
  boxes marked: `design`, `condition`, `kcond` (standard name of the condition), `population`, `n` (number
  of participants), `reg` (registration), `arm:<id>`, `outcome:<id>`, `subgroup:<id>` (ids as in
  `data/items.json`), and `arm_missing`, `outcome_missing` for a group or an outcome that is not listed.
  With "not correct" at least one box and a comment are required; with "unsure" a comment.
- `findings` has one entry per finding shown. `wrong` lists the boxes marked: `p` population,
  `i` intervention, `ki` its standard name, `c` comparator, `kc` its standard name, `o` outcome, `ko` its
  standard name, `d` direction, `u` the measure itself (shown when the outcome is named as a reduction),
  `t` time point, `h` primary outcome, `s` how the abstract words it, `nv` values in each group,
  `ne` estimate, `np` P value, `q` the sentence. `no_result` is the box "the sentence does not report a
  result between these two groups". With "not correct", at least one of `wrong` or `no_result` and a
  comment are required, and `worth` is null. With "unsure" a comment and `worth` are required; with
  "correct", `worth`.
- `missing`: does the abstract state a result between two groups that is not in the list ("no" is
  nothing missing). Text is required with "yes" and with "unsure". For a trial with no finding the
  question is whether the abstract states any such result.

A box that the pipeline left empty (no standard name, no time point, no number) is shown as such and
cannot be marked; `scripts/score.py` counts each box only where it was shown.

A trial being filled in is kept as a draft in the browser (`leb:d:...`) until Next saves it, so a
reload or a pause loses nothing.

## The items

`data/items.json` is written by `scripts/clinician_site.py` of the evidence base repository (run on the
server; do not edit the file by hand). Per trial: title, journal, year, the abstract in its sections,
the trial block (design and where the design came from, condition and its standard name, participants,
their number and its source, groups with role and size, outcomes with their primary and safety flags,
subgroups, registration number and its source), the findings in the order of the abstract (each with P, I,
C, O and their standard names, where the comparator was named, direction, the measure itself when the
outcome is named as a reduction, time point, primary-outcome flag, how the abstract words the result,
the numbers read for the comparison, the sentence with the words that state the effect, and where it sits
in the abstract) and how many findings are not shown. The second sheet, `statements`, has its own file
and its own section below.

## The second sheet: statements of another program (off by default)

A short second part for the same raters: the statements that another, published program reads from the
same abstracts, each as one plain sentence ("Orlistat treats Obesity."). The site does not say which
program. One screen per trial: the abstract on the left, with the sentence a statement was read from
underlined when the rater points at it (the title when it came from the title); on the right one row
per statement with two questions:

- **A. Does the abstract support it?** Yes, No or Unsure. A comment is required with Unsure and optional
  otherwise.
- **B. Is it a result of this trial** (something found by comparing its groups)? Yes, No or Unsure. Not
  asked when A is No.

Keys: `1 2 3` answer A, `Y N U` answer B, `J K` move between statements, Enter is Next, `B` is Back.

The sheet is **off** unless `config.js` says `export const STATEMENTS_SHEET = true;`. While it is off the
site loads and shows the trials sheet only, exactly as before: `data/statements.json` is not fetched, the
time estimate and the finish screen do not change. When it is on, the statements follow the trials (the
page between the two parts says that this is a good place to stop), the welcome page lists both parts with
their time (about 12 seconds per statement), and a rater who had already finished the trials is taken to
the statements on the next visit. `config.local.js` can set `STATEMENTS_SHEET` for local testing.

`data/statements.json` is written by `scripts/clinician_statements.py` of the evidence base repository,
from the same sample: 29 of the 50 trials have a statement, 132 statements in all, at most 13 per trial.
It names no source, no predicate code, no concept identifier and no PubMed id. The key that says which
statement is which (`statements_key.json`) stays in the evidence base repository, like the other key.

One answer per evaluator and trial (sheet `statements`, item id = the trial id):

```json
{"statements": {"T07s1": {"support": "yes" | "no" | "unsure",
                          "result":  "yes" | "no" | "unsure" | null,
                          "note": "..."}}}
```

`result` is null when `support` is "no". `scripts/pull_ratings.py` writes `rater<k>_statements.tsv` when
somebody has rated a statement, and `scripts/score.py --statements-key <path to statements_key.json>`
adds to the report: the share of statements the abstract supports (with a Wilson interval, by kind and by
predicate), the share that are a result of the trial, the trials with at least one supported result, and
the two raters' agreement (raw and Cohen's kappa).

## Files

```
index.html, 404.html, config.js        page shell, deep-link redirect, Supabase settings (public)
assets/app.js                          entry: settings, items, first screen
assets/views.js                        screens and flow (welcome, intro, trial, pause, finish)
assets/trial.js                        the trial screen: abstract, PICO layout, controls, answer JSON
assets/statements.js                   the statements screen (second sheet, off by default)
assets/state.js, storage.js,           session and trial order, localStorage (answers, drafts, queue),
  sync.js, api.js, prng.js,            save queue with retries, Supabase RPC calls, seeded shuffle,
  markdown.js, dom.js                  guide markdown
assets/style.css
data/items.json                        the trials (generated)
data/statements.json                   the statements of the second sheet (generated; loaded only when the sheet is on)
supabase/schema.sql, supabase/README.md
scripts/pull_ratings.py, scripts/score.py
```
