# Internals

Run receipts, crawling, graphify and looking into a sandbox.

## Run receipts

Every `brain run` agent attempt first creates a host record, for Claude and Codex alike:

```
.runs/<project>/<phase>/<timestamp-uuid>/
  plan.json       requested engine/model/effort, limits, Git state, output contract
  context.json    input paths and SHA-256 hashes, declared skills and known omissions
  role.md         role snapshot before launch
  prompt.md       exact kickoff prompt
  contract        optional phase contract snapshot
  result.json     agent claim and separate host handoff verdict after exit
  summary.md      phase summary as found at exit, when present
  handoff.*       other available handoff files
  evidence/       check commands, logs, exit codes, artifact hashes and evidence copies
```

These records are written once by the host, outside the phase sandbox's `system/`
and `memory/` mounts. Recording uses Bash, awk, Git and shasum, already used by the
launcher; Node.js is needed only for the optional cockpit and JavaScript development
tests. A private `inputs.nul` file stores paths and hashes for comparisons without a
JSON parser. No database or new host runtime is required.

Records are gitignored, in neither repo, and need a backup alongside
project memory. They are not protected from the host user, or a
session explicitly mounting the whole brain repository. Free sessions, drafting and
evolve do not use these records.

**Human verdicts are records too.** `brain approve`, `reject` and `reopen` (and the same
buttons in the cockpit) each write a record with `plan.json` (`actor: human`) and a
`result.json` naming the outcome, the feedback items, the defects it waived, deferred
or verified, and the phases it reopened, whose `.done` files are kept in it. Every
change of phase state now leaves one directory.

**A launcher that dies is noticed.** `.running` holds the attempt's run id, and the
record holds the launcher's pid (`launcher`, written before `plan.json`). A dead pid
means nobody will finish that attempt: the next `brain run`, `brain status` or
`brain watch` closes it as `crashed`, holds any `.done` or `.fixed` it wrote after the
lease as rejected, and removes the lease, so neither the phase nor the cockpit's watch
stays blocked. A record with a plan, no result and no live launcher is closed the same
way.

The inventory captures declared inputs, not proof of what an agent read. It includes
the brief, decisions, phase handoffs, project sources, configuration and locally
resolvable declared skills, plus `system/skills.lock` — the commit each external skill
repo was at when `brain sync-skills` installed it. What a Claude run actually read is
in its transcript receipt (below). Effective sandbox policy is not claimed to be
verified. The prompt carries the playbook's preamble and the phase's own section, so
`prompt.md` holds the instruction the agent was given, not a path to it.
Inputs can still change during a run; `changed_inputs` records hash differences at
exit. Git state includes the tracked diff and untracked file content, excluding ignored
files. This is an audit foundation, not a reproducible filesystem snapshot.

The host validates the existing handoff contract before accepting an attempt:

- Work: a fresh, nonempty summary and a fresh `.done`.
- Review: a fresh summary with exactly one `RESULT: PASS` or `RESULT: FAIL`, and a
  fresh log ending in the matching `YYYY-MM-DD PASS|FAIL` line. PASS also needs a fresh
  `.done`; FAIL must not create one.
- Fix: a fresh, nonempty `.fixed`, without a fresh `.done`. A fix cannot approve itself.

For a review or a fix, the host then checks the summary's `## Defects` block
(`BRAIN.md`): FAIL needs an `OPEN` defect and PASS none, every id the previous summary
had `OPEN` must still be listed, and a `.fixed` must name every `OPEN` id. A review that
breaks this is `defects_invalid`: its summary and log are put back as the attempt found
them (the agent's version is `rejected.md` in the record), so the review runs again
instead of sending the fixer a list the host refused.

Invalid completion markers are preserved in the host record and removed from phase
state. An incomplete handoff or failed contract exits 2 and stops `auto`; the agent
timeout exits 3. Explicitly rerunning a completed phase archives its previous `.done`
before launch. Contracted attempts withhold proposed markers until verification
finishes; interrupted verification cannot publish a completion marker. The result
distinguishes `blocked`, `handoff_valid`, `verified`, `verification_failed`,
`defects_invalid`, `crashed` and, for human records, `approved`, `rejected` and
`reopened`. `verified` means the declared mechanical checks passed, not that a human
approved. Phase state is still read from the marker files; the records are the audit
trail beside them.
Legacy marker state stays compatible. The cockpit reads the newest attempt's record
from disk and, when the host rejected it, shows the verdict on the phase — every check
with its command and exit status, the log each one printed, and the line saying which
output, evidence or check failed. A `verified` attempt says nothing: a verdict is only
news when it is bad. Its own transcript receipts are still shown below that.

Check this contract without a sandbox with `bash test/state.sh`, `bash test/contracts.sh` and
`node test/run-record.mjs`, alongside `node ui/test.mjs` and `bash -n bin/brain`.

Claude transcript receipts remain in `memory/projects/<p>/phases/<phase>.runs/`: a
`<run-id>.json` with duration, turns, model, tokens, the tools it called, the skills it
invoked and the brain files it read (`reads`). The run id is the host record's, and
`run-record.sh finish` copies the receipt in as `transcript.json` and fills
`resolved_model` from it; the role file and summary that run had are that record's
`role.md` and `summary.md`. Older receipts are `<timestamp>.json` with
`<timestamp>.<role>.md` beside them, and are still read. One per run, not one per phase: a review that took three fix
rounds ran three times, under the reviewer and its fix-role in turn, and what changed
between them is the question worth asking. Read them in the cockpit's **Runs** tab or on
the phase page, which opens with them.

The transcript receipt is read by `brain-runlog` inside the sandbox and printed at
the end of the run. Codex has no receipt from that helper; its host plan and result
still exist. Transcript collection remains best effort.

## Crawling a site

`brain-crawl` turns pages into markdown a role can quote and cite:

```bash
brain-crawl https://old-site.example/about
brain-crawl --sitemap https://old-site.example/sitemap.xml
```

One file per URL under `crawl/`. The script ships in the template; crawl4ai does not.
The first `brain-crawl` in a sandbox installs it there (~20 s, ~730 MB — mostly scipy,
litellm and a second Playwright), and it lives and dies with that sandbox. It reuses
the Chromium the image already has, so no browser is downloaded again.

That is a trade, not an obvious win: an image layer is shared by every sandbox, a
writable layer is not. On demand costs 730 MB per sandbox that crawls; baking it into
the Dockerfile next to graphify would cost ~2.9 GB once (both images, in Docker and in
sbx's store) and nothing per sandbox. Break-even is around four crawling sandboxes, so
if most of your projects crawl an old site, move it into the image.

The `web-crawl` skill tells a role when to use it, and to cite the file rather than a
page it never fetched.

## Looking at what is running in the sandbox

Playwright's Chromium runs headless inside the sandbox; nothing is installed on your
Mac. To open a dev server (or anything else the agent is serving) in your own browser,
expose its port from the sandbox — see "Local development" in the Docker Sandboxes
docs.

## graphify

Inside a sandbox, the `mapper` role (or you) runs `brain-graphify-setup` once per project.
It installs the graphify skill project-scoped and keeps its files out of git via
`.git/info/exclude`. Then `/graphify .` (Claude) or `$graphify .` (Codex) builds the map;
`graphify update .` refreshes code-only for free. The `repo-map` skill tells agents to
query the graph instead of reading files one by one.
