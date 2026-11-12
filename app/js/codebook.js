// Codebook panel: definitions, rules and anchors one click away, plus the full codebook text.

import { S } from './data.js';
import { h, chip, colourFor, mdToHtml } from './ui.js';
import { frameSetting } from './settings.js';

const st = { open: false, frame: null, field: null, value: null, tab: 'field', q: '' };
let el = null;
let full = { file: null, html: null };
// the codebook file and version follow the frame shown (or in view), so an older and a newer frame each open their own
const cbFrame = () => (st.frame && S.frames[st.frame] ? st.frame : S.frameInView);
const cbFile = () => frameSetting(cbFrame(), 'codebook', S.review);
const cbVersion = () => frameSetting(cbFrame(), 'codebook_version', S.review) || '';

export function mountCodebook(root) {
  el = h('aside', { id: 'codebook', 'aria-label': 'Codebook', hidden: true });
  root.append(el);
}

export function toggleCodebook() { st.open ? closeCodebook() : openCodebook(); }
export function closeCodebook() { st.open = false; render(); }

export function openCodebook(opts = {}) {
  st.open = true;
  if (opts.frame) st.frame = opts.frame;
  if (opts.field !== undefined) st.field = opts.field;
  if (opts.value !== undefined) st.value = opts.value;
  st.tab = opts.tab || (st.field ? 'field' : st.tab);
  render();
}

function frameOrFirst() { return st.frame && S.frames[st.frame] ? S.frames[st.frame] : S.frames[S.frameInView] || Object.values(S.frames)[0]; }

function valueBlock(v, hl) {
  return h('div', { class: 'cb-val' + (hl ? ' hl' : ''), id: hl ? 'cb-hl' : null },
    h('div', { class: 'cb-name' }, h('span', { class: 'dot', style: { background: colourFor(v.id) } }), v.label, v.group ? h('span', { class: 'cb-group', text: v.group }) : null),
    v.definition ? h('p', { text: v.definition }) : h('p', { class: 'muted', text: 'The codebook gives no definition for this value.' }),
    v.anchors && v.anchors.length ? h('ul', { class: 'cb-anch' }, v.anchors.map((a) => h('li', { text: a }))) : null);
}

function fieldTab() {
  const fr = frameOrFirst();
  if (!fr) return h('p', { class: 'muted', text: 'No frames loaded.' });
  const f = fr.fields.find((x) => x.id === st.field) || fr.fields[0];
  const q = st.q.toLowerCase();
  const vals = f.values.filter((v) => !q || (v.label + ' ' + v.definition + ' ' + (v.group || '')).toLowerCase().includes(q));
  const groups = [...new Set(vals.map((v) => v.group || ''))];
  return h('div', null,
    h('div', { class: 'cb-picker' }, fr.fields.map((x) => h('button', { type: 'button', class: 'pill' + (x.id === f.id ? ' on' : ''), onclick: () => { st.field = x.id; st.value = null; render(); } }, x.label))),
    h('div', { class: 'cb-ref', text: f.codebook_ref }),
    f.rules && f.rules.length ? h('details', { open: true }, h('summary', { text: 'Rules' }), h('ol', { class: 'cb-rules' }, f.rules.map((r) => h('li', { text: r })))) : null,
    h('input', { type: 'text', class: 'cb-search', placeholder: 'Filter values', value: st.q, oninput: (e) => { st.q = e.target.value; render(true); } }),
    groups.map((g) => h('div', null, g ? h('h4', { text: g }) : null, vals.filter((v) => (v.group || '') === g).map((v) => valueBlock(v, v.id === st.value)))));
}

function allTab() {
  const q = st.q.toLowerCase();
  const rows = [];
  for (const fr of Object.values(S.frames)) for (const f of fr.fields) for (const v of f.values) {
    if (q && !(v.label + ' ' + v.definition).toLowerCase().includes(q)) continue;
    rows.push({ fr, f, v });
  }
  return h('div', null,
    h('input', { type: 'text', class: 'cb-search', placeholder: 'Search every code and definition', value: st.q, oninput: (e) => { st.q = e.target.value; render(true); } }),
    h('p', { class: 'muted', text: `${rows.length} values` }),
    rows.slice(0, 120).map(({ fr, f, v }) => h('div', { class: 'cb-val', onclick: () => openCodebook({ frame: fr.id, field: f.id, value: v.id, tab: 'field' }) },
      h('div', { class: 'cb-name' }, h('span', { class: 'dot', style: { background: colourFor(v.id) } }), v.label, h('span', { class: 'cb-group', text: `${f.label}${v.group ? ' · ' + v.group : ''}` })),
      v.definition ? h('p', { text: v.definition }) : null)));
}

function fullTab() {
  const wrap = h('div', { class: 'md' });
  const file = cbFile();
  if (!file) return h('p', { class: 'muted', text: 'This review has no codebook file yet.' });
  if (full.file === file && full.html) { wrap.innerHTML = full.html; queueMicrotask(jump); return wrap; }
  wrap.append(h('p', { class: 'muted', text: 'Loading the codebook' }));
  S.store.readText(file).then((t) => { full = { file, html: mdToHtml(t) }; if (st.open && st.tab === 'full') render(); }).catch((e) => { wrap.textContent = 'Could not load the codebook: ' + e.message; });
  return wrap;
}

function jump() {
  const fr = frameOrFirst();
  const f = fr && fr.fields.find((x) => x.id === st.field);
  if (!f || !el) return;
  const hs = [...el.querySelectorAll('[data-h]')];
  const hit = hs.find((n) => n.dataset.h === f.codebook_ref);
  if (hit) hit.scrollIntoView({ block: 'start' });
}

export function render(keepScroll) {
  if (!el) return;
  el.hidden = !st.open;
  if (!st.open) return;
  const body = h('div', { class: 'cb-body' }, st.tab === 'field' ? fieldTab() : st.tab === 'all' ? allTab() : fullTab());
  const prev = el.querySelector('.cb-body');
  const top = prev ? prev.scrollTop : 0;
  const focus = document.activeElement && document.activeElement.classList.contains('cb-search');
  const pos = focus ? document.activeElement.selectionStart : 0;
  el.replaceChildren(
    h('div', { class: 'cb-head' },
      h('b', { text: 'Codebook' }), h('span', { class: 'muted', text: cbVersion() }),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Close codebook', onclick: closeCodebook }, '×')),
    h('div', { class: 'cb-tabs' }, [['field', 'This field'], ['all', 'All codes'], ['full', 'Full codebook']].map(([k, l]) =>
      h('button', { type: 'button', class: 'pill' + (st.tab === k ? ' on' : ''), onclick: () => { st.tab = k; st.q = ''; render(); } }, l))),
    body);
  if (keepScroll) body.scrollTop = top;
  else { const hl = el.querySelector('#cb-hl'); if (hl) hl.scrollIntoView({ block: 'center' }); }
  if (focus) { const i = el.querySelector('.cb-search'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
}

export { chip };
