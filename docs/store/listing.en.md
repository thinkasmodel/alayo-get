# Chrome Web Store listing (English)

Copy for the Chrome Web Store developer console. The store renders the detailed description as plain text, so it is kept in a `text` block below and uses plain line breaks and hyphens. Positioning matches `README.md`; other extensions are not compared by name; no other extension is named.

## Name

Alayo Get

## Short description

Limit: 132 characters. This text: 116 characters (counted with Python `len()`).

```text
Save web pages, X threads, images, videos and quotes as plain Markdown and media files in a local folder you choose.
```

## Category

Productivity (suggested).

## Language

English (primary listing). The Chinese listing is in `listing.zh.md`.

## Detailed description

```text
Alayo Get saves what you find on the web as ordinary files in a folder on your computer: Markdown for articles, posts, links and quotes, and the original files for images, videos, audio and PDFs.

Your files, not an app's
- The output is plain Markdown with YAML frontmatter, plus the original media files. It is not tied to any note-taking app.
- It writes straight into a local folder you pick, using the browser's File System Access API. Nothing goes through your Downloads folder, and there is no save dialog for each clip.

What it saves
- Articles: the main text of a page converted to Markdown, with its images saved alongside. Text extraction uses defuddle, an open-source engine.
- X posts: single posts, X Articles and quoted posts. An author's thread of consecutive self-replies is merged into one file.
- Bookmarks: the link, title, description and cover image. If a page's text can't be extracted, the save falls back to a bookmark instead of failing.
- Images, audio, video and PDFs: saved as the original file, with a small metadata file that records the page it came from.
- Online videos (YouTube, Bilibili, X video and cloud-drive share pages): a Markdown file with the cover, duration, author, description and link.
- Quotes: select text and save it. Quotes from the same page collect in one file, and each one links back to the exact passage with a text-fragment link (#:~:text=).

How you save
- Toolbar button, right-click menu (page, link, image, video, audio, selected text) or the shortcut Alt+Shift+S.
- After saving you can add a title, tags and a note.
- Pages you have already saved are recognized: you are told when you saved them, and you can still save a new snapshot.
- The interface is in English or Simplified Chinese, following your browser language.

What to do with the files
They are ordinary Markdown and media files, so any editor, note-taking tool or file manager can open them. If you use Alayo Workbench, the Mac app, you can add your library folder as a watched folder: new clips show up there one card per clip, and you can organize them on its canvas. This is optional.

Privacy
Everything is written to the folder you chose. There is no account, no analytics and no telemetry, and the extension only contacts the websites whose content you are saving, when you save. Privacy policy: https://alayo.ai/en/get/privacy

Open source under the Apache License 2.0: https://github.com/thinkasmodel/alayo-get
```

## Links for the listing form

- Privacy policy URL: https://alayo.ai/en/get/privacy
- Homepage / support URL: https://github.com/thinkasmodel/alayo-get
- Support email: hello@alayo.ai
