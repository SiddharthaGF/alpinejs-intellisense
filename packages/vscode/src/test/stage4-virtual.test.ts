import * as assert from "assert";
import * as vscode from "vscode";

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

const MINIMAL = [
    "<div x-data=\"{ open: false }\">",
    "    <button @click=\"open = !open\"></button>",
    "    <span x-text=\"open\"></span>",
    "</div>",
].join("\n");

const COMMAND_SHOW_VIRTUAL_REQUEST = "alpine.showVirtual.request";
const COMMAND_SHOW_VIRTUAL = "alpine.showVirtual";

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function waitForValue<T>(
    producer: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 15000,
    intervalMs = 200,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastValue: T | undefined;
    while (Date.now() < deadline) {
        lastValue = await producer();
        if (predicate(lastValue)) {
            return lastValue;
        }
        await wait(intervalMs);
    }
    throw new Error("Timed out waiting for expected value.");
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
        const status = await vscode.commands.executeCommand<{ running: boolean }>("alpine.status");
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

suite("Stage 4 Virtual TypeScript document", function () {
    this.timeout(30000);
    void vscode.window.showInformationMessage("Stage 4 tests starting.");

    test("produces a TypeScript virtual with one mapping per Alpine expression", async () => {
        const doc = await openHtml(MINIMAL);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const response = await waitForValue(
            async () =>
                await vscode.commands.executeCommand<VirtualResponse>(
                    COMMAND_SHOW_VIRTUAL_REQUEST,
                    doc.uri,
                ),
            (value) => Boolean(value?.code && value.mappings?.length),
        );
        assert.ok(response, "show-virtual response should be defined");
        assert.strictEqual(response.languageId, "typescript");
        assert.ok(response.code.includes("open"));
        assert.ok(response.code.includes("!open"));
        assert.ok(response.code.includes("return open"));

        // Three valid Alpine expressions in the source → three mappings that mention `open`.
        const opens = response.mappings.filter((m) =>
            response.code
                .slice(m.virtualRange.start, m.virtualRange.end)
                .includes("open"),
        );
        assert.ok(
            opens.length >= 3,
            `expected at least 3 mappings referencing open, got ${opens.length}`,
        );

        // Internal identifiers are prefixed and won't leak through completion.
        for (const id of response.internalIdentifiers) {
            assert.ok(id.startsWith("__alpine_internal_"));
        }
    });

    test("Alpine: Show Virtual JavaScript is registered as a command", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes(COMMAND_SHOW_VIRTUAL),
            `expected ${COMMAND_SHOW_VIRTUAL} to be registered`,
        );
    });
});
