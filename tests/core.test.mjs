import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvents, makeEvent, verifyState, isDone, finalValue } from '../app/js/events.js';
import { alphaNominal } from '../app/js/stats.js';
import { draw } from '../app/js/sampler.js';

test('mergeEvents unions by id and never loses an event', () => {
  const a = [{ id: 'a', t: '2026-01-01T00:00:01Z' }, { id: 'b', t: '2026-01-01T00:00:02Z' }];
  const b = [{ id: 'b', t: '2026-01-01T00:00:02Z' }, { id: 'c', t: '2026-01-01T00:00:00Z' }];
  const m = mergeEvents(a, b);
  assert.deepEqual(m.map((e) => e.id), ['c', 'a', 'b']);
  assert.deepEqual(mergeEvents(b, a).map((e) => e.id), ['c', 'a', 'b']); // order independent
  assert.equal(mergeEvents(m, m).length, 3); // idempotent
});

test('latest verify event wins, clear removes', () => {
  const k = { coder: 'x', sample: 's', unit: 'u', frame: 'f' };
  const e = (t, action, value) => ({ id: t, t, type: 'verify', ...k, field: 'level', action, value });
  assert.equal(verifyState([e('1', 'agree')], k).level.action, 'agree');
  assert.equal(verifyState([e('1', 'agree'), e('2', 'other', 'System')], k).level.value, 'System');
  assert.equal(verifyState([e('1', 'agree'), e('2', 'clear')], k).level, undefined);
});

test('done and reopen', () => {
  const k = { coder: 'x', sample: 's', unit: 'u', frame: 'f' };
  const ev = [{ id: '1', t: '1', type: 'done', ...k }, { id: '2', t: '2', type: 'reopen', ...k }];
  assert.equal(isDone(ev.slice(0, 1), k), true);
  assert.equal(isDone(ev, k), false);
});

test('finalValue', () => {
  assert.deepEqual(finalValue('agree', 'A'), { v: 'A' });
  assert.deepEqual(finalValue('disagree', 'A'), { v: null });
  assert.deepEqual(finalValue('other', 'A', 'B'), { v: 'B' });
  assert.equal(finalValue('unsure', 'A'), null);
});

test('alpha: perfect, none and a known case', () => {
  assert.equal(alphaNominal([['a', 'a'], ['b', 'b'], ['a', 'a']]).alpha, 1);
  assert.equal(alphaNominal([]).alpha, null);
  // Two coders, 10 units, 8 agree (4 a, 4 b), 2 disagree (a/b, b/a):
  const pairs = [...Array(4).fill(['a', 'a']), ...Array(4).fill(['b', 'b']), ['a', 'b'], ['b', 'a']];
  const r = alphaNominal(pairs);
  // n=20, n_a=10, n_b=10, Do=4, De=(10*10+10*10)/19=10.526, alpha=1-4/10.526=0.62
  assert.ok(Math.abs(r.alpha - (1 - 4 / (200 / 19))) < 1e-9);
  assert.equal(r.agreement, 0.8);
  // blank counts as a category
  assert.equal(alphaNominal([[null, ''], ['a', 'a']]).agreement, 1);
});

const popn = () => {
  const out = [];
  for (let d = 0; d < 20; d++) for (let u = 0; u < 10; u++) out.push({ doc: 'D' + d, unit: `D${d}-U${u}`, stratum: d % 4 === 0 ? 'rare' : u < 5 ? 'A' : 'B' });
  return out;
};

