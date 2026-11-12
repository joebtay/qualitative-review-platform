// The progress dashboard on the PI's page (PI, 24 October 2026): for each review and coder, items done of assigned,
// records decided of assigned, last activity, and a flag when work is outstanding and nothing has happened for a week.
// Counts and dates only, by the progress page's own rules (count.js): every file is cut down the moment it is read,
// so no code, decision, reason, note or comment reaches the page. Read only, through the App, from team repos only;
// a master is never read. Each repo is read in one GitHub request (GraphQL), to stay inside Cloudflare's limits.

import { reduceFile, kindOf, projectModel, needsLook } from './count.js';
import { masters, lower } from './service.js';

const BLOB = '... on Blob { text isTruncated }';
const QUERY = `query($o: String!, $n: String!) { repository(owner: $o, name: $n) {
  review: object(expression: "HEAD:review.json") { ${BLOB} }
  setup: object(expression: "HEAD:setup.json") { ${BLOB} }
  records: object(expression: "HEAD:screening/records.json") { ${BLOB} }
  samples: object(expression: "HEAD:samples") { ... on Tree { entries { name object { ${BLOB} } } } }
  work: object(expression: "HEAD:work") { ... on Tree { entries { name object { ... on Tree { entries { name object { ${BLOB} } } } } } } }
} }`;

/** One team repo, cut down: {repo, review, setup, samples, records, agreed, first, work: {handle: events}} or {repo, error}. */
async function readRepo(env, projects, repo, now, { repoToken, gh }) {
  const token = await repoToken(env, projects, repo, now);
  if (!token) return { repo, error: 'The GitHub App is not installed on this repository.' };
  const [o, n] = repo.split('/');
  const r = await gh(env, '/graphql', { method: 'POST', token, body: { query: QUERY, variables: { o, n } } });
  const j = r.ok ? await r.json() : null;
  const d = j && j.data && j.data.repository;
  if (!d) return { repo, error: `GitHub did not answer (${r.status}).` };
  // a file is parsed, cut down by count.js and the parsed copy dropped; a file GitHub truncates is read on its own
  const read = async (path, obj) => {
    let text = obj && obj.text;
    if (obj && obj.isTruncated) {
      const raw = await gh(env, `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { token, accept: 'application/vnd.github.raw+json' });
      text = raw.ok ? await raw.text() : null;
    }
    if (typeof text !== 'string') return undefined;
    try { return JSON.parse(text); } catch { return undefined; }
  };
  const out = { repo, master: false, samples: [], records: null, agreed: [], first: null, work: {} };
  out.review = reduceFile('review', await read('review.json', d.review));
  out.setup = d.setup ? reduceFile('setup', await read('setup.json', d.setup)) : null;
  const sc = out.review && out.review.screening;
  if (sc) {
    if (sc.records === 'screening/records.json') out.records = reduceFile('records', await read(sc.records, d.records)) || [];
    else {
      const raw = await gh(env, `/repos/${repo}/contents/${sc.records.split('/').map(encodeURIComponent).join('/')}`, { token, accept: 'application/vnd.github.raw+json' });
      out.records = raw.ok ? reduceFile('records', JSON.parse(await raw.text())) : [];
    }
  }
  for (const e of (d.samples && d.samples.entries) || []) {
    if (!/\.json$/.test(e.name)) continue;
    const s = reduceFile('sample', await read(`samples/${e.name}`, e.object));
    if (s) out.samples.push(s);
  }
  for (const h of (d.work && d.work.entries) || []) {
    for (const f of (h.object && h.object.entries) || []) {
      const p = `work/${h.name}/${f.name}`;
      if (kindOf(p, out.review) !== 'work') continue;
      (out.work[h.name] ||= []).push(...(reduceFile('work', await read(p, f.object)) || []));
    }
  }
  return out;
}

/** The dashboard: each review with each coder's counts. coders: admin.js allCoders(). */
export async function progress(env, projects, coders, now, deps) {
  const out = { at: new Date(now).toISOString(), projects: [] };
  for (const [id, p] of Object.entries(projects.projects || {})) {
    const never = masters(projects);
    const mine = coders.flatMap((c) => c.projects.filter((x) => x.id === id && !never.has(lower(x.repo))).map((x) => ({ name: c.name, handle: c.handle, repo: x.repo })));
    if (!mine.length) continue;
    const people = [];
    for (const c of mine) {
      let row = { name: c.name, handle: c.handle, repo: c.repo };
      try {
        const r = await readRepo(env, projects, c.repo, now, deps);
        if (r.error) row.error = r.error;
        else {
          const m = projectModel({ repos: [{ ...r, master: true }], now });
          const person = m.people.find((x) => x.handle === c.handle) || { samples: [], screening: r.records ? { assigned: r.records.length, decided: 0 } : null, last: null, days: null, state: r.records && r.records.length ? 'none-yet' : 'nothing' };
          row = { ...row, samples: person.samples, screening: person.screening, last: person.last, days: person.days, state: person.state, look: needsLook(person) };
        }
      } catch (e) { row.error = 'Could not read this repository just now.'; }
      people.push(row);
    }
    out.projects.push({ id, title: p.title || id, on: p.enabled === true, people });
  }
  return out;
}
