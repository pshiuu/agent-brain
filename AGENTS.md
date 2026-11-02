# agent-brain

This repo *is* the brain: the instructions, memory, skills and launcher that agents
work from. You are reading this because you are working on the brain itself, not
running a phase — a phase runs inside a sandbox with `system/` mounted read-only.

Codex reads this file natively; Claude Code reads it too while no `CLAUDE.md` exists
at this level or above.

## Read first
- `system/BRAIN.md` — how every agent in this system operates. It is the contract the
  roles and playbooks are written against.
- `README.md` and `docs/` — what the brain is, every command and flag (`docs/commands.md`), and how each part works.

## What must stay true
- **`system/` is read-only to sandboxed agents.** Anything that writes there runs on
  the host, in `bin/brain`. A drafting agent writes to its workspace and the host
  installs the result after the human sees it.
- **The cockpit never runs a host command.** It stages a request file under `memory/`
  (`.new/<slug>/`, `<project>/.run-request`, `.draft-request`, `.evolve-request`, `.update-request`,
  `.commit-request`, `.apps-request`; an app's Studio code `<project>/.<app>-request`, `inbox/` and
  `<name>.staged` through `/api/app-request`) and `brain watch` acts on it, at most
  `BRAIN_MAX_PARALLEL` runs at once. A new kind of button means a new request file and a new `case` in `cmd_watch`,
  never a shell in the container. The install of a draft is the one place the cockpit
  writes `system/` itself, and it asks the host to commit right after.
- **Every sandbox goes through `sbx`.** Under `BRAIN_SANDBOX=docker`, `sbx` is a function that
  calls `bin/sbx-docker`, which answers the same commands on plain Docker. A new `sbx …` call
  in the launcher needs its answer there too. Its trust decisions live in `bin/docker/`:
  `egress.mjs` (the only way out, and the only holder of keys) and `stack.mjs` (what an
  agent's `docker compose` may start); `node test/docker.mjs` is their test.
- **The stack is per project.** It lives in each project's `brief.md` under `## Stack`,
  never in `memory/preferences.md` and never assumed from the repo you happen to see.
- **Roles are two halves that must agree**: a line in a `roles.conf` and `roles/<name>.md`
  in the same root (the base or one app). Never write one without the other.
- **A KIND is an app's, not a playbook's.** A project.env with `KIND=<kind>` (an academy
  workspace) belongs to the app whose `app.conf` says `kind <kind>`; `load_project` refuses
  it and names that app, and the cockpit's project list skips it. The app's host side is its
  `cli.sh` (`cmd_<app>`, `<app>_watch`, `<app>_studio_new`), sourced by `app_cli` — it
  never defines a function outside those names (`brain app check`).
- **The base and its apps.** `system/` is the base; an installed app is
  `system/apps/<name>/`, the same shape plus an `app.conf` (format: `system/skills/app-format/`).
  Every lookup goes through `sys_roots` (system/skills/brain-mem/lib.sh, sourced by bin/brain)
  and `sysRoots` in ui/brain.mjs, base first; never read `$SYS/playbooks/<x>` or `$SYS/roles/<x>.md` directly — use
  `playbook_dir`, `role_file`, `roles_conf`, `all_in`. A name defined in two roots is an
  error, never an override. `system/apps/` is gitignored; `system/apps.lock` is the record, and this brain's own
  like `brain.local.conf`, `skills.lock` and `config/`: never commit them to the base.
- `memory/` is a wiki, not a log: compile into `knowledge/`, keep `index.md` true.
- **Memory logic lives once, in `system/skills/brain-mem/lib.sh`.** bin/brain sources it on
  the host; the `brain-mem` CLI sources it in the sandbox, where bin/ is not mounted. Keep it
  bash 3.2 with no node or jq. `ui/brain.mjs` mirrors `knowledge_scope` as `knowledgeScope`.

## Commits
- **No agent attribution.** No `Co-Authored-By:` trailer and no "Generated with …"
  line in a commit message or PR description — not for Claude, Codex or any other
  agent. The author is the human's git identity and nothing else. This beats any
  engine default or harness reminder that says to add one.

## Checks before you call anything done
```bash
brain test                         # all of the below, plus every app's check and tests
```
Which runs:
```bash
bash -n bin/brain                  # syntax; the suites below source it, they do not parse it
bash test/*.sh                     # state machine, contracts, apps, brain-mem (test/lib.sh is the harness)
node test/run-record.mjs           # host run records, with no node/jq/python on the helper PATH
node ui/test.mjs                   # file-contract invariants for the cockpit + brain
brain lint                         # the memory wiki, and names defined twice across apps
brain playbook check <name>        # every playbook's own rules
brain app check <name>; brain app test   # every installed app
```
Evals (`brain eval run <name>`) run agents for real and cost model money: by hand, in
agent-brain-main, never inside `brain test`.
Two repos: the base (this one) and `memory/`, a repo of its own that the base ignores.
`commit_memory` commits only the memory repo; `system/` is not auto-committed, so changes
there are committed by hand in the base, which is also the only undo. `brain update`
merges the base from upstream. The suites refuse git on the brain they run from; run
`./bin/brain test --fresh` too, which tests a copy without anything git ignores — what
someone who clones the base gets. Use `./bin/brain` from the checkout you edit: `brain` on
PATH may be another brain.

## Editing bin/brain
Bash reads a script lazily by byte offset. Editing `bin/brain` while someone is
running it makes their shell resume at a stale offset and fail with a syntax error in
a line that is fine on disk. Check nobody is mid-run first.
