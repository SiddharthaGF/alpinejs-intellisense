#!/usr/bin/env node
/**
 * Copies the alpine-spec HTML Custom Data file into the extension's `data/`
 * directory so the relative path declared in package.json resolves inside
 * the packed VSIX.
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const vscodeDir = resolve(here, "..");
const specDataDir = resolve(vscodeDir, "..", "alpine-spec", "data");
const require = createRequire(import.meta.url);
const tsPackageJson = require.resolve("typescript/package.json", {
    paths: [resolve(vscodeDir, "..", "language-core")],
});
const tsLibDir = resolve(dirname(tsPackageJson), "lib");

const dataDir = resolve(vscodeDir, "data");
mkdirSync(dataDir, { recursive: true });

const source = resolve(specDataDir, "alpine-html-custom-data.json");
if (!existsSync(source)) {
    console.error(`[copy-data] missing ${source} (run pnpm build first).`);
    process.exit(1);
}
copyFileSync(source, resolve(dataDir, "alpine-html-custom-data.json"));
console.log(`[copy-data] copied ${source} -> data/alpine-html-custom-data.json`);

if (!existsSync(tsLibDir)) {
    console.error(`[copy-data] missing TypeScript lib directory ${tsLibDir}.`);
    process.exit(1);
}
const tsTargetDir = resolve(dataDir, "typescript-lib");
mkdirSync(tsTargetDir, { recursive: true });
for (const file of readdirSync(tsLibDir)) {
    if (!/^lib\..*\.d\.ts$/.test(file)) {
        continue;
    }
    copyFileSync(resolve(tsLibDir, file), resolve(tsTargetDir, file));
}
console.log(`[copy-data] copied TypeScript libs from ${tsLibDir} -> data/typescript-lib`);
