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
        headers: {
          'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
        },
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

    it('labels Traceparent-only Chrome traffic as a traced proxy agent', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
          Traceparent: '00-abc123-def456-01',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('traced proxy agent');
    });

    it('labels Traceparent plus Cursor Accept header as Cursor (suspected)', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/139.0.0.0 Safari/537.36',
          Traceparent: '00-abc123-def456-01',
          Accept:
            'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Cursor (suspected)');
      expect(result.company).toBe('Anysphere');
      expect(result.company).toBe('Anysphere');
    });

    it('detects Cursor definitively via Sentry Baggage header', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/139.0.0.0 Safari/537.36',
          Baggage:
            'sentry-environment=production,sentry-public_key=41fa59a1376ec796312848f4f17266ba,sentry-trace_id=abc123,sentry-org_id=4510313822748672',
          'Sentry-Trace': 'abc123-def456-0',
          Traceparent: '00-abc123-def456-01',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Cursor');
      expect(result.company).toBe('Anysphere');
    });

    it('identifies Cursor by its confirmed fetch fingerprint (September 2026 controlled test)', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
          Accept:
            'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Cursor');
      expect(result.company).toBe('Anysphere');
    });

    it('does not apply the Cursor fetch fingerprint when Sec-Ch-Ua or the no-cache headers are missing', () => {
      const base = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0.0.0 Safari/537.36',
        Accept:
          'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      };
      const withClientHints = classifySignalEntry(
        makeSignalEntry({
          trigger: 'content-negotiation',
          headers: { ...base, 'Sec-Ch-Ua': '"Chromium";v="145"' },
        }),
      );
      expect(withClientHints.name).not.toBe('Cursor');
      const { Pragma: _p, ...noPragma } = base;
      const withoutPragma = classifySignalEntry(
        makeSignalEntry({ trigger: 'content-negotiation', headers: noPragma }),
      );
      expect(withoutPragma.isAgent).toBe(true);
      expect(withoutPragma.name).toBe('Cursor (suspected)');
    });

    it('does not trigger Sentry heuristic for different sentry-public_key', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/139.0.0.0 Safari/537.36',
          Baggage:
            'sentry-environment=production,sentry-public_key=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          Traceparent: '00-abc123-def456-01',
        },
      });
      const result = classifySignalEntry(entry);
      // Should fall through to tracedProxyHeuristic (via Traceparent), not sentryBaggage
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('traced proxy agent');
    });

    it('falls through from Sentry to Traceparent heuristic when no Baggage', () => {
      const entry = makeSignalEntry({
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/139.0.0.0 Safari/537.36',
          Traceparent: '00-abc123-def456-01',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('traced proxy agent');
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

    it('identifies Claude Agent (preflight) by UA pattern', () => {
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'Claude-Agent/1.0 (preflight)' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Claude Agent');
      expect(result.company).toBe('Anthropic');
    });

    it('identifies Claude Agent (smart-fetch) by UA pattern', () => {
      const entry = makeSignalEntry({
        headers: { 'User-Agent': 'Claude-Agent/1.0 (smart-fetch)' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Claude Agent');
      expect(result.company).toBe('Anthropic');
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
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          trigger: 'content-negotiation',
        }),
        makeSignalEntry({
          timestamp: toEpoch('2026-04-04T21:00:00Z'),
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
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

    it('accumulates byTrigger counts across entries', () => {
      const entries = [
        makeSignalEntry({
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          trigger: 'content-negotiation',
        }),
        makeSignalEntry({
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          trigger: 'content-negotiation',
          ip: '5.6.7.8',
        }),
        makeSignalEntry({
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          trigger: 'llms-txt',
          ip: '9.9.9.9',
        }),
      ];
      const result = getSignalSummary(entries, '2026-04-04', -420);
      expect(result).not.toBeNull();
      expect(result!.byTrigger['content-negotiation']).toBe(2);
      expect(result!.byTrigger['llms-txt']).toBe(1);
    });

    it('builds per-agent trigger breakdown', () => {
      const entries = [
        makeSignalEntry({
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          trigger: 'content-negotiation',
        }),
        makeSignalEntry({
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          trigger: 'llms-txt',
          ip: '5.6.7.8',
        }),
        makeSignalEntry({
          headers: { 'User-Agent': 'Google-Gemini-CLI/1.0' },
          trigger: 'content-negotiation',
          ip: '7.7.7.7',
        }),
      ];
      const result = getSignalSummary(entries, '2026-04-04', -420);
      expect(result).not.toBeNull();
      expect(result!.identifiedAgents).toHaveLength(2);

      const claude = result!.identifiedAgents.find((a) => a.name === 'Claude Code')!;
      expect(claude.requests).toBe(2);
      expect(claude.byTrigger['content-negotiation']).toBe(1);
      expect(claude.byTrigger['llms-txt']).toBe(1);

      const gemini = result!.identifiedAgents.find((a) => a.name === 'Gemini CLI')!;
      expect(gemini.requests).toBe(1);
      expect(gemini.byTrigger['content-negotiation']).toBe(1);
    });

    it('handles entries without triggers', () => {
      const entries = [
        makeSignalEntry({
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          // No trigger
        }),
      ];
      const result = getSignalSummary(entries, '2026-04-04', -420);
      expect(result).not.toBeNull();
      expect(result!.byTrigger).toEqual({});
      expect(result!.identifiedAgents[0].byTrigger).toEqual({});
    });

    it('excludes entries from a different date', () => {
      const entries = [
        makeSignalEntry({
          // This is April 5 UTC, which is April 4 PDT — should match
          timestamp: toEpoch('2026-04-05T05:00:00Z'),
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
          trigger: 'content-negotiation',
        }),
        makeSignalEntry({
          // This is April 5 UTC late — April 5 PDT — should NOT match
          timestamp: toEpoch('2026-04-05T20:00:00Z'),
          headers: {
            'User-Agent': 'Claude-User (claude-code/2.1.270; +https://support.anthropic.com/)',
          },
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

    it('labels an Accept-only Cursor match as suspected via the taxonomy', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept:
            'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('Cursor (suspected)');
    });

    it('detects got-pattern agent via Accept taxonomy', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'SomeClient/1.0',
          Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.8',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('got-pattern agent');
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

  describe('curated bot database consultation', () => {
    it('does not seed an agent for a known crawler hitting llms.txt', () => {
      const entry = makeSignalEntry({
        trigger: 'llms-txt',
        headers: {
          'User-Agent':
            'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)',
          Accept: '*/*',
        },
      });
      expect(classifySignalEntry(entry).isAgent).toBe(false);
    });

    it('does not seed an agent for a known AI search bot with an agent-like Accept header', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)',
          Accept:
            'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5',
        },
      });
      expect(classifySignalEntry(entry).isAgent).toBe(false);
    });

    it('does not treat bare Claude-User (Claude.ai user fetch) as Claude Code', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent':
            'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +claude-user@anthropic.com)',
          Accept: 'text/markdown, text/html, */*',
        },
      });
      expect(classifySignalEntry(entry).isAgent).toBe(false);
    });

    it('identifies self-identifying coding agents from the bot database', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Code/1.138.0 Chrome/148.0.7778.280 Electron/42.10.0 Safari/537.36',
          Accept:
            'text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, application/xml;q=0.8, */*;q=0.7',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('GitHub Copilot');
      expect(result.company).toBe('Microsoft');
    });

    it('still runs heuristics for UAs the bot database does not curate', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: { 'User-Agent': 'python-httpx/0.28.1', Accept: 'text/markdown' },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('markdown agent (minimal)');
    });

    it('can be disabled with botClassifier: null', () => {
      const { classifySignalEntry: classify } = createSignalClassifier({ botClassifier: null });
      const entry = makeSignalEntry({
        trigger: 'llms-txt',
        headers: {
          'User-Agent':
            'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)',
        },
      });
      const result = classify(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('unidentified');
    });
  });

  describe('html-first Accept taxonomy', () => {
    it('names the shared html/json/markdown/csv framework', () => {
      const entry = makeSignalEntry({
        trigger: 'content-negotiation',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/markdown;q=0.7,text/plain;q=0.6,text/csv;q=0.6,*/*;q=0.5',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('html-first agent');
    });
  });

  describe('plain-text fetcher heuristic', () => {
    it('detects a browser UA sending a bare text/plain Accept', () => {
      const entry = makeSignalEntry({
        trigger: 'llms-txt',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Android 14; Mobile; rv:123.0) Gecko/123.0 Firefox/123',
          Accept: 'text/plain',
          'Accept-Encoding': 'gzip',
          'Cache-Control': 'no-cache',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.isAgent).toBe(true);
      expect(result.name).toBe('plain-text fetcher (browser-masked)');
    });

    it('does not trigger when Sec-Ch-Ua is present', () => {
      const entry = makeSignalEntry({
        trigger: 'llms-txt',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/plain',
          'Sec-Ch-Ua': '"Chromium";v="131"',
        },
      });
      const result = classifySignalEntry(entry);
      expect(result.name).not.toBe('plain-text fetcher (browser-masked)');
    });

    it('does not trigger for non-browser UAs or richer Accept headers', () => {
      expect(
        classifySignalEntry(
          makeSignalEntry({ headers: { 'User-Agent': 'SomeTool/1.0', Accept: 'text/plain' } }),
        ).isAgent,
      ).toBe(false);
      expect(
        classifySignalEntry(
          makeSignalEntry({
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/123.0',
              Accept: 'text/plain,*/*',
            },
          }),
        ).isAgent,
      ).toBe(false);
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
