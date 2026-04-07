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
    if (!userAgent || userAgent === '-') {
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
