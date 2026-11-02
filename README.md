# agent-brain

A brain for your agents: the instructions, memory, skills and tools they work from,
plus a `brain` command that starts the right agent (Claude or Codex, with the right
model) in its own sandbox for each phase of a project.

Two ideas hold it together.

**The sandbox is the permission boundary.** Every phase runs in a Docker Sandbox
(`sbx`) with the project directory mounted, so the agent works at full permission
inside it — no approval prompt per file write or command — and can reach nothing
else on your machine. What it gets beyond the code is declared once, in
`system/sandbox.conf` (MCP servers, network egress) and `system/skills.list`
(skills), and applies to every sandbox the brain creates.

**Memory is a wiki, not a chat log.** What one project taught is compiled into a
page the next project reads, so the brain gets better rather than longer.

Nothing here is tied to a stack or to web work. A playbook is any repeatable
sequence of phases — ship a feature, research a market, migrate a database, produce
and review content — and you write your own. The stack is not a property of the brain
either: it belongs to one
project, and is declared in that project's brief.

```
agent-brain/
  bin/brain                 launcher (runs on your Mac)
  templates/                sandbox image: Playwright + Chromium, graphify, helpers
  test/state.sh             the phase state machine, checked without a sandbox
  system/                   instructions, mounted READ-ONLY into sandboxes
    BRAIN.md                operating manual every agent reads first
    brain.conf              the base's defaults: timeouts, ceilings, notification
    brain.local.conf        this brain's own values for them, read first (not in git)
    roles.conf              role → engine + model  (edit to switch)
    roles/*.md              one file per role
    playbooks/<path>/       dev paths: phases + playbook.md + brief template,
                            and playbook.env for the repos that path clones
    skills/                 skills imported into sbx's shared store (Claude + Codex)
  memory/                   mounted READ-WRITE; everything but projects/ is committed
    index.md                the catalog every agent reads first
    knowledge/              the wiki: one compiled page per topic, cross-linked
    preferences.md          how you work, across every project (not the stack)
    proposals.md            changes agents want made to system/ (## Open),
                            the ones you approved (## Accepted) and the
                            ones you turned down (## Declined)
    log.md                  append-only: what happened when
    sources/                brain-wide material you drop in, compiled into knowledge/
    clients/<slug>/         one profile per client, shared by their projects
    projects/<name>/        brief (incl. this project's stack), decisions, phase
                            summaries, QA screenshots, and sources/ — this project's
                            own documents — gitignored, local only
```

Your project folders in `~/dev` only contain code.

## Setup (once)

On a Mac with Docker Desktop, from the repo:

```bash
./install.sh              # safe to run again; ./install.sh --uninstall stops it all
```

It checks for git, Docker Desktop and `sbx` (and offers `brew install --cask sbx`),
runs `brain init`, installs `brain watch` as a login item, builds and starts the cockpit
container on the first free port from 7777, opens it, and offers to put this repo's
`bin/` on your PATH. What it cannot do for you: `sbx login`, and the engines' keys —
`sbx secret set anthropic` (and `openai` for Codex), or sign in when the first run asks.

Only the cockpit is a container. `bin/brain` stays on the Mac: it drives `sbx`, which
starts the sandboxes, and opens Terminal windows, and neither works from inside one.
`brain` works on the repo it lives in (or `$BRAIN`), so a second brain on the same Mac
gets its own watcher, its own cockpit and its own port.

By hand, the same thing:

Prerequisites: `sbx` installed and logged in (`sbx login`), and Docker Desktop
running (only needed to build the templates).

```bash
# 1. put the repo in place and add the launcher to your PATH
mv agent-brain ~/agent-brain
echo 'export PATH="$HOME/agent-brain/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc

# 2. say how you like to work (working style, taste — no stack here)
open ~/agent-brain/memory/preferences.md

# 3. build + load both templates, import skills, init git
brain init
```

`brain init` builds `brain-claude:v1` and `brain-codex:v1`, loads them into sbx,
links `system/skills/*` into `~/.agents/skills` and runs `sbx skills import`. At the
end it reminds you to write your first playbook, since `system/playbooks/` starts
empty.

External skills (public or private repos) are listed in `system/skills.list` and
installed by `brain init` / `brain sync-skills`:

```
owner/repo                                    # no names = every skill in it
Leonxlnx/taste-skill design-taste-frontend redesign-existing-projects
https://github.com/YOUR-ORG/YOUR-SKILLS.git html-to-payload
keep: some-skill-you-installed-by-hand       # keep it, don't prune it
```

sbx clones on your Mac with your own git credentials, so a private repo works over
HTTPS once `gh auth setup-git` has run, or over SSH (`git@github.com:…`). The name
after the repo is the `name:` in that skill's `SKILL.md`, which is often not its folder
name. A `keep:` line is not installed from anywhere — it just protects a skill already
in the store from the prune step below.

Check with `sbx skills ls`; update later with `sbx skills update`. `BRAIN_PRUNE_SKILLS=0`
turns the pruning off.

### MCP servers and network rules

`system/sandbox.conf` declares what every sandbox gets beyond skills: MCP servers
and network policy. `brain sync-sandbox` (and `brain init`) applies it.

```
mcp github --url https://api.githubcopilot.com/mcp/   # registered + attached to new sandboxes
deny pastebin.com,*.ngrok.io                          # egress is allow-all by default
allow *.npmjs.org                                     # needed once you narrow that
```

The MCP set is fixed when a sandbox is created, so a server added later reaches
existing sandboxes only via `sbx mcp load <name> --sandbox <sandbox>` (or by
deleting the sandbox and letting `brain run` rebuild it). Policy rules apply to
all sandboxes immediately and are idempotent — re-syncing changes nothing.
Check with `sbx mcp ls` and `sbx policy ls --wide`.

## Memory is a wiki, not a log

Agents don't append notes that nobody reads later. They **compile**: each retro takes
what a finished project taught and rewrites the `knowledge/` page that owns that topic,
updates `index.md`, and appends one line to `log.md`. New evidence that contradicts a
page changes the page. Pages cross-link with `[[page-name]]`.

That means a session starts by reading `index.md` and opening three relevant pages,
not by reading all of memory. It keeps working as the wiki grows.

`projects/` and `sources/` are the raw record and never change. `knowledge/` is what
we learned from them and is always current. The rules the agents follow are in
`system/BRAIN.md`.

```bash
brain lint      # pages missing from the index, index links that point nowhere,
                # pages linked but not written yet, pages nothing links to,
                # pages with no ## Sources, citations of files that are not here,
                # pages with no tags: line or under the wrong ### of the index, a tag
                # no app and no stack names, a page about one client (move it there),
                # proposals under no heading, sources nobody compiled — and a
                # brain-wide source only one project cites, which is that client's
```

