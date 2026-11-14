import { describe, it, expect } from 'vitest';
import { createSignalClassifier } from '../src/signals.js';
import { createClassifier } from '../src/classify.js';
import {
  buildAgentSeeds,
  reclassifyEntries,
  crossReferenceAgentIps,
  crossReferenceSignalIps,
  detectSpoofedBrowsers,
  parseBrowserVersion,
} from '../src/sessions.js';
import { spoofedBrowserHeuristic, SPOOFED_BROWSER_NAME } from '../src/defaults/agents.js';
import type { ClassifiedEntry, LogEntry, SignalEntry } from '../src/types.js';

const CHROME_OLD =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CHROME_NEW =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0';
const SAFARI_OLD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15';
const SAFARI_NEW =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15';
const CLAUDE_CODE = 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)';

function log(overrides: Partial<LogEntry>): LogEntry {
  return {
    ip: '1.1.1.1',
    timestamp: 1_800_000_000,
    method: 'GET',
    path: '/page/',
    status: 200,
    size: 1000,
    referrer: null,
    userAgent: CHROME_NEW,
    ...overrides,
  };
}
function sig(
  overrides: Partial<SignalEntry> & {
    ua?: string;
    accept?: string;
    extra?: Record<string, string>;
  },
): SignalEntry {
  const { ua, accept, extra, ...rest } = overrides;
  return {
    ip: '1.1.1.1',
    timestamp: 1_800_000_000,
    domain: 'example.com',
    headers: { 'User-Agent': ua ?? CHROME_NEW, Accept: accept ?? 'text/html', ...(extra ?? {}) },
    ...rest,
  };
}
const classify = createClassifier();
const { classifySignalEntry } = createSignalClassifier();
const classified = (entries: LogEntry[]): ClassifiedEntry[] =>
  entries.map((entry) => ({ entry, classification: classify(entry.userAgent) }));

