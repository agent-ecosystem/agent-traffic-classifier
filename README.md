# agent-traffic-classifier

Classify web server traffic into humans, bots, AI agents, and programmatic clients. Built for analyzing access logs and HTTP header signals to understand how AI agents interact with your site.

## What it does

Given access log entries (and optionally HTTP header signals), the library:

1. **Classifies** each request by user-agent into a category: human, AI crawler, AI assistant, AI search, coding agent, search crawler, SEO bot, monitoring, social preview, programmatic client, or unknown
2. **Detects AI agents** that use standard browser user-agents (Claude Code, Cursor, Gemini CLI) via HTTP header heuristics and signal attribution
3. **Clusters sessions** by correlating signal data with access logs to reclassify traffic that would otherwise look human
4. **Detects proxy-based agents** (like Cursor) via a duplicate-request heuristic: same path + UA from different IPs within a short window
5. **Aggregates** classified entries into daily summary documents with category breakdowns, top paths, referrers, bot/agent/programmatic stats, and status codes

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
  parseApacheTzOffset,
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

### With signal data

For deeper agent detection, capture HTTP headers from requests that exhibit agent-like behavior (content negotiation, `llms.txt` requests, etc.) and feed them as signal entries. This lets the library identify agents that use standard browser user-agents.

```ts
import {
  parseLine,
  createClassifier,
  createFilter,
  createSignalClassifier,
  buildAgentSeeds,
  reclassifyEntries,
  detectDuplicateRequestAgents,
  aggregate,
} from 'agent-traffic-classifier';
import type { LogEntry, SignalEntry } from 'agent-traffic-classifier';

const classify = createClassifier();
const shouldSkip = createFilter();
const { classifySignalEntry, getSignalSummary } = createSignalClassifier();

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

// Aggregate with signal summary
const docs = aggregate(withDuplicates, {
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
| `ai-crawler`     | AI training data crawlers (GPTBot, ClaudeBot, etc.)                                       |
| `ai-assistant`   | AI assistants fetching live content (ChatGPT-User, Claude-Web)                            |
| `ai-search`      | AI-powered search engines (PerplexityBot, OAI-SearchBot)                                  |
| `agent`          | AI coding agents (Claude Code, Cursor, GitHub Copilot, Gemini CLI)                        |
| `search-crawler` | Traditional search engines (Googlebot, Bingbot)                                           |
| `seo-bot`        | SEO/marketing bots (AhrefsBot, SemrushBot)                                                |
| `monitoring`     | Uptime monitors (UptimeRobot, Pingdom)                                                    |
| `social-preview` | Link preview fetchers (Twitterbot, Slackbot)                                              |
| `programmatic`   | HTTP clients (curl, axios, python-requests)                                               |
| `other-bot`      | Bots detected by [isbot](https://github.com/nicedayfor/isbot) but not in the curated list |
| `unknown`        | Empty or missing user-agent                                                               |

Classification priority: curated bot list > programmatic client heuristic > isbot fallback > human.

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
  cursorHeuristic,
} from 'agent-traffic-classifier';

const { classifySignalEntry, getSignalSummary } = createSignalClassifier({
  // Add a new known agent UA pattern
  knownAgents: [{ pattern: 'MyAgent', name: 'My Agent', company: 'Me' }, ...DEFAULT_KNOWN_AGENTS],
  // Add a custom header-based heuristic
  heuristics: [
    (entry) => {
      if (entry.headers?.['X-My-Agent']) {
        return { isAgent: true, name: 'MyAgent', company: 'Me' };
      }
      return null;
    },
    ...DEFAULT_HEURISTICS,
  ],
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
- **`readLogFiles(dir, pattern?)`** -- Read and parse `.log` and `.log.gz` files from a directory
- **`parseApacheTs(raw)`** -- Convert an Apache timestamp string to Unix epoch seconds
- **`parseApacheTzOffset(raw)`** -- Extract timezone offset in minutes from an Apache timestamp
- **`parseSignalLog(content)`** -- Parse JSONL signal log content into `SignalEntry[]`

### Core

- **`createClassifier(options?)`** -- Returns `(userAgent: string) => ClassifyResult`
- **`createFilter(options?)`** -- Returns `(entry: LogEntry) => boolean` (true = skip)
- **`createSignalClassifier(options?)`** -- Returns `{ classifySignalEntry, getSignalSummary }`

### Sessions

- **`buildAgentSeeds(signalEntries, classifySignalEntry)`** -- Build agent seeds grouped by domain
- **`reclassifyEntries(entries, domainSeeds, classifyFn, options?)`** -- Reclassify access log entries using signal seeds
- **`detectDuplicateRequestAgents(entries, options?)`** -- Detect proxy-based agents via duplicate-request heuristic

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
  cursorHeuristic,
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
  CATEGORY_PROGRAMMATIC,
  CATEGORY_OTHER_BOT,
  CATEGORY_UNKNOWN,
  AI_CATEGORY_PREFIX,
  UNIDENTIFIED_AGENT,
} from 'agent-traffic-classifier';
```

## License

MIT
