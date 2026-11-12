// Loads a review from a store and holds all state in one object.

import { mergeEvents, makeEvent, cmp } from './events.js';
import { Sync } from './sync.js';
import { corpusUnits, corpusDocs, asidePath, asideIds } from './tier.js';
import { viewFor, hiddenUnits, visible, submitted, SAMPLES_DOC, LOCKED_AFTER_SUBMIT } from './assign.js';
import { layerOf, layerIds, withExtraFields, supersededIds } from './settings.js';

export const S = {
  store: null, handle: null, review: null, frames: {}, docs: [], docById: new Map(),
  units: new Map(), layers: new Map(), samples: [], events: new Map(), sync: null,
  loading: { total: 0, done: 0 }, syncStatus: { state: 'saved', pending: 0 }, listeners: new Set(), statusListeners: new Set(), codebook: null,
};

export const notify = () => S.listeners.forEach((f) => f());
export const notifyStatus = () => S.statusListeners.forEach((f) => f());

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const x = items[i++]; await fn(x); }
  }));
}

export async function loadReview(store, handle) {
  S.store = store;
  S.handle = handle;
  S.review = await store.readJSON('review.json');
  S.frames = {};
  // a frame setting may add fields (extra_fields, such as a secondary form); the frame file is never altered
  for (const f of S.review.frames || []) if (store.has(`frames/${f}.json`)) S.frames[f] = withExtraFields(await store.readJSON(`frames/${f}.json`), S.review);
  // documents a register sets aside never load: if the review names a register that cannot be read, nothing loads
  const ap = asidePath(S.review);
  const aside = ap ? asideIds(store.has(ap) ? await store.readJSON(ap) : { documents: [{ doc: '*', platform: 'set aside' }] }) : null;
  const index = store.has('documents/index.json') ? await store.readJSON('documents/index.json') : [];
  S.docs = aside && aside.has('*') ? [] : corpusDocs(index, S.review, aside);
  S.docById = new Map(S.docs.map((d) => [d.id, d]));
  S.queries = store.has('queries.json') ? await store.readJSON('queries.json') : [];
  const sc = S.review.screening;
  S.records = null; S.firstScreen = null;
  if (sc && sc.enabled) {
    S.records = sc.records && store.has(sc.records) ? await store.readJSON(sc.records) : [];
    S.firstScreen = sc.first && store.has(sc.first) ? await store.readJSON(sc.first) : { records: {} };
  }
  S.sync = new Sync(store, handle, (st) => { S.syncStatus = st; notifyStatus(); });
  notify();
  loadRest().catch((e) => { S.loadError = e; notify(); });
}

export async function loadRest() {
  const { store, review } = S;
  // every layer the review lists loads, so each frame is read from its own layer (settings.js layerOf)
  const lids = layerIds(review);
  const jobs = [];
  for (const d of S.docs) {
    if (store.has(`units/${d.id}.json`)) jobs.push(['units', d.id]);
    for (const lid of lids) if (store.has(`layers/${lid}/${d.id}.json`)) jobs.push(['layer', d.id, lid]);
  }
  const samplePaths = store.list('samples/').filter((p) => p.endsWith('.json'));
  const workPaths = store.list('work/').filter((p) => p.endsWith('.json'));
  S.loading = { total: jobs.length + samplePaths.length + workPaths.length, done: 0 };
  const tick = () => { S.loading.done++; if (S.loading.done % 8 === 0) notify(); };
  S.samples = [];
  await pool(samplePaths, 6, async (p) => { S.samples.push(await store.readJSON(p)); tick(); });
  await pool(workPaths, 6, async (p) => {
    const [, , file] = p.split('/');
    const doc = file.replace(/\.json$/, '');
    try {
      const w = await store.readJSON(p);
      S.events.set(doc, mergeEvents(S.events.get(doc), w.events));
    } catch {}
    tick();
  });
  // local outbox events that have not reached GitHub yet
  for (const [doc, evs] of Object.entries(S.sync.outbox)) S.events.set(doc, mergeEvents(S.events.get(doc), evs));
  notify();
  await pool(jobs, 8, async ([kind, id, lid]) => {
    if (kind === 'units') S.units.set(id, corpusUnits((await store.readJSON(`units/${id}.json`)).units, review));
    else {
      if (!S.layers.has(lid)) S.layers.set(lid, new Map());
      S.layers.get(lid).set(id, await store.readJSON(`layers/${lid}/${id}.json`));
    }
    tick();
  });
  // a layer may add units of its own (its units block, "add": true), charted in that layer only; units/ is never altered
  // a layer that a newer layer supersedes adds none: its successor carries them
  const replaced = supersededIds(review);
  for (const [lid, docs] of S.layers) if (!replaced.has(lid)) for (const [doc, d] of docs) for (const [id, v] of Object.entries(d?.units || {})) {
    const list = S.units.get(doc) || [];
    if (!v.add || list.some((x) => x.id === id)) continue;
    const { add, change, was, ...u } = v;
    S.units.set(doc, list.concat(corpusUnits([{ ...u, layer: lid }], review)));
  }
  // samples name units by id: keep only units that loaded, so a sample can never show a unit outside the corpus
  for (const sm of S.samples) sm.units = (sm.units || []).filter((u) => S.docById.has(u.doc) && S.units.get(u.doc)?.some((x) => x.id === u.unit));
  // an assigned sample shows each coder only their own items, in their own order
  S.samples = S.samples.map((sm) => viewFor(sm, S.handle));
  S.loading.done = S.loading.total;
  S.ready = true;
  notify();
}

