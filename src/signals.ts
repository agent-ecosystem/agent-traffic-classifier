import type {
  IpInfo,
  SignalClassifierOptions,
  SignalClassifyResult,
  SignalEntry,
  SignalSummary,
} from './types.js';
import {
  DEFAULT_KNOWN_AGENTS,
  DEFAULT_DEV_TOOLS,
  DEFAULT_AGENT_TRIGGERS,
  DEFAULT_HEURISTICS,
} from './defaults/agents.js';
import { createClassifier } from './classify.js';
import { extractDateKey } from './date.js';
import {
  CATEGORY_AGENT,
  CATEGORY_HUMAN,
  CATEGORY_OTHER_BOT,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_UNKNOWN,
  UNIDENTIFIED_AGENT,
} from './defaults/categories.js';

/**
 * Categories the bot classifier assigns when the UA is NOT in the curated bot
 * database. Entries in these categories fall through to the header heuristics;
 * everything else is a self-identifying bot whose category settles the question.
 */
const UNCURATED_CATEGORIES = new Set([
  CATEGORY_HUMAN,
  CATEGORY_UNKNOWN,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_OTHER_BOT,
]);

/**
 * Create signal classification functions for detecting agents from HTTP header data.
 *
 * Returns { classifySignalEntry, getSignalSummary } bound to the provided configuration.
 */
export function createSignalClassifier(options?: SignalClassifierOptions): {
  classifySignalEntry: (entry: SignalEntry) => SignalClassifyResult;
  getSignalSummary: (
    signalEntries: SignalEntry[],
    dateKey: string,
    tzOffsetMinutes: number | null,
  ) => SignalSummary | null;
} {
  const knownAgents = options?.knownAgents ?? DEFAULT_KNOWN_AGENTS;
  const devTools = options?.devTools ?? DEFAULT_DEV_TOOLS;
  const agentTriggers = options?.agentTriggers ?? DEFAULT_AGENT_TRIGGERS;
  const heuristics = options?.heuristics ?? DEFAULT_HEURISTICS;
  const ipLookup = options?.ipLookup;
  const botClassifier =
    options?.botClassifier === null ? null : (options?.botClassifier ?? createClassifier());

  function classifySignalEntry(entry: SignalEntry): SignalClassifyResult {
    const ua = entry.headers?.['User-Agent'] || '';

    // Check known agent UA patterns
    for (const agent of knownAgents) {
      if (ua.includes(agent.pattern)) {
        return { isAgent: true, name: agent.name, company: agent.company };
      }
    }

    // Exclude known dev tools
    const uaLower = ua.toLowerCase();
    for (const tool of devTools) {
      if (uaLower.includes(tool.toLowerCase())) {
        return { isAgent: false };
      }
    }

    // Consult the curated bot database. Self-identifying coding agents are agents.
    // Self-identifying crawlers, assistants, search bots, feed readers, etc. are
    // not, even when they request llms.txt or negotiate for markdown: without
    // this check, GPTBot, ClaudeBot, bingbot and friends hitting llms.txt would
    // seed "unidentified" agent sessions and pull their access-log traffic out
    // of the ai-crawler / search-crawler categories.
    if (botClassifier) {
      const bot = botClassifier(ua);
      if (bot.category === CATEGORY_AGENT) {
        return { isAgent: true, name: bot.botName ?? UNIDENTIFIED_AGENT, company: bot.botCompany };
      }
      if (!UNCURATED_CATEGORIES.has(bot.category)) {
        return { isAgent: false };
      }
    }

    // Resolve IP intelligence (once per entry, shared across heuristics)
    const ipInfo: IpInfo | undefined = ipLookup ? ipLookup(entry.ip) : undefined;

    // Run heuristics (e.g., Cursor detection, Chrome 122 fingerprint)
    for (const heuristic of heuristics) {
      const result = heuristic(entry, ipInfo);
      if (result) return result;
    }

    // Unknown UA: trigger-based inference (only when trigger is present)
    if (entry.trigger && agentTriggers.has(entry.trigger)) {
      return { isAgent: true, name: UNIDENTIFIED_AGENT, company: null };
    }

    return { isAgent: false };
  }

  function getSignalSummary(
    signalEntries: SignalEntry[],
    dateKey: string,
    tzOffsetMinutes: number | null,
  ): SignalSummary | null {
    if (tzOffsetMinutes == null) return null;

    const dayEntries = signalEntries.filter((e) => {
      return extractDateKey(e.timestamp, tzOffsetMinutes) === dateKey;
    });

    // Only include entries classified as agent (exclude known dev tools)
    const agentEntries = dayEntries.filter((e) => classifySignalEntry(e).isAgent);
    if (agentEntries.length === 0) return null;

    const byTrigger: Record<string, number> = {};
    const byAgent: Record<
      string,
      {
        name: string;
        company: string | null;
        requests: number;
        ips: Set<string>;
        triggers: Record<string, number>;
      }
    > = {};

    for (const entry of agentEntries) {
      if (entry.trigger) {
        byTrigger[entry.trigger] = (byTrigger[entry.trigger] || 0) + 1;
      }

      const cls = classifySignalEntry(entry);
      const name = cls.name ?? UNIDENTIFIED_AGENT;
      if (!byAgent[name]) {
        byAgent[name] = {
          name,
          company: cls.company ?? null,
          requests: 0,
          ips: new Set(),
          triggers: {},
        };
      }
      byAgent[name].requests++;
      byAgent[name].ips.add(entry.ip);
      if (entry.trigger) {
        byAgent[name].triggers[entry.trigger] = (byAgent[name].triggers[entry.trigger] || 0) + 1;
      }
    }

    return {
      totalSignals: agentEntries.length,
      byTrigger,
      identifiedAgents: Object.values(byAgent).map((a) => ({
        name: a.name,
        company: a.company,
        requests: a.requests,
        uniqueIPs: a.ips.size,
        byTrigger: a.triggers,
      })),
    };
  }

  return { classifySignalEntry, getSignalSummary };
}
