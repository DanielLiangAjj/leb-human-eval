// The trial screen: the abstract on the left and, on the right, everything that was read from it.
// Every box is one thing the pipeline wrote down and can be marked as wrong by a click. Also when an
// answer is valid and the exact answer JSON that is saved (scripts/pull_ratings.py and
// scripts/score.py depend on these keys).
import { h } from './dom.js';

const OK = { ok: true, need: '', unit: -1 };
const need = (text, unit) => ({ ok: false, need: text, unit });
const filled = (s, n = 3) => String(s || '').trim().length >= n;

const COLOR = {
  correct: 'var(--green)', 'not correct': 'var(--red)', unsure: 'var(--amber)',
  yes: 'var(--green)', no: 'var(--red)',
};
const READ = ['correct', 'not correct', 'unsure'];
const READ_LABEL = { correct: 'All correct', 'not correct': 'Something is wrong', unsure: 'Unsure' };
const WORTH = ['yes', 'no', 'unsure'];
const WORTH_LABEL = { yes: 'Yes', no: 'No', unsure: 'Unsure' };
const MISSING = ['no', 'yes', 'unsure'];
const MISSING_LABEL = { no: 'Nothing is missing', yes: 'Something is missing', unsure: 'Unsure' };
const MISSING_COLOR = { no: 'var(--green)', yes: 'var(--red)', unsure: 'var(--amber)' };

/** The boxes of a finding that can be marked wrong: key and its name in messages and in the scores. */
export const FINDING_PARTS = [
  ['p', 'population'], ['i', 'intervention'], ['ki', 'standard name of the intervention'],
  ['c', 'comparator'], ['kc', 'standard name of the comparator'],
  ['o', 'outcome'], ['ko', 'standard name of the outcome'],
  ['d', 'direction'], ['u', 'measure itself'], ['t', 'time point'], ['h', 'primary outcome'], ['s', 'how it is worded'],
  ['nv', 'values in each group'], ['ne', 'estimate'], ['np', 'P value'], ['q', 'sentence'],
];
const FINDING_NAME = Object.fromEntries(FINDING_PARTS);
const FINDING_ORDER = FINDING_PARTS.map(([k]) => k);
/** The boxes of the trial block with a fixed key; groups, outcomes and subgroups add "arm:A1", "outcome:O2", "subgroup:P2". */
export const TRIAL_PARTS = [
  ['design', 'design'], ['condition', 'condition'], ['kcond', 'standard name of the condition'], ['population', 'participants'],
  ['n', 'number of participants'], ['reg', 'registration'], ['arm_missing', 'a group is missing'], ['outcome_missing', 'an outcome is missing'],
];
const TRIAL_NAME = Object.fromEntries(TRIAL_PARTS);
const ARROW = { higher: '▲', lower: '▼', no_difference: '＝', mixed: '▲▼' };

const letterOf = (fid) => fid.slice(-1);
const count = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));

/** Keys that exist on this finding's card (a box that is not shown cannot be marked). */
function findingKeys(f) {
  const keys = ['p', 'i', 'c', 'o', 'd', 'h', 's', 'q'];
  if (f.i.codes && f.i.codes.length) keys.push('ki');
  if (f.c.codes && f.c.codes.length) keys.push('kc');
  if (f.o.code) keys.push('ko');
  if (f.underlying) keys.push('u');
  if (f.time) keys.push('t');
  for (const n of f.numbers || []) keys.push(n.key);
  return keys;
}

function trialKeys(item) {
  const t = item.trial || {};
  const keys = ['design', 'population', 'arm_missing', 'outcome_missing'];
  if (t.condition) { keys.push('condition'); if (t.condition.code) keys.push('kcond'); }
  if (t.n) keys.push('n');
  if (t.registration) keys.push('reg');
  for (const a of t.arms || []) keys.push(`arm:${a.id}`);
  for (const o of t.outcomes || []) keys.push(`outcome:${o.id}`);
  for (const s of t.subgroups || []) keys.push(`subgroup:${s.id}`);
  return keys;
}

