import { describe, expect, it } from "vitest";
import { readFileAsDataUrl } from "../src/ui/sidepanel/fileDataUrl";

describe("readFileAsDataUrl", () => {
  it("reads uploaded files as data URLs", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await expect(readFileAsDataUrl(file)).resolves.toBe("data:text/plain;base64,aGVsbG8=");
  });
});
