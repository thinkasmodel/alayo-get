import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Capture, PendingSave } from '@/shared/types';
import { renderOptions, type LibraryHandle, type OptionsDeps } from './render';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Perm = 'granted' | 'prompt' | 'denied';

function fakeHandle(name: string, query: Perm, request: Perm = 'granted') {
  return {
    name,
    queryPermission: vi.fn(async () => query),
    requestPermission: vi.fn(async () => request),
  } satisfies LibraryHandle;
}

function pendingItems(n: number): PendingSave[] {
  return Array.from({ length: n }, (_, i) => {
    const capture: Capture = {
      url: `https://example.com/${i + 1}`,
      title: `待补存 ${i + 1}`,
      site: '',
      author: '',
      published: '',
      description: '',
      coverUrl: '',
      markdown: null,
      textLength: 0,
      kind: 'page',
    };
    return { capture, snapshot: false };
  });
}

function makeDeps(handle: LibraryHandle | undefined, pending: PendingSave[] = [], picked?: LibraryHandle | Error) {
  let stored = handle;
  const deps = {
    loadHandle: vi.fn(async () => stored),
    saveHandle: vi.fn(async (h: LibraryHandle) => {
      stored = h;
    }),
    pickDirectory: vi.fn(async () => {
      if (picked instanceof Error) throw picked;
      if (!picked) throw new Error('没准备选择结果');
      return picked;
    }),
    listPending: vi.fn(async () => pending),
    // 生产实现等 service worker 补写结束后回复实际补存条数；这里默认按队列全部补存成功回复。
    notifyGranted: vi.fn<OptionsDeps['notifyGranted']>(async () => ({ saved: pending.length })),
    platform: vi.fn(async () => 'mac' as const),
    shortcut: vi.fn(async () => '⌥⇧S'),
  } satisfies OptionsDeps;
  return deps;
}

async function mount(deps: OptionsDeps) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const page = await renderOptions(root, deps);
  const view = () => root.querySelector('.wrap')?.getAttribute('data-view');
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  return { root, page, view, button, text: () => root.textContent ?? '' };
}

afterEach(() => document.body.replaceChildren());

describe('选项页视图切换', () => {
  it('没有句柄 → 首次使用引导', async () => {
    const { view, text, button } = await mount(makeDeps(undefined));
    expect(view()).toBe('onboarding');
    expect(text()).toContain('把网页存成本地文件');
    expect(text()).toContain('选择剪藏库文件夹');
    expect(text()).not.toContain('在 Workbench 里把它设为监控目录');
    expect(text()).toContain('重启浏览器后，还要授权一次');
    expect(text()).toContain('保存方式');
    expect(text()).toContain('⌥⇧S');
    expect(button('选择文件夹…')).toBeDefined();
    expect(button('更换…')).toBeUndefined();
    expect(button('开始使用')?.disabled).toBe(true);
  });

  it('有句柄且已授权 → 设置，没有重新授权卡片', async () => {
    const { view, text, root } = await mount(makeDeps(fakeHandle('Alayo Get', 'granted')));
    expect(view()).toBe('settings');
    expect(text()).toContain('剪藏库');
    expect(root.querySelector('code')?.textContent).toBe('Alayo Get');
    expect(text()).not.toContain('需要重新授权剪藏库');
    expect(root.querySelector('#reauth')).toBeNull();
  });

  it('有句柄但权限不是 granted → 设置页顶部加重新授权卡片', async () => {
    const { view, text, root, button } = await mount(makeDeps(fakeHandle('Alayo Get', 'prompt')));
    expect(view()).toBe('reauth');
    expect(text()).toContain('需要重新授权剪藏库');
    expect(text()).toContain('Chrome 重启后收回了写入“Alayo Get”文件夹的权限。');
    expect(root.querySelector('.wrap')?.children[1]?.id).toBe('reauth');
    expect(button('授权…')).toBeDefined();
    expect(root.querySelector('.pend')).toBeNull(); // 队列为空时不列待补存
  });
});

describe('选择文件夹（注入的 showDirectoryPicker）', () => {
  it('选好后写句柄、发 library-granted，第 1 步打勾，"开始使用"可点并切到设置', async () => {
    const picked = fakeHandle('Alayo Get', 'granted');
    const deps = makeDeps(undefined, [], picked);
    const { button, root, text, view } = await mount(deps);
    button('选择文件夹…')?.click();
    await flush();
    expect(deps.pickDirectory).toHaveBeenCalledTimes(1);
    expect(deps.saveHandle).toHaveBeenCalledWith(picked);
    expect(deps.notifyGranted).toHaveBeenCalledTimes(1);
    expect(root.querySelector('code')?.textContent).toBe('Alayo Get');
    expect(button('更换…')).toBeDefined();
    expect(root.querySelector('#library .n-done')).not.toBeNull();
    expect(text()).toContain('已完成');
    const start = button('开始使用');
    expect(start?.disabled).toBe(false);
    start?.click();
    expect(view()).toBe('settings');
  });

  it('用户取消（AbortError）时界面不变', async () => {
    const abort = new Error('The user aborted a request.');
    abort.name = 'AbortError';
    const deps = makeDeps(undefined, [], abort);
    const { button, root } = await mount(deps);
    const before = root.innerHTML;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    button('选择文件夹…')?.click();
    await flush();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    expect(root.innerHTML).toBe(before);
    expect(deps.saveHandle).not.toHaveBeenCalled();
    expect(deps.notifyGranted).not.toHaveBeenCalled();
  });
});

