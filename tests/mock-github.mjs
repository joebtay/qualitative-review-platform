// A small fake of the GitHub REST API (the parts Review Coder uses), serving a directory.
// node tests/mock-github.mjs <dir> <port> [owner/repo]
// Control endpoints: POST /__fail?n=3&status=503 fails the next n requests; GET /__log returns writes;
// /__big?bytes=N makes JSON reads of files over N bytes come back without content, as GitHub does over 1 MB.
// Several repos on one server (for tools/team/attach_coder.py): node tests/mock-github.mjs --repos o/a=DIR,o/b=DIR PORT.
// Trees then carry git blob shas; PATCH /repos/o/r {name} renames a repo; PUT /repos/o/r/collaborators/h invites
// (GET /__collaborators lists the invitations); an unknown repo is 404. GET /user/repos lists every repo served.
// For the sign-in service (cloudflare/service.js): --repos ... PORT --app PUBLIC_KEY.pem --app-id ID --installed o/a,o/b
// acts as a GitHub App installed on those repos only: GET /repos/o/r/installation checks the App's JWT (RS256, issuer ID),
// POST /app/installations/1/access_tokens gives a token for the repos asked, and that token reaches only them.
// Each write in /__log then also carries its repo, message, author and committer. POST /graphql answers the progress
// dashboard's one read of a repo (cloudflare/progress.js), for an App token that reaches it.
// It also fakes Cloudflare's email API (cloudflare/mail.js) under /client/v4/accounts/<id>/email/..., for the token
// "test-email": addresses wait to be confirmed until POST /__mail/verify?email=..., only confirmed addresses get mail,
// and GET /__mail lists the addresses and the mail sent.
// For the progress page: GET /__requests lists every API request (method, path, token); POST /__pages?repo=o/r with
// {pages, build, runs} sets what GET /repos/o/r/pages, /pages/builds/latest and /actions/runs answer (404 when unset).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function startMock(dir, port, repo = 'joebtay/greylit-review-data', repos = null, app = null) {
  const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
  const blobSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
  const collaborators = [];
  const shaOf = repos ? blobSha : sha; // several repos: the git blob sha, as GitHub's contents API gives
  let fail = { n: 0, status: 503 };
  const writes = [];
  const requests = [];
  const pages = {};
  let conflictNext = 0;
  let bigOver = Infinity;
  const appTokens = new Map(); // installation token -> Set of repo full names
  const mail = { addresses: {}, sent: [] }; // the fake Cloudflare email API
  const jwtOk = (auth) => {
    const [hd, bd, sg] = auth.slice(7).split('.');
    if (!sg) return false;
    const v = crypto.createVerify('RSA-SHA256'); v.update(`${hd}.${bd}`);
    if (!v.verify(app.publicKey, Buffer.from(sg, 'base64url'))) return false;
    const c = JSON.parse(Buffer.from(bd, 'base64url'));
    const now = Math.floor(Date.now() / 1000);
    return c.iss === String(app.appId) && c.iat <= now + 5 && c.exp > now && c.exp - c.iat <= 600;
  };
  const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === '.git' ? [] : walk(path.join(d, e.name), base + e.name + '/')) : [base + e.name]);
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const u = new URL(req.url, 'http://x');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (u.pathname === '/__fail') { fail = { n: Number(u.searchParams.get('n')), status: Number(u.searchParams.get('status') || 503) }; return json(200, fail); }
    if (u.pathname === '/__conflict') { conflictNext = Number(u.searchParams.get('n') || 1); return json(200, { conflictNext }); }
    if (u.pathname === '/__log') return json(200, writes);
    if (u.pathname === '/__collaborators') return json(200, collaborators);
    if (u.pathname === '/__requests') return json(200, requests);
    if (u.pathname === '/__mail') return json(200, mail);
    if (u.pathname === '/__mail/verify') { mail.addresses[String(u.searchParams.get('email')).toLowerCase()] = true; return json(200, { ok: true }); }
    if (u.pathname.startsWith('/client/v4/accounts/')) {
      if (req.headers.authorization !== 'Bearer test-email') return json(403, { success: false, errors: [{ message: 'Authentication error' }] });
      let body = ''; req.on('data', (c) => (body += c));
      req.on('end', () => {
        const b = body ? JSON.parse(body) : {};
        if (u.pathname.endsWith('/email/routing/addresses') && req.method === 'POST') {
          const e = String(b.email).toLowerCase();
          if (e in mail.addresses) return json(409, { success: false, errors: [{ message: 'Destination address already exists' }] });
          mail.addresses[e] = false; return json(200, { success: true, result: { email: e, verified: null } });
        }
        if (u.pathname.endsWith('/email/routing/addresses')) return json(200, { success: true, result: Object.entries(mail.addresses).map(([email, v]) => ({ email, verified: v ? new Date().toISOString() : null })) });
        if (u.pathname.endsWith('/email/sending/send') && req.method === 'POST') {
          if (!mail.addresses[String(b.to).toLowerCase()]) return json(400, { success: false, errors: [{ message: 'Destination address not verified' }] });
          mail.sent.push(b); return json(200, { success: true, result: { delivered: [b.to], permanent_bounces: [], queued: [] } });
        }
        json(404, { success: false, errors: [{ message: 'Not Found' }] });
      });
      return;
    }
    if (u.pathname === '/__pages') {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { pages[u.searchParams.get('repo')] = JSON.parse(body || '{}'); json(200, { ok: true }); }); return;
    }
    if (u.pathname === '/__big') { bigOver = Number(u.searchParams.get('bytes')); return json(200, { bigOver }); }
    if (u.pathname === '/__external') { // simulate another device writing the same file
      const p = u.searchParams.get('path'); const abs = path.join(dir, p); fs.mkdirSync(path.dirname(abs), { recursive: true });
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { fs.writeFileSync(abs, body); json(200, { ok: true }); }); return;
    }
    requests.push({ method: req.method, path: u.pathname + u.search, auth: req.headers.authorization || null });
    if (fail.n > 0 && u.pathname !== '/user') { fail.n--; return json(fail.status, { message: 'injected failure' }); }
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return json(401, { message: 'Bad credentials' });
    if (app) {
      const im = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(u.pathname);
      if (im) return !jwtOk(auth) ? json(401, { message: 'A JSON web token could not be decoded' }) : app.installed.has(im[1]) && repos[im[1]] ? json(200, { id: 1 }) : json(404, { message: 'Not Found' });
      if (u.pathname === '/app/installations/1/access_tokens' && req.method === 'POST') {
        if (!jwtOk(auth)) return json(401, { message: 'A JSON web token could not be decoded' });
        let body = ''; req.on('data', (c) => (body += c));
        req.on('end', () => {
          const b = JSON.parse(body || '{}');
          const owner = [...app.installed][0].split('/')[0];
          const want = (b.repositories || []).map((n) => `${owner}/${n}`);
          if (!want.length || want.some((r) => !app.installed.has(r))) return json(422, { message: 'There is at least one repository that does not exist or is not accessible to the parent installation.' });
          const t = 'ghs_' + crypto.randomBytes(12).toString('hex');
          appTokens.set(t, new Set(want));
          json(201, { token: t, expires_at: new Date(Date.now() + 3600e3).toISOString(), permissions: b.permissions || {} });
        });
        return;
      }
      if (u.pathname === '/graphql' && req.method === 'POST') { // the progress dashboard's one-request read (cloudflare/progress.js)
        let body = ''; req.on('data', (c) => (body += c));
        req.on('end', () => {
          const { o, n } = JSON.parse(body).variables || {};
          const full = `${o}/${n}`;
          if (!auth.startsWith('Bearer ghs_') || !appTokens.get(auth.slice(7))?.has(full) || !repos[full]) return json(200, { data: { repository: null }, errors: [{ message: 'Could not resolve to a Repository' }] });
          const rdir = repos[full];
          const blob = (p) => { const f = path.join(rdir, p); return fs.existsSync(f) && fs.statSync(f).isFile() ? { text: fs.readFileSync(f, 'utf8'), isTruncated: false } : null; };
          const tree = (p, depth) => {
            const d = path.join(rdir, p);
            if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return null;
            return { entries: fs.readdirSync(d).map((name) => ({ name, object: fs.statSync(path.join(d, name)).isDirectory() ? (depth > 1 ? tree(`${p}/${name}`, depth - 1) : {}) : blob(`${p}/${name}`) })) };
          };
          json(200, { data: { repository: { review: blob('review.json'), setup: blob('setup.json'), records: blob('screening/records.json'), samples: tree('samples', 1), work: tree('work', 2) } } });
        });
        return;
      }
      if (auth.startsWith('Bearer ghs_')) {
        const rm = /^\/repos\/([^/]+\/[^/]+)/.exec(u.pathname);
        if (!rm || !appTokens.get(auth.slice(7))?.has(rm[1])) return json(404, { message: 'Not Found' });
      }
    }
    if (u.pathname === '/user') return json(200, { login: auth.slice(7).split('-')[0] || 'tester' });
    if (u.pathname === '/user/repos') { const all = repos ? Object.keys(repos) : [repo]; const pn = Number(u.searchParams.get('page') || 1); return json(200, pn === 1 ? all.map((full_name) => ({ full_name, name: full_name.split('/')[1] })) : []); }
    let rest, rdir = dir;
    if (repos) {
      const mm = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(u.pathname);
      if (!mm || !repos[mm[1]]) return json(404, { message: 'Not Found' });
      rdir = repos[mm[1]]; rest = mm[2] || '';
      if (rest === '' && req.method === 'PATCH') {
        let body = ''; req.on('data', (c) => (body += c));
        req.on('end', () => { const nm = mm[1].split('/')[0] + '/' + JSON.parse(body).name; repos[nm] = repos[mm[1]]; delete repos[mm[1]]; writes.push({ rename: mm[1], to: nm }); json(200, { full_name: nm }); });
        return;
      }
      const cm = /^\/collaborators\/([^/]+)$/.exec(rest);
      if (cm && req.method === 'PUT') { collaborators.push({ repo: mm[1], handle: cm[1] }); return json(201, {}); }
    } else {
      const m = new RegExp(`^/repos/${repo}(/.*)?$`).exec(u.pathname);
      if (!m) return json(404, { message: 'Not Found' });
      rest = m[1] || '';
    }
    if (rest === '') return json(200, { default_branch: 'main' });
    const pg = repos ? pages[/^\/repos\/([^/]+\/[^/]+)/.exec(u.pathname)[1]] : pages[repo];
    if (req.method === 'GET' && rest === '/pages') return pg && pg.pages ? json(200, pg.pages) : json(404, { message: 'Not Found' });
    if (req.method === 'GET' && rest === '/pages/builds/latest') return pg && pg.build ? json(200, pg.build) : json(404, { message: 'Not Found' });
    if (req.method === 'GET' && rest === '/actions/runs') return pg && pg.runs ? json(200, { total_count: pg.runs.length, workflow_runs: pg.runs }) : json(200, { total_count: 0, workflow_runs: [] });
    if (rest.startsWith('/git/trees/')) return json(200, { tree: walk(rdir).map((p) => ({ path: p, type: 'blob', ...(repos ? { sha: blobSha(fs.readFileSync(path.join(rdir, p))) } : {}) })) });
    if (rest.startsWith('/contents/')) {
      const p = decodeURIComponent(rest.slice('/contents/'.length));
      const abs = path.join(rdir, p);
      if (req.method === 'GET') {
        if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return json(404, { message: 'Not Found' });
        const buf = fs.readFileSync(abs);
        if ((req.headers.accept || '').includes('raw')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(buf); }
        if (buf.length > bigOver) return json(200, { sha: shaOf(buf), content: '', encoding: 'none', size: buf.length });
        return json(200, { sha: shaOf(buf), content: buf.toString('base64'), encoding: 'base64' });
      }
      if (req.method === 'PUT') {
        let body = ''; req.on('data', (c) => (body += c));
        req.on('end', () => {
          const b = JSON.parse(body);
          const exists = fs.existsSync(abs);
          if (conflictNext > 0 && exists) { conflictNext--; return json(409, { message: 'conflict' }); }
          if (exists && !b.sha) return json(422, { message: "Invalid request. \"sha\" wasn't supplied." });
          if (exists && shaOf(fs.readFileSync(abs)) !== b.sha) return json(409, { message: 'sha does not match' });
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          const buf = Buffer.from(b.content, 'base64'); fs.writeFileSync(abs, buf);
          writes.push(app || repos ? { repo: /^\/repos\/([^/]+\/[^/]+)/.exec(u.pathname)[1], path: p, bytes: buf.length, message: b.message, author: b.author || null, committer: b.committer || null } : { path: p, bytes: buf.length });
          return json(exists ? 200 : 201, { content: { sha: shaOf(buf) } });
        });
        return;
      }
    }
    json(404, { message: 'Not Found' });
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

if (process.argv[1] && process.argv[1].endsWith('mock-github.mjs') && process.argv[2] === '--repos') {
  const repos = Object.fromEntries(process.argv[3].split(',').map((x) => x.split('=')));
  const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const app = opt('--app') ? { publicKey: crypto.createPublicKey(fs.readFileSync(opt('--app'))), appId: opt('--app-id'), installed: new Set((opt('--installed') || '').split(',').filter(Boolean)) } : null;
  startMock(null, Number(process.argv[4] || 8790), null, repos, app).then(() => console.log('mock github up'));
} else if (process.argv[1] && process.argv[1].endsWith('mock-github.mjs') && process.argv[2]) {
  startMock(process.argv[2], Number(process.argv[3] || 8790), process.argv[4]).then(() => console.log('mock github up'));
}
