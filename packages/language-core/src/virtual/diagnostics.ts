import * as ts from "typescript";
import type { OffsetRange } from "../types.js";
import type { MappingEntry } from "./types.js";
import { createSourceMapAdapter } from "./sourceMapAdapter.js";

export interface AdaptedDiagnostic {
    /** Original TS diagnostic from the language service. */
    readonly original: ts.Diagnostic;
    /** Source range in the HTML document when the diagnostic maps safely. */
    readonly sourceRange: OffsetRange | undefined;
    /** True when the diagnostic should be propagated to the user. */
    readonly reportable: boolean;
    /** Translated severity: 1=Error, 2=Warning, 3=Info, 4=Hint. */
    readonly severity: number;
    /** Formatted message. */
    readonly message: string;
    /** Internal flag: the diagnostic references an internal identifier. */
    readonly wrapsInternal: boolean;
}

export function adaptDiagnostics(
    diagnostics: readonly ts.Diagnostic[],
    mappings: ReadonlyArray<MappingEntry>,
): AdaptedDiagnostic[] {
    const sm = createSourceMapAdapter(mappings);
    const result: AdaptedDiagnostic[] = [];
    for (const diagnostic of diagnostics) {
        if (diagnostic.start === undefined || diagnostic.length === undefined) {
            continue;
        }
        const start = diagnostic.start;
        const end = diagnostic.start + diagnostic.length;
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        const wrapsInternal = messageContainsInternal(message);
        const startLoc = sm.mapVirtualToSource(start);
        const endLoc = sm.mapVirtualToSource(end);
        const mapping = startLoc.mapping;
        let reportable = !wrapsInternal && Boolean(mapping);
        if (startLoc.mapping && endLoc.mapping && startLoc.mapping !== endLoc.mapping) {
            reportable = false;
        }
        const sourceRange = reportable && mapping ? mapping.sourceRange : undefined;
        result.push({
            original: diagnostic,
            sourceRange,
            reportable,
            severity: mapSeverity(diagnostic.category),
            message,
            wrapsInternal,
        });
    }
    return result;
}

function messageContainsInternal(message: string): boolean {
    if (!message) {
        return false;
    }
    return message.includes("__alpine_internal_")
        || message.includes("__alpine_data")
        || message.includes("Cannot find name '__alpine_");
}

function mapSeverity(category: ts.DiagnosticCategory): number {
    switch (category) {
        case ts.DiagnosticCategory.Error:
            return 1;
        case ts.DiagnosticCategory.Warning:
            return 2;
        case ts.DiagnosticCategory.Suggestion:
            return 4;
        case ts.DiagnosticCategory.Message:
            return 3;
        default:
            return 1;
    }
}
