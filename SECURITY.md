# Security policy

## Reporting a vulnerability

Please report security problems by email to **hello@alayo.ai**, not through a public GitHub issue.

Include what you found, the steps or a page that reproduces it, and the extension version (shown on `chrome://extensions`). We will acknowledge your report within 7 days and keep you informed while we work on a fix.

## Scope

Alayo Get runs with access to all websites, injects scripts into the pages you save, and writes files into a local folder you choose. Reports we especially want to hear about:

- a web page being able to make the extension write, overwrite or read files outside what the user asked to save;
- a web page being able to trigger a save, or a network request from the extension, without a user action;
- data from one site leaking to another site through the extension.

## Supported versions

Only the latest version published on the Chrome Web Store, and the `main` branch of this repository, receive security fixes.
