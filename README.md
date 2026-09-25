<p align="center">
  <a href="https://github.com/agent-ecosystem/agent-traffic-classifier/actions/workflows/ci.yml"><img src="https://github.com/agent-ecosystem/agent-traffic-classifier/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/agent-traffic-classifier"><img src="https://img.shields.io/npm/v/agent-traffic-classifier" alt="npm"></a>
</p>

# agent-traffic-classifier

Classify web server traffic into humans, bots, AI agents, and programmatic clients. Built for analyzing access logs and HTTP header signals to understand how AI agents interact with your site.

> **Status: Early development (0.x)**
> This library is currently in early iteration and does not promise stability guarantees.

## What it does

Given access log entries (and optionally HTTP header signals), the library:

1. **Classifies** each request by user-agent into a category: human, AI crawler, AI assistant, AI search, coding agent, search crawler, SEO bot, monitoring, social preview, feed reader, programmatic client, or unknown
2. **Detects AI agents** that use standard browser user-agents (Claude Code, Cursor, Kiro, Gemini CLI) via HTTP header heuristics and signal attribution
3. **Identifies agent frameworks** by Accept header patterns, missing browser security headers, and conversation-tracking headers, even when the specific agent is unknown
4. **Attributes country-level intelligence** to unidentified agents using IP ranges from Regional Internet Registries, enabling suspected identification (e.g., "Kimi / Doubao / DeepSeek (suspected)" for Chinese AI assistants)
5. **Clusters sessions** by correlating signal data with access logs to reclassify traffic that would otherwise look human
6. **Cross-references programmatic traffic** with signal data to upgrade HTTP client requests (httpx, undici, etc.) to agent when they share IPs with known agent signals
7. **Detects proxy-based agents** (like Cursor) via a duplicate-request heuristic: same path + UA from different IPs within a short window
8. **Detects vulnerability scanners** by the paths they probe for (`.env`, `.git`, SSH keys, path traversal) and relabels the whole session, so scanners that rotate browser user agents and attach fake Reddit or Hacker News referrers stay out of human stats and referral sources
9. **Aggregates** classified entries into daily summary documents with category breakdowns, top paths, referrers, bot/agent/programmatic stats, and status codes

## Install

```
npm install agent-traffic-classifier
```

## Quick start

### Access logs only

The simplest usage: parse Apache access logs, classify, and aggregate.

```ts
import {
  parseLine,
  createClassifier,
  createFilter,
  reclassifyEntries,
  aggregate,
} from 'agent-traffic-classifier';
import type { LogEntry } from 'agent-traffic-classifier';

const classify = createClassifier();
const shouldSkip = createFilter();

// Parse log lines into entries
const lines = [
  '1.1.1.1 - - [04/Apr/2026:10:00:00 -0700] "GET /about/ HTTP/1.1" 200 5000 "https://google.com" "Mozilla/5.0 Chrome/120"',
  '2.2.2.2 - - [04/Apr/2026:10:00:01 -0700] "GET /about/ HTTP/1.1" 200 5000 "-" "GPTBot/1.0"',
  '3.3.3.3 - - [04/Apr/2026:10:00:02 -0700] "GET / HTTP/1.1" 200 3000 "-" "curl/7.68.0"',
];

const entries: LogEntry[] = lines.map((line) => parseLine(line)).filter((e) => e !== null);

// Classify (no signal data, so pass null for seeds)
const classified = reclassifyEntries(entries, null, classify);

// Aggregate into daily summaries
const docs = aggregate(classified, {
  domain: 'example.com',
  tzOffsetMinutes: -420, // PDT
  shouldSkip,
});

// docs[0].summary.byCategory => { human: {...}, 'ai-crawler': {...}, programmatic: {...} }
```

### With signal data and IP intelligence

For deeper agent detection, capture HTTP headers from requests that exhibit agent-like behavior (content negotiation, `llms.txt` requests, etc.) and feed them as signal entries. Combined with IP intelligence, this lets the library identify agents that use standard browser user-agents and attribute unidentified traffic to suspected services.

