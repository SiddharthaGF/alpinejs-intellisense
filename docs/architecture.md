# Architecture

## Goals

Provide semantic JavaScript tooling inside Alpine.js directives in HTML and Blade files, reusing the TypeScript Language Service so completions, hovers, diagnostics, signature help, and navigation behave as they would in a real `.js` / `.ts` file.

## Stage roadmap

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold from `yo code` + pnpm monorepo + tooling baseline. | done |
| 2 | VS Code client ↔ Language Server via LSP, restart + output commands. | done |
| 3 | Tolerant HTML parser, normalized directive model, `alpine-spec` with the 18 core directives, completion + hover for directive names. | done |
| 4 | Virtual TypeScript documents, mappings, `Volar` adapters. | done |
| 5 | TypeScript Language Service wiring, real diagnostics, event typing, signature help. | done |
| 6 | Nested scopes, `x-model`, `init()`, dynamic enable. | done |
| 7 | Blade PHP stripping, plugin API, workspace identifier index. | done |
| 8 | Workspace-index injection, signature help, `Alpine: Show Identifiers`. | done |
| 9 | Workspace Trust gate, cross-file test surface, plugin completion. | done |
| 10 | .vsix packaging, server bundle assembly, Marketplace metadata. | done |

## Workspace

```
packages/
├── vscode/              ← VS Code extension (scaffold from `yo code`)
├── language-server/     ← LSP entry point
├── language-core/       ← Parsers, models, virtual documents, adapters
└── alpine-spec/         ← Directive metadata (single source of truth)
```

### Dependencies

```
vscode  ──► language-core, language-server, alpine-spec
language-server ──► language-core, alpine-spec
language-core ──► alpine-spec
alpine-spec ──► (none — leaf)
```

Acyclic graph. Lower packages never depend on upper packages.

## Boundaries

- **Volar** APIs are private to `language-core`. Only `VirtualCodeAdapter`, `LanguageServiceAdapter`, `SourceMapAdapter` leak outside, and only via the local `Adapters` namespace.
- **TypeScript Language Service** usage lives entirely in `language-core`. The Language Server forwards requests from LSP and never speaks TS API directly.
- The **VS Code extension** owns only client plumbing: command registration, configuration, output channel, restart lifecycle. All intelligence lives in the server.

## Stage 1 baseline

Stage 1 does not implement Alpine-specific behavior yet. It establishes:

- The monorepo layout above.
- TypeScript strict mode in every package.
- ESLint flat config per package.
- Vitest configured for unit tests (`pnpm test:unit`).
- Root-level convenience scripts (`build`, `watch`, `typecheck`, `lint`, `test`, `test:unit`, `package`).
- Documentation skeleton: `README.md`, `CONTRIBUTING.md`, this file.

Adding any Alpine-specific parsing, Volar wiring, or TS-LS wiring in stage 1 is an explicit violation of the project rules and must be deferred to its proper stage.

## Stage 2 baseline

Stage 2 turns the `vscode` package into the LSP client and `language-server` into the standalone LSP server.

### Client (`packages/vscode`)

- Activation events: `onLanguage:html`, `onCommand:alpine.restart`, `onCommand:alpine.showOutput`.
- Commands: `Alpine: Restart Language Server`, `Alpine: Show Output`.
- Internal commands used by integration tests: `alpine.ping`, `alpine.status`.
- Settings:
  - `alpineLanguageTools.enable` (boolean, default `true`).
  - `alpineLanguageTools.trace.server` (`off` | `messages` | `compact` | `verbose`).
- Spawns `packages/language-server/dist/main.js` via stdio.

### Server (`packages/language-server`)

- Entry point: `packages/language-server/src/main.ts`.
- Capabilities: `textDocumentSync: Incremental`, `hoverProvider: true`.
- Custom request `alpine/ping` returns `{ ok, server, version, initialized }`.
- Lifecycle hooks wired: `onInitialize`, `onInitialized`, `onShutdown`, `onExit`.

