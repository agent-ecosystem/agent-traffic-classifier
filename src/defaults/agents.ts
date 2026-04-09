import type { IpInfo, SignalEntry, SignalHeuristic } from '../types.js';
import { CURSOR_PROXY_AGENT } from './sessions.js';

/** Known agent UA patterns for signal classification. */
export const DEFAULT_KNOWN_AGENTS: Array<{ pattern: string; name: string; company: string }> = [
  { pattern: 'Claude-User', name: 'Claude Code', company: 'Anthropic' },
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

export const DEFAULT_ACCEPT_TAXONOMY: AcceptPattern[] = [
  // text/plain preferred over markdown — unusual ordering, distinct framework
  { prefix: 'text/plain;q=1.0,text/markdown', name: 'text-first agent' },
  // axios-based pattern (same as Claude Code WebFetch, but from non-Claude UAs)
  { prefix: 'text/markdown,text/html,*/*', name: 'axios-pattern agent' },
  // Cursor Accept pattern: full browser-like preference list with markdown first
  {
    prefix:
      'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5',
    name: 'Cursor (suspected)',
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
 * Cursor heuristic: generic Chrome UA + Traceparent (OpenTelemetry) header,
 * but NOT VS Code (which includes "Code/" in the UA).
 * Cursor proxies requests through server infrastructure that adds tracing.
 */
export const cursorHeuristic: SignalHeuristic = (entry: SignalEntry) => {
  const ua = entry.headers?.['User-Agent'] || '';
  if (entry.headers?.['Traceparent'] && ua.includes('Chrome/') && !ua.includes('Code/')) {
    return { isAgent: true, name: CURSOR_PROXY_AGENT.name, company: CURSOR_PROXY_AGENT.company };
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

/** Default heuristics for signal-based agent detection (order matters: first match wins). */
export const DEFAULT_HEURISTICS: SignalHeuristic[] = [
  chrome122Heuristic,
  sentryBaggageHeuristic,
  cursorHeuristic,
  conversationTrackingHeuristic,
  markdownMimeHeuristic,
  acceptTaxonomyHeuristic,
  missingBrowserHeadersHeuristic,
];
