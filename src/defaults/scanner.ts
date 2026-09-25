/**
 * Defaults for vulnerability scanner detection.
 *
 * Scanners probe for leaked secrets (.env, .git, SSH keys, cloud and AI-agent
 * credentials), path-traversal holes, framework debug endpoints, and known
 * remote-code-execution bugs. Many rotate through mainstream browser user
 * agents and attach a fake referrer (Reddit, Hacker News, Facebook, Google,
 * t.co) to every request so the traffic looks organic. Request by request
 * their traffic classifies as `human`.
 *
 * `DEFAULT_PROBE_PATTERNS` names the paths only a scanner asks for. The filter
 * drops those requests from stats, and `detectScanners` uses `isProbeRequest`
 * (patterns plus status code and method) to identify the IPs sending them so
 * the rest of the session is relabelled too, taking the fake referrers with it.
 */
import type { LogEntry } from '../types.js';
import {
  CATEGORY_HUMAN,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_SPOOFED_BROWSER,
  CATEGORY_UNKNOWN,
} from './categories.js';

/**
 * Request paths (including query string) that only a vulnerability scanner asks for.
 * Matched against the raw request path with `RegExp.test`.
 *
 * Kept deliberately narrower than `DEFAULT_SKIP_SUBSTRINGS`: a match here can
 * relabel an IP's whole session, so anything a real visitor to a WordPress,
 * PHP, or docs site might trip is either left out or anchored to a filename.
 * `isProbeRequest` adds a further guard: a path match only counts when the
 * server answered 4xx, so a file that really exists on a site never counts.
 */
