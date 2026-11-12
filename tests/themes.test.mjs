// Themes: fragments of a paragraph-level thematic frame, grouping, checks code by code, and finding a
// passage in a PDF text layer (app/js/themes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { themeConfig, codeField, splitCodeField, fragmentsOf, groupDocs, codeIndex, verdicts, progress, colours, alnum, locateIn, checkGroups, groupFragments, answered, addedCodes } from '../app/js/themes.js';

const frame = { id: 'themes', fields: [
  { id: 'sq1', label: 'Prevalence and severity', values: [{ id: 'Pooled' }, { id: 'Form: Example form' }] },
  { id: 'sq6', label: 'Equity and ethics', values: [{ id: 'Justice' }, { id: 'Gender and sex' }] },
] };
const layer = new Map([
  ['A', { codes: {
    'A-p0002': { themes: { sq1: { v: ['Pooled'], why: 'w1', quote: 'q1' }, sq6: null } },
    'A-p0001': { themes: { sq1: { v: ['Form: Example form', 'Pooled'], why: 'w0', quote: 'q0' }, sq6: { v: ['Justice'], why: 'w2', quote: 'q2', gap: true } } },
  }, units: {} }],
  ['B', { codes: { 'B-t0001': { themes: { sq6: { v: ['Gender and sex'], why: 'w3', quote: 'q3' } } } } }],
]);
const units = new Map([['A', [{ id: 'A-p0001', page: '5', pdf_page: 1, text: 'one' }, { id: 'A-p0002', page: '6', pdf_page: 2, text: 'two' }]], ['B', [{ id: 'B-t0001', page: '9', pdf_page: 3, text: 'row' }]]]);

test('themes settings need a frame', () => {
  assert.equal(themeConfig({}), null);
  assert.equal(themeConfig({ themes: { home: {} } }), null);
  assert.deepEqual(themeConfig({ themes: { frame: 'themes' } }), { frame: 'themes' });
});

test('a check on one code is recorded under field::code, and splits back', () => {
  assert.equal(codeField('sq5', 'Reasonable accommodation'), 'sq5::Reasonable accommodation');
  assert.deepEqual(splitCodeField('sq5::Level 1 experimental'), { field: 'sq5', code: 'Level 1 experimental' });
  assert.equal(splitCodeField('function_primary'), null);
});

test('fragments come in document, paragraph and field order, with page and gap', () => {
  const fr = fragmentsOf(frame, layer, ['A', 'B'], units);
  assert.deepEqual(fr.map((f) => `${f.unit}/${f.field}`), ['A-p0001/sq1', 'A-p0001/sq6', 'A-p0002/sq1', 'B-t0001/sq6']);
  assert.equal(fr[1].gap, true);
  assert.equal(fr[0].page, '5');
  assert.equal(fr[3].pdf_page, 3);
});

test('documents sit in full under their home sub-question and are linked under the others', () => {
  const fr = fragmentsOf(frame, layer, ['A', 'B'], units);
  const g = groupDocs(frame, ['A', 'B'], { A: 'sq1', B: 'sq1' }, fr);
  assert.deepEqual(g[0], { field: 'sq1', label: 'Prevalence and severity', home: ['A', 'B'], also: [] });
  assert.deepEqual(g[1].home, []);
  assert.deepEqual(g[1].also, ['A', 'B']);
});

test('code index counts fragments and documents per code, zero-count codes kept', () => {
  const fr = fragmentsOf(frame, layer, ['A', 'B'], units);
  const idx = codeIndex(frame, fr);
  const pooled = idx[0].codes.find((c) => c.id === 'Pooled');
  assert.equal(pooled.frags.length, 2);
  assert.deepEqual(pooled.docs, ['A']);
  assert.equal(idx[1].codes.find((c) => c.id === 'Gender and sex').frags.length, 1);
  assert.equal(idx[1].codes.length, 2);
});

