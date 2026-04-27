import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../src/index.js";

describe("getErrorMessage", () => {
  it("uses Error.message when available", () => {
    expect(getErrorMessage(new Error("Boom"))).toBe("Boom");
  });

  it("stringifies non-Error values", () => {
    expect(getErrorMessage("plain failure")).toBe("plain failure");
    expect(getErrorMessage(404)).toBe("404");
  });
});