describe('spoofedBrowserHeuristic', () => {
  it('flags a browser UA that sends Sec-Fetch-Site without Sec-Fetch-Mode and Sec-Fetch-Dest', () => {
    const r = spoofedBrowserHeuristic(
      sig({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/markdown;q=0.7,text/plain;q=0.6,text/csv;q=0.6,*/*;q=0.5',
        extra: { 'Sec-Fetch-Site': 'cross-site', 'Content-Length': '0', Connection: 'close' },
      }),
    );
    expect(r).toEqual({
      isAgent: false,
      category: 'spoofed-browser',
      name: SPOOFED_BROWSER_NAME,
      company: null,
    });
  });
  it('does not flag a full Fetch Metadata set without client hints (Firefox, Safari)', () => {
    const full = {
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
    };
    expect(spoofedBrowserHeuristic(sig({ ua: FIREFOX, extra: full }))).toBeNull();
    expect(spoofedBrowserHeuristic(sig({ ua: SAFARI_NEW, extra: full }))).toBeNull();
  });
  it('does not flag a non-browser UA that sends partial Fetch Metadata', () => {
    expect(
      spoofedBrowserHeuristic(sig({ ua: CLAUDE_CODE, extra: { 'Sec-Fetch-Site': 'none' } })),
    ).toBeNull();
  });
  it('flags a Firefox UA carrying Chromium client hints', () => {
    const r = spoofedBrowserHeuristic(
      sig({ ua: FIREFOX, extra: { 'Sec-Ch-Ua': '"Chromium";v="99", "Google Chrome";v="99"' } }),
    );
    expect(r).toEqual({
      isAgent: false,
      category: 'spoofed-browser',
      name: SPOOFED_BROWSER_NAME,
      company: null,
    });
  });
  it('flags a Safari UA carrying client hints', () => {
    const r = spoofedBrowserHeuristic(
      sig({
        ua: SAFARI_OLD,
        extra: { 'Sec-Ch-Ua': '"Chromium";v="101", "Microsoft Edge";v="101"' },
      }),
    );
    expect(r?.category).toBe('spoofed-browser');
  });
  it('flags a Chrome UA whose major disagrees with its client hints', () => {
    const r = spoofedBrowserHeuristic(
      sig({
        ua: CHROME_OLD,
        extra: { 'Sec-Ch-Ua': '"Chromium";v="110", "Google Chrome";v="110"' },
      }),
    );
    expect(r?.category).toBe('spoofed-browser');
  });
  it('does not flag consistent Chrome hints, hint-less requests, or non-browser UAs', () => {
    expect(
      spoofedBrowserHeuristic(
        sig({
          ua: CHROME_NEW,
          extra: { 'Sec-Ch-Ua': '"Chromium";v="152", "Google Chrome";v="152"' },
        }),
      ),
    ).toBeNull();
    expect(spoofedBrowserHeuristic(sig({ ua: FIREFOX }))).toBeNull();
    expect(
      spoofedBrowserHeuristic(
        sig({ ua: 'curl/8.7.1', extra: { 'Sec-Ch-Ua': '"Chromium";v="99"' } }),
      ),
    ).toBeNull();
  });
  it('runs first in the default chain and wins over trigger-based fallback', () => {
    const r = classifySignalEntry(
      sig({
        trigger: 'llms-txt',
        ua: FIREFOX,
        extra: { 'Sec-Ch-Ua': '"Chromium";v="99"', 'Sec-Fetch-Dest': 'document' },
      }),
    );
    expect(r.isAgent).toBe(false);
    expect(r.category).toBe('spoofed-browser');
  });
});

describe('category-carrying seeds', () => {
  it('seeds spoofed-browser sessions and reclassifies matching IP+UA traffic without counting it as agent', () => {
    const signals = [
      sig({
        ip: '9.9.9.9',
        ua: FIREFOX,
        trigger: 'llms-txt',
        extra: { 'Sec-Ch-Ua': '"Chromium";v="99"' },
      }),
    ];
    const seeds = buildAgentSeeds(signals, classifySignalEntry).get('example.com')!;
    expect(seeds.size).toBe(1);
    expect([...seeds.values()][0].category).toBe('spoofed-browser');
    const out = reclassifyEntries(
      [
        log({ ip: '9.9.9.9', userAgent: FIREFOX, path: '/llms.txt' }),
        log({ ip: '9.9.9.9', userAgent: FIREFOX, path: '/about/', timestamp: 1_800_000_010 }),
      ],
      seeds,
      classify,
    );
    expect(out.map((e) => e.classification.category)).toEqual([
      'spoofed-browser',
      'spoofed-browser',
    ]);
    expect(out[0].classification.botName).toBe(SPOOFED_BROWSER_NAME);
  });
  it('still seeds agents as agent', () => {
    const seeds = buildAgentSeeds(
      [
        sig({
          ua: CLAUDE_CODE,
          trigger: 'content-negotiation',
          accept: 'text/markdown, text/html, */*',
        }),
      ],
      classifySignalEntry,
    ).get('example.com')!;
    expect([...seeds.values()][0].category).toBe('agent');
  });
});

describe('crossReferenceAgentIps', () => {
  const signals = [
    sig({
      ip: '5.5.5.5',
      ua: CLAUDE_CODE,
      trigger: 'content-negotiation',
      accept: 'text/markdown, text/html, */*',
      domain: 'other.example',
    }),
  ];
  it('attributes a curl request to the agent active from the same IP within the window, across domains', () => {
    const out = crossReferenceAgentIps(
      classified([
        log({
          ip: '5.5.5.5',
          userAgent: 'curl/8.18.0',
          path: '/llms.txt',
          timestamp: 1_800_000_030,
        }),
      ]),
      signals,
      classifySignalEntry,
    );
    expect(out[0].classification).toEqual({
      category: 'agent',
      botName: 'Claude Code',
      botCompany: 'Anthropic',
    });
  });
  it('uses self-identifying access-log agents as anchors too', () => {
    const out = crossReferenceAgentIps(
      classified([
        log({ ip: '5.5.5.5', userAgent: CLAUDE_CODE }),
        log({ ip: '5.5.5.5', userAgent: 'curl/8.18.0', timestamp: 1_800_000_020 }),
      ]),
      [],
      classifySignalEntry,
    );
    expect(out[1].classification.category).toBe('agent');
    expect(out[1].classification.botName).toBe('Claude Code');
  });
  it('does not relabel outside the window, from other IPs, or non-programmatic entries', () => {
    const out = crossReferenceAgentIps(
      classified([
        log({ ip: '5.5.5.5', userAgent: 'curl/8.18.0', timestamp: 1_800_000_000 + 3600 }),
        log({ ip: '6.6.6.6', userAgent: 'curl/8.18.0' }),
        log({ ip: '5.5.5.5', userAgent: CHROME_NEW }),
      ]),
      signals,
      classifySignalEntry,
    );
    expect(out.map((e) => e.classification.category)).toEqual([
      'programmatic',
      'programmatic',
      'human',
    ]);
  });
  it('ignores unidentified and heuristic-only signal results as anchors', () => {
    const weak = [sig({ ip: '7.7.7.7', ua: 'SomeUnknownClient/1.0', trigger: 'llms-txt' })];
    const out = crossReferenceAgentIps(
      classified([log({ ip: '7.7.7.7', userAgent: 'curl/8.18.0' })]),
      weak,
      classifySignalEntry,
    );
    expect(out[0].classification.category).toBe('programmatic');
  });
  it('honours a custom window', () => {
    const out = crossReferenceAgentIps(
      classified([
        log({ ip: '5.5.5.5', userAgent: 'curl/8.18.0', timestamp: 1_800_000_000 + 100 }),
      ]),
      signals,
      classifySignalEntry,
      { windowSeconds: 30 },
    );
    expect(out[0].classification.category).toBe('programmatic');
  });
});

