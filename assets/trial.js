// The trial screen: the abstract on the left and, on the right, what was read from it, laid out as
// PICO, with the answer controls. Also when an answer is valid and the exact answer JSON that is
// saved (scripts/pull_ratings.py and scripts/score.py depend on these keys).
import { h } from './dom.js';

const OK = { ok: true, need: '', unit: -1 };
const need = (text, unit) => ({ ok: false, need: text, unit });
const filled = (s, n = 3) => String(s || '').trim().length >= n;

const COLOR = {
  correct: 'var(--green)', 'not correct': 'var(--red)', unsure: 'var(--amber)',
  yes: 'var(--green)', no: 'var(--red)',
};
const READ = ['correct', 'not correct', 'unsure'];
const READ_LABEL = { correct: 'Correct', 'not correct': 'Not correct', unsure: 'Unsure' };
const WORTH = ['yes', 'no', 'unsure'];
const WORTH_LABEL = { yes: 'Yes', no: 'No', unsure: 'Unsure' };
const MISSING = ['no', 'yes', 'unsure'];
const MISSING_LABEL = { no: 'Nothing is missing', yes: 'Something is missing', unsure: 'Unsure' };
const MISSING_COLOR = { no: 'var(--green)', yes: 'var(--red)', unsure: 'var(--amber)' };

/** The parts of a finding a rater can mark as wrong: key, badge, name in messages. */
export const PARTS = [
  ['p', 'P', 'population'], ['i', 'I', 'intervention'], ['c', 'C', 'comparator'], ['o', 'O', 'outcome'],
  ['d', 'Result', 'direction'], ['n', 'Numbers', 'numbers'],
];
const PART_NAME = Object.fromEntries(PARTS.map(([k, , name]) => [k, name]));
const ARROW = { higher: '▲', lower: '▼', no_difference: '＝', mixed: '▲▼' };

const emptyFinding = () => ({ rating: null, wrong: [], no_result: false, worth: null, note: '' });
const letterOf = (fid) => fid.slice(-1);

