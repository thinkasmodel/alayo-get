import { describe, expect, it } from 'vitest';
import alchain from '../../../tests/fixtures/x/thread-alchainhust.html?raw';
import naval1 from '../../../tests/fixtures/x/thread-naval-1.html?raw';
import naval2 from '../../../tests/fixtures/x/thread-naval-2.html?raw';
import naval3 from '../../../tests/fixtures/x/thread-naval-3.html?raw';
import naval4 from '../../../tests/fixtures/x/thread-naval-4.html?raw';
import videoP4n from '../../../tests/fixtures/x/video-p4nthera.html?raw';
import videoViktor from '../../../tests/fixtures/x/video-viktoroddy.html?raw';
import { classifyCell, listCells, parsePost } from './cells';
import { Accumulator, collectThread, X_MAX_MS } from './collect';
import type { XCell } from './cells';
import { loadFixture, snapshotDriver } from './testkit';

const NAVAL_FOCAL = '1002103360646823936';
const navalDocs = () => [naval1, naval2, naval3, naval4].map(loadFixture);

/** 快照里帖子 id 的顺序。 */
function postIds(doc: Document): string[] {
  return listCells(doc).flatMap((c) => {
    const k = classifyCell(c);
    return k.kind === 'post' ? [k.id] : [];
  });
}

describe('collectThread：naval 作者串（快照 1 → 2 → 点击后 3 → 4）', () => {
  it('41 条，顺序与快照一致，不含别人的帖子和 naval 在别人下面的回复，按钮点 1 次，完整', async () => {
    const docs = navalDocs();
    const driver = snapshotDriver(docs);
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(result).not.toBeNull();
    if (!result) return;
    const ids = result.posts.map((p) => p.id);

    expect(ids).toHaveLength(41);
    expect(ids[0]).toBe('1002103360646823936');
    expect(ids[40]).toBe('1129483486081966080');
    expect(new Set(ids).size).toBe(41);
    expect(result.posts.every((p) => p.handle === 'naval')).toBe(true);
    expect(ids).not.toContain('1002943376801423361');
    expect(result.posts.map((p) => p.textMd).join('\n')).not.toContain('Sure, please do.');

    // 顺序与快照 3、4 中出现的顺序一致
    for (const doc of [docs[2], docs[3]]) {
      const inSnap = postIds(doc as Document).filter((id) => ids.includes(id));
      expect(inSnap.length).toBeGreaterThan(0);
      expect(inSnap).toEqual(ids.filter((id) => inSnap.includes(id)));
    }

    expect(driver.clicks).toHaveLength(1);
    expect(driver.clicks[0]?.textContent).toContain('显示回复');
    expect(result.partial).toBeNull();
    expect(result.form).toBe('thread');
    expect(driver.restored).toBe(1);
    expect(driver.annotations).toBeGreaterThan(0);
  });

  it('maxPosts = 20：存前 20 条，limit: true', async () => {
    const result = await collectThread(snapshotDriver(navalDocs()), NAVAL_FOCAL, { maxPosts: 20 });
    expect(result?.posts).toHaveLength(20);
    expect(result?.posts[0]?.id).toBe(NAVAL_FOCAL);
    expect(result?.partial).toEqual({ limit: true, timeout: false, truncated: 0 });
  });

  it('假时钟在第 2 步后越过 15 秒：timeout: true，已采到的按顺序保留', async () => {
    const docs = navalDocs();
    const driver = snapshotDriver(docs, {
      onStep: (d, step) => {
        if (step === 2) d.clock = X_MAX_MS + 1;
      },
    });
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(result?.partial).toEqual({ limit: false, timeout: true, truncated: 0 });
    const ids = result?.posts.map((p) => p.id) ?? [];
    // 快照 1、2 里焦点帖之后、按钮之前的 naval 帖子
    const snap2 = postIds(docs[1] as Document);
    const expected = [...new Set([...postIds(docs[0] as Document), ...snap2.slice(0, snap2.indexOf('1002107808202960896') + 1)])];
    expect(ids).toEqual(expected);
    expect(ids).toHaveLength(31);
    expect(driver.restored).toBe(1);
  });
});

