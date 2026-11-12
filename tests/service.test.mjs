// The sign-in service (cloudflare/service.js) against a fake GitHub and a fake KV: passwords, the lock, sessions,
// which projects a coder sees, and what a save may do. Made-up coders and repos only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { handle, scramble, coderProjects, _reset, MAX_TRIES } from '../cloudflare/service.js';
import { checkWelcome } from '../cloudflare/welcome.js';
import { keyDer } from '../cloudflare/ghapp.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM1 = privateKey.export({ type: 'pkcs1', format: 'pem' }); // as GitHub gives it
const PEM8 = privateKey.export({ type: 'pkcs8', format: 'pem' });

const PROJECTS = {
  site: { mail_from: 'noreply@lead.test', mail_name: 'Review Coder' },
  projects: {
    alpha: { title: 'Alpha review', enabled: true, masters: ['pi/alpha-master'], coders: { coda: { handle: 'codera', repo: 'pi/alpha-team-a' }, codb: { handle: 'coderb', repo: 'pi/alpha-team-b' }, sly: { handle: 'sly', repo: 'pi/alpha-master' } } },
    beta: { title: 'Beta review', enabled: true, masters: ['pi/beta-master'], coders: { coda: { handle: 'codera', repo: 'pi/beta-team-a' } } },
    gamma: { title: 'Gamma review', enabled: false, masters: ['pi/gamma-master'], coders: { codb: { handle: 'coderb', repo: 'pi/gamma-team-b' } } },
  },
};
const PW = { coda: 'correct horse battery', codb: 'another long password' };

function kv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); if (!v || (v.exp && v.exp * 1000 <= Date.now() + (globalThis.SKEW || 0))) return null; return type === 'json' ? JSON.parse(v.v) : v.v; },
    async put(k, v, o = {}) { m.set(k, { v, exp: o.expiration }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; },
  };
}

async function envFor(extra = {}) {
  return {
    SESSION_SECRET: 'x'.repeat(40), GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: PEM1, LOCKS: kv(), GITHUB_API: 'https://gh.test',
    PASSWORD_CODA: await scramble(PW.coda), PASSWORD_CODB: await scramble(PW.codb), PASSWORD_SLY: await scramble('sly password long'), ...extra,
  };
}

// a fake GitHub: the App is installed on the team repos only; installation tokens reach their one repo
const INSTALLED = new Set(['pi/alpha-team-a', 'pi/alpha-team-b', 'pi/beta-team-a', 'pi/gamma-team-b']);
const gh = { calls: [], puts: [], files: new Map() };
const mail = { addresses: new Map(), sent: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const auth = (init.headers || {}).Authorization || '';
  gh.calls.push({ method: init.method || 'GET', path: u.pathname, auth, ua: (init.headers || {})['User-Agent'] });
  const j = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  let m;
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(u.pathname))) {
    const [h, b, s] = auth.slice(7).split('.');
    const v = createVerify('RSA-SHA256'); v.update(`${h}.${b}`);
    if (!v.verify(publicKey, Buffer.from(s, 'base64url'))) return j(401, { message: 'bad jwt' });
    const claims = JSON.parse(Buffer.from(b, 'base64url'));
    if (claims.iss !== '12345' || claims.exp - claims.iat > 600) return j(401, { message: 'bad claims' });
    return INSTALLED.has(m[1]) ? j(200, { id: 7 }) : j(404, { message: 'Not Found' });
  }
  if (u.pathname === '/app/installations/7/access_tokens') {
    const body = JSON.parse(init.body);
    return j(201, { token: `ghs_${body.repositories.join('+')}`, expires_at: new Date(Date.now() + 3600e3).toISOString() });
  }
  if (u.host === 'cf.test') { // a fake of Cloudflare's email API (cloudflare/mail.js)
    if (auth !== 'Bearer email-token') return j(403, { success: false, errors: [{ message: 'Authentication error' }] });
    if (u.pathname.endsWith('/email/routing/addresses') && init.method === 'POST') {
      const e = JSON.parse(init.body).email.toLowerCase();
      if (mail.addresses.has(e)) return j(409, { success: false, errors: [{ code: 2032, message: 'Destination address already exists' }] });
      mail.addresses.set(e, false); return j(200, { success: true, result: { email: e, verified: null } });
    }
    if (u.pathname.endsWith('/email/routing/addresses')) return j(200, { success: true, result: [...mail.addresses].map(([email, v]) => ({ email, verified: v ? '2026-10-25T00:00:00Z' : null })) });
    if (u.pathname.endsWith('/email/sending/send')) {
      const b = JSON.parse(init.body);
      if (mail.refuse) return j(mail.refuse.status, { success: false, errors: [{ code: mail.refuse.code, message: mail.refuse.message }], result: null });
      if (!mail.addresses.get(String(b.to).toLowerCase())) return j(400, { success: false, errors: [{ message: 'Destination address not verified' }] });
      mail.sent.push(b); return j(200, { success: true, result: { delivered: [b.to], permanent_bounces: [], queued: [] } });
    }
  }
  if (u.pathname === '/graphql') {
    const v = JSON.parse(init.body).variables;
    if (auth !== `Bearer ghs_${v.n}`) return j(401, { message: 'Bad credentials' });
    const files = gh.files.get(`${v.o}/${v.n}`) || {};
    const blob = (p) => (p in files ? { text: JSON.stringify(files[p]), isTruncated: false } : null);
    const dir = (pre, depth) => {
      const names = [...new Set(Object.keys(files).filter((p) => p.startsWith(pre + '/')).map((p) => p.slice(pre.length + 1).split('/')[0]))];
      return names.length ? { entries: names.map((n) => ({ name: n, object: depth > 1 && !((pre + '/' + n) in files) ? dir(pre + '/' + n, depth - 1) : blob(pre + '/' + n) })) } : null;
    };
    return j(200, { data: { repository: { review: blob('review.json'), setup: blob('setup.json'), records: blob('screening/records.json'), samples: dir('samples', 1), work: dir('work', 2) } } });
  }
  if ((m = /^\/users\/([^/]+)$/.exec(u.pathname))) return m[1] === 'realcoder' ? j(200, { login: 'RealCoder', id: 4242 }) : j(404, { message: 'Not Found' });
  if ((m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname))) {
    if (auth !== `Bearer ghs_${m[2]}`) return j(404, { message: 'Not Found' });
    const rest = m[3] || '';
    if (!rest) return j(200, { default_branch: 'main', full_name: `${m[1]}/${m[2]}`, private: true, permissions: {} });
    if (rest.startsWith('/git/trees/')) return j(200, { tree: [{ path: 'review.json', type: 'blob' }] });
    if (rest.startsWith('/contents/')) {
      const p = decodeURIComponent(rest.slice(10));
      if ((init.method || 'GET') === 'PUT') { const b = JSON.parse(init.body); gh.puts.push({ repo: `${m[1]}/${m[2]}`, path: p, body: b }); return j(201, { content: { sha: 'a'.repeat(40) } }); }
      const held = gh.files.get(`${m[1]}/${m[2]}`);
      if (init.headers.Accept.includes('raw') && held) return p in held ? new Response(JSON.stringify(held[p]), { status: 200 }) : j(404, { message: 'Not Found' });
      return init.headers.Accept.includes('raw') ? new Response('{"raw":true}', { status: 200 }) : j(200, { sha: 'b'.repeat(40), content: btoa('{}'), encoding: 'base64' });
    }
  }
  return j(404, { message: 'Not Found' });
};

