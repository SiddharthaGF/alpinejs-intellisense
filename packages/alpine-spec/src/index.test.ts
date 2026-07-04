import { describe, expect, it } from "vitest";
import {
    DIRECTIVES,
    getDirectiveByCanonicalName,
    getCompletionNames,
    getDirectiveReferenceUrl,
    getMagicReferenceUrl,
    getMarkdownDocumentation,
    getModifiers,
    splitAttributeName,
    toHtmlCustomData,
} from "./index.js";

describe("alpine-spec catalogue", () => {
    it("registers the 18 core Alpine directives", () => {
        expect(DIRECTIVES.length).toBe(18);
        const names = DIRECTIVES.map((d) => d.name);
        for (const expected of [
            "x-data",
            "x-init",
            "x-show",
            "x-bind",
            "x-on",
            "x-text",
            "x-html",
            "x-model",
            "x-modelable",
            "x-for",
            "x-transition",
            "x-effect",
            "x-ignore",
            "x-ref",
            "x-cloak",
            "x-teleport",
            "x-if",
            "x-id",
        ]) {
            expect(names).toContain(expected);
        }
    });

    it("declares both x-bind and x-on shorthands", () => {
        expect(getDirectiveByCanonicalName("x-bind")?.aliases).toContain(":");
        expect(getDirectiveByCanonicalName("x-on")?.aliases).toContain("@");
    });

    it("documents the known modifiers for x-on and x-model", () => {
        const xOn = getModifiers("x-on").map((m) => m.name);
        expect(xOn).toContain("prevent");
        expect(xOn).toContain("debounce");

        const xModel = getModifiers("x-model").map((m) => m.name);
        expect(xModel).toContain("lazy");
        expect(xModel).toContain("trim");
    });

    it("produces an HTML Custom Data payload with directives and shorthands", () => {
        const data = toHtmlCustomData();
        expect(data.version).toBe(1.1);
        const attributeNames = data.attributes.map((a) => a.name);
        expect(attributeNames).toContain("x-data");
        expect(attributeNames).toContain(":");
        expect(attributeNames).toContain("@");
        for (const attribute of data.attributes) {
            expect(attribute.description.length).toBeGreaterThan(0);
        }
    });

    it("normalises directive names through splitAttributeName", () => {
        expect(splitAttributeName("x-on:click.prevent")).toEqual({
            canonical: "x-on",
            argument: "click",
            modifiers: ["prevent"],
        });
        expect(splitAttributeName("@click.prevent.stop")).toEqual({
            canonical: "x-on",
            shorthand: "@",
            argument: "click",
            modifiers: ["prevent", "stop"],
        });
        expect(splitAttributeName(":disabled")).toEqual({
            canonical: "x-bind",
            shorthand: ":",
            argument: "disabled",
            modifiers: [],
        });
        expect(splitAttributeName("x-data")).toEqual({
            canonical: "x-data",
            modifiers: [],
        });
        expect(splitAttributeName("x-unknown")).toBeNull();
        expect(splitAttributeName("class")).toBeNull();
    });

    it("returns matching canonical names for completion prefixes", () => {
        expect(getCompletionNames("x-d").map((d) => d.name)).toContain("x-data");
        expect(getCompletionNames("@").map((d) => d.name)).toContain("x-on");
        expect(getCompletionNames(":cl").map((d) => d.name)).toContain("x-bind");
        expect(getCompletionNames("totally-unrelated")).toEqual([]);
    });

    it("exposes documentation for canonical directives", () => {
        const docs = getMarkdownDocumentation("x-show");
        expect(docs).toBeDefined();
        expect(docs).toMatch(/display: none/i);
        expect(docs).toContain("https://alpinejs.dev/directives/show");
    });

    it("exposes official reference urls for directives and magics", () => {
        expect(getDirectiveReferenceUrl("x-on")).toBe("https://alpinejs.dev/directives/on");
        expect(getMagicReferenceUrl("$el")).toBe("https://alpinejs.dev/magics/el");
    });
});
