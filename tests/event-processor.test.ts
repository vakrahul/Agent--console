import { describe, expect, it } from "vitest";
import { processServerEvent, flushActiveTokenGroup } from "@/events/event-processor";
import { createInitialAppState } from "@/state/types";

// ── Helpers ─────────────────────────────────────────────────

function makeState() {
  return createInitialAppState();
}

// ── Token deduplication ─────────────────────────────────────

describe("event processor: token idempotency", () => {
  it("does not duplicate token text for the same seq", () => {
    let state = makeState();
    const event = { type: "TOKEN", seq: 1, stream_id: "s1", text: "hello " } as const;
    state = processServerEvent(state, event);
    state = processServerEvent(state, event);
    expect(state.streams.get("s1")?.text).toBe("hello ");
  });

  it("accumulates consecutive tokens from the same stream into one group", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOKEN", seq: 1, stream_id: "s1", text: "hello " });
    state = processServerEvent(state, { type: "TOKEN", seq: 2, stream_id: "s1", text: "world" });
    // Timeline still has NO finalized entry (group not yet flushed)
    expect(state.timeline.filter((e) => e.type === "TOKEN_GROUP")).toHaveLength(0);
    expect(state.activeTokenGroup?.tokenCount).toBe(2);
    expect(state.activeTokenGroup?.fullText).toBe("hello world");
  });

  it("flushes the token group when a non-TOKEN event arrives", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOKEN", seq: 1, stream_id: "s1", text: "hi " });
    state = processServerEvent(state, { type: "TOKEN", seq: 2, stream_id: "s1", text: "there" });
    state = processServerEvent(state, { type: "STREAM_END", seq: 3, stream_id: "s1" });
    const groups = state.timeline.filter((e) => e.type === "TOKEN_GROUP");
    expect(groups).toHaveLength(1);
    expect(groups[0].kind === "token_group" && groups[0].tokenCount).toBe(2);
    expect(groups[0].kind === "token_group" && groups[0].fullText).toBe("hi there");
    expect(state.activeTokenGroup).toBeNull();
  });

  it("starts a new group when stream_id changes mid-stream", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOKEN", seq: 1, stream_id: "s1", text: "a" });
    state = processServerEvent(state, { type: "TOKEN", seq: 2, stream_id: "s2", text: "b" });
    // s1 group was flushed when s2 token arrived
    const groups = state.timeline.filter((e) => e.type === "TOKEN_GROUP");
    expect(groups).toHaveLength(1);
    expect(groups[0].kind === "token_group" && groups[0].streamId).toBe("s1");
    // s2 group is still accumulating
    expect(state.activeTokenGroup?.streamId).toBe("s2");
  });

  it("flushActiveTokenGroup finalises the group without a new event", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOKEN", seq: 1, stream_id: "s1", text: "partial" });
    state = flushActiveTokenGroup(state);
    expect(state.activeTokenGroup).toBeNull();
    const groups = state.timeline.filter((e) => e.type === "TOKEN_GROUP");
    expect(groups).toHaveLength(1);
  });
});

// ── Tool call lifecycle ─────────────────────────────────────

