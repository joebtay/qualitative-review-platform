// Verify by document: the whole text with every coded fragment marked, and the fragments' codes beside it.

import { S, docEvents, allEvents, addEvent, firstCodes, firstExtras, unitList, findUnit, notify } from './data.js';
import { memoFor, commentsFor } from './events.js';
import { h, colourFor, bar, pct } from './ui.js';
import { textPane, whereText, saveScroll, restoreScroll, pagesFor } from './fulltext.js';
import { frameFor, submitted, unblinded, blindSamplesFor, SAMPLES_DOC } from './assign.js';
import { passagesFor, passageSpans, rangeOffsets, isCode, passagesCSV } from './passages.js';
import { layerOf, newCodeFields, sameLayer } from './settings.js';
import { V, renderVerify, modeBar, verifiableFrames, indexMine, unresolved, badParent, fieldRows, docOrder, currentSample, verifyOpts } from './verify.js';

export const D = { doc: null, task: null, fidx: 0, tab: null, filter: 'todo', scroll: null, keep: null, sel: null, np: null, msg: null };

/** For each verifiable frame, its current sample: the same one the fragment view uses. */
function activeSamples() {
  const out = [];
  for (const f of verifiableFrames()) { const s = currentSample(f); if (s) out.push({ frame: f, sample: s }); }
  return out;
}

/** Every (unit, frame) to verify, grouped by document, in document and unit order. */
function buildTasks(active) {
  const byDoc = new Map();
  const ord = docOrder();
  for (const { frame: base, sample } of active) {
    const frame = frameFor(base, sample, verifyOpts(base.id, sample));
    const mine = indexMine(sample);
    for (const u of sample.units) {
      if (!byDoc.has(u.doc)) byDoc.set(u.doc, []);
      byDoc.get(u.doc).push({ key: `${frame.id}|${u.unit}`, doc: u.doc, unit: u.unit, frame, sample, st: mine.get(u.unit) || { fields: {}, done: false } });
    }
  }
  for (const [doc, list] of byDoc) {
    const pos = new Map(unitList(doc).map((x, i) => [x.id, i]));
    const fo = new Map(active.map((a, i) => [a.frame.id, i]));
    list.sort((a, b) => ((pos.get(a.unit) ?? 0) - (pos.get(b.unit) ?? 0)) || (fo.get(a.frame.id) - fo.get(b.frame.id)));
  }
  const docs = [...byDoc.keys()].sort((a, b) => (ord.get(a) ?? 0) - (ord.get(b) ?? 0));
  return { byDoc, docs };
}

