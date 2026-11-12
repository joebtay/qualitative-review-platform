// New codes and comments on selected text: live list, marks, export, blinding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passagesFor, passageSpans, passagesCSV, isCode } from '../app/js/passages.js';
import { hiddenUnits, visible, viewFor } from '../app/js/assign.js';

const p = (id, coder, extra = {}) => ({ id, coder, type: 'passage', doc: 'D1', page: '3', start: 10, end: 20, quote: 'some words', codes: { level: 'Service', function_primary: null, subcategory: null }, comment: null, t: '2026-10-10T00:00:00Z', ...extra });

test('a withdrawn passage drops out; only its own coder can withdraw it', () => {
  const evs = [p('a', 'joebtay'), p('b', 'xcoder'), { id: 'w1', type: 'passage-withdraw', coder: 'joebtay', passage: 'a' }, { id: 'w2', type: 'passage-withdraw', coder: 'joebtay', passage: 'b' }];
  assert.deepEqual(passagesFor(evs).map((x) => x.id), ['b']);
});

test('a comment has no codes; a new code has at least one', () => {
  assert.equal(isCode(p('a', 'x')), true);
  assert.equal(isCode(p('a', 'x', { codes: null, comment: 'hi' })), false);
  assert.equal(isCode(p('a', 'x', { codes: { level: null, function_primary: null, subcategory: null } })), false);
});

test('marks sit on the page with the same label', () => {
  const pages = [{ label: '1', text: '' }, { label: '3', text: 'xxxxxxxxxxsome wordsxxxx' }];
  const m = passageSpans([p('a', 'x'), p('b', 'x', { page: '99' })], pages);
  assert.deepEqual([...m.keys()], [1]);
  assert.deepEqual(m.get(1), [{ start: 10, end: 20, key: 'np:a' }]);
});

test('export lists words, page, codes, coder and comment, and quotes commas', () => {
  const csv = passagesCSV([p('a', 'joebtay', { quote: 'words, with "quotes"', comment: 'note', pdf_file: 'documents/D1.pdf', pdf_page: 3, sample: 's' })], () => 'Title');
  const [head, row] = csv.trim().split('\n');
  assert.equal(head, 'id,kind,doc,title,page,pdf_file,pdf_page,words,level,function_primary,subcategory,comment,coder,time,sample');
  assert.equal(row, 'a,new code,D1,Title,3,documents/D1.pdf,3,"words, with ""quotes""",Service,,,note,joebtay,2026-10-10T00:00:00Z,s');
});

test("another coder's passage on a blind sample stays hidden until everyone submits", () => {
  const sample = viewFor({ id: 's', coders: { joebtay: {}, xcoder: {} }, units: [{ doc: 'D1', unit: 'D1-C1', order: { joebtay: 1, xcoder: 1 } }] }, 'joebtay');
  const theirs = p('b', 'xcoder', { sample: 's' });
  const open = p('c', 'xcoder'); // no sample: not blind
  let hd = hiddenUnits([sample], []);
  assert.equal(visible(theirs, 'joebtay', hd), false);
  assert.equal(visible(open, 'joebtay', hd), true);
  assert.equal(visible(p('a', 'joebtay', { sample: 's' }), 'joebtay', hd), true);
  hd = hiddenUnits([sample], [{ type: 'submit', coder: 'joebtay', sample: 's' }, { type: 'submit', coder: 'xcoder', sample: 's' }]);
  assert.equal(visible(theirs, 'joebtay', hd), true);
});

test('a passage on a document in a blind sample is hidden even when another sample is in view', async () => {
  const { blindSamplesFor } = await import('../app/js/assign.js');
  const blind = viewFor({ id: 'task6a', coders: { joebtay: {}, xcoder: {} }, units: [{ doc: 'D1', unit: 'D1-C1', order: { joebtay: 1, xcoder: 1 } }] }, 'xcoder');
  const open = { id: 'taxonomy-s2', units: [{ doc: 'D1', unit: 'D1-C9' }] };
  const ids = blindSamplesFor([open, blind], 'D1', []).map((s) => s.id);
  assert.deepEqual(ids, ['task6a']);
  const theirs = p('b', 'joebtay', { sample: ids[0], samples: ids });
  assert.equal(visible(theirs, 'xcoder', hiddenUnits([open, blind], [])), false);
  assert.deepEqual(blindSamplesFor([open, blind], 'D2', []), []);
});

test('stale offsets are not marked; formula-like cells are defused', () => {
  const pages = [{ label: '3', text: 'xxxxxxxxxxsome wordsxxxx' }];
  assert.equal(passageSpans([p('a', 'x')], pages).get(0).length, 1);
  assert.equal(passageSpans([p('a', 'x', { quote: 'other' })], pages).size, 0);
  const row = passagesCSV([p('a', 'x', { quote: '-dash first', comment: '=SUM(1)' })]).trim().split('\n')[1];
  assert.ok(row.includes("'-dash first") && row.includes("'=SUM(1)"));
});

test('export columns follow the code fields the new codes carry (codebook v2.0.1 names)', () => {
  const v2 = p('a', 'x', { codes: { statement_type: 'Recommendation', level: 'System', function_primary: 'Prevention', form: null } });
  const [head, row] = passagesCSV([v2]).trim().split('\n');
  assert.equal(head, 'id,kind,doc,title,page,pdf_file,pdf_page,words,statement_type,level,function_primary,form,comment,coder,time,sample');
  assert.match(row, /,Recommendation,System,Prevention,,/);
});
