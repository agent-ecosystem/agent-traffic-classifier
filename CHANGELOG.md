# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) with 0.x semantics: minor versions may change classification behavior.

## [0.8.0] - 2026-11-14

Based on an audit of November 7 to 14, 2026 logs across twelve sites (56,979 requests, 3,179 signal entries) with 0.7.0. The 0.7.0 triggers held: the per-pair version test demoted 1,604 pairs (5,962 filtered requests, none of which loaded an asset or navigated with a same-site referrer), the pool test another 1,567 pairs, and the week's top referrers are search engines and the author's own sites again. Two shapes survived as `human`.

### Changed

- **`detectSpoofedBrowsers` gained a fifth trigger, `bareOriginReferrers` (default on).** A browser-UA pair that sent a Referer consisting of a bare origin with no path (`https://example.com`, exported as `BARE_ORIGIN_REFERRER_RE`) and never loaded an asset is demoted regardless of browser version or request count. Browsers serialize an origin-only referrer with a trailing slash (`https://example.com/`), so the slashless form only comes from code that set the header by hand. In the audit week 1,188 pairs sent one, 1,138 of them single-request, under current Chrome 150-154 and Firefox 156 strings from residential addresses, fetching probe paths (`/api`, `/api/events/consume`, `/guides/disaster-recovery`) that returned 404, plus a second pool that used it as a same-site referrer; the trigger moves 1,213 filtered requests, 14% of what still counted as human. The 16 pairs that had also loaded an asset were all self-identifying bots (GPTBot, DuckDuckBot, the VirusTotal webview), which the asset condition leaves alone in any case.
- **The pool test (`uaPools`) no longer requires a Referer by default.** `poolReferrerShare` now defaults to 0 (pass 0.8 for the 0.7.0 behavior), and pairs the per-pair tests already demoted count toward the pool's single-request share. The requirement was meant to spare agent fetchers, which the staleness test already keeps out because they run current browser versions. A pool of 743 requests from 347 Tencent Cloud addresses under one frozen iOS 13 string sent no Referer on seven of the sites it visited and a bare-origin one on the other four, and its two-request addresses (independently demoted as stale) pushed the single-request share under 90% on the larger sites. With both changes the pool test demotes a further 1,548 filtered requests across 42 stale UA versions (the iOS 13 pool, the rest of a Chrome/139 string that fetched 1,054 pages from 222 datacenter addresses in three days, a Chrome/81 string from 91 addresses fetching one homepage each, a Chrome/126 string from 21 addresses probing Metabase session endpoints, feed URLs under Safari strings), all one request per address with no asset load and nothing that navigated or rendered.
- **`spoofedBrowserHeuristic` also fires on partial Fetch Metadata.** A browser UA that sends `Sec-Fetch-Site` without `Sec-Fetch-Mode` and `Sec-Fetch-Dest` is reported as `spoofed-browser` (not an agent). Browsers send the three together on every request. In the audit week this was the exact header set, and only this set, of the proxy-pool crawler that fetched markdown alternates of HTML pages (147 signal entries from 144 addresses, one each, Chrome/131, `Content-Length: 0` on GET, no `Accept-Language`) and had been reported as "html-first agent" since October; every other entry carrying `Sec-Fetch-Site` carried the other two as well. Its entries had seeded agent sessions that absorbed 594 filtered access-log requests; the agent column for the week goes from 1,313 to 708.

- **The version reference has a dated floor and is shared between sibling families.** `detectSpoofedBrowsers` computes its per-family reference from the asset-loading sessions in the entries. On a small site a week of logs often has none for a family, or only an old one (agentminutes.dev had no Safari or Edge asset loader and an iOS reference of 16), which left 473 requests under nine stale Safari 17, iOS 17, and Edge 120/121 strings as `human`. The reference is now shared between Chrome and Edge and between Safari and iOS, and raised to `DEFAULT_REFERENCE_FLOOR` (as of 2026-11-01: Chrome 150, Edge 150, Firefox 150, Safari 26, iOS 26) as max(observed, floor). The floor applies only when the newest timestamp in the entries is at or past its `asOf` date, so reprocessing older logs is still judged by the versions current then. **The floor is a calendar-dependent constant that must be bumped at each pattern audit**, together with its `asOf` date; it is set a few majors behind the versions current at that date so it can only be too low (less aggressive on sites with no observed reference), never too high. `referenceFloor: false` computes from the entries alone; `referenceMajors` still overrides everything.

