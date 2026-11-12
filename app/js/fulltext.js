// The full-text pane shared by Verify (by document) and Screen: page text with fragments marked, or the PDF.

import { S, notify } from './data.js';
import { h, colourFor } from './ui.js';
import { pdfParts } from './documents.js';
import { snippetsFor, findSpans, pageRefs, segments } from './match.js';

export const FT = { pages: new Map(), failed: new Set(), pdf: new Map() };

const pagesPath = (id) => `documents/${id}.pages.json`;
export const hasText = (id) => !!S.store && S.store.has(pagesPath(id));
export const hasPdf = (d) => !!d && pdfParts(d).some((x) => S.store.has(x.file));
const pageNum = (label) => parseInt(String(label ?? '').replace(/^e/i, ''), 10);

/** Page text for a document, loaded once. Returns the pages, or null while loading or if there is none. */
export function pagesFor(id) {
  if (!FT.pages.has(id) && !FT.failed.has(id) && hasText(id)) {
    FT.pages.set(id, null);
    S.store.readJSON(pagesPath(id)).then((x) => { FT.pages.set(id, x.pages || []); notify(); }).catch(() => { FT.pages.delete(id); FT.failed.add(id); notify(); });
  }
  return FT.pages.get(id) || null;
}

/** PDF part and page within it for a printed page number. */
export function pdfTarget(d, page) {
  const parts = pdfParts(d).filter((x) => S.store.has(x.file));
  const n = pageNum(String(page ?? '').replace(/^pp?\.\s*/i, ''));
  const part = (Number.isFinite(n) && parts.find((x) => n >= x.from && (x.to === null || n <= x.to))) || parts[0];
  return part ? { file: part.file, local: Number.isFinite(n) ? n - part.from + 1 : null } : null;
}

function pdfUrl(file) {
  if (FT.pdf.has(file)) return FT.pdf.get(file);
  FT.pdf.set(file, null);
  S.store.readBlob(file).then((b) => { FT.pdf.set(file, URL.createObjectURL(new Blob([b], { type: 'application/pdf' }))); notify(); }).catch(() => { FT.pdf.delete(file); });
  return null;
}

/** Where each item sits in the text. item: {key, text, page, kind, quotes}. */
export function locate(pages, items) {
  const spans = new Map(), cites = new Map(), found = new Map();
  for (const it of items) {
    const snips = snippetsFor({ kind: it.kind, text: it.text }, it.quotes || []);
    const refs = new Set(pageRefs(`${it.page ? 'p.' + it.page : ''} ${it.text || ''}`));
    const rec = { marks: 0, pages: new Set() };
    pages.forEach((p, i) => {
      if (snips.length) for (const s of findSpans(p.text, snips)) { if (!spans.has(i)) spans.set(i, []); spans.get(i).push({ ...s, key: it.key }); rec.marks++; rec.pages.add(i); }
      if (refs.has(pageNum(p.label))) { if (!cites.has(i)) cites.set(i, new Set()); cites.get(i).add(it.key); rec.pages.add(i); }
    });
    found.set(it.key, rec);
  }
  return { spans, cites, found };
}

/** A short line on where an item was found. */
export function whereText(pages, loc, key) {
  if (!pages || !loc) return '';
  const f = loc.found.get(key);
  return f && f.marks ? `${f.marks} highlight${f.marks > 1 ? 's' : ''} in the text` : f && f.pages.size ? `cited on p. ${[...f.pages].map((k) => pages[k].label).join(', ')}` : 'not located in the text';
}

/**
 * The full-text card. o: {doc, id, title, sub, items, ghosts, sel, onSelect(key), tab, setTab(tab), scrollTo, colour(key),
 *   extra: Map page index -> [{start, end, key}] for new passages (keys "np:..."), extraTitle(key), onMouseUp(ev)}
 * items are live (clickable); ghosts are shown faintly. Returns {el, loc, pages, after(root)}.
 */
