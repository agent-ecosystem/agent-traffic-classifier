import { describe, it, expect } from 'vitest';
import { parseIpv4, parseCidr, matchesCidr, buildCidrIndex } from '../src/adapters/ip-ranges.js';

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
