// The project lead's review switcher (app/js/reviews.js): links, the remembered list, and looking on GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedRepo, confFor, knownReviews, remember, forget, candidate, findReviews } from '../app/js/reviews.js';

const c = { repo: 'joebtay/cogimp-review-data', token: 't' };

test('a ?repo= link opens that review over the saved one', () => {
  assert.equal(confFor(c, '?repo=joebtay/greylit-review-data').repo, 'joebtay/greylit-review-data');
  assert.equal(confFor(c, '?repo=joebtay/greylit-review-data').token, 't');
  assert.equal(confFor(c, '').repo, c.repo);
  assert.equal(confFor(c, '?repo=not a repo').repo, c.repo);
  assert.equal(linkedRepo('?api=http://localhost:1&repo=a/b'), 'a/b');
});

test('the list keeps the open review first, and remembers titles', () => {
  let k = remember(c, 'joebtay/greylit-review-data', 'Grey literature review');
  k = remember(k, c.repo, 'Cognitive impairment');
  assert.deepEqual(knownReviews(k).map((r) => r.repo), [c.repo, 'joebtay/greylit-review-data']);
  assert.equal(knownReviews(k)[1].title, 'Grey literature review');
  assert.deepEqual(knownReviews({ repo: 'a/b', token: 't' }), [{ repo: 'a/b', title: 'a/b' }]);
});

test('removing a review hides it, never the one open now, and adding it again shows it', () => {
  let k = remember(c, 'joebtay/greylit-review-data', 'Grey');
  k = forget(k, 'joebtay/greylit-review-data');
  assert.equal(knownReviews(k).length, 1);
  assert.deepEqual(forget(k, c.repo), k);
  assert.equal(knownReviews(remember(k, 'joebtay/greylit-review-data', 'Grey')).length, 2);
});

test('only repos named for a review are checked, never the platform repos or team repos', () => {
  assert.ok(candidate('joebtay/greylit-review-data'));
  assert.ok(!candidate('joebtay/review-coder'));
  assert.ok(!candidate('joebtay/review-coder-app'));
  assert.ok(!candidate('joebtay/cogimp-team'));
});

test('looking on GitHub keeps the repos that hold a review.json, with their titles', async () => {
  const files = { 'joebtay/greylit-review-data': { title: 'Grey literature review' }, 'joebtay/cogimp-review-data': { title: 'Cognitive' } };
  const fake = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/user/repos') return { ok: true, json: async () => ['joebtay/greylit-review-data', 'joebtay/cogimp-review-data', 'joebtay/old-review-notes', 'joebtay/review-coder', 'joebtay/cogimp-team'].map((full_name) => ({ full_name })) };
    const m = /^\/repos\/([^/]+\/[^/]+)\/contents\/review\.json$/.exec(u.pathname);
    if (m && files[m[1]]) return { ok: true, text: async () => JSON.stringify(files[m[1]]) };
    return { ok: false, status: 404 };
  };
  const found = await findReviews({ token: 't', api: 'http://x' }, fake);
  assert.deepEqual(found.map((r) => r.repo).sort(), ['joebtay/cogimp-review-data', 'joebtay/greylit-review-data']);
  assert.equal(found.find((r) => r.repo === 'joebtay/greylit-review-data').title, 'Grey literature review');
  await assert.rejects(findReviews({ token: 't', api: 'http://x' }, async () => ({ ok: false, status: 401 })));
});
