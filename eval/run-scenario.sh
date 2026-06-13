#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: bash eval/run-scenario.sh <scenario-name>" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scenario="$1"
mode="skill"
prompt_scenario="$scenario"
if [[ "$scenario" == no-skill/* ]]; then
  mode="no-skill"
  prompt_scenario="${scenario#no-skill/}"
fi

prompt="$repo_root/eval/prompts/$prompt_scenario.md"
opencode_bin="${OPENCODE_BIN:-opencode}"

if [[ ! -f "$prompt" ]]; then
  echo "missing prompt: $prompt" >&2
  exit 2
fi

if [[ ! -f "$repo_root/dist/index.js" ]]; then
  echo "missing dist/index.js; run npm run build first" >&2
  exit 2
fi

if [[ ! -d "$repo_root/scenarios/bin" ]]; then
  echo "missing scenarios/bin; run bash scenarios/build-all.sh first" >&2
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

safe_name="${scenario//\//-}"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/gdb-lite-eval-${safe_name}.XXXXXX")"
cleanup() {
  if [[ "${EVAL_KEEP_WORKSPACE:-0}" == "1" ]]; then
    echo "kept eval workspace: $workspace" >&2
  else
    rm -rf "$workspace"
  fi
}
trap cleanup EXIT

cp -a "$repo_root/scenarios" "$workspace/scenarios"
if [[ "$mode" == "skill" ]]; then
  mkdir -p "$workspace/.opencode/skills"
  cp -a "$repo_root/skills/." "$workspace/.opencode/skills/"
fi

skill_permission='{}'
if [[ "$mode" == "skill" ]]; then
  skill_permission='{"skill":{"gdb-debugging":"allow"}}'
fi

cat > "$workspace/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "permission": $skill_permission,
  "mcp": {
    "gdb-lite": {
      "type": "local",
      "command": ["node", "$repo_root/dist/index.js"],
      "enabled": true,
      "timeout": 30000
    }
  }
}
JSON

echo "eval workspace: $workspace" >&2
echo "scenario: $scenario" >&2
echo "skill visibility: $mode" >&2

cd "$workspace"
"$opencode_bin" run --dangerously-skip-permissions --print-logs --log-level INFO "$(cat "$prompt")"
