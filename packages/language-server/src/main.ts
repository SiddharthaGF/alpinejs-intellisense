import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import {
    createConnection,
    Definition,
    InitializeParams,
    InitializeResult,
    Location,
    Range,
    TextDocuments,
    TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    Hover,
    MarkupContent,
    MarkupKind,
    ParameterInformation,
    Position,
    SignatureHelp,
    SignatureInformation,
} from "vscode-languageserver-types";
import {
    adaptDiagnostics,
    createSourceMapAdapter,
    createTypeScriptLanguageServiceAdapter,
    extractAlpineDirectives,
    generateAlpineVirtualCode,
    isBladeUri,
    parseDataLiteral,
    parseElements,
    isStage4SupportedDirective,
    PluginRegistry,
    preprocessForLanguage,
    stripPhpBlocks,
    type AdaptedDiagnostic,
    type AlpineDirectiveNode,
    type CustomDirective,
    type DataMemberDescriptor,
    type ExternDeclaration,
    type IdentifierDeclaration,
    type LanguageServiceAdapterHandle,
    type OffsetRange,
    type ResolvedXDataSource,
    type VirtualCodeFile,
} from "@alpine-language-tools/language-core";
import {
    DIRECTIVES,
    getCompletionNames,
    getMagicReferenceUrl,
    getMarkdownDocumentation,
    getModifiers,
} from "@alpine-language-tools/alpine-spec";

const SERVER_NAME = "alpine-language-server";
const SERVER_VERSION = "0.0.0";

const connection = createConnection();
const documents = new TextDocuments<TextDocument>(TextDocument);

interface DocumentState {
    directives: AlpineDirectiveNode[];
    resolvedXDataByAttribute: ReadonlyMap<string, ResolvedXDataSource>;
    virtual: VirtualCodeFile;
    tsAdapter: LanguageServiceAdapterHandle;
}

interface HoverLike {
    displayParts?: Array<{ text: string }>;
    documentation?: Array<{ text: string }>;
    tags?: Array<{ name: string; text?: string | Array<{ text: string }> }>;
}

const state = new Map<string, DocumentState>();
const pluginRegistry = new PluginRegistry();
const workspaceIdentifiers: Map<string, IdentifierDeclaration[]> = new Map();
const BUNDLED_TS_LIB_ROOT = resolveBundledTypeScriptLibRoot();
let initialized = false;
const COMPLETION_TRIGGER_CHARACTERS = [
    ...("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_".split("")),
    ".",
    ":",
    "@",
] as const;

function buildState(text: string, fileId: string, languageId?: string): DocumentState {
    const prepared = preprocessForLanguage(text, languageId, fileId);
    const directives = analyzeFromText(prepared, fileId);
    const resolvedXDataByAttribute = collectResolvedXDataSources(prepared, directives);
    const localMemberNames = collectCurrentDataMemberNames(directives, resolvedXDataByAttribute);
    const externs = collectExterns(fileId, localMemberNames);
    const virtual = generateAlpineVirtualCode(prepared, fileId, externs, {
        resolvedXDataByAttribute,
    });
    const tsAdapter = createTypeScriptLanguageServiceAdapter(fileId, {
        libRoot: BUNDLED_TS_LIB_ROOT,
    });
    tsAdapter.attach(virtual);
    return { directives, resolvedXDataByAttribute, virtual, tsAdapter };
}

function attributeRangeKey(range: OffsetRange): string {
    return `${range.start}:${range.end}`;
}

interface NamedComponentSource {
    name: string;
    source: ResolvedXDataSource;
}

function collectResolvedXDataSources(
    text: string,
    directives: ReadonlyArray<AlpineDirectiveNode>,
): ReadonlyMap<string, ResolvedXDataSource> {
    const namedSources = indexNamedComponentSources(text);
    const resolved = new Map<string, ResolvedXDataSource>();
    for (const directive of directives) {
        if (directive.canonicalName !== "x-data") {
            continue;
        }
        const source = resolveDirectiveXDataSource(directive, namedSources);
        if (source) {
            resolved.set(attributeRangeKey(directive.attributeRange), source);
        }
    }
    return resolved;
}

function collectCurrentDataMemberNames(
    directives: ReadonlyArray<AlpineDirectiveNode>,
    resolvedXDataByAttribute: ReadonlyMap<string, ResolvedXDataSource> = new Map(),
): ReadonlySet<string> {
    const names = new Set<string>();
    for (const directive of directives) {
        if (directive.canonicalName !== "x-data") {
            continue;
        }
        for (const member of getDirectiveMembers(directive, resolvedXDataByAttribute)) {
            names.add(member.name);
        }
    }
    return names;
}

function getDirectiveMembers(
    directive: AlpineDirectiveNode,
    resolvedXDataByAttribute: ReadonlyMap<string, ResolvedXDataSource> = new Map(),
): ReadonlyArray<DataMemberDescriptor> {
    const parsed = parseDataLiteral(directive.value ?? "{}");
    if (!parsed.parseError) {
        return parsed.members;
    }
    return resolvedXDataByAttribute.get(attributeRangeKey(directive.attributeRange))?.members ?? [];
}

function resolveDirectiveXDataSource(
    directive: AlpineDirectiveNode,
    namedSources: ReadonlyMap<string, ResolvedXDataSource>,
): ResolvedXDataSource | undefined {
    const ref = parseXDataReference(directive.value ?? "");
    if (!ref) {
        return undefined;
    }
    return namedSources.get(ref.name);
}

function parseXDataReference(value: string): { name: string; kind: "identifier" | "call" } | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    const source = ts.createSourceFile(
        "alpine-xdata-ref.ts",
        `(${trimmed})`,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.JS,
    );
    const statement = source.statements[0];
    if (!statement || !ts.isExpressionStatement(statement)) {
        return undefined;
    }
    let expr = statement.expression;
    while (ts.isParenthesizedExpression(expr)) {
        expr = expr.expression;
    }
    if (ts.isIdentifier(expr)) {
        return { name: expr.text, kind: "identifier" };
    }
    if (ts.isCallExpression(expr) && expr.arguments.length === 0 && ts.isIdentifier(expr.expression)) {
        return { name: expr.expression.text, kind: "call" };
    }
    return undefined;
}

function indexNamedComponentSources(text: string): ReadonlyMap<string, ResolvedXDataSource> {
    const indexed = new Map<string, ResolvedXDataSource>();
    for (const script of collectScriptBlocks(text)) {
        const source = ts.createSourceFile(
            "alpine-inline-script.js",
            script.text,
            ts.ScriptTarget.ES2022,
            true,
            ts.ScriptKind.JS,
        );
        const register = (entry: NamedComponentSource | undefined): void => {
            if (!entry || indexed.has(entry.name)) {
                return;
            }
            indexed.set(entry.name, entry.source);
        };
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) {
                register(extractAlpineDataSource(node, script.start, source));
            }
            if (ts.isFunctionDeclaration(node)) {
                register(extractFunctionComponentSource(node, script.start));
            }
            if (ts.isVariableDeclaration(node)) {
                register(extractVariableComponentSource(node, script.start));
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return indexed;
}

function collectScriptBlocks(text: string): Array<{ text: string; start: number }> {
    const blocks: Array<{ text: string; start: number }> = [];
    const lower = text.toLowerCase();
    const visit = (elements: ReturnType<typeof parseElements>): void => {
        for (const element of elements) {
            if (element.tag === "script") {
                const startTagEnd = text.indexOf(">", element.start);
                if (startTagEnd < 0) {
                    continue;
                }
                const contentStart = startTagEnd + 1;
                const closingStart = lower.lastIndexOf("</script", element.end);
                const contentEnd = closingStart >= contentStart ? closingStart : element.end;
                blocks.push({
                    text: text.slice(contentStart, contentEnd),
                    start: contentStart,
                });
            }
            if (element.children.length > 0) {
                visit(element.children);
            }
        }
    };
    visit(parseElements(text));
    return blocks;
}

function extractAlpineDataSource(
    node: ts.CallExpression,
    baseOffset: number,
    sourceFile: ts.SourceFile,
): NamedComponentSource | undefined {
    if (!ts.isPropertyAccessExpression(node.expression)) {
        return undefined;
    }
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "Alpine") {
        return undefined;
    }
    if (node.expression.name.text !== "data") {
        return undefined;
    }
    const [nameArg, factoryArg] = node.arguments;
    if (!nameArg || !factoryArg || !ts.isStringLiteralLike(nameArg)) {
        return undefined;
    }
    const objectLiteral = resolveFactoryObjectLiteral(factoryArg);
    const source = objectLiteral ? createResolvedXDataSource(objectLiteral, baseOffset) : undefined;
    return source ? { name: nameArg.text, source } : undefined;
}

