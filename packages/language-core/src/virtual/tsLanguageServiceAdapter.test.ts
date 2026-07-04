import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
    adaptDiagnostics,
    createSourceMapAdapter,
    createTypeScriptLanguageServiceAdapter,
    generateAlpineVirtualCode,
} from "../index.js";

const TYPO_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <button @click=\"opne = true\"></button>",
    "</div>",
].join("\n");

const COMPLETION_CASE = [
    "<div x-data=\"{ open: false, toggle() {} }\">",
    "    <button @click=\"tog\"></button>",
    "</div>",
].join("\n");

const HOVER_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <span x-text=\"open\"></span>",
    "</div>",
].join("\n");

const EVENT_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <input @input=\"$event.target.value\">",
    "</div>",
].join("\n");

const MAGIC_HOVER_CASE = [
    "<div x-data=\"{ message: 'Hola', focusCurrent() { return this.$nextTick(); } }\">",
    "    <button @click=\"$el.innerHTML = message\"></button>",
    "</div>",
].join("\n");

const MAGIC_COMPLETION_CASE = [
    "<div x-data=\"{ message: 'Hola' }\">",
    "    <button @click=\"$n\"></button>",
    "</div>",
].join("\n");

const CONSOLE_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <button @click=\"console.log(open)\"></button>",
    "</div>",
].join("\n");

const XDATA_HOVER_CASE = [
    "<div x-data=\"{ contador: 0, mensaje: 'Hola Mundo', up() { contador++; return mensaje; } }\"></div>",
].join("\n");

const XDATA_CONSOLE_CASE = [
    "<div x-data=\"{ count: 0, up() { count++; console.log('Contador incrementado a: ' + count); } }\"></div>",
].join("\n");

const XDATA_MATH_CASE = [
    "<div x-data=\"{ count: 0, up() { count = Math.abs(count) + 1; } }\"></div>",
].join("\n");

const XDATA_THIS_CASE = [
    "<div x-data=\"{ count: 0, message: 'Hola', up() { this.count = Math.abs(this.count) + 1; return this.message; } }\"></div>",
].join("\n");

const XDATA_GETTER_CASE = [
    "<div x-data=\"{ count: 0, get doubleCount() { return this.count * 2; } }\">",
    "    <span x-text=\"doubleCount\"></span>",
    "</div>",
].join("\n");

const XDATA_JSDOC_METHOD_CASE = [
    "<div x-data=\"{",
    "/**",
    " * @param {string} newMessage",
    " * @returns {void}",
    " */",
    "updateMessage(newMessage) {",
    "  this.message = newMessage;",
    "},",
    "message: 'Hola'",
    "}\">",
    "    <button x-on:click=\"updateMessage\"></button>",
    "</div>",
].join("\n");

const XDATA_JSDOC_GETTER_CASE = [
    "<div x-data=\"{",
    "_count: 0,",
    "/**",
    " * @returns {number}",
    " */",
    "get count() {",
    "  return this._count;",
    "}",
    "}\">",
    "    <span x-text=\"count\"></span>",
    "</div>",
].join("\n");

const XDATA_TYPED_COMPLETION_CASE = [
    "<div x-data=\"{ count: 0, message: 'Hola', up() { count++; } }\">",
    "    <span x-text=\"cou\"></span>",
    "</div>",
].join("\n");

const XDATA_DEFINITION_CASE = [
    "<div x-data=\"{ count: 0, up() { console.log(count); }, reset() { count = 0; } }\">",
    "    <span x-text=\"count\"></span>",
    "</div>",
].join("\n");

const XDATA_METHOD_DEFINITION_CASE = [
    "<div x-data=\"{ count: 0, reset() { count = 0; } }\">",
    "    <button x-on:click=\"reset\"></button>",
    "    <button x-on:click=\"reset()\"></button>",
    "</div>",
].join("\n");

const OUT_OF_SCOPE_CASE = [
    "<div x-data=\"{ localCount: 0, up() { localCount++; } }\">",
    "    <span x-text=\"localCount\"></span>",
    "</div>",
    "<button x-on:click=\"console.log(localCount)\"></button>",
].join("\n");

function compute(input: string): ReturnType<typeof generateAlpineVirtualCode> {
    return generateAlpineVirtualCode(input, "test");
}

