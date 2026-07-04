import { describe, expect, it } from "vitest";
import { LANGUAGE_CORE_VERSION } from "./index.js";

describe("language-core", () => {
    it("exposes a version constant", () => {
        expect(typeof LANGUAGE_CORE_VERSION).toBe("string");
        expect(LANGUAGE_CORE_VERSION.length).toBeGreaterThan(0);
    });
});
