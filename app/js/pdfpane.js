// A PDF beside the page (not over it), with many passages highlighted at once, each in its own colours.
// Mozilla's PDF.js draws the pages and their text layer; the highlights are boxes laid over the text
// layer, found by the words of each passage (themes.js locateIn). Used by the Themes by document view.
import { h } from './ui.js';
import { load, pdfjs } from './pdfview.js';
import { locateIn } from './themes.js';

/**
 * Mount a PDF viewer in `host`. marks: [{ key, page (PDF page), text (the whole passage), quotes: [..],
 * colours: [css colour, ..], title }]. onPick(key) runs when a highlight is clicked.
 * Returns { show(key), setMarks(marks), found: Map key -> true|false, destroy() }.
 */
export async function mountPdf(host, { blob, marks = [], onPick = () => {}, onStatus = () => {}, onSelect = null }) {
  await load();
  const { lib, viewerMod } = pdfjs();
  const viewerEl = h('div', { class: 'pdfViewer' });
  const container = h('div', { class: 'pdfbody' }, viewerEl);
  host.replaceChildren(h('div', { class: 'pdfwrap' + (onSelect ? ' selectable' : '') }, container));
  if (onSelect) {
    // Text can be selected anywhere, highlights included (they let the mouse through): a selection is offered to
    // onSelect({ quote, page, rect }); a plain click on a highlight picks it, as a click on the highlight would.
    container.addEventListener('mouseup', (ev) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        const el = (n) => (n.nodeType === 1 ? n : n.parentElement);
        const pa = el(r.startContainer)?.closest('.page'), pb = el(r.endContainer)?.closest('.page');
        if (!pa || !viewerEl.contains(pa)) return;
        const quote = sel.toString().replace(/\s+/g, ' ').trim();
        if (quote.length < 3) return;
        onSelect({ quote, page: Number(pa.dataset.pageNumber), samePage: pa === pb, rect: r.getBoundingClientRect() });
        return;
      }
      for (const hl of container.querySelectorAll('.hl')) {
        const b = hl.getBoundingClientRect();
        if (ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom) { onPick(hl.dataset.key); return; }
      }
    });
  }
  const { EventBus, PDFLinkService, PDFViewer } = viewerMod;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({ container, viewer: viewerEl, eventBus, linkService });
  linkService.setViewer(viewer);
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  viewer.setDocument(doc);
  linkService.setDocument(doc);

  let list = marks;
  let want = null; // a mark to bring into view once its page has drawn
  const found = new Map();
  const drawn = new Map(); // page number -> overlay element

  const draw = (n) => {
    const pv = viewer.getPageView(n - 1);
    const tl = pv && pv.textLayer && pv.textLayer.div;
    if (!tl) return;
    const spans = [...tl.querySelectorAll('span')].filter((s) => s.firstChild && s.firstChild.nodeType === 3);
    const items = spans.map((s) => s.firstChild.data);
    const pageBox = pv.div.getBoundingClientRect();
    if (drawn.has(n)) drawn.get(n).remove();
    const layer = h('div', { class: 'hlayer' });
    for (const m of list.filter((x) => Number(x.page) === n)) {
      const ranges = locateIn(items, m.text, m.quotes || []);
      found.set(m.key, ranges.length > 0);
      for (const r of ranges) {
        for (let i = r.from[0]; i <= r.to[0]; i++) {
          const node = spans[i].firstChild;
          const rg = document.createRange();
          rg.setStart(node, i === r.from[0] ? r.from[1] : 0);
          rg.setEnd(node, i === r.to[0] ? r.to[1] : node.data.length);
          for (const b of rg.getClientRects()) {
            if (b.width < 1 || b.height < 1) continue;
            const cs = m.colours && m.colours.length ? m.colours : ['#888'];
            const bg = cs.length === 1 ? cs[0] : `linear-gradient(to bottom, ${cs.map((c, j) => `${c} ${(100 * j) / cs.length}% ${(100 * (j + 1)) / cs.length}%`).join(', ')})`;
            layer.append(h('div', { class: 'hl', 'data-key': m.key, title: m.title || '',
              style: { left: `${b.left - pageBox.left}px`, top: `${b.top - pageBox.top}px`, width: `${b.width}px`, height: `${b.height}px`, background: bg },
              onclick: () => onPick(m.key) }));
          }
        }
      }
    }
    pv.div.append(layer);
    drawn.set(n, layer);
    onStatus(found);
    if (want) mark(want);
  };

  const mark = (key) => {
    const m = list.find((x) => x.key === key);
    if (!m) return;
    for (const el of container.querySelectorAll('.hl.on')) el.classList.remove('on');
    const els = [...container.querySelectorAll('.hl')].filter((el) => el.dataset.key === key);
    if (!els.length) {
      want = key;
      if (viewer.currentPageNumber !== Number(m.page)) viewer.currentPageNumber = Number(m.page);
      return;
    }
    want = null;
    els.forEach((el) => el.classList.add('on'));
    const top = els[0].getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = Math.max(0, top - container.clientHeight / 3);
  };

  eventBus.on('textlayerrendered', (e) => draw(e.pageNumber));
  eventBus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; if (want) mark(want); });
  const fit = () => { if (viewer.pdfDocument) viewer.currentScaleValue = 'page-width'; };
  window.addEventListener('resize', fit);

  return {
    found,
    container,
    show: (key) => { want = key; mark(key); },
    setMarks: (m) => { list = m; for (const n of [...drawn.keys()]) draw(n); },
    destroy: () => { window.removeEventListener('resize', fit); try { viewer.cleanup(); doc.destroy(); } catch {} host.replaceChildren(); },
    get pages() { return doc.numPages; },
  };
}
