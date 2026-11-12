// Themes: two views of a thematic frame coded at paragraph level (themes.js holds the logic).
//   By document (#/themes/doc/<doc>[/<unit>]): documents grouped by sub-question, the PDF beside the
//     fragments, every fragment highlighted in the PDF, coloured by code.
//   By theme (#/themes/code/<field>/<code>): every fragment for one code across documents, with its
//     source, a jump to the highlighted PDF, and agree or disagree.
// Both write the same events, so a check made in either view counts once and shows in both.
import { S, allEvents, addEvent, unitList } from './data.js';
import { h, bar, pct } from './ui.js';
import { openCodebook } from './codebook.js';
import { feature } from './features.js';
import { pdfParts } from './documents.js';
import { mountPdf } from './pdfpane.js';
import { pdfTarget } from './pdfloc.js';
import { layerOf } from './settings.js';
import { renderCheck } from './checkview.js';
import { themeConfig, fragmentsOf, groupDocs, codeIndex, verdicts, progress, colours, codeField, PALETTE } from './themes.js';

export const T = { doc: null, unit: null, field: null, code: null, sq: 'all', colourBy: 'code', off: new Set(), pdf: null, pdfDoc: null, open: null, notes: {} };

const short = (id) => { const d = S.docById.get(id); return (d && (d.short || d.title)) || id; };

function model() {
  const cfg = themeConfig(S.review);
  const frame = cfg && S.frames[cfg.frame];
  if (!frame) return null;
  const lid = layerOf(frame.id, S.review);
  const docIds = S.docs.map((d) => d.id);
  const frags = fragmentsOf(frame, S.layers.get(lid), docIds, S.units);
  const v = verdicts(allEvents(), S.handle, frame.id);
  return { cfg, frame, frags, v, docIds };
}

export function renderThemes(root, parts) {
  S.frameInView = (themeConfig(S.review) || {}).frame;
  if ((themeConfig(S.review) || {}).checking) { renderCheck(root, parts); return; } // a checker's own workspace (checkview.js)
  const byDoc = feature('themes_by_document'), byCode = feature('themes_by_code');
  let [mode, a, b] = parts;
  if (mode === 'doc' && !byDoc) mode = 'code';
  if (mode === 'code' && !byCode) mode = 'doc';
  if (mode !== 'doc' && mode !== 'code') mode = byDoc ? 'doc' : 'code';
  if (!S.ready) { root.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'muted', text: `Loading ${S.loading.done} of ${S.loading.total} files` }))); return; }
  const M = model();
  if (!M) { root.replaceChildren(h('div', { class: 'page narrow' }, h('h1', { text: 'Themes' }), h('p', { class: 'muted', text: 'This review has no thematic frame set up for these views.' }))); return; }
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  const head = h('div', { class: 'thead' },
    h('div', { class: 'seg', role: 'tablist' },
      byDoc ? h('button', { type: 'button', id: 'tv-doc', class: mode === 'doc' ? 'on' : '', onclick: () => { location.hash = `#/themes/doc/${encodeURIComponent(T.doc || M.docIds[0])}`; } }, 'By document') : null,
      byCode ? h('button', { type: 'button', id: 'tv-code', class: mode === 'code' ? 'on' : '', onclick: () => { location.hash = codeHash(T.field, T.code, M); } }, 'By theme') : null),
    overall(M));
  if (mode === 'doc') renderByDoc(root, head, M, decodeURIComponent(a || ''), decodeURIComponent(b || ''), q.get('sq'));
  else renderByCode(root, head, M, decodeURIComponent(a || ''), decodeURIComponent(b || ''));
}

function overall(M) {
  const p = progress(M.frags, M.v);
  return h('div', { class: 'tprog' }, h('span', { class: 'muted small', id: 'tv-progress', text: `${p.done} of ${p.n} codes checked by you (${pct(p.done, p.n)})` }), bar(p.n ? p.done / p.n : 0));
}

