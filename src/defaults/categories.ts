/** Category assigned to entries with empty or missing user-agent strings. */
export const CATEGORY_UNKNOWN = 'unknown';

/** Category for verified human traffic. */
export const CATEGORY_HUMAN = 'human';

/** Category for programmatic HTTP clients (curl, axios, etc.). */
export const CATEGORY_PROGRAMMATIC = 'programmatic';

/** Category for bots detected by the isbot library but not in the curated list. */
export const CATEGORY_OTHER_BOT = 'other-bot';

/** Category for feed readers and news apps (user-initiated, not bots). */
export const CATEGORY_FEED_READER = 'feed-reader';

/** Category for traffic reclassified as AI coding agent via signal attribution. */
export const CATEGORY_AGENT = 'agent';

/** Prefix shared by all AI bot categories (ai-crawler, ai-assistant, ai-search). */
export const AI_CATEGORY_PREFIX = 'ai-';

/** Name assigned to agents detected via trigger heuristics but not matched to a known agent. */
export const UNIDENTIFIED_AGENT = 'unidentified';