```ts
import {
  parseLine,
  createClassifier,
  createFilter,
  createSignalClassifier,
  createCountryLookup,
  createCloudProviderLookup,
  buildSessionProfiles,
  buildAgentSeeds,
  reclassifyEntries,
  detectDuplicateRequestAgents,
  crossReferenceSignalIps,
  aggregate,
} from 'agent-traffic-classifier';
import type { LogEntry, SignalEntry } from 'agent-traffic-classifier';

const classify = createClassifier();
const shouldSkip = createFilter();

// Initialize IP intelligence (async, fetches public range data once)
const countryLookup = await createCountryLookup(['CN']); // Only fetch ranges for countries you need
const cloudLookup = await createCloudProviderLookup(); // Google, AWS, Cloudflare ranges

const { classifySignalEntry, getSignalSummary } = createSignalClassifier({
  ipLookup: (ip) => {
    const info: Record<string, string> = {};
    const country = countryLookup(ip);
    if (country) info.country = country;
    const provider = cloudLookup(ip);
    if (provider) info.cloudProvider = provider;
    return info;
  },
});

// Parse access log entries
const entries: LogEntry[] = logLines.map((line) => parseLine(line)).filter((e) => e !== null);

// Signal entries from your capture mechanism (middleware, edge function, etc.)
const signalEntries: SignalEntry[] = [
  {
    ip: '5.5.5.5',
    timestamp: 1743789604, // Unix epoch seconds
    domain: 'example.com',
    headers: { 'User-Agent': 'Claude-User/1.0' },
    trigger: 'content-negotiation',
  },
];

// Build agent seeds from signals and reclassify access log entries
const seeds = buildAgentSeeds(signalEntries, classifySignalEntry);
const domainSeeds = seeds.get('example.com') ?? null;
const classified = reclassifyEntries(entries, domainSeeds, classify);

// Build per-IP session profiles (static assets + self-site referrers)
// to suppress false-positive "Cursor (suspected)" during traffic spikes
const sessionProfiles = buildSessionProfiles(classified, 'example.com');

// Detect proxy-based agents (e.g., Cursor's duplicate-request pattern)
const withDuplicates = detectDuplicateRequestAgents(classified, { sessionProfiles });

// Upgrade programmatic clients that share IPs with known agent signals
const withCrossRef = crossReferenceSignalIps(
  withDuplicates,
  signalEntries,
  'example.com',
  classifySignalEntry,
);

// Aggregate with signal summary
const docs = aggregate(withCrossRef, {
  domain: 'example.com',
  tzOffsetMinutes: -420,
  shouldSkip,
  signalEntries,
  classifySignalEntry,
  getSignalSummary,
});
```

### Custom log formats

The library operates on format-agnostic `LogEntry` and `SignalEntry` interfaces. The Apache parser is a convenience adapter; you can construct entries from any source:

```ts
import type { LogEntry, SignalEntry } from 'agent-traffic-classifier';

// From nginx JSON logs, CDN exports, middleware, etc.
const entry: LogEntry = {
  ip: '1.2.3.4',
  timestamp: 1743789600, // Unix epoch seconds (UTC)
  method: 'GET',
  path: '/about/',
  status: 200,
  size: 5000,
  referrer: null,
  userAgent: 'Mozilla/5.0 ...',
};
```

## Categories

Every request is classified into one of these categories:

