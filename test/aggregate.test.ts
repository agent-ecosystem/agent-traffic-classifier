import { describe, it, expect } from 'vitest';
import { aggregate, normalizePath, extractDateKey } from '../src/aggregate.js';
import { createFilter } from '../src/filter.js';
import type { ClassifiedEntry, LogEntry } from '../src/types.js';

const toEpoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    ip: '1.2.3.4',
    timestamp: toEpoch('2026-04-03T21:22:31Z'),
    method: 'GET',
    path: '/',
    status: 200,
    size: 100,
    referrer: null,
    userAgent: 'Mozilla/5.0',
    ...overrides,
  };
}

function makeClassified(
  entry: Partial<LogEntry>,
  classification: { category: string; botName?: string | null; botCompany?: string | null },
): ClassifiedEntry {
  return {
    entry: makeEntry(entry),
    classification: {
      botName: null,
      botCompany: null,
      ...classification,
    },
  };
}

describe('extractDateKey', () => {
  it('extracts local date from epoch + offset', () => {
    // 2026-04-03 21:22:31 UTC with -420 offset (PDT) → local 14:22:31 → 2026-04-03
    expect(extractDateKey(toEpoch('2026-04-03T21:22:31Z'), -420)).toBe('2026-04-03');
  });

  it('shifts date when UTC and local dates differ', () => {
    // 2026-04-04 02:00:00 UTC with -420 offset → local 2026-04-03 19:00:00
    expect(extractDateKey(toEpoch('2026-04-04T02:00:00Z'), -420)).toBe('2026-04-03');
  });

  it('uses UTC when offset is 0', () => {
    expect(extractDateKey(toEpoch('2026-01-15T00:00:00Z'), 0)).toBe('2026-01-15');
    expect(extractDateKey(toEpoch('2025-12-31T23:59:59Z'), 0)).toBe('2025-12-31');
  });

  it('returns null for non-finite timestamps', () => {
    expect(extractDateKey(NaN, 0)).toBeNull();
    expect(extractDateKey(Infinity, 0)).toBeNull();
  });
});

describe('normalizePath', () => {
  it('adds trailing slash to directory-like paths', () => {
    expect(normalizePath('/about').path).toBe('/about/');
  });

  it('does not add trailing slash to root', () => {
    expect(normalizePath('/').path).toBe('/');
  });

  it('does not add trailing slash to paths with extensions', () => {
    expect(normalizePath('/page.html').path).toBe('/page.html');
  });

  it('preserves existing trailing slashes', () => {
    expect(normalizePath('/about/').path).toBe('/about/');
  });

  it('extracts utm_source and removes it from path', () => {
    const result = normalizePath('/page?utm_source=twitter&ref=abc');
    expect(result.utmSource).toBe('twitter');
    expect(result.path).toBe('/page/?ref=abc');
  });

  it('removes query string entirely when only utm_source', () => {
    const result = normalizePath('/page?utm_source=twitter');
    expect(result.utmSource).toBe('twitter');
    expect(result.path).toBe('/page/');
  });

  it('returns null utmSource when no utm_source param', () => {
    const result = normalizePath('/page?ref=abc');
    expect(result.utmSource).toBeNull();
  });
});

