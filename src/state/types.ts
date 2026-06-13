import type { JsonObject, ProtocolError, ServerMessage } from "@/protocol/types";

export type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "STREAMING"
  | "WAITING_TOOL_RESULT"
  | "RECONNECTING"
  | "RESUMING"
  | "FAILED";

export type ToolCallState = {
  callId: string;
  streamId: string;
  toolName: string;
  args: JsonObject;
  result?: JsonObject;
  status: "waiting" | "complete";
  createdSeq: number;
  resultSeq?: number;
  ackSentAt?: number;
};

export type StreamState = {
  streamId: string;
  tokenSeqs: Set<number>;
  text: string;
  toolCallIds: string[];
  status: "streaming" | "waiting_tool" | "complete" | "error";
  lastSeq: number;
};

export type ContextSnapshot = {
  contextId: string;
  seq: number;
  data: JsonObject;
  timestamp: number;
};

/** A single protocol event entry in the trace timeline. */
export type TimelineEntry =
  | {
      kind: "event";
      id: string;
      seq: number;
      type: ServerMessage["type"] | "PONG" | "TOOL_ACK" | "PROTOCOL_ERROR";
      label: string;
      streamId?: string;
      callId?: string;
      contextId?: string;
      timestamp: number;
    }
  | {
      /** Consecutive TOKEN events collapsed into one expandable row. */
      kind: "token_group";
      id: string;
      /** seq of the first token in the group */
      seq: number;
      type: "TOKEN_GROUP";
      streamId: string;
      tokenCount: number;
      durationMs: number;
      fullText: string;
      startTime: number;
      timestamp: number;
      label: string;
    };

/** Mutable accumulator used while tokens are arriving. Stored on AppState and flushed when a non-TOKEN event arrives. */
export type ActiveTokenGroup = {
  id: string;
  streamId: string;
  firstSeq: number;
  lastSeq: number;
  startTime: number;
  tokenCount: number;
  fullText: string;
};

export type MetricsState = {
  lastReceivedSeq: number;
  lastProcessedSeq: number;
  lastRenderedSeq: number;
  lastAcknowledgedSeq: number;
  bufferedEvents: number;
  droppedDuplicates: number;
  replayCount: number;
  reconnectCount: number;
  lastHeartbeat?: number;
  missedHeartbeats: number;
  averageLatency: number;
};

export type AppState = {
  connectionState: ConnectionState;
  streams: Map<string, StreamState>;
  toolCalls: Map<string, ToolCallState>;
  contexts: Map<string, ContextSnapshot[]>;
  selectedContextId?: string;
  /** Index into the selected context's snapshot history for the scrubber. -1 = latest. */
  contextHistoryIndex: number;
  timeline: TimelineEntry[];
  /** The token group currently being accumulated (flushed on non-TOKEN events). */
  activeTokenGroup: ActiveTokenGroup | null;
  protocolErrors: ProtocolError[];
  metrics: MetricsState;
};

export function createInitialAppState(): AppState {
  return {
    connectionState: "DISCONNECTED",
    streams: new Map(),
    toolCalls: new Map(),
    contexts: new Map(),
    contextHistoryIndex: -1,
    timeline: [],
    activeTokenGroup: null,
    protocolErrors: [],
    metrics: {
      lastReceivedSeq: 0,
      lastProcessedSeq: 0,
      lastRenderedSeq: 0,
      lastAcknowledgedSeq: 0,
      bufferedEvents: 0,
      droppedDuplicates: 0,
      replayCount: 0,
      reconnectCount: 0,
      missedHeartbeats: 0,
      averageLatency: 0
    }
  };
}