function codeHash(field, code, M) {
  if (!field || !code) { const first = codeIndex(M.frame, M.frags).flatMap((g) => g.codes.map((c) => ({ g, c }))).find((x) => x.c.frags.length); if (!first) return '#/themes/code'; field = first.g.field; code = first.c.id; }
  return `#/themes/code/${encodeURIComponent(field)}/${encodeURIComponent(code)}`;
}
const docHash = (doc, unit, sq) => `#/themes/doc/${encodeURIComponent(doc)}${unit ? '/' + encodeURIComponent(unit) : ''}${sq && sq !== 'all' ? '?sq=' + sq : ''}`;

// ----- one code on one fragment: agree or disagree, with an optional note

function verdictRow(M, f, code, colour) {
  const key = `${f.unit}|${codeField(f.field, code)}`;
  const cur = M.v.get(key) || { action: null, note: '' };
  const send = (type, extra) => addEvent(f.doc, type, { sample: M.cfg.sample || null, unit: f.unit, frame: M.frame.id, field: codeField(f.field, code), ...extra });
  const act = (a) => send('verify', { action: cur.action === a ? 'clear' : a, value: code });
  const nk = key;
  const note = cur.action === 'disagree' ? h('div', { class: 'vnote' },
    h('textarea', { rows: 2, placeholder: 'Why not (optional)', 'data-note': nk, onblur: (e) => { const t = e.target.value.trim(); if (t !== (cur.note || '')) send('note', { text: t }); } }, cur.note || '')) : null;
  return h('div', { class: 'vrow' + (cur.action ? ' ' + cur.action : ''), 'data-code': code },
    h('span', { class: 'dot', style: { background: colour } }),
    h('button', { type: 'button', class: 'link cname', title: 'Show the definition', onclick: () => openCodebook({ frame: M.frame.id, field: f.field, value: code }), text: code }),
    h('span', { class: 'vacts' },
      h('button', { type: 'button', class: 'act agree' + (cur.action === 'agree' ? ' on' : ''), onclick: () => act('agree'), 'aria-pressed': cur.action === 'agree' ? 'true' : 'false' }, 'Agree'),
      h('button', { type: 'button', class: 'act disagree' + (cur.action === 'disagree' ? ' on' : ''), onclick: () => act('disagree'), 'aria-pressed': cur.action === 'disagree' ? 'true' : 'false' }, 'Disagree')),
    note);
}

const fieldLabel = (M, id) => (M.frame.fields.find((x) => x.id === id) || {}).label || id;

// ----- by document

