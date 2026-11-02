# Memory index

The catalog of everything the brain knows. Every agent reads this file first and
then opens only the pages it needs. Nothing else is read whole.

Maintained by agents. If a page exists and is not listed here, the lint is failing.

## Knowledge (`knowledge/`)
Compiled pages. One topic per page, kept current — not a log. Each `###` heading is a
set of tags; a page sits under the heading that is exactly its `tags:` line. Your prompt's
"Knowledge scope" names the tags you read: open the sections that carry one of them.

<!-- - [payload.md](knowledge/payload.md) — one line on what the page settles, under "### payload". -->
_empty — the first retro fills this._

## Clients (`clients/`)
<!-- - [acme](clients/acme/profile.md) — who they are, tone, constraints. -->
_none yet._

## Projects (`projects/`)
The record of what happened. Briefs, decisions, phase summaries, QA. Source
material for the knowledge pages — read a project only when working on it.

<!-- - [acme-site](projects/acme-site/) — new-website, 2026-09 — shipped. -->
_none yet._

## Also here
- [preferences.md](preferences.md) — how the human works, across all projects. Always
  follow. Not the stack: that is per project, in the project's `brief.md`.
- [proposals.md](proposals.md) — agent suggestions for `system/`, under `## Open`. `brain evolve` applies the ones you move to `## Accepted`.
- [log.md](log.md) — what happened when.
- `sources/` — external material dropped in by the human, immutable, compiled into `knowledge/`.
