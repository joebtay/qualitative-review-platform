// Verify: draw a locked sample, then check the first coder's codes unit by unit.

import { S, docEvents, allEvents, addEvent, firstCodes, firstExtras, unitList, findUnit, populationFor, fieldDef, valueDef, refreshEvents, notify } from './data.js';
import { verifyState, isDone, memoFor, commentsFor } from './events.js';
import { draw } from './sampler.js';
import { h, chip, colourFor, bar, pct } from './ui.js';
import { openCodebook, toggleCodebook } from './codebook.js';
import { openPdf, pdfParts } from './documents.js';
import { renderDocView } from './docview.js';
import { frameFor, submitted, unblinded, SAMPLES_DOC, defaultSample } from './assign.js';
import { feature } from './features.js';
import { shouldOpen, markSeen, orientationPage, taskLine } from './orientation.js';
import { layerOf, unitLabel, sameLayer, verifyAddFields, confirmBlank } from './settings.js';
import { themeConfig } from './themes.js';

export const V = { mode: 'fragment', pick: {}, frame: null, sampleId: null, filter: 'todo', unit: null, fieldIdx: 0, picker: null, pickQ: '', draft: null };

export const ACTIONS = [['agree', 'Agree', 'A'], ['disagree', 'Disagree', 'D'], ['other', 'Other code', 'O'], ['unsure', 'Unsure', 'U']];
// The Task 6A workbook set: Disagree means "this code is wrong" and needs a note; Other names the right code.
export const ACTIONS_WB = [['agree', 'Agree', 'A'], ['disagree', 'Disagree', 'D'], ['other', 'Other', 'O']];
const wb = (frame) => frame.answers === 'workbook';
export const docOrder = () => new Map(S.docs.map((d, i) => [d.id, i]));

/** Frames a coder can verify: those of the first layer, then those of any other layer a sample is drawn on. */
export function verifiableFrames() {
  const first = S.review.layers.find((l) => l.id === S.review.first_layer);
  const sampled = new Set(S.samples.map((x) => x.frame));
  const theme = (themeConfig(S.review) || {}).frame; // verified code by code in the Themes views, not here
  return Object.values(S.frames).filter((f) => f.id !== theme).filter((f) => (first && (first.frames || []).includes(f.id))
    || (sampled.has(f.id) && S.samples.some((x) => x.frame === f.id && sameLayer(x.layer, layerOf(f.id, S.review), S.review))));
}

export function sampleQueue(sample) {
  if (sample.coders) return sample.units.slice(); // assigned: already in this coder's item order
  const ord = docOrder();
  const pos = new Map();
  for (const [doc] of ord) unitList(doc).forEach((u, i) => pos.set(doc + '|' + u.id, i));
  return sample.units.slice().sort((a, b) => (ord.get(a.doc) - ord.get(b.doc)) || ((pos.get(a.doc + '|' + a.unit) ?? 0) - (pos.get(b.doc + '|' + b.unit) ?? 0)));
}

/** My verification state for every unit in a sample, built in one pass over the events. */
export function indexMine(sample) {
  const idx = new Map();
  const get = (u) => { if (!idx.has(u)) idx.set(u, { fields: {}, notes: {}, done: false }); return idx.get(u); };
  for (const e of allEvents().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id < b.id ? -1 : 1))) {
    if (e.coder !== S.handle || e.sample !== sample.id || e.frame !== sample.frame) continue;
    const s = get(e.unit);
    if (e.type === 'verify') { if (e.action === 'clear') delete s.fields[e.field]; else s.fields[e.field] = e; }
    else if (e.type === 'note') s.notes[e.field] = e.text;
    else if (e.type === 'done') s.done = true;
    else if (e.type === 'reopen') s.done = false;
  }
  return idx;
}

export const effective = (codes, st, field, frame) => {
  const e = st.fields[field];
  if (!e) return codes[field] ?? null;
  if (e.action === 'agree') return codes[field] ?? null;
  if (e.action === 'disagree') return frame && wb(frame) ? codes[field] ?? null : null; // workbook: wrong, but no replacement named
  if (e.action === 'other') return e.value ?? null;
  return codes[field] ?? null;
};

/** The frame-setting fields a sample shows besides its own, and the fields whose blank code needs an answer (settings.js). */
export function verifyOpts(frameId, sample) {
  return { addFields: sample && sample.answers === 'question' ? [] : verifyAddFields(frameId, S.review), confirm: confirmBlank(frameId, S.review) };
}

/** The values a field offers for this unit: those of the chosen parent where the field depends on another. */
export function optionsFor(frame, f, codes, st) {
  if (!f.depends_on) return f.values;
  const par = effective(codes, st, f.depends_on, frame);
  return f.values.filter((v) => !v.parent || v.parent === par);
}

/** A blank first code that still needs an answer: a confirm_blank field ("None given") with values to choose from. */
export const needsConfirm = (frame, f, codes, st) => !!f.confirm_blank && codes[f.id] == null && optionsFor(frame, f, codes, st).length > 0;

export function unresolved(frame, codes, st) {
  const notes = st.notes || {};
  return frame.fields.filter((f) => (!st.fields[f.id] && !(codes[f.id] == null && !f.required && !needsConfirm(frame, f, codes, st)))
    || (wb(frame) && st.fields[f.id] && st.fields[f.id].action === 'disagree' && !(notes[f.id] || '').trim()));
}

