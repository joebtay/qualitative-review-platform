import { S, docEvents, allEvents, firstCodes, unitList, notCoded, layerFlags } from './data.js';
import { layerOf, sameLayer } from './settings.js';
import { h, bar, pct, colourFor, chip, mdToHtml } from './ui.js';
import { openCodebook } from './codebook.js';
import { queriesSection } from './queries.js';

const num = (n) => (n === null || n === undefined ? h('span', { class: 'muted', text: 'not entered' }) : String(n));

const PRISMA_LABELS = { identified: 'Records identified', screened: 'Records screened', sought: 'Reports sought for retrieval', assessed: 'Reports assessed for eligibility (full text)', included: 'Included' };

/**
 * The PRISMA 2020 flow from review.json `prisma`. With `prisma.show` (a list of boxes, for example
 * ["screened", "assessed"]) only those boxes appear, with no exclusion box; `prisma.labels` renames boxes.
 */
export function prisma() {
  const p = S.review.prisma || {};
  const label = (k) => (p.labels || {})[k] || PRISMA_LABELS[k];
  const box = (t, n, cls) => h('div', { class: 'pbox ' + (cls || '') }, h('div', { class: 'pt', text: t }), h('div', { class: 'pn' }, num(n)));
  if (Array.isArray(p.show)) {
    const ks = p.show.filter((k) => k in PRISMA_LABELS);
    return h('div', { class: 'prisma' }, h('div', { class: 'pcol' }, ks.map((k, i) => [i ? h('div', { class: 'parrow', text: '↓' }) : null, box(label(k), p[k], k === 'included' ? 'inc' : '')])));
  }
  const excl = p.excluded || [];
  const exTotal = excl.reduce((s, x) => s + (x.n || 0), 0);
  return h('div', { class: 'prisma' },
    h('div', { class: 'pcol' }, box('Records identified', p.identified), h('div', { class: 'parrow', text: '↓' }), box('Records screened', p.screened), h('div', { class: 'parrow', text: '↓' }),
      box('Reports sought for retrieval', p.sought), h('div', { class: 'parrow', text: '↓' }), box('Reports assessed for eligibility (full text)', p.assessed), h('div', { class: 'parrow', text: '↓' }),
      box('Included', p.included, 'inc')),
    h('div', { class: 'pcol side' },
      h('div', { class: 'pbox ex' }, h('div', { class: 'pt', text: `Reports excluded at full text${exTotal ? ` (n = ${exTotal})` : ''}` }),
        excl.length ? h('ul', null, excl.map((x) => h('li', { text: `${x.reason}: ${x.n}` }))) : h('div', { class: 'muted', text: 'No exclusions recorded yet. They come from the Screen module.' }))));
}

/** units coded in the first layer / total units, per frame */
export function codedProgress() {
  const out = {};
  let total = 0;
  for (const d of S.docs) total += unitList(d.id).filter((u) => !u.excluded && !u.layer).length;
  for (const fr of Object.values(S.frames)) {
    const lid = layerOf(fr.id, S.review);
    const layerFrames = (S.review.layers.find((l) => l.id === lid) || {}).frames || [];
    if (!layerFrames.includes(fr.id)) { out[fr.id] = { coded: 0, total }; continue; }
    // units the layer flags not-coded (headings) take no codes, and units it flags held are kept out until a ruling:
    // both are left out of the frame's total, as are units another layer adds
    let coded = 0, ftotal = 0;
    for (const d of S.docs) for (const u of unitList(d.id)) {
      if (u.excluded || (u.layer && !sameLayer(u.layer, lid, S.review)) || notCoded(d.id, u.id, fr.id) || layerFlags(d.id, u.id, fr.id).includes('held')) continue;
      ftotal++;
      if (firstCodes(d.id, u.id, fr.id)) coded++;
    }
    out[fr.id] = { coded, total: ftotal };
  }
  return { out, total };
}

export function verifiedProgress(frame) {
  const samples = S.samples.filter((s) => s.frame === frame);
  const sampled = new Set(), done = new Set();
  for (const s of samples) for (const u of s.units) sampled.add(u.unit);
  for (const e of allEvents()) if (e.type === 'done' && e.frame === frame && sampled.has(e.unit)) done.add(e.unit);
  const mine = new Set();
  for (const e of allEvents()) if (e.type === 'done' && e.frame === frame && e.coder === S.handle && sampled.has(e.unit)) mine.add(e.unit);
  return { sampled: sampled.size, done: done.size, mine: mine.size };
}

const PROJECT_SECTIONS = ['protocol', 'questions', 'progress', 'team', 'links', 'queries', 'prisma', 'milestones', 'layers'];

/** The protocol, from review.json `protocol.file` (markdown in the data repo), on its own page. */
let protoCache = null;
export function renderProtocol(root) {
  const pr = S.review.protocol || {};
  const body = h('div', { class: 'md orient', id: 'protocol-body' }, h('p', { class: 'muted', text: 'Loading the protocol' }));
  root.replaceChildren(h('div', { class: 'page narrow' }, h('p', null, h('a', { href: '#/project', text: 'Back to the project' })), h('section', { class: 'card' }, body)));
  if (!pr.file) { body.replaceChildren(h('p', { class: 'muted', text: 'No protocol file is set for this review.' })); return; }
  if (protoCache && protoCache.file === pr.file) { body.innerHTML = protoCache.html; return; }
  S.store.readText(pr.file).then((t) => { protoCache = { file: pr.file, html: mdToHtml(t) }; body.innerHTML = protoCache.html; })
    .catch(() => body.replaceChildren(h('p', { class: 'muted', text: `Could not load ${pr.file}.` })));
}

