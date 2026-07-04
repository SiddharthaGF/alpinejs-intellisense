import * as assert from "assert";
import {
    isInsideAlpineDirectiveValue,
    shouldAutoTriggerSuggest,
} from "../autoSuggest.js";

const COMPLEX_CASE = [
    "<div",
    '    x-data="{',
    "        count: 0,",
    "        message: 'Hola Mundo',",
    "        syncMessage() {",
    "            return message + count;",
    "        }",
    '    }"',
    ">",
    '    <span x-text="mess"></span>',
    '    <input x-model="mess">',
    '    <button x-on:click="syn"></button>',
    "</div>",
].join("\n");

suite("Auto suggest helper", () => {
    test("detects offsets inside Alpine directive values", () => {
        const offset = COMPLEX_CASE.indexOf('x-text="mess') + 'x-text="mess'.length;
        assert.strictEqual(
            isInsideAlpineDirectiveValue(COMPLEX_CASE, "html", "file:///sample.html", offset),
            true,
        );
    });

    test("does not detect offsets outside Alpine directive values", () => {
        const offset = COMPLEX_CASE.indexOf("<div") + 2;
        assert.strictEqual(
            isInsideAlpineDirectiveValue(COMPLEX_CASE, "html", "file:///sample.html", offset),
            false,
        );
    });

    test("auto triggers on identifier input inside Alpine directive values", () => {
        const cursorOffset = COMPLEX_CASE.indexOf('x-model="mess') + 'x-model="mess'.length;
        assert.strictEqual(
            shouldAutoTriggerSuggest({
                sourceText: COMPLEX_CASE,
                languageId: "html",
                uri: "file:///sample.html",
                insertedText: "s",
                rangeLength: 0,
                cursorOffset,
            }),
            true,
        );
    });

    test("does not auto trigger on non-identifier input", () => {
        const cursorOffset = COMPLEX_CASE.indexOf('x-on:click="syn') + 'x-on:click="syn'.length;
        assert.strictEqual(
            shouldAutoTriggerSuggest({
                sourceText: COMPLEX_CASE,
                languageId: "html",
                uri: "file:///sample.html",
                insertedText: " ",
                rangeLength: 0,
                cursorOffset,
            }),
            false,
        );
    });

    test("supports Blade documents through the URI", () => {
        const cursorOffset = COMPLEX_CASE.indexOf('x-on:click="syn') + 'x-on:click="syn'.length;
        assert.strictEqual(
            shouldAutoTriggerSuggest({
                sourceText: COMPLEX_CASE,
                languageId: "plaintext",
                uri: "file:///resources/views/example.blade.php",
                insertedText: "c",
                rangeLength: 0,
                cursorOffset,
            }),
            true,
        );
    });
});
