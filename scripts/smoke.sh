#!/usr/bin/env bash
# smoke.sh — INTEGRATION smoke test for agent-bill. Run ON THE LMDE 7 TARGET.
# This is the layer that needs a real Cinnamon/GJS/keyring, so it cannot run
# in the WSL dev sandbox. It verifies the installed desklet and round-trips a
# throwaway secret through the real lib/keyring.js under GJS.
#
# Usage:
#   ./scripts/smoke.sh                 # install + files + metadata + keyring + leak checks
#   ./scripts/smoke.sh --reload        # also restart the Cinnamon shell afterwards
#   ./scripts/smoke.sh --repo /path    # use a specific repo (default: auto)
set -uo pipefail

UUID="agent-bill@DarkestAbed"
REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
DO_RELOAD=0
INSTALLED="$HOME/.local/share/cinnamon/desklets/$UUID"

pass=0; fail=0
ok()  { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
note(){ echo "NOTE: $1"; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --reload) DO_RELOAD=1; shift ;;
        --repo)   REPO="$2"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

echo "== agent-bill smoke (target) =="

# 0. environment
command -v gjs >/dev/null 2>&1 && ok "gjs present" || bad "gjs missing (install: sudo apt install gjs)"
command -v jq  >/dev/null 2>&1 && ok "jq present"  || note "jq missing (JSON checks will be skipped)"

# 1. install (idempotent)
if "$REPO/scripts/install.sh" "$REPO" >/dev/null 2>&1; then
    ok "install.sh ran"
else
    bad "install.sh failed"
fi

# 2. all expected files present in the installed desklet
EXPECTED="metadata.json desklet.js settings-schema.json providers/base.js providers/claude.js providers/codex.js providers/ollama.js lib/http.js lib/keyring.js lib/usage.js lib/ui.js lib/keydialog.js"
for f in $EXPECTED; do
    [[ -f "$INSTALLED/$f" ]] && ok "installed: $f" || bad "missing installed: $f"
done

# 3. metadata uuid matches folder + JSON validity
if command -v jq >/dev/null 2>&1; then
    mu="$(jq -r .uuid "$INSTALLED/metadata.json" 2>/dev/null)"
    [[ "$mu" == "$UUID" ]] && ok "metadata uuid == folder ($UUID)" || bad "uuid mismatch (metadata=$mu)"
    jq -e . "$INSTALLED/settings-schema.json" >/dev/null 2>&1 \
        && ok "settings-schema.json valid JSON" || bad "settings-schema.json invalid JSON"
fi

# 4. syntax-check installed JS (only if node is present)
if command -v node >/dev/null 2>&1; then
    allok=1
    while IFS= read -r f; do
        node --check "$f" 2>/dev/null || { allok=0; bad "syntax: ${f#"$INSTALLED"/}"; }
    done < <(find "$INSTALLED" -name '*.js')
    [[ $allok -eq 1 ]] && ok "all installed JS syntax OK (node --check)"
else
    note "node not present; skipping JS syntax check (the Cinnamon render is the real load test)"
fi

# 5. libsecret available + keyring round-trip via the REAL lib/keyring.js under gjs
if command -v gjs >/dev/null 2>&1; then
    if gjs -c "imports.gi.Secret;" 2>/dev/null; then
        ok "libsecret (Secret) loadable in GJS"
    else
        bad "libsecret not available (install: sudo apt install gir1.2-secret-1)"
    fi
    if AGENT_BILL_DESKLET_DIR="$INSTALLED" gjs "$REPO/scripts/smoke-keyring.js"; then
        ok "keyring round-trip via lib/keyring.js"
    else
        bad "keyring round-trip failed (see scripts/smoke-keyring.js output)"
    fi
else
    bad "gjs missing; cannot run keyring integration test"
fi

# 6. no plaintext secrets in the installed files
if grep -rIl "roundtrip-value-123" "$INSTALLED" >/dev/null 2>&1; then
    bad "smoke test value leaked into installed files!"
else
    ok "no plaintext test secret in installed files"
fi
if grep -rInE "sk-ant-admin01-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}" "$INSTALLED" >/dev/null 2>&1; then
    bad "hardcoded API key pattern found in installed files!"
else
    ok "no hardcoded API key pattern in installed files"
fi

# 7. optional Cinnamon reload
if [[ $DO_RELOAD -eq 1 ]]; then
    if "$REPO/scripts/reload.sh"; then
        ok "reload.sh requested (Cinnamon shell restarting)"
        note "after reload: right-click desktop -> Add desklets -> Agent Bill, then add your API keys in its settings"
    else
        bad "reload.sh failed"
    fi
fi

echo "== smoke result: $pass passed, $fail failed =="
[[ $fail -eq 0 ]]
