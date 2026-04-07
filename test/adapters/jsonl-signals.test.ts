import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseSignalTs, parseSignalLog } from '../../src/adapters/jsonl-signals.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

describe('parseSignalTs', () => {
  it('parses an ISO 8601 UTC timestamp', () => {
    const ts = '2026-04-04T20:49:28Z';
    const result = parseSignalTs(ts);
    expect(result).not.toBeNull();
    const expected = Math.floor(new Date('2026-04-04T20:49:28Z').getTime() / 1000);
    expect(result).toBe(expected);
  });

  it('parses an ISO 8601 timestamp with offset', () => {
    const ts = '2026-04-04T13:49:28-07:00';
    const result = parseSignalTs(ts);
    expect(result).not.toBeNull();
    const expected = Math.floor(new Date('2026-04-04T20:49:28Z').getTime() / 1000);
    expect(result).toBe(expected);
  });

  it('returns null for invalid timestamps', () => {
    expect(parseSignalTs('')).toBeNull();
    expect(parseSignalTs('not a date')).toBeNull();
  });
});

describe('parseSignalLog', () => {
  it('reads JSONL files from a directory and returns SignalEntry objects', async () => {
    const entries = await parseSignalLog(join(FIXTURES_DIR, 'signals'));
    // Fixture has 5 lines: 2 valid with domain+timestamp, 1 malformed JSON, 1 missing domain, 1 valid from other.com
    expect(entries).toHaveLength(3);
  });

  it('skips malformed JSON lines', async () => {
    const entries = await parseSignalLog(join(FIXTURES_DIR, 'signals'));
    // "not valid json {{{" should be silently skipped
    expect(entries.every((e) => e.ip !== undefined || e.domain !== undefined)).toBe(true);
  });

  it('skips entries missing required fields (domain or timestamp)', async () => {
    const entries = await parseSignalLog(join(FIXTURES_DIR, 'signals'));
    // Entry with no domain should be skipped
    expect(entries.every((e) => e.domain !== undefined && e.timestamp !== undefined)).toBe(true);
  });

  it('returns empty array for nonexistent directory', async () => {
    const entries = await parseSignalLog('/nonexistent/signal/dir');
    expect(entries).toHaveLength(0);
  });

  it('returns empty array for directory with no .jsonl files', async () => {
    const entries = await parseSignalLog(join(FIXTURES_DIR, 'logs'));
    expect(entries).toHaveLength(0);
  });

  it('converts timestamps to epoch seconds', async () => {
    const entries = await parseSignalLog(join(FIXTURES_DIR, 'signals'));
    expect(entries.every((e) => typeof e.timestamp === 'number')).toBe(true);
    const claude = entries.find((e) => e.ip === '1.2.3.4');
    expect(claude).toBeDefined();
    const expected = Math.floor(new Date('2026-04-04T20:49:28Z').getTime() / 1000);
    expect(claude!.timestamp).toBe(expected);
  });

  it('preserves all fields from valid entries', async () => {
    const entries = await parseSignalLog(join(FIXTURES_DIR, 'signals'));
    const claude = entries.find((e) => e.ip === '1.2.3.4');
    expect(claude).toBeDefined();
    expect(claude!.domain).toBe('example.com');
    expect(claude!.trigger).toBe('content-negotiation');
    expect(claude!.headers['User-Agent']).toBe('Claude-User/1.0');
  });
});
