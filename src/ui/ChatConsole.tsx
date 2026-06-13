"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAgentRuntimeContext } from "@/realtime/AgentRuntimeContext";
import type { StreamState, ToolCallState } from "@/state/types";
import styles from "./ChatConsole.module.css";

// ─────────────────────────────────────────────────────────────
// Agent Icon (SVG — no emoji)
// ─────────────────────────────────────────────────────────────

function AgentIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="18" fill="url(#agentGrad)" />
      {/* Brain-like circuit motif */}
      <circle cx="18" cy="14" r="5" stroke="white" strokeWidth="1.5" fill="none" />
      <line x1="18" y1="9" x2="18" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="23" y1="14" x2="25" y2="14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="14" x2="11" y2="14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="21.5" y1="10.5" x2="23" y2="9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14.5" y1="10.5" x2="13" y2="9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      {/* Dots for "thinking" */}
      <circle cx="16" cy="14" r="1" fill="white" opacity="0.8" />
      <circle cx="18" cy="14" r="1" fill="white" />
      <circle cx="20" cy="14" r="1" fill="white" opacity="0.8" />
      {/* Connector to body */}
      <path d="M13 20 Q18 24 23 20" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <defs>
        <linearGradient id="agentGrad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function UserIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="url(#userGrad)" />
      <circle cx="16" cy="13" r="5" fill="white" opacity="0.9" />
      <path d="M6 26c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <defs>
        <linearGradient id="userGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Typing Indicator
// ─────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className={styles.typingWrap}>
      <div className={styles.agentAvatar}>
        <AgentIcon size={28} />
      </div>
      <div className={styles.typingBubble}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tool Call Card (inline chat style)
// ─────────────────────────────────────────────────────────────

function ToolCard({ call }: { call: ToolCallState }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`${styles.toolCard} ${call.status === "done" ? styles.toolCardDone : styles.toolCardPending}`}>
      <button
        className={styles.toolCardHeader}
        type="button"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={styles.toolCardLeft}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 4V3a3 3 0 0 1 6 0v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="8" r="1.2" fill="currentColor" />
          </svg>
          <span className={styles.toolName}>{call.toolName}</span>
        </div>
        <div className={styles.toolCardRight}>
          <span className={`${styles.toolStatus} ${call.status === "done" ? styles.toolStatusDone : styles.toolStatusPending}`}>
            {call.status === "done" ? "Completed" : "Running"}
          </span>
          <span className={styles.toolChevron}>{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className={styles.toolCardBody}>
          <div className={styles.toolSection}>
            <span className={styles.toolSectionLabel}>Input</span>
            <pre className={styles.toolPre}>{JSON.stringify(call.args, null, 2)}</pre>
          </div>
          {call.result ? (
            <div className={styles.toolSection}>
              <span className={styles.toolSectionLabel}>Output</span>
              <pre className={`${styles.toolPre} ${styles.toolPreResult}`}>{JSON.stringify(call.result, null, 2)}</pre>
            </div>
          ) : (
            <div className={styles.toolWaiting}>
              <span className={styles.dot} />
              <span className={styles.dot} />
              <span className={styles.dot} />
              <span>Processing</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Agent Message Bubble
// ─────────────────────────────────────────────────────────────

function AgentMessage({ stream, toolCalls }: { stream: StreamState; toolCalls: Map<string, ToolCallState> }) {
  const isStreaming = stream.status === "streaming" || stream.status === "waiting_tool";

  return (
    <div className={styles.messageRow}>
      <div className={styles.agentAvatar}>
        <AgentIcon size={32} />
      </div>
      <div className={styles.messageGroup}>
        <span className={styles.senderLabel}>Alchemyst Agent</span>
        <div className={`${styles.bubble} ${styles.agentBubble}`}>
          <span className={styles.bubbleText}>
            {stream.text}
            {isStreaming && stream.status === "streaming" && (
              <span className={styles.cursor} />
            )}
          </span>
        </div>
        {stream.toolCallIds.map((callId) => {
          const call = toolCalls.get(callId);
          if (!call) return null;
          return <ToolCard key={callId} call={call} />;
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// User Message Bubble
// ─────────────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <div className={`${styles.messageRow} ${styles.userRow}`}>
      <div className={styles.messageGroup}>
        <span className={`${styles.senderLabel} ${styles.userLabel}`}>You</span>
        <div className={`${styles.bubble} ${styles.userBubble}`}>
          <span className={styles.bubbleText}>{content}</span>
        </div>
      </div>
      <div className={styles.agentAvatar}>
        <UserIcon size={32} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Connection Status Bar
// ─────────────────────────────────────────────────────────────

function StatusBar({
  connectionState,
  onReconnect,
}: {
  connectionState: string;
  onReconnect: () => void;
}) {
  const isOk = connectionState === "CONNECTED" || connectionState === "STREAMING";
  const isWarn = connectionState === "RECONNECTING" || connectionState === "RESUMING";

  return (
    <div className={`${styles.statusBar} ${isOk ? styles.statusOk : isWarn ? styles.statusWarn : styles.statusBad}`}>
      <div className={styles.statusDot} />
      <span className={styles.statusText}>{connectionState}</span>
      {!isOk && (
        <button className={styles.statusBtn} type="button" onClick={onReconnect}>
          Reconnect
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Chat Console
// ─────────────────────────────────────────────────────────────

type Turn = { kind: "user"; content: string } | { kind: "agent"; streamId: string };

export function ChatConsole() {
  const { state, sendUserMessage, reconnectNow } = useAgentRuntimeContext();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const streams = [...state.streams.values()];
  const isStreaming =
    state.connectionState === "STREAMING" ||
    state.connectionState === "WAITING_TOOL_RESULT";

  // Track conversation turns
  useEffect(() => {
    for (const stream of streams) {
      setTurns((prev) => {
        if (prev.find((t) => t.kind === "agent" && t.streamId === stream.streamId))
          return prev;
        return [...prev, { kind: "agent", streamId: stream.streamId }];
      });
    }
  }, [state.streams.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
  }, [state.streams, turns]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
  };

  const scrollToBottom = () => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg) return;
    setTurns((prev) => [...prev, { kind: "user", content: msg }]);
    sendUserMessage(msg);
    setInput("");
    textareaRef.current?.focus();
  }, [input, sendUserMessage]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-grow textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div className={styles.root}>
      {/* Background layers */}
      <div className={styles.bgGradient} />
      <div className={styles.bgGrid} />

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <AgentIcon size={28} />
          </div>
          <div>
            <h1 className={styles.headerTitle}>Alchemyst Agent</h1>
            <p className={styles.headerSub}>Context-aware AI — real-time streaming</p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <StatusBar connectionState={state.connectionState} onReconnect={reconnectNow} />
          <Link href="/" className={styles.navLink}>
            Console
          </Link>
        </div>
      </header>

      {/* Messages */}
      <div className={styles.scrollArea} ref={scrollRef} onScroll={handleScroll}>
        <div className={styles.messageList}>
          {/* Welcome */}
          {turns.length === 0 && (
            <div className={styles.welcome}>
              <div className={styles.welcomeIcon}>
                <AgentIcon size={48} />
              </div>
              <h2 className={styles.welcomeTitle}>Start a conversation</h2>
              <p className={styles.welcomeSub}>
                Ask about Q3 reports, run data analysis, or query the knowledge base.
              </p>
              <div className={styles.suggestions}>
                {[
                  "Summarize the Q3 earnings report",
                  "Analyze the correlation between user growth and revenue",
                  "Load the full database schema",
                  "Look up the deployment SLA requirements",
                ].map((s) => (
                  <button
                    key={s}
                    className={styles.suggestion}
                    type="button"
                    onClick={() => {
                      setTurns((prev) => [...prev, { kind: "user", content: s }]);
                      sendUserMessage(s);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation turns */}
          {turns.map((turn, i) => {
            if (turn.kind === "user") {
              return <UserMessage key={`user-${i}`} content={turn.content} />;
            }
            const stream = state.streams.get(turn.streamId);
            if (!stream) return null;
            return (
              <AgentMessage
                key={turn.streamId}
                stream={stream}
                toolCalls={state.toolCalls}
              />
            );
          })}

          {/* Typing indicator while waiting for first token */}
          {isStreaming && streams.length === 0 && <TypingIndicator />}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button className={styles.scrollBtn} type="button" onClick={scrollToBottom}>
          ↓
        </button>
      )}

      {/* Composer */}
      <div className={styles.composerWrap}>
        <div className={styles.composer}>
          <textarea
            ref={textareaRef}
            id="chat-input"
            className={styles.composerInput}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKey}
            placeholder="Message the agent..."
            rows={1}
          />
          <div className={styles.composerActions}>
            <span className={styles.composerHint}>Enter to send · Shift+Enter for new line</span>
            <button
              id="chat-send-btn"
              className={`${styles.sendBtn} ${!input.trim() || isStreaming ? styles.sendBtnDisabled : ""}`}
              type="button"
              disabled={!input.trim() || isStreaming}
              onClick={handleSend}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 9L16 9M16 9L10 3M16 9L10 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <p className={styles.composerDisclaimer}>
          °°°°°°°°°°°°°°°°
        </p>
      </div>
    </div>
  );
}