### Added

- `SpoofedBrowserOptions.bareOriginReferrers`; exported `BARE_ORIGIN_REFERRER_RE`.
- `SpoofedBrowserOptions.referenceFloor`, the `ReferenceFloor` type, and exported `DEFAULT_REFERENCE_FLOOR`.
- Bot database, from operator pages read on 2026-11-14: `KamataBot` (Kamata, B2B company research, Web Bot Auth), `MapTheNetBot` (link graph, Web Bot Auth), `panscient` (Panscient, business and professional profiles), `DomainMetaDataBot` (arndt.ai, domain technology database), `Kaupr/` (B2B contact data), `Vercatus/` (AI visibility, Web Bot Auth; note its "identity probes" replay Googlebot, GPTBot and ClaudeBot user agents signed as Vercatus), `GrowthXBot`, `CitationTrackerBot`, `DocumentationAI-AgentScore` (docs agent-readiness scanner) and `agent-readiness-index` as `seo-bot`, along with `SERankingBacklinksBot` (SE Ranking; its documentation page returned 403); `INETDEX-BOT`, `image-meta.com` (ImageMetaBot and its heritrix string, image metadata index), `IsonSearchBot` (IsonAI, Web Bot Auth), `HiraxSearchBot`, `YepBot` (Ahrefs) and the pre-release `SearchBot/0.1 (independent search engine` as `search-crawler`; `FontScanBot` (font licence compliance) and `Assetnote` (attack-surface scanning under a Chrome/60 string) as `scanner`; `(personal certificate monitor)`, `HTML Proofer` and `Miravi-Reachability` as `monitoring`; `PubSub-revival` as `feed-reader`; `TANKbot` ("a crawler for TANK Neural") as `ai-crawler`; `Defuddle/` (on-demand HTML to Markdown, like markdown.new) as `agent`; `KagiTranslatePreview` as `ai-assistant`.

### Notes from the audit

- With the first three changes the week's filtered human count went from 8,748 to 5,998; the reference floor and sibling sharing take it to 5,405. The floor on its own moved 249 filtered requests from 237 pairs (Safari 17 and iOS 17 pool strings, plus ten Safari 18 and iOS 18 pairs that the 3-major Safari threshold now reaches across the 18-to-26 numbering jump), none of which had loaded an asset; sibling sharing accounted for the rest, mostly Edge 120/121 judged by the Chrome reference. The google.com-referred human count was unchanged at 449, and the surviving-pool section of the session audit is down to one group of 22 requests under a current Edge build.
- Still not curated: `SapientBot/1.0` (270 requests, six sites, replays `?utm_source=chatgpt.com` URLs, no public page), `QlyzeBot/1.0` (310 requests from one address; its bot page is empty), `rapblaze-linkresearch/1.0` (rapblaze.com is a consumer rap-video site that says nothing about a crawler), `CrolBot/0.1` (cloro.dev sells SERP and AI-answer scraping but does not name the bot), `dwnupd/1.0 (+https://example.com/bot)` (images only), `TernCrawler`, `DiffuseMind`, the NVIDIA PSIRT `NVIDIABOT` string, `Elseweb/0.1` and `spippbot/0.1` (pages empty or unreachable).
- The server's rate limiter answered 2,424 requests with 429 this week (716 addresses); 390 of them went to the iOS 13 pool and 260 to a stale Mac Chrome/120 string. The filter does not look at status codes, so a 429 to a browser-UA request still counts as a human page view until a detector demotes the pair.
- A 33-request, 30-address group of real-looking Chrome/157 sessions (full client hints, `Accept-Language`, `Referer: https://www.google.com/`) fetched `llms.txt` and `.md` URLs directly on afdocs.dev and agentreadingtest.com. It classifies as not-agent and human, which is the right default without more evidence.
- Claude Code builds 2.1.212 through 2.1.325 were seen; `X-Request-Id` appears on some requests from 2.1.310 onward. OpenCode, GitHub Copilot (`GitHubCopilotRuntime-WebFetch` and the VS Code Electron string), Claude Desktop, and ZCode all matched by name. One `Go-http-client/2.0` markdown fetcher on agentdocsspec.com carried Alibaba EagleEye tracing in its `Baggage` header.

