import { describe, expect, it } from "vitest";
import { SequenceBuffer } from "@/events/sequence-buffer";
import type { ServerMessage } from "@/protocol/types";

function token(seq: number): ServerMessage {
  return { type: "TOKEN", seq, stream_id: "s1", text: String(seq) };
}

describe("SequenceBuffer", () => {
  // ── Basic ordering ──────────────────────────────────────────

  it("processes in-order events", () => {
    const buffer = new SequenceBuffer();
    expect(buffer.accept(token(1)).processable.map((e) => e.seq)).toEqual([1]);
    expect(buffer.accept(token(2)).processable.map((e) => e.seq)).toEqual([2]);
  });

  it("buffers a future event and drains after the gap arrives", () => {
    const buffer = new SequenceBuffer();
    expect(buffer.accept(token(3)).processable).toEqual([]);
    expect(buffer.accept(token(1)).processable.map((e) => e.seq)).toEqual([1]);
    expect(buffer.accept(token(2)).processable.map((e) => e.seq)).toEqual([2, 3]);
  });

  // ── Deduplication ───────────────────────────────────────────

  it("deduplicates a pending event", () => {
    const buffer = new SequenceBuffer();
    buffer.accept(token(2));
    expect(buffer.accept(token(2)).duplicates.map((e) => e.seq)).toEqual([2]);
  });

  it("deduplicates an already-processed event", () => {
    const buffer = new SequenceBuffer();
    buffer.accept(token(1));
    expect(buffer.accept(token(1)).duplicates.map((e) => e.seq)).toEqual([1]);
  });

  it("deduplicates both pending and already-processed events independently", () => {
    const buffer = new SequenceBuffer();
    buffer.accept(token(2)); // pending
    buffer.accept(token(1)); // processes 1 and drains 2
    expect(buffer.accept(token(1)).duplicates.map((e) => e.seq)).toEqual([1]);
    expect(buffer.accept(token(2)).duplicates.map((e) => e.seq)).toEqual([2]);
  });

  // ── Edge cases ──────────────────────────────────────────────

  it("handles a single event correctly", () => {
    const buffer = new SequenceBuffer();
    const result = buffer.accept(token(1));
    expect(result.processable).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);
    expect(result.buffered).toHaveLength(0);
  });

  it("handles a single future event (seq=5 when expecting seq=1)", () => {
    const buffer = new SequenceBuffer();
    const result = buffer.accept(token(5));
    expect(result.processable).toHaveLength(0);
    expect(result.buffered).toHaveLength(1);
  });

  it("drains a fully-reversed sequence [5,4,3,2,1] correctly", () => {
    const buffer = new SequenceBuffer();
    // All arrive out of order, all buffered except when gap closes.
    buffer.accept(token(5)); // buffered
    buffer.accept(token(4)); // buffered
    buffer.accept(token(3)); // buffered
    buffer.accept(token(2)); // buffered
    const last = buffer.accept(token(1)); // triggers full drain
    expect(last.processable.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drains a large gap in a single call", () => {
    const buffer = new SequenceBuffer();
    buffer.accept(token(10));
    buffer.accept(token(7));
    buffer.accept(token(8));
    buffer.accept(token(9));
    buffer.accept(token(6));
    buffer.accept(token(5));
    buffer.accept(token(4));
    buffer.accept(token(3));
    buffer.accept(token(2));
    const result = buffer.accept(token(1));
    expect(result.processable.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // ── resetAfterResume ────────────────────────────────────────

  it("resetAfterResume sets expectedSequence to lastProcessedSeq+1", () => {
    const buffer = new SequenceBuffer();
    buffer.accept(token(1));
    buffer.accept(token(2));
    buffer.accept(token(4)); // future, buffered
    // Simulate reconnect: server will replay from seq=3
    buffer.resetAfterResume(2);
    // seq=4 should still be in pending (not yet dropped); seq=3 triggers drain
    const result = buffer.accept(token(3));
    expect(result.processable.map((e) => e.seq)).toEqual([3, 4]);
  });

  it("resetAfterResume clears pending events at or before lastProcessedSeq", () => {
    const buffer = new SequenceBuffer();
    buffer.accept(token(3)); // future, buffered
    buffer.accept(token(1)); // processes 1
    buffer.resetAfterResume(5); // pretend server says last=5
    // pending seq=3 was <= 5, should be gone
    const result = buffer.accept(token(6));
    expect(result.processable.map((e) => e.seq)).toEqual([6]);
  });

  // ── Metrics ─────────────────────────────────────────────────

  it("reports correct metrics after mixed events", () => {
    const buffer = new SequenceBuffer();
    buffer.accept(token(3)); // buffered
    buffer.accept(token(2)); // buffered
    buffer.accept(token(1)); // processes 1, 2, 3
    buffer.accept(token(2)); // duplicate
    const metrics = buffer.getMetrics();
    expect(metrics.lastProcessedSeq).toBe(3);
    expect(metrics.duplicateCount).toBe(1);
    expect(metrics.bufferedCount).toBe(0);
  });

  it("empty buffer: draining nothing returns empty processable", () => {
    const buffer = new SequenceBuffer();
    const metrics = buffer.getMetrics();
    expect(metrics.lastProcessedSeq).toBe(0);
    expect(metrics.bufferedCount).toBe(0);
  });
});
