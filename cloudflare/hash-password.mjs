#!/usr/bin/env node
// Makes the scrambled form of a coder's password, for the Cloudflare setting PASSWORD_<NAME> (cloudflare/README.md).
//   node cloudflare/hash-password.mjs coderb              asks for the password (it is not shown as you type)
//   node cloudflare/hash-password.mjs coderb --new        makes a new password, prints it once, then its scrambled form
//   node cloudflare/hash-password.mjs --secret         makes a value for SESSION_SECRET
// The password itself is never saved anywhere. Send it to the coder by a different route from the link.
import { webcrypto } from 'node:crypto';
import { scramble } from './service.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const args = process.argv.slice(2);
// letters and digits that cannot be mistaken for each other (no 0/o, 1/l/i)
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
const pick = (n) => [...crypto.getRandomValues(new Uint32Array(n))].map((x) => ABC[x % ABC.length]).join('');

if (args.includes('--secret')) {
  console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'));
  process.exit(0);
}
const name = (args.find((a) => !a.startsWith('--')) || '').toLowerCase();
if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(name)) {
  console.error('Give the coder\'s sign-in name (lower case letters, digits, - or _), for example: node cloudflare/hash-password.mjs coderb');
  process.exit(1);
}
const setting = 'PASSWORD_' + name.toUpperCase().replace(/-/g, '_');

async function ask(q) {
  process.stdout.write(q);
  const { stdin } = process;
  if (!stdin.isTTY) { let s = ''; for await (const c of stdin) s += c; return s.replace(/\r?\n$/, ''); }
  stdin.setRawMode(true);
  let s = '';
  return new Promise((resolve) => stdin.on('data', function on(b) {
    for (const ch of b.toString('utf8')) {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); return resolve(s); }
      if (ch === '\u0003') process.exit(1);
      if (ch === '\u007f') s = s.slice(0, -1); else s += ch;
    }
  }));
}

let pw;
if (args.includes('--new')) {
  pw = [pick(4), pick(4), pick(4), pick(4)].join('-');
  console.log(`New password for ${name}: ${pw}`);
  console.log('Copy it now. It is not saved anywhere.\n');
} else {
  pw = await ask(`Password for ${name}: `);
  if (pw.length < 12) { console.error('Use at least 12 characters, or run with --new to make one.'); process.exit(1); }
}
console.log(`Setting name:  ${setting}`);
console.log(`Setting value: ${await scramble(pw)}`);
