# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) with 0.x semantics: minor versions may change classification behavior.

## [0.4.0] - 2026-09-20

### Added

- `spoofedBrowserHeuristic` (first in the default chain): flags requests whose client hints contradict their user agent (Firefox or Safari UA with `Sec-Ch-Ua`; Chrome UA whose major disagrees with its hints). Returns a non-agent result in the new `spoofed-browser` category.
- `detectSpoofedBrowsers`: demotes human-category IP+UA pairs that never load assets, never send a same-site referrer, have two or more requests, and run a browser version far behind the newest asset-loading session of the same family (thresholds per family; reference versions self-calibrate from the corpus or can be supplied). Single-request pairs and current versions are never touched.
- `crossReferenceAgentIps`: attributes programmatic requests to a self-identifying agent active from the same IP within a window (default 15 minutes), across user agents and domains. Captures coding agents shelling out to curl. Only ever touches `programmatic` entries.
- `parseBrowserVersion`, `DEFAULT_STALE_MAJORS`, `DEFAULT_AGENT_IP_WINDOW_SECONDS`, `CATEGORY_SPOOFED_BROWSER`, `SPOOFED_BROWSER_NAME`.
- `spoofed-browser` is in `DEFAULT_TOP_PATHS_SKIP_CATEGORIES`.
- Bot database: PipericBot (seo-bot).

### Changed

- **`crossReferenceSignalIps` now applies a time window** (default 15 minutes, `windowSeconds` option; pass `Infinity` for the old behaviour). Previously any programmatic request from an IP that produced an agent signal that day was upgraded, regardless of elapsed time, which attributed unrelated curl activity from a developer's own address to an agent that had run hours earlier. On nine days of real logs the window keeps 160 of 171 upgrades; the 11 dropped were all hours apart from their anchor.
- `SignalClassifyResult` and `AgentSeed` gained an optional `category`. `buildAgentSeeds` now seeds sessions for non-agent results that carry a category, and `reclassifyEntries` applies the seed's category (still `agent` for agents).
- README documents the shared-IP design constraints for session functions and how to keep internal tools (site checkers, CI probes) from seeding agent sessions via `devTools`.

## [0.3.0] - 2026-09-20

Based on an audit of a week of live traffic (September 11 to 19, 2026) across twelve sites, plus two controlled tests of Cursor's fetch behavior.

### Changed

- **Signal classifier consults the bot database before running header heuristics.** Self-identifying crawlers, assistants, search bots, and feed readers are no longer treated as agents when they request `llms.txt` or negotiate for markdown. Previously GPTBot, ClaudeBot, bingbot, Amazonbot, Bytespider, and others seeded "unidentified" agent sessions, which pulled their access-log traffic out of the `ai-crawler` and `search-crawler` categories. Self-identifying coding agents (category `agent`) are still agents. New `botClassifier` option on `createSignalClassifier`; pass `null` to restore the old behavior.
- **Bare `Claude-User` is now `ai-assistant`, not Claude Code.** `Claude-User/1.0` is Claude.ai fetching a page on a user's behalf. Only the versioned `Claude-User (claude-code/x.y.z; ...)` UA is Claude Code, matched on `claude-code/` in both the bot database and `DEFAULT_KNOWN_AGENTS`.
- **Traceparent-based Cursor attribution downgraded.** `cursorHeuristic` is renamed `tracedProxyHeuristic` (the old name remains as a deprecated alias). It returns "Cursor (suspected)" only when the Accept header is Cursor's, and a neutral "traced proxy agent" otherwise. Controlled tests on 2026-09-19 showed Cursor's current desktop client sends no tracing headers on either its direct URL fetch or its web-search path.
- The Accept-taxonomy entry for Cursor's markdown-first preference list is labelled "Cursor (suspected)" and is now defined by the exported `CURSOR_ACCEPT_PREFIX` constant.

### Added

