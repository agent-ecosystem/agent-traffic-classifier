import type {
  AggregateOptions,
  AgentStat,
  BotStat,
  ClassifiedEntry,
  DaySummary,
  PathStat,
  ProgrammaticStat,
  ReferrerStat,
} from './types.js';
import { extractDateKey } from './date.js';
import {
  DEFAULT_TOP_PATHS_SKIP_CATEGORIES,
  DEFAULT_TOP_ITEM_PATHS_LIMIT,
} from './defaults/aggregate.js';
import {
  CATEGORY_HUMAN,
  AI_CATEGORY_PREFIX,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_AGENT,
} from './defaults/categories.js';

export { extractDateKey } from './date.js';

/**
 * Normalize a URL path:
 * - Extract and remove utm_source (returned separately)
 * - Add trailing slash to directory-like paths
 */
export function normalizePath(rawPath: string): { path: string; utmSource: string | null } {
  let normalizedPath = rawPath;
  let utmSource: string | null = null;

  const qIdx = rawPath.indexOf('?');
  if (qIdx !== -1) {
    const base = rawPath.slice(0, qIdx);
    const params = new URLSearchParams(rawPath.slice(qIdx + 1));
    if (params.has('utm_source')) {
      utmSource = params.get('utm_source');
      params.delete('utm_source');
      const remaining = params.toString();
      normalizedPath = remaining ? `${base}?${remaining}` : base;
    }
  }

  // Normalize trailing slashes: /contribute and /contribute/ -> /contribute/
  const qPart = normalizedPath.indexOf('?');
  const pathPart = qPart !== -1 ? normalizedPath.slice(0, qPart) : normalizedPath;
  const querySuffix = qPart !== -1 ? normalizedPath.slice(qPart) : '';
  if (pathPart !== '/' && !pathPart.includes('.') && !pathPart.endsWith('/')) {
    normalizedPath = pathPart + '/' + querySuffix;
  }

  return { path: normalizedPath, utmSource };
}

/**
 * Aggregate classified log entries into daily summary documents.
 *
 * Does NOT add collectedAt (consumer responsibility).
 */
