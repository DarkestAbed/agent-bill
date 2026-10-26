#!/usr/bin/env bash
# verify.sh — verification gate for the agent-bill desklet.
# Runs in the WSL/dev sandbox where Cinnamon and GJS are NOT available.
# It checks: JSON validity, JS syntax (node --check), UUID/folder match,
# required files presence, settings-schema callbacks exist in JS, AND runs
# the unit-test suite (node --test tests/) for the pure-logic module
# (lib/usage.js). For the real integration test on the target, use smoke.sh.
set -uo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
DESKLET_DIR="$REPO/desklet/agent-bill@DarkestAbed"
UUID="agent-bill@DarkestAbed"

pass=0; fail=0
ok()   { echo "PASS: $1"; pass=$((pass+1)); }
bad()  { echo "FAIL: $1"; fail=$((fail+1)); }

echo "== agent-bill verify =="

# 1. Required files exist
for f in metadata.json desklet.js settings-schema.json \
         providers/base.js providers/claude.js providers/codex.js providers/ollama.js \
         lib/http.js lib/keyring.js lib/usage.js lib/ui.js lib/keydialog.js; do
    if [[ -f "$DESKLET_DIR/$f" ]]; then ok "file exists: $f"; else bad "missing file: $f"; fi
done

# 2. metadata.json is valid JSON and UUID matches folder
if jq -e . "$DESKLET_DIR/metadata.json" >/dev/null 2>&1; then
    ok "metadata.json is valid JSON"
else
    bad "metadata.json is NOT valid JSON"
fi
meta_uuid="$(jq -r .uuid "$DESKLET_DIR/metadata.json" 2>/dev/null)"
if [[ "$meta_uuid" == "$UUID" ]]; then ok "metadata uuid matches folder ($UUID)"; else bad "uuid mismatch: folder=$UUID metadata=$meta_uuid"; fi

# 3. settings-schema.json is valid JSON
if jq -e . "$DESKLET_DIR/settings-schema.json" >/dev/null 2>&1; then
    ok "settings-schema.json is valid JSON"
else
    bad "settings-schema.json is NOT valid JSON"
fi

# 4. Every JS file passes node --check (syntax only; GJS imports are not resolved)
mapfile -t jsfiles < <(find "$DESKLET_DIR" -name '*.js' | sort)
for f in "${jsfiles[@]}"; do
    if node --check "$f" 2>/dev/null; then
        ok "syntax OK: ${f#$REPO/}"
    else
        bad "syntax ERROR: ${f#$REPO/}"
        node --check "$f" || true
    fi
done

# 5. settings-schema callbacks are defined in desklet.js
mapfile -t callbacks < <(jq -r '.. | objects | select(has("callback")) | .callback' "$DESKLET_DIR/settings-schema.json" | sort -u)
for cb in "${callbacks[@]}"; do
    if grep -q "$cb" "$DESKLET_DIR/desklet.js"; then
        ok "callback '$cb' defined in desklet.js"
    else
        bad "callback '$cb' NOT found in desklet.js"
    fi
done

# 6. desklet.js defines the required entry point
if grep -q "function main(metadata, deskletId)" "$DESKLET_DIR/desklet.js"; then
    ok "desklet.js exports main(metadata, deskletId)"
else
    bad "desklet.js missing main(metadata, deskletId)"
fi

# 7. No plaintext secrets committed: fail if any file looks like a real key.
if grep -rInE "sk-ant-admin01-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_-]{20,}" "$DESKLET_DIR" >/dev/null 2>&1; then
    bad "possible hardcoded API key found in desklet source!"
else
    ok "no hardcoded API keys in source"
fi

# 8. Unit tests (node --test) for the pure-logic module lib/usage.js.
if command -v node >/dev/null 2>&1; then
    if node --test "$REPO"/tests/*.test.js >/tmp/agent-bill-tests.log 2>&1; then
        n_tests=$(grep -cE '^✔ ' /tmp/agent-bill-tests.log)
        n_fail=$(grep -cE '^✖ ' /tmp/agent-bill-tests.log)
        ok "unit tests (node --test): ${n_tests:-0} passed, ${n_fail:-0} failed"
    else
        bad "unit tests FAILED — see /tmp/agent-bill-tests.log"
        tail -40 /tmp/agent-bill-tests.log || true
    fi
else
    bad "node not found; cannot run unit tests"
fi

echo "== result: $pass passed, $fail failed =="
[[ $fail -eq 0 ]]