export function badParent(frame, f, codes, st) {
  if (!f.depends_on) return null;
  const v = effective(codes, st, f.id, frame);
  if (v == null) return null;
  const def = f.values.find((x) => x.id === v);
  const parent = effective(codes, st, f.depends_on, frame);
  if (def && def.parent && def.parent !== parent) return `${v} belongs to ${def.parent}, not ${parent ?? '(blank)'}.`;
  return null;
}

/** The field rows for one unit in one frame: the first coder's code, its definition, and Agree, Disagree, Other code, Unsure. Shared by both Verify views. o: {act, sel, setSel, pk, rerender, root} */
export function fieldRows(frame, codes, st, o) {
  return frame.fields.map((f, i) => {
    const key = o.pk + f.id;
    const orig = codes[f.id] ?? null;
    const e = st.fields[f.id];
    const confirmIt = needsConfirm(frame, f, codes, st);
    const implicit = !e && orig == null && !f.required && !confirmIt;
    const bp = badParent(frame, f, codes, st);
    const sel = i === o.sel;
    const vdef = (v) => f.values.find((x) => x.id === v);
    const btns = (wb(frame) ? ACTIONS_WB : ACTIONS).map(([a, label, k]) => h('button', { type: 'button', class: 'act ' + a + (e && e.action === a ? ' on' : ''), disabled: !!o.locked || (a === 'agree' && !!bp) || (a === 'disagree' && orig == null), title: `${label} (${k})`,
      onclick: (ev) => { ev.stopPropagation(); o.setSel(i); if (a === 'other') { V.picker = V.picker === key ? null : key; V.pickQ = ''; o.rerender(); } else { V.picker = null; o.act(f, a); } } }, label, h('kbd', { text: k })));
    const options = optionsFor(frame, f, codes, st);
    const q = V.pickQ.toLowerCase();
    const pick = V.picker === key ? h('div', { class: 'picker' },
      options.length > 10 ? h('input', { type: 'text', placeholder: 'Filter', value: V.pickQ, oninput: (ev) => { V.pickQ = ev.target.value; o.rerender(); const el = o.root.querySelector('.picker input'); if (el) { el.focus(); el.setSelectionRange(V.pickQ.length, V.pickQ.length); } } }) : null,
      options.length ? options.filter((v) => !q || (v.label + v.definition).toLowerCase().includes(q)).map((v) => h('button', { type: 'button', class: 'po' + (e && e.value === v.id ? ' on' : ''), onclick: (ev) => { ev.stopPropagation(); V.picker = null; o.act(f, 'other', v.id); } },
        h('span', { class: 'dot', style: { background: colourFor(v.id) } }), h('b', { text: v.label }), h('span', { class: 'pd', text: v.definition || '' }))) : h('p', { class: 'muted', text: 'No values fit the chosen parent. Use Disagree.' }),
      f.required ? null : h('div', { class: 'muted', text: 'To make this field blank, use Disagree.' })) : null;
    const status = !e ? (implicit ? 'Blank, nothing to check' : confirmIt ? 'None given: Agree that there is none, or Other to add one' : 'Not checked') : e.action === 'agree' ? 'Agreed' : e.action === 'disagree' ? (wb(frame) ? 'Disagreed: this code is wrong' : 'Disagreed: should be blank') : e.action === 'other' ? `Changed to ${e.value}` : 'Marked unsure';
    return h('div', { class: 'frow' + (sel ? ' sel' : '') + (e ? ' ' + e.action : ''), onclick: () => { if (o.sel !== i) { o.setSel(i); o.rerender(); } } },
      h('div', { class: 'fl' }, h('div', { class: 'fn' }, h('b', { text: f.label }), f.required ? null : h('span', { class: 'muted', text: ' optional' }),
        h('button', { type: 'button', class: 'link', onclick: (ev) => { ev.stopPropagation(); openCodebook({ frame: frame.id, field: f.id, value: orig, tab: 'field' }); } }, 'Definitions')),
        h('div', { class: 'fv' }, orig != null ? chip(orig, { onclick: (ev) => { ev.stopPropagation(); openCodebook({ frame: frame.id, field: f.id, value: orig, tab: 'field' }); } }) : h('span', { class: 'muted', text: f.confirm_blank ? 'None given' : '(blank)' }),
          e && e.action === 'other' ? h('span', { class: 'arrow' }, '→ ', chip(e.value, { onclick: (ev) => { ev.stopPropagation(); openCodebook({ frame: frame.id, field: f.id, value: e.value, tab: 'field' }); } })) : null,
          e && e.action === 'disagree' ? h('span', { class: 'arrow muted', text: '→ (blank)' }) : null),
        orig != null && vdef(orig) && vdef(orig).definition ? h('div', { class: 'fd', text: vdef(orig).definition }) : null,
        orig != null && vdef(orig) && vdef(orig).source ? h('div', { class: 'muted small', text: 'Source: ' + vdef(orig).source }) : null,
        bp ? h('div', { class: 'warnline', text: bp + ' Choose Other or Disagree.' }) : null),
      h('div', { class: 'fa' }, h('div', { class: 'acts' }, btns), h('div', { class: 'fs muted', text: status }), pick,
        wb(frame) && o.note && !implicit ? (() => { const nv = (st.notes || {})[f.id] || ''; const need = e && e.action === 'disagree' && !nv.trim();
          return h('label', { class: 'fnote' + (need ? ' need' : '') }, h('span', { class: 'muted small', text: need ? 'Note (needed for Disagree)' : 'Note' }),
            h('input', { type: 'text', value: nv, disabled: !!o.locked, 'data-note': f.id, onclick: (ev) => ev.stopPropagation(), onblur: (ev) => { if (ev.target.value !== nv) o.note(f, ev.target.value); } })); })() : null));
  });
}