export const TRIAL_UI = {
  keys: 'Keys: 1 2 3 answer the highlighted block · Y N U worth having · J K next and previous block · Enter next trial · B back',
  empty(item) {
    return {
      glance: { rating: null, note: '' },
      findings: Object.fromEntries(item.findings.map((f) => [f.id, emptyFinding()])),
      missing: { rating: null, text: '' },
    };
  },
  /** A stored answer (or a draft) as a complete draft for this item; unknown keys are dropped. */
  fromAnswer(a, item) {
    const d = TRIAL_UI.empty(item);
    if (!a || typeof a !== 'object') return d;
    if (a.glance) d.glance = { rating: READ.includes(a.glance.rating) ? a.glance.rating : null, note: a.glance.note ?? '' };
    for (const f of item.findings) {
      const x = a.findings && a.findings[f.id];
      if (!x) continue;
      d.findings[f.id] = {
        rating: READ.includes(x.rating) ? x.rating : null,
        wrong: Array.isArray(x.wrong) ? x.wrong.filter((k) => k in PART_NAME) : [],
        no_result: Boolean(x.no_result),
        worth: WORTH.includes(x.worth) ? x.worth : null,
        note: x.note ?? '',
      };
    }
    if (a.missing) d.missing = { rating: MISSING.includes(a.missing.rating) ? a.missing.rating : null, text: a.missing.text ?? '' };
    return d;
  },
  /** First thing still to do, with the number of its block (0 = the trial at a glance). */
  validate(d, item) {
    if (!d.glance.rating) return need('Answer block 1, the trial at a glance.', 0);
    if (d.glance.rating === 'not correct' && !filled(d.glance.note)) return need('Block 1: say what is not correct (at least 3 characters).', 0);
    for (let k = 0; k < item.findings.length; k++) {
      const f = item.findings[k];
      const x = d.findings[f.id];
      const name = `Finding ${letterOf(f.id)}`;
      if (!x.rating) return need(`${name}: choose correct, not correct or unsure.`, k + 1);
      if (x.rating === 'not correct' && !x.wrong.length && !x.no_result && !filled(x.note)) {
        return need(`${name}: click the part that is wrong, tick the box, or write a note.`, k + 1);
      }
      if (x.rating !== 'not correct' && !x.worth) return need(`${name}: say whether it is worth having.`, k + 1);
    }
    const last = item.findings.length + 1;
    if (!d.missing.rating) return need('Answer the last block, anything missing.', last);
    if (d.missing.rating === 'yes' && !filled(d.missing.text)) return need('Last block: say which result is missing (at least 3 characters).', last);
    return OK;
  },
  finalize(d, item) {
    const findings = {};
    for (const f of item.findings) {
      const x = d.findings[f.id];
      const bad = x.rating === 'not correct';
      findings[f.id] = {
        rating: x.rating,
        wrong: x.rating === 'correct' ? [] : x.wrong.slice().sort(),
        no_result: bad ? Boolean(x.no_result) : false,
        worth: bad ? null : x.worth,
        note: x.rating === 'correct' ? '' : String(x.note || '').trim(),
      };
    }
    return {
      glance: { rating: d.glance.rating, note: d.glance.rating === 'correct' ? '' : String(d.glance.note || '').trim() },
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

function textField(label, maxLength, onInput) {
  const input = h('input', { type: 'text', maxlength: String(maxLength), autocomplete: 'off' });
  input.addEventListener('input', () => onInput(input.value));
  const hint = h('span', { class: 'field-hint' });
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, ' ', hint), input);
  return {
    el,
    set(value) { if (input.value !== value) input.value = value; },
    hint(text, required = false) { hint.textContent = text; el.classList.toggle('required', required); },
  };
}

const count = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));

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
  const units = []; // {el, kind, id, complete()}
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

  // 1. the trial at a glance
  const t = item.trial || {};
  const glanceChoices = choiceRow(READ, READ_LABEL, COLOR, ['1', '2', '3'], (v) => {
    st.draft.glance.rating = v;
    st.changed();
  });
  const glanceNote = textField('What is not correct', 600, (v) => { st.draft.glance.note = v; st.changed(); });
  const people = [t.population].filter(Boolean);
  const glance = addUnit({
    kind: 'glance', id: 'glance',
    el: h('section', { class: 'block unit' },
      h('h2', { class: 'block-title' }, h('span', { class: 'step' }, '1'), 'The trial at a glance'),
      h('dl', { class: 'glance' },
        h('dt', {}, h('span', { class: 'badge' }, 'P'), 'Participants'),
        h('dd', {}, people.length ? people.join(' · ') : h('span', { class: 'muted' }, 'not read from the abstract'),
          t.n != null ? h('span', { class: 'n' }, `${count(t.n)} participants`) : h('span', { class: 'n muted' }, 'number of participants not read')),
        h('dt', {}, h('span', { class: 'badge' }, 'I'), h('span', { class: 'badge' }, 'C'), 'Groups'),
        h('dd', {}, (t.arms || []).length
          ? h('ul', { class: 'arms' }, t.arms.map((a) => h('li', {}, a.name, a.n != null ? h('span', { class: 'n' }, `n = ${count(a.n)}`) : null)))
          : h('span', { class: 'muted' }, 'no groups read from the abstract'))),
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Are the participants, the groups and their sizes what the abstract states?')),
      glanceChoices.el, h('div', { class: 'fields' }, glanceNote.el)),
    complete: () => Boolean(st.draft.glance.rating) && (st.draft.glance.rating !== 'not correct' || filled(st.draft.glance.note)),
    refresh() {
      const g = st.draft.glance;
      glanceChoices.set(g.rating);
      glanceNote.el.hidden = !g.rating || g.rating === 'correct';
      glanceNote.set(g.note);
      glanceNote.hint(g.rating === 'not correct' ? '(required)' : '(optional)', g.rating === 'not correct');
    },
    pick(n) { if (READ[n]) { st.draft.glance.rating = READ[n]; st.changed(); return true; } return false; },
  });

  // 2. the findings
  const findingUnits = item.findings.map((f) => {
    const x = () => st.draft.findings[f.id];
    const togglePart = (key) => {
      const d = x();
      const set = new Set(d.wrong);
      if (set.has(key)) set.delete(key); else set.add(key);
      d.wrong = [...set];
      if (d.wrong.length && d.rating !== 'unsure') d.rating = 'not correct';
      st.changed();
    };
    const part = (key, badge, label, body) => h('button', {
      type: 'button', class: `part part-${key}`, 'data-part': key, 'aria-pressed': 'false',
      title: `Click if the ${PART_NAME[key]} is wrong`, onclick: () => togglePart(key),
    }, h('span', { class: 'part-head' }, h('span', { class: 'badge' }, badge), h('span', { class: 'part-label' }, label), h('span', { class: 'part-x', 'aria-hidden': 'true' }, '✗')), body);
    const sub = (text) => (text ? h('span', { class: 'part-sub' }, text) : null);
    const pBody = [h('span', { class: 'part-text' }, f.p.text), sub(f.p.subgroup ? `subgroup${f.p.n != null ? `, n = ${count(f.p.n)}` : ''}` : '')];
    const iBody = [h('span', { class: 'part-text' }, f.i.text), sub(f.i.n != null ? `n = ${count(f.i.n)}` : '')];
    const cBody = [h('span', { class: 'part-text' }, f.c.text), sub(f.c.n != null ? `n = ${count(f.c.n)}` : '')];
    // The detail line is shown only when it says something the outcome's name does not.
    const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
    const named = new Set(words(f.o.text));
    const detail = f.o.detail && f.o.detail.length > 6 && !words(f.o.detail).every((w) => named.has(w)) ? f.o.detail : '';
    const oBody = [h('span', { class: 'part-text' }, f.o.text), sub(detail), sub(f.o.kind === 'safety' ? 'safety outcome' : '')];
    const parts = [
      part('p', 'P', 'Population', pBody), part('i', 'I', 'Intervention', iBody),
      part('c', 'C', 'Comparator', cBody), part('o', 'O', 'Outcome', oBody),
    ];
    const dPart = part('d', 'Result', '', [h('span', { class: 'part-text' }, h('span', { class: 'arrow', 'aria-hidden': 'true' }, ARROW[f.direction] || ''), ' ', f.result)]);
    const nPart = f.numbers && f.numbers.length
      ? part('n', 'Numbers', '', [h('span', { class: 'num-list' }, f.numbers.map((n) => h('span', { class: 'num' }, h('span', { class: 'num-label' }, `${n.label}: `), n.text)))])
      : null;
    const all = [...parts, dPart, nPart].filter(Boolean);

    const read = choiceRow(READ, READ_LABEL, COLOR, ['1', '2', '3'], (v) => {
      const d = x();
      d.rating = v;
      if (v === 'correct') { d.wrong = []; d.no_result = false; }
      st.changed();
    });
    const worth = choiceRow(WORTH, WORTH_LABEL, COLOR, ['Y', 'N', 'U'], (v) => { x().worth = v; st.changed(); });
    const wrongSummary = h('span', { class: 'summary' });
    const noResult = h('input', { type: 'checkbox' });
    noResult.addEventListener('change', () => {
      const d = x();
      d.no_result = noResult.checked;
      if (d.no_result && d.rating !== 'unsure') d.rating = 'not correct';
      st.changed();
    });
    const note = textField('Note', 600, (v) => { x().note = v; st.changed(); });
    const wrongBox = h('div', { class: 'wrong-box' },
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'What is wrong:'), wrongSummary),
      h('label', { class: 'check' }, noResult, h('span', {}, 'The sentence does not report a result between these two groups')),
      h('div', { class: 'fields' }, note.el));
    const worthLine = h('div', { class: 'row-line worth-line' }, h('span', { class: 'q-label' }, 'Worth having in an evidence base?'), worth.el);
    const state = h('span', { class: 'f-state' });
    const el = h('article', { class: 'finding unit', 'data-id': f.id },
      h('div', { class: 'f-head' }, h('span', { class: 'f-tag' }, `Finding ${letterOf(f.id)}`), state),
      h('div', { class: 'pico' }, parts),
      h('div', { class: 'result-row' }, dPart, nPart),
      f.sentence ? h('blockquote', { class: 'quote', title: 'The sentence this finding was read from. Click to show all of it.', onclick: (e) => e.currentTarget.classList.toggle('open') }, f.sentence) : null,
      h('div', { class: 'f-controls' },
        h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Read correctly?'), read.el),
        wrongBox, worthLine));
    el.addEventListener('mouseenter', () => hover(f.id, true));
    el.addEventListener('mouseleave', () => hover(f.id, false));
    const complete = () => {
      const d = x();
      if (!d.rating) return false;
      if (d.rating === 'not correct') return d.wrong.length > 0 || d.no_result || filled(d.note);
      return Boolean(d.worth);
    };
    return addUnit({
      kind: 'finding', id: f.id, el, complete,
      refresh() {
        const d = x();
        read.set(d.rating);
        for (const b of all) {
          const on = d.wrong.includes(b.dataset.part);
          b.classList.toggle('wrong', on);
          b.setAttribute('aria-pressed', String(on));
        }
        const showWrong = d.rating === 'not correct' || d.rating === 'unsure';
        wrongBox.hidden = !showWrong;
        wrongSummary.textContent = d.wrong.length
          ? d.wrong.slice().sort((a, b) => PARTS.findIndex((p) => p[0] === a) - PARTS.findIndex((p) => p[0] === b)).map((k) => PART_NAME[k]).join(', ')
          : (d.rating === 'unsure' ? 'click a part above if one of them is the doubt (optional)' : 'click the part that is wrong above');
        wrongSummary.classList.toggle('muted', !d.wrong.length);
        noResult.checked = d.no_result;
        note.set(d.note);
        note.hint('(optional)');
        worthLine.hidden = d.rating === 'not correct';
        worth.set(d.worth);
        state.textContent = complete() ? '✓' : '';
        el.classList.toggle('done', complete());
        el.dataset.rating = d.rating || '';
      },
      pick(n) {
        if (!READ[n]) return false;
        const d = x();
        d.rating = READ[n];
        if (d.rating === 'correct') { d.wrong = []; d.no_result = false; }
        st.changed();
        return true;
      },
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
    complete: () => Boolean(st.draft.missing.rating) && (st.draft.missing.rating !== 'yes' || filled(st.draft.missing.text)),
    refresh() {
      const m = st.draft.missing;
      missChoices.set(m.rating);
      missText.el.hidden = !m.rating || m.rating === 'no';
      missText.set(m.text);
      missText.hint(m.rating === 'yes' ? '(required: outcome and groups, in a few words)' : '(optional)', m.rating === 'yes');
    },
    pick(n) { if (MISSING[n]) { st.draft.missing.rating = MISSING[n]; st.changed(); return true; } return false; },
  });

  const findingsBlock = h('section', { class: 'block findings-block' },
    h('h2', { class: 'block-title' }, h('span', { class: 'step' }, '2'),
      none ? 'Findings read from the abstract' : `Findings read from the abstract (${item.findings.length})`),
    none
      ? h('p', { class: 'none-read' }, 'No finding was read from this abstract.')
      : h('p', { class: 'muted small' }, 'Each finding compares two groups on one outcome. Click a part to mark it as wrong.'),
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
