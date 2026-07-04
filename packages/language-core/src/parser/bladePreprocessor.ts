/**
 * Preprocess Blade templates before parsing.
 *
 * Replaces `<?php ... ?>` blocks with whitespace that preserves offsets so the
 * existing offset-based directive parser keeps producing stable range mappings.
 * No regex is used for the actual content scanning — we walk the string
 * character-by-character and look for the literal opening/closing tokens.
 */
export function stripPhpBlocks(input: string): string {
    const out: string[] = [];
    let i = 0;
    const phpOpen = "<?php";
    const echoOpen = "<?=";
    while (i < input.length) {
        if (input.startsWith(phpOpen, i)) {
            const blockEnd = findPhpClose(input, i + phpOpen.length);
            replaceRangeWithSpaces(out, input, i, blockEnd);
            i = blockEnd;
            continue;
        }
        if (input.startsWith(echoOpen, i)) {
            const blockEnd = findPhpClose(input, i + echoOpen.length);
            replaceRangeWithSpaces(out, input, i, blockEnd);
            i = blockEnd;
            continue;
        }
        out.push(input.charAt(i));
        i++;
    }
    return out.join("");
}

function findPhpClose(input: string, from: number): number {
    let i = from;
    while (i + 1 < input.length) {
        if (input.charCodeAt(i) === 63 && input.charCodeAt(i + 1) === 62) {
            return i + 2;
        }
        i++;
    }
    return input.length;
}

function replaceRangeWithSpaces(out: string[], input: string, from: number, until: number): void {
    let j = 0;
    while (from + j < until) {
        const ch = input.charAt(from + j);
        out.push(ch === "\n" ? "\n" : " ");
        j++;
    }
}

export function isBladeUri(uri: string): boolean {
    return uri.toLowerCase().endsWith(".blade.php");
}

export function preprocessForLanguage(text: string, languageId: string | undefined, uri: string): string {
    if (languageId === "blade" || isBladeUri(uri)) {
        return stripPhpBlocks(text);
    }
    return text;
}
