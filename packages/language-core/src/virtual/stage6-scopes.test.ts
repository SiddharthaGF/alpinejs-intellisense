import { describe, expect, it } from "vitest";
import {
    createSourceMapAdapter,
    generateAlpineVirtualCode,
} from "../index.js";

describe("nested x-data scopes", () => {
    it("emits bindings for outer then inner scope in source order", () => {
        const html = [
            "<section x-data=\"{ count: 0 }\">",
            "    <div x-data=\"{ nested: 'x' }\">",
            "        <span x-text=\"nested\"></span>",
            "    </div>",
            "    <span x-text=\"count\"></span>",
            "</section>",
        ].join("\n");
        const virtual = generateAlpineVirtualCode(html, "nested");
        expect(virtual.code).toContain("let count");
        expect(virtual.code).toContain("let nested");
        // outer should come before inner
        const outerIdx = virtual.code.indexOf("let count");
        const innerIdx = virtual.code.indexOf("let nested");
        expect(outerIdx).toBeLessThan(innerIdx);
    });

    it("inner scope shadows outer by lexical position", () => {
        const html = [
            "<section x-data=\"{ open: false }\">",
            "    <div x-data=\"{ open: 'inner' }\">",
            "        <span x-text=\"open\"></span>",
            "    </div>",
            "</section>",
        ].join("\n");
        const virtual = generateAlpineVirtualCode(html, "doc");
        expect(virtual.code).toContain(": boolean");
        expect(virtual.code).toContain(": string");
    });
});

describe("x-model directive", () => {
    it("emits an assignment-shaped snippet with internal mapping", () => {
        const html = "<div x-data=\"{ open: false }\"><input x-model=\"open\"></div>";
        const virtual = generateAlpineVirtualCode(html, "doc");
        expect(virtual.code).toMatch(/store = newValue/i);
        expect(virtual.code).toContain("open");
        const sm = createSourceMapAdapter(virtual.mappings);
        const valueStart = html.indexOf("\"open\"") + 1;
        const projected = sm.mapSourceToVirtual(valueStart);
        expect(projected.mapping).toBeDefined();
        expect(virtual.code).toContain("open");
    });
});

describe("init() in x-data", () => {
    it("declares an init() function inside the virtual", () => {
        const html = "<div x-data=\"{ count: 0, init() { console.log('x') } }\"></div>";
        const virtual = generateAlpineVirtualCode(html, "doc");
        expect(virtual.code).toContain("function init");
        const initRange = virtual.code.indexOf("function init");
        expect(initRange).toBeGreaterThan(0);
    });
});