## [0.7.0] - 2026-11-01

Based on an audit of October 24 to November 1, 2026 logs across twelve sites (72,451 requests, 3,397 signal entries). The 0.6.x changes held: OpenCode is named on both of its fingerprints, nothing reports Cursor, and the robots.txt trigger caught the Hetzner crawler that survived in October. The largest remaining gap was a crawler that `detectSpoofedBrowsers` could not see: 23 frozen early-2024 browser user agents (Chrome 120 to 130, Firefox 121 to 128, Safari and iOS 17.0 and 17.1) made 2,542 page requests from 2,537 residential addresses, one request each, with no asset load and a Referer on 99.6% of them that pointed at a page linking to the target (another of the audited sites, or a real inbound link such as a blog post, a LinkedIn share, or a Kagi result). Single-request pairs are exempt from the stale-version test, so all of it counted as `human` (a fifth of the week's human total) and put the linking hosts at the top of the referral sources. A second automation, a headless Chrome/146 from 193 addresses, replayed one fixed off-site referrer on every request including its stylesheet and script fetches.

### Changed

- **`detectSpoofedBrowsers` gained two triggers.** `uaPools` (default on) relaxes the request-count minimum for a user-agent string that a proxy pool spreads one request per address: a browser UA that is stale by the existing threshold, appears from at least `poolMinIps` (5) addresses of which 90% or more are single-request, never loaded an asset from any of them, and carried a Referer on at least `poolReferrerShare` (0.8) of its requests is demoted as a whole, same-site referrers included. Agent fetchers share the one-request-per-IP shape (ExaUser, ChatGPT-User, Claude Code) but run current browser versions and send no Referer (0 of 568 agent requests in the audit week; 11% for ChatGPT-User), so they do not match. The detector runs per site and the pool spread thin across twelve of them, which is why the default is five addresses rather than twenty: in the audit week a threshold of 20 reached 37% of the pool's requests, 10 reached 71%, 5 reached 83%, and every qualifying group down to three addresses was visibly the same crawler (same referrer hosts, same homepage-plus-trailing-slash pairs). `externalAssetReferrers` (default on) demotes any browser-UA pair that fetched a stylesheet, script, or font with an off-site referrer, regardless of assets or version; a browser's sub-resource requests carry the embedding page as referrer, never the site the visitor came from. Images are excluded because hotlinking produces that shape legitimately. The giveaway proves the referrer value fake for that UA string, so every pair on the site wearing the same UA that sent the same exact referrer URL is demoted with it: the Chrome/146 automation rendered pages from only 9 of its 193 addresses and fetched one page and one image from the rest. In the audit week the two triggers demoted most of the 2,542-request pool and all of the 619-request Chrome/146 session and nothing else of note; no legitimate (UA, referrer) group, including the google.com ones, contained a giveaway pair; the only other off-site sub-resource referrers were ten requests from one Mac Chrome string and three from a referrer-spam domain.
- **A browser user agent cut off before the browser token is `unknown`.** `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36`, the Macintosh and Windows variants, `Mozilla/5.0 (Macintosh) Safari/605`, and `Mozilla/5.0 Chrome/131.0` (619 requests from 31 addresses in the audit week, probing `.env`, `/api/keys`, `/actuator/env`, `/openapi.json`, and `/swagger.json`) previously classified `human`: isbot passes them, and with no version the stale-browser test had nothing to compare. They now join the bare `Mozilla/5.0` rule from 0.5.0, so `detectScanners` can reach them. The check runs after the curated bot list, so a self-identifying `(compatible; SomeBot/1.0) AppleWebKit/537.36` keeps its entry.
- `DEFAULT_PROBE_PATTERNS` gained exposed-LLM-proxy and API-discovery probes: `/v1/chat/completions`, `/v1/completions`, `/v1/models`, `/v1/embeddings`, `/v1/messages` (any version prefix), `/api/openai`, `/api/generate`, `/api/tags`, `/api/keys`, `/api/env`, `/api/config`, `/api/secrets`, `openapi.json`, `openapi.yaml`, `swagger.json`, `swagger.yaml`, `/swagger-ui`, `/api-docs`, `/v3/api-docs`. Path matches still count only on a 4xx answer, so a site that serves an API or publishes its schema never trips them. One scanner in the audit week sent the chat-completion POSTs under a bare `Mozilla/5.0` and the GETs under a spoofed `SemrushBot` string from a non-Semrush address; the POSTs were already caught by the write-method rule, the GETs were not and still are not, because curated bots are exempt from `detectScanners`.

### Added

- `SpoofedBrowserOptions.uaPools`, `poolMinIps`, `poolReferrerShare`, `externalAssetReferrers`.
- Bot database, from operator pages read on 2026-11-01: `AgenstryBot` (Agenstry, an index of public AI agents that cycles through `.well-known/agents.json`, `mcp.json`, `agent-card.json`, and the A2A variants, with Web Bot Auth signatures) and `agentcensus-crawler` as `ai-search`; `AnySearchUser` (AnySearch, user-initiated fetch, Web Bot Auth) as `ai-assistant`; `RiverBot` (River AI, "train and evaluate our AI models") and `KosoBot` (Koso, trains its classification model) as `ai-crawler`; `CorpusBot` (corpus.blog citation index), `ev-crawler` (Headline, a venture firm), and `TechLeadsBot` as `seo-bot`; `T2Bot`, `AskRobotsBot`, and `IBEROBot` as `search-crawler`; `ForestEngine` and `InternetData.io` (port and configuration scanners) as `scanner`.

### Notes from the audit

- Not curated, no public documentation found: `SapientBot/1.0` (Azure addresses, replays URLs with `?utm_source=chatgpt.com`), `TernCrawler/1.0` (Accept header lists office-document MIME types), `DiffuseMind/1.0` (runs the agentreadingtest task suite under two user agents from one AWS address). `catalog-scout/0.1` claims 402registry.com, whose documented crawler is `402registry-check/1.0`.
- The "html-first agent" signal result (228 entries from 223 addresses, one each, `Content-Length: 0` on GET, Referer set to the HTML page of the requested markdown, no `Accept-Language`, no client hints) is a second proxy-pool crawler fetching markdown alternates, not an interactive agent. It shares no addresses with the HTML pool above. Left as is pending a decision on the heuristic.
- A growing set of self-described one-off crawlers (`Firmenradar/0.5 (bounded company research)`, `domain-census/1.0 (research; one-request-per-domain)`, `craft-engine/0.1 (one person's research reader; slow, read-only)`; 26 distinct strings, a handful of requests each). Most land in `other-bot` through isbot; the ones without a bot-like word fall through to `human`.

## [0.6.2] - 2026-10-18

Based on the robots.txt requesters in the October 11 to 18 logs: 419 requests for `/robots.txt` arrived from browser user agents that the session passes still left as `human`. They came from 374 IP+UA pairs; 330 of those fetched `robots.txt` and nothing else, and 355 never loaded a static asset. The 19 pairs that did load assets were real sessions in which someone also opened `robots.txt`. The asset-less ones included two datacenter crawlers on current Chrome builds that faked a same-site referrer on every request (187 page views that the stale-version test could not touch) and three distributed robots.txt surveys rotating one frozen browser UA across 37 to 76 IPs each.

### Added

- `detectSpoofedBrowsers` gained a second trigger: a browser-UA pair that requested `/robots.txt` and never loaded a static asset is demoted to `spoofed-browser` regardless of browser version, referrers, or request count. No browser fetches the crawl-policy file on its own, and a person who types the URL in also renders pages. `SpoofedBrowserOptions.robotsFetchers` (default true) turns it off. Exported `ROBOTS_TXT_RE`.
- Bot database: `(Gort)`, a robots.txt survey that hides its token at the end of a 2014 Safari user agent (76 IPs in the audit week, one `robots.txt` request each), as `seo-bot`.

## [0.6.1] - 2026-10-18

### Added

- Bot database and `DEFAULT_KNOWN_AGENTS`: Google Antigravity (`Google-Jetski-Antigravity`, category `agent`). Confirmed by a controlled test on 2026-10-18: the user agent is the entire header set (no `Accept`, no `Accept-Language`), sent over HTTP/1.1 from Google's `rate-limited-proxy-*.google.com` range (`66.249.87.160/27`, in Google's published special-crawlers list), not from the user's IP. Previously `other-bot` in access logs via isbot, and "unidentified" in the signal classifier, where the missing `Accept` header defeats every heuristic.