export async function refreshEvents() {
  await S.store.refreshTree();
  const paths = S.store.list('work/').filter((p) => p.endsWith('.json'));
  await pool(paths, 6, async (p) => {
    const doc = p.split('/')[2].replace(/\.json$/, '');
    try { S.events.set(doc, mergeEvents(S.events.get(doc), (await S.store.readJSON(p)).events, S.sync.pendingEvents(doc))); } catch {}
  });
  notify();
}

export function addEvent(doc, type, fields) {
  const sub = submitted.bind(null, rawEvents(SAMPLES_DOC));
  if (LOCKED_AFTER_SUBMIT.has(type) && [fields.sample, ...(fields.samples || [])].some((x) => x && sub(x).has(S.handle))) return null; // submitted: answers are final
  const prev = S.events.get(doc) || [];
  const e = makeEvent(S.handle, type, { doc, ...fields }, prev.length ? prev[prev.length - 1].t : null);
  S.events.set(doc, mergeEvents(S.events.get(doc), [e]));
  S.sync.add(doc, e);
  notify();
  return e;
}

/** Latest recorded decision for a query (by time, then id), or null. */
export function latestDecision(qid) { const d = decisionsFor(qid); return d.length ? d[d.length - 1] : null; }
export function decisionsFor(qid) { return docEvents('_queries').filter((e) => e.type === 'decision' && e.query === qid).sort(cmp); }

const rawEvents = (doc) => S.events.get(doc) || [];
/** Units whose other coders' work stays hidden: units of a blind sample not yet submitted by every coder. */
export const hidden = () => hiddenUnits(S.samples, rawEvents(SAMPLES_DOC));
export const allEvents = () => { const hd = hidden(); return [].concat(...S.events.values()).filter((e) => visible(e, S.handle, hd)); };
export const docEvents = (doc) => { const hd = hidden(); return rawEvents(doc).filter((e) => visible(e, S.handle, hd)); };

const val = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x.v ?? null : x ?? null);
export const codeValue = val;

/** The first coder's codes for a unit and frame, from the layer that holds the frame: {field: value}. */
export function firstCodes(doc, unit, frame) {
  const L = S.layers.get(layerOf(frame, S.review))?.get(doc);
  const c = L?.codes?.[unit]?.[frame];
  if (!c) return null;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, val(v)]));
}
export function firstExtras(doc, unit, frame) {
  const L = S.layers.get(frame ? layerOf(frame, S.review) : S.review.first_layer)?.get(doc);
  const raw = L?.codes?.[unit];
  return { note: L?.notes?.[unit] || '', raw };
}

/** The flags the frame's layer gives a unit. */
export function layerFlags(doc, unit, frame) { return S.layers.get(layerOf(frame, S.review))?.get(doc)?.flags?.[unit] || []; }
/** True when the frame's layer flags the unit not-coded (a heading, or a segment that takes no codes). */
export function notCoded(doc, unit, frame) { return layerFlags(doc, unit, frame).includes('not-coded'); }

export function unitList(doc) { return S.units.get(doc) || []; }
/** A unit as a frame's layer shows it. A layer may correct a unit's page, quote or label without touching units/
 *  (which an earlier layer shares): `units: { "<unit>": { "page": "12", "text": "...", "label": "...", "flags": [...] } }`
 *  in the layer's <doc>.json. With no frame, or no correction, the unit is as in units/. A layer's added units
 *  ("add": true) load with the document's other units (loadRest). */
export function findUnit(doc, id, frame) {
  const u = unitList(doc).find((x) => x.id === id);
  if (!u || !frame) return u;
  const fix = S.layers.get(layerOf(frame, S.review))?.get(doc)?.units?.[id];
  if (!fix) return u;
  const out = { ...u };
  for (const k of ['page', 'text', 'label', 'flags']) if (fix[k] !== undefined) out[k] = fix[k];
  return out;
}

export function populationFor(frame) {
  const f = S.frames[frame];
  const out = [];
  for (const d of S.docs) {
    for (const u of unitList(d.id)) {
      if (u.excluded) continue;
      const c = firstCodes(d.id, u.id, frame);
      if (!c) continue;
      out.push({ doc: d.id, unit: u.id, stratum: c[f.stratify_by] ?? '(blank)' });
    }
  }
  return out;
}

export function fieldDef(frame, field) { return S.frames[frame].fields.find((x) => x.id === field); }
export function valueDef(frame, field, value) { return fieldDef(frame, field)?.values.find((v) => v.id === value); }
