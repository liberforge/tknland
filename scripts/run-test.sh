#!/usr/bin/env bash
# Run the tkn.land staging user-journey battery.
# Loads secrets from scripts/.env.staging-test (gitignored).
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
cd "$ROOT"

ENV_FILE="${METTAL_STG_ENV_FILE:-$SCRIPTS/.env.staging-test}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Copy scripts/.env.example.staging-test to scripts/.env.staging-test and fill secrets." >&2
  exit 1
fi

export METTAL_STG_ENV_FILE="$ENV_FILE"
# Gates / fixtures can still be overridden from the shell; defaults live in .env.staging-test
export TKN_RECEIVER_ADDRESS="${TKN_RECEIVER_ADDRESS:-0x8aF993d76a2f723238d38188990f801b1Fbb80D3}"
export METTAL_STG_BANK_CCI="${METTAL_STG_BANK_CCI:-03500000155325374494}"

exec node "$SCRIPTS/user-journey-battery.mjs" "$@"
