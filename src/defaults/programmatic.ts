/**
 * Substring patterns for programmatic HTTP clients.
 * Matched case-insensitively against user-agent strings.
 */
export const DEFAULT_PROGRAMMATIC: string[] = [
  'axios',
  'node-fetch',
  'urllib',
  'python-requests',
  'Python-urllib',
  'Go-http-client',
  'Java/',
  'libwww-perl',
  'Wget',
  'curl',
  'httpx',
  'aiohttp',
  'okhttp',
  'Ruby',
  'colly',
  'newspaper',
  'undici',
  'trafilatura',
  'http.rb',
  'Bun/',
  'got (',
  'HeadlessChrome',
];

/**
 * Exact-match user-agent strings for programmatic clients.
 * These are too generic for substring matching (e.g., "node").
 */
export const DEFAULT_EXACT_PROGRAMMATIC: string[] = ['node'];
