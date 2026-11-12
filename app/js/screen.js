// Screen: full-text screening against a first screen.
// Blinded (review.json screening.blind true): the screener judges each criterion and decides with the first
// screen hidden; saving the decision reveals the first screen beside theirs for reconciliation.
// Open (blind false): the first screen is visible throughout; the screener agrees or disagrees with each point.
// Switched on per review in review.json "screening".
// Blinded with no first screen in the repo (a separate screening repo, so the second screener cannot read the
// first screen): saving records the decision and moves on; the screens are compared later, where both are held.

import { S, docEvents, addEvent } from './data.js';
import { commentsFor } from './events.js';
import { h, bar } from './ui.js';
import { textPane, whereText, saveScroll, restoreScroll } from './fulltext.js';

export const SC = { rec: null, crit: 0, tab: null, filter: 'todo', scroll: null, keep: null, pick: null, draft: null, keys: null };

const JCOL = { Met: '#0b7a53', 'Not met': '#b3261e', Unclear: '#b7791f' };
const JKEY = { Met: 'M', 'Not met': 'N', Unclear: 'U' };
const CCOL = ['#1c5cab', '#7b3fa0', '#0f7c8c', '#a3541b', '#4f6b1a', '#9b2c5a'];
const DEC = { include: 'Include', exclude: 'Exclude', discuss: 'Discuss' };

/** Exclusion reasons as {text, criterion}. review.json may list plain strings or {criterion, text} objects. */
export const reasonList = (cfg) => (cfg.reasons || []).map((x) => (typeof x === 'string' ? { text: x, criterion: null } : { text: x.text, criterion: x.criterion || null }));

/**
 * The first screen's reason for comparison: the PI's recoding into a protocol reason
 * (`protocol_reason.text`, added 11 October 2026) once filled, else the reason as first recorded.
 */
export const firstReason = (f) => (f && f.protocol_reason && f.protocol_reason.text) || (f && f.reason) || null;

const cmpT = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id < b.id ? -1 : 1);

/**
 * One coder's screening state for a record. crit: latest event per criterion. decision: latest decision.
 * firstDecision: the earliest decision (in blinded screening, the one made before the first screen was shown).
 * critAtDecision: each criterion's event as it stood when firstDecision was made.
 */
export function screenState(rec, coder) {
  const st = { crit: {}, decision: null, firstDecision: null, critAtDecision: null };
  for (const e of docEvents(rec).filter((x) => x.coder === coder && x.record === rec).sort(cmpT)) {
    if (e.type === 'screen') { if (e.action === 'clear') delete st.crit[e.criterion]; else st.crit[e.criterion] = e; }
    else if (e.type === 'screen-decision') { if (!st.firstDecision) { st.firstDecision = e; st.critAtDecision = { ...st.crit }; } st.decision = e; }
  }
  return st;
}

/** A screener's judgement on a criterion from their event: their own value, or the first screen's when they agreed. */
const judged = (e, firstJ) => (!e ? null : e.action === 'judge' || e.action === 'disagree' ? e.value || null : e.action === 'agree' ? firstJ : null);

/** Every screener's decisions on each record, beside the first screen's. For the Agreement tab. */
export function screenPairs() {
  const cfg = S.review.screening; const first = S.firstScreen?.records || {};
  const blind = !!cfg.blind;
  const coders = new Set();
  for (const r of S.records || []) for (const e of docEvents(r.id)) if (e.type === 'screen-decision' || e.type === 'screen') coders.add(e.coder);
  const out = [];
  for (const c of coders) for (const r of S.records || []) {
    const st = screenState(r.id, c); const f = first[r.id];
    if (!f) continue;
    const d = blind ? st.firstDecision : st.decision;
    const critSrc = blind && st.critAtDecision ? st.critAtDecision : st.crit;
    out.push({ coder: c, rec: r.id, first: f.decision, firstReason: firstReason(f),
      decision: d ? d.decision : null, reason: d ? d.reason : null,
      final: st.decision ? st.decision.decision : null, finalReason: st.decision ? st.decision.reason : null,
      changed: !!(blind && st.firstDecision && st.decision && (st.decision.decision !== st.firstDecision.decision || st.decision.reason !== st.firstDecision.reason)),
      crit: (cfg.criteria || []).map((k) => { const e = critSrc[k.id]; const fj = f.criteria[k.id]?.judgement; return { id: k.id, first: fj, action: e ? e.action : null, value: judged(e, fj) }; }) });
  }
  return out;
}

