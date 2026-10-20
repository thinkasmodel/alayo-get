// 选项页「翻译」小节（ALAG-27 §8，设计稿 designs/alag-27-translate/Options.dc.html）：
// 目标语言（默认跟随界面语言）、保存时总是翻译（默认关）；浏览器不支持时两项灰掉并说明。
import { languageName, resolveTarget, TARGET_LANGUAGES } from '@/core/translate/targets';
import type { TranslationSettings } from '@/io/translationSettings';
import { currentLang, t } from '@/shared/i18n';
import { h, iconEl, type Child } from '../dom';

const AUTO_LABEL_ID = 'opt-auto-translate';
const ALWAYS_ID = 'opt-tr-always';

function targetRow(settings: TranslationSettings, disabled: boolean, onChange: (patch: Partial<TranslationSettings>) => void): HTMLElement {
  const follow = t('opt_trFollow', [languageName(resolveTarget('auto', currentLang()))]);
  const select = h('select', { class: 'sel', id: 'opt-lang', ...(disabled ? { disabled: true } : {}) });
  select.append(h('option', { value: 'auto' }, follow));
  // 不支持时只显示「跟随界面语言」一项（设计稿 B）
  if (!disabled) for (const language of TARGET_LANGUAGES) select.append(h('option', { value: language.tag }, language.endonym));
  select.value = disabled ? 'auto' : settings.target;
  if (!disabled) {
    select.addEventListener('change', () => {
      onChange({ target: select.value === 'auto' ? 'auto' : (select.value as TranslationSettings['target']) });
    });
  }
  return h('div', { class: disabled ? 'kr tr dim' : 'kr tr' }, [
    h('div', { class: 'lab' }, [
      h('label', { for: 'opt-lang' }, t('opt_trTarget')),
      disabled ? null : h('span', { class: 'desc' }, t('opt_trTargetDesc')),
    ]),
    h('span', { class: 'selw' }, [select, iconEl('chevronDown', 12, 'chev')]),
  ]);
}

function alwaysRow(settings: TranslationSettings, disabled: boolean, onChange: (patch: Partial<TranslationSettings>) => void): HTMLElement {
  const button = h('button', {
    type: 'button',
    class: 'sw',
    role: 'switch',
    'aria-checked': disabled ? 'false' : String(settings.always),
    'aria-labelledby': AUTO_LABEL_ID,
    id: ALWAYS_ID,
    ...(disabled ? { disabled: true } : {}),
    onclick: () => {
      // 不整页重绘时闭包里的 settings 会过期，以控件当前状态为准。
      if (!disabled) onChange({ always: button.getAttribute('aria-checked') !== 'true' });
    },
  }, h('i', {}));
  return h('div', { class: disabled ? 'kr tr dim' : 'kr tr' }, [
    h('div', { class: 'lab' }, [
      h('span', { class: 'lt', id: AUTO_LABEL_ID }, t('opt_trAlways')),
      disabled ? null : h('span', { class: 'desc' }, t('opt_trAlwaysDesc')),
    ]),
    button,
  ]);
}

/** 「翻译」小节：返回标题与卡片两个节点；onboarding 不调用。 */
export function translationSection(
  settings: TranslationSettings,
  supported: boolean,
  onChange: (patch: Partial<TranslationSettings>) => void,
): Child[] {
  const title = h('div', { class: 'fl section' }, t('opt_trTitle'));
  if (!supported) {
    return [
      title,
      h('div', { class: 'keys' }, [
        h('div', { class: 'callout' }, [iconEl('info', 16, 'ic'), h('span', {}, t('opt_trUnsupported'))]),
        targetRow(settings, true, onChange),
        alwaysRow(settings, true, onChange),
      ]),
    ];
  }
  return [
    title,
    h('div', { class: 'keys' }, [
      targetRow(settings, false, onChange),
      alwaysRow(settings, false, onChange),
      h('div', { class: 'inset' }, [h('b', {}, t('opt_trPrivacyLead')), t('opt_trPrivacy')]),
    ]),
  ];
}
