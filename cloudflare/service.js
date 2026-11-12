// The sign-in service (a Cloudflare Worker, run as the Pages Functions of the site; PI, 24 October 2026).
// A coder signs in with a name and a password the PI allocates, and stays signed in on that device for 30 days. The
// service then passes on only the GitHub calls the app makes (who am I, the repo's default branch, list files, read a
// file, save a file), for the repos given to that coder, with a GitHub App's token that the coder never sees. It saves
// only into work/<that coder's handle>/, names the coder as the commit author (GitHub records the App as committer),
// never reads or saves a master, and locks a name after 5 wrong passwords in 15 minutes.
//
// A coder who forgets their password asks for a one-hour, one-use link by email (mail.js), to an address they have
// confirmed once; the reply never says whether a name or an email exists.
//
// The PI's page (/admin/, admin.js here) adds coders, makes new passwords, unlocks names, edits the welcome page and
// shows progress. Coders come from cloudflare/projects.json and from that page (KV coder:<name>); a password is the
// page's (KV pw:<name>) or else the setting PASSWORD_<NAME>.
//
// Settings (Cloudflare, never in a repo): SESSION_SECRET, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ADMIN_PASSWORD (the
// PI's first password, scrambled; the PI's own choice then lives in KV admin:pw), PASSWORD_<NAME> (optional), and the
// KV namespace bound as LOCKS. GITHUB_API is for the tests only. The project list is passed in by
// functions/api/[[path]].js.

import { appJwt } from './ghapp.js';
import { admin } from './admin.js';
import { welcome } from './welcome.js';
import { mailReady, sendMail } from './mail.js';

export const SESSION_DAYS = 30;
export const ADMIN_HOURS = 12;
export const MAX_TRIES = 5;
export const LOCK_MINUTES = 15;
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SEG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MAX_SAVE = 4 * 1024 * 1024; // base64 characters in one save
const te = new TextEncoder();

export const json = (status, obj, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
export const refuse = (status, message) => json(status, { message });
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const lower = (s) => String(s || '').toLowerCase();

/** Same-length comparison that does not stop at the first difference. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** The request's JSON body, or null; only a JSON content type is read (a form from another site cannot send one). */
export async function body(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return null;
  try { const b = await request.json(); return b && typeof b === 'object' ? b : null; } catch { return null; }
}

// ---- the project list, and coders added on the PI's page ----

/** Every master named anywhere in the list, switched on or not, lower case. A master is never read or saved here. */
export function masters(projects) {
  return new Set(Object.values(projects.projects || {}).flatMap((p) => p.masters || []).map(lower));
}

/** A coder's entry for one project: the list's, else the PI's page's (page = KV coder:<name>). */
function entryFor(p, id, name, page) {
  const f = (p.coders || {})[name];
  if (f) return { handle: f.handle, repo: f.repo, from: 'list' };
  if (page && page.projects && page.projects[id]) return { handle: page.handle, repo: page.projects[id], from: 'page' };
  return null;
}

/** The coder's switched-on projects, each with the one repo given to them there. An entry that names a master, or a
 *  repo that is not owner/name, is left out. */
export function coderProjects(projects, name, page = null) {
  const never = masters(projects);
  const out = [];
  for (const [id, p] of Object.entries(projects.projects || {})) {
    if (p.enabled !== true) continue;
    const c = entryFor(p, id, name, page);
    if (!c || !REPO_RE.test(c.repo || '') || never.has(lower(c.repo)) || !NAME_RE.test(lower(c.handle || ''))) continue;
    out.push({ id, title: p.title || id, path: `/${id}/`, repo: c.repo, handle: lower(c.handle) });
  }
  return out;
}

export const pageCoder = async (env, name) => (NAME_RE.test(name) ? env.LOCKS.get(`coder:${name}`, 'json') : null);

/** The coder: one handle across their projects (it names their work folder and the commit author). */
export async function coderOf(env, projects, name) {
  const page = await pageCoder(env, name);
  const ps = coderProjects(projects, name, page);
  if (!ps.length) return null;
  if (new Set(ps.map((p) => p.handle)).size !== 1) return null; // one person, one handle: two are refused, not guessed
  const f = Object.values(projects.projects).map((p) => (p.coders || {})[name]).find(Boolean) || {};
  const handle = ps[0].handle;
  return {
    name, handle, display: f.display || (page && page.display) || handle,
    email: f.email || (page && page.author_email) || `${handle}@users.noreply.github.com`,
    projects: ps,
  };
}

// ---- passwords ----

/** The scrambled form: pbkdf2-sha256$<rounds>$<salt>$<hash>, salt and hash base64url. */
export async function scramble(password, { rounds = 10000, salt } = {}) {
  salt ||= crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
  return `pbkdf2-sha256$${rounds}$${b64u(salt)}$${b64u(bits)}`;
}

export async function passwordMatches(password, stored) {
  const m = /^pbkdf2-sha256\$(\d{4,6})\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{43})$/.exec(String(stored || '').trim());
  if (!m) return false;
  const again = await scramble(password, { rounds: Number(m[1]), salt: unb64u(m[2]) });
  return same(te.encode(again), te.encode(m[0]));
}

