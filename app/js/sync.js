// Autosave and sync. Every event is written to this browser first (the outbox), then pushed to
// work/<handle>/<doc>.json on GitHub. A failed push leaves the event in the outbox and retries.
// The outbox in localStorage is the single source of truth, so two tabs on one device share it
// and neither can overwrite the other's events. Memory is used only when storage is unavailable.

import { mergeEvents } from './events.js';

export class Sync {
  /** status callback receives {state:'saved'|'syncing'|'offline'|'error', pending:n, message} */
  constructor(store, handle, onStatus, { debounce = 1200, backoff = [4000, 10000, 30000, 60000], storage } = {}) {
    this.store = store;
    this.handle = handle;
    this.onStatus = onStatus || (() => {});
    this.debounce = debounce;
    this.backoff = backoff;
    this.storage = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.key = `rc:${store.repo}:${handle}:outbox`;
    this.mem = {}; // used only when storage fails
    this.timer = null;
    this.running = false;
    this.again = false;
    this.fails = 0;
    this.listeners = [];
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.flushSoon(0));
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.pending() && this.flushSoon(0));
      window.addEventListener('beforeunload', (e) => { if (this.pending()) { e.preventDefault(); e.returnValue = ''; } });
    }
    this._status();
    if (this.pending()) this.flushSoon(500);
  }

  /** {doc: [events]} as stored now. */
  get outbox() { return this._load(); }
  _load() {
    if (!this.storage) return this.mem;
    try { return JSON.parse(this.storage.getItem(this.key) || '{}'); } catch { return this.mem; }
  }
  _save(o) {
    for (const d of Object.keys(o)) if (!o[d] || !o[d].length) delete o[d];
    this.mem = o;
    if (!this.storage) return;
    try { this.storage.setItem(this.key, JSON.stringify(o)); } catch {
      // storage full or blocked: carry on in memory for this session, and say so
      this.storage = null;
      this.storageLost = true;
    }
  }
  pending() { return Object.values(this._load()).reduce((s, l) => s + l.length, 0); }
  pendingEvents(doc) { return this._load()[doc] || []; }
  _status(state, message) {
    const p = this.pending();
    const warn = this.storageLost && p ? 'This browser would not save your changes on this device. Keep this tab open until they reach GitHub.' : '';
    this.onStatus({ state: state || (p ? 'syncing' : 'saved'), pending: p, message: message || warn });
  }

  add(doc, event) {
    const o = this._load(); // re-read: another tab may have added events since
    (o[doc] ||= []).push(event);
    this._save(o); // saved on this device before anything else happens
    this._status('syncing');
    this.flushSoon(this.debounce);
  }

  flushSoon(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
  }

  async flush() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.again = false;
    let err = null;
    try {
      // each document on its own, so one failing file cannot hold back the rest
      for (const doc of Object.keys(this._load())) {
        try { await this._pushDoc(doc); } catch (e) { err ||= e; }
      }
    } finally {
      this.running = false;
    }
    if (err) {
      const wait = this.backoff[Math.min(this.fails++, this.backoff.length - 1)];
      const offline = err.status === 0 || err.status >= 500 || err.status === 429;
      const msg = this.store.service ? (err.status === 401 ? 'Your sign-in has ended. Your changes stay on this device. Sign out, then sign in again, and they will sync.'
        : err.status === 403 ? `The review site refused the save: ${err.message} Your changes stay on this device.` : err.message)
        : err.status === 401 ? 'GitHub refused the token. It may have expired: sign out and sign in with a new one. Your changes stay on this device.'
        : err.status === 403 ? 'GitHub refused the write. Check the token has Contents: read and write on this repo.' : err.message;
      this._status(offline ? 'offline' : 'error', msg);
      this.flushSoon(wait);
      return;
    }
    this.fails = 0;
    if (this.again || this.pending()) { this._status('syncing'); this.flushSoon(0); return; } // events added while pushing
    this._status('saved');
    this.listeners.forEach((f) => f());
  }

  async _pushDoc(doc) {
    const path = `work/${this.handle}/${doc}.json`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const batch = (this._load()[doc] || []).slice();
      if (!batch.length) return;
      const remote = await this.store.readFile(path);
      let events = [];
      if (remote) {
        // never write over a file that cannot be read: that would replace its events with ours
        let parsed;
        try { parsed = JSON.parse(remote.text); } catch { parsed = null; }
        if (!parsed || !Array.isArray(parsed.events)) throw Object.assign(new Error(`${path} on GitHub cannot be read, so nothing was written to it. Your changes stay on this device.`), { status: 'unreadable' });
        events = parsed.events;
      }
      const merged = mergeEvents(events, batch);
      try {
        await this.store.writeJSON(path, { schema: 1, coder: this.handle, doc, events: merged },
          { sha: remote ? remote.sha : undefined, message: `${this.handle}: ${batch.length} event(s) on ${doc}` });
      } catch (e) {
        if (e.status === 409 || e.status === 422) continue; // someone wrote first (another device): re-read and merge
        throw e;
      }
      const sent = new Set(batch.map((b) => b.id));
      const o = this._load(); // re-read: events added while the write was in flight stay
      if (o[doc]) o[doc] = o[doc].filter((x) => !sent.has(x.id));
      this._save(o);
      return;
    }
    throw Object.assign(new Error('Could not merge after 6 attempts'), { status: 409 });
  }
}
