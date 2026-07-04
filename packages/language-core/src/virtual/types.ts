import type { OffsetRange } from "../types.js";

export type { MappingCapabilities } from "./mappingCapabilities.js";

import type { MappingCapabilities } from "./mappingCapabilities.js";

export interface MappingEntry {
    sourceRange: OffsetRange;
    virtualRange: OffsetRange;
    capabilities: MappingCapabilities;
    label: string;
}

export interface VirtualCodeFile {
    /** Stable identifier for the virtual TS document. */
    readonly id: string;
    readonly languageId: "typescript";
    readonly code: string;
    readonly mappings: MappingEntry[];
    /** Identifier segments introduced by the generator. Never returned to the user. */
    readonly internalIdentifiers: ReadonlySet<string>;
}

export interface VirtualCodeAdapter {
    readonly id: string;
    readonly languageId: string;
    generate(input: string): VirtualCodeFile;
}

export interface SourceLocation {
    offset: number;
    mapping: MappingEntry | undefined;
    nearestOffset: number;
}

export interface GeneratedLocation {
    offset: number;
    mapping: MappingEntry | undefined;
    nearestOffset: number;
}

export interface SourceMapAdapter {
    mapSourceToVirtual(
        sourceOffset: number,
        capabilities?: Partial<MappingCapabilities>,
    ): SourceLocation;
    mapVirtualToSource(
        virtualOffset: number,
        capabilities?: Partial<MappingCapabilities>,
    ): GeneratedLocation;
}

export interface LanguageServiceAdapter {
    /** Stage 4 ships a stub. Stage 5 wires the real TypeScript Language Service. */
    readonly id: string;
    isAttached(): boolean;
    attach(virtualCode: VirtualCodeFile): void;
    detach(): void;
}