export function aggregate(entries: ClassifiedEntry[], options: AggregateOptions): DaySummary[] {
  const {
    domain,
    tzOffsetMinutes = 0,
    shouldSkip,
    signalEntries,
    classifySignalEntry,
    getSignalSummary,
    normalizePath: normalizePathFn = normalizePath,
    topPathsLimit = 50,
    topPathsSkipCategories = DEFAULT_TOP_PATHS_SKIP_CATEGORIES,
    topItemPathsLimit = DEFAULT_TOP_ITEM_PATHS_LIMIT,
    topReferrersLimit = 30,
  } = options;

  const skipCategoriesSet = new Set(topPathsSkipCategories);

  // Pre-filter signal entries by domain (once, not per-day)
  const domainSignals = signalEntries?.filter((e) => e.domain === domain);

  // Group by date (using timezone offset to determine local calendar date)
  const byDate = new Map<string, ClassifiedEntry[]>();

  for (const item of entries) {
    const dateKey = extractDateKey(item.entry.timestamp, tzOffsetMinutes);
    if (!dateKey) continue;
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(item);
  }

  const docs: DaySummary[] = [];

  for (const [dateKey, dayEntries] of byDate) {
    const categoryStats: Record<string, { requests: number; ips: Set<string> }> = {};
    const pathStats: Record<string, { count: number; ips: Set<string> }> = {};
    const referrerStats: Record<string, number> = {};
    const statusCodes: Record<string, number> = {};
    const botStats: Record<
      string,
      {
        name: string;
        company: string | null;
        category: string;
        requests: number;
        ips: Set<string>;
        paths: Record<string, number>;
      }
    > = {};
    const programmaticStats: Record<string, { requests: number; ips: Set<string> }> = {};
    const agentStats: Record<
      string,
      {
        name: string;
        company: string | null;
        requests: number;
        ips: Set<string>;
        paths: Record<string, number>;
      }
    > = {};

    for (const { entry, classification } of dayEntries) {
      // Skip proxy duplicate entries
      if (classification.proxyDuplicate) continue;

      const { category, botName, botCompany } = classification;
      const { path: normalizedPath, utmSource } = normalizePathFn(entry.path);

      // Category summary
      if (!categoryStats[category]) {
        categoryStats[category] = { requests: 0, ips: new Set() };
      }
      categoryStats[category].requests++;
      categoryStats[category].ips.add(entry.ip);

      // Determine if this is a content page
      const isContentPage = shouldSkip ? !shouldSkip(entry) : true;

      // Top paths (human + AI traffic, skip configured categories; filter static assets)
      if (isContentPage && !skipCategoriesSet.has(category)) {
        if (!pathStats[normalizedPath]) {
          pathStats[normalizedPath] = { count: 0, ips: new Set() };
        }
        pathStats[normalizedPath].count++;
        pathStats[normalizedPath].ips.add(entry.ip);
      }

      // Referrers (human traffic only, content pages only)
      if (isContentPage && category === CATEGORY_HUMAN) {
        if (utmSource) {
          referrerStats[utmSource] = (referrerStats[utmSource] || 0) + 1;
        }
        if (entry.referrer) {
          referrerStats[entry.referrer] = (referrerStats[entry.referrer] || 0) + 1;
        }
      }

      // Status codes
      statusCodes[entry.status] = (statusCodes[entry.status] || 0) + 1;

      // Per-bot breakdown for AI categories
      if (category.startsWith(AI_CATEGORY_PREFIX) && botName) {
        if (!botStats[botName]) {
          botStats[botName] = {
            name: botName,
            company: botCompany,
            category,
            requests: 0,
            ips: new Set(),
            paths: {},
          };
        }
        botStats[botName].requests++;
        botStats[botName].ips.add(entry.ip);
        if (isContentPage) {
          botStats[botName].paths[normalizedPath] =
            (botStats[botName].paths[normalizedPath] || 0) + 1;
        }
      }

      // Programmatic client breakdown
      if (category === CATEGORY_PROGRAMMATIC && botName) {
        if (!programmaticStats[botName]) {
          programmaticStats[botName] = { requests: 0, ips: new Set() };
        }
        programmaticStats[botName].requests++;
        programmaticStats[botName].ips.add(entry.ip);
      }

      // Agent breakdown
      if (category === CATEGORY_AGENT && botName) {
        if (!agentStats[botName]) {
          agentStats[botName] = {
            name: botName,
            company: botCompany,
            requests: 0,
            ips: new Set(),
            paths: {},
          };
        }
        agentStats[botName].requests++;
        agentStats[botName].ips.add(entry.ip);
        if (isContentPage) {
          agentStats[botName].paths[normalizedPath] =
            (agentStats[botName].paths[normalizedPath] || 0) + 1;
        }
      }
    }

    // Build the document
    const byCategory: Record<string, { requests: number; uniqueIPs: number }> = {};
    for (const [cat, stats] of Object.entries(categoryStats)) {
      byCategory[cat] = { requests: stats.requests, uniqueIPs: stats.ips.size };
    }

    const topPaths: PathStat[] = Object.entries(pathStats)
      .map(([path, s]) => ({ path, count: s.count, uniqueIPs: s.ips.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topPathsLimit);

    const topReferrers: ReferrerStat[] = Object.entries(referrerStats)
      .map(([referrer, count]) => ({ referrer, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topReferrersLimit);

    const aiBots: BotStat[] = Object.values(botStats).map((b) => ({
      name: b.name,
      company: b.company,
      category: b.category,
      requests: b.requests,
      uniqueIPs: b.ips.size,
      topPaths: Object.entries(b.paths)
        .sort(([, a], [, bv]) => bv - a)
        .slice(0, topItemPathsLimit)
        .map(([path, count]) => ({ path, count })),
    }));

    const programmatic: ProgrammaticStat[] = Object.entries(programmaticStats)
      .map(([client, s]) => ({ client, requests: s.requests, uniqueIPs: s.ips.size }))
      .sort((a, b) => b.requests - a.requests);

    const agents: AgentStat[] = Object.values(agentStats)
      .map((a) => ({
        name: a.name,
        company: a.company,
        requests: a.requests,
        uniqueIPs: a.ips.size,
        topPaths: Object.entries(a.paths)
          .sort(([, x], [, y]) => y - x)
          .slice(0, topItemPathsLimit)
          .map(([path, count]) => ({ path, count })),
      }))
      .sort((a, b) => b.requests - a.requests);

    // Signal log summary
    let agentSignals: DaySummary['agentSignals'] = null;
    if (domainSignals && classifySignalEntry && getSignalSummary) {
      agentSignals = getSignalSummary(domainSignals, dateKey, tzOffsetMinutes);

      // Merge per-agent trigger breakdown from signal summary into agents array
      if (agentSignals) {
        for (const agent of agents) {
          const signalAgent = agentSignals.identifiedAgents.find((a) => a.name === agent.name);
          if (signalAgent?.byTrigger) {
            agent.byTrigger = signalAgent.byTrigger;
          }
        }
      }
    }

    docs.push({
      date: dateKey,
      domain,
      summary: {
        totalRequests: dayEntries.length,
        byCategory,
      },
      topPaths,
      topReferrers,
      aiBots,
      statusCodes,
      programmatic,
      agents,
      agentSignals,
    });
  }

  return docs;
}
