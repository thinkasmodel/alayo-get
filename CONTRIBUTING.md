# Contributing to Alayo Get

Thanks for your interest. This file covers how the project checks changes and where decisions are written down.

## Issues

Report bugs and propose features in [GitHub Issues](https://github.com/thinkasmodel/alayo-get/issues). For a bug, include the browser and version, the page you were saving (if it's public), what you expected and what was written to your library folder.

Security problems go to the address in [SECURITY.md](SECURITY.md), not to a public issue.

## The verification contract

`verify.sh` at the repository root is the definition of "it works":

```sh
bash verify.sh fast   # typecheck + lint + unit tests; run it after every change
bash verify.sh full   # fast + production build + manifest checks; run it before you open a pull request
```

A pull request is ready when `bash verify.sh full` passes on it. The manifest check (`scripts/check-manifest.mjs`) enforces conventions from `DESIGN.md` and the ADRs, such as the permission list, the default shortcut and the rule that the capture script is injected on demand rather than declared in the manifest. If a change needs one of those conventions to change, change the decision record first (see below).

## Two test environments

Vitest runs two projects, configured in `vitest.config.ts`:

- `*.test.ts` runs in **Node**. This is for service-worker code (saving, file writing, routing). Service workers have no DOM, so code that touches the DOM by mistake fails here.
- `*.dom.test.ts` runs in **jsdom**. This is for code that runs in the page (extraction, Markdown conversion) and for the extension's own pages.

Put a new test in the environment its code runs in. Site-specific extraction tests use saved HTML samples in `tests/fixtures/`.

## Tests are not to be weakened

Do not edit, delete or skip a test or an assertion to make a check pass. If you believe an existing test is wrong, say so in the pull request and explain why, as a separate change from the code that depends on it.

## Domain language and decisions

- [`CONTEXT.md`](CONTEXT.md) defines the project's vocabulary: library, clip, source, the five clip kinds (article, bookmark, media, stream, quote) and so on. Use these terms in code, strings and discussion, and avoid the alternatives each entry lists. If a change introduces a new concept, add it there.
- [`docs/adr/`](docs/adr/) holds the architecture decision records. Read the relevant ones before changing behavior they cover. If your change reverses or extends a decision, add a new ADR or a dated revision note to the existing one, in the same pull request.
- [`DESIGN.md`](DESIGN.md) is the interface specification. Changes to anything users see (panel, page toast, setup page, settings) should follow it; propose changes to the design itself in an issue before implementing them.

These documents and the source code comments are written in Chinese; issues and pull requests are welcome in English or Chinese.

## Interface strings

All user-facing text lives in `public/_locales/{en,zh_CN,zh_TW}/messages.json`. Add every new key to all three files (`zh_TW` has the same content as `zh_CN`); the manifest check verifies that the keys the manifest uses exist in each.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
