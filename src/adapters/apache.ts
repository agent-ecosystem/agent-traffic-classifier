import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { join } from 'path';
import type { LogEntry } from '../types.js';

/**
 * Apache Combined Log Format regex.
 * Fields: ip, identity, user, timestamp, method, path, protocol, status, size, referrer, userAgent
 */
export const LOG_LINE_RE =
  /^(\S+) (\S+) (\S+) \[([^\]]+)\] "(\S+) (\S+) (\S+)" (\d+) (\S+) "([^"]*)" "([^"]*)"\s*$/;

/**
 * Parse a single Apache Combined Log Format line into a LogEntry.
 * Returns null for unparseable lines.
 */
export function parseLine(line: string): LogEntry | null {
  const m = line.match(LOG_LINE_RE);
  if (!m) return null;

  const [, ip, , , rawTimestamp, method, path, , statusStr, sizeStr, referrer, userAgent] = m;

  const timestamp = parseApacheTs(rawTimestamp);
  if (timestamp === null) return null;

  return {
    ip,
    timestamp,
    method,
    path,
    status: parseInt(statusStr, 10),
    size: sizeStr === '-' ? 0 : parseInt(sizeStr, 10),
    referrer: referrer === '-' ? null : referrer,
    userAgent,
  };
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/**
 * Parse Apache timestamp "04/Apr/2026:00:36:43 -0700" to Unix seconds.
 * Returns null for unparseable timestamps.
 */
export function parseApacheTs(ts: string): number | null {
  const m = ts.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})/);
  if (!m) return null;
  const [, day, mon, year, hh, mm, ss, tzSign, tzH, tzM] = m;
  if (!(mon in MONTHS)) return null;
  const offsetMinutes = (tzSign === '-' ? -1 : 1) * (parseInt(tzH) * 60 + parseInt(tzM));
  const d = new Date(
    Date.UTC(parseInt(year), MONTHS[mon], parseInt(day), parseInt(hh), parseInt(mm), parseInt(ss)),
  );
  return Math.floor(d.getTime() / 1000) - offsetMinutes * 60;
}

/**
 * Read all access.log files for a domain (current + rotated).
 * Handles plain text and .gz compressed files.
 * Yields parsed LogEntry objects.
 *
 * This is the Apache convenience adapter; consumers with other log
 * formats can skip this and feed LogEntry objects directly.
 */
/**
 * Extract timezone offset in minutes from a raw Apache timestamp.
 * E.g., "03/Apr/2026:14:22:31 -0700" → -420
 * Returns null for unparseable strings.
 *
 * Useful for consumers who need to pass tzOffsetMinutes to aggregate().
 */
export function parseApacheTzOffset(rawTimestamp: string): number | null {
  const m = rawTimestamp.match(/([+-])(\d{2})(\d{2})$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2]) * 60 + parseInt(m[3]));
}

/**
 * Read all access.log files for a domain (current + rotated).
 * Handles plain text and .gz compressed files.
 * Yields parsed LogEntry objects.
 *
 * This is the Apache convenience adapter; consumers with other log
 * formats can skip this and feed LogEntry objects directly.
 */
export async function* readLogFiles(domainDir: string): AsyncGenerator<LogEntry> {
  if (!existsSync(domainDir)) return;

  const files = (await readdir(domainDir)).filter((f) => f.startsWith('access.log')).sort();

  for (const file of files) {
    const filePath = join(domainDir, file);

    let stream: NodeJS.ReadableStream;
    if (file.endsWith('.gz')) {
      stream = createReadStream(filePath).pipe(createGunzip());
    } else {
      stream = createReadStream(filePath);
    }

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const parsed = parseLine(line);
      if (parsed) yield parsed;
    }
  }
}
