// Where a passage sits in its PDF, and the words a coder can search for there. Pure functions.

/**
 * The PDF file and page for a page label. `pages` is the `pages` list of <doc>.pages.json (label,
 * n = page within its file, file when the document is split into parts). Without page text, falls
 * back to the PDF parts' printed page ranges.
 */
export function pdfTarget(pages, parts, label) {
  const want = String(label ?? '').trim().replace(/^pp?\.\s*/i, '');
  const first = want.split(/[-–,]/)[0].trim(); // "8-9" opens on 8
  const pg = (pages || []).find((p) => String(p.label) === want) || (pages || []).find((p) => String(p.label) === first);
  if (pg) return { file: pg.file || parts[0].file, page: Number(pg.n) };
  const n = parseInt(first.replace(/^(e|pp?\.\s*)/i, ''), 10); // e-pages (e23) count as 23
  const part = (Number.isFinite(n) && parts.find((x) => n >= x.from && (x.to === null || n <= x.to))) || parts[0];
  return { file: part.file, page: Number.isFinite(n) ? n - part.from + 1 : null };
}

/** The first words of a passage, to paste into the PDF viewer's search: the first fragment, quotes removed. */
export function searchWords(text, max = 8) {
  // double quotes go, and single quotes only at the very start or end, so the words still match the PDF
  const frag = String(text || '').split(/\.\.\.|…/)[0].replace(/["“”]/g, ' ').trim().replace(/^['‘’]+|['‘’]+$/g, '').replace(/\s+/g, ' ').trim();
  return frag.split(' ').slice(0, max).join(' ');
}

/** What to search for, longest first: the first fragment whole, then its first 12 and 6 words. */
export function searchQueries(text) {
  const all = searchWords(text, 1e6);
  const out = [all, searchWords(text, 12), searchWords(text, 6)];
  return out.filter((q, i) => q && out.indexOf(q) === i);
}
