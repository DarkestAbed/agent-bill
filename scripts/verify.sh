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
         lib/http.js lib/keyring.js lib/usage.js lib/ui.js lib/keydialog.js lib/localauth.js; do
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

# 7b. No GNOME Shell-isms: imports.misc.extensionUtils / Me.imports do NOT
# exist in Cinnamon 6.x — using them crashes the desklet at load time.
# Cinnamon extensions must use require('./relative/path.js') instead.
# (Comment-only lines are excluded so docs can mention the anti-pattern.)
if grep -rInE 'imports\.misc\.extensionUtils|Me\.imports\.' "$DESKLET_DIR" 2>/dev/null | grep -vE ':\s*//' | grep -qE 'imports\.misc\.extensionUtils|Me\.imports\.'; then
    bad "GNOME Shell import pattern found (extensionUtils / Me.imports) — use require() instead!"
    grep -rInE 'imports\.misc\.extensionUtils|Me\.imports\.' "$DESKLET_DIR" | grep -vE ':\s*//' || true
else
    ok "no GNOME Shell import patterns (extensionUtils / Me.imports)"
fi

# 7c. No Clutter.UnicodeChar — removed in Cinnamon 6.x's Clutter 0.
# Use St.PasswordEntry or set_password_char('●') instead.
if grep -rIn 'Clutter\.UnicodeChar' "$DESKLET_DIR" 2>/dev/null | grep -vE ':\s*//' | grep -q 'Clutter\.UnicodeChar'; then
    bad "Clutter.UnicodeChar found — removed in Cinnamon 6.x, use St.PasswordEntry or a string char"
else
    ok "no Clutter.UnicodeChar references"
fi

# 7d. require() paths must be desklet-root-relative (no '../'). Cinnamon's
# requireModule mangles '../' with a naive replace(/\.\//g, '') → '.lib/…',
# which resolves to a nonexistent path and crashes the module load.
if grep -rInE "require\(['\"]\.\./" "$DESKLET_DIR" 2>/dev/null | grep -vE ':\s*//' | grep -qE "require\(['\"]\.\./"; then
    bad "require('../…') found — Cinnamon's require() is desklet-root-relative, use require('./…') instead!"
    grep -rInE "require\(['\"]\.\./" "$DESKLET_DIR" | grep -vE ':\s*//' || true
else
    ok "no require('../…') up-level paths (Cinnamon require is root-relative)"
fi

# 7e. No remove_child() without destroy() — Clutter 6 aborts the WHOLE SHELL
# (SIGABRT: clutter_actor_dispose assertion failed: priv->parent == NULL) if
# an actor is removed from its parent but later disposed, OR if an actor is
# destroyed while still parented. The safe patterns are:
#   - update in place (style/text) instead of swapping actors
#   - remove_child(x) followed immediately by x.destroy()  ← see ui.js destroy()
#   - parent.set_child(new) — St.Bin unparents the old child correctly
# A bare remove_child() that leaves the actor alive (relying on GC) is the
# crash-#2 trigger. (Comment-only lines are excluded; the one allowed call
# site is card.destroy() in lib/ui.js, which pairs it with .destroy().)
if grep -rInE '\.remove_child\(' "$DESKLET_DIR" 2>/dev/null \
   | grep -vE ':\s*//' \
   | grep -vE 'lib/ui\.js:[0-9]+:\s*parent\.remove_child\(this\.actor\);' \
   | grep -qE '\.remove_child\('; then
    bad "bare remove_child() found — must be followed by .destroy() or use set_child()/in-place update (crashes Cinnamon 6 shell)"
    grep -rInE '\.remove_child\(' "$DESKLET_DIR" | grep -vE ':\s*//' || true
else
    ok "no bare remove_child() (Clutter 6 shell-abort guard)"
fi

# 7f. Every async callback that touches actors must be guarded. In Cinnamon a
# desklet can be removed/reloaded while HTTP/keyring promises are in flight;
# touching disposed actors from those callbacks crashes the shell. The
# desklet.js pattern is: this._destroyed = true in on_desklet_removed/reloaded,
# and every .then() callback checks `if (this._destroyed) return;` first.
if ! grep -q '_destroyed' "$DESKLET_DIR/desklet.js"; then
    bad "desklet.js missing _destroyed guard (async callbacks can touch disposed actors → shell crash)"
else
    ok "desklet.js has _destroyed lifecycle guard"
fi

# 7g. No percentage CSS widths on St actors. Cinnamon's St does NOT support
# percentage lengths ("St-WARNING: percentage lengths not currently supported")
# — a `width: N%` or `border-radius: 50%` style is silently ignored (and
# logged on every repaint).
# Use fixed pixel sizes (Clutter actor.set_size) instead.
if grep -rInE '(width|height|radius|padding|margin|spacing|size):\s*[0-9.]+%' "$DESKLET_DIR" 2>/dev/null | grep -vE ':\s*//' | grep -qE '(width|height|radius|padding|margin|spacing|size):\s*[0-9.]+%'; then
    bad "percentage CSS length found (width/radius/…) — St ignores % lengths, use set_size(px) instead"
    grep -rInE '(width|height|radius|padding|margin|spacing|size):\s*[0-9.]+%' "$DESKLET_DIR" | grep -vE ':\s*//' || true
else
    ok "no percentage CSS lengths (St ignores them; pixel set_size used instead)"
fi

# 7h. Fetch errors must be surfaced on the card. A rejected provider fetch
# used to be silently skipped (card stuck on "waiting for first refresh…"
# forever — hid the Anthropic 403 for plan users). desklet.js must render the
# error, not swallow it.
if grep -q "renderError(this._errorText" "$DESKLET_DIR/desklet.js"; then
    ok "desklet.js surfaces fetch errors on the card (renderError)"
else
    bad "desklet.js does not surface fetch errors on the card (rejected fetches are silently skipped)"
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
