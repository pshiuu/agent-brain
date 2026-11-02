# qa — round 3

RESULT: FAIL
The reviewer's prose may quote "RESULT: FAIL" mid-line; only the line counts.

1. qa.slug-rename-links — a renamed page leaves nav and footer on /faq (404)
2. qa.stale-global-save — the first request after a global save is stale

## Defects
- qa.slug-rename-links OPEN code — nav stays on /faq after a rename
- qa.stale-global-save OPEN code — first request is stale — escaped: code-review
- qa.soft-404 OPEN code — /blog/* answers 200
- qa.tap-targets WAIVED — human 2026-09-23, decisions.md
- qa.mobile-320 VERIFIED

## Files
- qa/after/ — not a defect: a list under another heading   

