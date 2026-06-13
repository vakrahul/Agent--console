# Protocol Analysis

Complete reference for the WebSocket protocol spoken between Agent Console and `agent-server`.

## Message Flow Overview

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client (Agent Console)
    participant S as Server (agent-server)

    U->>C: types message, presses Enter
    C->>S: USER_MESSAGE { content }
    Note over S: resets seq=0, eventHistory=[]<br/>selects script, starts runScript()

    S->>C: CONTEXT_SNAPSHOT seq=1
    S->>C: TOKEN seq=2 "Based on "
    S->>C: TOKEN seq=3 "the Q3 report, "
    S->>C: TOOL_CALL seq=4 call_id=tc_01
    Note over C: freeze stream text<br/>render tool card (status: waiting)
    C->>S: TOOL_ACK call_id=tc_01
    Note over S: waits for ACK (max 5s)<br/>logs violation if missed
    S->>C: TOOL_RESULT seq=5 call_id=tc_01
    Note over C: update card (status: done)<br/>resume stream
    S->>C: TOKEN seq=6 "23.4% year-over-year"
    S->>C: STREAM_END seq=7

    loop every 12s
        S->>C: PING seq=N challenge="a1b2c3"
        C->>S: PONG echo="a1b2c3"
    end
```

## Client → Server Messages

```mermaid
graph LR
    subgraph Client Messages
        UM["USER_MESSAGE\n{ content: string }\nTriggers new agent response"]
        PO["PONG\n{ echo: string }\nMust echo challenge exactly\n(even empty string)"]
        RE["RESUME\n{ last_seq: number }\nSent as FIRST msg on reconnect\nServer replays events after last_seq"]
        TA["TOOL_ACK\n{ call_id: string }\nMust be sent within 2s of TOOL_CALL\nServer waits up to 5s then logs violation"]
    end
```

## Server → Client Messages

```mermaid
graph LR
    subgraph Server Messages
        TK["TOKEN\n{ seq, text, stream_id }\n30-80ms intervals\nGroup into TOKEN_GROUP for timeline"]
        TC["TOOL_CALL\n{ seq, call_id, tool_name, args, stream_id }\nPauses token stream\nRequires TOOL_ACK"]
        TR["TOOL_RESULT\n{ seq, call_id, result, stream_id }\nResumes token stream\nUpdate existing card by call_id"]
        CS["CONTEXT_SNAPSHOT\n{ seq, context_id, data }\nSent at start + context changes\nDedup by seq per context_id"]
        PI["PING\n{ seq, challenge }\nEvery 12s\n3 missed = connection terminated"]
        SE["STREAM_END\n{ seq, stream_id }\nFlush token group\nSet stream.status = complete"]
        ER["ERROR\n{ seq, code, message }\nSet connectionState = FAILED"]
    end
```

## Sequence Number Rules

```mermaid
flowchart TD
    Arrive["Message arrives with seq N"]
    Check1{"processedEvents\n.has(N)?"}
    Check2{"pendingEvents\n.has(N)?"}
    Check3{"N === expectedSeq?"}
    Check4{"N > expectedSeq?"}

    Drop1["Drop (duplicate)"]
    Drop2["Drop (duplicate pending)"]
    Process["Process immediately\nmarkProcessed(N)\ndrainPending()"]
    Buffer["pendingEvents.set(N, event)\n(wait for gap to close)"]
    Drop3["Drop (already passed, duplicate)"]

    Arrive --> Check1
    Check1 -->|yes| Drop1
    Check1 -->|no| Check2
    Check2 -->|yes| Drop2
    Check2 -->|no| Check3
    Check3 -->|yes| Process
    Check3 -->|no| Check4
    Check4 -->|yes| Buffer
    Check4 -->|no| Drop3
```

## Protocol Compliance Checklist

The server's `/log` endpoint verifies these. Evaluators will check it.

| Requirement | Implementation | Where |
|---|---|---|
| PONG within 3s of PING | `send({ type: "PONG", echo: challenge })` in `onmessage` | `useAgentRuntime.ts:78` |
| PONG echoes exact challenge | `echo: parsed.message.challenge` (passes `""` correctly) | `useAgentRuntime.ts:78` |
| TOOL_ACK within 2s | `window.setTimeout(() => send(TOOL_ACK), 0)` | `useAgentRuntime.ts:48` |
| RESUME as first msg on reconnect | Sent in `socket.onopen` before any other message | `useAgentRuntime.ts:65` |
| RESUME uses lastProcessedSeq | `stateRef.current.metrics.lastProcessedSeq` (not lastReceivedSeq) | `useAgentRuntime.ts:62` |
| Deduplication by seq | `processedEvents: Set<number>` in SequenceBuffer | `sequence-buffer.ts:19` |
| Out-of-order handling | `pendingEvents: Map<number, ServerMessage>` | `sequence-buffer.ts:18` |
| Corrupt PING handled | `isString("")` = true → PONG sent with `echo: ""` | `parser.ts:53` |
