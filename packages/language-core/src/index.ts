export const ALPINE_SPEC_VERSION = "0.0.0" as const;

export {
    stripPhpBlocks,
    isBladeUri,
    preprocessForLanguage,
} from "./parser/bladePreprocessor.js";

export {
    type ExternDeclaration,
} from "./virtual/alpineVirtualCode.js";

export {
    PluginRegistry,
    type CustomDirective,
} from "./plugins/PluginRegistry.js";

export {
    indexIdentifiers,
    type IdentifierDeclaration,
} from "./workspace/identifierIndex.js";

export {
    extractAlpineDirectives,
    parseElements,
    splitAttributeName,
} from "./directiveExtractor.js";
export type {
    AlpineDirectiveNode,
    DirectiveValueKind,
    OffsetRange,
    ParsedAttribute,
    ParsedElement,
} from "./types.js";

export {
    createAlpineVirtualCodeAdapter,
    generateAlpineVirtualCode,
    isStage4SupportedDirective,
    isHandlerReference,
    type ResolvedXDataSource,
    type VirtualBuildOptions,
} from "./virtual/alpineVirtualCode.js";
export {
    parseDataLiteral,
    type DataMemberDescriptor,
    type DataMemberParameterDescriptor,
} from "./virtual/xDataAst.js";
export {
    adaptDiagnostics,
    type AdaptedDiagnostic,
} from "./virtual/diagnostics.js";
export {
    createTypeScriptLanguageServiceAdapter,
    type LanguageServiceAdapterHandle,
    type SemanticService,
} from "./virtual/tsLanguageServiceAdapter.js";
export {
    createSourceMapAdapter,
} from "./virtual/sourceMapAdapter.js";
export {
    createNoopLanguageServiceAdapter,
} from "./virtual/languageServiceAdapter.js";
export type {
    GeneratedLocation,
    LanguageServiceAdapter,
    MappingCapabilities,
    MappingEntry,
    SourceLocation,
    SourceMapAdapter,
    VirtualCodeAdapter,
    VirtualCodeFile,
} from "./virtual/types.js";
export {
    DATA_DECLARATION_CAPS,
    FULL_SOURCE,
    HANDLER_BODY_CAPS,
    RENDER_EXPRESSION_CAPS,
    SOURCE_ONLY,
    isCapabilityEnabled,
    mergeCapabilities,
} from "./virtual/mappingCapabilities.js";

export const LANGUAGE_CORE_VERSION = ALPINE_SPEC_VERSION;
