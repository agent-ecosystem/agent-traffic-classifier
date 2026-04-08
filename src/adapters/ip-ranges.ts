import type { IpInfo, IpLookup } from '../types.js';

// --- IPv4 CIDR matching (pure bit math, no dependencies) ---

/** A precomputed CIDR entry for fast matching: base IP as 32-bit int + bitmask. */
export interface CidrEntry {
  base: number;
  mask: number;
}

/** Parse an IPv4 address string to a 32-bit unsigned integer. Returns null for non-IPv4. */
export function parseIpv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  // Convert to unsigned 32-bit
  return result >>> 0;
}

/** Parse a CIDR string "1.2.3.0/24" into a precomputed CidrEntry. Returns null for non-IPv4. */
export function parseCidr(cidr: string): CidrEntry | null {
  const [ipStr, prefixStr] = cidr.split('/');
  const base = parseIpv4(ipStr);
  if (base === null) return null;
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

/** Check whether an IPv4 integer falls within a precomputed CIDR entry. */
export function matchesCidr(ip: number, entry: CidrEntry): boolean {
  return (ip & entry.mask) >>> 0 === entry.base;
}

// --- Tagged CIDR index (maps IP → label) ---

interface TaggedRange {
  entry: CidrEntry;
  tag: string;
}

/**
 * Build an index from a list of (cidr, tag) pairs.
 * Returns a lookup function: ipv4 string → tag | undefined.
 */
export function buildCidrIndex(
  ranges: Array<{ cidr: string; tag: string }>,
): (ip: string) => string | undefined {
  const entries: TaggedRange[] = [];
  for (const { cidr, tag } of ranges) {
    const parsed = parseCidr(cidr);
    if (parsed) entries.push({ entry: parsed, tag });
  }

  return (ip: string): string | undefined => {
    const ipNum = parseIpv4(ip);
    if (ipNum === null) return undefined; // IPv6 or invalid — not matched
    for (const { entry, tag } of entries) {
      if (matchesCidr(ipNum, entry)) return tag;
    }
    return undefined;
  };
}

// --- Cloud provider IP range fetching ---

/** Fetch Google's published IP ranges (goog.json + cloud.json). */
async function fetchGoogleRanges(): Promise<Array<{ cidr: string; tag: string }>> {
  const ranges: Array<{ cidr: string; tag: string }> = [];

  // Google corporate/services (Googlebot, Google DNS, etc.)
  const googResp = await fetch('https://www.gstatic.com/ipranges/goog.json');
  if (googResp.ok) {
    const data = (await googResp.json()) as { prefixes: Array<{ ipv4Prefix?: string }> };
    for (const p of data.prefixes) {
      if (p.ipv4Prefix) ranges.push({ cidr: p.ipv4Prefix, tag: 'google' });
    }
  }

  // Google Cloud Platform
  const cloudResp = await fetch('https://www.gstatic.com/ipranges/cloud.json');
  if (cloudResp.ok) {
    const data = (await cloudResp.json()) as { prefixes: Array<{ ipv4Prefix?: string }> };
    for (const p of data.prefixes) {
      if (p.ipv4Prefix) ranges.push({ cidr: p.ipv4Prefix, tag: 'google' });
    }
  }

  return ranges;
}

/** Fetch AWS published IP ranges (AMAZON service superset only). */
async function fetchAwsRanges(): Promise<Array<{ cidr: string; tag: string }>> {
  const resp = await fetch('https://ip-ranges.amazonaws.com/ip-ranges.json');
  if (!resp.ok) return [];

  const data = (await resp.json()) as { prefixes: Array<{ ip_prefix: string; service: string }> };
  const ranges: Array<{ cidr: string; tag: string }> = [];
  // AMAZON service is the superset of all AWS ranges
  for (const p of data.prefixes) {
    if (p.service === 'AMAZON') {
      ranges.push({ cidr: p.ip_prefix, tag: 'aws' });
    }
  }
  return ranges;
}

/** Fetch Cloudflare's published IP ranges. */
async function fetchCloudflareRanges(): Promise<Array<{ cidr: string; tag: string }>> {
  const resp = await fetch('https://www.cloudflare.com/ips-v4/');
  if (!resp.ok) return [];

  const text = await resp.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((cidr) => ({ cidr, tag: 'cloudflare' }));
}

export interface CloudProviderLookupOptions {
  /** Override the fetch functions for testing or custom providers. */
  providers?: Array<{ name: string; fetch: () => Promise<Array<{ cidr: string; tag: string }>> }>;
}

/**
 * Create a cloud provider IP lookup.
 * Fetches published ranges from Google, AWS, and Cloudflare at init time.
 * Returns a sync function: ipv4 string → provider name | undefined.
 */
export async function createCloudProviderLookup(
  options?: CloudProviderLookupOptions,
): Promise<(ip: string) => string | undefined> {
  const providers = options?.providers ?? [
    { name: 'google', fetch: fetchGoogleRanges },
    { name: 'aws', fetch: fetchAwsRanges },
    { name: 'cloudflare', fetch: fetchCloudflareRanges },
  ];

  const allRanges: Array<{ cidr: string; tag: string }> = [];
  for (const provider of providers) {
    try {
      const ranges = await provider.fetch();
      allRanges.push(...ranges);
    } catch {
      // Skip providers that fail to fetch — partial data is better than none
    }
  }

  return buildCidrIndex(allRanges);
}

// --- Country lookup from RIR delegation data ---

/**
 * RIR delegation file URLs. Each RIR publishes allocations for its region.
 * We fetch from all five to cover global IP space.
 */
const RIR_URLS = [
  'https://ftp.apnic.net/stats/apnic/delegated-apnic-latest',
  'https://ftp.ripe.net/ripe/stats/delegated-ripencc-latest',
  'https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest',
  'https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-latest',
  'https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-latest',
];

/**
 * Parse RIR delegation data for specific countries.
 * RIR format: registry|CC|type|start|value|date|status
 * For IPv4, value is the number of addresses (e.g., 256 = /24).
 */
function parseRirDelegation(
  text: string,
  countries: Set<string>,
): Array<{ cidr: string; tag: string }> {
  const ranges: Array<{ cidr: string; tag: string }> = [];

  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.startsWith(' ')) continue;
    const parts = line.split('|');
    // registry|CC|type|start|value|date|status
    if (parts.length < 5) continue;
    const [, cc, type, start, valueStr] = parts;
    if (type !== 'ipv4') continue;
    if (!countries.has(cc)) continue;

    const count = parseInt(valueStr, 10);
    if (isNaN(count) || count <= 0) continue;

    // Convert address count to prefix length: count = 2^(32-prefix)
    const prefix = 32 - Math.log2(count);
    // Only emit if count is a power of 2 (clean CIDR boundary)
    if (Number.isInteger(prefix)) {
      ranges.push({ cidr: `${start}/${prefix}`, tag: cc });
    } else {
      // Non-power-of-2 allocations: split into largest power-of-2 blocks
      let remaining = count;
      let currentIp = parseIpv4(start);
      if (currentIp === null) continue;

      while (remaining > 0) {
        // Find the largest power-of-2 block that fits
        const blockBits = Math.floor(Math.log2(remaining));
        const blockSize = 1 << blockBits;
        const blockPrefix = 32 - blockBits;
        const a = (currentIp >>> 24) & 0xff;
        const b = (currentIp >>> 16) & 0xff;
        const c = (currentIp >>> 8) & 0xff;
        const d = currentIp & 0xff;
        ranges.push({ cidr: `${a}.${b}.${c}.${d}/${blockPrefix}`, tag: cc });
        currentIp = (currentIp + blockSize) >>> 0;
        remaining -= blockSize;
      }
    }
  }

  return ranges;
}

