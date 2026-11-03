# agent-brain

A brain for your agents. It holds the instructions, memory and skills they work from,
plus a `brain` command that runs each phase of a project with the right agent (Claude
Code, Codex, Gemini CLI or OpenCode, with the model and effort you chose), in a sandbox
of its own.

You describe a kind of work once as a **playbook**: plan, build, *your review*, test,
review, retro. The brain runs it phase by phase. It sends reviews back to a fixer until
they pass, stops where a human has to decide, and after every project compiles what it
learned into a wiki the next project reads. **Apps** package playbooks for a domain, so
you install a way of working instead of writing it.

## Why

- **Agents that don't start from zero.** Every project ends with a retro that rewrites
  the wiki pages it learned something about. The next project, on any agent, starts from
  what the last ones found out, not from a blank prompt.
- **Full autonomy without the risk.** Each phase runs in its own sandbox with only the
  project mounted. The agent works without a permission prompt per command and can
  reach nothing else on your machine; keys stay outside, in a proxy.
- **You decide where it matters, and only there.** Human gates sit where judgement is
  needed; between them, reviews and fixes loop on their own until they pass. `brain
  auto` waits at a gate and carries on the moment you answer.
- **The right agent for each job.** Every role picks its agent, model and effort. A
  reviewer can run on a different model from the writer it checks.
- **Instructions that improve, under your control.** Agents propose changes to their own
  instructions with evidence from the runs; nothing changes until you accept. Each
  playbook gets a scorecard (runs, minutes, dollars, FAIL rounds, findings let through)
  and evals, so you can see whether a change helped.
- **Memory that stays readable.** A wiki, not a chat log: one page per topic, tagged so
  each agent reads only its scope, with sources, dated confirmations and a lint that
  flags what went stale.
- **Proof, not trust.** Phase contracts let the host check an agent's work before it is
  handed on, and every attempt leaves a record: the exact prompt, the role as it was,
  the inputs with their hashes, and the verdict.
- **Any repeatable work.** Nothing is tied to a stack: ship a feature, migrate a
  database, research a market, write and review an article, run a thesis.

Two ideas hold it together.

**The sandbox is the permission boundary.** Every phase runs in a
[Docker Sandbox](https://docs.docker.com/ai/sandboxes/) (`sbx`, a VM each), or where
that does not run, a hardened container behind an egress proxy, with only the project
mounted. MCP servers, network rules and skills are declared once and apply to every
sandbox.

**Memory is a wiki, not a chat log.** A retro doesn't append notes nobody reads. It
rewrites the knowledge page that owns the topic, so twenty projects' lessons about one
thing stay one page. Agents read an index and the few pages in their scope, not
everything. The instructions themselves are read-only to every agent, and change only
through proposals you accept.

## What a project looks like

```bash
brain new <playbook> <project>     # a project from a playbook, with its brief
brain auto                         # run phases back to back
```

A playbook partway through:

```
✓ plan          planner      claude opus      what to build, and how we'll know it works
✓ build         developer    codex
▸ build-gate    you          ← waits here; approve or send back with comments
· test          tester
· review        reviewer     ⇄ developer      FAIL → fix → re-check, until PASS
· final-gate    you
· retro         retro        → knowledge/ pages, proposals for the instructions
```

Every attempt leaves a record on the host, and the cockpit shows where each project's
time, money and re-runs went.

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
brain app install <app>              # or Admin → Apps in the cockpit
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

An app is a domain packaged for the brain: its playbooks, roles, skills, MCP servers and
settings, and optionally Studio pages and `brain <app>` commands. Install one and its
playbooks are ready to run; update it and the update merges with what your runs taught
the installed copy. Apps can depend on each other and ship starter knowledge.

Apps live in [pshiuu/agent-brain-apps](https://github.com/pshiuu/agent-brain-apps):
content and search, websites, client profiles, and a research workspace for theses and
papers among them.

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
templates/         the sandbox images: one per agent, Playwright, helpers
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
| [Apps](docs/apps.md) | install, update, promote, what an app may declare |
| [Cockpit](docs/cockpit.md) | the Studio and Admin, running everything from the browser |
| [Internals](docs/internals.md) | run records, crawling, graphify |
| [Roadmap](docs/roadmap.md) | what is planned and not built yet |

## Working on the brain

[`AGENTS.md`](AGENTS.md) holds the invariants, and the checks to run before calling
anything done:

```bash
./bin/brain test            # syntax, every suite, lint, every playbook and app check
./bin/brain test --fresh    # the same on a copy without anything git ignores
```

## License

[Apache-2.0](LICENSE)
