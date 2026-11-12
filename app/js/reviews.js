// The project lead's reviews (PI, 11 November 2026). With a GitHub token, one sign-in opens every review the token
// can see. The app remembers each review opened on this device, looks on GitHub once for the others (a repository
// whose name contains "review" and that holds a review.json), and switches between them without signing out.
// A ?repo= link opens that review even when another one is saved. Work waiting to sync stays on this device under
// its own review and syncs when that review is next opened. The Cloudflare sign-in (signin.js) does not use this.

import { h } from './ui.js';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
export const validRepo = (r) => typeof r === 'string' && REPO_RE.test(r);

/** The review a ?repo= link asks for, or null. */
export function linkedRepo(search) {
  const q = new URLSearchParams(search || '').get('repo');
  return validRepo(q) ? q : null;
}

/** The saved sign-in to start from: the linked review when a link names one, else the saved one. */
export function confFor(c, search) {
  const q = linkedRepo(search);
  return q && q !== c.repo ? { ...c, repo: q } : c;
}

/** Every review known on this device, current first, then by title. Hidden ones are left out. */
export function knownReviews(c) {
  const map = { ...((c && c.reviews) || {}) };
  if (c && validRepo(c.repo) && !(c.repo in map)) map[c.repo] = '';
  const hidden = new Set((c && c.hidden) || []);
  return Object.entries(map).filter(([r]) => validRepo(r) && (r === c.repo || !hidden.has(r)))
    .map(([repo, title]) => ({ repo, title: title || repo }))
    .sort((a, b) => (a.repo === c.repo ? -1 : b.repo === c.repo ? 1 : a.title.localeCompare(b.title)));
}

/** The saved sign-in with a review added (or its title updated), and shown again if it was hidden. */
export function remember(c, repo, title) {
  if (!validRepo(repo)) return c;
  const reviews = { ...((c && c.reviews) || {}) };
  reviews[repo] = title || reviews[repo] || '';
  return { ...c, reviews, hidden: ((c && c.hidden) || []).filter((r) => r !== repo) };
}

/** The saved sign-in with a review taken off the list (never the one open now). */
export function forget(c, repo) {
  if (repo === c.repo) return c;
  const reviews = { ...((c && c.reviews) || {}) };
  delete reviews[repo];
  return { ...c, reviews, hidden: [...new Set([...((c && c.hidden) || []), repo])] };
}

/** Repositories worth checking for a review.json: the name contains "review"; never the platform's own repos. */
export const candidate = (fullName) => validRepo(fullName) && /review/i.test(fullName.split('/')[1]) && !/^review-coder/i.test(fullName.split('/')[1]);

/** Look on GitHub for the reviews the token can see. Returns [{repo, title}]. */
export async function findReviews({ token, api }, fetchImpl = fetch) {
  const base = api || 'https://api.github.com';
  const get = (p, raw) => fetchImpl(base + p, { cache: 'no-store', headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  const names = [];
  for (let page = 1; page <= 5; page++) {
    const r = await get(`/user/repos?per_page=100&sort=updated&page=${page}`);
    if (!r.ok) { if (page === 1) throw new Error(`GitHub answered ${r.status}`); break; }
    const list = await r.json();
    names.push(...list.map((x) => x.full_name).filter(candidate));
    if (list.length < 100) break;
  }
  const found = await Promise.all(names.map(async (repo) => {
    try {
      const r = await get(`/repos/${repo}/contents/review.json`, true);
      if (!r.ok) return null;
      const j = JSON.parse(await r.text());
      return { repo, title: (j && j.title) || repo };
    } catch { return null; }
  }));
  return found.filter(Boolean);
}

/** The switcher in the header: every known review, and a way to the full list. */
export function switcher(c, { onOpen }) {
  const list = knownReviews(c);
  const sel = h('select', { id: 'review-switch', class: 'review-switch', 'aria-label': 'Open another review', title: 'Open another review' },
    list.map((r) => h('option', { value: r.repo, selected: r.repo === c.repo, text: r.title })),
    h('option', { value: '#reviews', text: 'All my reviews…' }));
  sel.addEventListener('change', () => {
    const v = sel.value;
    sel.value = c.repo;
    if (v === '#reviews') location.hash = '#/reviews';
    else if (v !== c.repo) onOpen(v);
  });
  return sel;
}

/** The "Your reviews" page. */
export function renderReviews(main, { cfg, saveCfg, onOpen }) {
  const msg = h('div', { id: 'reviews-msg', class: 'muted small' });
  const paint = () => {
    const c = cfg();
    const rows = knownReviews(c).map((r) => h('div', { class: 'card review-row', 'data-repo': r.repo },
      h('div', { class: 'row', style: 'justify-content:space-between;margin-top:0;align-items:center' },
        h('div', null, h('b', { text: r.title }), h('div', { class: 'muted small', text: r.repo })),
        r.repo === c.repo ? h('span', { class: 'muted small', text: 'Open now' })
          : h('div', { class: 'row', style: 'margin-top:0' },
            h('button', { type: 'button', class: 'btn primary small', onclick: () => onOpen(r.repo), text: 'Open' }),
            h('button', { type: 'button', class: 'link small', onclick: () => { saveCfg(forget(cfg(), r.repo)); paint(); }, text: 'Remove from list' })))));
    list.replaceChildren(...rows);
  };
  const list = h('div', { id: 'reviews-list' });
  const look = h('button', { type: 'button', class: 'btn', id: 'reviews-find', text: 'Look for reviews on GitHub' });
  look.addEventListener('click', async () => {
    look.disabled = true; msg.textContent = 'Looking…';
    try {
      const found = await findReviews(cfg());
      let c = cfg();
      const before = knownReviews(c).length;
      for (const r of found) if (!(c.hidden || []).includes(r.repo)) c = remember(c, r.repo, r.title);
      c = { ...c, found_at: new Date().toISOString() };
      saveCfg(c);
      const added = knownReviews(c).length - before;
      msg.textContent = added ? `Found ${added} more review${added > 1 ? 's' : ''}.` : 'No other reviews found. Add one by its repository below.';
    } catch (e) { msg.textContent = `Could not look just now (${e.message}).`; }
    look.disabled = false; paint();
  });
  const addBox = h('input', { type: 'text', id: 'reviews-add', placeholder: 'owner/repo', autocomplete: 'off' });
  const add = () => {
    const v = addBox.value.trim();
    if (!validRepo(v)) { msg.textContent = 'Enter the repository as owner/name.'; return; }
    onOpen(v);
  };
  addBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  main.replaceChildren(h('div', { class: 'page narrow', id: 'reviews-page' },
    h('h1', { text: 'Your reviews' }),
    h('p', { class: 'muted', text: 'One sign-in opens every review your GitHub token can see. Changes not yet on GitHub stay saved on this device and sync when you next open that review.' }),
    list,
    h('div', { class: 'row' }, look, msg),
    h('h2', { text: 'Add a review' }),
    h('div', { class: 'row' }, addBox, h('button', { type: 'button', class: 'btn', id: 'reviews-add-go', onclick: add, text: 'Add and open' }))));
  paint();
}
