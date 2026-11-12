// Append-only event log. Pure functions, no DOM, no network.

export const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

export const cmp = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Union of event lists by id, oldest first. Never drops an event. */
export function mergeEvents(...lists) {
  const m = new Map();
  for (const l of lists) for (const e of l || []) if (e && e.id && !m.has(e.id)) m.set(e.id, e);
  return [...m.values()].sort(cmp);
}

/** Now, or 1 ms after `after` (the latest time already seen) if this clock is behind it.
 *  Keeps a coder's later action after their earlier one when a clock is slow or steps back. */
export function nextTime(after, now = Date.now()) {
  const a = after ? Date.parse(after) : NaN;
  return new Date(Number.isFinite(a) && now <= a ? a + 1 : now).toISOString();
}

export function makeEvent(coder, type, fields, after) {
  return { id: uid(), t: nextTime(after), coder, type, ...fields };
}

const fkey = (e) => `${e.unit}|${e.frame}|${e.field}`;

/** Latest verify event per field for one coder, sample, unit and frame. */
export function verifyState(events, { coder, sample, unit, frame }) {
  const out = {};
  for (const e of events) {
    if (e.type !== 'verify' || e.coder !== coder || e.sample !== sample || e.unit !== unit || e.frame !== frame) continue;
    out[e.field] = e; // events are sorted, so the last one wins
  }
  for (const k of Object.keys(out)) if (out[k].action === 'clear') delete out[k];
  return out;
}

/** True when the latest done/reopen event for this unit is "done". */
export function isDone(events, { coder, sample, unit, frame }) {
  let done = false;
  for (const e of events) {
    if (e.coder !== coder || e.sample !== sample || e.unit !== unit || e.frame !== frame) continue;
    if (e.type === 'done') done = true;
    else if (e.type === 'reopen') done = false;
  }
  return done;
}

/** Latest memo text by this coder for a unit and frame. */
export function memoFor(events, { coder, unit, frame }) {
  let memo = '';
  for (const e of events) if (e.type === 'memo' && e.coder === coder && e.unit === unit && e.frame === frame) memo = e.text;
  return memo;
}

export function commentsFor(events, unit) {
  return events.filter((e) => e.type === 'comment' && e.unit === unit);
}

/** The value a verifier ends up with for a field, given the first coder's value. */
export function finalValue(action, original, value) {
  if (action === 'agree') return { v: original ?? null };
  if (action === 'disagree') return { v: null };
  if (action === 'other') return { v: value ?? null };
  return null; // unsure or none: excluded from agreement
}
