import type {
  AgentSeed,
  BrowserFamily,
  ClassifiedEntry,
  ClassifyResult,
  CrossReferenceAgentIpsOptions,
  LogEntry,
  SessionOptions,
  SessionProfile,
  SignalClassifyResult,
  SignalEntry,
  SpoofedBrowserOptions,
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
  CATEGORY_SPOOFED_BROWSER,
  UNIDENTIFIED_AGENT,
} from './defaults/categories.js';
import { SPOOFED_BROWSER_NAME } from './defaults/agents.js';

/** Extensions that indicate static asset requests (images, scripts, styles, fonts). */
const STATIC_ASSET_RE = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)(\?|$)/i;

/**
 * Build per-IP session profiles from access log entries.
 *
 * For each IP, determines whether the session includes static asset fetches
 * (CSS, JS, images, fonts) and self-site referrers (referrers pointing to
 * the same domain). Both are strong indicators of a real browser session.
 *
 * Pass the result into `SessionOptions.sessionProfiles` to suppress
 * false-positive "Cursor (suspected)" labels during high-traffic periods.
 */
export function buildSessionProfiles(
  entries: ClassifiedEntry[],
  domain: string,
): Map<string, SessionProfile> {
  const profiles = new Map<string, SessionProfile>();

  for (const { entry } of entries) {
    let profile = profiles.get(entry.ip);
    if (!profile) {
      profile = { hasStaticAssets: false, hasSelfReferrer: false };
      profiles.set(entry.ip, profile);
    }

    if (!profile.hasStaticAssets && STATIC_ASSET_RE.test(entry.path)) {
      profile.hasStaticAssets = true;
    }

    if (
      !profile.hasSelfReferrer &&
      entry.referrer &&
      entry.referrer !== '-' &&
      entry.referrer.includes(domain)
    ) {
      profile.hasSelfReferrer = true;
    }
  }

  return profiles;
}

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
    // Agents seed agent sessions; non-agent results that still identify the
    // client (e.g. spoofed-browser) seed sessions in their own category.
    if (!cls.isAgent && !cls.category) continue;
    const category = cls.isAgent ? CATEGORY_AGENT : cls.category!;

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
        category,
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
 * For each access entry whose (IP, UA) matches a seed: if its timestamp falls
 * within windowSeconds of the seed's current window [earliestTs, latestTs],
 * reclassify to the seed's category ("agent" unless the seed says otherwise)
 * and expand the window.
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
            category: seed.category ?? CATEGORY_AGENT,
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
  const sessionProfiles = options?.sessionProfiles;

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
      // No signal data; heuristic only = suspected.
      // Session-aware gate: if both IPs show real-browser behavior (static
      // asset fetches AND self-site referrers), this pair is likely
      // coincidental concurrent human access, not a proxy-based agent.
      if (sessionProfiles) {
        const profA = sessionProfiles.get(result[idxA].entry.ip);
        const profB = sessionProfiles.get(result[idxB].entry.ip);
        if (
          profA?.hasStaticAssets &&
          profA?.hasSelfReferrer &&
          profB?.hasStaticAssets &&
          profB?.hasSelfReferrer
        ) {
          continue;
        }
      }
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

/**
 * Cross-reference programmatic requests with self-identifying agent activity
 * from the same IP, across user agents and across domains.
 *
 * Coding agents routinely drop to a shell and run curl (or another HTTP
 * client) moments after fetching with their own self-identifying tool. Those
 * requests arrive as `programmatic` and are invisible to header heuristics.
 * If a self-identifying agent (a signal entry or an access-log entry with a
 * named vendor) was active from the same IP within `windowSeconds`, the
 * programmatic request is attributed to that agent.
 *
 * Shared-IP safety: this only ever touches `programmatic` entries. Human
 * browser traffic is never reclassified on IP evidence. Keep the window short;
 * observed gaps between an agent's fetch-tool request and its shell request
 * are seconds to a few minutes.
 */
export function crossReferenceAgentIps(
  classifiedEntries: ClassifiedEntry[],
  signalEntries: SignalEntry[],
  classifySignalEntry: (entry: SignalEntry) => SignalClassifyResult,
  options?: CrossReferenceAgentIpsOptions,
): ClassifiedEntry[] {
  const windowSeconds = options?.windowSeconds ?? DEFAULT_AGENT_IP_WINDOW_SECONDS;

  // Anchors: self-identifying agents only (named, with a vendor). Heuristic
  // and "unidentified" results are not strong enough to spread across UAs.
  const anchors = new Map<string, Array<{ ts: number; name: string; company: string | null }>>();
  const addAnchor = (ip: string, ts: number, name: string, company: string | null) => {
    if (!anchors.has(ip)) anchors.set(ip, []);
    anchors.get(ip)!.push({ ts, name, company });
  };

  for (const entry of signalEntries) {
    const cls = classifySignalEntry(entry);
    if (!cls.isAgent || !cls.name || cls.name === UNIDENTIFIED_AGENT || !cls.company) continue;
    addAnchor(entry.ip, entry.timestamp, cls.name, cls.company);
  }
  for (const { entry, classification } of classifiedEntries) {
    if (classification.category !== CATEGORY_AGENT || classification.proxyDuplicate) continue;
    if (!classification.botName || !classification.botCompany) continue;
    addAnchor(entry.ip, entry.timestamp, classification.botName, classification.botCompany);
  }
  if (anchors.size === 0) return classifiedEntries;
  for (const list of anchors.values()) list.sort((a, b) => a.ts - b.ts);

  return classifiedEntries.map((item) => {
    if (item.classification.category !== CATEGORY_PROGRAMMATIC) return item;
    const list = anchors.get(item.entry.ip);
    if (!list) return item;
    const ts = item.entry.timestamp;
    let best: { ts: number; name: string; company: string | null } | null = null;
    for (const a of list) {
      if (a.ts > ts + windowSeconds) break;
      if (a.ts < ts - windowSeconds) continue;
      if (!best || Math.abs(a.ts - ts) < Math.abs(best.ts - ts)) best = a;
    }
    if (!best) return item;
    return {
      entry: item.entry,
      classification: { category: CATEGORY_AGENT, botName: best.name, botCompany: best.company },
    };
  });
}

