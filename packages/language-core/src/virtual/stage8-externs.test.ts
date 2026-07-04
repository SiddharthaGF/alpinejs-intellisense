import { describe, expect, it } from "vitest";
import {
    generateAlpineVirtualCode,
    type ExternDeclaration,
} from "../index.js";

const MINIMAL_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <span x-text=\"open\"></span>",
    "</div>",
].join("\n");

describe("virtual generation with externs", () => {
    it("emits a declare global preamble when externs are provided", () => {
        const externs: ExternDeclaration[] = [
            { name: "open", kind: "property", type: "boolean" },
            { name: "toggle", kind: "method", type: "void" },
        ];
        const virtual = generateAlpineVirtualCode(MINIMAL_CASE, "doc", externs);
        expect(virtual.code).toContain("declare global {");
        expect(virtual.code).toContain("let open: boolean;");
        expect(virtual.code).toContain("function toggle(): void;");
    });

    it("handles an empty extern list the same as no externs", () => {
        const a = generateAlpineVirtualCode(MINIMAL_CASE, "doc", []);
        const b = generateAlpineVirtualCode(MINIMAL_CASE, "doc");
        expect(a.code).toBe(b.code);
    });

    it("keeps the original directives when externs are prepended", () => {
        const externs: ExternDeclaration[] = [
            { name: "open", kind: "property", type: "boolean" },
        ];
        const virtual = generateAlpineVirtualCode(MINIMAL_CASE, "doc", externs);
        expect(virtual.code).toContain("return open");
    });
});