/** A new password: four groups of four letters and digits that cannot be mistaken for each other (about 79 bits). */
export function newPassword() {
  const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(16));
  return [0, 4, 8, 12].map((i) => [...r.slice(i, i + 4)].map((x) => ABC[x % ABC.length]).join('')).join('-');
}

const passwordVar = (name) => 'PASSWORD_' + name.toUpperCase().replace(/-/g, '_');
/** The coder's stored password: the PI's page's, else the setting. */
export const storedPassword = async (env, name) => (await env.LOCKS.get(`pw:${name}`)) || env[passwordVar(name)] || null;
/** The PI's stored password: the one the PI chose on the page, else the first one set in the settings. */
export const adminPassword = async (env) => (await env.LOCKS.get('admin:pw')) || env.ADMIN_PASSWORD || null;
// a made-up stored form, checked against when a name has no password, so a wrong name takes as long as a wrong password
const NOBODY = 'pbkdf2-sha256$10000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ---- sessions: name, role, expiry and a fingerprint of the stored password, signed with SESSION_SECRET ----

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(text)));
}
const fingerprint = async (stored) => hex(await crypto.subtle.digest('SHA-256', te.encode(String(stored).trim()))).slice(0, 16);

/** A signed session. role 'a' is the PI's page; a coder's session has no role. */
export async function makeSession(env, name, stored, now, { role, ms = SESSION_DAYS * 86400e3 } = {}) {
  const body = b64u(te.encode(JSON.stringify({ n: name, ...(role ? { r: role } : {}), exp: now + ms, pv: await fingerprint(stored) })));
  return { token: `rcs.${body}.${b64u(await hmac(env.SESSION_SECRET, body))}`, expires: new Date(now + ms).toISOString() };
}

/** The session a request carries, checked: signature, expiry and the password it was made with. Or null. */
export async function readSession(request, env, now) {
  const m = /^Bearer rcs\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  if (!same(te.encode(b64u(await hmac(env.SESSION_SECRET, m[1]))), te.encode(m[2]))) return null;
  let s;
  try { s = JSON.parse(new TextDecoder().decode(unb64u(m[1]))); } catch { return null; }
  if (!s || typeof s.exp !== 'number' || s.exp <= now || typeof s.n !== 'string') return null;
  const stored = s.r === 'a' ? await adminPassword(env) : NAME_RE.test(s.n) ? await storedPassword(env, s.n) : null;
  if (!stored || s.pv !== await fingerprint(stored)) return null;
  return s;
}

/** The coder a request's session names, or null. A changed password, an expired session or a coder no longer
 *  listed all end the session. The PI's session is not a coder's. */
async function sessionCoder(request, env, projects, now) {
  const s = await readSession(request, env, now);
  if (!s || s.r || !NAME_RE.test(s.n)) return null;
  const c = await coderOf(env, projects, s.n);
  return c ? { ...c, exp: s.exp } : null;
}

// ---- the lock: 5 wrong tries in 15 minutes locks the name for 15 minutes (KV, bound as LOCKS) ----