function trialPartName(item, key) {
  if (TRIAL_NAME[key]) return TRIAL_NAME[key];
  const [kind, id] = key.split(':');
  const t = item.trial || {};
  const list = kind === 'arm' ? t.arms : kind === 'outcome' ? t.outcomes : t.subgroups;
  const hit = (list || []).find((x) => x.id === id);
  return `${kind === 'arm' ? 'group' : kind} “${hit ? hit.name : id}”`;
}

const emptyFinding = () => ({ rating: null, wrong: [], no_result: false, worth: null, note: '' });

export const TRIAL_UI = {
  keys: 'Keys: 1 2 3 answer the highlighted block · Y N U worth having · J K next and previous block · Enter next trial · B back',
  empty(item) {
    return {
      glance: { rating: null, wrong: [], note: '' },
      findings: Object.fromEntries(item.findings.map((f) => [f.id, emptyFinding()])),
      missing: { rating: null, text: '' },
    };
  },
  /** A stored answer (or a draft) as a complete draft for this item; unknown keys are dropped. */
  fromAnswer(a, item) {
    const d = TRIAL_UI.empty(item);
    if (!a || typeof a !== 'object') return d;
    if (a.glance) {
      const allowed = new Set(trialKeys(item));
      d.glance = {
        rating: READ.includes(a.glance.rating) ? a.glance.rating : null,
        wrong: Array.isArray(a.glance.wrong) ? a.glance.wrong.filter((k) => allowed.has(k)) : [],
        note: a.glance.note ?? '',
      };
    }
    for (const f of item.findings) {
      const x = a.findings && a.findings[f.id];
      if (!x) continue;
      const allowed = new Set(findingKeys(f));
      d.findings[f.id] = {
        rating: READ.includes(x.rating) ? x.rating : null,
        wrong: Array.isArray(x.wrong) ? x.wrong.filter((k) => allowed.has(k)) : [],
        no_result: Boolean(x.no_result),
        worth: WORTH.includes(x.worth) ? x.worth : null,
        note: x.note ?? '',
      };
    }
    if (a.missing) d.missing = { rating: MISSING.includes(a.missing.rating) ? a.missing.rating : null, text: a.missing.text ?? '' };
    return d;
  },
  /** First thing still to do, with the number of its block (0 = the trial). */
  validate(d, item) {
    const g = d.glance;
    if (!g.rating) return need('Answer block 1, the trial.', 0);
    if (g.rating === 'not correct' && !g.wrong.length) return need('Block 1: click each box that is wrong, or mark that a group or an outcome is missing.', 0);
    if (g.rating !== 'correct' && !filled(g.note)) return need('Block 1: write what is wrong or why you are unsure (required).', 0);
    for (let k = 0; k < item.findings.length; k++) {
      const f = item.findings[k];
      const x = d.findings[f.id];
      const name = `Finding ${letterOf(f.id)}`;
      if (!x.rating) return need(`${name}: choose all correct, something is wrong, or unsure.`, k + 1);
      if (x.rating === 'not correct' && !x.wrong.length && !x.no_result) return need(`${name}: click each box that is wrong, or tick the box below them.`, k + 1);
      if (x.rating !== 'correct' && !filled(x.note)) return need(`${name}: write what is wrong or why you are unsure (required).`, k + 1);
      if (x.rating !== 'not correct' && !x.worth) return need(`${name}: say whether it is worth having.`, k + 1);
    }
    const last = item.findings.length + 1;
    if (!d.missing.rating) return need('Answer the last block, anything missing.', last);
    if (d.missing.rating !== 'no' && !filled(d.missing.text)) {
      return need(d.missing.rating === 'yes' ? 'Last block: say which result is missing (required).' : 'Last block: say why you are unsure (required).', last);
    }
    return OK;
  },
  finalize(d, item) {
    const findings = {};
    for (const f of item.findings) {
      const x = d.findings[f.id];
      const bad = x.rating === 'not correct';
      findings[f.id] = {
        rating: x.rating,
        wrong: x.rating === 'correct' ? [] : x.wrong.slice().sort((a, b) => FINDING_ORDER.indexOf(a) - FINDING_ORDER.indexOf(b)),
        no_result: bad ? Boolean(x.no_result) : false,
        worth: bad ? null : x.worth,
        note: x.rating === 'correct' ? '' : String(x.note || '').trim(),
      };
    }
    const g = d.glance;
    return {
      glance: { rating: g.rating, wrong: g.rating === 'correct' ? [] : g.wrong.slice().sort(), note: g.rating === 'correct' ? '' : String(g.note || '').trim() },
      findings,
      missing: { rating: d.missing.rating, text: d.missing.rating === 'no' ? '' : String(d.missing.text || '').trim() },
    };
  },
  mount: mountTrial,
};

