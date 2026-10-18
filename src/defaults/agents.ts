import type { IpInfo, SignalEntry, SignalHeuristic } from '../types.js';
import { CATEGORY_SPOOFED_BROWSER } from './categories.js';

/** Known agent UA patterns for signal classification. */
export const DEFAULT_KNOWN_AGENTS: Array<{ pattern: string; name: string; company: string }> = [
  // Claude Code's WebFetch: "Claude-User (claude-code/X.Y.Z; ...)". The bare
  // "Claude-User/1.0" UA is Claude.ai fetching on a user's behalf (ai-assistant),
  // which the bot database handles.
  { pattern: 'claude-code/', name: 'Claude Code', company: 'Anthropic' },
  { pattern: 'Claude-Agent', name: 'Claude Agent', company: 'Anthropic' },
  { pattern: 'Google-Gemini-CLI', name: 'Gemini CLI', company: 'Google' },
  { pattern: 'markdown.new', name: 'markdown.new', company: 'markdown.new' },
  // OpenCode's webfetch tool since 2026-08-19 (anomalyco/opencode #43330).
  { pattern: 'OpenCode-User', name: 'OpenCode', company: 'Anomaly' },
  { pattern: 'Augment-WebFetch', name: 'Augment Code', company: 'Augment Code' },
];

/** Known dev tools: stay as programmatic, never promoted to agent. */
export const DEFAULT_DEV_TOOLS: string[] = ['curl'];

/** Triggers that indicate agent behavior even with unknown/generic UAs. */
export const DEFAULT_AGENT_TRIGGERS: Set<string> = new Set(['content-negotiation', 'llms-txt']);

/**
 * Suspected agent candidates by country, keyed by fingerprint.
 * Used by heuristics that can identify a class of agent but not the specific service.
 * When IP intelligence provides a country match, the heuristic returns the candidate
 * list instead of a generic name.
 */
export const SUSPECTED_AGENTS: Record<string, Record<string, string>> = {
  'chinese-ai-assistant': {
    CN: 'Kimi / Doubao / DeepSeek (suspected)',
  },
};

/**
 * Accept header taxonomy: known Accept patterns that identify agent frameworks.
 * Each agent framework produces a distinctive preference ordering and q-values.
 * These patterns are more stable than UA strings.
 *
 * Matched after whitespace normalization (`, ` → `,`), using startsWith.
 * Order matters: more specific patterns first to avoid short-circuiting.
 *
 * Patterns already caught by specific heuristics (chrome122, exaFetch, openCode, markdownMime)
 * are excluded because those heuristics run earlier in the chain.
 */
export interface AcceptPattern {
  prefix: string;
  name: string;
}

/**
 * Accept header of Exa's fetch infrastructure (markdown first, then a
 * browser-like preference list). Sent by `ExaSearchBot`, by `ExaUser`, and,
 * until Exa started labelling user-initiated fetches as `ExaUser` in late
 * September 2026, by Cursor's URL fetch with a generic Chrome UA (controlled
 * tests 2026-04, 2026-09-19 and 2026-10-18; the last one arrived as ExaUser).
 */
export const EXA_FETCH_ACCEPT_PREFIX =
  'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5';

/** @deprecated Renamed to EXA_FETCH_ACCEPT_PREFIX; Cursor's fetch runs on Exa and now self-identifies as ExaUser. */
export const CURSOR_ACCEPT_PREFIX = EXA_FETCH_ACCEPT_PREFIX;

/** Name reported for the Exa fetch fingerprint when the UA does not self-identify. */
export const EXA_FETCH_NAME = 'Exa fetch (suspected)';

/**
 * Accept headers hardcoded in OpenCode's webfetch tool
 * (anomalyco/opencode, packages/core/src/tool/plugin/webfetch.ts), one per
 * output format: markdown (the default), text, and html. Normalized form
 * (no space after commas). OpenCode's HTTP client (Effect) also adds
 * `Traceparent` and `B3` tracing headers to every request.
 */
