# Roadmap

What is planned and not built yet. Each item says what it is for, how it fits what is
already here, and what stays the same. Done items leave this page; the docs that describe
them are the record.

## Score an evolve before it is kept

`brain evolve` applies the proposals you accepted, and then nothing checks whether the
output got better. Optimisers like GEPA and Hermes self-evolution run the same
analyse-then-propose loop, but score every candidate edit on evals before keeping it;
they report $2–10 per run and results with as few as three examples.

- After `brain playbook evolve <name>`, run that playbook's eval (`brain eval run`) and
  put its line in `results.tsv` next to the last one: checks passed, FAIL rounds,
  minutes, dollars.
- If the score dropped, say so and show the undo: `git checkout -- system` (or the
  app's equivalent), since `system/` is committed by hand and git is its only undo.
- The human gate stays. You still accept or decline; you do it on a number instead of a
  guess. Evals cost model money, so this is a prompt to run one, never automatic inside
  `brain test`.

## Turn failures into eval cases

Every real failure should become a regression case. The brain already records the
signals: human rejections at gates, `escaped: <phase>` findings, and FAIL rounds. Today
evals are written by hand, so there are few of them.

- `brain eval capture <project> <phase>` freezes that project's `brief.md` and
  `sources/` into `evals/<name>/` with an `eval.conf` naming its playbook, and a
  `check.sh` with one `fail`/`pass` line for the thing that went wrong (from the gate
  feedback or the escaped finding), for a human to sharpen.
- It runs on the host (it writes `system/`), into the base's `evals/` or the
  playbook's app's, and is committed by hand like any other change there.

## Check the LLM reviewers against your own decisions

`seo-reviewer` and the other review roles are LLM judges. Published work documents their
biases: they favour longer text, are sycophantic, and go easy on output from the same
model family.

- The cheap test: count how often a reviewer's PASS was later rejected by the human at a
  gate. Gate decisions are free labels. A column per review role in the analyse
  scorecard ("PASS later rejected at a gate") is enough.
- If that rate is high, give the reviewer a different engine or model from the writer.
  Roles already pick their engine per line in `roles.conf`; this is data, not code.
