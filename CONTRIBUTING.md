# Contributing

## Project rules

These rules apply to every change merged into this repository.

1. **One stage at a time.** Implement only the stage currently in scope. Do not start work for the next stage.
2. **Inspect the repository before editing** to understand existing state and conventions.
3. **Preserve prior functionality and tests.** Regressions are not acceptable.
4. **TypeScript strict mode** in every package.
5. **No `any`.** Use typed adapters or `unknown` + narrowing.
6. **No `eval`, `Function`, or workspace code execution** at any layer.
7. **No regex-based semantic analysis.** Parsing must be tree-based.
8. **Reuse the TypeScript Language Service** for JavaScript and TypeScript semantic features.
9. **No proposed VS Code APIs.**
10. **Workspace Trust** boundaries must be respected.
11. **Justify every new dependency** in the PR description.
12. **Verify dependency versions and APIs** before installing.
13. **Encapsulate Volar** behind our own `VirtualCodeAdapter`, `LanguageServiceAdapter`, `SourceMapAdapter` interfaces.
14. **No mocked code, empty handlers, or `TODO`s** within the scope of the stage being shipped.
15. **No stage is "done" without green tests.**
16. **Update docs** that belong to the stage.
17. **Small, descriptive commits** when the environment allows.

## Required commands before opening a PR

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

When the stage affects the Extension Host or the Language Server, also run the integration tests:

```bash
pnpm --filter @alpine-language-tools/vscode test
```

## Layout conventions

- One `package.json` per workspace package.
- Each package exposes `build`, `watch`, `typecheck`, `lint`, `test`, `test:unit` scripts.
- Shared tooling lives at the workspace root (`pnpm-workspace.yaml`, `.gitignore`).
- New directives or modifiers must be added to `packages/alpine-spec` first, never hard-coded inline.

## Reporting format at the end of a stage

1. Summary of what was implemented.
2. Files created and modified.
3. Key technical decisions.
4. Dependencies added or removed (with justification).
5. Commands executed.
6. Real output of each command.
7. Tests added.
8. Remaining limitations outside the stage.
9. Recommended next stage.

Do not invent results. If a command fails, paste the error, attempt a fix, and document the actual state.
