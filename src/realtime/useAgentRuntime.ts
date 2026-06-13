"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EventJournal } from "@/events/event-journal";
import { processServerEvent, recordClientMessage, recordProtocolError } from "@/events/event-processor";
import { SequenceBuffer } from "@/events/sequence-buffer";
import { parseServerMessage } from "@/protocol/parser";
import type { ClientMessage, ServerMessage } from "@/protocol/types";
import { createInitialAppState, type AppState } from "@/state/types";

const WS_URL = "ws://localhost:4747/ws";
const BACKOFF_MS = [500, 1000, 2000, 4000, 10000];

/** Server sends PING every 12s. After 3 missed PINGs the server terminates the connection. */
const HEARTBEAT_INTERVAL_MS = 13_000; // check every 13s
const HEARTBEAT_DEAD_THRESHOLD_MS = 14_000; // 14s without a PING = 1 missed

type Runtime = {
  state: AppState;
  sendUserMessage: (content: string) => void;
  reconnectNow: () => void;
  selectContext: (contextId: string) => void;
};

export function useAgentRuntime(): Runtime {
  const [state, setState] = useState<AppState>(() => createInitialAppState());
  const socketRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef(new SequenceBuffer());
  const journalRef = useRef(new EventJournal());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatWatchdogRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);
  const stateRef = useRef(state);

  // ── Refs for real-time metric tracking ─────────────────────
  /** true while we are replaying events after RESUME */
  const isResumingRef = useRef(false);
  /** the last_seq we sent in the RESUME message */
  const resumeSeqRef = useRef(0);
  /** timestamp when the last USER_MESSAGE was sent — used to compute response latency */
  const userMessageSentAtRef = useRef(0);
  /** true once we have recorded latency for the current turn */
  const latencyRecordedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Heartbeat watchdog ────────────────────────────────────

  const startHeartbeatWatchdog = useCallback(() => {
    if (heartbeatWatchdogRef.current) window.clearInterval(heartbeatWatchdogRef.current);
    heartbeatWatchdogRef.current = window.setInterval(() => {
      const lastHb = stateRef.current.metrics.lastHeartbeat;
      if (!lastHb) return; // no PING received yet in this session
      if (Date.now() - lastHb > HEARTBEAT_DEAD_THRESHOLD_MS) {
        setState((current) => ({
          ...current,
          metrics: {
            ...current.metrics,
            missedHeartbeats: current.metrics.missedHeartbeats + 1
          }
        }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, []);

  const stopHeartbeatWatchdog = useCallback(() => {
    if (heartbeatWatchdogRef.current) {
      window.clearInterval(heartbeatWatchdogRef.current);
      heartbeatWatchdogRef.current = null;
    }
  }, []);

  // ── Send ──────────────────────────────────────────────────

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    setState((current) => recordClientMessage(current, message));
    return true;
  }, []);

  // ── Process ordered events ────────────────────────────────

  const processOrdered = useCallback((events: ServerMessage[]) => {
    if (events.length === 0) return;

    // FIX 2: Count replayed events while RESUMING state is active.
    // isResumingRef is true from when RESUME is sent until we see a seq
    // that is strictly beyond what we asked the server to replay from.
    let replayedCount = 0;
    if (isResumingRef.current) {
      for (const event of events) {
        if (event.seq <= resumeSeqRef.current) {
          replayedCount++;
        } else {
          // We've received a new (non-replayed) event — replay phase is over.
          isResumingRef.current = false;
        }
      }
      if (replayedCount > 0) {
        setState((current) => ({
          ...current,
          metrics: {
            ...current.metrics,
            replayCount: current.metrics.replayCount + replayedCount
          }
        }));
      }
    }

    for (const event of events) {
      journalRef.current.append(event);
      setState((current) => processServerEvent(current, event));

      if (event.type === "TOOL_CALL") {
        window.setTimeout(() => send({ type: "TOOL_ACK", call_id: event.call_id }), 0);
      }

      // FIX 4: Compute response latency from USER_MESSAGE → first TOKEN of this turn.
      if (
        event.type === "TOKEN" &&
        !latencyRecordedRef.current &&
        userMessageSentAtRef.current > 0
      ) {
        const latencyMs = Date.now() - userMessageSentAtRef.current;
        latencyRecordedRef.current = true;
        setState((current) => ({
          ...current,
          metrics: { ...current.metrics, averageLatency: latencyMs }
        }));
      }
    }
  }, [send]);

  // ── Connect ───────────────────────────────────────────────

  const connect = useCallback(() => {
    closedByUserRef.current = false;
    setState((current) => ({
      ...current,
      connectionState: current.metrics.reconnectCount > 0 ? "RECONNECTING" : "CONNECTING"
    }));

    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      const lastSeq = stateRef.current.metrics.lastProcessedSeq;
      const isResume = lastSeq > 0;

      setState((current) => ({
        ...current,
        connectionState: isResume ? "RESUMING" : "CONNECTED"
      }));

      if (isResume) {
        // Mark that we're in replay mode.
        isResumingRef.current = true;
        resumeSeqRef.current = lastSeq;
        send({ type: "RESUME", last_seq: lastSeq });
        
        // We MUST use a timeout here because the server does not send a
        // "RESUME_COMPLETE" message. If there are 0 events to replay,
        // we will never exit RESUMING state otherwise.
        window.setTimeout(() => {
          isResumingRef.current = false;
          setState((current) => {
            if (current.connectionState === "RESUMING") {
              return { ...current, connectionState: "CONNECTED" };
            }
            return current;
          });
        }, 150);
      }

      startHeartbeatWatchdog();
    };

    socket.onmessage = (messageEvent: MessageEvent<string>) => {
      const parsed = parseServerMessage(String(messageEvent.data));
      if (!parsed.ok) {
        setState((current) => recordProtocolError(current, parsed.error));
        return;
      }

      // Respond to PING immediately — well within the 3s deadline.
      if (parsed.message.type === "PING") {
        send({ type: "PONG", echo: parsed.message.challenge });
      }

      const result = bufferRef.current.accept(parsed.message);
      setState((current) => ({
        ...current,
        metrics: {
          ...current.metrics,
          lastReceivedSeq: result.metrics.lastReceivedSeq,
          lastProcessedSeq: Math.max(current.metrics.lastProcessedSeq, result.metrics.lastProcessedSeq),
          bufferedEvents: result.metrics.bufferedCount,
          droppedDuplicates: result.metrics.duplicateCount
        }
      }));

      processOrdered(result.processable);
    };

    socket.onerror = () => {
      stopHeartbeatWatchdog();
      setState((current) => ({ ...current, connectionState: "FAILED" }));
    };

    socket.onclose = () => {
      // FIX 5 (confirmed not a bug): The stale-socket guard here prevents the
      // `reconnectNow` manual reconnect from scheduling a duplicate backoff timer.
      // When reconnectNow calls close() then connect() synchronously, connect()
      // sets socketRef.current = newSocket before this onclose fires, so
      // socketRef.current !== socket → return immediately. No duplicate timer.
      if (socketRef.current !== socket) return;
      if (closedByUserRef.current) return;

      stopHeartbeatWatchdog();
      setState((current) => ({
        ...current,
        connectionState: "RECONNECTING",
        metrics: { ...current.metrics, reconnectCount: current.metrics.reconnectCount + 1 }
      }));

      const attempt = reconnectAttemptRef.current;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    };
  }, [processOrdered, send, startHeartbeatWatchdog, stopHeartbeatWatchdog]);

  // ── Mount / unmount ───────────────────────────────────────

  useEffect(() => {
    connect();
    return () => {
      closedByUserRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      stopHeartbeatWatchdog();
      socketRef.current?.close();
    };
  }, [connect, stopHeartbeatWatchdog]);

  // ── Public actions ────────────────────────────────────────

  const sendUserMessage = useCallback((content: string) => {
    if (!content.trim()) return;
    bufferRef.current.resetForNewTurn();
    journalRef.current.reset();

    // Reset latency tracking for the new turn.
    userMessageSentAtRef.current = Date.now();
    latencyRecordedRef.current = false;

    send({ type: "USER_MESSAGE", content });
    setState((current) => ({
      ...current,
      streams: new Map(),
      toolCalls: new Map(),
      contexts: new Map(),
      selectedContextId: undefined,
      connectionState: "STREAMING",
      metrics: {
        ...current.metrics,
        lastReceivedSeq: 0,
        lastProcessedSeq: 0,
        lastRenderedSeq: 0,
        lastAcknowledgedSeq: 0,
        bufferedEvents: 0,
        droppedDuplicates: 0,
        // preserve reconnect / replay / heartbeat counters across turns
      }
    }));
  }, [send]);

  // FIX 5 — confirmed safe: reconnectNow's close() fires onclose after
  // connect() runs, so the stale-socket guard stops any double reconnect.
  const reconnectNow = useCallback(() => {
    // Clear any pending auto-reconnect timer so it doesn't fire on top of this.
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    socketRef.current?.close();
    connect();
  }, [connect]);

  const selectContext = useCallback((contextId: string) => {
    setState((current) => ({ ...current, selectedContextId: contextId }));
  }, []);

  return { state, sendUserMessage, reconnectNow, selectContext };
}
