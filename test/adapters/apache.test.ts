import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  parseLine,
  parseApacheTs,
  parseApacheTzOffset,
  LOG_LINE_RE,
  readLogFiles,
} from '../../src/adapters/apache.js';

const toEpoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

describe('parseLine', () => {
  it('parses a valid Apache Combined Log Format line', () => {
    const line =
      '192.168.1.1 - - [03/Apr/2026:14:22:31 -0700] "GET /about/ HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"';
    const result = parseLine(line);
    expect(result).toEqual({
      ip: '192.168.1.1',
      timestamp: toEpoch('2026-04-03T21:22:31Z'),
      method: 'GET',
      path: '/about/',
      status: 200,
      size: 1234,
      referrer: 'https://example.com',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('returns null for malformed lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('not a log line')).toBeNull();
    expect(parseLine('incomplete 192.168.1.1')).toBeNull();
  });

  it('handles "-" size as 0', () => {
    const line =
      '10.0.0.1 - - [03/Apr/2026:14:22:31 -0700] "GET / HTTP/1.1" 304 - "https://example.com" "Mozilla/5.0"';
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });

  it('handles "-" referrer as null', () => {
    const line =
      '10.0.0.1 - - [03/Apr/2026:14:22:31 -0700] "GET / HTTP/1.1" 200 500 "-" "Mozilla/5.0"';
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result!.referrer).toBeNull();
  });

  it('handles complex user-agent strings', () => {
    const line =
      '10.0.0.1 - - [03/Apr/2026:14:22:31 -0700] "GET / HTTP/1.1" 200 500 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"';
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result!.userAgent).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    );
  });

  it('parses POST requests', () => {
    const line =
      '10.0.0.1 - - [03/Apr/2026:14:22:31 -0700] "POST /api/data HTTP/1.1" 201 42 "-" "curl/7.68"';
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('POST');
    expect(result!.status).toBe(201);
  });
});

describe('LOG_LINE_RE', () => {
  it('is exported and matches Apache Combined Log Format', () => {
    expect(LOG_LINE_RE).toBeInstanceOf(RegExp);
    const line =
      '127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 "http://www.example.com/start.html" "Mozilla/4.08"';
    expect(LOG_LINE_RE.test(line)).toBe(true);
  });
});

describe('parseApacheTs', () => {
  it('parses a timestamp with negative timezone offset', () => {
    const ts = '03/Apr/2026:14:22:31 -0700';
    const result = parseApacheTs(ts);
    expect(result).not.toBeNull();
    // 2026-04-03 14:22:31 -0700 = 2026-04-03 21:22:31 UTC
    const expected = Math.floor(new Date('2026-04-03T21:22:31Z').getTime() / 1000);
    expect(result).toBe(expected);
  });

  it('parses a timestamp with positive timezone offset', () => {
    const ts = '03/Apr/2026:14:22:31 +0530';
    const result = parseApacheTs(ts);
    expect(result).not.toBeNull();
    // 2026-04-03 14:22:31 +0530 = 2026-04-03 08:52:31 UTC
    const expected = Math.floor(new Date('2026-04-03T08:52:31Z').getTime() / 1000);
    expect(result).toBe(expected);
  });

  it('parses a timestamp with UTC offset', () => {
    const ts = '03/Apr/2026:14:22:31 +0000';
    const result = parseApacheTs(ts);
    expect(result).not.toBeNull();
    const expected = Math.floor(new Date('2026-04-03T14:22:31Z').getTime() / 1000);
    expect(result).toBe(expected);
  });

  it('returns null for invalid timestamps', () => {
    expect(parseApacheTs('')).toBeNull();
    expect(parseApacheTs('not a timestamp')).toBeNull();
    expect(parseApacheTs('2026-04-03T14:22:31Z')).toBeNull(); // ISO, not Apache
  });
});

describe('parseApacheTzOffset', () => {
  it('extracts negative offset', () => {
    expect(parseApacheTzOffset('03/Apr/2026:14:22:31 -0700')).toBe(-420);
  });

  it('extracts positive offset', () => {
    expect(parseApacheTzOffset('03/Apr/2026:14:22:31 +0530')).toBe(330);
  });

  it('extracts UTC offset', () => {
    expect(parseApacheTzOffset('03/Apr/2026:14:22:31 +0000')).toBe(0);
  });

  it('returns null for invalid strings', () => {
    expect(parseApacheTzOffset('')).toBeNull();
    expect(parseApacheTzOffset('not a timestamp')).toBeNull();
  });
});

describe('readLogFiles', () => {
  it('reads plain text access log files and yields LogEntry objects', async () => {
    const entries = [];
    for await (const entry of readLogFiles(join(FIXTURES_DIR, 'logs'))) {
      entries.push(entry);
    }
    // 3 valid lines in access.log + 1 in access.log.1.gz = 4
    expect(entries).toHaveLength(4);
  });

  it('reads gzipped access log files', async () => {
    const entries = [];
    for await (const entry of readLogFiles(join(FIXTURES_DIR, 'logs'))) {
      entries.push(entry);
    }
    // The .gz file contains one entry from 03/Apr
    const gzEntry = entries.find((e) => e.ip === '4.4.4.4');
    expect(gzEntry).toBeDefined();
    expect(gzEntry!.path).toBe('/old-page/');
  });

  it('skips malformed lines in log files', async () => {
    const entries = [];
    for await (const entry of readLogFiles(join(FIXTURES_DIR, 'logs'))) {
      entries.push(entry);
    }
    // "not a valid log line" in access.log should be skipped
    expect(entries.every((e) => e.ip !== undefined)).toBe(true);
  });

  it('yields nothing for a nonexistent directory', async () => {
    const entries = [];
    for await (const entry of readLogFiles('/nonexistent/path')) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(0);
  });

  it('yields nothing for a directory with no access.log files', async () => {
    // The signals directory has no access.log files
    const entries = [];
    for await (const entry of readLogFiles(join(FIXTURES_DIR, 'signals'))) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(0);
  });
});
