# memory-corruption-binary-bridge

This scenario models an API integration bug between visible C glue code and a
black-box vendor library. The vendor parser reads a binary manifest feed,
assembles a canonical key into a caller-provided buffer, and reports the full
required length. The visible caller assumes the truncated result is still a C
string and passes it to another black-box in-place string API, causing a write
past the fixed buffer into an adjacent canary.
