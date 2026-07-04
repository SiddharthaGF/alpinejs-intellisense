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

interface CompletionResponse {
    items: Array<{ label: string; kind?: number; detail?: string }>;
}

interface ProviderCompletionList {
    items: Array<{ label: string | { label: string } }>;
}

interface HoverResponse {
    contents: { kind?: string; value: string } | null;
}

interface ProviderHover {
    contents:
        | vscode.MarkdownString
        | vscode.MarkedString
        | Array<vscode.MarkdownString | vscode.MarkedString>;
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

const TYPO_CASE = [
    "<div x-data=\"{ open: false, toggle() {} }\">",
    "    <button @click=\"opne = true\"></button>",
    "</div>",
].join("\n");

const COMPLETION_CASE = [
    "<div x-data=\"{ open: false, toggle() {} }\">",
    "    <button @click=\"tog\"></button>",
    "</div>",
].join("\n");

const HOVER_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <span x-text=\"open\"></span>",
    "</div>",
].join("\n");

const EVENT_CASE = [
    "<div x-data=\"{ open: false }\">",
    "    <input @input=\"$event.target.value\">",
    "</div>",
].join("\n");

const MAGIC_HOVER_CASE = [
    "<div x-data=\"{ message: 'Hola Mundo', focusCurrent() { return this.$nextTick(); } }\">",
    "    <button @click=\"$el.innerHTML = message\"></button>",
    "</div>",
].join("\n");

const MAGIC_COMPLETION_CASE = [
    "<div x-data=\"{ message: 'Hola Mundo' }\">",
    "    <button @click=\"$n\"></button>",
    "</div>",
].join("\n");

const XDATA_HOVER_CASE = [
    "<div x-data=\"{ contador: 0, mensaje: 'Hola Mundo', up() { contador++; return mensaje; } }\"></div>",
].join("\n");

const XDATA_CONSOLE_CASE = [
    "<div x-data=\"{ count: 0, up() { count++; console.log('Contador incrementado a: ' + count); } }\"></div>",
].join("\n");

const XDATA_MATH_CASE = [
    "<div x-data=\"{ count: 0, up() { count = Math.abs(count) + 1; } }\"></div>",
].join("\n");

const XDATA_THIS_CASE = [
    "<div x-data=\"{ count: 0, message: 'Hola Mundo', up() { this.count = Math.abs(this.count) + 1; return this.message; } }\"></div>",
].join("\n");

const XDATA_GETTER_CASE = [
    "<div x-data=\"{ count: 0, get doubleCount() { return this.count * 2; } }\"></div>",
].join("\n");

const XDATA_METHOD_HOVER_CASE = [
    "<div x-data=\"{ count: 0, reset() { count = 0; } }\">",
    '    <button x-on:click="reset"></button>',
    "</div>",
].join("\n");

const XDATA_JSDOC_METHOD_CASE = [
    "<div x-data=\"{",
    "/**",
    " * @param {string} newMessage",
    " * @returns {void}",
    " */",
    "updateMessage(newMessage) {",
    "  this._message = newMessage;",
    "},",
    "_message: 'Hola'",
    "}\">",
    "</div>",
].join("\n");

const XDATA_JSDOC_GETTER_CASE = [
    "<div x-data=\"{",
    "_count: 0,",
    "/**",
    " * @returns {number}",
    " */",
    "get count() {",
    "  return this._count;",
    "}",
    "}\">",
    "</div>",
].join("\n");

const XDATA_COMPLETION_CASE = [
    "<div x-data=\"{ count: 0, up() { conso } }\"></div>",
].join("\n");

const XDATA_MEMBER_COMPLETION_CASE = [
    "<div x-data=\"{ count: 0, up() { console.l } }\"></div>",
].join("\n");

const XDATA_DEFINITION_CASE = [
    "<div x-data=\"{ count: 0, message: 'Hola Mundo', up() { console.log(count); }, reset() { count = 0; } }\">",
    '    <span x-text="count"></span>',
    '    <button x-on:click="reset"></button>',
    "</div>",
].join("\n");