export const OPENCODE_ACCEPT_PREFIXES: string[] = [
  'text/markdown;q=1.0,text/x-markdown;q=0.9,text/plain;q=0.8,text/html;q=0.7,*/*;q=0.1',
  'text/plain;q=1.0,text/markdown;q=0.9,text/html;q=0.8,*/*;q=0.1',
  'text/html;q=1.0,application/xhtml+xml;q=0.9,text/plain;q=0.8,text/markdown;q=0.7,*/*;q=0.1',
];

/** Identity reported when a request matches OpenCode's fingerprint without its self-identifying UA (builds before 2026-08-19 sent a generic Chrome/143 UA). */
export const OPENCODE_SUSPECTED = { name: 'OpenCode (suspected)', company: 'Anomaly' } as const;

export const DEFAULT_ACCEPT_TAXONOMY: AcceptPattern[] = [
  // text/plain preferred over markdown. OpenCode's text format sends the full
  // form and is caught by openCodeAcceptHeuristic first; this catches partial
  // or variant lists with the same unusual ordering.
  { prefix: 'text/plain;q=1.0,text/markdown', name: 'text-first agent' },
  // HTML first, then JSON, markdown, plain text and CSV. Seen from generic Chrome UAs
  // and from self-identifying AI search bots (Keenable, Aranet) in Sept 2026 traffic,
  // so it is a shared fetch framework rather than a single product.
  {
    prefix:
      'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/markdown;q=0.7,text/plain;q=0.6,text/csv;q=0.6',
    name: 'html-first agent',
  },
  // axios-based pattern (same as Claude Code WebFetch, but from non-Claude UAs)
  { prefix: 'text/markdown,text/html,*/*', name: 'axios-pattern agent' },
  // Full browser-like preference list with markdown first: Exa's fetch
  // infrastructure. The exaFetchHeuristic matches the full fingerprint; this
  // entry catches Accept-only matches (e.g. a client whose proxy strips the
  // cache headers). ExaSearchBot and ExaUser send the same Accept but
  // self-identify and are excluded by the bot database before this runs.
  {
    prefix: EXA_FETCH_ACCEPT_PREFIX,
    name: EXA_FETCH_NAME,
  },
  // got library: markdown + plain text preference
  { prefix: 'text/markdown,text/plain;q=0.9,*/*;q=0.8', name: 'got-pattern agent' },
  // Variant with q=0.8 for wildcard (different from Chrome 122's q=0.1)
  { prefix: 'text/markdown,text/html;q=0.9,*/*;q=0.8', name: 'markdown agent' },
  // Minimal: markdown + html preference without wildcard
  { prefix: 'text/markdown,text/html;q=0.9', name: 'markdown agent' },
  // Bare markdown request (minimal client)
  { prefix: 'text/markdown', name: 'markdown agent (minimal)' },
];

/** Normalize an Accept header for taxonomy matching: collapse whitespace after commas. */
function normalizeAccept(accept: string): string {
  return accept.replace(/,\s+/g, ',').trim();
}

/**
 * Sentry Baggage heuristic: a constant `sentry-public_key` leaked in the
 * Baggage header of a server-side fetch pipeline, seen in April 2026 alongside
 * `Traceparent`, `B3` and OpenCode's markdown-first Accept header.
 *
 * It was attributed to Cursor at the time. Controlled Cursor tests in
 * September and October 2026 never produced tracing or Sentry headers, while
 * OpenCode's source hardcodes that exact Accept string, adds Traceparent and
 * B3 through its Effect HTTP client, and ships Sentry in its desktop app. The
 * key itself has not been matched to a project, so the result stays
 * "suspected".
 */
export const sentryBaggageHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const baggage = entry.headers?.['Baggage'] || '';
  if (baggage.includes('sentry-public_key=41fa59a1376ec796312848f4f17266ba')) {
    return { isAgent: true, name: OPENCODE_SUSPECTED.name, company: OPENCODE_SUSPECTED.company };
  }
  return null;
};

