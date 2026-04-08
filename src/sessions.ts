import type {
  AgentSeed,
  ClassifiedEntry,
  ClassifyResult,
  LogEntry,
  SessionOptions,
  SignalClassifyResult,
  SignalEntry,
} from './types.js';
import {
  DEFAULT_WINDOW_SECONDS,
  DEFAULT_PROXY_WINDOW_SECONDS,
  CURSOR_PROXY_AGENT,
} from './defaults/sessions.js';
import {
  CATEGORY_AGENT,
  CATEGORY_HUMAN,
  CATEGORY_PROGRAMMATIC,
  UNIDENTIFIED_AGENT,
} from './defaults/categories.js';

/**
 * Build agent seeds from signal entries, grouped by domain.
 *
 * Returns Map<domain, Map<"ip|||ua", AgentSeed>>
 * earliestTs/latestTs define the initial window from signal data;
 * the reclassification step expands these as access entries match.
 */
export function buildAgentSeeds(
  signalEntries: SignalEntry[],
  classifySignalEntry: (entry: SignalEntry) => SignalClassifyResult,
): Map<string, Map<string, AgentSeed>> {
  const byDomain = new Map<string, Map<string, AgentSeed>>();

  for (const entry of signalEntries) {
    const cls = classifySignalEntry(entry);
    if (!cls.isAgent) continue;

    const ua = entry.headers?.['User-Agent'] || '';
    const ts = entry.timestamp;

    if (!byDomain.has(entry.domain)) byDomain.set(entry.domain, new Map());
    const seeds = byDomain.get(entry.domain)!;
    const key = `${entry.ip}|||${ua}`;

    if (!seeds.has(key)) {
      seeds.set(key, {
        name: cls.name ?? UNIDENTIFIED_AGENT,
        company: cls.company ?? null,
        earliestTs: ts,
        latestTs: ts,
      });
    } else {
      const seed = seeds.get(key)!;
      seed.earliestTs = Math.min(seed.earliestTs, ts);
      seed.latestTs = Math.max(seed.latestTs, ts);
    }
  }

  return byDomain;
}

/**
 * Reclassify access log entries using agent signal seeds.
 *
 * For each access entry whose (IP, UA) matches an agent seed: if its
 * timestamp falls within windowSeconds of the seed's current window
 * [earliestTs, latestTs], reclassify as "agent" and expand the window.
 *
 * Returns array of ClassifiedEntry.
 */
export function reclassifyEntries(
  rawEntries: LogEntry[],
  domainSeeds: Map<string, AgentSeed> | null,
  classifyFn: (userAgent: string) => ClassifyResult,
  options?: SessionOptions,
): ClassifiedEntry[] {
  const windowSeconds = options?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const result: ClassifiedEntry[] = [];

  for (const entry of rawEntries) {
    const baseClassification = classifyFn(entry.userAgent);

    if (!domainSeeds) {
      result.push({ entry, classification: baseClassification });
      continue;
    }

    const key = `${entry.ip}|||${entry.userAgent}`;
    const seed = domainSeeds.get(key);

    if (seed) {
      const ts = entry.timestamp;
      if (ts >= seed.earliestTs - windowSeconds && ts <= seed.latestTs + windowSeconds) {
        // Match: expand window and reclassify
        seed.earliestTs = Math.min(seed.earliestTs, ts);
        seed.latestTs = Math.max(seed.latestTs, ts);
        result.push({
          entry,
          classification: {
            category: CATEGORY_AGENT,
            botName: seed.name,
            botCompany: seed.company,
          },
        });
        continue;
      }
    }

    result.push({ entry, classification: baseClassification });
  }

  return result;
}

/**
 * Detect proxy-based agent fetches via duplicate-request heuristic,
 * collapse duplicate pairs to a single agent request, and assign
 * confidence levels based on corroborating signals.
 *
 * Heuristic: when the same path is requested with the same User-Agent
 * from different IPs within a short window, it likely indicates a
 * proxy-based coding agent rather than organic traffic.
 *
 * The proxy agent identity (default: Cursor/Anysphere) is configurable
 * via options.proxyAgent.
 *
 * Confidence levels:
 * - proxyAgent.name: duplicate-request pattern AND signal data corroborate
 * - proxyAgent.suspectedName: duplicate-request pattern only, no signal data
 *
 * Collapse: for each pair, only ONE entry is classified as the agent.
 * The other is marked with proxyDuplicate=true so the aggregator skips it.
 */
