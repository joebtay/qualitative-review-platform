// Frame settings and the layer that holds each frame (app/js/settings.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { layerOf, layerIds, frameSetting, unitLabel, newCodeFields, anyOrientation } from '../app/js/settings.js';

const review = {
  first_layer: 'master-v1.4', orientation: { file: 'orientation/v1.md', task: 'Old task' }, codebook: 'codebook/v1.7.md', codebook_version: 'v1.7',
  layers: [{ id: 'master-v1.4', frames: ['taxonomy', 'attributes'] }, { id: 'master-v2.0', frames: ['taxonomy-v2', 'attributes-v2'] }],
  frame_settings: { 'taxonomy-v2': { codebook: 'codebook/v2.0.1.md', codebook_version: 'v2.0.1', unit_label: 'thematic segment',
    orientation: { file: 'orientation/v2.md', task: 'New task' }, new_codes: { fields: ['statement_type', 'level', 'function_primary', 'form', 'nope'] } } },
};

test('each frame reads from the layer that holds it; the first layer wins when it holds the frame', () => {
  assert.equal(layerOf('taxonomy', review), 'master-v1.4');
  assert.equal(layerOf('taxonomy-v2', review), 'master-v2.0');
  assert.equal(layerOf('unknown', review), 'master-v1.4');
  assert.deepEqual(layerIds(review), ['master-v1.4', 'master-v2.0']);
});

test('a frame setting falls back to the review-wide setting', () => {
  assert.equal(frameSetting('taxonomy-v2', 'codebook', review), 'codebook/v2.0.1.md');
  assert.equal(frameSetting('taxonomy', 'codebook', review), 'codebook/v1.7.md');
  assert.equal(frameSetting('taxonomy-v2', 'orientation', review).task, 'New task');
  assert.equal(frameSetting('taxonomy', 'orientation', review).task, 'Old task');
  assert.equal(frameSetting(undefined, 'codebook_version', review), 'v1.7');
});

test('the unit label is the frame\'s, or "passage" when nothing is set', () => {
  assert.equal(unitLabel('taxonomy-v2', review), 'thematic segment');
  assert.equal(unitLabel('taxonomy', review), 'passage');
});

test('new codes take the frame setting, then the sample fields, then every field; unknown fields drop out', () => {
  const v2 = { id: 'taxonomy-v2', fields: ['statement_type', 'level', 'function_primary', 'form', 'gap_primary'].map((id) => ({ id })) };
  const v1 = { id: 'taxonomy', fields: ['level', 'function_primary', 'subcategory', 'gap_primary'].map((id) => ({ id })) };
  assert.deepEqual(newCodeFields(v2, null, review), ['statement_type', 'level', 'function_primary', 'form']);
  assert.deepEqual(newCodeFields(v1, { fields: ['level', 'function_primary', 'subcategory'] }, review), ['level', 'function_primary', 'subcategory']);
  assert.deepEqual(newCodeFields(v1, null, review), ['level', 'function_primary', 'subcategory', 'gap_primary']);
});

test('the header shows the orientation button when any frame has a page', () => {
  assert.equal(anyOrientation(review), true);
  assert.equal(anyOrientation({ frame_settings: { x: { orientation: { file: 'a.md' } } } }), true);
  assert.equal(anyOrientation({}), false);
});

// Codebook v2.0.2, PI ruling 28 (16 October 2026): a newer layer supersedes the one a locked sample names, and a
// frame setting adds the secondary form and the secondary checks without editing the frame file or the sample.
import { currentLayer, sameLayer, supersededIds, withExtraFields, verifyAddFields, confirmBlank } from '../app/js/settings.js';

const r2 = {
  first_layer: 'master-v1.4',
  layers: [{ id: 'master-v1.4', frames: ['taxonomy'] }, { id: 'master-v2.0', frames: [] }, { id: 'master-v2.0.1', frames: [] },
    { id: 'master-v2.0.2', frames: ['taxonomy-v2'], supersedes: 'master-v2.0.1' }],
  frame_settings: { 'taxonomy-v2': {
    extra_fields: [{ id: 'form_secondary', label: 'Secondary form', copy_values_from: 'form', depends_on: 'function_secondary' }],
    verify_add_fields: ['function_secondary', 'form_secondary'], confirm_blank: ['function_secondary', 'form_secondary'] } },
};

test('a layer that supersedes another replaces it for samples drawn on the older one', () => {
  assert.equal(layerOf('taxonomy-v2', r2), 'master-v2.0.2');
  assert.equal(currentLayer('master-v2.0.1', r2), 'master-v2.0.2');
  assert.equal(currentLayer('master-v2.0', r2), 'master-v2.0');
  assert.ok(sameLayer('master-v2.0.1', 'master-v2.0.2', r2));
  assert.ok(!sameLayer('master-v2.0', 'master-v2.0.2', r2));
  assert.ok(!sameLayer('master-v1.4', 'master-v2.0.2', r2));
  assert.deepEqual([...supersededIds(r2)], ['master-v2.0.1']);
  const loop = { layers: [{ id: 'a', supersedes: 'b' }, { id: 'b', supersedes: 'a' }] };
  assert.ok(['a', 'b'].includes(currentLayer('a', loop))); // a loop stops, never hangs
});

test('a frame setting adds a field that copies another field\'s values; the frame itself is unchanged', () => {
  const frame = { id: 'taxonomy-v2', fields: [{ id: 'function_secondary', values: [{ id: 'Continuity' }] }, { id: 'form', depends_on: 'function_primary', values: [{ id: 'Care coordination', parent: 'Continuity' }] }] };
  const f = withExtraFields(frame, r2);
  assert.deepEqual(f.fields.map((x) => x.id), ['function_secondary', 'form', 'form_secondary']);
  const fs = f.fields[2];
  assert.equal(fs.label, 'Secondary form'); assert.equal(fs.depends_on, 'function_secondary'); assert.equal(fs.required, false);
  assert.deepEqual(fs.values, [{ id: 'Care coordination', parent: 'Continuity' }]);
  assert.equal(frame.fields.length, 2);
  assert.equal(withExtraFields(f, r2).fields.length, 3); // added once only
  assert.equal(withExtraFields({ id: 'taxonomy', fields: [] }, r2).fields.length, 0);
  assert.deepEqual(verifyAddFields('taxonomy-v2', r2), ['function_secondary', 'form_secondary']);
  assert.deepEqual(verifyAddFields('taxonomy', r2), []);
  assert.ok(confirmBlank('taxonomy-v2', r2).has('form_secondary'));
});
