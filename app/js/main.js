import { S, loadReview, refreshEvents } from './data.js';
import { GitHubStore, StaticStore } from './store.js';
import { h } from './ui.js';
import { mountCodebook, toggleCodebook, render as renderCodebook } from './codebook.js';
import { renderProject, renderProtocol } from './project.js';
import { renderDocuments, renderDocProfile } from './documents.js';
import { renderVerify, V } from './verify.js';
import { renderScreen, SC } from './screen.js';
import { renderAgreement } from './agreement.js';
import { feature } from './features.js';
import { orientationPage, anyHasOrientation, orientationFrame } from './orientation.js';
import { renderThemes } from './themeview.js';
import { SECTION } from './section.js';
import { confFor, remember, switcher, renderReviews, findReviews } from './reviews.js';
import { serviceSession, serviceSignIn, resetForm, clearSession, projectList, notYours, serviceProblem, SERVICE_API } from './signin.js';

const NAV = [['project', 'Project'], ['documents', 'Documents'], ['screen', 'Screen'], ['code', 'Code'], ['verify', 'Verify'], ['themes', 'Themes'], ['agreement', 'Agreement'], ['overview', 'Overview']];
const themesOn = () => feature('themes_by_document') || feature('themes_by_code');
const CFG = 'rc:config';
const app = document.getElementById('app');
let shell = null, main = null, pill = null, pendingRender = false;

const cfg = () => { try { return JSON.parse(localStorage.getItem(CFG) || 'null'); } catch { return null; } };
const saveCfg = (c) => { try { localStorage.setItem(CFG, JSON.stringify(c)); } catch {} };
// A classic token with only the repo box ticked: GitHub opens its form with this scope selected.
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Review%20Coder';
const apiOverride = () => { const q = new URLSearchParams(location.search).get('api'); return q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q) ? q : null; };

function signIn(msg) {
  const c = cfg() || {};
  const qRepo = new URLSearchParams(location.search).get('repo');
  const linkRepo = qRepo && /^[\w.-]+\/[\w.-]+$/.test(qRepo) ? qRepo : null;
  const repo = h('input', { type: 'text', id: 'repo', placeholder: 'owner/repo', value: linkRepo || c.repo || '', autocomplete: 'off' });
  const token = h('input', { type: 'password', id: 'token', placeholder: 'GitHub token', value: c.token || '', autocomplete: 'off' });
  const remember = h('input', { type: 'checkbox', id: 'remember', checked: true });
  const err = h('div', { class: 'warnline', id: 'err', text: msg || '' });
  const go = async () => {
    err.textContent = '';
    const conf = { repo: repo.value.trim(), token: token.value.trim(), api: apiOverride() || undefined };
    if (!/^[\w.-]+\/[\w.-]+$/.test(conf.repo) || !conf.token) { err.textContent = 'Enter the repository as owner/name and paste your token.'; return; }
    await start(new GitHubStore(conf), conf, remember.checked);
  };
  app.replaceChildren(h('div', { class: 'signin' },
    h('h1', { text: 'Review Coder' }), h('p', { class: 'muted', text: 'Code, verify and screen documents for an evidence review. Everything is saved to your review\'s private GitHub repo.' }),
    h('label', null, 'Review data repository', repo), h('label', null, 'Your GitHub token', token),
    h('p', { class: 'small tokenlink' }, 'No token yet? ', h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener', id: 'make-token', text: 'Make one on GitHub' }),
      ' (opens with the right box ticked: choose 90 days, click Generate token, copy it and paste it here).'),
    h('label', { class: 'inline' }, remember, ' Remember on this device'),
    err, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: go, text: 'Open review' }), h('button', { type: 'button', class: 'btn', onclick: () => start(new StaticStore('./demo/'), null, false), text: 'Try the demo' })),
    h('details', null, h('summary', { text: 'How to make a token' }),
      h('p', { class: 'small', text: 'If the review repo is yours, or belongs to an organisation you are in, make a fine-grained token:' }),
      h('ol', null, h('li', { text: 'GitHub, Settings, Developer settings, Fine-grained tokens, Generate new token.' }), h('li', { text: 'Repository access: only select repositories, then pick the review data repo.' }),
        h('li', { text: 'Permissions: Contents, read and write. Nothing else.' }), h('li', { text: 'Set an expiry that covers the review. The token stays in this browser and goes only to api.github.com.' })),
      h('p', { class: 'small', text: 'If you were invited to a repo on another person\'s account, GitHub does not offer it for a fine-grained token. Make a classic token instead:' }),
      h('ol', null, h('li', null, 'Use the "Make one on GitHub" link above, or: GitHub, Settings, Developer settings, Personal access tokens, Tokens (classic), Generate new token (classic).'),
        h('li', { text: 'Scopes: tick repo only.' }), h('li', { text: 'Expiration: 90 days, or the length of the review.' }),
        h('li', { text: 'A classic token reaches every repo you can open, so use it only here, on your own computer.' })))));
}

