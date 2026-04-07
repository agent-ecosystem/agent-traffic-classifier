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
 * import { createFilter, DEFAULT_SKIP_EXTENSIONS, DEFAULT_SKIP_PATHS } from 'agent-traffic-classifier';
 *
 * const shouldSkip = createFilter({
 *   // Add .md to the default extension filter
 *   skipExtensions: /\.(js|css|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|json|xml|md)$/i,
 *   // Extend default paths with site-specific ones
 *   skipPaths: [...DEFAULT_SKIP_PATHS, '/internal-tool/'],
 *   // Add custom substring patterns (no defaults shipped)
 *   skipSubstrings: ['-nonexistent-'],
 *   // Add per-site paths (no defaults shipped)
 *   siteSkipPaths: ['/staging/'],
 * });
 * ```
 */

/** Static asset file extensions. */
export const DEFAULT_SKIP_EXTENSIONS =
  /\.(js|css|jpg|jpeg|png|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|json|xml)$/i;

/** Exact paths: favicons, manifests, discovery files, and common scanner probes. */
export const DEFAULT_SKIP_PATHS: string[] = [
  // WordPress probes (scanners hit these on every server)
  '/xmlrpc.php',
  '/wp-login.php',
  '/wp-cron.php',
  '/index.php',
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
  // Dotfiles (vulnerability scanners)
  '/.env',
  '/.git',
  // RSS/Atom feeds
  '/feed/',
  // Debug/actuator probes (Spring Boot, etc.)
  '/actuator/',
  '/debug/',
  // Admin panels (vulnerability scanners, not real content)
  '/admin',
];

/** Path prefixes: static asset directories and common scanner targets. */
export const DEFAULT_SKIP_PREFIXES: string[] = [
  '/js/',
  '/css/',
  '/lib/',
  '/fonts/',
  '/assets/',
  '/avatars/',
  '/images/',
  '/static/',
  // WordPress paths (scanners probe these everywhere)
  '/wp-admin/',
  '/wp-includes/',
  '/wp-content/',
  '/wordpress/',
  // Well-known discovery paths
  '/.well-known/',
];