const SITE = 'https://review.test';
const req = (path, { method = 'GET', token, body, headers = {} } = {}) => new Request(SITE + path, {
  method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
});
const login = (env, name, password, now) => handle(req('/api/login', { method: 'POST', body: { name, password } }), env, PROJECTS, now);
async function signedIn(env, name = 'coda') { const r = await login(env, name, PW[name]); assert.equal(r.status, 200); return (await r.json()).token; }
const save = (env, token, repo, path, body = { message: 'm', content: btoa('{"events":[]}'), branch: 'main' }) => handle(req(`/api/gh/repos/${repo}/contents/${path}`, { method: 'PUT', token, body }), env, PROJECTS);

test.beforeEach(() => { _reset(); gh.calls.length = 0; gh.puts.length = 0; });

test('the right password signs in, with a 30-day session', async () => {
  const env = await envFor();
  const t0 = Date.now();
  const r = await login(env, 'coda', PW.coda, t0);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.token, /^rcs\./);
  assert.equal(Date.parse(j.expires) - t0, 30 * 86400e3);
  assert.equal(j.handle, 'codera');
  const me = await handle(req('/api/me', { token: j.token }), env, PROJECTS, t0 + 29.9 * 86400e3);
  assert.equal(me.status, 200);
  const late = await handle(req('/api/me', { token: j.token }), env, PROJECTS, t0 + 30 * 86400e3 + 1);
  assert.equal(late.status, 401, 'the session ends after 30 days');
});

test('the name is not case sensitive; the password is', async () => {
  const env = await envFor();
  assert.equal((await login(env, ' CodA ', PW.coda)).status, 200);
  assert.equal((await login(env, 'coda', PW.coda.toUpperCase())).status, 401);
});

test('a wrong password, an unknown name and an empty password all fail with the same message', async () => {
  const env = await envFor();
  const msgs = [];
  for (const [n, p] of [['coda', 'wrong password!'], ['nobody', 'whatever password'], ['coda', '']]) {
    const r = await login(env, n, p);
    assert.equal(r.status, 401);
    msgs.push((await r.json()).message);
  }
  assert.equal(new Set(msgs).size, 1);
  assert.ok(!JSON.stringify(msgs).includes('codera'));
});

test('5 wrong tries in 15 minutes lock the name, even against the right password, for 15 minutes', async () => {
  const env = await envFor();
  const t0 = Date.now();
  for (let i = 1; i < MAX_TRIES; i++) assert.equal((await login(env, 'coda', 'wrong password ' + i, t0 + i * 1000)).status, 401);
  const fifth = await login(env, 'coda', 'wrong password 5', t0 + 5000);
  assert.equal(fifth.status, 429);
  assert.match((await fifth.json()).message, /locked for 15 minutes/);
  const right = await login(env, 'coda', PW.coda, t0 + 6000);
  assert.equal(right.status, 429, 'locked: the right password is refused too');
  assert.equal((await login(env, 'codb', PW.codb, t0 + 6000)).status, 200, 'another name is not locked');
  assert.equal((await login(env, 'coda', PW.coda, t0 + 5000 + 15 * 60e3 + 1)).status, 200, 'the lock lifts after 15 minutes');
});

test('wrong tries spread over more than 15 minutes do not lock; a right password clears the count', async () => {
  const env = await envFor();
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) await login(env, 'coda', 'nope nope nope', t0 + i * 1000);
  assert.equal((await login(env, 'coda', 'nope nope nope', t0 + 16 * 60e3)).status, 401, 'the fifth try is in a new window');
  assert.equal((await login(env, 'coda', PW.coda, t0 + 16 * 60e3 + 1000)).status, 200);
  assert.equal(env.LOCKS.m.has('fails:coda'), false);
  for (let i = 0; i < 4; i++) await login(env, 'coda', 'nope nope nope', t0 + 17 * 60e3 + i);
  assert.equal((await login(env, 'coda', PW.coda, t0 + 17 * 60e3 + 10)).status, 200, 'four wrong tries, then the right one');
});

test('an unknown name is locked the same way, so names cannot be guessed from the replies', async () => {
  const env = await envFor();
  let last;
  for (let i = 0; i < MAX_TRIES; i++) last = await login(env, 'ghost', 'some password here');
  assert.equal(last.status, 429);
});

