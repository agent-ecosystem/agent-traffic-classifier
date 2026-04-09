import { describe, it, expect, vi } from 'vitest';
import {
  parseIpv4,
  parseCidr,
  matchesCidr,
  buildCidrIndex,
  createCloudProviderLookup,
  createCountryLookup,
  createIpLookup,
} from '../src/adapters/ip-ranges.js';

describe('parseIpv4', () => {
  it('parses a valid IPv4 address', () => {
    expect(parseIpv4('192.168.1.1')).toBe(((192 << 24) | (168 << 16) | (1 << 8) | 1) >>> 0);
  });

  it('parses 0.0.0.0', () => {
    expect(parseIpv4('0.0.0.0')).toBe(0);
  });

  it('parses 255.255.255.255', () => {
    expect(parseIpv4('255.255.255.255')).toBe(0xffffffff);
  });

  it('returns null for IPv6', () => {
    expect(parseIpv4('2001:db8::1')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseIpv4('not-an-ip')).toBeNull();
    expect(parseIpv4('256.1.1.1')).toBeNull();
    expect(parseIpv4('1.2.3')).toBeNull();
  });
});

describe('parseCidr', () => {
  it('parses a /24 CIDR', () => {
    const result = parseCidr('192.168.1.0/24');
    expect(result).not.toBeNull();
    expect(result!.mask).toBe(0xffffff00 >>> 0);
  });

  it('parses a /32 CIDR (single host)', () => {
    const result = parseCidr('10.0.0.1/32');
    expect(result).not.toBeNull();
    expect(result!.mask).toBe(0xffffffff);
  });

  it('parses a /0 CIDR (all addresses)', () => {
    const result = parseCidr('0.0.0.0/0');
    expect(result).not.toBeNull();
    expect(result!.mask).toBe(0);
    expect(result!.base).toBe(0);
  });

  it('normalizes base address to network boundary', () => {
    // 192.168.1.100/24 should normalize to 192.168.1.0/24
    const result = parseCidr('192.168.1.100/24');
    expect(result).not.toBeNull();
    expect(result!.base).toBe(parseIpv4('192.168.1.0'));
  });

  it('returns null for IPv6 CIDR', () => {
    expect(parseCidr('2001:db8::/32')).toBeNull();
  });
});

describe('matchesCidr', () => {
  it('matches IP within CIDR range', () => {
    const cidr = parseCidr('192.168.1.0/24')!;
    expect(matchesCidr(parseIpv4('192.168.1.50')!, cidr)).toBe(true);
    expect(matchesCidr(parseIpv4('192.168.1.0')!, cidr)).toBe(true);
    expect(matchesCidr(parseIpv4('192.168.1.255')!, cidr)).toBe(true);
  });

  it('does not match IP outside CIDR range', () => {
    const cidr = parseCidr('192.168.1.0/24')!;
    expect(matchesCidr(parseIpv4('192.168.2.1')!, cidr)).toBe(false);
    expect(matchesCidr(parseIpv4('10.0.0.1')!, cidr)).toBe(false);
  });

  it('works with /16 ranges', () => {
    const cidr = parseCidr('10.0.0.0/16')!;
    expect(matchesCidr(parseIpv4('10.0.255.255')!, cidr)).toBe(true);
    expect(matchesCidr(parseIpv4('10.1.0.0')!, cidr)).toBe(false);
  });

  it('works with /8 ranges', () => {
    const cidr = parseCidr('66.0.0.0/8')!;
    expect(matchesCidr(parseIpv4('66.249.79.1')!, cidr)).toBe(true);
    expect(matchesCidr(parseIpv4('67.0.0.1')!, cidr)).toBe(false);
  });
});