describe('collectThread：点开“显示回复”后等展开完成再判定（codex review 第 1 轮）', () => {
  it('展开响应慢（点击后 8 次 wait 才出现快照 3）：仍是 41 条，partial 为 null', async () => {
    const driver = snapshotDriver(navalDocs(), { clickDelayWaits: 8 });
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(result?.posts).toHaveLength(41);
    expect(result?.posts[40]?.id).toBe('1129483486081966080');
    expect(result?.partial).toBeNull();
    expect(driver.clicks).toHaveLength(1);
  });

  it('点击无效（快照不变、按钮一直在）：timeout: true，已采到的 31 条保留', async () => {
    const docs = navalDocs();
    const driver = snapshotDriver(docs, { clickNoop: true });
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(result?.partial).toEqual({ limit: false, timeout: true, truncated: 0 });
    expect(result?.posts).toHaveLength(31);
    expect(result?.posts.at(-1)?.id).toBe('1002107808202960896');
    expect(driver.clicks).toHaveLength(1);
    expect(driver.restored).toBe(1);
  });
});

describe('collectThread：站内切页后尽快停（codex review 第 3 轮）', () => {
  it('第 2 步后 navigatedAway 为真：timeout: true，保留已采到的帖子，restore 1 次', async () => {
    const driver = snapshotDriver(navalDocs(), {
      onStep: (d, step) => {
        if (step === 2) d.away = true;
      },
    });
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(result?.partial).toEqual({ limit: false, timeout: true, truncated: 0 });
    expect(result?.posts).toHaveLength(31);
    expect(result?.posts[0]?.id).toBe(NAVAL_FOCAL);
    expect(driver.restored).toBe(1);
  });

  it('开始前就已切页：返回 null，不滚动，restore 1 次', async () => {
    const driver = snapshotDriver(navalDocs());
    driver.away = true;
    expect(await collectThread(driver, NAVAL_FOCAL)).toBeNull();
    expect(driver.index).toBe(0);
    expect(driver.restored).toBe(1);
  });
});

describe('collectThread：骨架还在加载时不按“到底且空闲”结束（codex review 第 3 轮）', () => {
  const VIKTOR_FOCAL = '2107279715195392141';
  const VIKTOR_SELF = '2107282370500182194';
  /** viktoroddy 样本里作者自回复那条去掉 User-Name，变成骨架 */
  const skeletonDoc = () => {
    const doc = loadFixture(videoViktor);
    for (const a of doc.querySelectorAll('article[data-testid="tweet"]')) {
      if (a.getAttribute('data-alayo-x')?.includes(VIKTOR_SELF)) a.querySelectorAll('[data-testid="User-Name"]').forEach((u) => u.remove());
    }
    return doc;
  };

  it('焦点帖后面是骨架，2 秒后变成作者自己的帖子：2 条，partial 为 null', async () => {
    const skel = skeletonDoc();
    const full = loadFixture(videoViktor);
    expect(listCells(skel).map((c) => classifyCell(c).kind).slice(0, 3)).toEqual(['post', 'separator', 'skeleton']);
    const driver = snapshotDriver([skel]);
    driver.cells = () => listCells(driver.clock >= 2_000 ? full : skel);
    const result = await collectThread(driver, VIKTOR_FOCAL);
    expect(result?.posts.map((p) => p.id)).toEqual([VIKTOR_FOCAL, VIKTOR_SELF]);
    expect(result?.partial).toBeNull();
  });

  it('骨架一直不消失：timeout: true', async () => {
    const driver = snapshotDriver([skeletonDoc()]);
    const result = await collectThread(driver, VIKTOR_FOCAL);
    expect(result?.partial).toEqual({ limit: false, timeout: true, truncated: 0 });
    expect(result?.posts.map((p) => p.id)).toEqual([VIKTOR_FOCAL]);
  });
});

describe('collectThread：作者串中间夹着骨架时不判完整（codex review 第 4 轮）', () => {
  const VIKTOR_FOCAL = '2107279715195392141';
  const VIKTOR_SELF = '2107282370500182194';
  const MIDDLE = '2107280000000000001';
  /** viktoroddy 派生：焦点帖 → 骨架（或作者的新帖 MIDDLE）→ 作者帖 → 他人帖 */
  const derived = (skeleton: boolean) => {
    const doc = loadFixture(videoViktor);
    const cells = listCells(doc);
    const self = cells.find((c) => {
      const k = classifyCell(c);
      return k.kind === 'post' && k.id === VIKTOR_SELF;
    });
    if (!self) throw new Error('样本里没有作者自回复');
    const middle = self.cloneNode(true) as Element;
    for (const a of middle.querySelectorAll('a[href*="/status/"]')) a.setAttribute('href', (a.getAttribute('href') ?? '').replace(VIKTOR_SELF, MIDDLE));
    const art = middle.querySelector('article[data-testid="tweet"]');
    art?.setAttribute('data-alayo-x', (art.getAttribute('data-alayo-x') ?? '').replace(VIKTOR_SELF, MIDDLE));
    if (skeleton) middle.querySelectorAll('[data-testid="User-Name"]').forEach((u) => u.remove());
    (cells[0] as Element).after(middle);
    return doc;
  };

  it('骨架一直在：timeout: true', async () => {
    const skel = derived(true);
    expect(listCells(skel).map((c) => classifyCell(c).kind).slice(0, 5)).toEqual(['post', 'skeleton', 'separator', 'post', 'separator']);
    const result = await collectThread(snapshotDriver([skel]), VIKTOR_FOCAL);
    expect(result?.partial).toEqual({ limit: false, timeout: true, truncated: 0 });
  });

  it('2 秒后骨架换成作者帖：结果包含它，partial 为 null', async () => {
    const skel = derived(true);
    const full = derived(false);
    const driver = snapshotDriver([skel]);
    driver.cells = () => listCells(driver.clock >= 2_000 ? full : skel);
    const result = await collectThread(driver, VIKTOR_FOCAL);
    expect(result?.posts.map((p) => p.id)).toEqual([VIKTOR_FOCAL, MIDDLE, VIKTOR_SELF]);
    expect(result?.partial).toBeNull();
  });
});