test('a coder sees only their own switched-on projects, each with their own repo', async () => {
  const env = await envFor();
  const a = await (await login(env, 'coda', PW.coda)).json();
  assert.deepEqual(a.projects.map((p) => [p.id, p.path, p.repo]), [['alpha', '/alpha/', 'pi/alpha-team-a'], ['beta', '/beta/', 'pi/beta-team-a']]);
  const b = await (await login(env, 'codb', PW.codb)).json();
  assert.deepEqual(b.projects.map((p) => p.id), ['alpha'], 'gamma is switched off');
  assert.ok(!JSON.stringify(b).includes('alpha-team-a') && !JSON.stringify(b).includes('gamma'), 'nothing of another coder or a switched-off project');
  const me = await (await handle(req('/api/me', { token: b.token }), env, PROJECTS)).json();
  assert.deepEqual(me.projects.map((p) => p.repo), ['pi/alpha-team-b']);
});

test('a coder entry that names a master is never used', async () => {
  assert.deepEqual(coderProjects(PROJECTS, 'sly'), []);
  const env = await envFor();
  assert.equal((await login(env, 'sly', 'sly password long')).status, 401);
});

test('who am I gives the handle; reads of the coder\'s own repo pass through with a one-repo App token', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  const u = await (await handle(req('/api/gh/user', { token: t }), env, PROJECTS)).json();
  assert.equal(u.login, 'codera');
  const info = await (await handle(req('/api/gh/repos/pi/alpha-team-a', { token: t }), env, PROJECTS)).json();
  assert.deepEqual(info, { full_name: 'pi/alpha-team-a', default_branch: 'main' });
  const tree = await handle(req('/api/gh/repos/pi/alpha-team-a/git/trees/main?recursive=1', { token: t }), env, PROJECTS);
  assert.equal(tree.status, 200);
  const raw = await handle(req('/api/gh/repos/pi/alpha-team-a/contents/review.json?ref=main', { token: t, headers: { Accept: 'application/vnd.github.raw+json' } }), env, PROJECTS);
  assert.equal(await raw.text(), '{"raw":true}');
  const file = await handle(req('/api/gh/repos/pi/alpha-team-a/contents/work/codera/X.json?ref=main', { token: t }), env, PROJECTS);
  assert.equal((await file.json()).encoding, 'base64');
  const tokens = gh.calls.filter((c) => c.path.startsWith('/app/installations/'));
  assert.equal(tokens.length, 1, 'one App token, then reused');
  assert.ok(gh.calls.every((c) => c.ua), 'every call to GitHub names itself (GitHub requires a User-Agent)');
  assert.ok(gh.calls.filter((c) => c.path.startsWith('/repos/pi/alpha-team-a/') || c.path === '/repos/pi/alpha-team-a').every((c) => c.auth === 'Bearer ghs_alpha-team-a' || c.path.endsWith('/installation')));
});

test('no session, a forged session or a session signed with another secret gets nothing', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  assert.equal((await handle(req('/api/gh/user'), env, PROJECTS)).status, 401);
  const [p, body, sig] = t.split('.');
  const forged = `${p}.${Buffer.from(JSON.stringify({ n: 'codb', exp: Date.now() + 1e6, pv: 'x' })).toString('base64url')}.${sig}`;
  assert.equal((await handle(req('/api/gh/user', { token: forged }), env, PROJECTS)).status, 401);
  const other = await envFor({ SESSION_SECRET: 'y'.repeat(40), PASSWORD_CODA: env.PASSWORD_CODA });
  assert.equal((await handle(req('/api/gh/user', { token: t }), other, PROJECTS)).status, 401);
  assert.equal(body.length > 0, true);
});

test('a new password ends the sessions made with the old one', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  env.PASSWORD_CODA = await scramble('a brand new password');
  assert.equal((await handle(req('/api/gh/user', { token: t }), env, PROJECTS)).status, 401);
});

test('a save into the coder\'s own folder goes to GitHub with the coder as author and the App as committer', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  const r = await save(env, t, 'pi/alpha-team-a', 'work/codera/CI01.json', { message: 'codera: 1 event(s) on CI01', content: btoa('{"events":[]}'), branch: 'main', sha: 'c'.repeat(40), author: { name: 'someone else', email: 'x@y' }, committer: { name: 'forged', email: 'f@g' } });
  assert.equal(r.status, 201);
  assert.equal(gh.puts.length, 1);
  const b = gh.puts[0].body;
  assert.deepEqual(b.author, { name: 'codera', email: 'codera@users.noreply.github.com' });
  assert.equal(b.committer, undefined, 'no committer sent: GitHub records the App');
  assert.equal(b.sha, 'c'.repeat(40));
  assert.equal(b.branch, 'main');
  assert.equal(gh.puts[0].path, 'work/codera/CI01.json');
});

test('a save outside the coder\'s own folder is refused', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  for (const p of ['review.json', 'work/coderb/CI01.json', 'work/CI01.json', 'samples/s1.json', 'work/codera/../review.json', 'work/codera/%2e%2e/review.json',
    'work/codera%2F..%2Freview.json', 'work/codera/CI01.txt', 'work/codera//CI01.json', 'Work/codera/CI01.json', 'work/Codera/CI01.json', 'work/codera/.hidden.json']) {
    const r = await save(env, t, 'pi/alpha-team-a', p);
    assert.ok(r.status === 403 || r.status === 400, `${p}: ${r.status}`);
  }
  assert.equal(gh.puts.length, 0);
});

test('a save to a repo not listed for the coder is refused, and so is a save to a master, even where the App is installed', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  for (const repo of ['pi/alpha-team-b', 'pi/gamma-team-b', 'pi/unknown', 'other/alpha-team-a']) {
    assert.equal((await save(env, t, repo, 'work/codera/CI01.json')).status, 404, repo);
  }
  INSTALLED.add('pi/alpha-master'); // were the App ever installed on a master by mistake
  for (const repo of ['pi/alpha-master', 'PI/Alpha-Master', 'pi/beta-master', 'pi/gamma-master']) {
    const r = await save(env, t, repo, 'work/codera/CI01.json');
    assert.equal(r.status, 403, repo);
    assert.match((await r.json()).message, /master/);
    assert.equal((await handle(req(`/api/gh/repos/${repo}/contents/review.json`, { token: t }), env, PROJECTS)).status, 403, `no read of ${repo} either`);
  }
  INSTALLED.delete('pi/alpha-master');
  assert.equal(gh.puts.length, 0);
  assert.ok(!gh.calls.some((c) => /master/.test(c.path)), 'GitHub is never asked about a master');
});

