#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-install}"
if [[ "$#" -gt 0 ]]; then shift; fi
exec node "$ROOT/scripts/install-core.js" "$ACTION" "$@"