describe('buildCidrIndex', () => {
  it('builds an index and looks up IPs', () => {
    const lookup = buildCidrIndex([
      { cidr: '66.249.64.0/19', tag: 'google' },
      { cidr: '192.178.0.0/15', tag: 'google' },
      { cidr: '52.0.0.0/11', tag: 'aws' },
      { cidr: '104.16.0.0/13', tag: 'cloudflare' },
    ]);

    expect(lookup('66.249.79.1')).toBe('google');
    expect(lookup('192.178.5.10')).toBe('google');
    expect(lookup('52.10.20.30')).toBe('aws');
    expect(lookup('104.16.1.1')).toBe('cloudflare');
    expect(lookup('8.8.8.8')).toBeUndefined();
  });

  it('returns undefined for IPv6 addresses', () => {
    const lookup = buildCidrIndex([{ cidr: '10.0.0.0/8', tag: 'test' }]);
    expect(lookup('2001:db8::1')).toBeUndefined();
  });

  it('skips invalid CIDR entries', () => {
    const lookup = buildCidrIndex([
      { cidr: 'not-a-cidr', tag: 'bad' },
      { cidr: '10.0.0.0/8', tag: 'good' },
    ]);
    expect(lookup('10.1.2.3')).toBe('good');
  });

  it('returns first match when ranges overlap', () => {
    const lookup = buildCidrIndex([
      { cidr: '10.0.0.0/24', tag: 'narrow' },
      { cidr: '10.0.0.0/8', tag: 'wide' },
    ]);
    expect(lookup('10.0.0.5')).toBe('narrow');
    expect(lookup('10.1.0.5')).toBe('wide');
  });
});

describe('createCloudProviderLookup', () => {
  it('builds index from custom providers', async () => {
    const lookup = await createCloudProviderLookup({
      providers: [
        {
          name: 'test-cloud',
          fetch: async () => [
            { cidr: '10.0.0.0/8', tag: 'test-cloud' },
            { cidr: '172.16.0.0/12', tag: 'test-cloud' },
          ],
        },
      ],
    });
    expect(lookup('10.1.2.3')).toBe('test-cloud');
    expect(lookup('172.16.5.1')).toBe('test-cloud');
    expect(lookup('8.8.8.8')).toBeUndefined();
  });

  it('combines ranges from multiple providers', async () => {
    const lookup = await createCloudProviderLookup({
      providers: [
        { name: 'alpha', fetch: async () => [{ cidr: '10.0.0.0/8', tag: 'alpha' }] },
        { name: 'beta', fetch: async () => [{ cidr: '192.168.0.0/16', tag: 'beta' }] },
      ],
    });
    expect(lookup('10.1.2.3')).toBe('alpha');
    expect(lookup('192.168.1.1')).toBe('beta');
  });

  it('gracefully handles provider fetch failures', async () => {
    const lookup = await createCloudProviderLookup({
      providers: [
        {
          name: 'failing',
          fetch: async () => {
            throw new Error('network error');
          },
        },
        { name: 'working', fetch: async () => [{ cidr: '10.0.0.0/8', tag: 'working' }] },
      ],
    });
    // The working provider's ranges should still be available
    expect(lookup('10.1.2.3')).toBe('working');
  });

  it('returns empty lookup when all providers fail', async () => {
    const lookup = await createCloudProviderLookup({
      providers: [
        {
          name: 'broken',
          fetch: async () => {
            throw new Error('fail');
          },
        },
      ],
    });
    expect(lookup('10.1.2.3')).toBeUndefined();
  });
});

