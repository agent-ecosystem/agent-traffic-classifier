/**
 * Default skip patterns for filtering non-content requests from path-level analytics.
 *
 * These defaults target static assets, common vulnerability scanner probes, and
 * infrastructure paths that appear in virtually every web server's access logs
 * regardless of framework or CMS. They are used by `createFilter()` to decide
 * which requests are "content" (and thus counted in topPaths) vs. noise.
 *
 * To customize, pass your own values to `createFilter()`. Each option replaces
 * (not merges with) the corresponding default, so spread the default if you
 * want to extend rather than replace:
 *
 * ```ts
 * import { createFilter, DEFAULT_SKIP_SUBSTRINGS } from 'agent-traffic-classifier';
 *
 * const shouldSkip = createFilter({
 *   // Extend default substrings with site-specific ones
 *   skipSubstrings: [...DEFAULT_SKIP_SUBSTRINGS, '-staging-'],
 * });
 * ```
 */

/** Static asset and scanner probe file extensions. */
export const DEFAULT_SKIP_EXTENSIONS =
  /\.(js|css|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|json|xml|php|sql|bak|log|key|pem)$/i;

/** Exact paths: favicons, manifests, discovery files. */
export const DEFAULT_SKIP_PATHS: string[] = [
  // Favicons and app icons
  '/favicon.ico',
  '/favicon.png',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/apple-touch-icon-120x120.png',
  '/apple-touch-icon-120x120-precomposed.png',
  // Web app manifests
  '/site.webmanifest',
  '/manifest.webmanifest',
  '/service-worker.js',
  // Meta/discovery files
  '/robots.txt',
  '/sitemap.xml',
  '/ads.txt',
  '/app-ads.txt',
  '/style.css',
  // RSS/Atom feeds
  '/feed/',
  // Debug/actuator probes (Spring Boot, etc.)
  '/actuator/',
  '/debug/',
  // Admin panels
  '/admin',
];

/** Path prefixes: static asset directories. */
export const DEFAULT_SKIP_PREFIXES: string[] = [
  '/js/',
  '/css/',
  '/lib/',
  '/fonts/',
  '/assets/',
  '/avatars/',
  '/images/',
  '/static/',
  // Well-known discovery paths
  '/.well-known/',
  // Malformed URLs (always scanner noise)
  '//', // Double-slash
  '/https%3A', // URL-encoded redirect probes
  '/http%3A',
];

/**
 * Substring patterns: matched anywhere in the path via `includes()`.
 *
 * This is the primary defense against vulnerability scanners. Scanners try every
 * prefix variant (/wp/wp-admin/, /new/wp-admin/, /blog/wp-admin/), so substring
 * matching catches them all at once without enumerating prefixes.
 */
export const DEFAULT_SKIP_SUBSTRINGS: string[] = [
  // WordPress probes (scanners try every prefix variant)
  'wp-admin',
  'wp-login',
  'wp-config',
  'xmlrpc',
  'wp-includes',
  'wp-content',
  // PHP probes
  'phpinfo',
  'phpmyadmin',
  '/pma/',
  // Credential and config file probes
  '.env',
  '.git/',
  '.ssh/',
  '.aws/',
  '.docker',
  'docker-compose',
  // Path traversal
  '/etc/passwd',
  '/@fs/',
  // Framework debug/admin probes
  '_profiler',
  '_environment',
  '/webroot/',
  '/cmd_',
];
