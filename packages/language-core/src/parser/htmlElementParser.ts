import { getLanguageService } from "vscode-html-languageservice";
import type { OffsetRange, ParsedAttribute, ParsedElement } from "../types.js";

type Token = number;

interface Scanner {
    scan(): Token;
    getTokenOffset(): number;
    getTokenEnd(): number;
    getTokenText(): string;
    getTokenLength(): number;
}

interface PendingAttribute {
    name: string;
    nameRange: OffsetRange;
    hasEquals: boolean;
}

interface OpeningElement {
    tag: string | undefined;
    start: number;
    startTagOpenEnd: number | undefined;
    attributes: ParsedAttribute[];
    pending: PendingAttribute | undefined;
    lastAttributeEnd: number | undefined;
    startTagEnd: number | undefined;
}

const VOID_ELEMENTS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

const scannerFactory = (): { createScanner(input: string): Scanner } => {
    const service = getLanguageService();
    return {
        createScanner(input: string): Scanner {
            return service.createScanner(input) as unknown as Scanner;
        },
    };
};

function stripAttributeQuotes(raw: string): string {
    if (raw.length < 2) {
        return raw;
    }
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'") && first === last) {
        return raw.slice(1, -1);
    }
    return raw;
}

const Token = {
    EOS: 21,
    StartTagOpen: 3,
    StartTag: 6,
    AttributeName: 11,
    DelimiterAssign: 10,
    AttributeValue: 12,
    StartTagSelfClose: 5,
    StartTagClose: 4,
    EndTagOpen: 7,
    EndTagClose: 8,
} as const;

/**
 * Tolerant HTML element parser built on top of `vscode-html-languageservice`'s
 * scanner. Captures full attribute offsets, accepts malformed / incomplete
 * documents, and never throws for partial input.
 */