describe('createCountryLookup', () => {
  it('parses RIR delegation data for requested countries', async () => {
    // Simulate RIR delegation format: registry|CC|type|start|value|date|status
    const rirData = [
      '# Comment line',
      'apnic|CN|ipv4|1.0.0.0|256|20100101|allocated',
      'apnic|JP|ipv4|1.0.16.0|4096|20100101|allocated',
      'apnic|CN|ipv6|2001:200::|35|20100101|allocated',
      'apnic|CN|ipv4|223.255.254.0|512|20100101|allocated',
    ].join('\n');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => rirData,
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const lookup = await createCountryLookup(['CN'], { rirUrls: ['https://mock-rir/'] });
      // 1.0.0.0/256 = /24 (power of 2)
      expect(lookup('1.0.0.1')).toBe('CN');
      // JP entries should be excluded (only CN requested)
      expect(lookup('1.0.16.1')).toBeUndefined();
      // IPv6 lines should be skipped
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles non-power-of-2 allocations by splitting into CIDR blocks', async () => {
    // 768 addresses = 512 + 256 (not a power of 2)
    const rirData = 'apnic|CN|ipv4|10.0.0.0|768|20100101|allocated\n';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => rirData,
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const lookup = await createCountryLookup(['CN'], { rirUrls: ['https://mock-rir/'] });
      // 768 = 512 (/23) + 256 (/24)
      // First block: 10.0.0.0/23 covers 10.0.0.0 - 10.0.1.255
      expect(lookup('10.0.0.1')).toBe('CN');
      expect(lookup('10.0.1.255')).toBe('CN');
      // Second block: 10.0.2.0/24 covers 10.0.2.0 - 10.0.2.255
      expect(lookup('10.0.2.1')).toBe('CN');
      // Outside the allocation
      expect(lookup('10.0.3.1')).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles failed RIR fetch gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const lookup = await createCountryLookup(['CN'], { rirUrls: ['https://mock-rir/'] });
      expect(lookup('1.0.0.1')).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles RIR network errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);

    try {
      const lookup = await createCountryLookup(['CN'], { rirUrls: ['https://mock-rir/'] });
      expect(lookup('1.0.0.1')).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('normalizes country codes to uppercase', async () => {
    const rirData = 'apnic|CN|ipv4|10.0.0.0|256|20100101|allocated\n';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => rirData,
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      // Lowercase input should still match
      const lookup = await createCountryLookup(['cn'], { rirUrls: ['https://mock-rir/'] });
      expect(lookup('10.0.0.1')).toBe('CN');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips malformed RIR lines', async () => {
    const rirData = [
      'too|few|fields',
      '|CN|ipv4|10.0.0.0|256|20100101|allocated',
      'apnic|CN|ipv4|invalid-ip|256|20100101|allocated',
      'apnic|CN|ipv4|10.0.0.0|notanumber|20100101|allocated',
      'apnic|CN|ipv4|10.1.0.0|256|20100101|allocated',
    ].join('\n');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => rirData,
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const lookup = await createCountryLookup(['CN'], { rirUrls: ['https://mock-rir/'] });
      // Only the last valid line should produce a match
      expect(lookup('10.1.0.1')).toBe('CN');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createIpLookup', () => {
  it('combines cloud and country lookups', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'apnic|CN|ipv4|10.0.0.0|256|20100101|allocated\n',
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const lookup = await createIpLookup({
        cloudProviders: {
          providers: [
            { name: 'test', fetch: async () => [{ cidr: '192.168.0.0/16', tag: 'test-cloud' }] },
          ],
        },
        countries: ['CN'],
        countryOptions: { rirUrls: ['https://mock-rir/'] },
      });

      const cloudResult = lookup('192.168.1.1');
      expect(cloudResult.cloudProvider).toBe('test-cloud');

      const countryResult = lookup('10.0.0.1');
      expect(countryResult.country).toBe('CN');

      const noMatch = lookup('8.8.8.8');
      expect(noMatch.cloudProvider).toBeUndefined();
      expect(noMatch.country).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips cloud lookup when cloudProviders is false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'apnic|CN|ipv4|10.0.0.0|256|20100101|allocated\n',
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const lookup = await createIpLookup({
        cloudProviders: false,
        countries: ['CN'],
        countryOptions: { rirUrls: ['https://mock-rir/'] },
      });

      const result = lookup('10.0.0.1');
      expect(result.country).toBe('CN');
      expect(result.cloudProvider).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips country lookup when no countries specified', async () => {
    const lookup = await createIpLookup({
      cloudProviders: {
        providers: [{ name: 'test', fetch: async () => [{ cidr: '10.0.0.0/8', tag: 'test' }] }],
      },
      countries: [],
    });

    const result = lookup('10.1.2.3');
    expect(result.cloudProvider).toBe('test');
    expect(result.country).toBeUndefined();
  });

  it('returns empty info when no options match', async () => {
    const lookup = await createIpLookup({
      cloudProviders: {
        providers: [{ name: 'test', fetch: async () => [] }],
      },
    });

    const result = lookup('8.8.8.8');
    expect(result).toEqual({});
  });
});
