#!/usr/bin/env node
/**
 * Audit the session-level detectors against real logs.
 *
 * The per-request audits (`audit-access-logs.mjs`, `audit-signal-logs.mjs`)
 * show what the user-agent database and signal heuristics miss. This one runs
 * the full pipeline a consumer would run (signal seeds, spoofed-browser and
 * scanner demotion, duplicate-request and IP cross-reference attribution) and
 * reports what each stage moved, what it left behind, and what the referral
 * sources look like afterwards. Run it before and after a change to the
 * detectors to see the effect on a week of traffic.
 *
 * Usage:
 *   npm run build
 *   node scripts/audit-sessions.mjs <log-dir> [--dev-tools afdocs/,curl] [--watch 1.2.3.4,5.6.7.8]
 *
 * Expected layout, as for the other audit scripts:
 *   <log-dir>/access/<site>/access.log[.<date>][.gz]
 *   <log-dir>/signals/*.jsonl            (optional)
 *
 * `--dev-tools` names user-agent substrings the signal classifier should treat
 * as your own tooling rather than agents (a docs checker in CI, for example).
 * Without it such a tool seeds "unidentified" agent sessions that absorb all
 * of its traffic. `--watch` prints the final category of every pair from the
 * listed IPs, for checking a specific crawler or false positive.
 *
 * Sections:
 *  - filtered requests by category after each stage
 *  - spoofed-browser demotions, with the largest demoted pairs
 *  - scanner demotions by IP
 *  - cross-reference upgrades (programmatic -> agent)
 *  - watched IPs
 *  - surviving human pairs: browser UA, many page requests, no assets (the
 *    gaps: a crawler the detectors could not reach)
 *  - surviving human UA pools: one UA string used by many single-request IPs
 *    with no asset load (a proxy-pool crawler the pool trigger did not reach,
 *    usually because the site has too few addresses per UA)
 *  - top external referrers among what is still human
 */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const L = await import(join(here, '..', 'dist', 'index.js'));

const args = process.argv.slice(2);
const logDir = args.find((a) => !a.startsWith('--'));
if (!logDir) {
  console.error(
    'usage: node scripts/audit-sessions.mjs <log-dir> [--dev-tools a,b] [--watch ip,ip]',
  );
  process.exit(1);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? [] : (args[i + 1] ?? '').split(',').filter(Boolean);
};
const devTools = [...flag('--dev-tools'), ...L.DEFAULT_DEV_TOOLS];
const watch = new Set(flag('--watch'));

const classify = L.createClassifier();
const shouldSkip = L.createFilter();
const { classifySignalEntry } = L.createSignalClassifier({ devTools });

const signalsDir = join(logDir, 'signals');
let signalEntries = [];
try {
  if (statSync(signalsDir).isDirectory()) signalEntries = await L.parseSignalLog(signalsDir);
} catch {
  // no signals directory: access-log-only mode
}
const seeds = L.buildAgentSeeds(signalEntries, classifySignalEntry);
console.log(`signal entries: ${signalEntries.length}, domains with agent seeds: ${seeds.size}`);
console.log(`dev tools: ${devTools.join(', ')}`);

const ASSET_RE = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)(\?|$)/i;
const STAGES = ['classify', 'spoofed', 'scanners', 'final'];
const stageTotals = Object.fromEntries(STAGES.map((s) => [s, {}]));
const bump = (stage, cat) => (stageTotals[stage][cat] = (stageTotals[stage][cat] ?? 0) + 1);

const demoted = [];
const scannerIps = new Map();
const upgrades = {};
const watched = [];
const survivors = [];
const referrers = {};
/** ua -> { n, filtered, assets, pairs: Map<ip@site, n>, refs: Map<host, n> } over final-human entries */
const pools = new Map();

