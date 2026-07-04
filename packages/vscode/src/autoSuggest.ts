const IDENTIFIER_TRIGGER_RE = /^[A-Za-z0-9_$]$/;
const ALPINE_ATTR_VALUE_RE =
    /(?:\bx-[A-Za-z0-9_:.-]+|@[A-Za-z0-9_:.-]+|:[A-Za-z0-9_:.-]+)\s*=\s*(["'])([\s\S]*?)\1/g;

export interface AutoSuggestContext {
    sourceText: string;
    languageId: string;
    uri: string;
    insertedText: string;
    rangeLength: number;
    cursorOffset: number;
}

export function shouldAutoTriggerSuggest(
    context: AutoSuggestContext,
): boolean {
    if (!isSupportedDocument(context.languageId, context.uri)) {
        return false;
    }
    if (context.rangeLength !== 0) {
        return false;
    }
    if (!IDENTIFIER_TRIGGER_RE.test(context.insertedText)) {
        return false;
    }
    return isInsideAlpineDirectiveValue(
        context.sourceText,
        context.languageId,
        context.uri,
        context.cursorOffset,
    );
}

export function isInsideAlpineDirectiveValue(
    sourceText: string,
    languageId: string,
    uri: string,
    offset: number,
): boolean {
    if (!isSupportedDocument(languageId, uri)) {
        return false;
    }
    ALPINE_ATTR_VALUE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ALPINE_ATTR_VALUE_RE.exec(sourceText))) {
        const full = match[0];
        const value = match[2] ?? "";
        const fullStart = match.index;
        const valueStart = fullStart + full.length - value.length - 1;
        const valueEnd = valueStart + value.length;
        if (valueStart < offset && offset <= valueEnd) {
            return true;
        }
    }
    return false;
}

function isSupportedDocument(languageId: string, uri: string): boolean {
    return languageId === "html" || languageId === "blade" || uri.toLowerCase().endsWith(".blade.php");
}
