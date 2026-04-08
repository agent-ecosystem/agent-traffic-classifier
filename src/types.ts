/** The canonical log entry shape. All downstream modules operate on this interface. */
export interface LogEntry {
  ip: string;
  timestamp: number; // Unix epoch seconds (UTC)
  method: string;
  path: string;
  status: number;
  size: number;
  referrer: string | null;
  userAgent: string;
}

/** Result of classifying a user-agent string. */
export interface ClassifyResult {
  category: string;
  botName: string | null;
  botCompany: string | null;
}

/** A log entry paired with its classification. */
export interface ClassifiedEntry {
  entry: LogEntry;
  classification: ClassifyResult & { proxyDuplicate?: boolean };
}

/** A signal entry captured from HTTP headers (e.g., via middleware, edge function, or PHP shim). */
export interface SignalEntry {
  ip: string;
  timestamp: number; // Unix epoch seconds (UTC)
  domain: string;
  headers: Record<string, string>;
  trigger?: string; // enables unidentified-agent inference when present
}

/** Result of classifying a signal entry. */
export interface SignalClassifyResult {
  isAgent: boolean;
  name?: string;
  company?: string | null;
}

/** IP intelligence result for a single IP address. */
export interface IpInfo {
  cloudProvider?: string; // e.g., "google", "aws", "cloudflare"
  country?: string; // ISO 3166-1 alpha-2: "CN", "US", etc.
}

/** Synchronous IP lookup function. Returned by the async adapter factories after initialization. */
export type IpLookup = (ip: string) => IpInfo;

/** A heuristic function for detecting agents from signal entry headers. */
export type SignalHeuristic = (entry: SignalEntry, ipInfo?: IpInfo) => SignalClassifyResult | null;

/** A bot entry in the bot database. */
export interface BotEntry {
  pattern: string;
  name: string;
  company: string;
  category: string;
}

/** The bot database shape (as loaded from bots.json). */
export interface BotDatabase {
  categories: Record<string, string>;
  bots: BotEntry[];
}

/** Options for createClassifier. */
export interface ClassifierOptions {
  bots?: BotEntry[];
  programmaticClients?: string[];
  exactProgrammaticClients?: string[];
}

/** Options for createFilter. */
export interface FilterOptions {
  skipExtensions?: RegExp;
  skipPaths?: string[];
  skipPrefixes?: string[];
  skipSubstrings?: string[];
  siteSkipPaths?: string[];
}

/** Options for createSignalClassifier. */
export interface SignalClassifierOptions {
  knownAgents?: Array<{ pattern: string; name: string; company: string }>;
  devTools?: string[];
  agentTriggers?: Set<string>;
  heuristics?: SignalHeuristic[];
  ipLookup?: IpLookup;
}

/** Configuration for the proxy-based agent detected by duplicate-request heuristic. */
export interface ProxyAgentConfig {
  name: string;
  company: string;
  suspectedName: string;
}

/** Options for session functions. */
export interface SessionOptions {
  windowSeconds?: number;
  proxyWindowSeconds?: number;
  proxyAgent?: ProxyAgentConfig;
}

/** An agent seed built from signal entries, used for session attribution. */
export interface AgentSeed {
  name: string;
  company: string | null;
  earliestTs: number;
  latestTs: number;
}

/** Per-agent summary within a signal summary. */
export interface SignalAgentSummary {
  name: string;
  company: string | null;
  requests: number;
  uniqueIPs: number;
  byTrigger: Record<string, number>;
}

/** Summary of signal log data for a domain on a given date. */
export interface SignalSummary {
  totalSignals: number;
  byTrigger: Record<string, number>;
  identifiedAgents: SignalAgentSummary[];
}

/** Options for the aggregate function. */
export interface AggregateOptions {
  domain: string;
  tzOffsetMinutes?: number;
  shouldSkip?: (entry: LogEntry) => boolean;
  signalEntries?: SignalEntry[];
  classifySignalEntry?: (entry: SignalEntry) => SignalClassifyResult;
  getSignalSummary?: (
    signalEntries: SignalEntry[],
    dateKey: string,
    tzOffsetMinutes: number | null,
  ) => SignalSummary | null;
  normalizePath?: (rawPath: string) => { path: string; utmSource: string | null };
  topPathsLimit?: number;
  topPathsSkipCategories?: string[];
  topItemPathsLimit?: number;
  topReferrersLimit?: number;
}

/** A path entry in a daily summary. */
export interface PathStat {
  path: string;
  count: number;
  uniqueIPs: number;
}

/** A referrer entry in a daily summary. */
export interface ReferrerStat {
  referrer: string;
  count: number;
}

/** A bot breakdown entry in a daily summary. */
export interface BotStat {
  name: string;
  company: string | null;
  category: string;
  requests: number;
  uniqueIPs: number;
  topPaths: Array<{ path: string; count: number }>;
}

/** A programmatic client entry in a daily summary. */
export interface ProgrammaticStat {
  client: string;
  requests: number;
  uniqueIPs: number;
}

/** An agent entry in a daily summary. */
export interface AgentStat {
  name: string;
  company: string | null;
  requests: number;
  uniqueIPs: number;
  topPaths: Array<{ path: string; count: number }>;
  byTrigger?: Record<string, number>;
}

/** A daily traffic summary document. */
export interface DaySummary {
  date: string;
  domain: string;
  summary: {
    totalRequests: number;
    byCategory: Record<string, { requests: number; uniqueIPs: number }>;
  };
  topPaths: PathStat[];
  topReferrers: ReferrerStat[];
  aiBots: BotStat[];
  statusCodes: Record<string, number>;
  programmatic: ProgrammaticStat[];
  agents: AgentStat[];
  agentSignals: SignalSummary | null;
}