test('a save to another branch, or a save that is not a file, is refused', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  assert.equal((await save(env, t, 'pi/alpha-team-a', 'work/codera/CI01.json', { content: btoa('{}'), branch: 'other' })).status, 403);
  assert.equal((await save(env, t, 'pi/alpha-team-a', 'work/codera/CI01.json', { branch: 'main' })).status, 400);
  assert.equal((await save(env, t, 'pi/alpha-team-a', 'work/codera/CI01.json', { content: 'not base64 !!', branch: 'main' })).status, 400);
  assert.equal(gh.puts.length, 0);
});

test('only the app\'s calls pass: other GitHub calls and methods are refused', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  for (const [m, p] of [['GET', '/api/gh/repos/pi/alpha-team-a/collaborators'], ['DELETE', '/api/gh/repos/pi/alpha-team-a/contents/work/codera/CI01.json'],
    ['POST', '/api/gh/repos/pi/alpha-team-a/git/refs'], ['GET', '/api/gh/user/repos'], ['GET', '/api/gh/repos/pi/alpha-team-a/pulls'], ['PATCH', '/api/gh/repos/pi/alpha-team-a']]) {
    const r = await handle(req(p, { method: m, token: t }), env, PROJECTS);
    assert.ok(r.status === 404 || r.status === 405, `${m} ${p}: ${r.status}`);
  }
  assert.equal(gh.puts.length, 0);
});

test('a switched-off project lets no one in', async () => {
  const env = await envFor();
  const b = await (await login(env, 'codb', PW.codb)).json();
  assert.equal((await handle(req('/api/gh/repos/pi/gamma-team-b/contents/review.json', { token: b.token }), env, PROJECTS)).status, 404);
});

test('a repo the App is not installed on says so', async () => {
  const env = await envFor();
  const t = await signedIn(env);
  INSTALLED.delete('pi/beta-team-a');
  const r = await handle(req('/api/gh/repos/pi/beta-team-a', { token: t }), env, PROJECTS);
  INSTALLED.add('pi/beta-team-a');
  assert.equal(r.status, 403);
  assert.match((await r.json()).message, /not installed/);
});

test('requests from another site, a login that is not JSON, or a service not set up, are refused', async () => {
  const env = await envFor();
  assert.equal((await handle(req('/api/login', { method: 'POST', body: { name: 'coda', password: PW.coda }, headers: { Origin: 'https://evil.test' } }), env, PROJECTS)).status, 403);
  assert.equal((await handle(new Request(SITE + '/api/login', { method: 'POST', body: 'name=coda', headers: { 'Content-Type': 'text/plain' } }), env, PROJECTS)).status, 415);
  for (const k of ['SESSION_SECRET', 'LOCKS']) {
    const e = await envFor({ [k]: undefined });
    assert.equal((await login(e, 'coda', PW.coda)).status, 503, k);
  }
  for (const k of ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY']) {
    const e = await envFor({ [k]: undefined });
    const t = (await (await login(e, 'coda', PW.coda)).json()).token;
    assert.equal((await handle(req('/api/gh/repos/pi/alpha-team-a', { token: t }), e, PROJECTS)).status, 503, `${k}: no GitHub without the App`);
  }
  assert.equal((await login(await envFor({ SESSION_SECRET: 'short' }), 'coda', PW.coda)).status, 503);
});

test('the App key is read as GitHub gives it, as PKCS#8, or as one line', async () => {
  const one = PEM1.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const want = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' }));
  for (const k of [PEM1, PEM8, one, PEM1.replace(/\n/g, '\\n')]) assert.deepEqual(Buffer.from(keyDer(k)), want);
  for (const k of [PEM8, one]) {
    _reset();
    const env = await envFor({ GITHUB_APP_PRIVATE_KEY: k });
    const t = await signedIn(env);
    assert.equal((await handle(req('/api/gh/repos/pi/alpha-team-a', { token: t }), env, PROJECTS)).status, 200);
  }
  assert.throws(() => keyDer('bm90IGEga2V5'));
});

test('the scrambled form never holds the password, and the same password scrambles differently each time', async () => {
  const a = await scramble('my secret password');
  const b = await scramble('my secret password');
  assert.notEqual(a, b);
  assert.ok(!a.includes('secret'));
  assert.match(a, /^pbkdf2-sha256\$10000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
});

// ---- the project lead's page ----

const PI_PW = 'the lead password, long enough';
async function adminEnv(extra = {}) { return envFor({ ADMIN_PASSWORD: await scramble(PI_PW), EMAIL_API_TOKEN: 'email-token', CF_API: 'https://cf.test/client/v4', ...extra }); }
const adminLogin = (env, password = PI_PW, now) => handle(req('/api/admin/login', { method: 'POST', body: { password } }), env, PROJECTS, now);
async function adminToken(env) { const r = await adminLogin(env); assert.equal(r.status, 200); return (await r.json()).token; }
const adm = async (env, t, path, method = 'GET', body) => { const r = await handle(req('/api/admin' + path, { method, token: t, body }), env, PROJECTS); return { status: r.status, j: await r.json() }; };

test('the lead signs in with their own password; wrong tries lock it; a coder\'s session is not the lead\'s', async () => {
  const env = await adminEnv();
  assert.equal((await adminLogin(env, 'nope nope nope')).status, 401);
  const coder = await signedIn(env);
  assert.equal((await adm(env, coder, '/state')).status, 401, 'a coder cannot use the lead\'s page');
  const t = await adminToken(env);
  assert.equal((await handle(req('/api/gh/user', { token: t }), env, PROJECTS)).status, 401, 'the lead\'s session is not a coder\'s');
  const st = await adm(env, t, '/state');
  assert.equal(st.status, 200);
  assert.deepEqual(st.j.coders.map((c) => c.name), ['coda', 'codb', 'sly']);
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) assert.equal((await adminLogin(env, 'wrong ' + i, t0)).status, 401);
  assert.equal((await adminLogin(env, 'wrong 5', t0)).status, 429);
  assert.equal((await adminLogin(env, PI_PW, t0 + 1000)).status, 429, 'locked, even with the right password');
  assert.equal((await adminLogin(await adminEnv({ ADMIN_PASSWORD: undefined }), PI_PW)).status, 503, 'no lead password set: no way in');
});

