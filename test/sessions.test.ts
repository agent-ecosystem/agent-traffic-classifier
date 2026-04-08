import { describe, it, expect } from 'vitest';
import {
  buildAgentSeeds,
  reclassifyEntries,
  detectDuplicateRequestAgents,
  crossReferenceSignalIps,
} from '../src/sessions.js';
import { createSignalClassifier } from '../src/signals.js';
import { createClassifier } from '../src/classify.js';
import type { ClassifiedEntry, LogEntry, SignalEntry } from '../src/types.js';

const toEpoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function makeLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    ip: '1.2.3.4',
    timestamp: toEpoch('2026-04-04T07:36:43Z'),
    method: 'GET',
    path: '/',
    status: 200,
    size: 100,
    referrer: null,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...overrides,
  };
}

function makeSignalEntry(overrides: Partial<SignalEntry> = {}): SignalEntry {
  return {
    ip: '1.2.3.4',
    timestamp: toEpoch('2026-04-04T07:36:43Z'),
    domain: 'example.com',
    headers: { 'User-Agent': 'Claude-User/1.0' },
    trigger: 'content-negotiation',
    ...overrides,
  };
}

describe('buildAgentSeeds', () => {
  const { classifySignalEntry } = createSignalClassifier();

  it('builds seeds grouped by domain', () => {
    const entries = [
      makeSignalEntry({ domain: 'a.com' }),
      makeSignalEntry({ domain: 'b.com', ip: '5.6.7.8' }),
    ];
    const seeds = buildAgentSeeds(entries, classifySignalEntry);
    expect(seeds.has('a.com')).toBe(true);
    expect(seeds.has('b.com')).toBe(true);
  });

  it('groups by ip|||ua key', () => {
    const entries = [
      makeSignalEntry({ timestamp: toEpoch('2026-04-04T07:30:00Z') }),
      makeSignalEntry({ timestamp: toEpoch('2026-04-04T07:35:00Z') }),
    ];
    const seeds = buildAgentSeeds(entries, classifySignalEntry);
    const domainSeeds = seeds.get('example.com')!;
    expect(domainSeeds.size).toBe(1); // Same IP+UA, collapsed into one seed
    const seed = domainSeeds.values().next().value!;
    expect(seed.earliestTs).toBeLessThan(seed.latestTs);
  });

  it('skips non-agent entries', () => {
    const entries = [makeSignalEntry({ headers: { 'User-Agent': 'curl/7.68' } })];
    const seeds = buildAgentSeeds(entries, classifySignalEntry);
    expect(seeds.size).toBe(0);
  });

  it('deduplicates by expanding time window', () => {
    const entries = [
      makeSignalEntry({ timestamp: toEpoch('2026-04-04T07:00:00Z') }),
      makeSignalEntry({ timestamp: toEpoch('2026-04-04T07:10:00Z') }),
      makeSignalEntry({ timestamp: toEpoch('2026-04-04T07:05:00Z') }),
    ];
    const seeds = buildAgentSeeds(entries, classifySignalEntry);
    const seed = seeds.get('example.com')!.values().next().value!;
    expect(seed.name).toBe('Claude Code');
    expect(seed.company).toBe('Anthropic');
  });
});

describe('reclassifyEntries', () => {
  const { classifySignalEntry } = createSignalClassifier();
  const classify = createClassifier();

  it('reclassifies entries matching an agent seed within the time window', () => {
    const signalEntries = [makeSignalEntry()];
    const seeds = buildAgentSeeds(signalEntries, classifySignalEntry);
    const domainSeeds = seeds.get('example.com')!;

    const logEntries = [makeLogEntry({ userAgent: 'Claude-User/1.0' })];
    const result = reclassifyEntries(logEntries, domainSeeds, classify);
    expect(result[0].classification.category).toBe('agent');
    expect(result[0].classification.botName).toBe('Claude Code');
  });

  it('does not reclassify entries outside the time window', () => {
    // Use a custom signal classifier that recognizes "TestAgent/1.0"
    const { classifySignalEntry: testClassify } = createSignalClassifier({
      knownAgents: [{ pattern: 'TestAgent', name: 'TestAgent', company: 'Test' }],
    });
    const signalEntries = [
      makeSignalEntry({
        timestamp: toEpoch('2026-04-04T07:36:43Z'),
        headers: { 'User-Agent': 'TestAgent/1.0' },
      }),
    ];
    const seeds = buildAgentSeeds(signalEntries, testClassify);
    const domainSeeds = seeds.get('example.com')!;

    // Entry is 2 hours later than the signal — outside the default window
    const logEntries = [
      makeLogEntry({
        timestamp: toEpoch('2026-04-04T09:36:43Z'),
        userAgent: 'TestAgent/1.0',
      }),
    ];
    const result = reclassifyEntries(logEntries, domainSeeds, classify);
    // Outside the window, so falls through to base classification.
    // "TestAgent" is not in the bot DB, so it goes to isbot or human.
    expect(result[0].classification.category).not.toBe('agent');
  });

  it('uses base classification when no seeds exist', () => {
    const logEntries = [makeLogEntry()];
    const result = reclassifyEntries(logEntries, null, classify);
    expect(result[0].classification.category).toBe('human');
  });

  it('expands the seed window as entries match', () => {
    const signalEntries = [makeSignalEntry({ timestamp: toEpoch('2026-04-04T07:36:43Z') })];
    const seeds = buildAgentSeeds(signalEntries, classifySignalEntry);
    const domainSeeds = seeds.get('example.com')!;

    // Two entries: one within the initial window, one 50 seconds after the first.
    // After the first matches and expands the window, the second should also match.
    const logEntries = [
      makeLogEntry({
        timestamp: toEpoch('2026-04-04T07:37:00Z'),
        userAgent: 'Claude-User/1.0',
      }),
      makeLogEntry({
        timestamp: toEpoch('2026-04-04T07:37:50Z'),
        userAgent: 'Claude-User/1.0',
      }),
    ];
    const result = reclassifyEntries(logEntries, domainSeeds, classify);
    expect(result[0].classification.category).toBe('agent');
    expect(result[1].classification.category).toBe('agent');
  });
});

