---
name: web-crawl
description: Crawl web pages to clean markdown inside the sandbox with brain-crawl (crawl4ai), for migrating an old site's content, auditing one, or reading reference sites. Use whenever a phase needs the actual text of pages rather than a screenshot or a guess.
---

# Crawling pages

`brain-crawl` turns pages into markdown you can quote and cite. Run it in the project
root, inside the sandbox.

```bash
brain-crawl https://old-site.example/about            # one or more URLs
brain-crawl --sitemap https://old-site.example/sitemap.xml
```

One file per URL under `crawl/`, named for the URL, so a re-crawl overwrites rather
than piling up. A page it could not extract is reported `✗` and no file is written —
an empty file would read as an empty page. Under the `✗` it prints the crawler's own
reason, so read that before concluding the sites blocked you.

First run installs crawl4ai (~20s, ~730 MB) and the Chromium headless shell its
Playwright pins — a different build from the image's, and without it every URL comes
back `✗`. It is deliberately not in the template image: most projects never crawl.

## When to reach for it

- **Content migration.** Crawl the whole sitemap before writing anything. The old
  site's words are the source of truth; do not retype or paraphrase from memory.
- **Auditing a site.** Crawl the pages you are judging so findings quote real text.
- **Reference sites.** Crawl for structure and copy. For how a site *looks*, take
  screenshots instead — `brain-shoot` and the `visual-qa` skill.

## Rules

- **Cite the file, never the URL you did not crawl.** A claim about a page needs
  `crawl/<file>.md` behind it. This is what stops invented content.
- Crawl once per phase, not per question. The files persist; re-read them.
- A page behind a login, a form, or heavy interaction will come back thin or empty.
  Say so in your phase summary rather than filling the gap from imagination.
- JavaScript-rendered pages are fine — it drives a real browser.
- `crawl/` is output, not source. Keep it out of the repo's history unless the human
  asks: add it to `.git/info/exclude`.
- Only crawl what the brief points at. Someone else's site is not yours to hammer:
  a sitemap of hundreds of pages is a decision to check with the human first.
