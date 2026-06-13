import { describe, expect, it } from "vitest";
import { transitionConnection } from "@/realtime/state-machine";

describe("connection state machine", () => {
  it("models stream, tool wait, reconnect, and resume", () => {
    expect(transitionConnection("DISCONNECTED", "CONNECT")).toBe("CONNECTING");
    expect(transitionConnection("CONNECTING", "OPEN")).toBe("CONNECTED");
    expect(transitionConnection("CONNECTED", "USER_MESSAGE")).toBe("STREAMING");
    expect(transitionConnection("STREAMING", "TOOL_CALL")).toBe("WAITING_TOOL_RESULT");
    expect(transitionConnection("WAITING_TOOL_RESULT", "DROP")).toBe("RECONNECTING");
    expect(transitionConnection("RECONNECTING", "OPEN")).toBe("RESUMING");
    expect(transitionConnection("RESUMING", "RESUME_COMPLETE")).toBe("CONNECTED");
  });
});
