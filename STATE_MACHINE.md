# State Machine

The WebSocket connection lifecycle is modelled as an explicit finite state machine. Every state transition is validated — invalid events for the current state are no-ops.

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> DISCONNECTED

    DISCONNECTED --> CONNECTING : connect()

    CONNECTING --> CONNECTED : socket.onopen\n(fresh connection)
    CONNECTING --> FAILED : socket.onerror

    CONNECTED --> STREAMING : USER_MESSAGE sent\nor TOKEN received
    CONNECTED --> RECONNECTING : socket drop

    STREAMING --> WAITING_TOOL_RESULT : TOOL_CALL received
    STREAMING --> CONNECTED : STREAM_END received
    STREAMING --> RECONNECTING : socket drop

    WAITING_TOOL_RESULT --> STREAMING : TOOL_RESULT received
    WAITING_TOOL_RESULT --> CONNECTED : STREAM_END received
    WAITING_TOOL_RESULT --> RECONNECTING : socket drop

    RECONNECTING --> RESUMING : socket.onopen\n(sends RESUME as first msg)
    RECONNECTING --> RECONNECTING : backoff timer fires\n(500→1000→2000→4000→10000ms)

    RESUMING --> CONNECTED : replayed events\nfully processed
    RESUMING --> FAILED : socket.onerror

    FAILED --> CONNECTING : manual reconnect button
```

## Transition Table

| Current State | Event | Next State | Side Effect |
|---|---|---|---|
| DISCONNECTED | CONNECT | CONNECTING | Open WebSocket |
| CONNECTING | OPEN (fresh) | CONNECTED | Start heartbeat |
| CONNECTING | OPEN (reconnect) | RESUMING | Send `RESUME {last_seq}` |
| CONNECTING | FAIL | FAILED | Show error |
| CONNECTED | USER_MESSAGE | STREAMING | Send USER_MESSAGE |
| CONNECTED | DROP | RECONNECTING | Schedule backoff |
| STREAMING | TOOL_CALL | WAITING_TOOL_RESULT | Freeze stream text, show card |
| STREAMING | STREAM_END | CONNECTED | Flush token group |
| STREAMING | DROP | RECONNECTING | Schedule backoff |
| WAITING_TOOL_RESULT | TOOL_RESULT | STREAMING | Update card with result |
| WAITING_TOOL_RESULT | DROP | RECONNECTING | Card stays "waiting" |
| RECONNECTING | OPEN | RESUMING | Send `RESUME` first |
| RESUMING | RESUME_COMPLETE | CONNECTED | Normal operation |
| FAILED | CONNECT | CONNECTING | Manual retry |

## Implementation

```mermaid
flowchart LR
    SM["state-machine.ts\ntransitionConnection(state, event)"]
    Hook["useAgentRuntime.ts\nsocket.onopen / onclose / onerror"]
    EP2["event-processor.ts\nprocessServerEvent()"]

    Hook -->|calls transition| SM
    EP2 -->|sets connectionState directly\nfor protocol events| State["AppState.connectionState"]
    SM --> State
```

> **Design note:** `transitionConnection` is a pure function exported separately from the hook so it can be unit-tested in isolation without mocking WebSocket. The hook owns the actual socket lifecycle.
