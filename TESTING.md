# Testing

## Run

```powershell
npm test        # run all 30 tests once
npm run test:watch  # watch mode
```

## Test Coverage Map

```mermaid
graph TD
    subgraph SB ["sequence-buffer.test.ts (13 tests)"]
        SB1["In-order processing"]
        SB2["Gap buffering + drain"]
        SB3["Duplicate: pending event"]
        SB4["Duplicate: processed event"]
        SB5["Mixed dedup + gaps"]
        SB6["Single event seq=1"]
        SB7["Single future event seq=5"]
        SB8["Fully reversed [5,4,3,2,1]"]
        SB9["Large gap drain [1..10]"]
        SB10["resetAfterResume sets expectedSeq"]
        SB11["resetAfterResume clears stale pending"]
        SB12["Metrics after mixed events"]
        SB13["Empty buffer metrics"]
    end

    subgraph EP ["event-processor.test.ts (14 tests)"]
        EP1["Token dedup by seq"]
        EP2["Token group accumulation"]
        EP3["Token group flush on STREAM_END"]
        EP4["New group on stream_id change"]
        EP5["flushActiveTokenGroup() manual"]
        EP6["Tool card update on TOOL_RESULT"]
        EP7["No duplicate card on replayed TOOL_CALL"]
        EP8["Two sequential tool calls independent"]
        EP9["STREAM_END sets status=complete"]
        EP10["waiting_tool → streaming on TOOL_RESULT"]
        EP11["Context snapshot dedup by seq"]
        EP12["Context snapshot append new seq"]
        EP13["contextHistoryIndex resets on new snapshot"]
        EP14["Corrupt PING empty challenge no crash"]
    end

    subgraph CHAOS ["chaos/out-of-order-tool-result.test.ts (1 test)"]
        C1["TOOL_RESULT buffered until TOOL_CALL seq arrives"]
    end

    subgraph SM ["state-machine.test.ts (1 test)"]
        SM1["Full lifecycle: disconnect→connect→stream→tool→reconnect→resume"]
    end

    subgraph JD ["json-diff.test.ts (1 test)"]
        JD1["Diff detection: added, removed, changed"]
    end
```

## What Each Test Proves for the Assignment

| Assignment Requirement | Covered By |
|---|---|
| Out-of-order messages rendered correctly | `SB2`, `SB8`, `SB9`, `C1` |
| Duplicate messages deduplicated | `SB3`, `SB4`, `SB5`, `EP7`, `EP11` |
| Token text not duplicated on replay | `EP1` |
| Tool call card not duplicated on replay | `EP7` |
| Tool calls resolved independently | `EP8` |
| TOOL_RESULT finds existing card (no new card) | `EP6` |
| State machine transitions correct | `SM1` |
| Context diff correctly computed | `JD1` |
| Token group accumulates, flushes on boundary | `EP2`, `EP3`, `EP4`, `EP5` |
| RESUME sends correct last_seq | `SB10`, `SB11` |
| Corrupt PING handled without crash | `EP14` |

## Protocol Compliance Verification (Manual)

After running the app against the server, check `http://localhost:4747/log`.

```mermaid
flowchart LR
    App["App running\nnpm run dev"]
    Server["agent-server\ndocker run -p 4747:4747 agent-server"]
    Log["GET http://localhost:4747/log"]
    Check["Verify JSON array contains:\n- PONG verdict: ok\n- TOOL_ACK verdict: ok\n- RESUME verdict: ok\n- No PONG_TIMEOUT violations\n- No TOOL_ACK_TIMEOUT violations"]

    App -->|connects| Server
    Server --> Log
    Log --> Check
```

### Expected `/log` entries after a normal session

```json
[
  { "type": "USER_MESSAGE", "verdict": "ok" },
  { "type": "PONG",         "verdict": "ok",    "data": { "latency_ms": 12 } },
  { "type": "TOOL_ACK",     "verdict": "ok",    "data": { "call_id": "tc_..." } },
  { "type": "RESUME",       "verdict": "ok",    "data": { "last_seq": 7 } }
]
```

Any `"verdict": "violation"` entry means a protocol requirement was missed.

<img src="image-2.png" width="900" alt="Test results — all passing" />