// The welcome page's text (PI, 24 October 2026): a short introduction, then each review with its status, a short
// description, links and team. Public, shown before sign-in, so it holds only what the PI chooses to publish.
// The text starts from cloudflare/projects.json ("welcome", and each project's "about"); the PI edits it on /admin/
// and the edit is kept in KV site:welcome. Never names a coder's sign-in name, handle or repo unless the PI types it.
//   { intro: {title, text}, projects: {<id>: {status, description, links: [{label, url}], team: [{name, role}]}} }

import { json, refuse } from './service.js';

const LIMITS = { title: 120, text: 1500, status: 60, description: 1500, label: 80, url: 300, name: 80, role: 80 };
const str = (v, n) => typeof v === 'string' && v.length <= n;

/** A plain-text problem with the content, or null when it is fine. */
export function checkWelcome(c, projects) {
  if (!c || typeof c !== 'object') return 'Send the welcome text.';
  const i = c.intro || {};
  if (!str(i.title || '', LIMITS.title) || !str(i.text || '', LIMITS.text)) return 'The introduction is too long.';
  if (!c.projects || typeof c.projects !== 'object') return 'Send the reviews.';
  for (const [id, p] of Object.entries(c.projects)) {
    if (!(projects.projects || {})[id]) return `There is no review called ${id}.`;
    if (!p || typeof p !== 'object') return `${id}: send its text.`;
    if (!str(p.status || '', LIMITS.status) || !str(p.description || '', LIMITS.description)) return `${id}: the status or description is too long.`;
    for (const l of p.links || []) if (!l || !str(l.label || '', LIMITS.label) || !str(l.url || '', LIMITS.url) || !/^https:\/\/[^\s"'<>]+$/.test(l.url || '')) return `${id}: each link needs a short label and an address starting https://.`;
    for (const m of p.team || []) if (!m || !str(m.name || '', LIMITS.name) || !m.name || !str(m.role || '', LIMITS.role)) return `${id}: each team member needs a name, and a short role.`;
    if ((p.links || []).length > 10 || (p.team || []).length > 30) return `${id}: too many links or team members.`;
  }
  return null;
}

/** The text as published: the PI's edit if any, else the project list's. Only the fields above, nothing else. */
export async function welcomeContent(env, projects) {
  let saved = null;
  try { saved = env.LOCKS ? await env.LOCKS.get('site:welcome', 'json') : null; } catch {}
  const base = projects.welcome || {};
  const intro = (saved && saved.intro) || base.intro || { title: 'Review Coder', text: '' };
  const out = { intro: { title: intro.title || 'Review Coder', text: intro.text || '' }, projects: [] };
  for (const [id, p] of Object.entries(projects.projects || {})) {
    const a = (saved && saved.projects && saved.projects[id]) || p.about || {};
    out.projects.push({
      id, title: p.title || id, open: p.enabled === true, status: a.status || (p.enabled === true ? 'Open' : 'On hold'),
      description: a.description || '', links: (a.links || []).map(({ label, url }) => ({ label, url })), team: (a.team || []).map(({ name, role }) => ({ name, role: role || '' })),
    });
  }
  return out;
}

export async function welcome(request, env, projects) {
  if (request.method !== 'GET') return refuse(405, 'Use GET.');
  if (projects.site && projects.site.welcome_public === false) return refuse(404, 'Not found.'); // PI, 3 November 2026: projects.json "site.welcome_public"
  return json(200, await welcomeContent(env, projects), { 'Cache-Control': 'public, max-age=60' });
}
