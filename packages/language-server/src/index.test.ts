import { describe, expect, it } from "vitest";
import { LANGUAGE_SERVER_VERSION } from "./index.js";

describe("language-server", () => {
    it("exposes a version constant", () => {
        expect(typeof LANGUAGE_SERVER_VERSION).toBe("string");
        expect(LANGUAGE_SERVER_VERSION.length).toBeGreaterThan(0);
    });
});
