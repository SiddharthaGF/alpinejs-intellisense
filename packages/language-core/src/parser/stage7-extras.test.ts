import { describe, expect, it } from "vitest";
import {
    extractAlpineDirectives,
    indexIdentifiers,
    isBladeUri,
    parseDataLiteral,
    PluginRegistry,
    preprocessForLanguage,
    stripPhpBlocks,
    type CustomDirective,
} from "../index.js";

const BLADE_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <?php $value = '<span>oops</span>'; echo $value; ?>",
    "    <button @click=\"opne = true\"></button>",
    "</div>",
].join("\n");

describe("Blade preprocessor", () => {
    it("recognises .blade.php URIs", () => {
        expect(isBladeUri("app/Resources/views/index.blade.php")).toBe(true);
        expect(isBladeUri("index.html")).toBe(false);
        expect(isBladeUri("INSTRUMENTS.BLADE.PHP")).toBe(true);
    });

    it("strips PHP open/close while preserving offsets", () => {
        const html = "<div><?php echo 'hi'; ?>x</div>";
        const stripped = stripPhpBlocks(html);
        expect(stripped.length).toBe(html.length);
        expect(stripped.indexOf("?php")).toBe(-1);
        expect(stripped.indexOf("'hi'") >= 0 || stripped.includes("'hi'")).toBe(false);
        expect(stripped.includes("x")).toBe(true);
    });

    it("strips short echo tags too", () => {
        const html = "<div><?= $value ?>x</div>";
        const stripped = stripPhpBlocks(html);
        expect(stripped.length).toBe(html.length);
        expect(stripped.includes("?")).toBe(false);
    });

    it("preprocessForLanguage detects blade from uri or language id", () => {
        const sample = "<div x-data=\"{ a: 1 }\"></div>";
        expect(preprocessForLanguage(sample, "html", "view.html")).toBe(sample);
        expect(preprocessForLanguage(sample, "blade", "view.blade.php")).toBe(sample);
    });

    it("extracts Alpine directives out of Blade templates", () => {
        const stripped = preprocessForLanguage(BLADE_CASE, "blade", "view.blade.php");
        const directives = extractAlpineDirectives(stripped);
        expect(directives.map((d) => d.canonicalName)).toEqual(
            expect.arrayContaining(["x-data", "x-on"]),
        );
        const typo = directives.find((d) => d.canonicalName === "x-on");
        expect(typo?.value).toBe("opne = true");
    });
});

describe("PluginRegistry", () => {
    it("registers custom directives and exposes them to the analyser", () => {
        const registry = new PluginRegistry();
        const spec: CustomDirective = {
            name: "x-tooltip",
            modifiers: ["top", "bottom"],
            valueKind: "expression",
            documentation: "Custom tooltip directive",
        };
        registry.register(spec);
        const html = "<div x-tooltip=\"msg\"></div>";
        const directives = registry.augment(html);
        const found = directives.find((d) => d.canonicalName === "x-tooltip");
        expect(found).toBeDefined();
        expect(found?.valueKind).toBe("expression");
        expect(registry.list()).toHaveLength(1);
    });

    it("ignores unknown directives the registry did not register", () => {
        const registry = new PluginRegistry();
        const html = "<div x-random></div>";
        const directives = registry.augment(html);
        expect(directives).toEqual([]);
    });

    it("unregister removes a custom directive", () => {
        const registry = new PluginRegistry();
        registry.register({ name: "x-foo", valueKind: "none", documentation: "foo" });
        expect(registry.knownCanonical("x-foo")).toBe(true);
        expect(registry.unregister("x-foo")).toBe(true);
        expect(registry.knownCanonical("x-foo")).toBe(false);
    });
});

describe("indexIdentifiers", () => {
    it("surfaces property, method and init() identifiers per file", () => {
        const html = [
            "<div x-data=\"{",
            "    count: 0,",
            "    toggle() {},",
            "    init() {}",
            "}\">",
            "    <span x-text=\"count\"></span>",
            "</div>",
        ].join("\n");
        const ids = indexIdentifiers(html, "counter.html");
        const names = ids.map((i) => i.name).sort();
        expect(names).toContain("count");
        expect(names).toContain("toggle");
        expect(names).toContain("init");
        expect(ids.find((i) => i.name === "init")?.kind).toBe("init");
    });

    it("supports multiple x-data declarations in the same file", () => {
        const html = [
            "<div x-data=\"{ a: 1 }\"></div>",
            "<section x-data=\"{ b: 2, set() {} }\"></section>",
        ].join("\n");
        const ids = indexIdentifiers(html, "m.html");
        expect(ids.map((i) => i.name).sort()).toEqual(["a", "b", "set"]);
    });

    it("returns an empty array on parse error", () => {
        expect(indexIdentifiers("<div x-data=\"not an object\"></div>", "x.html")).toEqual([]);
    });
});

describe("parseDataLiteral export smoke", () => {
    it("exposes the parser via the public surface", () => {
        expect(parseDataLiteral("{ a: 1, b: 'x' }").members.map((m) => m.name)).toEqual(["a", "b"]);
    });
});