- `cursorFetchHeuristic`: definitive Cursor identification from the full fingerprint confirmed by controlled test (generic Chrome UA, Cursor's Accept header, `Pragma` and `Cache-Control: no-cache`, no `Sec-Ch-Ua`).
- `plainTextFetcherHeuristic`: browser-like UA sending a bare `Accept: text/plain` with no `Sec-Ch-Ua`, observed as an `llms.txt` scanner rotating through browser UAs.
- Accept-taxonomy entry for the html-first framework pattern (html, json, markdown, plain, csv), seen from generic Chrome UAs and from KeenableBot and Aranet-SearchBot.
- Bot database entries for coding and tool-use agents: `GitHubCopilotRuntime-WebFetch`, ZCode, Qoder CLI and IDE, grok-agent, deepseek-harness, and the embedded browsers of Claude Desktop, Kimi Desktop, WorkBuddy, and CodeBuddy.
- Bot database entries for AI assistants (Perplexity-User, MistralAI-User, DuckAssistBot, Amazon Quick, Amazon Q Business, Gemini Deep Research, xAI-Grok, Keenable-User, Shap-User), AI search (Claude-SearchBot, ExaSearchBot, Cloudflare AI Search, AzureAI-SearchBot, Kimi-SearchBot, meta-webindexer, KeenableBot, Aranet-SearchBot, Querit-SearchBot, Amazon Kendra), and AI crawlers (SSI-Nutch, Reflectionbot, Hunyuan, DeepSeekBot, KimiBot, MoonshotBot, GrokBot, PanguBot, Qwenbot, YiBot, ChatGLM-Spider, BeansLLM-CorpusBot, ShapBot).
- Bot database entries for search crawlers (SeznamBot, Sogou, PetalBot, Qwantbot, MojeekBot, CocCocBot, 360Spider, YisouSpider, Bravebot, AdsBot-Google, TikTokSpider, Marginalia, YaCy, other Yandex bots), SEO bots (Barkrowler, DataForSeoBot, SiteAuditBot, SEOJuice, BuiltWith, PoweredByBot, Screaming Frog, BacklinkDiscovery), monitoring (WebPageTest, Lighthouse, lychee, Oh Dear, DreamHost), social and fediverse link previews (Skype, Iframely, Lark, Misskey, Akkoma, Pleroma, Iceshrimp, Friendica, Catodon, Summaly, Matrix Synapse, Mattermost, Telegram, Zoom, HatchFeed), and feed readers (Zapier, Skyreader, Kingfisher, Inoreader, NetNewsWire, Reeder, RSS.Social, feeeed, Tapestry, feedparser, rss-parser, generic "RSS Reader" and "Feed Aggregator").
- Programmatic client patterns: PhantomJS, Lightpanda, Scrapy, HTTrack, Dalvik.
- `scripts/audit-access-logs.mjs` and `scripts/audit-signal-logs.mjs` for re-running this kind of audit against a directory of logs, with a guide in `scripts/README.md`.

### Fixed

- `ExaSearchBot`, which sends the same Accept header as Cursor, was being reported as "Cursor (suspected)". It is now routed to `ai-search` by the bot database before the heuristics run.
- `Screaming Frog`, previously used as the isbot-fallback test fixture, is now a curated `seo-bot`.

## [0.2.0] - 2026-04-09

### Added

- Additional bot, agent, and feed-reader classifications derived from real-world traffic during a Hacker News spike.

### Changed

- Expanded test coverage across classifier, signals, sessions, and aggregation.

## [0.1.2] - 2026-04-07

### Added

- Default skip substrings for vulnerability-scanner probes (`wp-admin`, `phpinfo`, `.env`, `.git/`, and similar), matched anywhere in the path.

## [0.1.1] - 2026-04-07

### Added

- More scanner and probe paths in the default skip lists.

## [0.1.0] - 2026-04-07

### Added

- Initial release: Apache log parsing, user-agent classification with a curated bot database, programmatic client detection, isbot fallback, signal-based agent heuristics, IP intelligence adapters, session clustering, duplicate-request proxy detection, and daily aggregation.

[0.4.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/releases/tag/v0.1.0
