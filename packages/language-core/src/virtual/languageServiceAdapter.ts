import type { LanguageServiceAdapter, VirtualCodeFile } from "./types.js";

export function createNoopLanguageServiceAdapter(id: string): LanguageServiceAdapter {
    let attached: VirtualCodeFile | undefined;
    return {
        id,
        isAttached(): boolean {
            return attached !== undefined;
        },
        attach(virtualCode: VirtualCodeFile): void {
            attached = virtualCode;
        },
        detach(): void {
            attached = undefined;
        },
    };
}
