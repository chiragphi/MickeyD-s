#!/usr/bin/env node
/* Build step for static hosting.

   The game has no bundler and no dependencies. This stamps a content hash onto
   every <script src> query string, so a redeploy can never serve a stale mix of
   old and new modules while still allowing long-lived cache headers on src/*.

   Firebase config is NOT written into the bundle — it is served at runtime by
   /api/config from the deployment's environment variables, so no credentials
   ever land in the repository. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const SRC = path.join(root, 'src');

function reportConfig() {
  const ok = !!(process.env.FIREBASE_API_KEY && process.env.FIREBASE_DATABASE_URL);
  console.log(ok
    ? 'build: FIREBASE_* env vars present — /api/config will serve them at runtime'
    : 'build: no FIREBASE_* env vars — multiplayer will prompt players for their own project');
  return ok;
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

reportConfig();
stampCacheBuster();
console.log('build: done');
