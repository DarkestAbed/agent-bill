# Questions

Log of questions asked during the agent-bill desklet bootstrap. Format per entry:

- Qx
  - Question text:
  - Who asked
  - Who answered
  - Answer text:
  - Notes:
  - Question timestamp:

---

- Q1
  - Question text: Which language for the desklet code? (Cinnamon desklets are canonically GJS/JavaScript, but Python via PyGObject is also possible.)
  - Who asked: Claude Code
  - Who answered: javi (user)
  - Answer text: JavaScript (GJS) — canonical.
  - Notes: GJS is the standard language for Cinnamon desklets/applets/extensions, with the best docs and examples and full native access to St, Clutter, GLib, Gio.
  - Question timestamp: 2026-10-26 (bootstrap session)

- Q2
  - Question text: How do I get files from this WSL2 sandbox onto your LMDE 7 machine? (This determines install.sh's transport.)
  - Who asked: Claude Code
  - Who answered: javi (user)
  - Answer text: This is going to be a GitHub repo, which will be synced in the proper Git fashion. This will update and deploy on the target machine.
  - Notes: Transport is git; install.sh/reload.sh run on the target machine after git clone/pull. No rsync/SSH assumptions.
  - Question timestamp: 2026-10-26 (bootstrap session)

- Q3
  - Question text: How should Cinnamon be reloaded on LMDE 7 after each deploy? (Affects reload.sh.)
  - Who asked: Claude Code
  - Who answered: javi (user)
  - Answer text: Restart Cinnamon: Alt+F2 → r / `cinnamon --replace`.
  - Notes: Restarts the shell without logging out; picks up newly installed desklets. Implemented in scripts/reload.sh as `cinnamon --replace`.
  - Question timestamp: 2026-10-26 (bootstrap session)

- Q4
  - Question text: Scope of this barebones bootstrap — what should I actually create and commit?
  - Who asked: Claude Code
  - Who answered: javi (user)
  - Answer text: Full scaffold: desklet + install.sh + reload.sh + README + .gitignore + git init + commit.
  - Notes: Everything needed for a working dev loop in one shot; committed as a4fb841 on branch main.
  - Question timestamp: 2026-10-26 (bootstrap session)

- Q5
  - Question text: Do you want me to create the `agent-bill` GitHub repo under DarkestAbed and push the bootstrap commit? (I did not push without asking, since publishing to GitHub is outward-facing.)
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: No
  - Notes: Awaiting user decision. Repo creation and push are gated on explicit approval.
  - Question timestamp: 2026-10-26T13:39:34Z

- Q6
  - Question text: '''
    The objective and goal of this desklet is to have a one-stop-shop on the desktop screen to see usage of Claude Code, Codex and Ollama, per 5-hour window and week allowance. This needs to be done using official APIs from Claude and OpenAI and Ollama, gated by API keys or logins so everything can be properly refreshed against live, real accounts. This needs to be displaced in a big desklet, dark mode only, that shows and updates usage at a configurable time range. How would you go about that?
  '''
  - Who asked: Operator
  - Who answered: null
  - Answer text: null
  - Notes: null
  - Question timestamp: 2026-10-26T11:04:35Z-4

- Q7
  - Question text: How should the desklet access Anthropic (Claude Code) usage? (The usage report API requires an organization; individual accounts can't use it.)
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: Org Admin API key.
  - Notes: Desklet calls the Anthropic Admin API with an organization admin key (sk-ant-admin01-…) stored in the GNOME keyring.
  - Question timestamp: 2026-10-26 (design session)

- Q8
  - Question text: Codex's Usage API returns tokens used per bucket, not the plan's weekly cap. How should the desklet present the 'week allowance' for Codex?
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: Show weekly usage + note limit is plan-based.
  - Notes: Card shows weekly tokens used; allowance is the Codex plan's weekly limit, which the Usage API does not expose.
  - Question timestamp: 2026-10-26 (design session)

- Q9
  - Question text: Local Ollama has no billing/history API — usage only exists per-request. What should 'Ollama usage' mean in the desklet?
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: Ollama cloud usage (ollama.com).
  - Notes: Desklet polls https://ollama.com/api/usage (usage_usd, request_count, tokens over 24h/7d/30d). Local token aggregation was considered and set aside.
  - Question timestamp: 2026-10-26 (design session)

- Q10
  - Question text: Since the architecture has a shared provider abstraction, should all three providers be implemented in one pass, or staged?
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: All three providers in one pass.
  - Notes: Shared provider abstraction (providers/base.js + lib/usage.js) means all three fit in one pass.
  - Question timestamp: 2026-10-26 (design session)

- Q11
  - Question text: How exactly should the desklet get Ollama cloud usage?
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: API key in keyring + poll /api/usage.
  - Notes: ollama.com bearer key stored in the keyring; desklet calls https://ollama.com/api/usage. Consistent with the other two key-gated cloud providers.
  - Question timestamp: 2026-10-26 (design session)

- Q12
  - Question text: What refresh interval and selectable time range should the desklet use?
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: 5 min refresh; range 5h/24h/7d.
  - Notes: Refresh every 5 minutes; selectable range Last 5 hours / Last 24 hours / Last 7 days. Matches the 5-hour-window + weekly-usage goal.
  - Question timestamp: 2026-10-26 (design session)

- Q13
  - Question text: Q6 resolution summary — was the design validated and implemented?
  - Who asked: Claude Code
  - Who answered: Operator
  - Answer text: Yes — design validated (Q7–Q12) and implemented in one pass.
  - Notes: Implemented: desklet.js (UI shell + refresh loop), settings-schema.json, providers/{base,claude,codex,ollama}.js, lib/{http,keyring,usage,ui,keydialog}.js, scripts/verify.sh. All credentials via GNOME keyring (libsecret); async libsoup3 HTTP; dark-mode only. Static verification: 33/33 PASS. Not yet run under Cinnamon (sandbox has no GJS/Cinnamon) — first live render is on the LMDE 7 target via install.sh + reload.sh.
  - Question timestamp: 2026-10-26 (implementation session)

- Q14
  - Question text: Desklet installed and Cinnamon reloaded on LMDE 7 target, but it failed to load (no "Loaded desklet agent-bill" in logs, desklet not visible on desktop). What went wrong?
  - Who asked: javi (user)
  - Who answered: Claude Code
  - Answer text: Root cause: the desklet used GNOME Shell's `imports.misc.extensionUtils.getCurrentExtension()` + `Me.imports.lib.ui` pattern, which does NOT exist in Cinnamon 6.x — it throws ImportError at module load time, crashing the entire desklet before `main()` is even called. Cinnamon extensions must use the injected `require('./relative/path.js')` instead. Three secondary bugs were also fixed: (1) `Clutter.UnicodeChar.BULLET` is undefined in Clutter 0 — replaced with `St.PasswordEntry`; (2) `entry.connect('activate')` doesn't work — the signal is on `entry.clutter_text`; (3) Cinnamon's `require()` resolves against the desklet ROOT, not the calling file, and mangles `../` paths. Also switched `TextDecoder().decode()` to `imports.byteArray.toString()` (idiomatic cjs). Three new static guards added to verify.sh (no extensionUtils/Me.imports, no Clutter.UnicodeChar, no require('../…')) and matching guards in smoke.sh.
  - Notes: Fixed in commit (see git log). All fixes verified: 37/37 verify checks PASS, 10/10 unit tests PASS. Key lesson: `node --check` and unit tests cannot catch Cinnamon module-load failures — the import mechanism is Cinnamon-specific. The new verify.sh guards catch the three anti-patterns statically. Memory file saved: cinnamon-6-gotchas.md. Pending: smoke.sh still checks for `gjs` but LMDE 7 ships `cjs` — needs updating.
  - Question timestamp: 2026-10-26 (debugging session)

- Q15
  - Question text: After reinstalling the desklet (with crash-#1 fixes) and reloading Cinnamon, the WHOLE SHELL died ~16s after `cinnamon --replace` (SIGABRT, coredump). What killed it?
  - Who asked: javi (user)
  - Who answered: Claude Code
  - Answer text: Root cause (from gdb on the coredump, symbols from muffin-dbg/cinnamon-dbg): a C-level GLib assertion — `Clutter:ERROR: clutter-actor.c:6224: clutter_actor_dispose: assertion failed: (priv->parent == NULL)` — fires when a Clutter actor reaches GObject disposal while still parented. That is `g_assert` → `abort()` → SIGABRT: it kills the entire Cinnamon shell and is NOT catchable from JS. The stack showed `clutter_timeline_do_frame → Gjs::Closure::invoke → clutter_actor_destroy` — a JS `ease({onComplete})` callback (Cinnamon's own `Desklet.destroy()`, which fades 500 ms then calls `actor.destroy()`) destroying our desklet's actor tree. The cascade hit an `St.Bin` (`st_bin_destroy` destroys `priv->child` itself) and finally an actor whose `priv->parent` was non-NULL at dispose. Our code had 4 actor-lifecycle violations matching this: (1) `renderBar()` did `parent.remove_child(oldBar)` + `insert_child_at_index(newBar)` on EVERY refresh without destroying the old bar — orphaned actors accumulate and GJS later disposes them (primary trigger); (2) `makeUsageBar()` created two dead unparented `St.Bin` actors (`track`, `fill`); (3) `_reconcileCards()` did bare `remove_child(card.actor)`; (4) no `_destroyed` guard on async callbacks (`Promise.allSettled().then()`, `Keyring.storeKey/clearKey().then()`, Mainloop timer) — they touched actors after teardown. Also `reload.sh` discarded `cinnamon --replace` stderr (`>/dev/null 2>&1`), which is why the `Bail out!` line never appeared in any log. Fixes: `makeUsageBar()` rewritten with in-place `setPercent()` (no actor swap, no dead actors); `renderBar()` → `this._bar.setPercent(p)`; `card.destroy()` = remove_child + destroy paired; `_reconcileCards()` uses `card.destroy()`; `_destroyed` flag set in BOTH `on_desklet_removed()` and `on_desklet_reloaded()` and checked in every async callback + timer + `_refresh()`; keydialog content destroyed on close; `reload.sh` now logs to `~/.local/share/cinnamon/cinnamon-replace.log`; verify.sh gained guards 7e (no bare remove_child) + 7f (_destroyed guard); smoke.sh gained 6c and was fixed to use `cjs` not `gjs` (LMDE 7 ships cjs). Verified: 39/39 verify PASS, 10/10 unit tests PASS.
  - Notes: Key lessons: (a) Clutter actor-lifecycle violations are shell-killing C aborts, not JS errors — treat them as critical; (b) NEVER `remove_child()` without `destroy()`; NEVER `destroy()` a parented actor; prefer in-place style/text updates; use `St.Bin.set_child()` to swap; (c) `St.Bin` has its own `st_bin_destroy` vfunc that destroys `priv->child` — don't double-destroy; (d) every async callback must check `_destroyed` before touching actors; (e) `cinnamon --replace` stderr is the ONLY place C-level assertions appear — never discard it. Memory file saved: crash-2-actor-lifecycle.md; cinnamon-6-gotchas.md extended with lesson 11.
  - Question timestamp: 2026-10-26 (crash #2 debugging session)

