#!/usr/bin/env node
/**
 * Audit agent-signal logs against the current signal heuristics.
 *
 * Runs every signal entry through `createSignalClassifier()` and prints, per
 * result name, the distinct User-Agent + Accept combinations with counts,
 * unique IPs, domains, triggers, methods, any non-standard request headers,
 * and sample paths. The `unidentified` section is where new fingerprints
 * show up; the `NOT-AGENT` section is worth a skim for self-identifying
 * agents the bot database does not know yet.
 *
 * Usage:
 *   npm run build
 *   node scripts/audit-signal-logs.mjs <log-dir>
 *
 * Expected layout: JSONL files as written by the signal tracker shim, one
 * object per line with `timestamp`, `domain`, `ip`, `method`, `path`,
 * `trigger`, and `headers`:
 *   <log-dir>/signals/*.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { createSignalClassifier } = await import(join(here, '..', 'dist', 'index.js'));

const [logDir] = process.argv.slice(2);
if (!logDir) {
  console.error('usage: node scripts/audit-signal-logs.mjs <log-dir>');
  process.exit(1);
}

const { classifySignalEntry } = createSignalClassifier();

/** Headers that carry no identifying signal on their own. */
const STANDARD_HEADERS = new Set([
  'Accept',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Cdn-Loop',
  'Cf-Connecting-Ip',
  'Cf-Ipcountry',
  'Cf-Ray',
  'Cf-Visitor',
  'Connection',
  'Content-Length',
  'Content-Type',
  'Cookie',
  'Dnt',
  'From',
  'Host',
  'If-Modified-Since',
  'If-None-Match',
  'Origin',
  'Pragma',
  'Priority',
  'Range',
  'Referer',
  'Sec-Ch-Ua',
  'Sec-Ch-Ua-Mobile',
  'Sec-Ch-Ua-Platform',
  'Sec-Fetch-Dest',
  'Sec-Fetch-Mode',
  'Sec-Fetch-Site',
  'Sec-Fetch-User',
  'Sec-Gpc',
  'Te',
  'Upgrade-Insecure-Requests',
  'User-Agent',
  'Via',
  'X-Forwarded-For',
  'X-Forwarded-Proto',
  'X-Real-Ip',
  'X-Requested-With',
]);

const entries = [];
const signalsDir = join(logDir, 'signals');
for (const file of readdirSync(signalsDir)) {
  if (!file.endsWith('.jsonl')) continue;
  for (const line of readFileSync(join(signalsDir, file), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line);
      entries.push({
        raw,
        entry: {
          ip: raw.ip,
          timestamp: Math.floor(Date.parse(raw.timestamp) / 1000),
          domain: raw.domain,
          headers: raw.headers ?? {},
          trigger: raw.trigger,
        },
      });
    } catch {
      // skip malformed lines
    }
  }
}

const byTrigger = {};
const headerFrequency = {};
/** result name -> "ua\naccept" -> stats */
const byName = {};

for (const { raw, entry } of entries) {
  const result = classifySignalEntry(entry);
  const name = result.isAgent ? (result.name ?? '(agent, unnamed)') : 'NOT-AGENT';
  byTrigger[raw.trigger] = (byTrigger[raw.trigger] ?? 0) + 1;

  const ua = entry.headers['User-Agent'] || '(none)';
  const accept = entry.headers['Accept'] || '(none)';
  const key = `UA=${ua}\n      Accept=${accept}`;
  const groups = (byName[name] ??= {});
  const rec = (groups[key] ??= {
    requests: 0,
    ips: new Set(),
    domains: new Set(),
    triggers: new Set(),
    methods: new Set(),
    paths: new Set(),
    extraHeaders: new Map(),
  });
  rec.requests++;
  rec.ips.add(entry.ip);
  rec.domains.add(raw.domain);
  rec.triggers.add(raw.trigger);
  rec.methods.add(raw.method);
  rec.paths.add(raw.path);
  for (const [header, value] of Object.entries(entry.headers)) {
    headerFrequency[header] = (headerFrequency[header] ?? 0) + 1;
    if (!STANDARD_HEADERS.has(header)) {
      const values = rec.extraHeaders.get(header) ?? new Set();
      values.add(String(value).slice(0, 120));
      rec.extraHeaders.set(header, values);
    }
  }
}

console.log(`signal entries: ${entries.length}`);
console.log('triggers:', byTrigger);

console.log('\n=== non-standard request headers seen (count) ===');
for (const [header, count] of Object.entries(headerFrequency).sort((a, b) => b[1] - a[1])) {
  if (!STANDARD_HEADERS.has(header)) console.log(`${String(count).padStart(6)} ${header}`);
}

const total = (groups) => Object.values(groups).reduce((n, r) => n + r.requests, 0);
for (const [name, groups] of Object.entries(byName).sort((a, b) => total(b[1]) - total(a[1]))) {
  console.log(
    `\n\n##### ${name}  (${total(groups)} entries, ${Object.keys(groups).length} UA/Accept combos)`,
  );
  for (const [key, rec] of Object.entries(groups).sort((a, b) => b[1].requests - a[1].requests)) {
    console.log(
      `  [${rec.requests} req, ${rec.ips.size} ip, ${[...rec.domains].join(',')}] triggers=${[...rec.triggers].join(',')} methods=${[...rec.methods].join(',')}`,
    );
    console.log(`      ${key}`);
    for (const [header, values] of rec.extraHeaders) {
      console.log(`      + ${header}: ${[...values].slice(0, 3).join(' | ')}`);
    }
    console.log(`      paths: ${[...rec.paths].slice(0, 4).join(', ')}`);
  }
}