function renderByDoc(root, head, M, docArg, unitArg, sqArg) {
  if (docArg && S.docById.has(docArg)) T.doc = docArg;
  if (!T.doc || !S.docById.has(T.doc)) T.doc = M.docIds.find((d) => M.frags.some((f) => f.doc === d)) || M.docIds[0];
  if (sqArg !== null) T.sq = sqArg || 'all';
  if (unitArg) T.unit = unitArg;
  const doc = S.docById.get(T.doc);
  const all = M.frags.filter((f) => f.doc === T.doc);
  const shown = all.filter((f) => T.sq === 'all' || f.field === T.sq);
  // colours: by code (codes present in the document, in frame order) or by sub-question
  const present = M.frame.fields.flatMap((fl) => fl.values.map((v) => v.id).filter((c) => all.some((f) => f.field === fl.id && f.codes.includes(c))).map((c) => codeField(fl.id, c)));
  const byCode = colours(present);
  const bySq = new Map(M.frame.fields.map((fl, i) => [fl.id, PALETTE[i % PALETTE.length]]));
  const colourOf = (f, c) => (T.colourBy === 'code' ? byCode.get(codeField(f.field, c)) : bySq.get(f.field));
  const visibleCodes = (f) => f.codes.filter((c) => !T.off.has(codeField(f.field, c)));

  // left: documents by sub-question
  const groups = groupDocs(M.frame, M.docIds, M.cfg.home || {}, M.frags);
  const n = (d, sq) => M.frags.filter((f) => f.doc === d && (!sq || f.field === sq)).length;
  const side = h('aside', { class: 'tside' }, h('section', { class: 'card' }, h('h2', { text: 'Documents by sub-question' }),
    h('p', { class: 'muted small', text: 'Each review sits in full under its main sub-question. Its fragments under the others are linked.' }),
    groups.map((g) => h('div', { class: 'tgroup', 'data-sq': g.field },
      h('h3', { text: g.label }),
      g.home.map((d) => h('a', { href: docHash(d, null, 'all'), class: 'tdoc' + (d === T.doc ? ' cur' : ''), 'data-doc': d },
        h('span', { text: short(d) }), h('span', { class: 'muted small', text: ` ${n(d)}` }))),
      g.also.length ? h('div', { class: 'talso small' }, h('span', { class: 'muted', text: 'Also: ' }),
        g.also.map((d, i) => [i ? ', ' : '', h('a', { href: docHash(d, null, g.field), 'data-also': d, text: `${short(d)} (${n(d, g.field)})` })])) : null))));

  // right: fragments
  const p = progress(all, M.v);
  const pills = h('div', { class: 'pills', id: 'tv-sq' }, [['all', 'All', all.length], ...M.frame.fields.map((fl) => [fl.id, fl.label, all.filter((f) => f.field === fl.id).length])]
    .map(([k, l, c]) => h('button', { type: 'button', class: 'pill' + (T.sq === k ? ' on' : ''), disabled: !c && k !== 'all', 'data-sq': k, onclick: () => { location.hash = docHash(T.doc, null, k); } }, `${l} ${c}`)));
  const legend = h('div', { class: 'legend', id: 'tv-legend' },
    h('div', { class: 'seg small' }, ['code', 'sub-question'].map((k) => h('button', { type: 'button', class: T.colourBy === (k === 'code' ? 'code' : 'sq') ? 'on' : '', onclick: () => { T.colourBy = k === 'code' ? 'code' : 'sq'; renderThemes(root, ['doc', T.doc]); } }, `Colour by ${k}`))),
    T.colourBy === 'code'
      ? present.map((k) => { const [fl, c] = k.split('::'); return h('button', { type: 'button', class: 'lg' + (T.off.has(k) ? ' off' : ''), title: `${fieldLabel(M, fl)}. Click to hide or show`, 'data-lg': k, onclick: () => { T.off.has(k) ? T.off.delete(k) : T.off.add(k); repaint(); } }, h('span', { class: 'dot', style: { background: byCode.get(k) } }), c); })
      : M.frame.fields.map((fl) => h('span', { class: 'lg' }, h('span', { class: 'dot', style: { background: bySq.get(fl.id) } }), fl.label)));
  const card = (f) => {
    const key = `${f.unit}|${f.field}`;
    return h('div', { class: 'tfrag' + (T.open === key ? ' cur' : ''), 'data-key': key, 'data-unit': f.unit, 'data-field': f.field },
      h('div', { class: 'tfh' },
        h('button', { type: 'button', class: 'link', onclick: () => select(f), text: `p.${f.page ?? '?'} · ${fieldLabel(M, f.field)}` }),
        f.gap ? h('span', { class: 'pill warn small', title: 'The review states it found none of this', text: 'Gap statement' }) : null,
        h('span', { class: 'nf muted small', 'data-nf': f.unit, hidden: true, text: 'Not located in the PDF text; the paragraph is on this page' })),
      f.codes.map((c) => verdictRow(M, f, c, colourOf(f, c))),
      h('div', { class: 'why' }, h('b', { text: 'Why it matters. ' }), f.why),
      h('div', { class: 'passage small' }, '“', f.quote, '”'));
  };
  const list = h('div', { class: 'tfrags', id: 'tv-frags' }, shown.length ? shown.map(card) : h('p', { class: 'muted', text: 'No fragments here.' }));
  const right = h('section', { class: 'card tright' },
    h('div', { class: 'tdh' }, h('h2', { text: short(T.doc) }), h('span', { class: 'muted small', text: `${all.length} fragments · ${p.done} of ${p.n} codes checked` })),
    h('div', { class: 'muted small', text: doc && doc.title }), pills, legend, list);

  // centre: the PDF, kept across re-renders of the same document so a check does not reload it
  const keep = T.centre && T.centreDoc === T.doc && T.pdf;
  const oldScroll = (root.querySelector('#tv-frags') || {}).scrollTop || 0;
  if (!keep) {
    if (T.pdf) { try { T.pdf.destroy(); } catch {} T.pdf = null; }
    const pdfHost = h('div', { class: 'tpdf', id: 'tv-pdf' });
    const status = h('div', { class: 'muted small', id: 'tv-pdf-status', text: 'Loading the PDF' });
    T.centre = h('section', { class: 'card tcentre' }, status, pdfHost);
    T.centreDoc = T.doc;
  }
  const centre = T.centre;
  const pdfHost = centre.querySelector('#tv-pdf');
  const status = centre.querySelector('#tv-pdf-status');
  root.replaceChildren(h('div', { class: 'twrap' }, h('div', { class: 'tbar' }, head), side, centre, right));
  if (keep) list.scrollTop = oldScroll;

  const marks = () => {
    const out = [];
    const byUnit = new Map();
    for (const f of shown) { if (!byUnit.has(f.unit)) byUnit.set(f.unit, []); byUnit.get(f.unit).push(f); }
    for (const [unit, fs] of byUnit) {
      const cs = [];
      for (const f of fs) for (const c of visibleCodes(f)) { const col = colourOf(f, c); if (!cs.includes(col)) cs.push(col); }
      if (!cs.length) continue;
      const f0 = fs[0];
      out.push({ key: unit, page: f0.pdf_page || pageOf(f0), text: f0.text, quotes: fs.map((x) => x.quote), colours: cs,
        title: fs.map((f) => `${fieldLabel(M, f.field)}: ${f.codes.join('; ')}`).join('\n') });
    }
    return out;
  };
  const select = (f) => { T.open = `${f.unit}|${f.field}`; T.unit = f.unit; mark(); if (T.pdf) T.pdf.show(f.unit); };
  const mark = () => { for (const el of list.querySelectorAll('.tfrag')) el.classList.toggle('cur', el.dataset.key === T.open); };
  const repaint = () => { if (T.pdf) T.pdf.setMarks(marks()); for (const el of legend.querySelectorAll('[data-lg]')) el.classList.toggle('off', T.off.has(el.dataset.lg)); };
  const onPick = (unit) => {
    const el = [...list.querySelectorAll('.tfrag')].find((x) => x.dataset.unit === unit);
    if (!el) return;
    T.open = el.dataset.key; T.unit = unit; mark();
    el.scrollIntoView({ block: 'nearest' });
  };
  const onStatus = (found) => {
    let a = 0, b = 0;
    for (const [k, ok] of found) {
      if (ok) a++; else b++;
      const el = list.querySelector(`[data-nf="${CSS.escape(k)}"]`); if (el) el.hidden = ok;
      for (const c of list.querySelectorAll(`.tfrag[data-unit="${CSS.escape(k)}"]`)) c.dataset.located = ok ? 'yes' : 'no';
    }
    status.textContent = `${a} highlighted on the pages drawn so far${b ? `; ${b} not located in the PDF text` : ''}`;
    status.dataset.found = String(a);
  };

  T.onPick = onPick; T.onStatus = onStatus; // the kept viewer calls the handlers of the latest render
  if (keep) {
    T.pdf.setMarks(marks());
    const want = unitArg && shown.find((f) => f.unit === unitArg);
    if (want && T.lastUnitArg !== unitArg) select(want);
    T.lastUnitArg = unitArg;
    mark();
    onStatus(T.pdf.found);
    return;
  }
  T.lastUnitArg = unitArg;
  const parts = pdfParts(doc || {}).filter((x) => S.store.has(x.file));
  if (!parts.length) { status.textContent = 'The PDF is not in the data repo.'; return; }
  const file = parts[0].file;
  const go = async () => {
    try {
      if (T.pdfDoc !== T.doc || !T.blob) { T.blob = null; const b = await S.store.readBlob(file); T.blob = b instanceof Blob ? b : new Blob([b], { type: 'application/pdf' }); T.pdfDoc = T.doc; }
      if (!pdfHost.isConnected) return;
      T.pdf = await mountPdf(pdfHost, { blob: T.blob, marks: marks(), onPick: (k) => T.onPick(k), onStatus: (f) => T.onStatus(f) });
      const target = T.unit && shown.find((f) => f.unit === T.unit);
      if (target) select(target); else if (shown[0]) T.pdf.show(shown[0].unit);
      else status.textContent = 'No fragments to highlight.';
    } catch (e) { status.textContent = 'Could not open the PDF: ' + e.message; }
  };
  go();
}

