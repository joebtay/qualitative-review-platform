#!/usr/bin/env node
// Builds the Cloudflare site into dist/ (the Pages build command; cloudflare/README.md):
//   /            the welcome page (public): each review's status, description, links and team (cloudflare/site/);
//                with projects.json "site.welcome_public": false, a redirect to /signin/ and no welcome text
//   /signin/     a copy of app/ where a coder signs in and is sent on to their review
//   /<id>/       one copy of app/ per switched-on project; a switched-off project gets a short notice and no app
//   /admin/      the project lead's page (cloudflare/site/admin/)
// The coders and repos stay out of dist/: each section learns only its own id and title (js/section.js), and the
// build stops if a coder name, handle or repo from the project list would be published.
//   node cloudflare/build.mjs [--projects cloudflare/projects.json] [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { welcomeContent } from './welcome.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const list = JSON.parse(fs.readFileSync(path.resolve(arg('--projects', path.join(ROOT, 'cloudflare/projects.json'))), 'utf8'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'dist')));
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED = ['api', 'js', 'css', 'demo', 'vendor', 'signin', 'admin'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function copyApp(to, section) {
  fs.cpSync(path.join(ROOT, 'app'), to, { recursive: true });
  fs.writeFileSync(path.join(to, 'js/section.js'),
    `// Written by cloudflare/build.mjs: this copy of the app is a section of the Cloudflare site.\nexport const SECTION = ${JSON.stringify(section)};\n`);
}

fs.rmSync(OUT, { recursive: true, force: true });
copyApp(path.join(OUT, 'signin'), { project: null });
const ids = Object.keys(list.projects || {});
for (const id of ids) {
  if (!ID_RE.test(id) || RESERVED.includes(id)) throw new Error(`Project id "${id}" cannot be a section name`);
  const p = list.projects[id];
  const dir = path.join(OUT, id);
  if (p.enabled === true) { copyApp(dir, { project: id, title: p.title || id }); continue; }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Review Coder</title><link rel="stylesheet" href="/signin/css/app.css"></head>
<body><div id="app"><div class="signin" id="section-off"><h1>${esc(p.title || id)}</h1>
<p>This review is not open on this site yet.</p><p class="muted">If you code for this review, keep using the link and sign-in you have now.</p><p><a href="/">Back to the welcome page</a></p></div></div></body>
</html>
`);
}

// the welcome page and the PI's page, with the project list's welcome text built in (the page then loads the PI's edits)
fs.cpSync(path.join(ROOT, 'cloudflare/site'), OUT, { recursive: true });
const w = await welcomeContent({}, list);
const card = (p) => `<section class="card review" id="review-${esc(p.id)}"><div class="row" style="justify-content:space-between;margin-top:0"><h2>${esc(p.title)}</h2><span class="status${p.open ? ' open' : ''}">${esc(p.status)}</span></div>`
  + (p.description ? `<p class="desc">${esc(p.description)}</p>` : '')
  + (p.links.length ? `<div><h4>Links</h4><ul>${p.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join('')}</ul></div>` : '')
  + (p.team.length ? `<div><h4>Team</h4><ul>${p.team.map((m) => `<li>${esc(m.name)}${m.role ? `<span class="muted">, ${esc(m.role)}</span>` : ''}</li>`).join('')}</ul></div>` : '')
  + '</section>';
const index = path.join(OUT, 'index.html');
const closed = list.site && list.site.welcome_public === false; // the address opens on the sign-in page, and nothing of the welcome text is published
if (closed) {
  fs.rmSync(path.join(OUT, 'welcome.js'));
  fs.writeFileSync(index, `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=/signin/"></head>
<body><p><a href="/signin/">Sign in</a></p></body>
</html>
`);
} else fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('WELCOME_TITLE', esc(w.intro.title)).replace('WELCOME_TEXT', esc(w.intro.text)).replace('WELCOME_REVIEWS', w.projects.map(card).join('\n')));

fs.writeFileSync(path.join(OUT, '_headers'), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/admin/*
  X-Robots-Tag: noindex
  Cache-Control: no-store
`);

// leak check: no coder name, handle or repo from the list in any built file
const secrets = new Set();
for (const p of Object.values(list.projects || {})) {
  for (const r of p.masters || []) secrets.add(r);
  for (const [name, c] of Object.entries(p.coders || {})) { secrets.add(`"${name}"`); if (c.handle) secrets.add(c.handle); if (c.repo) secrets.add(c.repo); }
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const leaks = [];
for (const f of walk(OUT)) {
  if (!/\.(html|js|mjs|json|css|md|txt)$/.test(f) && !f.endsWith('_headers')) continue;
  const t = fs.readFileSync(f, 'utf8');
  for (const s of secrets) if (s && t.includes(s)) leaks.push(`${path.relative(OUT, f)}: ${s}`);
}
if (leaks.length) { console.error('The build would publish names from the project list:\n' + leaks.join('\n')); process.exit(1); }
const on = ids.filter((id) => list.projects[id].enabled === true);
console.log(`Built ${path.relative(ROOT, OUT) || OUT}: ${closed ? 'sign-in' : 'welcome'} at /, sign-in at /signin/, ${on.length ? on.map((x) => `/${x}/`).join(' ') : 'no sections'} open, ${ids.filter((x) => !on.includes(x)).map((x) => `/${x}/`).join(' ') || 'none'} switched off, project lead at /admin/.`);