describe('aggregate', () => {
  it('groups entries by date', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ timestamp: toEpoch('2026-04-03T12:00:00Z') }, { category: 'human' }),
      makeClassified({ timestamp: toEpoch('2026-04-04T12:00:00Z') }, { category: 'human' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.date).sort()).toEqual(['2026-04-03', '2026-04-04']);
  });

  it('computes category stats with unique IPs', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ ip: '1.1.1.1' }, { category: 'human' }),
      makeClassified({ ip: '1.1.1.1' }, { category: 'human' }),
      makeClassified({ ip: '2.2.2.2' }, { category: 'human' }),
      makeClassified({}, { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].summary.byCategory.human).toEqual({ requests: 3, uniqueIPs: 2 });
    expect(docs[0].summary.byCategory['ai-crawler']).toEqual({ requests: 1, uniqueIPs: 1 });
  });

  it('skips proxy duplicate entries in counts', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeEntry(),
        classification: { category: 'agent', botName: 'Cursor', botCompany: 'Anysphere' },
      },
      {
        entry: makeEntry({ ip: '5.5.5.5' }),
        classification: {
          category: 'agent',
          botName: 'Cursor',
          botCompany: 'Anysphere',
          proxyDuplicate: true,
        },
      },
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].summary.byCategory.agent.requests).toBe(1);
  });

  it('uses shouldSkip to exclude entries from all stats', () => {
    const shouldSkip = createFilter();
    const entries: ClassifiedEntry[] = [
      makeClassified({ path: '/about/' }, { category: 'human' }),
      makeClassified({ path: '/style.css' }, { category: 'human' }),
      makeClassified({ path: '/.env' }, { category: 'human' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com', shouldSkip });
    // /style.css and /.env are skipped — only /about/ counts
    expect(docs[0].topPaths).toHaveLength(1);
    expect(docs[0].topPaths[0].path).toBe('/about/');
    expect(docs[0].summary.totalRequests).toBe(1);
    expect(docs[0].summary.byCategory.human.requests).toBe(1);
  });

  it('tracks referrers for human traffic only', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ referrer: 'https://google.com' }, { category: 'human' }),
      makeClassified(
        { referrer: 'https://google.com' },
        { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' },
      ),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].topReferrers).toHaveLength(1);
    expect(docs[0].topReferrers[0].count).toBe(1); // Only the human entry
  });

  it('builds AI bot breakdown', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({}, { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' }),
      makeClassified({}, { category: 'ai-crawler', botName: 'ClaudeBot', botCompany: 'Anthropic' }),
      makeClassified({}, { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].aiBots).toHaveLength(2);
    const gpt = docs[0].aiBots.find((b) => b.name === 'GPTBot');
    expect(gpt!.requests).toBe(2);
  });

  it('builds programmatic client breakdown', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({}, { category: 'programmatic', botName: 'curl' }),
      makeClassified({}, { category: 'programmatic', botName: 'curl' }),
      makeClassified({}, { category: 'programmatic', botName: 'axios' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].programmatic).toHaveLength(2);
    const curl = docs[0].programmatic.find((p) => p.client === 'curl');
    expect(curl!.requests).toBe(2);
  });

  it('builds agent breakdown', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({}, { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' }),
      makeClassified({}, { category: 'agent', botName: 'Cursor', botCompany: 'Anysphere' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].agents).toHaveLength(2);
  });

  it('tracks status codes', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ status: 200 }, { category: 'human' }),
      makeClassified({ status: 200 }, { category: 'human' }),
      makeClassified({ status: 404 }, { category: 'human' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].statusCodes[200]).toBe(2);
    expect(docs[0].statusCodes[404]).toBe(1);
  });

  it('excludes seo-bot and other-bot from topPaths', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ path: '/about/' }, { category: 'seo-bot', botName: 'AhrefsBot' }),
      makeClassified({ path: '/about/' }, { category: 'other-bot' }),
      makeClassified({ path: '/about/' }, { category: 'human' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    // Only the human entry should count toward topPaths
    expect(docs[0].topPaths[0].count).toBe(1);
  });

  it('respects topPathsLimit', () => {
    const entries: ClassifiedEntry[] = Array.from({ length: 100 }, (_, i) =>
      makeClassified({ path: `/page-${i}/` }, { category: 'human' }),
    );
    const docs = aggregate(entries, { domain: 'example.com', topPathsLimit: 5 });
    expect(docs[0].topPaths).toHaveLength(5);
  });

  it('sets agentSignals to null when no signal data provided', () => {
    const entries: ClassifiedEntry[] = [makeClassified({}, { category: 'human' })];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].agentSignals).toBeNull();
  });

  it('sets domain on each document', () => {
    const entries: ClassifiedEntry[] = [makeClassified({}, { category: 'human' })];
    const docs = aggregate(entries, { domain: 'my-site.com' });
    expect(docs[0].domain).toBe('my-site.com');
  });

  it('tracks utm_source as a referrer for human traffic', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ path: '/page?utm_source=twitter' }, { category: 'human' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].topReferrers.find((r) => r.referrer === 'twitter')).toBeDefined();
  });

  it('merges signal summary trigger data into agents array', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({}, { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' }),
    ];
    const mockGetSignalSummary = () => ({
      totalSignals: 1,
      byTrigger: { 'content-negotiation': 1 },
      identifiedAgents: [
        {
          name: 'Claude Code',
          company: 'Anthropic',
          requests: 1,
          uniqueIPs: 1,
          byTrigger: { 'content-negotiation': 1 },
        },
      ],
    });
    const docs = aggregate(entries, {
      domain: 'example.com',
      signalEntries: [],
      classifySignalEntry: () => ({ isAgent: false }),
      getSignalSummary: mockGetSignalSummary,
    });
    const claude = docs[0].agents.find((a) => a.name === 'Claude Code');
    expect(claude!.byTrigger).toEqual({ 'content-negotiation': 1 });
  });

  it('handles entries without shouldSkip (all pages treated as content)', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ path: '/style.css' }, { category: 'human' }),
      makeClassified({ path: '/about/' }, { category: 'human' }),
    ];
    // No shouldSkip provided — both should appear in topPaths
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].topPaths).toHaveLength(2);
  });

  it('accepts custom topPathsSkipCategories', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ path: '/about/' }, { category: 'human' }),
      makeClassified({ path: '/about/' }, { category: 'custom-bot' }),
    ];
    // Default: 'custom-bot' is NOT in skip list, so both count
    const docsDefault = aggregate(entries, { domain: 'example.com' });
    expect(docsDefault[0].topPaths[0].count).toBe(2);

    // Custom skip: exclude 'custom-bot'
    const docsCustom = aggregate(entries, {
      domain: 'example.com',
      topPathsSkipCategories: ['custom-bot'],
    });
    expect(docsCustom[0].topPaths[0].count).toBe(1);
  });

  it('accepts custom normalizePath', () => {
    const entries: ClassifiedEntry[] = [makeClassified({ path: '/About' }, { category: 'human' })];
    const docs = aggregate(entries, {
      domain: 'example.com',
      normalizePath: (rawPath) => ({ path: rawPath.toLowerCase(), utmSource: null }),
    });
    expect(docs[0].topPaths[0].path).toBe('/about');
  });

  it('sorts referrers by count descending', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({ referrer: 'https://low.com' }, { category: 'human' }),
      makeClassified({ referrer: 'https://high.com' }, { category: 'human' }),
      makeClassified({ referrer: 'https://high.com' }, { category: 'human' }),
      makeClassified({ referrer: 'https://high.com' }, { category: 'human' }),
      makeClassified({ referrer: 'https://mid.com' }, { category: 'human' }),
      makeClassified({ referrer: 'https://mid.com' }, { category: 'human' }),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    expect(docs[0].topReferrers[0].referrer).toBe('https://high.com');
    expect(docs[0].topReferrers[0].count).toBe(3);
    expect(docs[0].topReferrers[1].referrer).toBe('https://mid.com');
    expect(docs[0].topReferrers[2].referrer).toBe('https://low.com');
  });

  it('sorts AI bot paths by count descending', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified(
        { path: '/low/' },
        { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' },
      ),
      makeClassified(
        { path: '/high/' },
        { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' },
      ),
      makeClassified(
        { path: '/high/' },
        { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' },
      ),
      makeClassified(
        { path: '/high/' },
        { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' },
      ),
      makeClassified(
        { path: '/mid/' },
        { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' },
      ),
      makeClassified(
        { path: '/mid/' },
        { category: 'ai-crawler', botName: 'GPTBot', botCompany: 'OpenAI' },
      ),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    const gpt = docs[0].aiBots.find((b) => b.name === 'GPTBot')!;
    expect(gpt.topPaths[0].path).toBe('/high/');
    expect(gpt.topPaths[0].count).toBe(3);
    expect(gpt.topPaths[1].path).toBe('/mid/');
    expect(gpt.topPaths[2].path).toBe('/low/');
  });

  it('sorts agent paths by count descending', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified(
        { path: '/low/' },
        { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      ),
      makeClassified(
        { path: '/high/' },
        { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      ),
      makeClassified(
        { path: '/high/' },
        { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      ),
      makeClassified(
        { path: '/high/' },
        { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      ),
      makeClassified(
        { path: '/mid/' },
        { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      ),
      makeClassified(
        { path: '/mid/' },
        { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      ),
    ];
    const docs = aggregate(entries, { domain: 'example.com' });
    const claude = docs[0].agents.find((a) => a.name === 'Claude Code')!;
    expect(claude.topPaths[0].path).toBe('/high/');
    expect(claude.topPaths[0].count).toBe(3);
    expect(claude.topPaths[1].path).toBe('/mid/');
    expect(claude.topPaths[2].path).toBe('/low/');
  });

  it('pre-filters signal entries by domain', () => {
    const entries: ClassifiedEntry[] = [
      makeClassified({}, { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' }),
    ];
    let receivedEntries: unknown[] = [];
    const mockGetSignalSummary = (signalEntries: unknown[]) => {
      receivedEntries = signalEntries;
      return null;
    };
    aggregate(entries, {
      domain: 'example.com',
      signalEntries: [
        {
          ip: '1.1.1.1',
          timestamp: toEpoch('2026-04-03T21:22:31Z'),
          domain: 'example.com',
          headers: {},
        },
        {
          ip: '2.2.2.2',
          timestamp: toEpoch('2026-04-03T21:22:31Z'),
          domain: 'other.com',
          headers: {},
        },
      ],
      classifySignalEntry: () => ({ isAgent: false }),
      getSignalSummary: mockGetSignalSummary,
    });
    // Only the example.com entry should reach getSignalSummary
    expect(receivedEntries).toHaveLength(1);
  });
});