const rememberReview = remember;
const tokenMode = () => S.store && !S.store.service && !S.store.demo && cfg() && cfg().token;

/** Open another review with the same token (reviews.js). Changes not yet synced stay on this device under their review. */
function openReview(repo) {
  const n = S.sync && S.sync.pending();
  if (n && !confirm(`${n} change${n > 1 ? 's have' : ' has'} not reached GitHub yet. They stay saved on this device and sync when you come back to this review. Open the other review anyway?`)) return;
  saveCfg({ ...cfg(), repo });
  const u = new URL(location.href);
  u.searchParams.set('repo', repo);
  u.hash = '';
  location.href = u.toString();
}

/** Once per device, look on GitHub for the other reviews the token can see, and add them to the switcher. */
async function lookOnce() {
  const c = cfg();
  if (!c || !c.token || c.found_at) return;
  try {
    let n = c;
    for (const r of await findReviews(c)) if (!(n.hidden || []).includes(r.repo)) n = rememberReview(n, r.repo, r.title);
    saveCfg({ ...n, repo: cfg().repo, found_at: new Date().toISOString() });
    const old = document.getElementById('review-switch');
    if (old) old.replaceWith(switcher(cfg(), { onOpen: openReview }));
  } catch {}
}

async function start(store, conf, remember) {
  app.replaceChildren(h('div', { class: 'signin' }, h('p', { class: 'muted', text: 'Opening the review' })));
  try {
    const u = await store.user();
    await store.init();
    if (conf && remember) saveCfg({ ...(cfg() || {}), ...conf });
    await loadReview(store, u.login);
    if (conf && remember) saveCfg(rememberReview(cfg() || conf, store.repo, S.review.title));
    buildShell(u.login);
    route();
    if (conf && remember) lookOnce();
  } catch (e) {
    if ((conf || store.service) && (e.status === 0 || e.status >= 500)) { offlineScreen(store, conf, remember, e); return; }
    if (store.service) { if (e.status === 401) { clearSession(); openSection('Your sign-in has ended. Sign in again.'); } else serviceProblem(app, SECTION.title, e.message); return; }
    const m = e.status === 401 ? 'GitHub rejected the token.' : e.status === 404 ? 'Repository not found, or the token cannot see it. If you were invited, accept the invitation on GitHub first (check your email), then try again.' : e.status === 0 ? 'Could not reach GitHub.' : e.message;
    signIn(m);
  }
}