describe('collectThread：骨架预检查不越过“显示回复”按钮（codex review 第 5 轮）', () => {
  it('naval 快照 2 的按钮之后、第一条别人的回复之前有个一直在的骨架：仍先点按钮，41 条，partial 为 null', async () => {
    const docs = navalDocs();
    const snap2 = docs[1] as Document;
    const cells = listCells(snap2);
    const button = cells.find((c) => classifyCell(c).kind === 'button');
    const khemaridh = cells.find((c) => {
      const k = classifyCell(c);
      return k.kind === 'post' && k.handle === 'khemaridh';
    });
    if (!button || !khemaridh) throw new Error('快照 2 结构不符');
    const skeleton = khemaridh.cloneNode(true) as Element;
    skeleton.querySelectorAll('[data-testid="User-Name"]').forEach((u) => u.remove());
    khemaridh.before(skeleton);
    const kinds = listCells(snap2).map((c) => classifyCell(c).kind);
    const at = kinds.indexOf('button');
    expect(kinds.slice(at - 1, at + 4)).toEqual(['post', 'button', 'separator', 'skeleton', 'post']);

    const driver = snapshotDriver(docs);
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(driver.clicks).toHaveLength(1);
    expect(result?.posts).toHaveLength(41);
    expect(result?.posts[40]?.id).toBe('1129483486081966080');
    expect(result?.partial).toBeNull();
  });
});

describe('collectThread：作者串内部的按钮按 DOM 顺序处理（codex review 第 6 轮）', () => {
  // 从 naval 样本里取 cell 拼合成快照：A1..A3 是 naval 连续三条，OTHER 是 @khemaridh 的回复
  const n3 = () => listCells(loadFixture(naval3));
  const byId = (cells: Element[], id: string) =>
    cells.find((c) => {
      const k = classifyCell(c);
      return k.kind === 'post' && k.id === id;
    }) as Element;
  const A1 = '1002103497725173760';
  const A2 = '1002103559276478464';
  const A3 = '1002103627387813888';
  const OTHER = '1002873481942523904';
  type Part = 'A1' | 'A2' | 'A3' | 'OTHER' | 'BUTTON' | 'SKEL';
  function synth(parts: Part[]): Document {
    const src = n3();
    const n2cells = listCells(loadFixture(naval2));
    const button = n2cells.find((c) => classifyCell(c).kind === 'button') as Element;
    const doc = document.implementation.createHTMLDocument('');
    const main = doc.createElement('main');
    doc.body.append(main);
    for (const p of parts) {
      let el: Element;
      if (p === 'BUTTON') el = button;
      else if (p === 'SKEL') {
        el = byId(src, A2).cloneNode(true) as Element;
        el.querySelectorAll('[data-testid="User-Name"]').forEach((u) => u.remove());
      } else el = byId(src, { A1, A2, A3, OTHER }[p]);
      main.append(doc.importNode(el, true));
    }
    return doc;
  }
  const kinds = (doc: Document) => listCells(doc).map((c) => classifyCell(c).kind);

  it('A1 → 按钮 → A3 → 他人帖：点按钮；点开后 A1 → A2 → A3 → 他人帖，3 条，partial 为 null', async () => {
    const before = synth(['A1', 'BUTTON', 'A3', 'OTHER']);
    expect(kinds(before)).toEqual(['post', 'button', 'post', 'post']);
    const driver = snapshotDriver([before, synth(['A1', 'A2', 'A3', 'OTHER'])]);
    const result = await collectThread(driver, A1);
    expect(driver.clicks).toHaveLength(1);
    expect(result?.posts.map((p) => p.id)).toEqual([A1, A2, A3]);
    expect(result?.partial).toBeNull();
  });

  it('A1 → 按钮 → 骨架 → A3 → 他人帖：按 DOM 顺序先遇到按钮，先点按钮', async () => {
    const driver = snapshotDriver([synth(['A1', 'BUTTON', 'SKEL', 'A3', 'OTHER']), synth(['A1', 'A2', 'A3', 'OTHER'])]);
    const result = await collectThread(driver, A1);
    expect(driver.clicks).toHaveLength(1);
    expect(result?.posts.map((p) => p.id)).toEqual([A1, A2, A3]);
    expect(result?.partial).toBeNull();
  });

  it('A1 → 骨架 → 按钮 → A3 → 他人帖：先 pending；1 秒后骨架换成 A2，再点按钮', async () => {
    const skel = synth(['A1', 'SKEL', 'BUTTON', 'A3', 'OTHER']);
    const rendered = synth(['A1', 'A2', 'BUTTON', 'A3', 'OTHER']);
    const after = synth(['A1', 'A2', 'A3', 'OTHER']);
    const driver = snapshotDriver([skel, after]);
    let clickedAt = -1;
    driver.cells = () => listCells(driver.index === 1 ? after : driver.clock >= 1_000 ? rendered : skel);
    const click = driver.click;
    driver.click = async (el) => {
      clickedAt = driver.clock;
      await click(el);
    };
    const result = await collectThread(driver, A1);
    expect(driver.clicks).toHaveLength(1);
    expect(clickedAt).toBeGreaterThanOrEqual(1_000);
    expect(result?.posts.map((p) => p.id)).toEqual([A1, A2, A3]);
    expect(result?.partial).toBeNull();
  });
});

