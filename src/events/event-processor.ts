import type { ClientMessage, ProtocolError, ServerMessage } from "@/protocol/types";
import type {
  ActiveTokenGroup,
  AppState,
  StreamState,
  TimelineEntry,
} from "@/state/types";

// ─────────────────────────────────────────────────────────────
// State cloning — shallow Maps/arrays so React sees new refs.
// ─────────────────────────────────────────────────────────────

function cloneState(state: AppState): AppState {
  return {
    ...state,
    streams: new Map(state.streams),
    toolCalls: new Map(state.toolCalls),
    contexts: new Map([...state.contexts].map(([key, value]) => [key, [...value]])),
    timeline: [...state.timeline],
    protocolErrors: [...state.protocolErrors],
    metrics: { ...state.metrics }
  };
}

// ─────────────────────────────────────────────────────────────
// Token group helpers
// ─────────────────────────────────────────────────────────────

/**
 * Flush the active token group into a finalized TOKEN_GROUP timeline entry.
 * Called when a non-TOKEN event arrives, or when the stream ends.
 */
function flushTokenGroup(state: AppState): void {
  const group = state.activeTokenGroup;
  if (!group) return;
  const entry: TimelineEntry = {
    kind: "token_group",
    id: group.id,
    seq: group.firstSeq,
    type: "TOKEN_GROUP",
    streamId: group.streamId,
    tokenCount: group.tokenCount,
    durationMs: Date.now() - group.startTime,
    fullText: group.fullText,
    startTime: group.startTime,
    timestamp: group.startTime,
    label: `Streamed ${group.tokenCount} token${group.tokenCount === 1 ? "" : "s"}`
  };
  state.timeline.push(entry);
  state.activeTokenGroup = null;
}

/**
 * Accumulate a TOKEN event into the active group (or start a new group).
 * Does NOT push to timeline — the group is only finalized on flush.
 */
