import { describe, expect, it } from 'vitest';

describe('jsdom 环境', () => {
  it('页面一侧有 DOM', () => {
    expect(typeof document).toBe('object');
  });
});
