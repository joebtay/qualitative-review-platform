// Seeded, stratified sampler. Deterministic: the same seed and population always give the same sample.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * population: [{doc, unit, stratum}]
 * Returns {units:[{doc,unit}], strata:{name:{population,drawn}}, toppedUp:[doc]}
 * 15% per stratum (rounded up, at least minPer, never more than the stratum holds),
 * spread round-robin across documents, then one unit from every document still missing.
 */
export function draw(population, { fraction = 0.15, minPer = 2, seed }) {
  const rnd = mulberry32(seed);
  const pop = population.slice().sort((a, b) => (a.doc + '\u0000' + a.unit < b.doc + '\u0000' + b.unit ? -1 : 1));
  const byStratum = new Map();
  for (const p of pop) {
    const s = p.stratum ?? '(blank)';
    if (!byStratum.has(s)) byStratum.set(s, []);
    byStratum.get(s).push(p);
  }
  const strata = {};
  const chosen = new Map(); // key -> {doc, unit}
  for (const name of [...byStratum.keys()].sort()) {
    const units = byStratum.get(name);
    const target = Math.min(units.length, Math.max(minPer, Math.ceil(fraction * units.length)));
    const byDoc = new Map();
    for (const u of units) {
      if (!byDoc.has(u.doc)) byDoc.set(u.doc, []);
      byDoc.get(u.doc).push(u);
    }
    const docs = shuffle([...byDoc.keys()], rnd);
    const queues = new Map(docs.map((d) => [d, shuffle(byDoc.get(d), rnd)]));
    let drawn = 0;
    while (drawn < target) {
      let progressed = false;
      for (const d of docs) {
        if (drawn >= target) break;
        const q = queues.get(d);
        if (q.length) {
          const u = q.pop();
          chosen.set(u.doc + '\u0000' + u.unit, { doc: u.doc, unit: u.unit });
          drawn++;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    strata[name] = { population: units.length, drawn };
  }
  const covered = new Set([...chosen.values()].map((u) => u.doc));
  const toppedUp = [];
  const allDocs = [...new Set(pop.map((p) => p.doc))];
  for (const d of allDocs) {
    if (covered.has(d)) continue;
    const options = pop.filter((p) => p.doc === d);
    const u = options[Math.floor(rnd() * options.length)];
    chosen.set(u.doc + '\u0000' + u.unit, { doc: u.doc, unit: u.unit });
    toppedUp.push(d);
    const s = u.stratum ?? '(blank)';
    strata[s].drawn++;
  }
  return { units: [...chosen.values()], strata, toppedUp, population: pop.length };
}
