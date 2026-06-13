#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: bash eval/run-scenario.sh <scenario-name>" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scenario="$1"
prompt="$repo_root/eval/prompts/$scenario.md"
opencode_bin="${OPENCODE_BIN:-opencode}"

if [[ ! -f "$prompt" ]]; then
  echo "missing prompt: $prompt" >&2
  exit 2
fi

if ! command -v "$opencode_bin" >/dev/null 2>&1; then
  if [[ "$opencode_bin" == "opencode" && -x "$HOME/.opencode/bin/opencode" ]]; then
    opencode_bin="$HOME/.opencode/bin/opencode"
  else
    echo "missing opencode binary: $opencode_bin" >&2
    exit 127
  fi
fi

cd "$repo_root"
"$opencode_bin" run --dangerously-skip-permissions --print-logs --log-level INFO "$(cat "$prompt")"