const XDATA_METHOD_DEFINITION_CASE = [
    "<div x-data=\"{ count: 0, reset() { count = 0; } }\">",
    '    <button x-on:click="reset"></button>',
    '    <button x-on:click="reset()"></button>',
    "</div>",
].join("\n");

const INLINE_XDATA_DIAGNOSTIC_CASE = [
    "<div x-data=\"{",
    "  /** @type {number} */",
    "  count: 0,",
    "  /** @type {string} */",
    "  message: 'Hola Mundo',",
    "  /** @returns {void} */",
    "  up() {",
    "    this.count++;",
    "  },",
    "  /**",
    "   * @param {string} newMessage",
    "   * @returns {void}",
    "   */",
    "  updateMessage(newMessage) {",
    "    this.message = newMessage;",
    "  }",
    "}\">",
    "  <button x-on:click=\"up\"></button>",
    "  <input x-model=\"message\">",
    "  <button x-on:click=\"updateMessage('Nuevo mensaje')\"></button>",
    "</div>",
].join("\n");

const EXTERNAL_COMPONENT_SOURCES_CASE = [
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
    "<div x-data=\"counterComponent\">",
    "    <span x-text=\"message\"></span>",
    "    <button x-on:click=\"updateM\"></button>",
    "    <button x-on:click=\"up()\"></button>",
    "</div>",
    "<div x-data=\"counterFunction()\">",
    "    <span x-text=\"count\"></span>",
    "    <button x-on:click=\"reset()\"></button>",
    "</div>",
].join("\n");

const OUT_OF_SCOPE_CASE = [
    '<div x-data="{ localCount: 0, up() { localCount++; } }">',
    '    <span x-text="localCount"></span>',
    "</div>",
    '<button x-on:click="console.log(localCount)"></button>',
].join("\n");

const COMPLEX_XDATA_DIRECTIVE_CASE = [
    "<div",
    '    x-data="{',
    "        count: 0,",
    "        message: 'Hola Mundo',",
    "        logs: [],",
    "        get statusText() {",
    "            return message + ' (' + count + ')';",
    "        },",
    "        syncMessage(prefix = 'Contador') {",
    "            message = prefix + ': ' + count;",
    "            console.log(message);",
    "            return message;",
    "        },",
    "        up(step = 1) {",
    "            count = Math.abs(count) + step;",
    "            logs.push(syncMessage());",
    "        },",
    "        reset() {",
    "            count = 0;",
    "            syncMessage('Reiniciado');",
    "        }",
    '    }"',
    ">",
    '    <h1 x-text="mess"></h1>',
    '    <p x-text="statusTex"></p>',
    '    <button x-on:click="re"></button>',
    '    <button x-on:click="up()"></button>',
    '    <input type="text" x-model="mess" placeholder="Escribe un mensaje">',
    '    <span x-bind:title="syncMess"></span>',
    "</div>",
].join("\n");

const XTEXT_COMPLETION_CASE = COMPLEX_XDATA_DIRECTIVE_CASE;
const XMODEL_COMPLETION_CASE = COMPLEX_XDATA_DIRECTIVE_CASE;
const XON_COMPLETION_CASE = COMPLEX_XDATA_DIRECTIVE_CASE;
const XBIND_COMPLETION_CASE = COMPLEX_XDATA_DIRECTIVE_CASE;

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