const QFIELD = { id: '_question' };
/** One question per item, with its options and a note (a sample with answers "question", such as the heading sample). */
export function questionRows(q, st, o) {
  const e = st.fields[QFIELD.id];
  const nv = (st.notes || {})[QFIELD.id] || '';
  return [h('div', { class: 'frow sel' + (e ? ' answered' : '') },
    h('div', { class: 'fl' }, h('div', { class: 'fn' }, h('b', { text: q.text }))),
    h('div', { class: 'fa' },
      h('div', { class: 'acts' }, q.options.map((opt, i) => h('button', { type: 'button', class: 'act answer' + (e && e.value === opt ? ' on' : ''), 'data-option': opt, disabled: !!o.locked, title: `${opt} (${i + 1})`,
        onclick: (ev) => { ev.stopPropagation(); o.act(QFIELD, 'answer', opt); } }, opt, h('kbd', { text: String(i + 1) })))),
      h('div', { class: 'fs muted', text: e ? `Answered: ${e.value}` : 'Not answered' }),
      h('label', { class: 'fnote' }, h('span', { class: 'muted small', text: 'Note (optional)' }),
        h('input', { type: 'text', value: nv, disabled: !!o.locked, 'data-note': QFIELD.id, onclick: (ev) => ev.stopPropagation(), onblur: (ev) => { if (ev.target.value !== nv) o.note(QFIELD, ev.target.value); } }))))];
}

/** The sample a frame is being verified in. Both views use the same one, so a coder can switch views at any time. */
export function currentSample(frame) {
  const ss = S.samples.filter((s) => s.frame === frame.id && sameLayer(s.layer, layerOf(frame.id, S.review), S.review)).sort((a, b) => (a.created < b.created ? -1 : 1));
  // Only a coder's own pick is kept. The default is worked out afresh each time, so a render during
  // loading, before each coder's view of the samples is set, cannot fix the wrong sample in place.
  return defaultSample(ss, V.pick[frame.id]);
}

