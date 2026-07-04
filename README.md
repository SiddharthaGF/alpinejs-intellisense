# Alpine Language Tools

VS Code extension providing **real semantic support** for JavaScript inside [Alpine.js](https://alpinejs.dev/) directives.

This monorepo hosts:

| Package | Purpose |
| --- | --- |
| `packages/vscode` | VS Code extension (TypeScript scaffold from `yo code`). |
| `packages/language-server` | Language Server speaking LSP. |
| `packages/language-core` | Parsers, normalized models, virtual documents, TypeScript Language Service adapters. |
| `packages/alpine-spec` | Single source of truth for Alpine directive metadata. |

## Status

Currently on **Stage 10: `pnpm vsix` packaging**. `@vscode/vsce` is a devDep; `copy-server.mjs` assembles the language-server bundle and the Alpine HTML Custom Data into the extension package, and `pnpm vsix` (root) emits `dist/alpine-language-tools-<version>.vsix`. The extension manifest now carries Marketplace metadata (`publisher`, `repository`, `license`, `keywords`). Stage 11 (CI / release) is the natural next step — see `docs/architecture.md`.

## Requirements

- Node.js `>= 20`.
- pnpm `>= 9`.

## Install

```bash
pnpm install
```

## Scripts (run from repository root)

| Command | Action |
| --- | --- |
| `pnpm build` | Build every package. |
| `pnpm watch` | Watch-mode build for every package. |
| `pnpm typecheck` | TypeScript strict type-check across the workspace. |
| `pnpm lint` | ESLint across the workspace. |
| `pnpm test` | Run all package tests. |
| `pnpm test:unit` | Run only unit tests. |
| `pnpm package` | Produce the `.vsix` bundle. |

## Debug the VS Code extension

1. Open `packages/vscode` in VS Code (`File → Add Folder to Workspace`).
2. Press `F5`. The Extension Development Host launches with the example `Hello World` command registered.

See `CONTRIBUTING.md` for the rules that apply to every stage and `docs/architecture.md` for design notes.