// ---- small building blocks ------------------------------------------------------------------

function choiceRow(values, labels, colors, keys, onPick) {
  const buttons = values.map((value, i) => h('button', {
    type: 'button', class: 'choice', 'data-value': value, 'aria-pressed': 'false', onclick: () => onPick(value),
  }, keys[i] ? h('kbd', {}, keys[i]) : null, h('span', {}, labels[value])));
  return {
    el: h('div', { class: 'choices', role: 'group' }, buttons),
    set(selected, disabled = false) {
      for (const b of buttons) {
        const on = b.dataset.value === selected;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
        b.style.setProperty('--sel', colors[b.dataset.value] || 'var(--blue)');
        b.disabled = disabled;
      }
    },
  };
}

function textField(labelText, maxLength, onInput) {
  const input = h('input', { type: 'text', maxlength: String(maxLength), autocomplete: 'off' });
  input.addEventListener('input', () => onInput(input.value));
  const name = h('span', { class: 'field-name' }, labelText);
  const hint = h('span', { class: 'field-hint' });
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, name, ' ', hint), input);
  return {
    el,
    set(value) { if (input.value !== value) input.value = value; },
    name(text) { name.textContent = text; },
    hint(text, required = false) { hint.textContent = text; el.classList.toggle('required', required); },
  };
}

/** A set of boxes that toggle a key in one "wrong" list. */
function markers(getDraft, onToggle) {
  const all = [];
  return {
    /** One box: a button that marks `key` as wrong. */
    box(key, cls, what, ...children) {
      const el = h('button', {
        type: 'button', class: `mk ${cls || ''}`, 'data-key': key, 'aria-pressed': 'false', title: `Click if ${what} is wrong`,
        onclick: () => onToggle(key),
      }, children);
      all.push(el);
      return el;
    },
    paint() {
      const wrong = getDraft().wrong;
      for (const el of all) {
        const on = wrong.includes(el.dataset.key);
        el.classList.toggle('wrong', on);
        el.setAttribute('aria-pressed', String(on));
      }
    },
  };
}

const label = (text) => h('span', { class: 'mk-label' }, text);
const sub = (text) => (text ? h('span', { class: 'part-sub' }, text) : null);
const badgeHead = (badge, name) => h('span', { class: 'part-head' }, h('span', { class: 'badge' }, badge), h('span', { class: 'part-label' }, name));
const codeText = (codes) => [h('span', { class: 'code-as' }, 'coded as '), codes.map((c, i) => [i ? ' + ' : '', h('b', {}, c.name), ` · ${c.vocabulary}`])];
const noCode = () => h('span', { class: 'no-code' }, 'no standard name assigned');

// ---- the abstract, with the sentences the findings were read from --------------------------------

