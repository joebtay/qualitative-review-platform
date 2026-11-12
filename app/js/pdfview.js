// The passage's PDF page inside the app, with the passage highlighted, using Mozilla's PDF.js
// (app/vendor/pdfjs, Apache 2.0). Loaded only when a coder first opens a PDF.
import { h } from './ui.js';

let lib = null, viewerMod = null;
/** The PDF.js library and viewer module, once loaded. */
export const pdfjs = () => ({ lib, viewerMod });
export async function load() {
  if (lib) return;
  if (!document.querySelector('link[data-pdfjs]')) document.head.append(h('link', { rel: 'stylesheet', href: 'vendor/pdfjs/pdf_viewer.css', 'data-pdfjs': '1' }));
  lib = await import('../vendor/pdfjs/pdf.min.mjs');
  globalThis.pdfjsLib = lib; // the viewer module reads the library from here
  lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  viewerMod = await import('../vendor/pdfjs/pdf_viewer.mjs');
}

/**
 * Show a PDF over the app, on `page`, and highlight the first of `queries` that it finds.
 * `queries` go from the whole passage to its first words. `fallback` is shown when none is found.
 */
export async function showPdf({ blob, page, queries = [], title = '', fallback = '', note = '', label = 'passage' }) {
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  await load();
  const status = h('span', { class: 'pdfstatus', id: 'pdf-status', text: 'Loading the PDF' });
  const url = URL.createObjectURL(blob);
  const close = () => { ov.remove(); URL.revokeObjectURL(url); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const viewerEl = h('div', { class: 'pdfViewer' });
  const container = h('div', { class: 'pdfbody' }, viewerEl); // PDF.js needs an absolutely positioned container
  const ov = h('div', { class: 'pdfov', role: 'dialog', 'aria-label': 'PDF' },
    h('div', { class: 'pdfbar' }, h('b', { text: title }), status,
      h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener', text: 'Open in a new tab' }),
      h('button', { type: 'button', class: 'btn small primary', id: 'pdf-close', onclick: close, text: 'Close' })),
    note ? h('div', { class: 'pdfnote', text: note }) : null, h('div', { class: 'pdfwrap' }, container));
  document.body.append(ov);
  document.addEventListener('keydown', esc, true);

  const { EventBus, PDFLinkService, PDFFindController, PDFViewer, FindState } = viewerMod;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer = new PDFViewer({ container, viewer: viewerEl, eventBus, linkService, findController });
  linkService.setViewer(viewer);
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const target = page ? Math.min(page, doc.numPages) : 1;
  const width = (await doc.getPage(target)).getViewport({ scale: 1 }).width; // pages can differ: fit the passage's own page
  viewer.setDocument(doc);
  linkService.setDocument(doc);

  const tries = queries.filter((q) => q && q.trim());
  let i = 0;
  const find = () => eventBus.dispatch('find', { source: null, type: '', query: tries[i], caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false, matchDiacritics: false });
  eventBus.on('updatefindcontrolstate', (e) => {
    if (e.state === FindState.FOUND || e.state === FindState.WRAPPED) { status.textContent = i === 0 ? `${Label} highlighted` : `Start of the ${label} highlighted`; ov.dataset.found = '1'; }
    else if (e.state === FindState.NOT_FOUND) {
      if (++i < tries.length) find();
      else { status.textContent = fallback || `The ${label} was not found in the PDF text`; ov.dataset.found = '0'; }
    }
  });
  eventBus.on('pagesinit', () => {
    viewer.currentScale = Math.max(0.25, (container.clientWidth - 40) / (width * 96 / 72));
    viewer.currentPageNumber = target;
    status.textContent = tries.length ? `Finding the ${label}` : '';
    if (tries.length) find();
  });
  return ov;
}
