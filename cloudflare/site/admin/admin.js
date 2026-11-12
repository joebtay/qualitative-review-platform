// The project lead's page (PI, 24 October 2026): coders and passwords, progress, the welcome page, and the PI's own
// password. Talks only to /api/admin/ (cloudflare/admin.js). The PI's session is kept on this device for 12 hours.
// A new password is shown once, here, to send on; the service keeps only its scrambled form.

const KEY = 'rc:admin';
const root = document.getElementById('admin');
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const session = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && Date.parse(s.expires) > Date.now() ? s : null; } catch { return null; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const forget = () => { try { localStorage.removeItem(KEY); } catch {} };
const site = location.origin + '/';

async function api(path, method = 'GET', body) {
  const s = session();
  const r = await fetch('/api/admin' + path, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401 && path !== '/login') { forget(); signIn('Your sign-in has ended. Sign in again.'); throw new Error('signed out'); }
  if (!r.ok) throw Object.assign(new Error(j.message || `Error ${r.status}`), { status: r.status });
  return j;
}

function signIn(msg) {
  const pw = h('input', { type: 'password', id: 'admin-password', autocomplete: 'current-password' });
  const err = h('div', { class: 'warnline', id: 'err', text: msg || '' });
  const go = async (e) => {
    e.preventDefault(); err.textContent = '';
    try { save(await api('/login', 'POST', { password: pw.value })); main(); } catch (x) { err.textContent = x.message; pw.value = ''; }
  };
  root.replaceChildren(h('div', { class: 'signin', style: 'margin-top:4vh' }, h('h1', { text: 'Project lead' }),
    h('p', { class: 'muted', text: 'Add coders, make new passwords, see progress and edit the welcome page.' }),
    h('form', { onsubmit: go }, h('label', { class: 'f' }, 'Your password', pw), err, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', id: 'admin-signin', text: 'Sign in' })))));
  pw.focus();
}

let tab = 'coders';
function main() {
  const body = h('div', { id: 'tab-body' });
  const tabs = [['coders', 'Coders'], ['progress', 'Progress'], ['welcome', 'Welcome page'], ['password', 'Your password']];
  const bar = h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { type: 'button', class: 'pill' + (k === tab ? ' on' : ''), id: `tab-${k}`, onclick: () => { tab = k; main(); }, text: l })));
  root.replaceChildren(h('div', { class: 'head' }, h('div', null, h('h1', { text: 'Project lead' }), h('p', { class: 'muted small' }, h('a', { href: '/signin/', text: 'Coders\' sign-in' }))),
    h('button', { type: 'button', class: 'btn', id: 'admin-signout', onclick: () => { forget(); signIn(); }, text: 'Sign out' })), bar, body);
  ({ coders, progress, welcome, password })[tab](body).catch((e) => { if (e.message !== 'signed out') body.replaceChildren(h('div', { class: 'warnline', text: e.message })); });
}

// ---- coders ----

function shown(name, password, warning) {
  const msg1 = `Hi. The review platform is at ${site}\nSign in there. Your name is: ${name}\nI will send your password separately.`;
  const copy = (t) => h('button', { type: 'button', class: 'btn small', onclick: () => navigator.clipboard && navigator.clipboard.writeText(t), text: 'Copy' });
  return h('div', { class: 'shown', id: 'shown' },
    password ? [h('p', null, `Password for ${name}: `, h('code', { id: 'shown-password', text: password }), ' ', copy(password)),
      h('p', { class: 'small', text: 'Copy it now. It is not shown again. Send the name and the password by different routes, for example the message below by email and the password by text.' }),
      h('pre', { class: 'small', style: 'white-space:pre-wrap;margin:6px 0', text: msg1 }), copy(msg1)] : h('p', { text: `${name} is added. They already have a password.` }),
    warning ? h('div', { class: 'warnline', text: warning }) : null);
}

async function coders(body, note) {
  const st = await api('/state');
  const reviews = st.projects;
  const act = (label, id, fn) => h('button', { type: 'button', class: 'btn small', id, onclick: fn, text: label });
  const rows = st.coders.map((c) => h('tr', { id: `coder-${c.name}` },
    h('td', null, h('b', { text: c.name }), h('div', { class: 'muted small', text: `folder: ${c.handle}` })),
    h('td', null, c.projects.map((p) => h('div', { class: 'small' }, `${(reviews.find((r) => r.id === p.id) || {}).title || p.id}`, h('span', { class: 'muted', text: ` · ${p.repo}${p.on ? '' : ' · switched off'}` })))),
    h('td', { class: 'small hide-s' }, c.contact || '', c.contact && c.confirmed === true ? h('div', { class: 'ok', text: 'confirmed' }) : null,
      c.contact && c.confirmed === false ? h('div', { class: 'muted', title: 'Cloudflare emailed them a link to confirm this address. Until they click it, Forgot password emails cannot reach them.', text: 'waiting for them to confirm' }) : null),
    h('td', null, c.locked ? h('span', { class: 'look', text: 'Locked' }) : c.password ? h('span', { class: 'ok', text: 'Ready' }) : h('span', { class: 'muted', text: 'No password' })),
    h('td', null, h('div', { class: 'row', style: 'margin-top:0' },
      act('New password', `pw-${c.name}`, async () => {
        if (!confirm(`Make a new password for ${c.name}? Their old password stops working at once.`)) return;
        const r = await api(`/coders/${c.name}/password`, 'POST', {}); coders(body, shown(c.name, r.password));
      }),
      c.locked ? act('Unlock', `unlock-${c.name}`, async () => { await api(`/coders/${c.name}/unlock`, 'POST', {}); coders(body); }) : null,
      act('Email', `email-${c.name}`, async () => {
        const v = prompt(`Email address for ${c.name}, for password resets (leave empty to clear):`, c.contact || '');
        if (v === null) return;
        try { const r = await api(`/coders/${c.name}/contact`, 'POST', { contact: v }); if (r.warning) alert(r.warning); coders(body); } catch (e) { alert(e.message); }
      }),
      c.projects.some((p) => p.from === 'page') ? act('Remove', `remove-${c.name}`, async () => {
        if (!confirm(`Remove ${c.name}? They can no longer sign in. Their work stays in their repository.`)) return;
        try { await api(`/coders/${c.name}/remove`, 'POST', {}); coders(body); } catch (e) { alert(e.message); }
      }) : null))));

  const f = { name: h('input', { id: 'add-name', autocomplete: 'off', placeholder: 'e.g. alex' }), project: h('select', { id: 'add-project' }, reviews.map((r) => h('option', { value: r.id, text: r.title + (r.on ? '' : ' (switched off)') }))),
    repo: h('input', { id: 'add-repo', autocomplete: 'off', placeholder: 'joebtay/...' }), github: h('input', { id: 'add-github', autocomplete: 'off' }), contact: h('input', { id: 'add-contact', type: 'email', autocomplete: 'off' }) };
  const err = h('div', { class: 'warnline', id: 'add-err' });
  const add = async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await api('/coders', 'POST', { name: f.name.value, project: f.project.value, repo: f.repo.value, github: f.github.value, contact: f.contact.value });
      coders(body, shown(r.name, r.password, r.warning));
    } catch (x) { err.textContent = x.message; }
  };
  body.replaceChildren(...[note,
    st.app ? null : h('div', { class: 'warnline', text: 'The GitHub App is not set up on the site yet, so coders cannot open their reviews.' }),
    st.mail ? null : h('div', { class: 'warnline', id: 'mail-off', text: 'Email is not set up on the site yet, so Forgot password sends nothing. Use New password and send it yourself.' }),
    h('section', { class: 'card' }, h('h2', { text: 'Coders' }),
      st.coders.length ? h('table', { class: 't', id: 'coders' }, h('thead', null, h('tr', null, ['Name', 'Reviews and repository', 'Email', 'Status', ''].map((t, i) => h('th', { class: i === 2 ? 'hide-s' : null, text: t })))), h('tbody', null, rows))
        : h('p', { class: 'muted', text: 'No coders yet.' })),
    h('section', { class: 'card', style: 'margin-top:14px' }, h('h2', { text: 'Add a coder' }),
      h('p', { class: 'small muted', text: 'Each coder needs their own team repository, with the saving App installed on it. Ask Claude to build one if it does not exist yet.' }),
      h('form', { onsubmit: add, id: 'add-form' }, h('div', { class: 'grid' },
        h('label', { class: 'f' }, 'Sign-in name', f.name), h('label', { class: 'f' }, 'Review', f.project), h('label', { class: 'f' }, 'Their team repository', f.repo),
        h('label', { class: 'f' }, 'GitHub username (optional: links their saves to their GitHub profile; use it to keep an existing work folder)', f.github),
        h('label', { class: 'f' }, 'Email (optional: Cloudflare asks them to confirm it once; then they can reset their own password)', f.contact)),
      err, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', id: 'add-submit', text: 'Add coder and make a password' })))),
    st.mail ? mailCard(st) : null].filter(Boolean));
}

/** Email: the last email the site tried to send, with Cloudflare's reason if it refused, and a test email. */
function mailCard(st) {
  const L = st.mailLast;
  const when = L ? new Date(L.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const last = !L ? h('p', { class: 'muted', id: 'mail-last', text: 'The site has not sent an email yet.' })
    : L.ok ? h('p', { class: 'ok', id: 'mail-last', text: `Last email: sent ${when}.` })
    : h('p', { class: 'warnline', id: 'mail-last', text: `Last email: not sent ${when}. Cloudflare said: ${L.said}` });
  const to = h('input', { id: 'mail-test-to', type: 'email', autocomplete: 'email', placeholder: 'an address confirmed in Cloudflare' });
  const out = h('div', { id: 'mail-test-out' });
  const test = async (e) => {
    e.preventDefault(); out.replaceChildren(h('p', { class: 'muted', text: 'Sending…' }));
    try { const r = await api('/mail-test', 'POST', { to: to.value }); out.replaceChildren(h('p', { class: r.ok ? 'ok' : 'warnline', text: r.message })); }
    catch (x) { out.replaceChildren(h('p', { class: 'warnline', text: x.message })); }
  };
  return h('section', { class: 'card', style: 'margin-top:14px', id: 'mail-card' }, h('h2', { text: 'Email' }), last,
    h('form', { onsubmit: test, id: 'mail-test-form' }, h('label', { class: 'f' }, 'Send a test email to', to), out,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit', id: 'mail-test-send', text: 'Send a test email' }))));
}

// ---- progress ----

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none yet');
const STATE = { finished: 'Finished', active: 'Active', stale: 'No activity for a week or more', 'none-yet': 'Not started', nothing: 'Nothing assigned' };

async function progress(body) {
  body.replaceChildren(h('p', { class: 'muted', text: 'Counting, from each coder\'s repository' }));
  const p = await api('/progress');
  body.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('p', { class: 'muted small', id: 'progress-at', text: `Counted ${new Date(p.at).toLocaleString('en-GB')}. Counts and dates only.` }),
      h('button', { type: 'button', class: 'btn small', id: 'progress-refresh', onclick: () => progress(body), text: 'Refresh' })),
    h('div', null, p.projects.length ? p.projects.map((r) => h('section', { class: 'card', style: 'margin-top:12px', id: `progress-${r.id}` }, h('h2', null, r.title, r.on ? null : h('span', { class: 'status', style: 'margin-left:8px', text: 'switched off' })),
      h('table', { class: 't' }, h('thead', null, h('tr', null, ['Coder', 'Screening', 'Samples', 'Last activity', 'Status'].map((t) => h('th', { text: t })))),
        h('tbody', null, r.people.map((c) => h('tr', null, h('td', null, h('b', { text: c.name }), h('div', { class: 'muted small', text: c.repo })),
          c.error ? h('td', { colspan: 4, class: 'small bad', text: c.error }) : [
            h('td', { text: c.screening ? `${c.screening.decided} of ${c.screening.assigned} decided` : '' }),
            h('td', null, (c.samples || []).map((s) => h('div', { class: 'small', text: `${s.title}: ${s.done} of ${s.assigned}${s.submitted ? ', submitted' : ''}` }))),
            h('td', { text: c.last ? `${day(c.last)} (${c.days === 0 ? 'today' : c.days === 1 ? 'yesterday' : `${c.days} days ago`})` : 'none yet' }),
            h('td', { class: c.look ? 'look' : '', text: STATE[c.state] || '' })]))))))
      : h('p', { class: 'muted', text: 'No coders yet.' })));
}

// ---- welcome page ----

async function welcome(body) {
  const c = await api('/welcome');
  const title = h('input', { id: 'w-title', value: c.intro.title }), intro = h('textarea', { id: 'w-text', rows: 3 }, c.intro.text);
  const per = c.projects.map((p) => ({ p,
    status: h('input', { id: `w-status-${p.id}`, value: p.status }), description: h('textarea', { id: `w-desc-${p.id}`, rows: 4 }, p.description),
    links: h('textarea', { id: `w-links-${p.id}`, rows: 3 }, p.links.map((l) => `${l.label} | ${l.url}`).join('\n')),
    team: h('textarea', { id: `w-team-${p.id}`, rows: 3 }, p.team.map((m) => (m.role ? `${m.name} | ${m.role}` : m.name)).join('\n')) }));
  const msg = h('div', { id: 'w-msg' });
  const lines = (t) => t.value.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => x.split('|').map((y) => y.trim()));
  const go = async (e) => {
    e.preventDefault(); msg.replaceChildren();
    const out = { intro: { title: title.value.trim(), text: intro.value.trim() }, projects: {} };
    for (const x of per) out.projects[x.p.id] = { status: x.status.value.trim(), description: x.description.value.trim(),
      links: lines(x.links).map(([label, url]) => ({ label, url: url || '' })), team: lines(x.team).map(([name, role]) => ({ name, role: role || '' })) };
    try { await api('/welcome', 'PUT', out); msg.replaceChildren(h('div', { class: 'okline', style: 'margin:8px 0', text: 'Saved. The welcome page shows it within a minute.' })); }
    catch (x) { msg.replaceChildren(h('div', { class: 'warnline', text: x.message })); }
  };
  body.replaceChildren(h('form', { onsubmit: go, id: 'w-form' },
    c.public ? h('p', { class: 'small muted' }, 'Everyone can see this page, before signing in. Publish only what you are happy to make public. ', h('a', { href: '/', target: '_blank', text: 'Open the welcome page' }))
      : h('p', { class: 'small muted', id: 'w-private', text: 'Nobody can see this page at the moment: the address opens on the sign-in page. You can edit the text here and it stays private.' }),
    h('section', { class: 'card' }, h('h2', { text: 'Introduction' }), h('label', { class: 'f' }, 'Heading', title), h('label', { class: 'f' }, 'Text', intro)),
    per.map((x) => h('section', { class: 'card', style: 'margin-top:12px' }, h('h2', { text: x.p.title }),
      h('label', { class: 'f' }, 'Status (for example: Full-text screening, On hold)', x.status), h('label', { class: 'f' }, 'Short description', x.description),
      h('label', { class: 'f' }, 'Links, one per line: label | https://address', x.links), h('label', { class: 'f' }, 'Team, one per line: name | role', x.team))),
    msg, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', id: 'w-save', text: 'Save the welcome page' }))));
}

// ---- the PI's own password ----

async function password(body) {
  const cur = h('input', { type: 'password', id: 'p-current', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', id: 'p-next', autocomplete: 'new-password' });
  const again = h('input', { type: 'password', id: 'p-again', autocomplete: 'new-password' });
  const msg = h('div', { id: 'p-msg' });
  const go = async (e) => {
    e.preventDefault(); msg.replaceChildren();
    if (next.value !== again.value) { msg.replaceChildren(h('div', { class: 'warnline', text: 'The two new passwords are not the same.' })); return; }
    try { save(await api('/password', 'POST', { current: cur.value, next: next.value })); msg.replaceChildren(h('div', { class: 'okline', style: 'margin:8px 0', text: 'Changed. Use the new password next time.' })); cur.value = next.value = again.value = ''; }
    catch (x) { msg.replaceChildren(h('div', { class: 'warnline', text: x.message })); }
  };
  body.replaceChildren(h('section', { class: 'card', style: 'max-width:460px' }, h('h2', { text: 'Your password' }),
    h('form', { onsubmit: go }, h('label', { class: 'f' }, 'Current password', cur), h('label', { class: 'f' }, 'New password (at least 12 characters)', next), h('label', { class: 'f' }, 'New password again', again),
      msg, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', id: 'p-save', text: 'Change password' })))));
}

if (session()) main(); else signIn();
