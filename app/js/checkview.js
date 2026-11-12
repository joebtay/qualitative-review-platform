// Check the coding: one checker works through the AI coding of their checking groups, paper by paper, with the PDF
// beside them (cognitive review phase 2, PI 2 November 2026). Switched on by review.json themes.checking; the logic is
// in themes.js. Route: #/themes/<group>/<doc>[/<unit>].
//
// For each AI code: Agree, Disagree or Change (to another code of the same research question), and a note on any
// code. "Add a code" adds a codebook code the AI missed, or a code outside the codebook, which goes to the PI's ruling
// list. Text selected in the PDF can be highlighted, noted or coded. The AI coder's reason for a fragment shows only
// once every code on it is answered. Everything is an append-only event in the checker's own repo; nothing of another
// checker is here, and a submitted group is final.
import { S, allEvents, docEvents, addEvent } from './data.js';
import { h, bar, pct } from './ui.js';
import { openCodebook } from './codebook.js';
import { pdfParts } from './documents.js';
import { mountPdf } from './pdfpane.js';
import { layerOf } from './settings.js';
import { submitted, SAMPLES_DOC } from './assign.js';
import { passagesFor } from './passages.js';
import { themeConfig, fragmentsOf, verdicts, progress, codeField, checkGroups, groupFragments, answered, addedCodes, PALETTE } from './themes.js';

export const C = { drafts: new Map(), timers: new Map(), flush: new Map(), group: null, doc: null, unit: null, todo: false, pick: null, add: null, sel: null, selForm: null, msg: null, pdf: null, centre: null, centreKey: null, blob: null, blobDoc: null, openNote: new Set() };

const short = (id) => { const d = S.docById.get(id); return (d && (d.short || d.title)) || id; };
const hash = (g, doc, unit) => `#/themes/${encodeURIComponent(g)}/${encodeURIComponent(doc)}${unit ? '/' + encodeURIComponent(unit) : ''}`;
const fkey = (f) => `${f.unit}|${f.field}`;
/** A code's own quote, where a later coding pass added the code to a fragment with words of its own. */
const ownQuote = (f, code) => { const a = f.added && f.added[code]; return a && a.quote && a.quote !== f.quote ? a.quote : null; };

// A note saves as the checker types (after a pause) and when they leave the box, never by a click elsewhere, so a
// click on Agree straight after typing is not lost to a redraw; the draft survives redraws and keeps the cursor.
function noteBox(pk, saved, save, locked) {
  const flush = () => { clearTimeout(C.timers.get(pk)); C.timers.delete(pk); const d = C.drafts.get(pk); if (d == null) return; C.drafts.delete(pk); if (d.trim() !== (saved || '')) save(d.trim()); };
  C.flush.set(pk, flush);
  return h('textarea', { class: 'cknote', rows: 2, disabled: locked, placeholder: 'Your note on this code (optional)', 'data-note': pk,
    oninput: (e) => { C.drafts.set(pk, e.target.value); clearTimeout(C.timers.get(pk)); C.timers.set(pk, setTimeout(flush, 900)); },
    onblur: flush }, C.drafts.get(pk) ?? saved ?? '');
}

function model() {
  const cfg = themeConfig(S.review);
  const frame = cfg && S.frames[cfg.frame];
  if (!frame) return null;
  const groups = checkGroups(S.samples, frame.id);
  const lid = layerOf(frame.id, S.review);
  const docIds = S.docs.map((d) => d.id);
  const order = new Map(docIds.map((d, i) => [d, i]));
  const all = fragmentsOf(frame, S.layers.get(lid), docIds, S.units);
  const v = verdicts(allEvents(), S.handle, frame.id);
  const sev = docEvents(SAMPLES_DOC);
  const sq = new Map(frame.fields.map((f, i) => [f.id, { label: f.label, colour: PALETTE[i % PALETTE.length], field: f }]));
  const G = groups.map((g) => {
    const frags = groupFragments(all, g, order);
    const docs = docIds.filter((d) => frags.some((f) => f.doc === d));
    return { g, frags, docs, p: progress(frags, v), done: submitted(sev, g.id).has(S.handle) };
  });
  return { cfg, frame, G, v, sq, order };
}