export function textPane(o) {
  const pages = hasText(o.id) ? pagesFor(o.id) : null;
  const tab = (o.tab || 'text') === 'text' && !hasText(o.id) && hasPdf(o.doc) ? 'pdf' : (o.tab || 'text');
  const all = [...o.items, ...(o.ghosts || [])];
  const loc = pages ? locate(pages, all) : null;
  const live = new Set(o.items.map((x) => x.key));
  const label = new Map(all.map((x) => [x.key, x.label || x.key]));
  const colour = o.colour || ((k) => colourFor(label.get(k)));
  let body;
  if (tab === 'pdf') {
    const selItem = all.find((x) => x.key === o.sel);
    const f = loc && o.sel ? loc.found.get(o.sel) : null;
    const page = (selItem && selItem.page) || (f && f.pages.size ? pages[[...f.pages][0]].label : null);
    const tgt = hasPdf(o.doc) ? pdfTarget(o.doc, page) : null;
    const url = tgt ? pdfUrl(tgt.file) : null;
    body = !tgt ? h('p', { class: 'muted', text: 'The PDF is not in the data repo yet.' }) : !url ? h('p', { class: 'muted', text: 'Loading the PDF' })
      : h('iframe', { class: 'pdfv', src: url + (tgt.local ? `#page=${tgt.local}` : ''), title: 'Full text' });
  } else if (!hasText(o.id)) {
    body = h('p', { class: 'muted', text: hasPdf(o.doc) ? 'No text version of this document yet. Use the PDF tab.' : 'The full text is not in the data repo yet.' });
  } else if (!pages) {
    body = h('p', { class: 'muted', text: FT.failed.has(o.id) ? 'Could not load the text.' : 'Loading the text' });
  } else {
    body = pages.map((p, i) => {
      const xs = (o.extra && o.extra.get(i)) || [];
      const sp = [...(loc.spans.get(i) || []), ...xs];
      const ci = [...(loc.cites.get(i) || [])].filter((k) => live.has(k));
      const hot = ci.includes(o.sel) || sp.some((s) => s.key === o.sel);
      return h('section', { class: 'pg' + (hot ? ' hot' : ''), 'data-pg': i },
        h('div', { class: 'pgh' }, h('span', { class: 'mono', text: `p. ${p.label}` }),
          ci.length ? h('span', { class: 'cites' }, h('span', { class: 'muted', text: 'cited by ' }), ci.map((k) => h('button', { type: 'button', class: 'cite' + (k === o.sel ? ' on' : ''), style: { '--c': colour(k) }, onclick: () => o.onSelect(k) }, label.get(k)))) : null),
        h('div', { class: 'pgt' }, segments(p.text.length, sp).map((g) => {
          const txt = p.text.slice(g.start, g.end);
          if (!g.keys.length) return txt;
          const np = g.keys.filter((k) => k.startsWith('np:'));
          if (np.length && np.length === g.keys.length) return h('mark', { class: 'newp' + (np.some((k) => k === 'np:sel') ? ' sel' : ''), title: np.map((k) => o.extraTitle ? o.extraTitle(k) : k).join('\n') }, txt);
          const ks = g.keys.filter((k) => live.has(k));
          if (!ks.length) return h('mark', { class: 'frag ghost', title: 'Coded, not in this sample: ' + g.keys.map((k) => label.get(k)).join(', ') }, txt);
          const on = ks.includes(o.sel);
          return h('mark', { class: 'frag' + (on ? ' on' : ''), 'data-u': ks.join(' '), title: ks.map((k) => label.get(k)).join(', '), style: { '--c': colour(on ? o.sel : ks[0]) }, onclick: () => o.onSelect(on ? o.sel : ks[0]) }, txt);
        })));
    });
  }
  const el = h('section', { class: 'card dtext' },
    h('div', { class: 'dth' }, h('div', null, o.sub ? h('div', { class: 'mono muted', text: o.sub }) : null, h('div', { class: 'dt', text: o.title || o.id })),
      h('div', { class: 'seg' }, [['text', 'Text'], ['pdf', 'PDF']].map(([k, l]) => h('button', { type: 'button', class: tab === k ? 'on' : '', disabled: (k === 'pdf' && !hasPdf(o.doc)) || (k === 'text' && !hasText(o.id)), onclick: () => o.setTab(k) }, l)))),
    h('div', { class: 'dtb' + (tab === 'pdf' ? ' pdf' : ''), onmouseup: o.onMouseUp || null }, body));
  const after = (root) => {
    const tb = root.querySelector('.dtb');
    if (!o.scrollTo || tab !== 'text' || !pages || !tb) return false;
    const m = [...tb.querySelectorAll('mark.frag[data-u]')].find((x) => x.dataset.u.split(' ').includes(o.scrollTo));
    const f = loc.found.get(o.scrollTo);
    const target = m || (f && f.pages.size ? tb.querySelector(`.pg[data-pg="${[...f.pages][0]}"]`) : null);
    if (target) tb.scrollTop = Math.max(0, target.offsetTop - tb.offsetTop - 80);
    return true;
  };
  return { el, loc, pages, tab, after };
}

/** Keep the scroll position of panes across a re-render of the same document. */
export function saveScroll(root, sels) { return Object.fromEntries(sels.map((s) => [s, root.querySelector(s)?.scrollTop || 0])); }
export function restoreScroll(root, saved) { for (const [s, v] of Object.entries(saved)) { const e = root.querySelector(s); if (e) e.scrollTop = v; } }
