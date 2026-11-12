// Per-review switches (review.json `features`) and the Markdown used for the orientation page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { feature, FEATURES, DEFAULT_OFF } from '../app/js/features.js';
import { mdToHtml } from '../app/js/ui.js';

test('a switch left out is on, so other reviews keep every part of the app', () => {
  for (const k of FEATURES) if (!DEFAULT_OFF.has(k)) assert.equal(feature(k, { id: 'capacity' }), true);
  assert.equal(feature('document_view', { features: {} }), true);
});

test('the themes views stay off unless the review turns them on and sets up a frame', () => {
  for (const k of ['themes_by_document', 'themes_by_code']) {
    assert.equal(feature(k, { id: 'greylit' }), false);
    assert.equal(feature(k, { features: { [k]: true } }), false); // switched on but no "themes" block
    assert.equal(feature(k, { features: { [k]: true }, themes: { frame: 'themes' } }), true);
    assert.equal(feature(k, { features: {}, themes: { frame: 'themes' } }), false);
  }
});

test('the grey literature review hides Verify by document and keeps the rest', () => {
  const greylit = { id: 'greylit', features: { document_view: false } };
  assert.equal(feature('document_view', greylit), false);
  assert.equal(feature('pdf', greylit), true);
  assert.equal(feature('screen', greylit), true);
});

test('orientation Markdown: quotes, rules, tables and bold render', () => {
  const html = mdToHtml('> "Liaising between primary and secondary care"\n\n---\n\n**Level: Individual.**\n\n| A | B |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<blockquote>"Liaising between/);
  assert.match(html, /<hr>/);
  assert.match(html, /<b>Level: Individual.<\/b>/);
  assert.match(html, /<td>1<\/td>/);
});

test('orientation Markdown: a fenced block keeps its lines', () => {
  const html = mdToHtml('```\nPassage\n ├─ Level\n └─ Function\n```\n\nAfter');
  assert.match(html, /<pre>Passage\n ├─ Level\n └─ Function<\/pre>/);
  assert.match(html, /<p>After<\/p>/);
});
