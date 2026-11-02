# Getting better

How a lesson gets back into the instructions, improving a playbook after its runs, and evals.

## How a lesson gets back into the system

`retro` writes what a project taught into `knowledge/`, and anything that should change
an instruction into `memory/proposals.md` with the evidence behind it. It cannot apply
them: `system/` is mounted read-only in every phase, so an agent can never rewrite the
instructions it is running under. That is worth keeping — and it is also why proposals
pile up, because the agents that learn the lesson are exactly the ones barred from
acting on it.

`brain evolve` is the deliberate exception, and the only command that may write
`system/`. Because it rewrites the instructions every other agent then reads, what it
may touch is not left to its judgement: `proposals.md` is two lists, agents append to
`## Open`, and **moving a line to `## Accepted` is your approval**. Evolve applies that
section and nothing else, and refuses to start when it is empty.

```bash
$EDITOR ~/agent-brain/memory/proposals.md     # move the lines you want to ## Accepted
brain evolve                                  # apply them
brain evolve "the seeder must never hardcode an internal link"   # or name it yourself
git -C ~/agent-brain diff system              # the review
git -C ~/agent-brain checkout -- system       # the undo
```

Naming the change on the command line *is* the approval, so that form needs no queue.

The cockpit does the same moves without the editor. Every proposal on the Overview, and
on each project's **Memory** tab (which also shows the knowledge pages, client profile
and log entries that project left behind), has **Accept** and **Decline**. Decline moves
the line under `## Declined`, which BRAIN.md tells agents to read before proposing, so a
retro does not file what you already turned down. **Run brain evolve** leaves a request
that `brain watch` turns into a Terminal running `brain evolve` on the brain, one at a
time. There is no per-project evolve: `system/` is one set of instructions shared by
every project, so the Memory tab's button applies everything accepted and says how much
of it came from that project.

The editor still judges: an accepted proposal it cannot support goes back under
`## Open` with its reason rather than being applied or dropped. It deletes the lines it
did apply, so `## Accepted` is empty again when it finishes — and if any line left
`## Open` during the run, `brain evolve` says so before you look at the diff. The
sandbox is thrown away afterwards.

The brain is a git repo, so the diff is the second review and there is no separate one.
Its summary lands in `memory/system-edits.md`, which is how you read a run you did not
watch — and how it avoids re-proposing what you already turned down.

The role's own bias is worth knowing: it puts a rule where the phase that *owns* it can
act on it, pairs it with the review that catches it, and prefers a command with an
expected output over "be careful with X". A rule with no check behind it is the one that
gets skipped.

## Making a playbook better after every run

`retro` asks what a project taught about the *work*. Improving the *playbook* is two
separate steps, and it works for any playbook, with or without a retro phase.

**Step 1 — analyse the runs.** Nothing in `system/` changes here.

```bash
brain playbook analyse redesign-website
```

- **The host counts.** One scorecard per project that ran the playbook, one row per
  phase: agent runs and minutes, FAIL rounds (a human rejection is one too), findings
  a later phase raised with `escaped: <phase>`, what shipped open / waived / deferred,
  and attempts the host rejected (timed out, crashed, failed verification). `—` means
  the project is older than that record, not zero. These come from files an agent
  cannot all see, and the same arithmetic scores every run, so the next run's card
  says whether the last change helped.
- **The `playbook-analyst` judges**, with `system/` read-only as in any phase. It
  traces the most expensive rework to the phase that owns the cause, not the review
  that noticed it. It checks each past edit in `memory/system-edits.md` against the
  runs since. Then it rewrites `knowledge/playbook-<name>.md`, which the next run's
  agents read at the start of their phase, and files proposals under `## Open` —
  none that is already open, declined or applied.

**Step 2 — choose, then evolve.** On the playbook's page in the cockpit, **Accept** what
should change the playbook and **Decline** what should not (or move the lines under
`## Accepted` / `## Declined` in `proposals.md`). A declined proposal stays on record, so
the next analysis does not file it again. Then apply what you accepted:

```bash
brain playbook evolve redesign-website   # this playbook's accepted proposals, nothing else
brain evolve                             # every accepted proposal, for every playbook
```

With one playbook the two do the same. With several, the first is the one you want:
you can improve one playbook while another has a project partway through it, and its
accepted lines wait until you evolve that one. A proposal belongs to a playbook when its
`[target]` names the playbook's folder or a role its phases run. One against a shared
role belongs to every playbook that runs it; one against a skill or `BRAIN.md` belongs
to none, and only `brain evolve` applies it. Both commands warn and ask before editing a
playbook a project is partway through: that project's remaining phases run under the
edited instructions, and a renamed phase orphans the files it had.

`brain run` and `brain auto` suggest step one when a playbook completes. The cockpit has
**Analyse runs** on each playbook's page and on a finished project. The playbook page
lists just the proposals that would change that playbook or its roles, with an
**Evolve <playbook>** button for step 2.

## Evals: does a playbook still produce good work?

The test suites prove the machinery; an eval proves the agents. It runs a playbook for real
on a fixed input, approves its human gates as they come, and scores what came out:

```bash
brain eval                        # the evals here, and how each one last went
brain eval run seo-article        # a real project, unattended — model money and time
brain eval score <project>        # score a run again, e.g. one you finished by hand
```

An eval is a folder `evals/<name>/` in the base or an app: `eval.conf` names the playbook,
`brief.md` is the project's whole brief, `sources/` the files it cites, and `check.sh` the
rubric, one `pass <what>` or `fail <what>` line per check (the seo app's runs its article
checks one by one and `brain-mem check` after the retro). The report goes to
`memory/evals/<name>/<project>.md`: the scorecard per phase (agent runs, minutes, FAIL
rounds, findings let through), the checks, and the totals next to the last run's, which
`results.tsv` keeps one line per run with the base and app commits it ran on. Run evals in
`agent-brain-main`, never in the brain you work in: each run is a real project whose retro
writes to that brain's memory. They are never part of `brain test`.
