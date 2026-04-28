import { describe, expect, it } from "vitest";
import {
  getNextSessionSocketStatus,
  isSessionSocketUnavailable,
  shouldClearSessionSocketRef,
  shouldFlushPendingPermissions,
  shouldFlushPendingPrompt,
} from "../src/index.js";

describe("session socket state helpers", () => {
  it("detects unavailable sockets", () => {
    expect(isSessionSocketUnavailable(false, "open")).toBe(true);
    expect(isSessionSocketUnavailable(true, "idle")).toBe(true);
    expect(isSessionSocketUnavailable(true, "connecting")).toBe(true);
    expect(isSessionSocketUnavailable(true, "closed")).toBe(true);
    expect(isSessionSocketUnavailable(true, "error")).toBe(true);
    expect(isSessionSocketUnavailable(true, "open")).toBe(false);
  });

  it("maps websocket callbacks to socket status values", () => {
    expect(getNextSessionSocketStatus("idle", "open")).toBe("open");
    expect(getNextSessionSocketStatus("open", "close")).toBe("closed");
    expect(getNextSessionSocketStatus("open", "error")).toBe("error");
    expect(getNextSessionSocketStatus("open", "message")).toBe("open");
  });

  it("decides when socket refs and pending work should be flushed", () => {
    expect(shouldClearSessionSocketRef("close")).toBe(true);
    expect(shouldClearSessionSocketRef("error")).toBe(true);
    expect(shouldClearSessionSocketRef("open")).toBe(false);
    expect(shouldFlushPendingPrompt("open", "session-1", "session-1")).toBe(true);
    expect(shouldFlushPendingPrompt("open", "session-2", "session-1")).toBe(false);
    expect(shouldFlushPendingPermissions("open", 1)).toBe(true);
    expect(shouldFlushPendingPermissions("close", 1)).toBe(false);
    expect(shouldFlushPendingPermissions("open", 0)).toBe(false);
  });
});
