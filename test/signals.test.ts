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

    it('identifies markdown.new by UA pattern', () => {
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'markdown.new/1.0' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('markdown.new');
      expect(result.company).toBe('markdown.new');
    });

    it('detects Chrome 122 / macOS 14.7.2 as unidentified AI assistant (no IP data)', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1',
          'Sec-Fetch-Mode': 'cors',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified AI assistant');
    });

    it('does not trigger Chrome 122 heuristic without markdown Accept', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html, */*',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.name).not.toBe('unidentified AI assistant');
    });

    it('detects agent via X-Conversation-Id header', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0',
          'X-Conversation-Id': 'cebe3fc8-dfb2-4dd6-9f3e-5836ac0e24a2',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
    });

    it('detects agent via X-Conversation-Request-Id header', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0',
          'X-Conversation-Request-Id': 'e48e18793ff93af20260403230725057',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
    });

    it('detects agent by text/x-markdown in Accept header', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          Accept:
            'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('markdown agent');
    });

    it('Chrome 122 heuristic takes priority over Cursor for matching entries', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1',
          Traceparent: '00-e48e18793ff93af20260403230725057-2607475134ffa733-01',
          'X-Conversation-Id': 'cebe3fc8-dfb2-4dd6-9f3e-5836ac0e24a2',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified AI assistant');
    });
  });

  describe('IP intelligence', () => {
    it('Chrome 122 heuristic returns suspected Chinese AI agents when country is CN', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({
        ipLookup: () => ({ country: 'CN' }),
      });
      const entry = makeSignalEntry({
        ip: '117.143.4.8',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1',
        },
      });
      const result = classify(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Kimi / Doubao / DeepSeek (suspected)');
    });

    it('Chrome 122 heuristic returns generic name when country is not CN', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({
        ipLookup: () => ({ country: 'US' }),
      });
      const entry = makeSignalEntry({
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1',
        },
      });
      const result = classify(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified AI assistant');
    });

    it('Chrome 122 heuristic returns generic name when no ipLookup provided', () => {
      const { classifySignalEntry: classify } = createSignalClassifier();
      const entry = makeSignalEntry({
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1',
        },
      });
      const result = classify(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified AI assistant');
    });

    it('conversation tracking heuristic returns suspected name with CN IP', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({
        ipLookup: () => ({ country: 'CN' }),
      });
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0',
          'X-Conversation-Id': 'cebe3fc8-dfb2-4dd6-9f3e-5836ac0e24a2',
        },
      });
      const result = classify(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Kimi / Doubao / DeepSeek (suspected)');
    });

    it('conversation tracking heuristic returns no name without country', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({
        ipLookup: () => ({}),
      });
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0',
          'X-Conversation-Id': 'cebe3fc8-dfb2-4dd6-9f3e-5836ac0e24a2',
        },
      });
      const result = classify(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBeUndefined();
    });

    it('ipLookup receives cloud provider info', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({
        ipLookup: () => ({ cloudProvider: 'google' }),
      });
      // This just verifies ipLookup is called — cloud provider doesn't change
      // the Chrome 122 heuristic behavior (it uses country, not cloud provider)
      const entry = makeSignalEntry({
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1',
        },
      });
      const result = classify(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified AI assistant');
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

  describe('Accept header taxonomy', () => {
    it('detects text-first agent pattern', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept: 'text/plain;q=1.0,text/markdown;q=0.9,text/html;q=0.8',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('text-first agent');
    });

    it('detects axios-pattern agent', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept: 'text/markdown,text/html,*/*',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('axios-pattern agent');
    });

    it('detects markdown agent with q-values', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.8',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('markdown agent');
    });

    it('detects bare markdown request as minimal agent', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept: 'text/markdown',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('markdown agent (minimal)');
    });

    it('does not match non-markdown Accept headers', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept: 'text/html, application/json',
        },
      });
      const result = classifySignalEntry(entry);
      // Should fall through to trigger-based unidentified
      expect(result.name).toBe('unidentified');
    });

    it('normalizes whitespace in Accept headers before matching', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept: 'text/markdown,  text/html;q=0.9,  */*;q=0.8',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('markdown agent');
    });
  });

  describe('missing browser headers heuristic', () => {
    it('detects Chrome UA without Sec-Ch-Ua requesting markdown', () => {
      // Uses an Accept header that includes markdown but doesn't match any
      // taxonomy prefix, so the missing-browser-headers heuristic catches it
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Accept: 'application/json, text/markdown;q=0.9, text/html;q=0.8',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('browser-masked agent');
    });

    it('does not trigger when Sec-Ch-Ua is present', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Accept: 'text/markdown, text/html;q=0.9',
          'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130"',
        },
      });
      const result = classifySignalEntry(entry);
      // Should not be browser-masked since Sec-Ch-Ua is present
      expect(result.name).not.toBe('browser-masked agent');
    });

    it('does not trigger for non-Chrome UAs', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'python-requests/2.28.0',
          Accept: 'text/markdown',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.name).not.toBe('browser-masked agent');
    });

    it('does not trigger for VS Code (Code/ in UA)', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'Mozilla/5.0 Code/1.90.0 Chrome/120.0.0.0',
          Accept: 'text/markdown, text/html;q=0.9',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.name).not.toBe('browser-masked agent');
    });

    it('does not trigger without markdown in Accept', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Accept: 'text/html, */*',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.name).not.toBe('browser-masked agent');
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
