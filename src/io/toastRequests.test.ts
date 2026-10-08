import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Capture } from '@/shared/types';
import { createToastRequests, TOAST_REQUESTS_LIMIT } from './toastRequests';

const capture = (url: string): Capture => ({
  url,
  title: url,
  site: '',
  author: '',
  published: '',
  description: '',
  coverUrl: '',
  markdown: null,
  textLength: 0,
  kind: 'link',
});

beforeEach(() => fakeBrowser.reset());

describe('页面提示的请求记录', () => {
  it('新建一个实例（模拟后台重启）后仍能按 id 取回同一份采集结果', async () => {
    await createToastRequests().put('r1', capture('https://a.example.com/'));
    expect((await createToastRequests().get('r1'))?.url).toBe('https://a.example.com/');
  });

  it(`最多保留 ${TOAST_REQUESTS_LIMIT} 条，超出丢最早的`, async () => {
    const store = createToastRequests();
    for (let i = 0; i <= TOAST_REQUESTS_LIMIT; i++) await store.put(`r${i}`, capture(`https://a.example.com/${i}`));
    expect(await store.get('r0')).toBeUndefined();
    expect((await store.get(`r${TOAST_REQUESTS_LIMIT}`))?.url).toBe(`https://a.example.com/${TOAST_REQUESTS_LIMIT}`);
  });
});
