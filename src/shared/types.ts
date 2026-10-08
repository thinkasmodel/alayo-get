// 剪藏管线共用的类型。字面量与 tasks/briefs/ALAG-2A.md「协议」段冻结一致，Brief B 依赖。

/** 剪藏的 medium（M1 只用到 web 与 link；x 是 X 专门适配，ALAG-3；其余为 ALAG-4 媒体、流媒体与摘录）。 */
export type Medium = 'web' | 'link' | 'x' | 'image' | 'audio' | 'video' | 'pdf' | 'quote';

/** 媒体剪藏的类别（ALAG-4）。 */
export type MediaKind = 'image' | 'audio' | 'video' | 'pdf';

/** 流媒体剪藏的平台（ALAG-4）；other 是超过 100MB 或拿不到大小的音视频直链。 */
export type Platform = 'youtube' | 'bilibili' | 'x' | 'baidupan' | '115' | 'quark' | 'other';

/** 媒体剪藏的采集信息（ALAG-4）。 */
export interface MediaCaptureInfo {
  kind: MediaKind;
  /** 媒体地址：文件本身的 URL（http(s) 或 data:）。 */
  url: string;
  /** 原文件名（含扩展名，可能为空，下载后按 content-type 补）。 */
  fileName: string;
}

/** 流媒体剪藏的采集信息（ALAG-4）。 */
export interface StreamCaptureInfo {
  platform: Platform;
  /** 平台内 ID；直链为空串。 */
  videoId: string;
  embed: string;
  /** 秒；取不到为 null。 */
  duration: number | null;
  /** 流媒体是视频还是音频，决定 medium。 */
  medium: 'video' | 'audio';
  /** 只有直链（platform other）有：所在网页与它的标题。 */
  page?: { url: string; title: string };
  /** 只有直链有：文件大小；拿不到为 null。 */
  bytes?: number | null;
}

/** 摘录剪藏的采集信息（ALAG-4）。 */
export interface QuoteCaptureInfo {
  /** 摘录正文 Markdown（还没加 `> `）。 */
  markdown: string;
  /** 带 `#:~:text=` 的完整链接；生成不了为 null。 */
  fragmentUrl: string | null;
  /** 选中的那一刻（ISO）。暂存补写时也用它，不用补写时刻。 */
  selectedAt: string;
  /** 这次摘录操作的 id（SW 生成 Capture 时填）；暂存补写、页面提示重放沿用，用来识别已落盘的同一次操作。旧 Capture 没有。 */
  opId?: string;
}

/** 抽取状态。 */
export type ExtractState = 'full' | 'partial' | 'fallback';

/** X 剪藏的形态：单帖、作者串、长文（ALAG-3）。 */
export type XForm = 'post' | 'thread' | 'article';

/** X 剪藏只存了一部分的原因。 */
export interface XPartial {
  /** 作者串超过 50 条，只存了前 50 条 */
  limit: boolean;
  /** 15 秒内没有加载完 */
  timeout: boolean;
  /** 被截断（“显示更多”）的帖子条数 */
  truncated: number;
}

/** X 专门适配的采集信息。 */
export interface XCaptureInfo {
  form: XForm;
  /** 存下的帖子条数（长文为 1） */
  posts: number;
  /** null 表示完整 */
  partial: XPartial | null;
  /** 只有长文有：正文一级标题用的长文标题，不带 @handle 前缀 */
  heading?: string;
}

/** 页面采集结果：页面内采集脚本回给 service worker，或由 service worker 自己拼出（右键链接、不能注入的页面）。 */
export interface Capture {
  url: string;
  title: string;
  site: string;
  author: string;
  published: string;
  description: string;
  coverUrl: string;
  /** 正文 Markdown；为 null 时存成书签剪藏。 */
  markdown: string | null;
  textLength: number;
  kind: 'page' | 'link' | 'uninjectable' | 'media' | 'stream' | 'quote';
  /**
   * 仅 kind 为 'link' 或 'stream' 时有意义：service worker 是否抓到了目标页（流媒体剪藏：是否取到了元数据）。
   * true → extract: full；false 或缺省 → extract: partial。
   * （brief 冻结的 Capture 无法区分这两种情况，见 tasks/implementation-notes.md Deviations。）
   */
  fetched?: boolean;
  /** 只有 X 专门适配会填（此时 kind 仍是 'page'）。 */
  x?: XCaptureInfo;
  /** 媒体剪藏（kind 'media'）：此时 url 是所在网页（出处），文件地址在 media.url。 */
  media?: MediaCaptureInfo;
  /** 流媒体剪藏（kind 'stream'）：此时 url 是平台视频页的规范地址；直链时是直链本身。 */
  stream?: StreamCaptureInfo;
  /** 页面采集脚本回传的 document.contentType；不是 HTML 时按媒体剪藏处理（ALAG-4）。 */
  contentType?: string;
  /** 摘录剪藏（kind 'quote'）：此时 url 是页面地址，title 是页面标题。 */
  quote?: QuoteCaptureInfo;
}