test('checks: the latest event per code wins; clear undoes; notes kept; other coders and frames ignored', () => {
  const ev = (id, t, coder, type, field, extra) => ({ id, t, coder, type, frame: 'themes', unit: 'A-p0001', field, ...extra });
  const events = [
    ev('1', '2026-10-13T01:00:00Z', 'joebtay', 'verify', 'sq1::Pooled', { action: 'disagree' }),
    ev('2', '2026-10-13T01:01:00Z', 'joebtay', 'note', 'sq1::Pooled', { text: 'not pooled' }),
    ev('3', '2026-10-13T01:02:00Z', 'joebtay', 'verify', 'sq1::Pooled', { action: 'agree' }),
    ev('4', '2026-10-13T01:03:00Z', 'joebtay', 'verify', 'sq6::Justice', { action: 'agree' }),
    ev('5', '2026-10-13T01:04:00Z', 'joebtay', 'verify', 'sq6::Justice', { action: 'clear' }),
    ev('6', '2026-10-13T01:05:00Z', 'xcoder', 'verify', 'sq1::Form: Example form', { action: 'agree' }),
    { ...ev('7', '2026-10-13T01:06:00Z', 'joebtay', 'verify', 'sq1', { action: 'agree' }) },
  ];
  const v = verdicts(events, 'joebtay', 'themes');
  assert.deepEqual(v.get('A-p0001|sq1::Pooled'), { action: 'agree', value: null, note: 'not pooled' }); // value: the code an action names (change, add)
  assert.equal(v.get('A-p0001|sq6::Justice').action, null);
  assert.equal(v.has('A-p0001|sq1::Form: Example form'), false);
  assert.equal(v.size, 2);
  const fr = fragmentsOf(frame, layer, ['A', 'B'], units);
  assert.deepEqual(progress(fr, v), { n: 5, done: 1 });
});

test('colours: one per key, in order', () => {
  const c = colours(['a', 'b', 'a2']);
  assert.equal(c.size, 3);
  assert.notEqual(c.get('a'), c.get('b'));
});

test('alnum keeps letters and digits with their place, folding ligatures and accents', () => {
  const N = alnum(['Signiﬁcant ', 'café-41']);
  assert.equal(N.text, 'significantcafe41');
  assert.deepEqual(N.at[0], [0, 0]);
  assert.deepEqual(N.at[N.text.length - 1], [1, 6]);
});

test('locateIn finds a passage across text items, ignoring spaces, hyphens and case', () => {
  const items = ['Homeless adults had a high ', 'preva-', 'lence of TBI (53.1%).', ' Next sentence.'];
  const r = locateIn(items, 'high prevalence of TBI (53·1%)');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].from, [0, 22]);
  assert.deepEqual(r[0].to, [2, 18]); // just after the last digit, '1' of 1%
});

test('locateIn: a long passage whose middle differs is found by its two ends; else the quote', () => {
  const body = 'The first part of this paragraph runs on for quite a while, longer than sixty letters, and then ';
  const items = [body + 'MIDDLE IN THE PDF ' + 'ends with these closing words that finish the paragraph neatly.'];
  const passage = body + 'middle as segmented ' + 'ends with these closing words that finish the paragraph neatly.';
  const r = locateIn(items, passage);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].from, [0, 0]);
  assert.equal(r[0].to[1], items[0].length - 1);
  const q = locateIn(['nothing like it here, but the quote is here somewhere'], 'xx yy zz not found at all in text', ['the quote is here']);
  assert.equal(q.length, 1);
  assert.deepEqual(locateIn(['short'], 'short'), []);
});

// ----- checking the AI coding in pair groups (cognitive review phase 2, PI 2 November 2026)

test('checkGroups: samples on the thematic frame with research questions and items, in id order', () => {
  const s = [{ id: 'check-c', frame: 'themes', fields: ['sq6'], units: [{ doc: 'A', unit: 'u1' }] },
    { id: 'check-a', frame: 'themes', fields: ['sq1', 'sq2'], units: [{ doc: 'A', unit: 'u1' }] },
    { id: 'themes-all', frame: 'themes', units: [{ doc: 'A', unit: 'u1' }] },
    { id: 'check-b', frame: 'themes', fields: ['sq4'], units: [], assigned: false },
    { id: 'check-profile', frame: 'profile', units: [{ doc: 'A', unit: 'p' }] }];
  assert.deepEqual(checkGroups(s, 'themes').map((x) => x.id), ['check-a', 'check-c']);
});

