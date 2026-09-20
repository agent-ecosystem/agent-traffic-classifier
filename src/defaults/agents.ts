import type { IpInfo, SignalEntry, SignalHeuristic } from '../types.js';
import { CURSOR_PROXY_AGENT } from './sessions.js';
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
 * Patterns already caught by specific heuristics (chrome122, cursor, markdownMime)
 * are excluded because those heuristics run earlier in the chain.
 */
export interface AcceptPattern {
  prefix: string;
  name: string;
}

/** Cursor's Accept header (markdown first, then a browser-like preference list). */
export const CURSOR_ACCEPT_PREFIX =
  'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5';

export const DEFAULT_ACCEPT_TAXONOMY: AcceptPattern[] = [
  // text/plain preferred over markdown — unusual ordering, distinct framework
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
  // Full browser-like preference list with markdown first. Cursor's Accept
  // header, confirmed by controlled tests in April and September 2026. The
  // cursorFetchHeuristic matches the full Cursor fingerprint; this entry catches
  // Accept-only matches (e.g. a client whose proxy strips the cache headers).
  // ExaSearchBot sends the same Accept but self-identifies and is excluded by
  // the bot database before this runs.
  {
    prefix: CURSOR_ACCEPT_PREFIX,
    name: CURSOR_PROXY_AGENT.suspectedName,
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
 * Sentry Baggage heuristic: definitively identifies Cursor via its Sentry
 * org credentials leaked in the Baggage header. More specific than the
 * Traceparent-based cursorHeuristic, so it runs first in the chain.
 *
 * The sentry-public_key is constant across all observed Cursor entries
 * and uniquely identifies Cursor's production Sentry deployment.
 */
export const sentryBaggageHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const baggage = entry.headers?.['Baggage'] || '';
  if (baggage.includes('sentry-public_key=41fa59a1376ec796312848f4f17266ba')) {
    return { isAgent: true, name: CURSOR_PROXY_AGENT.name, company: CURSOR_PROXY_AGENT.company };
  }
  return null;
};

/**
 * Cursor fetch heuristic: the full header fingerprint of Cursor's URL fetch,
 * confirmed by a controlled test on 2026-09-19 (fetch initiated from a current
 * Cursor build against a site with no other content-negotiation traffic):
 *
 * - generic Chrome UA (Chrome/145 at the time), no Code/ token
 * - Accept: text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,...
 * - Pragma: no-cache and Cache-Control: no-cache
 * - no Sec-Ch-Ua (a real Chrome always sends it)
 * - each request from a different proxy IP; no tracing or Sentry headers
 *
 * ExaSearchBot sends the same fingerprint with a self-identifying UA and is
 * excluded by the bot database before this runs.
 */
export const cursorFetchHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const h = entry.headers ?? {};
  const ua = h['User-Agent'] || '';
  if (!ua.includes('Chrome/') || ua.includes('Code/')) return null;
  if (h['Sec-Ch-Ua']) return null;
  if (!normalizeAccept(h['Accept'] || '').startsWith(CURSOR_ACCEPT_PREFIX)) return null;
  if (h['Pragma'] !== 'no-cache' || h['Cache-Control'] !== 'no-cache') return null;
  return { isAgent: true, name: CURSOR_PROXY_AGENT.name, company: CURSOR_PROXY_AGENT.company };
};

/**
 * Traced proxy heuristic: generic Chrome UA + Traceparent (OpenTelemetry) header,
 * but NOT VS Code (which includes "Code/" in the UA). Tracing headers mean a
 * server-side fetch pipeline, so this is an agent of some kind.
 *
 * In April 2026 this co-occurred with Cursor's Sentry Baggage header and Accept
 * string. Controlled tests on 2026-09-19 (direct URL fetch and Agent-mode web
 * search, both from a current Cursor build) showed Cursor no longer sends any
 * tracing headers, and the Traceparent traffic seen in September carries a
 * different Accept header (text/markdown;q=1.0, text/x-markdown;q=0.9, ...)
 * plus B3 headers. So: with Cursor's Accept header it is reported as
 * "Cursor (suspected)"; otherwise as a generic traced proxy agent.
 */
export const tracedProxyHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const ua = entry.headers?.['User-Agent'] || '';
  if (!entry.headers?.['Traceparent'] || !ua.includes('Chrome/') || ua.includes('Code/')) {
    return null;
  }
  if (normalizeAccept(entry.headers?.['Accept'] || '').startsWith(CURSOR_ACCEPT_PREFIX)) {
    return {
      isAgent: true,
      name: CURSOR_PROXY_AGENT.suspectedName,
      company: CURSOR_PROXY_AGENT.company,
    };
  }
  return { isAgent: true, name: 'traced proxy agent', company: null };
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
 * Runs after more specific heuristics (chrome122, cursor, markdownMime) so it
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
  cursorFetchHeuristic,
  tracedProxyHeuristic,
  conversationTrackingHeuristic,
  markdownMimeHeuristic,
  acceptTaxonomyHeuristic,
  missingBrowserHeadersHeuristic,
  plainTextFetcherHeuristic,
];