describe('detectDuplicateRequestAgents', () => {
  it('detects duplicate-request pairs from different IPs', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '2.2.2.2', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    const result = detectDuplicateRequestAgents(entries);
    const agentEntry = result.find((e) => e.classification.category === 'agent');
    const dupEntry = result.find((e) => e.classification.proxyDuplicate);
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.classification.botName).toBe('Cursor (suspected)');
    expect(dupEntry).toBeDefined();
  });

  it('does not flag same-IP entries as duplicates', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    const result = detectDuplicateRequestAgents(entries);
    expect(result.every((e) => !e.classification.proxyDuplicate)).toBe(true);
  });

  it('promotes unidentified agent + duplicate pattern to confirmed Cursor', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'agent', botName: 'unidentified', botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '2.2.2.2', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    const result = detectDuplicateRequestAgents(entries);
    const agentEntry = result.find(
      (e) => e.classification.category === 'agent' && !e.classification.proxyDuplicate,
    );
    expect(agentEntry!.classification.botName).toBe('Cursor');
    expect(agentEntry!.classification.botCompany).toBe('Anysphere');
  });

  it('returns original entries when no duplicates found', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page-a', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '2.2.2.2', path: '/page-b', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    const result = detectDuplicateRequestAgents(entries);
    // Different paths, so no pair
    expect(result).toBe(entries); // Same reference, no copy needed
  });

  it('skips known non-proxy agents like Claude Code', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Claude-User/1.0' }),
        classification: { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      },
      {
        entry: makeLogEntry({ ip: '2.2.2.2', path: '/page', userAgent: 'Claude-User/1.0' }),
        classification: { category: 'agent', botName: 'Claude Code', botCompany: 'Anthropic' },
      },
    ];
    const result = detectDuplicateRequestAgents(entries);
    expect(result.every((e) => !e.classification.proxyDuplicate)).toBe(true);
  });

  it('preserves named agent when paired with human (nameA is named agent)', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'agent', botName: 'Cursor', botCompany: 'Anysphere' },
      },
      {
        entry: makeLogEntry({ ip: '2.2.2.2', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    const result = detectDuplicateRequestAgents(entries);
    const primary = result.find(
      (e) => e.classification.category === 'agent' && !e.classification.proxyDuplicate,
    );
    expect(primary!.classification.botName).toBe('Cursor');
    expect(primary!.entry.ip).toBe('1.1.1.1');
    expect(result.find((e) => e.classification.proxyDuplicate)).toBeDefined();
  });

  it('preserves named agent when paired with human (nameB is named agent)', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '2.2.2.2', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'agent', botName: 'Cursor', botCompany: 'Anysphere' },
      },
    ];
    const result = detectDuplicateRequestAgents(entries);
    const primary = result.find(
      (e) => e.classification.category === 'agent' && !e.classification.proxyDuplicate,
    );
    expect(primary!.classification.botName).toBe('Cursor');
    expect(primary!.entry.ip).toBe('2.2.2.2');
    expect(result.find((e) => e.classification.proxyDuplicate)).toBeDefined();
  });

  it('respects custom proxyWindowSeconds', () => {
    // Entries 5 seconds apart with default 2-second window: no match
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({
          ip: '1.1.1.1',
          path: '/page',
          userAgent: 'Chrome/120',
          timestamp: toEpoch('2026-04-04T07:36:43Z'),
        }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
      {
        entry: makeLogEntry({
          ip: '2.2.2.2',
          path: '/page',
          userAgent: 'Chrome/120',
          timestamp: toEpoch('2026-04-04T07:36:48Z'),
        }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    // Default window (2s): no match
    const noMatch = detectDuplicateRequestAgents(entries);
    expect(noMatch.every((e) => !e.classification.proxyDuplicate)).toBe(true);

    // Wider window (10s): match
    const match = detectDuplicateRequestAgents(entries, { proxyWindowSeconds: 10 });
    expect(match.some((e) => e.classification.proxyDuplicate)).toBe(true);
  });

  it('uses custom proxyAgent config for naming', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.1.1.1', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '2.2.2.2', path: '/page', userAgent: 'Chrome/120' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    const result = detectDuplicateRequestAgents(entries, {
      proxyAgent: { name: 'Windsurf', company: 'Codeium', suspectedName: 'Windsurf (suspected)' },
    });
    const agentEntry = result.find(
      (e) => e.classification.category === 'agent' && !e.classification.proxyDuplicate,
    );
    expect(agentEntry!.classification.botName).toBe('Windsurf (suspected)');
    expect(agentEntry!.classification.botCompany).toBe('Codeium');
  });
});

