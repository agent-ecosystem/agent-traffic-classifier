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
      const result = classify('Screaming Frog SEO Spider/17.2');
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
