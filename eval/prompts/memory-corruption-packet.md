The program `scenarios/bin/packet` changes a packet checksum unexpectedly after loading a label. Please debug it with GDB Lite MCP.

The source is under `scenarios/memory-corruption-packet/`. Do not edit files. Find the write that corrupts the checksum.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
