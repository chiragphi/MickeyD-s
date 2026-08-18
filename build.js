#!/usr/bin/env node
/* Build step for static hosting.

   The game has no bundler and no dependencies — this does exactly two things:

   1. If FIREBASE_* environment variables are present (e.g. set on Vercel), it
      regenerates src/firebase-config.js from them. Otherwise the committed
      config is left alone, so local and file:// play keep working.

   2. Stamps a content hash onto every <script src> query string, so a redeploy
      can never serve a stale mix of old and new modules while still allowing
      long-lived cache headers on src/*.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const SRC = path.join(root, 'src');

const ENV = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  databaseURL: 'FIREBASE_DATABASE_URL',
  projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId: 'FIREBASE_APP_ID',
};

function writeConfigFromEnv() {
  if (!process.env[ENV.apiKey] || !process.env[ENV.databaseURL]) {
    console.log('build: no FIREBASE_* env vars — keeping the committed src/firebase-config.js');
    return false;
  }
  const cfg = {};
  for (const [key, envName] of Object.entries(ENV)) {
    if (process.env[envName]) cfg[key] = process.env[envName];
  }
  const body = Object.entries(cfg)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');
  fs.writeFileSync(path.join(SRC, 'firebase-config.js'),
    `/* Generated at build time from FIREBASE_* environment variables. Do not edit. */\n` +
    `window.FIREBASE_CONFIG = {\n${body}\n};\n`);
  console.log(`build: wrote src/firebase-config.js from env (${Object.keys(cfg).length} keys, project ${cfg.projectId || '?'})`);
  return true;
}

function stampCacheBuster() {
  const indexPath = path.join(root, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const hash = crypto.createHash('sha1');
  for (const f of fs.readdirSync(SRC).sort()) {
    if (f.endsWith('.js')) hash.update(fs.readFileSync(path.join(SRC, f)));
  }
  const v = hash.digest('hex').slice(0, 10);
  html = html.replace(/(<script src="src\/[a-z-]+\.js)(\?v=[^"]*)?"/g, `$1?v=${v}"`);
  fs.writeFileSync(indexPath, html);
  console.log(`build: stamped asset version ${v}`);
}

writeConfigFromEnv();
stampCacheBuster();
console.log('build: done');
