# agent-bill

A **Linux Cinnamon desklet** that surfaces an agent-based billing summary on your desktop.

- **Target platform:** Linux Mint Debian Edition 7 (LMDE 7, Debian 13 based) with Cinnamon.
- **Language:** JavaScript via **GJS** (the canonical language for Cinnamon desklets), using the modern ES6 `class extends Desklet.Desklet` style.
- **Distribution:** This is a **GitHub repository**. Development happens here; the target machine clones/updates it with `git` and runs the install/reload scripts locally.

## Repository layout

```
agent-bill-desklet/
  desklet/
    agent-bill@DarkestAbed/     # the desklet itself (folder name == UUID)
      metadata.json             # desklet metadata (uuid, name, description, ...)
      desklet.js                # desklet code (GJS / ES6 class)
  scripts/
    install.sh                  # copies the desklet into ~/.local/share/cinnamon/desklets/
    reload.sh                   # restarts the Cinnamon shell without logging out
  README.md
  .gitignore
```

The desklet **UUID** is `agent-bill@DarkestAbed`. The folder name under `desklet/` must match the UUID exactly — Cinnamon relies on this.

## Development loop (on your LMDE 7 machine)

These scripts are meant to run **on the target machine**, not in a WSL/dev sandbox.

1. **Get the code** (first time):
   ```bash
   git clone <repo-url> ~/agent-bill-desklet
   cd ~/agent-bill-desklet
   ```
2. **Install the desklet**:
   ```bash
   ./scripts/install.sh
   ```
3. **Reload the Cinnamon shell** (equivalent of `Alt+F2` → `r`):
   ```bash
   ./scripts/reload.sh
   ```
4. **Add it to the desktop**: right-click the desktop → **Add desklets** → select **Agent Bill**.
5. **Iterate**: edit `desklet/agent-bill@DarkestAbed/desklet.js`, then re-run `./scripts/install.sh && ./scripts/reload.sh`.

To pick up upstream changes later: `git pull`, then re-run `install.sh` + `reload.sh`.

## Debugging

- View desklet logs in **Looking Glass**: right-click the panel → **Troubleshoot** → **Looking Glass** (use `global.log(...)` / `global.logError(...)` in the code).
- Shell logs also land in `~/.xsession-errors`.
- If a desklet fails to load, check that `metadata.json` `uuid` matches the folder name and that `desklet.js` defines `function main(metadata, deskletId)`.

## Notes

- The desklet entry point for a **desklet** is `main(metadata, deskletId)`. (Do not confuse this with the 4-argument `main(metadata, orientation, panel_height, instance_id)` signature, which is for **applets** — panel items.)
- `setHeader(title)` sets the desklet's header; `setContent(actor)` sets its body; `on_desklet_added_to_desktop()` is the lifecycle hook where the UI is built.
