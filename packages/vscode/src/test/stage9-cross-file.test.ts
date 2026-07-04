import * as assert from "assert";
import * as vscode from "vscode";

interface CompletionResponse {
    items: Array<{ label: string; kind?: number }>;
}

interface IndexResponse {
    ok: boolean;
    total: number;
    files: number;
}

interface IdentifierDeclaration {
    name: string;
    kind: "property" | "method" | "init";
    fileName: string;
    sourceOffset: number;
}

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function waitForValue<T>(
    load: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 10000,
    intervalMs = 250,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastValue = await load();
    while (Date.now() < deadline) {
        if (predicate(lastValue)) {
            return lastValue;
        }
        await wait(intervalMs);
        lastValue = await load();
    }
    return lastValue;
}

async function openHtml(content: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({
        language: "html",
        content,
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc;
}

async function waitForServerReady(): Promise<boolean> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const status = await vscode.commands.executeCommand<{ running: boolean }>(
            "alpine.status",
        );
        if (status && status.running) {
            const directives = await vscode.commands.executeCommand<Array<{ name: string }>>(
                "alpine.directives",
            );
            if (directives && directives.length > 0) {
                return true;
            }
        }
        await wait(250);
    }
    return false;
}

suite("Stage 9 Stage 8 cross-file identifier sharing", function () {
    this.timeout(30000);
    void vscode.window.showInformationMessage("Stage 9 tests starting.");

    test("cross-file identifiers surface in virtual code", async () => {
        await openHtml("<div x-data=\"{ open: false }\"></div>");
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const provider = "<div x-data=\"{ toggle() {} }\"><button @click=\"tog\"></button></div>";
        const consumer = await openHtml(provider);

        const indexResponse = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<IndexResponse>(
                    "alpine.index.submit",
                    [
                        {
                            uri: "file:///seed.html",
                            text: "<div x-data=\"{ open: false }\"></div>",
                            languageId: "html",
                        },
                        {
                            uri: consumer.uri.toString(),
                            text: provider,
                            languageId: "html",
                        },
                    ],
                )) ?? { ok: false, total: 0, files: 0 },
            (value) => value.ok && value.total >= 1,
            15000,
        );
        assert.ok(indexResponse, "alpine.index.submit should return");
        assert.ok(indexResponse.ok, "index.submit should succeed");
        assert.ok(indexResponse.total >= 1, "expected at least one identifier indexed");

        const identifiers = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<IdentifierDeclaration[]>(
                    "alpine.index.query.request",
                )) ?? [],
            (value) => value.some((id) => id.name === "open"),
            15000,
        );
        assert.ok(
            Array.isArray(identifiers) && identifiers.length > 0,
            "expected identifiers list non-empty",
        );
        assert.ok(
            identifiers.some((id) => id.name === "open"),
            `expected 'open' in the index, got ${identifiers.map((id) => id.name).join(", ")}`,
        );
    });

    test("alpine.plugin.register exposes a custom directive completion", async () => {
        await openHtml("<div></div>");
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const registerResult = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<{ ok: boolean; name: string }>(
                    "alpine.plugin.register",
                    {
                        name: "x-tooltip",
                        valueKind: "expression",
                        documentation: "Custom tooltip directive",
                    },
                )) ?? { ok: false, name: "" },
            (value) => value.ok && value.name === "x-tooltip",
        );
        assert.ok(registerResult && registerResult.ok, "plugin.register should succeed");
        assert.strictEqual(registerResult.name, "x-tooltip");

        const doc = await openHtml("<div x-too></div>");
        const position = new vscode.Position(0, "<div x-too".length);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    "alpine.completion",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => (value.items ?? []).some((item) => item.label === "x-tooltip"),
        );
        const labels = (response?.items ?? []).map((i) => i.label);
        assert.ok(
            labels.includes("x-tooltip"),
            `expected x-tooltip in completion (got ${labels.join(", ")})`,
        );

        await vscode.commands.executeCommand("alpine.plugin.unregister", {
            name: "x-tooltip",
        });
    });
});
