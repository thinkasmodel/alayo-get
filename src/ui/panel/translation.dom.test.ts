import { describe, expect, it, vi } from 'vitest';
import { loadMessages, useLocale } from '../../../tests/setup/i18n';
import type { TranslationOutcome, TranslationView } from '@/shared/types';
import { blockModel, renderTranslationBlock, type TranslationBlockActions, type TranslationBlockInput } from './translation';

const messages = loadMessages('zh_CN');
const zh = (key: keyof typeof messages): string => messages[key]?.message ?? '';

const failed = (outcome: TranslationOutcome): TranslationView => ({ phase: 'finished', target: 'zh', outcome });

function makeActions() {
  return {
    select: vi.fn<(target: string) => void>(),
    translate: vi.fn<(target: string) => void>(),
    download: vi.fn<(model: unknown, target: string) => void>(),
  } satisfies TranslationBlockActions;
}

function render(input: Partial<TranslationBlockInput> = {}) {
  const root = document.createElement('div');
  const actions = makeActions();
  const model = blockModel({
    file: '文章.md',
    supported: true,
    settings: { target: 'auto', always: false },
    uiLang: 'zh',
    ...input,
  });
  root.append(renderTranslationBlock(model, actions));
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  return { root, actions, model, button, select: root.querySelector<HTMLSelectElement>('select') };
}