describe('重新授权（注入的 requestPermission）', () => {
  it('granted：发 library-granted，卡片换成"已授权，补存了 N 条剪藏"', async () => {
    const handle = fakeHandle('Alayo Get', 'prompt', 'granted');
    const deps = makeDeps(handle, pendingItems(2));
    const { button, text } = await mount(deps);
    expect(text()).toContain('授权后会补存 2 条剪藏');
    button('授权…')?.click();
    await flush();
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(deps.notifyGranted).toHaveBeenCalledTimes(1);
    expect(text()).toContain('已授权，补存了 2 条剪藏');
    expect(text()).toContain('可以关掉这个页面，回去继续浏览。');
    expect(button('授权…')).toBeUndefined();
  });

  it('granted 后、补写结束前：显示"正在补存"，不提前说补存了（编排者补充）', async () => {
    const handle = fakeHandle('Alayo Get', 'prompt', 'granted');
    const deps = makeDeps(handle, pendingItems(3));
    let reply: (v: { saved: number }) => void = () => {};
    deps.notifyGranted.mockImplementation(() => new Promise((resolve) => (reply = resolve)));
    const { button, text } = await mount(deps);
    button('授权…')?.click();
    await flush();
    expect(text()).toContain('已授权，正在补存 3 条剪藏…');
    expect(text()).not.toContain('补存了');
    reply({ saved: 2 });
    await flush();
    expect(text()).toContain('已授权，补存了 2 条剪藏');
  });

  it('service worker 没有回复补写结果：只写"已授权"（编排者补充）', async () => {
    const deps = makeDeps(fakeHandle('Alayo Get', 'prompt', 'granted'), pendingItems(2));
    deps.notifyGranted.mockImplementation(async () => undefined);
    const { button, root } = await mount(deps);
    button('授权…')?.click();
    await flush();
    expect(root.querySelector('#reauth .stt')?.textContent).toBe('已授权');
  });

  it('granted 且队列为空：只写"已授权"', async () => {
    const deps = makeDeps(fakeHandle('Alayo Get', 'prompt', 'granted'), []);
    const { button, root } = await mount(deps);
    button('授权…')?.click();
    await flush();
    expect(root.querySelector('#reauth .stt')?.textContent).toBe('已授权');
  });

  it('denied：不发 library-granted，卡片里加一行提示，按钮还在', async () => {
    const deps = makeDeps(fakeHandle('Alayo Get', 'prompt', 'denied'), pendingItems(1));
    const { button, root, text } = await mount(deps);
    button('授权…')?.click();
    await flush();
    expect(deps.notifyGranted).not.toHaveBeenCalled();
    expect(root.querySelector('.denied')?.textContent).toBe('没有获得授权。可以再点一次“授权…”。');
    expect(text()).not.toContain('已授权');
    expect(button('授权…')).toBeDefined();
  });

  it('待补存超过 5 条：只列 5 条标题，再写"等 N 条"', async () => {
    const deps = makeDeps(fakeHandle('Alayo Get', 'prompt'), pendingItems(7));
    const { root, text } = await mount(deps);
    expect(text()).toContain('授权后会补存 7 条剪藏');
    const titles = [...root.querySelectorAll('.pi:not(.more)')].map((el) => el.textContent);
    expect(titles).toEqual(['待补存 1', '待补存 2', '待补存 3', '待补存 4', '待补存 5']);
    expect(root.querySelector('.pi.more')?.textContent).toBe('等 7 条');
  });

  it('#reauth 锚点把焦点放在"授权…"按钮上', async () => {
    const { page, button } = await mount(makeDeps(fakeHandle('Alayo Get', 'prompt')));
    page.applyAnchor('#reauth');
    expect(document.activeElement).toBe(button('授权…'));
  });
});

