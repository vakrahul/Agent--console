# Agent Console

Agent Console is a Next.js 14 App Router frontend for the Alchemyst AI real-time agent . It treats WebSocket streaming as a **distributed-systems problem**: every frame passes through protocol validation, sequence buffering, deduplication, an append-only Event Journal, an idempotent event processor, and only then reaches React UI state.

## Documentation Directory

Please review the following extensive engineering documentation for a deep-dive into the system architecture and decision-making process:

| Document | Contents |
|---|---|
| **[DECISIONS.md](./DECISIONS.md)** | Rationale for sequence buffering, UI freezing, and state recovery |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | High-level system design and data flow |
| **[FAILURE_MODES.md](./FAILURE_MODES.md)** | Edge cases, chaos mode survival, and the hidden `TOOL_ACK` race condition |
| **[STATE_MACHINE.md](./STATE_MACHINE.md)** | Formalized WebSocket connection lifecycle and transitions |
| **[PROTOCOL_ANALYSIS.md](./PROTOCOL_ANALYSIS.md)** | Breakdown of the server protocol and payload rules |
| **[TESTING.md](./TESTING.md)** | Test suites covering idempotency and sequence reordering |

---

## Architecture

> End-to-end data flow from raw WebSocket frame to rendered React UI.

```mermaid
flowchart LR
    WS["WebSocket\nws://localhost:4747/ws"]

    subgraph Runtime ["useAgentRuntime (hook) — lives in layout, shared across pages"]
        direction TB
        P["Protocol Parser\nparser.ts\nValidates JSON frames"]
        SB["Sequence Buffer\nsequence-buffer.ts\nReorders + deduplicates"]
        EJ["Event Journal\nevent-journal.ts\nAppend-only log"]
        EP["Event Processor\nevent-processor.ts\nPure state reducer"]
        P --> SB --> EJ --> EP
    end

    subgraph State ["React State — AppState"]
        direction TB
        S1["streams / toolCalls"]
        S2["contexts / timeline"]
        S3["metrics / connectionState"]
    end

    subgraph UI ["AgentConsole UI — Two Views"]
        direction TB
        Chat["Streaming Chat\nToken bubbles + Tool cards"]
        Timeline["Trace Timeline\nFiltered + searchable"]
        Ctx["Context Inspector\nDiff + JSON tree + Scrubber"]
        Metrics["Engineering Metrics\nSeq / buffer / latency"]
    end

    WS -->|raw JSON frame| P
    EP -->|AppState| State
    State --> Chat
    State --> Timeline
    State --> Ctx
    State --> Metrics
```

---

## Connection State Machine

> The client's WebSocket lifecycle. Every state transition is explicit and observable via the connection badge in the UI.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> DISCONNECTED

    DISCONNECTED --> CONNECTING : connect()
    CONNECTING --> CONNECTED : socket.onopen\n(fresh session)
    CONNECTING --> FAILED : network error

    CONNECTED --> STREAMING : USER_MESSAGE sent\nfirst TOKEN received
    STREAMING --> WAITING_TOOL_RESULT : TOOL_CALL arrives\nstream paused
    WAITING_TOOL_RESULT --> STREAMING : TOOL_RESULT arrives\nstream resumes
    STREAMING --> CONNECTED : STREAM_END received

    CONNECTED --> RECONNECTING : socket drop detected
    STREAMING --> RECONNECTING : socket drop mid-stream
    WAITING_TOOL_RESULT --> RECONNECTING : socket drop mid-tool

    RECONNECTING --> RESUMING : socket.onopen\n(send RESUME + last_seq)
    RESUMING --> CONNECTED : replay complete\n(150ms fallback timeout)
    RESUMING --> FAILED : reconnect error

    FAILED --> CONNECTING : manual Reconnect button
```

---

## Sequence Buffer — Chaos Mode Reordering

> How out-of-order and duplicate `seq` values are handled without corrupting state.

```mermaid
sequenceDiagram
    autonumber
    participant S as Server (chaos)
    participant B as SequenceBuffer
    participant P as EventProcessor
    participant UI as React UI

    Note over S,UI: Messages arrive out of order due to chaos mode

    S->>B: TOKEN seq=3 (arrived early)
    B-->>B: pendingEvents.set(3, event) — held in buffer

    S->>B: TOKEN seq=1 (next expected)
    B->>P: release seq=1
    P->>UI: setState — append token 1

    S->>B: TOKEN seq=2
    B->>P: release seq=2
    B->>P: drain buffer — release seq=3
    P->>UI: setState — append tokens 2 + 3

    Note over B,P: Duplicate detection — same seq arrives again
    S->>B: TOKEN seq=2 (duplicate)
    B-->>B: processedEvents.has(2) — dropped silently
```

---

## Reconnection / RESUME Flow

> How a mid-stream connection drop is made invisible to the user.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant S as Server

    C->>S: USER_MESSAGE "Summarise Q3"
    S->>C: CONTEXT_SNAPSHOT seq=1
    S->>C: TOKEN seq=2 — "Based on the"
    S->>C: TOKEN seq=3 — "Q3 report,"
    S--xC: connection drop (chaos)

    Note over C: onclose fires<br/>state RECONNECTING<br/>backoff: 500ms, 1s, 2s...

    C->>S: new WebSocket() — reconnect attempt
    C->>S: RESUME { last_seq: 3 } — first message sent

    S->>C: replay TOKEN seq=4 (missed while disconnected)
    S->>C: replay TOOL_CALL seq=5 (missed while disconnected)

    Note over C: SequenceBuffer deduplicates<br/>seq 1-3 already in processedEvents — skipped
    C->>S: TOOL_ACK call_id=tc_01
    S->>C: TOOL_RESULT seq=6
    S->>C: STREAM_END seq=7

    Note over C,S: User sees seamless continuation — no missing or duplicate text
```

---

## Run

```powershell
# 1. Start the mock agent backend
docker build -t agent-server ./agent-server
docker run -p 4747:4747 agent-server

# 2. Start the frontend (always port 3001)
npm install
npm run dev
```

Open **http://localhost:3001** — or **http://localhost:3001/chat** for the dedicated chat view.

```powershell
# Chaos mode
docker run -p 4747:4747 agent-server --mode chaos
npm run dev
```

Server compliance log: `http://localhost:4747/log`

---

## Run Tests

```powershell
npm test
```

**30 tests** across 5 suites: sequence buffer, event processor, JSON diff, state machine, chaos edge cases.

---

## Screenshots

### Normal Mode — Streamed Response with Tool Call

<img src="image.png" width="900" alt="Streamed response with tool call card" />

### Trace Timeline + Engineering Metrics

<img src="image-1.png" width="900" alt="Trace timeline and engineering metrics panel" />
