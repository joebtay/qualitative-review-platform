// Name-and-password sign-in on the Cloudflare site (section.js, cloudflare/service.js). The sign-in service checks
// the password and gives a 30-day session; the app then reads and saves through it, at /api/gh, with no GitHub
// token. The session is kept on this device under rc:session until it ends or the coder signs out.

import { h } from './ui.js';

export const SESSION_KEY = 'rc:session';
export const SERVICE_API = () => location.origin + '/api/gh';

/** The session saved on this device, or null when there is none or it has ended. */
export function serviceSession() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!s || !s.token || !(Date.parse(s.expires) > Date.now()) || !Array.isArray(s.projects)) { clearSession(); return null; }
  return s;
}
export function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

const until = (s) => new Date(s.expires).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** The sign-in form. onDone runs once a session is saved. */
export function serviceSignIn(app, { title, msg, onDone }) {
  const name = h('input', { type: 'text', id: 'name', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const password = h('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
  const err = h('div', { class: 'warnline', id: 'err', text: msg || '' });
  const button = h('button', { type: 'submit', class: 'btn primary', id: 'signin', text: 'Sign in' });
  const go = async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!name.value.trim() || !password.value) { err.textContent = 'Enter your name and your password.'; return; }
    button.disabled = true;
    let r, j = {};
    try {
      r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value.trim(), password: password.value }) });
      try { j = await r.json(); } catch {}
    } catch { r = null; }
    button.disabled = false;
    if (!r) { err.textContent = 'Could not reach the review site. Check your connection and try again.'; return; }
    if (!r.ok || !j.token) { err.textContent = j.message || 'Sign-in failed.'; password.value = ''; password.focus(); return; }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(j)); } catch {}
    onDone();
  };
  app.replaceChildren(h('div', { class: 'signin' },
    h('h1', { text: 'Review Coder' }),
    h('p', { class: 'muted', id: 'section-title', text: title || 'Sign in to open your review.' }),
    h('form', { onsubmit: go, id: 'signin-form' },
      h('label', null, 'Name', name), h('label', null, 'Password', password),
      err, h('div', { class: 'row' }, button, h('button', { type: 'button', class: 'link', id: 'forgot', onclick: () => forgotForm(app, { title, onDone, name: name.value.trim() }), text: 'Forgot your password?' }))),
    h('p', { class: 'small muted', text: 'Your name and password come from the project lead. You stay signed in on this device for 30 days, or until you sign out. Sign out when you finish on a shared computer.' })));
  name.focus();
}

const post = async (path, body) => {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch {}
    return { ok: r.ok, j };
  } catch { return { ok: false, j: { message: 'Could not reach the review site. Check your connection and try again.' } }; }
};

/** "Forgot your password?": the coder gives their name; a link comes by email if they have a confirmed address. */
function forgotForm(app, { title, onDone, name: given }) {
  const name = h('input', { type: 'text', id: 'forgot-name', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', value: given || '' });
  const msg = h('div', { id: 'forgot-msg' });
  const button = h('button', { type: 'submit', class: 'btn primary', id: 'forgot-send', text: 'Email me a link' });
  const go = async (e) => {
    e.preventDefault();
    if (!name.value.trim()) return;
    button.disabled = true;
    msg.replaceChildren(h('div', { class: 'muted', style: 'margin:8px 0', text: 'Sending…' }));
    const r = await post('/api/forgot', { name: name.value.trim() });
    button.disabled = false;
    msg.replaceChildren(h('div', { class: r.ok ? 'okline' : 'warnline', style: 'margin:8px 0', text: r.j.message || 'Something went wrong. Try again.' }));
  };
  app.replaceChildren(h('div', { class: 'signin' },
    h('h1', { text: 'Forgot your password?' }),
    h('p', { class: 'muted', text: 'Give your name. We email a link to set a new password to the address the project lead has for you.' }),
    h('form', { onsubmit: go, id: 'forgot-form' }, h('label', null, 'Name', name), msg, h('div', { class: 'row' }, button,
      h('button', { type: 'button', class: 'link', id: 'forgot-back', onclick: () => serviceSignIn(app, { title, onDone }), text: 'Back to sign in' }))),
    h('p', { class: 'small muted', text: 'No email? Ask the project lead for a new password.' })));
  name.focus();
}

/** The page a reset link opens: choose a new password, then go straight in. */
export function resetForm(app, token, { onDone }) {
  const pw = h('input', { type: 'password', id: 'new-password', autocomplete: 'new-password' });
  const again = h('input', { type: 'password', id: 'new-password-again', autocomplete: 'new-password' });
  const err = h('div', { class: 'warnline', id: 'reset-err' });
  const button = h('button', { type: 'submit', class: 'btn primary', id: 'reset-save', text: 'Set password and sign in' });
  const go = async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pw.value.length < 12) { err.textContent = 'Use at least 12 characters.'; return; }
    if (pw.value !== again.value) { err.textContent = 'The two passwords are not the same.'; return; }
    button.disabled = true;
    const r = await post('/api/reset', { token, password: pw.value });
    button.disabled = false;
    if (!r.ok || !r.j.token) { err.textContent = r.j.message || 'That did not work. Ask for a new link.'; return; }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(r.j)); } catch {}
    try { history.replaceState(null, '', location.pathname); } catch {}
    onDone();
  };
  app.replaceChildren(h('div', { class: 'signin' },
    h('h1', { text: 'Choose a new password' }),
    h('p', { class: 'muted', text: 'At least 12 characters. A short sentence you will remember works well.' }),
    h('form', { onsubmit: go, id: 'reset-form' }, h('label', null, 'New password', pw), h('label', null, 'New password again', again), err, h('div', { class: 'row' }, button))));
  pw.focus();
}

const signOut = () => h('button', { type: 'button', class: 'btn', id: 'signout', onclick: () => { clearSession(); location.reload(); }, text: 'Sign out' });
const links = (s) => h('ul', { id: 'my-projects' }, s.projects.map((p) => h('li', null, h('a', { href: p.path, text: p.title }))));

/** The root page, for a coder with more than one review (or none). */
export function projectList(app, s) {
  app.replaceChildren(h('div', { class: 'signin' }, h('h1', { text: 'Your reviews' }),
    s.projects.length ? links(s) : h('p', { text: 'Your sign-in does not open any review yet. Ask the project lead.' }),
    h('p', { class: 'small muted', text: `Signed in as ${s.name} until ${until(s)}.` }), h('div', { class: 'row' }, signOut())));
}

/** A section the coder's sign-in does not include. */
export function notYours(app, s, title) {
  app.replaceChildren(h('div', { class: 'signin' }, h('h1', { text: title || 'Review Coder' }),
    h('p', { id: 'not-yours', text: 'Your sign-in does not include this review.' }),
    s.projects.length ? [h('p', { text: 'Your reviews:' }), links(s)] : null,
    h('div', { class: 'row' }, signOut())));
}

/** The review would not open through the service (for example, the saving App is not on the repo yet). */
export function serviceProblem(app, title, message) {
  app.replaceChildren(h('div', { class: 'signin' }, h('h1', { text: title || 'Review Coder' }),
    h('div', { class: 'warnline', id: 'err', text: `The review did not open: ${message}` }),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => location.reload(), text: 'Try again' }), signOut())));
}
