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
cinnamon --replace >/dev/null 2>&1 &

echo "Cinnamon shell reload requested."
