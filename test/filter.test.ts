import { describe, it, expect } from 'vitest';
import { createFilter } from '../src/filter.js';
import type { LogEntry } from '../src/types.js';

function makeEntry(path: string): LogEntry {
  return {
    ip: '1.2.3.4',
    timestamp: 1775250151,
    method: 'GET',
    path,
    status: 200,
    size: 100,
    referrer: null,
    userAgent: 'Mozilla/5.0',
  };
}

describe('createFilter', () => {
  const shouldSkip = createFilter();

  describe('static asset extensions', () => {
    it('skips .js files', () => expect(shouldSkip(makeEntry('/app.js'))).toBe(true));
    it('skips .css files', () => expect(shouldSkip(makeEntry('/style.css'))).toBe(true));
    it('skips .png files', () => expect(shouldSkip(makeEntry('/image.png'))).toBe(true));
    it('skips .jpg files', () => expect(shouldSkip(makeEntry('/photo.jpg'))).toBe(true));
    it('skips .woff2 files', () => expect(shouldSkip(makeEntry('/font.woff2'))).toBe(true));
    it('skips .svg files', () => expect(shouldSkip(makeEntry('/icon.svg'))).toBe(true));
    it('skips .json files', () => expect(shouldSkip(makeEntry('/data.json'))).toBe(true));
    it('skips .xml files', () => expect(shouldSkip(makeEntry('/feed.xml'))).toBe(true));
    it('does not skip .md files', () => expect(shouldSkip(makeEntry('/README.md'))).toBe(false));
  });

  describe('skip paths', () => {
    it('skips WordPress probes', () => {
      expect(shouldSkip(makeEntry('/xmlrpc.php'))).toBe(true);
      expect(shouldSkip(makeEntry('/wp-login.php'))).toBe(true);
    });

    it('skips favicons', () => {
      expect(shouldSkip(makeEntry('/favicon.ico'))).toBe(true);
      expect(shouldSkip(makeEntry('/apple-touch-icon.png'))).toBe(true);
    });

    it('skips robots.txt', () => expect(shouldSkip(makeEntry('/robots.txt'))).toBe(true));
    it('skips sitemap.xml', () => expect(shouldSkip(makeEntry('/sitemap.xml'))).toBe(true));
  });

  describe('skip prefixes', () => {
    it('skips /assets/ paths', () => expect(shouldSkip(makeEntry('/assets/main.js'))).toBe(true));
    it('skips /static/ paths', () => expect(shouldSkip(makeEntry('/static/img.png'))).toBe(true));
    it('skips /wp-admin/ paths', () =>
      expect(shouldSkip(makeEntry('/wp-admin/index.php'))).toBe(true));
    it('skips /.well-known/ paths', () =>
      expect(shouldSkip(makeEntry('/.well-known/acme-challenge/abc'))).toBe(true));
  });

  describe('scanner probe extensions', () => {
    it('skips .php files', () => expect(shouldSkip(makeEntry('/info.php'))).toBe(true));
    it('skips .sql files', () => expect(shouldSkip(makeEntry('/dump.sql'))).toBe(true));
    it('skips .bak files', () => expect(shouldSkip(makeEntry('/wp-config.php.bak'))).toBe(true));
    it('skips .log files', () =>
      expect(shouldSkip(makeEntry('/storage/logs/laravel.log'))).toBe(true));
    it('skips .key files', () => expect(shouldSkip(makeEntry('/server.key'))).toBe(true));
    it('skips .pem files', () => expect(shouldSkip(makeEntry('/private.pem'))).toBe(true));
  });

  describe('default skip substrings', () => {
    it('skips .env anywhere in path', () => {
      expect(shouldSkip(makeEntry('/.env'))).toBe(true);
      expect(shouldSkip(makeEntry('/.env.local'))).toBe(true);
      expect(shouldSkip(makeEntry('/config/.env.production'))).toBe(true);
    });

    it('skips wp-admin under any prefix', () => {
      expect(shouldSkip(makeEntry('/wp-admin/install.php'))).toBe(true);
      expect(shouldSkip(makeEntry('/wp/wp-admin/install.php'))).toBe(true);
      expect(shouldSkip(makeEntry('/blog/wp-admin/install.php'))).toBe(true);
      expect(shouldSkip(makeEntry('/old/wp-admin/install.php'))).toBe(true);
    });

    it('skips phpinfo under any prefix', () => {
      expect(shouldSkip(makeEntry('/phpinfo.php'))).toBe(true);
      expect(shouldSkip(makeEntry('/phpinfo/'))).toBe(true);
      expect(shouldSkip(makeEntry('/test/phpinfo.php'))).toBe(true);
      expect(shouldSkip(makeEntry('/_profiler/phpinfo/'))).toBe(true);
    });

    it('skips credential probes', () => {
      expect(shouldSkip(makeEntry('/.git/config'))).toBe(true);
      expect(shouldSkip(makeEntry('/dev/.git/config'))).toBe(true);
      expect(shouldSkip(makeEntry('/.ssh/id_rsa'))).toBe(true);
      expect(shouldSkip(makeEntry('/.aws/credentials'))).toBe(true);
    });

    it('skips xmlrpc under any prefix', () => {
      expect(shouldSkip(makeEntry('/xmlrpc.php'))).toBe(true);
      expect(shouldSkip(makeEntry('//xmlrpc.php?rsd'))).toBe(true);
    });

    it('skips path traversal probes', () => {
      expect(shouldSkip(makeEntry('/etc/passwd'))).toBe(true);
      expect(shouldSkip(makeEntry('/@fs/etc/passwd/?raw??'))).toBe(true);
    });

    it('skips framework debug probes', () => {
      expect(shouldSkip(makeEntry('/_profiler/open'))).toBe(true);
      expect(shouldSkip(makeEntry('/_environment/'))).toBe(true);
      expect(shouldSkip(makeEntry('/webroot/index.php/_environment'))).toBe(true);
    });
  });

  describe('content pages pass through', () => {
    it('allows /', () => expect(shouldSkip(makeEntry('/'))).toBe(false));
    it('allows /about/', () => expect(shouldSkip(makeEntry('/about/'))).toBe(false));
    it('allows /blog/my-post/', () => expect(shouldSkip(makeEntry('/blog/my-post/'))).toBe(false));
    it('allows /contact', () => expect(shouldSkip(makeEntry('/contact'))).toBe(false));
    it('allows /llms.txt', () => expect(shouldSkip(makeEntry('/llms.txt'))).toBe(false));
    it('allows /README.md', () => expect(shouldSkip(makeEntry('/README.md'))).toBe(false));
  });

  describe('custom options', () => {
    it('accepts custom skipSubstrings', () => {
      const filter = createFilter({ skipSubstrings: ['-nonexistent-'] });
      expect(filter(makeEntry('/test-nonexistent-path'))).toBe(true);
      expect(filter(makeEntry('/real-page/'))).toBe(false);
    });

    it('accepts custom siteSkipPaths', () => {
      const filter = createFilter({ siteSkipPaths: ['/api/'] });
      expect(filter(makeEntry('/api/data'))).toBe(true);
      expect(filter(makeEntry('/about/'))).toBe(false);
    });

    it('accepts custom skipExtensions', () => {
      const filter = createFilter({ skipExtensions: /\.custom$/i });
      expect(filter(makeEntry('/file.custom'))).toBe(true);
      // Default extensions no longer apply when overridden
      expect(filter(makeEntry('/app.js'))).toBe(false);
    });
  });
});
