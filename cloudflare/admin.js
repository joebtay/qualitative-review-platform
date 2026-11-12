// The PI's page, /admin/ (PI, 24 October 2026): add a coder, make a new password, unlock a name, set a coder's email,
// remove a coder, change the PI's own password, edit the welcome page, and see progress. Everything is kept in the KV
// store bound as LOCKS, never in a repo. A new password is shown once, to send on; only its scrambled form is kept.
//   coder:<name>   {handle, display, contact, author_email, projects: {<project id>: "owner/repo"}, added}
//   pw:<name>      the coder's scrambled password (over the setting PASSWORD_<NAME>)
//   admin:pw       the PI's scrambled password (over the setting ADMIN_PASSWORD)
//   site:welcome   the welcome page's text (welcome.js)
//   coders         the names of the coders added here: KV lists catch up only within a minute, a read by name at once
// A coder's email goes to Cloudflare to confirm (mail.js): they click Cloudflare's link once, then "Forgot password"
// emails reach them. The page shows who has confirmed.
// The PI's session lasts 12 hours. The PI's name is locked like a coder's after 5 wrong passwords.

import {
  json, refuse, body, lower, masters, NAME_RE, REPO_RE, scramble, passwordMatches, newPassword, storedPassword, adminPassword,
  makeSession, readSession, lockedUntil, wrongTry, clearTries, unlock, LOCKED, WRONG, ADMIN_HOURS, pageCoder, repoToken, gh,
} from './service.js';
import { checkWelcome, welcomeContent } from './welcome.js';
import { progress } from './progress.js';
import { mailReady, registerAddress, addressStatus, sendMail } from './mail.js';