function offlineScreen(store, conf, remember, e) {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(`rc:${store.repo}:`) && k.endsWith(':outbox')) n += Object.values(JSON.parse(localStorage.getItem(k) || '{}')).reduce((a, l) => a + l.length, 0); } } catch {}
  app.replaceChildren(h('div', { class: 'signin' }, h('h1', { text: 'Cannot reach GitHub' }),
    h('p', null, e.message + '. '), h('p', { class: 'ok', text: n ? `${n} change${n > 1 ? 's' : ''} saved on this device will sync when the connection returns.` : 'Nothing is waiting to sync.' }),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => start(store, conf, remember), text: 'Try again' }), store.service ? h('button', { type: 'button', class: 'btn', onclick: () => { clearSession(); openSection(); }, text: 'Sign in again' }) : h('button', { type: 'button', class: 'btn', onclick: () => signIn(), text: 'Change repository or token' }))));
}

function buildShell(handle) {
  pill = h('div', { class: 'syncpill' });
  main = h('main', { id: 'main' });
  const labels = S.review.nav || {}; // a review may name a tab for its own work (cognitive review phase 2: "Check the coding")
  const nav = h('nav', { 'aria-label': 'Workspace' }, NAV.filter(([k]) => (k === 'themes' ? themesOn() : feature(k))).map(([k, l]) => h('a', { href: `#/${k}`, 'data-k': k, text: labels[k] || l })));
  shell = h('div', { class: 'shell' },
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('div', { class: 'logo' }, '≡'), h('div', null, h('b', { text: 'Review Coder' }), tokenMode() ? switcher(cfg(), { onOpen: openReview }) : h('div', { class: 'muted small', text: S.review.title }))),
      nav,
      h('div', { class: 'right' }, pill,
        anyHasOrientation() ? h('a', { href: '#/orientation', class: 'btn small', id: 'orient-header', title: 'The questions, their definitions and worked examples' }, 'How the codes work') : null,
        S.review.codebook || Object.keys(S.frames || {}).length ? h('button', { type: 'button', class: 'btn small', onclick: () => toggleCodebook(), title: 'Show definitions (?)' }, 'Codebook') : null,
        h('div', { class: 'who', title: handle }, h('span', { class: 'av', text: handle.slice(0, 2).toUpperCase() }), h('span', { class: 'muted small', text: handle })),
        h('button', { type: 'button', class: 'btn small', onclick: () => { if (S.sync && S.sync.pending() && !confirm(`${S.sync.pending()} changes have not reached GitHub yet. They stay saved on this device. Sign out anyway?`)) return; try { localStorage.removeItem(CFG); } catch {} clearSession(); location.hash = ''; location.reload(); } }, 'Sign out'))),
    main);
  app.replaceChildren(shell);
  mountCodebook(app);
  S.listeners.add(scheduleRender);
  S.statusListeners.add(paintPill);
  paintPill();
}

function paintPill() {
  if (!pill) return;
  const s = S.syncStatus;
  const where = S.store && S.store.demo ? 'in this browser (demo)' : 'to GitHub';
  const txt = s.state === 'saved' ? `Saved ${where}` : s.state === 'syncing' ? `Saved on this device · ${s.pending} syncing` : s.state === 'offline' ? `Saved on this device · ${s.pending} waiting, offline` : `Saved on this device · ${s.pending} not synced`;
  pill.className = 'syncpill ' + s.state;
  pill.title = s.message || '';
  const kids = [h('span', { class: 'sd' }), txt];
  if (s.state !== 'saved') kids.push(h('button', { type: 'button', class: 'link', onclick: () => S.sync.flush(), text: 'Retry' }));
  pill.replaceChildren(...kids);
}

function scheduleRender() {
  const a = document.activeElement;
  if (a && /^(TEXTAREA|INPUT)$/.test(a.tagName) && a.closest('#main') && a.type !== 'checkbox') { pendingRender = true; return; }
  route();
}
document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(route, 0); } });

