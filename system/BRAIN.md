# Brain operating manual

Every agent reads this first, whatever the engine (Claude or Codex).

**In an academy workspace** (your prompt says "brain academy workspace") the workspace
folder is the project's memory, and the `academy` skill is its format: follow it instead of
the `projects/<name>/`, phase and review parts below. The brain-wide memory is read-only
for you there; a lesson about doing research goes into your run summary under `## Lessons`.
The rules on handoffs through files, skills and never writing `$BRAIN_SYSTEM` still hold.

## Where things are
- `$BRAIN_SYSTEM` (read-only): this manual, `roles/`, `playbooks/`, `roles.conf`. Installed
  apps are `apps/<name>/` inside it, shaped the same way; your prompt gives the full path
  of your role and playbook, wherever they live.
- `$BRAIN_MEMORY` (read-write): the brain's memory, a wiki you maintain.
  - `index.md` — the catalog. Read this first, every session.
  - `knowledge/` — compiled pages, one topic each. What we know and why.
  - `preferences.md` — how the human likes things done *across all projects*
    (working style, taste). It deliberately holds no stack.
  - `clients/<client>/` — one client's memory, when the clients app is installed and your
    prompt's `Client memory:` line names a folder. The `client-memory` skill says what is
    in it and what goes there instead of `knowledge/`.
  - `projects/<name>/` — the record of one project:
    - `brief.md` — the task, written by the human. The source of truth, and where
      this project's stack is declared (`## Stack`).
    - `decisions.md` — decisions and why (append, never rewrite history).
    - `phases/<phase>.md` — each phase's output/summary.
    - `qa/` — screenshots and reports.
    - `sources/` — documents the human dropped in **for this project**: the client's
      brand book, their logos, a contract, a call transcript. Immutable. Read them and
      cite the filename in the summary of the phase that used one. This is where
      project material belongs — it goes no further than the project.
  - `sources/` — the brain's own: material any project may need. Immutable. You read
    them and compile what matters into `knowledge/`, citing the filename. A source
    nobody has cited yet is work waiting for you. A client's own documents do **not**
    go here; the next project's agents would read them.
  - `log.md` — append-only record of what happened when.
  - `proposals.md` — your suggestions for `system/`. **Append under `## Open`**, never
    under `## Accepted`: that section is the human's, and moving a line into it is how
    they approve it. It is a real queue, worked by `brain evolve`, so write each line so
    someone can act on it: which file and phase, what to change, and the evidence from
    this project that says so. A proposal with no evidence behind it is not accepted.
    `brain-mem propose` files it there in that format.
    `## Declined` is what the human turned down: read it before you propose, and do
    not file the same change again without new evidence.
- The project code is the current working directory. Only code goes there.

`projects/` and `sources/` are the raw record: what happened, verbatim.
`knowledge/` is what we learned from it: compiled, current, cross-linked.
Never delete from the raw record. Always keep `knowledge/` current.

## Start of every session
1. Read `index.md`, then `preferences.md`.
2. Your prompt's **Knowledge scope** names the tags you read. In the index's Knowledge
   part, open the pages under the `###` headings that carry one of them and are
   relevant to your task. The rest belongs to other apps and stacks. Do not read the
   whole wiki; that is what the index is for. A line **App knowledge** names folders of
   pages an app ships: read them the same way. They are read-only; when this brain learns
   that one is wrong, write the correction as a page of your own and propose the fix
   against the app's page.
3. Read this project's `brief.md`, `decisions.md`, and the `phases/*.md` of earlier
   phases, plus the client profile if your prompt names a client memory. A `RESULT: FAIL` with
   "Feedback from the human" is the most important input you have.
   The brief's `## Stack` is this project's stack and beats `preferences.md`. It is
   per project on purpose — the brain runs every kind of work, not one stack.
4. If the project has code and `graphify-out/` exists, use `graphify query "..."`
   and `graphify-out/GRAPH_REPORT.md` instead of reading files one by one
   (skill: repo-map). If the repo is large and has no map yet, build one first.
5. Then do the task you were given.

## Keeping the wiki
You compile knowledge; you do not accumulate it. A page is rewritten to stay true,
not appended to until nobody reads it.

Write memory through `brain-mem` (skill: brain-mem): `brain-mem page` writes a knowledge
page and files it in `index.md` under its tags, `propose` and `decide` append in the right
place and format, `scope` and `search` read only what is yours. It refuses a write these
rules forbid and says why. Run `brain-mem check` before you finish a phase that changed memory.

- **One topic per page**, named for the topic: `knowledge/payload-access-control.md`,
  not `knowledge/lessons-from-acme.md`.
- **Tag every page** on the line under its title: `tags: seo`, `tags: web, payload`. The
  app whose playbook you are running, plus a stack word (`payload`, `tailwind`) when the
  page is about that tool and any project using it needs it. `tags: shared` only for what
  every agent needs, whatever it works on. In `index.md` the page goes under the `###`
  heading that is exactly its tags, which you add when it is not there.
- **One client's facts go to the client** (the `client-memory` skill), not `knowledge/`:
  the next client's agents must not read them as how things are.
- **Update the page that exists** before creating a new one. Two pages on one topic
  is the failure mode; merge them.
- **When new evidence contradicts a page**, rewrite the claim and say what changed.
  Keep the old claim only if knowing it was wrong is useful.
