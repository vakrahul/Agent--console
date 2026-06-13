# Failure Modes

Every chaos-mode failure is handled explicitly. This document maps each failure to its detection mechanism, handling strategy, and the test that covers it.

## Failure Map

```mermaid
graph TD
    subgraph ChaosInputs ["Chaos Mode Inputs"]
        DROP["Connection Drop\nno close frame"]
        OOO["Out-of-Order Delivery\nseq values shuffled"]
        DUP["Duplicate Messages\nsame seq sent twice"]
        RAPID["Rapid Tool Calls\ntwo TOOL_CALLs before result"]
        CORRUPT["Corrupt PING\nempty challenge string"]
        BIG["Oversized Context\n500KB+ data object"]
        SPIKE["Latency Spike\n2-8 second pause"]
    end

    subgraph Handling ["Client Handling"]
        RECONN["Reconnect with backoff\n500→1000→2000→4000→10000ms\nSend RESUME on reconnect"]
        BUFFER["SequenceBuffer\nbuffer future seqs\ndrain when gap closes"]
        DEDUP["SequenceBuffer\nprocessedEvents Set\nsilently drop duplicates"]
        STACK["Stacked tool cards\nkeyed by call_id\nnever overwrites"]
        PONG["PONG with echo: ''\nparser accepts isString('')\nserver logs 'ok'"]
        LAZY["LazyJsonTree\ncollapsible nodes\nno full stringify"]
        WAIT["React renders partial state\nUI stays interactive\ncursor animation continues"]
    end

    DROP --> RECONN
    OOO --> BUFFER
    DUP --> DEDUP
    RAPID --> STACK
    CORRUPT --> PONG
    BIG --> LAZY
    SPIKE --> WAIT
```

## Detailed Scenarios

### 1. Connection Drop Mid-Stream

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    S->>C: TOKEN seq=10
    S->>C: TOKEN seq=11
    S--xC: TCP drop (no close frame)
    Note over C: onclose fires<br/>socketRef check passes<br/>closedByUserRef = false<br/>→ schedule reconnect 500ms
    C->>S: new WebSocket
    C->>S: RESUME { last_seq: 11 }
    S->>C: TOKEN seq=12 (replayed)
    Note over C: seq=12 > expectedSeq=12 ✓<br/>processable, not duplicate
```

**What must NOT happen:** The reconnect must not trigger if the socket was intentionally closed (`closedByUserRef = true`) or if a stale socket closes after being replaced (`socketRef.current !== socket`).

---

### 2. Out-of-Order Tool Result (Critical Race)

```mermaid
sequenceDiagram
    participant S as Server (chaos)
    participant B as SequenceBuffer

    S->>B: TOOL_RESULT seq=20 (arrives first)
    B-->>B: 20 > expectedSeq=19 → pendingEvents.set(20)
    S->>B: TOOL_CALL seq=19 (arrives late)
    B->>EP: process TOOL_CALL seq=19
    B->>EP: drain → process TOOL_RESULT seq=20
    Note over EP: TOOL_CALL processed first<br/>TOOL_RESULT finds existing card ✓
```

If TOOL_RESULT were processed before TOOL_CALL, the card would not exist and the result would be lost. The sequence buffer guarantees ordering.

---

### 3. TOOL_ACK Race Condition

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    S->>C: TOOL_CALL seq=5 call_id=tc_01
    C->>C: render card (status: waiting)
    C->>S: TOOL_ACK call_id=tc_01
    S--xC: connection drops
    C->>S: RESUME last_seq=5
    S->>C: replay TOOL_RESULT seq=6
    Note over C: toolCalls.get('tc_01') exists<br/>→ update status: complete ✓<br/>No duplicate card created
```

**This is the race the assignment says to look for.** The fix is that `processServerEvent` for `TOOL_RESULT` always does `get` then `update` — never `set` on a new key unless the key doesn't exist.

---

### 4. Corrupt PING

```mermaid
flowchart LR
    Server["Server sends\n{ type: PING, seq: N, challenge: '' }"]
    Parser["parser.ts\nisString('') → true\nParseResult: ok"]
    Hook["useAgentRuntime.ts\nsend({ type: PONG, echo: '' })"]
    Server2["Server receives\n{ echo: '' }\nmatch: challenge === '' ✓\nlogs 'ok'"]

    Server --> Parser --> Hook --> Server2
```

**No crash.** The parser accepts empty strings for `challenge` because `isString("")` returns `true`. The PONG is sent with `echo: ""` which exactly matches the challenge.

---

### 5. Oversized Context (500KB+)

The `ContextInspector` uses `LazyJsonTree` which renders JSON as a collapsible DOM tree rather than a single `JSON.stringify` into a `<pre>`. Only expanded nodes render their children. An object with 1000 keys renders as a single collapsed `{ 1000 keys }` button until clicked.

| Approach | 500KB payload |
|---|---|
| `<pre>{JSON.stringify(data)}</pre>` | Freezes tab during stringify + DOM insertion |
| `LazyJsonTree` (our approach) | Root renders instantly; children mount on demand |

## Failure Coverage in Tests

| Failure Mode | Test File | Test Name |
|---|---|---|
| Out-of-order delivery | `sequence-buffer.test.ts` | "buffers future events and drains after gap" |
| Fully reversed sequence | `sequence-buffer.test.ts` | "drains a fully-reversed sequence [5,4,3,2,1]" |
| Duplicate messages | `sequence-buffer.test.ts` | "deduplicates processed and pending events" |
| Out-of-order TOOL_RESULT | `chaos/out-of-order-tool-result.test.ts` | "buffers TOOL_RESULT until TOOL_CALL is processed" |
| Token idempotency | `event-processor.test.ts` | "does not duplicate token text for same seq" |
| Rapid tool calls | `event-processor.test.ts` | "handles two sequential tool calls without overwriting" |
| Context dedup | `event-processor.test.ts` | "does not duplicate a snapshot with same seq" |
| Corrupt PING | `event-processor.test.ts` | "handles empty challenge without throwing" |
