/**
 * Public model for the Alpine Language Tools core.
 *
 * Stage 3 introduces the declarative directive model and the parser that
 * converts HTML into a stream of `AlpineDirectiveNode`s. The core stays
 * framework-agnostic; LSP, VS Code, and tests all consume the same types.
 */
import type { DirectiveValueKind } from "@alpine-language-tools/alpine-spec";

export type { DirectiveValueKind } from "@alpine-language-tools/alpine-spec";

export interface OffsetRange {
    start: number;
    end: number;
}

export interface AlpineDirectiveNode {
    originalName: string;
    canonicalName: string;
    shorthand?: "@" | ":";
    argument?: string;
    modifiers: string[];
    value?: string;
    valueKind: DirectiveValueKind;
    attributeRange: OffsetRange;
    nameRange: OffsetRange;
    valueRange?: OffsetRange;
    elementRange: OffsetRange;
}

export interface ParsedAttribute {
    name: string;
    value: string | undefined;
    nameRange: OffsetRange;
    valueRange: OffsetRange | undefined;
    attributeRange: OffsetRange;
}

export interface ParsedElement {
    tag: string | undefined;
    attributes: ParsedAttribute[];
    children: ParsedElement[];
    startTagOpen?: OffsetRange;
    startTagClose?: OffsetRange;
    start: number;
    end: number;
}
