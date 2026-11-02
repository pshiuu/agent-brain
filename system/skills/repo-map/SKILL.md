---
name: repo-map
description: Map and navigate an existing codebase with graphify instead of reading files one by one. Use before changing an unfamiliar or large repo, when asked how something works, where something is, or what a change would affect.
---

# Repo map (graphify)

## Setup (once per project)
Run `brain-graphify-setup` in the project root. It installs the graphify skill for this
project and keeps its files out of git (via .git/info/exclude).

## Build or refresh the map
- Full map (code + docs): `/graphify .` in Claude, `$graphify .` in Codex.
- After code changes: `graphify update .` (code only, runs locally, no LLM cost).
- Big repos: add a `.graphifyignore` (gitignore syntax) for generated/vendor folders.

## Use it
- Overview: `graphify-out/GRAPH_REPORT.md` (god nodes = central modules, surprising links).
- Targeted: `graphify query "how does the page render its blocks?"`
- Dependencies: `graphify path "PageRenderer" "payload.config"`
- One thing: `graphify explain "Header"`
Prefer scoped queries over reading the whole report. Verify anything important in the
actual source file before changing it — edges tagged INFERRED/AMBIGUOUS are guesses.

## Commit or not?
`graphify-out/` can be committed so the next session starts with a map. Ask the human
once per project and record the answer in decisions.md.
