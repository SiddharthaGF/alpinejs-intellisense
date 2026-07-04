import * as path from "node:path";
import * as vscode from "vscode";
import { shouldAutoTriggerSuggest } from "./autoSuggest.js";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    Trace,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let outputChannel: vscode.LogOutputChannel | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

const COMMAND_RESTART = "alpine.restart";
const COMMAND_SHOW_OUTPUT = "alpine.showOutput";
const COMMAND_SHOW_VIRTUAL = "alpine.showVirtual";
const COMMAND_SHOW_IDENTIFIERS = "alpine.showIdentifiers";
const COMMAND_PING = "alpine.ping";
const COMMAND_STATUS = "alpine.status";
const OUTPUT_CHANNEL_NAME = "Alpine Language Server";
const SECTION = "alpineLanguageTools";

interface IdentifierDeclaration {
    name: string;
    kind: "property" | "method" | "init";
    fileName: string;
    sourceOffset: number;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    extensionContext = context;

    if (!vscode.workspace.isTrusted) {
        void vscode.window.showInformationMessage(
            "Alpine Language Tools is paused: this workspace is not trusted. Review the Workspace Trust setting and re-enable if appropriate.",
        );
        return;
    }

    const enabled = vscode.workspace
        .getConfiguration(SECTION)
        .get<boolean>("enable", true);
    if (!enabled) {
        return;
    }

    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, {
        log: true,
    });
    context.subscriptions.push(outputChannel);

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMAND_SHOW_OUTPUT, () => {
            outputChannel?.show(true);
        }),
        vscode.commands.registerCommand(COMMAND_RESTART, async () => {
            await restart();
            void vscode.window.showInformationMessage("Alpine Language Server restarted.");
        }),
        vscode.commands.registerCommand(COMMAND_PING, pingServer),
        vscode.commands.registerCommand(COMMAND_STATUS, status),
        vscode.commands.registerCommand(COMMAND_SHOW_VIRTUAL, showVirtual),
        vscode.commands.registerCommand(COMMAND_SHOW_IDENTIFIERS, showIdentifiers),
        vscode.commands.registerCommand(
            "alpine.directives",
            () => client?.sendRequest("alpine/directives"),
        ),
        vscode.commands.registerCommand(
            "alpine.plugin.register",
            (spec: { name: string; valueKind?: string; documentation?: string; modifiers?: string[] }) =>
                client?.sendRequest("alpine/plugin/register", spec),
        ),
        vscode.commands.registerCommand(
            "alpine.plugin.unregister",
            (params: { name: string }) =>
                client?.sendRequest("alpine/plugin/unregister", params),
        ),
        vscode.commands.registerCommand(
            "alpine.index.submit",
            (files: Array<{ uri: string; text: string; languageId?: string }>) =>
                client?.sendRequest("alpine/index/files", { files }),
        ),
        vscode.commands.registerCommand(
            "alpine.index.query.request",
            () => client?.sendRequest("alpine/index/query"),
        ),
        vscode.commands.registerCommand(
            "alpine.completion",
            (uri: vscode.Uri, position: vscode.Position) => {
                const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
                return client?.sendRequest("alpine/completion-test", {
                    textDocument: { uri: uri.toString() },
                    position,
                    text: doc?.getText(),
                });
            },
        ),
        vscode.commands.registerCommand(
            "alpine.hover",
            (uri: vscode.Uri, position: vscode.Position) => {
                const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
                return client?.sendRequest("alpine/hover-test", {
                    textDocument: { uri: uri.toString() },
                    position,
                    text: doc?.getText(),
                });
            },
        ),
        vscode.commands.registerCommand(
            "alpine.showVirtual.request",
            (uri?: vscode.Uri) => {
                const target = uri ?? vscode.window.activeTextEditor?.document.uri;
                if (!target) {
                    return undefined;
                }
                const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target.toString());
                return client?.sendRequest("alpine/show-virtual", {
                    textDocument: { uri: target.toString() },
                    text: doc?.getText(),
                });
            },
        ),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration(`${SECTION}.trace.server`)) {
                applyTraceSetting();
            }
            if (event.affectsConfiguration(`${SECTION}.enable`)) {
                const enabled = vscode.workspace
                    .getConfiguration(SECTION)
                    .get<boolean>("enable", true);
                if (!enabled && client) {
                    await stop();
                } else if (enabled && !client) {
                    await start();
                }
            }
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || event.document !== editor.document || !client) {
                return;
            }
            if (editor.selections.length !== 1 || !editor.selection.isEmpty) {
                return;
            }
            const change = event.contentChanges[0];
            if (!change || event.contentChanges.length !== 1) {
                return;
            }
            const enabled = vscode.workspace
                .getConfiguration(SECTION, editor.document)
                .get<boolean>("autoTriggerSuggestions", true);
            if (!enabled) {
                return;
            }
            const cursorOffset = editor.document.offsetAt(editor.selection.active);
            if (
                !shouldAutoTriggerSuggest({
                    sourceText: editor.document.getText(),
                    languageId: editor.document.languageId,
                    uri: editor.document.uri.toString(),
                    insertedText: change.text,
                    rangeLength: change.rangeLength,
                    cursorOffset,
                })
            ) {
                return;
            }
            void vscode.commands.executeCommand("editor.action.triggerSuggest");
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidGrantWorkspaceTrust(async () => {
            if (!client && vscode.workspace.isTrusted) {
                const enabled = vscode.workspace
                    .getConfiguration(SECTION)
                    .get<boolean>("enable", true);
                if (enabled) {
                    await start();
                }
            }
        }),
    );

    await start();
}

