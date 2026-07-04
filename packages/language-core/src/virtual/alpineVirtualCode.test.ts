import { describe, expect, it } from "vitest";
import {
    createSourceMapAdapter,
    extractAlpineDirectives,
    generateAlpineVirtualCode,
    isStage4SupportedDirective,
} from "../index.js";

const MINIMAL_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <button @click=\"open = !open\"></button>",
    "    <span x-text=\"open\"></span>",
    "</div>",
].join("\n");

const XDATA_METHOD_CASE = [
    "<div x-data=\"{ count: 0, inc() { count++; return count; } }\"></div>",
].join("\n");

interface GoldenMapping {
    label: string;
    sourceStart: number;
    sourceEnd: number;
    virtualText: string;
}

function mappingArray(code: string, mapping: { sourceRange: { start: number; end: number }; virtualRange: { start: number; end: number }; label: string }[]): GoldenMapping[] {
    return mapping.map((m) => ({
        label: m.label,
        sourceStart: m.sourceRange.start,
        sourceEnd: m.sourceRange.end,
        virtualText: code.slice(m.virtualRange.start, m.virtualRange.end),
    }));
}

describe("alpine-spec scope (stage 4)", () => {
    it("accepts only stage-4-supported canonical directives", () => {
        for (const name of ["x-data", "x-on", "x-text", "x-bind", "x-show"]) {
            expect(isStage4SupportedDirective(name)).toBe(true);
        }
        for (const name of ["x-for", "x-init", "x-effect", "x-teleport"]) {
            expect(isStage4SupportedDirective(name)).toBe(false);
        }
    });
});