export interface Preview {
  title: string;
  site: string;
  source: string;
  medium: 'web' | 'link' | MediaKind | 'stream' | 'quote';
}

export interface ClipSummary {
  id: string;
  /** 剪藏库根目录下的文件名，如 `标题.md`。 */
  file: string;
  title: string;
  medium: Medium;
  site: string;
  /** 规范化出处。 */
  source: string;
  extract: ExtractState;
  /** 成功存到本地的图片张数（含封面）。 */
  imageCount: number;
  /** 下载失败、保留远程地址的图片张数（含封面）。 */
  imageFailures: number;
  tags: string[];
  note: string;
  /** ISO 时间。 */
  savedAt: string;
  /** X 剪藏：从 Capture 原样带过来；service worker 重启后重建的剪藏信息里没有。 */
  x?: XCaptureInfo;
  /** 媒体剪藏：类别与字节数。此时 source 是已保存记录的键（规范化的媒体地址），site 取所在网页的域名，file 是媒体文件名。 */
  media?: { kind: MediaKind; bytes: number };
  /** 流媒体剪藏：平台、时长、视频或音频；超过 100MB 或拿不到大小的直链带 oversize。 */
  stream?: { platform: Platform; duration: number | null; medium: 'video' | 'audio'; oversize?: { bytes: number | null } };
  /**
   * 摘录剪藏（ALAG-4）：此时 id 是这一条摘录的新 ULID，fileId 是摘录文件 frontmatter 的 id；entry 是第几条（从 1 起）；
   * anchor 是这条摘录下面那一行时间与链接的原文（写批注时据此定位）；fragment 为 false 表示链接只到页面；
   * recreated 为 true 表示原摘录文件不在了、这次新建。note 是这一条的批注，file 是摘录文件名。
   */
  quote?: { fileId: string; entry: number; anchor: string; fragment: boolean; recreated: boolean };
}

/** 已保存记录的一条。 */
export interface SavedEntry {
  id: string;
  file: string;
  title: string;
  medium: Medium;
  source: string;
  savedAt: string;
  tags: string[];
}

/** 已保存记录：规范化出处 → 最新一条。 */
export type SavedIndexData = Record<string, SavedEntry>;

export interface TagCount {
  tag: string;
  count: number;
}

export type SavingProgress = {
  phase: 'extract' | 'images' | 'write' | 'download';
  /** download 阶段为已下载与总字节（总数未知时 total 缺省）。 */
  done?: number;
  total?: number;
  /** download 阶段：下载的媒体类别，供说明行写类别。 */
  kind?: MediaKind;
};

export type PanelState =
  | { state: 'saving'; preview: Preview; progress: SavingProgress }
  | { state: 'saved' | 'fallback'; clip: ClipSummary; tagSuggestions: TagCount[] }
  | { state: 'duplicate'; preview: Preview; previous: SavedEntry }
  | { state: 'failed'; preview: Preview; error: { name: string; message: string } }
  | { state: 'needs-permission'; preview: Preview };

export type SavingState = Extract<PanelState, { state: 'saving' }>;

/** 一次保存的结果（不含 'saving'）。 */
export type SaveOutcome = Exclude<PanelState, SavingState>;

/** 面板与页面提示可改的字段。 */
export interface EditFields {
  title?: string;
  tags?: string[];
  note?: string;
}

/** 授权暂存队列里的一条。 */
export interface PendingSave {
  capture: Capture;
  snapshot: boolean;
}
