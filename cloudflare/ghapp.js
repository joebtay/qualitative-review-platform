// The GitHub App's sign-in: a short JWT signed with the App's private key (RS256), which GitHub swaps for a
// one-repo installation token (service.js). The key is the .pem GitHub gives (PKCS#1, "BEGIN RSA PRIVATE KEY"),
// a PKCS#8 .pem, or either as one line of base64 (cloudflare/one-line-key.mjs), so it pastes into a settings box.

const te = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** DER length bytes. */
function derLen(n) {
  if (n < 0x80) return [n];
  const out = [];
  for (let x = n; x > 0; x >>= 8) out.unshift(x & 0xff);
  return [0x80 | out.length, ...out];
}

/** Wraps a PKCS#1 RSA key in PKCS#8, which WebCrypto imports. */
function pkcs1to8(der) {
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const oct = [0x04, ...derLen(der.length)];
  const inner = [0x02, 0x01, 0x00, ...alg, ...oct];
  const total = inner.length + der.length;
  const out = new Uint8Array([0x30, ...derLen(total), ...inner, ...der]);
  return out;
}

/** The key's DER bytes as PKCS#8. */
export function keyDer(text) {
  const b = String(text || '').replace(/-----(BEGIN|END)[A-Z ]*-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  // after the outer SEQUENCE and its length, both forms start INTEGER 0; PKCS#8 then has a SEQUENCE (0x30),
  // PKCS#1 another INTEGER (0x02)
  let i = 1;
  i += der[i] & 0x80 ? 1 + (der[i] & 0x7f) : 1;
  const next = der[i + 3];
  if (der[0] !== 0x30 || der[i] !== 0x02 || (next !== 0x30 && next !== 0x02)) throw new Error('GITHUB_APP_PRIVATE_KEY is not an RSA private key');
  return next === 0x30 ? der : pkcs1to8(der);
}

const keys = new Map();
async function importKey(text) {
  if (!keys.has(text)) keys.set(text, await crypto.subtle.importKey('pkcs8', keyDer(text), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']));
  return keys.get(text);
}

/** A JWT for the App, valid 9 minutes (GitHub allows 10), dated a minute back for clock drift. */
export async function appJwt(appId, privateKey, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const head = b64u(te.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64u(te.encode(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId).trim() })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(privateKey), te.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}
