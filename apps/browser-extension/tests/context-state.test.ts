import { describe, expect, it } from "vitest";
import { resolveSelectionText } from "../src/contextState";

describe("contextState helpers", () => {
  it("preserves the last non-empty selection when the page loses focus and reports an empty selection", () => {
    expect(
      resolveSelectionText({
        previousSelectionText: "Fresh selection",
        nextSelectionText: "",
        hasFocus: false,
      }),
    ).toBe("Fresh selection");
  });

  it("clears the selection when the page is still focused and reports an empty selection", () => {
    expect(
      resolveSelectionText({
        previousSelectionText: "Fresh selection",
        nextSelectionText: "",
        hasFocus: true,
      }),
    ).toBe("");
  });
});