| Category          | Description                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `human`           | Regular browser traffic                                                                                                                                                                                                             |
| `agent`           | AI coding agents (Claude Code, Claude Agent, Cursor, Kiro, GitHub Copilot, Gemini CLI, Qoder, ZCode, grok-agent, MCP clients) and AI desktop apps' embedded browsers (Claude Desktop, WorkBuddy, CodeBuddy)                         |
| `ai-crawler`      | AI training data crawlers (GPTBot, ClaudeBot, SSI-Nutch, DeepSeekBot, etc.)                                                                                                                                                         |
| `ai-assistant`    | AI assistants fetching live content on a user's behalf (ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User, DuckAssistBot, Amazon Quick)                                                                                    |
| `ai-search`       | AI-powered search engines (PerplexityBot, OAI-SearchBot, Claude-SearchBot, ExaSearchBot, Kagibot)                                                                                                                                   |
| `search-crawler`  | Traditional search engines (Googlebot, Bingbot)                                                                                                                                                                                     |
| `seo-bot`         | SEO/marketing bots (AhrefsBot, SemrushBot)                                                                                                                                                                                          |
| `monitoring`      | Uptime monitors (UptimeRobot, Pingdom)                                                                                                                                                                                              |
| `social-preview`  | Link preview fetchers (Twitterbot, Slackbot, Mastodon, WhatsApp)                                                                                                                                                                    |
| `feed-reader`     | Feed readers and news apps (FreshRSS, Feedly, HackerNews app)                                                                                                                                                                       |
| `programmatic`    | HTTP clients (curl, axios, python-requests, httpx, trafilatura)                                                                                                                                                                     |
| `spoofed-browser` | Automation wearing a browser user agent that does not behave like one. Never assigned by user agent alone; see `detectSpoofedBrowsers` and the spoofed-header heuristic                                                             |
| `scanner`         | Vulnerability scanners: self-identifying ones by user agent (zgrab, Nuclei, CensysInspect, sqlmap) and, via `detectScanners`, any IP that sent a burst of probes for secrets or exploits (`.env`, `.git`, SSH keys, path traversal) |
| `other-bot`       | Bots detected by [isbot](https://github.com/nicedayfor/isbot) but not in the curated list                                                                                                                                           |
| `unknown`         | Empty or missing user-agent                                                                                                                                                                                                         |

Classification priority: curated bot list > programmatic client heuristic > isbot fallback > human.

## Signal heuristics

When HTTP header signals are available, the library applies a chain of heuristics to identify agents that use standard browser user-agents. The chain is ordered by specificity (first match wins):

1. **Known agent UAs**: Claude Code (`claude-code/`), Claude Agent (`Claude-Agent`), Gemini CLI (`Google-Gemini-CLI`), markdown.new
2. **Dev tool exclusion**: curl and other known developer tools are excluded from agent classification
3. **Spoofed browser headers**: A Firefox or Safari user agent carrying `Sec-Ch-Ua` (neither browser sends client hints), or a Chrome user agent whose major version disagrees with its own client hints. Returns a non-agent result in the `spoofed-browser` category; session attribution relabels the matching IP+UA traffic without counting it as an agent
4. **Curated bot database**: The same bot database the access-log classifier uses. Self-identifying coding agents (category `agent`, e.g. `GitHubCopilotRuntime-WebFetch`, VS Code's `Code/` token, `grok-agent`) are agents. Self-identifying crawlers, assistants, search bots and feed readers are never agents, even when they request `llms.txt` or negotiate for markdown, so GPTBot, ClaudeBot, bingbot and ExaSearchBot no longer seed "unidentified" agent sessions. Pass `botClassifier: null` to disable.
5. **Chrome 122 / macOS 14.7.2**: Frozen browser fingerprint used by Chinese AI assistant services. With CN country IP, returns "Kimi / Doubao / DeepSeek (suspected)"
6. **Cursor (Sentry Baggage)**: Definitively identifies Cursor via its Sentry org credentials leaked in the `Baggage` header (seen April 2026, absent by September 2026)
7. **Cursor (fetch fingerprint)**: Generic Chrome UA with Cursor's markdown-first Accept header, `Pragma: no-cache`, `Cache-Control: no-cache`, and no `Sec-Ch-Ua`. Confirmed by controlled tests in April and September 2026
8. **Traced proxy**: Generic Chrome UA with OpenTelemetry `Traceparent` headers, excluding VS Code. A server-side fetch pipeline of some kind. Reported as "Cursor (suspected)" only when paired with Cursor's Accept header (the April 2026 combination), otherwise as "traced proxy agent"
9. **Conversation tracking headers**: `X-Conversation-Id` or `X-Conversation-Request-Id` are definitively agent headers
10. **text/x-markdown Accept**: The unofficial markdown MIME type is only sent by purpose-built agents
11. **Accept header taxonomy**: Known Accept preference patterns that identify agent frameworks (axios-pattern, text-first, html-first, Cursor, got-pattern, markdown variants)
12. **Missing browser headers**: Chrome UA requesting markdown without `Sec-Ch-Ua` (a header real Chrome always sends)
13. **Plain-text fetcher**: Browser-like UA sending a bare `Accept: text/plain` with no `Sec-Ch-Ua`. No browser does this; observed as an `llms.txt` scanner rotating through browser UAs
14. **Trigger-based fallback**: Requests with agent triggers (`content-negotiation`, `llms-txt`) but no heuristic match are classified as "unidentified"

All heuristics are exported individually so you can reorder, replace, or extend the chain.

Cursor's fetch fingerprint was re-confirmed on 2026-09-19 by two controlled tests against a quiet tracked site from a current Cursor build: a direct URL fetch, and an Agent-mode web search that led Cursor to fetch several pages. Both paths produced the same requests: each from a different proxy IP with a generic Chrome/145 UA, Cursor's markdown-first Accept header, `Pragma`/`Cache-Control: no-cache`, and no `Sec-Ch-Ua`, tracing, or Sentry headers. The web searches themselves generated no requests to the site; only the follow-up page fetches did. Exa's crawler (`ExaSearchBot`) sends the identical fingerprint with a self-identifying UA, consistent with Cursor's fetch running on Exa infrastructure; the bot database routes ExaSearchBot to `ai-search` before the heuristics run. Traffic carrying `Traceparent` and `B3` tracing headers with a `text/markdown;q=1.0, text/x-markdown;q=0.9, ...` Accept was labelled Cursor in April 2026 because it co-occurred with the Sentry header, but neither September test reproduced it, so it is now reported as a generic "traced proxy agent".

### Auditing the defaults against real logs

The `scripts/` directory has two scripts that run a directory of access logs and signal logs through the current build and print what the defaults miss (uncategorized bots, unmatched signal fingerprints, new request headers). See [scripts/README.md](scripts/README.md) for the expected log layout and how to read the output.

## IP intelligence

The library includes adapters for IP-to-country and IP-to-cloud-provider lookups. These are optional, async-init, sync-lookup: you call the async factory once at startup, and it returns a synchronous lookup function.

```ts
import {
  createCountryLookup,
  createCloudProviderLookup,
  createIpLookup,
  buildCidrIndex,
} from 'agent-traffic-classifier';

// Country lookup from RIR delegation data (fetches from APNIC, RIPE, etc.)
const countryLookup = await createCountryLookup(['CN', 'RU']);

// Cloud provider lookup (fetches published ranges from Google, AWS, Cloudflare)
const cloudLookup = await createCloudProviderLookup();

// Combined convenience factory
const ipLookup = await createIpLookup({
  countries: ['CN'],
  cloudProviders: true,
});

// Or build your own CIDR index for custom ranges
const customIndex = buildCidrIndex([
  { cidr: '10.0.0.0/8', tag: 'internal' },
  { cidr: '172.16.0.0/12', tag: 'internal' },
]);
const tag = customIndex('10.1.2.3'); // => 'internal'
```

The `IpLookup` interface (`(ip: string) => IpInfo`) can be implemented with any data source. The built-in adapters are convenience layers; pass your own function if you have a different IP intelligence source.

## Configuration

Every module uses a factory function that accepts an options object. All options have sensible defaults. Each option replaces (not merges with) its default, so spread the default if you want to extend.

### Classifier

```ts
import { createClassifier, defaultBotDb } from 'agent-traffic-classifier';

const classify = createClassifier({
  // Prepend custom bots (checked first due to priority ordering)
  bots: [
    { pattern: 'MyBot', name: 'MyBot', company: 'Me', category: 'ai-crawler' },
    ...defaultBotDb.bots,
  ],
  // Add custom programmatic client patterns
  programmaticClients: ['my-http-lib', ...DEFAULT_PROGRAMMATIC],
});
```

### Filter

The filter determines which requests are counted in aggregation. Requests matching skip patterns are excluded from all stats (category counts, top paths, referrers, status codes).

```ts
import { createFilter, DEFAULT_SKIP_SUBSTRINGS } from 'agent-traffic-classifier';

const shouldSkip = createFilter({
  // Extend default substrings with site-specific patterns
  skipSubstrings: [...DEFAULT_SKIP_SUBSTRINGS, '-staging-'],
  // Per-site paths (empty by default)
  siteSkipPaths: ['/old-section/'],
});
```

The default substrings cover common vulnerability scanner probes (`wp-admin`, `phpinfo`, `.git/`, `.ssh/`, `.aws/`, `xmlrpc`, `_profiler`, etc.) using substring matching, so they catch all prefix variants at once (e.g., `/wp/wp-admin/`, `/blog/wp-admin/`, `/old/wp-admin/`).

`skipPatterns` (default `DEFAULT_PROBE_PATTERNS`) adds regex matching for probes a substring cannot express: path traversal in any encoding (`/../`, `/%2e%2e/`, `/%252e%252e/`, `/%2f../`), absolute system paths (`/etc/`, `/proc/`, `/var/log/`), private keys (`id_rsa`, `id_ed25519`), credential files (`aws-credentials`, `serviceaccount/token`), config dumps (`serverless.yml`, `docker-compose.yaml`, `application.properties`, `appsettings.json`), and framework debug endpoints (`actuator`, `_ignition`, `telescope/api`). The same patterns drive `detectScanners`, together with status code and method (see `isProbeRequest`). Pass `skipPatterns: []` to count probe requests in stats (they then show up under the `scanner` category if `detectScanners` runs).

### Signal classifier

```ts
import {
  createSignalClassifier,
  DEFAULT_KNOWN_AGENTS,
  DEFAULT_HEURISTICS,
} from 'agent-traffic-classifier';

const { classifySignalEntry, getSignalSummary } = createSignalClassifier({
  // Add a new known agent UA pattern
  knownAgents: [{ pattern: 'MyAgent', name: 'My Agent', company: 'Me' }, ...DEFAULT_KNOWN_AGENTS],
  // Add a custom header-based heuristic
  heuristics: [
    (entry, ipInfo) => {
      if (entry.headers?.['X-My-Agent']) {
        return { isAgent: true, name: 'MyAgent', company: 'Me' };
      }
      return null;
    },
    ...DEFAULT_HEURISTICS,
  ],
  // Optional IP intelligence for country/cloud attribution
  ipLookup: (ip) => ({ country: 'US' }),
});
```

### Internal tools that negotiate for markdown

Site checkers, CI probes, and other tools you run yourself will trip the signal tracker if they send `Accept: text/markdown` or fetch `llms.txt`. Without a curated entry they fall through to the heuristics and seed "unidentified" agent sessions that then absorb all of the tool's access-log traffic. List them in `devTools` so they are never promoted, and give the same classifier to `botClassifier` so both sides agree:

```ts
const classify = createClassifier({
  programmaticClients: ['my-checker/', ...DEFAULT_PROGRAMMATIC],
});
const { classifySignalEntry } = createSignalClassifier({
  devTools: ['my-checker/', ...DEFAULT_DEV_TOOLS],
  botClassifier: classify,
});
```

### Session options

```ts
import { buildSessionProfiles, detectDuplicateRequestAgents } from 'agent-traffic-classifier';

// Build session profiles from the full (unfiltered) classified entries.
// This checks each IP for static asset requests and self-site referrers,
// which are strong indicators of real browser sessions.
const sessionProfiles = buildSessionProfiles(classified, 'example.com');

const result = detectDuplicateRequestAgents(classified, {
  windowSeconds: 120, // Signal seed matching window (default: 60)
  proxyWindowSeconds: 5, // Duplicate-request pairing window (default: 2)
  proxyAgent: {
    // Override the default Cursor identity
    name: 'Windsurf',
    company: 'Codeium',
    suspectedName: 'Windsurf (suspected)',
  },
  // Suppress false-positive "suspected" labels when both IPs in a
  // duplicate pair have browser-like sessions (static assets + self-referrers)
  sessionProfiles,
});
```

### Scanner detection

```ts
import { detectScanners, isProbeRequest, DEFAULT_PROBE_PATTERNS } from 'agent-traffic-classifier';

// Run on the full (unfiltered) entries so the probes are visible.
const result = detectScanners(classified, 'example.com', {
  minProbes: 3, // Probes within one window before an IP counts as a scanner (default: 3)
  windowSeconds: 900, // Burst window, and how far from a probe a request is demoted (default: 900)
  probePatterns: [...DEFAULT_PROBE_PATTERNS, /\/my-honeypot\//], // Extend the probe list
  categories: ['human', 'programmatic'], // Categories eligible for demotion
  isProbe: (entry) => isProbeRequest(entry) || entry.path === '/trap', // Full override of the probe test
});
```

Scanners rotate through browser user agents and attach a fake referrer (Reddit, Hacker News, Facebook, Google, t.co) to every request, so request by request they classify as `human` and their referrers surface as referral sources. The filter drops the probes themselves, but the rest of the session (existence checks like `/admin.css`, config-file guesses like `/telescope`) leaks through. `detectScanners` relabels everything the IP did within the window of its probes to `scanner`, which `aggregate` excludes from top paths and referrers.

A request is a probe (`isProbeRequest`) when a probe pattern matches the path and the server answered 4xx, when a probe pattern matches the query string at any status (static hosts answer `/?rest_route=/wp/v2/users` with the homepage), when the method is PROPFIND, TRACE, TRACK, or CONNECT and the answer is 4xx, or when a POST, PUT, PATCH, or DELETE hits a missing target (404, 405, 501). The status guard makes the detector self-calibrating: `/wp-login.php` counts on a static site and not on WordPress, and a `docker-compose.yml` a docs site serves for download never counts.

Shared-IP safety: an IP+UA pair that ever navigated with a same-site referrer is never touched (a scanner never navigates; a person behind the same NAT clicking through the site does), self-identifying bots (including isbot-detected `other-bot`) and attributed agents are never touched, the burst requirement keeps a crawler that checks `/wp-admin/` once per visit from qualifying, and the window keeps a probe burst from relabelling unrelated traffic from the same address hours later. Same-site referrers are compared by host, so a fake `https://www.google.com/search?q=example.com` referrer does not count as navigation.

Self-identifying scanners (zgrab, masscan, Nuclei, Nikto, sqlmap, WPScan, CensysInspect, Expanse, LeakIX, gobuster, ffuf, and a few observed one-offs) are classified `scanner` directly from the bot database. A bare `Mozilla/5.0` user agent, which isbot flags as a bot, is classified `unknown` so behavioural detection still applies to it.

### Aggregation

```ts
import { aggregate } from 'agent-traffic-classifier';

const docs = aggregate(classified, {
  domain: 'example.com',
  tzOffsetMinutes: -420,
  shouldSkip, // Entries matching this filter are excluded from all stats
  topPathsLimit: 100, // Max top paths per day (default: 50)
  topItemPathsLimit: 20, // Max top paths per bot/agent (default: 10)
  topReferrersLimit: 50, // Max referrers per day (default: 30)
  topPathsSkipCategories: ['seo-bot', 'other-bot'], // Categories excluded from top paths
  normalizePath: (raw) => ({
    // Custom path normalization
    path: raw.toLowerCase(),
    utmSource: null,
  }),
});
```

## API

### Adapters

- **`parseLine(line)`** -- Parse an Apache Combined Log Format line into a `LogEntry`
- **`readLogFiles(dir)`** -- Read and parse `.log` and `.log.gz` files from a directory
- **`parseApacheTs(raw)`** -- Convert an Apache timestamp string to Unix epoch seconds
- **`parseApacheTzOffset(raw)`** -- Extract timezone offset in minutes from an Apache timestamp
- **`parseSignalLog(dir)`** -- Parse JSONL signal log files from a directory into `SignalEntry[]`

### Core

- **`createClassifier(options?)`** -- Returns `(userAgent: string) => ClassifyResult`
- **`createFilter(options?)`** -- Returns `(entry: LogEntry) => boolean` (true = skip)
- **`createSignalClassifier(options?)`** -- Returns `{ classifySignalEntry, getSignalSummary }`

### Sessions

Two constraints govern every function here that uses IP evidence: human-category browser requests are never moved to another category on IP evidence alone (one person on an office VPN running an agent must not relabel everyone else's browsing), and per-request or per-pair evidence is preferred over per-IP evidence wherever both exist.

- **`buildSessionProfiles(entries, domain)`** -- Build per-IP session profiles (static assets, self-site referrers) for false-positive suppression
- **`buildAgentSeeds(signalEntries, classifySignalEntry)`** -- Build agent seeds grouped by domain
- **`reclassifyEntries(entries, domainSeeds, classifyFn, options?)`** -- Reclassify access log entries using signal seeds
- **`detectDuplicateRequestAgents(entries, options?)`** -- Detect proxy-based agents via duplicate-request heuristic
- **`crossReferenceSignalIps(entries, signalEntries, domain, classifySignalEntry, options?)`** -- Upgrade programmatic entries to agent when their IP produced an agent signal on the same domain within a window (default 15 minutes; any agent signal counts, named agents preferred over "unidentified")
- **`crossReferenceAgentIps(entries, signalEntries, classifySignalEntry, options?)`** -- Attribute programmatic requests (curl and friends) to a self-identifying agent active from the same IP within a short window (default 15 minutes), across user agents and domains. Only ever touches `programmatic` entries
- **`detectSpoofedBrowsers(entries, domain, options?)`** -- Demote browser-UA traffic that never loads assets, never navigates with a same-site referrer, has two or more requests, and runs a browser version far behind the newest asset-loading session of the same family. Single-request pairs and current versions are never touched
- **`detectScanners(entries, domain, options?)`** -- Demote every request an IP made within a window of its vulnerability probes to `scanner`, once it has sent a burst of at least three. IP+UA pairs with a same-site referrer, self-identifying bots, and attributed agents are never touched
- **`isSameSiteReferrer(referrer, domain)`** -- Whether a referrer URL is hosted on the domain or a subdomain (host comparison, `www.` ignored)
- **`parseBrowserVersion(userAgent)`** -- Browser family and major version for mainstream browser UAs, null otherwise
- **`isProbePath(path, patterns?)`** -- Whether a request path matches a vulnerability probe pattern
- **`isProbeRequest(entry, patterns?)`** -- Whether a request is a probe, taking status code and method into account

### IP intelligence

- **`createIpLookup(options?)`** -- Combined country + cloud provider lookup factory
- **`createCountryLookup(countries)`** -- Country lookup from RIR delegation data
- **`createCloudProviderLookup(options?)`** -- Cloud provider lookup from published ranges
- **`buildCidrIndex(entries)`** -- Build a CIDR lookup index from custom ranges
- **`parseIpv4(ip)`**, **`parseCidr(cidr)`**, **`matchesCidr(ip, cidr)`** -- Low-level IPv4 utilities

### Aggregation

- **`aggregate(entries, options)`** -- Aggregate classified entries into `DaySummary[]`
- **`normalizePath(rawPath)`** -- Normalize URL paths (trailing slashes, utm_source extraction)
- **`extractDateKey(epochSeconds, tzOffsetMinutes)`** -- Convert epoch + offset to `YYYY-MM-DD` date string

### Defaults

All defaults are exported so you can extend them:

```ts
import {
  // Bot database
  defaultBotDb,
  // Programmatic clients
  DEFAULT_PROGRAMMATIC,
  DEFAULT_EXACT_PROGRAMMATIC,
  // Agent detection
  DEFAULT_KNOWN_AGENTS,
  DEFAULT_DEV_TOOLS,
  DEFAULT_AGENT_TRIGGERS,
  DEFAULT_HEURISTICS,
  SUSPECTED_AGENTS,
  DEFAULT_ACCEPT_TAXONOMY,
  // Individual heuristics
  sentryBaggageHeuristic,
  cursorHeuristic,
  chrome122Heuristic,
  conversationTrackingHeuristic,
  markdownMimeHeuristic,
  acceptTaxonomyHeuristic,
  missingBrowserHeadersHeuristic,
  // Skip patterns
  DEFAULT_SKIP_EXTENSIONS,
  DEFAULT_SKIP_PATHS,
  DEFAULT_SKIP_PREFIXES,
  DEFAULT_SKIP_SUBSTRINGS,
  // Scanner detection
  DEFAULT_PROBE_PATTERNS,
  DEFAULT_SCANNER_MIN_PROBES,
  DEFAULT_SCANNER_WINDOW_SECONDS,
  DEFAULT_SCANNER_CATEGORIES,
  SCANNER_NAME,
  PROBE_METHODS_ANY_4XX,
  PROBE_METHODS_MISSING,
  // Session config
  DEFAULT_WINDOW_SECONDS,
  DEFAULT_PROXY_WINDOW_SECONDS,
  CURSOR_PROXY_AGENT,
  // Aggregation
  DEFAULT_TOP_PATHS_SKIP_CATEGORIES,
  DEFAULT_TOP_ITEM_PATHS_LIMIT,
  // Category constants
  CATEGORY_HUMAN,
  CATEGORY_AGENT,
  CATEGORY_FEED_READER,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_OTHER_BOT,
  CATEGORY_SPOOFED_BROWSER,
  CATEGORY_SCANNER,
  CATEGORY_UNKNOWN,
  AI_CATEGORY_PREFIX,
  UNIDENTIFIED_AGENT,
} from 'agent-traffic-classifier';
```

## License

MIT
