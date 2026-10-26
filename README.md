# agent-bill

A **big, dark-mode Linux Cinnamon desklet** that is a one-stop desktop dashboard for your
**Claude Code**, **Codex (OpenAI)** and **Ollama (cloud)** usage — per 5-hour window and
weekly allowance, refreshed on a configurable interval against your live accounts.

- **Target platform:** Linux Mint Debian Edition 7 (LMDE 7, Debian 13 based) with Cinnamon.
- **Language:** JavaScript via **GJS** (canonical for Cinnamon desklets), modern ES6 `class extends Desklet.Desklet`.
- **Distribution:** This is a **GitHub repository**. You manage the remote. The target machine clones/updates with `git` and runs the install/reload scripts locally.

## What it shows

Three provider cards in a dark theme, each with a **5-hour window** bar, **weekly usage**,
and token/request/cost stats:

| Provider | Data source | Auth |
|---|---|---|
| **Claude** | Anthropic Admin API `GET /v1/organizations/usage_report/messages` | Org **admin API key** (`sk-ant-admin01-…`) |
| **Codex** | OpenAI Admin API `GET /v1/organization/usage/completions` | Org **admin API key** (Bearer) |
| **Ollama** | Ollama cloud `GET https://ollama.com/api/usage` | Bearer key |

> The Codex card shows **weekly tokens used**; the allowance itself is your Codex **plan's
> weekly limit**, which the Usage API does not expose. Ollama cloud supports `24h/7d/30d`
> ranges (the UI `5h` clamps to `24h` for Ollama).

## Repository layout

```
agent-bill-desklet/
  desklet/agent-bill@DarkestAbed/     # the desklet (folder name == UUID)
    metadata.json                     # uuid, name, description, version
    settings-schema.json              # refresh interval, time range, per-provider
                                      # toggles, "enter API key" buttons (NO secrets)
    desklet.js                        # UI shell + refresh loop (GJS / ES6 class)
    providers/
      base.js                         # documented provider contract
      claude.js                       # Anthropic Admin API
      codex.js                        # OpenAI Admin API
      ollama.js                       # Ollama cloud /api/usage
    lib/
      http.js                         # libsoup3 async GET (never blocks the UI)
      keyring.js                      # GNOME keyring (libsecret) credential store
      usage.js                        # normalizes all providers -> UsageSnapshot
      ui.js                           # dark-theme widgets / provider cards
      keydialog.js                    # masked API-key entry dialog
  scripts/
    install.sh                        # copies desklet -> ~/.local/share/cinnamon/desklets/
    reload.sh                         # restarts the Cinnamon shell (no logout)
    verify.sh                         # static checks (JSON, JS syntax, UUID, secrets)
  .docs/questions.md                  # decision / Q&A log
  README.md
  .gitignore
```

The desklet **UUID** is `agent-bill@DarkestAbed`. The folder name must match the UUID exactly.

## Security

- **API keys are never in the repo or in `settings-schema.json`.** They are stored encrypted
  in the **GNOME keyring** (libsecret) under a per-desklet, per-provider attribute, entered
  through a masked dialog launched from the desklet's settings.
- `scripts/verify.sh` fails the build if a hardcoded key pattern is found in the source.

## Development loop (on your LMDE 7 machine)

These scripts run **on the target machine**, not in a WSL/dev sandbox.

1. **Get the code** (first time):
   ```bash
   git clone <repo-url> ~/agent-bill-desklet
   cd ~/agent-bill-desklet
   ```
2. **Verify** (optional, no Cinnamon needed):
   ```bash
   ./scripts/verify.sh
   ```
3. **Install the desklet**:
   ```bash
   ./scripts/install.sh
   ```
4. **Reload the Cinnamon shell** (equivalent of `Alt+F2` → `r`):
   ```bash
   ./scripts/reload.sh
   ```
5. **Add it to the desktop**: right-click the desktop → **Add desklets** → **Agent Bill**.
6. **Add your API keys**: open the desklet's settings (right-click the desklet → Configure)
   and use the **Enter … API key** buttons (Anthropic admin, OpenAI admin, Ollama).
7. **Iterate**: edit files, then `./scripts/install.sh && ./scripts/reload.sh`.

To pick up upstream changes later: `git pull`, then `install.sh` + `reload.sh`.

## Configuration (desklet settings)

- **Refresh interval** (minutes, default 5)
- **Time range**: Last 5 hours / Last 24 hours / Last 7 days
- Per-provider **enable** toggles (Claude / Codex / Ollama)
- **Enter / Remove API key** buttons per provider (stored in the keyring)

## Testing

Two layers, because the code needs both a sandbox and a real Cinnamon session:

- **Unit tests** (run anywhere Node is present, including this dev sandbox):
  ```bash
  npm test                 # == node --test tests/*.test.js
  ```
  Covers the pure-logic module `lib/usage.js` (token summation across nested
  provider `results[]` buckets, Anthropic/OpenAI/Ollama field mapping, the
  Ollama `5h`→`24h` clamp, range→`bucket_width`/`range` mappers, and
  error-isolation so one bad provider payload can't break the others). A tiny
  GJS shim (`tests/helpers/load-gjs.js`) loads the real module into Node by
  mirroring GJS function-export semantics and stubbing `imports`/`global`.

- **Verification gate** (static + unit, runs in the sandbox):
  ```bash
  ./scripts/verify.sh      # == npm run verify
  ```
  Checks JSON validity, `node --check` on every JS file, UUID↔folder match,
  settings-callback presence, the `main(metadata, deskletId)` entry point, a
  no-hardcoded-API-key guard, **and** the unit-test suite.

- **Integration smoke test** (run **on the LMDE 7 target** — it needs real GJS
  + the Secret Service keyring, which the WSL sandbox lacks):
  ```bash
  ./scripts/smoke.sh                 # install + files + metadata + keyring + leak checks
  ./scripts/smoke.sh --reload        # also restart the Cinnamon shell afterwards
  ```
  Verifies the installed desklet, then round-trips a throwaway secret through
  the **real** `lib/keyring.js` under GJS (`scripts/smoke-keyring.js`) and
  asserts no plaintext key lands on disk.

**Full e2e** (render + live API fetch per provider) is a manual checklist on
LMDE 7: add the desklet, enter the three API keys in settings, and confirm the
cards populate. This needs your real keys and a live Cinnamon session.

## Debugging

- View desklet logs in **Looking Glass**: right-click the panel → **Troubleshoot** → **Looking Glass** (the code uses `global.log` / `global.logError`).
- Shell logs also land in `~/.xsession-errors`.
- If a desklet fails to load, check that `metadata.json` `uuid` matches the folder name and that `desklet.js` defines `function main(metadata, deskletId)`.
- If a card shows ⚠, the provider fetch failed (bad/missing key, network, or rate limit). The footer shows the error; other cards keep working.

## Notes

- The desklet entry point for a **desklet** is `main(metadata, deskletId)` — not the 4-argument applet signature.
- `setHeader(title)` sets the header; `setContent(actor)` sets the body; `on_desklet_added_to_desktop()` builds/starts the UI; `on_desklet_removed()` cleans up timers and settings.
- HTTP is fully async (libsoup3 `send_and_read_async`); the desktop never freezes during fetches.
- The refresh loop uses `Mainloop.timeout_add_seconds` and is torn down in `on_desklet_removed`.
