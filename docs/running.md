# Running phases

What happens when a phase runs: reaching the dev server, the two engines, how a role reaches the agent, running unattended, and choosing models.

## Reaching the thing the agent is building

The sandbox is the permission boundary, so a dev server and its database run *inside*
it. That is why they are invisible by default: nothing on your Mac is listening. Two
lines in `memory/projects/<name>/project.env` fix it, and the phase that stands the
stack up (`scaffold`, on the web paths) writes them:

```sh
PORTS=3000:3000,27018:27018            # HOST:SANDBOX, comma-separated
DEV_UP='cd site && docker compose up -d && (setsid nohup pnpm dev >/tmp/dev.log 2>&1 &)'
```

`brain` publishes `PORTS` every time it opens the sandbox, so while a phase runs you can
open `localhost:3000` and watch the agent's work change under you. Between phases the
sandbox is stopped — `brain up` starts it, republishes the ports and runs `DEV_UP`, which
is how you look at the seeded database after the agent has gone. Anything that stops the
sandbox kills the dev server with it, so `brain up` is a thing you re-run, not a thing you
run once; the published port mappings survive and come back with the sandbox. `brain down`
is the other half: it stops the sandbox, which takes the dev server and the ports with it
and leaves the volumes alone. `DEV_UP` must return:
a command that blocks (a bare `pnpm dev`) hangs the call, which is what the `setsid nohup`
is for.

The data lives in Docker volumes inside the sandbox, so it survives `sbx stop` and every
phase. It does not survive `sbx rm` — deleting a project's sandbox deletes its database.

`--effort` values are per model: Claude takes the ones in `claude --help`, Codex the
ones in its own catalog. Leaving it unset passes no flag at all. brain rejects a value
neither engine has, because nothing downstream would: Claude warns and falls back to
its default, Codex says nothing, so a typo would quietly run the phase at default
effort. Per-model limits are a different matter — the cockpit reads Codex's catalog for
those; the CLI passes the value through and lets the engine decide.

## Engine parity

Both images carry the same tools (`brain-shoot`, `brain-graphify-setup`, `graphify`,
`npx`) and the same skill store, mounted at `~/.claude/skills` for Claude and
`~/.agents/skills` for Codex. What differs is only how each engine is told things:

| | Claude | Codex |
|---|---|---|
| model | `--model <m>` | `-m <m>` |
| effort | `--effort <l>` | `-c model_reasoning_effort=<l>` |
| the role | `--append-system-prompt-file` | `$CODEX_HOME/AGENTS.md` in the sandbox |

The prompt, the `BRAIN_*` environment, the read-only `system/` mount and the
read-write `memory/` mount are identical for both.

## How a role reaches the agent

The role is not a path the agent is asked to go and read. Each engine gets it the way
that engine actually loads instructions, so it is there from the first token:

- **Claude**: `--append-system-prompt-file $BRAIN_SYSTEM/roles/<role>.md`, a real
  system prompt. `system/` is mounted at its host path in the sandbox, so the path
  resolves inside it too.
- **Codex** has no such flag, but it reads `$CODEX_HOME/AGENTS.md` before anything
  else, so brain copies the role there — inside the sandbox, whose home is
  `/home/agent/.codex`, never your repo. It is rewritten before every phase and
  deleted when a session has no role, so one phase's role cannot leak into the next.

The prompt still names the role file for both, as a fallback if the injection fails.

**`AGENTS.md` is repo instructions, not a role**, and a folder per role holding
`AGENTS.md` and `CLAUDE.md` would be read by neither CLI: both discover those files by
walking the directory hierarchy — Codex from `$CODEX_HOME`, then the git root down to
the cwd; Claude from the cwd upwards, plus `~/.claude` — so a copy parked in
`system/roles/<name>/` is never on that path. Two places the convention does apply:
this repo's own root `AGENTS.md`, which a CLI running *in the brain* picks up, and the
`$CODEX_HOME` one above.

Writing a role into the *project* repo as `AGENTS.md` would be the wrong move even
though it looks equivalent: it would fight the repo's own instructions, show up in
`git status` every phase, and — for Claude — be ignored outright whenever the repo has
a `CLAUDE.md`, since the default mode reads `AGENTS.md` only when no `CLAUDE.md` exists
at or above the working directory.

Three caveats. Codex concatenates `$CODEX_HOME/AGENTS.md` *before* any `AGENTS.md` in
the workspace, and files nearer the working directory win on conflict — so a project's
own instructions still override the role, which is usually what you want. The Claude
flag needs a CLI in your image new enough to have it, and `BRAIN_ROLE_SYSTEM_PROMPT=0`
turns both mechanisms off if not, since otherwise a Claude phase fails to start. And
role files are context, not enforcement: adherence drops as they grow, so keep one
under ~200 lines and specific.

