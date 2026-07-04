#!/usr/bin/env node
/**
 * Bundles the language-server entry point with esbuild so the result is
 * self-contained inside the VSIX. Without this, Node cannot resolve
 * `vscode-languageserver`, `typescript`, etc. — the .vsix excludes
 * `node_modules/`. The previous `copy-server.mjs` only copied the bare
 * tsc-compiled CJS file which carried external `require()` calls.
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vscodeDir = resolve(here, "..");
const languageServerDir = resolve(vscodeDir, "..", "language-server");

const require = createRequire(import.meta.url);
const tsconfigPath = require.resolve(resolve(languageServerDir, "tsconfig.json"));

const outFile = resolve(vscodeDir, "dist", "server", "main.js");
await build({
    entryPoints: [resolve(languageServerDir, "src", "main.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    target: "es2022",
    format: "cjs",
    sourcemap: false,
    minify: true,
    treeShaking: true,
    external: ["vscode"],
    mainFields: ["module", "main"],
    conditions: ["module", "import", "default"],
    logLevel: "info",
    tsconfig: tsconfigPath,
});

console.log(`[bundle-server] wrote ${outFile}`);
