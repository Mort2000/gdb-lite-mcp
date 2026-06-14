#!/usr/bin/env python3
"""Generate the private binary manifest feed used by this scenario."""

from __future__ import annotations

import struct
import sys
from pathlib import Path


FIELDS = [
    (1, b"mort-asset-ops"),
    (2, b"ap-southeast-1"),
    (3, b"daily-rebalance"),
    (4, b"structured-energy-options"),
    (5, b"ultra-long-volatility-swap-tranche-2026-q4"),
    (6, b"batch-4096"),
]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: make_manifest_feed.py OUT", file=sys.stderr)
        return 2

    output = Path(argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)

    payload = bytearray(b"VMF1")
    payload.append(1)
    payload.append(len(FIELDS))
    for tag, value in FIELDS:
        payload.append(tag)
        payload.extend(struct.pack("<H", len(value)))
        payload.extend(value)

    output.write_bytes(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