test('sampler is deterministic and order independent', () => {
  const a = draw(popn(), { seed: 7 });
  const b = draw(popn().reverse(), { seed: 7 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.units, draw(popn(), { seed: 8 }).units);
});

test('sampler: 15% per stratum, min 2, covers every document', () => {
  const p = popn();
  const r = draw(p, { seed: 1, fraction: 0.15, minPer: 2 });
  const counts = {};
  for (const u of p) counts[u.stratum] = (counts[u.stratum] || 0) + 1;
  for (const [name, s] of Object.entries(r.strata)) {
    assert.equal(s.population, counts[name]);
    assert.ok(s.drawn >= Math.min(2, s.population));
    assert.ok(s.drawn >= Math.ceil(0.15 * s.population));
  }
  assert.equal(new Set(r.units.map((u) => u.doc)).size, 20);
  assert.equal(new Set(r.units.map((u) => u.unit)).size, r.units.length); // no duplicates
  assert.equal(Object.values(r.strata).reduce((s, x) => s + x.drawn, 0), r.units.length);
});

test('sampler: tiny stratum is taken whole', () => {
  const r = draw([{ doc: 'x', unit: 'x1', stratum: 'one' }], { seed: 1 });
  assert.equal(r.units.length, 1);
});

import { normalise, snippetsFor, findSpans, pageRefs, segments } from '../app/js/match.js';

test('normalise maps quotes, dashes, ligatures and line-break hyphens, and keeps offsets', () => {
  const s = 'The “ﬁrst” cog‐\nnitive  test';
  const n = normalise(s);
  assert.equal(n.text, 'the "first" cognitive test');
  assert.equal(s[n.idx[n.text.indexOf('cognitive')]], 'c');
});

test('snippetsFor pairs straight quotes in order and skips short ones', () => {
  const u = { kind: 'charting field', text: 'Only "restraints" (p.e127), on "structural restraints of the review" here.' };
  assert.deepEqual(snippetsFor(u), ['structural restraints of the review']);
  const c = { kind: 'component', text: 'are person-centred, empathetic' };
  assert.deepEqual(snippetsFor(c), ['are person-centred, empathetic']);
});

test('findSpans finds a quote across a line break and returns original offsets', () => {
  const page = 'Intro.\n\nMost likely, garden access is both a contrib-\nuting factor to and result of wellbeing.';
  const sp = findSpans(page, ['garden access is both a contributing factor']);
  assert.equal(sp.length, 1);
  assert.equal(page.slice(sp[0].start, sp[0].start + 6), 'garden');
});

test('pageRefs reads p., pp., ranges, lists and e-pages', () => {
  assert.deepEqual(pageRefs('Weighted mean (p.127). Tables (pp.128-129).'), [127, 128, 129]);
  assert.deepEqual(pageRefs('(pp.241, 243) and (e23), e30-e31, ms p.74'), [23, 30, 31, 74, 241, 243]);
  assert.deepEqual(pageRefs('Not reported.'), []);
});

test('segments split text at span edges and list covering keys', () => {
  const s = segments(10, [{ start: 2, end: 6, key: 'a' }, { start: 4, end: 8, key: 'b' }]);
  assert.deepEqual(s.map((x) => [x.start, x.end, x.keys.join('')]), [[0, 2, ''], [2, 4, 'a'], [4, 6, 'ab'], [6, 8, 'b'], [8, 10, '']]);
});

import { cohenKappa } from '../app/js/stats.js';

test('cohenKappa: perfect, chance-level and worked example', () => {
  assert.equal(cohenKappa([['i', 'i'], ['e', 'e']]).kappa, 1);
  const k = cohenKappa([['i', 'i'], ['i', 'i'], ['i', 'e'], ['e', 'e'], ['e', 'e'], ['e', 'i'], ['i', 'i'], ['e', 'e']]);
  assert.equal(k.n, 8); assert.equal(k.agreement, 0.75); assert.equal(k.kappa.toFixed(2), '0.50');
  assert.equal(cohenKappa([]).kappa, null);
});

test('corpus tier filter keeps only listed tiers and fails closed', async () => {
  const { corpusUnits, corpusDocs } = await import('../app/js/tier.js');
  const review = { corpus: { field: 'use_tier', include: ['Paper corpus'] } };
  const units = [{ id: 'a', use_tier: 'Paper corpus' }, { id: 'b', use_tier: 'Project resource' }, { id: 'c' }];
  assert.deepEqual(corpusUnits(units, review).map((u) => u.id), ['a']);
  assert.deepEqual(corpusDocs([{ id: 'D1', use_tier: 'Project resource' }, { id: 'D2', use_tier: 'Paper corpus' }], review).map((d) => d.id), ['D2']);
  assert.equal(corpusUnits(units, {}).length, 3); // no rule: unchanged
});

test('a register sets documents aside: they and only they leave the corpus', async () => {
  const { corpusDocs, asideIds, asidePath } = await import('../app/js/tier.js');
  const register = { documents: [{ doc: 'CI07', platform: 'set aside' }, { doc: 'CI08', platform: 'set aside' }, { doc: 'X1', platform: 'never loaded' }] };
  const aside = asideIds(register);
  assert.deepEqual([...aside].sort(), ['CI07', 'CI08']);
  const docs = ['CI01', 'CI07', 'CI08', 'CI09'].map((id) => ({ id }));
  assert.deepEqual(corpusDocs(docs, { corpus: { set_aside: 'documents/exclusions.json' } }, aside).map((d) => d.id), ['CI01', 'CI09']);
  assert.deepEqual(corpusDocs(docs, {}, null).map((d) => d.id), ['CI01', 'CI07', 'CI08', 'CI09']);
  assert.equal(asidePath({ corpus: { set_aside: 'documents/exclusions.json' } }), 'documents/exclusions.json');
  assert.equal(asidePath({ corpus: { field: 'use_tier', include: ['Paper corpus'] } }), null);
  // a tier rule and a register together: both apply
  const both = { corpus: { field: 'use_tier', include: ['Paper corpus'], set_aside: 'r.json' } };
  assert.deepEqual(corpusDocs([{ id: 'CI01', use_tier: 'Paper corpus' }, { id: 'CI07', use_tier: 'Paper corpus' }, { id: 'R1', use_tier: 'Other' }], both, aside).map((d) => d.id), ['CI01']);
});