describe("generateAlpineVirtualCode", () => {
    it("produces TypeScript and maps every expression in the minimal case", () => {
        const directives = extractAlpineDirectives(MINIMAL_CASE);
        const canonicals = directives.map((d) => d.canonicalName);
        expect(canonicals).toEqual(
            expect.arrayContaining(["x-data", "x-on", "x-text"]),
        );

        const virtual = generateAlpineVirtualCode(MINIMAL_CASE, "test-doc");
        expect(virtual.languageId).toBe("typescript");
        expect(virtual.code.length).toBeGreaterThan(0);

        // Identifiers present in the virtual source must be filtered from the user-visible surface.
        for (const id of virtual.internalIdentifiers) {
            expect(id.startsWith("__alpine_internal_")).toBe(true);
        }

        // The virtual code must reference `open` for each expression.
        const openMappings = mappingArray(virtual.code, virtual.mappings).filter(
            (m) => m.virtualText.includes("open"),
        );
        expect(openMappings.length).toBeGreaterThanOrEqual(3);

        const sourceFromVirtual = createSourceMapAdapter(virtual.mappings);

        const expected = [
            { contains: "open", canonical: "x-data" },
            { contains: "open = !open", canonical: "x-on" },
            { contains: "open", canonical: "x-text" },
        ];
        for (const exp of expected) {
            const directive = directives.find((d) => d.canonicalName === exp.canonical);
            expect(directive).toBeDefined();
            if (!directive || directive.valueRange === undefined) {
                continue;
            }
            const target = sourceFromVirtual.mapSourceToVirtual(directive.valueRange.start);
            expect(target.mapping).toBeDefined();
            const virtualText = virtual.code.slice(
                target.mapping!.virtualRange.start,
                target.mapping!.virtualRange.end,
            );
            expect(virtualText).toContain(exp.contains);
        }

        // The three expressions for `open` should land in separate mappings whose
        // virtual text differs because the generator emits distinct snippets.
        const mapped = mappingArray(virtual.code, virtual.mappings).filter((m) =>
            m.virtualText.includes("open"),
        );
        expect(new Set(mapped.map((m) => m.virtualText)).size).toBeGreaterThanOrEqual(3);
    });

    it("annotates mappings with capabilities", () => {
        const virtual = generateAlpineVirtualCode(MINIMAL_CASE, "test-doc");
        for (const m of virtual.mappings) {
            expect(m.capabilities).toBeDefined();
            expect(typeof m.capabilities.completion).toBe("boolean");
        }
    });

    it("treats mapping ranges as half-open intervals", () => {
        const directives = extractAlpineDirectives(MINIMAL_CASE);
        const on = directives.find((d) => d.canonicalName === "x-on");
        expect(on?.valueRange).toBeDefined();
        if (!on?.valueRange) {
            return;
        }
        const virtual = generateAlpineVirtualCode(MINIMAL_CASE, "doc");
        const sm = createSourceMapAdapter(virtual.mappings);
        const inside = sm.mapSourceToVirtual(on.valueRange.end - 1);
        const outside = sm.mapSourceToVirtual(on.valueRange.end);
        expect(inside.mapping).toBeDefined();
        expect(outside.mapping).toBeUndefined();
        const mapped = inside.mapping!.virtualRange;
        expect(sm.mapVirtualToSource(mapped.end - 1).mapping).toBeDefined();
        expect(sm.mapVirtualToSource(mapped.end).mapping).toBeUndefined();
    });

    it("keeps virtual document readonly by emitting stable internal identifiers", () => {
        const a = generateAlpineVirtualCode(MINIMAL_CASE, "doc");
        const b = generateAlpineVirtualCode(MINIMAL_CASE, "doc");
        expect(a.internalIdentifiers.size).toBeGreaterThan(0);
        expect(b.internalIdentifiers.size).toBe(a.internalIdentifiers.size);
        for (const id of a.internalIdentifiers) {
            expect(b.internalIdentifiers.has(id)).toBe(true);
        }
    });

    it("supports multiline attribute values without losing offsets", () => {
        const html = [
            "<div",
            "    x-data=\"{",
            "        open: false,",
            "    }\">",
            "    <button",
            "        @click=\"open = !open\"",
            "    ></button>",
            "</div>",
        ].join("\n");
        const directives = extractAlpineDirectives(html);
        const data = directives.find((d) => d.canonicalName === "x-data")!;
        const on = directives.find((d) => d.canonicalName === "x-on")!;
        expect(data.valueRange).toBeDefined();
        expect(on.valueRange).toBeDefined();
        const virtual = generateAlpineVirtualCode(html, "ml");
        const sm = createSourceMapAdapter(virtual.mappings);
        const dataHit = sm.mapSourceToVirtual(data.valueRange!.start);
        const onHit = sm.mapSourceToVirtual(on.valueRange!.start);
        expect(dataHit.mapping).toBeDefined();
        expect(onHit.mapping).toBeDefined();
        const dataText = virtual.code.slice(
            dataHit.mapping!.virtualRange.start,
            dataHit.mapping!.virtualRange.end,
        );
        const onText = virtual.code.slice(
            onHit.mapping!.virtualRange.start,
            onHit.mapping!.virtualRange.end,
        );
        expect(dataText).toContain("open");
        expect(onText).toContain("open = !open");
    });

    it("prefers nested x-data mappings for method bodies", () => {
        const virtual = generateAlpineVirtualCode(XDATA_METHOD_CASE, "doc");
        const sm = createSourceMapAdapter(virtual.mappings);
        const bodyOffset = XDATA_METHOD_CASE.indexOf("count++;");
        const projected = sm.mapSourceToVirtual(bodyOffset);
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data method inc body");
        const virtualText = virtual.code.slice(
            projected.mapping!.virtualRange.start,
            projected.mapping!.virtualRange.end,
        );
        expect(virtualText).toContain("{ count++; return count; }");
    });

    it("ignores directives outside stage 4 scope", () => {
        const html = [
            "<div",
            "    x-data=\"{ open: false }\"",
            "    x-init=\"load()\"",
            "    x-effect=\"count()\"",
            "    x-for=\"item in items\"",
            "></div>",
        ].join("\n");
        const directives = extractAlpineDirectives(html);
        expect(directives.map((d) => d.canonicalName)).toEqual(
            expect.arrayContaining(["x-data", "x-init", "x-effect", "x-for"]),
        );
        const virtual = generateAlpineVirtualCode(html, "doc");
        expect(virtual.code).toContain("let open");
        expect(virtual.code).not.toContain("load()");
        expect(virtual.code).not.toContain("count()");
        expect(virtual.code).not.toContain("for (");
    });

    it("filters completion-sensitive mappings on demand", () => {
        const virtual = generateAlpineVirtualCode(MINIMAL_CASE, "doc");
        const completionOnly = virtual.mappings.find(
            (m) => m.capabilities.completion === false,
        );
        expect(completionOnly).toBeDefined();
        const allowAll = createSourceMapAdapter(virtual.mappings);
        const allowed = allowAll.mapSourceToVirtual(completionOnly!.sourceRange.start);
        expect(allowed.mapping).toBeDefined();
    });
});