describe('面板翻译块：空闲与不支持（A / I）', () => {
  it('空闲：下拉框默认跟随界面语言（简体中文），翻译按钮带当前选中目标', () => {
    const { root, actions, select, button, model } = render();
    expect(model.kind).toBe('idle');
    expect(root.textContent).toContain(zh('tr_onlyThis'));
    expect(select?.value).toBe('zh');
    expect([...root.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['简体中文', '繁體中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español']);
    button(zh('tr_translate'))?.click();
    expect(actions.translate).toHaveBeenCalledWith('zh');

    if (!select) throw new Error('没有下拉框');
    select.value = 'ja';
    select.dispatchEvent(new Event('change'));
    expect(actions.select).toHaveBeenCalledWith('ja');
    button(zh('tr_translate'))?.click();
    expect(actions.translate).toHaveBeenLastCalledWith('ja');
  });

  it('用户选过的目标优先于设置', () => {
    const { select } = render({ selectedTarget: 'fr', settings: { target: 'ja', always: true } });
    expect(select?.value).toBe('fr');
  });

  it('浏览器不支持：下拉框与按钮 disabled，说明用 tr_unsupportedBrowser', () => {
    const { root, select, button } = render({ supported: false });
    expect(select?.disabled).toBe(true);
    expect(button(zh('tr_translate'))?.disabled).toBe(true);
    expect(root.textContent).toContain(zh('tr_unsupportedBrowser'));
  });
});

describe('面板翻译块：翻译中与结果（B / E / F / G）', () => {
  it('翻译中：目标语言名、done / total、进度条宽度', () => {
    const { root, model } = render({ view: { phase: 'running', target: 'ja', done: 12, total: 40 } });
    expect(model.kind).toBe('running');
    expect(root.textContent).toContain('正在翻译成日语');
    expect(root.textContent).toContain('12 / 40 段');
    expect(root.textContent).toContain(zh('tr_closeHint'));
    expect(root.querySelector<HTMLElement>('.bar i')?.style.width).toBe('30%');
    expect(root.querySelector('button')).toBeNull();
  });

  it('total 为 0 时进度条 0%', () => {
    const { root } = render({ view: { phase: 'running', target: 'zh', done: 0, total: 0 } });
    expect(root.querySelector<HTMLElement>('.bar i')?.style.width).toBe('0%');
  });

  it('译完：段数用 outcome.applied，说明行含语言对', () => {
    const { root, model } = render({ view: failed({ status: 'complete', applied: 40, total: 40, source: 'en' }) });
    expect(model.kind).toBe('complete');
    expect(root.textContent).toContain('已加上简体中文译文');
    expect(root.textContent).toContain('英语 → 简体中文，40 段，每段译文写在原文下方。');
  });

  it('原文就是目标语言：带「换成」，默认选中第一个不同于原文语言的目标', () => {
    const { root, model, select, button, actions } = render({ view: failed({ status: 'skipped', applied: 0, total: 10, source: 'en' }) });
    expect(model.kind).toBe('skipped');
    expect(root.textContent).toContain('原文已经是简体中文，没有翻译');
    expect(select?.value).toBe('zh');
    expect(select?.value).not.toBe('en');
    button(zh('tr_translate'))?.click();
    expect(actions.translate).toHaveBeenCalledWith('zh');
  });

  it('没有可翻译的文字（skipped、total 0）：显示没有要翻译的文字，没有下拉框和按钮', () => {
    const { root, model, select } = render({ view: failed({ status: 'skipped', applied: 0, total: 0 }) });
    expect(model.kind).toBe('skipped');
    expect(root.textContent).toContain(zh('tr_nothingToTranslate'));
    expect(root.textContent).not.toContain('原文已经是');
    expect(select).toBeNull();
    expect(root.querySelector('button')).toBeNull();
  });

  it('partial：没有「重试」，说明行写已译段数', () => {
    const { root, button } = render({ view: failed({ status: 'partial', applied: 12, total: 40, source: 'en', error: { code: 'host-lost' } }) });
    expect(root.textContent).toContain('翻译没做完');
    expect(root.textContent).toContain('已译 12 / 40 段，已写进文件。');
    expect(button(zh('ui_retry'))).toBeUndefined();
  });

  it('aborted already-translated：灰色信息图标，没有按钮', () => {
    const { root } = render({ view: failed({ status: 'aborted', reason: 'already-translated', applied: 0, total: 0 }) });
    expect(root.textContent).toContain(zh('tr_alreadyTranslated'));
    expect(root.querySelector('button')).toBeNull();
  });

  it('aborted 文件不见了：写文件名，没有按钮', () => {
    const { root } = render({ view: failed({ status: 'aborted', reason: 'file-missing', applied: 0, total: 0 }), file: '被改名的文章.md' });
    expect(root.textContent).toContain('翻译停了');
    expect(root.textContent).toContain('「被改名的文章.md」不在剪藏库里，可能已被移动或改名。已译的段留在原文件里。');
    expect(root.querySelector('button')).toBeNull();
  });

  it('aborted 写入失败：tr_writeFailed', () => {
    const { root } = render({ view: failed({ status: 'aborted', reason: 'write-failed', applied: 0, total: 0 }) });
    expect(root.textContent).toContain(zh('tr_writeFailed'));
  });
});

describe('面板翻译块：要下载模型（C / D）', () => {
  const modelSpec = { kind: 'translator' as const, source: 'en', target: 'zh' };

  it('C：翻译模型，说明语言对与约 80 MB，点「下载并翻译」把模型和同一目标交给回调', () => {
    const { root, actions, button } = render({
      view: failed({ status: 'failed', applied: 0, total: 10, error: { code: 'needs-download', model: modelSpec } }),
    });
    expect(root.textContent).toContain(zh('tr_needsModel'));
    expect(root.textContent).toContain('英语 → 简体中文，约 80 MB，由 Chrome 从 Google 下载。下载一次后可以离线翻译。');
    const b = button(zh('tr_downloadAndTranslate'));
    b?.click();
    expect(actions.download).toHaveBeenCalledWith(modelSpec, 'zh');
  });

  it('C：检测模型用检测模型文案', () => {
    const { root } = render({
      view: failed({ status: 'failed', applied: 0, total: 10, error: { code: 'needs-download', model: { kind: 'detector' } } }),
    });
    expect(root.textContent).toContain(zh('tr_needsDetector'));
    expect(root.textContent).toContain(zh('tr_needsDetectorDesc'));
  });

  it('D：下载中显示百分比，没有按钮', () => {
    const { root } = render({ download: { kind: 'downloading', model: modelSpec, fraction: 0.46 } });
    expect(root.textContent).toContain(zh('tr_downloading'));
    expect(root.textContent).toContain('46%');
    expect(root.querySelector<HTMLElement>('.bar i')?.style.width).toBe('46%');
    expect(root.querySelector('button')).toBeNull();
  });

  it('D：检测模型下载中用检测模型文案', () => {
    const { root } = render({ download: { kind: 'downloading', model: { kind: 'detector' }, fraction: 0.1 } });
    expect(root.textContent).toContain(zh('tr_downloadingDetector'));
    expect(root.textContent).toContain(zh('tr_downloadingDetectorDesc'));
  });

  it('下载失败：错误原文 + 重试（再点一次下载）', () => {
    const { root, actions, button } = render({ download: { kind: 'download-failed', model: modelSpec, message: 'NetworkError: offline' } });
    expect(root.textContent).toContain(zh('tr_downloadFailed'));
    expect(root.querySelector('.mono')?.textContent).toBe('NetworkError: offline');
    button(zh('ui_retry'))?.click();
    expect(actions.download).toHaveBeenCalledWith(modelSpec, 'zh');
  });
});

describe('面板翻译块：语言对不支持与引擎失败（H / G）', () => {
  it('unsupported-pair：说明行带语言对，带「换成」行', () => {
    const { root, select, button, actions } = render({
      view: failed({ status: 'failed', applied: 0, total: 2, error: { code: 'unsupported-pair', source: 'th', target: 'zh' } }),
    });
    expect(root.textContent).toContain(zh('tr_failed'));
    expect(root.textContent).toContain('本机翻译不支持泰语 → 简体中文。');
    expect(select).not.toBeNull();
    button(zh('tr_translate'))?.click();
    expect(actions.translate).toHaveBeenCalledWith('zh');
  });

  it('source-unknown：没有「换成」行', () => {
    const { root, select } = render({ view: failed({ status: 'failed', applied: 0, total: 2, error: { code: 'source-unknown' } }) });
    expect(root.textContent).toContain(zh('tr_sourceUnknown'));
    expect(select).toBeNull();
  });

  it('engine-failed：一段也没译出来 + 错误原文 + 重试同一目标', () => {
    const { root, button, actions } = render({
      view: { phase: 'finished', target: 'ja', outcome: { status: 'failed', applied: 0, total: 5, error: { code: 'engine-failed', message: 'Error: boom' } } },
    });
    expect(root.textContent).toContain(zh('tr_nothingTranslated'));
    expect(root.querySelector('.mono')?.textContent).toBe('Error: boom');
    button(zh('ui_retry'))?.click();
    expect(actions.translate).toHaveBeenCalledWith('ja');
  });

  it('host-lost：可重试，但没有错误原文', () => {
    const { root, button } = render({ view: failed({ status: 'failed', applied: 0, total: 5, error: { code: 'host-lost' } }) });
    expect(root.querySelector('.mono')).toBeNull();
    expect(button(zh('ui_retry'))).toBeDefined();
  });
});

describe('面板翻译块：英文界面', () => {
  it('en：下拉框选项仍是本地名称，句子用英文', () => {
    useLocale('en');
    const { root, select } = render({ view: { phase: 'running', target: 'zh', done: 1, total: 2 }, uiLang: 'en' });
    expect(root.textContent).toContain('Translating to Chinese (Simplified)');
    expect(root.textContent).not.toContain('正在翻译');
    expect(select).toBeNull();
  });
});
