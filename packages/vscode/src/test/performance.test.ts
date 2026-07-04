import * as assert from "assert";
import * as vscode from "vscode";

interface VirtualResponse {
    languageId: string;
    code: string;
    mappings: Array<{
        sourceRange: { start: number; end: number };
        virtualRange: { start: number; end: number };
        label: string;
        capabilities: Record<string, boolean>;
    }>;
}

interface CompletionResponse {
    items: Array<{ label: string; detail?: string }>;
}

interface HoverResponse {
    contents: { kind?: string; value: string } | null;
}

type DefinitionResult = vscode.Location | vscode.LocationLink;

const COMMAND_SHOW_VIRTUAL = "alpine.showVirtual.request";
const COMMAND_COMPLETION = "alpine.completion";
const COMMAND_HOVER = "alpine.hover";

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function waitForValue<T>(
    load: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 15000,
    intervalMs = 200,
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

function nowMs(): number {
    return Date.now();
}

async function measureLatency<T>(iterations: number, action: () => Promise<T>): Promise<{
    samples: number[];
    lastValue: T;
}> {
    const samples: number[] = [];
    let lastValue!: T;
    for (let index = 0; index < iterations; index += 1) {
        const start = nowMs();
        lastValue = await action();
        samples.push(nowMs() - start);
    }
    return { samples, lastValue };
}

function average(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid] ?? 0;
}

function max(values: readonly number[]): number {
    return values.reduce((largest, value) => Math.max(largest, value), 0);
}

function assertLatencyBudget(
    name: string,
    samples: readonly number[],
    budgets: { averageMs: number; medianMs: number; maxMs: number },
): void {
    const stats = {
        average: average(samples),
        median: median(samples),
        max: max(samples),
    };
    // Useful in CI logs when a regression happens.
    console.log(`[perf] ${name}: avg=${stats.average.toFixed(1)}ms median=${stats.median.toFixed(1)}ms max=${stats.max.toFixed(1)}ms samples=${samples.join(",")}`);
    assert.ok(
        stats.average <= budgets.averageMs,
        `${name} average ${stats.average.toFixed(1)}ms exceeded ${budgets.averageMs}ms`,
    );
    assert.ok(
        stats.median <= budgets.medianMs,
        `${name} median ${stats.median.toFixed(1)}ms exceeded ${budgets.medianMs}ms`,
    );
    assert.ok(
        stats.max <= budgets.maxMs,
        `${name} max ${stats.max.toFixed(1)}ms exceeded ${budgets.maxMs}ms`,
    );
}

function normalizeDefinitionTargets(
    entries: readonly DefinitionResult[],
): Array<{ uri: vscode.Uri; range: vscode.Range }> {
    const out: Array<{ uri: vscode.Uri; range: vscode.Range }> = [];
    for (const entry of entries) {
        if ("targetUri" in entry) {
            out.push({ uri: entry.targetUri, range: entry.targetSelectionRange ?? entry.targetRange });
        } else {
            out.push({ uri: entry.uri, range: entry.range });
        }
    }
    return out;
}

function buildPerfDocument(repetitions = 18): string {
    const filler: string[] = [];
    for (let index = 0; index < repetitions; index += 1) {
        filler.push(
            [
                `<section x-data="{`,
                `  count: ${index},`,
                `  message: 'Hola ${index}',`,
                `  logs: [],`,
                `  get statusText() { return message + ' ' + count; },`,
                `  syncMessage(prefix = 'Contador') { message = prefix + ': ' + count; logs.push(message); return message; },`,
                `  up(step = 1) { count = Math.abs(count) + step; return syncMessage(); },`,
                `  reset() { count = 0; return syncMessage('Reiniciado'); }`,
                `}">`,
                `  <h1 x-text="message"></h1>`,
                `  <span x-text="statusText"></span>`,
                `  <button x-on:click="up()"></button>`,
                `  <button x-on:click="reset()"></button>`,
                `  <input x-model="message">`,
                `</section>`,
            ].join("\n"),
        );
    }

    const targetBlocks = [
        `<div x-data="counterComponent">`,
        `  <span x-text="message"></span>`,
        `  <button x-on:click="updateM"></button>`,
        `</div>`,
        `<div x-data="counterFunction()">`,
        `  <span x-text="count"></span>`,
        `  <button x-on:click="reset()"></button>`,
        `</div>`,
        `<div x-data="{ count: 0, typo() { opne = true; } }">`,
        `  <button @click="typo()"></button>`,
        `</div>`,
    ].join("\n");

    return [
        "<script>",
        "document.addEventListener('alpine:init', () => {",
        "  Alpine.data('counterComponent', () => ({",
        "    /** @type {number} */",
        "    _count: 0,",
        "    /** @type {string} */",
        "    _message: 'Hola Mundo',",
        "    /** @returns {string} */",
        "    get message() {",
        "      return this._message;",
        "    },",
        "    /** @returns {void} */",
        "    up() {",
        "      this._count++;",
        "    },",
        "    /**",
        "     * @param {string} newMessage",
        "     * @returns {void}",
        "     */",
        "    updateMessage(newMessage) {",
        "      this._message = newMessage;",
        "    }",
        "  }));",
        "});",
        "",
        "function counterFunction() {",
        "  return {",
        "    /** @type {number} */",
        "    _count: 0,",
        "    /** @returns {number} */",
        "    get count() {",
        "      return this._count;",
        "    },",
        "    /** @returns {void} */",
        "    reset() {",
        "      this._count = 0;",
        "    }",
        "  };",
        "}",
        "</script>",
        ...filler,
        targetBlocks,
    ].join("\n");
}

