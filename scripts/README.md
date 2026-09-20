# Pattern audit scripts

The classifier's defaults drift as new agents, crawlers, and fetch frameworks appear. These scripts run real logs through the current build and show what the defaults miss, so the bot database and signal heuristics can be updated from evidence rather than memory.

They are not part of the published package and have no dependencies beyond Node and a built `dist/`.

## Gather logs

Copy a week or so of logs from your server into a directory with this layout. Nothing in this repo assumes a particular host, path, or set of domains.

```
<log-dir>/
  access/
    <site-a>/access.log
    <site-a>/access.log.2026-09-18
    <site-a>/access.log.2026-09-17.gz
    <site-b>/access.log
  signals/
    agent-signals-2026-09-18.jsonl
    agent-signals-2026-09-19.jsonl
```

- `access/` holds Apache Combined Log Format files, one subdirectory per site. Gzipped rotations are read as-is.
- `signals/` holds the JSONL written by the agent signal tracker shim (one object per line with `timestamp`, `domain`, `ip`, `method`, `path`, `trigger`, `headers`). Skip this directory if you only have access logs.

Keep the directory out of the repo. It is raw traffic data.

## Run

```
npm run build
node scripts/audit-access-logs.mjs <log-dir>
node scripts/audit-signal-logs.mjs <log-dir>
```

Both print to stdout; redirect to a file for anything more than a day of logs.

## Read the access-log report

The report starts with request counts per category, then the sections where uncategorized traffic hides:

- **other-bot** is the isbot fallback. Each distinct UA here is a candidate for `src/defaults/bots.json`. Sort out which category it belongs to from the UA's own description or product URL. High request counts with all requests skipped by the filter are usually feed readers or scanners.
- **human, non-Mozilla UA** is where self-identifying clients that isbot does not know end up: new coding agents, desktop apps, SDK fetchers. Anything with a product name and version here is worth a look.
- **human, Mozilla UA with a product URL or "compatible;" token** catches bots that impersonate a browser but still declare themselves.
- **programmatic** shows which substring matched each client, so you can spot a generic library UA that is actually one product.

Pass `--all` to also list every curated match by category, which is useful for checking that a new pattern did not steal traffic from an existing one (for example a `-User` assistant UA matching a `Bot` crawler pattern).

## Read the signal-log report

The report starts with trigger counts and a list of non-standard request headers with how often each appeared. New headers are the fastest way to find a new fetch framework (tracing headers, request IDs, signature headers).

Then one section per classifier result, each listing distinct User-Agent and Accept combinations with counts, IPs, domains, triggers, and any non-standard headers:

- **unidentified** entries hit an agent trigger but matched no heuristic. A repeated UA/Accept combination here is a new fingerprint. If the UA self-identifies, it belongs in `bots.json`; if it is a generic browser UA, the Accept header and extra headers are what to encode in `src/defaults/agents.ts`.
- **NOT-AGENT** is worth a skim for self-identifying agents the bot database does not know, since those fall through when their request did not carry an agent trigger.
- Named sections show what each heuristic is catching. Check that a heuristic's section does not contain a self-identifying crawler; if it does, the crawler needs a `bots.json` entry so the bot database excludes it before the heuristics run.

## Confirming an attribution

A pattern seen in the wild only tells you a fetcher exists, not who runs it. To attribute a fingerprint to a specific product, fetch a quiet site (one with no other content-negotiation traffic) from that product at a noted time, then look for the matching signal entries in that window. Compare the full header set, not just the UA, and repeat for each way the product can reach the web (direct URL fetch, web search, agent mode) since they may use different backends.
