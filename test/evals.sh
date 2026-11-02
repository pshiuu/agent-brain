#!/usr/bin/env bash
# brain eval: a playbook run on a fixed input, its gates approved by the runner, scored and
# compared with the run before. The agents are a stub here: cmd_run marks each work phase
# done after "two minutes" and stops at each human gate, the way the real one does.
#
#   ./test/evals.sh

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
REPO="$BRAIN"
fake_brain
# cmd_approve writes a host record through bin/run-record.sh under $BRAIN: a throwaway one.
BRAIN="$T"; mkdir -p "$BRAIN/bin" "$BRAIN/templates"; cp "$REPO/bin/run-record.sh" "$REPO/bin/phase-contract.sh" "$BRAIN/bin/"; cp "$REPO/templates/VERSION" "$BRAIN/templates/"
printf 'writer  claude  default\n' >> "$SYS/roles.conf"; printf '# Role: writer\n' > "$SYS/roles/writer.md"
mkdir -p "$SYS/playbooks/note"
printf 'draft  writer\ngate  human  writer\nfinish  writer\n' > "$SYS/playbooks/note/phases"
printf '# Playbook: note\n> A note.\n\n## draft\nx\n## gate\nx\n## finish\nx\n' > "$SYS/playbooks/note/playbook.md"
printf '# Brief\n\n## Topic\n' > "$SYS/playbooks/note/brief.md"
mkdir -p "$SYS/evals/short-note/sources"
printf 'playbook note\n' > "$SYS/evals/short-note/eval.conf"
printf '# Brief\n\n## Topic\nWhy cats sleep\n' > "$SYS/evals/short-note/brief.md"
printf 'notes\n' > "$SYS/evals/short-note/sources/notes.txt"
cat > "$SYS/evals/short-note/check.sh" <<'EOF'
grep -q 'Why cats sleep' "$PDIR/brief.md" && echo "pass the brief is the fixture's" || echo "fail the brief is the fixture's"
[ -f "$PDIR/phases/finish.done" ] && echo "pass it finished" || echo "fail it finished"
[ -f "$BRAIN_MEMORY/flag" ] && echo "pass the flag is set" || echo "fail the flag is set"
EOF

cmd_run() {
  local p; p="$(next_phase)"; [ -n "$p" ] || return 1
  if [ "$(phase_field "$p" 2)" = human ]; then RUN_STATUS=gate; printf '# %s\n\nRESULT: FAIL\n' "$p" > "$PDIR/phases/$p.md"; return 0; fi
  RUN_STATUS=done; printf '# %s\n\nRESULT: PASS\n' "$p" > "$PDIR/phases/$p.md"
  mkdir -p "$PDIR/phases/$p.runs"; printf '{"seconds": 120}\n' > "$PDIR/phases/$p.runs/1.json"
  touch "$PDIR/phases/$p.done"
}

section "list — what evals there are"
has "$(eval_list)" "short-note" "an eval in the base"
has "$(eval_list)" "not run yet" "and that it has not run"
no "an unknown eval" eval_dir nothing
# The command itself runs under set -e, where the sourced functions here do not.
has "$(BRAIN="$T" bash "$REPO/bin/brain" eval 2>&1)" "short-note" "brain eval lists it from the command line too"

section "run — a real project, gates approved, scored"
out="$(eval_run short-note 2>&1)"
p="$(ls "$MEM/projects" | grep '^eval-short-note-')"
yes "a project named for the eval" test -n "$p"
is "$(eval_field EVAL "$MEM/projects/$p/project.env")" "short-note" "marked as an eval run"
has "$(cat "$MEM/projects/$p/brief.md")" "Why cats sleep" "the fixture's brief replaced the template"
yes "its sources came along" test -f "$MEM/projects/$p/sources/notes.txt"
yes "the gate was approved by the runner" test -f "$MEM/projects/$p/phases/gate.done"
yes "and the playbook ran to the end" test -f "$MEM/projects/$p/phases/finish.done"
has "$out" "Phases done 3 of 3 · agent runs 2 · minutes 4 · FAIL rounds 0 · checks passed 2 of 3." "the totals"
has "$out" "First run of this eval" "nothing to compare with yet"
has "$out" "- fail the flag is set" "a failed check is named"
yes "the report is kept" test -f "$MEM/evals/short-note/$p.md"
is "$(tail -n +2 "$MEM/evals/short-note/results.tsv" | wc -l | tr -d ' ')" "1" "one results line"

section "the next run is compared with the last"
touch "$MEM/flag"; sleep 1
out="$(eval_run short-note 2>&1)"
p2="$(ls "$MEM/projects" | grep '^eval-short-note-' | grep -vx "$p")"
has "$out" "checks 2/3 -> 3/3" "the check that now passes shows"
has "$out" "Last run ($p" "named"
has "$(eval_list)" "checks 3/3" "list shows the last run"
out="$(eval_score "$p" 2>&1)"
is "$(tail -n +2 "$MEM/evals/short-note/results.tsv" | wc -l | tr -d ' ')" "3" "scoring again adds a line"
has "$out" "Last run ($p2" "and compares with the other run, not with itself"
no "score refuses a project that is no eval" eval_score nobody

section "brain app check — an app's evals"
mkdir -p "$T/app/evals/broken" "$T/app/evals/good"
printf 'name app\nversion 1\nbrain >= %s\n' "$BRAIN_VERSION" > "$T/app/app.conf"
printf 'playbook nowhere\n' > "$T/app/evals/broken/eval.conf"; printf 'if then\n' > "$T/app/evals/broken/check.sh"
printf 'playbook note\n' > "$T/app/evals/good/eval.conf"; printf '# Brief\n' > "$T/app/evals/good/brief.md"
out="$(app_check "$T/app" 2>&1)"
has "$out" "evals/broken runs playbook 'nowhere'" "an eval of a playbook nobody has"
has "$out" "evals/broken has no brief.md" "an eval without its input"
has "$out" "evals/broken/check.sh does not parse" "a rubric that does not parse"
hasnt "$out" "evals/good" "a good one passes"

finish
