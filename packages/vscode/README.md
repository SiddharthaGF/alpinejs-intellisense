# Alpine.js IntelliSense

Preview VS Code extension that adds semantic IntelliSense for Alpine.js inside HTML and Blade directive values.

## Preview Status

This extension is currently in **Preview**.

Core language features are already usable, but APIs, metadata, UI text, and edge-case behavior may still change between releases.

## What It Does

- Completion for Alpine component state, methods, getters, and JavaScript globals inside directive expressions.
- Hover information for Alpine state, methods, getters, JavaScript built-ins, and Alpine magic helpers like `$el` and `$nextTick`.
- Go to definition for `x-data` members and supported external component sources.
- Better scope awareness for nested Alpine components.
- Alpine directive hover documentation with direct links to the official Alpine reference.

## Supported Alpine Language Features

- `x-data`
- `x-on` / `@`
- `x-bind` / `:`
- `x-text`
- `x-show`
- `x-model`
- `x-modelable`
- `x-init`
- `x-effect`
- `x-html`
- `x-for`
- `x-if`
- `x-transition`
- `x-ref`
- `x-id`
- `x-cloak`
- `x-ignore`
- `x-teleport`

## Supported Magic Helpers

- `$el`
- `$refs`
- `$store`
- `$watch`
- `$dispatch`
- `$nextTick`
- `$root`
- `$data`
- `$id`
- `$event`

## Installation

### Install From VSIX

1. Open VS Code.
2. Open the Extensions view.
3. Select the `...` menu.
4. Choose **Install from VSIX...**
5. Pick the packaged `alpine-language-tools-<version>.vsix` file.

## Usage

Open an HTML or Blade file and place the cursor inside an Alpine directive value such as:

```html
<div x-data="{ count: 0, increment() { this.count++ } }">
  <button @click="increment">Increment</button>
  <span x-text="count"></span>
</div>
```

Inside Alpine expressions you should get:

- autocompletion for local component members
- hover details with inferred types and JSDoc
- definition navigation for local methods and supported external sources

## Commands

- `Alpine: Restart Language Server`
- `Alpine: Show Output`
- `Alpine: Show Virtual JavaScript`
- `Alpine: Show Identifiers`

## Settings

- `alpineLanguageTools.enable`: Enable or disable the extension.
- `alpineLanguageTools.trace.server`: Trace language server communication.
- `alpineLanguageTools.autoTriggerSuggestions`: Automatically open suggestions while typing inside Alpine directive values.

## Current Notes

- This extension focuses on Alpine expressions embedded in HTML and Blade.
- Some advanced Alpine runtime behaviors still use conservative typing.
- Marketplace metadata and docs are still evolving during preview.

## Official Alpine Documentation

The extension includes direct hover links to the official Alpine documentation for directives and supported magic helpers:

- [Alpine.js Directives](https://alpinejs.dev/directives/data)
- [Alpine.js Magics](https://alpinejs.dev/magics/)

## Repository

- Source: [github.com/alpine-language-tools/alpinejs-intellisense](https://github.com/alpine-language-tools/alpinejs-intellisense)
- Issues: [Report a bug or request a feature](https://github.com/alpine-language-tools/alpinejs-intellisense/issues)

## License

MIT
