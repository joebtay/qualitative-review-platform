// Themes: a thematic frame coded at paragraph level, verified code by code. Pure functions, tested in
// tests/themes.test.mjs. The two views are in themeview.js.
//
// review.json switches them on (both default off, unlike other switches):
//   "features": { "themes_by_document": true, "themes_by_code": true }
//   "themes": { "frame": "themes", "sample": "themes-all", "home": { "<doc>": "<field>" } }
// `frame` is a thematic frame with one multi-value field per sub-question. `home` gives each document the
// field it is shown under in full; it is shown again as a link under every other field it has fragments in
// (PI, 13 October 2026: the home decides display only). `sample` is a locked whole-documents sample of the
// frame; verification events carry it.
//
// A fragment is one paragraph's codes under one field: { v: [codes], why, quote, gap }. Each code on a
// fragment is checked on its own: a `verify` event with field "<field>::<code>", action agree or
// disagree, and an optional `note` event on the same field. The latest event for a unit and field holds
// the state, as elsewhere.

export const THEME_SWITCHES = ['themes_by_document', 'themes_by_code'];

/** The review's themes settings, or null when it has none. */
export function themeConfig(review) {
  const t = review && review.themes;
  return t && t.frame ? t : null;
}

/** The field id a check on one code is recorded under. */
export const codeField = (field, code) => `${field}::${code}`;
export function splitCodeField(k) {
  const i = String(k).indexOf('::');
  return i < 0 ? null : { field: k.slice(0, i), code: k.slice(i + 2) };
}

/**
 * Every fragment of the frame, in document order, then paragraph order, then field order.
 * layerDocs: Map doc -> the layer's <doc>.json. units: Map doc -> unit list (with layer-added units).
 */
export function fragmentsOf(frame, layerDocs, docIds, units) {
  const out = [];
  const fieldIds = frame.fields.map((f) => f.id);
  for (const doc of docIds) {
    const L = layerDocs && layerDocs.get(doc);
    if (!L || !L.codes) continue;
    const list = (units && units.get(doc)) || [];
    const pos = new Map(list.map((u, i) => [u.id, i]));
    const ids = Object.keys(L.codes).sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9) || (a < b ? -1 : 1));
    for (const unit of ids) {
      const rec = L.codes[unit] && L.codes[unit][frame.id];
      if (!rec) continue;
      const u = list.find((x) => x.id === unit) || (L.units && L.units[unit]) || {};
      for (const field of fieldIds) {
        const v = rec[field];
        const codes = v && typeof v === 'object' && !Array.isArray(v) ? v.v : v;
        if (!Array.isArray(codes) || !codes.length) continue;
        out.push({ doc, unit, field, codes, why: v.why || '', quote: v.quote || '', gap: !!v.gap, added: v.added || null,
          page: u.page ?? null, pdf_page: u.pdf_page ?? null, text: u.text || '', label: u.label || unit });
      }
    }
  }
  return out;
}

/** Documents by field: each field lists its home documents, then the others that have fragments under it. */
export function groupDocs(frame, docIds, home, frags) {
  const has = new Set(frags.map((f) => `${f.doc}|${f.field}`));
  return frame.fields.map((f) => ({
    field: f.id, label: f.label,
    home: docIds.filter((d) => (home || {})[d] === f.id),
    also: docIds.filter((d) => (home || {})[d] !== f.id && has.has(`${d}|${f.id}`)),
  }));
}

/** Every code of the frame, by field, with its fragments: [{ field, label, codes: [{ id, frags, docs }] }]. */
export function codeIndex(frame, frags) {
  return frame.fields.map((f) => ({
    field: f.id, label: f.label,
    codes: f.values.map((v) => {
      const fr = frags.filter((x) => x.field === f.id && x.codes.includes(v.id));
      return { id: v.id, group: v.group || '', frags: fr, docs: [...new Set(fr.map((x) => x.doc))] };
    }),
  }));
}

/** One coder's checks: Map "<unit>|<field>::<code>" -> { action, note }. Latest event wins (by t, then id). */
export function verdicts(events, handle, frameId) {
  const out = new Map();
  const sorted = (events || []).filter((e) => e.coder === handle && e.frame === frameId && splitCodeField(e.field || ''))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id < b.id ? -1 : 1));
  for (const e of sorted) {
    const k = `${e.unit}|${e.field}`;
    const cur = out.get(k) || { action: null, value: null, note: '' };
    if (e.type === 'verify') { cur.action = e.action === 'clear' ? null : e.action; cur.value = e.action === 'clear' ? null : e.value ?? null; }
    else if (e.type === 'note') cur.note = e.text || '';
    else continue;
    out.set(k, cur);
  }
  return out;
}