export function renderProject(root) {
  const r = S.review;
  const prog = S.ready ? codedProgress() : null;
  // review.json `project.sections` picks and orders the cards on this page. Left out, every card shows,
  // with the protocol card only when `protocol` is set.
  const want = (r.project && Array.isArray(r.project.sections)) ? r.project.sections : PROJECT_SECTIONS.filter((k) => k !== 'protocol' || r.protocol);
  const pr = r.protocol || {};
  const cards = {
    protocol: () => h('section', { class: 'card' }, h('h2', { text: 'Protocol' }),
      h('p', null, h('b', { text: pr.title || 'Protocol' })), pr.note ? h('p', { class: 'muted small', text: pr.note }) : null,
      h('div', { class: 'row' }, pr.file ? h('a', { href: '#/protocol', class: 'btn primary', id: 'open-protocol', text: 'Read the protocol' }) : null,
        pr.url ? h('a', { href: pr.url, target: '_blank', rel: 'noopener', class: 'btn', text: pr.url_label || 'Registration' }) : null)),
    questions: () => h('section', { class: 'card' }, h('h2', { text: 'Research questions' }),
          (r.questions || []).length ? h('ol', { class: 'rq' }, r.questions.map((q) => h('li', null, h('b', { text: q.id + '  ' }), q.text,
            (q.frames || []).length ? h('div', { class: 'rqf' }, q.frames.map((f) => h('span', { class: 'pill', text: (S.frames[f] || {}).name || f }))) : null))) : h('p', { class: 'muted', text: 'None entered. Edit review.json in the data repo.' })),
    progress: () => h('section', { class: 'card' }, h('h2', { text: 'Progress' }),
          !S.ready ? h('p', { class: 'muted', text: `Loading ${S.loading.done} of ${S.loading.total} files` }) : h('div', { class: 'prog' },
            h('div', { class: 'muted', text: `${S.docs.length} documents · ${prog.total.toLocaleString()} units of coding` }),
            Object.values(S.frames).map((fr) => {
              const c = prog.out[fr.id], v = verifiedProgress(fr.id);
              return h('div', { class: 'pr' }, h('div', { class: 'prh' }, h('b', { text: fr.name }), h('span', { class: 'muted', text: fr.type })),
                h('div', { class: 'prl' }, h('span', { text: 'Corpus coded' }), h('b', { text: `${pct(c.coded, c.total)}  (${c.coded.toLocaleString()} of ${c.total.toLocaleString()})` })), bar(c.total ? c.coded / c.total : 0, 'var(--blue)'),
                h('div', { class: 'prl' }, h('span', { text: 'Sample verified' }), h('b', { text: v.sampled ? `${pct(v.done, v.sampled)}  (${v.done} of ${v.sampled}; you ${v.mine})` : 'no sample drawn' })), bar(v.sampled ? v.done / v.sampled : 0, 'var(--green)'));
            }))),
    team: () => h('section', { class: 'card' }, h('h2', { text: 'Team' }),
          h('ul', { class: 'plain' }, (r.team || []).map((t) => h('li', null, h('b', { text: t.name }), '  ', h('span', { class: 'muted', text: `${t.role}${t.handle ? ' · @' + t.handle : ''}` }))))),
    links: () => h('section', { class: 'card' }, h('h2', { text: 'Key links' }),
          h('ul', { class: 'plain' },
            h('li', null, h('a', { href: '#/documents', text: 'Included documents' })),
            r.codebook ? h('li', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openCodebook({ tab: 'full' }); }, text: `Codebook ${r.codebook_version || ''}` })) : null,
            (r.links || []).filter((l) => !/codebook/i.test(l.label)).map((l) => h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label }))))),
    queries: () => queriesSection(),
    prisma: () => h('section', { class: 'card wide' }, h('h2', { text: 'PRISMA 2020 flow' }), prisma()),
    milestones: () => h('section', { class: 'card' }, h('h2', { text: 'Milestones' }),
          h('ul', { class: 'plain' }, (r.milestones || []).map((m) => h('li', { class: m.done ? 'done' : '' }, h('span', { class: 'tick', text: m.done ? '✓' : '○' }), ' ', m.label, m.date ? h('span', { class: 'muted', text: '  ' + m.date }) : null)))),
    layers: () => h('section', { class: 'card' }, h('h2', { text: 'Layers' }),
          (r.layers || []).length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['Layer', 'Kind', 'Frames'].map((x) => h('th', { text: x })))),
            h('tbody', null, r.layers.map((l) => h('tr', null, h('td', { text: l.label || l.id }), h('td', { text: l.kind }), h('td', { text: (l.frames || []).join(', ') }))))) : h('p', { class: 'muted', text: 'No coded layers yet.' })),
  };
  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'ph' }, h('h1', { text: r.title }), r.subtitle ? h('div', { class: 'muted', text: r.subtitle }) : null),
      h('div', { class: 'grid2' }, want.filter((k) => cards[k]).map((k) => cards[k]()))));
}
