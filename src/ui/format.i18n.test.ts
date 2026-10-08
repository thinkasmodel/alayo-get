// 界面文案纯函数的英文渲染（ALAG-7 brief A §8）。英文逐条取自 designs/alag-6-7/Strings.dc.html。
import { beforeEach, describe, expect, it } from 'vitest';
import { CJK, useLocale } from '../../tests/setup/i18n';
import {
  failureReason,
  formatMonthDay,
  oversizeNote,
  partialNote,
  partialToastText,
  quoteToastText,
  savedDescription,
  savedToastText,
  savingText,
  toastFailureText,
} from './format';

const MB = 1024 * 1024;
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

/** 断言值等于期望的英文，并且不含中日韩字符。 */
function en(actual: string | null, expected: string): void {
  expect(actual).toBe(expected);
  expect(actual).not.toMatch(CJK);
}

beforeEach(() => useLocale('en'));

describe('英文：保存进度', () => {
  it('四个阶段', () => {
    en(savingText({ phase: 'extract' }), 'Extracting article…');
    en(savingText({ phase: 'images', done: 7, total: 12 }), 'Article extracted. Downloading images 7 / 12');
    en(savingText({ phase: 'write' }), 'Saving to library…');
    en(savingText({ phase: 'download', done: 12.3 * MB, total: 40.1 * MB, kind: 'pdf' }), 'Downloading PDF, 12.3 / 40.1 MB');
    en(savingText({ phase: 'download', done: 300 * 1024, total: 900 * 1024, kind: 'image' }), 'Downloading image, 300 / 900 KB');
    en(savingText({ phase: 'download', done: 2 * MB, kind: 'video' }), 'Downloading video, 2 MB');
  });
});

describe('英文：已保存说明行', () => {
  const x = (form: 'post' | 'thread' | 'article', posts = 1) => ({ form, posts, partial: null });

  it('文章、书签；图片张数单复数；下载失败', () => {
    en(savedDescription({ medium: 'web', imageCount: 0, imageFailures: 0 }), 'Article');
    en(savedDescription({ medium: 'web', imageCount: 1, imageFailures: 0 }), 'Article · 1 image');
    en(savedDescription({ medium: 'web', imageCount: 2, imageFailures: 0 }), 'Article · 2 images');
    en(savedDescription({ medium: 'web', imageCount: 10, imageFailures: 2 }), 'Article · 10 images · 2 failed to download');
    en(savedDescription({ medium: 'web', imageCount: 0, imageFailures: 3 }), 'Article · 3 failed to download');
    en(savedDescription({ medium: 'link', imageCount: 0, imageFailures: 0 }), 'Bookmark');
  });

  it('X 剪藏：形态与作者串条数单复数', () => {
    en(savedDescription({ medium: 'x', imageCount: 0, imageFailures: 0, x: x('post') }), 'X post');
    en(savedDescription({ medium: 'x', imageCount: 0, imageFailures: 0, x: x('thread', 1) }), 'X thread · 1 post');
    en(savedDescription({ medium: 'x', imageCount: 0, imageFailures: 0, x: x('thread', 41) }), 'X thread · 41 posts');
    en(savedDescription({ medium: 'x', imageCount: 8, imageFailures: 0, x: x('thread', 41) }), 'X thread · 41 posts · 8 images');
    en(savedDescription({ medium: 'x', imageCount: 1, imageFailures: 1, x: x('article') }), 'X article · 1 image · 1 failed to download');
    en(savedDescription({ medium: 'x', imageCount: 0, imageFailures: 0 }), 'X clip');
  });

  it('媒体剪藏与流媒体剪藏', () => {
    const base = { imageCount: 0, imageFailures: 0 };
    en(savedDescription({ ...base, medium: 'image', media: { kind: 'image', bytes: 1258291 } }), 'Media · Image · 1.2 MB');
    en(savedDescription({ ...base, medium: 'pdf', media: { kind: 'pdf', bytes: 40.1 * MB } }), 'Media · PDF · 40.1 MB');
    const s = (platform: 'youtube' | 'bilibili' | 'x' | 'baidupan' | '115' | 'quark' | 'other', duration: number | null, medium: 'video' | 'audio' = 'video') =>
      savedDescription({ ...base, medium, stream: { platform, duration, medium } });
    en(s('youtube', 213), 'Stream · YouTube · 3:33');
    en(s('bilibili', 724), 'Stream · Bilibili · 12:04');
    en(s('x', 47), 'Stream · X video · 0:47');
    en(s('baidupan', null), 'Stream · Baidu Netdisk');
    en(s('quark', null), 'Stream · Quark');
    en(s('other', 30), 'Stream · Video link');
    en(s('other', null, 'audio'), 'Stream · Audio link');
  });

  it('超大直链的面板小字', () => {
    const stream = (bytes: number | null) => ({ stream: { platform: 'other' as const, duration: null, medium: 'video' as const, oversize: { bytes } } });
    en(oversizeNote(stream(1.8 * 1024 * MB)), 'The file is 1.8 GB, over 100 MB, so it wasn’t downloaded. Only the link was saved.');
    en(oversizeNote(stream(null)), 'Couldn’t get the file size, so it wasn’t downloaded. Only the link was saved.');
  });

  it('页面提示说明行：媒体、流媒体、超大直链四句', () => {
    const clip = { title: 'Never Gonna Give You Up', file: 'cover@2x.jpg' };
    en(savedToastText({ ...clip, media: { kind: 'image', bytes: 1 } }), 'Image · cover@2x.jpg');
    en(savedToastText({ ...clip, stream: { platform: 'bilibili', duration: 213, medium: 'video' } }), 'Bilibili · Never Gonna Give You Up');
    const oversize = (bytes: number | null, medium: 'video' | 'audio') => savedToastText({ ...clip, stream: { platform: 'other', duration: null, medium, oversize: { bytes } } });
    en(oversize(150 * MB, 'video'), 'Video is over 100 MB. Saved the link and details only');
    en(oversize(null, 'video'), 'Couldn’t get the video size. Saved the link and details only');
    en(oversize(150 * MB, 'audio'), 'Audio is over 100 MB. Saved the link and details only');
    en(oversize(null, 'audio'), 'Couldn’t get the audio size. Saved the link and details only');
  });
});

