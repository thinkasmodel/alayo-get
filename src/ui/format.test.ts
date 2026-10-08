import { describe, expect, it } from 'vitest';
import {
  failureDetail,
  failureReason,
  formatBytes,
  failureRetryable,
  formatDate,
  formatMonthDay,
  partialNote,
  oversizeNote,
  partialToastText,
  quoteToastText,
  savedDescription,
  savedToastText,
  savingPercent,
  savingText,
  toastFailureText,
} from './format';

// 用本地正午构造时间，避免时区把日期翻到前一天或后一天。
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

describe('保存进度', () => {
  it('extract 阶段', () => {
    expect(savingText({ phase: 'extract' })).toBe('正在抽取正文…');
    expect(savingPercent({ phase: 'extract' })).toBe(20);
  });

  it('images 阶段：文案带 done / total，进度 20% + 60% × done / total', () => {
    expect(savingText({ phase: 'images', done: 7, total: 12 })).toBe('正文已抽取，正在下载图片 7 / 12');
    expect(savingPercent({ phase: 'images', done: 0, total: 12 })).toBe(20);
    expect(savingPercent({ phase: 'images', done: 6, total: 12 })).toBe(50);
    expect(savingPercent({ phase: 'images', done: 12, total: 12 })).toBe(80);
  });

  it('write 阶段', () => {
    expect(savingText({ phase: 'write' })).toBe('正在写入剪藏库…');
    expect(savingPercent({ phase: 'write' })).toBe(90);
  });
});

describe('已保存说明行', () => {
  it('文章剪藏有图', () => {
    expect(savedDescription({ medium: 'web', imageCount: 12, imageFailures: 0 })).toBe('文章剪藏 · 含 12 张图片');
  });

  it('文章剪藏无图', () => {
    expect(savedDescription({ medium: 'web', imageCount: 0, imageFailures: 0 })).toBe('文章剪藏');
  });

  it('书签剪藏', () => {
    expect(savedDescription({ medium: 'link', imageCount: 0, imageFailures: 0 })).toBe('书签剪藏');
  });

  it('有下载失败的图片时追加一段', () => {
    expect(savedDescription({ medium: 'web', imageCount: 10, imageFailures: 2 })).toBe(
      '文章剪藏 · 含 10 张图片 · 2 张没下载成功',
    );
    expect(savedDescription({ medium: 'web', imageCount: 0, imageFailures: 3 })).toBe('文章剪藏 · 3 张没下载成功');
  });
});

describe('X 剪藏（ALAG-3）', () => {
  const x = (form: 'post' | 'thread' | 'article', posts = 1) => ({ form, posts, partial: null });

  it('说明行按形态写，之后照旧接图片张数和下载失败', () => {
    expect(savedDescription({ medium: 'x', imageCount: 2, imageFailures: 0, x: x('post') })).toBe('X 帖子 · 含 2 张图片');
    expect(savedDescription({ medium: 'x', imageCount: 8, imageFailures: 0, x: x('thread', 41) })).toBe('X 作者串 · 41 条 · 含 8 张图片');
    expect(savedDescription({ medium: 'x', imageCount: 6, imageFailures: 0, x: x('article') })).toBe('X 长文 · 含 6 张图片');
    expect(savedDescription({ medium: 'x', imageCount: 0, imageFailures: 0, x: x('post') })).toBe('X 帖子');
    expect(savedDescription({ medium: 'x', imageCount: 0, imageFailures: 0, x: x('thread', 3) })).toBe('X 作者串 · 3 条');
    expect(savedDescription({ medium: 'x', imageCount: 4, imageFailures: 1, x: x('article') })).toBe('X 长文 · 含 4 张图片 · 1 张没下载成功');
  });

  it('面板原因：各原因逐字对齐 DESIGN.md，多个原因按上限、超时、截断的顺序连写', () => {
    expect(partialNote({ limit: true, timeout: false, truncated: 0 }, 50)).toBe('作者串超过 50 条，只存了前 50 条。');
    expect(partialNote({ limit: false, timeout: true, truncated: 0 }, 23)).toBe('15 秒内没有加载完，存下了已加载的 23 条。');
    expect(partialNote({ limit: false, timeout: false, truncated: 2 }, 3)).toBe('有 2 条长帖在列表里只显示了开头，已在文中附上原帖链接。');
    expect(partialNote({ limit: true, timeout: false, truncated: 2 }, 50)).toBe(
      '作者串超过 50 条，只存了前 50 条。有 2 条长帖在列表里只显示了开头，已在文中附上原帖链接。',
    );
    expect(partialNote({ limit: false, timeout: true, truncated: 1 }, 12)).toBe(
      '15 秒内没有加载完，存下了已加载的 12 条。有 1 条长帖在列表里只显示了开头，已在文中附上原帖链接。',
    );
  });

  it('页面提示原因：只写一个，优先级为超过上限、超时、长帖被截断', () => {
    expect(partialToastText({ limit: true, timeout: false, truncated: 2 }, 50)).toBe('作者串超过 50 条，只存了前 50 条');
    expect(partialToastText({ limit: false, timeout: true, truncated: 2 }, 23)).toBe('15 秒内没加载完，存了 23 条');
    expect(partialToastText({ limit: false, timeout: false, truncated: 2 }, 3)).toBe('有 2 条长帖只存了开头，附了原帖链接');
  });
});

