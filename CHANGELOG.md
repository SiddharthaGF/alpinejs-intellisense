# Changelog

All notable changes to **Alpine Language Tools** are documented here.

## 0.0.1 — initial release

### Stage 1 — scaffold
- Generated project via `yo code`, normalized into a pnpm workspace with the
  mandatory layout (`packages/vscode`, `packages/language-server`,
  `packages/language-core`, `packages/alpine-spec`).
- TypeScript strict, esbuild, ESLint flat config, Vitest, GitHub-aware
  scripts (`build`, `watch`, `typecheck`, `lint`, `test`, `test:unit`, `package`,
  `clean`).
- Documentation skeleton: `README.md`, `CONTRIBUTING.md`, `docs/architecture.md`.

### Stage 2 — LSP client + server
- `vscode-languageclient` boots a stdio server pointing at
  `packages/language-server/dist/main.js`.
- Commands: `Alpine: Restart Language Server`, `Alpine: Show Output`.
- Settings: `alpineLanguageTools.enable`,
  `alpineLanguageTools.trace.server`.
- Integration suite: `vscode-test` launches Electron, opens an HTML doc,
  awaits the server, pings it, restarts it.

### Stage 3 — directive parser
- Tolerant HTML scanner powered by `vscode-html-languageservice`.
- `OffsetRange`, `AlpineDirectiveNode`, `DirectiveValueKind` exported.
- 18 Alpine directives registered in `alpine-spec` with aliases, modifiers,
  value kinds, documentation.
- Normalises `x-on:click.prevent`, `@click.prevent`, `x-bind:href`, `:href`.
- HTML Custom Data emitted on every build via
  `pnpm --filter @alpine-language-tools/alpine-spec run build`.
- LSP completionProvider + hoverProvider, with trigger characters
  `.`, `:`, `@`.

### Stage 4 — virtual TypeScript documents
- `VirtualCodeAdapter`, `SourceMapAdapter`, `LanguageServiceAdapter`
  interface stubs in `language-core/virtual/`.
- `generateAlpineVirtualCode` produces a read-only TS document with exact
  offset mappings per expression; identifiers prefixed `__alpine_internal_*`
  are filtered from completion and diagnostics.
- `Alpine: Show Virtual JavaScript` opens the virtual in an untitled
  TypeScript editor.

### Stage 5 — TypeScript Language Service
- `x-data` parsed with the TypeScript compiler AST; virtual emits
  `let prop: type; function name() {}` top-level declarations.
- In-memory `ts.LanguageService` runs over the virtual document; diagnostics,
  hover, completion, definition, document highlights are translated back
  to HTML offsets via the `SourceMapAdapter`.
- Filter rejects diagnostics that wrap internal identifiers.
- `$event: Event` parameter exposed on every handler.
- TextMate injection grammar at
  `packages/vscode/syntaxes/alpine-injection.tmLanguage.json`.

### Stage 6 — scopes, `x-model`, `init()`, Workspace Trust
- `x-model` and `x-modelable` recognised by the generator.
- Nested `x-data` shadow outer scope lexically.
- `init()` detected by member name.
- `alpineLanguageTools.enable` toggles start/stop live.

### Stage 7 — Blade, plugin API, workspace identifier index
- `bladePreprocessor.ts` strips `<?php … ?>` and `<?= … ?>` while preserving
  offsets.
- `PluginRegistry` exposes `register`, `unregister`, `list`, `augment` for
  third-party directives.
- `indexIdentifiers` walks `x-data` values and surfaces every property /
  method / `init` without executing the file's JavaScript.
- New LSP requests: `alpine/plugin/{register,unregister,list}`,
  `alpine/index/{files,query,clear}`.

### Stage 8 — externs, signature help, auto-index
- Workspace index entries surface as a `declare global { … }` preamble in
  every freshly generated virtual.
- `signatureHelpProvider` returns Alpine-specific signatures for `x-on` and
  `x-data`.
- Extension listens on `onDidSaveTextDocument` to push workspace changes and
  runs a bootstrap scan on activation.
- `Alpine: Show Identifiers` command renders the indexed identifiers.
- `documentSelector` widened with `**/*.blade.php` patterns.

### Stage 9 — Workspace Trust + cross-file tests
- Activation refuses to start when `vscode.workspace.isTrusted` is false;
  `onDidGrantWorkspaceTrust` re-enables it.
- Cross-file identifier sharing covered by an integration test:
  file A declares `open`, file B receives it via the workspace index and
  resolves inside its virtual.
- `alpine.plugin.register` integration test verifies custom directives
  surface in LSP completion and unregister cleanly between tests.

### Stage 10 — .vsix packaging + Marketplace metadata

- `packages/vscode/scripts/copy-server.mjs` copies the language-server bundle
  (`dist/main.js`) and the Alpine HTML Custom Data into the extension's
  `dist/` so the produced VSIX is self-contained.
- `alpineLanguageTools` renamed (no `@` prefix) so `vsce` accepts it as a
  Marketplace-style extension name. Added `publisher`, `license`,
  `repository`, and `keywords` metadata.
- `@vscode/vsce ^3.9.2` is a devDep; `pnpm vsix` produces the .vsix under the
  workspace `dist/` directory.
- `extension.ts` resolves the server module via `dist/server/main.js` so the
  same path works in dev and inside the packed VSIX.
- `.vscodeignore` excludes TypeScript sources, configuration files, and
  intermediate artifacts.
