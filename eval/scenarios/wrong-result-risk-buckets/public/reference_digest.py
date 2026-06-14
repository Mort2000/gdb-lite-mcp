#!/usr/bin/env python3

import json
import sys

MASK32 = 0xFFFFFFFF
FNV_SEED = 2166136261
FNV_PRIME = 16777619


def classify_score(score):
    if score >= 30000000:
        return 3
    if score >= 10000000:
        return 2
    if score >= 2500000:
        return 1
    return 0


def _field(position, name):
    if isinstance(position, dict):
        return position[name]
    return position[name]


def reference_score(position):
    net_exposure = int(_field(position, "exposure_cents")) - int(
        _field(position, "collateral_cents")
    )
    return (net_exposure * int(_field(position, "volatility_bp"))) // 100


def reference_bucket(position):
    return classify_score(reference_score(position))


def mix_u32(digest, value):
    digest ^= int(value) & MASK32
    return (digest * FNV_PRIME) & MASK32


def mix_id(digest, position_id):
    if isinstance(position_id, str):
        position_id = position_id.encode("ascii")
    elif hasattr(position_id, "string"):
        position_id = position_id.string().encode("ascii")
    else:
        values = []
        for value in position_id:
            byte = int(value) & 0xFF
            if byte == 0:
                break
            values.append(byte)
        position_id = values
    for value in position_id:
        digest = mix_u32(digest, value)
    return digest


def reference_digest(positions):
    digest = FNV_SEED
    for position in positions:
        digest = mix_id(digest, _field(position, "id"))
        digest = mix_u32(digest, _field(position, "exposure_cents"))
        digest = mix_u32(digest, _field(position, "collateral_cents"))
        digest = mix_u32(digest, _field(position, "volatility_bp"))
        digest = mix_u32(digest, reference_bucket(position))
    return digest


def main():
    positions = json.load(sys.stdin)
    print(f"reference_digest=0x{reference_digest(positions):08x}")


if __name__ == "__main__":
    main()