function pageOf(f) {
  const doc = S.docById.get(f.doc);
  const t = pdfTarget(null, pdfParts(doc), f.page);
  return t.page || 1;
}

// ----- by theme

function renderByCode(root, head, M, fieldArg, codeArg) {
  const idx = codeIndex(M.frame, M.frags);
  if (fieldArg && codeArg && M.frame.fields.some((f) => f.id === fieldArg)) { T.field = fieldArg; T.code = codeArg; }
  if (!T.field || !T.code) { const h0 = codeHash(null, null, M).split('/'); T.field = decodeURIComponent(h0[3] || ''); T.code = decodeURIComponent(h0[4] || ''); }
  const g = idx.find((x) => x.field === T.field);
  const c = g && g.codes.find((x) => x.id === T.code);
  const side = h('aside', { class: 'tside' }, h('section', { class: 'card' }, h('h2', { text: 'Codes by sub-question' }),
    idx.map((grp) => h('div', { class: 'tgroup', 'data-sq': grp.field }, h('h3', { text: grp.label }),
      grp.codes.map((x) => h('a', { href: codeHash(grp.field, x.id, M), class: 'tcode' + (grp.field === T.field && x.id === T.code ? ' cur' : '') + (x.frags.length ? '' : ' none'), 'data-code': x.id },
        h('span', { text: x.id }), h('span', { class: 'muted small', text: ` ${x.frags.length}` })))))));
  if (!c) { root.replaceChildren(h('div', { class: 'twrap code' }, h('div', { class: 'tbar' }, head), side, h('section', { class: 'card' }, h('p', { class: 'muted', text: 'Pick a code.' })))); return; }
  const def = (M.frame.fields.find((f) => f.id === T.field).values.find((v) => v.id === T.code)) || {};
  const fs = c.frags;
  const p = progress(fs.map((f) => ({ ...f, codes: [T.code] })), M.v);
  const rows = [];
  let last = null;
  for (const f of fs) {
    if (f.doc !== last) { rows.push(h('h3', { class: 'tsrc', text: `${short(f.doc)}` })); last = f.doc; }
    rows.push(h('div', { class: 'tfrag', 'data-unit': f.unit, 'data-doc': f.doc },
      h('div', { class: 'tfh' }, h('span', { class: 'src', text: `${short(f.doc)}, p.${f.page ?? '?'}, ${f.label.replace(/\s*\(p\.[^)]*\)$/, '')}` }),
        f.gap ? h('span', { class: 'pill warn small', text: 'Gap statement' }) : null,
        h('a', { class: 'btn small jump', href: docHash(f.doc, f.unit, T.field), text: 'Show in the PDF' })),
      h('div', { class: 'passage small' }, '“', f.quote, '”'),
      h('div', { class: 'why' }, h('b', { text: 'Why it matters. ' }), f.why),
      f.codes.length > 1 ? h('div', { class: 'muted small', text: 'Also coded here: ' + f.codes.filter((x) => x !== T.code).join('; ') }) : null,
      verdictRow(M, f, T.code, PALETTE[0]),
      h('details', { class: 'small' }, h('summary', { text: 'Whole paragraph' }), h('p', { class: 'ut', text: f.text }))));
  }
  const main = h('section', { class: 'card tmain' },
    h('div', { class: 'tdh' }, h('h2', { id: 'tv-code-name', text: T.code }), h('span', { class: 'muted small', text: `${fieldLabel(M, T.field)} · ${fs.length} fragments in ${c.docs.length} documents · ${p.done} of ${p.n} checked` })),
    h('p', { class: 'small', text: def.definition || '' }),
    h('div', { class: 'tfrags', id: 'tv-frags' }, rows.length ? rows : h('p', { class: 'muted', text: 'No fragment carries this code.' })));
  root.replaceChildren(h('div', { class: 'twrap code' }, h('div', { class: 'tbar' }, head), side, main));
}
