import { describe, expect, it } from "vitest";
import { SequenceBuffer } from "@/events/sequence-buffer";

describe("chaos: out-of-order tool result", () => {
  it("buffers TOOL_RESULT seq 20 until TOOL_CALL seq 19 is processed", () => {
    const buffer = new SequenceBuffer(19);
    const result = buffer.accept({ type: "TOOL_RESULT", seq: 20, call_id: "c1", result: { ok: true }, stream_id: "s1" });
    expect(result.processable).toEqual([]);

    const drained = buffer.accept({ type: "TOOL_CALL", seq: 19, call_id: "c1", tool_name: "lookup", args: {}, stream_id: "s1" });
    expect(drained.processable.map((event) => event.type)).toEqual(["TOOL_CALL", "TOOL_RESULT"]);
  });
});