// ---------- sampler ----------
const today = () => { const d = new Date(); return Number(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`); };

/** Write a sample, trying the next free id if the name is taken. Returns the saved sample or null. */
async function saveSample(obj, base, n) {
  for (let k = 0; k < 20; k++) {
    const id = `${base}${n + k}`;
    const o = { ...obj, id };
    try { await S.store.writeJSON(`samples/${id}.json`, o, { message: `Draw sample ${id}` }); S.samples.push(o); return o; }
    catch (e) { if (e.status === 422 || e.status === 409) continue; alert('Could not save the sample: ' + e.message); return null; }
  }
  return null;
}

function strataOf(frame, units) {
  const st = {};
  for (const u of populationFor(frame.id)) { const k = u.stratum; st[k] = st[k] || { population: 0, drawn: 0 }; st[k].population++; }
  const pick = new Set(units.map((u) => u.doc + '|' + u.unit));
  for (const u of populationFor(frame.id)) if (pick.has(u.doc + '|' + u.unit)) st[u.stratum].drawn++;
  return st;
}

function renderSampler(root, frame) {
  const sp = S.review.sampling || { fraction: 0.15, min_per_stratum: 2 };
  const frames = verifiableFrames();
  if (!V.draft) V.draft = { mode: 'percent', seed: today(), fraction: sp.fraction, min: sp.min_per_stratum, result: null, reason: 'First verification sample', docs: null, frames: null };
  const dr = V.draft;
  const docsWithUnits = S.docs.filter((d) => frames.some((f) => populationFor(f.id).some((u) => u.doc === d.id)));
  if (!dr.docs) dr.docs = new Set(docsWithUnits.map((d) => d.id));
  if (!dr.frames) dr.frames = new Set(frames.map((f) => f.id));
  const rr = () => renderVerify(root);
  const setMode = (m) => { dr.mode = m; dr.result = null; rr(); };

  const preview = () => {
    if (dr.mode === 'percent') dr.result = draw(populationFor(frame.id), { fraction: dr.fraction, minPer: dr.min, seed: dr.seed });
    else dr.result = { byFrame: frames.filter((f) => dr.frames.has(f.id)).map((f) => { const pop = populationFor(f.id); const units = pop.filter((u) => dr.docs.has(u.doc)).map((u) => ({ doc: u.doc, unit: u.unit })); return { frame: f, units, population: pop.length }; }) };
    rr();
  };
  const lock = async () => {
    const r = dr.result;
    const base = { layer: layerOf(frame.id, S.review), created: new Date().toISOString(), created_by: S.handle, locked: true, reason: dr.reason };
    if (dr.mode === 'percent') {
      const n = S.samples.filter((x) => x.frame === frame.id).length + 1;
      const o = await saveSample({ ...base, frame: frame.id, mode: 'percent', seed: dr.seed, fraction: dr.fraction, min_per_stratum: dr.min, stratify_by: frame.stratify_by, population: r.population, strata: r.strata, topped_up: r.toppedUp, units: r.units }, `${frame.id}-s`, n);
      if (o) { V.pick[frame.id] = o.id; V.sampleId = null; V.draft = null; notify(); }
      return;
    }
    const docs = docsWithUnits.map((d) => d.id).filter((id) => dr.docs.has(id));
    for (const x of r.byFrame) {
      if (!x.units.length) continue;
      const n = S.samples.filter((y) => y.frame === x.frame.id).length + 1;
      const o = await saveSample({ ...base, frame: x.frame.id, mode: 'documents', docs, fraction: x.population ? x.units.length / x.population : 0, stratify_by: x.frame.stratify_by, population: x.population, strata: strataOf(x.frame, x.units), units: x.units }, `${x.frame.id}-d`, n);
      if (o) V.pick[x.frame.id] = o.id;
    }
    V.draft = null; V.sampleId = null; V.mode = 'doc'; notify();
  };

  const r = dr.result;
  const tabs = h('div', { class: 'seg' }, [['percent', 'A percentage of units'], ['docs', 'Whole documents']].map(([k, l]) => h('button', { type: 'button', class: dr.mode === k ? 'on' : '', onclick: () => setMode(k) }, l)));
  let body;
  if (dr.mode === 'percent') {
    body = [h('p', { text: `The sample takes ${Math.round(dr.fraction * 100)}% of the units in each ${frame.fields.find((f) => f.id === frame.stratify_by).label.toLowerCase()} group of the ${frame.name} frame, at least ${dr.min} per group, spread across documents, then adds one unit from any document not yet covered. The seed and counts are saved with the sample. Once locked, it cannot be redrawn.` }),
      h('div', { class: 'form' },
        h('label', null, 'Sample size', h('select', { onchange: (e) => { dr.fraction = Number(e.target.value); dr.result = null; rr(); } }, [...new Set([0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1, dr.fraction])].sort((a, b) => a - b).map((x) => h('option', { value: x, selected: x === dr.fraction, text: x === 1 ? '100% (every unit)' : `${Math.round(x * 100)}%` })))),
        h('label', null, 'Random seed', h('input', { type: 'text', value: dr.seed, onchange: (e) => { dr.seed = parseInt(e.target.value, 10) || 1; dr.result = null; rr(); } })),
        h('label', null, 'Reason', h('input', { type: 'text', value: dr.reason, onchange: (e) => { dr.reason = e.target.value; } })))];
  } else {
    const allOn = dr.docs.size === docsWithUnits.length;
    const unitsIn = (id) => frames.filter((f) => dr.frames.has(f.id)).reduce((n, f) => n + populationFor(f.id).filter((u) => u.doc === id).length, 0);
    body = [h('p', { text: 'Choose the documents to verify. Every coded fragment in them goes into the sample, one sample per frame, and you work through them a document at a time with the full text beside you. Once locked, a sample cannot be redrawn.' }),
      h('div', { class: 'form' }, h('label', null, 'Reason', h('input', { type: 'text', value: dr.reason, onchange: (e) => { dr.reason = e.target.value; } }))),
      frames.length > 1 ? h('div', null, h('b', { text: 'Frames' }), h('div', { class: 'checks' }, frames.map((f) => h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: dr.frames.has(f.id), onchange: (e) => { if (e.target.checked) dr.frames.add(f.id); else dr.frames.delete(f.id); dr.result = null; rr(); } }), ' ' + f.name)))) : null,
      h('div', null, h('div', { class: 'row' }, h('b', { text: `Documents (${dr.docs.size} of ${docsWithUnits.length})` }),
        h('button', { type: 'button', class: 'link', onclick: () => { dr.docs = new Set(allOn ? [] : docsWithUnits.map((d) => d.id)); dr.result = null; rr(); } }, allOn ? 'Clear all' : 'Select all')),
        h('div', { class: 'checks docs' }, docsWithUnits.map((d) => h('label', { class: 'ck' }, h('input', { type: 'checkbox', checked: dr.docs.has(d.id), onchange: (e) => { if (e.target.checked) dr.docs.add(d.id); else dr.docs.delete(d.id); dr.result = null; rr(); } }),
          h('span', { class: 'mono', text: ' ' + d.id }), h('span', { text: ' ' + (d.short || d.title || '').slice(0, 70) }), h('span', { class: 'muted', text: ` · ${unitsIn(d.id)} fragments` })))))];
  }
  const count = r ? (dr.mode === 'percent' ? r.units.length : r.byFrame.reduce((n, x) => n + x.units.length, 0)) : 0;
  root.replaceChildren(modeBar(root), h('div', { class: 'page narrow' },
    h('div', { class: 'ph' }, h('h1', { text: 'Draw a verification sample' }), h('div', { class: 'muted', text: `Checks the ${S.review.layers.find((l) => l.id === layerOf(frame.id, S.review)).label} layer` })),
    h('section', { class: 'card' }, tabs, ...body,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: preview, disabled: !S.ready || (dr.mode === 'docs' && (!dr.docs.size || !dr.frames.size)), text: S.ready ? 'Preview draw' : 'Loading the corpus' }),
        r && count ? h('button', { type: 'button', class: 'btn primary', onclick: lock, text: `Lock and save ${count} units` }) : null,
        S.samples.length ? h('button', { type: 'button', class: 'btn', onclick: () => { V.sampleId = null; V.draft = null; rr(); } }, 'Cancel') : null)),
    r && dr.mode === 'percent' ? h('section', { class: 'card' }, h('h2', { text: `${r.units.length} of ${r.population.toLocaleString()} units (${(100 * r.units.length / r.population).toFixed(1)}%)` }),
      h('p', { class: 'muted', text: `${r.toppedUp.length} documents needed a top-up unit so every document is checked at least once.` }),
      h('table', { class: 't' }, h('thead', null, h('tr', null, ['Group', 'In corpus', 'Drawn'].map((x) => h('th', { text: x })))),
        h('tbody', null, Object.entries(r.strata).sort().map(([k, s]) => h('tr', null, h('td', null, h('span', { class: 'dot', style: { background: colourFor(k) } }), ' ' + k), h('td', { class: 'mono', text: s.population }), h('td', { class: 'mono', text: s.drawn })))))) : null,
    r && dr.mode === 'docs' ? h('section', { class: 'card' }, h('h2', { text: `${count} units in ${dr.docs.size} documents` }),
      h('table', { class: 't' }, h('thead', null, h('tr', null, ['Frame', 'Units in corpus', 'In sample'].map((x) => h('th', { text: x })))),
        h('tbody', null, r.byFrame.map((x) => h('tr', null, h('td', { text: x.frame.name }), h('td', { class: 'mono', text: x.population }), h('td', { class: 'mono', text: x.units.length })))))) : null));
}

/** The switch between the two Verify views. */
export function modeBar(root) {
  if (!feature('document_view')) return h('div', { class: 'vmode off' }); // one view only: nothing to switch
  return h('div', { class: 'vmode' }, h('div', { class: 'seg' },
    [['fragment', 'By fragment'], ['doc', 'By document']].map(([k, l]) => h('button', { type: 'button', class: V.mode === k ? 'on' : '', onclick: () => { V.mode = k; V.picker = null; if (V.sampleId === '__new') V.sampleId = null; renderVerify(root); window.scrollTo(0, 0); } }, l))),
    h('span', { class: 'muted', text: V.mode === 'doc' ? 'Whole document with every coded fragment marked. Work a document at a time.' : 'One fragment at a time, in sample order.' }));
}

// ---------- main ----------
export function renderVerify(root) {
  const frames = verifiableFrames();
  if (!S.review.first_layer || !frames.length) { root.replaceChildren(h('div', { class: 'page' }, h('h1', { text: 'Verify' }), h('p', { class: 'muted', text: 'This review has no coded layer to verify yet.' }))); return; }
  // open on a frame that holds items for this coder, so a coder whose sample is on a second frame lands on it
  const mineIn = (f) => S.samples.some((x) => x.frame === f.id && sameLayer(x.layer, layerOf(f.id, S.review), S.review) && x.coders && x.assigned && (x.units || []).length);
  // the default is worked out afresh until loading ends: samples on other layers are not known before then
  const frameId = frames.find((f) => f.id === V.frame) ? V.frame : (frames.find(mineIn) || frames[0]).id;
  if (S.ready) V.frame = frameId;
  const baseFrame = S.frames[frameId];
  if (V.sampleId === '__new') { renderSampler(root, baseFrame); return; }
  if (V.mode === 'doc' && !feature('document_view')) V.mode = 'fragment';
  if (V.mode === 'doc') { renderDocView(root); return; }
  S.frameInView = baseFrame.id; // the header's orientation and codebook follow the frame in view
  const samples = S.samples.filter((s) => s.frame === baseFrame.id && sameLayer(s.layer, layerOf(baseFrame.id, S.review), S.review));
  if (!samples.length || V.sampleId === '__new') { renderSampler(root, baseFrame); return; }
  const sample = currentSample(baseFrame);
  const frame = frameFor(baseFrame, sample, verifyOpts(baseFrame.id, sample));
  if (sample.coders && !sample.units.length) {
    root.replaceChildren(modeBar(root), h('div', { class: 'page narrow' }, h('section', { class: 'card' }, h('h2', { text: sample.title || sample.id }),
      h('p', { text: sample.assigned ? 'No items in this sample are assigned to you.' : `This sample is assigned to ${Object.keys(sample.coders).join(' and ')}. You have no items in it.` }),
      samples.length > 1 ? h('label', { class: 'sel' }, 'Sample', h('select', { onchange: (e) => { V.pick[baseFrame.id] = e.target.value; V.unit = null; renderVerify(root); } }, samples.map((s) => h('option', { value: s.id, selected: s.id === sample.id, text: s.id })))) : null)));
    return;
  }
  if (!S.ready) { root.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'muted', text: `Loading ${S.loading.done} of ${S.loading.total} files` }))); return; }

  const queue = sampleQueue(sample);
  const idx = indexMine(sample);
  const stOf = (u) => idx.get(u.unit) || { fields: {}, done: false };
  const doneN = queue.filter((u) => stOf(u).done).length;
  if (V.orient || shouldOpen(sample, doneN)) {
    root.replaceChildren(orientationPage(() => { markSeen(sample.id); V.orient = false; renderVerify(root); window.scrollTo(0, 0); }, 'Start coding', frame.id));
    return;
  }
  const unsureN = queue.filter((u) => Object.values(stOf(u).fields).some((e) => e.action === 'unsure')).length;
  const matches = (u) => V.filter === 'all' || (V.filter === 'todo' ? !stOf(u).done : V.filter === 'unsure' ? Object.values(stOf(u).fields).some((e) => e.action === 'unsure') : stOf(u).done);
  const shown = queue.filter(matches);
  let cur = queue.find((u) => u.unit === V.unit) || shown[0] || queue[0];
  V.unit = cur.unit;
  const goto = (u) => { if (u) { V.unit = u.unit; V.fieldIdx = 0; V.picker = null; renderVerify(root); window.scrollTo(0, 0); } };
  const qi = queue.findIndex((u) => u.unit === cur.unit);
  const pos = qi;
  const next = () => goto(queue.slice(qi + 1).find(matches) || shown.find((u) => u.unit !== cur.unit) || null);
  const prev = () => goto(queue[qi - 1]);

  const doc = S.docById.get(cur.doc);
  const unit = findUnit(cur.doc, cur.unit, frame.id);
  const codes = firstCodes(cur.doc, cur.unit, frame.id) || {};
  const st = stOf(cur);
  const events = docEvents(cur.doc);
  const extras = firstExtras(cur.doc, cur.unit, frame.id);
  const list = unitList(cur.doc);
  const ui = list.findIndex((u) => u.id === cur.unit);
  const para = unit && unit.kind === 'paragraph';

  const mySubmit = sample.coders && submitted(docEvents(SAMPLES_DOC), sample.id).has(S.handle);
  const act = (field, action, value) => { addEvent(cur.doc, 'verify', { sample: sample.id, unit: cur.unit, frame: frame.id, field: field.id, action, value: value ?? null }); };
  const note = (field, text) => { addEvent(cur.doc, 'note', { sample: sample.id, unit: cur.unit, frame: frame.id, field: field.id, text }); };
  // a question sample (the heading sample) asks one question per item in place of checking codes
  const q = sample.answers === 'question' && sample.question ? sample.question : null;
  const open = q ? (st.fields[QFIELD.id] ? [] : [{ id: QFIELD.id, label: 'the question' }]) : unresolved(frame, codes, st);
  const agreeRest = () => { if (q) return; for (const f of open) if (!badParent(frame, f, codes, st)) act(f, 'agree'); };
  const finish = () => { addEvent(cur.doc, 'done', { sample: sample.id, unit: cur.unit, frame: frame.id }); };

  // sidebar
  const strata = Object.entries(sample.strata || {}).sort();
  const stratumOf = (u) => { const c = firstCodes(u.doc, u.unit, frame.id); return c ? c[frame.stratify_by] ?? '(blank)' : '(blank)'; };
  const sdone = {}, stot = {};
  for (const u of queue) { const k = stratumOf(u); stot[k] = (stot[k] || 0) + 1; if (stOf(u).done) sdone[k] = (sdone[k] || 0) + 1; }

  const aside = h('aside', { class: 'vside' },
    h('section', { class: 'card' },
      frames.length > 1 ? h('label', { class: 'sel' }, 'Frame', h('select', { onchange: (e) => { V.frame = e.target.value; V.unit = null; renderVerify(root); } }, frames.map((f) => h('option', { value: f.id, selected: f.id === frame.id, text: f.name })))) : h('h2', { text: frame.name }),
      samples.length > 1 ? h('label', { class: 'sel' }, 'Sample', h('select', { onchange: (e) => { V.pick[frame.id] = e.target.value; V.unit = null; renderVerify(root); } }, samples.map((s) => h('option', { value: s.id, selected: s.id === sample.id, text: `${s.id}${s.mode === 'documents' ? ' (whole documents)' : ''}` })))) : null,
      h('div', { class: 'big' }, h('b', { text: `${doneN} / ${queue.length}` }), h('span', { class: 'muted', text: ` verified by you (${pct(doneN, queue.length)})` })),
      bar(queue.length ? doneN / queue.length : 0), unsureN ? h('div', { class: 'muted', text: `${unsureN} marked unsure` }) : null,
      sample.coders ? assignedBox(sample, queue, doneN, mySubmit, () => renderVerify(root))
        : h('div', { class: 'lock muted', text: `Drawn ${sample.created.slice(0, 10)} by ${sample.created_by} · seed ${sample.seed} · ${Math.round(sample.fraction * 100)}% · locked` }),
      sample.coders ? null : h('button', { type: 'button', class: 'link', onclick: () => { V.sampleId = '__new'; V.draft = null; renderVerify(root); } }, 'Draw another sample')),
    h('section', { class: 'card' }, h('h2', { text: 'Queue' }),
      h('div', { class: 'pills' }, [['todo', 'To do'], ['unsure', 'Unsure'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => h('button', { type: 'button', class: 'pill' + (V.filter === k ? ' on' : ''), onclick: () => { V.filter = k; V.unit = null; renderVerify(root); } }, l))),
      h('div', { class: 'qlist' }, (() => { const a = shown.findIndex((u) => u.unit === cur.unit); const b = a >= 0 ? Math.max(0, a - 3) : Math.max(0, shown.findIndex((u) => queue.indexOf(u) > qi)); return shown.slice(b, b + 12); })().map((u) => {
        const un = findUnit(u.doc, u.unit, frame.id); const s = stOf(u);
        return h('button', { type: 'button', class: 'qi' + (u.unit === cur.unit ? ' cur' : ''), onclick: () => goto(u) },
          h('span', { class: 'qs ' + (s.done ? 'd' : Object.keys(s.fields).length ? 'p' : '') }), h('span', { class: 'qt' }, sample.coders ? h('b', { class: 'mono', text: `${u.order[S.handle]}. ` }) : null, h('b', { class: 'mono', text: u.unit }), h('span', { text: ' ' + ((un && (un.label || un.text)) || '').slice(0, 60) })));
      })), h('div', { class: 'muted', text: `${shown.length} shown` })),
    sample.coders ? null : h('section', { class: 'card' }, h('h2', { text: 'Sample by group' }),
      strata.map(([k, s]) => h('div', { class: 'sg' }, h('div', { class: 'sgl' }, h('span', null, h('span', { class: 'dot', style: { background: colourFor(k) } }), ' ' + k), h('span', { class: 'mono muted', text: `${sdone[k] || 0}/${stot[k] || 0}` })), bar((stot[k] ? (sdone[k] || 0) / stot[k] : 0), colourFor(k)))))
  );

  const rows = q ? questionRows(q, st, { act, note, locked: mySubmit }) : fieldRows(frame, codes, st, { act, note, locked: mySubmit, sel: V.fieldIdx, setSel: (i) => { V.fieldIdx = i; }, pk: '', rerender: () => renderVerify(root), root });

  // first coder's memo and rationale stay hidden until the unit is done
  const hidden = !st.done;
  const claudeWhy = (() => { const raw = extras.raw && extras.raw[frame.id]; if (!raw) return []; return Object.entries(raw).filter(([, v]) => v && typeof v === 'object' && (v.why || v.conf != null)).map(([k, v]) => ({ k, why: v.why, conf: v.conf })); })();
  const comments = commentsFor(events, cur.unit);
  const myMemo = memoFor(events, { coder: S.handle, unit: cur.unit, frame: frame.id });

  const ctx = (u, label) => u ? h('div', { class: 'ctx' }, h('span', { class: 'ctxl', text: label }), (u.text || u.label || '').slice(0, 400)) : null;
  const card = h('section', { class: 'card ucard' },
    h('div', { class: 'uh' },
      h('div', null, h('div', { class: 'muted', text: sample.coders ? `Item ${cur.order[S.handle]} of ${queue.length}` : `Unit ${qi + 1} of ${queue.length}` }), h('div', { class: 'mono', text: `${cur.doc} · ${cur.unit}${unit && unit.page ? ' · p. ' + unit.page : ''}` })),
      h('div', { class: 'row' }, h('a', { href: `#/doc/${encodeURIComponent(cur.doc)}`, class: 'btn', text: 'Document profile' }),
        !feature('pdf') ? null : h('button', { type: 'button', class: 'btn', disabled: !(doc && pdfParts(doc).some((x) => S.store.has(x.file))), title: doc && pdfParts(doc).some((x) => S.store.has(x.file)) ? `Opens the PDF on this page and copies the first words of the ${unitLabel(frame.id, S.review)}, to search for` : 'The PDF is not in the data repo yet', onclick: () => openPdf(doc, unit && unit.page, unit && unit.text, unit && (unit.flags || []).includes('page-printed'), unitLabel(frame.id, S.review)) }, 'Open PDF'),
        h('button', { type: 'button', class: 'btn', onclick: prev, disabled: qi <= 0 }, 'Previous'), h('button', { type: 'button', class: 'btn', onclick: next }, 'Skip'))),
    h('div', { class: 'dt', text: doc ? doc.title : cur.doc }),
    para ? ctx(list[ui - 1], 'Before') : null,
    h('div', { class: 'passage' }, unit && unit.label && !para ? h('div', { class: 'plabel', text: unit.label }) : null, unit ? (unit.text || unit.label) : '(unit not found)'),
    para ? ctx(list[ui + 1], 'After') : null,
    unit && (unit.flags || []).includes('context-dependent') ? h('div', { class: 'warnline', text: 'This paragraph depends on its context. Read the neighbours before judging.' }) : null,
    unit && unit.parent && doc ? h('div', { class: 'muted', text: 'Intervention: ' + (((doc.interventions || []).find((x) => x.id === unit.parent) || {}).name || unit.parent) }) : null,
    h('div', { class: 'frows' }, rows),
    h('div', { class: 'notes' },
      h('div', null, h('b', { text: "First coder's notes" }), hidden ? h('div', { class: 'muted', text: 'Hidden until you finish this unit, so they cannot anchor your judgement.' }) :
        h('div', null, extras.note ? h('p', { text: extras.note }) : h('p', { class: 'muted', text: 'No notes.' }), claudeWhy.map((c) => h('p', { class: 'muted', text: `${c.k}: ${c.conf != null ? 'confidence ' + c.conf + '. ' : ''}${c.why || ''}` })))),
      h('label', null, h('b', { text: 'Your memo' }), h('textarea', { rows: 3, placeholder: 'Anything a second reader should know', value: myMemo, onblur: (ev) => { if (ev.target.value !== myMemo) addEvent(cur.doc, 'memo', { unit: cur.unit, frame: frame.id, text: ev.target.value }); } }, myMemo))),
    h('div', { class: 'comments' }, h('b', { text: `Discussion (${comments.length})` }),
      comments.map((c) => h('div', { class: 'cm' }, h('span', { class: 'cmw', text: c.coder }), h('span', { class: 'muted', text: ' ' + c.t.slice(0, 16).replace('T', ' ') }), h('div', { text: c.text }))),
      h('div', { class: 'row' }, h('textarea', { rows: 2, placeholder: 'Comment for the whole team', id: 'newcomment' }), h('button', { type: 'button', class: 'btn', onclick: () => { const t = document.getElementById('newcomment'); if (t.value.trim()) { addEvent(cur.doc, 'comment', { unit: cur.unit, text: t.value.trim() }); } } }, 'Post'))),
    h('div', { class: 'foot' },
      mySubmit ? h('div', { class: 'row' }, h('span', { class: 'ok', text: 'Submitted. Your answers are final.' }), h('button', { type: 'button', class: 'btn primary', onclick: next }, 'Next unit'))
      : st.done ? h('div', { class: 'row' }, h('span', { class: 'ok', text: 'Done' }), h('button', { type: 'button', class: 'btn', onclick: () => addEvent(cur.doc, 'reopen', { sample: sample.id, unit: cur.unit, frame: frame.id }) }, 'Reopen'), h('button', { type: 'button', class: 'btn primary', onclick: next }, 'Next unit'))
        : h('div', { class: 'row' }, open.length > 1 ? h('button', { type: 'button', class: 'btn', title: 'Agree with every unchecked field (Shift+A)', onclick: () => agreeRest() }, 'Agree with all remaining') : null,
          h('button', { type: 'button', class: 'btn primary', disabled: open.length > 0, onclick: () => { finish(); setTimeout(next, 0); } }, 'Done, next unit'),
          open.length ? h('span', { class: 'muted', text: `${open.length} field${open.length > 1 ? 's' : ''} left: ${open.map((f) => f.label).join(', ')}` }) : null)));

  const task = taskLine(() => { V.orient = true; renderVerify(root); window.scrollTo(0, 0); }, frame.id);
  root.replaceChildren(modeBar(root), h('div', { class: 'vwrap' }, aside, h('div', { class: 'vmain' }, task, card)));

  // keyboard
  V.keys = (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
    const f = frame.fields[V.fieldIdx];
    const k = ev.key.toLowerCase();
    if (mySubmit && !['j', 'k', 'arrowdown', 'arrowup', 'escape'].includes(k)) return false; // submitted: move, never answer
    if (k === 'arrowdown') { V.fieldIdx = Math.min(frame.fields.length - 1, V.fieldIdx + 1); V.picker = null; renderVerify(root); }
    else if (k === 'arrowup') { V.fieldIdx = Math.max(0, V.fieldIdx - 1); V.picker = null; renderVerify(root); }
    else if (k === 'j') next(); else if (k === 'k') prev();
    else if (q && /^[1-9]$/.test(k) && q.options[Number(k) - 1]) act(QFIELD, 'answer', q.options[Number(k) - 1]);
    else if (q && 'adou'.includes(k)) return false;
    else if (k === 'a' && ev.shiftKey) agreeRest();
    else if (k === 'a') { const e2 = ACTIONS[0]; if (!badParent(frame, f, codes, st)) act(f, e2[0]); }
    else if (k === 'd') { if ((codes[f.id] ?? null) != null) act(f, 'disagree'); }
    else if (k === 'u' && !wb(frame)) act(f, 'unsure');
    else if (k === 'o') { V.picker = V.picker === f.id ? null : f.id; V.pickQ = ''; renderVerify(root); }
    else if (k === 'enter' && !st.done && open.length === 0) { finish(); setTimeout(next, 0); }
    else if (k === 'escape') { if (V.picker) { V.picker = null; renderVerify(root); } else return false; }
    else return false;
    ev.preventDefault();
    return true;
  };
}

