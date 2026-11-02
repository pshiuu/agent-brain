# qa — round 3

RESULT: PASS
The reviewer's prose may quote "RESULT: FAIL" mid-line; only the line counts.

1. qa.slug-rename-links — a renamed page leaves nav and footer on /faq (404)
2. qa.stale-global-save — the first request after a global save is stale

## Defects
- qa.slug-rename-links DEFERRED code — nav stays on /faq after a rename — human 2026-09-24
- qa.stale-global-save VERIFIED code — first request is stale — escaped: code-review — human 2026-09-24
- qa.soft-404 VERIFIED code — /blog/* answers 200 — human 2026-09-24
- qa.tap-targets WAIVED — human 2026-09-23, decisions.md
- qa.mobile-320 VERIFIED

## Files
- qa/after/ — not a defect: a list under another heading

Approved by human on 2026-09-24.
