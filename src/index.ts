// Types
export type {
  LogEntry,
  ClassifyResult,
  ClassifiedEntry,
  SignalEntry,
  SignalClassifyResult,
  SignalHeuristic,
  IpInfo,
  IpLookup,
  BotEntry,
  BotDatabase,
  ClassifierOptions,
  FilterOptions,
  SignalClassifierOptions,
  ProxyAgentConfig,
  SessionOptions,
  AgentSeed,
  SignalAgentSummary,
  SignalSummary,
  AggregateOptions,
  PathStat,
  ReferrerStat,
  BotStat,
  ProgrammaticStat,
  AgentStat,
  DaySummary,
} from './types.js';

// Apache adapter (convenience layer for Apache Combined Log Format)
export {
  parseLine,
  LOG_LINE_RE,
  parseApacheTs,
  parseApacheTzOffset,
  readLogFiles,
} from './adapters/apache.js';

// Classification
export { createClassifier, defaultBotDb } from './classify.js';

// Filtering
export { createFilter } from './filter.js';

// Signal processing
export { createSignalClassifier } from './signals.js';

// JSONL signal log adapter (convenience layer for PHP shim JSONL format)
export { parseSignalLog, parseSignalTs } from './adapters/jsonl-signals.js';

// IP intelligence adapter (convenience layer for cloud provider + country lookups)
export {
  createIpLookup,
  createCloudProviderLookup,
  createCountryLookup,
  buildCidrIndex,
  parseIpv4,
  parseCidr,
  matchesCidr,
} from './adapters/ip-ranges.js';
export type {
  CidrEntry,
  CloudProviderLookupOptions,
  CountryLookupOptions,
  IpLookupOptions,
} from './adapters/ip-ranges.js';

// Session attribution
export {
  buildAgentSeeds,
  reclassifyEntries,
  detectDuplicateRequestAgents,
  crossReferenceSignalIps,
} from './sessions.js';

// Date utilities
export { extractDateKey } from './date.js';

// Aggregation
export { aggregate, normalizePath } from './aggregate.js';

// Defaults (for consumer-side extension)
export { DEFAULT_PROGRAMMATIC, DEFAULT_EXACT_PROGRAMMATIC } from './defaults/programmatic.js';
export {
  DEFAULT_KNOWN_AGENTS,
  DEFAULT_DEV_TOOLS,
  DEFAULT_AGENT_TRIGGERS,
  DEFAULT_HEURISTICS,
  SUSPECTED_AGENTS,
  DEFAULT_ACCEPT_TAXONOMY,
  cursorHeuristic,
  chrome122Heuristic,
  conversationTrackingHeuristic,
  markdownMimeHeuristic,
  acceptTaxonomyHeuristic,
  missingBrowserHeadersHeuristic,
} from './defaults/agents.js';
export type { AcceptPattern } from './defaults/agents.js';
export {
  DEFAULT_SKIP_EXTENSIONS,
  DEFAULT_SKIP_PATHS,
  DEFAULT_SKIP_PREFIXES,
} from './defaults/skip.js';
export {
  DEFAULT_WINDOW_SECONDS,
  DEFAULT_PROXY_WINDOW_SECONDS,
  CURSOR_PROXY_AGENT,
} from './defaults/sessions.js';
export {
  DEFAULT_TOP_PATHS_SKIP_CATEGORIES,
  DEFAULT_TOP_ITEM_PATHS_LIMIT,
} from './defaults/aggregate.js';
export {
  CATEGORY_UNKNOWN,
  CATEGORY_HUMAN,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_OTHER_BOT,
  CATEGORY_AGENT,
  CATEGORY_FEED_READER,
  AI_CATEGORY_PREFIX,
  UNIDENTIFIED_AGENT,
} from './defaults/categories.js';
