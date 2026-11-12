#!/usr/bin/env node
// Turns the GitHub App's private key file (.pem) into one line, for the Cloudflare setting GITHUB_APP_PRIVATE_KEY.
//   node cloudflare/one-line-key.mjs ~/Downloads/<app-name>.<date>.private-key.pem
// Prints the line only. Paste it into Cloudflare, then delete the .pem from Downloads.
import fs from 'node:fs';
import { keyDer } from './ghapp.js';

const f = process.argv[2];
if (!f || !fs.existsSync(f)) { console.error('Give the path of the .pem file GitHub downloaded.'); process.exit(1); }
const text = fs.readFileSync(f, 'utf8');
try { keyDer(text); } catch (e) { console.error(e.message.replace('GITHUB_APP_PRIVATE_KEY', 'This file')); process.exit(1); }
console.log(text.replace(/-----(BEGIN|END)[A-Z ]*-----/g, '').replace(/\s+/g, ''));
