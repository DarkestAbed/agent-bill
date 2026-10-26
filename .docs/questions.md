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
  - Who answered: (pending — not yet answered)
  - Answer text:
  - Notes: Awaiting user decision. Repo creation and push are gated on explicit approval.
  - Question timestamp: 2026-10-26T13:39:34Z
