"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAgentRuntime } from "./useAgentRuntime";
import type { AppState } from "@/state/types";

// ─────────────────────────────────────────────────────────────
// Context type mirrors the useAgentRuntime return value
// ─────────────────────────────────────────────────────────────

type AgentRuntimeContextValue = {
  state: AppState;
  sendUserMessage: (content: string) => void;
  reconnectNow: () => void;
  selectContext: (contextId: string) => void;
};

const AgentRuntimeContext = createContext<AgentRuntimeContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider — mount ONCE at the layout level so the WebSocket
// and all state survive page navigations.
// ─────────────────────────────────────────────────────────────

export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useAgentRuntime();
  return (
    <AgentRuntimeContext.Provider value={runtime}>
      {children}
    </AgentRuntimeContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// Hook — used by both /  (AgentConsole) and /chat (ChatConsole)
// ─────────────────────────────────────────────────────────────

export function useAgentRuntimeContext(): AgentRuntimeContextValue {
  const ctx = useContext(AgentRuntimeContext);
  if (!ctx) {
    throw new Error(
      "useAgentRuntimeContext must be used inside <AgentRuntimeProvider>"
    );
  }
  return ctx;
}