const accessRoot = join(logDir, 'access');
for (const site of readdirSync(accessRoot)) {
  const siteDir = join(accessRoot, site);
  if (!statSync(siteDir).isDirectory()) continue;
  const raw = [];
  for await (const entry of L.readLogFiles(siteDir)) raw.push(entry);
  if (raw.length === 0) continue;

  const s1 = L.reclassifyEntries(raw, seeds.get(site) ?? null, classify);
  const s2 = L.detectSpoofedBrowsers(s1, site);
  const s3 = L.detectScanners(s2, site);
  const profiles = L.buildSessionProfiles(s3, site);
  const s4 = L.detectDuplicateRequestAgents(s3, { sessionProfiles: profiles });
  const s5 = L.crossReferenceSignalIps(s4, signalEntries, site, classifySignalEntry);
  const s6 = L.crossReferenceAgentIps(s5, signalEntries, classifySignalEntry);

  const pairs = new Map();
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    const key = `${e.ip}|||${e.userAgent}`;
    let p = pairs.get(key);
    if (!p) {
      p = {
        ip: e.ip,
        ua: e.userAgent,
        site,
        n: 0,
        filtered: 0,
        assets: 0,
        robots: 0,
        refs: new Set(),
        paths: new Set(),
        first: s1[i].classification.category,
        afterSpoofed: s2[i].classification.category,
        afterScanners: s3[i].classification.category,
        final: s6[i].classification.category,
        finalName: s6[i].classification.botName,
      };
      pairs.set(key, p);
    }
    p.n++;
    const skipped = shouldSkip(e);
    if (!skipped) p.filtered++;
    if (ASSET_RE.test(e.path)) p.assets++;
    if (L.ROBOTS_TXT_RE.test(e.path)) p.robots++;
    if (e.referrer && !L.isSameSiteReferrer(e.referrer, site)) p.refs.add(e.referrer.slice(0, 60));
    if (p.paths.size < 5) p.paths.add(e.path.slice(0, 50));
    if (skipped) continue;

    bump('classify', s1[i].classification.category);
    bump('spoofed', s2[i].classification.category);
    bump('scanners', s3[i].classification.category);
    const fc = s6[i].classification;
    bump('final', fc.category);
    const before = s5[i].classification.category;
    if (before !== fc.category) {
      const k = `${before} -> ${fc.category} (${fc.botName ?? 'unnamed'})`;
      upgrades[k] = (upgrades[k] ?? 0) + 1;
    }
    if (fc.category === L.CATEGORY_HUMAN) {
      if (e.referrer && !L.isSameSiteReferrer(e.referrer, site)) {
        try {
          const host = new URL(e.referrer).host.replace(/^www\./, '');
          referrers[host] = (referrers[host] ?? 0) + 1;
        } catch {
          // unparsable referrer
        }
      }
      if (L.parseBrowserVersion(e.userAgent)) {
        let pool = pools.get(e.userAgent);
        if (!pool) {
          pool = { n: 0, assets: 0, pairs: new Map(), refs: new Map() };
          pools.set(e.userAgent, pool);
        }
        pool.n++;
        const pk = `${e.ip}@${site}`;
        pool.pairs.set(pk, (pool.pairs.get(pk) ?? 0) + 1);
        if (e.referrer) {
          try {
            const host = new URL(e.referrer).host.replace(/^www\./, '');
            pool.refs.set(host, (pool.refs.get(host) ?? 0) + 1);
          } catch {
            // unparsable referrer
          }
        }
      }
    }
  }
  // Asset loads are skipped by the filter, so count them for the pools from the pairs.
  for (const p of pairs.values()) {
    if (p.final === L.CATEGORY_HUMAN && p.assets > 0 && pools.has(p.ua))
      pools.get(p.ua).assets += p.assets;
    if (p.first === L.CATEGORY_HUMAN && p.afterSpoofed === L.CATEGORY_SPOOFED_BROWSER)
      demoted.push(p);
    if (p.afterSpoofed !== L.CATEGORY_SCANNER && p.afterScanners === L.CATEGORY_SCANNER) {
      const k = `${p.ip}@${site}`;
      scannerIps.set(k, (scannerIps.get(k) ?? 0) + p.n);
    }
    if (watch.has(p.ip)) watched.push(p);
    if (
      p.final === L.CATEGORY_HUMAN &&
      p.filtered >= 15 &&
      p.assets === 0 &&
      L.parseBrowserVersion(p.ua)
    ) {
      survivors.push(p);
    }
  }
}