export async function lockedUntil(env, name, now) {
  const l = await env.LOCKS.get(`lock:${name}`, 'json');
  return l && l.until > now ? l.until : 0;
}
export async function wrongTry(env, name, now) {
  const f = (await env.LOCKS.get(`fails:${name}`, 'json')) || null;
  const win = LOCK_MINUTES * 60e3;
  const cur = f && now - f.first < win ? { n: f.n + 1, first: f.first } : { n: 1, first: now };
  const exp = (t) => Math.max(Math.ceil(t / 1000), Math.ceil(now / 1000) + 60); // KV keeps a key at least 60 s
  if (cur.n >= MAX_TRIES) {
    await env.LOCKS.put(`lock:${name}`, JSON.stringify({ until: now + win }), { expiration: exp(now + win) });
    await env.LOCKS.delete(`fails:${name}`);
    return true;
  }
  await env.LOCKS.put(`fails:${name}`, JSON.stringify(cur), { expiration: exp(cur.first + win) });
  return false;
}
export async function clearTries(env, name) {
  if (await env.LOCKS.get(`fails:${name}`)) await env.LOCKS.delete(`fails:${name}`);
}
export async function unlock(env, name) {
  await env.LOCKS.delete(`lock:${name}`);
  await env.LOCKS.delete(`fails:${name}`);
}

export const LOCKED = `Too many wrong passwords. This name is locked for ${LOCK_MINUTES} minutes. Try again later, or ask the project lead.`;
export const WRONG = 'Name or password not recognised.';

async function login(request, env, projects, now) {
  const b = await body(request);
  if (!b) return refuse(415, 'Send JSON.');
  const name = lower(b.name).trim();
  const password = String(b.password || '');
  if (!NAME_RE.test(name) || !password || password.length > 200) return refuse(401, WRONG);
  if (await lockedUntil(env, name, now)) return refuse(429, LOCKED);
  const stored = await storedPassword(env, name);
  const c = stored ? await coderOf(env, projects, name) : null;
  const ok = await passwordMatches(password, stored || NOBODY);
  if (!ok || !c) {
    try { if (await wrongTry(env, name, now)) return refuse(429, LOCKED); } catch {} // a failed count still refuses
    return refuse(401, WRONG);
  }
  try { await clearTries(env, name); } catch {}
  const s = await makeSession(env, name, stored, now);
  return json(200, { ...s, name, handle: c.handle, projects: c.projects.map(({ id, title, path, repo }) => ({ id, title, path, repo })) });
}

// ---- forgotten passwords: a one-hour, one-use link by email ----

export const RESET_MINUTES = 60;
const RESETS_PER_HOUR = 3;
const SENT = 'If that name has a confirmed email address, a link to set a new password is on its way. It works for one hour.';
const sha = async (t) => hex(await crypto.subtle.digest('SHA-256', te.encode(t)));

async function forgot(request, env, projects, url, now, ctx) {
  const b = await body(request);
  if (!b) return refuse(415, 'Send JSON.');
  if (!mailReady(env)) return json(200, { message: 'Ask the project lead for a new password.', mail: false });
  const name = lower(b.name).trim();
  const reply = json(200, { message: SENT, mail: true });
  if (!NAME_RE.test(name)) return reply;
  // at most 3 links an hour for a name, whoever asks
  const k = `resets:${name}`;
  const c = (await env.LOCKS.get(k, 'json')) || { n: 0, first: now };
  if (now - c.first >= 3600e3) { c.n = 0; c.first = now; }
  if (c.n >= RESETS_PER_HOUR) return reply;
  await env.LOCKS.put(k, JSON.stringify({ n: c.n + 1, first: c.first }), { expiration: Math.max(Math.ceil((c.first + 3600e3) / 1000), Math.ceil(now / 1000) + 60) });
  const page = await pageCoder(env, name);
  const to = page && page.contact;
  if (!to || !(await coderOf(env, projects, name))) return reply;
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.LOCKS.put(`reset:${await sha(token)}`, JSON.stringify({ n: name, exp: now + RESET_MINUTES * 60e3 }), { expirationTtl: RESET_MINUTES * 60 });
  const link = `${url.origin}/signin/?reset=${token}`;
  const sending = sendMail(env, projects, {
    to, subject: 'Set a new password for the review platform',
    text: `Hello,\n\nSomeone asked to set a new password for the name "${name}" on the review platform. To choose a new password, open this link within one hour:\n\n${link}\n\nThe link works once. If you did not ask for this, ignore this email: your password stays as it is.\n`,
  }, now);
  // Cloudflare's mail service can take several seconds: reply at once and send in the background where we can
  if (ctx && ctx.waitUntil) ctx.waitUntil(sending); else await sending;
  return reply;
}