/** Sidebar box for an assigned sample: who it belongs to, blinding, and Submit. */
export function assignedBox(sample, queue, doneN, mySubmit, rerender) {
  const evs = docEvents(SAMPLES_DOC);
  const subs = submitted(evs, sample.id);
  const open = unblinded(sample, evs);
  const others = Object.keys(sample.coders).filter((c) => c !== S.handle);
  const submit = () => {
    if (!confirm(`Submit all ${queue.length} items? Your answers become final and cannot be changed.`)) return;
    addEvent(SAMPLES_DOC, 'submit', { sample: sample.id, items: queue.length });
    rerender();
  };
  return h('div', { class: 'assigned' },
    h('div', { class: 'muted', text: `Your ${queue.length} items, in your order.` }),
    h('div', { class: 'muted', text: open ? 'Every coder has submitted. Answers are visible to all.' : `Blind: you cannot see ${others.join(' or ') || 'other coders'}'s answers, and they cannot see yours, until everyone submits. ${others.filter((c) => subs.has(c)).length ? others.filter((c) => subs.has(c)).join(', ') + ' has submitted.' : ''}` }),
    mySubmit ? h('div', { class: 'ok', text: 'You have submitted this sample.' })
      : h('button', { type: 'button', class: 'btn primary', disabled: doneN < queue.length, title: doneN < queue.length ? 'Finish every item first' : '', onclick: submit, text: doneN < queue.length ? `Submit sample (${queue.length - doneN} items left)` : 'Submit sample' }));
}