const pad = (v, w) => String(v).padStart(w);
const sum = (arr, f) => arr.reduce((n, p) => n + p[f], 0);

console.log('\n=== filtered requests by category after each stage ===');
const cats = [...new Set(STAGES.flatMap((s) => Object.keys(stageTotals[s])))].sort();
console.log('category'.padEnd(18) + STAGES.map((s) => pad(s, 10)).join(''));
for (const c of cats) {
  console.log(c.padEnd(18) + STAGES.map((s) => pad(stageTotals[s][c] ?? 0, 10)).join(''));
}

const robots = demoted.filter((p) => p.robots > 0);
const other = demoted.filter((p) => p.robots === 0);
console.log('\n=== detectSpoofedBrowsers: human -> spoofed-browser ===');
console.log(
  `pairs that fetched robots.txt: ${robots.length} pairs, ${sum(robots, 'n')} requests (${sum(robots, 'filtered')} filtered)`,
);
console.log(
  `other triggers (stale version, UA pool, off-site asset referrer): ${other.length} pairs, ${sum(other, 'n')} requests (${sum(other, 'filtered')} filtered)`,
);
for (const p of demoted.sort((a, b) => b.n - a.n).slice(0, 10)) {
  console.log(
    `  ${p.site.padEnd(28)} ${p.ip.padEnd(16)} n=${pad(p.n, 4)} assets=${p.assets} robots=${p.robots} refs=${[...p.refs].slice(0, 2).join(' | ') || '-'}\n      ${p.ua.slice(0, 110)}`,
  );
}

console.log(`\n=== detectScanners: ${scannerIps.size} IP@site demoted ===`);
for (const [k, n] of [...scannerIps].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${pad(n, 5)} req  ${k}`);
}

console.log('\n=== cross-reference upgrades (filtered requests) ===');
for (const [k, n] of Object.entries(upgrades).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(n, 5)}  ${k}`);
}

if (watch.size > 0) {
  console.log('\n=== watched IPs ===');
  for (const p of watched.sort((a, b) => b.n - a.n)) {
    console.log(
      `  ${p.ip.padEnd(16)} ${p.site.padEnd(28)} n=${pad(p.n, 4)} ${p.first} -> ${p.final} ${p.finalName ?? ''}\n      ${p.ua.slice(0, 110)}`,
    );
  }
}

console.log(
  `\n=== surviving human pairs: browser UA, >=15 filtered requests, zero assets (${survivors.length}) ===`,
);
for (const p of survivors.sort((a, b) => b.filtered - a.filtered).slice(0, 25)) {
  console.log(
    `  ${p.site.padEnd(28)} ${p.ip.padEnd(16)} n=${pad(p.n, 4)} robots=${p.robots} refs=${[...p.refs].slice(0, 2).join(' | ') || '-'}\n      ${p.ua.slice(0, 110)}\n      ${[...p.paths].join(' ')}`,
  );
}

console.log(
  '\n=== surviving human UA pools: >=20 requests, >=90% of IP@site pairs single-request, zero assets ===',
);
let poolUas = 0;
let poolRequests = 0;
for (const [ua, pool] of [...pools].sort((a, b) => b[1].n - a[1].n)) {
  const single = [...pool.pairs.values()].filter((n) => n === 1).length;
  if (pool.n < 20 || pool.assets > 0 || single < 0.9 * pool.pairs.size) continue;
  poolUas++;
  poolRequests += pool.n;
  const v = L.parseBrowserVersion(ua);
  const refs = [...pool.refs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([h, n]) => `${h}:${n}`)
    .join(' ');
  console.log(
    `  ${pad(pool.n, 5)} req ${pad(pool.pairs.size, 5)} ip ${pad(single, 5)} single ${v ? (v.family + v.major).padStart(10) : ''}  ${ua.slice(0, 90)}\n      refs: ${refs || '-'}`,
  );
}
console.log(`pool UAs: ${poolUas}, requests: ${poolRequests}`);

console.log('\n=== top external referrers among final human (filtered) ===');
for (const [host, n] of Object.entries(referrers)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)) {
  console.log(`  ${pad(n, 5)} ${host}`);
}
