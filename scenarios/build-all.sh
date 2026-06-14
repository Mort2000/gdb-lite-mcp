#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="$root_dir/scenarios/bin"
mkdir -p "$bin_dir"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

gcc -g -O0 -Wall -Wextra "$root_dir/scenarios/wrong-result-ledger/ledger.c" -o "$bin_dir/ledger"
gcc -g -O0 -Wall -Wextra "$root_dir/scenarios/crash-sparse-cache/sparse_cache.c" -o "$bin_dir/sparse-cache"
gcc -g -O0 -Wall -Wextra "$root_dir/scenarios/hang-tokenizer/tokenizer.c" -o "$bin_dir/tokenizer"
gcc -g -O0 -Wall -Wextra "$root_dir/scenarios/memory-corruption-packet/packet.c" -o "$bin_dir/packet"
gcc -g -O0 -Wall -Wextra "$root_dir/scenarios/recursion-memo-cost/memo_cost.c" -o "$bin_dir/memo-cost"
gcc -g -O0 -Wall -Wextra "$root_dir/scenarios/hang-settlement-cursor/settlement_cursor.c" -o "$bin_dir/settlement-cursor"
gcc -g -O0 -Wall -Wextra "$root_dir/scenarios/core-invoice-export/invoice_export.c" -o "$bin_dir/invoice-export"
gcc -O2 -g0 -Wall -Wextra \
  -I "$root_dir/scenarios/wrong-result-risk-buckets" \
  -c "$root_dir/eval/private_sources/wrong-result-risk-buckets/risk_digest.c" \
  -o "$tmp_dir/risk_digest.o"
objcopy --strip-symbol risk_digest.c "$tmp_dir/risk_digest.o"
gcc -g -O0 -Wall -Wextra \
  "$root_dir/scenarios/wrong-result-risk-buckets/risk_buckets.c" \
  "$tmp_dir/risk_digest.o" \
  -o "$bin_dir/risk-buckets"

invoice_core="$bin_dir/invoice-export.core"
rm -f "$invoice_core"
gdb --quiet --nx --nh --batch \
  -ex "set pagination off" \
  -ex "set confirm off" \
  -ex "run" \
  -ex "generate-core-file $invoice_core" \
  -ex "quit" \
  "$bin_dir/invoice-export" >/dev/null 2>&1 || true

if [[ ! -f "$invoice_core" ]]; then
  echo "failed to generate invoice-export core file: $invoice_core" >&2
  exit 1
fi

echo "built debug programs in $bin_dir"
