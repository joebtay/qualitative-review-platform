// Sync and event-order tests. Each test names the failure path it guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Sync } from '../app/js/sync.js';
import { nextTime, makeEvent, verifyState, mergeEvents } from '../app/js/events.js';
import { GitHubStore } from '../app/js/store.js';
import { startMock } from './mock-github.mjs';

const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// In-memory stand-in for GitHubStore: files {path: {text, sha}}, with sha checks like the Contents API.
function fakeStore() {
  let n = 0;
  const files = new Map();
  const st = {
    repo: 'o/r', files, gate: null, writes: 0, onWrite: null,
    async readFile(p) { const f = files.get(p); return f ? { ...f } : null; },
    async writeJSON(p, obj, { sha } = {}) {
      if (st.gate) await st.gate;
      if (st.onWrite) { const f = st.onWrite; st.onWrite = null; await f(); }
      const cur = files.get(p);
      if (cur && !sha) throw Object.assign(new Error('sha missing'), { status: 422 });
      if (cur && cur.sha !== sha) throw Object.assign(new Error('stale'), { status: 409 });
      files.set(p, { text: JSON.stringify(obj), sha: 's' + ++n });
      st.writes++;
    },
  };
  return st;
}
const ev = (id, t = '2026-10-10T10:00:00.000Z') => ({ id, t, coder: 'joe', type: 'verify' });
const ids = (store, p) => JSON.parse(store.files.get(p).text).events.map((e) => e.id).sort();
const quiet = (s) => { clearTimeout(s.timer); s.flushSoon = () => {}; };

test('two tabs on one device: neither overwrites the other\'s unsent events', async () => {
  const storage = memStorage(); const store = fakeStore();
  const a = new Sync(store, 'joe', null, { storage }); quiet(a);
  const b = new Sync(store, 'joe', null, { storage }); quiet(b); // opened before tab A saved anything
  a.add('D1', ev('e1'));
  b.add('D1', ev('e2'));
  a.add('D1', ev('e3'));
  assert.deepEqual(JSON.parse(storage.getItem('rc:o/r:joe:outbox')).D1.map((e) => e.id), ['e1', 'e2', 'e3']);
  await a.flush();
  assert.deepEqual(ids(store, 'work/joe/D1.json'), ['e1', 'e2', 'e3']);
  assert.equal(a.pending(), 0);
  assert.equal(b.pending(), 0); // tab B sees the shared outbox, so it does not push again
});

test('an event added while a push is in flight is pushed, and the pill does not say saved early', async () => {
  const store = fakeStore(); const states = [];
  const s = new Sync(store, 'joe', (x) => states.push(x.state), { storage: memStorage(), debounce: 5 });
  let open; store.gate = new Promise((r) => (open = r));
  s.add('D1', ev('e1'));
  const first = s.flush();
  await new Promise((r) => setTimeout(r, 0));
  s.add('D1', ev('e2'));
  await s.flush(); // returns at once: a push is running
  open(); store.gate = null;
  await first;
  assert.notEqual(states[states.length - 1], 'saved');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(ids(store, 'work/joe/D1.json'), ['e1', 'e2']);
  assert.equal(s.pending(), 0);
  assert.equal(states[states.length - 1], 'saved');
  quiet(s);
});

test('a file on GitHub that cannot be read is never written over, and other documents still sync', async () => {
  const store = fakeStore(); let last;
  store.files.set('work/joe/D1.json', { text: '', sha: 'x1' }); // what GitHub's JSON read gives for a file over 1 MB
  store.files.set('work/joe/D2.json', { text: '{"events":[', sha: 'x2' }); // truncated
  const s = new Sync(store, 'joe', (x) => (last = x), { storage: memStorage() }); quiet(s);
  s.add('D1', ev('e1')); s.add('D2', ev('e2')); s.add('D3', ev('e3'));
  await s.flush();
  assert.equal(store.files.get('work/joe/D1.json').text, '');
  assert.equal(store.files.get('work/joe/D2.json').text, '{"events":[');
  assert.deepEqual(ids(store, 'work/joe/D3.json'), ['e3']); // not held back by D1 and D2
  assert.deepEqual(s.pendingEvents('D1').map((e) => e.id), ['e1']);
  assert.deepEqual(s.pendingEvents('D2').map((e) => e.id), ['e2']);
  assert.equal(last.state, 'error');
  assert.match(last.message, /cannot be read/);
});

test('409 from another device: re-read, merge, keep both sides', async () => {
  const store = fakeStore();
  store.files.set('work/joe/D1.json', { text: JSON.stringify({ events: [ev('r1')] }), sha: 'a' });
  store.onWrite = async () => store.files.set('work/joe/D1.json', { text: JSON.stringify({ events: [ev('r1'), ev('r2')] }), sha: 'b' });
  const s = new Sync(store, 'joe', null, { storage: memStorage() }); quiet(s);
  s.add('D1', ev('e1'));
  await s.flush();
  assert.deepEqual(ids(store, 'work/joe/D1.json'), ['e1', 'r1', 'r2']);
  assert.equal(s.pending(), 0);
});

test('a slow or stepped-back clock cannot put a later correction before the earlier answer', () => {
  const k = { coder: 'joe', sample: 's', unit: 'u', frame: 'taxonomy' };
  // device A's clock runs 5 minutes fast; the coder answers there, then corrects on device B
  const a = { ...makeEvent('joe', 'verify', { ...k, field: 'level', action: 'agree' }), t: '2026-10-10T10:05:00.000Z' };
  const bNow = Date.parse('2026-10-10T10:01:00.000Z');
  const b = { id: 'b1', t: nextTime(a.t, bNow), coder: 'joe', type: 'verify', ...k, field: 'level', action: 'other', value: 'System' };
  assert.equal(verifyState(mergeEvents([a], [b]), k).level.action, 'other');
  assert.equal(nextTime(null, bNow), '2026-10-10T10:01:00.000Z');
  assert.equal(nextTime('2026-10-10T10:00:00.000Z', bNow), '2026-10-10T10:01:00.000Z'); // a clock ahead is left alone
  assert.equal(nextTime('2026-10-10T10:01:00.000Z', bNow), '2026-10-10T10:01:00.001Z'); // same millisecond
});

test('GitHubStore reads a work file over the 1 MB JSON limit through the raw route, so sync keeps its events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-big-'));
  fs.mkdirSync(path.join(dir, 'work/joe'), { recursive: true });
  const old = Array.from({ length: 40 }, (_, i) => ev('old' + i));
  fs.writeFileSync(path.join(dir, 'work/joe/D1.json'), JSON.stringify({ schema: 1, coder: 'joe', doc: 'D1', events: old }));
  const srv = await startMock(dir, 0, 'o/r');
  const api = `http://localhost:${srv.address().port}`;
  try {
    await fetch(api + '/__big?bytes=500');
    const store = new GitHubStore({ repo: 'o/r', token: 'joe-token', api });
    await store.init();
    const f = await store.readFile('work/joe/D1.json');
    assert.equal(JSON.parse(f.text).events.length, 40);
    const s = new Sync(store, 'joe', null, { storage: memStorage() }); quiet(s);
    s.add('D1', ev('new1', '2026-10-10T11:00:00.000Z'));
    await s.flush();
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'work/joe/D1.json'), 'utf8')).events;
    assert.equal(after.length, 41);
    assert.equal(s.pending(), 0);
  } finally { srv.close(); }
});
