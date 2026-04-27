import { describe, expect, it } from "vitest";
import { getComposerTextareaSize } from "../src/composerAutosize";

describe("getComposerTextareaSize", () => {
  it("keeps the textarea at least one line tall", () => {
    expect(
      getComposerTextareaSize({
        lineHeight: 20,
        verticalInset: 12,
        scrollHeight: 10,
      }),
    ).toEqual({
      height: 32,
      overflowY: "hidden",
    });
  });

  it("caps the textarea at the configured line count", () => {
    expect(
      getComposerTextareaSize({
        lineHeight: 18,
        verticalInset: 10,
        scrollHeight: 260,
        maxLines: 4,
      }),
    ).toEqual({
      height: 82,
      overflowY: "auto",
    });
  });
});