test('groupFragments: the group\'s questions and paragraphs only, by document, page, paragraph and question', () => {
  const fr = [
    { doc: 'B', unit: 'B-p0002', field: 'sq1', pdf_page: 1, codes: ['x'] },
    { doc: 'A', unit: 'A-p0010', field: 'sq2', pdf_page: 2, codes: ['x'] },
    { doc: 'A', unit: 'A-p0010', field: 'sq1', pdf_page: 2, codes: ['x'] },
    { doc: 'A', unit: 'A-p0009', field: 'sq6', pdf_page: 1, codes: ['x'] },
    { doc: 'A', unit: 'A-p0003', field: 'sq1', pdf_page: 1, codes: ['x'] },
    { doc: 'A', unit: 'A-p0099', field: 'sq1', pdf_page: 1, codes: ['x'] }];
  const g = { fields: ['sq1', 'sq2'], units: [{ doc: 'A', unit: 'A-p0010' }, { doc: 'A', unit: 'A-p0003' }, { doc: 'A', unit: 'A-p0009' }, { doc: 'B', unit: 'B-p0002' }] };
  const out = groupFragments(fr, g, new Map([['A', 0], ['B', 1]]));
  assert.deepEqual(out.map((f) => `${f.unit}|${f.field}`), ['A-p0003|sq1', 'A-p0010|sq1', 'A-p0010|sq2', 'B-p0002|sq1']);
});

test('answered: every AI code needs agree, disagree or change; a note or an added code is not an answer', () => {
  const f = { unit: 'u', field: 'sq1', codes: ['a', 'b'] };
  const v = verdicts([
    { id: '1', t: '1', coder: 'me', frame: 'themes', type: 'verify', unit: 'u', field: 'sq1::a', action: 'agree', value: 'a' },
    { id: '2', t: '2', coder: 'me', frame: 'themes', type: 'note', unit: 'u', field: 'sq1::b', text: 'hm' },
    { id: '3', t: '3', coder: 'me', frame: 'themes', type: 'verify', unit: 'u', field: 'sq1::c', action: 'add', value: 'c' }], 'me', 'themes');
  assert.equal(answered(f, v), false);
  assert.deepEqual(progress([f], v), { n: 2, done: 1 });
  assert.deepEqual(addedCodes(f, v), [{ code: 'c', note: '' }]);
  const v2 = verdicts([{ id: '4', t: '4', coder: 'me', frame: 'themes', type: 'verify', unit: 'u', field: 'sq1::b', action: 'change', value: 'd' }], 'me', 'themes');
  for (const [k, x] of v2) v.set(k, { ...v.get(k), ...x, note: (v.get(k) || {}).note || '' });
  assert.equal(answered(f, v), true);
  assert.equal(v.get('u|sq1::b').value, 'd');
  assert.equal(v.get('u|sq1::b').note, 'hm');
});

test('verdicts: clear takes back a change and its code; another coder\'s checks never count', () => {
  const v = verdicts([
    { id: '1', t: '1', coder: 'me', frame: 'themes', type: 'verify', unit: 'u', field: 'sq1::a', action: 'change', value: 'z' },
    { id: '2', t: '2', coder: 'me', frame: 'themes', type: 'verify', unit: 'u', field: 'sq1::a', action: 'clear', value: 'a' },
    { id: '3', t: '3', coder: 'them', frame: 'themes', type: 'verify', unit: 'u', field: 'sq1::a', action: 'agree', value: 'a' }], 'me', 'themes');
  assert.deepEqual(v.get('u|sq1::a'), { action: null, value: null, note: '' });
});
