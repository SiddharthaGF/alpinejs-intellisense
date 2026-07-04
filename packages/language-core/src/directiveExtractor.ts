import {
    getDirectiveByAttributeName,
    splitAttributeName,
    type DirectiveSpec,
} from "@alpine-language-tools/alpine-spec";
import type {
    AlpineDirectiveNode,
    OffsetRange,
    ParsedAttribute,
    ParsedElement,
} from "./types.js";
import { parseElements } from "./parser/htmlElementParser.js";

export interface ExtractOptions {
    knownDirectives?: DirectiveSpec[];
}

export function extractAlpineDirectives(
    input: string,
    options: ExtractOptions = {},
): AlpineDirectiveNode[] {
    const roots = parseElements(input);
    const directives: AlpineDirectiveNode[] = [];
    walk(roots, directives, options.knownDirectives);
    return directives;
}

function walk(
    elements: ParsedElement[],
    out: AlpineDirectiveNode[],
    knownDirectives: readonly DirectiveSpec[] | undefined,
): void {
    for (const element of elements) {
        for (const attribute of element.attributes) {
            const node = toDirective(attribute, element, knownDirectives);
            if (node) {
                out.push(node);
            }
        }
        if (element.children.length > 0) {
            walk(element.children, out, knownDirectives);
        }
    }
}

function toDirective(
    attribute: ParsedAttribute,
    element: ParsedElement,
    knownDirectives: readonly DirectiveSpec[] | undefined,
): AlpineDirectiveNode | null {
    const split = splitAttributeName(attribute.name);
    if (!split) {
        return null;
    }
    const spec = knownDirectives
        ? knownDirectives.find((d) => d.name === split.canonical)
        : getDirectiveByAttributeName(attribute.name);
    if (!spec) {
        return null;
    }
    const elementRange: OffsetRange = {
        start: element.start,
        end: Math.max(element.end, element.start),
    };
    return {
        originalName: attribute.name,
        canonicalName: spec.name,
        shorthand: split.shorthand,
        argument: split.argument,
        modifiers: [...split.modifiers],
        value: attribute.value,
        valueKind: spec.valueKind,
        attributeRange: attribute.attributeRange,
        nameRange: attribute.nameRange,
        valueRange: attribute.valueRange,
        elementRange,
    };
}

export { parseElements } from "./parser/htmlElementParser.js";
export { splitAttributeName } from "@alpine-language-tools/alpine-spec";
export type {
    AlpineDirectiveNode,
    DirectiveValueKind,
    OffsetRange,
    ParsedAttribute,
    ParsedElement,
} from "./types.js";
