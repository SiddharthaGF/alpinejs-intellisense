import { describe, expect, it } from "vitest";
import {
    extractAlpineDirectives,
    type AlpineDirectiveNode,
} from "./index.js";

interface Expected {
    originalName: string;
    canonicalName: string;
    shorthand?: "@" | ":";
    argument?: string;
    modifiers: string[];
    value?: string;
    valueKind: string;
    nameStart: number;
    nameEnd: number;
    valueStart?: number;
    valueEnd?: number;
    elementStart: number;
}

function directivesOf(html: string): AlpineDirectiveNode[] {
    return extractAlpineDirectives(html);
}

function expectSingle(html: string, expected: Expected): void {
    const nodes = directivesOf(html);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.originalName).toBe(expected.originalName);
    expect(node.canonicalName).toBe(expected.canonicalName);
    expect(node.shorthand ?? undefined).toBe(expected.shorthand ?? undefined);
    expect(node.argument ?? undefined).toBe(expected.argument ?? undefined);
    expect(node.modifiers).toEqual(expected.modifiers);
    expect(node.value).toBe(expected.value);
    expect(node.valueKind).toBe(expected.valueKind);
    expect(node.nameRange.start).toBe(expected.nameStart);
    expect(node.nameRange.end).toBe(expected.nameEnd);
    if (expected.valueStart !== undefined) {
        expect(node.valueRange?.start).toBe(expected.valueStart);
    }
    if (expected.valueEnd !== undefined) {
        expect(node.valueRange?.end).toBe(expected.valueEnd);
    }
    expect(node.elementRange.start).toBe(expected.elementStart);
}

