import { describe, expect, it } from 'vitest';

describe('node 环境', () => {
  it('service worker 一侧没有 DOM', () => {
    expect(typeof document).toBe('undefined');
  });
});