function buildAbstract(item) {
  const marks = []; // {el, ids}
  const paras = item.abstract.map((sec, k) => {
    const spans = [];
    for (const f of item.findings) {
      for (const sp of [f.span, ...(f.other_spans || [])]) {
        if (sp && sp[0] === k && sp[2] > sp[1]) spans.push({ a: sp[1], b: sp[2], id: f.id });
      }
    }
    const cuts = [...new Set([0, sec.text.length, ...spans.flatMap((s) => [s.a, s.b])])]
      .filter((x) => x >= 0 && x <= sec.text.length).sort((x, y) => x - y);
    const nodes = [];
    for (let j = 0; j + 1 < cuts.length; j++) {
      const text = sec.text.slice(cuts[j], cuts[j + 1]);
      const ids = spans.filter((s) => s.a <= cuts[j] && s.b >= cuts[j + 1]).map((s) => s.id);
      if (!ids.length) { nodes.push(text); continue; }
      const el = h('span', { class: 'ev', 'data-f': ids.join(' ') }, text);
      marks.push({ el, ids });
      nodes.push(el);
    }
    return h('p', {}, sec.label ? h('span', { class: 'sec-label' }, `${sec.label} `) : null, nodes);
  });
  return { el: h('div', { class: 'abstract-text' }, paras), marks };
}

// ---- the screen -------------------------------------------------------------------------------

