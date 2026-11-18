// The statements screen (second sheet): the abstract on the left and, on the right, the short statements another
// program read from it, one compact row each with two questions. Also when an answer is valid and the exact answer
// JSON that is saved (scripts/pull_ratings.py and scripts/score.py depend on these keys).
// The sheet is shown only when config.js sets STATEMENTS_SHEET = true.
import { h } from './dom.js';

const OK = { ok: true, need: '', unit: -1 };
const need = (text, unit) => ({ ok: false, need: text, unit });
const filled = (s, n = 3) => String(s || '').trim().length >= n;
const ANSWERS = ['yes', 'no', 'unsure'];
const LABEL = { yes: 'Yes', no: 'No', unsure: 'Unsure' };
const COLOR = { yes: 'var(--green)', no: 'var(--red)', unsure: 'var(--amber)' };
const NOTE_MAX = 600;

/** "T07s3" -> "3" */
const numberOf = (sid) => sid.slice(sid.lastIndexOf('s') + 1);
const emptyStatement = () => ({ support: null, result: null, note: '' });
/** Question B is not asked when the abstract does not support the statement. */
const asksResult = (x) => x.support !== 'no';
const complete = (x) => Boolean(x.support) && (!asksResult(x) || Boolean(x.result)) && (x.support !== 'unsure' || filled(x.note));

export const STATEMENTS_UI = {
  keys: 'Keys: 1 2 3 supported: yes, no, unsure · Y N U a result of this trial · J K next and previous statement · Enter next trial · B back',
  empty(item) {
    return { statements: Object.fromEntries(item.statements.map((s) => [s.id, emptyStatement()])) };
  },
  /** A stored answer (or a draft) as a complete draft for this item; unknown keys are dropped. */
  fromAnswer(a, item) {
    const d = STATEMENTS_UI.empty(item);
    if (!a || typeof a !== 'object' || !a.statements) return d;
    for (const s of item.statements) {
      const x = a.statements[s.id];
      if (!x) continue;
      d.statements[s.id] = {
        support: ANSWERS.includes(x.support) ? x.support : null,
        result: ANSWERS.includes(x.result) ? x.result : null,
        note: x.note ?? '',
      };
    }
    return d;
  },
  /** First thing still to do, with the number of its row (0 = the first statement). */
  validate(d, item) {
    for (let k = 0; k < item.statements.length; k++) {
      const s = item.statements[k];
      const x = d.statements[s.id];
      const name = `Statement ${numberOf(s.id)}`;
      if (!x.support) return need(`${name}: say whether the abstract supports it.`, k);
      if (x.support === 'unsure' && !filled(x.note)) return need(`${name}: write why you are unsure (required).`, k);
      if (asksResult(x) && !x.result) return need(`${name}: say whether it is a result of this trial.`, k);
    }
    return OK;
  },
  finalize(d, item) {
    const statements = {};
    for (const s of item.statements) {
      const x = d.statements[s.id];
      statements[s.id] = { support: x.support, result: asksResult(x) ? x.result : null, note: String(x.note || '').trim().slice(0, NOTE_MAX) };
    }
    return { statements };
  },
  mount: mountStatements,
};

function choiceRow(keys, onPick) {
  const buttons = ANSWERS.map((value, i) => h('button', {
    type: 'button', class: 'choice', 'data-value': value, 'aria-pressed': 'false', onclick: () => onPick(value),
  }, h('kbd', {}, keys[i]), h('span', {}, LABEL[value])));
  return {
    el: h('div', { class: 'choices', role: 'group' }, buttons),
    set(selected, disabled = false) {
      for (const b of buttons) {
        const on = !disabled && b.dataset.value === selected;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
        b.style.setProperty('--sel', COLOR[b.dataset.value]);
        b.disabled = disabled;
      }
    },
  };
}

/** The abstract with the sentences the statements were read from; the title is marked when a statement came from it. */
function buildSource(item) {
  const marks = []; // {el, ids}
  const paras = item.abstract.map((sec, k) => {
    const spans = item.statements
      .filter((s) => s.span && s.span[0] === k && s.span[2] > s.span[1])
      .map((s) => ({ a: s.span[1], b: s.span[2], id: s.id }));
    const cuts = [...new Set([0, sec.text.length, ...spans.flatMap((s) => [s.a, s.b])])]
      .filter((x) => x >= 0 && x <= sec.text.length).sort((x, y) => x - y);
    const nodes = [];
    for (let j = 0; j + 1 < cuts.length; j++) {
      const text = sec.text.slice(cuts[j], cuts[j + 1]);
      const ids = spans.filter((s) => s.a <= cuts[j] && s.b >= cuts[j + 1]).map((s) => s.id);
      if (!ids.length) { nodes.push(text); continue; }
      const el = h('span', { class: 'ev', 'data-s': ids.join(' ') }, text);
      marks.push({ el, ids });
      nodes.push(el);
    }
    return h('p', {}, sec.label ? h('span', { class: 'sec-label' }, `${sec.label} `) : null, nodes);
  });
  const fromTitle = item.statements.filter((s) => s.where === 'title').map((s) => s.id);
  let title = item.title;
  if (fromTitle.length) {
    title = h('span', { class: 'ev', 'data-s': fromTitle.join(' ') }, item.title);
    marks.push({ el: title, ids: fromTitle });
  }
  return { el: h('div', { class: 'abstract-text' }, paras), title, marks };
}