describe("event processor: tool call idempotency", () => {
  it("updates an existing tool card for TOOL_RESULT", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOOL_CALL", seq: 1, stream_id: "s1", call_id: "c1", tool_name: "lookup", args: { q: "revenue" } });
    state = processServerEvent(state, { type: "TOOL_RESULT", seq: 2, stream_id: "s1", call_id: "c1", result: { value: "23%" } });
    expect(state.toolCalls.size).toBe(1);
    expect(state.toolCalls.get("c1")?.status).toBe("complete");
  });

  it("does not create a duplicate tool card on replayed TOOL_CALL", () => {
    let state = makeState();
    const tc = { type: "TOOL_CALL", seq: 1, stream_id: "s1", call_id: "c1", tool_name: "lookup", args: {} } as const;
    state = processServerEvent(state, tc);
    state = processServerEvent(state, tc); // replayed
    expect(state.toolCalls.size).toBe(1);
  });

  it("handles two sequential tool calls without overwriting", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOOL_CALL", seq: 1, stream_id: "s1", call_id: "c1", tool_name: "t1", args: {} });
    state = processServerEvent(state, { type: "TOOL_RESULT", seq: 2, stream_id: "s1", call_id: "c1", result: { a: 1 } });
    state = processServerEvent(state, { type: "TOOL_CALL", seq: 3, stream_id: "s1", call_id: "c2", tool_name: "t2", args: {} });
    state = processServerEvent(state, { type: "TOOL_RESULT", seq: 4, stream_id: "s1", call_id: "c2", result: { b: 2 } });
    expect(state.toolCalls.size).toBe(2);
    expect(state.toolCalls.get("c1")?.status).toBe("complete");
    expect(state.toolCalls.get("c2")?.status).toBe("complete");
    expect(state.toolCalls.get("c1")?.result).toEqual({ a: 1 });
    expect(state.toolCalls.get("c2")?.result).toEqual({ b: 2 });
  });
});

// ── Stream lifecycle ────────────────────────────────────────

describe("event processor: stream lifecycle", () => {
  it("STREAM_END sets stream status to complete", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOKEN", seq: 1, stream_id: "s1", text: "hello" });
    state = processServerEvent(state, { type: "STREAM_END", seq: 2, stream_id: "s1" });
    expect(state.streams.get("s1")?.status).toBe("complete");
    expect(state.connectionState).toBe("CONNECTED");
  });

  it("waiting_tool status is set on TOOL_CALL and cleared on TOOL_RESULT", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "TOOL_CALL", seq: 1, stream_id: "s1", call_id: "c1", tool_name: "t", args: {} });
    expect(state.streams.get("s1")?.status).toBe("waiting_tool");
    state = processServerEvent(state, { type: "TOOL_RESULT", seq: 2, stream_id: "s1", call_id: "c1", result: {} });
    expect(state.streams.get("s1")?.status).toBe("streaming");
  });
});

// ── Context snapshot ────────────────────────────────────────

describe("event processor: context snapshot deduplication", () => {
  it("does not duplicate a snapshot with the same seq", () => {
    let state = makeState();
    const snap = { type: "CONTEXT_SNAPSHOT", seq: 1, context_id: "ctx1", data: { x: 1 } } as const;
    state = processServerEvent(state, snap);
    state = processServerEvent(state, snap);
    expect(state.contexts.get("ctx1")?.length).toBe(1);
  });

  it("appends a new snapshot with a different seq", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "CONTEXT_SNAPSHOT", seq: 1, context_id: "ctx1", data: { x: 1 } });
    state = processServerEvent(state, { type: "CONTEXT_SNAPSHOT", seq: 5, context_id: "ctx1", data: { x: 2 } });
    expect(state.contexts.get("ctx1")?.length).toBe(2);
  });

  it("resets contextHistoryIndex to -1 when a new snapshot arrives", () => {
    let state = makeState();
    state = processServerEvent(state, { type: "CONTEXT_SNAPSHOT", seq: 1, context_id: "ctx1", data: { x: 1 } });
    state = { ...state, contextHistoryIndex: 0 }; // simulate user scrubbing
    state = processServerEvent(state, { type: "CONTEXT_SNAPSHOT", seq: 2, context_id: "ctx1", data: { x: 2 } });
    expect(state.contextHistoryIndex).toBe(-1);
  });
});

// ── Corrupt PING ────────────────────────────────────────────

describe("event processor: corrupt PING (empty challenge)", () => {
  it("handles an empty challenge without throwing", () => {
    let state = makeState();
    // Empty challenge is valid from the parser perspective (isString("") = true)
    expect(() => {
      state = processServerEvent(state, { type: "PING", seq: 1, challenge: "" });
    }).not.toThrow();
    expect(state.metrics.lastHeartbeat).toBeGreaterThan(0);
  });
});