describe('面向通用用户：Workbench 只是可选小节（ALAG-6）', () => {
  const views = [
    ['首次设置', () => makeDeps(undefined), 'onboarding'],
    ['设置', () => makeDeps(fakeHandle('Alayo Get', 'granted')), 'settings'],
    ['设置（需要重新授权）', () => makeDeps(fakeHandle('Alayo Get', 'prompt'), pendingItems(1)), 'reauth'],
  ] as const;

  it.each(views)('%s：有且只有一个默认收起的 Workbench 小节', async (_name, deps, expected) => {
    const { root, view } = await mount(deps());
    expect(view()).toBe(expected);
    const sections = root.querySelectorAll('details.wb');
    expect(sections).toHaveLength(1);
    const details = sections[0] as HTMLDetailsElement;
    expect(details.hasAttribute('open')).toBe(false);
    const summary = details.querySelector('summary')?.textContent ?? '';
    expect(summary).toContain('配合 Alayo Workbench 使用');
    expect(summary).toContain('可选');
    const body = details.textContent ?? '';
    for (const s of ['新建一个空间', '加到现有空间', '加入监控目录', '来源有 1 个新文件']) expect(body).toContain(s);
  });

  it.each(views)('%s：Workbench 小节之外的文字不提 Workbench', async (_name, deps) => {
    const { root } = await mount(deps());
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelector('details.wb')?.remove();
    expect(clone.querySelector('details.wb')).toBeNull();
    expect(clone.textContent).not.toContain('Workbench');
  });

  it('首次设置页：标题、导语，步骤卡只剩选择文件夹与重启后再授权', async () => {
    const { root } = await mount(makeDeps(undefined));
    expect(root.querySelector('h1')?.textContent).toBe('把网页存成本地文件');
    expect(root.querySelector('.lead')?.textContent).toBe(
      'Alayo Get 把文章、X 帖子、摘录、图片和视频存成文件，放进你选的本地文件夹。文章是 Markdown 格式，任何编辑器或笔记工具都能直接打开。',
    );
    const steps = [...root.querySelectorAll('section.step .stt')].map((el) => el.firstChild?.textContent);
    expect(steps).toEqual(['选择剪藏库文件夹', '重启浏览器后，还要授权一次']);
  });

  it.each(views)('%s：保存方式第三行是右键菜单', async (_name, deps) => {
    const { root } = await mount(deps());
    const row = root.querySelectorAll('.keys .kr')[2];
    expect(row?.firstChild?.textContent).toBe('右键菜单');
    expect(row?.querySelector('span')?.textContent).toBe('当前页面、链接、图片、音视频，或选中的文字');
  });
});

describe('Workbench 小节的展开状态在重绘后保留（ALAG-6）', () => {
  const expand = (root: HTMLElement) => {
    const details = root.querySelector<HTMLDetailsElement>('details.wb');
    if (!details) throw new Error('没有 Workbench 小节');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    return details;
  };

  it('展开后选好文件夹、页面重绘，小节仍展开', async () => {
    const { root, button } = await mount(makeDeps(undefined, [], fakeHandle('Alayo Get', 'granted')));
    const before = expand(root);
    button('选择文件夹…')?.click();
    await flush();
    const after = root.querySelector<HTMLDetailsElement>('details.wb');
    expect(after).not.toBe(before); // 确实重绘了
    expect(button('更换…')).toBeDefined();
    expect(after?.open).toBe(true);
    expect(after?.hasAttribute('open')).toBe(true);
  });

  it('展开后点"开始使用"切到设置页，设置页的小节也展开', async () => {
    const { root, button, view } = await mount(makeDeps(undefined, [], fakeHandle('Alayo Get', 'granted')));
    button('选择文件夹…')?.click();
    await flush();
    expand(root);
    button('开始使用')?.click();
    expect(view()).toBe('settings');
    expect(root.querySelector<HTMLDetailsElement>('details.wb')?.open).toBe(true);
  });

  it('没展开时选好文件夹、页面重绘，小节仍收起', async () => {
    const { root, button } = await mount(makeDeps(undefined, [], fakeHandle('Alayo Get', 'granted')));
    const before = root.querySelector('details.wb');
    button('选择文件夹…')?.click();
    await flush();
    const after = root.querySelector<HTMLDetailsElement>('details.wb');
    expect(after).not.toBe(before);
    expect(after?.open).toBe(false);
    expect(after?.hasAttribute('open')).toBe(false);
  });

  // 浏览器的 toggle 事件是异步派发的：点开小节后、toggle 到达前，补存回复可能先触发重绘（codex review 第 1 轮）
  it('点开小节后 toggle 还没派发就重绘，小节仍展开', async () => {
    const { root, button } = await mount(makeDeps(undefined, [], fakeHandle('Alayo Get', 'granted')));
    root.querySelector<HTMLElement>('details.wb summary')?.click();
    button('选择文件夹…')?.click();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 0)); // 让旧节点的 toggle 派发完
    expect(root.querySelector<HTMLDetailsElement>('details.wb')?.open).toBe(true);
  });

  it('点收小节后 toggle 还没派发就重绘，小节仍收起', async () => {
    const { root, button } = await mount(makeDeps(undefined, [], fakeHandle('Alayo Get', 'granted')));
    expand(root);
    root.querySelector<HTMLElement>('details.wb summary')?.click();
    button('选择文件夹…')?.click();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector<HTMLDetailsElement>('details.wb')?.open).toBe(false);
  });

  it('展开后再收起，重绘后保持收起', async () => {
    const { root, button } = await mount(makeDeps(undefined, [], fakeHandle('Alayo Get', 'granted')));
    const details = expand(root);
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    button('选择文件夹…')?.click();
    await flush();
    expect(root.querySelector<HTMLDetailsElement>('details.wb')?.open).toBe(false);
  });
});
