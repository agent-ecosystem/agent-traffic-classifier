import type { ProxyAgentConfig } from '../types.js';

/** How many seconds before/after a signal seed's time window an access log entry can appear and still be reclassified as agent traffic. */
export const DEFAULT_WINDOW_SECONDS = 60;

/** How many seconds apart two requests (same path + UA, different IPs) can be to count as a proxy duplicate pair. */
export const DEFAULT_PROXY_WINDOW_SECONDS = 2;

/** Cursor proxy agent identity, used by `detectDuplicateRequestAgents` when no `proxyAgent` override is provided. */
export const CURSOR_PROXY_AGENT: ProxyAgentConfig = {
  name: 'Cursor',
  company: 'Anysphere',
  suspectedName: 'Cursor (suspected)',
};