suite("Stage 5 TypeScript Language Service", function () {
    this.timeout(30000);
    void vscode.window.showInformationMessage("Stage 5 tests starting.");

    test("the virtual code exposes real TypeScript bindings", async () => {
        const doc = await openHtml(COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<VirtualResponse>(
                    COMMAND_SHOW_VIRTUAL,
                    doc.uri,
                )) ?? null,
            (value) => Boolean(value?.code?.includes("function toggle")),
        );
        assert.ok(response, "show-virtual response should exist");
        assert.ok(response.code.includes("let open"));
        assert.ok(response.code.includes("function toggle"));
    });

    test("a typo in @click gets a real diagnostic published via LSP", async () => {
        const doc = await openHtml(TYPO_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const diagnostics = await waitForValue(
            async () => vscode.languages.getDiagnostics(doc.uri),
            (value) => value.some((d) => d.message.toLowerCase().includes("opne")),
            15000,
        );
        const typo = diagnostics.find((d) => d.message.toLowerCase().includes("opne"));
        assert.ok(typo, "expected a diagnostic mentioning the typo `opne`");
        assert.strictEqual(typo.range.start.line, 1, `expected typo diagnostic on line 2, got ${typo.range.start.line + 1}`);
        assert.ok(typo.range.start.character >= 0);
        assert.ok(typo.range.end.character > typo.range.start.character);
        assert.strictEqual(typo.source, "Alpine");
    });

    test("completion inside @click suggests identifiers declared in x-data", async () => {
        const doc = await openHtml(COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const valueIdx = doc.getText().indexOf("\"tog\"") + 1;
        const position = doc.positionAt(valueIdx + 3);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    COMMAND_COMPLETION,
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => (value.items ?? []).some((item) => item.label === "toggle"),
        );
        const labels = (response?.items ?? []).map((i) => i.label);
        assert.ok(
            labels.includes("toggle"),
            `expected toggle completion, got ${labels.join(", ")}`,
        );
    });

    test("x-data numeric state completion exposes typed detail", async () => {
        const doc = await openHtml(XTEXT_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-text="mess') + 'x-text="mess'.length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    COMMAND_COMPLETION,
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => (value.items ?? []).some((item) => item.label === "count"),
            15000,
        );
        const count = response.items.find((item) => item.label === "count");
        assert.ok(count, "expected count completion item");
        assert.ok(
            (count.detail ?? "").toLowerCase().includes("number"),
            `expected count detail to mention number, got ${count.detail ?? "<empty>"}`,
        );
    });

    test("completion outside an Alpine component does not leak x-data locals", async () => {
        const doc = await openHtml(OUT_OF_SCOPE_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("localCount)") + "localCount".length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    COMMAND_COMPLETION,
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => Array.isArray(value.items),
            15000,
        );
        const labels = (response.items ?? []).map((item) => item.label);
        assert.ok(
            !labels.includes("localCount"),
            `did not expect localCount outside component scope, got ${labels.join(", ")}`,
        );
        const diagnostics = await waitForValue(
            async () => vscode.languages.getDiagnostics(doc.uri),
            (value) => value.some((diag) => diag.message.includes("localCount")),
            15000,
        );
        assert.ok(
            diagnostics.some((diag) => diag.message.includes("localCount")),
            `expected diagnostic for out-of-scope localCount, got ${diagnostics.map((d) => d.message).join(" | ")}`,
        );
    });

    test("editor completion inside x-data suggests console for `conso`", async () => {
        const doc = await openHtml(XDATA_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("conso") + "conso".length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderCompletionList>(
                    "vscode.executeCompletionItemProvider",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => completionLabels(value.items).includes("console"),
            15000,
        );
        const labels = completionLabels(response.items);
        const consoleIndex = labels.indexOf("console");
        assert.ok(consoleIndex >= 0, `expected console completion, got ${labels.slice(0, 20).join(", ")}`);
        assert.ok(consoleIndex < 10, `expected console near top, got index ${consoleIndex}`);
    });

    test("editor member completion inside x-data suggests log for `console.l`", async () => {
        const doc = await openHtml(XDATA_MEMBER_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("console.l") + "console.l".length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderCompletionList>(
                    "vscode.executeCompletionItemProvider",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => completionLabels(value.items).includes("log"),
            15000,
        );
        const labels = completionLabels(response.items);
        const logIndex = labels.indexOf("log");
        assert.ok(logIndex >= 0, `expected log completion, got ${labels.slice(0, 20).join(", ")}`);
        assert.ok(logIndex < 10, `expected log near top, got index ${logIndex}`);
    });

    test("x-text completion prioritizes x-data properties and methods in complex objects", async () => {
        const doc = await openHtml(XTEXT_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-text="mess') + 'x-text="mess'.length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderCompletionList>(
                    "vscode.executeCompletionItemProvider",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => completionLabels(value.items).includes("message"),
            15000,
        );
        const labels = completionLabels(response.items);
        expectLocalPriority(labels, "message", ["count", "statusText", "syncMessage"]);
    });

    test("x-model completion prioritizes x-data properties and methods in complex objects", async () => {
        const doc = await openHtml(XMODEL_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-model="mess') + 'x-model="mess'.length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderCompletionList>(
                    "vscode.executeCompletionItemProvider",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => completionLabels(value.items).includes("message"),
            15000,
        );
        const labels = completionLabels(response.items);
        expectLocalPriority(labels, "message", ["count", "reset", "syncMessage"]);
    });

    test("x-on completion prioritizes x-data methods and properties in complex objects", async () => {
        const doc = await openHtml(XON_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-on:click="re') + 'x-on:click="re'.length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderCompletionList>(
                    "vscode.executeCompletionItemProvider",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => completionLabels(value.items).includes("reset"),
            15000,
        );
        const labels = completionLabels(response.items);
        expectLocalPriority(labels, "reset", ["message", "syncMessage", "up"]);
    });

    test("x-bind completion prioritizes x-data getters and methods in complex objects", async () => {
        const doc = await openHtml(XBIND_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-bind:title="syncMess') + 'x-bind:title="syncMess'.length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderCompletionList>(
                    "vscode.executeCompletionItemProvider",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => completionLabels(value.items).includes("syncMessage"),
            15000,
        );
        const labels = completionLabels(response.items);
        expectLocalPriority(labels, "syncMessage", ["message", "reset", "statusText"]);
    });

    test("hover on x-text `open` returns a TypeScript-typed answer", async () => {
        const doc = await openHtml(HOVER_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const valueIdx = doc.getText().indexOf("\"open\"") + 1;
        const position = doc.positionAt(valueIdx + 1);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = (value.contents?.value ?? "").toLowerCase();
                return text.includes("(property) open: boolean");
            },
        );
        const value = response.contents?.value ?? "";
        assert.ok(value.length > 0, "hover should expose a value");
        const text = value.toLowerCase();
        assert.ok(
            text.includes("(property) open: boolean"),
            `hover content should use property-style typing, got ${value}`,
        );
    });

    test("@input handler body has $event available", async () => {
        const doc = await openHtml(EVENT_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const valueIdx = doc.getText().indexOf("$event");
        const position = doc.positionAt(valueIdx + 2);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => (value.contents?.value ?? "").toLowerCase().includes("event"),
        );
        const text = (response.contents?.value ?? "").toLowerCase();
        assert.ok(
            text.includes("event"),
            `hover should mention Event, got ${response.contents?.value}`,
        );
    });

    test("hover on $el inside Alpine handlers exposes DOM docs", async () => {
        const doc = await openHtml(MAGIC_HOVER_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const valueIdx = doc.getText().indexOf("$el");
        const position = doc.positionAt(valueIdx + 2);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = (value.contents?.value ?? "").toLowerCase();
                return text.includes("$el") && text.includes("htmlelement");
            },
        );
        const text = (response.contents?.value ?? "").toLowerCase();
        assert.ok(text.includes("$el"), `hover should mention $el, got ${response.contents?.value}`);
        assert.ok(
            text.includes("htmlelement"),
            `hover should type $el as HTMLElement, got ${response.contents?.value}`,
        );
        assert.ok(
            text.includes("https://alpinejs.dev/magics/el"),
            `hover should include Alpine magic reference, got ${response.contents?.value}`,
        );
    });

    test("completion inside Alpine handlers suggests magic helpers", async () => {
        const doc = await openHtml(MAGIC_COMPLETION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-on:click="$n') + 'x-on:click="$n'.length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderCompletionList>(
                    "vscode.executeCompletionItemProvider",
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => completionLabels(value.items).some((label) => label.includes("nextTick")),
            15000,
        );
        const labels = completionLabels(response.items);
        assert.ok(
            labels.some((label) => label.includes("nextTick")),
            `expected $nextTick completion, got ${labels.join(", ")}`,
        );
    });

    test("hover inside x-data method bodies resolves sibling state", async () => {
        const doc = await openHtml(XDATA_HOVER_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");
        const valueIdx = doc.getText().indexOf("contador++;");
        const position = doc.positionAt(valueIdx + 1);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = (value.contents?.value ?? "").toLowerCase();
                return text.includes("contador") && text.includes("number");
            },
        );
        const value = response.contents?.value ?? "";
        assert.ok(value.length > 0, "hover should expose a value");
        const text = value.toLowerCase();
        assert.ok(
            text.includes("(property) contador: number"),
            `hover should render property-style typing, got ${value}`,
        );
    });

    test("hover on console.log inside x-data methods exposes browser docs", async () => {
        const doc = await openHtml(XDATA_CONSOLE_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("console.log");
        const position = doc.positionAt(valueIdx + 1);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = (value.contents?.value ?? "").toLowerCase();
                return text.includes("console") && text.includes("debugging console");
            },
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(text.includes("console"), `hover should mention console, got ${value}`);
        assert.ok(
            text.includes("debugging console"),
            `hover should include console docs, got ${value}`,
        );
    });

    test("hover on Math.abs inside x-data methods exposes browser docs", async () => {
        const doc = await openHtml(XDATA_MATH_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("abs(");
        const position = doc.positionAt(valueIdx + 1);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = (value.contents?.value ?? "").toLowerCase();
                return text.includes("math.abs") && text.includes("absolute value");
            },
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(text.includes("math.abs"), `hover should mention Math.abs, got ${value}`);
        assert.ok(
            text.includes("absolute value"),
            `hover should include Math.abs docs, got ${value}`,
        );
    });

    test("hover on Math inside x-data methods uses native-style markdown", async () => {
        const doc = await openHtml(XDATA_MATH_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("Math.abs") + 1;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = value.contents?.value ?? "";
                return text.includes("```typescript") && text.toLowerCase().includes("var math: math");
            },
            15000,
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(value.includes("```typescript"), `hover should include a code fence, got ${value}`);
        assert.ok(text.includes("var math: math"), `hover should include Math signature, got ${value}`);
        assert.ok(
            text.includes("an intrinsic object that provides basic mathematics functionality and constants"),
            `hover should include Math docs, got ${value}`,
        );
    });

    test("hover on this inside x-data methods exposes the inferred component shape", async () => {
        const doc = await openHtml(XDATA_THIS_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("this.count") + 2;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = value.contents?.value?.toLowerCase() ?? "";
                return text.includes("count: number") && text.includes("message: string");
            },
            15000,
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(!/^any$/i.test(text.trim()), `hover for this should not be any, got ${value}`);
        assert.ok(
            text.includes("count: number"),
            `hover should expose typed state when hovering this access, got ${value}`,
        );
        assert.ok(!text.includes("alpinescope"), `hover should not expose synthetic scope names, got ${value}`);
    });

    test("hover on x-data getters uses getter-style typing", async () => {
        const doc = await openHtml(XDATA_GETTER_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("doubleCount()") + 1;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = value.contents?.value?.toLowerCase() ?? "";
                return text.includes("(getter) doublecount: number");
            },
            15000,
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(
            text.includes("(getter) doublecount: number"),
            `hover should render getter typing, got ${value}`,
        );
        assert.ok(!text.includes("unknown"), `getter hover should not be unknown, got ${value}`);
    });

    test("hover on x-data method usages uses method-style typing", async () => {
        const doc = await openHtml(XDATA_METHOD_HOVER_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().lastIndexOf("reset");
        const position = doc.positionAt(valueIdx + 1);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = value.contents?.value?.toLowerCase() ?? "";
                return text.includes("(method) reset(");
            },
            15000,
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(
            text.includes("(method) reset("),
            `hover should render method-style typing, got ${value}`,
        );
        assert.ok(!text.includes("function reset"), `hover should hide alias form, got ${value}`);
    });

    test("hover on x-data method declarations respects JSDoc parameter types", async () => {
        const doc = await openHtml(XDATA_JSDOC_METHOD_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("updateMessage(newMessage)") + 1;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = value.contents?.value?.toLowerCase() ?? "";
                return text.includes("(method) updatemessage(newmessage: string): void");
            },
            15000,
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(
            text.includes("(method) updatemessage(newmessage: string): void"),
            `hover should preserve JSDoc parameter types, got ${value}`,
        );
        assert.ok(!text.includes("newmessage: any"), `hover should not fall back to any, got ${value}`);
    });

    test("hover on x-data getter declarations respects JSDoc return types", async () => {
        const doc = await openHtml(XDATA_JSDOC_GETTER_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("count()") + 1;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = value.contents?.value?.toLowerCase() ?? "";
                return text.includes("(getter) count: number");
            },
            15000,
        );
        const value = response.contents?.value ?? "";
        const text = value.toLowerCase();
        assert.ok(
            text.includes("(getter) count: number"),
            `hover should preserve JSDoc getter return type, got ${value}`,
        );
        assert.ok(!text.includes("(getter) count: any"), `getter hover should not fall back to any, got ${value}`);
    });

    test("editor hover provider resolves Math.abs inside x-data methods", async () => {
        const doc = await openHtml(XDATA_MATH_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("abs(");
        const position = doc.positionAt(valueIdx + 1);
        const hovers = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderHover[]>(
                    "vscode.executeHoverProvider",
                    doc.uri,
                    position,
                )) ?? [],
            (value) => flattenHoverTexts(value).some((text) => {
                const lower = text.toLowerCase();
                return lower.includes("math.abs") && lower.includes("absolute value");
            }),
            15000,
        );
        const texts = flattenHoverTexts(hovers);
        assert.ok(
            texts.some((text) => {
                const lower = text.toLowerCase();
                return lower.includes("math.abs") && lower.includes("absolute value");
            }),
            `expected executeHoverProvider to include Math.abs docs, got ${texts.join(" || ")}`,
        );
    });

    test("editor hover provider does not append a low-signal any hover for Alpine magics", async () => {
        const doc = await openHtml(MAGIC_HOVER_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("$el");
        const position = doc.positionAt(valueIdx + 1);
        const hovers = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<ProviderHover[]>(
                    "vscode.executeHoverProvider",
                    doc.uri,
                    position,
                )) ?? [],
            (value) => flattenHoverTexts(value).some((text) => {
                const lower = text.toLowerCase();
                return lower.includes("$el") && lower.includes("htmlelement");
            }),
            15000,
        );
        const texts = flattenHoverTexts(hovers);
        assert.ok(
            texts.some((text) => {
                const lower = text.toLowerCase();
                return lower.includes("$el") && lower.includes("htmlelement");
            }),
            `expected executeHoverProvider to include $el docs, got ${texts.join(" || ")}`,
        );
        assert.ok(
            !texts.some((text) => text.trim().toLowerCase() === "any"),
            `did not expect executeHoverProvider to append a bare any hover, got ${texts.join(" || ")}`,
        );
    });

    test("definition provider resolves x-data state back to its declaration", async () => {
        const doc = await openHtml(XDATA_DEFINITION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().lastIndexOf('x-text="count') + 'x-text="'.length + 1;
        const position = doc.positionAt(valueIdx);
        const definitions = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<DefinitionResult[]>(
                    "vscode.executeDefinitionProvider",
                    doc.uri,
                    position,
                )) ?? [],
            (value) => normalizeDefinitionTargets(value).length > 0,
            15000,
        );
        const targets = normalizeDefinitionTargets(definitions);
        const local = targets.find((target) => target.uri.toString() === doc.uri.toString());
        assert.ok(local, `expected local definition, got ${targets.map((t) => t.uri.toString()).join(", ")}`);
        const text = doc.getText(local.range);
        assert.strictEqual(text, "count");
    });

    test("definition provider resolves console.log to bundled TypeScript libs", async () => {
        const doc = await openHtml(XDATA_CONSOLE_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf("log(") + 1;
        const position = doc.positionAt(valueIdx);
        const definitions = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<DefinitionResult[]>(
                    "vscode.executeDefinitionProvider",
                    doc.uri,
                    position,
                )) ?? [],
            (value) =>
                normalizeDefinitionTargets(value).some((target) =>
                    target.uri.fsPath.endsWith("lib.dom.d.ts"),
                ),
            15000,
        );
        const targets = normalizeDefinitionTargets(definitions);
        const external = targets.find((target) => target.uri.fsPath.endsWith("lib.dom.d.ts"));
        assert.ok(
            external,
            `expected lib.dom.d.ts definition, got ${targets.map((t) => t.uri.fsPath).join(", ")}`,
        );
        const targetDoc = await vscode.workspace.openTextDocument(external.uri);
        const targetText = targetDoc.getText(external.range);
        assert.ok(
            /log/i.test(targetText),
            `expected log definition text, got ${targetText || "<empty>"}`,
        );
    });

    test("definition provider resolves x-data methods for handler references with and without parentheses", async () => {
        const doc = await openHtml(XDATA_METHOD_DEFINITION_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        for (const marker of ['x-on:click="reset"', 'x-on:click="reset()"']) {
            const valueIdx = doc.getText().indexOf(marker) + 'x-on:click="'.length + 1;
            const position = doc.positionAt(valueIdx);
            const definitions = await waitForValue(
                async () =>
                    (await vscode.commands.executeCommand<DefinitionResult[]>(
                        "vscode.executeDefinitionProvider",
                        doc.uri,
                        position,
                    )) ?? [],
                (value) => normalizeDefinitionTargets(value).length > 0,
                15000,
            );
            const targets = normalizeDefinitionTargets(definitions);
            const local = targets.find((target) => target.uri.toString() === doc.uri.toString());
            assert.ok(local, `expected local method definition for ${marker}, got ${targets.map((t) => t.uri.toString()).join(", ")}`);
            const text = doc.getText(local.range);
            assert.strictEqual(text, "reset");
        }
    });

    test("inline x-data with JSDoc and bare handler refs does not emit bogus diagnostics", async () => {
        const doc = await openHtml(INLINE_XDATA_DIAGNOSTIC_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        await wait(1500);
        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const alpineDiagnostics = diagnostics.filter((diag) => diag.source === "Alpine");
        assert.ok(
            !alpineDiagnostics.some((diag) => String(diag.code) === "7006"),
            `did not expect implicit-any diagnostics, got ${alpineDiagnostics.map((d) => `${d.code}:${d.message}`).join(" | ")}`,
        );
        assert.ok(
            !alpineDiagnostics.some((diag) => String(diag.code) === "2554"),
            `did not expect bare-handler argument diagnostics, got ${alpineDiagnostics.map((d) => `${d.code}:${d.message}`).join(" | ")}`,
        );
        assert.ok(
            !alpineDiagnostics.some((diag) => diag.message.includes("store")),
            `did not expect synthetic x-model store diagnostics, got ${alpineDiagnostics.map((d) => `${d.code}:${d.message}`).join(" | ")}`,
        );
    });

    test("completion inside Alpine.data-backed x-data resolves registered members", async () => {
        const doc = await openHtml(EXTERNAL_COMPONENT_SOURCES_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-on:click="updateM') + 'x-on:click="updateM'.length;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<CompletionResponse>(
                    COMMAND_COMPLETION,
                    doc.uri,
                    position,
                )) ?? { items: [] },
            (value) => (value.items ?? []).some((item) => item.label === "updateMessage"),
            15000,
        );
        const item = response.items.find((entry) => entry.label === "updateMessage");
        assert.ok(item, "expected updateMessage completion item");
        assert.ok(
            (item.detail ?? "").toLowerCase().includes("string"),
            `expected JSDoc-backed detail for updateMessage, got ${item.detail ?? "<empty>"}`,
        );
    });

    test("hover inside Alpine.data-backed x-data uses source getter docs", async () => {
        const doc = await openHtml(EXTERNAL_COMPONENT_SOURCES_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().indexOf('x-text="message') + 'x-text="'.length + 1;
        const position = doc.positionAt(valueIdx);
        const response = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<HoverResponse>(
                    COMMAND_HOVER,
                    doc.uri,
                    position,
                )) ?? { contents: null },
            (value) => {
                const text = value.contents?.value?.toLowerCase() ?? "";
                return text.includes("(getter) message: string");
            },
            15000,
        );
        const value = response.contents?.value ?? "";
        assert.ok(
            value.toLowerCase().includes("(getter) message: string"),
            `expected source-backed getter hover, got ${value}`,
        );
    });

    test("definition provider resolves function-backed x-data methods to the script source", async () => {
        const doc = await openHtml(EXTERNAL_COMPONENT_SOURCES_CASE);
        const ready = await waitForServerReady();
        assert.ok(ready, "language server should be ready");

        const valueIdx = doc.getText().lastIndexOf("reset()") + 1;
        const position = doc.positionAt(valueIdx);
        const definitions = await waitForValue(
            async () =>
                (await vscode.commands.executeCommand<DefinitionResult[]>(
                    "vscode.executeDefinitionProvider",
                    doc.uri,
                    position,
                )) ?? [],
            (value) => normalizeDefinitionTargets(value).length > 0,
            15000,
        );
        const targets = normalizeDefinitionTargets(definitions);
        const local = targets.find((target) => target.uri.toString() === doc.uri.toString());
        assert.ok(
            local,
            `expected local function-backed method definition, got ${targets.map((t) => t.uri.toString()).join(", ")}`,
        );
        const text = doc.getText(local.range);
        assert.strictEqual(text, "reset");
    });
});