const ADMIN = '#admin'; // the lock's key for the PI: not a name a coder can have
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,180}\.[A-Za-z]{2,}$/;
const GH_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Every coder: the project list's and the page's, with where each project's entry comes from. */
async function allCoders(env, projects) {
  const names = new Set();
  for (const p of Object.values(projects.projects || {})) for (const n of Object.keys(p.coders || {})) names.add(n);
  for (const n of (await env.LOCKS.get('coders', 'json')) || []) names.add(n);
  let cursor;
  do {
    const l = await env.LOCKS.list({ prefix: 'coder:', cursor });
    for (const k of l.keys) names.add(k.name.slice(6));
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  const out = [];
  for (const name of [...names].filter((n) => NAME_RE.test(n)).sort()) {
    const page = await pageCoder(env, name);
    if (!page && !Object.values(projects.projects || {}).some((p) => (p.coders || {})[name])) continue; // removed, list not caught up
    const ps = [];
    let handle = page && page.handle;
    for (const [id, p] of Object.entries(projects.projects || {})) {
      const f = (p.coders || {})[name];
      if (f) { ps.push({ id, repo: f.repo, from: 'list', on: p.enabled === true }); handle = handle || f.handle; }
      else if (page && page.projects && page.projects[id]) ps.push({ id, repo: page.projects[id], from: 'page', on: p.enabled === true });
    }
    out.push({
      name, handle: lower(handle || name), contact: (page && page.contact) || '', projects: ps,
      password: !!(await storedPassword(env, name)), locked: !!(await lockedUntil(env, name, Date.now())),
    });
  }
  return out;
}

/** Each coder with confirmed: true or false for their email (null when there is no email or no way to check). */
async function withConfirmed(env, coders) {
  let st = null;
  try { st = await addressStatus(env); } catch {}
  return coders.map((c) => ({ ...c, confirmed: c.contact && st ? st.get(c.contact.toLowerCase()) === true : null }));
}

/** The index of coders added here: add or drop one name. */
async function indexCoder(env, name, add) {
  const now = new Set((await env.LOCKS.get('coders', 'json')) || []);
  if (add) now.add(name); else now.delete(name);
  await env.LOCKS.put('coders', JSON.stringify([...now].sort()));
}

/** GitHub's no-reply address for a username, so commits show on the person's profile; null if there is no such user. */
async function githubUser(env, login) {
  const r = await fetch((env.GITHUB_API || 'https://api.github.com') + `/users/${encodeURIComponent(login)}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'review-coder-signin' } });
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.id && j.login ? { login: lower(j.login), email: `${j.id}+${j.login}@users.noreply.github.com` } : null;
}

/** The coders a team repo is labelled for: review.json's team, less the PI. Null when it cannot be read. */
async function repoLabels(env, projects, repo, now) {
  const token = await repoToken(env, projects, repo, now);
  if (!token) return null;
  const r = await gh(env, `/repos/${repo}/contents/review.json`, { token, accept: 'application/vnd.github.raw+json' });
  if (!r.ok) return null;
  const team = (JSON.parse(await r.text()) || {}).team;
  if (!Array.isArray(team)) return null;
  return [...new Set(team.filter((m) => m && m.handle && !/^pi$/i.test(String(m.role || ''))).map((m) => lower(m.handle)))];
}

async function addCoder(env, projects, b, now) {
  const name = lower(b.name).trim();
  const id = String(b.project || '');
  const repo = String(b.repo || '').trim();
  const p = (projects.projects || {})[id];
  if (!NAME_RE.test(name)) return refuse(400, 'Use a short sign-in name: lower-case letters, digits, - or _.');
  if (!p) return refuse(400, 'Choose a project.');
  if (!REPO_RE.test(repo)) return refuse(400, 'Give the coder\'s team repository as owner/name, for example joebtay/cogimp-team.');
  if (masters(projects).has(lower(repo))) return refuse(400, 'That is a master repository. A coder works in a team repository, never a master.');
  if ((p.coders || {})[name]) return refuse(400, `${name} is already in this project.`);
  const contact = String(b.contact || '').trim();
  if (contact && !EMAIL_RE.test(contact)) return refuse(400, 'That email address does not look right.');
  const old = (await pageCoder(env, name)) || null;
  const listed = Object.values(projects.projects).map((x) => (x.coders || {})[name]).find(Boolean);
  let handle = (old && old.handle) || (listed && lower(listed.handle)) || null;
  let author;
  const ghName = String(b.github || '').trim();
  if (ghName) {
    if (!GH_RE.test(ghName)) return refuse(400, 'That GitHub username does not look right.');
    const u = await githubUser(env, ghName);
    if (!u) return refuse(400, `GitHub has no user called ${ghName}.`);
    if (handle && handle !== u.login) return refuse(400, `${name} already saves as ${handle}. One person keeps one work folder.`);
    handle = u.login; author = u.email;
  }
  // the repo's items are labelled for one coder (PI, 25 October 2026: Coder F and Coder E were added without their GitHub
  // usernames, and their items would not have shown): use that label, and refuse a different one
  let labels = null;
  try { labels = await repoLabels(env, projects, repo, now); } catch {}
  if (labels && labels.length) {
    if (!handle && labels.length === 1) handle = labels[0];
    else if (!labels.includes(handle || name)) {
      return refuse(400, `${repo} is set up for ${labels.join(' or ')}, so their items would not show for ${handle || name}. Put ${labels.length === 1 ? labels[0] : 'the right one'} in GitHub username, or choose the repository set up for this person.`);
    }
  }
  handle = handle || name;
  if (!NAME_RE.test(handle)) return refuse(400, 'That name cannot be a work folder name.');
  // blinding: one coder to a team repo, so no coder sees another's work
  const other = (await allCoders(env, projects)).find((c) => c.name !== name && c.projects.some((x) => lower(x.repo) === lower(repo)));
  if (other) return refuse(400, `${repo} is ${other.name}'s team repository. Each coder has their own, so no one sees another's work.`);
  const rec = { handle, display: (old && old.display) || handle, contact: contact || (old && old.contact) || '', author_email: author || (old && old.author_email) || null,
    projects: { ...((old && old.projects) || {}), [id]: repo }, added: (old && old.added) || new Date(now).toISOString() };
  await env.LOCKS.put(`coder:${name}`, JSON.stringify(rec));
  await indexCoder(env, name, true);
  let password = null;
  if (!(await storedPassword(env, name))) {
    password = newPassword();
    await env.LOCKS.put(`pw:${name}`, await scramble(password));
  }
  const warnings = [];
  if (rec.contact && rec.contact !== (old && old.contact)) {
    const r = await registerAddress(env, rec.contact);
    if (!r.ok) warnings.push(`${r.message} ${name} can sign in, but cannot reset their own password by email yet.`);
  }
  try { if (!(await repoToken(env, projects, repo, now))) warnings.push(`The saving App is not installed on ${repo} yet. Install it there, or ${name} cannot open the review.`); } catch { warnings.push('Could not check the GitHub App just now.'); }
  if (p.enabled !== true) warnings.push(`${p.title || id} is switched off, so ${name} cannot open it until it is switched on.`);
  const warning = warnings.length ? warnings.join(' ') : null;
  return json(200, { name, handle, password, warning });
}

export async function admin(request, env, projects, url, now, { appReady }) {
  const path = url.pathname.slice('/api/admin'.length);
  if (path === '/login') {
    if (request.method !== 'POST') return refuse(405, 'Use POST.');
    const b = await body(request);
    if (!b) return refuse(415, 'Send JSON.');
    const stored = await adminPassword(env);
    if (!stored) return refuse(503, 'The project lead\'s password is not set up yet.');
    if (await lockedUntil(env, ADMIN, now)) return refuse(429, LOCKED);
    if (!(await passwordMatches(String(b.password || '').slice(0, 200), stored))) {
      try { if (await wrongTry(env, ADMIN, now)) return refuse(429, LOCKED); } catch {}
      return refuse(401, 'Password not recognised.');
    }
    try { await clearTries(env, ADMIN); } catch {}
    return json(200, await makeSession(env, ADMIN, stored, now, { role: 'a', ms: ADMIN_HOURS * 3600e3 }));
  }
  const s = await readSession(request, env, now);
  if (!s || s.r !== 'a') return refuse(401, 'Sign in as the project lead.');
  const b = request.method === 'GET' ? {} : await body(request);
  if (!b) return refuse(415, 'Send JSON.');

  if (path === '/state' && request.method === 'GET') {
    return json(200, {
      projects: Object.entries(projects.projects || {}).map(([id, p]) => ({ id, title: p.title || id, on: p.enabled === true })),
      coders: await withConfirmed(env, await allCoders(env, projects)), app: appReady, mail: mailReady(env),
      mailLast: (await env.LOCKS.get('mail:last', 'json')) || null,
    });
  }
  // a test email from the site, to an address the PI gives (Cloudflare sends only to confirmed addresses)
  if (path === '/mail-test' && request.method === 'POST') {
    const to = String(b.to || '').trim();
    if (!EMAIL_RE.test(to)) return refuse(400, 'That email address does not look right.');
    if (!mailReady(env)) return refuse(400, 'Email is not set up on the site yet.');
    const r = await sendMail(env, projects, { to, subject: 'Test email from the review platform', text: 'This is a test email from the review platform. It shows that "Forgot password" emails can reach this address.\n' }, now);
    return json(200, { ok: r.ok, message: r.ok ? `Sent to ${to}. Check the inbox and the spam folder.` : `Cloudflare did not send it: ${r.said || 'no reason given'}` });
  }
  if (path === '/coders' && request.method === 'POST') return addCoder(env, projects, b, now);
  const m = /^\/coders\/([a-z0-9_-]{1,40})\/(password|unlock|contact|remove)$/.exec(path);
  if (m && request.method === 'POST') {
    const name = m[1];
    const known = (await allCoders(env, projects)).find((c) => c.name === name);
    if (!known) return refuse(404, `No coder called ${name}.`);
    if (m[2] === 'password') {
      const password = newPassword();
      await env.LOCKS.put(`pw:${name}`, await scramble(password));
      await unlock(env, name);
      return json(200, { name, password });
    }
    if (m[2] === 'unlock') { await unlock(env, name); return json(200, { name, locked: false }); }
    const page = (await pageCoder(env, name)) || { handle: known.handle, display: known.handle, projects: {} };
    if (m[2] === 'contact') {
      const contact = String(b.contact || '').trim();
      if (contact && !EMAIL_RE.test(contact)) return refuse(400, 'That email address does not look right.');
      await env.LOCKS.put(`coder:${name}`, JSON.stringify({ ...page, contact }));
      const r = contact ? await registerAddress(env, contact) : { ok: true };
      return json(200, { name, contact, warning: r.ok ? null : `${r.message} ${name} cannot reset their own password by email yet.` });
    }
    // remove: from one project, or from every project the page added; the project list's entries stay (a PR)
    const id = String(b.project || '');
    const fromList = known.projects.filter((x) => x.from === 'list' && (!id || x.id === id));
    if (id && fromList.length) return refuse(400, `${name} is in ${id} through the project list in the repo. Ask Claude to take them out there.`);
    const left = { ...(page.projects || {}) };
    if (id) delete left[id]; else for (const k of Object.keys(left)) delete left[k];
    if (Object.keys(left).length || known.projects.some((x) => x.from === 'list')) await env.LOCKS.put(`coder:${name}`, JSON.stringify({ ...page, projects: left }));
    else { await env.LOCKS.delete(`coder:${name}`); await env.LOCKS.delete(`pw:${name}`); await unlock(env, name); await indexCoder(env, name, false); }
    return json(200, { name, removed: id || 'all' });
  }
  if (path === '/password' && request.method === 'POST') {
    const current = String(b.current || ''), next = String(b.next || '');
    if (!(await passwordMatches(current, await adminPassword(env)))) return refuse(400, 'Your current password is not right.'); // not 401: that would sign the page out
    if (next.length < 12 || next.length > 200) return refuse(400, 'Use at least 12 characters.');
    const stored = await scramble(next);
    await env.LOCKS.put('admin:pw', stored);
    return json(200, await makeSession(env, ADMIN, stored, now, { role: 'a', ms: ADMIN_HOURS * 3600e3 })); // other PI sessions end
  }
  if (path === '/welcome' && request.method === 'GET') return json(200, { ...await welcomeContent(env, projects), public: !(projects.site && projects.site.welcome_public === false) });
  if (path === '/welcome' && request.method === 'PUT') {
    const err = checkWelcome(b, projects);
    if (err) return refuse(400, err);
    await env.LOCKS.put('site:welcome', JSON.stringify(b));
    return json(200, await welcomeContent(env, projects));
  }
  if (path === '/progress' && request.method === 'GET') {
    if (!appReady) return refuse(503, 'The GitHub App is not set up yet.');
    return json(200, await progress(env, projects, await allCoders(env, projects), now, { repoToken, gh }));
  }
  return refuse(404, 'Not found.');
}