function route() {
  if (!main) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = (parts[0] || 'project').split('?')[0];
  shell.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === page || (page === 'doc' && a.dataset.k === 'documents') || (page === 'protocol' && a.dataset.k === 'project')));
  const y = window.scrollY;
  const off = { documents: 'documents', doc: 'documents', verify: 'verify', screen: 'screen', agreement: 'agreement', overview: 'overview', code: 'code' }[page];
  if (page === 'themes' && !themesOn()) main.replaceChildren(h('div', { class: 'page narrow' }, h('h1', { text: 'Themes' }),
    h('p', { class: 'muted', text: 'This part of the platform is not switched on for this review yet.' }), h('p', null, h('a', { href: '#/project', text: 'Back to the project' }))));
  else if (off && !feature(off)) main.replaceChildren(h('div', { class: 'page narrow' }, h('h1', { text: NAV.find((n) => n[0] === page)?.[1] || 'Not available' }),
    h('p', { class: 'muted', text: 'This part of the platform is not switched on for this review yet.' }), h('p', null, h('a', { href: '#/project', text: 'Back to the project' }))));
  else if (page === 'reviews' && tokenMode()) renderReviews(main, { cfg, saveCfg, onOpen: openReview });
  else if (page === 'project') renderProject(main);
  else if (page === 'protocol') renderProtocol(main);
  else if (page === 'documents') renderDocuments(main);
  else if (page === 'doc') renderDocProfile(main, decodeURIComponent(parts[1] || ''));
  else if (page === 'verify') renderVerify(main);
  else if (page === 'themes') renderThemes(main, parts.slice(1).map((x) => x.split('?')[0]));
  else if (page === 'screen') renderScreen(main);
  else if (page === 'orientation' && anyHasOrientation()) main.replaceChildren(orientationPage(() => { location.hash = '#/verify'; }, 'Back to coding', orientationFrame()));
  else if (page === 'agreement') renderAgreement(main);
  else main.replaceChildren(h('div', { class: 'page' }, h('h1', { text: NAV.find((n) => n[0] === page)?.[1] || 'Not found' }), h('p', { class: 'muted', text: page === 'overview' ? 'The matrix and audit trail arrive in stage 4.' : 'This module arrives in stage 5.' })));
  renderCodebook(true);
  if (page !== 'verify' && page !== 'screen' && page !== 'themes') window.scrollTo(0, y);
}
window.addEventListener('hashchange', () => { if (main) { route(); window.scrollTo(0, 0); } });

document.addEventListener('keydown', (e) => {
  if (!main) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === '?') { toggleCodebook(); e.preventDefault(); return; }
  if ((location.hash.startsWith('#/verify')) && V.keys) V.keys(e);
  else if (location.hash.startsWith('#/screen') && SC.keys) SC.keys(e);
});

// On the Cloudflare site (section.js) a coder signs in with a name and password, and lands in their own review.
// The root page sends them on; a project's section opens its one repo for them. ?token keeps the GitHub-token sign-in
// there, for the project lead.
function openSection(msg) {
  const reset = new URLSearchParams(location.search).get('reset');
  if (reset) { resetForm(app, reset, { onDone: () => openSection() }); return; } // a "Forgot password" link
  const s = serviceSession();
  if (!s) { serviceSignIn(app, { title: SECTION.title, msg, onDone: () => openSection() }); return; }
  if (!SECTION.project) {
    if (s.projects.length === 1) location.replace(s.projects[0].path);
    else projectList(app, s);
    return;
  }
  const p = s.projects.find((x) => x.id === SECTION.project);
  if (!p) { notYours(app, s, SECTION.title); return; }
  start(new GitHubStore({ repo: p.repo, token: s.token, api: SERVICE_API(), service: true }), null, false);
}

const c = cfg();
if (SECTION && !new URLSearchParams(location.search).has('token') && !location.search.includes('demo')) openSection();
else if (location.search.includes('demo')) start(new StaticStore('./demo/'), null, false);
else if (c && c.repo && c.token) { const conf = confFor(c, location.search); start(new GitHubStore({ ...conf, api: apiOverride() || conf.api }), conf, true); }
else signIn();
