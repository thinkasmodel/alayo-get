// 面板的标签输入（DESIGN.md §3.2 定稿 2B）：chip ＋ 历史标签建议 ＋ "新建标签"。
import { tagSuggestions } from '@/core/tags';
import { t, tn } from '@/shared/i18n';
import type { SavedIndexData, TagCount } from '@/shared/types';
import { h, iconEl } from '../dom';

export const SUGGESTION_LIMIT = 8;

export interface TagInputOptions {
  /** input 的 id，给外面的 `<label for>` 用。 */
  id: string;
  initial: string[];
  /** 读已保存记录；第一次输入时调用，结果缓存。 */
  loadIndex(): Promise<SavedIndexData>;
  /** 标签列表变化（添加或删除）后调用，参数是新的全量列表。 */
  onChange(tags: string[]): void;
}

export interface TagInput {
  el: HTMLElement;
  input: HTMLInputElement;
  tags(): string[];
}

type Item = { kind: 'tag'; tag: string; count: number } | { kind: 'new'; tag: string };

export function createTagInput(options: TagInputOptions): TagInput {
  const tags: string[] = [];
  for (const raw of options.initial) {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }

  const listId = `${options.id}-list`;
  let items: Item[] = [];
  let active = 0;
  let open = false;
  let indexPromise: Promise<SavedIndexData> | null = null;
  let query = 0;

  const chips = h('span', { class: 'chips' });
  const input = h('input', {
    id: options.id,
    class: 'taginput',
    type: 'text',
    placeholder: t('tag_placeholder'),
    autocomplete: 'off',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
  });
  const box = h('div', { class: 'inp tags' }, [chips, input]);
  const list = h('div', { class: 'drop', id: listId, role: 'listbox', hidden: true });
  const el = h('div', { class: 'tagfield' }, [box, list]);

  box.addEventListener('mousedown', (e) => {
    // 点输入框空白处时把焦点给 input；点 chip 上的删除按钮不拦
    if (e.target === box || e.target === chips) {
      e.preventDefault();
      input.focus();
    }
  });

  const renderChips = () => {
    chips.replaceChildren(
      ...tags.map((tag) =>
        h('span', { class: 'chip' }, [
          h('span', { class: 'chiptext' }, tag),
          h(
            'button',
            {
              type: 'button',
              class: 'chipx',
              'aria-label': t('tag_remove', tag),
              onclick: () => removeTag(tag),
            },
            iconEl('chipClose', 10),
          ),
        ]),
      ),
    );
  };

  const close = () => {
    open = false;
    items = [];
    active = 0;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const renderList = () => {
    if (items.length === 0) {
      close();
      return;
    }
    open = true;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.replaceChildren(
      ...items.map((item, i) => {
        const selected = i === active;
        const label = item.kind === 'new' ? t('tag_create', item.tag) : item.tag;
        const hint = item.kind === 'new' ? t('tag_return') : tn('tag_count', item.count);
        const option = h(
          'button',
          {
            type: 'button',
            id: `${listId}-${i}`,
            class: selected ? 'opt on' : 'opt',
            role: 'option',
            tabindex: '-1',
            'aria-selected': selected ? 'true' : 'false',
            onclick: () => choose(item),
          },
          [h('span', { class: 'optlabel' }, label), h('em', {}, hint)],
        );
        // 保持焦点在输入框上，点击仍然生效
        option.addEventListener('mousedown', (e) => e.preventDefault());
        return option;
      }),
    );
    input.setAttribute('aria-activedescendant', `${listId}-${active}`);
  };

  const emit = () => options.onChange([...tags]);

  const addTag = (raw: string): boolean => {
    const tag = raw.trim();
    if (!tag || tags.includes(tag)) return false;
    tags.push(tag);
    renderChips();
    input.value = '';
    close();
    emit();
    return true;
  };

  function removeTag(tag: string) {
    const i = tags.indexOf(tag);
    if (i === -1) return;
    tags.splice(i, 1);
    renderChips();
    emit();
    input.focus();
  }

  function choose(item: Item) {
    addTag(item.tag);
    input.focus();
  }

  const buildItems = (index: SavedIndexData, prefix: string): Item[] => {
    const suggestions: TagCount[] = tagSuggestions(index, prefix, SUGGESTION_LIMIT).filter((s) => !tags.includes(s.tag));
    const result: Item[] = suggestions.map((s) => ({ kind: 'tag', tag: s.tag, count: s.count }));
    const known = Object.values(index).some((entry) => entry.tags.includes(prefix));
    if (!known && !tags.includes(prefix)) result.push({ kind: 'new', tag: prefix });
    return result;
  };

  const update = async () => {
    const prefix = input.value.trim();
    const seq = ++query;
    if (!prefix) {
      close();
      return;
    }
    indexPromise ??= options.loadIndex().catch((err) => {
      console.warn('[Alayo Get] 读取已保存记录失败，标签建议为空', err);
      indexPromise = null;
      return {};
    });
    const index = await indexPromise;
    // 等待期间又输入了新内容，以最新一次为准
    if (seq !== query || input.value.trim() !== prefix) return;
    items = buildItems(index, prefix);
    active = 0;
    renderList();
  };

  input.addEventListener('input', () => void update());
  input.addEventListener('blur', () => close());
  input.addEventListener('keydown', (e) => {
    // 输入法组字时的回车、方向键归输入法
    if (e.isComposing || e.keyCode === 229) return;
    switch (e.key) {
      case 'ArrowDown':
        if (!open) return;
        e.preventDefault();
        active = Math.min(active + 1, items.length - 1);
        renderList();
        return;
      case 'ArrowUp':
        if (!open) return;
        e.preventDefault();
        active = Math.max(active - 1, 0);
        renderList();
        return;
      case 'Enter': {
        e.preventDefault();
        const item = open ? items[active] : undefined;
        if (item) choose(item);
        else addTag(input.value);
        return;
      }
      case 'Escape':
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'Backspace':
        if (input.value === '' && tags.length > 0) {
          e.preventDefault();
          const last = tags[tags.length - 1];
          if (last !== undefined) removeTag(last);
        }
        return;
    }
  });

  renderChips();
  return { el, input, tags: () => [...tags] };
}