describe('日期', () => {
  it('YYYY-MM-DD（补零）', () => {
    expect(formatDate(localNoon(2026, 9, 28))).toBe('2026-09-28');
    expect(formatDate(localNoon(2026, 1, 5))).toBe('2026-01-05');
  });

  it('页面提示用的 M 月 D 日（不补零）', () => {
    expect(formatMonthDay(localNoon(2026, 9, 28))).toBe('9 月 28 日');
    expect(formatMonthDay(localNoon(2026, 1, 5))).toBe('1 月 5 日');
  });
});

describe('失败原因', () => {
  it('NotFoundError：找不到剪藏库文件夹', () => {
    const error = { name: 'NotFoundError', message: 'A requested file or directory could not be found.' };
    expect(failureReason(error, 'Alayo Get')).toBe('找不到剪藏库文件夹“Alayo Get”，它可能被移动、改名或删除了。');
    expect(failureDetail(error, 'Alayo Get')).toBe('NotFoundError · Alayo Get');
    expect(toastFailureText(error)).toBe('找不到剪藏库文件夹，本次没有保存');
  });

  it('其他错误：写入时出错加错误消息', () => {
    const error = { name: 'QuotaExceededError', message: '磁盘空间不足' };
    expect(failureReason(error, 'Alayo Get')).toBe('写入时出错：磁盘空间不足');
    expect(failureDetail(error, 'Alayo Get')).toBe('QuotaExceededError · Alayo Get');
    expect(toastFailureText(error)).toBe('写入时出错：磁盘空间不足，本次没有保存');
    expect(toastFailureText({ name: 'ExpiredRequest', message: '这条提示对应的内容已过期' })).toBe('这条提示已过期，没有保存，请重新保存一次');
  });
});