describe('crossReferenceSignalIps window', () => {
  const unidentified = sig({ ip: '5.5.5.5', ua: 'SomeUnknownClient/1.0', trigger: 'llms-txt' });
  const named = sig({
    ip: '5.5.5.5',
    ua: CLAUDE_CODE,
    trigger: 'content-negotiation',
    accept: 'text/markdown, text/html, */*',
    timestamp: 1_800_000_000 + 60,
  });
  it('upgrades programmatic requests within the default window and prefers named agents', () => {
    const out = crossReferenceSignalIps(
      classified([log({ ip: '5.5.5.5', userAgent: 'curl/8.7.1', timestamp: 1_800_000_000 + 30 })]),
      [unidentified, named],
      'example.com',
      classifySignalEntry,
    );
    expect(out[0].classification).toEqual({
      category: 'agent',
      botName: 'Claude Code',
      botCompany: 'Anthropic',
    });
  });
  it('does not upgrade requests outside the window', () => {
    const out = crossReferenceSignalIps(
      classified([
        log({ ip: '5.5.5.5', userAgent: 'curl/8.7.1', timestamp: 1_800_000_000 + 4 * 3600 }),
      ]),
      [unidentified, named],
      'example.com',
      classifySignalEntry,
    );
    expect(out[0].classification.category).toBe('programmatic');
  });
  it('restores the unbounded behaviour with windowSeconds: Infinity', () => {
    const out = crossReferenceSignalIps(
      classified([
        log({ ip: '5.5.5.5', userAgent: 'curl/8.7.1', timestamp: 1_800_000_000 + 4 * 3600 }),
      ]),
      [unidentified, named],
      'example.com',
      classifySignalEntry,
      { windowSeconds: Infinity },
    );
    expect(out[0].classification.category).toBe('agent');
  });
  it('never touches human browser traffic', () => {
    const out = crossReferenceSignalIps(
      classified([log({ ip: '5.5.5.5', userAgent: CHROME_NEW, timestamp: 1_800_000_000 + 30 })]),
      [named],
      'example.com',
      classifySignalEntry,
    );
    expect(out[0].classification.category).toBe('human');
  });
});

describe('parseBrowserVersion', () => {
  it('parses mainstream browsers and rejects bots and embedded apps', () => {
    expect(parseBrowserVersion(CHROME_OLD)).toEqual({ family: 'chrome', major: 122 });
    expect(parseBrowserVersion(FIREFOX)).toEqual({ family: 'firefox', major: 123 });
    expect(parseBrowserVersion(SAFARI_OLD)).toEqual({ family: 'safari', major: 17 });
    expect(
      parseBrowserVersion(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
      ),
    ).toEqual({ family: 'edge', major: 122 });
    expect(
      parseBrowserVersion(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ family: 'ios', major: 13 });
    expect(
      parseBrowserVersion('Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)'),
    ).toBeNull();
    expect(
      parseBrowserVersion(
        'Mozilla/5.0 (Windows NT 10.0) Code/1.138.0 Chrome/148.0.0.0 Electron/42.10.0 Safari/537.36',
      ),
    ).toBeNull();
    expect(parseBrowserVersion('curl/8.7.1')).toBeNull();
  });
});

