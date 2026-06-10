#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: bash eval/run-scenario.sh <scenario-name>" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scenario="$1"
prompt="$repo_root/eval/prompts/$scenario.md"

if [[ ! -f "$prompt" ]]; then
  echo "missing prompt: $prompt" >&2
  exit 2
fi

cd "$repo_root/eval"
opencode run --dangerously-skip-permissions --print-logs --log-level INFO "$(cat "$prompt")"