`brain` runs the same check after every phase and warns if a page and the index
disagree. (The pattern is [Karpathy's LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).)

### Feeding it documents

Two places, and which one matters. A client's brand book, their logos, a contract, a
call transcript belong to **one project**: upload them on that project's **Sources**
tab, and they stay in `memory/projects/<name>/sources/` where only that project's
phases read them. Something every project may need — an article, a process doc, a
standard you work to — goes brain-wide into `memory/sources/`, or **Memory ->
sources/** in the cockpit. Either way it is kept byte-for-byte and never edited.

A brain-wide source is then compiled into the wiki by an agent:

```bash
brain open     # "compile the new sources into knowledge/"
```

The agent writes or updates the knowledge page and cites the filename under
`## Sources`. That citation is how `brain lint` and the cockpit know a source has
actually been read, so an uncompiled document keeps showing up as work waiting.

### Does this grow out of control?

Not the part that gets read. `index.md` is what every session loads; the pages under it
are opened on demand, and a retro *rewrites* a page rather than appending to it, so 20
projects worth of lessons about one topic stay one page. `brain lint` warns when a page passes
250 lines (it has turned back into a log — split it) or the index passes 150.

Nor does every agent read all of it. Each page carries a `tags:` line (`seo`,
`web, payload`, `shared`) and sits in the index under the `###` heading of its tags. A
phase's prompt names its **Knowledge scope**: `shared`, the app its playbook comes from
and the apps that one requires, and every tag a word of the brief's `## Stack` starts
with. An SEO article for a Payload site reads `shared seo payload`, never the redesign
lessons. Remove an app and its tag drops out of every scope; the pages stay. Facts about
one client live beside their profile in `clients/<client>/`, not in `knowledge/`.

Agents write all of this through `brain-mem` (`system/skills/brain-mem/`), a CLI in the
sandbox: `scope`, `search`, `page` (tags it, files it under its `###`), `propose`, `decide`,
`check`. It refuses a write the rules forbid instead of leaving it for `brain lint` to find.
It shares its code with `bin/brain` (`lib.sh`), so the lint and the scope are one implementation.

What does grow fast is project memory, and QA screenshots worst of all: `brain-shoot`
writes full-page PNGs at three widths per URL, every review round. So `memory/projects/`
is gitignored in full — briefs, decisions, phase summaries, crawled content and those
PNGs are working material, and they stay on the machine that made them. The part meant to
outlive one project (`index.md`, `knowledge/`, `clients/`, `preferences.md`) is tracked in
memory's own repo (below). Project memory is yours to back up; git is not doing it for you.

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

### Every command and flag

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
| `brain update` | — | the base from upstream: refuses with uncommitted changes in it, then `git pull` (a merge, so this brain's own commits stay; it stops on a real conflict) and `./install.sh` again. `memory/` is not touched |
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

### The base and your memory: two repos

The brain folder is two git repos. The outer one is the **base** — `bin/`, `ui/`,
`system/`, `templates/`, the tests — and it is the same for everyone who runs the brain.
`memory/` is a repo of its own, which the base ignores: your clients, the wiki your retros
compiled, the proposals, the log. It never travels with the base.

- **Your settings are not the base's.** `system/brain.local.conf` (read before
  `brain.conf`), `system/apps.lock`, `system/skills.lock` and `system/config/` are this
  brain's own and git ignores them, so they never reach the base and an update never
  touches them.
- **Updating.** `brain update` pulls the base from upstream. What `brain evolve` taught your
  roles and playbooks is commits of your own on that checkout, so the update is a merge
  that keeps them and stops on a real conflict, as `brain app update` does for an app.
- **Backing up memory.** Give it a private remote: `git -C memory remote add origin <url>`,
  then `git -C memory push -u origin HEAD`. Each phase commits memory on its own
  (`commit_memory`); pushing is yours.
- **Giving the brain to someone.** Give them the base's URL. They clone it and run
  `./install.sh`; `brain init` starts an empty memory from `examples/memory/` as its own repo.
  A knowledge page you want them to have travels by hand: a compiled page cites the
  project records it came from, so read it first.
- **Moving to another machine.** Clone the base, clone your memory repo into `memory/`, copy
  your settings files across, run `./install.sh`, then `brain app install <name>` for each
  line of `system/apps.lock`.

A brain from before the split tracked `memory/` in the base. Its old commits still hold
that memory, so a base repo you hand to anyone else starts from a fresh history.

**Developing the base.** Keep two folders: `agent-brain-main`, the shared base you change,
commit and push, with a throwaway memory; and `agent-brain-local`, the brain you work in, a
clone of main that only pulls (`brain update`; its push URL is disabled). Test a change in
main with `./bin/brain test` and `./bin/brain test --fresh` — the second runs every suite on
a copy of the base without anything git ignores, which is exactly what someone who clones it
gets. The suites refuse to run git on the brain they run from, so a test can never commit
into a real brain. Use `./bin/brain` there: `brain` on your PATH is the local brain.

### Evals: does a playbook still produce good work?

The test suites prove the machinery; an eval proves the agents. It runs a playbook for real
on a fixed input, approves its human gates as they come, and scores what came out:

```bash
brain eval                        # the evals here, and how each one last went
brain eval run seo-article        # a real project, unattended — model money and time
brain eval score <project>        # score a run again, e.g. one you finished by hand
```

An eval is a folder `evals/<name>/` in the base or an app: `eval.conf` names the playbook,
`brief.md` is the project's whole brief, `sources/` the files it cites, and `check.sh` the
rubric, one `pass <what>` or `fail <what>` line per check (the seo app's runs its article
checks one by one and `brain-mem check` after the retro). The report goes to
`memory/evals/<name>/<project>.md`: the scorecard per phase (agent runs, minutes, FAIL
rounds, findings let through), the checks, and the totals next to the last run's, which
`results.tsv` keeps one line per run with the base and app commits it ran on. Run evals in
`agent-brain-main`, never in the brain you work in: each run is a real project whose retro
writes to that brain's memory. They are never part of `brain test`.

### How a lesson gets back into the system

`retro` writes what a project taught into `knowledge/`, and anything that should change
an instruction into `memory/proposals.md` with the evidence behind it. It cannot apply
them: `system/` is mounted read-only in every phase, so an agent can never rewrite the
instructions it is running under. That is worth keeping — and it is also why proposals
pile up, because the agents that learn the lesson are exactly the ones barred from
acting on it.

`brain evolve` is the deliberate exception, and the only command that may write
`system/`. Because it rewrites the instructions every other agent then reads, what it
may touch is not left to its judgement: `proposals.md` is two lists, agents append to
`## Open`, and **moving a line to `## Accepted` is your approval**. Evolve applies that
section and nothing else, and refuses to start when it is empty.

```bash
$EDITOR ~/agent-brain/memory/proposals.md     # move the lines you want to ## Accepted
brain evolve                                  # apply them
brain evolve "the seeder must never hardcode an internal link"   # or name it yourself
git -C ~/agent-brain diff system              # the review
git -C ~/agent-brain checkout -- system       # the undo
```

Naming the change on the command line *is* the approval, so that form needs no queue.

The cockpit does the same moves without the editor. Every proposal on the Overview, and
on each project's **Memory** tab (which also shows the knowledge pages, client profile
and log entries that project left behind), has **Accept** and **Decline**. Decline moves
the line under `## Declined`, which BRAIN.md tells agents to read before proposing, so a
retro does not file what you already turned down. **Run brain evolve** leaves a request
that `brain watch` turns into a Terminal running `brain evolve` on the brain, one at a
time. There is no per-project evolve: `system/` is one set of instructions shared by
every project, so the Memory tab's button applies everything accepted and says how much
of it came from that project.

The editor still judges: an accepted proposal it cannot support goes back under
`## Open` with its reason rather than being applied or dropped. It deletes the lines it
did apply, so `## Accepted` is empty again when it finishes — and if any line left
`## Open` during the run, `brain evolve` says so before you look at the diff. The
sandbox is thrown away afterwards.

The brain is a git repo, so the diff is the second review and there is no separate one.
Its summary lands in `memory/system-edits.md`, which is how you read a run you did not
watch — and how it avoids re-proposing what you already turned down.

The role's own bias is worth knowing: it puts a rule where the phase that *owns* it can
act on it, pairs it with the review that catches it, and prefers a command with an
expected output over "be careful with X". A rule with no check behind it is the one that
gets skipped.

### Making a playbook better after every run

`retro` asks what a project taught about the *work*. Improving the *playbook* is two
separate steps, and it works for any playbook, with or without a retro phase.

**Step 1 — analyse the runs.** Nothing in `system/` changes here.

```bash
brain playbook analyse redesign-website
```

- **The host counts.** One scorecard per project that ran the playbook, one row per
  phase: agent runs and minutes, FAIL rounds (a human rejection is one too), findings
  a later phase raised with `escaped: <phase>`, what shipped open / waived / deferred,
  and attempts the host rejected (timed out, crashed, failed verification). `—` means
  the project is older than that record, not zero. These come from files an agent
  cannot all see, and the same arithmetic scores every run, so the next run's card
  says whether the last change helped.
- **The `playbook-analyst` judges**, with `system/` read-only as in any phase. It
  traces the most expensive rework to the phase that owns the cause, not the review
  that noticed it. It checks each past edit in `memory/system-edits.md` against the
  runs since. Then it rewrites `knowledge/playbook-<name>.md`, which the next run's
  agents read at the start of their phase, and files proposals under `## Open` —
  none that is already open, declined or applied.

**Step 2 — choose, then evolve.** On the playbook's page in the cockpit, **Accept** what
should change the playbook and **Decline** what should not (or move the lines under
`## Accepted` / `## Declined` in `proposals.md`). A declined proposal stays on record, so
the next analysis does not file it again. Then apply what you accepted:

```bash
brain playbook evolve redesign-website   # this playbook's accepted proposals, nothing else
brain evolve                             # every accepted proposal, for every playbook
```

With one playbook the two do the same. With several, the first is the one you want:
you can improve one playbook while another has a project partway through it, and its
accepted lines wait until you evolve that one. A proposal belongs to a playbook when its
`[target]` names the playbook's folder or a role its phases run. One against a shared
role belongs to every playbook that runs it; one against a skill or `BRAIN.md` belongs
to none, and only `brain evolve` applies it. Both commands warn and ask before editing a
playbook a project is partway through: that project's remaining phases run under the
edited instructions, and a renamed phase orphans the files it had.

`brain run` and `brain auto` suggest step one when a playbook completes. The cockpit has
**Analyse runs** on each playbook's page and on a finished project. The playbook page
lists just the proposals that would change that playbook or its roles, with an
**Evolve <playbook>** button for step 2.

### Reaching the thing the agent is building

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

### Engine parity

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

### How a role reaches the agent

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

### The stack is per project

`memory/preferences.md` holds what is true of *every* project: how you commit, how
you like code and copy, what you find ugly. It holds no stack, because the brain is
not one stack's tool — the same brain runs a Next.js rebuild, a Python data job and
a research project.

Each project's stack goes in its own `brief.md`, under `## Stack`, and beats the
preferences. Working in an existing repo? Write "as in the repo": agents are told
to read the manifest and lockfile, and to record what they found in `decisions.md`
rather than assume. `system/brief-template.md` is the default brief; a playbook can
ship its own.

### Playbooks

A playbook is a named sequence of phases, each phase run by a role, each role run by
an engine and model you choose. That is all it is — nothing about it assumes code, a
stack, or a website.

**Playbooks come from apps, or you write them.** The web app brings `redesign-website`
and `new-website`, the SEO app `seo-article`, `aeo-refresh` and `article-combiner`, each
with the roles they run (see Apps below). `system/playbooks/` holds the ones you write
yourself; the base's `roles.conf` starts with only the authors and `retro`; the academy's
roles came with the academy app. There are no example playbooks to copy: the ones that used to live in
`examples/playbooks/` were web work, specific enough to mislead and not good enough to
copy from.

So a fresh brain starts by writing a playbook and the roles it names:

```bash
brain playbook new            # the phases, in order, and who runs each
brain role new                # each role the playbook names, both halves at once
brain playbook check <name>   # until it comes back clean
```

`brain playbook check` is the worklist: it names every role a phase calls for that
does not exist yet.

What makes a phase a *review* is the third column of `phases`, not its name: a phase
with a fix-role there is one brain can send back. Those phases write `RESULT: PASS` or
`RESULT: FAIL` into their summary — by convention they are the `*-review`, `qa`,
`audit` and `verify` phases. On FAIL, `brain run` opens a new sandbox as the fix-role
instead of the reviewer, hands it the numbered fix list, and asks it to write what it
changed into `phases/<phase>.fixed`; the next run sees that file, re-runs the review and
gives it to the reviewer as the account of the round. `brain auto` walks that loop
unattended — fix, re-review, fix — and only stops when the review passes or a ceiling is
hit. After 3 failed rounds brain stops and asks you (`BRAIN_MAX_FIX_LOOPS` in
`system/brain.conf`). A phase with no fix-role is never sent back, which is also why
`brain reject` refuses on one.

### Apps

An app is a domain packaged for the brain: its roles, playbooks and skills in one folder.
Apps live in their own repo, one folder each (`APPS_SOURCE` in `system/brain.conf`, by
default `pshiuu/agent-brain-apps`), and install into `system/apps/<name>/`:

```bash
brain app install seo                         # from APPS_SOURCE
brain app install seo --from ~/code/apps seo  # from a local folder or any git URL
brain app update seo                          # the newer version, keeping this brain's changes
brain app                                     # what is installed, and from which commit
brain app check seo                           # the app-format rules
brain app remove seo                          # refused while a project is partway through it
brain app forget seo                          # after remove: its knowledge pages to memory/archive/
```

The same from the cockpit: **Admin → Apps** is a small app store — every app as a tile,
searchable, filtered by installed or available, and a page per app with its README, its
settings and Install, Update, Revert or Uninstall. `brain watch` checks the repo when it starts and when you
press the button (`brain app catalog` at a terminal), runs each change in the background,
then `brain sync-skills` and `sync-sandbox` as needed, and shows how it went. An app with
its own Studio code asks you to trust it; Uninstall asks once (twice when this brain changed it).
Admin's Playbooks, Roles and Skills pages tag everything an app brought with the app it came
with, linked to its page. None of it can be deleted on its own, since the app's other parts
depend on it; uninstalling the app removes all of it, and `brain app remove` runs
`brain sync-skills` so its skills leave the sandbox store too.

The apps today: `seo` (articles), `web` (websites on PayloadCMS) and `academy` (theses
and papers, with commands of its own: `brain academy …`).

The brain looks into every installed app the way it looks into `system/` itself, so an
app's playbooks show up in `brain playbooks` and the cockpit, and its roles run like any
other. Nothing is copied into the base: removing the folder removes the app, and what its
projects taught the brain stays in `memory/`: removing an app only hides the knowledge
pages tagged with it, and `brain app forget <name>` moves the ones tagged with it alone to
`memory/archive/knowledge/` when you ask. An app may ship starter pages of its own in its
`knowledge/` folder; agents whose scope names the app read them, read-only. Install refuses an app that fails
`brain app check` (both halves of every role inside the app, every playbook clean, no
name the base or another app already uses), and asks before installing one that brings
its own Studio code. `system/apps/` is not in git; `system/apps.lock`, this brain's own and
ignored too, records where each app came from, so you can install the same ones again. The format is
`system/skills/app-format/SKILL.md`.

What your runs teach an app stays on your machine. `brain evolve`, Adjust playbook and the
Roles page change the installed copy in `system/apps/<name>/`, and the untouched copy in
`system/apps/.base/<name>/` is what it is compared with:

```bash
brain app diff seo                  # what this brain changed in the app
brain app revert seo [file]         # drop those changes
brain app update seo                # the new version, merged with yours; stops on a real conflict
brain app promote seo [file]        # app developers: into the apps repo (APPS_DEV), to push
```

**What an app may declare.** Besides its roles, playbooks and skills, an app's `app.conf`
says what its sandboxes reach and what it needs from you:

```
mcp      dataforseo https://mcp.dataforseo.com/http           an MCP server its agents get
secret   dataforseo basic <check-url> DataForSEO API login     that server's key (basic or bearer)
setting  serp toggle on Live Google results                    a value its skills read
allow    api.openalex.org,doi.org                              hosts its sandboxes may reach
```

An app's `secret` and `setting` lines become a Settings section on its page in Admin → Apps. A key is checked at the check URL, stored by `brain watch` in sbx's secret store (the
agent never sees it) and only then goes into new sandboxes; settings land in
`system/config/<app>.conf`, outside the app's folder, so an update keeps them. `mcp` lines
without a secret and `allow` lines are registered by `brain sync-sandbox`, like those in
`system/sandbox.conf`.

`brain test` runs everything that says the brain works — the test suites, the lint,
every playbook check and every installed app's check and tests — in one go.

### Human gates

A phase whose role is `human` waits for you. `brain run` prints what to look at and
returns; `brain auto` parks there and keeps waiting, so an overnight run stops *at* your
design gate instead of unwinding, and carries on the moment you decide — from this
terminal, another one, or the cockpit. Approve or send it back with feedback:

```bash
brain approve design-approval
brain reject design-approval "Hero feels generic" "Footer needs opening hours"
```

Each argument to `reject` becomes one numbered item and one `OPEN` defect, and the
phase's fix-role picks them up on the next `brain run`; its `.fixed` has to name every
id. A gate with no fix-role (a final sign-off like `launch-gate`) cannot be rejected;
send the playbook back to the phase that made the work instead:

```bash
brain reopen port "the price chart must pre-select the current hour"
```

Approving a review that still has open findings does not erase them: each one is
recorded `WAIVED` (or `DEFERRED` with `--defer <id>`), `brain status` shows the count on
that phase, and retro reads them.

**Clients are an app.** Install `clients` (Admin → Apps) when you do client work: then a
project can be for a client, whose profile in `memory/clients/<client>/profile.md` every
project for them reuses, the Studio gets its Clients pages, and `brain new --client <slug>`
works. Without it no project has a client, an input a playbook asks once per client is
asked with every project instead, and `memory/clients/` stays on disk, unread, until the
app is back.

### Optional phase contracts

Add `system/playbooks/<name>/contracts/<phase>` to enforce mechanical requirements
for an agent phase. No extension, YAML parser or database is needed:

```text
# Paths are literal, relative to project code or this project's memory.
input memory:brief.md
output project:deliverable/report.pdf
evidence memory:qa/validation.txt
check 120 ./scripts/validate.sh
```

`input` requires a nonempty regular file before the agent starts. `output` requires
one after verification. `evidence` additionally requires a file newer than the
attempt's start marker and keeps a copy in that attempt's host record. Paths may
contain spaces, but have no glob expansion, absolute paths, `.`/`..` components or
symlink components. Comments occupy their own lines. Unknown directives fail validation.

`check` is a timeout in seconds (1–86400), followed by a shell command. The host runs
checks in order **inside the project's sandbox**, from the project root, after the
agent exits. It records combined stdout/stderr and exit status, stops at the first
failure, then checks output/evidence files. A sandbox `timeout` command bounds each
check, with five seconds to terminate before forced killing; a missing executable
also fails verification. A stalled sandbox transport is not yet covered by that
command timeout. Checks must start any services they need because autostop may have
stopped the agent's services.

Contracts are trusted system configuration: use repeatable verification commands,
not publishing, deployment or other external effects. The commands are snapshotted
before launch and never read from the agent's writable memory as instructions.
Checks also run after fix handoffs; a reviewer reporting FAIL proceeds to the fixer
without having to pass acceptance checks. A failed host check stops `auto` with exit
2 and preserves diagnostics; it does not automatically create a reviewer verdict or
retry the command. Fix the cause and rerun the phase.

The existing `phases` row still owns the reviewer, fix-role and human approval.
Contracts on `human` phases are rejected: put checks on the preceding agent phase.
Run `brain playbook check <name>` to validate contracts; the cockpit's checks report
the same grammar and phase errors. Existing playbooks without contracts keep their
handoff-only behavior.

### Leaving it running

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

### Switch agents, models and effort

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

### Add a dev path

```bash
brain playbook new [name]      # asks everything it needs
brain playbook new seo --engine codex --model gpt-5.4 --effort high   # or pick the drafter up front
brain playbook check <name>    # the rules that otherwise fail mid-phase
```

`brain playbook new` offers three ways in, because a playbook is mostly a judgement
about *order and gates*, not typing:

| | |
|---|---|
| name the phases yourself | asks phase by phase: the name, the role (from a menu of what is in `roles.conf`), the fix-role if it is a review, and the one line the phase's agent will be handed. Writes `phases`, `playbook.md` and `brief.md` so they already agree |
| let an agent draft it | describe the path in a sentence and the `playbook-author` role drafts all three files. You see what it wrote and the check result before anything is installed |

The drafting agent is a role like any other, `playbook-author`, so its instructions are
a file you can edit and its engine, model and effort come from `roles.conf`. That line
is only the default: the draft route asks you each of the three with it pre-filled, so
three keystrokes keep it and a typed answer — or the flag above — wins for that one
draft. Designing a path is the kind of work where reaching for a bigger model, or a
second opinion from the other engine, is worth the prompt. The
format itself is not in that role: it is the `playbook-format` skill, which is also
what an agent repairing a playbook later will reach for. Run `brain sync-skills` once
after pulling, so the skill reaches your sandboxes (the role also names its path, so
it works before you do).

Two things that role is told **not** to do. It never invents a role: it reads
`roles.conf` and the existing `roles/*.md`, uses what fits, and when nothing does it
says so and asks you rather than deciding. If you agree a new role is needed, it writes
the proposed instructions into its own workspace, and `brain` shows you that file and
offers to install it — you pick the engine and model, and both halves get written
together. Decline, and the playbook still installs; `brain playbook check` keeps
failing on the missing role until you create it, which is the point.

It drafts into a scratch workspace, never into `system/`: that stays mounted read-only
in every sandbox, so no agent can rewrite the instructions it runs under. Nothing is
installed until you say yes, so an abandoned session leaves no half-made playbook.

Each draft gets its own folder — `.drafts/playbook/<name>/`, and `.drafts/role/<name>.md`
for a role — so two drafts never write `phases` and `playbook.md` over each other, and
one you declined is still there after the next. The *workspace* above them is fixed,
because a sandbox's mount is chosen once at create time and cannot vary per draft.
`.drafts/` is gitignored.

### A path that starts from a code repo

A playbook that builds on a starter names it in `playbook.env`, next to `phases`. Two
variables, read at two different moments, and which one you want is a question about
*when the choice is known*:

| | read by | when |
|---|---|---|
| `TEMPLATE_REPO`, `TEMPLATE_BRANCH` | `brain new` | at project creation. Clones into the code directory, drops the template's history, commits `Start from template <name>@<sha>`, and records `TEMPLATE=` in `project.env`. The folder must be empty |
| anything else | the phase that needs it, from `$BRAIN_SYSTEM/playbooks/<path>/playbook.env` | whenever. `system/` is mounted in every sandbox, so a phase reads the file itself |

`redesign-website` uses the second form, with `STARTER_LOCALIZED` and `STARTER_SINGLE`:
localized and single-language are separate repos, and which one a project needs is not
known until `intake` has asked about locales — after `brain new` has already run. So
`scaffold` reads the decision out of `decisions.md` and clones accordingly, and the
playbook tells it to stop and ask rather than guess. A starter named in the brief's
`## Stack` overrides both, and the porter says so in its summary.

Fill the two in before the first run — they ship empty, because they are private repos
and yours are not mine:

```bash
$EDITOR ~/agent-brain-apps/web/playbooks/redesign-website/playbook.env   # then commit and push it
brain app install web
```

The file ships with the web app, so an edit to the installed copy in `system/apps/web/` is
replaced by the next `brain app install web`.

The sandbox a draft runs in is deleted when it finishes, unlike a project's. A project
sandbox is reused by every phase of that project, for days; a drafting one is used once
and would then sit in `sbx ls` for good. Rebuilding it costs about six seconds against
an authoring session measured in minutes. The draft itself is on your Mac, in
`.drafts/`, so nothing is lost with the container.

Both the check and the questions enforce the rules that otherwise surface halfway
through a run: every role exists in `roles.conf`, every review phase has a fix-role
(without one a `RESULT: FAIL` re-runs the reviewer, which never edits, and
`BRAIN_MAX_FIX_LOOPS` cannot stop it), every phase has a `## <phase>` section — that
section *is* the instruction brain hands the agent — and the `> ` description line
exists, since `brain playbooks` prints it. A `#` comment parked on a data line is read
as the fix-role, so that is flagged too.

One of them is a `·` note rather than a `✗`: a `human` gate with no fix-role. You can
still approve it, but `brain reject` refuses, so the way back is `brain reopen` on an
earlier phase — right for a final sign-off, a defect anywhere else. A phase whose
fix-role is its own role is a `✗`: a review cannot fix its own findings. The cockpit's checks and
`brain playbook check` report the same set at the same levels.

In the cockpit, **Playbooks -> New playbook**: give it a name and a description, and
either start from a skeleton (plan, build, code-review, retro, runnable and lint-clean
straight away) or copy an existing playbook, which rewrites the title and description and
keeps the phases. Delete from the playbook's own page; it refuses while any project still
points at it, since `project.env` carries `PLAYBOOK=<name>` and `brain status` and
`brain run` both fail without the folder.

By hand it is the same thing: create a folder under `system/playbooks/`, write `phases`
(phase, role, fix-role), `playbook.md` (first `> ` line is the description) and
`brief.md`. New roles go into `system/roles/` and `roles.conf`.

`system/` is not auto-committed (`commit_memory` stages only `memory/`), so commit a
playbook you care about; `git -C ~/agent-brain checkout system/playbooks/<name>` is the
only undo for a delete.

### Add or remove a role

A role is two files that have to agree: a line in `roles.conf` (which engine and model
runs it) and `system/roles/<name>.md` (what it is told to do). `brain role new [name]`
writes both, and so does **Roles -> New role** in the cockpit — half a role is the
commonest lint error. Delete from the role's own page;
it refuses while any playbook names it in either column, since `brain` reads the role
straight out of `phases` and the phase would fail on its next run.

Which role runs which phase is set on the playbook page: every phase row has a role and
a fix-role dropdown, listing only roles that exist. The raw `phases` editor is still
there underneath for bulk edits — the dropdowns just rewrite one line and leave your
comments and alignment alone.

A fix-role is who gets called when a review phase writes `RESULT: FAIL`. Review roles
(`*-reviewer`, `qa`) need one or the run loops on the reviewer, which is why the lint
treats a missing one as an error rather than a warning.

## Academy workspaces (theses, papers, research)

Playbooks run a project through phases to "done". A thesis is not that: it runs for
months, in many short tasks in no fixed order. The **academy** app is that second way of
working: `brain app install academy`, then `brain academy new <name>` and its verbs
(`find`, `ingest`, `ask`, `talk`, `draft`, `review`, `check`, `export`, …). Its README is
the manual. A workspace is its own git repo with `KIND=academy` in its `project.env`; the
playbook commands refuse it.

An app gets commands of its own this way: its `cli.sh` defines `cmd_<app>`, and
`brain <app> <verb>` sources it (`system/skills/app-format/`).

Admin → Memory draws the brain's own `knowledge/` as a graph.

## Cockpit (web UI)

One local server, two front ends on the same API:

- **Studio** at `/` — for the people the work is for, with no engine words. Projects
  grouped by **area** — the `Area:` line under a playbook's description (`Content`,
  `Websites`, …); a playbook without one is in `Other` — each with a step bar, and what
  waits on you on top. **New project** offers every playbook with a brief or an
  `inputs` file, the most used first: its inputs are the form, its brief's headings the
  rest, and a client's answers are asked once. The review, where you select a passage to
  comment on it and **Send back** turns each comment into one numbered fix that must be
  answered (`brain reject`, with the quote), or **Approve** (`brain approve`) — both
  start the next steps. **Copy** when the project wrote `content/article.md`; progress
  and brief for every project. **Adjust playbook** (on a finished project: **Feedback on
  the playbook**) when a playbook's results do not come out as wished (below); and
  **Clients**. A project page is built from the files the project has, not from its
  area, so a new kind of work needs no Studio change; a tab for a new kind of output is
  one entry in `tabs` in `ui/public/studio.js`.
- **Admin** at `/admin` — the engine room below: everything that is not running a
  phase, for whoever runs the brain.

Admin is a local web UI for cross-project status, the playbooks and their instructions,
roles, skills, human gates and QA screenshots.

```bash
docker compose up -d            # http://127.0.0.1:7777 (COCKPIT_PORT in .env)
docker compose up -d --build    # after changing anything in ui/
docker compose down
```

It bind-mounts the brain read-write and `~/dev` read-only, and binds to loopback only.
It deliberately cannot call `brain` or `sbx` (those are host binaries), so running a
phase stays in your terminal; the UI shows the command to paste. `./install.sh` writes
`.env` with this Mac's paths and port; without one, compose mounts the folder you run it
from and `~/dev`.

### From the browser, with no terminal

Someone who never opens a terminal can run the whole loop from the cockpit once
`brain watch` is a login item (`brain watch install`, once, by you):

| | |
|---|---|
| New project | the Overview form: playbook, name, client, and one box per heading of the playbook's brief. It stages `memory/.new/<slug>/` and `brain watch` runs `brain new` for it a tick later — the container cannot, since `~/dev` is mounted read-only. A refusal stays on the row until you discard it |
| Run | a button per project, with the same **then start** picker as the verdict box. It leaves the `.run-request` a verdict does. `BRAIN_MAX_PARALLEL` in `system/brain.conf` (default 3) caps how many projects run at once; the rest show as queued and start as windows close |
| Inputs | what a playbook asks for when a project starts, typed: short or long text, a web address, a list of them, a number, a choice, files. Each is asked for every project or once per client. The playbook's page edits them as rows with the form beside it; the author drafts them with the playbook. They live in `system/playbooks/<name>/inputs`, one line each (`<input> <type> <per> <need> <label>`), and `brain playbook check` holds them to the same rules as the cockpit. A per-project answer lands in the project's `brief.md` under its label, so no agent reads anything new; a per-client one in `memory/clients/<client>/profile.md`, with its files in `clients/<client>/sources/` (not committed, like project sources). URLs are checked as you paste and `example.com/page` gets its `https://` |
| New playbook | describe the work and the `playbook-author` drafts it in a Terminal window `brain watch` opens, asking its questions there. The draft gets its own page under Playbooks: phases, sections, the roles it proposes with an engine, model and effort picker each, and the problems `brain playbook check` would find. **Install** writes the playbook and both halves of every proposed role, then asks `brain watch` to commit `system/`, so an installed draft is one `git revert` away. **Open the author again** sends it back with your changes; it revises instead of starting over |
| Adjust with AI | for a playbook that did not come out as wished: say what should be different, on the playbook's page in Admin or with **Adjust playbook** on any project in the Studio. The draft starts as a copy of the installed playbook (never its `playbook.env`, which `brain new` sources on the host), the `playbook-author` revises it, and the draft page marks each phase new, changed or removed against the installed one. **Install changes** (Studio: **Apply changes**) writes it over the playbook and asks `brain watch` to commit; **Discard** leaves the playbook as it was. Role instructions are shared between playbooks and stay `brain evolve`'s; an adjustment changes the playbook's own sections |

Each of these leaves a request file under `memory/` (`.new/`, `.run-request`,
`.draft-request`, `.commit-request`) and `brain watch` acts on it; nothing in the
container runs a host command. When nobody is listening the cockpit says so on the
page, with the one command that fixes it for good.

### Starting the run from the cockpit

Approving or requesting changes only writes the verdict — the container has no way to
reach your terminal, and a web server on your Mac that can run host commands is a worse
trade than typing eight characters. `brain watch` is the bridge, and it runs as you:

```bash
brain watch          # leave it in a spare tab
```

With it running, the verdict box's **then start** picker (per browser, remembered)
opens a new Terminal window on the project and runs `brain auto` or `brain run` for you.
The cockpit writes one word into `memory/projects/<name>/.run-request`; `brain watch`
accepts `run` and `auto` and nothing else, skips a project that already has a phase in a
sandbox, and keeps a heartbeat at `memory/.watch` so the cockpit can tell you when
nothing is listening instead of looking broken. Stop it and the buttons go back to
saving the verdict and showing you the command.

What it is good for:

| | |
|---|---|
| Overview | every project at once, which phase is next, and what is blocked on **you**. `brain status` is one project at a time and only from inside its folder |
| Blocked states | `brain status` shows done / failed / pending. The cockpit also separates "waiting for the fixer", "fixed, waiting for the reviewer" and "failed N/3, `brain run` will stop and ask you" |
| Playbooks | each phase row next to its `## <phase>` section of `playbook.md`, which today live in two different files. Edit the section in place; create from a skeleton or a copy, and delete (blocked while a project still points at it) |
| Checks | cross-file problems that otherwise surface mid-run: a role in `phases` that is not in `roles.conf`, a phase with no section in `playbook.md`, a review phase with no fix-role, a `#` comment on a data line that parses as a field |
| Human gates | approve, reject or send the playbook back with the design and the QA screenshots on the same page. Open findings are listed with a box each to defer instead of waive. Same texts and records as `brain approve`, `reject` and `reopen` |
| Runs | every run the project has made, newest first: how long, how many turns, tokens written, which skills the role declared and which it actually invoked. A phase that failed twice has three runs, under two different roles, and each carries the role file it ran against as it read at the time |
| Roles | engine, model and reasoning effort per role, from dropdowns; each rewrites that one line of `roles.conf` |
| Skills per role | tick which skills a role should reach for. Neither CLI can restrict a run's skill set, so this writes a `Skills:` line into the role's instructions: it directs the role, it does not sandbox it |
| Skills | every skill the brain declares, own and external, in one list. This is the set `sync-skills` installs and prunes to, so it should match `sbx skills ls`; the container cannot run `sbx` to confirm it |
| Installing a skill | paste a GitHub repo, pick from the skills it actually contains, and it writes the `skills.list` line for you. It reads each `SKILL.md` for the real name, which is often not the folder name (`output-skill/` is `full-output-enforcement`) |
| Removing a skill | **Remove** on any external or host skill drops it from `skills.list`; your own skills get a type-the-name confirm on their page. Both only change what the brain declares — the cockpit then shows the `sbx` command that actually uninstalls |

### Adding someone else's skill

Two steps, and the order matters:

1. In the cockpit, **Skills -> Add skills from a repo**. Paste `owner/repo` or a GitHub
   URL, pick the ones you want, and it merges them into the right `skills.list` line.
2. `brain sync-skills` in the terminal. Nothing is installed until you do.

Do **not** run `sbx skills add` yourself: `sync-skills` builds its keep list from
`skills.list` and removes everything that is not on it, so a skill added directly is
installed and then pruned on the next sync.

### Removing a skill

Same two steps, same order. In **Skills**, hit **Remove** next to an external or host
skill and it comes out of `skills.list` — if that empties a repo line, the line goes too,
because a repo with no names installs everything in it and the next sync prunes it all
back out. Your own skills are directories, so they get the type-the-name confirm on their
own page, like a role or a playbook.

Then apply it in the terminal. The cockpit shows both options:

```bash
brain sync-skills                  # prunes everything off the keep list in one pass
sbx skills rm --force <name>       # or just this one, now
```

Neither runs from the cockpit: it is a container with the brain repo bind-mounted, and
`sbx` is a host binary. That is deliberate — it has read-write access to the whole brain
and no auth, so it edits files and hands you commands rather than executing them.

The name in `skills.list` is the `name:` field of the skill's `SKILL.md`, which is often
not the folder name. The lookup reads the frontmatter so you get the right one. Private
repos still work in `skills.list` (sbx clones them on your Mac with your git
credentials), the lookup just cannot enumerate them, so type the names by hand.

Saves are atomic, refuse to overwrite a file you changed in your editor meanwhile, and
skip writing when nothing changed (rewriting a phase summary with identical bytes would
bump its mtime past the `.fixed` marker and re-run the fixer). Edits to `system/` are not
auto-committed, so `git -C ~/agent-brain diff` is your undo.

```bash
node ui/test.mjs        # self-check for the file-contract invariants
node ui/server.mjs      # run on the host instead of Docker, if you prefer
```

## SEO, AEO and GEO content

Two playbooks, four roles and one skill that they share. Each article is a project.

| Playbook | Steps (**you** = a gate in the cockpit) |
|---|---|
| `seo-article` | research → outline → **you** → images → draft → editor check ⇄ writer → **you** → retro |
| `aeo-refresh` | research: the live page, and a plan per section → **you** → rewrite → editor check ⇄ writer → **you** → retro |

- **Roles**: `seo-researcher` (what ranks, what people ask, a primary source per number),
  `seo-writer` (outline, article and every fix round, in the client's voice),
  `seo-reviewer` (the editor check — it never edits), `image-researcher`. `retro` is
  shared with every path; each playbook's `## retro` names what it should learn.
- **Inputs**: keyword, language, audience, angle, pages to beat — per article. Website,
  market, author, tone of voice, texts in their voice, competitors — once per client,
  the same labels in both playbooks, so a client is entered once.
- **The article** is `memory/projects/<name>/content/article.md`, in the format
  the SEO app's `skills/seo-content/SKILL.md` fixes: front matter for the CMS fields, a 50-word
  opening answer, question headings answered at once, a `## FAQ`, a link beside every
  number, images with a licence.
- **The editor check** is half script, half judgement. `article.mjs check` measures
  (✓ / ! / ✗ per check, exit 1 on a ✗): the keyword, meta lengths, headings, length
  against the research, internal links, alt text and licences, the opening answer, the
  FAQ, sourced numbers, author and date, dead links. The writer runs it before handing
  over, the reviewer runs it, and `contracts/editor-check` runs it again after a PASS or
  a fix, so neither can hand over an article it fails. The reviewer judges the rest:
  coverage, intent, every fact against its source, the voice.
- **Webflow** by copy and paste: a project with an article has a **Copy** tab with a
  Copy button per field, the body copied as rich text, the images to upload with their
  alt text and credit, tables as Embeds, and the Article + FAQPage JSON-LD. It is rebuilt
  from the file on every open. Approve the final gate once it is in Webflow.
- **Images**: royalty-free, from Openverse and Wikimedia Commons (no API key): CC0,
  public domain, CC BY and CC BY-SA, never NC or ND, licence confirmed on the source page,
  the file URL recorded rather than downloaded.
- **DataForSEO** is optional. Without it the research uses web search and writes
  volume and difficulty as `unknown`. Connect it on the app's page, **Admin → Apps → SEO & content**,
  in the Settings section its `app.conf` generates (see "What an app may declare"): the API login and password
  (from the API Access tab) are checked against DataForSEO, then `brain watch` stores them in
  sbx's secret store, registers the server and loads it into the sandboxes that exist. The
  key is never written to a file in the brain. The same page switches each use on or off —
  volume and difficulty, the live SERP, what AI engines answer — in `system/config/seo.conf`;
  a use that is off is researched as if DataForSEO were not connected.

## graphify

Inside a sandbox, the `mapper` role (or you) runs `brain-graphify-setup` once per project.
It installs the graphify skill project-scoped and keeps its files out of git via
`.git/info/exclude`. Then `/graphify .` (Claude) or `$graphify .` (Codex) builds the map;
`graphify update .` refreshes code-only for free. The `repo-map` skill tells agents to
query the graph instead of reading files one by one.

## Run receipts

Every `brain run` agent attempt first creates a host record, for Claude and Codex alike:

```
.runs/<project>/<phase>/<timestamp-uuid>/
  plan.json       requested engine/model/effort, limits, Git state, output contract
  context.json    input paths and SHA-256 hashes, declared skills and known omissions
  role.md         role snapshot before launch
  prompt.md       exact kickoff prompt
  contract        optional phase contract snapshot
  result.json     agent claim and separate host handoff verdict after exit
  summary.md      phase summary as found at exit, when present
  handoff.*       other available handoff files
  evidence/       check commands, logs, exit codes, artifact hashes and evidence copies
```

These records are written once by the host, outside the phase sandbox's `system/`
and `memory/` mounts. Recording uses Bash, awk, Git and shasum, already used by the
launcher; Node.js is needed only for the optional cockpit and JavaScript development
tests. A private `inputs.nul` file stores paths and hashes for comparisons without a
JSON parser. No database or new host runtime is required.

Records are gitignored, in neither repo, and need a backup alongside
project memory. They are not protected from the host user, or a
session explicitly mounting the whole brain repository. Free sessions, drafting and
evolve do not use these records.

**Human verdicts are records too.** `brain approve`, `reject` and `reopen` (and the same
buttons in the cockpit) each write a record with `plan.json` (`actor: human`) and a
`result.json` naming the outcome, the feedback items, the defects it waived, deferred
or verified, and the phases it reopened, whose `.done` files are kept in it. Every
change of phase state now leaves one directory.

**A launcher that dies is noticed.** `.running` holds the attempt's run id, and the
record holds the launcher's pid (`launcher`, written before `plan.json`). A dead pid
means nobody will finish that attempt: the next `brain run`, `brain status` or
`brain watch` closes it as `crashed`, holds any `.done` or `.fixed` it wrote after the
lease as rejected, and removes the lease, so neither the phase nor the cockpit's watch
stays blocked. A record with a plan, no result and no live launcher is closed the same
way.

The inventory captures declared inputs, not proof of what an agent read. It includes
the brief, decisions, phase handoffs, project sources, configuration and locally
resolvable declared skills, plus `system/skills.lock` — the commit each external skill
repo was at when `brain sync-skills` installed it. What a Claude run actually read is
in its transcript receipt (below). Effective sandbox policy is not claimed to be
verified. The prompt carries the playbook's preamble and the phase's own section, so
`prompt.md` holds the instruction the agent was given, not a path to it.
Inputs can still change during a run; `changed_inputs` records hash differences at
exit. Git state includes the tracked diff and untracked file content, excluding ignored
files. This is an audit foundation, not a reproducible filesystem snapshot.

The host validates the existing handoff contract before accepting an attempt:

- Work: a fresh, nonempty summary and a fresh `.done`.
- Review: a fresh summary with exactly one `RESULT: PASS` or `RESULT: FAIL`, and a
  fresh log ending in the matching `YYYY-MM-DD PASS|FAIL` line. PASS also needs a fresh
  `.done`; FAIL must not create one.
- Fix: a fresh, nonempty `.fixed`, without a fresh `.done`. A fix cannot approve itself.

For a review or a fix, the host then checks the summary's `## Defects` block
(`BRAIN.md`): FAIL needs an `OPEN` defect and PASS none, every id the previous summary
had `OPEN` must still be listed, and a `.fixed` must name every `OPEN` id. A review that
breaks this is `defects_invalid`: its summary and log are put back as the attempt found
them (the agent's version is `rejected.md` in the record), so the review runs again
instead of sending the fixer a list the host refused.

Invalid completion markers are preserved in the host record and removed from phase
state. An incomplete handoff or failed contract exits 2 and stops `auto`; the agent
timeout exits 3. Explicitly rerunning a completed phase archives its previous `.done`
before launch. Contracted attempts withhold proposed markers until verification
finishes; interrupted verification cannot publish a completion marker. The result
distinguishes `blocked`, `handoff_valid`, `verified`, `verification_failed`,
`defects_invalid`, `crashed` and, for human records, `approved`, `rejected` and
`reopened`. `verified` means the declared mechanical checks passed, not that a human
approved. Phase state is still read from the marker files; the records are the audit
trail beside them.
Legacy marker state stays compatible. The cockpit reads the newest attempt's record
from disk and, when the host rejected it, shows the verdict on the phase — every check
with its command and exit status, the log each one printed, and the line saying which
output, evidence or check failed. A `verified` attempt says nothing: a verdict is only
news when it is bad. Its own transcript receipts are still shown below that.

Check this contract without a sandbox with `bash test/state.sh`, `bash test/contracts.sh` and
`node test/run-record.mjs`, alongside `node ui/test.mjs` and `bash -n bin/brain`.

Claude transcript receipts remain in `memory/projects/<p>/phases/<phase>.runs/`: a
`<run-id>.json` with duration, turns, model, tokens, the tools it called, the skills it
invoked and the brain files it read (`reads`). The run id is the host record's, and
`run-record.sh finish` copies the receipt in as `transcript.json` and fills
`resolved_model` from it; the role file and summary that run had are that record's
`role.md` and `summary.md`. Older receipts are `<timestamp>.json` with
`<timestamp>.<role>.md` beside them, and are still read. One per run, not one per phase: a review that took three fix
rounds ran three times, under the reviewer and its fix-role in turn, and what changed
between them is the question worth asking. Read them in the cockpit's **Runs** tab or on
the phase page, which opens with them.

The transcript receipt is read by `brain-runlog` inside the sandbox and printed at
the end of the run. Codex has no receipt from that helper; its host plan and result
still exist. Transcript collection remains best effort.

## Crawling a site

`brain-crawl` turns pages into markdown a role can quote and cite:

```bash
brain-crawl https://old-site.example/about
brain-crawl --sitemap https://old-site.example/sitemap.xml
```

One file per URL under `crawl/`. The script ships in the template; crawl4ai does not.
The first `brain-crawl` in a sandbox installs it there (~20 s, ~730 MB — mostly scipy,
litellm and a second Playwright), and it lives and dies with that sandbox. It reuses
the Chromium the image already has, so no browser is downloaded again.

That is a trade, not an obvious win: an image layer is shared by every sandbox, a
writable layer is not. On demand costs 730 MB per sandbox that crawls; baking it into
the Dockerfile next to graphify would cost ~2.9 GB once (both images, in Docker and in
sbx's store) and nothing per sandbox. Break-even is around four crawling sandboxes, so
if most of your projects crawl an old site, move it into the image.

The `web-crawl` skill tells a role when to use it, and to cite the file rather than a
page it never fetched.

## Looking at what is running in the sandbox

Playwright's Chromium runs headless inside the sandbox; nothing is installed on your
Mac. To open a dev server (or anything else the agent is serving) in your own browser,
expose its port from the sandbox — see "Local development" in the Docker Sandboxes
docs.

## Updating the template

`brain init` never bumps anything: it reads `templates/VERSION` and builds
`brain-<engine>:<that version>`. The file is yours to edit.

**Rebuilding the same version** (the usual case, for an additive change like a new
`templates/bin/` script) replaces the tag. Two things follow: the previous image loses
its tag and becomes a dangling `<none>` — that is where most of Docker's "reclaimable"
space in a brain comes from — and **existing sandboxes keep the image they were created
from**. `ensure_sandbox` passes the tag only when creating one. To pull a change into a
sandbox that already exists, delete it and let the next `brain run` rebuild it:

```bash
sbx rm --force <project>-<engine>     # ~6s to recreate, nothing is lost:
                                      # memory, system and the code are host mounts
```

**Bumping to `v2`** is the deliberate break: new projects get v2, running projects keep
v1 until their sandbox is deleted. It also means two ~5 GB images in Docker and two in
sbx's store until you remove the old one by hand:

```bash
docker image rm brain-claude:v1 brain-codex:v1
sbx template rm brain-claude:v1       # and brain-codex:v1
```

Bump when a change would break a project mid-flight; rebuild in place when it would not.

## Disk space

A brain is not small, and it is stored twice: `brain init` builds a Docker image and
then loads a copy into sbx's own containerd store. On the machine this was written on,
`brain-claude:v1` and `brain-codex:v1` are 4.7 and 5.0 GB in Docker, with ~6.5 GB in
`~/Library/Application Support/com.docker.sandboxes`.

**Sandboxes are nearly free.** They share the template's layers and add only their own
writable diff, which is why one costs ~6 s to create. The exception is anything
installed *inside* one — `brain-crawl` pulling crawl4ai is 730 MB in that sandbox alone.

What actually stacks up: template versions you keep, per-sandbox installs, and ordinary
Docker leftovers.

```bash
docker image prune        # dangling <none> only — the orphans left by rebuilds
docker builder prune      # build cache; costs you a slower next build
sbx prune                 # stopped sandboxes; each is ~6s to recreate
```

**`docker image prune -a` is not one of these.** It deletes every image no container
references, and a brain image has no container — sbx runs from its own store — so it
takes out both templates along with anything else you have pulled but are not running
right now. A *stopped* container does protect its image, so databases you restart
survive; `docker container prune` removes those containers and with them that
protection. `docker volume prune` can delete database data from containers you removed.

## Things to check on first run

These depend on sbx behavior that changes quickly (kits/skills are experimental):

- `sbx ls` output: `brain` expects the sandbox name in the first column after a
  header line. If sandboxes get re-created every run, adjust `sandbox_exists` in `bin/brain`.
- Mounts: `system` (read-only) and `memory` (read-write) go in as extra workspaces on
  the `sbx create` line, in its `HOST:ro` form, and land on the same path they have on
  your Mac — which is what `$BRAIN_SYSTEM` and `$BRAIN_MEMORY` point at. `sbx mount`
  takes a different spec (`HOST:CTR_TARGET:ro`), so if you add a mount by hand, give it
  the target path twice. Check one with
  `sbx exec <sandbox> -- touch $BRAIN_SYSTEM/x` — it must fail read-only.
- If template builds or in-sandbox installs fail on downloads, allow the domain:
  `sbx policy allow network <domain>`.
- If you don't have Docker Desktop: `sbx run claude`, install Playwright/graphify
  inside by hand, then `sbx template save <sandbox> brain-claude:v1` (same for codex).
