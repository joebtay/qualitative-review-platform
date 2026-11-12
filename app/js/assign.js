// Assigned samples: a scripted draw loaded as is, never redrawn. Each coder sees only the items
// assigned to them, in their own order. Work on the sample stays hidden from the other coders
// until every assigned coder has submitted. Pure functions; data.js applies them on load.

/** The sample as one coder sees it: their units only, sorted by their item number. */
export function viewFor(sample, handle) {
  if (!sample.coders) return sample;
  const mine = (sample.units || []).filter((u) => u.order && u.order[handle] != null)
    .sort((a, b) => a.order[handle] - b.order[handle]);
  return { ...sample, all_units: sample.units, units: mine, assigned: !!sample.coders[handle] };
}

/** A frame limited to the sample's fields, with the sample's definitions and answer set.
 *  opts (from the frame's settings, settings.js): addFields, fields shown besides the sample's own, in the frame's order,
 *  so a locked sample is never edited to add a check (secondary function and form, PI ruling 28b, 16 October 2026);
 *  confirm, fields whose blank first code still needs an answer (each gets confirm_blank: true). */
export function frameFor(frame, sample, opts = {}) {
  const add = new Set(opts.addFields || []);
  const confirm = opts.confirm || new Set();
  if (!sample || (!sample.fields && !sample.definitions && !sample.answers)) {
    if (!confirm.size) return frame;
    return { ...frame, fields: frame.fields.map((f) => (confirm.has(f.id) ? { ...f, confirm_blank: true } : f)) };
  }
  const keep = sample.fields ? new Set([...sample.fields, ...add]) : null;
  const defs = sample.definitions || {};
  const fields = frame.fields.filter((f) => !keep || keep.has(f.id)).map((f) => ({
    ...f,
    ...(confirm.has(f.id) ? { confirm_blank: true } : {}),
    values: f.values.map((v) => { const d = defs[`${f.id}|${v.id}`]; return d ? { ...v, definition: d.definition, source: d.source } : v; }),
  }));
  return { ...frame, fields, answers: sample.answers || null };
}

/**
 * The sample to open when the coder has not picked one: the newest that holds items for them.
 * An assigned sample with no items for this coder (another coder's, or the PI's practice sample)
 * never opens by default, so nobody lands on an empty queue. `ss` is sorted oldest first.
 */
export function defaultSample(ss, picked) {
  return ss.find((x) => x.id === picked) || [...ss].reverse().find((x) => x.assigned !== false && (x.units || []).length) || ss[ss.length - 1] || null;
}

export const SAMPLES_DOC = '_samples';

/** Coders who have submitted the sample. */
export function submitted(events, sampleId) {
  const s = new Set();
  for (const e of events) if (e.type === 'submit' && e.sample === sampleId) s.add(e.coder);
  return s;
}

/** True once every assigned coder has submitted. */
export function unblinded(sample, events) {
  if (!sample.coders) return true;
  const s = submitted(events, sample.id);
  return Object.keys(sample.coders).every((c) => s.has(c));
}

/**
 * Units whose work by other coders is hidden from `handle`: every unit of a blind sample that is
 * not yet unblinded. Returns Map unit -> true.
 */
export function hiddenUnits(samples, events) {
  const out = new Set();
  out.samples = new Set(); // blind samples not yet open: others' events naming them stay hidden too
  for (const s of samples) {
    if (!s.coders || s.blind === false || unblinded(s, events)) continue;
    out.samples.add(s.id);
    for (const u of s.all_units || s.units || []) out.add(u.unit);
  }
  return out;
}

/** May `handle` see event `e`? Their own always; others' not while it names a unit or sample still blind. */
export function visible(e, handle, hidden) {
  if (e.coder === handle || e.type === 'submit') return true;
  if (e.unit && hidden.has(e.unit)) return false;
  if (e.sample && hidden.samples && hidden.samples.has(e.sample)) return false;
  if (Array.isArray(e.samples) && hidden.samples && e.samples.some((s) => hidden.samples.has(s))) return false;
  return true;
}

/** Blind samples, not yet open, that hold a unit of this document: a passage on it carries them all. */
export function blindSamplesFor(samples, doc, events) {
  return samples.filter((s) => s.coders && s.blind !== false && (s.all_units || s.units || []).some((u) => u.doc === doc) && !unblinded(s, events));
}

/** Event types a coder can no longer add to a sample once they have submitted it. */
export const LOCKED_AFTER_SUBMIT = new Set(['verify', 'done', 'reopen', 'note', 'passage', 'passage-withdraw']);
