// Corpus tier filter. A review that sets `corpus` in review.json loads only the units and documents
// whose tier is listed there. Anything without a listed tier is left out, so a missing field fails closed.
//   "corpus": { "field": "use_tier", "include": ["Paper corpus"] }
// A review may also set documents aside: "corpus": { "set_aside": "documents/exclusions.json" } leaves out every
// document the register lists with "platform": "set aside" (cogimp, 2 November 2026: CI07, CI08 and CI14, excluded
// once the two full-text screens were compared). Their files stay in the repo; their units, codes and samples
// never load, because units and layers load only for the documents kept.

export function tierRule(review) {
  const c = review && review.corpus;
  return c && c.field && Array.isArray(c.include) ? { field: c.field, include: new Set(c.include) } : null;
}

export function inCorpus(item, rule) {
  return !rule || rule.include.has(item?.[rule.field]);
}

export function corpusUnits(units, review) {
  const rule = tierRule(review);
  return rule ? (units || []).filter((u) => inCorpus(u, rule)) : units || [];
}

/** The register file a review sets documents aside with, or null. */
export const asidePath = (review) => (review && review.corpus && typeof review.corpus.set_aside === 'string' ? review.corpus.set_aside : null);

/** The ids a register sets aside: its documents with "platform": "set aside". */
export function asideIds(register) {
  return new Set(((register && register.documents) || []).filter((d) => d && d.platform === 'set aside').map((d) => d.doc));
}

export function corpusDocs(docs, review, aside = null) {
  const rule = tierRule(review);
  const kept = rule ? (docs || []).filter((d) => inCorpus(d, rule)) : docs || [];
  return aside && aside.size ? kept.filter((d) => !aside.has(d.id)) : kept;
}
