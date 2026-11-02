---
name: playbook-format
description: The file contract for a brain playbook (phases, playbook.md, brief.md) and the rules that make one actually run. Use when writing, reviewing or repairing a playbook, or when brain could not read one.
---

# Playbook format

A playbook is a folder, `$BRAIN_SYSTEM/playbooks/<name>/`, holding three required
files and optional phase contracts.

## `phases` — the pipeline

```
# phase        role              fix-role (who fixes when this review FAILs)
plan           planner
build          builder
code-review    code-reviewer     builder
retro          retro
```

- One line per phase, in the order they run. Columns are whitespace separated.
- `#` starts a whole comment line and nothing else. A `#` parked after a role is read
  as the fix-role — a real bug that brain cannot see.
- `role` needs a line in `$BRAIN_SYSTEM/roles.conf`, or is `human` for a gate the
  person approves with `brain approve <phase>`.
- The third column is what makes a phase a **review**. Brain runs that role when the
  review writes `RESULT: FAIL`, then runs the review again. A review without one loops
  on itself: brain re-runs the reviewer, which is forbidden to edit, and the round
  counter lives in the branch that needs a fix-role, so `BRAIN_MAX_FIX_LOOPS` never
  stops it.
- **A `human` gate needs one too.** `brain approve <phase>` works without it, but
  `brain reject <phase> "..."` refuses on a phase with no fix-role, so a gate without
  one can only ever be said yes to. The fix-role is whoever made the thing you are
  rejecting: the designer for a design gate, the copywriter for a copy gate. Leave it
  off only for a final sign-off, where there is nothing left to send back to.

## `playbook.md` — what each phase does

```
# Playbook: <name>
> One line. `brain playbooks` and the cockpit print this.

What every agent on this path should know before any phase runs.

## <phase>
What this phase produces, where it goes, and the gate it must pass.
```

An optional `Area: <name>` line under the description says which kind of work this is
(`Content`, `Websites`, `Leads`). The Studio groups playbooks and their projects by it.
Reuse an area another playbook already names before inventing one.

Every phase in `phases` needs its `## <phase>` section. Brain hands that section to
the agent running the phase, so it is the instruction, not documentation. Write it for
someone who knows nothing but their role and the files named in it.

### What the section demands

Its wording sets how much the phase does, and no later phase recovers work this one was
not asked for. "Produce the design" gets a design. "Every page in the brief's sitemap
has a file in `design/`, and `phases/design.md` accounts for each one" gets the sweep.
Name the artefact, where it lands, and what counts as all of it.

### The role says how; the section says what and where

The role file is already loaded when the phase runs. A section that re-explains the
role's method is one instruction in two places, and the day one changes they disagree.
Write the section as this path's half: what the phase is handed, what it produces,
where that goes, and the gate it must pass.

### Name the path's vocabulary once, in the preamble

The lines above the first `## ` reach every phase, so the path's shared terms are
defined there — `the gate`, `the crawl`, `the sweep` — and each section then uses the
bare word. Reach for a word the model already knows before coining one. The same idea
re-explained in three sections costs three times and drifts.

### Say what the neighbouring phase owns

A prohibition pulls the work it forbids into context and half-reads as a suggestion.
"Do not touch the palette" invites a look at the palette; "the palette is `brand`'s and
was approved there" does not. State a boundary as ownership.

### Then cut

Read each line and ask whether the agent would behave differently without it. "Be
thorough", "follow best practices", "communicate clearly" — it already would, so they
are pure cost to the lines around them. Delete whole sentences, not words. When two
people disagree about whether a line is a no-op, settle it by running the phase
without it.

## `brief.md` — what the human fills in

The questions that must be answered before phase one. `brain new` copies it to
`memory/projects/<name>/brief.md`. Start from `$BRAIN_SYSTEM/brief-template.md` and
keep its `## Stack` section: the stack belongs to each project, not to the brain.

## `inputs` — what a project is handed, typed (optional)

When the path needs things the human hands over — a keyword, the URLs of competitors or
reference sites, a language, a brand book — say so in `inputs`, and the cockpit asks for
them as a form instead of a blank brief: a URL list that checks every address, a choice,
a file drop.

```
# input           type           per      need  label
keyword           text           project  yes   Primary keyword
language          choice:en,de   project  yes   Language
competitor-pages  urls           project  no    Competitor pages
competitors       urls           client   no    Competitors
brand-docs        files          client   no    Brand guidelines
```

- Five columns, whitespace separated; the label is the rest of the line. Full-line `#`
  comments only, as in `phases`.
- `type`: `text` (one line), `longtext`, `url`, `urls` (a list), `number`, `files`, or
  `choice:a,b` (single-word options, at least two).
- `per`: `project` is asked for every project. `client` is asked once and kept in
  `memory/clients/<client>/profile.md` (files in `clients/<client>/sources/`), so the
  competitors and the brand book are entered once per client, not per article. That
  needs the clients app; without it a `client` input is asked with every project and
  lands in the brief, so the same `## <label>` works either way.
- `need`: `yes` or `no`.
- The label is the heading the answer lands under — a per-project answer in the
  project's `brief.md`, a per-client one in the client profile. So give every per-project
  input its `## <label>` heading in `brief.md` too; `brain new` at a terminal asks the
  brief's headings, not `inputs`.
- A section reads what it was handed by that heading: "crawl every URL under
  `## Competitor pages` in the brief", "follow `## Brand guidelines` in the client
  profile". A URL list is `- https://…` lines; files are `- sources/<file>` lines.

Ask only for what the path cannot find for itself. A phase that can research the
competitors does not need them typed in; a phase that must beat the three the client
named does.

## Check it

### Optional `contracts/<phase>` — mechanical acceptance

An agent phase may have a plain-text contract (no extension):

```text
input memory:brief.md
output project:deliverable/report.pdf
evidence memory:qa/validation.txt
check 120 ./scripts/validate.sh
```

- `input`, `output`, `evidence` name nonempty regular files under `project:` (code)
  or `memory:` (this project's memory). Paths are literal; no absolute paths,
  traversal, glob expansion or symlink components. Spaces are allowed.
- Inputs must exist before launch. Outputs must exist after verification. Evidence
  must be newer than the attempt's start marker; the host retains its bytes and hash.
- `check <seconds> <command>` runs in the sandbox from the project root after the
  agent exits, with a 1–86400 second timeout. The host keeps output and exit status.
  Checks must start their own services if needed and be repeatable verification,
  not external effects. They stop at the first failure.
- A contract applies to work, PASS and fix handoffs. Review FAIL already routes to
  its fixer. Missing inputs block launch; failed verification stops `auto` with
  diagnostics rather than silently accepting `.done` or retrying commands.
- Keep role/fix-role and `human` gates in `phases`. Contracts on human gates are
  invalid; put mechanical verification on the agent phase before the gate.
- Full-line `#` comments only. Unknown directives are errors. The host uses the
  pre-run snapshot, so editing a contract affects the next attempt.

Use a contract for requirements that can be checked mechanically. Keep the phase's
judgment criteria and explanations in `playbook.md`; do not duplicate shell checks
as prose-only instructions.

`brain playbook check <name>` enforces every rule above. Run it before handing over.

## What a good path looks like

- A review comes straight after the work it judges, not all of them at the end.
- A review role never edits; its fix-role does. They are different roles.
- A `human` gate goes where a wrong turn is expensive to undo — before a build starts
  from a design, before anything is published.
- Each phase hands the next one something named: a file, a folder, a summary.
- End with `retro`, which compiles what the project taught into `knowledge/`.
