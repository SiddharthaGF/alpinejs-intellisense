/**
 * Capabilities attached to a mapping between source expressions and the
 * corresponding snippet of the generated virtual document.
 *
 * A capability that is `false` means the downstream language service should
 * suppress that feature on the generated side. Stage 4 only translates the
 * flags into the Volar `CodeInformation` shape.
 */
export interface MappingCapabilities {
    diagnostics: boolean;
    completion: boolean;
    hover: boolean;
    definition: boolean;
    references: boolean;
    rename: boolean;
    semanticTokens: boolean;
}

export const SOURCE_ONLY: MappingCapabilities = {
    diagnostics: false,
    completion: false,
    hover: false,
    definition: false,
    references: false,
    rename: false,
    semanticTokens: false,
};

export const FULL_SOURCE: MappingCapabilities = {
    diagnostics: true,
    completion: true,
    hover: true,
    definition: true,
    references: true,
    rename: true,
    semanticTokens: true,
};

export const HANDLER_BODY_CAPS: MappingCapabilities = {
    diagnostics: true,
    completion: true,
    hover: true,
    definition: true,
    references: true,
    rename: true,
    semanticTokens: true,
};

export const DATA_DECLARATION_CAPS: MappingCapabilities = {
    diagnostics: true,
    completion: false,
    hover: true,
    definition: true,
    references: true,
    rename: true,
    semanticTokens: true,
};

export const DATA_ALIAS_CAPS: MappingCapabilities = {
    diagnostics: true,
    completion: false,
    hover: false,
    definition: true,
    references: true,
    rename: true,
    semanticTokens: true,
};

export const RENDER_EXPRESSION_CAPS: MappingCapabilities = {
    diagnostics: true,
    completion: true,
    hover: true,
    definition: true,
    references: true,
    rename: false,
    semanticTokens: true,
};

export function isCapabilityEnabled(
    capabilities: MappingCapabilities,
    feature: keyof MappingCapabilities,
): boolean {
    return capabilities[feature];
}

export function mergeCapabilities(
    base: MappingCapabilities,
    override: Partial<MappingCapabilities>,
): MappingCapabilities {
    return { ...base, ...override };
}