- **Cross-link** with `[[page-name]]` (no `.md`). Liberally. A link to a page that
  does not exist yet marks something worth writing.
- **Cite the raw record** so a claim can be checked: `projects/acme/phases/qa.md`. For
  a dropped-in document, cite its filename exactly — that is how `brain lint` (and the
  cockpit) tell a compiled source from one still waiting.
- **Update `index.md`** in the same pass — a page not in the index is invisible.
- **Append one line to `log.md`**: `## [YYYY-MM-DD] <op> | <subject>`.

Page format:

```markdown
# Payload access control
tags: web, payload
One line: what this page settles.

## What we know
- Claim — why, and what it cost us. [[payload-hooks]]
- Claim — why.

## Open
- Question we have not answered yet.

## Sources
- projects/acme-relaunch/phases/code-review.md (2026-09-14)
```

Write a page when the same thing has now cost us twice, or when one project taught
something the next project needs. Not for every observation — a wiki of noise is
the same as no wiki.

## Handoffs
- You hand off through files, not chat. The next agent may be a different
  engine and knows nothing except what is in memory and the code.
- Your phase summary (`phases/<phase>.md`) must contain: what you did, where the
  outputs are, open questions, and anything the next role must know.
- Record real decisions in `decisions.md`: `YYYY-MM-DD — decision — reason`
  (`brain-mem decide "<decision>" "<reason>"`).
- The host checks handoffs after exit: a normal phase needs a fresh, nonempty summary
  and `.done`; a review also needs its matching final log line; a fix needs a nonempty
  `.fixed` and must not create `.done`. Write the summary before the final marker.
  These checks establish a complete handoff, not that the project's checks passed.
- A playbook may add `contracts/<phase>` with required inputs, outputs, fresh evidence
  and sandbox verification commands. Read it before work. The host snapshots and
  enforces it; evidence must come from this attempt. A fix still awaits its reviewer,
  and passing mechanical checks does not replace a human gate.
- Your prompt already contains the playbook's preamble and your phase's section, as
  the playbook states them for this run. That text is the phase's instruction.
- A summary ending in `## Feedback from the human` means a human reopened your phase.
  That feedback is why it runs again; say how you addressed each item.

## Review phases (roles ending in -reviewer, and qa)
- You never edit project code. You check and report.
- Write `phases/<phase>.md` with a line `RESULT: PASS` or `RESULT: FAIL`,
  and for FAIL a numbered fix list. Cite the rule, doc or brief line broken.
- End the summary with a `## Defects` block, one line per finding, so no finding can
  quietly disappear between rounds:
  ```
  ## Defects
  - qa.slug-rename-links OPEN code — nav stays on /faq after a rename — escaped: code-review
  - qa.mobile-320 VERIFIED
  ```
  - The id is `<this phase>.<slug>`, lowercase, and stays the same for as long as the
    finding exists; the numbered item that describes it names the id too.
  - The state is `OPEN` (still wrong), `VERIFIED` (was open, you checked it is fixed),
    `WAIVED` or `DEFERRED` (a human decided; keep them as they are).
  - `escaped: <phase>` names the earlier phase that should have caught it, when one
    should have. Retro counts these.
- The host checks the block after you exit. FAIL needs at least one `OPEN`, PASS needs
  none, and every id the previous summary had `OPEN` must still be listed, in any
  state. A summary that breaks this is not a handoff; it is put back and the review
  runs again.
- Append one line to `phases/<phase>.log`: `YYYY-MM-DD PASS` or `YYYY-MM-DD FAIL`.
- Only on PASS: create `phases/<phase>.done`.

## Fix rounds (you were sent in to fix a failed review)
The review's `phases/<phase>.md` is the reviewer's file, not yours: writing it makes the
fix look newer than the review and starts the round again. Your handoff is
`phases/<phase>.fixed` — one line per item saying what you changed, written when every
item is addressed, **with the defect's id on its line**. The host rejects a `.fixed`
that leaves an `OPEN` id unnamed. Creating it is what ends the round, and the reviewer
reads it next.

A human's rejection has the same shape: numbered feedback and a `## Defects` block with
ids like `design-gate.r2-1`. Answer each one the same way.

## Rules
- Prefer deterministic checks (build, typecheck, lint, tests, brain-shoot) over opinions.
- Never commit secrets. Never push to main. Commit work in small commits on a branch
  named `brain/<phase>`.
- Never assume a stack. Take it from the brief; if the brief is silent, read it out
  of the repo (manifest, lockfile, config) and write what you found into
  `decisions.md`. If neither says and the choice is expensive to undo, ask.
- If the brief is unclear or contradicts itself, write the question into your phase
  summary and stop instead of guessing on anything expensive to undo.
- Never write into `$BRAIN_SYSTEM` (it is read-only anyway). Suggestions for
  improving roles/playbooks go under `## Open` in `proposals.md`.
- A skill is a tool you call, not a document you cite. The `Skills:` line in your role
  names the ones chosen for your work, and until you actually invoke one, all you have
  is the single line of description in your skill list — not the skill. Every run
  records which skills were invoked, so "took direction from X" without a call to X is
  visible after the fact. If a skill named in your role is wrong for the work, say so
  in your summary instead of quietly skipping it.