describe('媒体剪藏与流媒体剪藏（ALAG-4，DESIGN.md §3.2、§3.3）', () => {
  const MB = 1024 * 1024;

  it('大小写法：不到 1MB 写整数 KB；MB、GB 一位小数，小数是 0 时去掉', () => {
    expect(formatBytes(900 * 1024)).toBe('900 KB');
    expect(formatBytes(1258291)).toBe('1.2 MB');
    expect(formatBytes(63 * MB)).toBe('63 MB');
    expect(formatBytes(40.1 * MB)).toBe('40.1 MB');
    expect(formatBytes(1.8 * 1024 * MB)).toBe('1.8 GB');
  });

  it('下载进度句与进度条：20 + 60 × done / total，总数未知时 20', () => {
    expect(savingText({ phase: 'download', done: 12.3 * MB, total: 40.1 * MB, kind: 'pdf' })).toBe('正在下载 PDF，12.3 / 40.1 MB');
    expect(savingText({ phase: 'download', done: 12.3 * MB, kind: 'pdf' })).toBe('正在下载 PDF，12.3 MB');
    expect(savingText({ phase: 'download', done: 300 * 1024, total: 900 * 1024, kind: 'image' })).toBe('正在下载 图片，300 / 900 KB');
    expect(savingText({ phase: 'download', done: 0, total: 8 * MB, kind: 'audio' })).toBe('正在下载 音频，0 / 8 MB');
    expect(savingText({ phase: 'download', done: 2 * MB, kind: 'video' })).toBe('正在下载 视频，2 MB');
    expect(savingPercent({ phase: 'download', done: 10, total: 40, kind: 'pdf' })).toBe(35);
    expect(savingPercent({ phase: 'download', done: 40, total: 40, kind: 'pdf' })).toBe(80);
    expect(savingPercent({ phase: 'download', done: 10, kind: 'pdf' })).toBe(20);
  });

  it('媒体剪藏的说明行：媒体剪藏 · 类别 · 大小', () => {
    const base = { imageCount: 0, imageFailures: 0 };
    expect(savedDescription({ ...base, medium: 'image', media: { kind: 'image', bytes: 1258291 } })).toBe('媒体剪藏 · 图片 · 1.2 MB');
    expect(savedDescription({ ...base, medium: 'audio', media: { kind: 'audio', bytes: 8.4 * MB } })).toBe('媒体剪藏 · 音频 · 8.4 MB');
    expect(savedDescription({ ...base, medium: 'video', media: { kind: 'video', bytes: 63 * MB } })).toBe('媒体剪藏 · 视频 · 63 MB');
    expect(savedDescription({ ...base, medium: 'pdf', media: { kind: 'pdf', bytes: 40.1 * MB } })).toBe('媒体剪藏 · PDF · 40.1 MB');
  });

  it('流媒体剪藏的说明行：平台与时长，取不到时长不写；直链写视频直链、音频直链', () => {
    const base = { imageCount: 1, imageFailures: 0 };
    const s = (platform: 'youtube' | 'bilibili' | 'x' | 'baidupan' | '115' | 'quark' | 'other', duration: number | null, medium: 'video' | 'audio' = 'video') =>
      savedDescription({ ...base, medium, stream: { platform, duration, medium } });
    expect(s('youtube', 213)).toBe('流媒体剪藏 · YouTube · 3:33');
    expect(s('bilibili', 724)).toBe('流媒体剪藏 · B 站 · 12:04');
    expect(s('x', 47)).toBe('流媒体剪藏 · X 视频 · 0:47');
    expect(s('baidupan', null)).toBe('流媒体剪藏 · 百度网盘');
    expect(s('115', null)).toBe('流媒体剪藏 · 115');
    expect(s('quark', null)).toBe('流媒体剪藏 · 夸克');
    expect(s('other', null)).toBe('流媒体剪藏 · 视频直链');
    expect(s('other', null, 'audio')).toBe('流媒体剪藏 · 音频直链');
  });

  it('超大或拿不到大小的直链：面板小字', () => {
    const stream = (bytes: number | null) => ({ stream: { platform: 'other' as const, duration: null, medium: 'video' as const, oversize: { bytes } } });
    expect(oversizeNote(stream(1.8 * 1024 * MB))).toBe('文件有 1.8 GB，超过 100MB，没有下载，只记了链接。');
    expect(oversizeNote(stream(null))).toBe('拿不到文件大小，没有下载，只记了链接。');
    expect(oversizeNote({ stream: { platform: 'youtube', duration: 1, medium: 'video' } })).toBeNull();
    expect(oversizeNote({})).toBeNull();
  });

  it('页面提示说明行：媒体“类别 · 文件名”，流媒体“平台 · 标题”，超大直链两句（音频同理）', () => {
    const clip = { title: '标题', file: '少数派年度盘点 - cover@2x.jpg' };
    expect(savedToastText({ ...clip, media: { kind: 'image', bytes: 1 } })).toBe('图片 · 少数派年度盘点 - cover@2x.jpg');
    expect(savedToastText({ ...clip, media: { kind: 'pdf', bytes: 1 } })).toBe('PDF · 少数派年度盘点 - cover@2x.jpg');
    expect(savedToastText({ ...clip, title: '【官方 MV】Never Gonna Give You Up - Rick Astley', stream: { platform: 'bilibili', duration: 213, medium: 'video' } })).toBe(
      'B 站 · 【官方 MV】Never Gonna Give You Up - Rick Astley',
    );
    const oversize = (bytes: number | null, medium: 'video' | 'audio') => savedToastText({ ...clip, stream: { platform: 'other', duration: null, medium, oversize: { bytes } } });
    expect(oversize(150 * MB, 'video')).toBe('视频超过 100MB，只记了链接和信息');
    expect(oversize(null, 'video')).toBe('拿不到视频大小，只记了链接和信息');
    expect(oversize(150 * MB, 'audio')).toBe('音频超过 100MB，只记了链接和信息');
    expect(oversize(null, 'audio')).toBe('拿不到音频大小，只记了链接和信息');
    expect(savedToastText(clip)).toBe('标题');
  });

  it('时间线上右键 X 视频：页面提示说明行', () => {
    expect(toastFailureText({ name: 'XVideoNeedsPost', message: '在时间线上认不出是哪条帖子，请打开帖子页再存' })).toBe('在时间线上认不出是哪条帖子，请打开帖子页再存');
  });
});