/**
 * Exa fetch heuristic: the header fingerprint of Exa's fetch infrastructure
 * when it arrives without a self-identifying UA:
 *
 * - generic Chrome UA, no Code/ token
 * - Accept: text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,...
 * - Pragma: no-cache and Cache-Control: no-cache
 * - no Sec-Ch-Ua (a real Chrome always sends it)
 * - each request from a different proxy IP; no tracing or Sentry headers
 *
 * This was Cursor's URL fetch in controlled tests on 2026-04 and 2026-09-19
 * (Chrome/145 at the time). On 2026-10-18 the same test produced the same
 * fingerprint under the `ExaUser/1.0` UA with Web Bot Auth signatures, so Exa
 * now labels these fetches and the bot database routes them to `ai-assistant`
 * before this runs. A match here is therefore an Exa-run fetch from a client
 * that strips or predates the label, and is reported as suspected rather than
 * attributed to Cursor.
 */
export const exaFetchHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const h = entry.headers ?? {};
  const ua = h['User-Agent'] || '';
  if (!ua.includes('Chrome/') || ua.includes('Code/')) return null;
  if (h['Sec-Ch-Ua']) return null;
  if (!normalizeAccept(h['Accept'] || '').startsWith(EXA_FETCH_ACCEPT_PREFIX)) return null;
  if (h['Pragma'] !== 'no-cache' || h['Cache-Control'] !== 'no-cache') return null;
  return { isAgent: true, name: EXA_FETCH_NAME, company: null };
};

/** @deprecated Renamed to exaFetchHeuristic; the fingerprint belongs to Exa's infrastructure, not to Cursor alone. */
export const cursorFetchHeuristic: SignalHeuristic = exaFetchHeuristic;

function matchesOpenCodeAccept(accept: string | undefined): boolean {
  const normalized = normalizeAccept(accept || '');
  return OPENCODE_ACCEPT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Traced proxy heuristic: generic Chrome UA + Traceparent (OpenTelemetry) header,
 * but NOT VS Code (which includes "Code/" in the UA). Tracing headers mean a
 * server-side fetch pipeline, so this is an agent of some kind.
 *
 * Paired with one of OpenCode's Accept headers this is an OpenCode build from
 * before 2026-08-19, when its webfetch tool sent a generic Chrome/143 UA (the
 * Traceparent and B3 headers come from its Effect HTTP client). Current builds
 * self-identify as `OpenCode-User` and never reach this heuristic. Any other
 * Accept header is reported as a generic traced proxy agent.
 */
export const tracedProxyHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const ua = entry.headers?.['User-Agent'] || '';
  if (!entry.headers?.['Traceparent'] || !ua.includes('Chrome/') || ua.includes('Code/')) {
    return null;
  }
  if (matchesOpenCodeAccept(entry.headers?.['Accept'])) {
    return { isAgent: true, name: OPENCODE_SUSPECTED.name, company: OPENCODE_SUSPECTED.company };
  }
  return { isAgent: true, name: 'traced proxy agent', company: null };
};

/**
 * OpenCode Accept heuristic: any request whose Accept header is one of the
 * three preference lists hardcoded in OpenCode's webfetch tool, regardless of
 * UA or tracing headers. Catches OpenCode builds whose proxy strips tracing
 * headers, and forks that reuse the fetch tool. Self-identifying `OpenCode-User`
 * requests are matched by the bot database before this runs.
 */
export const openCodeAcceptHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  if (!matchesOpenCodeAccept(entry.headers?.['Accept'])) return null;
  return { isAgent: true, name: OPENCODE_SUSPECTED.name, company: OPENCODE_SUSPECTED.company };
};

/** @deprecated Renamed to tracedProxyHeuristic; kept as an alias. */
export const cursorHeuristic: SignalHeuristic = tracedProxyHeuristic;

/** Name reported for clients whose browser headers contradict their user agent. */
export const SPOOFED_BROWSER_NAME = 'browser-spoofing crawler';

