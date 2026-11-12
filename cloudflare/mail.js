// Email for the sign-in service (PI, 25 October 2026): "Forgot password" links, sent free through Cloudflare's Email
// Service to addresses the coder has confirmed once (Cloudflare "destination addresses"). A coder's email is
// registered when the PI adds it on /admin/; Cloudflare then sends them a one-off "verify this address" message.
// Cloudflare refuses to send to an address that is not confirmed, so nothing reaches an unconfirmed address.
//
// Settings: EMAIL_API_TOKEN (a Cloudflare key with Email Routing Addresses Edit and Email Sending Edit, never in a
// repo). The sender is projects.json "site.mail_from" on the PI's own address. CF_API is for the tests only.

const ACCOUNT = '8b5bfe489e81009d1422dc0204265744'; // the Cloudflare account (an identifier, not a secret)

export const mailReady = (env) => !!env.EMAIL_API_TOKEN;

async function cf(env, path, { method = 'GET', body } = {}) {
  const r = await fetch(`${env.CF_API || 'https://api.cloudflare.com/client/v4'}/accounts/${env.CF_ACCOUNT_ID || ACCOUNT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.EMAIL_API_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'review-coder-signin' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { ok: r.ok && !!(j && j.success), status: r.status, j };
}

/** Ask Cloudflare to confirm an address: it emails the person a link once. An address already known is fine. */
export async function registerAddress(env, email) {
  if (!mailReady(env)) return { ok: false, message: 'Email is not set up on the site yet.' };
  const r = await cf(env, '/email/routing/addresses', { method: 'POST', body: { email } });
  if (r.ok) return { ok: true };
  const msg = ((r.j && r.j.errors) || []).map((e) => e.message || '').join(' ');
  if (/exist|duplicate/i.test(msg)) return { ok: true };
  return { ok: false, message: `Cloudflare did not take the address (${r.status}).` };
}

/** Which addresses are confirmed: Map of lower-case email to true (confirmed) or false (waiting). Null if unknown. */
export async function addressStatus(env) {
  if (!mailReady(env)) return null;
  const out = new Map();
  for (let page = 1; page <= 10; page++) {
    const r = await cf(env, `/email/routing/addresses?per_page=50&page=${page}`);
    if (!r.ok) return null;
    for (const a of r.j.result || []) out.set(String(a.email || '').toLowerCase(), !!a.verified);
    if ((r.j.result || []).length < 50) break;
  }
  return out;
}

/** Send one plain-text email. Cloudflare refuses an address that is not confirmed. The outcome, with Cloudflare's
 *  own words when it refuses, is kept as KV "mail:last" for the PI's page (no address, no link). */
export async function sendMail(env, projects, { to, subject, text }, now = Date.now()) {
  if (!mailReady(env)) return { ok: false };
  const site = projects.site || {};
  if (!site.mail_from) return { ok: false };
  let r;
  try {
    r = await cf(env, '/email/sending/send', { method: 'POST', body: { from: site.mail_name ? { address: site.mail_from, name: site.mail_name } : site.mail_from, to, subject, text } });
  } catch (e) { r = { ok: false, status: 0, j: { errors: [{ message: `Could not reach Cloudflare (${(e && e.message) || e}).` }] } }; }
  const res = (r.j && r.j.result) || {};
  const bounced = (res.permanent_bounces || []).length;
  const ok = r.ok && !bounced;
  const said = ok ? '' : bounced ? 'The address bounced.' : ((r.j && r.j.errors) || []).map((e) => [e.code, e.message].filter(Boolean).join(' ')).join('; ') || 'No reason given.';
  const last = { t: new Date(now).toISOString(), ok, status: r.status, queued: (res.queued || []).length > 0, said };
  if (!ok) console.log(`review-coder mail: refused (${r.status}) ${said}`);
  try { await env.LOCKS.put('mail:last', JSON.stringify(last)); } catch {}
  return { ok, status: r.status, said };
}
