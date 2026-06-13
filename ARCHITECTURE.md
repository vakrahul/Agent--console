# Architecture

## Data Pipeline

Every WebSocket frame flows through a strict, unidirectional pipeline. UI components never parse raw frames.

```mermaid
flowchart TD
    WS["WebSocket Frame\n(raw JSON string)"]
    PP["Protocol Parser\nparser.ts\n- JSON.parse\n- type + seq validation\n- field type guards"]
    SB["Sequence Buffer\nsequence-buffer.ts\n- pendingEvents: Map(seq, event)\n- processedEvents: Set(seq)\n- gap detection + drain"]
    EJ["Event Journal\nevent-journal.ts\n- append-only log\n- seqIndex dedup\n- compactTokens()"]
    EP["Event Processor\nevent-processor.ts\n- pure function: state to state\n- token group accumulation\n- idempotent tool cards"]
    RS["React State\nAppState\n- streams Map\n- toolCalls Map\n- contexts Map\n- timeline array"]
    UI["React UI\nAgentConsole.tsx\n- StreamView\n- TimelineRow\n- ContextInspector\n- MetricsPanel"]

    WS -->|raw string| PP
    PP -->|ParseResult ok or err| SB
    SB -->|ordered ServerMessages| EJ
    EJ -->|JournalEntries| EP
    EP -->|AppState immutable| RS
    RS -->|React render| UI
```

## Component Responsibilities

```mermaid
graph LR
    subgraph Hook ["useAgentRuntime.ts"]
        Socket["WebSocket lifecycle\n- connect/reconnect\n- backoff timer\n- stale-socket guard"]
        PONG["PONG sender\n- echoes challenge\n- handles empty string"]
        ACK["TOOL_ACK sender\n- setTimeout 0\n- within 2s window"]
        RESUME["RESUME sender\n- first msg on reconnect\n- sends lastProcessedSeq"]
    end
    subgraph Engine ["Event Engine"]
        SB2["SequenceBuffer"]
        EP2["EventProcessor"]
        EJ2["EventJournal"]
    end
    subgraph ReactLayer ["React Layer"]
        State["useState(AppState)"]
        UI2["AgentConsole"]
    end

    Socket --> SB2
    SB2 --> EJ2
    EJ2 --> EP2
    EP2 --> State
    State --> UI2
    Socket --> PONG
    Socket --> ACK
    Socket --> RESUME
```

## Agent Server (provided, unmodified)

```mermaid
flowchart LR
    subgraph Docker ["agent-server Docker container"]
        WS2["WebSocket Server\nport 4747/ws"]
        SM["Script Manager\nruns response scripts"]
        CH["Chaos Engine\n- connection drops\n- out-of-order delivery\n- duplicate messages\n- latency spikes\n- corrupt PING"]
        LOG["Client Log\nGET /log\nprotocol compliance"]
        HIST["Event History\nfor RESUME replay"]
    end

    Client -->|USER_MESSAGE| WS2
    Client -->|PONG / TOOL_ACK / RESUME| WS2
    WS2 --> SM
    SM -->|seq resets per message| CH
    CH -->|chaos-modified frames| Client
    WS2 --> LOG
    SM --> HIST
    HIST -->|replay after last_seq| Client
```

> **Key insight from reading server.ts:** The server resets `seq = 0` and `eventHistory = []` on each `USER_MESSAGE`. This means `SequenceBuffer.resetForNewTurn()` (which resets `expectedSequence = 1`) is correct — not a bug.
