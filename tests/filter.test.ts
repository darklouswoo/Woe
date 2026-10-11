import { describe, it, expect } from '@jest/globals';
import {
  extractFilterTags,
  evaluateFilter,
  hasFilterTags
} from '../src/plugins/filter';
import { FilterConfig, PluginContext } from '../src/plugins/types';


function createMockContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    userId: 1,
    now: new Date().toISOString(),
    message: {
      id: 1,
      appId: 1,
      title: 'Test Message',
      priority: 5,
      content: 'Test content',
      extras: {}
    },
    ...overrides
  };
}

describe('extractFilterTags', () => {
  it('should return empty arrays when no filter tags in extras', () => {
    const ctx = createMockContext({
      message: { id: 1, appId: 1, content: 'test', extras: {} }
    });

    const result = extractFilterTags(ctx);

    expect(result.tags).toEqual([]);
  });

  it('should extract tags from woe::filter::tags', () => {
    const ctx = createMockContext({
      message: {
        id: 1,
        appId: 1,
        content: 'test',
        extras: {
          'woe::filter::tags': ['alert', 'critical', 'webhook']
        }
      }
    });

    const result = extractFilterTags(ctx);

    expect(result.tags).toEqual(['alert', 'critical', 'webhook']);
  });

  it('should ignore invalid tag values', () => {
    const ctx = createMockContext({
      message: {
        id: 1,
        appId: 1,
        content: 'test',
        extras: {
          'woe::filter::tags': ['valid', 123, null, 'another']
        }
      }
    });

    const result = extractFilterTags(ctx);

    expect(result.tags).toEqual(['valid', 'another']);
  });
});

describe('hasFilterTags', () => {
  it('should return false for undefined extras', () => {
    expect(hasFilterTags(undefined)).toBe(false);
  });

  it('should return false for empty extras', () => {
    expect(hasFilterTags({})).toBe(false);
  });

  it('should return true when woe::filter::tags exists', () => {
    expect(hasFilterTags({ 'woe::filter::tags': ['alert'] })).toBe(true);
  });

  it('should return false for unrelated extras', () => {
    expect(hasFilterTags({ 'client::display': {} })).toBe(false);
  });
});

describe('evaluateFilter', () => {
  it('should allow message when no filter configured', () => {
    const ctx = createMockContext();
    const result = evaluateFilter(undefined, ctx);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('No filter configured');
  });

  describe('tags filtering', () => {
    it('should allow when message has matching tag', () => {
      const filter: FilterConfig = { tags: ['alert', 'critical'] };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          content: 'test',
          extras: {
            'woe::filter::tags': ['alert']
          }
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(true);
    });

    it('should allow when any tag matches', () => {
      const filter: FilterConfig = { tags: ['alert', 'critical'] };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          content: 'test',
          extras: {
            'woe::filter::tags': ['critical', 'info']
          }
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(true);
    });

    it('should deny when no tags match', () => {
      const filter: FilterConfig = { tags: ['alert'] };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          content: 'test',
          extras: {
            'woe::filter::tags': ['info', 'debug']
          }
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tags mismatch');
    });

    it('should deny when message has no tags', () => {
      const filter: FilterConfig = { tags: ['alert'] };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          content: 'test',
          extras: {}
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tags mismatch');
    });

    it('should deny when plugin has tags config but message has no tags', () => {


      const filter: FilterConfig = { tags: ['webhook', 'alert', 'critical'] };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          content: 'Test message without tags',
          extras: {}
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tags mismatch');
    });

    it('should allow all messages when filter has no tags', () => {
      const filter: FilterConfig = {};
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          content: 'test',
          extras: { 'woe::filter::tags': ['anything'] }
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(true);
    });
  });

  describe('priority filtering', () => {
    it('should allow when message priority >= minPriority', () => {
      const filter: FilterConfig = { minPriority: 5 };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          priority: 8,
          content: 'test'
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(true);
    });

    it('should deny when message priority < minPriority', () => {
      const filter: FilterConfig = { minPriority: 5 };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          priority: 3,
          content: 'test'
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Priority too low');
    });

    it('should allow all when filter has no minPriority', () => {
      const filter: FilterConfig = { tags: ['alert'] };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          priority: 0,
          content: 'test'
        }
      });

      const result = evaluateFilter(filter, ctx);


      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tags');
    });
  });

  describe('combined filtering', () => {
    it('should pass when all conditions match', () => {
      const filter: FilterConfig = {
        tags: ['alert'],
        minPriority: 5
      };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          priority: 8,
          content: 'test',
          extras: {
            'woe::filter::tags': ['alert']
          }
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('All conditions matched');
    });

    it('should fail fast on first mismatch', () => {
      const filter: FilterConfig = {
        tags: ['alert'],
        minPriority: 10
      };
      const ctx = createMockContext({
        message: {
          id: 1,
          appId: 1,
          priority: 5,
          content: 'test',
          extras: {
            'woe::filter::tags': ['info']
          }
        }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tags mismatch');
    });
  });

  describe('error handling', () => {
    it('should fail-close on evaluation error', () => {
      const filter: FilterConfig = { tags: ['alert'] };

      const ctx = createMockContext();

      Object.defineProperty(ctx.message!, 'extras', {
        get: () => { throw new Error('Test error'); }
      });

      const result = evaluateFilter(filter, ctx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Filter evaluation error');
    });
  });
});