describe('detectSpoofedBrowsers', () => {
  // A real, current-version session that loads assets: sets the reference for chrome and safari.
  const realChrome = [
    log({ ip: '2.2.2.2', userAgent: CHROME_NEW, path: '/' }),
    log({ ip: '2.2.2.2', userAgent: CHROME_NEW, path: '/css/site.css' }),
  ];
  const realSafari = [
    log({ ip: '3.3.3.3', userAgent: SAFARI_NEW, path: '/' }),
    log({ ip: '3.3.3.3', userAgent: SAFARI_NEW, path: '/images/a.png' }),
  ];
  it('demotes a stale-version pair with multiple requests, no assets, and no self-referrer', () => {
    const spoof = [
      log({ ip: '9.9.9.9', userAgent: CHROME_OLD, path: '/' }),
      log({ ip: '9.9.9.9', userAgent: CHROME_OLD, path: '/about/', timestamp: 1_800_000_005 }),
    ];
    const out = detectSpoofedBrowsers(classified([...realChrome, ...spoof]), 'example.com');
    expect(out.slice(2).map((e) => e.classification.category)).toEqual([
      'spoofed-browser',
      'spoofed-browser',
    ]);
    expect(out.slice(0, 2).map((e) => e.classification.category)).toEqual(['human', 'human']);
  });
  it('never demotes single-request pairs (cached-asset returning visitors)', () => {
    const out = detectSpoofedBrowsers(
      classified([...realChrome, log({ ip: '9.9.9.9', userAgent: CHROME_OLD })]),
      'example.com',
    );
    expect(out[2].classification.category).toBe('human');
  });
  it('demotes a current-version pair that fetched robots.txt without loading assets, even with self-referrers', () => {
    // October 2026: Hetzner crawlers on current Chrome faking same-site referrers on every request.
    const crawler = [
      log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/robots.txt' }),
      log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/', referrer: 'https://example.com/' }),
      log({
        ip: '9.9.9.9',
        userAgent: CHROME_NEW,
        path: '/about/',
        referrer: 'https://example.com/',
        timestamp: 1_800_000_005,
      }),
    ];
    const out = detectSpoofedBrowsers(classified([...realChrome, ...crawler]), 'example.com');
    expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
    expect(out.slice(0, 2).every((e) => e.classification.category === 'human')).toBe(true);
  });
  it('demotes a single robots.txt-only request (distributed robots.txt surveys)', () => {
    const out = detectSpoofedBrowsers(
      classified([
        ...realChrome,
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/robots.txt' }),
      ]),
      'example.com',
    );
    expect(out[2].classification.category).toBe('spoofed-browser');
  });
  it('keeps a robots.txt fetcher that also loaded assets (a person reading robots.txt)', () => {
    const person = [
      log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/' }),
      log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/css/site.css' }),
      log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/robots.txt?x=1' }),
    ];
    const out = detectSpoofedBrowsers(classified([...realChrome, ...person]), 'example.com');
    expect(out.every((e) => e.classification.category === 'human')).toBe(true);
  });
  it('can turn the robots.txt trigger off', () => {
    const out = detectSpoofedBrowsers(
      classified([
        ...realChrome,
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/robots.txt' }),
      ]),
      'example.com',
      { robotsFetchers: false },
    );
    expect(out[2].classification.category).toBe('human');
  });
  it('never demotes current versions, even with no assets (carrier-grade NAT safety)', () => {
    const cur = [
      log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/' }),
      log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/about/' }),
    ];
    const out = detectSpoofedBrowsers(classified([...realChrome, ...cur]), 'example.com');
    expect(out.every((e) => e.classification.category === 'human')).toBe(true);
  });
  it('does not demote stale pairs that load assets or navigate with self-referrers', () => {
    const withRef = [
      log({ ip: '9.9.9.9', userAgent: CHROME_OLD, path: '/' }),
      log({
        ip: '9.9.9.9',
        userAgent: CHROME_OLD,
        path: '/about/',
        referrer: 'https://example.com/',
      }),
    ];
    const out = detectSpoofedBrowsers(classified([...realChrome, ...withRef]), 'example.com');
    expect(out.every((e) => e.classification.category === 'human')).toBe(true);
  });
  it('uses per-family references and, without the floor, skips families with no reference', () => {
    const oldSafari = [
      log({ ip: '9.9.9.9', userAgent: SAFARI_OLD, path: '/' }),
      log({ ip: '9.9.9.9', userAgent: SAFARI_OLD, path: '/about/' }),
    ];
    const oldFirefox = [
      log({ ip: '8.8.8.8', userAgent: FIREFOX, path: '/' }),
      log({ ip: '8.8.8.8', userAgent: FIREFOX, path: '/about/' }),
    ];
    const out = detectSpoofedBrowsers(
      classified([...realSafari, ...oldSafari, ...oldFirefox]),
      'example.com',
      { referenceFloor: false },
    );
    expect(out.slice(2, 4).map((e) => e.classification.category)).toEqual([
      'spoofed-browser',
      'spoofed-browser',
    ]);
    // no asset-loading Firefox session exists, so Firefox cannot be judged
    expect(out.slice(4).map((e) => e.classification.category)).toEqual(['human', 'human']);
  });
  describe('reference floor and sibling families', () => {
    const oldFirefox = [
      log({ ip: '8.8.8.8', userAgent: FIREFOX, path: '/' }),
      log({ ip: '8.8.8.8', userAgent: FIREFOX, path: '/about/' }),
    ];
    const EDGE_OLD =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0';
    const IOS_OLD =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';
    const before = (entries: LogEntry[]) =>
      entries.map((e) => ({ ...e, timestamp: 1_700_000_000 }));

    it('judges a family with no asset-loading session by the floor when the window is past asOf', () => {
      // test timestamps are January 2027, after DEFAULT_REFERENCE_FLOOR.asOf
      const out = detectSpoofedBrowsers(classified([...realSafari, ...oldFirefox]), 'example.com');
      expect(out.slice(2).map((e) => e.classification.category)).toEqual([
        'spoofed-browser',
        'spoofed-browser',
      ]);
    });
    it('does not apply the floor to a log window older than asOf', () => {
      const out = detectSpoofedBrowsers(
        classified(before([...realSafari, ...oldFirefox])),
        'example.com',
      );
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('raises an observed reference that is below the floor', () => {
      const CHROME_MID =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
      const CHROME_130 =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
      const onlyLoader = [
        log({ ip: '2.2.2.2', userAgent: CHROME_MID, path: '/' }),
        log({ ip: '2.2.2.2', userAgent: CHROME_MID, path: '/css/site.css' }),
      ];
      const pair = [
        log({ ip: '9.9.9.9', userAgent: CHROME_130, path: '/' }),
        log({ ip: '9.9.9.9', userAgent: CHROME_130, path: '/about/' }),
      ];
      // observed reference 125 would keep Chrome 130; the floor of 150 makes it stale
      const out = detectSpoofedBrowsers(classified([...onlyLoader, ...pair]), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
      const noFloor = detectSpoofedBrowsers(classified([...onlyLoader, ...pair]), 'example.com', {
        referenceFloor: false,
      });
      expect(noFloor.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('never lowers an observed reference', () => {
      const CHROME_140 =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
      const pair = [
        log({ ip: '9.9.9.9', userAgent: CHROME_140, path: '/' }),
        log({ ip: '9.9.9.9', userAgent: CHROME_140, path: '/about/' }),
      ];
      // observed Chrome 152: 140 is 12 behind, not stale; the floor of 150 must not change that
      const out = detectSpoofedBrowsers(classified([...realChrome, ...pair]), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('shares a reference between Chrome and Edge, and between Safari and iOS, with no floor', () => {
      const edgePair = [
        log({ ip: '9.9.9.9', userAgent: EDGE_OLD, path: '/' }),
        log({ ip: '9.9.9.9', userAgent: EDGE_OLD, path: '/about/' }),
      ];
      const iosPair = [
        log({ ip: '8.8.8.8', userAgent: IOS_OLD, path: '/' }),
        log({ ip: '8.8.8.8', userAgent: IOS_OLD, path: '/about/' }),
      ];
      const out = detectSpoofedBrowsers(
        classified(before([...realChrome, ...realSafari, ...edgePair, ...iosPair])),
        'example.com',
      );
      expect(out.slice(4).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
    });
    it('accepts a custom floor and skips families it leaves out', () => {
      const out = detectSpoofedBrowsers(classified([...realSafari, ...oldFirefox]), 'example.com', {
        referenceFloor: { asOf: '2026-01-01', majors: { chrome: 150 } },
      });
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('ignores the floor when referenceMajors is supplied', () => {
      const out = detectSpoofedBrowsers(classified(oldFirefox), 'example.com', {
        referenceMajors: { chrome: 150 },
      });
      expect(out.every((e) => e.classification.category === 'human')).toBe(true);
    });
  });
  it('accepts explicit reference versions', () => {
    const oldFirefox = [
      log({ ip: '8.8.8.8', userAgent: FIREFOX, path: '/' }),
      log({ ip: '8.8.8.8', userAgent: FIREFOX, path: '/about/' }),
    ];
    const out = detectSpoofedBrowsers(classified(oldFirefox), 'example.com', {
      referenceMajors: { firefox: 147 },
    });
    expect(out[0].classification.category).toBe('spoofed-browser');
  });
  it('leaves non-human categories alone', () => {
    const bot = [
      log({
        ip: '9.9.9.9',
        userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)',
        path: '/',
      }),
      log({
        ip: '9.9.9.9',
        userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)',
        path: '/a/',
      }),
    ];
    const out = detectSpoofedBrowsers(classified([...realChrome, ...bot]), 'example.com');
    expect(out[2].classification.category).toBe('ai-crawler');
  });

  describe('uaPools (November 2026 residential-proxy crawler)', () => {
    const OFFSITE = 'https://corpus.blog/posts/abc';
    const poolOf = (ua: string, count: number, referrer: string | null = OFFSITE) =>
      Array.from({ length: count }, (_, i) =>
        log({
          ip: `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
          userAgent: ua,
          path: `/p${i}/`,
          referrer,
        }),
      );
    it('demotes a stale UA spread one request per IP with referrers and no assets', () => {
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_OLD, 20)]),
        'example.com',
      );
      expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
      expect(out.slice(0, 2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('demotes the pool even when its referrers are same-site pages', () => {
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_OLD, 20, 'https://example.com/other/')]),
        'example.com',
      );
      expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
    });
    it('demotes a stale UA pool that sends no referrers (mid-November 2026 Tencent Cloud pool)', () => {
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_OLD, 20, null)]),
        'example.com',
      );
      expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
      expect(out.slice(0, 2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('poolReferrerShare restores the Referer requirement', () => {
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_OLD, 20, null)]),
        'example.com',
        { poolReferrerShare: 0.8 },
      );
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('counts pairs the version test already demoted toward the single-request share', () => {
      // 16 single-request addresses plus 4 two-request addresses: 80% single on
      // its own, but the two-request pairs are stale with no assets and no
      // same-site referrer, so the pair test demotes them and the pool is whole.
      const twoEach = [1, 2, 3, 4].flatMap((i) => [
        log({ ip: `10.1.0.${i}`, userAgent: CHROME_OLD, path: '/a/', referrer: null }),
        log({ ip: `10.1.0.${i}`, userAgent: CHROME_OLD, path: '/b/', referrer: null }),
      ]);
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_OLD, 16, null), ...twoEach]),
        'example.com',
      );
      expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
    });
    it('keeps a current-version UA pool (ExaUser-shaped proxy fetches)', () => {
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_NEW, 20)]),
        'example.com',
      );
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('keeps a pool below poolMinIps', () => {
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_OLD, 4)]),
        'example.com',
      );
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('keeps a pool when any address wearing the UA loaded an asset', () => {
      const entries = [
        ...realChrome,
        ...poolOf(CHROME_OLD, 20),
        log({
          ip: '10.9.9.9',
          userAgent: CHROME_OLD,
          path: '/css/site.css',
          referrer: 'https://example.com/',
        }),
      ];
      const out = detectSpoofedBrowsers(classified(entries), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('can be disabled with uaPools: false', () => {
      const out = detectSpoofedBrowsers(
        classified([...realChrome, ...poolOf(CHROME_OLD, 20)]),
        'example.com',
        {
          uaPools: false,
        },
      );
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
  });

  describe('bareOriginReferrers (Referer with no path)', () => {
    it('demotes a single-request current-version pair whose Referer is a bare origin', () => {
      const probe = log({
        ip: '7.7.7.7',
        userAgent: CHROME_NEW,
        path: '/api/events/consume',
        status: 404,
        referrer: 'https://example.com',
      });
      const out = detectSpoofedBrowsers(classified([...realChrome, probe]), 'example.com');
      expect(out[2].classification.category).toBe('spoofed-browser');
      expect(out.slice(0, 2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('treats an http:// bare origin and an off-site bare origin the same way', () => {
      const entries = [
        log({ ip: '7.7.7.1', userAgent: CHROME_NEW, referrer: 'http://www.example.com' }),
        log({ ip: '7.7.7.2', userAgent: FIREFOX, referrer: 'https://other.example' }),
      ];
      const out = detectSpoofedBrowsers(classified([...realChrome, ...entries]), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
    });
    it('keeps a pair that also rendered pages', () => {
      const entries = [
        log({ ip: '7.7.7.7', userAgent: CHROME_NEW, path: '/', referrer: 'https://example.com' }),
        log({
          ip: '7.7.7.7',
          userAgent: CHROME_NEW,
          path: '/css/site.css',
          referrer: 'https://example.com/',
        }),
      ];
      const out = detectSpoofedBrowsers(classified([...realChrome, ...entries]), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('does not fire on a referrer with a path, including the origin with a trailing slash', () => {
      const entries = [
        log({ ip: '7.7.7.1', userAgent: CHROME_NEW, referrer: 'https://example.com/' }),
        log({ ip: '7.7.7.2', userAgent: CHROME_NEW, referrer: 'https://www.google.com/' }),
        log({ ip: '7.7.7.3', userAgent: CHROME_NEW, referrer: 'https://example.com/posts/' }),
      ];
      const out = detectSpoofedBrowsers(classified([...realChrome, ...entries]), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('can be disabled with bareOriginReferrers: false', () => {
      const probe = log({ ip: '7.7.7.7', userAgent: CHROME_NEW, referrer: 'https://example.com' });
      const out = detectSpoofedBrowsers(classified([...realChrome, probe]), 'example.com', {
        bareOriginReferrers: false,
      });
      expect(out[2].classification.category).toBe('human');
    });
  });

  describe('externalAssetReferrers (fixed fake referrer on sub-resources)', () => {
    const FAKE = 'https://www.aocr.org/';
    it('demotes a pair that fetched a stylesheet with an off-site referrer, assets and version notwithstanding', () => {
      const headless = [
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/', referrer: FAKE }),
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/css/site.css', referrer: FAKE }),
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/app.js', referrer: FAKE }),
      ];
      const out = detectSpoofedBrowsers(classified([...realChrome, ...headless]), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'spoofed-browser')).toBe(true);
      expect(out.slice(0, 2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('extends the giveaway to every pair with the same UA and the same exact referrer', () => {
      const giveaway = [
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/', referrer: FAKE }),
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/css/site.css', referrer: FAKE }),
      ];
      const sameUaSameRef = log({
        ip: '8.8.8.8',
        userAgent: CHROME_NEW,
        path: '/about/',
        referrer: FAKE,
      });
      const sameUaOtherRef = log({
        ip: '7.7.7.7',
        userAgent: CHROME_NEW,
        path: '/about/',
        referrer: 'https://news.example/post',
      });
      const otherUaSameRef = log({
        ip: '6.6.6.6',
        userAgent: SAFARI_NEW,
        path: '/about/',
        referrer: FAKE,
      });
      const out = detectSpoofedBrowsers(
        classified([
          ...realChrome,
          ...realSafari,
          ...giveaway,
          sameUaSameRef,
          sameUaOtherRef,
          otherUaSameRef,
        ]),
        'example.com',
      );
      const cats = out.slice(4).map((e) => e.classification.category);
      expect(cats).toEqual([
        'spoofed-browser',
        'spoofed-browser',
        'spoofed-browser',
        'human',
        'human',
      ]);
    });
    it('keeps a hotlinked image (off-site referrer on an image only)', () => {
      const out = detectSpoofedBrowsers(
        classified([
          ...realChrome,
          log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/images/a.png', referrer: FAKE }),
        ]),
        'example.com',
      );
      expect(out[2].classification.category).toBe('human');
    });
    it('keeps a real session whose sub-resources carry the embedding page as referrer', () => {
      const real = [
        log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/', referrer: FAKE }),
        log({
          ip: '9.9.9.9',
          userAgent: CHROME_NEW,
          path: '/css/site.css',
          referrer: 'https://example.com/',
        }),
      ];
      const out = detectSpoofedBrowsers(classified([...realChrome, ...real]), 'example.com');
      expect(out.slice(2).every((e) => e.classification.category === 'human')).toBe(true);
    });
    it('can be disabled with externalAssetReferrers: false', () => {
      const out = detectSpoofedBrowsers(
        classified([
          ...realChrome,
          log({ ip: '9.9.9.9', userAgent: CHROME_NEW, path: '/css/site.css', referrer: FAKE }),
        ]),
        'example.com',
        { externalAssetReferrers: false },
      );
      expect(out[2].classification.category).toBe('human');
    });
  });
});
