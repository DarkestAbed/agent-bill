#!/usr/bin/env bash
# install.sh — install the agent-bill desklet into Cinnamon.
# Run this ON THE LMDE 7 TARGET MACHINE (after cloning the repo there via git).
#
# Usage:
#   ./scripts/install.sh                 # auto-detects the repo next to this script
#   ./scripts/install.sh /path/to/repo   # explicit repo path
set -euo pipefail

UUID="agent-bill@DarkestAbed"

# Resolve the desklet source folder inside the repo.
if [[ $# -ge 1 ]]; then
    REPO="$1"
else
    REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
fi

SRC="$REPO/desklet/$UUID"
DESKLET_DIR="$HOME/.local/share/cinnamon/desklets"
DEST="$DESKLET_DIR/$UUID"

if [[ ! -d "$SRC" ]]; then
    echo "ERROR: desklet source not found at $SRC" >&2
    echo "       Is the repo cloned and does it contain desklet/$UUID ?" >&2
    exit 1
fi

mkdir -p "$DESKLET_DIR"
rm -rf "$DEST"
cp -r "$SRC" "$DEST"

echo "Installed $UUID -> $DEST"
echo "Next: reload the Cinnamon shell (./scripts/reload.sh or Alt+F2, type 'r'),"
echo "      then add the desklet: right-click desktop -> Add desklets -> Agent Bill."
