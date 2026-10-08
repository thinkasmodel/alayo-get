// 内联 SVG 图标（1.5px 描边，取自 designs/alag-2-m1/*.dc.html；file、audio、video、play、quote 取自
// designs/alag-4-media/Main.dc.html 的“预览卡字形”）。颜色走 currentColor，由 CSS 决定。

const svg = (size: number, body: string, extra = 'stroke-linecap="round" stroke-linejoin="round"', strokeWidth = '1.5') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" ${extra} aria-hidden="true" focusable="false">${body}</svg>`;

export type IconName =
  | 'brand'
  | 'settings'
  | 'check'
  | 'stepCheck'
  | 'spinner'
  | 'clock'
  | 'link'
  | 'doc'
  | 'lock'
  | 'folder'
  | 'close'
  | 'chipClose'
  | 'image'
  | 'file'
  | 'audio'
  | 'video'
  | 'play'
  | 'quote'
  | 'chevronRight';

const bodies: Record<IconName, (size: number) => string> = {
  brand: (s) =>
    svg(s, '<path d="M12 3v11"></path><path d="M7.5 9.5 12 14l4.5-4.5"></path><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14"></path>'),
  settings: (s) =>
    svg(
      s,
      '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path><circle cx="16" cy="7" r="2"></circle><circle cx="10" cy="17" r="2"></circle>',
      'stroke-linecap="round"',
    ),
  check: (s) => svg(s, '<circle cx="12" cy="12" r="9"></circle><path d="m8 12.5 2.8 2.8L16.5 9.5"></path>'),
  stepCheck: (s) => svg(s, '<path d="m6 12.5 4 4L18 8.5"></path>', 'stroke-linecap="round" stroke-linejoin="round"', '2'),
  spinner: (s) =>
    svg(s, '<circle cx="12" cy="12" r="9" opacity=".25"></circle><path d="M21 12a9 9 0 0 0-9-9"></path>', 'stroke-linecap="round"'),
  clock: (s) => svg(s, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>'),
  link: (s) =>
    svg(
      s,
      '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"></path><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"></path>',
    ),
  doc: (s) =>
    svg(s, '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M9 13h6M9 17h4"></path>'),
  lock: (s) => svg(s, '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>'),
  folder: (s) =>
    svg(s, '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>', 'stroke-linejoin="round"'),
  close: (s) => svg(s, '<path d="M6 6l12 12M18 6 6 18"></path>', 'stroke-linecap="round"'),
  chipClose: (s) => svg(s, '<path d="M6 6l12 12M18 6 6 18"></path>', 'stroke-linecap="round"', '2'),
  image: (s) =>
    svg(s, '<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.5"></circle><path d="m21 16-5-5-8 8"></path>'),
  // ALAG-4 预览卡字形：PDF（带折角的文档）、音频（音符）、视频（摄像机）、流媒体（圆圈内三角）、摘录（引号）
  file: (s) =>
    svg(
      s,
      '<path d="M6 3h8l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"></path><path d="M14 3v5h5"></path><path d="M8.5 13h7M8.5 16.5h4.5"></path>',
    ),
  audio: (s) => svg(s, '<path d="M9 18V6l10-2v12"></path><circle cx="6.5" cy="18" r="2.5"></circle><circle cx="16.5" cy="16" r="2.5"></circle>'),
  video: (s) => svg(s, '<rect x="3" y="5.5" width="13" height="13" rx="2"></rect><path d="m16 10.5 5-3v9l-5-3"></path>'),
  play: (s) => svg(s, '<circle cx="12" cy="12" r="9"></circle><path d="M10 8.8v6.4l5.2-3.2z"></path>'),
  quote: (s) =>
    svg(s, '<path d="M5 18v-5.5C5 9 6.8 6.8 10 6"></path><path d="M5 13h4v5H5z"></path><path d="M14 18v-5.5C14 9 15.8 6.8 19 6"></path><path d="M14 13h4v5h-4z"></path>'),
  // ALAG-6 选项页 Workbench 小节的展开箭头
  chevronRight: (s) => svg(s, '<path d="m9 6 6 6-6 6"></path>', 'stroke-linecap="round" stroke-linejoin="round"', '1.8'),
};

/** 返回图标的 SVG 字符串。 */
export function icon(name: IconName, size = 16): string {
  return bodies[name](size);
}