describe("extractAlpineDirectives", () => {
    it("detects a directive name with double-quoted value", () => {
        const html = '<div x-data="{ open: false }"></div>';
        expectSingle(html, {
            originalName: "x-data",
            canonicalName: "x-data",
            modifiers: [],
            value: "{ open: false }",
            valueKind: "data-object",
            nameStart: html.indexOf("x-data"),
            nameEnd: html.indexOf("x-data") + "x-data".length,
            valueStart: html.indexOf('"') + 1,
            valueEnd: html.lastIndexOf('"'),
            elementStart: 0,
        });
    });

    it("detects a directive name with single-quoted value", () => {
        const html = `<span x-text='name'></span>`;
        expectSingle(html, {
            originalName: "x-text",
            canonicalName: "x-text",
            modifiers: [],
            value: "name",
            valueKind: "expression",
            nameStart: html.indexOf("x-text"),
            nameEnd: html.indexOf("x-text") + "x-text".length,
            valueStart: html.indexOf("'") + 1,
            valueEnd: html.lastIndexOf("'"),
            elementStart: 0,
        });
    });

    it("handles multi-line attributes with exact offsets", () => {
        const html = `<button\n    x-on:click.prevent="open = !open"\n></button>`;
        const node = directivesOf(html)[0]!;
        expect(node.canonicalName).toBe("x-on");
        expect(node.argument).toBe("click");
        expect(node.modifiers).toEqual(["prevent"]);
        const expectedNameStart = html.indexOf("x-on:click.prevent");
        expect(node.nameRange.start).toBe(expectedNameStart);
        expect(node.nameRange.end).toBe(expectedNameStart + "x-on:click.prevent".length);
        const value = "open = !open";
        const valueStart = html.indexOf(`"${value}"`) + 1;
        expect(node.valueRange?.start).toBe(valueStart);
        expect(node.valueRange?.end).toBe(valueStart + value.length);
        expect(node.value).toBe(value);
    });

    it("normalises @click.prevent into x-on with the shorthand marker", () => {
        const html = `<button @click.prevent="open = !open"></button>`;
        expectSingle(html, {
            originalName: "@click.prevent",
            canonicalName: "x-on",
            shorthand: "@",
            argument: "click",
            modifiers: ["prevent"],
            value: "open = !open",
            valueKind: "statement",
            nameStart: html.indexOf("@click.prevent"),
            nameEnd: html.indexOf("@click.prevent") + "@click.prevent".length,
            valueStart: html.indexOf('"') + 1,
            valueEnd: html.lastIndexOf('"'),
            elementStart: 0,
        });
    });

    it("normalises :disabled into x-bind with the shorthand marker", () => {
        const html = `<input :disabled="loading">`;
        expectSingle(html, {
            originalName: ":disabled",
            canonicalName: "x-bind",
            shorthand: ":",
            argument: "disabled",
            modifiers: [],
            value: "loading",
            valueKind: "expression",
            nameStart: html.indexOf(":disabled"),
            nameEnd: html.indexOf(":disabled") + ":disabled".length,
            valueStart: html.indexOf('"') + 1,
            valueEnd: html.lastIndexOf('"'),
            elementStart: 0,
        });
    });

    it("accepts chained modifiers on long and short forms", () => {
        const longNode = directivesOf(
            `<input x-on:keydown.shift.ctrl.alt="run()">`,
        )[0]!;
        expect(longNode.canonicalName).toBe("x-on");
        expect(longNode.argument).toBe("keydown");
        expect(longNode.modifiers).toEqual(["shift", "ctrl", "alt"]);

        const shortNode = directivesOf(
            `<input @keyup.shift.once="run()">`,
        )[0]!;
        expect(shortNode.canonicalName).toBe("x-on");
        expect(shortNode.shorthand).toBe("@");
        expect(shortNode.argument).toBe("keyup");
        expect(shortNode.modifiers).toEqual(["shift", "once"]);
    });

    it("reports directives without a value as 'none' valueKind", () => {
        const html = `<div x-cloak></div>`;
        const node = directivesOf(html)[0]!;
        expect(node.canonicalName).toBe("x-cloak");
        expect(node.valueKind).toBe("none");
        expect(node.value).toBeUndefined();
        expect(node.valueRange).toBeUndefined();
        expect(node.nameRange).toEqual({
            start: html.indexOf("x-cloak"),
            end: html.indexOf("x-cloak") + "x-cloak".length,
        });
    });

    it("tolerates incomplete HTML at end of input", () => {
        const html = `<div x-data="{ open: false }"><button @click=`;
        const nodes = directivesOf(html);
        expect(nodes.length).toBeGreaterThanOrEqual(1);
        const data = nodes.find((d) => d.canonicalName === "x-data")!;
        expect(data.value).toBe("{ open: false }");
    });

    it("ignores unknown directives and non-Alpine attributes", () => {
        const html = `<div class="foo" x-data="{}" x-totallymade="bar"></div>`;
        const names = directivesOf(html).map((d) => d.canonicalName);
        expect(names).toContain("x-data");
        expect(names).not.toContain("x-totallymade");
    });

    it("extracts directives from nested elements", () => {
        const html = [
            "<section>",
            '  <div x-data="{ open: false }">',
            '    <button @click="open = !open">x</button>',
            '    <span x-text="open"></span>',
            "  </div>",
            "</section>",
        ].join("\n");
        const nodes = directivesOf(html);
        const canonicals = nodes.map((d) => d.canonicalName);
        expect(canonicals).toEqual(
            expect.arrayContaining(["x-data", "x-on", "x-text"]),
        );
        const data = nodes.find((d) => d.canonicalName === "x-data")!;
        const onClick = nodes.find(
            (d) => d.canonicalName === "x-on" && d.shorthand === "@",
        )!;
        const text = nodes.find((d) => d.canonicalName === "x-text")!;
        expect(data.elementRange.start).toBeLessThan(onClick.elementRange.start);
        expect(onClick.elementRange.start).toBeLessThan(text.elementRange.start);
    });

    it("does not treat siblings after void elements as nested inside the prior component", () => {
        const html = [
            '<body x-data="{ parentCounter: 0 }">',
            '  <div x-data="{ count: 0, message: \'Hola\' }">',
            '    <input type="text" x-model="message">',
            "  </div>",
            '  <button x-on:click="console.log(count)"></button>',
            "</body>",
        ].join("\n");
        const nodes = directivesOf(html);
        const innerData = nodes.find(
            (d) => d.canonicalName === "x-data" && d.value?.includes("count: 0"),
        )!;
        const outerButton = nodes.find(
            (d) => d.canonicalName === "x-on" && d.value === "console.log(count)",
        )!;
        expect(innerData.elementRange.end).toBeLessThanOrEqual(outerButton.elementRange.start);
    });

    it("keeps attribute range inclusive of whitespace", () => {
        const html = `<div   x-data   =   "{ a: 1 }"   ></div>`;
        const node = directivesOf(html)[0]!;
        expect(node.attributeRange.start).toBe(html.indexOf("x-data"));
        expect(node.attributeRange.end).toBeGreaterThan(html.indexOf('1 }"'));
    });
});