export const DEFAULT_PROBE_PATTERNS: RegExp[] = [
  // Path traversal in any encoding: ../  %2e%2e/  .%2e/  %2e./  %252e%252e/  %2f../  overlong UTF-8
  /(?:\.|%2e|%252e){2}(?:\/|%2f|%252f|\\)/i,
  /%c0%ae|%c0%af|%e0%80%ae/i,
  // Absolute system paths
  /\/(?:etc|proc)\//i,
  /\/var\/(?:log|www|run|lib|backups?)\//i,
  /\/(?:root|home\/[^/]+)\/\./i,
  // Dotfiles and dot-directories that hold secrets or source
  /(?:^|\/|%2f)(?:\.|%2e)(?:git|svn|hg|ssh|aws|docker|kube|npmrc|htpasswd|htaccess|bash_history|mysql_history|DS_Store|vscode|idea|github|gitlab-ci|travis|circleci)(?![a-z0-9])/i,
  // AI coding agent and cloud CLI credential stores
  /(?:^|\/|%2f)(?:\.|%2e)(?:claude|codex|cursor|openai|anthropic|gemini|aider|continue)(?![a-z0-9])/i,
  /\.config\/(?:gh|gcloud|claude|codex|openai|anthropic)\//i,
  /application_default_credentials/i,
  // Environment files in any position: /.env  /.env.local  /.env1  /config/aws.env  /%2eenv
  /(?:\.|%2e)env(?![a-z])/i,
  // Private keys and credential files
  /id_(?:rsa|dsa|ecdsa|ed25519)/i,
  /(?:aws|gcp|google|azure|service)[-_.]?(?:account[-_.]?)?credentials/i,
  /\.aws\/credentials/i,
  /(?:^|\/)(?:secrets?|credentials?)\.(?:json|ya?ml|txt|ini)/i,
  /serviceaccount\/token/i,
  // Config files that leak secrets
  /wp-config/i,
  /(?:^|\/)(?:configuration|config|settings|database|db)\.php/i,
  /(?:^|\/)settings\.py/i,
  /(?:^|\/)(?:serverless|docker-compose|application|aws)\.ya?ml/i,
  /(?:^|\/)application\.properties/i,
  /(?:^|\/)appsettings(?:\.[\w-]+)?\.json/i,
  /(?:^|\/)web\.config(?:$|\?)/i,
  /\/(?:WEB|META)-INF\//i,
  /(?:^|\/)(?:composer|package)\.(?:json|lock)(?:$|\?)/i,
  /(?:^|\/)node_modules\//i,
  // Framework debug and admin endpoints
  /\/(?:actuator|_ignition|_profiler|_debugbar|server-status|server-info|elmah\.axd|h2-console)(?:$|\/|\?)/i,
  /\/telescope\/api\//i,
  /\/(?:solr\/admin|geoserver\/web|jenkins\/login|nacos\/v1|druid\/index\.html)/i,
  /Telerik\.Web\.UI/i,
  /(?:debug|laravel|error)\.log/i,
  // PHP info dumps, dev leftovers, and web shells, anchored to the filename
  /(?:^|\/)(?:php_?info|php-info|phpversion|pinfo|info|test|debug|shell|cmd|c99|r57|wso|alfa|adminer|i|p|pi|php)\.php(?:$|\?|\.)/i,
  /phpmyadmin|\/pma\//i,
  /xmlrpc\.php/i,
  // CMS fingerprinting
  /wp-(?:admin|login)/i,
  /wp-includes\//i,
  /wlwmanifest\.xml/i,
  /rest_route=|\/wp\/v2\/users/i,
  /manifests\/files\/joomla\.xml|\/administrator\/(?:$|\?|index\.php|manifests)/i,
  /\/plugins\/[^/]+\/readme\.txt/i,
  /\/ghost\/api\/content/i,
  // Remote code execution probes
  /cgi-bin|eval-stdin|vendor\/phpunit|thinkphp|invokefunction/i,
  /(?:^|\/)(?:_rsc|api\/rsc)(?:$|\?|\/)/i,
  /\/(?:manager\/html|boaform|HNAP1|autodiscover\/autodiscover|owa\/auth)(?:$|\/|\?|\.)/i,
  // Injection payloads anywhere in the request
  /\$\{jndi:|%24%7bjndi/i,
  /union(?:\+|%20| )+(?:all(?:\+|%20| )+)?select|sleep\(\d+\)|benchmark\(|information_schema/i,
  /<script|%3cscript/i,
  /xdebug_session_start/i,
  // Backups and editor droppings
  /\.(?:bak|old|orig|swp)(?:$|\?)/i,
  /(?:^|\/)(?:backup|bak|www|site|html|public_html|htdocs|wwwroot|db|database|dump)[\w.-]*\.(?:zip|tar|tgz|gz|rar|7z)(?:$|\?)/i,
];

/** Test whether a request path matches any probe pattern, regardless of status or method. */
export function isProbePath(path: string, patterns: RegExp[] = DEFAULT_PROBE_PATTERNS): boolean {
  return patterns.some((re) => re.test(path));
}

/** Methods that no browser or ordinary client sends; any 4xx answer marks a probe. */
export const PROBE_METHODS_ANY_4XX: ReadonlySet<string> = new Set([
  'PROPFIND',
  'TRACE',
  'TRACK',
  'CONNECT',
]);

/**
 * Write methods that real clients do use; they mark a probe only when the target
 * does not exist (404) or refuses the method (405, 501). Validation and auth
 * failures (400, 401, 403, 422) on real endpoints never count.
 */
export const PROBE_METHODS_MISSING: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/**
 * Decide whether a single request is a vulnerability probe.
 *
 * - A probe pattern in the query string counts regardless of status: static
 *   hosts answer `/?rest_route=/wp/v2/users` with the homepage and a 200.
 * - A probe pattern in the path counts only on a 4xx answer. A path that really
 *   exists on the site (`/wp-login.php` on WordPress, `/docker-compose.yml` in a
 *   docs download folder) returns 2xx and never counts.
 * - PROPFIND, TRACE, TRACK, and CONNECT count on any 4xx.
 * - POST, PUT, PATCH, and DELETE count on 404, 405, or 501.
 */
export function isProbeRequest(
  entry: Pick<LogEntry, 'path' | 'status' | 'method'>,
  patterns: RegExp[] = DEFAULT_PROBE_PATTERNS,
): boolean {
  const q = entry.path.indexOf('?');
  if (q !== -1 && isProbePath(entry.path.slice(q), patterns)) return true;
  const clientError = entry.status >= 400 && entry.status < 500;
  if (clientError && isProbePath(entry.path, patterns)) return true;
  const method = entry.method.toUpperCase();
  if (clientError && PROBE_METHODS_ANY_4XX.has(method)) return true;
  if (
    (entry.status === 404 || entry.status === 405 || entry.status === 501) &&
    PROBE_METHODS_MISSING.has(method)
  ) {
    return true;
  }
  return false;
}

/** Name assigned to traffic demoted by `detectScanners`. */
export const SCANNER_NAME = 'vulnerability scanner';

/** Minimum probe requests, within `DEFAULT_SCANNER_WINDOW_SECONDS` of each other, before an IP is treated as a scanner. */
export const DEFAULT_SCANNER_MIN_PROBES = 3;

/** Window (15 minutes) both for the probe burst and for how far from a probe a request is demoted. */
export const DEFAULT_SCANNER_WINDOW_SECONDS = 900;

/**
 * Categories `detectScanners` may demote: the ones a scanner hides in. Curated
 * bots, isbot-detected bots (`other-bot`), and attributed agents all
 * self-identify and are left alone.
 */
export const DEFAULT_SCANNER_CATEGORIES: string[] = [
  CATEGORY_HUMAN,
  CATEGORY_SPOOFED_BROWSER,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_UNKNOWN,
];
