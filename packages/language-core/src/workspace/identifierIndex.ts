import {
    extractAlpineDirectives,
    parseDataLiteral,
} from "../index.js";

export interface IdentifierDeclaration {
    name: string;
    kind: "property" | "method" | "init";
    fileName: string;
    sourceOffset: number;
}

/**
 * Walk a parsed Alpine document and surface the top-level identifiers declared
 * by every `x-data` value. The result is what the language server feeds back
 * into the virtual TypeScript preamble so cross-file references resolve.
 *
 * The scanner never executes the file's JavaScript — it only inspects the
 * textual form (via the same AST helper used by the generator) and emits the
 * identifier names.
 */
export function indexIdentifiers(
    text: string,
    fileName: string,
): IdentifierDeclaration[] {
    const directives = extractAlpineDirectives(text);
    const out: IdentifierDeclaration[] = [];
    for (const directive of directives) {
        if (directive.canonicalName !== "x-data") {
            continue;
        }
        const value = directive.value ?? "{}";
        const parsed = parseDataLiteral(value);
        if (parsed.parseError) {
            continue;
        }
        for (const member of parsed.members) {
            out.push({
                name: member.name,
                kind: member.kind === "init" ? "init" : member.kind === "method" ? "method" : "property",
                fileName,
                sourceOffset: directive.valueRange
                    ? directive.valueRange.start + member.nameRange.start
                    : 0,
            });
        }
    }
    return out;
}