/** How many code checks a list of fragments holds, and how many are answered. */
export function progress(frags, v) {
  let n = 0, done = 0;
  for (const f of frags) for (const c of f.codes) { n++; const x = v.get(`${f.unit}|${codeField(f.field, c)}`); if (x && x.action && x.action !== 'add') done++; }
  return { n, done };
}

// ----- checking the AI coding in pair groups (checkview.js; cognitive review phase 2, PI 2 November 2026)
// A group is a locked sample on the thematic frame with `fields`: its research questions. A checker answers every
// AI code on every fragment of the group: agree, disagree, or change (value: the code chosen); action add (value:
// the code) is a codebook code the checker adds to a fragment. A note on a code is a `note` event on the same field.

export const CHECK_ACTIONS = ['agree', 'disagree', 'change'];

/** The checker's groups: samples on the thematic frame that name research questions and hold items for them. */
export function checkGroups(samples, frameId) {
  return (samples || []).filter((s) => s.frame === frameId && Array.isArray(s.fields) && s.fields.length && s.assigned !== false && (s.units || []).length)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** A group's fragments: its research questions only, on its paragraphs only, in document, page and paragraph order. */
export function groupFragments(frags, group, docOrder) {
  const fields = new Set(group.fields);
  const units = new Set((group.units || []).map((u) => `${u.doc}|${u.unit}`));
  const fo = new Map(group.fields.map((f, i) => [f, i]));
  const num = (u) => { const m = /(\d+)$/.exec(u); return m ? Number(m[1]) : 0; };
  return frags.filter((f) => fields.has(f.field) && units.has(`${f.doc}|${f.unit}`))
    .sort((a, b) => ((docOrder.get(a.doc) ?? 0) - (docOrder.get(b.doc) ?? 0)) || ((a.pdf_page || 0) - (b.pdf_page || 0))
      || (num(a.unit) - num(b.unit)) || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0) || (fo.get(a.field) - fo.get(b.field)));
}

/** True once every AI code on the fragment has a verdict: the AI coder's reason shows only then. */
export function answered(f, v) {
  return f.codes.every((c) => { const x = v.get(`${f.unit}|${codeField(f.field, c)}`); return !!(x && CHECK_ACTIONS.includes(x.action)); });
}

/** Codes the checker added to a fragment, from the codebook: [{ code, note }]. */
export function addedCodes(f, v) {
  const out = [];
  const pre = `${f.unit}|${f.field}::`;
  for (const [k, x] of v) if (k.startsWith(pre) && x.action === 'add') out.push({ code: k.slice(pre.length), note: x.note || '' });
  return out;
}

// Qualitative colours, distinct in light and dark, for codes and sub-questions.
export const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22',
  '#393b79', '#ad494a', '#637939', '#7b4173', '#8c6d31', '#3182bd'];

/** Colours for a list of keys, in order: the first gets the first colour. */
export function colours(keys) {
  return new Map(keys.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
}

const LIG = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ß': 'ss' };

/** Letters and digits only, lower case, with a map from each kept character to [item, offset]. */
export function alnum(items) {
  let text = '';
  const at = [];
  items.forEach((s, i) => {
    const str = String(s ?? '');
    for (let k = 0; k < str.length; k++) {
      let c = LIG[str[k]] ?? str[k];
      c = c.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
      for (const ch of c) if (/[a-z0-9]/.test(ch)) { text += ch; at.push([i, k]); }
    }
  });
  return { text, at };
}

/**
 * Where a passage sits in a run of text items (the PDF text layer of one page), ignoring spaces,
 * punctuation, case and line-break hyphens. Tries the whole passage, then its first and last 40
 * characters as the two ends, then each extra snippet (a quote). Returns [{ from: [item, offset],
 * to: [item, offset] }] (to is exclusive), or [] when nothing is found.
 */
export function locateIn(items, passage, extras = []) {
  const N = alnum(items);
  const span = (a, b) => ({ from: N.at[a], to: [N.at[b - 1][0], N.at[b - 1][1] + 1] });
  const q = alnum([passage]).text;
  if (q.length >= 12) {
    const k = N.text.indexOf(q);
    if (k >= 0) return [span(k, k + q.length)];
    if (q.length > 90) {
      const head = q.slice(0, 40), tail = q.slice(-40);
      const a = N.text.indexOf(head);
      const b = a >= 0 ? N.text.indexOf(tail, a + head.length) : -1;
      if (a >= 0 && b >= 0 && b + 40 - a < q.length * 1.6) return [span(a, b + 40)];
    }
  }
  const out = [];
  for (const s of extras) {
    const t = alnum([s]).text;
    if (t.length < 12) continue;
    const k = N.text.indexOf(t);
    if (k >= 0) out.push(span(k, k + t.length));
  }
  return out;
}
