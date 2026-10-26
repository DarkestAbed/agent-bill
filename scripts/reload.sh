#!/usr/bin/env bash
# reload.sh — restart the Cinnamon shell WITHOUT logging out.
# Run this ON THE LMDE 7 TARGET MACHINE, inside the Cinnamon session.
# This is the scripted equivalent of: Alt+F2, type 'r', Enter.
set -euo pipefail

if ! command -v cinnamon >/dev/null 2>&1; then
    echo "ERROR: 'cinnamon' not found. Are you running this inside a Cinnamon session?" >&2
    exit 1
fi

# Replace the running Cinnamon instance in place.
# IMPORTANT: do NOT discard stderr. C-level Clutter assertions ("Bail out!
# …") and JS errors from the shell go to stderr; if the new shell crashes
# during startup, this log is the ONLY place the reason survives (the process
# is fire-and-forget, so its output would otherwise be lost forever).
LOG="$HOME/.local/share/cinnamon/cinnamon-replace.log"
mkdir -p "$(dirname "$LOG")"
echo "=== cinnamon --replace started $(date -Is) ===" >> "$LOG"
cinnamon --replace >>"$LOG" 2>&1 &

echo "Cinnamon shell reload requested."
echo "If it crashes, the reason is in: $LOG"
