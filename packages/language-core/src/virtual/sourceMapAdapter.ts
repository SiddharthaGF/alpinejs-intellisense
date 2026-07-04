import type { MappingCapabilities } from "./mappingCapabilities.js";
import type { MappingEntry, SourceMapAdapter } from "./types.js";

interface MappingFilter {
    requested?: Partial<MappingCapabilities>;
    matches(feature: keyof MappingCapabilities): boolean;
}

const FULL_FILTER: MappingFilter = {
    matches: () => true,
};

function filterFor(
    requested: Partial<MappingCapabilities> | undefined,
): MappingFilter {
    if (!requested) {
        return FULL_FILTER;
    }
    const required = Object.entries(requested) as Array<
        [keyof MappingCapabilities, boolean]
    >;
    return {
        requested,
        matches(feature: keyof MappingCapabilities): boolean {
            const r = required.find(([f]) => f === feature)?.[1];
            return r === undefined || r;
        },
    };
}

export function createSourceMapAdapter(
    mappings: ReadonlyArray<MappingEntry>,
): SourceMapAdapter {
    const sortedBySource = [...mappings].sort(
        (a, b) => a.sourceRange.start - b.sourceRange.start,
    );
    const sortedByVirtual = [...mappings].sort(
        (a, b) => a.virtualRange.start - b.virtualRange.start,
    );

    const mapSourceToVirtual: SourceMapAdapter["mapSourceToVirtual"] = (offset, caps) => {
        const filter = filterFor(caps);
        const best = findBestContainingMapping(
            sortedBySource,
            offset,
            filter,
            (mapping) => mapping.sourceRange,
        );
        return {
            offset: best ? best.virtualRange.start : offset,
            mapping: best,
            nearestOffset: best ? best.sourceRange.start : offset,
        };
    };

    const mapVirtualToSource: SourceMapAdapter["mapVirtualToSource"] = (offset, caps) => {
        const filter = filterFor(caps);
        const best = findBestContainingMapping(
            sortedByVirtual,
            offset,
            filter,
            (mapping) => mapping.virtualRange,
        );
        return {
            offset: best ? best.sourceRange.start : offset,
            mapping: best,
            nearestOffset: best ? best.virtualRange.start : offset,
        };
    };

    return { mapSourceToVirtual, mapVirtualToSource };
}

function capabilityMatches(caps: MappingCapabilities, filter: MappingFilter): boolean {
    if (!filter.requested) {
        return true;
    }
    for (const key of Object.keys(filter.requested) as Array<keyof MappingCapabilities>) {
        const required = filter.requested[key];
        if (required === undefined) {
            continue;
        }
        if (caps[key] !== required) {
            return false;
        }
    }
    for (const key of Object.keys(caps) as Array<keyof MappingCapabilities>) {
        if (caps[key] === true && !filter.matches(key)) {
            return false;
        }
    }
    return true;
}

function findBestContainingMapping(
    mappings: ReadonlyArray<MappingEntry>,
    offset: number,
    filter: MappingFilter,
    rangeOf: (mapping: MappingEntry) => { start: number; end: number },
): MappingEntry | undefined {
    let best: MappingEntry | undefined;
    for (const mapping of mappings) {
        const range = rangeOf(mapping);
        if (range.start > offset) {
            break;
        }
        if (range.start <= offset && offset < range.end) {
            if (!capabilityMatches(mapping.capabilities, filter)) {
                continue;
            }
            if (!best || isMoreSpecificMapping(mapping, best, rangeOf)) {
                best = mapping;
            }
        }
    }
    return best;
}

function isMoreSpecificMapping(
    candidate: MappingEntry,
    current: MappingEntry,
    rangeOf: (mapping: MappingEntry) => { start: number; end: number },
): boolean {
    const candidateRange = rangeOf(candidate);
    const currentRange = rangeOf(current);
    const candidateLength = candidateRange.end - candidateRange.start;
    const currentLength = currentRange.end - currentRange.start;
    if (candidateLength !== currentLength) {
        return candidateLength < currentLength;
    }
    return candidateRange.start >= currentRange.start;
}
