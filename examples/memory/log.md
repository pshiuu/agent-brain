# Log

Append-only. Newest at the bottom. One line per entry so it stays greppable:
`grep "^## \[" log.md | tail -5`

Format: `## [YYYY-MM-DD] <ingest|query|lint|retro> | <subject>` then one line of what changed.