suite("Extension Performance", function () {
    this.timeout(60000);

    test("virtual generation and diagnostics stay within budget on large documents", async () => {
        const content = buildPerfDocument();
        const doc = await openHtml(content);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const virtualWarm = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<VirtualResponse>(
                    COMMAND_SHOW_VIRTUAL,
                    doc.uri,
                )) ?? null,
            (value) => Boolean(value?.code && value.mappings.length > 0),
            15000,
        );
        assert.ok(virtualWarm, "show virtual should return a response");

        const virtualPerf = await measureLatency(5, async () =>
            (await vscode.commands.executeCommand<VirtualResponse>(
                COMMAND_SHOW_VIRTUAL,
                doc.uri,
            )) ?? { languageId: "", code: "", mappings: [] },
        );
        assert.ok(virtualPerf.lastValue.code.length > 0, "virtual code should not be empty");
        assertLatencyBudget("showVirtual large document", virtualPerf.samples, {
            averageMs: 900,
            medianMs: 900,
            maxMs: 1500,
        });

        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const typoOffset = doc.getText().lastIndexOf("opne");
        assert.ok(typoOffset >= 0, "expected typo marker in perf document");
        const typoRange = new vscode.Range(
            doc.positionAt(typoOffset),
            doc.positionAt(typoOffset + "opne".length),
        );

        const diagnosticStart = nowMs();
        await editor.edit((builder) => {
            builder.replace(typoRange, "open");
        });
        const clearedDiagnostics = await waitForValue(
            async () => vscode.languages.getDiagnostics(doc.uri),
            (value) => !value.some((diag) => diag.message.toLowerCase().includes("opne")),
            15000,
        );
        const diagnosticDuration = nowMs() - diagnosticStart;
        assert.ok(Array.isArray(clearedDiagnostics), "diagnostics query should resolve");
        assert.ok(
            diagnosticDuration <= 4000,
            `diagnostic refresh took ${diagnosticDuration}ms on a large document`,
        );
        console.log(`[perf] diagnostics refresh large document: ${diagnosticDuration}ms`);
    });

    test("completion, hover, and definition remain responsive on large documents", async () => {
        const doc = await openHtml(buildPerfDocument());
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const completionOffset = doc.getText().indexOf('x-on:click="updateM') + 'x-on:click="updateM'.length;
        const completionPosition = doc.positionAt(completionOffset);
        const completionWarm = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    COMMAND_COMPLETION,
                    doc.uri,
                    completionPosition,
                )) ?? { items: [] },
            (value) => (value.items ?? []).some((item) => item.label === "updateMessage"),
            15000,
        );
        assert.ok(
            completionWarm.items.some((item) => item.label === "updateMessage"),
            "expected updateMessage completion",
        );

        const hoverOffset = doc.getText().lastIndexOf('x-text="message') + 'x-text="'.length + 1;
        const hoverPosition = doc.positionAt(hoverOffset);
        const hoverWarm = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    hoverPosition,
                )) ?? { contents: null },
            (value) => (value.contents?.value ?? "").toLowerCase().includes("(getter) message: string"),
            15000,
        );
        assert.ok(
            (hoverWarm.contents?.value ?? "").toLowerCase().includes("(getter) message: string"),
            "expected source-backed getter hover",
        );

        const definitionOffset = doc.getText().lastIndexOf("reset()") + 1;
        const definitionPosition = doc.positionAt(definitionOffset);
        const definitionWarm = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<DefinitionResult[]>(
                    "vscode.executeDefinitionProvider",
                    doc.uri,
                    definitionPosition,
                )) ?? [],
            (value) => normalizeDefinitionTargets(value).length > 0,
            15000,
        );
        assert.ok(normalizeDefinitionTargets(definitionWarm).length > 0, "expected definition target");

        const completionPerf = await measureLatency(5, async () =>
            (await vscode.commands.executeCommand<CompletionResponse>(
                COMMAND_COMPLETION,
                doc.uri,
                completionPosition,
            )) ?? { items: [] },
        );
        assertLatencyBudget("completion large document", completionPerf.samples, {
            averageMs: 3500,
            medianMs: 3200,
            maxMs: 5500,
        });

        const hoverPerf = await measureLatency(5, async () =>
            (await vscode.commands.executeCommand<HoverResponse>(
                COMMAND_HOVER,
                doc.uri,
                hoverPosition,
            )) ?? { contents: null },
        );
        assertLatencyBudget("hover large document", hoverPerf.samples, {
            averageMs: 850,
            medianMs: 850,
            maxMs: 1100,
        });

        const definitionPerf = await measureLatency(5, async () =>
            (await vscode.commands.executeCommand<DefinitionResult[]>(
                "vscode.executeDefinitionProvider",
                doc.uri,
                definitionPosition,
            )) ?? [],
        );
        assertLatencyBudget("definition large document", definitionPerf.samples, {
            averageMs: 500,
            medianMs: 500,
            maxMs: 900,
        });
    });
});
