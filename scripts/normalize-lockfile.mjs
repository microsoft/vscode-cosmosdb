#!/usr/bin/env node
// Normalizes package-lock.json so every `resolved` tarball URL points at the
// public npm registry instead of an internal Azure Artifacts feed.
//
// Why: npmjs.org is network-blocked inside Microsoft, so local `npm install`
// fetches through an Azure Artifacts upstream and writes feed URLs
// (e.g. https://<org>.pkgs.visualstudio.com/_packaging/<feed>/npm/registry/...)
// into the lockfile. That committed lock breaks external consumers and CI that
// clone from GitHub, because they cannot authenticate to the feed.
//
// npm only re-homes a `resolved` URL to the configured registry when it is in
// the *npmjs-canonical* shape. A feed URL is treated as a foreign absolute URL
// and fetched literally -> 401/EALLOWREMOTE. So the committed lock must be
// npmjs-canonical; the environment's .npmrc (feed for internal builds, default
// npmjs for external/CI) then decides where bytes are actually pulled from.
//
// Integrity is preserved: an Azure Artifacts npm upstream is a byte-identical
// passthrough of npmjs, so the sha512 in `integrity` already matches the npmjs
// tarball. Only the host+feed path segment is rewritten.
//
// Usage:
//   node scripts/normalize-lockfile.mjs            # rewrite in place
//   node scripts/normalize-lockfile.mjs --check    # exit 1 if any feed URL remains (CI guard)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NPMJS = 'https://registry.npmjs.org/';
// Matches https://<host>.(pkgs.visualstudio.com | pkgs.dev.azure.com)/_packaging/<feed>/npm/registry/
const FEED_RE =
  /https:\/\/[^/"]*\.(?:pkgs\.visualstudio\.com|pkgs\.dev\.azure\.com)\/_packaging\/[^/]+\/npm\/registry\//g;

const check = process.argv.includes('--check');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'package-lock.json');

const original = readFileSync(lockPath, 'utf8');
const matches = original.match(FEED_RE) ?? [];

if (check) {
  if (matches.length) {
    console.error(
      `\u274c package-lock.json contains ${matches.length} internal Azure Artifacts feed URL(s).\n` +
        `   Run \`npm run lock:normalize\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log('\u2705 package-lock.json is clean (no internal feed URLs).');
  process.exit(0);
}

if (!matches.length) {
  console.log('\u2705 Nothing to do: no internal feed URLs found.');
  process.exit(0);
}

const normalized = original.replace(FEED_RE, NPMJS);
writeFileSync(lockPath, normalized);
console.log(`\u2705 Rewrote ${matches.length} feed URL(s) -> ${NPMJS}`);
