// New codes and comments on selected text (Verify by document). PI decision 4, brought forward as step 3
// (9 October 2026). Each is an append-only `passage` event on its document: the exact words, the PDF page,
// character offsets in that page's text, codes from the frame (none for a comment) and an optional comment.
// Nothing here changes the master. The PI rules on each new code before master v1.5.

/** The code fields used across a list of new codes, in the order they first appear. Each review sets its own (settings.js newCodeFields). */
export function codeFields(list) {
  const out = [];
  for (const p of list) for (const k of Object.keys(p.codes || {})) if (!out.includes(k)) out.push(k);
  return out;
}

/** Live passages on a document, oldest first: withdrawn ones drop out. */
export function passagesFor(events) {
  const gone = new Set(events.filter((e) => e.type === 'passage-withdraw').map((e) => e.passage + '|' + e.coder));
  return events.filter((e) => e.type === 'passage' && !gone.has(e.id + '|' + e.coder));
}

export const isCode = (p) => !!p.codes && Object.values(p.codes).some((v) => v != null && v !== '');

/** Character offsets of a DOM range inside a page's text element. Null if the range leaves the element. */
export function rangeOffsets(pgt, range) {
  if (!pgt.contains(range.startContainer) || !pgt.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.setStart(pgt, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}

/** Spans to mark in the text, by page index: [{start, end, key}], key "np:<event id>".
 *  A passage whose offsets no longer hold its words (page text re-extracted) is not marked. */
export function passageSpans(list, pages) {
  const byLabel = new Map();
  pages.forEach((p, i) => { if (!byLabel.has(String(p.label))) byLabel.set(String(p.label), i); });
  const out = new Map();
  for (const p of list) {
    const i = byLabel.get(String(p.page));
    if (i == null || pages[i].text.slice(p.start, p.end) !== p.quote) continue;
    if (!out.has(i)) out.set(i, []);
    out.get(i).push({ start: p.start, end: p.end, key: 'np:' + p.id });
  }
  return out;
}

// a cell opening with = + - @ would run as a formula in a spreadsheet: lead it with an apostrophe
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/** CSV of passages for the PI's ruling: one row per passage. */
export function passagesCSV(list, titleOf = () => '', fields = codeFields(list)) {
  const head = ['id', 'kind', 'doc', 'title', 'page', 'pdf_file', 'pdf_page', 'words', ...fields, 'comment', 'coder', 'time', 'sample'];
  const rows = list.map((p) => [p.id, isCode(p) ? 'new code' : 'comment', p.doc, titleOf(p.doc), p.page, p.pdf_file, p.pdf_page, p.quote,
    ...fields.map((f) => p.codes?.[f]), p.comment, p.coder, p.t, p.sample]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