function extractFunctionComponentSource(
    node: ts.FunctionDeclaration,
    baseOffset: number,
): NamedComponentSource | undefined {
    if (!node.name || node.parameters.length > 0) {
        return undefined;
    }
    const objectLiteral = resolveFactoryObjectLiteral(node);
    const source = objectLiteral ? createResolvedXDataSource(objectLiteral, baseOffset) : undefined;
    return source ? { name: node.name.text, source } : undefined;
}

function extractVariableComponentSource(
    node: ts.VariableDeclaration,
    baseOffset: number,
): NamedComponentSource | undefined {
    if (!ts.isIdentifier(node.name) || !node.initializer) {
        return undefined;
    }
    const objectLiteral = resolveFactoryObjectLiteral(node.initializer);
    const source = objectLiteral ? createResolvedXDataSource(objectLiteral, baseOffset) : undefined;
    return source ? { name: node.name.text, source } : undefined;
}

function resolveFactoryObjectLiteral(
    node: ts.Node,
): ts.ObjectLiteralExpression | undefined {
    if (ts.isParenthesizedExpression(node)) {
        return resolveFactoryObjectLiteral(node.expression);
    }
    if (ts.isArrowFunction(node)) {
        if (ts.isBlock(node.body)) {
            return findReturnedObjectLiteral(node.body);
        }
        return resolveFactoryObjectLiteral(node.body);
    }
    if (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
        return node.body ? findReturnedObjectLiteral(node.body) : undefined;
    }
    if (ts.isObjectLiteralExpression(node)) {
        return node;
    }
    return undefined;
}

function findReturnedObjectLiteral(block: ts.Block): ts.ObjectLiteralExpression | undefined {
    for (const statement of block.statements) {
        if (!ts.isReturnStatement(statement) || !statement.expression) {
            continue;
        }
        const objectLiteral = resolveFactoryObjectLiteral(statement.expression);
        if (objectLiteral) {
            return objectLiteral;
        }
    }
    return undefined;
}

function createResolvedXDataSource(
    objectLiteral: ts.ObjectLiteralExpression,
    baseOffset: number,
): ResolvedXDataSource | undefined {
    const expressionText = objectLiteral.getText();
    const parsed = parseDataLiteral(expressionText);
    if (parsed.parseError || parsed.members.length === 0) {
        return undefined;
    }
    return {
        expressionText,
        expressionRange: {
            start: baseOffset + objectLiteral.getStart(),
            end: baseOffset + objectLiteral.getEnd(),
        },
        members: parsed.members,
    };
}

function resolveBundledTypeScriptLibRoot(): string | undefined {
    const candidate = resolve(__dirname, "..", "..", "data", "typescript-lib");
    return existsSync(resolve(candidate, "lib.es2022.d.ts")) ? candidate : undefined;
}

function collectExterns(currentUri: string, shadowedNames: ReadonlySet<string> = new Set()): ExternDeclaration[] {
    const externs: ExternDeclaration[] = [];
    const seen = new Set<string>();
    for (const [fileUri, decls] of workspaceIdentifiers.entries()) {
        if (fileUri === currentUri) {
            continue;
        }
        for (const decl of decls) {
            if (seen.has(decl.name) || shadowedNames.has(decl.name)) {
                continue;
            }
            seen.add(decl.name);
            externs.push({
                name: decl.name,
                kind: decl.kind,
                type: kindToType(decl.kind),
            });
        }
    }
    return externs;
}

function kindToType(kind: IdentifierDeclaration["kind"]): ExternDeclaration["type"] {
    switch (kind) {
        case "method":
        case "init":
            return "unknown";
        default:
            return "unknown";
    }
}

function analyzeFromText(text: string, fileId: string): AlpineDirectiveNode[] {
    const base = extractAlpineDirectives(text).filter((d) =>
        isStage4SupportedDirective(d.canonicalName),
    );
    if (pluginRegistry.listSpecs().length === 0) {
        return base;
    }
    const customDirectives = pluginRegistry
        .augment(text)
        .filter((d) => !isStage4SupportedDirective(d.canonicalName));
    const seen = new Set<string>();
    for (const dir of base) {
        seen.add(`${dir.attributeRange.start}:${dir.attributeRange.end}`);
    }
    return [...base, ...customDirectives.filter((d) => {
        const k = `${d.attributeRange.start}:${d.attributeRange.end}`;
        if (seen.has(k)) {
            return false;
        }
        seen.add(k);
        return true;
    })];
    void fileId;
}

void isBladeUri;

function refreshDiagnostics(uri: string): void {
    const cached = state.get(uri);
    if (!cached) {
        connection.sendDiagnostics({ uri, diagnostics: [] });
        return;
    }
    const doc = documents.get(uri);
    if (!doc) {
        connection.sendDiagnostics({ uri, diagnostics: [] });
        return;
    }
    const syntactic = cached.tsAdapter.service.getSyntacticDiagnostics();
    const semantic = cached.tsAdapter.service.getSemanticDiagnostics();
    const adapted = adaptDiagnostics([...syntactic, ...semantic], cached.virtual.mappings);
    connection.sendDiagnostics({
        uri,
        diagnostics: adapted
            .filter((d) => d.reportable && d.sourceRange)
            .map((diagnostic) => toLspDiagnostic(diagnostic, doc)),
    });
}

function toLspDiagnostic(adapted: AdaptedDiagnostic, doc: TextDocument): Diagnostic {
    return {
        range: {
            start: doc.positionAt(adapted.sourceRange!.start),
            end: doc.positionAt(adapted.sourceRange!.end),
        },
        message: adapted.message,
        severity: toLspSeverity(adapted.severity),
        source: "Alpine",
        code: typeof adapted.original.code === "number" ? adapted.original.code : undefined,
    };
}

function toLspSeverity(level: number): DiagnosticSeverity {
    switch (level) {
        case 1:
            return DiagnosticSeverity.Error;
        case 2:
            return DiagnosticSeverity.Warning;
        case 3:
            return DiagnosticSeverity.Information;
        case 4:
            return DiagnosticSeverity.Hint;
        default:
            return DiagnosticSeverity.Error;
    }
}

interface AlpineInitializationOptions {
    serverVersion?: string;
    workspaceTrusted?: boolean;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const options = (params.initializationOptions ?? {}) as AlpineInitializationOptions;
    connection.console.info(
        `[${SERVER_NAME}] initialize workspace=${params.workspaceFolders ? "yes" : "no"} trusted=${options.workspaceTrusted !== false}`,
    );
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            hoverProvider: true,
            definitionProvider: true,
            completionProvider: {
                triggerCharacters: [...COMPLETION_TRIGGER_CHARACTERS],
                resolveProvider: false,
            },
            signatureHelpProvider: {
                triggerCharacters: ["(", ",", "="],
                retriggerCharacters: [","],
            },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
});