function flattenHoverTexts(hovers: ProviderHover[]): string[] {
    const out: string[] = [];
    for (const hover of hovers) {
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
        for (const content of contents) {
            if (typeof content === "string") {
                out.push(content);
                continue;
            }
            if ("value" in content && typeof content.value === "string") {
                out.push(content.value);
                continue;
            }
            if ("language" in content && typeof content.value === "string") {
                out.push(content.value);
            }
        }
    }
    return out;
}

function completionLabels(items: Array<{ label: string | { label: string } }>): string[] {
    return items.map((item) => (typeof item.label === "string" ? item.label : item.label.label));
}

function expectLocalPriority(labels: string[], primary: string, companionNames: string[]): void {
    const primaryIndex = labels.indexOf(primary);
    assert.ok(primaryIndex >= 0, `expected ${primary} completion, got ${labels.slice(0, 20).join(", ")}`);
    assert.ok(primaryIndex < 5, `expected ${primary} near top, got index ${primaryIndex}`);
    for (const name of companionNames) {
        const idx = labels.indexOf(name);
        assert.ok(idx >= 0, `expected ${name} completion, got ${labels.slice(0, 20).join(", ")}`);
        assert.ok(idx < 10, `expected ${name} near top, got index ${idx}`);
    }
}

function normalizeDefinitionTargets(
    definitions: DefinitionResult[],
): Array<{ uri: vscode.Uri; range: vscode.Range }> {
    return definitions
        .map((item) =>
            "targetUri" in item
                ? {
                      uri: item.targetUri,
                      range: item.targetSelectionRange ?? item.targetRange,
                  }
                : {
                      uri: item.uri,
                      range: item.range,
                  },
        )
        .filter((item): item is { uri: vscode.Uri; range: vscode.Range } => Boolean(item.range));
}
