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