export function deactivate(): Thenable<void> | undefined {
    return stop();
}

async function start(): Promise<void> {
    if (client) {
        return;
    }
    if (!extensionContext) {
        return;
    }
    const modulePath = resolveServerModule();
    const serverOptions: ServerOptions = {
        run: { module: modulePath, transport: TransportKind.stdio },
        debug: {
            module: modulePath,
            transport: TransportKind.stdio,
            options: { execArgv: ["--nolazy", "--inspect=6004"] },
        },
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "html" },
            { scheme: "untitled", language: "html" },
            { scheme: "file", pattern: "**/*.blade.php" },
            { scheme: "untitled", pattern: "**/*.blade.php" },
        ],
        outputChannel,
        synchronize: { configurationSection: SECTION },
        initializationOptions: { serverVersion: "0.0.0" },
    };
    client = new LanguageClient(
        "alpine-language-server",
        "Alpine Language Server",
        serverOptions,
        clientOptions,
    );
    applyTraceSetting();
    try {
        await client.start();
        outputChannel?.appendLine("Alpine Language Server started.");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel?.appendLine(`Failed to start: ${message}`);
        client = undefined;
        throw error;
    }
}

void registerWorkspaceIndexing();

async function stop(): Promise<void> {
    if (!client) {
        return;
    }
    const current = client;
    client = undefined;
    try {
        await current.stop();
        outputChannel?.appendLine("Alpine Language Server stopped.");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel?.appendLine(`Stop timed out, disposing client anyway: ${message}`);
    } finally {
        current.dispose();
    }
}

async function restart(): Promise<void> {
    await stop();
    await start();
}

function resolveServerModule(): string {
    if (!extensionContext) {
        throw new Error("Extension context not initialised.");
    }
    return extensionContext.asAbsolutePath(
        path.join("dist", "server", "main.js"),
    );
}

function applyTraceSetting(): void {
    if (!client) {
        return;
    }
    const setting = vscode.workspace
        .getConfiguration(SECTION)
        .get<string>("trace.server", "off");
    const trace = Trace.fromString(setting);
    void client.setTrace(trace);
}

interface PingResult {
    ok: boolean;
    server: string;
    version: string;
    initialized: boolean;
}

async function pingServer(): Promise<PingResult | { ok: false; error: string }> {
    if (!client) {
        return { ok: false, error: "client_not_started" };
    }
    return client.sendRequest<PingResult>("alpine/ping");
}

function status(): { running: boolean } {
    return { running: client !== undefined };
}

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

async function showVirtual(uri?: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const target = uri ?? editor?.document.uri;
    if (!target) {
        void vscode.window.showWarningMessage("Alpine: Show Virtual JavaScript needs an open HTML document.");
        return;
    }
    if (!client) {
        void vscode.window.showWarningMessage("Alpine Language Server is not running.");
        return;
    }
    let response: VirtualResponse | null;
    try {
        response = await client.sendRequest<VirtualResponse>("alpine/show-virtual", {
            textDocument: { uri: target.toString() },
            text: undefined,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Alpine: Show Virtual JavaScript failed: ${message}`);
        return;
    }
    if (!response) {
        void vscode.window.showWarningMessage("Alpine: no virtual code available for this document.");
        return;
    }
    const doc = await vscode.workspace.openTextDocument({
        language: response.languageId,
        content: response.code,
    });
    await vscode.window.showTextDocument(doc, { preview: true });
}

async function showIdentifiers(): Promise<void> {
    if (!client) {
        void vscode.window.showWarningMessage("Alpine Language Server is not running.");
        return;
    }
    const identifiers = await client.sendRequest<IdentifierDeclaration[]>(
        "alpine/index/query",
    );
    const list = (identifiers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const grouped = new Map<string, IdentifierDeclaration[]>();
    for (const id of list) {
        const key = id.fileName;
        const bucket = grouped.get(key) ?? [];
        bucket.push(id);
        grouped.set(key, bucket);
    }
    const lines: string[] = [
        "// Workspace index of x-data identifiers.",
        `// Files: ${grouped.size}; identifiers: ${list.length}`,
        "",
    ];
    for (const [file, items] of grouped) {
        lines.push(`// ${file}`);
        for (const item of items) {
            lines.push(`${item.kind}  ${item.name}`);
        }
        lines.push("");
    }
    const doc = await vscode.workspace.openTextDocument({
        language: "plaintext",
        content: lines.join("\n"),
    });
    await vscode.window.showTextDocument(doc, { preview: true });
}

async function registerWorkspaceIndexing(): Promise<void> {
    if (!extensionContext) {
        return;
    }
    const disposable = vscode.workspace.onDidSaveTextDocument(() => {
        void pushWorkspaceIndex();
    });
    extensionContext.subscriptions.push(disposable);
    await pushWorkspaceIndex();
}

async function pushWorkspaceIndex(): Promise<void> {
    if (!client) {
        return;
    }
    const files = await vscode.workspace.findFiles(
        "**/*.{html,blade.php}",
        "**/{node_modules,dist,out,build}/**",
        200,
    );
    const payload: Array<{ uri: string; text: string; languageId: string }> = [];
    for (const file of files) {
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            payload.push({
                uri: doc.uri.toString(),
                text: doc.getText(),
                languageId: doc.languageId,
            });
        } catch {
            // ignore unreadable file
        }
    }
    try {
        await client.sendRequest("alpine/index/files", { files: payload });
    } catch {
        // server might not be ready yet
    }
}