export function detectDuplicateRequestAgents(
  classifiedEntries: ClassifiedEntry[],
  options?: SessionOptions,
): ClassifiedEntry[] {
  const proxyWindowSeconds = options?.proxyWindowSeconds ?? DEFAULT_PROXY_WINDOW_SECONDS;
  const proxyAgent = options?.proxyAgent ?? CURSOR_PROXY_AGENT;
  const proxyBotNames = new Set([UNIDENTIFIED_AGENT, proxyAgent.name, proxyAgent.suspectedName]);

  // Group ALL entries by (path, userAgent)
  const groups = new Map<string, number[]>();

  for (let i = 0; i < classifiedEntries.length; i++) {
    const { entry, classification } = classifiedEntries[i];
    // Skip entries already identified as known non-proxy agents or bots
    const cat = classification.category;
    if (cat !== CATEGORY_HUMAN && cat !== CATEGORY_AGENT) continue;
    // Skip known non-proxy agents (Claude Code, GitHub Copilot, etc.)
    if (
      cat === CATEGORY_AGENT &&
      classification.botName &&
      !proxyBotNames.has(classification.botName)
    ) {
      continue;
    }

    const key = `${entry.path}|||${entry.userAgent}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  // Find duplicate-request pairs: different IPs within the window
  const pairs: Array<[number, number]> = [];

  for (const indices of groups.values()) {
    if (indices.length < 2) continue;

    const withTs = indices.map((i) => ({
      idx: i,
      ts: classifiedEntries[i].entry.timestamp,
    }));
    withTs.sort((a, b) => a.ts - b.ts);

    const used = new Set<number>();
    for (let i = 0; i < withTs.length; i++) {
      if (used.has(withTs[i].idx)) continue;
      for (let j = i + 1; j < withTs.length; j++) {
        if (used.has(withTs[j].idx)) continue;
        if (withTs[j].ts - withTs[i].ts > proxyWindowSeconds) break;
        const ipA = classifiedEntries[withTs[i].idx].entry.ip;
        const ipB = classifiedEntries[withTs[j].idx].entry.ip;
        if (ipA !== ipB) {
          pairs.push([withTs[i].idx, withTs[j].idx]);
          used.add(withTs[i].idx);
          used.add(withTs[j].idx);
          break;
        }
      }
    }
  }

  if (pairs.length === 0) return classifiedEntries;

  const result = classifiedEntries.map((item) => ({ ...item }));

  for (const [idxA, idxB] of pairs) {
    const clsA = result[idxA].classification;
    const clsB = result[idxB].classification;
    const nameA = clsA.category === CATEGORY_AGENT ? clsA.botName : null;
    const nameB = clsB.category === CATEGORY_AGENT ? clsB.botName : null;

    let agentName: string;
    let agentCompany: string | null;
    let primaryIdx: number;
    let duplicateIdx: number;

    if (nameA && nameA !== UNIDENTIFIED_AGENT) {
      agentName = nameA;
      agentCompany = clsA.botCompany;
      primaryIdx = idxA;
      duplicateIdx = idxB;
    } else if (nameB && nameB !== UNIDENTIFIED_AGENT) {
      agentName = nameB;
      agentCompany = clsB.botCompany;
      primaryIdx = idxB;
      duplicateIdx = idxA;
    } else if (nameA === UNIDENTIFIED_AGENT || nameB === UNIDENTIFIED_AGENT) {
      // Signal data exists + duplicate-request pattern = confirmed proxy agent
      agentName = proxyAgent.name;
      agentCompany = proxyAgent.company;
      primaryIdx = nameA ? idxA : idxB;
      duplicateIdx = nameA ? idxB : idxA;
    } else {
      // No signal data; heuristic only = suspected
      agentName = proxyAgent.suspectedName;
      agentCompany = proxyAgent.company;
      primaryIdx = idxA;
      duplicateIdx = idxB;
    }

    result[primaryIdx] = {
      entry: result[primaryIdx].entry,
      classification: {
        category: CATEGORY_AGENT,
        botName: agentName,
        botCompany: agentCompany,
      },
    };

    result[duplicateIdx] = {
      entry: result[duplicateIdx].entry,
      classification: {
        ...result[duplicateIdx].classification,
        proxyDuplicate: true,
      },
    };
  }

  return result;
}

/**
 * Cross-reference programmatic client IPs with agent signal IPs.
 *
 * If a programmatic entry (e.g., python-httpx, undici) comes from the same IP
 * that also appears in agent signal data, the programmatic traffic is likely
 * driven by the same agent. This upgrades the entry from "programmatic" to "agent".
 *
 * The agent name is taken from the best signal classification for that IP.
 * Run this after reclassifyEntries and detectDuplicateRequestAgents.
 */
export function crossReferenceSignalIps(
  classifiedEntries: ClassifiedEntry[],
  signalEntries: SignalEntry[],
  domain: string,
  classifySignalEntry: (entry: SignalEntry) => SignalClassifyResult,
): ClassifiedEntry[] {
  // Build IP → best agent name map from signal entries for this domain
  const ipAgents = new Map<string, { name: string; company: string | null }>();

  for (const entry of signalEntries) {
    if (entry.domain !== domain) continue;
    const cls = classifySignalEntry(entry);
    if (!cls.isAgent) continue;

    const name = cls.name ?? UNIDENTIFIED_AGENT;
    const existing = ipAgents.get(entry.ip);

    // Prefer named agents over "unidentified"
    if (!existing || (existing.name === UNIDENTIFIED_AGENT && name !== UNIDENTIFIED_AGENT)) {
      ipAgents.set(entry.ip, { name, company: cls.company ?? null });
    }
  }

  if (ipAgents.size === 0) return classifiedEntries;

  return classifiedEntries.map((item) => {
    if (item.classification.category !== CATEGORY_PROGRAMMATIC) return item;

    const agent = ipAgents.get(item.entry.ip);
    if (!agent) return item;

    return {
      entry: item.entry,
      classification: {
        category: CATEGORY_AGENT,
        botName: agent.name,
        botCompany: agent.company,
      },
    };
  });
}
