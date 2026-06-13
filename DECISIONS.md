# Decisions

## Sequence Ordering and Deduplication

**Data structure:** `SequenceBuffer` uses three fields:

| Field | Type | Purpose |
|---|---|---|
| `pendingEvents` | `Map<number, ServerMessage>` | Out-of-order events waiting for a gap to close |
| `processedEvents` | `Set<number>` | All seq values already committed to state |
| `expectedSequence` | `number` | The next seq value we are ready to consume |

When a message arrives, the buffer checks three cases in order:

1. **Duplicate** — `processedEvents.has(seq)` or `pendingEvents.has(seq)` → dropped, counter incremented.
2. **Future** — `seq > expectedSequence` → stored in `pendingEvents`, nothing emitted.
3. **Exact match** — `seq === expectedSequence` → processed immediately, then `drainPending` walks the map upward consuming any now-contiguous events.

`Map` was chosen over a sorted array because random-access lookup and insertion are O(1) and the drain walk is simply `while (map.has(n))`, giving O(k) drain for k contiguous pending events. A sorted array would require O(k log k) insertion and either binary search or a pointer, for no correctness benefit.

`RESUME.last_seq` uses `metrics.lastProcessedSeq` (the highest seq that has been committed to React state and rendered to the DOM) rather than `metrics.lastReceivedSeq` (the highest frame received by the socket). This distinction matters: a message received by the socket but not yet processed by React would not be in the DOM, so replaying from it is correct. Sending the higher `lastReceivedSeq` could cause the server to skip events the client never actually rendered.

## Layout Stability During Tool Call Interruptions

When a `TOOL_CALL` event arrives, the event processor:

1. Freezes the current `StreamState.text` in-place — no modification, no re-render of the text node.
2. Appends the `call_id` to `stream.toolCallIds`, which causes a new `<div>` (the tool card) to appear **below** the frozen text, not replacing it.
3. The tool card is keyed by `call_id`, so React never unmounts-then-remounts it when `TOOL_RESULT` arrives — it only updates the existing node's content.

This prevents reflow because the text container's dimensions do not change. No CSS tricks are needed — the architecture guarantees no parent layout shift because the stream text and tool card occupy separate, stable DOM nodes.

Token groups (`TOKEN_GROUP` timeline entries) further prevent timeline jank: instead of pushing one `TimelineEntry` per token (30+ per second), consecutive tokens accumulate in `activeTokenGroup` on state and only produce a single timeline entry when a non-TOKEN event arrives or the stream ends. React therefore performs at most one reconciliation per protocol boundary rather than one per token.

## Reconnection State Recovery

On disconnect:
- `onclose` checks `socketRef.current !== socket` to guard against stale close events from replaced sockets (React StrictMode or manual reconnect replacing a socket before the old one closes).
- `closedByUserRef.current` prevents reconnect loops on intentional close.
- Exponential backoff: `[500, 1000, 2000, 4000, 10000]ms`.

On reconnect (`socket.onopen`):
- The first message sent is `RESUME { last_seq: metrics.lastProcessedSeq }`.
- The `SequenceBuffer` retains its full state across the disconnect (it is not reset). `processedEvents` still contains all previously processed seqs, so any replayed event the client already rendered is silently deduplicated without reaching the event processor.
- If the connection dropped mid-tool-call (after `TOOL_CALL`, before `TOOL_RESULT`), the `ToolCallState` remains `status: "waiting"` in `toolCalls` Map. When the replayed `TOOL_RESULT` arrives it finds the existing card by `call_id` and updates it in-place — no duplication, no visual jump.

**What the DOM has "consumed" vs what the socket has "received":** `lastRenderedSeq` tracks the highest seq that passed through `processServerEvent` and was committed to React state (and thus rendered). `lastReceivedSeq` tracks the highest seq received by the WebSocket handler. The gap between them is the in-flight buffered range. `RESUME` sends `lastRenderedSeq` (aliased as `lastProcessedSeq`), ensuring the server replays anything not yet in the DOM.

## Identified Protocol Race Condition

The assignment specifically introduces a race in the `TOOL_ACK` → `TOOL_RESULT` sequence:

1. Client sends `USER_MESSAGE`.
2. Server sends `TOOL_CALL`.
3. Client renders the card and sends `TOOL_ACK`.
4. Connection drops before `TOOL_RESULT` arrives.
5. Client reconnects, sends `RESUME last_seq=N` where `N` is the seq of the `TOOL_CALL`.
6. Server replays `TOOL_RESULT` (and any buffered `TOOL_ACK_TIMEOUT` log entry).
7. Client must update the **existing** card, not create a new one.

The fix is that `processServerEvent` for `TOOL_RESULT` does `toolCalls.get(call_id)` and updates the existing entry rather than inserting a new one. If the `call_id` is not found (edge case where `TOOL_CALL` itself was also lost), a new entry is created. This is idempotent by construction.

A second, less obvious race: `TOOL_RESULT seq=20` can arrive before `TOOL_CALL seq=19` in chaos mode. The `SequenceBuffer` holds seq=20 in `pendingEvents` until seq=19 arrives and is processed, at which point the drain walk emits both in order. `processServerEvent` therefore always sees `TOOL_CALL` before `TOOL_RESULT` for a given `call_id`.

## Scaling to 50 Concurrent Agent Streams (Operations Dashboard)

Current bottlenecks and their fixes:

| Bottleneck | Fix |
|---|---|
| Single `AppState` holds all streams — one update re-renders all panels | Normalize to `Map<streamId, StreamState>` slices; use separate React contexts or Zustand slices per stream so only the affected stream re-renders |
| Timeline grows linearly with all events from all streams | Per-stream timeline windows (last N events) with a global merged view virtualized using `react-virtual` or `@tanstack/virtual` |
| Single `SequenceBuffer` with a global `expectedSequence` | Per-stream buffers keyed by `stream_id`; global seq ordering only for protocol-level dedup |
| Single WebSocket connection | WebSocket connection pool (one per agent session); a `ConnectionManager` singleton dispatches incoming frames to the correct stream buffer by `stream_id` |
| `cloneState` copies all Maps on every event | Switch to Immer or per-stream atom model (Jotai/Zustand) to produce structural sharing |

The protocol engine (parser, sequence buffer, journal) is already stream-agnostic and can be shared without modification — it does not assume a single active stream.

## Scaling to 100× Longer Responses (Document Generation)

| Problem | Fix |
|---|---|
| `StreamState.text` grows to megabytes; React re-renders the whole string on every token | Store text as `string[]` segments; render each segment as a separate `<span>` keyed by segment index. React only diffs the last element, not the full string. |
| Timeline accumulates thousands of `TOKEN_GROUP` entries | After `STREAM_END`, compact all `TOKEN_GROUP` entries for that stream into a single "Streamed N tokens total" journal summary. The `EventJournal.compactTokens` method already supports this. |
| `CONTEXT_SNAPSHOT` history grows unbounded per `context_id` | Apply a retention limit per `context_id` (e.g. last 50 snapshots) and evict oldest on overflow. The scrubber UI already supports arbitrary-length history. |
| `<LazyJsonTree>` renders the full object tree root on mount | Add intersection-observer–based deferred expansion: children of a collapsed node are not mounted until the node is opened. Combine with `MAX_INITIAL_DEPTH = 1` for deep objects. |
| `processedEvents: Set<number>` grows linearly with event count | Cap at last `N` seqs using a sliding window; all seqs older than `lastProcessedSeq - window` are guaranteed not to be replayed and can be pruned. |