function accumulateToken(state: AppState, event: Extract<ServerMessage, { type: "TOKEN" }>): void {
  if (state.activeTokenGroup && state.activeTokenGroup.streamId === event.stream_id) {
    state.activeTokenGroup.tokenCount += 1;
    state.activeTokenGroup.fullText += event.text;
    state.activeTokenGroup.lastSeq = event.seq;
  } else {
    // Different stream or no group — flush existing first
    if (state.activeTokenGroup) flushTokenGroup(state);
    state.activeTokenGroup = {
      id: `tg-${event.stream_id}-${event.seq}`,
      streamId: event.stream_id,
      firstSeq: event.seq,
      lastSeq: event.seq,
      startTime: Date.now(),
      tokenCount: 1,
      fullText: event.text
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Non-token timeline entry builder
// ─────────────────────────────────────────────────────────────

function eventTimelineEntry(event: Exclude<ServerMessage, { type: "TOKEN" }>): TimelineEntry {
  const base = {
    kind: "event" as const,
    id: `${event.type}-${event.seq}`,
    seq: event.seq,
    timestamp: Date.now()
  };
  switch (event.type) {
    case "TOOL_CALL":
      return { ...base, type: event.type, label: `${event.tool_name}(${event.call_id})`, streamId: event.stream_id, callId: event.call_id };
    case "TOOL_RESULT":
      return { ...base, type: event.type, label: `Result ${event.call_id}`, streamId: event.stream_id, callId: event.call_id };
    case "CONTEXT_SNAPSHOT":
      return { ...base, type: event.type, label: `Context ${event.context_id}`, contextId: event.context_id };
    case "PING":
      return { ...base, type: event.type, label: `PING ${event.challenge || "(empty)"}` };
    case "STREAM_END":
      return { ...base, type: event.type, label: `Stream ended ${event.stream_id}`, streamId: event.stream_id };
    case "ERROR":
      return { ...base, type: event.type, label: `${event.code}: ${event.message}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Stream helpers
// ─────────────────────────────────────────────────────────────

function ensureStream(state: AppState, streamId: string): StreamState {
  const existing = state.streams.get(streamId);
  if (existing) return { ...existing, tokenSeqs: new Set(existing.tokenSeqs), toolCallIds: [...existing.toolCallIds] };
  return { streamId, tokenSeqs: new Set(), text: "", toolCallIds: [], status: "streaming", lastSeq: 0 };
}

// ─────────────────────────────────────────────────────────────
// Main event processor — pure function, returns new state.
// ─────────────────────────────────────────────────────────────

export function processServerEvent(state: AppState, event: ServerMessage): AppState {
  const next = cloneState(state);
  next.metrics.lastProcessedSeq = Math.max(next.metrics.lastProcessedSeq, event.seq);
  next.metrics.lastRenderedSeq = Math.max(next.metrics.lastRenderedSeq, event.seq);
  next.metrics.lastAcknowledgedSeq = Math.max(next.metrics.lastAcknowledgedSeq, event.seq);

  switch (event.type) {
    case "TOKEN": {
      const stream = ensureStream(next, event.stream_id);
      if (!stream.tokenSeqs.has(event.seq)) {
        stream.tokenSeqs.add(event.seq);
        stream.text += event.text;
        stream.lastSeq = event.seq;
        stream.status = "streaming";
      }
      next.streams.set(event.stream_id, stream);
      next.connectionState = "STREAMING";
      // Accumulate into active token group (no timeline push yet).
      accumulateToken(next, event);
      break;
    }

    case "TOOL_CALL": {
      // Non-TOKEN: flush any in-progress token group first.
      flushTokenGroup(next);
      const stream = ensureStream(next, event.stream_id);
      stream.status = "waiting_tool";
      stream.lastSeq = event.seq;
      if (!stream.toolCallIds.includes(event.call_id)) stream.toolCallIds.push(event.call_id);
      next.streams.set(event.stream_id, stream);
      if (!next.toolCalls.has(event.call_id)) {
        next.toolCalls.set(event.call_id, {
          callId: event.call_id,
          streamId: event.stream_id,
          toolName: event.tool_name,
          args: event.args,
          status: "waiting",
          createdSeq: event.seq
        });
      }
      next.connectionState = "WAITING_TOOL_RESULT";
      next.timeline.push(eventTimelineEntry(event));
      break;
    }

    case "TOOL_RESULT": {
      flushTokenGroup(next);
      const existing = next.toolCalls.get(event.call_id);
      if (existing) {
        next.toolCalls.set(event.call_id, { ...existing, result: event.result, resultSeq: event.seq, status: "complete" });
      }
      const stream = ensureStream(next, event.stream_id);
      stream.status = "streaming";
      stream.lastSeq = event.seq;
      next.streams.set(event.stream_id, stream);
      next.connectionState = "STREAMING";
      next.timeline.push(eventTimelineEntry(event));
      break;
    }

    case "CONTEXT_SNAPSHOT": {
      flushTokenGroup(next);
      const history = next.contexts.get(event.context_id) ?? [];
      if (!history.some((snapshot) => snapshot.seq === event.seq)) {
        history.push({ contextId: event.context_id, seq: event.seq, data: event.data, timestamp: Date.now() });
      }
      next.contexts.set(event.context_id, history);
      next.selectedContextId = next.selectedContextId ?? event.context_id;
      // Reset scrubber to latest when a new snapshot arrives.
      next.contextHistoryIndex = -1;
      next.timeline.push(eventTimelineEntry(event));
      break;
    }

    case "PING":
      next.metrics.lastHeartbeat = Date.now();
      // Flush token group so PING shows up as a boundary in the timeline.
      flushTokenGroup(next);
      next.timeline.push(eventTimelineEntry(event));
      break;

    case "STREAM_END": {
      flushTokenGroup(next);
      const stream = ensureStream(next, event.stream_id);
      stream.status = "complete";
      stream.lastSeq = event.seq;
      next.streams.set(event.stream_id, stream);
      next.connectionState = "CONNECTED";
      next.timeline.push(eventTimelineEntry(event));
      break;
    }

    case "ERROR":
      flushTokenGroup(next);
      next.connectionState = "FAILED";
      next.timeline.push(eventTimelineEntry(event));
      break;
  }

  return next;
}

// ─────────────────────────────────────────────────────────────
// Client-side timeline recording helpers
// ─────────────────────────────────────────────────────────────

export function recordClientMessage(state: AppState, message: ClientMessage): AppState {
  const next = cloneState(state);
  const id = `${message.type}-${Date.now()}-${next.timeline.length}`;
  next.timeline.push({
    kind: "event",
    id,
    seq: next.metrics.lastProcessedSeq,
    type: message.type,
    label: message.type,
    timestamp: Date.now()
  });
  if (message.type === "TOOL_ACK") {
    const call = next.toolCalls.get(message.call_id);
    if (call) next.toolCalls.set(message.call_id, { ...call, ackSentAt: Date.now() });
  }
  return next;
}

export function recordProtocolError(state: AppState, error: ProtocolError): AppState {
  const next = cloneState(state);
  next.protocolErrors.push(error);
  next.timeline.push({
    kind: "event",
    id: `protocol-error-${error.timestamp}`,
    seq: next.metrics.lastProcessedSeq,
    type: "PROTOCOL_ERROR",
    label: error.message,
    timestamp: error.timestamp
  });
  return next;
}

/**
 * Flush the in-progress token group into the timeline.
 * Call this from useAgentRuntime on disconnect / before reset so
 * the last tokens in a dropped stream appear in the trace.
 */
export function flushActiveTokenGroup(state: AppState): AppState {
  if (!state.activeTokenGroup) return state;
  const next = cloneState(state);
  flushTokenGroup(next);
  return next;
}
