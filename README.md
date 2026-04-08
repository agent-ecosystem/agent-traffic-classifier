# agent-traffic-classifier

Classify web server traffic into humans, bots, AI agents, and programmatic clients. Built for analyzing access logs and HTTP header signals to understand how AI agents interact with your site.

## What it does

Given access log entries (and optionally HTTP header signals), the library:

1. **Classifies** each request by user-agent into a category: human, AI crawler, AI assistant, AI search, coding agent, search crawler, SEO bot, monitoring, social preview, feed reader, programmatic client, or unknown
2. **Detects AI agents** that use standard browser user-agents (Claude Code, Cursor, Kiro, Gemini CLI) via HTTP header heuristics and signal attribution
3. **Identifies agent frameworks** by Accept header patterns, missing browser security headers, and conversation-tracking headers, even when the specific agent is unknown
4. **Attributes country-level intelligence** to unidentified agents using IP ranges from Regional Internet Registries, enabling suspected identification (e.g., "Kimi / Doubao / DeepSeek (suspected)" for Chinese AI assistants)
5. **Clusters sessions** by correlating signal data with access logs to reclassify traffic that would otherwise look human
6. **Cross-references programmatic traffic** with signal data to upgrade HTTP client requests (httpx, undici, etc.) to agent when they share IPs with known agent signals
7. **Detects proxy-based agents** (like Cursor) via a duplicate-request heuristic: same path + UA from different IPs within a short window
8. **Aggregates** classified entries into daily summary documents with category breakdowns, top paths, referrers, bot/agent/programmatic stats, and status codes

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

// Detect proxy-based agents (e.g., Cursor's duplicate-request pattern)
const withDuplicates = detectDuplicateRequestAgents(classified);

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

| Category         | Description                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `human`          | Regular browser traffic                                                                   |
| `agent`          | AI coding agents (Claude Code, Cursor, Kiro, GitHub Copilot, Gemini CLI, MCP clients)     |
| `ai-crawler`     | AI training data crawlers (GPTBot, ClaudeBot, etc.)                                       |
| `ai-assistant`   | AI assistants fetching live content (ChatGPT-User, GoogleAgent-URLContext)                |
| `ai-search`      | AI-powered search engines (PerplexityBot, OAI-SearchBot, Kagibot)                         |
| `search-crawler` | Traditional search engines (Googlebot, Bingbot)                                           |
| `seo-bot`        | SEO/marketing bots (AhrefsBot, SemrushBot)                                                |
| `monitoring`     | Uptime monitors (UptimeRobot, Pingdom)                                                    |
| `social-preview` | Link preview fetchers (Twitterbot, Slackbot, Mastodon, WhatsApp)                          |
| `feed-reader`    | Feed readers and news apps (FreshRSS, Feedly, HackerNews app)                             |
| `programmatic`   | HTTP clients (curl, axios, python-requests, httpx, trafilatura)                           |
| `other-bot`      | Bots detected by [isbot](https://github.com/nicedayfor/isbot) but not in the curated list |
| `unknown`        | Empty or missing user-agent                                                               |

Classification priority: curated bot list > programmatic client heuristic > isbot fallback > human.

## Signal heuristics

When HTTP header signals are available, the library applies a chain of heuristics to identify agents that use standard browser user-agents. The chain is ordered by specificity (first match wins):

1. **Known agent UAs**: Claude Code (`Claude-User`), Gemini CLI (`Google-Gemini-CLI`), markdown.new
2. **Dev tool exclusion**: curl and other known developer tools are excluded from agent classification
3. **Chrome 122 / macOS 14.7.2**: Frozen browser fingerprint used by Chinese AI assistant services. With CN country IP, returns "Kimi / Doubao / DeepSeek (suspected)"
4. **Cursor (Traceparent)**: Generic Chrome UA with OpenTelemetry tracing headers, excluding VS Code
5. **Conversation tracking headers**: `X-Conversation-Id` or `X-Conversation-Request-Id` are definitively agent headers
6. **text/x-markdown Accept**: The unofficial markdown MIME type is only sent by purpose-built agents
7. **Accept header taxonomy**: Known Accept preference patterns that identify agent frameworks (axios-pattern, text-first, markdown variants)
8. **Missing browser headers**: Chrome UA requesting markdown without `Sec-Ch-Ua` (a header real Chrome always sends)
9. **Trigger-based fallback**: Requests with agent triggers (`content-negotiation`, `llms-txt`) but no heuristic match are classified as "unidentified"

All heuristics are exported individually so you can reorder, replace, or extend the chain.

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
import { createFilter, DEFAULT_SKIP_PATHS } from 'agent-traffic-classifier';

const shouldSkip = createFilter({
  // Extend default paths
  skipPaths: [...DEFAULT_SKIP_PATHS, '/internal/'],
  // Add custom substring matches (empty by default)
  skipSubstrings: ['-staging-'],
  // Per-site paths (empty by default)
  siteSkipPaths: ['/old-section/'],
});
```

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

### Session options

```ts
import { detectDuplicateRequestAgents } from 'agent-traffic-classifier';

const result = detectDuplicateRequestAgents(classified, {
  windowSeconds: 120, // Signal seed matching window (default: 60)
  proxyWindowSeconds: 5, // Duplicate-request pairing window (default: 2)
  proxyAgent: {
    // Override the default Cursor identity
    name: 'Windsurf',
    company: 'Codeium',
    suspectedName: 'Windsurf (suspected)',
  },
});
```

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

- **`buildAgentSeeds(signalEntries, classifySignalEntry)`** -- Build agent seeds grouped by domain
- **`reclassifyEntries(entries, domainSeeds, classifyFn, options?)`** -- Reclassify access log entries using signal seeds
- **`detectDuplicateRequestAgents(entries, options?)`** -- Detect proxy-based agents via duplicate-request heuristic
- **`crossReferenceSignalIps(entries, signalEntries, domain, classifySignalEntry)`** -- Upgrade programmatic entries to agent when their IP appears in signal data

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
  CATEGORY_UNKNOWN,
  AI_CATEGORY_PREFIX,
  UNIDENTIFIED_AGENT,
} from 'agent-traffic-classifier';
```

## License

MIT