/** st: {draft, changed()}. Returns {el, refresh(), key(k), focusUnit(i)}. */
function mountTrial(item, st) {
  const units = []; // {el, kind, id, complete(), refresh(), pick()}
  let active = 0;

  const abstract = buildAbstract(item);
  const pane = h('aside', { class: 'abstract-pane' },
    h('h2', { class: 'pane-title' }, 'Abstract'),
    abstract.el,
    item.findings.length ? h('p', { class: 'pane-note' }, 'Underlined: the sentences the findings were read from. Point at a finding to see its sentence.') : null);

  function paintMarks() {
    const unit = units[active];
    const on = unit && unit.kind === 'finding' ? unit.id : null;
    for (const m of abstract.marks) m.el.classList.toggle('on', on != null && m.ids.includes(on));
    if (on == null) return;
    const first = abstract.marks.find((m) => m.ids.includes(on));
    if (!first || pane.scrollHeight <= pane.clientHeight + 4) return;
    const box = pane.getBoundingClientRect();
    const r = first.el.getBoundingClientRect();
    if (r.top < box.top + 40 || r.bottom > box.bottom - 20) pane.scrollTop += r.top - box.top - box.height / 3;
  }

  function setActive(i, { scroll = false } = {}) {
    active = Math.max(0, Math.min(units.length - 1, i));
    units.forEach((u, k) => u.el.classList.toggle('active', k === active));
    paintMarks();
    if (scroll) {
      const el = units[active].el;
      const r = el.getBoundingClientRect();
      const top = (document.getElementById('topbar')?.getBoundingClientRect().bottom || 0) + 12;
      if (r.top < top || r.bottom > window.innerHeight - 90) window.scrollBy({ top: r.top - top - 8, behavior: 'smooth' });
    }
  }

  const hover = (id, on) => { for (const m of abstract.marks) if (m.ids.includes(id)) m.el.classList.toggle('hover', on); };
  for (const m of abstract.marks) {
    m.el.addEventListener('click', () => {
      const i = units.findIndex((u) => u.kind === 'finding' && u.id === m.ids[0]);
      if (i >= 0) setActive(i, { scroll: true });
    });
  }

  function addUnit(unit) {
    const index = units.length;
    units.push(unit);
    unit.el.addEventListener('pointerdown', () => setActive(index));
    unit.el.addEventListener('focusin', () => { if (active !== index) setActive(index); });
    return unit;
  }

  /** Toggle a key in a draft's wrong list; marking something makes the rating "something is wrong". */
  const toggleIn = (d, key) => {
    const set = new Set(d.wrong);
    if (set.has(key)) set.delete(key); else set.add(key);
    d.wrong = [...set];
    if (d.wrong.length && d.rating !== 'unsure') d.rating = 'not correct';
    st.changed();
  };
  const setRating = (d, v) => {
    d.rating = v;
    if (v === 'correct') { d.wrong = []; if ('no_result' in d) d.no_result = false; }
    st.changed();
  };

  // 1. the trial
  const t = item.trial || {};
  const G = () => st.draft.glance;
  const gm = markers(G, (key) => toggleIn(G(), key));
  const rowOf = (name, ...content) => [h('dt', {}, name), h('dd', {}, content)];
  const muted = (text) => h('span', { class: 'muted not-read' }, text);
  const name = (text) => h('span', { class: 'chip-name' }, text);
  const tag = (text) => (text ? h('span', { class: 'chip-tag' }, text) : null);
  const chip = (key, what, text, ...tags) => gm.box(key, 'mk-chip', what, name(text), tags.map(tag));
  const rows = [
    rowOf('Design', chip('design', 'the design', (t.design && t.design.text) || 'not read', t.design && t.design.source)),
    rowOf('Condition', t.condition
      ? [chip('condition', 'the condition', t.condition.text),
        t.condition.code ? gm.box('kcond', 'mk-chip mk-code', 'the standard name of the condition', codeText([t.condition.code])) : noCode()]
      : muted('not read from the abstract')),
    rowOf('Participants', chip('population', 'the description of the participants', t.population || 'not read from the abstract')),
    rowOf('Number', t.n ? chip('n', 'the number of participants', `${count(t.n.value)} participants`, t.n.source) : muted('number of participants not read')),
    rowOf('Groups', (t.arms || []).map((a) => chip(`arm:${a.id}`, 'this group', a.name, a.role, a.n != null ? `n = ${count(a.n)}` : 'size not read', a.from_registry ? 'from the trial registry' : '')),
      gm.box('arm_missing', 'mk-chip mk-add', 'the list of groups (one is missing)', 'a group is missing')),
    rowOf('Outcomes', (t.outcomes || []).map((o) => chip(`outcome:${o.id}`, 'this outcome', o.name, o.primary ? 'primary' : '', o.safety ? 'safety' : '')),
      gm.box('outcome_missing', 'mk-chip mk-add', 'the list of outcomes (one is missing)', 'an outcome is missing')),
    (t.subgroups || []).length ? rowOf('Subgroups', t.subgroups.map((s) => chip(`subgroup:${s.id}`, 'this subgroup', s.name, s.n != null ? `n = ${count(s.n)}` : ''))) : null,
    rowOf('Registration', t.registration
      ? chip('reg', 'the registration number', t.registration.ids.join(', '), t.registration.source)
      : muted('no registration number found')),
  ];
  const glanceChoices = choiceRow(READ, READ_LABEL, COLOR, ['1', '2', '3'], (v) => setRating(G(), v));
  const glanceSummary = h('span', { class: 'summary' });
  const glanceNote = textField('What is wrong', 800, (v) => { G().note = v; st.changed(); });
  const glanceWrong = h('div', { class: 'wrong-box' },
    h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Marked:'), glanceSummary),
    h('div', { class: 'fields' }, glanceNote.el));
  const glanceDone = () => {
    const g = G();
    if (!g.rating) return false;
    if (g.rating === 'correct') return true;
    return filled(g.note) && (g.rating === 'unsure' || g.wrong.length > 0);
  };
  const glance = addUnit({
    kind: 'glance', id: 'glance',
    el: h('section', { class: 'block unit', 'data-rating': '' },
      h('h2', { class: 'block-title' }, h('span', { class: 'step' }, '1'), 'The trial'),
      h('p', { class: 'muted small' }, 'Everything read about the trial as a whole. Click a box to mark it as wrong.'),
      h('dl', { class: 'tfields' }, rows),
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Is every box what the abstract states?')),
      glanceChoices.el, glanceWrong),
    complete: glanceDone,
    refresh() {
      const g = G();
      glanceChoices.set(g.rating);
      gm.paint();
      glanceWrong.hidden = !g.rating || g.rating === 'correct';
      glanceSummary.textContent = g.wrong.length
        ? g.wrong.map((k) => trialPartName(item, k)).join('; ')
        : (g.rating === 'unsure' ? 'click a box above if one of them is the doubt (optional)' : 'click each box that is wrong above');
      glanceSummary.classList.toggle('muted', !g.wrong.length);
      glanceNote.set(g.note);
      glanceNote.name(g.rating === 'unsure' ? 'Why you are unsure' : 'What is wrong');
      glanceNote.hint('(required)', true);
      glance.el.dataset.rating = g.rating || '';
    },
    pick(n) { if (READ[n]) { setRating(G(), READ[n]); return true; } return false; },
  });

  // 2. the findings
  const findingUnits = item.findings.map((f) => {
    const x = () => st.draft.findings[f.id];
    const fm = markers(x, (key) => toggleIn(x(), key));
    const text = (...s) => h('span', { class: 'part-text' }, s);
    // The detail line is shown only when it says something the outcome's name does not.
    const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
    const named = new Set(words(f.o.text));
    const detail = f.o.detail && f.o.detail.length > 6 && !words(f.o.detail).every((w) => named.has(w)) ? f.o.detail : '';
    const cell = (main, codes, key, what) => h('div', { class: 'cell' }, main,
      key ? (codes && codes.length ? fm.box(key, 'mk-code', what, codeText(codes)) : noCode()) : null);
    const pico = [
      cell(fm.box('p', 'part', 'the population', badgeHead('P', 'Population'), text(f.p.text),
        sub(f.p.subgroup ? `subgroup${f.p.n != null ? `, n = ${count(f.p.n)}` : ''}` : ''), sub((f.p.tags || []).length ? `age group: ${f.p.tags.join(', ')}` : ''))),
      cell(fm.box('i', 'part', 'the intervention', badgeHead('I', 'Intervention'), text(f.i.text), sub(f.i.n != null ? `n = ${count(f.i.n)}` : '')),
        f.i.codes, 'ki', 'the standard name of the intervention'),
      cell(fm.box('c', 'part', 'the comparator', badgeHead('C', 'Comparator'), text(f.c.text), sub(f.c.n != null ? `n = ${count(f.c.n)}` : ''), sub(f.c.where)),
        f.c.codes, 'kc', 'the standard name of the comparator'),
      cell(fm.box('o', 'part', 'the outcome', badgeHead('O', 'Outcome'), text(f.o.text), sub(detail), sub(f.o.kind === 'safety' ? 'safety outcome' : '')),
        f.o.code ? [f.o.code] : [], 'ko', 'the standard name of the outcome'),
    ];
    const fact = (key, what, title, ...content) => fm.box(key, 'fact', what, label(title), content);
    const facts = [
      fact('d', 'the direction', 'Direction', text(h('span', { class: 'arrow', 'aria-hidden': 'true' }, ARROW[f.direction] || ''), ' ', f.result)),
      f.underlying ? fact('u', 'this reading of the measure', 'The measure itself', h('span', { class: 'fact-text' }, f.underlying)) : null,
      f.time ? fact('t', 'the time point', 'Time point', text(f.time)) : null,
      fact('h', 'this', 'Primary outcome', text(f.primary ? 'Yes' : 'No'), sub(f.primary ? 'named as primary, or what the conclusions lead with' : '')),
      fact('s', 'this', 'How the abstract words it', h('span', { class: 'fact-text' }, (f.stated && f.stated.text) || 'not classified'), sub(f.stated && f.stated.borderline ? 'borderline significance' : '')),
    ].filter(Boolean);
    const numbers = (f.numbers || []).map((n) => fact(n.key, 'this number', n.label, h('span', { class: 'fact-text' }, n.text)));
    const sentence = f.sentence;
    const quoteBody = f.phrase && f.phrase[1] > f.phrase[0]
      ? [sentence.slice(0, f.phrase[0]), h('b', {}, sentence.slice(f.phrase[0], f.phrase[1])), sentence.slice(f.phrase[1])]
      : [sentence];
    const quote = sentence ? fm.box('q', 'mk-quote', 'the sentence', label('Sentence it was read from'), h('span', { class: 'quote-text' }, quoteBody)) : null;

    const read = choiceRow(READ, READ_LABEL, COLOR, ['1', '2', '3'], (v) => setRating(x(), v));
    const worth = choiceRow(WORTH, WORTH_LABEL, COLOR, ['Y', 'N', 'U'], (v) => { x().worth = v; st.changed(); });
    const wrongSummary = h('span', { class: 'summary' });
    const noResult = h('input', { type: 'checkbox' });
    noResult.addEventListener('change', () => {
      const d = x();
      d.no_result = noResult.checked;
      if (d.no_result && d.rating !== 'unsure') d.rating = 'not correct';
      st.changed();
    });
    const note = textField('What is wrong', 800, (v) => { x().note = v; st.changed(); });
    const wrongBox = h('div', { class: 'wrong-box' },
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Marked:'), wrongSummary),
      h('label', { class: 'check' }, noResult, h('span', {}, 'The sentence does not report a result between these two groups')),
      h('div', { class: 'fields' }, note.el));
    const worthLine = h('div', { class: 'row-line worth-line' }, h('span', { class: 'q-label' }, 'Worth having in an evidence base?'), worth.el);
    const state = h('span', { class: 'f-state' });
    const el = h('article', { class: 'finding unit', 'data-id': f.id },
      h('div', { class: 'f-head' }, h('span', { class: 'f-tag' }, `Finding ${letterOf(f.id)}`), state),
      h('div', { class: 'pico' }, pico),
      h('div', { class: 'facts' }, facts),
      numbers.length ? h('div', { class: 'facts' }, numbers) : h('p', { class: 'no-numbers' }, 'No number was read for this comparison.'),
      quote,
      h('div', { class: 'f-controls' },
        h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Is every box right?'), read.el),
        wrongBox, worthLine));
    el.addEventListener('mouseenter', () => hover(f.id, true));
    el.addEventListener('mouseleave', () => hover(f.id, false));
    const complete = () => {
      const d = x();
      if (!d.rating) return false;
      if (d.rating === 'correct') return Boolean(d.worth);
      if (!filled(d.note)) return false;
      if (d.rating === 'not correct') return d.wrong.length > 0 || d.no_result;
      return Boolean(d.worth);
    };
    return addUnit({
      kind: 'finding', id: f.id, el, complete,
      refresh() {
        const d = x();
        read.set(d.rating);
        fm.paint();
        const showWrong = d.rating === 'not correct' || d.rating === 'unsure';
        wrongBox.hidden = !showWrong;
        wrongSummary.textContent = d.wrong.length
          ? d.wrong.slice().sort((a, b) => FINDING_ORDER.indexOf(a) - FINDING_ORDER.indexOf(b)).map((k) => FINDING_NAME[k]).join('; ')
          : (d.rating === 'unsure' ? 'click a box above if one of them is the doubt (optional)' : 'click each box that is wrong above');
        wrongSummary.classList.toggle('muted', !d.wrong.length);
        noResult.checked = d.no_result;
        note.set(d.note);
        note.name(d.rating === 'unsure' ? 'Why you are unsure' : 'What is wrong');
        note.hint('(required)', true);
        worthLine.hidden = d.rating === 'not correct';
        worth.set(d.worth);
        state.textContent = complete() ? '✓' : '';
        el.classList.toggle('done', complete());
        el.dataset.rating = d.rating || '';
      },
      pick(n) { if (!READ[n]) return false; setRating(x(), READ[n]); return true; },
      worth(v) {
        if (x().rating === 'not correct') return false;
        x().worth = v;
        st.changed();
        return true;
      },
    });
  });

  // 3. anything missing
  const none = item.findings.length === 0;
  const missChoices = choiceRow(MISSING, none ? { no: 'No, it states none', yes: 'Yes, it states one', unsure: 'Unsure' } : MISSING_LABEL,
    MISSING_COLOR, ['1', '2', '3'], (v) => { st.draft.missing.rating = v; st.changed(); });
  const missText = textField('Which result', 1000, (v) => { st.draft.missing.text = v; st.changed(); });
  const missing = addUnit({
    kind: 'missing', id: 'missing',
    el: h('section', { class: 'block unit' },
      h('h2', { class: 'block-title' }, h('span', { class: 'step' }, '3'), 'Anything missing'),
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, none
        ? 'Does the abstract state a result between two groups of the trial?'
        : 'Does the abstract state a result between two groups that is not in the list above?')),
      item.not_shown ? h('p', { class: 'muted small' }, `${item.not_shown} more finding${item.not_shown === 1 ? '' : 's'} read from this abstract ${item.not_shown === 1 ? 'is' : 'are'} not shown, to keep the list short. If you name a missing result, we check it against ${item.not_shown === 1 ? 'that one' : 'those'}.`) : null,
      missChoices.el, h('div', { class: 'fields' }, missText.el)),
    complete: () => Boolean(st.draft.missing.rating) && (st.draft.missing.rating === 'no' || filled(st.draft.missing.text)),
    refresh() {
      const m = st.draft.missing;
      missChoices.set(m.rating);
      missText.el.hidden = !m.rating || m.rating === 'no';
      missText.set(m.text);
      missText.name(m.rating === 'unsure' ? 'Why you are unsure' : 'Which result');
      missText.hint(m.rating === 'yes' ? '(required: outcome and groups, in a few words)' : '(required)', true);
    },
    pick(n) { if (MISSING[n]) { st.draft.missing.rating = MISSING[n]; st.changed(); return true; } return false; },
  });

  const findingsBlock = h('section', { class: 'block findings-block' },
    h('h2', { class: 'block-title' }, h('span', { class: 'step' }, '2'),
      none ? 'Findings read from the abstract' : `Findings read from the abstract (${item.findings.length})`),
    none
      ? h('p', { class: 'none-read' }, 'No finding was read from this abstract.')
      : h('p', { class: 'muted small' }, 'Each finding compares two groups on one outcome. Every box was written down by the program: click a box to mark it as wrong.'),
    findingUnits.map((u) => u.el));

  const meta = [item.journal, item.year].filter(Boolean).join(' · ');
  const el = h('div', { class: 'trial' },
    h('header', { class: 'trial-head' }, h('h1', { class: 'trial-title' }, item.title), meta ? h('p', { class: 'trial-meta' }, meta) : null),
    h('div', { class: 'trial-grid' }, pane, h('div', { class: 'read-pane' }, glance.el, findingsBlock, missing.el)));

  setActive(0);

  return {
    el,
    refresh() { for (const u of units) u.refresh(); },
    /** Move the highlight to block number i (as numbered by validate). */
    focusUnit(i) { setActive(i, { scroll: true }); },
    /** Keyboard: returns true when the key was used. */
    key(k) {
      const unit = units[active];
      if (k === 'j' || k === 'k') { setActive(active + (k === 'j' ? 1 : -1), { scroll: true }); return true; }
      let used = false;
      if (k === '1' || k === '2' || k === '3') used = unit.pick(Number(k) - 1);
      else if ((k === 'y' || k === 'n' || k === 'u') && unit.kind === 'finding') used = unit.worth({ y: 'yes', n: 'no', u: 'unsure' }[k]);
      if (used && unit.complete() && active + 1 < units.length) setActive(active + 1, { scroll: true });
      return used;
    },
  };
}
