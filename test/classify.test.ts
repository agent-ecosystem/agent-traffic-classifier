import { describe, it, expect } from 'vitest';
import { createClassifier, defaultBotDb } from '../src/classify.js';

describe('createClassifier', () => {
  const classify = createClassifier();

  describe('bot database matching', () => {
    it('classifies GPTBot as ai-crawler', () => {
      const result = classify('Mozilla/5.0 GPTBot/1.0');
      expect(result.category).toBe('ai-crawler');
      expect(result.botName).toBe('GPTBot');
      expect(result.botCompany).toBe('OpenAI');
    });

    it('classifies ChatGPT-User as ai-assistant', () => {
      const result = classify('Mozilla/5.0 ChatGPT-User/1.0');
      expect(result.category).toBe('ai-assistant');
      expect(result.botName).toBe('ChatGPT-User');
    });

    it('classifies OAI-SearchBot as ai-search', () => {
      const result = classify('Mozilla/5.0 OAI-SearchBot/1.0');
      expect(result.category).toBe('ai-search');
      expect(result.botName).toBe('OAI-SearchBot');
    });

    it('classifies ClaudeBot as ai-crawler', () => {
      const result = classify('ClaudeBot/1.0');
      expect(result.category).toBe('ai-crawler');
      expect(result.botName).toBe('ClaudeBot');
      expect(result.botCompany).toBe('Anthropic');
    });

    it('classifies Googlebot as search-crawler', () => {
      const result = classify(
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      );
      expect(result.category).toBe('search-crawler');
      expect(result.botName).toBe('Googlebot');
    });

    it('classifies AhrefsBot as seo-bot', () => {
      const result = classify('Mozilla/5.0 (compatible; AhrefsBot/7.0)');
      expect(result.category).toBe('seo-bot');
      expect(result.botName).toBe('AhrefsBot');
    });

    it('classifies UptimeRobot as monitoring', () => {
      const result = classify('UptimeRobot/2.0');
      expect(result.category).toBe('monitoring');
      expect(result.botName).toBe('UptimeRobot');
    });

    it('classifies Twitterbot as social-preview', () => {
      const result = classify('Twitterbot/1.0');
      expect(result.category).toBe('social-preview');
      expect(result.botName).toBe('Twitterbot');
    });

    it('classifies GitHub Copilot (Code/) as agent', () => {
      const result = classify('Mozilla/5.0 Code/1.90.0 (Windows; x64) AppleWebKit/537.36');
      expect(result.category).toBe('agent');
      expect(result.botName).toBe('GitHub Copilot');
    });

    it('classifies GoogleAgent-URLContext as ai-assistant', () => {
      const result = classify('GoogleAgent-URLContext/1.0');
      expect(result.category).toBe('ai-assistant');
      expect(result.botName).toBe('GoogleAgent-URLContext');
      expect(result.botCompany).toBe('Google');
    });

    it('classifies ModelContextProtocol as agent', () => {
      const result = classify('ModelContextProtocol/1.0 (Automate; +https://example.com)');
      expect(result.category).toBe('agent');
      expect(result.botName).toBe('MCP Client');
    });

    it('classifies JarvisSearch as ai-search', () => {
      const result = classify('JarvisSearch-Crawler/0.1 (https://example.com)');
      expect(result.category).toBe('ai-search');
      expect(result.botName).toBe('JarvisSearch');
    });

    it('classifies Mastodon as social-preview', () => {
      const result = classify('Mastodon/4.5.8 (https://mastodon.social)');
      expect(result.category).toBe('social-preview');
      expect(result.botName).toBe('Mastodon');
    });

    it('classifies WhatsApp as social-preview', () => {
      const result = classify('WhatsApp/2.23.20.0');
      expect(result.category).toBe('social-preview');
      expect(result.botName).toBe('WhatsApp');
    });

    it('classifies HackerNews app as feed-reader', () => {
      const result = classify('HackerNews/1536 CFNetwork/1568.200.51 Darwin/24.1.0');
      expect(result.category).toBe('feed-reader');
      expect(result.botName).toBe('HackerNews App');
    });

    it('classifies FreshRSS as feed-reader', () => {
      const result = classify('FreshRSS/1.28.1 (Linux; https://freshrss.org)');
      expect(result.category).toBe('feed-reader');
      expect(result.botName).toBe('FreshRSS');
    });

    it('classifies Claude Code (versioned UA) as agent', () => {
      const result = classify('Claude-User (claude-code/2.1.92; +https://support.anthropic.com/)');
      expect(result.category).toBe('agent');
      expect(result.botName).toBe('Claude Code');
      expect(result.botCompany).toBe('Anthropic');
    });

    it('classifies Kiro-CLI as agent', () => {
      const result = classify('Kiro-CLI');
      expect(result.category).toBe('agent');
      expect(result.botName).toBe('Kiro');
      expect(result.botCompany).toBe('Amazon');
    });

    it('classifies Flipboard as feed-reader', () => {
      const result = classify(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.11; rv:49.0) Gecko/20100101 Firefox/49.0 (FlipboardProxy/1.2)',
      );
      expect(result.category).toBe('feed-reader');
      expect(result.botName).toBe('Flipboard');
    });

    it('classifies Lemmy as social-preview', () => {
      const result = classify('Lemmy/0.19.17; +https://example.com');
      expect(result.category).toBe('social-preview');
      expect(result.botName).toBe('Lemmy');
    });
  });

  describe('patterns added from September 2026 traffic', () => {
    it('classifies bare Claude-User (Claude.ai user fetch) as ai-assistant, not Claude Code', () => {
      const result = classify(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +claude-user@anthropic.com)',
      );
      expect(result.category).toBe('ai-assistant');
      expect(result.botName).toBe('Claude-User');
      expect(result.botCompany).toBe('Anthropic');
    });

    it('classifies Claude-SearchBot as ai-search (not ClaudeBot)', () => {
      const result = classify(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +claudebot@anthropic.com)',
      );
      expect(result.category).toBe('ai-search');
      expect(result.botName).toBe('Claude-SearchBot');
    });

    it('classifies Perplexity-User as ai-assistant (not PerplexityBot)', () => {
      const result = classify(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexitybot)',
      );
      expect(result.category).toBe('ai-assistant');
      expect(result.botName).toBe('Perplexity-User');
    });

    it('classifies GitHub Copilot runtime WebFetch as agent', () => {
      const result = classify('GitHubCopilotRuntime-WebFetch');
      expect(result.category).toBe('agent');
      expect(result.botName).toBe('GitHub Copilot');
    });

    it('classifies grok-agent as agent', () => {
      const result = classify('Mozilla/5.0 (compatible; grok-agent/1.0; +https://x.ai)');
      expect(result.category).toBe('agent');
      expect(result.botName).toBe('Grok Agent');
      expect(result.botCompany).toBe('xAI');
    });

    it('classifies ZCode and Qoder CLIs as agents', () => {
      expect(classify('ZCode-WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)').botName).toBe(
        'ZCode',
      );
      expect(classify('qodercli/1.1.51 (+https://qoder.com)').botName).toBe('Qoder CLI');
      expect(classify('qodercli/1.1.51 (+https://qoder.com)').category).toBe('agent');
    });

    it('classifies the Claude desktop app embedded browser as agent', () => {
      const result = classify(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.2553.0 Chrome/152.0.7977.76 Safari/537.36',
      );
      expect(result.category).toBe('agent');
      expect(result.botName).toBe('Claude Desktop');
    });

    it('classifies ExaSearchBot as ai-search', () => {
      const result = classify(
        'Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)',
      );
      expect(result.category).toBe('ai-search');
      expect(result.botCompany).toBe('Exa');
    });

    it('classifies SSI-Nutch as ai-crawler', () => {
      const result = classify(
        'SSI-Nutch/1.23 (SSI broad web crawler; https://ssi.inc/; adi@ssi.inc)',
      );
      expect(result.category).toBe('ai-crawler');
      expect(result.botCompany).toBe('Safe Superintelligence');
    });

    it('classifies Amazon Quick on-behalf-of fetches as ai-assistant', () => {
      const result = classify('amazon-Quick-on-behalf-of-1266b92d');
      expect(result.category).toBe('ai-assistant');
      expect(result.botName).toBe('Amazon Quick');
    });

    it('classifies BuiltWith as seo-bot (previously fell through to human)', () => {
      const result = classify(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; BuiltWith/1.4; rb.gy/xprgqj) Chrome/124.0.0.0 Safari/537.36',
      );
      expect(result.category).toBe('seo-bot');
    });

    it('classifies WebPageTest agents as monitoring', () => {
      const result = classify(
        'Mozilla/5.0 (Linux; Android 8.1.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36 PTST/260802.202201',
      );
      expect(result.category).toBe('monitoring');
      expect(result.botName).toBe('WebPageTest');
    });

    it('classifies fediverse link fetchers as social-preview', () => {
      expect(classify('Misskey/2025.4.7 (https://example.social/)').category).toBe(
        'social-preview',
      );
      expect(
        classify('Akkoma 3.20.0; https://example.social <admin@example.social>; Bot').category,
      ).toBe('social-preview');
      expect(
        classify('Catodon/4.6.0-alpha.8+cat.nightly (http.rb/5.3.1; +https://example.social/)')
          .category,
      ).toBe('social-preview');
    });

    it('classifies Zapier, Inoreader and Reeder as feed-reader', () => {
      expect(classify('Zapier').category).toBe('feed-reader');
      expect(
        classify('Inoreader/1.0 (+http://www.inoreader.com/feed-fetcher; 3 subscribers; )')
          .category,
      ).toBe('feed-reader');
      expect(classify('Reeder/5050102 CFNetwork/3860.700.2 Darwin/25.6.0').category).toBe(
        'feed-reader',
      );
      expect(classify('feeeed/37 CFNetwork/3860.600.12 Darwin/25.5.0').category).toBe(
        'feed-reader',
      );
    });

    it('classifies Scrapy, PhantomJS and Dalvik as programmatic', () => {
      expect(classify('Scrapy/2.17.0 (+https://scrapy.org)').category).toBe('programmatic');
      expect(
        classify(
          'Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.0.0 Safari/538.1',
        ).category,
      ).toBe('programmatic');
      expect(
        classify('Dalvik/2.1.0 (Linux; U; Android 9.0; ZTE BA520 Build/MRA58K)').category,
      ).toBe('programmatic');
    });
  });

  describe('programmatic clients', () => {
    it('classifies curl', () => {
      const result = classify('curl/7.68.0');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('curl');
    });

    it('classifies python-requests', () => {
      const result = classify('python-requests/2.28.0');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('python-requests');
    });

    it('classifies axios', () => {
      const result = classify('axios/1.4.0');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('axios');
    });

    it('classifies Go-http-client', () => {
      const result = classify('Go-http-client/2.0');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('Go-http-client');
    });

    it('classifies newspaper', () => {
      const result = classify('newspaper/0.2.8');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('newspaper');
    });

    it('classifies undici', () => {
      const result = classify('undici');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('undici');
    });

    it('classifies trafilatura', () => {
      const result = classify('trafilatura/2.0.0 (+https://github.com/adbar/trafilatura)');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('trafilatura');
    });

    it('classifies http.rb', () => {
      const result = classify('http.rb/5.1.1');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('http.rb');
    });

    it('classifies http.rb with Mastodon as social-preview (bot list wins)', () => {
      const result = classify('http.rb/5.1.1 (Mastodon/4.5.8; +https://mastodon.social/)');
      expect(result.category).toBe('social-preview');
      expect(result.botName).toBe('Mastodon');
    });

    it('classifies exact-match "node"', () => {
      const result = classify('node');
      expect(result.category).toBe('programmatic');
      expect(result.botName).toBe('node');
    });

    it('does not classify "nodejs-app" as exact-match "node"', () => {
      // "node" as a substring is handled by programmatic, but "nodejs-app" is not "node" exactly
      // However, the substring list doesn't include "node" either, so this should fall through
      const result = classify('nodejs-app/1.0');
      // This isn't in the programmatic list as a substring, so it should go to isbot or human
      expect(result.category).not.toBe('programmatic');
    });
  });

  describe('isbot fallback', () => {
    it('catches bots not in our curated list via isbot', () => {
      const result = classify(
        'Mozilla/5.0 (compatible; SpiderLing; +https://www.sketchengine.eu/crawler/)',
      );
      expect(result.category).toBe('other-bot');
    });
  });

  describe('human fallback', () => {
    it('classifies normal browser UA as human', () => {
      const result = classify(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
      expect(result.category).toBe('human');
      expect(result.botName).toBeNull();
      expect(result.botCompany).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('classifies null/empty UA as unknown', () => {
      expect(classify('').category).toBe('unknown');
      expect(classify('-').category).toBe('unknown');
    });

    it('respects bot list priority (Applebot-Extended before Applebot)', () => {
      const extResult = classify('Applebot-Extended/1.0');
      expect(extResult.category).toBe('ai-crawler');
      expect(extResult.botName).toBe('Applebot-Extended');

      const baseResult = classify('Applebot/1.0');
      expect(baseResult.category).toBe('search-crawler');
      expect(baseResult.botName).toBe('Applebot');
    });
  });

  describe('custom options', () => {
    it('accepts custom bot entries', () => {
      const custom = createClassifier({
        bots: [{ pattern: 'MyBot', name: 'MyBot', company: 'Me', category: 'agent' }],
      });
      expect(custom('MyBot/1.0').category).toBe('agent');
      expect(custom('MyBot/1.0').botName).toBe('MyBot');
      // Default bots no longer match since we replaced the list
      expect(custom('GPTBot/1.0').category).not.toBe('ai-crawler');
    });

    it('accepts custom programmatic clients', () => {
      const custom = createClassifier({ programmaticClients: ['my-cli'] });
      expect(custom('my-cli/1.0').category).toBe('programmatic');
    });

    it('accepts custom exact programmatic clients', () => {
      const custom = createClassifier({ exactProgrammaticClients: ['myapp'] });
      expect(custom('myapp').category).toBe('programmatic');
    });
  });
});

describe('defaultBotDb', () => {
  it('has categories and bots', () => {
    expect(defaultBotDb.categories).toBeDefined();
    expect(defaultBotDb.bots).toBeInstanceOf(Array);
    expect(defaultBotDb.bots.length).toBeGreaterThan(0);
  });

  it('does not contain the afdocs entry', () => {
    const afdocs = defaultBotDb.bots.find((b) => b.pattern === 'afdocs/');
    expect(afdocs).toBeUndefined();
  });

  it('does not contain the internal-tool category', () => {
    expect(defaultBotDb.categories).not.toHaveProperty('internal-tool');
  });
});