/** st: {draft, changed()}. Returns {el, refresh(), key(k), focusUnit(i)}. */
function mountStatements(item, st) {
  const units = [];
  let active = 0;

  const source = buildSource(item);
  const pane = h('aside', { class: 'abstract-pane' },
    h('h2', { class: 'pane-title' }, 'Abstract'),
    source.el,
    h('p', { class: 'pane-note' }, 'Underlined: the sentences the statements were read from. Point at a statement to see its sentence.'));

  function paintMarks() {
    const on = units[active] ? units[active].id : null;
    for (const m of source.marks) m.el.classList.toggle('on', on != null && m.ids.includes(on));
    const first = source.marks.find((m) => m.ids.includes(on) && pane.contains(m.el));
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

  const hover = (id, on) => { for (const m of source.marks) if (m.ids.includes(id)) m.el.classList.toggle('hover', on); };
  for (const m of source.marks) {
    m.el.addEventListener('click', () => {
      // A sentence can carry several statements: go to the first one of them that still needs an answer.
      const rows = m.ids.map((id) => units.findIndex((u) => u.id === id)).filter((i) => i >= 0);
      const open = rows.find((i) => !units[i].complete());
      if (rows.length) setActive(open ?? rows[0], { scroll: true });
    });
  }

  item.statements.forEach((s, index) => {
    const x = () => st.draft.statements[s.id];
    const support = choiceRow(['1', '2', '3'], (v) => { x().support = v; st.changed(); });
    const result = choiceRow(['Y', 'N', 'U'], (v) => { if (asksResult(x())) { x().result = v; st.changed(); } });
    const input = h('input', { type: 'text', maxlength: String(NOTE_MAX), autocomplete: 'off', 'aria-label': `Comment on statement ${numberOf(s.id)}` });
    input.addEventListener('input', () => { x().note = input.value; st.changed(); });
    const noteName = h('span', { class: 'field-name' });
    const noteHint = h('span', { class: 'field-hint' });
    const noteField = h('label', { class: 'field stmt-note' }, h('span', { class: 'field-label' }, noteName, ' ', noteHint), input);
    let noteOpen = false;
    const addNote = h('button', { type: 'button', class: 'btn-link stmt-add', onclick: () => { noteOpen = true; unit.refresh(); input.focus(); } }, 'Add a comment');
    const resultLine = h('div', { class: 'row-line stmt-q' }, h('span', { class: 'q-label' }, 'B. A result of this trial?'), result.el);
    const state = h('span', { class: 'f-state' });
    const el = h('article', { class: 'stmt unit', 'data-id': s.id },
      h('div', { class: 'stmt-head' },
        h('span', { class: 'stmt-no' }, numberOf(s.id)),
        h('span', { class: 'stmt-text' }, s.text),
        state),
      s.where === 'title' ? h('p', { class: 'stmt-from' }, 'Read from the title.') : null,
      h('div', { class: 'stmt-qs' },
        h('div', { class: 'row-line stmt-q' }, h('span', { class: 'q-label' }, 'A. Does the abstract support it?'), support.el),
        resultLine),
      h('div', { class: 'stmt-foot' }, addNote, noteField));
    el.addEventListener('mouseenter', () => hover(s.id, true));
    el.addEventListener('mouseleave', () => hover(s.id, false));
    el.addEventListener('pointerdown', () => setActive(index));
    el.addEventListener('focusin', () => { if (active !== index) setActive(index); });
    const unit = {
      id: s.id, el,
      complete: () => complete(x()),
      refresh() {
        const d = x();
        support.set(d.support);
        result.set(d.result, !asksResult(d));
        resultLine.classList.toggle('not-asked', !asksResult(d));
        const required = d.support === 'unsure';
        const show = required || noteOpen || filled(d.note, 1);
        noteField.hidden = !show;
        addNote.hidden = show || !d.support;
        if (input.value !== d.note) input.value = d.note;
        noteName.textContent = required ? 'Why you are unsure' : 'Comment';
        noteHint.textContent = required ? '(required)' : '(optional)';
        noteField.classList.toggle('required', required);
        const done = complete(d);
        state.textContent = done ? '✓' : '';
        el.classList.toggle('done', done);
        el.dataset.support = d.support || '';
      },
      support(v) { x().support = v; st.changed(); return true; },
      result(v) {
        if (!asksResult(x())) return false;
        x().result = v;
        st.changed();
        return true;
      },
    };
    units.push(unit);
  });

  const meta = [item.journal, item.year].filter(Boolean).join(' · ');
  const n = item.statements.length;
  const el = h('div', { class: 'trial statements' },
    h('header', { class: 'trial-head' }, h('h1', { class: 'trial-title' }, source.title), meta ? h('p', { class: 'trial-meta' }, meta) : null),
    h('div', { class: 'trial-grid' }, pane,
      h('div', { class: 'read-pane' },
        h('section', { class: 'block findings-block' },
          h('h2', { class: 'block-title' }, `Statements read from this abstract (${n})`),
          h('p', { class: 'muted small' }, 'Each statement was written by another program. Answer A for every statement, and B unless the answer to A is No.'),
          units.map((u) => u.el)))));

  setActive(0);

  return {
    el,
    refresh() { for (const u of units) u.refresh(); },
    /** Move the highlight to row number i (as numbered by validate). */
    focusUnit(i) { setActive(i, { scroll: true }); },
    /** Keyboard: returns true when the key was used. */
    key(k) {
      const unit = units[active];
      if (!unit) return false;
      if (k === 'j' || k === 'k') { setActive(active + (k === 'j' ? 1 : -1), { scroll: true }); return true; }
      let used = false;
      if (k === '1' || k === '2' || k === '3') used = unit.support(ANSWERS[Number(k) - 1]);
      else if (k === 'y' || k === 'n' || k === 'u') used = unit.result({ y: 'yes', n: 'no', u: 'unsure' }[k]);
      if (used && unit.complete() && active + 1 < units.length) setActive(active + 1, { scroll: true });
      return used;
    },
  };
}
