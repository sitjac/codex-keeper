#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  . "${NVM_DIR}/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[codex-keeper] node was not found in PATH. Install Node.js >= 20 or configure NVM_DIR." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[codex-keeper] npm was not found in PATH. Install npm >= 10 or configure NVM_DIR." >&2
  exit 1
fi

cd "${REPO_ROOT}"
exec npm run serve -- "$@"