describe('crossReferenceSignalIps', () => {
  const classifyAsAgent = (_entry: SignalEntry) => ({
    isAgent: true as const,
    name: 'Claude Code',
    company: 'Anthropic' as string | null,
  });

  const classifyAsNotAgent = (_entry: SignalEntry) => ({
    isAgent: false as const,
  });

  it('upgrades programmatic entry to agent when IP matches signal data', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
    ];
    const signals = [makeSignalEntry({ ip: '1.2.3.4', domain: 'example.com' })];

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifyAsAgent);
    expect(result[0].classification.category).toBe('agent');
    expect(result[0].classification.botName).toBe('Claude Code');
    expect(result[0].classification.botCompany).toBe('Anthropic');
  });

  it('does not upgrade when IP does not match signal data', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
    ];
    const signals = [makeSignalEntry({ ip: '9.9.9.9', domain: 'example.com' })];

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifyAsAgent);
    expect(result[0].classification.category).toBe('programmatic');
  });

  it('does not upgrade when signal is for a different domain', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
    ];
    const signals = [makeSignalEntry({ ip: '1.2.3.4', domain: 'other.com' })];

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifyAsAgent);
    expect(result[0].classification.category).toBe('programmatic');
  });

  it('does not upgrade non-programmatic entries', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4' }),
        classification: { category: 'human', botName: null, botCompany: null },
      },
    ];
    const signals = [makeSignalEntry({ ip: '1.2.3.4', domain: 'example.com' })];

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifyAsAgent);
    expect(result[0].classification.category).toBe('human');
  });

  it('does not upgrade when signal entry is not classified as agent', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
    ];
    const signals = [makeSignalEntry({ ip: '1.2.3.4', domain: 'example.com' })];

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifyAsNotAgent);
    expect(result[0].classification.category).toBe('programmatic');
  });

  it('prefers named agents over unidentified', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
    ];
    const signals = [
      makeSignalEntry({ ip: '1.2.3.4', domain: 'example.com' }),
      makeSignalEntry({ ip: '1.2.3.4', domain: 'example.com' }),
    ];

    let callCount = 0;
    const classifier = (_entry: SignalEntry) => {
      callCount++;
      if (callCount === 1) return { isAgent: true as const, name: undefined, company: null };
      return { isAgent: true as const, name: 'Claude Code', company: 'Anthropic' as string | null };
    };

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifier);
    expect(result[0].classification.botName).toBe('Claude Code');
  });

  it('returns original array reference when no signal IPs match agents', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
    ];
    const signals = [makeSignalEntry({ ip: '1.2.3.4', domain: 'example.com' })];

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifyAsNotAgent);
    expect(result).toBe(entries);
  });

  it('handles multiple entries with different IPs', () => {
    const entries: ClassifiedEntry[] = [
      {
        entry: makeLogEntry({ ip: '1.2.3.4', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '5.6.7.8', userAgent: 'undici' }),
        classification: { category: 'programmatic', botName: 'undici', botCompany: null },
      },
      {
        entry: makeLogEntry({ ip: '9.9.9.9', userAgent: 'python-httpx/0.27' }),
        classification: { category: 'programmatic', botName: 'httpx', botCompany: null },
      },
    ];
    const signals = [
      makeSignalEntry({ ip: '1.2.3.4', domain: 'example.com' }),
      makeSignalEntry({ ip: '9.9.9.9', domain: 'example.com' }),
    ];

    const result = crossReferenceSignalIps(entries, signals, 'example.com', classifyAsAgent);
    expect(result[0].classification.category).toBe('agent');
    expect(result[1].classification.category).toBe('programmatic'); // no signal match
    expect(result[2].classification.category).toBe('agent');
  });
});