/**
 * Spoofed browser heuristic: the request carries browser client hints that a
 * real browser could not have produced alongside its own user agent.
 *
 * - Firefox and Safari never send `Sec-Ch-Ua`; a Gecko or WebKit UA with client
 *   hints is a fetch library wearing a costume.
 * - Chrome and Edge report their own major version in `Sec-Ch-Ua`; a UA whose
 *   major disagrees with the hint is spoofed.
 *
 * Observed in September 2026 as a distributed crawler (~1,000 IPs, a frozen set
 * of early-2024 browser UAs, client hints from a small fixed pool) that fetched
 * llms.txt and .md URLs while presenting as human visitors.
 *
 * Returns a non-agent result carrying the `spoofed-browser` category, so
 * session attribution can relabel the matching IP+UA traffic without
 * counting it as an agent.
 */
export const spoofedBrowserHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const h = entry.headers ?? {};
  const ua = h['User-Agent'] || '';
  const hints = h['Sec-Ch-Ua'];
  if (!hints || !ua.startsWith('Mozilla/5.0 (')) return null;

  const isGecko = /Gecko\/\d+/.test(ua) && /Firefox\//.test(ua);
  const isSafari = /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\//.test(ua);
  if (isGecko || isSafari) {
    return {
      isAgent: false,
      category: CATEGORY_SPOOFED_BROWSER,
      name: SPOOFED_BROWSER_NAME,
      company: null,
    };
  }

  const uaMajor = (ua.match(/(?:Chrome|CriOS|Edg)\/(\d+)/) ?? [])[1];
  const hintMajor = (hints.match(/"(?:Google Chrome|Chromium|Microsoft Edge)";v="(\d+)"/) ?? [])[1];
  if (uaMajor && hintMajor && uaMajor !== hintMajor) {
    return {
      isAgent: false,
      category: CATEGORY_SPOOFED_BROWSER,
      name: SPOOFED_BROWSER_NAME,
      company: null,
    };
  }
  return null;
};

/**
 * Chrome 122 / macOS 14.7.2 heuristic: frozen Chrome version and OS fingerprint
 * combined with markdown content negotiation. Identified in HN traffic analysis
 * as a Chinese AI assistant service (Kimi, Doubao, DeepSeek, or similar) doing
 * server-side web retrieval through proxy infrastructure.
 *
 * With IP intelligence: CN country → "Kimi / Doubao / DeepSeek (suspected)"
 * Without IP intelligence: → "unidentified AI assistant"
 */
export const chrome122Heuristic: SignalHeuristic = (entry: SignalEntry, ipInfo?: IpInfo) => {
  const ua = entry.headers?.['User-Agent'] || '';
  const accept = entry.headers?.['Accept'] || '';
  if (
    ua.includes('Chrome/122.0.0.0') &&
    ua.includes('Mac OS X 14_7_2') &&
    accept.includes('text/markdown')
  ) {
    const candidates = SUSPECTED_AGENTS['chinese-ai-assistant'];
    const country = ipInfo?.country;
    const name = (country && candidates[country]) || 'unidentified AI assistant';
    return { isAgent: true, name, company: null };
  }
  return null;
};

/**
 * Conversation tracking headers: X-Conversation-Id and X-Conversation-Request-Id
 * are definitively agent conversation-tracking headers. No browser sends these.
 *
 * With IP intelligence: uses the same suspected agent lookup as chrome122.
 * Without IP intelligence: → unnamed agent (isAgent: true, no name).
 */
export const conversationTrackingHeuristic: SignalHeuristic = (
  entry: SignalEntry,
  ipInfo?: IpInfo,
) => {
  if (entry.headers?.['X-Conversation-Id'] || entry.headers?.['X-Conversation-Request-Id']) {
    const candidates = SUSPECTED_AGENTS['chinese-ai-assistant'];
    const country = ipInfo?.country;
    const name = country && candidates[country];
    return name ? { isAgent: true, name, company: null } : { isAgent: true };
  }
  return null;
};