## [0.6.0] - 2026-10-18

Based on an audit of a week of live traffic (October 11 to 18, 2026) across twelve sites, a controlled Cursor test, and a read of OpenCode's source. Two identities changed. The `Traceparent` + `B3` + markdown-first traffic that was "Cursor" from April and "traced proxy agent" from September is OpenCode: its webfetch tool hardcodes that Accept header, sent a generic Chrome/143 UA until 2026-08-19, and now self-identifies as `OpenCode-User`. And Cursor's own fetch, which runs on Exa, now arrives as `ExaUser/1.0`: the 2026-10-18 controlled test produced the September fingerprint (one request per page from rotating proxy IPs, Exa's Accept header, no-cache headers, no `Sec-Ch-Ua`) under that UA, with Web Bot Auth signatures and an unprompted `robots.txt` fetch. The confirmed Cursor fingerprint had zero hits in the week, and ExaUser was falling through to "Cursor (suspected)".

### Changed

- **Nothing is attributed to Cursor any more.** Cursor is one of possibly many clients behind `ExaUser`, which the bot database now routes to `ai-assistant` before the heuristics run (the same fix ExaSearchBot got in 0.3.0). Consequences: Cursor's traffic leaves the `agent` category; `cursorFetchHeuristic` is renamed `exaFetchHeuristic` and reports "Exa fetch (suspected)" with no company; the Accept-taxonomy entry for that header carries the same name; `CURSOR_ACCEPT_PREFIX` is renamed `EXA_FETCH_ACCEPT_PREFIX`. The old names remain as deprecated aliases.
- **`tracedProxyHeuristic` reports "OpenCode (suspected)"** when the Accept header is one of OpenCode's, and "traced proxy agent" otherwise. The Exa-Accept branch that returned "Cursor (suspected)" is gone.
- **`sentryBaggageHeuristic` reports "OpenCode (suspected)"** instead of "Cursor". The key co-occurred with OpenCode's Accept header and tracing headers in April 2026, OpenCode's desktop app ships Sentry, and Cursor's controlled tests have never produced Sentry headers. The key itself has not been matched to a project.
- **`detectDuplicateRequestAgents` no longer names Cursor by default.** The new default `DEFAULT_PROXY_AGENT` reports "proxy agent" / "proxy agent (suspected)" with no company. `CURSOR_PROXY_AGENT` is still exported (deprecated) for consumers who want the old labels via `proxyAgent`. `ProxyAgentConfig.company` is now `string | null`.

### Added

- `openCodeAcceptHeuristic`: matches any of the three Accept preference lists hardcoded in OpenCode's webfetch tool (`OPENCODE_ACCEPT_PREFIXES`), regardless of UA or tracing headers, and reports `OPENCODE_SUSPECTED`. Runs after `tracedProxyHeuristic`.
- `EXA_FETCH_NAME`, `OPENCODE_ACCEPT_PREFIXES`, `OPENCODE_SUSPECTED`, `DEFAULT_PROXY_AGENT`.
- `DEFAULT_KNOWN_AGENTS`: `OpenCode-User`, `Augment-WebFetch`.
- Bot database, agents: OpenCode (`OpenCode-User`), Augment Code (`Augment-WebFetch`), Vercel's `agent-browser`, `KiroServer` (only `Kiro-CLI` matched before), Qoder's China build (`qoderclicn/`).
- Bot database, AI: `ExaUser` and `OpenAI File Downloader` and QuillBot (ai-assistant); `ExaBot`, Gensparkbot, TalarionSearchBot, NagetBot, AgentDiscoveryIndex (ai-search); ElevenLabs Crawler, Amazon Bedrock Knowledge Base, Recraft image dataset, AbliterantBot, CMU ClueWeb Crawler, Sketch Engine SpiderLing, llmstxtcrawler (ai-crawler).
- Bot database, everything else seen at volume in the week: twenty-two independent search engines (ibou-search, ElamurBot, LoadedBot, FindgBot, TrellisBot, CGMSearchBot, AstianGOBot, interCrawlerBot, LanternBot, Naver's Yeti, generic Apache Nutch, Mwmbl, and others), lead-generation and marketing crawlers as `seo-bot` (SunriseTranscriptionReach, Moment Leads, HubSpot Crawler, Dataprovider.com, Pandalytics, Netcraft, Serpstat, AgentFitBot, and others), news aggregators and read-later apps as `feed-reader` (BriskBot, DaypopBot, Downread, Caterpillar, Instapaper, RSS Amplifier, `(RSS digest)`, and others), KakaoBot and Webex Teams as `social-preview`.
- Bot database, scanners: `wp2shell`, `PageBuilderCK-Scanner`, `HxC-Endpoint-Discovery`, `redirect-scanner`, `wildcat-threat-mcp`, and the user agent that is literally `http://<site>/wp-admin/install.php?step=1` (423 probes from one Cloudflare Workers egress IP in the audit week, previously `other-bot` via isbot).

### Notes from the audit

- `detectScanners` (0.5.0) and `detectSpoofedBrowsers` (0.4.0) held up: a 3,204-request backup-archive sweep (`*.zip`, six seconds, one AWS IP) was demoted to `scanner`, no fake-referrer session reached the referrer stats, and the spoofed-browser pass moved roughly 9,400 filtered requests out of `human`, mostly Tencent and China Unicom addresses with frozen early-2024 browser UAs.
- Known gaps, unchanged: a datacenter crawler that sends same-site referrers survives `detectSpoofedBrowsers` (it is exempted as navigation), and one running a current browser version is never stale enough to demote.
- New request headers: `X-Openai-Host-Hash` on GPTBot and OAI-SearchBot; Alibaba EagleEye `Baggage` on a Go-http-client markdown fetcher. Not used as heuristics yet.

## [0.5.0] - 2026-09-25

Based on a scanner session captured on 2026-09-18: one datacenter IP made 839 requests in 95 minutes, rotating through fifteen browser user agents and attaching a fake referrer (Reddit, Facebook, Google, Hacker News, Twitter, or a random search-engine or t.co URL) to each one. The probes themselves were dropped by the filter, but the rest of the session classified as `human` and put Reddit and Hacker News at the top of the site's referral sources. A review across five sites and eight days then found `.env` sweeps from Google Cloud addresses, an AI-agent credential harvester, a Next.js server-action RCE probe, a Joomla RCE probe with a self-identifying user agent, and CMS fingerprinters, plus one legitimate benchmark crawler that a first draft of the detector would have mislabelled.

### Added

- `detectScanners`: demotes every request an IP made within a window (default 15 minutes) of its vulnerability probes to the new `scanner` category, once it has sent a burst of at least `minProbes` (default 3) within that window. Takes the fake referrers out of `topReferrers` and the existence checks out of `topPaths`. IP+UA pairs that navigated with a same-site referrer, self-identifying bots (curated or isbot-detected), and attributed agents are never touched.
- `isProbeRequest`: the per-request probe test. A probe pattern in the path counts only on a 4xx answer, so a path the site really serves (`/wp-login.php` on WordPress, a downloadable `docker-compose.yml`) never counts. A probe pattern in the query string counts at any status. PROPFIND, TRACE, TRACK, and CONNECT count on any 4xx; POST, PUT, PATCH, and DELETE count on 404, 405, or 501. `ScannerOptions.isProbe` overrides it entirely.
- `DEFAULT_PROBE_PATTERNS` and `isProbePath`: path traversal in any encoding (`/../`, `/%2e%2e/`, `/%252e%252e/`, `/%2f../`, `/%2e./`, overlong UTF-8), absolute system paths, private keys, cloud credential files, AI coding agent credential stores (`.claude/`, `.codex/`, `.cursor/`, `.config/gcloud/`), config dumps (`serverless.yml`, `docker-compose.yaml`, `application.properties`, `appsettings.json`, `composer.json`, `package.json`), framework debug endpoints, PHP info and web-shell filenames, CMS fingerprints (`wlwmanifest.xml`, `joomla.xml`, plugin `readme.txt`), Next.js RSC endpoints, injection payloads (`${jndi:`, `union select`, `<script`, `XDEBUG_SESSION_START`), and backup archives. Patterns are anchored to filenames where a substring could match a blog slug (`phpinfo`, `xmlrpc`).
- `createFilter` gained `skipPatterns` (default `DEFAULT_PROBE_PATTERNS`), so the probes above are dropped from stats like the substring probes already were. Pass `skipPatterns: []` to count them instead.
- `isSameSiteReferrer(referrer, domain)`: host comparison with `www.` ignored. Used by `buildSessionProfiles`, `detectSpoofedBrowsers`, and `detectScanners`.
- Bot database: a `scanner` category with self-identifying scanners (zgrab, masscan, Nuclei, Nikto, sqlmap, WPScan, Nmap, CensysInspect, Expanse, LeakIX, gobuster, DirBuster, ffuf, feroxbuster, NetSystemsResearch, InternetMeasurement, Odin, GenomeCrawlerd) and observed one-offs (`crusader-worker`, `sppb-rce-poc`, `CMS-Security-Auditor`, `cve-` prefixed).
- `CATEGORY_SCANNER`, `SCANNER_NAME`, `DEFAULT_SCANNER_MIN_PROBES`, `DEFAULT_SCANNER_WINDOW_SECONDS`, `DEFAULT_SCANNER_CATEGORIES`, `PROBE_METHODS_ANY_4XX`, `PROBE_METHODS_MISSING`, `ScannerOptions`.
- `scanner` is in `DEFAULT_TOP_PATHS_SKIP_CATEGORIES`.

### Changed

- **Same-site referrers are now matched by host, not substring.** `buildSessionProfiles` and `detectSpoofedBrowsers` previously treated any referrer containing the domain as navigation within the site, so a spoofed `https://www.google.com/search?q=example.com` referrer (observed in the wild; Google has not sent query terms since 2011) counted as a real browser session.
- **A bare `Mozilla/5.0` (or `Mozilla/4.0`, with or without `(compatible)`) user agent is now `unknown`, not `other-bot`.** It carries no identity, and isbot's bot verdict was exempting a 256-request `.env` sweep from behavioural detection.
- The default filter now also skips requests matching `DEFAULT_PROBE_PATTERNS`, so daily totals drop slightly on sites that get scanned. Path traversal and system-path probes previously counted as content requests.

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

[0.5.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/agent-ecosystem/agent-traffic-classifier/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/agent-ecosystem/agent-traffic-classifier/releases/tag/v0.1.0
