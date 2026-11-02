---
name: brain-mem
description: Read and write the brain's memory correctly from inside a phase — the knowledge pages in your scope, a new or rewritten knowledge page filed in index.md under its tags, a proposal for system/, a project decision, the memory lint. Use whenever you read or change memory/ (knowledge/, index.md, proposals.md, decisions.md).
---

# brain-mem

`"$BRAIN_SYSTEM/skills/brain-mem/brain-mem" <verb>` — `brain-mem` below. It reads
`BRAIN_SYSTEM`, `BRAIN_MEMORY` and `BRAIN_PROJECT`, which every phase has. Each write is
checked before it lands; a refusal says what to fix.

| Verb | Does |
|---|---|
| `brain-mem scope` | Your knowledge scope, the pages it covers, the apps' read-only pages, your client's pages |
| `brain-mem search <word>...` | Lines that mention any word, in those pages only |
| `brain-mem page <name> --summary "<one line>" [--tags "a, b"] < page.md` | Writes `knowledge/<name>.md` with its `tags:` line and files it in `index.md` under the `###` heading that is exactly its tags |
| `brain-mem propose "[system/<file> <where>] what to change — why, with the evidence"` | Appends to `## Open` in `proposals.md`, adding `(project, date)` |
| `brain-mem decide "<decision>" "<reason>"` | Appends `YYYY-MM-DD — decision — reason` to this project's `decisions.md` |
| `brain-mem check` | The memory lint; exit 1 on an error |

## page
- The page comes on stdin in BRAIN.md's page format: `# Title` first, a `## Sources`
  section. Any `tags:` line in it is replaced.
- Tags: `--tags` if given, else the page's current tags, else your playbook's app
  (`shared` for a base playbook). A tag must be `shared`, an installed app or a word of
  some brief's `## Stack`; `shared` stands alone.
- `--summary` is the page's index line. A rewrite keeps the old one unless you give a new one.
- Rewriting a page is the normal case: read it, change what is no longer true, write the
  whole page back. A retag moves its index line.
- Client facts go to `clients/<client>/<topic>.md` by hand; this does not write there.

Still yours after a write: the `log.md` line, and `[[links]]` from related pages.