/**
 * text/x-markdown Accept heuristic: the unofficial text/x-markdown MIME type
 * is only sent by purpose-built markdown-aware agents. No standard browser or
 * common HTTP library uses this MIME type.
 */
export const markdownMimeHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const accept = entry.headers?.['Accept'] || '';
  if (accept.includes('text/x-markdown')) {
    return { isAgent: true, name: 'markdown agent', company: null };
  }
  return null;
};

/**
 * Accept header taxonomy heuristic: matches known Accept patterns that identify
 * agent frameworks. Each framework produces a distinctive preference ordering
 * and q-value pattern that is more stable than UA strings.
 *
 * Runs after more specific heuristics (chrome122, exaFetch, openCode, markdownMime) so it
 * only catches entries those missed. Provides more specific naming than the
 * trigger-based "unidentified" fallback.
 */
export const acceptTaxonomyHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const accept = entry.headers?.['Accept'] || '';
  if (!accept.includes('text/markdown') && !accept.includes('text/plain;q=1.0')) return null;

  const normalized = normalizeAccept(accept);
  for (const pattern of DEFAULT_ACCEPT_TAXONOMY) {
    if (normalized.startsWith(pattern.prefix)) {
      return { isAgent: true, name: pattern.name, company: null };
    }
  }
  return null;
};

/**
 * Missing browser headers heuristic: detects agents that impersonate Chrome
 * but omit the security headers that real browsers always send.
 *
 * Real Chrome sends Sec-Ch-Ua, Sec-Fetch-Dest, Sec-Fetch-Site on every
 * navigation and fetch request. Agents using fetch libraries (even with
 * Chrome-like UAs) omit these. A Chrome UA requesting markdown content
 * without these headers is almost certainly an agent.
 *
 * This is a broad catch-all that runs after all more specific heuristics.
 */
export const missingBrowserHeadersHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const ua = entry.headers?.['User-Agent'] || '';
  const accept = entry.headers?.['Accept'] || '';

  // Only applies to Chrome-like UAs requesting markdown
  if (!ua.includes('Chrome/') || ua.includes('Code/')) return null;
  if (!accept.includes('text/markdown')) return null;

  // Real Chrome always sends Sec-Ch-Ua; its absence is the strongest signal
  if (!entry.headers?.['Sec-Ch-Ua']) {
    return { isAgent: true, name: 'browser-masked agent', company: null };
  }

  return null;
};

/**
 * Plain-text fetcher heuristic: a browser-like (Mozilla/) UA sending a bare
 * `Accept: text/plain` header. No browser sends that Accept value; the
 * combination indicates a fetcher hiding behind rotating browser UAs.
 *
 * Observed in September 2026 as a single llms.txt scanner that cycled through
 * desktop and mobile browser UAs across many IPs while always sending exactly
 * `Accept: text/plain`, `Accept-Encoding: gzip`, `Accept-Language: en-US` and
 * `Cache-Control: no-cache`, and never sending `Sec-Ch-Ua`.
 */
export const plainTextFetcherHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const ua = entry.headers?.['User-Agent'] || '';
  const accept = (entry.headers?.['Accept'] || '').trim();
  if (!ua.startsWith('Mozilla/')) return null;
  if (accept !== 'text/plain') return null;
  if (entry.headers?.['Sec-Ch-Ua']) return null;
  return { isAgent: true, name: 'plain-text fetcher (browser-masked)', company: null };
};

/** Default heuristics for signal-based agent detection (order matters: first match wins). */
export const DEFAULT_HEURISTICS: SignalHeuristic[] = [
  spoofedBrowserHeuristic,
  chrome122Heuristic,
  sentryBaggageHeuristic,
  exaFetchHeuristic,
  tracedProxyHeuristic,
  openCodeAcceptHeuristic,
  conversationTrackingHeuristic,
  markdownMimeHeuristic,
  acceptTaxonomyHeuristic,
  missingBrowserHeadersHeuristic,
  plainTextFetcherHeuristic,
];
