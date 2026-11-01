import { isbot } from 'isbot';
import type { BotEntry, ClassifierOptions, ClassifyResult } from './types.js';
import defaultBotDatabase from './defaults/bots.json' with { type: 'json' };
import { DEFAULT_PROGRAMMATIC, DEFAULT_EXACT_PROGRAMMATIC } from './defaults/programmatic.js';
import {
  CATEGORY_UNKNOWN,
  CATEGORY_PROGRAMMATIC,
  CATEGORY_OTHER_BOT,
  CATEGORY_HUMAN,
} from './defaults/categories.js';

/**
 * A bare `Mozilla/5.0` (or `Mozilla/4.0`, with or without `(compatible)`) says
 * nothing about the client. isbot flags it as a bot; here it is `unknown`, like
 * an empty user agent, so it stays eligible for behavioural detection.
 */
const BARE_MOZILLA_RE = /^Mozilla\/[45]\.0(?:\s*\(compatible;?\s*\))?\s*$/;

/**
 * A browser user agent cut off before the browser token, such as
 * `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36` or
 * `Mozilla/5.0 (Macintosh) Safari/605`. No browser sends these; in November
 * 2026 logs they came from 31 addresses probing `.env`, `/api/keys`,
 * `/actuator/env`, `/openapi.json`, and `/swagger.json`. Like a bare
 * `Mozilla/5.0` they are `unknown`, which keeps them eligible for
 * behavioural detection (isbot passes them, so they would otherwise be
 * `human`, and with no version there is nothing for the stale-browser test
 * to compare). Checked after the curated bot list so a self-identifying
 * `(compatible; SomeBot/1.0) AppleWebKit/537.36` keeps its entry.
 */
const TRUNCATED_BROWSER_RE =
  /^Mozilla\/5\.0 (?:\((?![^)]*compatible)[^)]*\) )?(?:AppleWebKit\/[\d.]+(?: \(KHTML, like Gecko\))?|(?:Chrome|Safari)\/[\d.]+)\s*$/;

/** The default bot database shipped with the library. */
export const defaultBotDb = defaultBotDatabase as {
  categories: Record<string, string>;
  bots: BotEntry[];
};

/**
 * Create a classifier function that categorizes user-agent strings.
 *
 * Priority:
 *  1. Match against known bot list (most specific)
 *  2. Heuristic for programmatic clients (axios, curl, etc.)
 *  3. isbot fallback for general bot detection
 *  4. Everything else is "human"
 */
export function createClassifier(
  options?: ClassifierOptions,
): (userAgent: string) => ClassifyResult {
  const bots = options?.bots ?? defaultBotDb.bots;
  const programmatic = options?.programmaticClients ?? DEFAULT_PROGRAMMATIC;
  const exactProgrammatic = options?.exactProgrammaticClients ?? DEFAULT_EXACT_PROGRAMMATIC;

  return (userAgent: string): ClassifyResult => {
    if (!userAgent || userAgent === '-' || BARE_MOZILLA_RE.test(userAgent)) {
      return { category: CATEGORY_UNKNOWN, botName: null, botCompany: null };
    }

    // 1. Check curated bot list (order matters: more specific patterns first)
    for (const bot of bots) {
      if (userAgent.includes(bot.pattern)) {
        return {
          category: bot.category,
          botName: bot.name,
          botCompany: bot.company,
        };
      }
    }

    if (TRUNCATED_BROWSER_RE.test(userAgent)) {
      return { category: CATEGORY_UNKNOWN, botName: null, botCompany: null };
    }

    // 2. Heuristic: programmatic clients that aren't in bot lists.
    // Check BEFORE isbot, because isbot flags axios/curl/etc. as bots
    // and we want to track these separately.
    const uaLower = userAgent.toLowerCase();
    for (const sig of programmatic) {
      if (uaLower.includes(sig.toLowerCase())) {
        return { category: CATEGORY_PROGRAMMATIC, botName: sig, botCompany: null };
      }
    }

    // Exact-match programmatic clients (too generic for substring matching)
    const uaTrimmed = userAgent.trim();
    if (exactProgrammatic.includes(uaTrimmed)) {
      return { category: CATEGORY_PROGRAMMATIC, botName: uaTrimmed, botCompany: null };
    }

    // 3. isbot catches remaining known bots we haven't categorized
    if (isbot(userAgent)) {
      return { category: CATEGORY_OTHER_BOT, botName: null, botCompany: null };
    }

    // 4. Human visitor
    return { category: CATEGORY_HUMAN, botName: null, botCompany: null };
  };
}