/** Default window for crossReferenceAgentIps (15 minutes). */
export const DEFAULT_AGENT_IP_WINDOW_SECONDS = 900;

/** Default staleness thresholds (major versions behind the reference) per browser family. */
export const DEFAULT_STALE_MAJORS: Record<BrowserFamily, number> = {
  chrome: 15,
  edge: 15,
  firefox: 15,
  safari: 3,
  ios: 3,
};

/**
 * Parse the browser family and major version from a browser-shaped user agent.
 * Returns null for non-browser UAs (bots, libraries, embedded apps with product tokens).
 */
export function parseBrowserVersion(
  userAgent: string,
): { family: BrowserFamily; major: number } | null {
  if (!userAgent.startsWith('Mozilla/5.0 (')) return null;
  if (/bot|crawl|spider|compatible;|Headless|Electron|Code\//i.test(userAgent)) return null;
  let m: RegExpMatchArray | null;
  if ((m = userAgent.match(/(?:iPhone|CPU) OS (\d+)_/)))
    return { family: 'ios', major: Number(m[1]) };
  if ((m = userAgent.match(/Edg\/(\d+)/))) return { family: 'edge', major: Number(m[1]) };
  if ((m = userAgent.match(/(?:Chrome|CriOS)\/(\d+)/)))
    return { family: 'chrome', major: Number(m[1]) };
  if ((m = userAgent.match(/Firefox\/(\d+)/))) return { family: 'firefox', major: Number(m[1]) };
  if ((m = userAgent.match(/Version\/(\d+)[\d.]* .*Safari\//)))
    return { family: 'safari', major: Number(m[1]) };
  return null;
}

/**
 * Demote human-category traffic that wears a browser user agent but does not
 * behave like a browser, to the `spoofed-browser` category.
 *
 * An IP+UA pair is demoted only when ALL of the following hold:
 *  - the UA parses as a mainstream browser (see parseBrowserVersion)
 *  - the pair made at least `minRequests` requests (default 2)
 *  - the pair never fetched a static asset and never sent a same-site referrer
 *  - the browser version is stale: at least `staleMajors[family]` majors behind
 *    the newest version of that family seen among pairs that DID load assets
 *    (or behind `referenceMajors[family]` when supplied)
 *
 * Shared-IP safety: the key is IP+UA, not IP; single-request pairs are never
 * touched (a returning visitor with cached assets looks the same as a single
 * hit); and the version test keeps carrier-grade NAT safe, since current
 * browser versions can never be demoted.
 */
export function detectSpoofedBrowsers(
  classifiedEntries: ClassifiedEntry[],
  domain: string,
  options?: SpoofedBrowserOptions,
): ClassifiedEntry[] {
  const minRequests = options?.minRequests ?? 2;
  const staleMajors = { ...DEFAULT_STALE_MAJORS, ...options?.staleMajors };

  type Pair = {
    n: number;
    assets: boolean;
    selfRef: boolean;
    parsed: ReturnType<typeof parseBrowserVersion>;
  };
  const pairs = new Map<string, Pair>();
  for (const { entry } of classifiedEntries) {
    const key = `${entry.ip}|||${entry.userAgent}`;
    let p = pairs.get(key);
    if (!p) {
      p = { n: 0, assets: false, selfRef: false, parsed: parseBrowserVersion(entry.userAgent) };
      pairs.set(key, p);
    }
    p.n++;
    if (STATIC_ASSET_RE.test(entry.path)) p.assets = true;
    if (entry.referrer && entry.referrer !== '-' && entry.referrer.includes(domain))
      p.selfRef = true;
  }

  // Reference: newest major per family among pairs that behave like browsers.
  const reference: Partial<Record<BrowserFamily, number>> = { ...options?.referenceMajors };
  if (!options?.referenceMajors) {
    for (const p of pairs.values()) {
      if (!p.parsed || !p.assets) continue;
      const cur = reference[p.parsed.family];
      if (cur === undefined || p.parsed.major > cur) reference[p.parsed.family] = p.parsed.major;
    }
  }

  const demote = new Set<string>();
  for (const [key, p] of pairs) {
    if (!p.parsed || p.n < minRequests || p.assets || p.selfRef) continue;
    const ref = reference[p.parsed.family];
    if (ref === undefined) continue;
    if (p.parsed.major <= ref - staleMajors[p.parsed.family]) demote.add(key);
  }
  if (demote.size === 0) return classifiedEntries;

  return classifiedEntries.map((item) => {
    if (item.classification.category !== CATEGORY_HUMAN) return item;
    if (!demote.has(`${item.entry.ip}|||${item.entry.userAgent}`)) return item;
    return {
      entry: item.entry,
      classification: {
        category: CATEGORY_SPOOFED_BROWSER,
        botName: SPOOFED_BROWSER_NAME,
        botCompany: null,
      },
    };
  });
}
