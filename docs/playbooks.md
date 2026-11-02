# Playbooks and roles

Writing playbooks and roles, review loops, human gates and phase contracts.

## The stack is per project

`memory/preferences.md` holds what is true of *every* project: how you commit, how
you like code and copy, what you find ugly. It holds no stack, because the brain is
not one stack's tool — the same brain runs a Next.js rebuild, a Python data job and
a research project.

Each project's stack goes in its own `brief.md`, under `## Stack`, and beats the
preferences. Working in an existing repo? Write "as in the repo": agents are told
to read the manifest and lockfile, and to record what they found in `decisions.md`
rather than assume. `system/brief-template.md` is the default brief; a playbook can
ship its own.

## Playbooks

A playbook is a named sequence of phases, each phase run by a role, each role run by
an engine and model you choose. That is all it is — nothing about it assumes code, a
stack, or a website.

**Playbooks come from apps, or you write them.** The web app brings `redesign-website`
and `new-website`, the SEO app `seo-article`, `aeo-refresh` and `article-combiner`, each
with the roles they run (see [Apps](apps.md)). `system/playbooks/` holds the ones you write
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

## Human gates

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

## Optional phase contracts

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

## Add a dev path

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

## A path that starts from a code repo

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

## Add or remove a role

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
