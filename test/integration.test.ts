import { describe, it, expect } from 'vitest';
import {
  parseLine,
  createClassifier,
  createFilter,
  createSignalClassifier,
  buildAgentSeeds,
  reclassifyEntries,
  detectDuplicateRequestAgents,
  aggregate,
} from '../src/index.js';
import type { LogEntry, SignalEntry } from '../src/types.js';

const toEpoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('integration: full pipeline', () => {
  it('processes access log lines through the complete pipeline', () => {
    const classify = createClassifier();
    const shouldSkip = createFilter();
    const { classifySignalEntry, getSignalSummary } = createSignalClassifier();

    // Simulate access log lines
    const lines = [
      '1.1.1.1 - - [04/Apr/2026:10:00:00 -0700] "GET /about/ HTTP/1.1" 200 5000 "https://google.com" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0"',
      '2.2.2.2 - - [04/Apr/2026:10:00:01 -0700] "GET /about/ HTTP/1.1" 200 5000 "-" "GPTBot/1.0"',
      '3.3.3.3 - - [04/Apr/2026:10:00:02 -0700] "GET /style.css HTTP/1.1" 200 1000 "-" "Mozilla/5.0"',
      '4.4.4.4 - - [04/Apr/2026:10:00:03 -0700] "GET / HTTP/1.1" 200 3000 "-" "curl/7.68.0"',
      '5.5.5.5 - - [04/Apr/2026:10:00:04 -0700] "GET /about/ HTTP/1.1" 200 5000 "-" "Claude-User/1.0"',
    ];

    // Parse
    const rawEntries: LogEntry[] = lines.map((l) => parseLine(l)).filter((e) => e !== null);
    expect(rawEntries).toHaveLength(5);

    // Signal entries (Claude Code detected via header signal)
    const signalEntries: SignalEntry[] = [
      {
        ip: '5.5.5.5',
        timestamp: toEpoch('2026-04-04T17:00:04Z'),
        domain: 'example.com',
        headers: { 'User-Agent': 'Claude-User/1.0' },
        trigger: 'content-negotiation',
      },
    ];

    // Build seeds and reclassify
    const seeds = buildAgentSeeds(signalEntries, classifySignalEntry);
    const domainSeeds = seeds.get('example.com') ?? null;
    const classified = reclassifyEntries(rawEntries, domainSeeds, classify);
    const withDuplicates = detectDuplicateRequestAgents(classified);

    // Aggregate
    const docs = aggregate(withDuplicates, {
      domain: 'example.com',
      tzOffsetMinutes: -420,
      shouldSkip,
      signalEntries,
      classifySignalEntry,
      getSignalSummary,
    });

    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc.date).toBe('2026-04-04');
    expect(doc.domain).toBe('example.com');

    // Category breakdown
    expect(doc.summary.byCategory.human).toBeDefined();
    expect(doc.summary.byCategory['ai-crawler']).toBeDefined();
    expect(doc.summary.byCategory.programmatic).toBeDefined();

    // GPTBot is in aiBots
    const gptBot = doc.aiBots.find((b) => b.name === 'GPTBot');
    expect(gptBot).toBeDefined();
    expect(gptBot!.company).toBe('OpenAI');

    // curl is in programmatic
    const curl = doc.programmatic.find((p) => p.client === 'curl');
    expect(curl).toBeDefined();

    // Claude Code classified as agent (via signal reclassification)
    expect(doc.summary.byCategory.agent).toBeDefined();

    // /style.css should be filtered from topPaths
    expect(doc.topPaths.find((p) => p.path === '/style.css')).toBeUndefined();
    // /about/ should be in topPaths
    expect(doc.topPaths.find((p) => p.path === '/about/')).toBeDefined();

    // Signal summary present
    expect(doc.agentSignals).not.toBeNull();
    expect(doc.agentSignals!.totalSignals).toBe(1);
  });

  it('works without signal data (access-log-only mode)', () => {
    const classify = createClassifier();
    const shouldSkip = createFilter();

    const lines = [
      '1.1.1.1 - - [04/Apr/2026:10:00:00 -0700] "GET / HTTP/1.1" 200 5000 "-" "Mozilla/5.0 Chrome/120.0.0.0"',
      '2.2.2.2 - - [04/Apr/2026:10:00:01 -0700] "GET / HTTP/1.1" 200 5000 "-" "ClaudeBot/1.0"',
    ];

    const rawEntries = lines.map((l) => parseLine(l)).filter((e) => e !== null);
    const classified = reclassifyEntries(rawEntries, null, classify);
    const docs = aggregate(classified, {
      domain: 'example.com',
      tzOffsetMinutes: -420,
      shouldSkip,
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].summary.byCategory.human).toBeDefined();
    expect(docs[0].summary.byCategory['ai-crawler']).toBeDefined();
    expect(docs[0].agentSignals).toBeNull();
  });
});
