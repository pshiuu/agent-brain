# Commands

Daily use, and every command with its flags.

## Daily use

```bash
brain playbooks                          # list dev paths
brain new                                # asks: playbook, name, code directory
brain new new-website acme-site          # or pass them; creates ~/dev/acme-site + brief
#   -> then it offers to fill the brief in: here in the terminal (one question per
#      heading, enter to skip), or with phase one's agent, which asks and writes it.
#      Either way `## Stack` is where this project's stack lives.
cd ~/dev/acme-site
brain run                                # runs the next phase with the right agent
brain status                             # progress
brain auto                               # run phases back to back
brain open                               # free session with brain + memory loaded
brain open --engine codex
brain up                                 # bring the dev stack up and reach it from your browser
brain down                               # put it back down when you are done looking
brain evolve                             # apply the proposals you moved to ## Accepted
brain update                             # the base from upstream, merged with this brain's own commits
brain run design --engine codex --model <model>   # override for one run
```

Only `brain new` and `brain init` ask anything, and only for what you left out: run
either with its arguments — or from a script, or with `BRAIN_NONINTERACTIVE=1` — and
nothing is prompted (a scripted `brain new` leaves the brief as the template, for
phase one to ask about). `brain new` on a brain with no playbooks yet offers to copy an
example first, and asks for a client slug only when the playbook has a role that uses
one.

Existing code (rebuild, feature, audit): point `--dir` at the repo, or answer the
"code directory" prompt with it.

```bash
brain new rebuild-website acme-old --dir ~/dev/acme-old
brain new feature acme-booking --dir ~/dev/acme-site
```

Each run opens the agent interactively with a kickoff prompt, inside that project's
sandbox — full permission on the code, nothing outside it. When the agent has
finished the phase, exit the session; `brain` commits the memory and (in `auto`)
starts the next phase.

## Every command and flag

`brain` with no arguments prints the same list. `init`, `playbooks`, `playbook`, `new`
and `lint` run from anywhere; the rest read the project's `project.env` and must run
from inside the project folder.

| command | flags | |
|---|---|---|
| `brain init` | — | builds both templates and loads them into sbx, syncs skills and `sandbox.conf`, `git init`s the brain, and starts `memory/` as its own repo when there is none |
| `brain playbooks` | — | your playbooks, each with the `> ` line from its `playbook.md` |
| `brain playbook new [name]` | `--engine claude\|codex`<br>`--model M`<br>`--effort L` | name the phases yourself, or have the `playbook-author` draft them. Asks for the name if you leave it out. The flags pick the drafting agent and skip those questions; they do nothing on the other route |
| `brain playbook draft <name>` | — | the cockpit's Draft button, in the Terminal window `brain watch` opens: the `playbook-author` works from `.drafts/playbook/<name>/REQUEST.md`, asks its questions there, and the cockpit shows and installs the draft. A second call revises the draft instead of starting over. For an installed playbook it is the Adjust button's round: the cockpit seeds the draft with the installed copy, and installing writes the revision over it |
| `brain playbook check <name>` | — | role exists in `roles.conf`, reviews and human gates have a fix-role, every phase has its `## ` section, description line present. `✗` and `·` like `brain lint`; exits 1 only on `✗` |
| `brain playbook analyse <name>` | `--engine claude\|codex`<br>`--model M`<br>`--effort L` | step one of improving a playbook, and all it does is analyse. Prints a scorecard per project that ran it, counted from the record (runs, minutes, FAIL rounds, findings each phase let through, what shipped open, attempts the host rejected). Then the `playbook-analyst` writes `knowledge/playbook-<name>.md` and files proposals under `## Open`. Nothing in `system/` changes. Step two is yours: accept or decline each proposal, then `brain playbook evolve <name>` |
| `brain playbook evolve <name>` | `--engine claude\|codex`<br>`--model M`<br>`--effort L` | `brain evolve` held to one playbook: applies only the accepted proposals that change it or its roles (read from each line's `[target]`), and leaves every other accepted line waiting for its own run. Refuses when nothing is accepted for it, and says so afterwards if the editor touched another playbook's accepted line |
| `brain role new [name]` | — | writes both halves a role needs: the `roles.conf` line (engine, model, effort) and `roles/<name>.md`. Write it yourself or have the `role-author` draft it. Refuses a name that already exists |
| `brain new [<playbook> <name>]` | `--dir PATH`<br>`--client SLUG` | asks for whatever you leave out. `--dir` defaults to `$DEV_DIR/<name>` and is where existing code goes; `--client` is slugified and seeds `memory/clients/<slug>/profile.md`. It makes a git repo only by cloning a template: otherwise the phase that writes the code makes one where the code is (`redesign-website`: `site/`, so `crawl/`, `brandkit/` and `design/` beside it are never committed) |
| `brain run [phase]` | `--engine claude\|codex`<br>`--model M`<br>`--effort L` | phase defaults to the next unfinished one. The flags override `roles.conf` for this one run |
| `brain auto` | — | `run` in a loop until the playbook finishes or something needs you. Waits at a human gate rather than stopping. Exit code says which: `0` complete, `1` error, `2` a phase came back not done, `3` a ceiling stopped it |
| `brain open` | `--engine`<br>`--model`<br>`--effort` | free session with the brain and this project's memory loaded. Defaults to claude and the engine's own default model |
| `brain up` | `[engine]` | publish this project's `PORTS` to the host and run its `DEV_UP`, so the site and its database are reachable at `localhost` between phases. Starts the sandbox if it is stopped |
| `brain down` | `[engine]` | stop this project's sandbox: the dev stack and the published ports go with it, the data stays in its volumes. `brain up` brings it all back |
| `brain evolve ["what to change"]` | `--engine`<br>`--model`<br>`--effort` | runs the `system-editor` role on the brain itself — the only command with `system/` writable. Applies the `## Accepted` section of `memory/proposals.md` — all of it, whichever playbook each line is for; `brain playbook evolve <name>` is the one-playbook form — and refuses to run when it is empty, unless you name the change yourself. Both warn and ask before editing a playbook that a project is partway through. Review with `git diff system` |
| `brain engine` | `ls`<br>`add <name>…`<br>`remove <name>` | the agents this brain runs, from `system/engines.conf`: `add` builds one's image and offers it to roles, `remove` refuses while a role runs on it. `install.sh` asks the first time |
| `brain secret set <name>` | `--oauth` | a key for the sandboxes: `anthropic`, `openai`, `google`, or an app's. `--oauth` signs in to a Claude or ChatGPT subscription instead. Kept by sbx, or under the Docker driver by its egress proxy; never in a sandbox |
| `brain config` | `get KEY`<br>`set KEY VALUE` | a setting in `system/brain.local.conf` |
| `brain update` | `--check` | the base from upstream: commits this brain's own changes to `system/` (what evolve and the cockpit wrote), refuses while a phase runs or with other uncommitted changes, then `git pull` (a merge, so this brain's own commits stay; it stops on a real conflict) and `./install.sh` again. `memory/` is not touched. `--check` only lists the commits it would bring. `brain watch` checks on its own every 6 hours and the cockpit shows a banner with an **Update** button |
| `brain status` | — | `✓` done, `✗` failed, `▸` running, `·` pending, each phase's open / waived / deferred defects, and which phase is next. Closes attempts whose launcher died first |
| `brain lint` | — | the memory wiki only. Exits 1 on `✗` lines, warns on `·` ones |
| `test/state.sh` | — | the phase state machine, without a sandbox: what runs next, when a phase is finished, and every way `brain auto` can stop. Run it after touching `bin/brain` |
| `brain approve [phase]` | `--defer ID` | turns the summary's verdict line into `RESULT: PASS` and keeps the rest. Every `OPEN` defect becomes `WAIVED`, `VERIFIED` when a fix round landed since and names it, or `DEFERRED` when you pass its id. Defaults to the next phase |
| `brain reject <phase> "..." ["..."]` | — | writes `RESULT: FAIL` plus your points as a numbered list and as `OPEN` defects the fixer must answer. Each argument is one item. Needs a fix-role on that phase |
| `brain reopen <phase> "..." ["..."]` | — | sends the playbook back to `<phase>`: it and every later phase lose their `.done` (kept in the record) and run again. A work phase keeps its summary and gets your points appended. The way back from a gate with no fix-role |
| `brain watch` | `install`<br>`uninstall` | host-side bridge for the cockpit: creates the projects its New project form staged, opens a Terminal window running `brain run` or `brain auto` for its Run and verdict buttons (at most `BRAIN_MAX_PARALLEL` projects at once; the rest wait), `brain playbook draft` for its Draft button, `brain evolve` for Evolve, and commits what its Install button put into `system/`. Runs until you stop it. `install` makes it a login item so nobody has to start it; `uninstall` removes that |
| `brain sync-skills` | — | re-links `system/skills/*`, installs `skills.list`, and removes anything not on the keep list |
| `brain sync-sandbox` | — | registers `sandbox.conf`'s MCP servers and applies its network rules |

The image tag is `<VERSION>-<hash of templates/>`, so editing anything under `templates/`
moves it on its own. A sandbox is built from the image once and never revisited, so when
the tag has moved under an existing one `brain run` says so and tells you how to rebuild —
otherwise a tool added to `templates/bin/` exists in the repo, in no image, and in no
sandbox, and every call to it fails silently.
