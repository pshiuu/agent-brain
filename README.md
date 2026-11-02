# agent-brain

A brain for your coding and content agents. It holds the instructions, memory and skills
they work from, plus a `brain` command that runs each phase of a project with the right
agent (Claude Code or Codex, with the model and effort you chose), in a sandbox of its own.

You describe the work once as a **playbook**: research, outline, *your review*, draft,
editor check, *your review*, retro. The brain runs it phase by phase. It sends reviews
back to a fixer until they pass, stops where a human has to decide, and after every
project compiles what it learned into a wiki the next project reads.

Two ideas hold it together.

**The sandbox is the permission boundary.** Every phase runs in a
[Docker Sandbox](https://docs.docker.com/ai/sandboxes/) (`sbx`, a VM each), or where
that does not run, a hardened container behind an egress proxy, with only the project
mounted. Inside it the agent works at full permission, with no approval prompt per file
write or command, and it can reach nothing else on your machine. MCP servers, network
rules and skills are declared once and apply to every sandbox.

**Memory is a wiki, not a chat log.** A retro doesn't append notes nobody reads. It
rewrites the knowledge page that owns the topic, so twenty projects' lessons about one
thing stay one page. Agents read an index and the few pages in their scope, not
everything. Changes to the instructions themselves are only *proposed*: the instructions
are read-only to every agent, and nothing changes until you accept a proposal.

Nothing here is tied to a stack or to web work. A playbook is any repeatable sequence of
phases: ship a feature, research a market, migrate a database, write and review an
article.

## What a project looks like

```bash
brain new seo-article heat-pump-noise     # a project from a playbook, with its brief
brain auto                                # run phases back to back
```

The seo app's `seo-article` playbook, partway through:

```
✓ research        seo-researcher   claude opus     what ranks, what people ask, a source per number
✓ outline         seo-writer       claude opus
▸ outline-gate    you              ← waits here; approve or send back with comments
· images          image-researcher
· draft           seo-writer
· editor-check    seo-reviewer     ⇄ seo-writer    FAIL → fix → re-check, until PASS
· final-gate      you
· retro           retro            → knowledge/ pages, proposals for the instructions
```

`brain auto` parks at a human gate and carries on the moment you decide, from the
terminal or from the cockpit. Every attempt leaves a record on the host: the exact
prompt, the role file as it was, the inputs with their hashes, and the verdict the host
reached about the handoff.

## The cockpit

A local web UI on `127.0.0.1`, in two parts on one API:

- **Studio**, for the people the work is for. What waits on you, projects by area, a
  review where you select a passage and comment on it (each comment becomes a numbered
  fix the agent must answer), the finished copy, and "adjust this playbook" in plain words.
- **Admin**, for whoever runs the brain. Playbooks next to their instructions, roles with
  their engine, model and effort, skills, proposals to accept or decline, every run's
  record, and an app store.

The cockpit edits files and never runs a host command. Each button stages a request file,
and `brain watch` on your Mac acts on it.

## Requirements

- macOS, Apple silicon or Intel (the watcher is a launchd login item; runs open in Terminal)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [`sbx`](https://docs.docker.com/ai/sandboxes/) on Apple silicon, for a VM per sandbox.
  Without it (on an Intel Mac, say) the sandboxes run as hardened containers behind an
  egress proxy that holds the keys: [the Docker driver](docs/setup.md#sandboxes-without-sbx-the-docker-driver)
- One or more agents, chosen at install: Claude Code (API key or Pro/Max subscription),
  Codex (API key or ChatGPT subscription), Gemini CLI, OpenCode. Add one later with
  `brain engine add <name>`
- git. Node is only needed to run the cockpit outside Docker or to run its tests.

## Quickstart

```bash
git clone https://github.com/pshiuu/agent-brain.git ~/agent-brain
cd ~/agent-brain && ./install.sh     # asks a few questions; safe to run again
```

`install.sh` asks how sandboxes should run (`sbx`, or plain Docker on an Intel Mac) and
which agents you use, builds a sandbox image for each, offers to sign them in, starts the
cockpit and `brain watch`, opens the cockpit, and offers to put `brain` on your PATH.

A fresh brain has no playbooks. Get some from an app, or write your own:

```bash
brain app install seo                # or Admin → Apps in the cockpit
brain new                            # pick a playbook, name the project, fill in the brief
brain auto
```

```bash
brain playbook new                   # name the phases yourself, or let an agent draft them
brain role new                       # each role it names: who runs it and what it is told
brain playbook check <name>
```

## Concepts

| | |
|---|---|
| **Playbook** | an ordered list of phases (`phases`: phase, role, fix-role) plus the instruction for each (`playbook.md`) and the brief a project fills in |
| **Role** | who runs a phase: a line in `roles.conf` (agent, model, effort) and `roles/<name>.md` (what it is told). `human` is a role too. Different roles can run on different agents |
| **Review loop** | a phase with a fix-role writes `RESULT: PASS` or `FAIL` and a list of defects with ids. On FAIL the fixer runs and must answer each id, then the review runs again. A ceiling stops a loop that isn't converging |
| **Contract** | optional per phase: files that must exist, and checks the host runs in the sandbox after the agent exits. An agent can't hand over work its check fails |
| **Memory** | `memory/` is its own git repo: `knowledge/` (the wiki), `index.md`, client profiles, `proposals.md`, and per-project records that stay on your machine |
| **Evolve** | agents file proposals; you accept or decline them; `brain evolve` is the one command that may rewrite `system/`, and only what you accepted. `git diff system` is the review |
| **App** | a domain packaged for the brain: its playbooks, roles, skills, MCP servers, settings, and optionally Studio pages and `brain <app>` commands. Updates merge with what your runs taught the installed copy |

## Apps

Apps live in [pshiuu/agent-brain-apps](https://github.com/pshiuu/agent-brain-apps):

- **seo**: articles that rank and get quoted in AI answers (`seo-article`,
  `aeo-refresh`, `article-combiner`), with a measured editor check and optional DataForSEO
- **web**: websites on PayloadCMS, from brief to launch: content, brand kit, design,
  build and QA
- **clients**: a profile per client that every project for them reuses
- **academy**: a workspace for theses and papers (sources, notes, drafts, checks) with
  commands of its own

Writing an app: [`system/skills/app-format/SKILL.md`](system/skills/app-format/SKILL.md).

## Layout

```
bin/brain          the launcher; runs on your Mac and drives sbx
system/            the instructions, mounted read-only into every sandbox
  BRAIN.md         the operating manual every agent reads first
  roles.conf       role → engine, model, effort
  roles/ playbooks/ skills/
  apps/<name>/     installed apps (not in git; apps.lock records them)
memory/            a git repo of its own, mounted read-write (not in this repo)
templates/         the sandbox images: Claude Code / Codex, Playwright, helpers
ui/                the cockpit (plain node, no build step; runs from this folder)
test/              the state machine, contracts, apps and memory, without a sandbox
examples/memory/   what a new brain's memory starts from
```

## Documentation

| | |
|---|---|
| [Setup](docs/setup.md) | install, skills, MCP servers and network rules, sandboxes without sbx, templates, disk space |
| [Commands](docs/commands.md) | daily use, and every command with its flags |
| [Playbooks and roles](docs/playbooks.md) | writing them, review loops, human gates, phase contracts |
| [Running phases](docs/running.md) | dev servers, the two engines, how a role reaches the agent, running unattended |
| [Memory](docs/memory.md) | the wiki, feeding it documents, the base and memory as two repos |
| [Getting better](docs/learning.md) | proposals and evolve, analysing a playbook's runs, evals |
| [Apps](docs/apps.md) | install, update, promote, what an app may declare; seo and academy |
| [Cockpit](docs/cockpit.md) | the Studio and Admin, running everything from the browser |
| [Internals](docs/internals.md) | run records, crawling, graphify |

## Working on the brain

[`AGENTS.md`](AGENTS.md) holds the invariants, and the checks to run before calling
anything done:

```bash
./bin/brain test            # syntax, every suite, lint, every playbook and app check
./bin/brain test --fresh    # the same on a copy without anything git ignores
```

## License

[Apache-2.0](LICENSE)
