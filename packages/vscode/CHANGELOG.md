# Change Log

All notable changes to the VS Code extension package are documented here.

## 0.0.19

- Added Marketplace-ready extension icon support via `assets/logo.png`.
- Marked the extension as **Preview** in the manifest.
- Added a package-local `README.md` so installed VSIX builds no longer appear empty in the Extensions view.
- Added official Alpine documentation reference links to directive hovers and supported magic-helper hovers.
- Improved Alpine magic helper support for `$el`, `$refs`, `$store`, `$watch`, `$dispatch`, `$nextTick`, `$root`, `$data`, and `$id`.
- Removed duplicate low-signal hover output caused by embedded JavaScript hover providers in Alpine directive values.

## 0.0.18

- Removed duplicate hover content from the editor hover provider inside Alpine directive values.
- Added regression coverage to ensure Alpine magic hovers do not append a stray `any`.

## 0.0.17

- Added initial Marketplace icon wiring in the extension manifest workflow.

## 0.0.16

- Added Alpine magic helper typing support and corresponding semantic tests.

## 0.0.0

- Initial workspace scaffold for the Alpine.js IntelliSense extension, language server, virtual TypeScript pipeline, and packaging flow.
