import * as assert from "assert";
import * as vscode from "vscode";

interface CompletionResponse {
    items: Array<{ label: string; kind?: number }>;
}

interface HoverResponse {
    contents: { kind: string; value: string } | null;
}

const COMMAND_DIRECTIVES = "alpine.directives";
const COMMAND_REQUEST_COMPLETION = "alpine.completion";
const COMMAND_REQUEST_HOVER = "alpine.hover";

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
    await waitForServerReady();
    await wait(500);
    return doc;
}

async function waitForServerReady(): Promise<{ running: boolean } | undefined> {
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
                return status;
            }
        }
        await wait(250);
    }
    return undefined;
}

suite("Stage 3 Alpine parser features", function () {
    this.timeout(30000);
    void vscode.window.showInformationMessage("Stage 3 tests starting.");

    test("exposes the 18 Alpine directives on the server", async () => {
        await openHtml("<div></div>");
        const directives = await vscode.commands.executeCommand<Array<{ name: string }>>(
            COMMAND_DIRECTIVES,
        );
        assert.ok(directives && directives.length === 18, "expected 18 directives");
        const names = directives.map((d) => d.name);
        for (const expected of ["x-data", "x-on", "x-bind", "x-for", "x-id"]) {
            assert.ok(names.includes(expected), `missing directive ${expected}`);
        }
    });

    test("completes known directive names from x- prefix", async () => {
        await openHtml("<div x-dat></div>");
        const position = new vscode.Position(0, "<div x-dat".length);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    COMMAND_REQUEST_COMPLETION,
                    await activeUri(),
                    position,
                )) ?? { items: [] },
            (value) => (value.items ?? []).some((item) => item.label === "x-data"),
        );
        const labels = response?.items.map((i) => i.label) ?? [];
        assert.ok(
            labels.includes("x-data"),
            `expected x-data in completion (got ${labels.join(", ")})`,
        );
    });

    test("completes modifiers when the cursor is over an existing directive", async () => {
        await openHtml("<button x-on:click=\"\"></button>");
        const doc = await vscode.window.activeTextEditor?.document;
        assert.ok(doc, "expected a document");
        const idx = doc.getText().indexOf("x-on:click");
        const position = doc.positionAt(idx + "x-on:click".length - 2);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    COMMAND_REQUEST_COMPLETION,
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => (value.items ?? []).some((item) => item.label.startsWith(".")),
        );
        const labels = response?.items.map((i) => i.label) ?? [];
        assert.ok(
            labels.some((l) => l.startsWith(".")),
            `expected at least one modifier in completion (got ${labels.join(", ")})`,
        );
    });

    test("hover returns markdown documentation for a known directive", async () => {
        await openHtml("<div x-show=\"open\"></div>");
        const doc = await vscode.window.activeTextEditor?.document;
        assert.ok(doc, "expected a document");
        const idx = doc.getText().indexOf("x-show");
        const position = doc.positionAt(idx + 2);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_REQUEST_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => (value.contents?.value ?? "").toLowerCase().includes("display: none"),
        );
        assert.ok(response, "hover should respond");
        const value = response.contents?.value ?? "";
        assert.ok(
            value.toLowerCase().includes("display: none"),
            `expected markdown content, got ${value}`,
        );
        assert.ok(
            value.includes("https://alpinejs.dev/directives/show"),
            `expected Alpine directive reference link, got ${value}`,
        );
    });
});

async function activeUri(): Promise<vscode.Uri> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error("no active editor");
    }
    return editor.document.uri;
}
