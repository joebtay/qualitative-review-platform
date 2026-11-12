// Open PDF: the right file and page for a page label, and the words to search for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfTarget, searchWords } from '../app/js/pdfloc.js';

const one = [{ file: 'documents/A.pdf', from: 1, to: null }];
const split = [{ file: 'documents/P_pt1.pdf', from: 1, to: 15 }, { file: 'documents/P_pt2.pdf', from: 16, to: null }];

test('a page label opens the PDF page the page text came from', () => {
  const pages = [{ n: 1, label: '15', file: 'documents/P_pt1.pdf' }, { n: 1, label: '16', file: 'documents/P_pt2.pdf' }, { n: 2, label: '17', file: 'documents/P_pt2.pdf' }];
  assert.deepEqual(pdfTarget(pages, split, '17'), { file: 'documents/P_pt2.pdf', page: 2 });
  assert.deepEqual(pdfTarget(pages, split, '16-17'), { file: 'documents/P_pt2.pdf', page: 1 }); // a range opens on its first page
});

test('without page text, printed ranges of the parts decide; p. and pp. are read', () => {
  assert.deepEqual(pdfTarget(null, split, '17'), { file: 'documents/P_pt2.pdf', page: 2 });
  assert.deepEqual(pdfTarget([], one, 'pp.7-8'), { file: 'documents/A.pdf', page: 7 });
  assert.deepEqual(pdfTarget([], one, ''), { file: 'documents/A.pdf', page: null });
});

test('search words: the first words of the first fragment, quotes removed', () => {
  assert.equal(searchWords('"Liaising between primary and secondary care to facilitate patients\u2019 access"'), 'Liaising between primary and secondary care to facilitate');
  assert.equal(searchWords('Stop sweeps ... Do not remove property', 8), 'Stop sweeps');
  assert.equal(searchWords("\u2018Do not remove residents' property\u2019"), "Do not remove residents' property"); // inner apostrophe kept
});
