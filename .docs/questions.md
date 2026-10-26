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