connection.onInitialized(() => {
    initialized = true;
    connection.console.info(`[${SERVER_NAME}] initialized`);
});

connection.onShutdown(() => {
    initialized = false;
    connection.console.info(`[${SERVER_NAME}] shutdown requested`);
});

connection.onExit(() => {
    connection.console.info(`[${SERVER_NAME}] exit`);
});

documents.onDidOpen(({ document }): void => {
    state.set(document.uri, buildState(document.getText(), document.uri, document.languageId));
    refreshDiagnostics(document.uri);
});

documents.onDidChangeContent(({ document }): void => {
    state.set(document.uri, buildState(document.getText(), document.uri, document.languageId));
    refreshDiagnostics(document.uri);
});

documents.onDidClose(({ document }): void => {
    const cached = state.get(document.uri);
    if (cached) {
        cached.tsAdapter.detach();
    }
    state.delete(document.uri);
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

function dispatchHover(uri: string, position: Position, doc: TextDocument): Hover | null {
    const offset = doc.offsetAt(position);
    const cached = state.get(uri);
    if (cached) {
        const sm = createSourceMapAdapter(cached.virtual.mappings);
        const localMemberLabels = collectLocalMemberLabels(
            cached.directives,
            offset,
            cached.resolvedXDataByAttribute,
        );
        const localMemberDetails = collectLocalMemberDetails(
            cached.directives,
            offset,
            cached.resolvedXDataByAttribute,
        );
        const projected = sm.mapSourceToVirtual(offset, { hover: true });
        if (projected.mapping) {
            const virtualOffset = projected.mapping.virtualRange.start
                + (offset - projected.mapping.sourceRange.start);
            if (virtualOffset >= 0 && virtualOffset < cached.virtual.code.length) {
                const hoverMemberLabel = resolveHoverMemberLabel(
                    cached.tsAdapter.service,
                    sm,
                    virtualOffset,
                    projected.mapping.label,
                );
                const value = resolveHoverValue(
                    cached.tsAdapter.service,
                    cached.virtual.code,
                    projected.mapping.virtualRange,
                    virtualOffset,
                    hoverMemberLabel,
                    localMemberLabels,
                    localMemberDetails,
                );
                if (value) {
                    const contents: MarkupContent = {
                        kind: MarkupKind.Markdown,
                        value,
                    };
                    return { contents };
                }
            }
        }
    }
    const directive = findDirectiveAt(uri, position, doc);
    if (!directive) {
        return null;
    }
    const docs = getMarkdownDocumentation(directive.canonicalName);
    if (!docs) {
        return null;
    }
    const valueKind = `**Value kind:** \`${directive.valueKind}\``;
    const summary = initialized
        ? "Alpine Language Server recognises this directive."
        : "Alpine Language Server is still initializing.";
    const value: string = [
        summary,
        "",
        docs,
        "",
        valueKind,
    ].join("\n");
    const contents: MarkupContent = { kind: MarkupKind.Markdown, value };
    return { contents };
}

function resolveHoverValue(
    service: LanguageServiceAdapterHandle["service"],
    code: string,
    range: { start: number; end: number },
    preferredOffset: number,
    mappingLabel?: string,
    localMemberLabels: ReadonlyMap<string, string> = new Map(),
    localMemberDetails: ReadonlyMap<string, DataMemberDescriptor> = new Map(),
): string {
    if (range.end <= range.start) {
        return "";
    }
    const local = resolveHoverFromToken(
        service,
        code,
        range,
        preferredOffset,
        mappingLabel,
        localMemberLabels,
        localMemberDetails,
    );
    if (local) {
        return local;
    }
    const upperBound = range.end - 1;
    const start = Math.max(range.start, Math.min(preferredOffset, upperBound));
    const tried = new Set<number>();
    let fallback = "";
    for (const offset of expandOffsets(start, range.start, upperBound)) {
        if (tried.has(offset)) {
            continue;
        }
        tried.add(offset);
        const value = formatHoverValue(
            service.getHoverAtPosition(offset),
            mappingLabel,
            localMemberLabels,
            localMemberDetails,
        );
        if (!value) {
            continue;
        }
        if (isLowSignalHoverValue(value)) {
            if (!fallback) {
                fallback = value;
            }
            continue;
        }
        if (value) {
            return value;
        }
    }
    return fallback;
}

function resolveHoverFromToken(
    service: LanguageServiceAdapterHandle["service"],
    code: string,
    range: { start: number; end: number },
    preferredOffset: number,
    mappingLabel?: string,
    localMemberLabels: ReadonlyMap<string, string> = new Map(),
    localMemberDetails: ReadonlyMap<string, DataMemberDescriptor> = new Map(),
): string {
    const anchor = findHoverTokenAnchor(code, preferredOffset, range);
    if (anchor === undefined) {
        return "";
    }
    const tokenRange = expandHoverTokenRange(code, anchor, range);
    const start = Math.max(tokenRange.start, Math.min(preferredOffset, tokenRange.end - 1));
    const tried = new Set<number>();
    let fallback = "";
    for (const offset of expandOffsets(start, tokenRange.start, tokenRange.end - 1)) {
        if (tried.has(offset)) {
            continue;
        }
        tried.add(offset);
        const value = formatHoverValue(
            service.getHoverAtPosition(offset),
            mappingLabel,
            localMemberLabels,
            localMemberDetails,
        );
        if (!value) {
            continue;
        }
        if (isLowSignalHoverValue(value)) {
            if (!fallback) {
                fallback = value;
            }
            continue;
        }
        return value;
    }
    return fallback;
}

function* expandOffsets(
    center: number,
    start: number,
    end: number,
): Generator<number, void, undefined> {
    yield center;
    for (let delta = 1; center - delta >= start || center + delta <= end; delta++) {
        if (center - delta >= start) {
            yield center - delta;
        }
        if (center + delta <= end) {
            yield center + delta;
        }
    }
}

function formatHoverValue(
    quickInfo: HoverLike | undefined,
    mappingLabel?: string,
    localMemberLabels: ReadonlyMap<string, string> = new Map(),
    localMemberDetails: ReadonlyMap<string, DataMemberDescriptor> = new Map(),
): string {
    if (!quickInfo) {
        return "";
    }
    const display = (quickInfo.displayParts ?? [])
        .map((part) => part.text)
        .join("")
        .trim();
    const normalizedDisplay = normalizeHoverDisplay(
        display,
        mappingLabel,
        localMemberLabels,
        localMemberDetails,
    );
    const docs = (quickInfo.documentation ?? [])
        .map((part) => part.text)
        .join("\n")
        .trim();
    const tags = (quickInfo.tags ?? [])
        .map((tag) => {
            const body = Array.isArray(tag.text)
                ? tag.text.map((part) => part.text).join("")
                : (tag.text ?? "");
            return body ? `*@${tag.name}* ${body}` : `*@${tag.name}*`;
        })
        .join("\n\n")
        .trim();
    const reference = formatHoverReferenceMarkdown(normalizedDisplay);
    const markdown = [
        normalizedDisplay
            ? `\`\`\`typescript\n${normalizedDisplay.replace(/```/g, "\\`\\`\\`")}\n\`\`\``
            : "",
        docs,
        tags,
        reference,
    ]
        .filter(Boolean)
        .join("\n\n");
    const value = markdown.replace(/\n{3,}/g, "\n\n");
    return containsInternalHoverText(value) ? "" : value;
}

