"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAgentRuntimeContext } from "@/realtime/AgentRuntimeContext";
import { diffJson } from "@/state/json-diff";
import type { AppState, ConnectionState, StreamState, TimelineEntry, ToolCallState } from "@/state/types";
import type { JsonObject, JsonValue } from "@/protocol/types";
import styles from "./AgentConsole.module.css";

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────

export function AgentConsole() {
  const { state, sendUserMessage, reconnectNow, selectContext } = useAgentRuntimeContext();
  const [input, setInput] = useState("");
  const [timelineFilter, setTimelineFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selectedElementId, setSelectedElementId] = useState<string | undefined>();

  const timelineRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const chatElementRefs = useRef<Map<string, HTMLElement>>(new Map());

  const handleTimelineClick = useCallback((elementId: string | undefined) => {
    if (!elementId) return;
    setSelectedElementId(elementId);
    chatElementRefs.current.get(elementId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const handleChatElementClick = useCallback((elementId: string) => {
    setSelectedElementId(elementId);
    timelineRowRefs.current.get(elementId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const streams = [...state.streams.values()];
  const isReconnecting = state.connectionState === "RECONNECTING" || state.connectionState === "RESUMING";
  const isFailed = state.connectionState === "FAILED";

  const filteredTimeline = useMemo(() => {
    return state.timeline
      .filter((entry) => {
        if (timelineFilter === "ALL") return true;
        if (timelineFilter === "TOKEN") return entry.type === "TOKEN_GROUP";
        return entry.type === timelineFilter;
      })
      .filter((entry) => entry.label.toLowerCase().includes(search.toLowerCase()))
      .slice(-500);
  }, [state.timeline, timelineFilter, search]);

  return (
    <div className={styles.root}>
      {/* ── Top Bar ───────────────────────────────────────── */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <span className={styles.appName}>Agent Console</span>
          <span className={styles.appSub}>Fault-tolerant real-time AI agent</span>
        </div>
        <div className={styles.topbarRight}>
          <Link href="/chat" className={styles.chatNavBtn}>Chat View</Link>
          <ConnectionBadge state={state} onReconnect={reconnectNow} />
        </div>
      </header>

      {/* ── Reconnect Banner ──────────────────────────────── */}
      {(isReconnecting || isFailed) && (
        <ReconnectBanner state={state} onReconnect={reconnectNow} />
      )}

      {/* ── Main Grid ─────────────────────────────────────── */}
      <div className={styles.grid}>

        {/* Chat */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Streaming Chat</span>
            <span className={styles.panelMeta}>{streams.length} stream{streams.length !== 1 ? "s" : ""}</span>
          </div>
          <div className={styles.chatScroll}>
            {streams.length === 0
              ? <div className={styles.empty}>Send a message to start a stream.</div>
              : streams.map((stream) => (
                  <StreamView
                    key={stream.streamId}
                    stream={stream}
                    toolCalls={state.toolCalls}
                    selectedElementId={selectedElementId}
                    onToolCardClick={handleChatElementClick}
                    chatElementRefs={chatElementRefs}
                  />
                ))
            }
          </div>
          <div className={styles.composer}>
            <textarea
              id="chat-input"
              className={styles.composerInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim()) { sendUserMessage(input); setInput(""); }
                }
              }}
              placeholder="Ask the agent... (Enter to send)"
              rows={2}
            />
            <button
              id="chat-send-btn"
              className={styles.sendBtn}
              type="button"
              onClick={() => { if (input.trim()) { sendUserMessage(input); setInput(""); } }}
            >
              Send
            </button>
          </div>
        </section>

        {/* Timeline */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Trace Timeline</span>
            <span className={styles.panelMeta}>{state.timeline.length} events</span>
          </div>
          <div className={styles.filterBar}>
            <select
              id="timeline-filter-select"
              className={styles.filterSelect}
              value={timelineFilter}
              onChange={(e) => setTimelineFilter(e.target.value)}
            >
              {["ALL","TOKEN","TOOL_CALL","TOOL_RESULT","CONTEXT_SNAPSHOT","PING","PONG","ERROR"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input
              id="timeline-search-input"
              className={styles.filterInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
            />
          </div>
          <div className={styles.timelineList}>
            {filteredTimeline.map((entry) => {
              const linkId = entry.kind === "event"
                ? (entry.callId ?? (entry.streamId || undefined))
                : (entry.streamId || undefined);
              // Only mark selected if linkId is defined AND matches
              const isSelected = linkId !== undefined && selectedElementId === linkId;
              return (
                <TimelineRow
                  key={entry.id}
                  entry={entry}
                  isSelected={isSelected}
                  onClick={() => handleTimelineClick(linkId)}
                  rowRef={(el) => {
                    if (linkId) {
                      if (el) timelineRowRefs.current.set(linkId, el);
                      else timelineRowRefs.current.delete(linkId);
                    }
                  }}
                />
              );
            })}
          </div>
        </section>

        {/* Context Inspector */}
        <ContextInspector state={state} onSelectContext={selectContext} />

        {/* Metrics */}
        <MetricsPanel state={state} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Connection Badge
// ─────────────────────────────────────────────────────────────

const STATE_META: Record<ConnectionState, { label: string; cls: string }> = {
  CONNECTED:          { label: "CONNECTED",          cls: "stConnected"    },
  STREAMING:          { label: "STREAMING",           cls: "stStreaming"    },
  CONNECTING:         { label: "CONNECTING",          cls: "stConnecting"   },
  RECONNECTING:       { label: "RECONNECTING",        cls: "stReconnecting" },
  RESUMING:           { label: "RESUMING",            cls: "stResuming"     },
  WAITING_TOOL_RESULT:{ label: "TOOL PENDING",        cls: "stTool"         },
  FAILED:             { label: "FAILED",              cls: "stFailed"       },
  DISCONNECTED:       { label: "DISCONNECTED",        cls: "stDisconnected" },
};

function ConnectionBadge({ state, onReconnect }: { state: AppState; onReconnect: () => void }) {
  const meta = STATE_META[state.connectionState];
  return (
    <div className={styles.connectionBadge}>
      <div className={`${styles.connStatus} ${styles[meta.cls]}`}>
        <span className={styles.connDot} />
        <span className={styles.connLabel}>{meta.label}</span>
      </div>
      <button id="reconnect-btn" className={styles.reconnectBtn} type="button" onClick={onReconnect}>
        Reconnect
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Reconnect Banner
// ─────────────────────────────────────────────────────────────

function ReconnectBanner({ state, onReconnect }: { state: AppState; onReconnect: () => void }) {
  const isFailed = state.connectionState === "FAILED";
  return (
    <div className={`${styles.reconnectBanner} ${isFailed ? styles.bannerFailed : styles.bannerWarn}`}>
      <div className={styles.bannerContent}>
        <span className={styles.bannerState}>{state.connectionState}</span>
        <span className={styles.bannerDetail}>
          Attempt {state.metrics.reconnectCount} &nbsp;|&nbsp; Last seq: {state.metrics.lastProcessedSeq}
        </span>
      </div>
      <button className={styles.bannerRetry} type="button" onClick={onReconnect}>
        Retry now
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// StreamView
// ─────────────────────────────────────────────────────────────

function StreamView({
  stream, toolCalls, selectedElementId, onToolCardClick, chatElementRefs
}: {
  stream: StreamState;
  toolCalls: Map<string, ToolCallState>;
  selectedElementId: string | undefined;
  onToolCardClick: (id: string) => void;
  chatElementRefs: React.MutableRefObject<Map<string, HTMLElement>>;
}) {
  return (
    <article
      className={styles.stream}
      id={`stream-${stream.streamId}`}
      ref={(el) => {
        if (el) chatElementRefs.current.set(stream.streamId, el);
        else chatElementRefs.current.delete(stream.streamId);
      }}
    >
      <div className={styles.streamHeader}>
        <span className={styles.streamId}>{stream.streamId}</span>
        <span className={`${styles.streamStatus} ${stream.status === "complete" ? styles.statusComplete : stream.status === "waiting_tool" ? styles.statusTool : styles.statusStreaming}`}>
          {stream.status}
        </span>
      </div>
      <div className={styles.streamText}>{stream.text || <span className={styles.streamCursor}>|</span>}</div>

      {stream.toolCallIds.map((callId) => {
        const call = toolCalls.get(callId);
        if (!call) return null;
        const isHighlighted = selectedElementId === callId;
        return (
          <div
            key={call.callId}
            id={`tool-${call.callId}`}
            className={`${styles.toolCard} ${isHighlighted ? styles.toolHighlighted : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onToolCardClick(call.callId)}
            onKeyDown={(e) => { if (e.key === "Enter") onToolCardClick(call.callId); }}
            ref={(el) => {
              if (el) chatElementRefs.current.set(call.callId, el);
              else chatElementRefs.current.delete(call.callId);
            }}
          >
            <div className={styles.toolCardHeader}>
              <div className={styles.toolCardLeft}>
                <span className={styles.toolIcon} />
                <strong className={styles.toolName}>{call.toolName}</strong>
              </div>
              <span className={`${styles.toolBadge} ${call.status === "waiting" ? styles.toolBadgeWait : styles.toolBadgeDone}`}>
                {call.status === "waiting" ? "Waiting" : "Done"}
              </span>
            </div>
            <div className={styles.toolDivider} />
            <div className={styles.toolSection}>
              <span className={styles.toolSectionLabel}>Arguments</span>
              <pre className={styles.toolPre}>{JSON.stringify(call.args, null, 2)}</pre>
            </div>
            {call.result && (
              <>
                <div className={styles.toolDivider} />
                <div className={styles.toolSection}>
                  <span className={styles.toolSectionLabel}>Result</span>
                  <pre className={styles.toolPre}>{JSON.stringify(call.result, null, 2)}</pre>
                </div>
              </>
            )}
            {!call.result && (
              <div className={styles.toolWaiting}>Waiting for result...</div>
            )}
          </div>
        );
      })}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// TimelineRow
// ─────────────────────────────────────────────────────────────

function TimelineRow({
  entry, isSelected, onClick, rowRef
}: {
  entry: TimelineEntry;
  isSelected: boolean;
  onClick: () => void;
  rowRef: (el: HTMLButtonElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (entry.kind === "token_group") {
    return (
      <div className={`${styles.tlRow} ${isSelected ? styles.tlRowSelected : ""}`}>
        <button
          ref={rowRef}
          className={styles.tlRowBtn}
          type="button"
          onClick={() => { setExpanded((v) => !v); onClick(); }}
        >
          <span className={`${styles.tlType} ${styles.tlToken}`}>TOKEN</span>
          <span className={styles.tlSeq}>#{entry.seq}</span>
          <span className={styles.tlLabel}>
            {entry.tokenCount} tokens &middot; {(entry.durationMs / 1000).toFixed(1)}s
            <span className={styles.tlExpand}>{expanded ? " collapse" : " expand"}</span>
          </span>
        </button>
        {expanded && <pre className={styles.tlTokenText}>{entry.fullText}</pre>}
      </div>
    );
  }

  const typeStyle = TYPE_STYLES[entry.type] ?? styles.tlDefault;
  return (
    <button
      ref={rowRef}
      className={`${styles.tlRowBtn} ${isSelected ? styles.tlRowSelected : ""}`}
      type="button"
      onClick={onClick}
    >
      <span className={`${styles.tlType} ${typeStyle}`}>{entry.type}</span>
      <span className={styles.tlSeq}>#{entry.seq}</span>
      <span className={styles.tlLabel}>{entry.label}</span>
    </button>
  );
}

const TYPE_STYLES: Record<string, string> = {
  TOKEN_GROUP:      styles.tlToken,
  TOOL_CALL:        styles.tlTool,
  TOOL_RESULT:      styles.tlTool,
  CONTEXT_SNAPSHOT: styles.tlContext,
  PING:             styles.tlPing,
  PONG:             styles.tlPing,
  STREAM_END:       styles.tlStream,
  ERROR:            styles.tlError,
  PROTOCOL_ERROR:   styles.tlError,
};

// ─────────────────────────────────────────────────────────────
// ContextInspector
// ─────────────────────────────────────────────────────────────

function ContextInspector({
  state, onSelectContext
}: {
  state: AppState;
  onSelectContext: (id: string) => void;
}) {
  const contextIds = [...state.contexts.keys()];
  const selectedId = state.selectedContextId ?? contextIds[0];
  const history = selectedId ? (state.contexts.get(selectedId) ?? []) : [];
  const total = history.length;

  const [scrubIndex, setScrubIndex] = useState(-1);
  const resolved = scrubIndex < 0 || scrubIndex >= total ? total - 1 : scrubIndex;

  const current = history[resolved];
  const previous = resolved > 0 ? history[resolved - 1] : undefined;

  const diffs = useMemo(
    () => (current ? diffJson(previous?.data, current.data).slice(0, 200) : []),
    [current, previous]
  );

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Context Inspector</span>
        <span className={styles.panelMeta}>{total} snapshot{total !== 1 ? "s" : ""}</span>
      </div>
      <div className={styles.filterBar}>
        <select
          id="context-select"
          className={styles.filterSelect}
          value={selectedId ?? ""}
          onChange={(e) => { onSelectContext(e.target.value); setScrubIndex(-1); }}
        >
          {contextIds.map((id) => <option key={id}>{id}</option>)}
        </select>
        <div className={styles.scrubber}>
          <button id="ctx-prev-btn" type="button" className={styles.scrubBtn}
            disabled={resolved <= 0} onClick={() => setScrubIndex(Math.max(0, resolved - 1))}>
            Prev
          </button>
          <span className={styles.scrubLabel}>{total === 0 ? "0 / 0" : `${resolved + 1} / ${total}`}</span>
          <button id="ctx-next-btn" type="button" className={styles.scrubBtn}
            disabled={resolved >= total - 1} onClick={() => setScrubIndex(resolved + 1 >= total - 1 ? -1 : resolved + 1)}>
            Next
          </button>
        </div>
      </div>

      {diffs.length > 0 && (
        <div className={styles.diffList}>
          <div className={styles.diffHeader}>Changes from previous snapshot</div>
          {diffs.map((d) => (
            <div key={`${d.kind}-${d.path}`} className={`${styles.diffRow} ${styles[`diff${d.kind.charAt(0).toUpperCase()}${d.kind.slice(1)}`]}`}>
              <span className={styles.diffKind}>{d.kind}</span>
              <code className={styles.diffPath}>{d.path}</code>
              {d.kind === "changed" && (
                <span className={styles.diffVal}>{JSON.stringify(d.before)} → {JSON.stringify(d.after)}</span>
              )}
              {d.kind === "added" && (
                <span className={styles.diffVal}>{JSON.stringify(d.after)}</span>
              )}
              {d.kind === "removed" && (
                <span className={styles.diffVal}>{JSON.stringify(d.before)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.jsonTreeWrap}>
        {current
          ? <LazyJsonTree data={current.data} />
          : <div className={styles.empty}>No context snapshot yet.</div>
        }
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Lazy JSON Tree
// ─────────────────────────────────────────────────────────────

const MAX_DEPTH = 2;
const MAX_STR = 100;
const MAX_KEYS = 150;

function LazyJsonTree({ data }: { data: JsonObject }) {
  return (
    <div className={styles.jsonTree}>
      <JsonNode value={data} depth={0} label={null} />
    </div>
  );
}

function JsonNode({ value, depth, label }: { value: JsonValue; depth: number; label: string | null }) {
  const [open, setOpen] = useState(depth < MAX_DEPTH);

  const keyEl = label !== null
    ? <span className={styles.jKey}>{JSON.stringify(label)}: </span>
    : null;

  if (Array.isArray(value)) {
    if (value.length === 0) return <div className={styles.jLine}>{keyEl}<span className={styles.jPunct}>[]</span></div>;
    return (
      <div>
        <button className={styles.jToggle} onClick={() => setOpen((v) => !v)} type="button">
          {keyEl}<span className={styles.jPunct}>{open ? "[ " : `[ ${value.length} items ]`}</span>
          <span className={styles.jCaret}>{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div className={styles.jChildren}>
            {value.slice(0, MAX_KEYS).map((item, i) => <JsonNode key={i} value={item} depth={depth + 1} label={String(i)} />)}
            {value.length > MAX_KEYS && <div className={styles.jMore}>… {value.length - MAX_KEYS} more</div>}
            <span className={styles.jPunct}>]</span>
          </div>
        )}
      </div>
    );
  }

  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as JsonObject);
    if (keys.length === 0) return <div className={styles.jLine}>{keyEl}<span className={styles.jPunct}>{"{}"}</span></div>;
    return (
      <div>
        <button className={styles.jToggle} onClick={() => setOpen((v) => !v)} type="button">
          {keyEl}<span className={styles.jPunct}>{open ? "{ " : `{ ${keys.length} keys }`}</span>
          <span className={styles.jCaret}>{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div className={styles.jChildren}>
            {keys.slice(0, MAX_KEYS).map((k) => <JsonNode key={k} value={(value as JsonObject)[k]} depth={depth + 1} label={k} />)}
            {keys.length > MAX_KEYS && <div className={styles.jMore}>… {keys.length - MAX_KEYS} more keys</div>}
            <span className={styles.jPunct}>{"}"}</span>
          </div>
        )}
      </div>
    );
  }

  const s = JSON.stringify(value);
  const display = s.length > MAX_STR ? s.slice(0, MAX_STR) + "…" : s;
  const cls = typeof value === "string" ? styles.jStr
    : typeof value === "number" ? styles.jNum
    : typeof value === "boolean" ? styles.jBool
    : styles.jNull;

  return <div className={styles.jLine}>{keyEl}<span className={cls}>{display}</span></div>;
}

// ─────────────────────────────────────────────────────────────
// Metrics Panel
// ─────────────────────────────────────────────────────────────

function MetricsPanel({ state }: { state: AppState }) {
  const pendingAcks = [...state.toolCalls.values()].filter((c) => c.status === "waiting").length;
  const totalToolCalls = state.toolCalls.size;
  const latencyDisplay = state.metrics.averageLatency > 0
    ? `${state.metrics.averageLatency}ms`
    : "—";

  const groups: { label: string; value: string | number; highlight?: boolean }[][] = [
    [
      { label: "Last Received Seq",  value: state.metrics.lastReceivedSeq },
      { label: "Last Processed Seq", value: state.metrics.lastProcessedSeq },
      { label: "Last Rendered Seq",  value: state.metrics.lastRenderedSeq },
      { label: "Last ACK Seq",       value: state.metrics.lastAcknowledgedSeq },
    ],
    [
      { label: "Buffered Events",    value: state.metrics.bufferedEvents,    highlight: state.metrics.bufferedEvents > 0 },
      { label: "Dropped Dupes",      value: state.metrics.droppedDuplicates, highlight: state.metrics.droppedDuplicates > 0 },
      { label: "Replayed Events",    value: state.metrics.replayCount,       highlight: state.metrics.replayCount > 0 },
      { label: "Reconnects",         value: state.metrics.reconnectCount,    highlight: state.metrics.reconnectCount > 0 },
    ],
    [
      { label: "Tool Calls Total",   value: totalToolCalls },
      { label: "Pending ACKs",       value: pendingAcks,                     highlight: pendingAcks > 0 },
      { label: "Missed Heartbeats",  value: state.metrics.missedHeartbeats,  highlight: state.metrics.missedHeartbeats > 0 },
      { label: "Response Latency",   value: latencyDisplay },
    ],
    [
      { label: "Last Heartbeat",     value: state.metrics.lastHeartbeat ? new Date(state.metrics.lastHeartbeat).toLocaleTimeString() : "none" },
      { label: "Connection State",   value: state.connectionState },
    ],
  ];

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Engineering Metrics</span>
        <span className={`${styles.panelMeta} ${state.connectionState === "CONNECTED" || state.connectionState === "STREAMING" ? styles.metaOk : styles.metaWarn}`}>
          {state.connectionState}
        </span>
      </div>
      <div className={styles.metricsBody}>
        {groups.map((group, gi) => (
          <div key={gi} className={styles.metricGroup}>
            {group.map(({ label, value, highlight }) => (
              <div key={label} className={`${styles.metricCard} ${highlight ? styles.metricHighlight : ""}`}>
                <span className={styles.metricLabel}>{label}</span>
                <strong className={styles.metricValue}>{value}</strong>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
