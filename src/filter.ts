import type { FilterOptions, LogEntry } from './types.js';
import {
  DEFAULT_SKIP_EXTENSIONS,
  DEFAULT_SKIP_PATHS,
  DEFAULT_SKIP_PREFIXES,
  DEFAULT_SKIP_SUBSTRINGS,
} from './defaults/skip.js';

/**
 * Create a filter function that determines whether a log entry should be skipped.
 * Returns true if the request should be SKIPPED (static assets, probes, etc.).
 */
export function createFilter(options?: FilterOptions): (entry: LogEntry) => boolean {
  const skipExtensions = options?.skipExtensions ?? DEFAULT_SKIP_EXTENSIONS;
  const skipPaths = options?.skipPaths ?? DEFAULT_SKIP_PATHS;
  const skipPrefixes = options?.skipPrefixes ?? DEFAULT_SKIP_PREFIXES;
  const skipSubstrings = options?.skipSubstrings ?? DEFAULT_SKIP_SUBSTRINGS;
  const siteSkipPaths = options?.siteSkipPaths ?? [];

  return (entry: LogEntry): boolean => {
    const { path } = entry;
    if (skipExtensions.test(path)) return true;
    if (skipPaths.some((p) => path.startsWith(p))) return true;
    if (skipPrefixes.some((p) => path.startsWith(p))) return true;
    if (skipSubstrings.some((s) => path.includes(s))) return true;
    // Per-site skip paths
    if (siteSkipPaths.some((p) => path.startsWith(p))) return true;
    return false;
  };
}
