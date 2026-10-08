# Chrome Web Store privacy practices: permission justifications

English text for the "Privacy practices" tab of the developer console: the single-purpose description, one justification per permission, and the remote-code declaration. The permissions are the ones declared in `wxt.config.ts` (`storage`, `scripting`, `contextMenus`, `activeTab`, `tabs`, host permission `<all_urls>`). Each paragraph was checked against the source on 2026-10-08; the file references in brackets are for maintainers and are not part of the text to paste.

## Single purpose

Alayo Get has one purpose: when the user asks, it saves the web content in front of them (a page, an X post or thread, a link, an image, audio, video, PDF, or selected text) as plain Markdown and media files in a local folder the user chose. Every permission below serves only this saving flow. The extension has no other features, shows no ads, and does not change how web pages look or behave apart from a short confirmation message after a save and, on X post pages, scrolling to load the rest of a thread while that save runs.

## Permission justifications

### Host permission: `<all_urls>`

Users can save content from any website, and the files a page refers to (images, cover images, PDFs, audio and video) are hosted on arbitrary domains and content servers. The extension's service worker therefore needs to make cross-origin requests to those addresses. It does so only as part of a save the user started from the toolbar button, the keyboard shortcut or the right-click menu: (1) it fetches the target page of a link the user right-clicked, to read its title, description and cover image; (2) for YouTube and Bilibili videos, it fetches the video page and reads the title, author, duration, description and cover from the HTML as text; (3) it downloads the images in the article being saved, cover images, and the image, audio, video or PDF file the user chose to save, and writes them to the user's local folder; (4) before downloading a media file, it sends a HEAD request (or a GET that is aborted once the headers arrive) to check the file size against the 100 MB limit. Host access also lets the extension inject its capture script into the page being saved (see `scripting`). No request is made in the background or on pages the user is not saving, and nothing is sent to any server other than the site the content comes from. Media downloads send a site's cookies only when the media file is on the same site as the page being saved; media on other sites is fetched without cookies. [`src/sw/saveClip.ts` `captureLink`, image download; `src/sw/saveStream.ts` `captureStreamPage`; `src/sw/saveMedia.ts` `probeMedia`, download]

### `scripting`

Used to run the extension's own packaged code in the tab the user is saving, at the moment of the save. The service worker calls `chrome.scripting.executeScript` to inject `content-scripts/capture.js`, which extracts the page's main content (with the bundled defuddle library), converts it to Markdown (with the bundled Turndown library), reads the selected text and builds a link back to it when the user saves a quote, and shows the small confirmation message with an "add note" button. On x.com post pages it also runs one small packaged function in the page's main world; that function reads data the X page already holds in memory (the original address of a quoted post, the real URLs behind t.co short links, video durations) and writes it onto the post element as a `data-alayo-x` attribute for the capture script to read. It makes no network requests and does not call X's API. On X post pages the capture script may also scroll the page and click X's own "show replies" control to load the rest of the author's thread, for at most 50 posts or 15 seconds and only while that save is running, then scroll back to where the user was. The capture script is not declared in the manifest, so nothing is injected into pages the user does not save. [`src/entrypoints/background.ts` `injectCapture`, `installAnnotator`; `src/page/x/annotate.ts`]

### `tabs`

Used to read the URL and title of the tab being saved. The URL is the clip's source and is used to decide what kind of clip to create (a normal page, a video platform page, or a PDF or media file opened directly); the title names the file, and on pages where scripts cannot run it is all the extension saves, as a bookmark. The extension finds the active tab with `chrome.tabs.query` when the user presses the shortcut or opens the toolbar panel, exchanges messages with its own capture script in that tab, and uses `chrome.tabs.create` only to open its own settings page (for example, to re-authorize the library folder). It does not read the user's browsing history or observe tabs the user is not saving. [`src/entrypoints/background.ts`, `src/entrypoints/popup/main.ts`]

### `activeTab`

Gives the extension temporary access to the tab the user is acting on when they click the toolbar button, press the save shortcut or choose a right-click menu item, so it can read that tab and run the capture script in it for this one save. [`src/entrypoints/background.ts`]

### `storage`

Used for the extension's own local records, which never leave the device. `chrome.storage.local` keeps the saved-records table (for each saved source URL: the clip's id, file name, title, kind, tags and save time), used to show recent saves, to tell the user that a page was already saved, and to suggest tags they used before; it also keeps a record of quote saves that were already written, so a retried quote is not written twice. `chrome.storage.session` keeps short-lived data while saves are in progress: saves waiting for folder access to be re-granted (written once the user grants it), the content behind the "Retry" and "Save new snapshot" buttons on the confirmation message, and the quote records used when the user adds a note. The handle to the chosen library folder is kept in the extension's IndexedDB, which needs no separate permission. [`src/io/savedIndex.ts`, `src/io/quoteOps.ts`, `src/io/pending.ts`, `src/io/toastRequests.ts`, `src/io/quoteEntries.ts`; folder handle: `src/io/library.ts`]

### `contextMenus`

Used to add "Save to Alayo Get" items to the right-click menu for a page, a link, an image, a video, an audio element and selected text. Choosing one of these items is how the user saves a specific link, media file or text selection. [`src/sw/menus.ts`, `src/sw/route.ts`]

## Remote code

No, the extension does not use remote code. All JavaScript it runs is included in the extension package, including the bundled third-party libraries (defuddle, Turndown, idb-keyval, text-fragments-polyfill, ulid). It does not load scripts from any server, does not use `eval()` or `new Function()`, and the scripts it injects with `chrome.scripting.executeScript` are files and functions from the package. Link target pages and video pages fetched during a save are read as text to extract metadata; their scripts are never executed by the extension.
