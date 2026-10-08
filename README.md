# Alayo Get

Alayo Get is a Chrome extension that saves web pages, X posts, links, images, videos and selected text as plain Markdown and media files in a local folder you choose.

It covers the same ground as Obsidian Web Clipper and MarkDownload, and uses the same extraction engine as Obsidian Web Clipper ([defuddle](https://github.com/kepano/defuddle)). Compared with those, and with full-page archivers like SingleFile:

- **Not tied to any note-taking app.** The output is plain Markdown with YAML frontmatter, plus the original media files. Nothing about it assumes a particular app.
- **Writes straight into a folder you pick.** It uses the File System Access API to write into any local folder, not into your Downloads folder, and without a save dialog for each clip.
- **X threads become one file.** When you save a post, the author's consecutive self-replies are collected and merged into a single article.
- **Media clips keep their source.** Images, audio and video files, and PDFs are saved as the original files, with a small metadata sidecar that records the page they came from.
- **Quotes link back to the exact passage.** Selected text is saved with a `#:~:text=` text-fragment link that jumps back to that spot on the original page.
- **English and Chinese interface.** The interface follows the browser language: Simplified Chinese for Chinese browsers, English for everything else.

**Install:** Chrome Web Store <!-- CWS_URL --> (Coming soon), or [load it unpacked](#install).

## What it saves

Every save produces one visible file in your library folder, called a *clip*. There are five kinds:

| Kind | What you get |
|---|---|
| **article** | The page's main text (or an X post, thread or X Article) converted to Markdown, with its images downloaded next to it. |
| **bookmark** | The link, title, description and cover image, without the body text. A right-clicked link is saved this way, and an article whose text can't be extracted falls back to a bookmark (`extract: fallback`). |
| **media** | The image, audio or video file (up to 100 MB) or PDF itself, unchanged, named `Page title - original-file-name.ext`. |
| **stream** | A Markdown file for an online video or audio (YouTube, Bilibili, X video, cloud-drive share pages, or direct media links over 100 MB): cover, duration, author, description and the original link. The media itself is not downloaded. |
| **quote** | Text you selected and saved. All quotes from the same page are appended to one `Quotes - Page title.md`, each as a blockquote with the time it was saved and a link back to the passage. |

You can save from the toolbar panel, the right-click menu (page, link, image, video, audio, selected text) or the keyboard shortcut `Alt+Shift+S`. After saving, you can add a title, tags and a note.

Layout of the library folder:

```text
your-library/
├── Some article title.md
├── @handle - first words of the post.md
├── Page title - photo.jpg
├── Quotes - Page title.md
├── .assets/<id>/      images and covers used by an article, bookmark or stream clip
└── .meta/<id>.json    metadata sidecar for a media clip (source page, media URL, tags, note)
```

All clips sit flat in the root; there are no date subfolders. Markdown clips carry frontmatter with `id` (a ULID), `source` (the canonical URL), `medium`, `title`, `author`, `published`, `captured`, `site`, `tags`, `note` and `extract`. The two support folders start with a dot, so macOS and Linux hide them by default; Windows Explorer shows them.

## Privacy

Everything you save is written only to the local folder you chose; nothing is uploaded. The extension has no account, no analytics and no telemetry, and it only contacts the websites whose content you are saving, at the moment you save. Full policy: [alayo.ai/en/get/privacy](https://alayo.ai/en/get/privacy).

## What to do with the files

They are ordinary Markdown and media files, so any editor, note-taking tool, file manager or script can read them.

If you use [Alayo Workbench](https://alayo.ai/en/workbench/), the Mac app, you can add your library folder as a watched folder. New clips then show up in Workbench, one card per clip, and you can organize them on its canvas. This is optional; the extension's settings page has a collapsed section that explains the setup.

## Install

**Chrome Web Store:** <!-- CWS_URL --> Coming soon.

**Load unpacked (developer mode):**

1. `npm i` and `npm run build`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.

On first install the extension opens its setup page, where you choose the library folder. After a browser restart, Chrome asks for access to the folder once more; choose to allow it on every visit so later saves don't ask again.

The extension is Manifest V3 and should work in other Chromium-based browsers.

## Development

Requires Node.js 22 or later.

```sh
npm i                 # install dependencies (also runs `wxt prepare`)
npm run dev           # development build with live reload
npm run build         # production build into .output/chrome-mv3
bash verify.sh fast   # typecheck + lint + unit tests
bash verify.sh full   # fast + production build + manifest checks
```

- Tests run in two Vitest environments (see the comment in `vitest.config.ts`): `*.test.ts` runs in Node and covers the service-worker side, so accidental DOM use fails there; `*.dom.test.ts` runs in jsdom and covers the page side (extraction, Markdown conversion) and the extension pages.
- Interface and file strings live in `public/_locales` (`en`, `zh_CN`, `zh_TW`).
- Source code comments are written in Chinese.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Docs

- [`CONTEXT.md`](CONTEXT.md): the domain vocabulary (library, clip, the five clip kinds, and so on).
- [`docs/adr/`](docs/adr/): architecture decision records.
- [`DESIGN.md`](DESIGN.md): interface design rules and tokens.
- [`docs/PRD.md`](docs/PRD.md): product requirements.

These documents are written in Chinese.

## License

[Apache License 2.0](LICENSE). Copyright 2026 ThinkAsModel Limited. Third-party components are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

---

## 中文简介

Alayo Get 是一个 Chrome 扩展，把网页、X 帖子、链接、图片、视频和选中的文字存成普通的 Markdown 和媒体文件，放进你选定的本地文件夹（剪藏库）。不绑定任何笔记软件；用 File System Access API 直接写进文件夹，不经下载目录；X 作者串自动合并成一篇；媒体剪藏带元数据侧档；摘录带 `#:~:text=` 链接，能跳回原文位置；界面跟随浏览器语言显示简体中文或英文。

存下的文件任何编辑器和笔记工具都能读。用 [Alayo Workbench](https://alayo.ai/zh/workbench/) 的话，可以把剪藏库加为监控目录，在画布上整理剪藏。隐私政策见 [alayo.ai/zh/get/privacy](https://alayo.ai/zh/get/privacy)。
