# memory-corruption-packet

## Purpose

Evaluates memory-corruption debugging with a watchpoint-friendly adjacent-field overwrite.

## User-Visible Project

The workspace contains `src/packet.c` and `bin/packet`.

## Hidden Build Inputs

None.

## Expected Diagnosis

`load_label` copies `strlen(source) + 1` bytes from `"priority-high"` into `packet->label[8]`, overflowing into adjacent fields and corrupting `checksum`.

## Anti-Cheat Notes

The prompt names the changed checksum but not the overflowing copy site.