Alpine-specific parsing, Volar wiring, and TS-LS integration are out of scope for stage 2 and must be deferred to stages 3–5.

## Stage 3 baseline

Stage 3 wires `vscode-html-languageservice` into `language-core`, exposes the 18 Alpine directives from `alpine-spec`, and lets the LSP respond with completion + hover.

### Parser (`packages/language-core`)

- `parseElements(input)` tolerant scanner-driven parser captures exact attribute offsets.
- `extractAlpineDirectives(input)` walks the parsed tree, normalises long / shorthand forms (`x-on:click.prevent`, `@click.prevent`, `x-bind:href`, `:href`) and returns `AlpineDirectiveNode[]` with offset ranges for name, value, attribute, and element.
- Unknown directives are silently filtered out.

### Catalogue (`packages/alpine-spec`)

- Registers all 18 directives: `x-data`, `x-init`, `x-show`, `x-bind`, `x-on`, `x-text`, `x-html`, `x-model`, `x-modelable`, `x-for`, `x-transition`, `x-effect`, `x-ignore`, `x-ref`, `x-cloak`, `x-teleport`, `x-if`, `x-id`.
- Declares the `:`, `@` shorthands.
- Catalogue of modifiers for `x-on`, `x-bind`, `x-model`, `x-transition`.
- `toHtmlCustomData()` emits a VS Code HTML Custom Data payload; build writes `packages/alpine-spec/data/alpine-html-custom-data.json`.
- VS Code contribution `contributes.html.customData` references that JSON.

### Server (`packages/language-server`)

- New capabilities: `completionProvider { triggerCharacters: ['.', ':', '@'] }`, plus the inherited `hoverProvider`.
- `onCompletion` returns modifier items when the cursor is over a known directive, or directive items when typing in an attribute name.
- `onHover` returns Markdown documentation for the canonical directive plus the value-kind hint.
- `alpine/directives`, `alpine/completion-test`, `alpine/hover-test` custom requests back the test suite without touching the LSP state machine.

Alpine-specific parsing of JavaScript expressions stays out of stage 3: `valueKind` only categorises the form (`data-object`, `expression`, `statement`, etc.). VS Code still ships no false JavaScript diagnostics because no JS analyser is wired up yet. Volar wiring, virtual documents, and TypeScript Language Service integration are deferred to stages 4–5.

## Stage 4 baseline

Stage 4 introduces the `language-core/virtual` package with three adapter interfaces, a Volar-friendly virtual document generator, and the `Alpine: Show Virtual JavaScript` command.

### Adapters (`packages/language-core/src/virtual/`)

- `VirtualCodeAdapter` — generates a `VirtualCodeFile` (id, `typescript`, code, mappings, internal identifiers).
- `SourceMapAdapter` — `mapSourceToVirtual(offset, caps?)` / `mapVirtualToSource(offset, caps?)`, filters mappings by capability flags.
- `LanguageServiceAdapter` — interface stub for the TypeScript Language Service, satisfied in stage 4 by `createNoopLanguageServiceAdapter` so future stages can swap in real implementations without touching callers.

### Generator

- Covers `x-data`, `x-text`, `x-show`, `x-on`/`@`, `x-bind`/`:` (`isStage4SupportedDirective`).
- Emits a read-only `typescript` document with stable internal identifiers prefixed `__alpine_internal_`, never returned to the user.
- Each Alpine expression maps to a contiguous virtual range; mapping capabilities control diagnostics / completion / hover / definition / references / rename / semantic tokens independently.

### Server

- `documentSelector` documents trigger `state.set(uri, { directives, virtual })`.
- `alpine/show-virtual` request returns `{ languageId, code, internalIdentifiers, mappings }` for the editor or test surface.

### Extension

- New command `Alpine: Show Virtual JavaScript` opens the virtual TS in a fresh `typescript` editor (untitled, never persisted).
- `alpine.showVirtual.request` exposes the same payload for tests.

## Stage 5 baseline