describe('collectThread：展开完成与被点的按钮绑定（codex review 第 6 轮）', () => {
  it('点击后先来一条无关的他人回复、按钮还在，过 8 次 wait 才出现快照 3：仍是 41 条，partial 为 null', async () => {
    const docs = navalDocs();
    const snap2 = docs[1] as Document;
    const unrelated = listCells(snap2).find((c) => {
      const k = classifyCell(c);
      return k.kind === 'post' && k.handle === 'SachinRamje';
    }) as Element;
    const driver = snapshotDriver(docs, {
      clickDelayWaits: 8,
      onClick: () => {
        // 原地给快照 2 加一条无关的他人回复（新 id），按钮元素不动
        const extra = unrelated.cloneNode(true) as Element;
        for (const a of extra.querySelectorAll('a[href*="/status/"]')) a.setAttribute('href', (a.getAttribute('href') ?? '').replace('1459510837001928704', '1459510837001928799'));
        const art = extra.querySelector('article[data-testid="tweet"]');
        art?.setAttribute('data-alayo-x', (art.getAttribute('data-alayo-x') ?? '').replace('1459510837001928704', '1459510837001928799'));
        (listCells(snap2).at(-1) as Element).after(extra);
      },
    });
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(driver.clicks).toHaveLength(1);
    expect(result?.posts).toHaveLength(41);
    expect(result?.posts[40]?.id).toBe('1129483486081966080');
    expect(result?.partial).toBeNull();
  });
});

describe('collectThread：按钮被虚拟滚动回收后不算展开完成（codex review 第 7 轮）', () => {
  /** 快照 2 去掉按钮和全部 naval 帖子，只剩 @khemaridh 等他人回复（展开区域离开了视野） */
  const othersOnly = () => {
    const doc = loadFixture(naval2);
    for (const c of listCells(doc)) {
      const k = classifyCell(c);
      if (k.kind === 'button' || (k.kind === 'post' && k.handle === 'naval')) c.remove();
    }
    expect(listCells(doc).some((c) => classifyCell(c).kind === 'button')).toBe(false);
    return doc;
  };

  it('点击后先出现只剩他人回复的快照（超过 1.5 秒），再出现快照 3：41 条，partial 为 null', async () => {
    const [n1, n2, n3, n4] = navalDocs() as [Document, Document, Document, Document];
    const driver = snapshotDriver([n1, n2, othersOnly(), n3, n4], { advanceAfterClickWaits: 20 });
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(driver.clicks).toHaveLength(1);
    expect(result?.posts).toHaveLength(41);
    expect(result?.posts[40]?.id).toBe('1129483486081966080');
    expect(result?.partial).toBeNull();
  });

  it('只剩他人回复的快照一直保持到超过 15 秒：timeout: true，保留 31 条', async () => {
    const [n1, n2] = navalDocs() as [Document, Document];
    const driver = snapshotDriver([n1, n2, othersOnly()]);
    const result = await collectThread(driver, NAVAL_FOCAL);
    expect(driver.clicks).toHaveLength(1);
    expect(driver.clock).toBeGreaterThanOrEqual(X_MAX_MS);
    expect(result?.partial).toEqual({ limit: false, timeout: true, truncated: 0 });
    expect(result?.posts).toHaveLength(31);
  });
});