describe('英文：日期', () => {
  it('页面提示用的月日：Oct 7', () => {
    en(formatMonthDay(localNoon(2026, 10, 7)), 'Oct 7');
    en(formatMonthDay(localNoon(2026, 1, 15)), 'Jan 15');
  });
});

describe('英文：摘录的页面提示', () => {
  const quote = { fileId: 'F', entry: 3, anchor: '', fragment: true, recreated: false };
  const file = 'Quotes - Thinking, Fast and Slow notes.md';

  it('三种形态', () => {
    en(quoteToastText({ file, quote }), 'Quote 3 · Quotes - Thinking, Fast and Slow notes.md');
    en(quoteToastText({ file, quote: { ...quote, entry: 2, fragment: false } }), 'Quote 2 · Couldn’t find the text on the page, so the link goes to the page');
    en(quoteToastText({ file, quote: { ...quote, recreated: true } }), 'The quotes file was missing, so a new one was created');
  });
});

describe('英文：X 只存了一部分', () => {
  it('面板原因：各句与连写（英文句子之间空一格）；长帖条数单复数', () => {
    en(partialNote({ limit: true, timeout: false, truncated: 0 }, 50), 'The thread has more than 50 posts. Saved the first 50.');
    en(partialNote({ limit: false, timeout: true, truncated: 0 }, 23), 'Loading didn’t finish within 15 seconds. Saved the 23 posts loaded.');
    en(partialNote({ limit: false, timeout: false, truncated: 2 }, 3), '2 long posts showed only their beginning in the list. Links to the full posts are included.');
    en(partialNote({ limit: false, timeout: false, truncated: 1 }, 3), '1 long post showed only its beginning in the list. A link to the full post is included.');
    en(
      partialNote({ limit: true, timeout: false, truncated: 2 }, 50),
      'The thread has more than 50 posts. Saved the first 50. 2 long posts showed only their beginning in the list. Links to the full posts are included.',
    );
  });

  it('页面提示原因：只写一个', () => {
    en(partialToastText({ limit: true, timeout: false, truncated: 2 }, 50), 'Thread over 50 posts. Saved the first 50');
    en(partialToastText({ limit: false, timeout: true, truncated: 2 }, 23), 'Didn’t finish loading in 15 s. Saved 23 posts');
    en(partialToastText({ limit: false, timeout: false, truncated: 2 }, 3), '2 long posts cut off. Linked the full posts');
  });
});

describe('英文：失败原因', () => {
  it('面板', () => {
    en(failureReason({ name: 'NotFoundError', message: 'x' }, 'Alayo Get'), 'Can’t find the library folder “Alayo Get”. It may have been moved, renamed or deleted.');
    en(failureReason({ name: 'QuotaExceededError', message: 'Disk full' }, 'Alayo Get'), 'Error while saving: Disk full');
  });

  it('页面提示', () => {
    en(toastFailureText({ name: 'NotFoundError', message: 'x' }), 'Can’t find the library folder. Not saved');
    en(toastFailureText({ name: 'ExpiredRequest', message: 'x' }), 'This notice has expired and nothing was saved. Please save again');
    en(toastFailureText({ name: 'XVideoNeedsPost', message: 'x' }), 'Can’t tell which post this is on the timeline. Open the post, then save again');
    en(toastFailureText({ name: 'NoDownloadableUrl', message: 'x' }), 'This image has no downloadable address. Not saved');
    en(toastFailureText({ name: 'DataUrlTooLarge', message: 'x' }), 'This image is embedded data and too large to hold. Allow access, then save again');
    en(toastFailureText({ name: 'QuotaExceededError', message: 'Disk full' }), 'Error while saving: Disk full. Not saved');
  });
});

describe('英文：X 只存了一部分的条数单复数（ALAG-7 brief B §6）', () => {
  const timeout = { limit: false, timeout: true, truncated: 0 };
  const truncated = (n: number) => ({ limit: false, timeout: false, truncated: n });

  it('面板：超时存下的条数', () => {
    en(partialNote(timeout, 1), 'Loading didn’t finish within 15 seconds. Saved the 1 post loaded.');
    en(partialNote(timeout, 2), 'Loading didn’t finish within 15 seconds. Saved the 2 posts loaded.');
  });

  it('页面提示：超时存下的条数', () => {
    en(partialToastText(timeout, 1), 'Didn’t finish loading in 15 s. Saved 1 post');
    en(partialToastText(timeout, 2), 'Didn’t finish loading in 15 s. Saved 2 posts');
  });

  it('页面提示：长帖被截断的条数', () => {
    en(partialToastText(truncated(1), 3), '1 long post cut off. Linked the full post');
    en(partialToastText(truncated(2), 3), '2 long posts cut off. Linked the full posts');
  });

  it('中文不变：1 与 2 同一句式', () => {
    useLocale('zh_CN');
    expect(partialNote(timeout, 1)).toBe('15 秒内没有加载完，存下了已加载的 1 条。');
    expect(partialToastText(timeout, 1)).toBe('15 秒内没加载完，存了 1 条');
    expect(partialToastText(truncated(1), 3)).toBe('有 1 条长帖只存了开头，附了原帖链接');
  });
});
