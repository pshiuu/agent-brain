---
name: role-format
description: How to write a brain role so both Claude and Codex follow it - the two halves a role needs, how each engine receives it, how a step's wording sets how much work it buys, and the contracts from BRAIN.md every role must honour. Use when writing, reviewing or repairing a role.
---

# Role format

## A role is two halves that must agree

| | |
|---|---|
| `$BRAIN_SYSTEM/roles.conf` | one line: `<name>  <engine>  <model>  [effort]` |
| `$BRAIN_SYSTEM/roles/<name>.md` | what the role is told to do |

Either half alone breaks the run: brain reads the engine from `roles.conf` and the
instructions from the file. `brain role new` writes both; never write one by hand.

`engine` is `claude` or `codex`. `model` is a name that engine accepts, or `default`.
`effort` is optional — `low medium high xhigh max` (Codex also has `none`), per model.

## The role is already loaded — do not tell it to go and read itself

Brain hands the file to the engine the way that engine loads instructions:

- **Claude**: `--append-system-prompt-file <the role file>` — it is system context.
- **Codex**: the file is copied to `$CODEX_HOME/AGENTS.md` inside the sandbox, which
  Codex reads before anything else.

So write the file as **instructions to someone who has already read them**. Second
person, imperative. Never "first read your role file" — they are the role file.

## Shape

```markdown
# Role: <name>
Skills: skill-one, skill-two
You <one sentence: what you are and what you produce>.

Do:
1. <first concrete step, naming the files you read>
2. ...

Output: `phases/<phase>.md` with <what must be in it>.
Don't: <the mistakes this role specifically makes>.
```

The `Skills:` line is optional and must be **bare names, comma separated** — the
cockpit parses that form and lets you tick skills on and off. Write it as prose and the
cockpit leaves it alone rather than destroying your reasoning, which is fine but means
the picker stops working for that role. Name only skills that exist: check
`$BRAIN_SYSTEM/skills/` and `skills.list`.

## Name the skill in the step that needs it

The `Skills:` line is a manifest — it tells the cockpit and the reader what this role
reaches for. It does not say *when*, and both engines decide for themselves whether a
skill is relevant. A skill listed at the top and never mentioned again is one the role
may or may not open.

So put the skill in the step, with its trigger:

```markdown
Skills: repo-map, payload-conventions

Do:
1. Before reading any file, build or refresh the map with the `repo-map` skill and
   query it — do not read the repo file by file.
3. Check every collection and global against the `payload-conventions` skill.
```

Not `2. Understand the codebase.` with `repo-map` only in the manifest. The step names
the skill, the moment to use it, and what it replaces.

## Choosing the skills

Read the descriptions; do not guess from names. Every skill states in its own
`description` when it should be used — that is exactly what both engines match on when
they decide to open one:

- the brain's own: `$BRAIN_SYSTEM/skills/*/SKILL.md`
- everything installed, external ones included: `~/.claude/skills/*/SKILL.md` on Claude,
  `~/.agents/skills/*/SKILL.md` on Codex. `$BRAIN_SYSTEM/skills.list` carries names only.

Propose a shortlist with one line each on why, and let the human cut it in one pass.
Do not ask skill by skill.

**Do not bake a project's stack into a general role.** The stack belongs to each
project's `brief.md`, and a role is reused across projects. A role that is
stack-specific by nature names its skills outright; a general one makes the skill
conditional, inside the step:

```markdown
3. If the project uses Payload — check the brief's `## Stack` and package.json — check
   every collection and global against the `payload-conventions` skill.
4. When you are translating an approved HTML design into Payload, do that with the
   `html-to-payload` skill rather than by hand.
```

A condition the role can actually evaluate — a file that exists, a line in the brief —
beats "if relevant".

## What a step demands

Every step ends on a bound — the condition that tells the role it is done. Two things
about that bound matter, and both are in its wording, not in a separate instruction.

**Can the role tell done from not-done?** "Understanding reached" cannot be checked, so
it is declared early. "Every collection in `src/collections/` accounted for in the
summary" can.

**How much does it ask for?** "List the blocks you changed" gets a list. "Account for
every block in `blocks.ts`, changed or not, with one line each" gets the sweep. Same
step, different amount of digging. Write the bound at the size of the work you want —
nothing later in the role recovers legwork the bound did not ask for.

## Leading words

A role that re-explains one idea in three places pays for it three times. Name it once,
then use the name as a bare token — `the gate`, `the sweep`, `the crawl`. Reach for a
word the model already knows before coining one; a made-up word costs you the sentences
that define it. Use the same word in the role, its playbook and the phase summary, and
both engines link them.

## Steer by the target, not the ban

A prohibition pulls the thing it forbids into context and half-reads as a suggestion.
So the step says what to do — "write the summary from the crawl output" — and the
`Don't:` line carries the specific traps this role has actually fallen into, each with
the thing to do instead beside it. A ban with no positive next to it is a missing step.

## Length and specificity

These files are **context, not enforcement** — the same rule Claude's own docs give for
`CLAUDE.md`. Adherence drops as they grow. Keep a role **under ~200 lines**, and prefer
"run `pnpm typecheck` and paste the failures" over "ensure quality".

Then cut. Read each sentence and ask whether the engine would behave differently
without it. "Be thorough", "follow best practices", "write clean code" — it already
does; they are pure cost to the sentences around them. Delete the whole sentence, not a
few words from it. When two people disagree about whether a line is a no-op, they
disagree about the default: settle it by running the role without the line.

## Contracts every role must honour (from BRAIN.md)

- Hand off through files, not chat: write `phases/<phase>.md` with what you did, where
  the outputs are, open questions, and what the next role must know.
- Real decisions go in `decisions.md` as `YYYY-MM-DD — decision — reason`.
- Commit in small commits on branch `brain/<phase>`. Never push to main, never commit
  secrets.
- `$BRAIN_SYSTEM` is read-only. Suggestions for it go under `## Open` in `proposals.md`.
- **A review role never edits.** It writes `RESULT: PASS` or `RESULT: FAIL` plus a
  numbered fix list, appends `YYYY-MM-DD PASS|FAIL` to `phases/<phase>.log`, and creates
  `phases/<phase>.done` only on PASS. Its fix-role does the editing.
- If the brief is unclear, write the question into the phase summary and stop rather
  than guess at anything expensive to undo.

## Choosing the engine

Pick per role, from how the work actually behaves — not by preference. Say in one line
why, so the human can disagree with a reason. `roles.conf` is one line to change.

## Check it

`brain playbook check <playbook>` fails while a phase names a role that has no
`roles.conf` line, so a half-written role surfaces there.