describe('Accumulator.merge：已知帖子每次都重新解析（codex review 第 4 轮）', () => {
  it('同一个 article 原地补上视频节点后再 merge：post.media 里有这个视频', () => {
    const doc = loadFixture(videoP4n);
    const cell = listCells(doc)[0] as Element;
    const photo = cell.querySelector('[data-testid="tweetPhoto"]') as Element;
    const parent = photo.parentElement as Element;
    photo.remove();
    const acc = new Accumulator();
    acc.merge([classifyCell(cell)]);
    expect(acc.list[0]?.post?.media).toHaveLength(0);
    parent.append(photo);
    acc.merge([classifyCell(cell)]);
    expect(acc.list[0]?.post?.media).toHaveLength(1);
    expect(acc.list[0]?.post?.media[0]?.kind).toBe('video');
  });

  it('重新解析失败（返回 null）时保留旧结果', () => {
    const doc = loadFixture(videoP4n);
    const cell = listCells(doc)[0] as Element;
    const acc = new Accumulator();
    const c = classifyCell(cell);
    acc.merge([c]);
    const before = acc.list[0]?.post;
    expect(before).not.toBeNull();
    // 帖子链接没了：parsePost 返回 null，但 cell 仍按旧的分类结果合并
    for (const t of cell.querySelectorAll('time')) t.remove();
    expect(c.kind === 'post' ? parsePost(c.article) : 'x').toBeNull();
    acc.merge([c]);
    expect(acc.list[0]?.post).toEqual(before);
  });
});

describe('Accumulator.merge：新帖子的位置（codex review 第 1 轮）', () => {
  const post = (id: string): XCell => {
    const el = document.createElement('div');
    return { kind: 'post', id, handle: 'a', el, article: el };
  };
  const ids = (acc: Accumulator) => acc.list.map((e) => e.id);

  it('前面没有已知帖子、后面有：插在后面第一条已知帖子之前', () => {
    const acc = new Accumulator();
    acc.merge([post('1'), post('3')]);
    acc.merge([post('2'), post('3')]);
    expect(ids(acc)).toEqual(['1', '2', '3']);
  });

  it('连续几条新帖子在已知帖子之前：保持相对顺序', () => {
    const acc = new Accumulator();
    acc.merge([post('1'), post('4')]);
    acc.merge([post('2'), post('3'), post('4')]);
    expect(ids(acc)).toEqual(['1', '2', '3', '4']);
  });

  it('本快照里一条已知帖子都没有：追加到末尾', () => {
    const acc = new Accumulator();
    acc.merge([post('1'), post('2')]);
    acc.merge([post('3'), post('4')]);
    expect(ids(acc)).toEqual(['1', '2', '3', '4']);
  });
});

describe('collectThread：单份快照', () => {
  it('video-p4nthera：1 条，form 为 post', async () => {
    const result = await collectThread(snapshotDriver([loadFixture(videoP4n)]), '2107175720086589633');
    expect(result?.posts.map((p) => p.id)).toEqual(['2107175720086589633']);
    expect(result?.form).toBe('post');
    expect(result?.partial).toBeNull();
  });

  it('video-viktoroddy：2 条（作者自回复算入）', async () => {
    const result = await collectThread(snapshotDriver([loadFixture(videoViktor)]), '2107279715195392141');
    expect(result?.posts.map((p) => p.id)).toEqual(['2107279715195392141', '2107282370500182194']);
    expect(result?.form).toBe('thread');
  });

  it('thread-alchainhust：3 条（跨分隔）', async () => {
    const result = await collectThread(snapshotDriver([loadFixture(alchain)]), '2031212582510674055');
    expect(result?.posts.map((p) => p.id)).toEqual(['2031212582510674055', '2031212769694068775', '2031347566865166627']);
  });

  it('找不到焦点帖：5 秒后返回 null，并恢复滚动位置', async () => {
    const driver = snapshotDriver([loadFixture(videoP4n)]);
    const result = await collectThread(driver, '1');
    expect(result).toBeNull();
    expect(driver.clock).toBeGreaterThanOrEqual(5_000);
    expect(driver.restored).toBe(1);
  });
});
