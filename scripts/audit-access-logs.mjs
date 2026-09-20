#!/usr/bin/env node
/**
 * Audit access logs against the current classifier defaults.
 *
 * Runs every request through `createClassifier()` and prints, per category,
 * the distinct user agents with request counts, unique IPs, site counts, how
 * many requests the default filter would skip, and the top paths. The
 * `other-bot` section and the non-browser `human` sections are where
 * uncategorized bots and agents show up.
 *
 * Usage:
 *   npm run build
 *   node scripts/audit-access-logs.mjs <log-dir> [--all]
 *
 * Expected layout (Apache Combined Log Format, optionally gzipped):
 *   <log-dir>/access/<site>/access.log
 *   <log-dir>/access/<site>/access.log.<date>
 *   <log-dir>/access/<site>/access.log.<date>.gz
 *
 * By default only the sections useful for finding new patterns are printed.
 * Pass --all to also dump every curated match by category.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const { parseLine, createClassifier, createFilter } = await import(
  join(here, '..', 'dist', 'index.js')
);

const [logDir, ...flags] = process.argv.slice(2);
if (!logDir) {
  console.error('usage: node scripts/audit-access-logs.mjs <log-dir> [--all]');
  process.exit(1);
}
const showAll = flags.includes('--all');

const classify = createClassifier();
const shouldSkip = createFilter();
const accessRoot = join(logDir, 'access');

/** category -> ua -> stats */
const byCategory = {};
let total = 0;
let unparsed = 0;

function readLog(path) {
  const raw = readFileSync(path);
  return (path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
}

for (const site of readdirSync(accessRoot)) {
  const siteDir = join(accessRoot, site);
  if (!statSync(siteDir).isDirectory()) continue;
  for (const file of readdirSync(siteDir)) {
    if (!file.startsWith('access.log')) continue;
    for (const line of readLog(join(siteDir, file)).split('\n')) {
      if (!line.trim()) continue;
      const entry = parseLine(line.trimEnd());
      if (!entry) {
        unparsed++;
        continue;
      }
      total++;
      const result = classify(entry.userAgent);
      const uas = (byCategory[result.category] ??= {});
      const rec = (uas[entry.userAgent] ??= {
        requests: 0,
        skipped: 0,
        ips: new Set(),
        sites: new Set(),
        paths: new Map(),
        botName: result.botName,
      });
      rec.requests++;
      rec.ips.add(entry.ip);
      rec.sites.add(site);
      if (shouldSkip(entry)) rec.skipped++;
      rec.paths.set(entry.path, (rec.paths.get(entry.path) ?? 0) + 1);
    }
  }
}

function sortedUas(category, predicate = () => true) {
  return Object.entries(byCategory[category] ?? {})
    .filter(([ua, rec]) => predicate(ua, rec))
    .sort((a, b) => b[1].requests - a[1].requests);
}

function printSection(title, rows) {
  console.log(`\n=== ${title} (${rows.length} distinct UAs) ===`);
  for (const [ua, rec] of rows) {
    const topPaths = [...rec.paths.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([p, n]) => `${p} (${n})`)
      .join('  ');
    const name = rec.botName ? `[${rec.botName}] ` : '';
    console.log(
      `${String(rec.requests).padStart(6)} req ${String(rec.ips.size).padStart(4)} ip ${String(rec.sites.size).padStart(2)} site skip=${rec.skipped}  ${name}${ua}`,
    );
    console.log(`        ${topPaths}`);
  }
}

console.log(`parsed ${total} requests (${unparsed} unparsed lines)`);
console.log('\n=== requests by category ===');
for (const [category, uas] of Object.entries(byCategory).sort((a, b) => sum(b[1]) - sum(a[1]))) {
  console.log(
    `${category.padEnd(16)} ${String(sum(uas)).padStart(7)} requests  ${Object.keys(uas).length} distinct UAs`,
  );
}
function sum(uas) {
  return Object.values(uas).reduce((n, r) => n + r.requests, 0);
}

// Where uncategorized bots hide: isbot caught them but the curated list did not.
printSection('other-bot: candidates for the bot database', sortedUas('other-bot'));

// Where agents and clients hide: classified human but not shaped like a browser UA.
printSection(
  'human, non-Mozilla UA: candidates for bots or programmatic clients',
  sortedUas('human', (ua) => !ua.startsWith('Mozilla/')),
);
printSection(
  'human, Mozilla UA with a product URL or "compatible;" token',
  sortedUas(
    'human',
    (ua) => ua.startsWith('Mozilla/') && /compatible;|\+http|https?:\/\//i.test(ua),
  ),
);

printSection('programmatic', sortedUas('programmatic'));
printSection('unknown (empty UA)', sortedUas('unknown'));

if (showAll) {
  for (const category of Object.keys(byCategory)) {
    if (['other-bot', 'human', 'programmatic', 'unknown'].includes(category)) continue;
    printSection(category, sortedUas(category));
  }
}