Stage 5 wires a real TypeScript Language Service to the virtual document.

### Language-core additions

- `xDataAst.ts` parses `x-data="..."` values via the TypeScript compiler API; emits
  `let name: T` for properties (literal type inference), `function name() {}` for
  methods, deterministic declarations for getters/setters. Stage 5 ignores methods
  bodies; only the surface signature matters for completion / hover / diagnostics.
- The generator (`alpineVirtualCode.ts`) rebuilds the virtual document per request
  to keep bindings in lexical scope (`let open: boolean;`, `function toggle() {}`)
  and exposes a typed `$event` parameter on every `x-on` body.
- `tsLanguageServiceAdapter.ts` creates an in-memory `ts.LanguageService` against
  the virtual code. Returns quick info, completions, definitions, document
  highlights, and semantic + syntactic diagnostics.
- `diagnostics.ts` translates TypeScript diagnostics back to source ranges via the
  `SourceMapAdapter` and filters out anything that wraps an internal identifier.

### Server wiring

- `state.set(uri, { directives, virtual, tsAdapter })` on every `didOpen` /
  `didChange`. `tsAdapter.attach(virtual)` rebuilds the service; diagnostics are
  emitted through `connection.sendDiagnostics` mapped from virtual to HTML offsets.
- `onHover` / `onCompletion` first consult the TypeScript Language Service, then
  fall back to the directive metadata. `$event` typing is provided through the
  handler signature `($event: Event, event: Event): void`.

### Extension

- Document selector now includes `scheme: "untitled"` so HTML scratch documents
  also reach the server (required for tests and quick playgrounds).
- New TextMate injection grammar at
  `packages/vscode/syntaxes/alpine-injection.tmLanguage.json` lights up
  JavaScript inside Alpine directive values via `contributes.grammars`.

## End-to-end acceptance tests (Stage 5)

- `<div x-data="{ open: false, toggle() {} }"><button @click="opne=true"></button></div>`
  publishes an LSP error on `opne`.
- The same source with `@click="tog"` triggers a completion list containing `toggle`.
- `<input @input="$event.target.value">` exposes hover info for `$event`.
- `<span x-text="open">` exposes the boolean type of `open`.

## Stage 6 baseline (scope expansion)

Stage 6 widens the directive coverage to `x-model` / `x-modelable`, ensures nested
`x-data` scopes surface with lexical shadowing, recognises `init()` as the Alpine
boot hook, and turns the `alpineLanguageTools.enable` setting into a live on/off
gate.

### Generator changes

- `x-model` and `x-modelable` are now in the directive set the generator
  recognises. `x-model` emits an assignment-shaped snippet
  (`store = newValue; void <expr>;`) so the source expression still parses under
  the TypeScript Language Service.
- Nested `x-data` declarations now get distinct scope identifiers
  (`__alpine_internal_*`). Inner scopes shadow outer ones lexically inside the
  generated TS, because identifiers are redeclared with the same name.
- `init()` is detected by member name and surfaces as `function init()` in the
  virtual so completion / diagnostics recognise it as the Alpine boot hook.

### Workspace Trust

- `alpineLanguageTools.enable` is now reactive: toggling the setting stops the
  client (and tear down the TS adapter); toggling it back on restarts it.
- Activation already short-circuits when the setting is off at boot.

## Stage 7 baseline (Blade + plugin API + workspace index)

Stage 7 broadens the language surface to Blade templates, third-party directive
plugins, and cross-file identifier resolution.

### Blade

- `language-core/src/parser/bladePreprocessor.ts` strips `<?php … ?>` and
  `<?= … ?>` blocks while preserving offsets (whitespace replacement). The HTML
  parser then sees a clean Alpine-only template and offsets stay stable for the
  directive extractor and the virtual generator.
- The server routes `documentSelector` entries with `pattern: "**/*.blade.php"`
  through the same HTML pipeline but invokes `preprocessForLanguage` first.

### Plugin API