export function parseElements(input: string): ParsedElement[] {
    if (!input) {
        return [];
    }

    const toParsedElement = (opening: OpeningElement, end: number): ParsedElement => {
        const tagEnd = opening.startTagEnd ?? opening.start;
        return {
            tag: opening.tag,
            attributes: opening.attributes,
            children: [],
            startTagOpen: { start: opening.start, end: tagEnd },
            startTagClose:
                opening.startTagEnd !== undefined && opening.lastAttributeEnd !== undefined
                    ? { start: opening.lastAttributeEnd, end: opening.startTagEnd }
                    : undefined,
            start: opening.start,
            end,
        };
    };

    const scanner = scannerFactory().createScanner(input);
    const stack: { opening: OpeningElement; element: ParsedElement }[] = [];
    const roots: ParsedElement[] = [];

    const pushElement = (end: number): ParsedElement => {
        const { opening, element } = stack[stack.length - 1];
        element.end = end;
        if (opening.startTagEnd !== undefined && opening.lastAttributeEnd !== undefined) {
            element.startTagClose = { start: opening.lastAttributeEnd, end: opening.startTagEnd };
        }
        const node = element;
        if (stack.length > 1) {
            stack[stack.length - 2].element.children.push(node);
        } else {
            roots.push(node);
        }
        return node;
    };

    const finalizePendingAttribute = (target: OpeningElement, end: number, fallbackEnd: number): void => {
        if (!target.pending) {
            target.lastAttributeEnd = end;
            return;
        }
        const attributeEnd = end === target.pending.nameRange.end ? fallbackEnd : end;
        target.attributes.push({
            name: target.pending.name,
            value: undefined,
            nameRange: target.pending.nameRange,
            valueRange: undefined,
            attributeRange: { start: target.pending.nameRange.start, end: attributeEnd },
        });
        target.pending = undefined;
        target.lastAttributeEnd = attributeEnd;
    };

    let token = scanner.scan();
    while (token !== Token.EOS) {
        const current = stack[stack.length - 1];
        switch (token) {
            case Token.StartTagOpen: {
                const start = scanner.getTokenOffset();
                const opening: OpeningElement = {
                    tag: readTagName(input, start),
                    start,
                    startTagOpenEnd: scanner.getTokenEnd(),
                    attributes: [],
                    pending: undefined,
                    lastAttributeEnd: scanner.getTokenEnd(),
                    startTagEnd: undefined,
                };
                const element = toParsedElement(opening, input.length);
                stack.push({ opening, element });
                break;
            }
            case Token.StartTag: {
                if (current) {
                    current.opening.tag = scanner.getTokenText();
                }
                break;
            }
            case Token.AttributeName: {
                if (!current) {
                    break;
                }
                if (current.opening.pending) {
                    finalizePendingAttribute(
                        current.opening,
                        scanner.getTokenOffset(),
                        scanner.getTokenEnd(),
                    );
                }
                current.opening.pending = {
                    name: scanner.getTokenText(),
                    nameRange: {
                        start: scanner.getTokenOffset(),
                        end: scanner.getTokenEnd(),
                    },
                    hasEquals: false,
                };
                current.opening.lastAttributeEnd = scanner.getTokenEnd();
                break;
            }
            case Token.DelimiterAssign: {
                if (!current || !current.opening.pending) {
                    break;
                }
                current.opening.pending.hasEquals = true;
                current.opening.lastAttributeEnd = scanner.getTokenEnd();
                break;
            }
            case Token.AttributeValue: {
                if (!current) {
                    break;
                }
                const raw = scanner.getTokenText();
                const rawOffset = scanner.getTokenOffset();
                const rawEnd = scanner.getTokenEnd();
                const value = stripAttributeQuotes(raw);
                const valueOffset = rawOffset + (raw.length - value.length === 2 ? 1 : 0);
                const valueEnd = valueOffset + value.length;
                if (current.opening.pending) {
                    const nameRange = current.opening.pending.nameRange;
                    current.opening.attributes.push({
                        name: current.opening.pending.name,
                        value,
                        nameRange,
                        valueRange: { start: valueOffset, end: valueEnd },
                        attributeRange: { start: nameRange.start, end: rawEnd },
                    });
                    current.opening.pending = undefined;
                }
                current.opening.lastAttributeEnd = rawEnd;
                break;
            }
            case Token.StartTagSelfClose: {
                if (current) {
                    if (current.opening.pending) {
                        finalizePendingAttribute(
                            current.opening,
                            scanner.getTokenEnd() - 1,
                            scanner.getTokenEnd(),
                        );
                    }
                    current.opening.startTagEnd = scanner.getTokenEnd();
                    current.opening.lastAttributeEnd = scanner.getTokenEnd();
                    pushElement(scanner.getTokenEnd());
                    stack.pop();
                }
                break;
            }
            case Token.StartTagClose: {
                if (current) {
                    const closeEnd = scanner.getTokenEnd();
                    const hasCloseChar = scanner.getTokenLength() > 0;
                    if (current.opening.pending) {
                        finalizePendingAttribute(
                            current.opening,
                            hasCloseChar ? closeEnd - 1 : closeEnd,
                            closeEnd,
                        );
                    }
                    current.opening.startTagEnd = closeEnd;
                    current.opening.lastAttributeEnd = closeEnd;
                    if (current.opening.tag && VOID_ELEMENTS.has(current.opening.tag)) {
                        pushElement(closeEnd);
                        stack.pop();
                    }
                }
                break;
            }
            case Token.EndTagOpen: {
                if (current && current.opening.pending) {
                    finalizePendingAttribute(
                        current.opening,
                        scanner.getTokenOffset(),
                        scanner.getTokenOffset(),
                    );
                }
                if (current) {
                    current.opening.startTagEnd = scanner.getTokenOffset();
                }
                break;
            }
            case Token.EndTagClose: {
                const offset = scanner.getTokenOffset();
                const closeEnd = scanner.getTokenEnd();
                if (stack.length === 0) {
                    break;
                }
                const target = stack[stack.length - 1];
                target.opening.startTagEnd = target.opening.startTagEnd ?? offset;
                target.opening.lastAttributeEnd = closeEnd;
                pushElement(closeEnd);
                stack.pop();
                break;
            }
            default:
                break;
        }
        token = scanner.scan();
    }

    while (stack.length > 0) {
        const { opening } = stack[stack.length - 1];
        if (opening.pending) {
            finalizePendingAttribute(opening, opening.lastAttributeEnd ?? input.length, input.length);
        }
        opening.startTagEnd = opening.startTagEnd ?? input.length;
        opening.lastAttributeEnd = input.length;
        pushElement(input.length);
        stack.pop();
    }

    return roots;
}

function readTagName(input: string, start: number): string | undefined {
    if (start < 0 || start >= input.length || input[start] !== "<") {
        return undefined;
    }
    let i = start + 1;
    while (i < input.length && /\s/.test(input[i] ?? "")) {
        i += 1;
    }
    if (input[i] === "/") {
        i += 1;
    }
    const nameStart = i;
    while (i < input.length && /[A-Za-z0-9:-]/.test(input[i] ?? "")) {
        i += 1;
    }
    const tag = input.slice(nameStart, i).trim().toLowerCase();
    return tag || undefined;
}
