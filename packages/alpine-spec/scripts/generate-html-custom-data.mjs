#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const require = createRequire(import.meta.url);
const spec = require(resolve(root, "dist/index.js"));

mkdirSync(resolve(root, "data"), { recursive: true });
const payload = spec.toHtmlCustomData();
writeFileSync(
    resolve(root, "data", "alpine-html-custom-data.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
);
