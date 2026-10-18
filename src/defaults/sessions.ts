import type { ProxyAgentConfig } from '../types.js';

/** How many seconds before/after a signal seed's time window an access log entry can appear and still be reclassified as agent traffic. */
export const DEFAULT_WINDOW_SECONDS = 60;

/** How many seconds apart two requests (same path + UA, different IPs) can be to count as a proxy duplicate pair. */
export const DEFAULT_PROXY_WINDOW_SECONDS = 2;

/**
 * Identity assigned by `detectDuplicateRequestAgents` when no `proxyAgent`
 * override is provided. The duplicate-request pattern (same path and UA from
 * two IPs within seconds) was Cursor's proxy behaviour in April 2026; Cursor's
 * fetch has since moved to Exa and makes one request per page, so the default
 * no longer names a product.
 */
export const DEFAULT_PROXY_AGENT: ProxyAgentConfig = {
  name: 'proxy agent',
  company: null,
  suspectedName: 'proxy agent (suspected)',
};

/** @deprecated No longer the default; pass as `proxyAgent` to keep the pre-0.6.0 Cursor attribution. */
export const CURSOR_PROXY_AGENT: ProxyAgentConfig = {
  name: 'Cursor',
  company: 'Anysphere',
  suspectedName: 'Cursor (suspected)',
};