export function renderDocView(root) {
  const rr = () => renderVerify(root);
  if (!S.ready) { root.replaceChildren(modeBar(root), h('div', { class: 'page' }, h('p', { class: 'muted', text: `Loading ${S.loading.done} of ${S.loading.total} files` }))); return; }
  const active = activeSamples();
  if (!active.length) {
    root.replaceChildren(modeBar(root), h('div', { class: 'page narrow' }, h('section', { class: 'card' }, h('h2', { text: 'No sample yet' }),
      h('p', { text: 'Draw a sample first. Choose "Whole documents" to verify every coded fragment in the documents you pick.' }),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { V.sampleId = '__new'; V.draft = { mode: 'docs', seed: 1, fraction: 1, min: 2, result: null, reason: 'Verification by document', docs: null, frames: null }; rr(); } }, 'Draw a sample'))));
    return;
  }
  const { byDoc, docs } = buildTasks(active);
  const done = (t) => t.st.done;
  const docDone = (id) => byDoc.get(id).every(done);
  const shownDocs = docs.filter((id) => D.filter === 'all' || (D.filter === 'todo' ? !docDone(id) : docDone(id)));
  if (!D.doc || !byDoc.has(D.doc)) D.doc = (shownDocs[0] || docs[0]);
  const doc = S.docById.get(D.doc);
  const tasks = byDoc.get(D.doc);
  let cur = tasks.find((t) => t.key === D.task);
  if (!cur) { cur = tasks.find((t) => !done(t)) || tasks[0]; D.task = cur.key; D.fidx = 0; D.scroll = cur.unit; }
  const ti = tasks.indexOf(cur);
  // every coded fragment in the document, so ones outside the sample still show (faintly) for context
  const L = S.layers.get(layerOf(active[0].frame.id, S.review))?.get(D.doc);
  S.frameInView = active[0].frame.id;
  const asItem = (u) => {
    const quotes = [];
    const raw = L?.codes?.[u.id];
    if (raw) for (const fr of Object.values(raw)) for (const v of Object.values(fr || {})) if (v && typeof v === 'object' && v.quote) quotes.push(v.quote);
    return { key: u.id, label: u.label || u.id, text: u.text, page: u.page, kind: u.kind, quotes };
  };
  const taskUnits = new Set(tasks.map((t) => t.unit));
  const coded = unitList(D.doc).filter((u) => !u.excluded && active.some(({ frame }) => firstCodes(D.doc, u.id, frame.id)));
  const unitTask = new Map(); for (const t of tasks) if (!unitTask.has(t.unit)) unitTask.set(t.unit, t);

  const select = (t, scroll = true) => { D.task = t.key; D.fidx = 0; V.picker = null; if (scroll) D.scroll = t.unit; rr(); };
  const nextTodo = () => tasks.slice(ti + 1).find((t) => !done(t)) || tasks.find((t) => !done(t) && t !== cur) || null;
  const gotoDoc = (id) => { D.doc = id; D.task = null; D.tab = null; V.picker = null; rr(); };
  const nextDoc = () => docs.slice(docs.indexOf(D.doc) + 1).find((id) => !docDone(id)) || docs.find((id) => !docDone(id) && id !== D.doc) || null;

  // ----- documents list
  const totalT = docs.reduce((n, id) => n + byDoc.get(id).length, 0);
  const totalD = docs.reduce((n, id) => n + byDoc.get(id).filter(done).length, 0);
  const aside = h('aside', { class: 'vside' },
    h('section', { class: 'card' }, h('h2', { text: 'Documents' }),
      h('div', { class: 'big' }, h('b', { text: `${docs.filter(docDone).length} / ${docs.length}` }), h('span', { class: 'muted', text: ' documents finished' })),
      bar(docs.length ? docs.filter(docDone).length / docs.length : 0),
      h('div', { class: 'muted', text: `${totalD} of ${totalT} fragments verified by you (${pct(totalD, totalT)})` }),
      h('div', { class: 'pills' }, [['todo', 'To do'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => h('button', { type: 'button', class: 'pill' + (D.filter === k ? ' on' : ''), onclick: () => { D.filter = k; rr(); } }, l))),
      h('div', { class: 'qlist dlist' }, (shownDocs.length ? shownDocs : []).map((id) => {
        const d = S.docById.get(id); const ts = byDoc.get(id); const n = ts.filter(done).length;
        return h('button', { type: 'button', class: 'qi' + (id === D.doc ? ' cur' : ''), onclick: () => gotoDoc(id) },
          h('span', { class: 'qs ' + (n === ts.length ? 'd' : n ? 'p' : '') }),
          h('span', { class: 'qt' }, h('b', { class: 'mono', text: id }), h('span', { text: ' ' + ((d && (d.short || d.title)) || '').slice(0, 48) }), h('span', { class: 'muted', text: ` · ${n}/${ts.length}` })));
      }), shownDocs.length ? null : h('p', { class: 'muted', text: D.filter === 'todo' ? 'Every document is finished.' : 'None.' }))),
    h('section', { class: 'card' }, h('h2', { text: 'Samples in use' }),
      h('p', { class: 'muted small', text: 'The same samples as the fragment view. Work done in either view counts.' }),
      active.map(({ frame, sample }) => { const ss = S.samples.filter((x) => x.frame === frame.id && sameLayer(x.layer, layerOf(frame.id, S.review), S.review));
        return ss.length > 1 ? h('label', { class: 'sel' }, frame.name, h('select', { onchange: (e) => { V.pick[frame.id] = e.target.value; D.task = null; rr(); } }, ss.map((x) => h('option', { value: x.id, selected: x.id === sample.id, text: `${x.id} \u00b7 ${x.units.length} units${x.mode === 'documents' ? ' (whole documents)' : ''}` }))))
          : h('div', { class: 'muted small', text: `${frame.name}: ${sample.id} \u00b7 ${sample.units.length} units` }); }),
      h('button', { type: 'button', class: 'link', onclick: () => { V.sampleId = '__new'; V.draft = null; rr(); } }, 'Draw another sample')),
    h('section', { class: 'card' }, h('h2', { text: 'New codes and comments' }),
      h('p', { class: 'muted small', text: 'Select text in the Text tab to add a code or a comment. The list for ruling holds every one you can see.' }),
      h('button', { type: 'button', class: 'btn', onclick: () => exportPassages() }, 'Export for ruling (CSV)')));

  // ----- new codes and comments on selected text
  if (D.sel && D.sel.doc !== D.doc) { D.sel = null; D.np = null; }
  // every blind sample still closed that holds this document, whatever sample is in view
  const sev = docEvents(SAMPLES_DOC);
  const blinds = blindSamplesFor(S.samples, D.doc, sev);
  const blindSample = blinds[0] || (tasks.find((t) => t.sample.coders) || {}).sample || null;
  const mySub = blinds.some((b) => submitted(sev, b.id).has(S.handle)) || (!!blindSample && submitted(sev, blindSample.id).has(S.handle));
  const allOpen = !blinds.length;
  const plist = passagesFor(docEvents(D.doc));
  const pg = pagesFor(D.doc);
  const extra = pg ? passageSpans(plist, pg) : new Map();
  if (D.sel && pg) { const i = pg.findIndex((p) => String(p.label) === String(D.sel.page)); if (i >= 0) { if (!extra.has(i)) extra.set(i, []); extra.get(i).push({ start: D.sel.start, end: D.sel.end, key: 'np:sel' }); } }
  const ptitle = (k) => { if (k === 'np:sel') return 'Your selection'; const p = plist.find((x) => 'np:' + x.id === k); return p ? `${p.coder}: ${isCode(p) ? 'new code ' + Object.values(p.codes).filter(Boolean).join(' / ') : 'comment'}${p.comment ? ' · ' + p.comment : ''}` : k; };
  const onMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !pg) return;
    const r = sel.getRangeAt(0);
    const host = (n) => (n.nodeType === 1 ? n : n.parentElement)?.closest('.pg');
    const a = host(r.startContainer), b = host(r.endContainer);
    if (!a || a !== b) { D.msg = 'Select text within one page.'; rr(); return; }
    const i = Number(a.dataset.pg); const off = rangeOffsets(a.querySelector('.pgt'), r);
    if (!off) return;
    const text = pg[i].text; let { start, end } = off;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end - start < 3) return;
    D.sel = { doc: D.doc, page: pg[i].label, pdf_file: pg[i].file || (doc && doc.pdf) || `documents/${D.doc}.pdf`, pdf_page: pg[i].n, start, end, quote: text.slice(start, end) }; D.np = null; D.msg = null;
    sel.removeAllRanges(); rr();
  };

  // ----- full text
  const pane = textPane({ extra, extraTitle: ptitle, onMouseUp, doc, id: D.doc, title: doc ? doc.title : D.doc, sub: `${D.doc}${doc && doc.year ? ' \u00b7 ' + doc.year : ''}`,
    items: coded.filter((u) => taskUnits.has(u.id)).map(asItem), ghosts: coded.filter((u) => !taskUnits.has(u.id)).map(asItem),
    sel: cur.unit, onSelect: (k) => { const t = unitTask.get(k); if (t) select(t, false); }, tab: D.tab, setTab: (k) => { D.tab = k; D.scroll = cur.unit; rr(); }, scrollTo: D.scroll });
  const { pages, loc } = pane;
  const textCard = pane.el;

  // ----- fragments
  const events = docEvents(D.doc);
  const taskCard = (t, i) => {
    const u = findUnit(t.doc, t.unit, t.frame && t.frame.id);
    const isCur = t === cur;
    const where = whereText(pages, loc, t.unit);
    const nf = Object.keys(t.st.fields).length;
    const head = h('button', { type: 'button', class: 'th', onclick: () => select(t) },
      h('span', { class: 'qs ' + (t.st.done ? 'd' : nf ? 'p' : '') }),
      h('span', { class: 'tl' }, h('b', { text: (u && u.label) || t.unit }), active.length > 1 && t.frame.name !== (u && u.label) ? h('span', { class: 'muted', text: ` · ${t.frame.name}` }) : null,
        h('span', { class: 'muted small', text: `  ${t.unit}${u && u.page ? ' · p. ' + u.page : ''}${where ? ' · ' + where : ''}` })),
      !isCur && u ? h('span', { class: 'tx', text: (u.text || '').slice(0, 140) }) : null);
    if (!isCur) return h('div', { class: 'task' + (t.st.done ? ' done' : '') }, head);

    const codes = firstCodes(t.doc, t.unit, t.frame.id) || {};
    const st = t.st;
    const locked = !!t.sample.coders && submitted(docEvents(SAMPLES_DOC), t.sample.id).has(S.handle);
    const note = (fd, text) => addEvent(t.doc, 'note', { sample: t.sample.id, unit: t.unit, frame: t.frame.id, field: fd.id, text });
    const act = (fd, action, value) => addEvent(t.doc, 'verify', { sample: t.sample.id, unit: t.unit, frame: t.frame.id, field: fd.id, action, value: value ?? null });
    const open = unresolved(t.frame, codes, st);
    const agreeRest = () => { for (const fd of open) if (!badParent(t.frame, fd, codes, st)) act(fd, 'agree'); };
    const finish = () => { const n = tasks.slice(i + 1).find((x) => !done(x) && x !== t) || tasks.find((x) => !done(x) && x !== t); if (n) { D.task = n.key; D.fidx = 0; D.scroll = n.unit; } V.picker = null; addEvent(t.doc, 'done', { sample: t.sample.id, unit: t.unit, frame: t.frame.id }); };
    const extras = firstExtras(t.doc, t.unit);
    const claudeWhy = (() => { const raw = extras.raw && extras.raw[t.frame.id]; if (!raw) return []; return Object.entries(raw).filter(([, v]) => v && typeof v === 'object' && (v.why || v.conf != null)).map(([k, v]) => ({ k, why: v.why, conf: v.conf })); })();
    const myMemo = memoFor(events, { coder: S.handle, unit: t.unit, frame: t.frame.id });
    const comments = commentsFor(events, t.unit);
    D.keyCtx = { t, codes, st, act, open, agreeRest, finish };
    return h('div', { class: 'task cur' + (st.done ? ' done' : '') }, head,
      h('div', { class: 'passage small' }, u ? (u.text || u.label) : '(unit not found)'),
      h('div', { class: 'frows' }, fieldRows(t.frame, codes, st, { act, note, locked, sel: D.fidx, setSel: (k) => { D.fidx = k; }, pk: t.key + '|', rerender: rr, root })),
      h('div', { class: 'notes' },
        h('div', null, h('b', { text: "First coder's notes" }), !st.done ? h('div', { class: 'muted', text: 'Hidden until you finish this fragment.' }) :
          h('div', null, extras.note ? h('p', { text: extras.note }) : h('p', { class: 'muted', text: 'No notes.' }), claudeWhy.map((c) => h('p', { class: 'muted', text: `${c.k}: ${c.conf != null ? 'confidence ' + c.conf + '. ' : ''}${c.why || ''}` })))),
        h('label', null, h('b', { text: 'Your memo' }), h('textarea', { rows: 2, placeholder: 'Anything a second reader should know', value: myMemo, onblur: (ev) => { if (ev.target.value !== myMemo) addEvent(t.doc, 'memo', { unit: t.unit, frame: t.frame.id, text: ev.target.value }); } }, myMemo))),
      h('div', { class: 'comments' }, h('b', { text: `Discussion (${comments.length})` }),
        comments.map((c) => h('div', { class: 'cm' }, h('span', { class: 'cmw', text: c.coder }), h('span', { class: 'muted', text: ' ' + c.t.slice(0, 16).replace('T', ' ') }), h('div', { text: c.text }))),
        h('div', { class: 'row' }, h('textarea', { rows: 1, placeholder: 'Comment for the whole team', id: 'newcomment' }), h('button', { type: 'button', class: 'btn', onclick: () => { const x = document.getElementById('newcomment'); if (x.value.trim()) addEvent(t.doc, 'comment', { unit: t.unit, text: x.value.trim() }); } }, 'Post'))),
      h('div', { class: 'foot' }, st.done
        ? h('div', { class: 'row' }, h('span', { class: 'ok', text: 'Done' }), h('button', { type: 'button', class: 'btn', onclick: () => addEvent(t.doc, 'reopen', { sample: t.sample.id, unit: t.unit, frame: t.frame.id }) }, 'Reopen'))
        : h('div', { class: 'row' }, open.length > 1 ? h('button', { type: 'button', class: 'btn', title: 'Agree with every unchecked field (Shift+A)', onclick: agreeRest }, 'Agree with all remaining') : null,
          h('button', { type: 'button', class: 'btn primary', disabled: open.length > 0, onclick: finish }, 'Done, next fragment'),
          open.length ? h('span', { class: 'muted', text: `${open.length} left: ${open.map((x) => x.label).join(', ')}` }) : null)));
  };
  const tdone = tasks.filter(done).length;
  const nd = docDone(D.doc) ? nextDoc() : null;
  const taskPanel = h('section', { class: 'card dtasks' }, passagePanel(),
    h('div', { class: 'dth' }, h('h2', { text: `Fragments ${tdone} / ${tasks.length}` }), h('span', { class: 'muted small', text: 'J K move · A D O U act · Enter done' })),
    bar(tasks.length ? tdone / tasks.length : 0),
    docDone(D.doc) ? h('div', { class: 'okline' }, h('span', { text: 'This document is finished.' }), nd ? h('button', { type: 'button', class: 'btn primary', onclick: () => gotoDoc(nd) }, `Next document: ${nd}`) : h('span', { class: 'muted', text: ' Every document in the sample is finished.' })) : null,
    h('div', { class: 'tlist' }, tasks.map(taskCard)));

  function passagePanel() {
    const kids = [];
    const others = blindSample ? Object.keys(blindSample.coders).filter((c) => c !== S.handle) : [];
    if (D.msg) kids.push(h('div', { class: 'warnline', text: D.msg }));
    if (D.sel) {
      // a new code takes the fields the review sets for the frame (frame_settings new_codes), not a fixed list
      const ncBase = (blindSample && S.frames[blindSample.frame]) || S.frames[active[0].frame.id];
      const frame = frameFor(ncBase, blindSample, verifyOpts(ncBase.id, blindSample));
      const ncIds = newCodeFields(frame, blindSample, S.review);
      const fields = frame.fields.filter((f) => ncIds.includes(f.id));
      const np = D.np || (D.np = { mode: null, codes: {}, comment: '' });
      const save = (codes) => {
        const ev = { frame: ncBase.id, page: String(D.sel.page), pdf_file: D.sel.pdf_file, pdf_page: D.sel.pdf_page, start: D.sel.start, end: D.sel.end, quote: D.sel.quote, codes, comment: np.comment.trim() || null };
        if (blinds.length) { ev.sample = blinds[0].id; ev.samples = blinds.map((b) => b.id); } // blind: hidden from other coders until everyone submits each sample
        const r = addEvent(D.doc, 'passage', ev);
        if (!r) { D.msg = 'You have submitted this sample, so new codes on it are closed.'; rr(); return; }
        D.sel = null; D.np = null; D.msg = null; rr();
      };
      const closed = mySub && !allOpen;
      const codeClosed = mySub;
      const fn = np.codes.function_primary || null;
      kids.push(h('div', { class: 'npbox' },
        h('div', { class: 'muted small', text: `Selected on p. ${D.sel.page}` }), h('div', { class: 'passage small', text: D.sel.quote }),
        closed ? h('div', { class: 'muted', text: 'You have submitted this sample. New codes and comments open again when everyone has submitted.' })
          : !np.mode ? h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn primary', disabled: codeClosed, title: codeClosed ? 'The sample is submitted' : '', onclick: () => { np.mode = 'code'; rr(); } }, 'Add a new code'),
            h('button', { type: 'button', class: 'btn', onclick: () => { np.mode = 'comment'; rr(); } }, 'Comment'),
            h('button', { type: 'button', class: 'btn', onclick: () => { D.sel = null; D.np = null; rr(); } }, 'Clear'))
          : h('div', { class: 'npform' },
            np.mode === 'code' ? fields.map((f) => {
              const opts = f.depends_on ? f.values.filter((v) => !v.parent || v.parent === fn) : f.values;
              return h('label', { class: 'sel' }, f.label, h('select', { 'data-np': f.id, onchange: (e) => { np.codes[f.id] = e.target.value || null; for (const g of fields) if (g.depends_on === f.id) np.codes[g.id] = null; rr(); } },
                h('option', { value: '', text: '(none)' }), opts.map((v) => h('option', { value: v.id, selected: np.codes[f.id] === v.id, text: v.label }))),
                np.codes[f.id] && (f.values.find((v) => v.id === np.codes[f.id]) || {}).definition ? h('div', { class: 'fd', text: f.values.find((v) => v.id === np.codes[f.id]).definition }) : null);
            }) : null,
            h('label', null, np.mode === 'code' ? 'Comment (optional)' : 'Comment', h('textarea', { rows: 2, 'data-np': 'comment', oninput: (e) => { np.comment = e.target.value; } }, np.comment)),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn primary', onclick: () => {
                if (np.mode === 'code') { const codes = Object.fromEntries(ncIds.map((k) => [k, np.codes[k] || null])); if (!Object.values(codes).some(Boolean)) { D.msg = 'Choose at least one code.'; rr(); return; } save(codes); }
                else { if (!np.comment.trim()) { D.msg = 'Write a comment first.'; rr(); return; } save(null); } } }, np.mode === 'code' ? 'Save new code' : 'Save comment'),
              h('button', { type: 'button', class: 'btn', onclick: () => { D.sel = null; D.np = null; D.msg = null; rr(); } }, 'Cancel')),
            blindSample && !allOpen ? h('div', { class: 'muted small', text: `Hidden from ${others.join(' and ')} until everyone submits.` }) : null)));
    }
    if (plist.length) kids.push(h('div', { class: 'nplist' }, h('b', { text: `New codes and comments on this document (${plist.length})` }),
      plist.map((p) => h('div', { class: 'npi' },
        h('div', { class: 'muted small', text: `${p.coder} · p. ${p.page} · ${isCode(p) ? 'new code' : 'comment'}` }),
        h('div', { class: 'passage small', text: p.quote }),
        isCode(p) ? h('div', null, Object.keys(p.codes).filter((k) => p.codes[k]).map((k) => h('span', { class: 'chip', text: p.codes[k] }))) : null,
        p.comment ? h('div', { text: p.comment }) : null,
        p.coder === S.handle && !(p.sample && mySub) ? h('button', { type: 'button', class: 'link', onclick: () => { if (confirm('Withdraw this? It stays in the record, marked withdrawn.')) addEvent(D.doc, 'passage-withdraw', { passage: p.id, sample: p.sample || undefined }); } }, 'Withdraw') : null))));
    return kids.length ? h('div', { class: 'nppanel' }, kids) : null;
  }

  function exportPassages() {
    const list = passagesFor(allEvents()).sort((a, b) => (a.doc + a.page + a.start < b.doc + b.page + b.start ? -1 : 1));
    const csv = passagesCSV(list, (id) => (S.docById.get(id) || {}).title || '');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `new_codes_for_ruling_${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  // keep scroll positions across re-renders
  const saved = saveScroll(root, ['.dtb', '.tlist']);
  root.replaceChildren(modeBar(root), h('div', { class: 'dwrap' }, aside, textCard, taskPanel));
  if (D.keep && D.keep.doc === D.doc) restoreScroll(root, saved);
  D.keep = { doc: D.doc };
  if (D.scroll) { pane.after(root); D.scroll = null; }
  const tl = root.querySelector('.tlist');
  const c = tl && tl.querySelector('.task.cur');
  if (c && (c.offsetTop < tl.scrollTop || c.offsetTop > tl.scrollTop + tl.clientHeight - 60)) tl.scrollTop = Math.max(0, c.offsetTop - tl.offsetTop - 8);

  // keyboard
  V.keys = (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
    const k = ev.key.toLowerCase();
    const x = D.keyCtx; if (!x) return false;
    const fd = x.t.frame.fields[D.fidx];
    if (k === 'arrowdown') { D.fidx = Math.min(x.t.frame.fields.length - 1, D.fidx + 1); V.picker = null; rr(); }
    else if (k === 'arrowup') { D.fidx = Math.max(0, D.fidx - 1); V.picker = null; rr(); }
    else if (k === 'j') { const n = tasks[ti + 1]; if (n) select(n); }
    else if (k === 'k') { const n = tasks[ti - 1]; if (n) select(n); }
    else if (k === 'a' && ev.shiftKey) x.agreeRest();
    else if (k === 'a') { if (fd && !badParent(x.t.frame, fd, x.codes, x.st)) x.act(fd, 'agree'); }
    else if (k === 'd') { if (fd && (x.codes[fd.id] ?? null) != null) x.act(fd, 'disagree'); }
    else if (k === 'u') { if (fd) x.act(fd, 'unsure'); }
    else if (k === 'o') { if (fd) { const key = x.t.key + '|' + fd.id; V.picker = V.picker === key ? null : key; V.pickQ = ''; rr(); } }
    else if (k === 'enter' && !x.st.done && x.open.length === 0) x.finish();
    else if (k === 'escape') { if (V.picker) { V.picker = null; rr(); } else return false; }
    else return false;
    ev.preventDefault();
    return true;
  };
}

