import * as path from "node:path";
import * as ts from "typescript";
import type { LanguageServiceAdapter, VirtualCodeFile } from "./types.js";

interface TsHost {
    host: ts.LanguageServiceHost;
    files: Map<string, ts.IScriptSnapshot>;
}

export interface TypeScriptLanguageServiceAdapterOptions {
    libRoot?: string;
}

function createInMemoryHost(
    fileName: string,
    content: string,
    options: TypeScriptLanguageServiceAdapterOptions = {},
): TsHost {
    const snapshot = ts.ScriptSnapshot.fromString(content);
    const files: Map<string, ts.IScriptSnapshot> = new Map([[fileName, snapshot]]);
    const compilerOptions: ts.CompilerOptions = {
        allowJs: true,
        noEmit: true,
        strict: true,
        noImplicitAny: false,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        isolatedModules: true,
        esModuleInterop: true,
        lib: ["es2022", "dom", "dom.iterable"],
    };
    const defaultLibFileName = options.libRoot
        ? path.join(options.libRoot, ts.getDefaultLibFileName(compilerOptions))
        : ts.getDefaultLibFilePath(compilerOptions);
    const libDirectory = path.dirname(defaultLibFileName);
    const libFileNames = (compilerOptions.lib ?? []).map((lib) =>
        path.join(libDirectory, `lib.${lib}.d.ts`),
    );
    const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => [fileName, ...libFileNames],
        getScriptVersion: () => "1",
        getScriptSnapshot: (name) => {
            const existing = files.get(name);
            if (existing) {
                return existing;
            }
            if (!ts.sys.fileExists(name)) {
                return undefined;
            }
            const text = ts.sys.readFile(name);
            return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
        },
        getCurrentDirectory: () => process.cwd(),
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: () => defaultLibFileName,
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };
    return { host, files };
}

export interface SemanticService {
    fileName: string;
    getCompletionsAtPosition(offset: number): ts.CompletionInfo | undefined;
    getCompletionEntryDetails(
        offset: number,
        entry: ts.CompletionEntry,
    ): ts.CompletionEntryDetails | undefined;
    getHoverAtPosition(offset: number): ts.QuickInfo | undefined;
    getDefinitionAtPosition(offset: number): readonly ts.DefinitionInfo[] | undefined;
    getDocumentHighlightsAtPosition(
        offset: number,
    ): readonly ts.DocumentHighlights[] | undefined;
    getSyntacticDiagnostics(): readonly ts.Diagnostic[];
    getSemanticDiagnostics(): readonly ts.Diagnostic[];
}

export interface LanguageServiceAdapterHandle extends LanguageServiceAdapter {
    service: SemanticService;
}

export function createTypeScriptLanguageServiceAdapter(
    fileId: string,
    options: TypeScriptLanguageServiceAdapterOptions = {},
): LanguageServiceAdapterHandle {
    const normalised = fileId.replace(/[^A-Za-z0-9_]/g, "_");
    const fileName = path.posix.join("/", `${normalised}.ts`);
    let currentCode = "";
    let hostBundle: TsHost | undefined;
    let service: ts.LanguageService | undefined;

    const rebuild = (code: string): void => {
        if (service) {
            service.dispose();
            service = undefined;
        }
        currentCode = code;
        hostBundle = createInMemoryHost(fileName, code, options);
        hostBundle.files.set(fileName, ts.ScriptSnapshot.fromString(code));
        service = ts.createLanguageService(hostBundle.host, ts.createDocumentRegistry());
    };

    const wrap = (): SemanticService => {
        const live = service;
        if (!live) {
            throw new Error("adapter not attached");
        }
        return {
            fileName,
            getCompletionsAtPosition: (offset) => {
                return live.getCompletionsAtPosition(fileName, offset, {
                    includeCompletionsForModuleExports: true,
                    includeCompletionsWithInsertText: true,
                });
            },
            getCompletionEntryDetails: (offset, entry) => {
                return live.getCompletionEntryDetails(
                    fileName,
                    offset,
                    entry.name,
                    {},
                    entry.source,
                    undefined,
                    entry.data,
                );
            },
            getHoverAtPosition: (offset) => {
                return live.getQuickInfoAtPosition(fileName, offset);
            },
            getDefinitionAtPosition: (offset) => {
                return live.getDefinitionAtPosition(fileName, offset);
            },
            getDocumentHighlightsAtPosition: (offset) => {
                return live.getDocumentHighlights(fileName, offset, [currentCode]);
            },
            getSyntacticDiagnostics: () => {
                return live.getSyntacticDiagnostics(fileName);
            },
            getSemanticDiagnostics: () => {
                return live.getSemanticDiagnostics(fileName);
            },
        };
    };

    const handle: LanguageServiceAdapterHandle = {
        id: fileId,
        isAttached: () => service !== undefined,
        attach(virtualCode: VirtualCodeFile): void {
            rebuild(virtualCode.code);
        },
        detach(): void {
            if (service) {
                service.dispose();
                service = undefined;
            }
            hostBundle = undefined;
            currentCode = "";
        },
        get service(): SemanticService {
            return wrap();
        },
    };
    return handle;
}

export function isInternalDiagnosticMessage(text: string): boolean {
    if (!text) {
        return true;
    }
    return text.includes("__alpine_internal_") || text.includes("__alpine_data");
}export const AlpineDiagnosticSource = "Alpine" as const;