- `language-core/src/plugins/PluginRegistry.ts` exposes
  `register / unregister / list / augment`. Custom directives get their own
  DirectiveSpec and are matched independently from the built-in catalogue because
  `alpine-spec`'s `splitAttributeName` is intentionally closed.
- The server exposes three requests: `alpine/plugin/register`,
  `alpine/plugin/unregister`, `alpine/plugin/list`.

### Workspace index

- `alpine/index/files` takes a list of files, preprocesses Blade, and surfaces the
  top-level identifiers declared by every `x-data` value. State lives server-side
  and the client triggers a scan via `vscode.workspace.findFiles` plus the
  `alpine/index/files` request — the index never executes workspace JS.
- `alpine/index/query` returns the flattened list so the client (and the language
  server itself, via a future generator change) can inject externs into the
  virtual TypeScript preamble.

## Stage 8 baseline (workspace index injection + signature help + auto-index)

- `generateAlpineVirtualCode(input, documentId, externs)` now prepends a
  `declare global { ... }` preamble listing every cross-file identifier exposed
  via `alpine/index/files`. Methods / `init()` are typed as functions, properties
  as `let`.
- `onSignatureHelp` in the language server responds for both `x-on` and
  `x-data`, surfacing the Alpine event signature (`(event: Event, $event:
  AlpineEvent): void`) and the component-scope shape.
- The extension registers `vscode.workspace.onDidSaveTextDocument` so the server
  re-scans `.html` / `.blade.php` files on each save. A bootstrap scan runs at
  activation.
- `Alpine: Show Identifiers` opens a read-only preview listing the indexed
  identifiers grouped by file.
- `documentSelector` now also includes `**/*.blade.php` patterns for both
  `scheme: file` and `scheme: untitled`.

## Stage 9 baseline (Workspace Trust + cross-file integration)

- `extensions.ts` activates only when `vscode.workspace.isTrusted` is true.
  An informational notification tells the user the language server is paused
  otherwise; `onDidGrantWorkspaceTrust` re-runs `start()` once trust is granted.
- `alpine.plugin.register` + `alpine.plugin.unregister` request handlers
  accept a `CustomDirective` payload; `dispatchCompletion` exposes the
  registration alongside built-in directives so HTML attribute-name completion
  picks up `x-foo` style custom attributes.
- The integration suite grew to two new tests:
  - `Stage 9: cross-file identifiers surface in virtual code` indexes two
    untitled documents and asserts that the workspace index query exposes the
    `open` identifier across files.
  - `alpine.plugin.register exposes a custom directive completion` registers
    a `x-tooltip` directive, queries completion for `x-too`, then unregisters
    to keep the global registry clean for sibling test suites.
- Workspace index injection is wired through `ExternDeclaration` so cross-file
  properties / methods / `init()` show up in completion / hover / diagnostics
  without spilling into the local lexical scope.
- `CHANGELOG.md` summarises the project history from scaffold to stage 9.

## Stage 10 baseline (packaging + .vsix artifacts)

- `packages/vscode/scripts/copy-server.mjs` is now part of the build chain.
  After `esbuild --production` runs, the language-server bundle and the
  alpine-spec HTML Custom Data file are copied into `packages/vscode/dist/…`
  so the `.vsix` is self-contained.
- `alpineLanguageTools` is now the Marketplace-style extension name (no `@`
  prefix). `publisher`, `license`, `repository`, and `keywords` fields are
  populated.
- `@vscode/vsce ^3.9.2` is a devDep; `pnpm vsix` from the root runs the
  packaging chain and writes `dist/alpine-language-tools-<version>.vsix`.
- `extension.ts` resolves the server module via `dist/server/main.js`
  instead of `../language-server/dist/main.js`. The relative path stays valid
  both at the workspace's debug-time and inside the packed .vsix.
- `.vscodeignore` excludes dev artifacts (`tsconfig`, `eslint.config.mjs`,
  `vsix/dist/**`) so the .vsix contains only the runtime files.