test('the lead adds a coder: a password is shown once, and the coder signs in to that review only', async () => {
  const env = await adminEnv();
  INSTALLED.add('pi/alpha-team-c');
  const t = await adminToken(env);
  const r = await adm(env, t, '/coders', 'POST', { name: 'Newbie', project: 'alpha', repo: 'pi/alpha-team-c', contact: 'new@example.org' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.match(r.j.password, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.equal(r.j.warning, null);
  assert.ok(!JSON.stringify([...env.LOCKS.m.values()]).includes(r.j.password), 'only the scrambled form is kept');
  const ok = await login(env, 'newbie', r.j.password);
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.deepEqual(j.projects.map((p) => [p.id, p.repo]), [['alpha', 'pi/alpha-team-c']]);
  assert.equal(j.handle, 'newbie');
  assert.equal((await save(env, j.token, 'pi/alpha-team-c', 'work/newbie/X.json')).status, 201);
  assert.equal(gh.puts[0].body.author.name, 'newbie');
  assert.equal((await save(env, j.token, 'pi/alpha-team-a', 'work/newbie/X.json')).status, 404, 'not another coder\'s repo');
  const again = await adm(env, t, '/coders', 'POST', { name: 'newbie', project: 'beta', repo: 'pi/beta-team-c' });
  assert.equal(again.j.password, null, 'adding a second review keeps the password');
  assert.match(again.j.warning, /not installed/);
  INSTALLED.delete('pi/alpha-team-c');
});

test('the lead cannot give a coder a master, another coder\'s repo, or a bad name', async () => {
  const env = await adminEnv();
  const t = await adminToken(env);
  for (const [b, re] of [
    [{ name: 'x1', project: 'alpha', repo: 'pi/alpha-master' }, /master/],
    [{ name: 'x2', project: 'alpha', repo: 'PI/Beta-Master' }, /master/],
    [{ name: 'x3', project: 'alpha', repo: 'pi/alpha-team-a' }, /coda's team repository/],
    [{ name: 'Bad Name!', project: 'alpha', repo: 'pi/x' }, /sign-in name/],
    [{ name: 'x4', project: 'nope', repo: 'pi/x' }, /Choose a project/],
    [{ name: 'x5', project: 'alpha', repo: 'not a repo' }, /owner\/name/],
    [{ name: 'coda', project: 'alpha', repo: 'pi/other' }, /already in this project/],
    [{ name: 'x6', project: 'alpha', repo: 'pi/x6', contact: 'not an email' }, /email/],
    [{ name: 'x7', project: 'alpha', repo: 'pi/x7', github: 'nosuchuser' }, /no user/],
  ]) {
    const r = await adm(env, t, '/coders', 'POST', b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.match(r.j.message, re);
  }
  assert.ok(![...env.LOCKS.m.keys()].some((k) => k.startsWith('coder:x')), 'nothing was saved');
});

test('a GitHub username keeps the coder\'s work folder and links their saves to their profile', async () => {
  const env = await adminEnv();
  INSTALLED.add('pi/alpha-team-g');
  const t = await adminToken(env);
  const r = await adm(env, t, '/coders', 'POST', { name: 'gina', project: 'alpha', repo: 'pi/alpha-team-g', github: 'realcoder' });
  assert.equal(r.j.handle, 'realcoder');
  const s = await (await login(env, 'gina', r.j.password)).json();
  assert.equal(s.handle, 'realcoder');
  assert.equal((await save(env, s.token, 'pi/alpha-team-g', 'work/gina/X.json')).status, 403, 'the folder is the GitHub name');
  assert.equal((await save(env, s.token, 'pi/alpha-team-g', 'work/realcoder/X.json')).status, 201);
  assert.deepEqual(gh.puts.at(-1).body.author, { name: 'realcoder', email: '4242+RealCoder@users.noreply.github.com' });
  INSTALLED.delete('pi/alpha-team-g');
});

test('a new password from the lead: the old one and its sessions stop at once, the lock is lifted', async () => {
  const env = await adminEnv();
  const t = await adminToken(env);
  const old = await signedIn(env); // coda, from the setting PASSWORD_CODA
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) await login(env, 'coda', 'wrong wrong ' + i, t0);
  assert.equal((await adm(env, t, '/state')).j.coders.find((c) => c.name === 'coda').locked, true);
  const r = await adm(env, t, '/coders/coda/password', 'POST', {});
  assert.equal(r.status, 200);
  assert.equal((await handle(req('/api/gh/user', { token: old }), env, PROJECTS)).status, 401, 'the old session has ended');
  assert.equal((await login(env, 'coda', PW.coda)).status, 401, 'the old password no longer works');
  assert.equal((await login(env, 'coda', r.j.password)).status, 200, 'the new one does, and the lock is gone');
});

test('the page works at once after an add, though Cloudflare\'s KV lists catch up only within a minute', async () => {
  const env = await adminEnv();
  env.LOCKS.list = async () => ({ keys: [], list_complete: true }); // a list that has not caught up yet
  const t = await adminToken(env);
  const r = await adm(env, t, '/coders', 'POST', { name: 'quick', project: 'alpha', repo: 'pi/alpha-team-q' });
  assert.equal(r.status, 200);
  assert.ok((await adm(env, t, '/state')).j.coders.some((c) => c.name === 'quick'), 'listed at once');
  assert.equal((await adm(env, t, '/coders/quick/password', 'POST', {})).status, 200, 'a new password at once');
  assert.equal((await adm(env, t, '/coders/quick/remove', 'POST', {})).status, 200, 'removed at once');
  assert.ok(!(await adm(env, t, '/state')).j.coders.some((c) => c.name === 'quick'), 'and gone from the list');
});

test('unlock, email, and remove', async () => {
  const env = await adminEnv();
  INSTALLED.add('pi/alpha-team-r');
  const t = await adminToken(env);
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) await login(env, 'codb', 'wrong wrong ' + i, t0);
  assert.equal((await login(env, 'codb', PW.codb)).status, 429);
  assert.equal((await adm(env, t, '/coders/codb/unlock', 'POST', {})).status, 200);
  assert.equal((await login(env, 'codb', PW.codb)).status, 200);
  assert.equal((await adm(env, t, '/coders/codb/contact', 'POST', { contact: 'b@example.org' })).status, 200);
  assert.equal((await adm(env, t, '/state')).j.coders.find((c) => c.name === 'codb').contact, 'b@example.org');
  assert.equal((await login(env, 'codb', PW.codb)).status, 200, 'an email changes nothing about signing in');
  assert.equal((await adm(env, t, '/coders/codb/remove', 'POST', { project: 'alpha' })).status, 400, 'a project-list coder is removed by a PR');
  const r = await adm(env, t, '/coders', 'POST', { name: 'temp', project: 'alpha', repo: 'pi/alpha-team-r' });
  const s = (await (await login(env, 'temp', r.j.password)).json()).token;
  assert.equal((await adm(env, t, '/coders/temp/remove', 'POST', {})).status, 200);
  assert.equal((await handle(req('/api/gh/user', { token: s }), env, PROJECTS)).status, 401, 'their session ends');
  assert.equal((await login(env, 'temp', r.j.password)).status, 401, 'they can no longer sign in');
  assert.ok(!env.LOCKS.m.has('pw:temp') && !env.LOCKS.m.has('coder:temp'));
  assert.equal((await adm(env, t, '/coders/nobody/password', 'POST', {})).status, 404);
  INSTALLED.delete('pi/alpha-team-r');
});

test('the lead changes their own password: the old one stops working', async () => {
  const env = await adminEnv();
  const t = await adminToken(env);
  assert.equal((await adm(env, t, '/password', 'POST', { current: 'wrong', next: 'a brand new lead password' })).status, 400, 'a wrong current password does not sign the page out');
  assert.equal((await adm(env, t, '/state')).status, 200);
  assert.equal((await adm(env, t, '/password', 'POST', { current: PI_PW, next: 'short' })).status, 400);
  const r = await adm(env, t, '/password', 'POST', { current: PI_PW, next: 'a brand new lead password' });
  assert.equal(r.status, 200);
  assert.equal((await adm(env, t, '/state')).status, 401, 'the old session ends');
  assert.equal((await adm(env, r.j.token, '/state')).status, 200, 'the new one works');
  assert.equal((await adminLogin(env, PI_PW)).status, 401);
  assert.equal((await adminLogin(env, 'a brand new lead password')).status, 200);
});

test('with site.welcome_public false the welcome text is closed to everyone but the lead', async () => {
  const env = await adminEnv();
  const P = { ...PROJECTS, site: { welcome_public: false }, welcome: { intro: { title: 'Hello', text: 'Intro' } } };
  assert.equal((await handle(req('/api/welcome'), env, P)).status, 404);
  assert.equal((await handle(req('/api/welcome'), {}, P)).status, 404, 'closed before the service is set up too');
  assert.equal((await handle(req('/api/admin/welcome'), env, P)).status, 401, 'no session');
  const coder = await (await handle(req('/api/login', { method: 'POST', body: { name: 'coderb', password: 'coderb-password' } }), env, P)).json().catch(() => ({}));
  if (coder.token) assert.equal((await handle(req('/api/admin/welcome', { token: coder.token }), env, P)).status, 401, 'a coder cannot read it');
  const t = (await (await adminLogin(env, PI_PW)).json()).token;
  const lead = await handle(req('/api/admin/welcome', { token: t }), env, P);
  assert.equal(lead.status, 200);
  const w = await lead.json();
  assert.equal(w.intro.title, 'Hello');
  assert.equal(w.public, false);
  const open = await (await handle(req('/api/admin/welcome', { token: t }), env, PROJECTS)).json();
  assert.equal(open.public, true, 'without the setting the page stays public');
});

test('the welcome page is public, starts from the project list, and only the lead edits it', async () => {
  const env = await adminEnv();
  const P = { ...PROJECTS, welcome: { intro: { title: 'Hello', text: 'Intro' } }, projects: { ...PROJECTS.projects, alpha: { ...PROJECTS.projects.alpha, about: { status: 'Screening', description: 'About alpha', links: [{ label: 'OSF', url: 'https://osf.io/x/' }], team: [{ name: 'A Person', role: 'Lead' }] } } } };
  const w = await (await handle(req('/api/welcome'), env, P)).json();
  assert.equal(w.intro.title, 'Hello');
  assert.deepEqual(w.projects.map((p) => [p.id, p.status, p.open]), [['alpha', 'Screening', true], ['beta', 'Open', true], ['gamma', 'On hold', false]]);
  const txt = JSON.stringify(w);
  for (const s of ['coda', 'codera', 'alpha-team', 'master']) assert.ok(!txt.includes(s), `the public page names no ${s}`);
  assert.equal((await handle(req('/api/welcome'), {}, P)).status, 200, 'it works before the service is set up');
  const edit = { intro: { title: 'Welcome', text: 'New intro' }, projects: { alpha: { status: 'Coding', description: 'New', links: [], team: [{ name: 'B', role: '' }] } } };
  const coder = await signedIn(env);
  assert.equal((await handle(req('/api/admin/welcome', { method: 'PUT', token: coder, body: edit }), env, P)).status, 401);
  const t = await adminToken(env);
  assert.equal((await handle(req('/api/admin/welcome', { method: 'PUT', token: t, body: edit }), env, P)).status, 200);
  const w2 = await (await handle(req('/api/welcome'), env, P)).json();
  assert.equal(w2.intro.text, 'New intro');
  assert.equal(w2.projects[0].status, 'Coding');
  assert.match(checkWelcome({ intro: {}, projects: { alpha: { links: [{ label: 'x', url: 'javascript:alert(1)' }] } } }, P), /https/);
  assert.match(checkWelcome({ intro: {}, projects: { nope: {} } }, P), /no review/);
});

test('progress: counts and dates per coder from their team repo, nothing of their decisions, never a master', async () => {
  const env = await adminEnv();
  const day = (n) => new Date(Date.now() - n * 86400e3).toISOString();
  gh.files.set('pi/alpha-team-a', {
    'review.json': { id: 'a', title: 'Alpha', screening: { enabled: true, records: 'screening/records.json' } },
    'screening/records.json': [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }],
    'work/codera/R1.json': { events: [{ id: 'e1', t: day(9), coder: 'codera', type: 'screen-decision', record: 'R1', decision: 'exclude', reason: 'SECRET REASON', note: 'SECRET NOTE' }] },
  });
  gh.files.set('pi/alpha-team-b', {
    'review.json': { id: 'b', title: 'Alpha', screening: { enabled: true, records: 'screening/records.json' } },
    'screening/records.json': [{ id: 'R1' }, { id: 'R2' }],
    'work/coderb/R1.json': { events: [{ id: 'e2', t: day(1), coder: 'coderb', type: 'screen-decision', record: 'R1', decision: 'include' }] },
    'work/coderb/R2.json': { events: [{ id: 'e3', t: day(0), coder: 'coderb', type: 'screen-decision', record: 'R2', decision: 'exclude' }] },
  });
  const t = await adminToken(env);
  const r = await adm(env, t, '/progress');
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const alpha = r.j.projects.find((p) => p.id === 'alpha');
  const a = alpha.people.find((p) => p.name === 'coda'), b = alpha.people.find((p) => p.name === 'codb');
  assert.deepEqual(a.screening, { assigned: 3, decided: 1 });
  assert.equal(a.state, 'stale'); assert.equal(a.look, true); assert.equal(a.days, 9);
  assert.deepEqual(b.screening, { assigned: 2, decided: 2 });
  assert.equal(b.state, 'finished');
  const txt = JSON.stringify(r.j);
  for (const s of ['SECRET', 'exclude', 'include']) assert.ok(!txt.includes(s), `no ${s} in the dashboard`);
  assert.ok(!alpha.people.some((p) => p.name === 'sly'), 'a coder given a master is left out');
  assert.ok(!gh.calls.some((c) => /master/.test(c.path)), 'no master is read');
  const coder = await signedIn(env);
  assert.equal((await adm(env, coder, '/progress')).status, 401, 'coders cannot see it');
  gh.files.clear();
});

test('adding a coder: the folder name follows the label on their team repo, and a different one is refused', async () => {
  const env = await adminEnv();
  const t = await adminToken(env);
  for (const r of ['pi/alpha-team-s', 'pi/alpha-team-w', 'pi/alpha-team-n']) INSTALLED.add(r);
  gh.files.set('pi/alpha-team-s', { 'review.json': { id: 'alpha-team-s', team: [{ handle: 'joebtay', role: 'PI' }, { handle: 'fcoder-design', role: 'Coder' }] } });
  gh.files.set('pi/alpha-team-w', { 'review.json': { id: 'alpha-team-w', team: [{ handle: 'joebtay', role: 'PI' }, { handle: 'wren99', role: 'Coder' }] } });
  gh.files.set('pi/alpha-team-n', { 'review.json': { id: 'alpha-team-n' } });
  // no GitHub username given: the repo's label becomes the folder, so the items show
  const s = await adm(env, t, '/coders', 'POST', { name: 'alex', project: 'alpha', repo: 'pi/alpha-team-s' });
  assert.equal(s.status, 200, JSON.stringify(s.j)); assert.equal(s.j.handle, 'fcoder-design');
  // a different name is refused, with what to do
  const w = await adm(env, t, '/coders', 'POST', { name: 'wren', project: 'alpha', repo: 'pi/alpha-team-w', github: 'realcoder' });
  assert.equal(w.status, 400); assert.match(w.j.message, /set up for wren99/);
  assert.equal(await env.LOCKS.get('coder:wren'), null, 'nothing is saved');
  // a repo with no label: the sign-in name is the folder, as before
  const n = await adm(env, t, '/coders', 'POST', { name: 'nell', project: 'alpha', repo: 'pi/alpha-team-n' });
  assert.equal(n.status, 200); assert.equal(n.j.handle, 'nell');
  for (const r of ['pi/alpha-team-s', 'pi/alpha-team-w', 'pi/alpha-team-n']) INSTALLED.delete(r);
  gh.files.clear();
});

// ---- forgotten passwords ----

const forgot = (env, name, origin = SITE) => handle(new Request(origin + '/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }), env, PROJECTS);
const reset = (env, token, password) => handle(req('/api/reset', { method: 'POST', body: { token, password } }), env, PROJECTS);
const linkIn = (m) => /\/signin\/\?reset=([A-Za-z0-9_-]+)/.exec(m.text)[1];

test('forgot password: a link by email only to a confirmed address; the same reply whatever the name', async () => {
  const env = await adminEnv();
  INSTALLED.add('pi/alpha-team-f');
  mail.addresses.clear(); mail.sent.length = 0;
  const t = await adminToken(env);
  const add = await adm(env, t, '/coders', 'POST', { name: 'fay', project: 'alpha', repo: 'pi/alpha-team-f', contact: 'Fay@Example.org' });
  assert.equal(add.j.warning, null);
  assert.equal(mail.addresses.get('fay@example.org'), false, 'the email went to Cloudflare to confirm');
  assert.equal((await adm(env, t, '/state')).j.coders.find((c) => c.name === 'fay').confirmed, false, 'the page shows it is waiting');
  const replies = [];
  for (const n of ['fay', 'nobody', 'coda']) replies.push(await (await forgot(env, n)).json());
  assert.equal(new Set(replies.map((r) => r.message)).size, 1, 'the same reply for a known name, an unknown one, and one with no email');
  assert.equal(mail.sent.length, 0, 'nothing reaches an unconfirmed address');
  mail.addresses.set('fay@example.org', true); // fay clicks Cloudflare's link
  assert.equal((await adm(env, t, '/state')).j.coders.find((c) => c.name === 'fay').confirmed, true);
  await forgot(env, 'FAY');
  assert.equal(mail.sent.length, 1);
  const m = mail.sent[0];
  assert.equal(m.to, 'Fay@Example.org'); assert.deepEqual(m.from, { address: 'noreply@lead.test', name: 'Review Coder' });
  assert.match(m.text, /within one hour/);
  const token = linkIn(m);
  assert.ok(m.text.includes(`${SITE}/signin/?reset=${token}`), 'the link is on the site the coder asked from');
  assert.ok(!JSON.stringify([...env.LOCKS.m.keys()]).includes(token), 'only a fingerprint of the link is kept');
  INSTALLED.delete('pi/alpha-team-f');
});

test('the reset link sets a new password once; the old password and its sessions end; the lock lifts', async () => {
  const env = await adminEnv();
  INSTALLED.add('pi/alpha-team-f');
  mail.addresses.clear(); mail.sent.length = 0;
  const t = await adminToken(env);
  const pw0 = (await adm(env, t, '/coders', 'POST', { name: 'fay', project: 'alpha', repo: 'pi/alpha-team-f', contact: 'fay@example.org' })).j.password;
  mail.addresses.set('fay@example.org', true);
  const old = (await (await login(env, 'fay', pw0)).json()).token;
  for (let i = 0; i < 5; i++) await login(env, 'fay', 'wrong wrong ' + i);
  assert.equal((await login(env, 'fay', pw0)).status, 429, 'locked');
  await forgot(env, 'fay');
  const token = linkIn(mail.sent[0]);
  assert.equal((await reset(env, token, 'short')).status, 400, 'at least 12 characters');
  const r = await reset(env, token, 'my own new password');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.token && j.projects[0].id === 'alpha', 'signed in at once');
  assert.equal((await handle(req('/api/gh/user', { token: old }), env, PROJECTS)).status, 401, 'the old session has ended');
  assert.equal((await login(env, 'fay', pw0)).status, 401, 'the old password no longer works, and the lock is gone');
  assert.equal((await login(env, 'fay', 'my own new password')).status, 200);
  assert.equal((await reset(env, token, 'another new password')).status, 400, 'the link works once');
  assert.equal((await reset(env, 'x'.repeat(43), 'another new password')).status, 400, 'a made-up link does nothing');
  INSTALLED.delete('pi/alpha-team-f');
});

test('reset links expire after an hour, and at most 3 are sent an hour for a name', async () => {
  const env = await adminEnv();
  INSTALLED.add('pi/alpha-team-f');
  mail.addresses.clear(); mail.sent.length = 0;
  const t = await adminToken(env);
  await adm(env, t, '/coders', 'POST', { name: 'fay', project: 'alpha', repo: 'pi/alpha-team-f', contact: 'fay@example.org' });
  mail.addresses.set('fay@example.org', true);
  const t0 = Date.now();
  await handle(new Request(SITE + '/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"fay"}' }), env, PROJECTS, t0);
  const token = linkIn(mail.sent[0]);
  assert.equal((await handle(req('/api/reset', { method: 'POST', body: { token, password: 'a new password here' } }), env, PROJECTS, t0 + 61 * 60e3)).status, 400, 'expired after an hour');
  for (let i = 0; i < 5; i++) await forgot(env, 'fay');
  assert.equal(mail.sent.length, 3, 'three an hour, then no more');
  INSTALLED.delete('pi/alpha-team-f');
});

test('when Cloudflare refuses an email, the PI page shows its reason; the reply can come before the send', async () => {
  const env = await adminEnv();
  INSTALLED.add('pi/alpha-team-f');
  mail.addresses.clear(); mail.sent.length = 0;
  const t = await adminToken(env);
  await adm(env, t, '/coders', 'POST', { name: 'fay', project: 'alpha', repo: 'pi/alpha-team-f', contact: 'fay@example.org' });
  mail.addresses.set('fay@example.org', true);
  assert.equal((await adm(env, t, '/state')).j.mailLast, null, 'nothing sent yet');
  mail.refuse = { status: 403, code: 10203, message: 'email.sending.error.email.sending_disabled' };
  // with a background slot (as on Cloudflare), the reply does not wait for the send
  const waits = [];
  const r = await handle(new Request(SITE + '/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"fay"}' }), env, PROJECTS, Date.now(), { waitUntil: (p) => waits.push(p) });
  assert.equal(r.status, 200); assert.equal(waits.length, 1, 'the send runs in the background');
  await Promise.all(waits);
  const last = (await adm(env, t, '/state')).j.mailLast;
  assert.equal(last.ok, false); assert.equal(last.status, 403);
  assert.match(last.said, /10203 email\.sending\.error\.email\.sending_disabled/);
  assert.ok(!JSON.stringify(last).includes('fay@'), 'no address is kept');
  assert.ok(!JSON.stringify(last).includes('reset='), 'no link is kept');
  const tr = await adm(env, t, '/mail-test', 'POST', { to: 'fay@example.org' });
  assert.equal(tr.status, 200); assert.equal(tr.j.ok, false); assert.match(tr.j.message, /sending_disabled/);
  mail.refuse = null;
  const ok = await adm(env, t, '/mail-test', 'POST', { to: 'fay@example.org' });
  assert.equal(ok.j.ok, true); assert.match(mail.sent.at(-1).subject, /Test email/);
  assert.equal((await adm(env, t, '/state')).j.mailLast.ok, true);
  assert.equal((await adm(env, t, '/mail-test', 'POST', { to: 'not an address' })).status, 400);
  assert.equal((await handle(req('/api/admin/mail-test', { method: 'POST', body: { to: 'fay@example.org' } }), env, PROJECTS)).status, 401, 'the PI only');
  INSTALLED.delete('pi/alpha-team-f');
});

test('without email set up, the page says so and Forgot password points to the lead', async () => {
  const env = await adminEnv({ EMAIL_API_TOKEN: undefined });
  const t = await adminToken(env);
  assert.equal((await adm(env, t, '/state')).j.mail, false);
  const r = await (await forgot(env, 'coda')).json();
  assert.equal(r.mail, false); assert.match(r.message, /project lead/);
});