function buildService(input: string) {
    const virtual = compute(input);
    const adapter = createTypeScriptLanguageServiceAdapter("test");
    adapter.attach(virtual);
    return { virtual, adapter, service: adapter.service };
}

function findOffsetOf(text: string, needle: string, from = 0): number {
    return text.indexOf(needle, from);
}

describe("TypeScript Language Service adapter", () => {
    it("emits a diagnostic for the typo `opne` in @click", () => {
        const { virtual, adapter } = buildService(TYPO_CASE);
        const diagnostics = [
            ...adapter.service.getSyntacticDiagnostics(),
            ...adapter.service.getSemanticDiagnostics(),
        ];
        const adapted = adaptDiagnostics(diagnostics, virtual.mappings);
        const typo = adapted.find((d) => d.message.toLowerCase().includes("opne"));
        expect(typo, "expected a diagnostic mentioning the typo `opne`").toBeDefined();
        expect(typo?.reportable).toBe(true);
        expect(typo?.sourceRange).toBeDefined();
        const sourceText = TYPO_CASE;
        const snippet = sourceText.slice(typo!.sourceRange!.start, typo!.sourceRange!.end);
        expect(snippet.toLowerCase()).toContain("opne");
    });

    it("drops diagnostics that wrap an internal identifier", () => {
        const { virtual, adapter } = buildService(TYPO_CASE);
        const diagnostics = [
            ...adapter.service.getSyntacticDiagnostics(),
            ...adapter.service.getSemanticDiagnostics(),
        ];
        const adapted = adaptDiagnostics(diagnostics, virtual.mappings);
        const leaked = adapted.find(
            (d) => d.message.includes("__alpine_internal_") || d.message.includes("__alpine_data"),
        );
        expect(leaked).toBeUndefined();
    });

    it("suggests `toggle` for completion inside the @click handler", () => {
        const { adapter } = buildService(COMPLETION_CASE);
        const virtual = compute(COMPLETION_CASE);
        const valueStart = COMPLETION_CASE.indexOf("\"tog\"") + 1;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart);
        expect(projected.mapping, "expected mapping for the `tog` value").toBeDefined();
        const completions = adapter.service.getCompletionsAtPosition(projected.mapping!.virtualRange.end);
        expect(completions, "expected TS LS to return completions").toBeDefined();
        const labels = (completions!.entries ?? completions!.entries).map((e) => e.name);
        expect(labels).toContain("toggle");
    });

    it("returns typed completion details for x-data numeric state", () => {
        const { adapter } = buildService(XDATA_TYPED_COMPLETION_CASE);
        const virtual = compute(XDATA_TYPED_COMPLETION_CASE);
        const valueStart = XDATA_TYPED_COMPLETION_CASE.indexOf('x-text="cou') + 'x-text="cou'.length;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart - 1, { completion: true });
        expect(projected.mapping, "expected completion mapping for x-text value").toBeDefined();
        const offset = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const completions = adapter.service.getCompletionsAtPosition(offset);
        expect(completions, "expected TS LS to return completions").toBeDefined();
        const count = completions?.entries.find((entry) => entry.name === "count");
        expect(count, "expected `count` completion").toBeDefined();
        const details = adapter.service.getCompletionEntryDetails(offset, count!);
        const display = (details?.displayParts ?? []).map((part) => part.text).join("");
        expect(display.toLowerCase()).toContain("count");
        expect(display.toLowerCase()).toContain("number");
    });

    it("resolves local definitions for x-data state usage", () => {
        const { adapter } = buildService(XDATA_DEFINITION_CASE);
        const virtual = compute(XDATA_DEFINITION_CASE);
        const valueStart = XDATA_DEFINITION_CASE.lastIndexOf('x-text="count') + 'x-text="'.length;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { definition: true });
        expect(projected.mapping, "expected definition mapping for x-text value").toBeDefined();
        const offset = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const definitions = adapter.service.getDefinitionAtPosition(offset);
        expect(definitions && definitions.length > 0, "expected local definitions").toBeTruthy();
        expect(definitions?.some((definition) => definition.fileName === adapter.service.fileName)).toBe(true);
    });

    it("resolves standard library definitions for console.log", () => {
        const { adapter } = buildService(XDATA_CONSOLE_CASE);
        const virtual = compute(XDATA_CONSOLE_CASE);
        const valueStart = XDATA_CONSOLE_CASE.indexOf("log(") + 1;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { definition: true });
        expect(projected.mapping, "expected definition mapping for console.log").toBeDefined();
        const offset = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const definitions = adapter.service.getDefinitionAtPosition(offset);
        expect(definitions && definitions.length > 0, "expected library definitions").toBeTruthy();
        expect(definitions?.some((definition) => /lib\.(dom|es\d+)/.test(definition.fileName))).toBe(true);
    });

    it("resolves local definitions for x-data method handler references with and without parentheses", () => {
        const { adapter } = buildService(XDATA_METHOD_DEFINITION_CASE);
        const virtual = compute(XDATA_METHOD_DEFINITION_CASE);
        const sm = createSourceMapAdapter(virtual.mappings);
        for (const marker of ['x-on:click="reset"', 'x-on:click="reset()"']) {
            const valueStart = XDATA_METHOD_DEFINITION_CASE.indexOf(marker) + 'x-on:click="'.length + 1;
            const projected = sm.mapSourceToVirtual(valueStart, { definition: true });
            expect(projected.mapping, `expected definition mapping for ${marker}`).toBeDefined();
            const offset = projected.mapping!.virtualRange.start
                + Math.min(
                    projected.mapping!.virtualRange.end - projected.mapping!.virtualRange.start,
                    Math.max(0, valueStart - projected.mapping!.sourceRange.start),
                );
            const definitions = adapter.service.getDefinitionAtPosition(offset);
            expect(definitions && definitions.length > 0, `expected local method definition for ${marker}`).toBeTruthy();
            expect(definitions?.some((definition) => definition.fileName === adapter.service.fileName)).toBe(true);
        }
    });

    it("does not leak x-data locals into sibling directives outside the component", () => {
        const { adapter } = buildService(OUT_OF_SCOPE_CASE);
        const virtual = compute(OUT_OF_SCOPE_CASE);
        const marker = 'x-on:click="console.log(localCount)';
        const valueStart = OUT_OF_SCOPE_CASE.indexOf(marker) + marker.length;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart - 1, { completion: true });
        expect(projected.mapping, "expected completion mapping for sibling handler").toBeDefined();
        const offset = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const completions = adapter.service.getCompletionsAtPosition(offset);
        expect(completions?.entries.some((entry) => entry.name === "localCount")).toBe(false);
        const diagnostics = [
            ...adapter.service.getSyntacticDiagnostics(),
            ...adapter.service.getSemanticDiagnostics(),
        ];
        expect(
            diagnostics.some((diag) => ts.flattenDiagnosticMessageText(diag.messageText, "\n").includes("localCount")),
        ).toBe(true);
    });

    it("hover on `open` inside x-text shows a type description", () => {
        const { virtual, adapter } = buildService(HOVER_CASE);
        const valueStart = HOVER_CASE.indexOf("\"open\"") + 1;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart);
        expect(projected.mapping).toBeDefined();
        const inside = projected.mapping!.virtualRange.start + 1;
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover, "expected hover info for `open`").toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join("");
        const blob = `${display}\n${docs}`;
        expect(blob.toLowerCase()).toMatch(/boolean/);
    });

    it("treats @input handler as having a typed $event", () => {
        const { virtual, adapter } = buildService(EVENT_CASE);
        const valueStart = EVENT_CASE.indexOf("$event");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart);
        expect(projected.mapping).toBeDefined();
        // Position inside the body where `$event` begins (after the 4 indent spaces).
        const inside = projected.mapping!.virtualRange.start + 5;
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join("");
        const text = `${display} ${docs}`.toLowerCase();
        expect(text).toContain("event");
    });

    it("provides hover info for $el inside Alpine handlers", () => {
        const { virtual, adapter } = buildService(MAGIC_HOVER_CASE);
        const valueStart = MAGIC_HOVER_CASE.indexOf("$el");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { hover: true });
        expect(projected.mapping).toBeDefined();
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join(" ");
        const text = `${display} ${docs}`.toLowerCase();
        expect(text).toContain("$el");
        expect(text).toContain("htmlelement");
        expect(text).toContain("current dom node");
    });

    it("completes Alpine magic helpers inside handlers", () => {
        const { adapter } = buildService(MAGIC_COMPLETION_CASE);
        const virtual = compute(MAGIC_COMPLETION_CASE);
        const valueStart = MAGIC_COMPLETION_CASE.indexOf("\"$n") + 1;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { completion: true });
        expect(projected.mapping).toBeDefined();
        const offset = projected.mapping!.virtualRange.start
            + (valueStart + 2 - projected.mapping!.sourceRange.start);
        const completions = adapter.service.getCompletionsAtPosition(offset);
        expect(completions).toBeDefined();
        const labels = (completions?.entries ?? []).map((entry) => entry.name);
        expect(labels).toContain("$nextTick");
    });

    it("loads standard library hover docs for console.log inside handlers", () => {
        const { virtual, adapter } = buildService(CONSOLE_CASE);
        const valueStart = CONSOLE_CASE.indexOf("log(");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart);
        expect(projected.mapping).toBeDefined();
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join(" ");
        expect(display).toContain("Console.log");
        expect(docs.toLowerCase()).toContain("prints to");
    });

    it("loads standard library hover docs for console inside x-data methods", () => {
        const { virtual, adapter } = buildService(XDATA_CONSOLE_CASE);
        const valueStart = XDATA_CONSOLE_CASE.indexOf("console.log");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { hover: true });
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data method up body");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join(" ");
        expect(display.toLowerCase()).toContain("console");
        expect(docs.toLowerCase()).toContain("debugging console");
    });

    it("loads standard library hover docs for console.log inside x-data methods", () => {
        const { virtual, adapter } = buildService(XDATA_CONSOLE_CASE);
        const valueStart = XDATA_CONSOLE_CASE.indexOf("log(");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { hover: true });
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data method up body");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join(" ");
        expect(display).toContain("Console.log");
        expect(docs.toLowerCase()).toContain("prints to");
    });

    it("loads standard library hover docs for Math inside x-data methods", () => {
        const { virtual, adapter } = buildService(XDATA_MATH_CASE);
        const valueStart = XDATA_MATH_CASE.indexOf("Math.abs");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { hover: true });
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data method up body");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join(" ");
        expect(display).toContain("Math");
        expect(docs.toLowerCase()).toContain("mathematics functionality");
    });

    it("loads standard library hover docs for Math.abs inside x-data methods", () => {
        const { virtual, adapter } = buildService(XDATA_MATH_CASE);
        const valueStart = XDATA_MATH_CASE.indexOf("abs(");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { hover: true });
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data method up body");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join(" ");
        expect(display).toContain("Math.abs");
        expect(docs.toLowerCase()).toContain("absolute value");
    });

    it("types `this` inside x-data methods", () => {
        const { virtual, adapter } = buildService(XDATA_THIS_CASE);
        const valueStart = XDATA_THIS_CASE.indexOf("this.count");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart + 1, { hover: true });
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data method up body");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart + 1 - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? []).map((p) => p.text).join("");
        expect(display.toLowerCase()).not.toBe("any");
        expect(display).toContain("__alpine_internal_magic_scope");
        expect(display.toLowerCase()).toContain("count: number");
        expect(display.toLowerCase()).toContain("message: string");
        expect(display).not.toContain("AlpineComponentScope_");
    });

    it("types `this.message` inside x-data methods", () => {
        const { virtual, adapter } = buildService(XDATA_THIS_CASE);
        const valueStart = XDATA_THIS_CASE.indexOf("this.message") + "this.".length;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart + 1, { hover: true });
        expect(projected.mapping).toBeDefined();
        const inside = projected.mapping!.virtualRange.start
            + (valueStart + 1 - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? []).map((p) => p.text).join("");
        expect(display.toLowerCase()).toContain("message");
        expect(display.toLowerCase()).toContain("string");
    });

    it("infers getter return types inside x-data declarations", () => {
        const { virtual, adapter } = buildService(XDATA_GETTER_CASE);
        const valueStart = XDATA_GETTER_CASE.indexOf("doubleCount()") + 1;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { hover: true });
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data getter doubleCount");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? []).map((p) => p.text).join("").toLowerCase();
        expect(display).toContain("doublecount");
        expect(display).toContain("number");
        expect(display).not.toContain("unknown");
    });

    it("preserves JSDoc parameter types for x-data method aliases", () => {
        const { adapter } = buildService(XDATA_JSDOC_METHOD_CASE);
        const virtual = compute(XDATA_JSDOC_METHOD_CASE);
        const valueStart = XDATA_JSDOC_METHOD_CASE.indexOf('x-on:click="updateMessage') + 'x-on:click="'.length;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart + 1, { hover: true });
        expect(projected.mapping).toBeDefined();
        const inside = projected.mapping!.virtualRange.start
            + (valueStart + 1 - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? []).map((p) => p.text).join("").toLowerCase();
        expect(display).toContain("updatemessage");
        expect(display).toContain("newmessage: string");
        expect(display).toContain("void");
        expect(display).not.toContain("newmessage: any");
    });

    it("preserves JSDoc return types for x-data getters", () => {
        const { virtual, adapter } = buildService(XDATA_JSDOC_GETTER_CASE);
        const valueStart = XDATA_JSDOC_GETTER_CASE.indexOf("count()") + 1;
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart, { hover: true });
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data getter count");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? []).map((p) => p.text).join("").toLowerCase();
        expect(display).toContain("count");
        expect(display).toContain("number");
        expect(display).not.toContain("any");
    });

    it("resolves hover inside x-data method bodies against sibling declarations", () => {
        const { virtual, adapter } = buildService(XDATA_HOVER_CASE);
        const valueStart = XDATA_HOVER_CASE.indexOf("contador++;");
        const sm = createSourceMapAdapter(virtual.mappings);
        const projected = sm.mapSourceToVirtual(valueStart);
        expect(projected.mapping).toBeDefined();
        expect(projected.mapping?.label).toBe("x-data method up body");
        const inside = projected.mapping!.virtualRange.start
            + (valueStart - projected.mapping!.sourceRange.start);
        const hover = adapter.service.getHoverAtPosition(inside);
        expect(hover).toBeDefined();
        const display = (hover!.displayParts ?? [])
            .map((p) => p.text)
            .join("");
        const docs = (hover!.documentation ?? [])
            .map((p) => p.text)
            .join("");
        const blob = `${display}\n${docs}`.toLowerCase();
        expect(blob).toContain("contador");
        expect(blob).toContain("number");
    });

    it("does not surface internal identifiers inside diagnostics for the typo case", () => {
        const { virtual, adapter } = buildService(TYPO_CASE);
        const syntactic = adapter.service.getSyntacticDiagnostics();
        const semantic = adapter.service.getSemanticDiagnostics();
        const adapted = adaptDiagnostics([...syntactic, ...semantic], virtual.mappings);
        const reportable = adapted.filter((d) => d.reportable);
        for (const d of reportable) {
            expect(d.message).not.toContain("__alpine_internal_");
            expect(d.message).not.toContain("__alpine_data");
        }
    });

    it("rebuilds when the virtual code is reattached", () => {
        const { adapter } = buildService(HOVER_CASE);
        const rebuilt = compute(TYPO_CASE);
        adapter.attach(rebuilt);
        const diagnostics = [
            ...adapter.service.getSyntacticDiagnostics(),
            ...adapter.service.getSemanticDiagnostics(),
        ];
        const adapted = adaptDiagnostics(diagnostics, rebuilt.mappings);
        const typo = adapted.find((d) => d.message.toLowerCase().includes("opne"));
        expect(typo).toBeDefined();
    });
});

describe("exposed types", () => {
    it("LanguageServiceAdapter attaches and detaches", () => {
        const adapter = createTypeScriptLanguageServiceAdapter("cli");
        expect(adapter.isAttached()).toBe(false);
        const virtual = generateAlpineVirtualCode(HOVER_CASE, "cli");
        adapter.attach(virtual);
        expect(adapter.isAttached()).toBe(true);
        adapter.detach();
        expect(adapter.isAttached()).toBe(false);
    });

    it("Diagnostic information round-trips TypeScript script kind correctly", () => {
        const code = "let foo = 1;";
        const sf = ts.createSourceFile("x.ts", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
        expect(sf.statements.length).toBe(1);
        void findOffsetOf;
    });
});
