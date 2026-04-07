import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { SignalEntry } from '../types.js';

/**
 * Parse signal log UTC timestamp "2026-04-04T20:49:28Z" to Unix seconds.
 * Returns null for unparseable timestamps.
 */
export function parseSignalTs(ts: string): number | null {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

/**
 * Parse all JSONL signal log files from a directory.
 * Reads both the current log and rotated dated logs.
 *
 * This is a convenience for the JSONL format produced by the PHP shim.
 * Consumers with other signal sources can construct SignalEntry objects directly.
 */
export async function parseSignalLog(signalDir: string): Promise<SignalEntry[]> {
  if (!existsSync(signalDir)) return [];

  const files = (await readdir(signalDir)).filter((f) => f.endsWith('.jsonl')).sort();

  const entries: SignalEntry[] = [];
  for (const file of files) {
    const content = await readFile(join(signalDir, file), 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        if (!raw.domain || !raw.timestamp) continue;
        const ts = parseSignalTs(raw.timestamp as string);
        if (ts === null) continue;
        entries.push({ ...raw, timestamp: ts } as unknown as SignalEntry);
      } catch {
        // Skip malformed lines (truncated writes, etc.)
      }
    }
  }
  return entries;
}