export interface CountryLookupOptions {
  /** RIR delegation file URLs to fetch. Defaults to all five RIRs. */
  rirUrls?: string[];
}

/**
 * Create a country IP lookup for specific country codes.
 * Fetches RIR delegation data and builds a CIDR index for the requested countries.
 *
 * Example: createCountryLookup(["CN"]) fetches all five RIR files but only
 * indexes Chinese IP allocations, keeping memory usage low.
 */
export async function createCountryLookup(
  countries: string[],
  options?: CountryLookupOptions,
): Promise<(ip: string) => string | undefined> {
  const countrySet = new Set(countries.map((c) => c.toUpperCase()));
  const urls = options?.rirUrls ?? RIR_URLS;

  const allRanges: Array<{ cidr: string; tag: string }> = [];

  // Fetch all RIR files in parallel
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) return [];
      const text = await resp.text();
      return parseRirDelegation(text, countrySet);
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allRanges.push(...result.value);
    }
  }

  return buildCidrIndex(allRanges);
}

// --- Convenience composer ---

export interface IpLookupOptions {
  /** Enable cloud provider detection. Default: true. */
  cloudProviders?: boolean | CloudProviderLookupOptions;
  /** Country codes to detect. Default: none (no country lookup). */
  countries?: string[];
  /** Country lookup options. */
  countryOptions?: CountryLookupOptions;
}

/**
 * Create a combined IP lookup that checks both cloud provider and country.
 * Async initialization; returns a sync IpLookup function.
 *
 * Example:
 *   const ipLookup = await createIpLookup({ countries: ["CN"] });
 *   ipLookup("117.143.4.8") // → { country: "CN" }
 *   ipLookup("66.249.79.1") // → { cloudProvider: "google" }
 */
export async function createIpLookup(options?: IpLookupOptions): Promise<IpLookup> {
  const doCloud = options?.cloudProviders !== false;
  const countries = options?.countries ?? [];

  // Initialize lookups in parallel
  const [cloudLookup, countryLookup] = await Promise.all([
    doCloud
      ? createCloudProviderLookup(
          typeof options?.cloudProviders === 'object' ? options.cloudProviders : undefined,
        )
      : Promise.resolve(undefined),
    countries.length > 0
      ? createCountryLookup(countries, options?.countryOptions)
      : Promise.resolve(undefined),
  ]);

  return (ip: string): IpInfo => {
    const info: IpInfo = {};
    if (cloudLookup) {
      const provider = cloudLookup(ip);
      if (provider) info.cloudProvider = provider;
    }
    if (countryLookup) {
      const country = countryLookup(ip);
      if (country) info.country = country;
    }
    return info;
  };
}