describe('右键直接失败的提示（ALAG-4 编排者裁决）', () => {
  it('NoDownloadableUrl、DataUrlTooLarge 各有一句，不再套“写入时出错”', () => {
    expect(toastFailureText({ name: 'NoDownloadableUrl', message: '这张图片没有可下载的地址' })).toBe('这张图片没有可下载的地址，本次没有保存');
    expect(toastFailureText({ name: 'DataUrlTooLarge', message: '这张图片是内嵌数据，太大，没法暂存，请授权后重新保存' })).toBe(
      '这张图片是内嵌数据，太大，没法暂存，请授权后重新保存',
    );
  });

  it('XVideoNeedsPost、NoDownloadableUrl 重试没有意义；其余失败可以重试', () => {
    expect(failureRetryable({ name: 'XVideoNeedsPost', message: '' })).toBe(false);
    expect(failureRetryable({ name: 'NoDownloadableUrl', message: '' })).toBe(false);
    expect(failureRetryable({ name: 'DataUrlTooLarge', message: '' })).toBe(false);
    expect(failureRetryable({ name: 'NotFoundError', message: '' })).toBe(true);
    expect(failureRetryable({ name: 'ExpiredRequest', message: '' })).toBe(true);
  });
});

describe('摘录剪藏的页面提示说明行（ALAG-4，DESIGN.md §3.3“已摘录”行）', () => {
  const quote = { fileId: 'F', entry: 3, anchor: '', fragment: true, recreated: false };
  const file = '摘录 - 为什么我们需要慢思考.md';

  it('第 N 条 · 文件名', () => {
    expect(quoteToastText({ file, quote })).toBe('第 3 条 · 摘录 - 为什么我们需要慢思考.md');
  });

  it('没能生成文本片段链接：第 N 条 · 没能定位到原文位置，链接只到页面', () => {
    expect(quoteToastText({ file, quote: { ...quote, entry: 2, fragment: false } })).toBe('第 2 条 · 没能定位到原文位置，链接只到页面');
  });

  it('原摘录文件不在了：原来的摘录文件不在了，新建了一个（优先于片段）', () => {
    expect(quoteToastText({ file, quote: { ...quote, entry: 1, recreated: true } })).toBe('原来的摘录文件不在了，新建了一个');
    expect(quoteToastText({ file, quote: { ...quote, entry: 1, recreated: true, fragment: false } })).toBe('原来的摘录文件不在了，新建了一个');
  });
});