function formatHoverReferenceMarkdown(display: string): string {
    const symbol = extractHoverSymbolName(display);
    const url = symbol ? getMagicReferenceUrl(symbol) : undefined;
    return url ? `[Alpine Reference](${url})` : "";
}

function extractHoverSymbolName(display: string): string | undefined {
    const propertyMatch = display.match(/^(?:let|const|var|\(property\)|\(getter\)|\(setter\))\s+([A-Za-z_$][\w$]*)\b/);
    if (propertyMatch?.[1]) {
        return propertyMatch[1];
    }
    const functionMatch = display.match(/^(?:function|\(method\))\s+([A-Za-z_$][\w$]*)\b/);
    if (functionMatch?.[1]) {
        return functionMatch[1];
    }
    return undefined;
}

function normalizeHoverDisplay(
    display: string,
    mappingLabel?: string,
    localMemberLabels: ReadonlyMap<string, string> = new Map(),
    localMemberDetails: ReadonlyMap<string, DataMemberDescriptor> = new Map(),
): string {
    const propertyMatch = display.match(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
    const methodMatch = display.match(/^function\s+([A-Za-z_$][\w$]*)(\([\s\S]*)$/);
    const nativeMethodMatch = display.match(/^\(method\)\s+([A-Za-z_$][\w$]*)\(([\s\S]*)\):\s*([\s\S]+)$/);
    const nativeGetterMatch = display.match(/^\(getter\)\s+([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
    const effectiveLabel = mappingLabel
        ?? localMemberLabels.get(
            propertyMatch?.[1] ?? methodMatch?.[1] ?? nativeMethodMatch?.[1] ?? nativeGetterMatch?.[1] ?? "",
        );
    if (!effectiveLabel) {
        return display;
    }
    if (effectiveLabel.startsWith("x-data getter ")) {
        const memberName = propertyMatch?.[1] ?? nativeGetterMatch?.[1] ?? extractLabeledMemberName(effectiveLabel, "x-data getter ");
        const descriptor = memberName ? localMemberDetails.get(memberName) : undefined;
        const explicitGetter = descriptor ? formatExplicitHoverGetter(descriptor) : undefined;
        if (explicitGetter) {
            return explicitGetter;
        }
        if (propertyMatch) {
            return `(getter) ${propertyMatch[1]}: ${propertyMatch[2]}`;
        }
        return display.replace(/^\(property\)/, "(getter)");
    }
    if (effectiveLabel.startsWith("x-data setter ")) {
        if (propertyMatch) {
            return `(setter) ${propertyMatch[1]}: ${propertyMatch[2]}`;
        }
        return display.replace(/^\(property\)/, "(setter)");
    }
    if (effectiveLabel.startsWith("x-data property ") || effectiveLabel.startsWith("x-data shorthand ")) {
        if (propertyMatch) {
            return `(property) ${propertyMatch[1]}: ${propertyMatch[2]}`;
        }
    }
    if (effectiveLabel.startsWith("x-data method ") || effectiveLabel.startsWith("x-data init ")) {
        const memberName = methodMatch?.[1] ?? nativeMethodMatch?.[1];
        const descriptor = memberName ? localMemberDetails.get(memberName) : undefined;
        const explicitMethod = descriptor ? formatExplicitHoverMethod(descriptor) : undefined;
        if (explicitMethod) {
            return explicitMethod;
        }
        if (methodMatch) {
            return `(method) ${methodMatch[1]}${methodMatch[2]}`;
        }
    }
    return display;
}

function resolveHoverMemberLabel(
    service: LanguageServiceAdapterHandle["service"],
    sm: ReturnType<typeof createSourceMapAdapter>,
    virtualOffset: number,
    mappingLabel?: string,
): string | undefined {
    const direct = asXDataMemberLabel(mappingLabel);
    if (direct) {
        return direct;
    }
    const definitions = service.getDefinitionAtPosition(virtualOffset) ?? [];
    for (const definition of definitions) {
        if (definition.fileName !== service.fileName) {
            continue;
        }
        const projected = sm.mapVirtualToSource(definition.textSpan.start, { definition: true });
        const label = asXDataMemberLabel(projected.mapping?.label);
        if (label) {
            return label;
        }
    }
    return undefined;
}

function asXDataMemberLabel(label: string | undefined): string | undefined {
    if (!label) {
        return undefined;
    }
    return /^x-data (property|shorthand|method|init|getter|setter) [A-Za-z_$][\w$]*$/.test(label)
        ? label
        : undefined;
}

function collectLocalMemberLabels(
    directives: ReadonlyArray<AlpineDirectiveNode>,
    offset: number,
    resolvedXDataByAttribute: ReadonlyMap<string, ResolvedXDataSource> = new Map(),
): ReadonlyMap<string, string> {
    const labels = new Map<string, string>();
    for (const [, member] of collectLocalMemberDetails(directives, offset, resolvedXDataByAttribute)) {
        if (!labels.has(member.name)) {
            labels.set(member.name, `x-data ${member.kind} ${member.name}`);
        }
    }
    return labels;
}

function collectLocalMemberDetails(
    directives: ReadonlyArray<AlpineDirectiveNode>,
    offset: number,
    resolvedXDataByAttribute: ReadonlyMap<string, ResolvedXDataSource> = new Map(),
): ReadonlyMap<string, DataMemberDescriptor> {
    const labels = new Map<string, string>();
    const members = new Map<string, DataMemberDescriptor>();
    for (const directive of findEnclosingDataDirectives(directives, offset)) {
        for (const member of getDirectiveMembers(directive, resolvedXDataByAttribute)) {
            if (!labels.has(member.name) && !members.has(member.name)) {
                members.set(member.name, member);
            }
        }
    }
    return members;
}

function formatExplicitHoverMethod(member: DataMemberDescriptor): string | undefined {
    if (member.kind !== "method" && member.kind !== "init") {
        return undefined;
    }
    const parameters = member.parameters ?? [];
    const hasExplicitJsDoc = parameters.some((parameter) => Boolean(parameter.jsDocTypeText))
        || Boolean(member.jsDocReturnTypeText);
    if (!hasExplicitJsDoc) {
        return undefined;
    }
    const signature = parameters.map((parameter) => {
        const typeText = parameter.jsDocTypeText ?? "any";
        if (parameter.isRest) {
            return `...${parameter.name}: ${typeText}`;
        }
        if (parameter.hasDefault) {
            return `${parameter.name}?: ${typeText}`;
        }
        return `${parameter.name}: ${typeText}`;
    }).join(", ");
    const returnType = member.jsDocReturnTypeText ?? "unknown";
    return `(method) ${member.name}(${signature}): ${returnType}`;
}

function formatExplicitHoverGetter(member: DataMemberDescriptor): string | undefined {
    if (member.kind !== "getter" || !member.jsDocReturnTypeText) {
        return undefined;
    }
    return `(getter) ${member.name}: ${member.jsDocReturnTypeText}`;
}

function extractLabeledMemberName(label: string, prefix: string): string | undefined {
    return label.startsWith(prefix) ? label.slice(prefix.length).trim() : undefined;
}

function containsInternalHoverText(text: string): boolean {
    if (!text) {
        return false;
    }
    return text.includes("__alpine_internal_") || text.includes("__alpine_data");
}

function isLowSignalHoverValue(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    return normalized === "any" || normalized === "unknown";
}

function findHoverTokenAnchor(
    code: string,
    preferredOffset: number,
    range: { start: number; end: number },
): number | undefined {
    const upperBound = range.end - 1;
    const start = Math.max(range.start, Math.min(preferredOffset, upperBound));
    if (isHoverTokenChar(code[start])) {
        return start;
    }
    for (let delta = 1; delta <= 2; delta++) {
        const right = start + delta;
        if (right <= upperBound && isHoverTokenChar(code[right])) {
            return right;
        }
        const left = start - delta;
        if (left >= range.start && isHoverTokenChar(code[left])) {
            return left;
        }
    }
    return undefined;
}

function expandHoverTokenRange(
    code: string,
    anchor: number,
    range: { start: number; end: number },
): { start: number; end: number } {
    let start = anchor;
    let end = anchor + 1;
    while (start > range.start && isHoverTokenChar(code[start - 1])) {
        start -= 1;
    }
    while (end < range.end && isHoverTokenChar(code[end])) {
        end += 1;
    }
    return { start, end };
}

function isHoverTokenChar(char: string | undefined): boolean {
    return Boolean(char && /[A-Za-z0-9_$.]/.test(char));
}

function dispatchCompletion(
    uri: string,
    position: Position,
    doc: TextDocument,
): CompletionItem[] {
    const items: CompletionItem[] = [];
    const cached = state.get(uri);
    if (cached) {
        const offset = doc.offsetAt(position);
        const sm = createSourceMapAdapter(cached.virtual.mappings);
        const projected = resolveCompletionMapping(sm, offset);
        if (projected.mapping) {
            const virtualOffset = projected.mapping.virtualRange.start
                + Math.min(
                    projected.mapping.virtualRange.end - projected.mapping.virtualRange.start,
                    Math.max(0, offset - projected.mapping.sourceRange.start),
                );
            const info = cached.tsAdapter.service.getCompletionsAtPosition(virtualOffset);
            if (info) {
                const prefix = readCompletionPrefix(doc.getText(), offset);
                const localNames = collectLocalCompletionNames(
                    cached.directives,
                    offset,
                    cached.resolvedXDataByAttribute,
                );
                const localMemberDetails = collectLocalMemberDetails(
                    cached.directives,
                    offset,
                    cached.resolvedXDataByAttribute,
                );
                const ordered = orderCompletionEntries(
                    info.entries,
                    prefix,
                    localNames,
                    cached.virtual.internalIdentifiers,
                );
                const preferred = ordered.find((entry) =>
                    matchesCompletionPrefix(entry, prefix) || localNames.has(entry.name),
                );
                for (const entry of ordered) {
                    const details = cached.tsAdapter.service.getCompletionEntryDetails(
                        virtualOffset,
                        entry,
                    );
                    const detail = preferLocalCompletionDetail(
                        formatCompletionDetail(details, entry.kind),
                        entry.name,
                        localNames,
                        cached.virtual,
                        cached.tsAdapter.service,
                        localMemberDetails,
                    );
                    items.push({
                        label: entry.name,
                        kind: mapCompletionKind(entry.kind),
                        detail,
                        sortText: scoreCompletionSortText(
                            entry,
                            prefix,
                            localNames,
                        ),
                        filterText: entry.filterText ?? entry.name,
                        insertText: entry.insertText,
                        preselect: preferred?.name === entry.name,
                        documentation: formatCompletionDocumentation(details),
                        textEdit: toCompletionTextEdit(
                            doc,
                            projected.mapping,
                            info.optionalReplacementSpan ?? entry.replacementSpan,
                            entry.insertText ?? entry.name,
                        ),
                    });
                }
            }
        }
    }
    const directive = findDirectiveAt(uri, position, doc);
    if (directive) {
        items.push(...completeModifier(directive));
        return items;
    }
    const attributePrefix = readAttributeNameAt(doc, position);
    if (attributePrefix === null) {
        return items;
    }
    items.push(...completeDirective(attributePrefix));
    return items;
}

function dispatchDefinition(
    uri: string,
    position: Position,
    doc: TextDocument,
): Definition | null {
    const cached = state.get(uri);
    if (!cached) {
        return null;
    }
    const offset = doc.offsetAt(position);
    const sm = createSourceMapAdapter(cached.virtual.mappings);
    const projected = resolveDefinitionMapping(sm, offset);
    if (!projected.mapping) {
        return null;
    }
    const virtualOffset = projected.mapping.virtualRange.start
        + Math.min(
            projected.mapping.virtualRange.end - projected.mapping.virtualRange.start,
            Math.max(0, offset - projected.mapping.sourceRange.start),
        );
    const definitions = cached.tsAdapter.service.getDefinitionAtPosition(virtualOffset) ?? [];
    const locations = dedupeDefinitionLocations(
        definitions
            .map((definition) =>
                toDefinitionLocation(
                    definition.fileName,
                    definition.textSpan.start,
                    definition.textSpan.length,
                    cached.tsAdapter.service.fileName,
                    sm,
                    uri,
                    doc,
                ),
            )
            .filter((value): value is Location => Boolean(value)),
    );
    return locations.length > 0 ? locations : null;
}

function resolveCompletionMapping(
    sm: ReturnType<typeof createSourceMapAdapter>,
    offset: number,
) {
    const direct = sm.mapSourceToVirtual(offset, { completion: true });
    if (direct.mapping) {
        return direct;
    }
    if (offset > 0) {
        const previous = sm.mapSourceToVirtual(offset - 1, { completion: true });
        if (previous.mapping) {
            return previous;
        }
    }
    return direct;
}

function resolveDefinitionMapping(
    sm: ReturnType<typeof createSourceMapAdapter>,
    offset: number,
) {
    const direct = sm.mapSourceToVirtual(offset, { definition: true });
    if (direct.mapping) {
        return direct;
    }
    if (offset > 0) {
        const previous = sm.mapSourceToVirtual(offset - 1, { definition: true });
        if (previous.mapping) {
            return previous;
        }
    }
    return direct;
}

function mapCompletionKind(kind: string): CompletionItemKind {
    switch (kind) {
        case "method":
            return CompletionItemKind.Method;
        case "function":
            return CompletionItemKind.Function;
        case "getter":
        case "setter":
        case "property":
            return CompletionItemKind.Property;
        case "field":
            return CompletionItemKind.Field;
        case "const":
        case "let":
        case "var":
        case "local var":
        case "variable":
            return CompletionItemKind.Variable;
        case "parameter":
            return CompletionItemKind.Variable;
        case "class":
            return CompletionItemKind.Class;
        case "interface":
            return CompletionItemKind.Interface;
        case "module":
            return CompletionItemKind.Module;
        case "keyword":
            return CompletionItemKind.Keyword;
        default:
            return CompletionItemKind.Text;
    }
}

function formatCompletionDetail(
    details: { displayParts?: Array<{ text: string }> } | undefined,
    fallback: string,
): string {
    const text = (details?.displayParts ?? [])
        .map((part) => part.text)
        .join("")
        .trim();
    return text || fallback;
}

function preferLocalCompletionDetail(
    detail: string,
    name: string,
    localNames: ReadonlySet<string>,
    virtual: VirtualCodeFile,
    service: LanguageServiceAdapterHandle["service"],
    localMemberDetails: ReadonlyMap<string, DataMemberDescriptor> = new Map(),
): string {
    if (!localNames.has(name) || !isLowSignalCompletionDetail(detail)) {
        return detail;
    }
    const local = resolveLocalCompletionDetail(name, virtual, service, localMemberDetails);
    return local || detail;
}

function isLowSignalCompletionDetail(detail: string): boolean {
    const normalized = detail.toLowerCase();
    return /\bany\b|\bunknown\b/.test(normalized);
}

function resolveLocalCompletionDetail(
    name: string,
    virtual: VirtualCodeFile,
    service: LanguageServiceAdapterHandle["service"],
    localMemberDetails: ReadonlyMap<string, DataMemberDescriptor> = new Map(),
): string | undefined {
    const labels = new Set([
        `x-data property ${name}`,
        `x-data shorthand ${name}`,
        `x-data getter ${name}`,
        `x-data setter ${name}`,
        `x-data method ${name}`,
        `x-data init ${name}`,
    ]);
    const mapping = virtual.mappings.find((candidate) =>
        candidate.capabilities.hover && labels.has(candidate.label),
    );
    if (!mapping) {
        return undefined;
    }
    const info = service.getHoverAtPosition(mapping.virtualRange.start);
    const display = (info?.displayParts ?? []).map((part) => part.text).join("").trim();
    if (!display) {
        return undefined;
    }
    return normalizeHoverDisplay(display, mapping.label, new Map(), localMemberDetails);
}

function formatCompletionDocumentation(
    details:
        | {
              documentation?: Array<{ text: string }>;
              tags?: Array<{ name: string; text?: string | Array<{ text: string }> }>;
          }
        | undefined,
): string | undefined {
    if (!details) {
        return undefined;
    }
    const docs = (details.documentation ?? [])
        .map((part) => part.text)
        .join("\n")
        .trim();
    const tags = (details.tags ?? [])
        .map((tag) => {
            const body = Array.isArray(tag.text)
                ? tag.text.map((part) => part.text).join("")
                : (tag.text ?? "");
            return body ? `@${tag.name} ${body}` : `@${tag.name}`;
        })
        .join("\n")
        .trim();
    const combined = [docs, tags].filter(Boolean).join("\n\n").trim();
    return combined || undefined;
}

function orderCompletionEntries<T extends { name: string; kind: string; sortText?: string }>(
    entries: readonly T[],
    prefix: string,
    localNames: ReadonlySet<string>,
    internalIdentifiers: ReadonlySet<string>,
): T[] {
    return entries
        .filter((entry) => !internalIdentifiers.has(entry.name))
        .sort((left, right) => {
        const leftRank = completionEntryRank(left, prefix);
        const rightRank = completionEntryRank(right, prefix);
        const leftLocalRank = localCompletionRank(left, prefix, localNames);
        const rightLocalRank = localCompletionRank(right, prefix, localNames);
        if (leftLocalRank !== rightLocalRank) {
            return leftLocalRank - rightLocalRank;
        }
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }
        if (leftRank === 0 && left.name.length !== right.name.length) {
            return left.name.length - right.name.length;
        }
        const leftSort = left.sortText ?? left.name;
        const rightSort = right.sortText ?? right.name;
        if (leftSort !== rightSort) {
            return leftSort.localeCompare(rightSort);
        }
        return left.name.localeCompare(right.name);
        });
}

function completionEntryRank(
    entry: { name: string; kind: string; sortText?: string },
    prefix: string,
): number {
    if (!prefix) {
        return 2;
    }
    if (matchesCompletionPrefix(entry, prefix)) {
        return 0;
    }
    return 1;
}

function localCompletionRank(
    entry: { name: string },
    prefix: string,
    localNames: ReadonlySet<string>,
): number {
    const isLocal = localNames.has(entry.name);
    const prefixMatch = matchesCompletionPrefix(entry, prefix);
    if (isLocal && prefixMatch) {
        return 0;
    }
    if (isLocal) {
        return 1;
    }
    if (prefixMatch) {
        return 2;
    }
    return 3;
}

function matchesCompletionPrefix(
    entry: { name: string },
    prefix: string,
): boolean {
    if (!prefix) {
        return false;
    }
    return entry.name.toLowerCase().startsWith(prefix.toLowerCase());
}

function scoreCompletionSortText(
    entry: { name: string; sortText?: string },
    prefix: string,
    localNames: ReadonlySet<string>,
): string {
    const base = entry.sortText ?? entry.name;
    return `${localCompletionRank(entry, prefix, localNames)}:${completionEntryRank(entry, prefix)}:${base}:${entry.name.length
        .toString()
        .padStart(4, "0")}`;
}

function toCompletionTextEdit(
    doc: TextDocument,
    mapping: { sourceRange: { start: number; end: number }; virtualRange: { start: number; end: number } },
    span: { start: number; length: number } | undefined,
    newText: string,
) {
    if (!span) {
        return undefined;
    }
    const sourceStart = mapVirtualOffsetToSourceOffset(mapping, span.start);
    const sourceEnd = mapVirtualOffsetToSourceOffset(mapping, span.start + span.length);
    return {
        range: {
            start: doc.positionAt(sourceStart),
            end: doc.positionAt(sourceEnd),
        },
        newText,
    };
}

function mapVirtualOffsetToSourceOffset(
    mapping: { sourceRange: { start: number; end: number }; virtualRange: { start: number; end: number } },
    virtualOffset: number,
): number {
    const delta = Math.max(0, virtualOffset - mapping.virtualRange.start);
    const sourceLength = mapping.sourceRange.end - mapping.sourceRange.start;
    return mapping.sourceRange.start + Math.min(sourceLength, delta);
}

function mapGeneratedOffsetToSourceOffset(
    mapping: { sourceRange: { start: number; end: number }; virtualRange: { start: number; end: number } },
    virtualOffset: number,
): number {
    const delta = Math.max(0, virtualOffset - mapping.virtualRange.start);
    const sourceLength = mapping.sourceRange.end - mapping.sourceRange.start;
    return mapping.sourceRange.start + Math.min(sourceLength, delta);
}

function readCompletionPrefix(text: string, offset: number): string {
    let start = offset;
    while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1] ?? "")) {
        start -= 1;
    }
    return text.slice(start, offset);
}

function collectLocalCompletionNames(
    directives: ReadonlyArray<AlpineDirectiveNode>,
    offset: number,
    resolvedXDataByAttribute: ReadonlyMap<string, ResolvedXDataSource> = new Map(),
): ReadonlySet<string> {
    const names = new Set<string>();
    for (const directive of findEnclosingDataDirectives(directives, offset)) {
        for (const member of getDirectiveMembers(directive, resolvedXDataByAttribute)) {
            names.add(member.name);
        }
    }
    return names;
}

function findEnclosingDataDirectives(
    directives: ReadonlyArray<AlpineDirectiveNode>,
    offset: number,
): AlpineDirectiveNode[] {
    return directives
        .filter(
            (directive) =>
                directive.canonicalName === "x-data"
                && directive.elementRange.start <= offset
                && offset <= directive.elementRange.end,
        )
        .sort((left, right) => {
            const leftSize = left.elementRange.end - left.elementRange.start;
            const rightSize = right.elementRange.end - right.elementRange.start;
            return leftSize - rightSize;
        });
}

function toDefinitionLocation(
    fileName: string,
    start: number,
    length: number,
    currentVirtualFileName: string,
    sm: ReturnType<typeof createSourceMapAdapter>,
    currentUri: string,
    currentDoc: TextDocument,
): Location | null {
    if (fileName === currentVirtualFileName) {
        const range = mapVirtualSpanToSourceRange(sm, currentDoc, start, length);
        return range ? Location.create(currentUri, range) : null;
    }
    if (!existsSync(fileName)) {
        return null;
    }
    const uri = pathToFileURL(fileName).toString();
    const text = readFileSync(fileName, "utf8");
    const languageId = guessLanguageId(fileName);
    const externalDoc = TextDocument.create(uri, languageId, 0, text);
    return Location.create(uri, {
        start: externalDoc.positionAt(start),
        end: externalDoc.positionAt(start + length),
    });
}

function mapVirtualSpanToSourceRange(
    sm: ReturnType<typeof createSourceMapAdapter>,
    doc: TextDocument,
    start: number,
    length: number,
): Range | null {
    const startLocation = sm.mapVirtualToSource(start, { definition: true });
    const endLocation = sm.mapVirtualToSource(
        Math.max(start, start + Math.max(1, length) - 1),
        { definition: true },
    );
    if (!startLocation.mapping || !endLocation.mapping) {
        return null;
    }
    const sourceStart = mapGeneratedOffsetToSourceOffset(startLocation.mapping, start);
    const sourceEndInclusive = mapGeneratedOffsetToSourceOffset(
        endLocation.mapping,
        Math.max(start, start + Math.max(1, length) - 1),
    );
    return {
        start: doc.positionAt(sourceStart),
        end: doc.positionAt(sourceEndInclusive + 1),
    };
}

function guessLanguageId(fileName: string): string {
    if (fileName.endsWith(".d.ts") || fileName.endsWith(".ts")) {
        return "typescript";
    }
    if (fileName.endsWith(".js")) {
        return "javascript";
    }
    return "plaintext";
}

function dedupeDefinitionLocations(locations: Location[]): Location[] {
    const seen = new Set<string>();
    return locations.filter((location) => {
        const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

connection.onHover(({ textDocument, position }): Hover | null => {
    const doc = documents.get(textDocument.uri);
    if (!doc) {
        return null;
    }
    return dispatchHover(textDocument.uri, position, doc);
});

connection.onCompletion(({ textDocument, position }): CompletionItem[] => {
    const doc = documents.get(textDocument.uri);
    if (!doc) {
        return [];
    }
    return dispatchCompletion(textDocument.uri, position, doc);
});

connection.onDefinition(({ textDocument, position }): Definition | null => {
    const doc = documents.get(textDocument.uri);
    if (!doc) {
        return null;
    }
    return dispatchDefinition(textDocument.uri, position, doc);
});

connection.onSignatureHelp(({ textDocument, position }): SignatureHelp | null => {
    const doc = documents.get(textDocument.uri);
    if (!doc) {
        return null;
    }
    const cached = state.get(textDocument.uri);
    if (!cached) {
        return null;
    }
    const offset = doc.offsetAt(position);
    const directive = findDirectiveAt(textDocument.uri, position, doc);
    if (directive && directive.canonicalName === "x-on") {
        const eventName = directive.argument ?? "event";
        const sig: SignatureInformation = {
            label: `(${eventName}: Event, $event: AlpineEvent): void`,
            parameters: [
                ParameterInformation.create("(event: Event)"),
                ParameterInformation.create("($event: AlpineEvent)"),
            ],
            documentation: {
                kind: MarkupKind.Markdown,
                value: [
                    `Alpine handler for the **${eventName}** event.`,
                    "",
                    "The event listener receives two parameters:",
                    "- `event`: the native DOM Event.",
                    "- `$event`: an Alpine convenience alias for the same value.",
                ].join("\n"),
            },
        };
        return {
            signatures: [sig],
            activeSignature: 0,
            activeParameter: 0,
        };
    }
    if (directive && directive.canonicalName === "x-data") {
        const sig: SignatureInformation = {
            label: `({ <property>, <method>(), init(): void })`,
            parameters: [
                ParameterInformation.create("(properties)"),
                ParameterInformation.create("(methods)"),
                ParameterInformation.create("(init())"),
            ],
            documentation: {
                kind: MarkupKind.Markdown,
                value: [
                    "Declares a new Alpine component scope.",
                    "",
                    "Each member can be:",
                    "- `name: literal` for state.",
                    "- `name() {}` for methods.",
                    "- `name(arg) { ... }` for async handlers.",
                    "- `init() { ... }` runs on mount.",
                ].join("\n"),
            },
        };
        const valueIdx = directive.valueRange?.start ?? offset;
        if (offset >= valueIdx - 1 && offset <= (directive.valueRange?.end ?? offset) + 1) {
            return {
                signatures: [sig],
                activeSignature: 0,
                activeParameter: 0,
            };
        }
    }
    void offset;
    return null;
});

connection.onRequest("alpine/ping", () => ({
    ok: true as const,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    initialized,
}));

connection.onRequest("alpine/directives", () => DIRECTIVES);

interface VirtualResponse {
    languageId: string;
    code: string;
    internalIdentifiers: string[];
    mappings: Array<{
        sourceRange: { start: number; end: number };
        virtualRange: { start: number; end: number };
        label: string;
        capabilities: Record<string, boolean>;
    }>;
}

connection.onRequest(
    "alpine/show-virtual",
    (params: TestCompletionParams): VirtualResponse | null => {
        const cached = state.get(params.textDocument.uri);
        let virtual: VirtualCodeFile | undefined = cached?.virtual;
        if (!virtual && params.text !== undefined) {
            virtual = generateAlpineVirtualCode(params.text, "alpine-virtual-code");
        }
        if (!virtual) {
            return null;
        }
        return {
            languageId: virtual.languageId,
            code: virtual.code,
            internalIdentifiers: [...virtual.internalIdentifiers],
            mappings: virtual.mappings.map((m) => ({
                sourceRange: m.sourceRange,
                virtualRange: m.virtualRange,
                label: m.label,
                capabilities: { ...m.capabilities },
            })),
        };
    },
);

interface TestCompletionParams {
    textDocument: { uri: string };
    position: Position;
    text?: string;
}

interface CompletionResponsePayload {
    items: CompletionItem[];
}

function resolveTestDocument(params: TestCompletionParams): TextDocument | undefined {
    const tracked = documents.get(params.textDocument.uri);
    if (tracked) {
        return tracked;
    }
    if (params.text !== undefined) {
        const synth = TextDocument.create(params.textDocument.uri, "html", 0, params.text);
        state.set(params.textDocument.uri, buildState(params.text, params.textDocument.uri));
        return synth;
    }
    return undefined;
}

connection.onRequest(
    "alpine/completion-test",
    (params: TestCompletionParams): CompletionResponsePayload | null => {
        const doc = resolveTestDocument(params);
        if (!doc) {
            return null;
        }
        if (params.text !== undefined) {
            state.set(params.textDocument.uri, buildState(params.text, params.textDocument.uri));
        }
        const items = dispatchCompletion(params.textDocument.uri, params.position, doc);
        return { items };
    },
);

interface HoverResponsePayload {
    contents: MarkupContent | null;
}

connection.onRequest(
    "alpine/hover-test",
    (params: TestCompletionParams): HoverResponsePayload | null => {
        const doc = resolveTestDocument(params);
        if (!doc) {
            return null;
        }
        if (params.text !== undefined) {
            state.set(params.textDocument.uri, buildState(params.text, params.textDocument.uri));
        }
        const hover = dispatchHover(params.textDocument.uri, params.position, doc);
        if (!hover) {
            return null;
        }
        const markup = hover.contents;
        if (typeof markup === "string") {
            return { contents: { kind: MarkupKind.PlainText, value: markup } };
        }
        if (Array.isArray(markup)) {
            const value = markup
                .map((item) => (typeof item === "string" ? item : item.value))
                .join("\n");
            return { contents: { kind: MarkupKind.Markdown, value } };
        }
        return { contents: markup as MarkupContent };
    },
);


documents.listen(connection);
connection.listen();

function findDirectiveAt(uri: string, position: Position, doc: TextDocument): AlpineDirectiveNode | null {
    const cache = state.get(uri);
    if (!cache) {
        return null;
    }
    const offset = doc.offsetAt(position);
    for (const directive of cache.directives) {
        if (offset >= directive.nameRange.start && offset <= directive.nameRange.end) {
            return directive;
        }
    }
    return null;
}

function readAttributeNameAt(doc: TextDocument, position: Position): string | null {
    const text = doc.getText();
    const offset = doc.offsetAt(position);
    if (offset > text.length) {
        return null;
    }
    let lastWhitespace = -1;
    for (let i = offset - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === undefined) {
            break;
        }
        if (ch === "<" || ch === ">") {
            break;
        }
        if (ch === "=") {
            return null;
        }
        if (ch === "/" && i + 1 < offset && /\s/.test(text[i + 1] ?? "")) {
            break;
        }
        if (/\s/.test(ch)) {
            lastWhitespace = i;
            break;
        }
    }
    if (lastWhitespace === -1) {
        return null;
    }
    const segment = text.slice(lastWhitespace + 1, offset).trim();
    if (!segment) {
        return null;
    }
    if (!/[a-zA-Z@:_]/.test(segment[0]!)) {
        return null;
    }
    return segment;
}

function completeDirective(prefix: string): CompletionItem[] {
    const items: CompletionItem[] = [];
    const matches = getCompletionNames(prefix);
    for (const spec of matches) {
        items.push({
            label: spec.name,
            kind: CompletionItemKind.Field,
            detail: `Alpine directive · ${spec.valueKind}`,
            documentation: spec.documentation,
        });
    }
    for (const custom of pluginRegistry.listSpecs()) {
        if (prefix === "" || custom.name.toLowerCase().startsWith(prefix.toLowerCase())) {
            items.push({
                label: custom.name,
                kind: CompletionItemKind.Field,
                detail: `Custom directive · ${custom.valueKind ?? "none"}`,
                documentation: custom.documentation ?? "",
            });
            for (const alias of custom.aliases ?? []) {
                if (prefix === "" || alias.startsWith(prefix)) {
                    items.push({
                        label: alias,
                        kind: CompletionItemKind.Field,
                        detail: `Custom directive · ${custom.valueKind ?? "none"} (shorthand)`,
                        documentation: custom.documentation ?? "",
                    });
                }
            }
        }
    }
    return items;
}

function completeModifier(directive: AlpineDirectiveNode): CompletionItem[] {
    const modifiers = getModifiers(directive.canonicalName);
    const used = new Set(directive.modifiers);
    return modifiers
        .filter((m) => !used.has(m.name))
        .map((m) => ({
            label: `.${m.name}`,
            kind: CompletionItemKind.Field,
            detail: `Modifier · ${directive.canonicalName}`,
            documentation: m.documentation,
            insertText: `.${m.name}`,
        }));
}

interface PluginRegisterResponse {
    ok: boolean;
    name: string;
    error?: string;
}

connection.onRequest("alpine/plugin/register", (spec: CustomDirective): PluginRegisterResponse => {
    if (!spec || typeof spec.name !== "string") {
        return { ok: false, name: "", error: "missing_name" };
    }
    pluginRegistry.register({
        ...spec,
        aliases: spec.aliases ?? [],
        modifiers: spec.modifiers ?? [],
    });
    return { ok: true, name: spec.name };
});

connection.onRequest("alpine/plugin/unregister", (params: { name?: string }): PluginRegisterResponse => {
    if (!params || typeof params.name !== "string") {
        return { ok: false, name: "", error: "missing_name" };
    }
    const removed = pluginRegistry.unregister(params.name);
    return { ok: removed, name: params.name };
});

connection.onRequest("alpine/plugin/list", () => pluginRegistry.list());

interface IndexResponse {
    ok: boolean;
    total: number;
    files: number;
}

connection.onRequest("alpine/index/clear", (): IndexResponse => {
    workspaceIdentifiers.clear();
    return { ok: true, total: 0, files: 0 };
});

interface IndexRequest {
    files: Array<{ uri: string; text: string; languageId?: string }>;
}

connection.onRequest(
    "alpine/index/files",
    (params: IndexRequest): IndexResponse => {
        if (!params || !Array.isArray(params.files)) {
            return { ok: true, total: 0, files: 0 };
        }
        let total = 0;
        const processedFiles = new Set<string>();
        for (const file of params.files) {
            if (typeof file.uri !== "string" || typeof file.text !== "string") {
                continue;
            }
            const prepared = preprocessForLanguage(
                file.text,
                file.languageId ?? "html",
                file.uri,
            );
            const decls = extractIdentifierDeclarations(prepared, file.uri);
            workspaceIdentifiers.set(file.uri, decls);
            total += decls.length;
            processedFiles.add(file.uri);
        }
        for (const uri of [...workspaceIdentifiers.keys()]) {
            if (!processedFiles.has(uri)) {
                workspaceIdentifiers.delete(uri);
            }
        }
        return { ok: true, total, files: processedFiles.size };
    },
);

connection.onRequest(
    "alpine/index/query",
    (): IdentifierDeclaration[] => {
        const flat: IdentifierDeclaration[] = [];
        for (const list of workspaceIdentifiers.values()) {
            flat.push(...list);
        }
        return flat;
    },
);

connection.onRequest("alpine/index/clear", () => {
    workspaceIdentifiers.clear();
    return { ok: true as const, total: 0 };
});

interface IndexRequest {
    files: Array<{ uri: string; text: string; languageId?: string }>;
}

connection.onRequest(
    "alpine/index/files",
    (params: IndexRequest): { ok: true; total: number; files: number } => {
        if (!params || !Array.isArray(params.files)) {
            return { ok: true as const, total: 0, files: 0 };
        }
        let total = 0;
        const processedFiles = new Set<string>();
        for (const file of params.files) {
            if (typeof file.uri !== "string" || typeof file.text !== "string") {
                continue;
            }
            const prepared = preprocessForLanguage(
                file.text,
                file.languageId ?? "html",
                file.uri,
            );
            const decls = extractIdentifierDeclarations(prepared, file.uri);
            workspaceIdentifiers.set(file.uri, decls);
            total += decls.length;
            processedFiles.add(file.uri);
        }
        for (const uri of [...workspaceIdentifiers.keys()]) {
            if (!processedFiles.has(uri)) {
                workspaceIdentifiers.delete(uri);
            }
        }
        return { ok: true as const, total, files: processedFiles.size };
    },
);

connection.onRequest("alpine/index/query", () => {
    const flat: IdentifierDeclaration[] = [];
    for (const list of workspaceIdentifiers.values()) {
        flat.push(...list);
    }
    return flat;
});

void stripPhpBlocks;

function extractIdentifierDeclarations(
    text: string,
    fileName: string,
): IdentifierDeclaration[] {
    const directives = extractAlpineDirectives(text);
    const out: IdentifierDeclaration[] = [];
    for (const directive of directives) {
        if (directive.canonicalName !== "x-data") {
            continue;
        }
        const value = directive.value ?? "";
        const offset = directive.valueRange?.start ?? 0;
        const matches = value.match(/[A-Za-z_$][\w$]*\s*[:,({]/g) ?? [];
        for (const m of matches) {
            const name = m.replace(/[:,({]/, "").trim();
            if (name.startsWith("'") || name.startsWith('"')) {
                continue;
            }
            if (name === "init") {
                out.push({ name, kind: "init", fileName, sourceOffset: offset });
                continue;
            }
            if (/^\s*function\b/.test(value.slice(value.indexOf(name)))) {
                out.push({ name, kind: "method", fileName, sourceOffset: offset });
            } else {
                out.push({ name, kind: "property", fileName, sourceOffset: offset });
            }
        }
    }
    return out;
}