export function renderCheck(root, parts) {
  if (!S.ready) { root.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'muted', text: `Loading ${S.loading.done} of ${S.loading.total} files` }))); return; }
  const M = model();
  if (!M || !M.G.length) { root.replaceChildren(h('div', { class: 'page narrow' }, h('h1', { text: 'Check the coding' }), h('p', { class: 'muted', text: 'There is nothing for you to check here.' }))); return; }
  const [ga, da, ua] = parts.map((x) => decodeURIComponent(x || ''));
  if (ga && M.G.some((x) => x.g.id === ga)) { if (C.group !== ga) { C.doc = null; C.unit = null; } C.group = ga; }
  if (!C.group || !M.G.some((x) => x.g.id === C.group)) C.group = (M.G.find((x) => x.p.done < x.p.n && !x.done) || M.G[0]).g.id;
  const G = M.G.find((x) => x.g.id === C.group);
  const left = (d) => { const fs = G.frags.filter((f) => f.doc === d); const p = progress(fs, M.v); return p.n - p.done; };
  if (da && G.docs.includes(da)) { if (C.doc !== da) C.unit = null; C.doc = da; }
  if (!C.doc || !G.docs.includes(C.doc)) C.doc = G.docs.find((d) => left(d) > 0) || G.docs[0];
  if (ua) C.unit = ua;
  const frags = G.frags.filter((f) => f.doc === C.doc);
  const locked = G.done;
  const dp = progress(frags, M.v);
  const di = G.docs.indexOf(C.doc);
  const rr = () => renderCheck(root, [C.group, C.doc, C.unit || '']);
  const go = (doc, unit) => { C.pick = null; C.add = null; C.sel = null; C.selForm = null; C.msg = null; location.hash = hash(C.group, doc, unit); };
  const firstOpen = (fs) => fs.find((f) => !answered(f, M.v));
  const nextCode = () => {
    const here = frags.indexOf(frags.find((f) => fkey(f) === C.unit) || frags[0]);
    const f = frags.slice(here + 1).find((x) => !answered(x, M.v)) || firstOpen(frags);
    if (f) { select(f); return; }
    const nd = G.docs.slice(di + 1).find((d) => left(d) > 0) || G.docs.find((d) => left(d) > 0);
    if (nd) go(nd, (firstOpen(G.frags.filter((x) => x.doc === nd)) || {}).unit);
  };

  // ----- the band at the top: which group, how far, what next
  const send = (f, code, type, extra) => {
    if (type !== 'note') for (const fl of [...C.flush.values()]) fl(); // a note typed just before the click saves first
    const r = addEvent(f.doc, type, { sample: G.g.id, unit: f.unit, frame: M.frame.id, field: codeField(f.field, code), ...extra });
    if (!r) { C.msg = 'You have submitted this group. Your answers are final.'; rr(); }
    const ae = document.activeElement;
    if (type !== 'note' && ae && ae.dataset && ae.dataset.note) ae.blur(); // the page redraws once the note box is left
    return r;
  };
  const submit = () => {
    if (G.p.done < G.p.n) return;
    if (!confirm(`Submit ${G.g.title}? Your answers become final, and your partner's answers stay hidden until they submit too.`)) return;
    addEvent(SAMPLES_DOC, 'submit', { sample: G.g.id, items: G.p.n });
  };
  const tabs = h('div', { class: 'ckgroups', role: 'tablist' }, M.G.map((x) => h('button', { type: 'button', role: 'tab', class: 'ckg' + (x.g.id === C.group ? ' on' : '') + (x.done ? ' sub' : ''), 'data-group': x.g.id,
    'aria-selected': x.g.id === C.group ? 'true' : 'false', onclick: () => { C.doc = null; C.unit = null; location.hash = hash(x.g.id, (x.docs.find((d) => { const fs = x.frags.filter((f) => f.doc === d); const p = progress(fs, M.v); return p.done < p.n; }) || x.docs[0])); } },
    h('b', { text: x.g.title }), h('span', { class: 'small', text: x.done ? 'Submitted' : `${x.p.done} of ${x.p.n} codes checked` }))));
  const band = h('div', { class: 'ckband card' },
    h('div', { class: 'ckrow' }, tabs,
      h('div', { class: 'ckprog' }, h('div', { class: 'small', id: 'ck-progress', text: `${G.g.title}: ${G.p.done} of ${G.p.n} codes checked (${pct(G.p.done, G.p.n)})` }), bar(G.p.n ? G.p.done / G.p.n : 0)),
      locked ? h('span', { class: 'pill ok', id: 'ck-submitted', text: 'Submitted. Your answers are final.' })
        : h('button', { type: 'button', class: 'btn' + (G.p.done === G.p.n ? ' primary' : ''), id: 'ck-submit', disabled: G.p.done < G.p.n, onclick: submit,
          title: G.p.done < G.p.n ? 'Answer every code in the group first' : '' }, G.p.done < G.p.n ? `Submit (${G.p.n - G.p.done} codes left)` : `Submit group ${G.g.title.split('.')[0]}`)),
    h('div', { class: 'ckrow ckwhere' },
      h('div', { class: 'ckpaper' }, h('span', { class: 'muted small', text: `Paper ${di + 1} of ${G.docs.length}` }), h('b', { id: 'ck-paper', text: short(C.doc) }),
        h('span', { class: 'small ' + (dp.done === dp.n ? 'ok' : 'muted'), id: 'ck-left', text: dp.done === dp.n ? 'Every code in this paper is checked' : `${dp.n - dp.done} of ${dp.n} codes left in this paper` })),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', disabled: di <= 0, onclick: () => go(G.docs[di - 1]) }, 'Previous paper'),
        h('button', { type: 'button', class: 'btn small primary', id: 'ck-next', disabled: G.p.done === G.p.n, onclick: nextCode }, 'Next code to check'),
        h('button', { type: 'button', class: 'btn small', disabled: di >= G.docs.length - 1, onclick: () => go(G.docs[di + 1]) }, 'Next paper'),
        h('a', { class: 'btn small', href: `#/doc/${encodeURIComponent(C.doc)}`, id: 'ck-info' }, 'Paper information'))),
    C.msg ? h('div', { class: 'warnline', text: C.msg }) : null);

  // ----- left: the papers
  const side = h('aside', { class: 'ckside card' }, h('h2', { text: 'Papers' }),
    h('div', { class: 'cklist' }, G.docs.map((d, i) => {
      const fs = G.frags.filter((f) => f.doc === d); const p = progress(fs, M.v);
      const st = p.done === p.n ? 'd' : p.done ? 'p' : '';
      return h('a', { href: hash(C.group, d), class: 'ckdoc' + (d === C.doc ? ' cur' : ''), 'data-doc': d },
        h('span', { class: 'qs ' + st, title: st === 'd' ? 'Done' : st === 'p' ? 'Started' : 'Not started' }),
        h('span', { class: 'ckdn' }, h('span', { text: `${i + 1}. ${short(d)}` }), h('span', { class: 'muted small', text: p.done === p.n ? 'Done' : `${p.n - p.done} left` })));
    })),
    h('div', { class: 'cklegend' }, h('h3', { text: 'Colours in the PDF' }),
      G.g.fields.map((fid) => h('div', { class: 'lg' }, h('span', { class: 'dot', style: { background: M.sq.get(fid).colour } }), M.sq.get(fid).label)),
      h('div', { class: 'lg' }, h('span', { class: 'dot', style: { background: '#f2c94c' } }), 'Your own highlights')),
    h('p', { class: 'muted small', text: 'Select any text in the PDF to highlight it, add a note or add a code.' }));

  // ----- right: the fragments of this paper
  const defOf = (field, code) => (M.sq.get(field).field.values.find((x) => x.id === code) || {}).definition || '';
  const codeRow = (f, code) => {
    const k = `${f.unit}|${codeField(f.field, code)}`;
    const cur = M.v.get(k) || { action: null, value: null, note: '' };
    const pk = `${fkey(f)}|${code}`;
    const act = (a, value) => send(f, code, 'verify', { action: cur.action === a && a !== 'change' ? 'clear' : a, value: value ?? code });
    const status = !cur.action ? 'Not checked yet' : cur.action === 'agree' ? 'You agree' : cur.action === 'disagree' ? 'You disagree: this code does not apply' : `You changed it to: ${cur.value}`;
    const noteOpen = C.openNote.has(pk) || !!cur.note;
    const choices = M.sq.get(f.field).field.values.filter((x) => x.id !== code);
    return h('div', { class: 'ckcode' + (cur.action ? ' ' + cur.action : ' open'), 'data-code': code },
      h('div', { class: 'ckch' },
        h('span', { class: 'dot', style: { background: M.sq.get(f.field).colour } }),
        h('button', { type: 'button', class: 'link cname', title: 'Show the definition', onclick: () => openCodebook({ frame: M.frame.id, field: f.field, value: code }), text: code }),
        h('span', { class: 'cks small', text: status })),
      ownQuote(f, code) ? h('div', { class: 'ckq small', 'data-own-quote': code }, '“', ownQuote(f, code), '”') : null,
      h('div', { class: 'ckacts' },
        h('button', { type: 'button', class: 'act agree' + (cur.action === 'agree' ? ' on' : ''), disabled: locked, 'aria-pressed': String(cur.action === 'agree'), onclick: () => act('agree') }, 'Agree'),
        h('button', { type: 'button', class: 'act disagree' + (cur.action === 'disagree' ? ' on' : ''), disabled: locked, 'aria-pressed': String(cur.action === 'disagree'), onclick: () => act('disagree') }, 'Disagree'),
        h('button', { type: 'button', class: 'act change' + (cur.action === 'change' ? ' on' : ''), disabled: locked, onclick: () => { C.pick = C.pick === pk ? null : pk; rr(); } }, cur.action === 'change' ? 'Change again' : 'Change'),
        h('button', { type: 'button', class: 'link small', disabled: locked && !cur.note, onclick: () => { C.openNote.has(pk) ? C.openNote.delete(pk) : C.openNote.add(pk); rr(); } }, cur.note ? 'Your note' : 'Add a note')),
      C.pick === pk ? h('div', { class: 'ckpick' }, h('div', { class: 'muted small', text: `Change to another ${M.sq.get(f.field).label} code:` }),
        choices.map((x) => h('button', { type: 'button', class: 'po' + (cur.action === 'change' && cur.value === x.id ? ' on' : ''), onclick: () => { C.pick = null; act('change', x.id); } },
          h('b', { text: x.id }), h('span', { class: 'pd', text: x.definition || '' }))),
        h('button', { type: 'button', class: 'btn small', onclick: () => { C.pick = null; rr(); } }, 'Cancel')) : null,
      noteOpen ? noteBox(pk, cur.note, (tx) => send(f, code, 'note', { text: tx }), locked) : null);
  };
  const addRow = (f, a) => {
    const pk = `${fkey(f)}|+${a.code}`;
    const noteOpen = C.openNote.has(pk) || !!a.note;
    return h('div', { class: 'ckcode added', 'data-added': a.code },
      h('div', { class: 'ckch' }, h('span', { class: 'dot', style: { background: M.sq.get(f.field).colour } }),
        h('button', { type: 'button', class: 'link cname', onclick: () => openCodebook({ frame: M.frame.id, field: f.field, value: a.code }), text: a.code }),
        h('span', { class: 'cks small', text: 'Added by you' })),
      h('div', { class: 'ckacts' },
        h('button', { type: 'button', class: 'btn small', disabled: locked, onclick: () => send(f, a.code, 'verify', { action: 'clear', value: a.code }) }, 'Remove'),
        h('button', { type: 'button', class: 'link small', disabled: locked && !a.note, onclick: () => { C.openNote.has(pk) ? C.openNote.delete(pk) : C.openNote.add(pk); rr(); } }, a.note ? 'Your note' : 'Add a note')),
      noteOpen ? noteBox(pk, a.note, (tx) => send(f, a.code, 'note', { text: tx }), locked) : null);
  };
  const mine = passagesFor(docEvents(C.doc)).filter((p) => p.coder === S.handle && p.frame === M.frame.id);
  const newCodes = (f) => mine.filter((p) => p.unit === f.unit && p.field === f.field && p.new_code);
  const addForm = (f) => {
    const st = C.add;
    const has = new Set([...f.codes, ...addedCodes(f, M.v).map((a) => a.code)]);
    const field = M.sq.get(st.field).field;
    return h('div', { class: 'ckpick ckadd' },
      G.g.fields.length > 1 ? h('label', { class: 'sel' }, 'Research question', h('select', { onchange: (e) => { st.field = e.target.value; rr(); } },
        G.g.fields.map((x) => h('option', { value: x, selected: x === st.field, text: M.sq.get(x).label })))) : null,
      h('div', { class: 'muted small', text: `Codebook v2 codes for ${field.label}:` }),
      field.values.filter((x) => !(st.field === f.field && has.has(x.id))).map((x) => h('button', { type: 'button', class: 'po', onclick: () => {
        C.add = null;
        if (st.field === f.field) send(f, x.id, 'verify', { action: 'add', value: x.id });
        else addEvent(f.doc, 'passage', { sample: G.g.id, frame: M.frame.id, unit: f.unit, field: st.field, kind: 'code', pdf_page: f.pdf_page, quote: f.quote || f.text.slice(0, 400), codes: { [st.field]: x.id }, new_code: null, comment: null });
      } }, h('b', { text: x.id }), h('span', { class: 'pd', text: x.definition || '' }))),
      h('label', null, h('span', { class: 'small', text: 'Or a code that is not in codebook v2 (it goes to Joe for a ruling):' }),
        h('input', { type: 'text', placeholder: 'Name the new code', value: st.text || '', oninput: (e) => { st.text = e.target.value; } })),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small primary', onclick: () => {
          if (!(st.text || '').trim()) { C.msg = 'Name the new code first, or pick one from the list.'; rr(); return; }
          C.add = null; C.msg = null;
          addEvent(f.doc, 'passage', { sample: G.g.id, frame: M.frame.id, unit: f.unit, field: st.field, kind: 'code', pdf_page: f.pdf_page, quote: f.quote || f.text.slice(0, 400), codes: null, new_code: { field: st.field, text: st.text.trim() }, comment: null });
        } }, 'Save new code'),
        h('button', { type: 'button', class: 'btn small', onclick: () => { C.add = null; rr(); } }, 'Cancel')));
  };
  const card = (f) => {
    const k = fkey(f);
    const done = answered(f, M.v);
    const isCur = k === C.unit;
    const extra = mine.filter((p) => p.unit === f.unit && p.field !== f.field && p.codes);
    return h('div', { class: 'ckfrag' + (done ? ' done' : ' todo') + (isCur ? ' cur' : ''), 'data-key': k, 'data-unit': f.unit, 'data-field': f.field, onclick: (e) => { if (e.target === e.currentTarget || e.target.closest('.ckfh')) select(f); } },
      h('div', { class: 'ckfh' },
        h('span', { class: 'dot', style: { background: M.sq.get(f.field).colour } }),
        h('b', { text: M.sq.get(f.field).label }), h('span', { class: 'muted small', text: `p. ${f.page ?? '?'}` }),
        f.gap ? h('span', { class: 'pill warn small', title: 'The review states it found none of this', text: 'Gap statement' }) : null,
        h('span', { class: 'pill small ' + (done ? 'ok' : 'todo'), text: done ? 'Checked' : 'To check' }),
        h('span', { class: 'nf muted small', 'data-nf': f.unit, hidden: true, text: 'Not found in the PDF text; it is on this page' })),
      h('div', { class: 'passage small' }, '“', f.quote || f.text.slice(0, 300), '”'),
      h('details', { class: 'small' }, h('summary', { text: 'Whole paragraph' }), h('p', { class: 'ut', text: f.text })),
      f.codes.map((c) => codeRow(f, c)),
      addedCodes(f, M.v).map((a) => addRow(f, a)),
      newCodes(f).map((p) => h('div', { class: 'ckcode added', 'data-new': p.new_code.text }, h('div', { class: 'ckch' }, h('span', { class: 'dot', style: { background: '#999' } }), h('b', { text: p.new_code.text }),
        h('span', { class: 'cks small', text: 'New code, for Joe to rule on' })), locked ? null : h('button', { type: 'button', class: 'link small', onclick: () => addEvent(f.doc, 'passage-withdraw', { passage: p.id, sample: G.g.id }) }, 'Remove'))),
      extra.map((p) => Object.entries(p.codes).filter(([, c]) => c).map(([fd, c]) => h('div', { class: 'ckcode added' }, h('div', { class: 'ckch' }, h('span', { class: 'dot', style: { background: M.sq.get(fd).colour } }), h('b', { text: c }),
        h('span', { class: 'cks small', text: `Added by you under ${M.sq.get(fd).label}` })), locked ? null : h('button', { type: 'button', class: 'link small', onclick: () => addEvent(f.doc, 'passage-withdraw', { passage: p.id, sample: G.g.id }) }, 'Remove')))),
      C.add && C.add.key === k ? addForm(f) : (locked ? null : h('button', { type: 'button', class: 'btn small ckaddbtn', onclick: () => { C.add = { key: k, field: f.field, text: '' }; rr(); } }, '+ Add a code')),
      h('div', { class: 'ckwhy small' + (done ? '' : ' muted') }, h('b', { text: "AI coder's reason. " }), done ? (f.why || 'None given.') : 'Shown once you have answered every code here.',
        done ? f.codes.filter((c) => ownQuote(f, c) && f.added[c].why && f.added[c].why !== f.why).map((c) => h('div', null, h('b', { text: `${c}: ` }), f.added[c].why)) : null));
  };
  const shown = C.todo ? frags.filter((f) => !answered(f, M.v) || fkey(f) === C.unit) : frags;
  const notesList = mine.filter((p) => !p.unit);
  const right = h('section', { class: 'card ckright', onmousedown: (e) => { if (e.target.closest('button') && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.note) e.preventDefault(); } },
    h('div', { class: 'ckrh' }, h('h2', { text: short(C.doc) }),
      h('div', { class: 'pills' }, [[false, `All ${frags.length}`], [true, `To check ${frags.filter((f) => !answered(f, M.v)).length}`]].map(([k, l]) => h('button', { type: 'button', class: 'pill' + (C.todo === k ? ' on' : ''), onclick: () => { C.todo = k; rr(); } }, l)))),
    h('div', { class: 'muted small', text: (S.docById.get(C.doc) || {}).title || '' }),
    h('div', { class: 'ckfrags', id: 'ck-frags' }, shown.length ? shown.map(card) : h('p', { class: 'muted', text: 'Every fragment in this paper is checked.' }),
      notesList.length ? h('div', { class: 'cknotes' }, h('h3', { text: `Your highlights and notes on this paper (${notesList.length})` }),
        notesList.map((p) => h('div', { class: 'npi', 'data-passage': p.id },
          h('div', { class: 'muted small', text: `PDF page ${p.pdf_page} · ${p.kind === 'note' ? 'note' : p.kind === 'code' ? 'code' : 'highlight'}` }),
          h('button', { type: 'button', class: 'link passage small', onclick: () => { if (C.pdf) C.pdf.show('np:' + p.id); }, text: `“${p.quote}”` }),
          p.codes ? h('div', null, Object.entries(p.codes).filter(([, c]) => c).map(([fd, c]) => h('span', { class: 'chip', text: `${c} (${M.sq.get(fd)?.label || fd})` }))) : null,
          p.new_code ? h('div', null, h('span', { class: 'chip', text: `New code: ${p.new_code.text}` }), h('span', { class: 'muted small', text: ' for Joe to rule on' })) : null,
          p.comment ? h('div', { text: p.comment }) : null,
          locked ? null : h('button', { type: 'button', class: 'link small', onclick: () => addEvent(C.doc, 'passage-withdraw', { passage: p.id, sample: G.g.id }) }, 'Remove')))) : null));

  // ----- centre: the PDF, kept while the paper stays the same
  const ckey = `${C.group}|${C.doc}`;
  const keep = C.centre && C.centreKey === ckey && C.pdf;
  const oldScroll = (root.querySelector('#ck-frags') || {}).scrollTop || 0;
  if (!keep) {
    if (C.pdf) { try { C.pdf.destroy(); } catch {} C.pdf = null; }
    C.centre = h('section', { class: 'card ckcentre' }, h('div', { class: 'muted small', id: 'ck-pdf-status', text: 'Loading the PDF' }), h('div', { class: 'tpdf', id: 'ck-pdf' }), h('div', { class: 'cksel', id: 'ck-sel', hidden: true }));
    C.centreKey = ckey;
  }
  const centre = C.centre;
  const pdfHost = centre.querySelector('#ck-pdf');
  const status = centre.querySelector('#ck-pdf-status');
  const selBox = centre.querySelector('#ck-sel');
  const ae = document.activeElement;
  const refocus = ae && ae.dataset && ae.dataset.note ? { k: ae.dataset.note, s: ae.selectionStart, e: ae.selectionEnd } : null;
  root.replaceChildren(h('div', { class: 'ckwrap' }, band, side, centre, right));
  if (refocus) { const el = root.querySelector(`textarea[data-note="${CSS.escape(refocus.k)}"]`); if (el) { el.focus(); try { el.setSelectionRange(refocus.s, refocus.e); } catch {} } }
  const list = root.querySelector('#ck-frags');
  if (keep) list.scrollTop = oldScroll;

  const marks = () => {
    const out = [];
    const byUnit = new Map();
    for (const f of frags) { if (!byUnit.has(f.unit)) byUnit.set(f.unit, []); byUnit.get(f.unit).push(f); }
    for (const [unit, fs] of byUnit) out.push({ key: unit, page: fs[0].pdf_page || 1, text: fs[0].text, quotes: fs.flatMap((x) => [x.quote, ...Object.values(x.added || {}).map((a) => a.quote)]).filter(Boolean), colours: [...new Set(fs.map((x) => M.sq.get(x.field).colour))],
      title: fs.map((x) => `${M.sq.get(x.field).label}: ${x.codes.join('; ')}`).join('\n') });
    for (const p of mine.filter((x) => !x.unit)) out.push({ key: 'np:' + p.id, page: p.pdf_page, text: p.quote, quotes: [], colours: ['#f2c94c'], title: p.comment || (p.new_code ? 'New code: ' + p.new_code.text : 'Your highlight') });
    return out;
  };
  function select(f) {
    C.unit = fkey(f);
    for (const el of list.querySelectorAll('.ckfrag')) el.classList.toggle('cur', el.dataset.key === C.unit);
    const el = list.querySelector(`.ckfrag[data-key="${CSS.escape(C.unit)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (C.pdf) C.pdf.show(f.unit);
    history.replaceState(null, '', hash(C.group, C.doc, C.unit));
  }
  const onPick = (key) => {
    if (key.startsWith('np:')) return;
    const f = frags.find((x) => x.unit === key && (!C.unit || !C.unit.startsWith(key + '|'))) || frags.find((x) => x.unit === key);
    if (f) { if (C.todo && answered(f, M.v)) { C.todo = false; C.unit = fkey(f); rr(); return; } select(f); }
  };
  const onStatus = (found) => {
    let a = 0, b = 0;
    for (const [k, ok] of found) {
      if (k.startsWith('np:')) continue;
      if (ok) a++; else b++;
      for (const el of list.querySelectorAll(`[data-nf="${CSS.escape(k)}"]`)) el.hidden = ok;
    }
    status.textContent = `${a} passages highlighted on the pages shown so far${b ? `; ${b} not found in the PDF text` : ''}. Click a highlight to find its codes.`;
  };
  // a text selection in the PDF: highlight it, note it or code it
  const showSel = () => {
    if (!C.sel || locked) { selBox.hidden = true; return; }
    const s = C.sel; const fm = C.selForm;
    const save = (kind, extra) => {
      const r = addEvent(C.doc, 'passage', { sample: G.g.id, frame: M.frame.id, kind, pdf_file: (pdfParts(S.docById.get(C.doc) || {})[0] || {}).file, pdf_page: s.page, quote: s.quote, codes: null, new_code: null, comment: null, ...extra });
      if (!r) { C.msg = 'You have submitted this group. Your answers are final.'; }
      C.sel = null; C.selForm = null; window.getSelection()?.removeAllRanges(); rr();
    };
    const field = fm && fm.kind === 'code' ? M.sq.get(fm.field).field : null;
    selBox.replaceChildren(h('div', { class: 'muted small', text: `Selected on PDF page ${s.page}` }), h('div', { class: 'passage small', text: s.quote.length > 220 ? s.quote.slice(0, 220) + '…' : s.quote }),
      !fm ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', id: 'ck-hl', onclick: () => save('highlight') }, 'Highlight'),
        h('button', { type: 'button', class: 'btn small', id: 'ck-note', onclick: () => { C.selForm = { kind: 'note', text: '' }; showSel(); } }, 'Add a note'),
        h('button', { type: 'button', class: 'btn small primary', id: 'ck-code', onclick: () => { C.selForm = { kind: 'code', field: G.g.fields[0], code: '', text: '', note: '' }; showSel(); } }, 'Add a code'),
        h('button', { type: 'button', class: 'link small', onclick: () => { C.sel = null; window.getSelection()?.removeAllRanges(); showSel(); } }, 'Cancel'))
        : fm.kind === 'note' ? h('div', null, h('textarea', { rows: 3, placeholder: 'Your note', oninput: (e) => { fm.text = e.target.value; } }, fm.text),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small primary', onclick: () => { if (fm.text.trim()) save('note', { comment: fm.text.trim() }); } }, 'Save note'),
            h('button', { type: 'button', class: 'link small', onclick: () => { C.selForm = null; showSel(); } }, 'Back')))
        : h('div', null,
          G.g.fields.length > 1 ? h('label', { class: 'sel' }, 'Research question', h('select', { onchange: (e) => { fm.field = e.target.value; fm.code = ''; showSel(); } },
            G.g.fields.map((x) => h('option', { value: x, selected: x === fm.field, text: M.sq.get(x).label })))) : null,
          h('label', { class: 'sel' }, 'Code', h('select', { 'data-sel': 'code', onchange: (e) => { fm.code = e.target.value; showSel(); } }, h('option', { value: '', text: '(choose a code)' }),
            field.values.map((x) => h('option', { value: x.id, selected: fm.code === x.id, text: x.id })), h('option', { value: '__new', selected: fm.code === '__new', text: 'A code not in codebook v2' }))),
          fm.code && fm.code !== '__new' ? h('div', { class: 'fd small', text: (field.values.find((x) => x.id === fm.code) || {}).definition || '' }) : null,
          fm.code === '__new' ? h('input', { type: 'text', placeholder: 'Name the new code (it goes to Joe for a ruling)', value: fm.text, oninput: (e) => { fm.text = e.target.value; } }) : null,
          h('textarea', { rows: 2, placeholder: 'Note (optional)', oninput: (e) => { fm.note = e.target.value; } }, fm.note),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small primary', onclick: () => {
            if (!fm.code || (fm.code === '__new' && !fm.text.trim())) return;
            save('code', fm.code === '__new' ? { new_code: { field: fm.field, text: fm.text.trim() }, comment: fm.note.trim() || null } : { codes: { [fm.field]: fm.code }, comment: fm.note.trim() || null });
          } }, 'Save code'), h('button', { type: 'button', class: 'link small', onclick: () => { C.selForm = null; showSel(); } }, 'Back'))));
    selBox.hidden = false;
  };
  const onSelect = ({ quote, page }) => { if (locked) return; C.sel = { quote, page }; C.selForm = null; showSel(); };
  C.onPick = onPick; C.onStatus = onStatus; C.onSelect = onSelect;
  showSel();
  if (keep) {
    C.pdf.setMarks(marks());
    onStatus(C.pdf.found);
    if (ua && C.lastUa !== ua) { const f = frags.find((x) => fkey(x) === ua); if (f) select(f); }
    C.lastUa = ua;
    return;
  }
  C.lastUa = ua;
  const doc = S.docById.get(C.doc);
  const files = pdfParts(doc || {}).filter((x) => S.store.has(x.file));
  if (!files.length) { status.textContent = 'The PDF is not in this workspace.'; return; }
  (async () => {
    try {
      if (C.blobDoc !== C.doc || !C.blob) { C.blob = null; const b = await S.store.readBlob(files[0].file); C.blob = b instanceof Blob ? b : new Blob([b], { type: 'application/pdf' }); C.blobDoc = C.doc; }
      if (!pdfHost.isConnected) return;
      C.pdf = await mountPdf(pdfHost, { blob: C.blob, marks: marks(), onPick: (k) => C.onPick(k), onStatus: (x) => C.onStatus(x), onSelect: (x) => C.onSelect(x) });
      const target = C.unit && frags.find((x) => fkey(x) === C.unit);
      if (target) select(target); else if (frags[0]) { const f = firstOpen(frags) || frags[0]; select(f); }
    } catch (e) { status.textContent = 'Could not open the PDF: ' + e.message; }
  })();
}