export function renderScreen(root) {
  const cfg = S.review.screening;
  const rr = () => renderScreen(root);
  if (!cfg || !cfg.enabled) {
    root.replaceChildren(h('div', { class: 'page narrow' }, h('h1', { text: 'Screen' }), h('section', { class: 'card' },
      h('p', { text: 'Full-text screening is switched off for this review.' }), cfg && cfg.note ? h('p', { class: 'muted', text: cfg.note }) : null)));
    return;
  }
  if (!S.records || !S.firstScreen) { root.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'muted', text: 'Loading the screening records' }))); return; }
  const blind = !!cfg.blind;
  const first = S.firstScreen.records || {};
  const crits = cfg.criteria || [];
  const judgements = cfg.judgements || ['Met', 'Not met', 'Unclear'];
  const recs = S.records;
  const me = S.handle;
  const stOf = (id) => screenState(id, me);
  const isDone = (id) => !!stOf(id).decision;
  const hasFirst = (id) => !!first[id];
  const isRevealed = (id) => !blind || (!!stOf(id).firstDecision && hasFirst(id));
  const differs = (id) => { if (!isRevealed(id)) return false; const d = stOf(id).decision; return d && (d.decision !== first[id]?.decision || (d.decision === 'exclude' && d.reason !== firstReason(first[id]))); };
  const shown = recs.filter((r) => SC.filter === 'all' || (SC.filter === 'todo' ? !isDone(r.id) : SC.filter === 'done' ? isDone(r.id) : differs(r.id)));
  if (!SC.rec || !recs.find((r) => r.id === SC.rec)) { SC.rec = (shown[0] || recs[0]).id; SC.crit = 0; SC.scroll = crits[0]?.id; }
  const rec = recs.find((r) => r.id === SC.rec);
  const f = first[rec.id] || { criteria: {}, rulings: [] };
  const st = stOf(rec.id);
  const revealed = isRevealed(rec.id);
  const decided = !!st.firstDecision;
  const firstHere = hasFirst(rec.id);
  const reasons = reasonList(cfg);
  const critLabel = (id) => (crits.find((c) => c.id === id) || {}).label || id;
  const ri = recs.indexOf(rec);
  const goto = (r) => { if (r) { SC.rec = r.id; SC.crit = 0; SC.tab = null; SC.draft = null; SC.pick = null; SC.scroll = crits[0]?.id; rr(); } };
  const act = (c, action, value) => addEvent(rec.id, 'screen', { record: rec.id, criterion: c.id, action, value: value ?? null });
  const colour = (k) => CCOL[Math.max(0, crits.findIndex((c) => c.id === k)) % CCOL.length];
  const nextTodo = () => recs.slice(ri + 1).find((r) => !isDone(r.id)) || recs.find((r) => !isDone(r.id) && r.id !== rec.id) || null;

  // ----- records list
  const doneN = recs.filter((r) => isDone(r.id)).length;
  const diffN = recs.filter((r) => differs(r.id)).length;
  const aside = h('aside', { class: 'vside' },
    h('section', { class: 'card' }, h('h2', { text: 'Full-text records' }),
      h('div', { class: 'big' }, h('b', { text: `${doneN} / ${recs.length}` }), h('span', { class: 'muted', text: ' decided by you' })), bar(recs.length ? doneN / recs.length : 0),
      diffN ? h('div', { class: 'muted', text: `${diffN} differ from the first screen` }) : null,
      h('div', { class: 'pills' }, [['todo', 'To do'], ['done', 'Done'], ['differ', 'Differ'], ['all', 'All']].map(([k, l]) => h('button', { type: 'button', class: 'pill' + (SC.filter === k ? ' on' : ''), onclick: () => { SC.filter = k; rr(); } }, l))),
      h('div', { class: 'qlist dlist' }, shown.map((r) => {
        const s = stOf(r.id); const fd = isRevealed(r.id) ? first[r.id]?.decision : null;
        return h('button', { type: 'button', class: 'qi' + (r.id === rec.id ? ' cur' : ''), onclick: () => goto(r) },
          h('span', { class: 'qs ' + (s.decision ? 'd' : Object.keys(s.crit).length ? 'p' : '') }),
          h('span', { class: 'qt' }, h('b', { class: 'mono', text: r.id }), h('span', { text: ' ' + (r.short || r.title || '').slice(0, 40) }),
            fd ? h('span', { class: 'dk ' + fd, title: 'First screen', text: fd === 'include' ? 'I' : 'E' }) : null, differs(r.id) ? h('span', { class: 'dk diff', text: '≠' }) : null));
      }), shown.length ? null : h('p', { class: 'muted', text: 'None.' }))),
    h('section', { class: 'card' }, h('h2', { text: 'How this screen works' }),
      h('p', { class: 'muted small', text: cfg.note || '' }),
      h('p', { class: 'muted small', text: `Criteria: ${cfg.source || 'the protocol'}.${S.firstScreen.screener ? ` First screen: ${S.firstScreen.name || S.firstScreen.screener}, ${S.firstScreen.date}.` : ''}` }),
      (cfg.rulings || []).length ? h('details', { class: 'pdef' }, h('summary', { text: `Rulings (${cfg.rulings.length})` }),
        cfg.rulings.map((r) => h('p', { class: 'small' }, h('b', { class: 'mono', text: r.id + ' ' }), `${r.question} `, h('span', { class: 'muted', text: r.ruling })))) : null));

  // ----- full text; the first screen's notes are marked only once they can be seen
  const evText = (c) => ((f.criteria[c.id] || {}).evidence || []).map((x) => x.text).join(' ');
  const items = revealed ? crits.map((c) => ({ key: c.id, label: c.label, text: `${f.criteria[c.id]?.note || ''} ${evText(c)}`, kind: 'note' })) : [];
  const pane = textPane({ doc: rec, id: rec.id, title: rec.title, sub: `${rec.id} · ${rec.short || ''}${rec.type ? ' · ' + rec.type : ''}`,
    items, sel: crits[SC.crit]?.id, onSelect: (k) => { SC.crit = Math.max(0, crits.findIndex((c) => c.id === k)); rr(); },
    tab: SC.tab, setTab: (k) => { SC.tab = k; SC.scroll = crits[SC.crit]?.id; rr(); }, scrollTo: revealed ? SC.scroll : null, colour });

  // ----- criteria
  const allActed = crits.every((c) => st.crit[c.id]);
  const jchip = (j, prefix) => h('span', { class: 'jchip', style: { '--j': JCOL[j] || '#5d6675' }, text: (prefix || '') + (j || '?') });
  const judgeButtons = (c, i, e) => h('div', { class: 'acts' }, judgements.map((j) => h('button', { type: 'button', class: 'act judge' + (e && judged(e) === j ? ' on' : ''), style: { '--j': JCOL[j] }, title: `${j} (${JKEY[j] || ''})`,
    onclick: (ev) => { ev.stopPropagation(); SC.crit = i; act(c, 'judge', j); } }, j, JKEY[j] ? h('kbd', { text: JKEY[j] }) : null)),
    h('span', { class: 'fs muted', text: e ? `Your judgement: ${judged(e, f.criteria[c.id]?.judgement)}` : 'Not judged' }));
  const firstNotes = (fc, sel) => [h('div', { class: 'passage small', text: fc.note || '(no note)' }),
    (fc.evidence || []).length ? h('details', { class: 'pdef', open: sel }, h('summary', { text: `Extraction notes (${fc.evidence.map((x) => x.field.toLowerCase()).join(', ')})` }),
      fc.evidence.map((x) => h('p', { class: 'small' }, h('b', { text: x.field + '. ' }), x.text))) : null];
  const critCard = (c, i) => {
    const fc = f.criteria[c.id] || { judgement: 'Unclear', note: '' };
    const e = st.crit[c.id];
    const sel = i === SC.crit;
    const cls = 'task crit' + (sel ? ' cur' : '');
    const click = () => { if (!sel) { SC.crit = i; SC.scroll = c.id; rr(); } };
    const def = (open) => h('details', { class: 'pdef', open }, h('summary', { text: 'Protocol definition' }),
      c.include || c.exclude ? [h('p', { class: 'small' }, h('b', { text: 'Include. ' }), c.include || ''), h('p', { class: 'small' }, h('b', { text: 'Exclude. ' }), c.exclude || '')]
        : h('p', { class: 'small', text: c.definition || '' }));
    if (blind) {
      const mine = judged(e, fc.judgement);
      const atDecision = st.critAtDecision ? judged(st.critAtDecision[c.id], fc.judgement) : mine;
      if (!revealed) {
        return h('div', { class: cls + (e ? ' judged' : ''), style: { '--c': colour(c.id) }, onclick: click },
          h('div', { class: 'th' }, h('span', { class: 'tl' }, h('b', { text: c.label }), mine ? [' ', jchip(mine)] : null)), def(sel), judgeButtons(c, i, e));
      }
      const match = atDecision && atDecision === fc.judgement;
      return h('div', { class: cls + (match ? ' agree' : ' disagree'), style: { '--c': colour(c.id) }, onclick: click },
        h('div', { class: 'th' }, h('span', { class: 'tl' }, h('b', { text: c.label }), ' ', jchip(atDecision, 'You: '), ' ', jchip(fc.judgement, 'First: '),
          h('span', { class: 'muted small', text: `  ${match ? 'same' : 'differs'} · ${whereText(pane.pages, pane.loc, c.id)}` }))),
        ...firstNotes(fc, sel), def(false),
        mine !== atDecision ? h('div', { class: 'muted small', style: { margin: '0 10px 6px' }, text: `Changed after the first screen was shown: now ${mine}.` }) : null,
        judgeButtons(c, i, e));
    }
    const others = judgements.filter((j) => j !== fc.judgement);
    const pk = rec.id + '|' + c.id;
    const status = !e ? 'Not checked' : e.action === 'agree' ? 'Agreed' : e.action === 'disagree' ? `Disagreed: ${e.value}` : 'Marked unsure';
    return h('div', { class: cls + (e ? ' ' + e.action : ''), style: { '--c': colour(c.id) }, onclick: click },
      h('div', { class: 'th' }, h('span', { class: 'tl' }, h('b', { text: c.label }), ' ', jchip(fc.judgement), h('span', { class: 'muted small', text: '  ' + whereText(pane.pages, pane.loc, c.id) }))),
      ...firstNotes(fc, sel), def(false),
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'act agree' + (e && e.action === 'agree' ? ' on' : ''), title: 'Agree (A)', onclick: (ev) => { ev.stopPropagation(); SC.crit = i; SC.pick = null; act(c, 'agree'); } }, 'Agree', h('kbd', { text: 'A' })),
        h('button', { type: 'button', class: 'act disagree' + (e && e.action === 'disagree' ? ' on' : ''), title: 'Disagree (D)', onclick: (ev) => { ev.stopPropagation(); SC.crit = i; SC.pick = SC.pick === pk ? null : pk; rr(); } }, 'Disagree', h('kbd', { text: 'D' })),
        h('button', { type: 'button', class: 'act unsure' + (e && e.action === 'unsure' ? ' on' : ''), title: 'Unsure (U)', onclick: (ev) => { ev.stopPropagation(); SC.crit = i; SC.pick = null; act(c, 'unsure'); } }, 'Unsure', h('kbd', { text: 'U' })),
        h('span', { class: 'fs muted', text: status })),
      SC.pick === pk ? h('div', { class: 'picker' }, h('div', { class: 'muted small', text: `The first screen says ${fc.judgement}. Your judgement:` }),
        others.map((j) => h('button', { type: 'button', class: 'po', onclick: (ev) => { ev.stopPropagation(); SC.pick = null; act(c, 'disagree', j); } }, h('span', { class: 'dot', style: { background: JCOL[j] } }), h('b', { text: j }), h('span', { class: 'pd', text: '' })))) : null);
  };

  // ----- decision
  const rulings = (cfg.rulings || []).filter((r) => (f.rulings || []).includes(r.id));
  const cur = st.decision;
  if (!SC.draft || SC.draft.rec !== rec.id) SC.draft = { rec: rec.id, decision: cur ? cur.decision : null, reason: cur ? cur.reason : null, note: cur ? cur.note || '' : '' };
  const dr = SC.draft;
  const fd = f.decision;
  const saveDecision = () => {
    if (!dr.decision || (dr.decision === 'exclude' && !dr.reason)) return;
    const ev = { record: rec.id, decision: dr.decision, reason: dr.decision === 'exclude' ? dr.reason : null, note: dr.note || '', ...(blind ? { revealed: !!st.firstDecision } : {}) };
    if ((!blind || !firstHere) && !cur) { const n = nextTodo(); if (n) { SC.rec = n.id; SC.crit = 0; SC.tab = null; SC.draft = null; SC.scroll = crits[0]?.id; } }
    if (blind && firstHere && !cur) SC.scroll = crits[0]?.id;
    addEvent(rec.id, 'screen-decision', ev);
  };
  const reasonLine = (r) => { const x = reasons.find((y) => y.text === r); return x && x.criterion ? `${critLabel(x.criterion)}: ${r}` : r; };
  const decLine = (d) => `${DEC[d.decision]}${d.reason ? ' (' + reasonLine(d.reason) + ')' : ''}`;
  const comments = commentsFor(docEvents(rec.id), '_screen');
  const saveLabel = cur ? 'Update decision' : blind && firstHere ? 'Save decision and show the first screen' : 'Save decision, next record';
  const nt = nextTodo();
  const panel = h('section', { class: 'card dtasks' },
    h('div', { class: 'dth' }, h('h2', { text: `${rec.id} · ${rec.short || ''}` }), h('span', { class: 'muted small', text: blind ? 'J K record · ↑↓ criterion · M N U' : 'J K record · ↑↓ criterion · A D U' })),
    h('div', { class: 'tlist' },
      rec.note ? h('div', { class: 'warnline', text: rec.note }) : null,
      h('div', { class: 'muted small rmeta' }, rec.citation ? h('div', { text: rec.citation }) : null, rec.fulltext_source && revealed ? h('div', { text: 'Full text: ' + rec.fulltext_source }) : null,
        rec.url ? h('a', { href: rec.url, target: '_blank', rel: 'noopener', text: rec.url }) : null),
      blind && !revealed ? h('div', { class: 'blindnote', text: firstHere ? 'Judge each criterion from the full text, then decide. The first screen stays hidden until you save your decision.'
        : 'Judge each criterion from the full text, then decide. The other screen is not shown here. Both screens are compared after both are complete.' }) : null,
      h('h3', { text: !blind ? 'First screen, criterion by criterion' : revealed ? 'Your judgements beside the first screen' : 'Your judgement, criterion by criterion' }),
      (cfg.definitions || []).map((d) => h('details', { class: 'pdef' }, h('summary', { text: `Definition: ${d.term}` }), h('p', { class: 'small' }, h('b', { text: d.term + '. ' }), d.text))),
      crits.map(critCard),
      revealed && rulings.length ? h('div', { class: 'rulings' }, h('h3', { text: 'Rulings that apply' }), rulings.map((r) => h('div', { class: 'ruling' }, h('b', { class: 'mono', text: r.id }), h('span', { text: ` ${r.question} ` }), h('span', { class: 'muted', text: r.ruling })))) : null,
      revealed ? h('div', { class: 'firstdec' }, h('span', { class: 'muted', text: 'First screen decision: ' }), h('b', { class: 'dec ' + fd, text: DEC[fd] || '?' }), fd === 'exclude' && firstReason(f) ? h('span', { text: ` (${reasonLine(firstReason(f))})` }) : null,
        fd === 'exclude' && f.protocol_reason && f.protocol_reason.text && f.reason && f.reason !== f.protocol_reason.text ? h('div', { class: 'muted small', text: `Recoded ${f.protocol_reason.date || ''} from the first-screen label: ${f.reason}` }) : null,
        f.call ? h('div', { class: 'muted small', text: 'Call: ' + f.call }) : null,
        blind && st.firstDecision ? h('div', { class: 'small' }, h('span', { class: 'muted', text: 'Your decision before it was shown: ' }), h('b', { class: 'dec ' + st.firstDecision.decision, text: decLine(st.firstDecision) })) : null) : null,
      h('div', { class: 'mydec' }, h('h3', { text: blind && revealed ? 'Your decision now' : 'Your decision' }),
        !allActed ? h('div', { class: 'muted small', text: blind ? 'Judge every criterion first.' : 'Check every criterion first.' }) : null,
        h('div', { class: 'seg' }, ['include', 'exclude', 'discuss'].map((k) => h('button', { type: 'button', class: dr.decision === k ? 'on' : '', disabled: !allActed, onclick: () => { dr.decision = k; if (k === 'exclude' && !dr.reason && revealed && fd === 'exclude' && reasons.some((x) => x.text === firstReason(f))) dr.reason = firstReason(f); rr(); } }, DEC[k]))),
        dr.decision === 'exclude' ? h('label', { class: 'sel' }, 'Reason', h('select', { onchange: (e) => { dr.reason = e.target.value || null; rr(); } }, h('option', { value: '', text: 'Choose a reason' }),
          reasons.some((x) => x.criterion) ? crits.filter((c) => reasons.some((x) => x.criterion === c.id)).map((c) => h('optgroup', { label: c.label }, reasons.filter((x) => x.criterion === c.id).map((x) => h('option', { value: x.text, selected: dr.reason === x.text, text: x.text }))))
            : reasons.map((x) => h('option', { value: x.text, selected: dr.reason === x.text, text: x.text })))) : null,
        h('label', { class: 'sel' }, 'Note', h('textarea', { rows: 2, placeholder: revealed ? 'Why, especially if you differ from the first screen' : 'Your reasons', value: dr.note, oninput: (e) => { dr.note = e.target.value; } }, dr.note)),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', disabled: !allActed || !dr.decision || (dr.decision === 'exclude' && !dr.reason), onclick: saveDecision }, saveLabel),
          cur ? h('span', { class: 'ok', text: `Saved: ${decLine(cur)}` }) : null,
          blind && cur && nt ? h('button', { type: 'button', class: 'btn', onclick: () => goto(nt) }, `Next record: ${nt.id}`) : null),
        blind && !firstHere && cur ? h('div', { class: 'muted small', text: 'Saved to your own folder in the repo. The screens are compared after both are complete.' }) : null),
      h('div', { class: 'comments' }, h('b', { text: `Discussion (${comments.length})` }),
        !revealed && !(blind && !firstHere && decided) ? h('div', { class: 'muted small', text: 'Hidden until you save your decision.' }) : [
          comments.map((c) => h('div', { class: 'cm' }, h('span', { class: 'cmw', text: c.coder }), h('span', { class: 'muted', text: ' ' + c.t.slice(0, 16).replace('T', ' ') }), h('div', { text: c.text }))),
          h('div', { class: 'row' }, h('textarea', { rows: 1, placeholder: 'Comment for the whole team', id: 'newcomment' }), h('button', { type: 'button', class: 'btn', onclick: () => { const x = document.getElementById('newcomment'); if (x.value.trim()) addEvent(rec.id, 'comment', { unit: '_screen', text: x.value.trim() }); } }, 'Post'))])));

  const saved = saveScroll(root, ['.dtb', '.tlist']);
  root.replaceChildren(h('div', { class: 'dwrap' }, aside, pane.el, panel));
  if (SC.keep === rec.id) restoreScroll(root, saved);
  SC.keep = rec.id;
  if (SC.scroll) { pane.after(root); SC.scroll = null; }

  SC.keys = (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
    const k = ev.key.toLowerCase(); const c = crits[SC.crit];
    const step = () => { if (SC.crit < crits.length - 1) { SC.crit++; SC.scroll = crits[SC.crit].id; } };
    if (k === 'arrowdown') { SC.crit = Math.min(crits.length - 1, SC.crit + 1); SC.scroll = crits[SC.crit].id; SC.pick = null; rr(); }
    else if (k === 'arrowup') { SC.crit = Math.max(0, SC.crit - 1); SC.scroll = crits[SC.crit].id; SC.pick = null; rr(); }
    else if (k === 'j') goto(recs[ri + 1]);
    else if (k === 'k') goto(recs[ri - 1]);
    else if (blind && c && ['m', 'n', 'u'].includes(k)) { const j = { m: 'Met', n: 'Not met', u: 'Unclear' }[k]; step(); act(c, 'judge', j); }
    else if (!blind && k === 'a' && c) { SC.pick = null; step(); act(c, 'agree'); }
    else if (!blind && k === 'd' && c) { const pk = rec.id + '|' + c.id; SC.pick = SC.pick === pk ? null : pk; rr(); }
    else if (!blind && k === 'u' && c) { SC.pick = null; act(c, 'unsure'); }
    else if (k === 'escape' && SC.pick) { SC.pick = null; rr(); }
    else return false;
    ev.preventDefault();
    return true;
  };
}
