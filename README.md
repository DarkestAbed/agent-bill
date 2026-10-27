# agent-bill

A dark-mode **Linux Cinnamon desklet** that shows, at a glance, how close you are to
the usage limits of your **Claude**, **Codex (ChatGPT)** and **Ollama cloud** plans,
and when each limit resets.

- **Target platform:** Linux Mint Debian Edition 7 (LMDE 7, Debian 13) with Cinnamon 6.6.
- **Language:** JavaScript (Cinnamon's `cjs`), ES6 `class extends Desklet.Desklet`.
- **Version:** 1.0.0

## What it shows

One **hero column** per provider, side by side:

```
╭ Agent Bill ─────────────────────────── updated 20:31  ↻ ╮
│ ┌ CLAUDE   PRO ┐   ┌ CODEX   FREE ┐   ┌ OLLAMA        ┐  │
│ │ 16%          │   │ 0%           │   │ 54%           │  │
│ │ weekly ·     │   │ 30-day ·     │   │ weekly ·      │  │
│ │ resets in 3d │   │ resets in 29d│   │ resets in 4d  │  │
│ │ ▬▬▬▬──────── │   │ ──────────── │   │ ▬▬▬▬▬▬▬───── │  │
│ │ 5-hour 3%·7h │   │              │   │ session 0%·3h │  │
│ │              │   │              │   │ ▁▇▆▄▂▁▃▅▇▆▂▁  │  │
│ │              │   │              │   │ 597 req · 24h │  │
│ └──────────────┘   └──────────────┘   └───────────────┘  │
╰──────────────────────────────────────────────────────────╯
```

- **Hero %**: the plan meter with the **highest usage**, because that is the limit that
  blocks you first. Amber from 70 %, red from 90 % or when the provider says you are
  rate-limited.
- **Countdowns** to each reset, repainted every 30 s between fetches.
- **Other meters** as small lines below the bar (e.g. Claude's 5-hour window).
- **Ollama**: a 24-hour hourly request sparkline and the request count.
- **Plan badge** (PRO, FREE, …) when the provider reports one.
- Rows with nothing real to show are **hidden**. The desklet never shows invented
  numbers or rows of "n/a".
- If a fetch fails, the column keeps the last good data and marks it **stale** with the
  reason (e.g. "run `claude` once to renew it").

Every field each provider exposes, and which ones the cards use, is documented in
[`.docs/provider-fields.md`](.docs/provider-fields.md).

## Credentials

| Provider | Default (plan users) | Optional |
|---|---|---|
| **Claude** | Reads your `claude` CLI login from `~/.claude/.credentials.json` on every refresh → `GET api.anthropic.com/api/oauth/usage` (5-hour + weekly %) | Anthropic **org admin key** (`sk-ant-admin01-…`) → Admin usage report (tokens, last 24 h) |
| **Codex** | Reads your `codex` CLI login from `~/.codex/auth.json` on every refresh → `GET chatgpt.com/backend-api/wham/usage` (plan windows: 5-hour + weekly on paid plans, 30-day on Free) | OpenAI **org admin key** (`sk-admin-…`) → Admin usage API (tokens, last 24 h) |
| **Ollama** | ollama.com **API key** (entered once, kept in the GNOME keyring) → `/api/usage` + `/api/balance` | — |

- **Nothing to paste for Claude or Codex.** The CLIs renew their own tokens, and the
  desklet re-reads the files every refresh, so it follows those renewals. If you have
  not used a CLI for a long time and its token has expired, the column says so: run
  `claude` (or `codex`) once.
- The desklet **only reads** those files. It never refreshes or rewrites the CLI tokens:
  that would rotate the refresh token and log the CLI out.
- `$CLAUDE_CONFIG_DIR` and `$CODEX_HOME` are respected.
- Admin and Ollama keys are stored encrypted in the **GNOME keyring** (libsecret),
  never in the repo or in the settings JSON. `scripts/verify.sh` fails the build if a
  key pattern appears in the source.
- The Claude and ChatGPT plan endpoints are **undocumented**. They work today
  (verified 2026-10-27), but they can change without notice.

## Settings

Right-click the desklet → **Configure**:

- **Refresh interval** (minutes, default 5). The **↻** button in the header refreshes now.
- **Layout**: *Side by side* (one column per provider) or *Stacked* (the same cards one
  above the other, full width).
- **Desklet width** (pixels, default 600), split evenly between the columns when side by side. Cinnamon
  desklets cannot be resized by dragging.
- Per-provider **show** toggles.
- **Enter / remove org admin key** (Claude, Codex; optional) and **Enter / remove
  Ollama API key**.

## Repository layout

```
desklet/agent-bill@DarkestAbed/     # the desklet (folder name == UUID)
  metadata.json                     # uuid, name, version
  settings-schema.json              # refresh, width, per-provider toggles + key buttons
  desklet.js                        # layout, credential resolution, refresh + countdown loop
  providers/
    base.js                         # provider contract: fetchUsage(range, cred)
    claude.js                       # OAuth plan usage | Admin usage report
    codex.js                        # wham/usage plan meters | Admin usage API
    ollama.js                       # /api/usage (24h) + /api/balance
  lib/
    localauth.js                    # reads the claude/codex CLI logins from $HOME
    usage.js                        # pure logic: payload -> UsageSnapshot, hero pick, countdowns
    ui.js                           # hero columns, bars, sparkline (pixel-sized, in-place updates)
    http.js                         # libsoup3 async GET (never blocks the UI)
    keyring.js                      # GNOME keyring (libsecret) store/lookup/clear
    keydialog.js                    # masked key-entry dialog
scripts/
  install.sh                        # copy the desklet to ~/.local/share/cinnamon/desklets/
  reload.sh                         # restart the Cinnamon shell (logs to cinnamon-replace.log)
  verify.sh                         # static gate + unit tests
  smoke.sh, smoke-keyring.js        # integration test on the target
tests/                              # node --test unit tests (usage.js, localauth.js)
.docs/questions.md                  # decision / Q&A log
.docs/provider-fields.md            # field inventory per provider
```

## Install and develop

```bash
git clone <repo-url> ~/agent-bill && cd ~/agent-bill
./scripts/install.sh
./scripts/reload.sh        # first time only: restarts the Cinnamon shell
```

Then right-click the desktop → **Add desklets** → **Agent Bill**.

After you change code, reload only this desklet. This is faster than restarting the
shell and does not touch other windows:

```bash
./scripts/install.sh && gdbus call --session --dest org.Cinnamon \
  --object-path /org/Cinnamon --method org.Cinnamon.ReloadXlet \
  'agent-bill@DarkestAbed' 'DESKLET'
```

Load errors appear in `~/.local/share/cinnamon/cinnamon-replace.log` (when the shell
was started by `reload.sh`) or in **Looking Glass** (right-click the panel →
Troubleshoot → Looking Glass).

## Testing

Three layers:

1. **Unit tests**: `npm test`. These cover `lib/usage.js` (all provider payload
   shapes as verified live, hero selection, countdown and number formatting, error
   isolation) and `lib/localauth.js` (credential-file parsing, expiry, missing logins).
   `tests/helpers/load-gjs.js` loads the real modules into Node.
2. **Static gate**: `./scripts/verify.sh` (`npm run verify`). It checks JSON validity,
   `node --check` on every file, UUID ↔ folder, settings callbacks, `main()`, a
   no-hardcoded-key guard, Cinnamon 6 load-failure guards (no `extensionUtils`, no
   `require('../')`, no bare `remove_child`, `_destroyed` guard, no `%` CSS lengths),
   and runs the unit tests.
3. **Integration smoke**: `./scripts/smoke.sh` (on the LMDE target). It checks the
   installed files and round-trips a throwaway secret through the real keyring under `cjs`.

The full end-to-end check (live fetch and render) is manual: reload the desklet and
look at the columns.

## Changelog

### 1.0.0 (2026-10-27)

- **No more pasted tokens.** Claude and Codex plan logins are read from the `claude` /
  `codex` CLI files in `$HOME` on every refresh, so token renewals are picked up
  automatically. Org admin keys are optional.
- **New card design.** Hero columns show the meter closest to its limit, with reset
  countdowns, secondary meters and an Ollama request sparkline. Rows with no real data
  are hidden.
- **Layout setting**: side by side or stacked.
- **Codex Free** shows its real 30-day window. Windows are labelled by length, not position.
- **Fixes:** bars fill from the left (they grew from the centre), provider names are no
  longer cut off, no Cinnamon frame around the panel, no `percentage lengths` warnings.
- Removed the 5h / 24h / 7d range setting (plan meters do not depend on it).
- Field inventory per provider: [`.docs/provider-fields.md`](.docs/provider-fields.md).
