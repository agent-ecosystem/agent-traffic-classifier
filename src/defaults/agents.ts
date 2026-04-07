import type { SignalEntry, SignalHeuristic } from '../types.js';
import { CURSOR_PROXY_AGENT } from './sessions.js';

/** Known agent UA patterns for signal classification. */
export const DEFAULT_KNOWN_AGENTS: Array<{ pattern: string; name: string; company: string }> = [
  { pattern: 'Claude-User', name: 'Claude Code', company: 'Anthropic' },
  { pattern: 'Google-Gemini-CLI', name: 'Gemini CLI', company: 'Google' },
];

/** Known dev tools: stay as programmatic, never promoted to agent. */
export const DEFAULT_DEV_TOOLS: string[] = ['curl'];

/** Triggers that indicate agent behavior even with unknown/generic UAs. */
export const DEFAULT_AGENT_TRIGGERS: Set<string> = new Set(['content-negotiation', 'llms-txt']);

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

/** Default heuristics for signal-based agent detection. */
export const DEFAULT_HEURISTICS: SignalHeuristic[] = [cursorHeuristic];
