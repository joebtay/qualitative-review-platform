// Assigned samples: per-coder view, order, fields, definitions and blinding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFor, frameFor, unblinded, hiddenUnits, visible, submitted, defaultSample } from '../app/js/assign.js';

const sample = {
  id: 'task6a-v1.4', frame: 'taxonomy', coders: { joebtay: { role: 'PI' }, xcoder: { role: 'Coder B' } },
  fields: ['level', 'function_primary', 'subcategory'], answers: 'workbook',
  definitions: { 'level|System': { definition: 'Across services.', source: 'Study definition' } },
  units: [
    { doc: 'A', unit: 'A-C1', slot: 'shared', order: { joebtay: 2, xcoder: 1 } },
    { doc: 'B', unit: 'B-C1', slot: 'PI only', order: { joebtay: 1 } },
    { doc: 'C', unit: 'C-C1', slot: 'Coder B only', order: { xcoder: 2 } },
  ],
};

test('each coder sees only their own items, in their own order', () => {
  assert.deepEqual(viewFor(sample, 'joebtay').units.map((u) => u.unit), ['B-C1', 'A-C1']);
  assert.deepEqual(viewFor(sample, 'xcoder').units.map((u) => u.unit), ['A-C1', 'C-C1']);
  const other = viewFor(sample, 'someone');
  assert.equal(other.units.length, 0);
  assert.equal(other.assigned, false);
  assert.equal(viewFor(sample, 'joebtay').all_units.length, 3);
});

test('a sample without coders is unchanged', () => {
  const s = { id: 'x', units: [{ doc: 'A', unit: 'A-C1' }] };
  assert.equal(viewFor(s, 'joebtay'), s);
});

test('the frame keeps only the sample fields and shows the sample definitions', () => {
  const frame = { id: 'taxonomy', fields: ['level', 'function_primary', 'subcategory', 'function_secondary', 'gap_primary'].map((id) => ({ id, values: [{ id: 'System', definition: 'frame wording' }] })) };
  const f = frameFor(frame, sample);
  assert.deepEqual(f.fields.map((x) => x.id), ['level', 'function_primary', 'subcategory']);
  assert.equal(f.fields[0].values[0].definition, 'Across services.');
  assert.equal(f.fields[0].values[0].source, 'Study definition');
  assert.equal(f.fields[1].values[0].definition, 'frame wording');
  assert.equal(f.answers, 'workbook');
  assert.equal(frame.fields[0].values[0].definition, 'frame wording'); // the frame itself is not changed
});

test('blind until every assigned coder submits; own work always visible', () => {
  const v = viewFor(sample, 'joebtay');
  const coderb = { id: 'z1', coder: 'xcoder', type: 'verify', sample: sample.id, unit: 'A-C1' };
  const coderbComment = { id: 'z2', coder: 'xcoder', type: 'comment', unit: 'A-C1', text: 'x' };
  const joe = { id: 'j1', coder: 'joebtay', type: 'verify', sample: sample.id, unit: 'A-C1' };
  const elsewhere = { id: 'z3', coder: 'xcoder', type: 'verify', unit: 'Z-C9' };
  const sub = (c) => ({ id: 's' + c, coder: c, type: 'submit', sample: sample.id });
  let evs = [];
  let hd = hiddenUnits([v], evs);
  assert.equal(visible(coderb, 'joebtay', hd), false);
  assert.equal(visible(coderbComment, 'joebtay', hd), false);
  assert.equal(visible(joe, 'joebtay', hd), true);
  assert.equal(visible(elsewhere, 'joebtay', hd), true);
  assert.ok(hd.has('C-C1')); // Coder B only units are hidden too, though the PI never sees them
  evs = [sub('joebtay')];
  assert.equal(unblinded(v, evs), false);
  assert.equal(visible(coderb, 'joebtay', hiddenUnits([v], evs)), false);
  evs = [sub('joebtay'), sub('xcoder')];
  assert.equal(unblinded(v, evs), true);
  assert.equal(visible(coderb, 'joebtay', hiddenUnits([v], evs)), true);
  assert.deepEqual([...submitted(evs, sample.id)].sort(), ['joebtay', 'xcoder']);
});

test('the default sample is the newest one with items for this coder', () => {
  const real = viewFor(sample, 'xcoder');
  const practice = viewFor({ id: 'practice-joebtay', coders: { joebtay: { role: 'PI' } }, units: [{ doc: 'D', unit: 'D-C1', order: { joebtay: 1 } }] }, 'xcoder');
  assert.equal(defaultSample([real, practice], undefined).id, 'task6a-v1.4'); // Coder B never lands on the PI's practice sample
  const piPractice = viewFor({ id: 'practice-joebtay', coders: { joebtay: { role: 'PI' } }, units: [{ doc: 'D', unit: 'D-C1', order: { joebtay: 1 } }] }, 'joebtay');
  assert.equal(defaultSample([viewFor(sample, 'joebtay'), piPractice], undefined).id, 'practice-joebtay');
  assert.equal(defaultSample([real, practice], 'practice-joebtay').id, 'practice-joebtay'); // a picked sample wins
  assert.equal(defaultSample([practice], undefined).id, 'practice-joebtay'); // nothing better: still opens
  assert.equal(defaultSample([], undefined), null);
});

test('frame settings add checks to a locked sample without editing it, and mark blank codes that need an answer', () => {
  const frame = { id: 'taxonomy-v2', fields: ['statement_type', 'level', 'function_primary', 'form', 'function_secondary', 'gap_primary', 'form_secondary'].map((id) => ({ id, values: [] })) };
  const locked = { id: 'r1', fields: ['statement_type', 'level', 'function_primary', 'form'], answers: 'workbook' };
  const before = JSON.stringify(locked);
  const f = frameFor(frame, locked, { addFields: ['function_secondary', 'form_secondary'], confirm: new Set(['function_secondary', 'form_secondary']) });
  assert.deepEqual(f.fields.map((x) => x.id), ['statement_type', 'level', 'function_primary', 'form', 'function_secondary', 'form_secondary']);
  assert.deepEqual(f.fields.filter((x) => x.confirm_blank).map((x) => x.id), ['function_secondary', 'form_secondary']);
  assert.equal(JSON.stringify(locked), before);
  assert.deepEqual(frameFor(frame, locked).fields.map((x) => x.id), ['statement_type', 'level', 'function_primary', 'form']); // no settings: as before
});
