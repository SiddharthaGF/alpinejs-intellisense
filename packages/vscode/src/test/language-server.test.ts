import * as assert from "assert";
import * as vscode from "vscode";

interface PingResult {
    ok: boolean;
    server: string;
    version: string;
    initialized: boolean;
}

interface StatusResult {
    running: boolean;
}

const COMMAND_PING = "alpine.ping";
const COMMAND_STATUS = "alpine.status";
const COMMAND_RESTART = "alpine.restart";
const POLL_INTERVAL_MS = 250;
const START_TIMEOUT_MS = 15000;

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServerReady(): Promise<StatusResult | undefined> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const status = await vscode.commands.executeCommand<StatusResult>(
            COMMAND_STATUS,
        );
        if (status && status.running) {
            return status;
        }
        await wait(POLL_INTERVAL_MS);
    }
    return undefined;
}

async function openHtmlDocument(content: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({
        language: "html",
        content,
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc;
}

suite("Language Server Integration", function () {
    this.timeout(30000);
    void vscode.window.showInformationMessage(
        "Alpine Language Server integration tests starting.",
    );

    test("client starts when an HTML document opens", async () => {
        await openHtmlDocument("<div x-data=\"{ open: false }\"></div>");
        const status = await waitForServerReady();
        assert.ok(
            status && status.running,
            `Alpine Language Server should report running within ${START_TIMEOUT_MS} ms`,
        );
    });

    test("alpine.ping returns ok with the expected server info", async () => {
        await openHtmlDocument("<button @click=\"count++\"></button>");
        const ready = await waitForServerReady();
        assert.ok(ready && ready.running, "server should be running before ping");

        const ping = await vscode.commands.executeCommand<PingResult>(
            COMMAND_PING,
        );
        assert.ok(ping, "ping command should resolve a value");
        assert.strictEqual(ping.ok, true, "ping.ok must be true");
        assert.strictEqual(ping.server, "alpine-language-server");
        assert.strictEqual(ping.initialized, true);
        assert.strictEqual(typeof ping.version, "string");
        assert.ok(ping.version.length > 0);
    });

    test("alpine.restart keeps the client running", async () => {
        await openHtmlDocument("<span x-text=\"name\"></span>");
        const before = await waitForServerReady();
        assert.ok(before && before.running, "server should start before restart");

        await vscode.commands.executeCommand(COMMAND_RESTART);
        const after = await waitForServerReady();
        assert.ok(after && after.running, "server should be running again after restart");
    });
});
