// Storage back ends. GitHubStore talks to the GitHub Contents API with the coder's own token.
// StaticStore serves the invented demo project and keeps writes in the browser only.

export class HttpError extends Error {
  constructor(status, msg) {
    super(msg || String(status));
    this.status = status;
  }
}

const enc = (s) => {
  let x = '';
  for (const c of new TextEncoder().encode(s)) x += String.fromCharCode(c);
  return btoa(x);
};
const dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class GitHubStore {
  /** service: true when api is the Cloudflare sign-in service (signin.js), with a session in place of a token. */
  constructor({ repo, token, api, service }) {
    this.repo = repo;
    this.service = !!service;
    this.token = token;
    this.api = api || 'https://api.github.com';
    this.branch = null;
    this.paths = new Set();
    this.demo = false;
  }

  async req(method, path, { body, raw } = {}) {
    let res;
    try {
      res = await fetch(this.api + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new HttpError(0, 'Network unavailable');
    }
    if (!res.ok) {
      let m = '';
      try { m = (await res.json()).message; } catch {}
      throw new HttpError(res.status, m || res.statusText);
    }
    return res;
  }

  async user() {
    return (await this.req('GET', '/user')).json();
  }

  async init() {
    const info = await (await this.req('GET', `/repos/${this.repo}`)).json();
    this.branch = info.default_branch || 'main';
    await this.refreshTree();
    return info;
  }

  async refreshTree() {
    const t = await (await this.req('GET', `/repos/${this.repo}/git/trees/${this.branch}?recursive=1`)).json();
    this.paths = new Set((t.tree || []).filter((x) => x.type === 'blob').map((x) => x.path));
  }

  has(path) { return this.paths.has(path); }
  list(prefix) { return [...this.paths].filter((p) => p.startsWith(prefix)); }

  async readText(path) {
    return (await this.req('GET', `/repos/${this.repo}/contents/${encPath(path)}?ref=${this.branch}`, { raw: true })).text();
  }
  async readJSON(path) { return JSON.parse(await this.readText(path)); }
  async readBlob(path) {
    return (await this.req('GET', `/repos/${this.repo}/contents/${encPath(path)}?ref=${this.branch}`, { raw: true })).blob();
  }

  /** {text, sha} or null when the file does not exist. */
  async readFile(path) {
    try {
      const j = await (await this.req('GET', `/repos/${this.repo}/contents/${encPath(path)}?ref=${this.branch}`)).json();
      // over 1 MB GitHub sends no content (encoding "none"): fetch the raw file. If it changed in
      // between, the write with this sha fails with 409 and the caller re-reads.
      if (j.encoding !== 'base64') return { text: await this.readText(path), sha: j.sha };
      return { text: dec(j.content || ''), sha: j.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** Create (no sha) or update (sha). Throws HttpError 409/422 when the sha is stale or the file already exists. */
  async writeJSON(path, obj, { sha, message } = {}) {
    const body = { message: message || `Update ${path}`, content: enc(JSON.stringify(obj, null, 1) + '\n'), branch: this.branch };
    if (sha) body.sha = sha;
    const j = await (await this.req('PUT', `/repos/${this.repo}/contents/${encPath(path)}`, { body })).json();
    this.paths.add(path);
    return j.content && j.content.sha;
  }
}

export class StaticStore {
  constructor(base = './demo/') {
    this.base = base;
    this.demo = true;
    this.repo = 'demo';
    this.paths = new Set();
    this.key = 'rc-demo:';
  }
  _get(p) { try { return localStorage.getItem(this.key + p); } catch { return null; } }
  _set(p, v) { try { localStorage.setItem(this.key + p, v); } catch {} }
  async user() { return { login: 'demo-coder' }; }
  async init() {
    const t = await (await fetch(this.base + 'tree.json')).json();
    this.paths = new Set(t);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this.key)) this.paths.add(k.slice(this.key.length));
      }
    } catch {}
    return {};
  }
  async refreshTree() {}
  has(p) { return this.paths.has(p); }
  list(prefix) { return [...this.paths].filter((p) => p.startsWith(prefix)); }
  async readText(p) {
    const o = this._get(p);
    if (o !== null) return o;
    const r = await fetch(this.base + p);
    if (!r.ok) throw new HttpError(r.status);
    return r.text();
  }
  async readJSON(p) { return JSON.parse(await this.readText(p)); }
  async readBlob() { throw new HttpError(404, 'The demo has no PDFs'); }
  async readFile(p) {
    try { return { text: await this.readText(p), sha: 'demo' }; } catch (e) { if (e.status === 404) return null; throw e; }
  }
  async writeJSON(p, obj, { sha } = {}) {
    if (!sha && this.paths.has(p) && this._get(p) !== null) throw new HttpError(422, 'sha wasn\'t supplied');
    this._set(p, JSON.stringify(obj, null, 1));
    this.paths.add(p);
    return 'demo';
  }
}
