# GDB Lite MCP Debug Scenarios

These scenarios are intentionally small but non-trivial native debugging tasks for evaluating GDB Lite MCP plus the `gdb-debugging` Skill.

Build all programs:

```bash
bash scenarios/build-all.sh
```

Programs are written to `scenarios/bin/`.

## Scenarios

| Scenario | Program | Symptom |
| --- | --- | --- |
| wrong-result-ledger | `scenarios/bin/ledger` | Returns failure after one floating-point reconciliation round fails an exact comparison. |
| crash-sparse-cache | `scenarios/bin/sparse-cache` | Segfaults while reading a cache entry. |
| hang-tokenizer | `scenarios/bin/tokenizer` | Hangs while tokenizing an identifier string. |
| memory-corruption-packet | `scenarios/bin/packet` | A checksum field changes unexpectedly after loading a label. |
| recursion-memo-cost | `scenarios/bin/memo-cost` | Recursive optimizer returns a cost lower than the expected cost. |
| hang-settlement-cursor | `scenarios/bin/settlement-cursor` | Hangs while replaying a settlement journal. |
| core-invoice-export | `scenarios/bin/invoice-export` with `scenarios/bin/invoice-export.core` | Core file shows a crash during invoice export. |

## Evaluation Rule

Ask the agent to localize the root cause without editing source. A successful run should report:

1. Exact root cause and source location.
2. Expected invariant versus actual runtime state.
3. Decisive GDB evidence from the MCP session.

For Skill versus no-Skill comparisons, record interaction count and evidence quality outside the prompt so the prompt stays natural in both modes.
