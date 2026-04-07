import { describe, it, expect } from 'vitest';
import { createSignalClassifier } from '../src/signals.js';
import type { SignalEntry } from '../src/types.js';

const toEpoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function makeSignalEntry(overrides: Partial<SignalEntry> = {}): SignalEntry {
  return {
    ip: '1.2.3.4',
    timestamp: toEpoch('2026-04-04T20:49:28Z'),
    domain: 'example.com',
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...overrides,
  };
}

describe('createSignalClassifier', () => {
  const { classifySignalEntry, getSignalSummary } = createSignalClassifier();

  describe('classifySignalEntry', () => {
    it('identifies Claude Code by UA pattern', () => {
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'Claude-User/1.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Claude Code');
      expect(result.company).toBe('Anthropic');
    });

    it('identifies Gemini CLI by UA pattern', () => {
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'Google-Gemini-CLI/1.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Gemini CLI');
      expect(result.company).toBe('Google');
    });

    it('excludes known dev tools', () => {
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'curl/7.68.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(false);
    });

    it('detects Cursor via Traceparent heuristic', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
          Traceparent: '00-abc123-def456-01',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Cursor');
      expect(result.company).toBe('Anysphere');
    });

    it('does not trigger Cursor heuristic when Code/ is in UA (VS Code)', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 Code/1.90.0 Chrome/120.0.0.0',
          Traceparent: '00-abc123-def456-01',
        },
      });
      const result = classifySignalEntry(entry);
      // Should not be Cursor since Code/ indicates VS Code/Copilot
      expect(result.name).not.toBe('Cursor');
    });

    it('classifies unknown UA with agent trigger as unidentified', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: { 'User-Agent': 'SomeUnknownClient/1.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified');
    });

    it('classifies unknown UA with llms-txt trigger as unidentified', () => {
      const entry = makeSignalEntry({
        trigger: 'llms-txt',
        headers: { 'User-Agent': 'SomeUnknownClient/1.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified');
    });

    it('does not classify unknown UA without trigger', () => {
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'SomeUnknownClient/1.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(false);
    });

    it('does not classify unknown UA with non-agent trigger', () => {
      const entry = makeSignalEntry({
        trigger: 'direct-md',
        headers: { 'User-Agent': 'SomeUnknownClient/1.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(false);
    });
  });

  describe('getSignalSummary', () => {
    it('returns null when tzOffsetMinutes is null', () => {
      const result = getSignalSummary([], '2026-04-04', null);
      expect(result).toBeNull();
    });

    it('returns null when no agent entries exist for the date', () => {
      const entries = [
        makeSignalEntry({
          headers: { 'User-Agent': 'curl/7.68' },
          trigger: 'content-negotiation',
        }),
      ];
      const result = getSignalSummary(entries, '2026-04-04', -420);
      expect(result).toBeNull();
    });

    it('builds summary for agent entries on the matching date', () => {
      const entries = [
        makeSignalEntry({
          timestamp: toEpoch('2026-04-04T20:49:28Z'),
          headers: { 'User-Agent': 'Claude-User/1.0' },
          trigger: 'content-negotiation',
        }),
        makeSignalEntry({
          timestamp: toEpoch('2026-04-04T21:00:00Z'),
          headers: { 'User-Agent': 'Claude-User/1.0' },
          trigger: 'llms-txt',
          ip: '5.6.7.8',
        }),
      ];
      // -420 = PDT (-0700), so 20:49 UTC = 13:49 PDT = 2026-04-04
      const result = getSignalSummary(entries, '2026-04-04', -420);
      expect(result).not.toBeNull();
      expect(result!.totalSignals).toBe(2);
      expect(result!.identifiedAgents).toHaveLength(1);
      expect(result!.identifiedAgents[0].name).toBe('Claude Code');
      expect(result!.identifiedAgents[0].uniqueIPs).toBe(2);
    });

    it('excludes entries from a different date', () => {
      const entries = [
        makeSignalEntry({
          // This is April 5 UTC, which is April 4 PDT — should match
          timestamp: toEpoch('2026-04-05T05:00:00Z'),
          headers: { 'User-Agent': 'Claude-User/1.0' },
          trigger: 'content-negotiation',
        }),
        makeSignalEntry({
          // This is April 5 UTC late — April 5 PDT — should NOT match
          timestamp: toEpoch('2026-04-05T20:00:00Z'),
          headers: { 'User-Agent': 'Claude-User/1.0' },
          trigger: 'content-negotiation',
          ip: '9.9.9.9',
        }),
      ];
      const result = getSignalSummary(entries, '2026-04-04', -420);
      expect(result).not.toBeNull();
      expect(result!.totalSignals).toBe(1);
    });
  });

  describe('custom options', () => {
    it('accepts custom known agents', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({
        knownAgents: [{ pattern: 'MyAgent', name: 'My Agent', company: 'Me' }],
      });
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'MyAgent/1.0' },
      });
      expect(classify(entry).isAgent).toBe(true);
      expect(classify(entry).name).toBe('My Agent');
    });

    it('accepts custom heuristics', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({
        heuristics: [
          (entry) => {
            if (entry.headers?.['X-Custom-Header']) {
              return { isAgent: true, name: 'CustomAgent', company: 'Custom' };
            }
            return null;
          },
        ],
      });
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'Something', 'X-Custom-Header': 'true' },
      });
      expect(classify(entry).isAgent).toBe(true);
      expect(classify(entry).name).toBe('CustomAgent');
    });
  });
});