| variable | default | |
|---|---|---|
| `BRAIN` | `~/agent-brain` | where this repo lives |
| `DEV_DIR` | `~/dev` | where `brain new` puts code |
| `BRAIN_MAX_FIX_LOOPS` | `3` | failed review rounds before brain stops and asks you |
| `BRAIN_NONINTERACTIVE` | `0` | `1` turns every prompt off; commands then fail on a missing argument instead of asking |
| `BRAIN_PRUNE_SKILLS` | `1` | `0` stops `sync-skills` removing skills that are not on the keep list |
| `BRAIN_ROLE_SYSTEM_PROMPT` | `1` | `0` stops loading the role as engine-native instructions (Claude's `--append-system-prompt-file`, Codex's `$CODEX_HOME/AGENTS.md`), for an image whose CLI predates it |
| `BRAIN_MCP` | — | extra MCP server names for new sandboxes, for a one-off you don't want in `sandbox.conf` |
| `CODEX_HOME` | `~/.codex` | cockpit only: where it reads Codex's model catalog from |

## Leaving it running

`brain auto` is meant to be left alone. Three backstops make that safe, and they are
set in **`system/brain.local.conf`** (your values, read first and not in git) over the base's
defaults in `system/brain.conf` — the same kind of file as `roles.conf` and
`sandbox.conf`, read with awk rather than sourced, so a typo in it is an ignored line
and not a command:

```
BRAIN_PHASE_TIMEOUT=7200   # seconds one phase may run with no handoff file (0 = off)
BRAIN_MAX_RUNS=50          # agent runs in one `brain auto` (0 = off)
BRAIN_MAX_FIX_LOOPS=3      # FAIL rounds one review may take before it stops and asks
BRAIN_NOTIFY=...           # any command; the message is appended as its last argument
```

The environment still wins, so a one-off changes nothing on disk:

```bash
BRAIN_PHASE_TIMEOUT=600 brain run design      # just this run
```

**The timeout** exists because a phase ends when the agent writes its handoff file. An
agent that hangs, or dies inside the sandbox before writing one, otherwise blocks
forever — `sbx`'s own `--ttl` is cloud-only and these are local sandboxes. The watcher
that already polls for the handoff file enforces it, stops the sandbox the same way, and
keeps the run receipt, which is where the reason for a hang is written down.

**The run ceiling** is a backstop for a loop that is not converging. `BRAIN_MAX_FIX_LOOPS`
bounds each review by counting `FAIL` lines in the phase log — so a reviewer that writes
`RESULT: FAIL` into its summary but forgets the log line is a fix loop nothing else
stops. Human gates do not count against it; waiting is not a run.

**The notification** is how you find out, since the terminal is not where you are. The
message is appended as the command's last argument, so flags in it stay flags:

```
BRAIN_NOTIFY=terminal-notifier -title brain -message
BRAIN_NOTIFY=/Users/you/bin/tell-me
```

It fires when the playbook finishes, when a gate needs you, when a ceiling stops the run,
and on any fatal error. A notifier that is missing or broken never takes a run down.

Exit codes make `brain auto` scriptable — `0` complete, `1` error, `2` a phase came back
not marked done, `3` a ceiling stopped it:

```bash
brain auto; case $? in
  0) echo "shipped" ;;
  2|3) echo "needs me" ;;
  *) echo "broke" ;;
esac
```

`brain evolve` is deliberately *not* part of this. It is the one command that rewrites
the instructions every later run reads, so it stays manual: you read what the agents
proposed, move what you want to `## Accepted`, and run it yourself.

What is checked, and what is not: `test/state.sh` covers the phase state machine and
every way `brain auto` can stop — including the timeout, against fake marker files, in
about twelve seconds. Run it after touching `bin/brain`. It does not cover `launch`,
`cmd_watch` or the sandbox lifecycle; those need a real `sbx`, and the way to exercise
them is a throwaway playbook with two fast phases and a gate.

One thing to know: don't edit `bin/brain` while a long `brain auto` is running. Bash
reads a script as it executes, and a file that grows underneath it used to make the
shell resume at a stale offset and run whatever fragment it landed on. The dispatch is
now wrapped in a brace group that exits, so that can no longer happen — but the habit is
still worth keeping.

## Switch agents, models and effort

Edit one line in `system/roles.conf` (or use the cockpit's dropdowns):

```
role                engine   model    [effort]
payload-builder     codex    default
code-reviewer       claude   opus     high
designer            claude   opus     xhigh
```

The fourth column is optional reasoning effort, passed as `--effort` to Claude and
`-c model_reasoning_effort=` to Codex. Leave it out and no flag is passed at all, which
is the previous behaviour exactly. Override for one run with `brain run --effort high`.

Allowed values are per model, not just per engine, so the cockpit reads them rather than
guessing: Claude's are the ones in `claude --help`, and Codex's come from its own model
catalog at `~/.codex/models_cache.json`, which compose mounts read-only. That is also
where the Codex model list comes from, so it stays current with the CLI. Only the
catalog is mounted; credentials live in `auth.json` and are never exposed to the
container. Without the mount the cockpit falls back to a generic list and says so.

The model box is free text with suggestions, so any name your CLI accepts works even if
neither side lists it.

Your sandbox images need a CLI new enough to accept `--effort`; leaving the column empty
avoids the question entirely.

`default` means the engine's default model. Claude takes aliases such as `opus` or
`sonnet`; for Codex put whichever model name you have access to.