async function reset(request, env, projects, now) {
  const b = await body(request);
  if (!b) return refuse(415, 'Send JSON.');
  const token = String(b.token || '');
  const password = String(b.password || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return refuse(400, 'This link is not right. Ask for a new one.');
  const key = `reset:${await sha(token)}`;
  const r = await env.LOCKS.get(key, 'json');
  if (!r || !(r.exp > now) || !NAME_RE.test(r.n || '')) return refuse(400, 'This link has expired or has been used. Ask for a new one.');
  if (password.length < 12 || password.length > 200) return refuse(400, 'Use at least 12 characters.');
  const c = await coderOf(env, projects, r.n);
  if (!c) return refuse(400, 'This link has expired or has been used. Ask for a new one.');
  await env.LOCKS.delete(key);
  const stored = await scramble(password);
  await env.LOCKS.put(`pw:${r.n}`, stored); // the old password and its sessions end
  await unlock(env, r.n);
  const s = await makeSession(env, r.n, stored, now);
  return json(200, { ...s, name: r.n, handle: c.handle, projects: c.projects.map(({ id, title, path, repo }) => ({ id, title, path, repo })) });
}

// ---- GitHub, through the App ----

const tokens = new Map(); // repo (lower case) -> {token, until}: an installation token for that one repo
const branches = new Map(); // repo -> default branch

export async function gh(env, path, { method = 'GET', token, accept, body } = {}) {
  return fetch((env.GITHUB_API || 'https://api.github.com') + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'review-coder-signin', ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** A token for one repo, with contents read and write and nothing else. Null when the App is not installed there.
 *  Never asked for a master. */
export async function repoToken(env, projects, repo, now) {
  if (masters(projects).has(lower(repo))) return null;
  const k = lower(repo);
  const t = tokens.get(k);
  if (t && t.until > now + 5 * 60e3) return t.token;
  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, now);
  const inst = await gh(env, `/repos/${repo}/installation`, { token: jwt });
  if (inst.status === 404) return null;
  if (!inst.ok) throw Object.assign(new Error(`GitHub App: ${inst.status}`), { status: 502 });
  const { id } = await inst.json();
  const r = await gh(env, `/app/installations/${id}/access_tokens`, { method: 'POST', token: jwt, body: { repositories: [repo.split('/')[1]], permissions: { contents: 'write', metadata: 'read' } } });
  if (!r.ok) throw Object.assign(new Error(`GitHub App token: ${r.status}`), { status: 502 });
  const j = await r.json();
  tokens.set(k, { token: j.token, until: Date.parse(j.expires_at) || now + 50 * 60e3 });
  return j.token;
}

async function defaultBranch(env, repo, token) {
  const k = lower(repo);
  if (branches.has(k)) return branches.get(k);
  const r = await gh(env, `/repos/${repo}`, { token });
  if (!r.ok) return null;
  const b = (await r.json()).default_branch || 'main';
  branches.set(k, b);
  return b;
}

/** Pass GitHub's answer back: its status and body, and only the content type. */
const passBack = (r, extra = {}) => new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store', ...extra } });

/** Decoded path segments, or null if any is empty, a dot name or not plain. */
function segments(raw) {
  const out = [];
  for (const s of raw.split('/')) {
    let d;
    try { d = decodeURIComponent(s); } catch { return null; }
    if (!SEG_RE.test(d) || d === '.' || d === '..') return null;
    out.push(d);
  }
  return out;
}

async function github(request, env, projects, coder, rest, url, now) {
  const method = request.method;
  if (rest === '/user' && method === 'GET') return json(200, { login: coder.handle, name: coder.display });
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(rest);
  if (!m) return refuse(404, 'Not available through the sign-in service.');
  const repo = `${m[1]}/${m[2]}`;
  const tail = m[3] || '';
  if (masters(projects).has(lower(repo))) return refuse(403, 'This is a master repository. The sign-in service never reads or saves it.');
  const mine = coder.projects.find((p) => lower(p.repo) === lower(repo));
  if (!mine) return refuse(404, 'Repository not found, or not one of your projects.');
  const repoName = mine.repo; // as the list spells it
  const token = await repoToken(env, projects, repoName, now);
  if (!token) return refuse(403, `The saving App is not installed on ${repoName}. Ask the project lead.`);

  if (tail === '' && method === 'GET') {
    const b = await defaultBranch(env, repoName, token);
    return b ? json(200, { full_name: repoName, default_branch: b }) : refuse(502, 'GitHub did not answer.');
  }
  const tree = /^\/git\/trees\/([^/]+)$/.exec(tail);
  if (tree && method === 'GET') {
    return passBack(await gh(env, `/repos/${repoName}/git/trees/${encodeURIComponent(decodeURIComponent(tree[1]))}?recursive=1`, { token }));
  }
  const ct = /^\/contents\/(.+)$/.exec(tail);
  if (!ct) return refuse(404, 'Not available through the sign-in service.');
  const segs = segments(ct[1]);
  if (!segs) return refuse(400, 'That file name is not allowed.');
  const enc = segs.map(encodeURIComponent).join('/');
  if (method === 'GET') {
    const ref = url.searchParams.get('ref');
    const accept = request.headers.get('Accept') === 'application/vnd.github.raw+json' ? 'application/vnd.github.raw+json' : 'application/vnd.github+json';
    return passBack(await gh(env, `/repos/${repoName}/contents/${enc}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, { token, accept }));
  }
  if (method !== 'PUT') return refuse(405, 'Not available through the sign-in service.');
  // a save: only into work/<handle>/, on the default branch, with the coder as author
  if (segs.length < 3 || segs[0] !== 'work' || segs[1] !== coder.handle || !segs[segs.length - 1].endsWith('.json')) {
    return refuse(403, `You can save only into work/${coder.handle}/.`);
  }
  let b;
  try { b = await request.json(); } catch { return refuse(400, 'Send JSON.'); }
  if (!b || typeof b.content !== 'string' || b.content.length > MAX_SAVE || !/^[A-Za-z0-9+/=\s]*$/.test(b.content)) return refuse(400, 'The file to save is missing or too big.');
  const branch = await defaultBranch(env, repoName, token);
  if (!branch) return refuse(502, 'GitHub did not answer.');
  if (b.branch && b.branch !== branch) return refuse(403, `Saves go to ${branch} only.`);
  const put = {
    message: String(b.message || `Update ${segs.join('/')}`).slice(0, 300),
    content: b.content.replace(/\s/g, ''),
    branch,
    author: { name: coder.display, email: coder.email },
    ...(typeof b.sha === 'string' && /^[0-9a-f]{40}$/.test(b.sha) ? { sha: b.sha } : {}),
  };
  return passBack(await gh(env, `/repos/${repoName}/contents/${enc}`, { method: 'PUT', token, body: put }));
}

// ---- the entry point ----

/** What the service needs: the base (sessions and the lock store) and the App (for GitHub). Without them it lets no
 *  one in. */
const base = (env) => !!(env.SESSION_SECRET && String(env.SESSION_SECRET).length >= 32 && env.LOCKS);
const appReady = (env) => !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
const NOT_SET_UP = 'The sign-in service is not set up yet. Tell the project lead.';

export async function handle(request, env, projects, now = Date.now(), ctx = null) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return refuse(403, 'Requests come from the review site only.');
  try {
    if (url.pathname === '/api/welcome') return await welcome(request, env, projects);
    if (!base(env)) return refuse(503, NOT_SET_UP);
    if (url.pathname.startsWith('/api/admin/')) return await admin(request, env, projects, url, now, { appReady: appReady(env) });
    if (url.pathname === '/api/login') return request.method === 'POST' ? await login(request, env, projects, now) : refuse(405, 'Use POST.');
    if (url.pathname === '/api/forgot') return request.method === 'POST' ? await forgot(request, env, projects, url, now, ctx) : refuse(405, 'Use POST.');
    if (url.pathname === '/api/reset') return request.method === 'POST' ? await reset(request, env, projects, now) : refuse(405, 'Use POST.');
    const coder = await sessionCoder(request, env, projects, now);
    if (url.pathname === '/api/me' && request.method === 'GET') {
      return coder ? json(200, { name: coder.name, handle: coder.handle, expires: new Date(coder.exp).toISOString(), projects: coder.projects.map(({ id, title, path, repo }) => ({ id, title, path, repo })) }) : refuse(401, 'Your sign-in has ended. Sign in again.');
    }
    if (url.pathname.startsWith('/api/gh/')) {
      if (!coder) return refuse(401, 'Your sign-in has ended. Sign in again.');
      if (!appReady(env)) return refuse(503, NOT_SET_UP);
      return await github(request, env, projects, coder, url.pathname.slice('/api/gh'.length), url, now);
    }
    return refuse(404, 'Not found.');
  } catch (e) {
    return refuse(e.status || 500, e.status ? e.message : 'The sign-in service hit an error.');
  }
}

// for the tests: forget cached App tokens and branches
export function _reset() { tokens.clear(); branches.clear(); }
