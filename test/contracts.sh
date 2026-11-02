#!/usr/bin/env bash
# Golden launcher scenarios with disposable code/memory and a fake sbx transport.
BRAIN_LIB=1 source "$(cd "$(dirname "$0")/.." && pwd)/bin/brain"
set +e
FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT
mkdir -p "$FIX/brain/bin" "$FIX/code" "$FIX/memory/phases"
cp "$(cd "$(dirname "$0")/.." && pwd)/bin/"{run-record.sh,phase-contract.sh} "$FIX/brain/bin/"
BRAIN="$FIX/brain"; SYS="$BRAIN/system"; MEM="$FIX"; PDIR="$FIX/memory"
PROJECT=fixture; PLAYBOOK=fixture; CLIENT=; BRAIN_AUTOSTOP=0
PHASES_FILE="$SYS/playbooks/fixture/phases"
CONTRACT="$SYS/playbooks/fixture/contracts/build"
mkdir -p "$SYS/roles" "$(dirname "$CONTRACT")"
printf 'build builder\nreview reviewer builder\ngate human builder\n' > "$PHASES_FILE"
printf 'builder claude default\nreviewer codex default\n' > "$SYS/roles.conf"
printf '# Builder\n' > "$SYS/roles/builder.md"
printf '# Reviewer\n' > "$SYS/roles/reviewer.md"
printf '# Playbook: fixture\n> Fixture\n\nEvery phase on this path knows this.\n\n## build\nBuild.\n## review\nReview.\n## gate\nApprove.\n' > "$SYS/playbooks/fixture/playbook.md"
cd "$FIX/code" || exit 1
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }
is() { [ "$1" = "$2" ] && ok || bad "$3: got $1, wanted $2"; }
yes() { local label="$1"; shift; "$@" && ok || bad "$label"; }
no() { local label="$1"; shift; if "$@"; then bad "$label"; else ok; fi; }
load_project() { :; }
header() { echo 'Fixture'; }
role_cfg() { echo 'claude default'; }
write_runlog() { :; }
commit_memory() { :; }
notify() { :; }
LAUNCHED=0; CHECK_EXIT=0; REVIEW=PASS; CHANGE_CONTRACT=0
sbx() {
  [ "$1" = exec ] || return 0
  # A timeout-wrapped command and positional cwd/command must cross this boundary.
  [ "$3" = -- ] && [ "$4" = timeout ] && [ "$5" = -k ] && [ "$6" = 5 ] && [ "$8" = sh ] || return 99
  printf '%s\n' "${13}" >> "$FIX/commands"
  printf 'check output\n'
  # Markers must remain proposals until verification succeeds.
  [ ! -f "$PDIR/phases/build.done" ] || return 98
  return "$CHECK_EXIT"
}
launch() {
  LAUNCHED=$((LAUNCHED + 1))
  printf '%s' "$4" > "$FIX/prompt"
  touch -t 200001010001 "$MARK"
  case "$5" in
    reviewer) printf '%b' "${REVIEW_BODY:-RESULT: $REVIEW\n}" > "$PDIR/phases/review.md"
      printf '2026-01-01 %s\n' "$REVIEW" >> "$PDIR/phases/review.log"
      [ "$REVIEW" != PASS ] || touch "$PDIR/phases/review.done" ;;
    builder)
      if [[ "$4" = *'Fix round'* ]]; then
        printf '%b' "${FIX_BODY:-1. Fixed\n}" > "$PDIR/phases/review.fixed"
      else
        printf 'Agent summary\n' > "$PDIR/phases/build.md"
        touch "$PDIR/phases/build.done"
      fi ;;
  esac
  [ "$CHANGE_CONTRACT" != 1 ] || printf 'check 10 changed-command\n' > "$CONTRACT"
  return 0
}
reset_phase() {
  rm -f "$PDIR/phases/"* "$FIX/commands"
  CHECK_EXIT=0; REVIEW=PASS; CHANGE_CONTRACT=0; REVIEW_BODY=; FIX_BODY=
}

printf 'input memory:brief.md\noutput project:dist/report.txt\nevidence memory:proof.txt\ncheck 10 check-command\n' > "$CONTRACT"
yes 'valid grammar' contract_validate "$CONTRACT"
for rule in 'input project:../outside' 'output memory:/absolute' 'evidence project:' 'output project:dir//file' 'check 0 nope' 'check 10' 'check 90000 nope' 'unknown value'; do
  printf '%s\n' "$rule" > "$FIX/invalid"
  no "reject $rule" contract_validate "$FIX/invalid"
done
printf 'input project:a file with spaces' > "$FIX/valid"
yes 'unterminated final line and spaces' contract_validate "$FIX/valid"
ln -s "$FIX" "$FIX/code/link"
no 'symlink reference rejected' contract_path project:link/memory/brief.md "$PWD" "$PDIR"

before="$LAUNCHED"
cmd_run build > "$FIX/out" 2>&1; rc=$?
is "$rc" 2 'missing input blocks'
is "$LAUNCHED" "$before" 'no agent started with missing input'
printf 'Brief\n' > "$PDIR/brief.md"
printf 'proof\n' > "$PDIR/proof.txt"
touch -t 200001010000 "$PDIR/proof.txt"
reset_phase
cmd_run build > "$FIX/out" 2>&1; rc=$?
is "$rc" 2 'done without output/evidence cannot pass'
no 'failed completion not published' test -f "$PDIR/phases/build.done"
yes 'stale evidence explained' grep -q 'Evidence is stale' "$FIX/out"
mkdir -p dist
printf 'Report\n' > dist/report.txt
touch "$PDIR/proof.txt"
reset_phase
cmd_run build > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'outputs, fresh evidence and checks pass'
yes 'completion published after checks' test -f "$PDIR/phases/build.done"
# The agent starts with its instruction, not a path to it: prompt.md is what it was told.
yes 'prompt carries the playbook preamble' grep -q 'Every phase on this path knows this.' "$FIX/prompt"
yes 'prompt carries the phase section' grep -qx 'Build.' "$FIX/prompt"
no 'and not another phase' grep -qx 'Review.' "$FIX/prompt"
yes 'sandbox receives declared command' grep -qx 'check-command' "$FIX/commands"

reset_phase; CHECK_EXIT=7
cmd_run build > "$FIX/out" 2>&1; rc=$?
is "$rc" 2 'failed command blocks completion'
no 'failed command cannot advance workflow' test -f "$PDIR/phases/build.done"
yes 'command exit included in diagnostic' grep -q 'exit 7' "$FIX/out"
reset_phase; CHECK_EXIT=124
cmd_run build > "$FIX/out" 2>&1; rc=$?
is "$rc" 2 'timed out command blocks completion'
yes 'timeout diagnostic retains exit status' grep -q 'exit 124' "$FIX/out"

reset_phase; CHANGE_CONTRACT=1
cmd_run build > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'live contract changes do not alter active snapshot'
yes 'original command used' grep -qx 'check-command' "$FIX/commands"
no 'replacement command not used' grep -qx 'changed-command' "$FIX/commands"

cp "$CONTRACT" "$SYS/playbooks/fixture/contracts/review"
reset_phase; REVIEW=FAIL; CHECK_EXIT=7
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'review FAIL is a completed investigation'
no 'review FAIL does not execute acceptance checks' test -f "$FIX/commands"
yes 'failed review dispatches fixer' fix_pending review
# Fixture timestamps separate review and fixer, without sleeping.
touch -t 200001010000 "$PDIR/phases/review.md"
CHECK_EXIT=0
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'fixer verifies handoff'
yes 'fix handoff published' test -f "$PDIR/phases/review.fixed"
no 'fixer cannot pass review' test -f "$PDIR/phases/review.done"
no 'fix now waits for reviewer' fix_pending review
REVIEW=PASS
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'reviewer rechecks after fix'
yes 'review PASS published after checks' test -f "$PDIR/phases/review.done"

yes 'review prompt carries its section' grep -qx 'Review.' "$FIX/prompt"
yes 'review prompt states the defect rules' grep -q 'every id the previous summary had OPEN' "$FIX/prompt"

yes 'playbook with contracts validates' check_playbook "$SYS/playbooks/fixture"
printf 'output project:file\n' > "$SYS/playbooks/fixture/contracts/gate"
no 'contract cannot silently redefine human gate' check_playbook "$SYS/playbooks/fixture"

# ---- defects: held after exit, rolled back when broken ------------------------
rm -f "$SYS/playbooks/fixture/contracts/"*
newest() { find "$BRAIN/.runs/fixture/review" -name result.json -print0 | xargs -0 ls -t | head -1; }
reset_phase; REVIEW=FAIL
REVIEW_BODY='RESULT: FAIL\n1. review.a\n2. review.b\n\n## Defects\n- review.a OPEN\n- review.b OPEN\n'
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'a review FAIL with open defects is a handoff'
yes 'and sends the fixer in' fix_pending review
round1="$(cat "$PDIR/phases/review.md")"
# The stub backdates the lease to 2000; older rounds are dated before it, as they are
# in real life, so only this attempt's files count as this attempt's.
touch -t 199901010000 "$PDIR/phases/review.md"
FIX_BODY='1. review.a: done\n'
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 2 'a fix that leaves an id unanswered is not a handoff'
yes 'the fix prompt asks for the ids' grep -q 'naming each OPEN defect id' "$FIX/prompt"
yes 'the fix prompt carries the section' grep -qx 'Review.' "$FIX/prompt"
yes 'the host says which' grep -q 'does not name open defect review.b' "$FIX/out"
yes 'the record says why' grep -q '"outcome":"defects_invalid"' "$(newest)"
yes 'the fix round is still owed' fix_pending review
FIX_BODY='1. review.a: done\n2. review.b: done\n'
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'a fix naming every id is a handoff'
no 'the reviewer is next' fix_pending review
touch -t 199912310000 "$PDIR/phases/review.fixed"
REVIEW_BODY='RESULT: FAIL\n1. review.a\n\n## Defects\n- review.a OPEN\n'
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 2 'a round that drops a finding is not a handoff'
is "$(cat "$PDIR/phases/review.md")" "$round1" 'the summary is put back as the attempt found it'
is "$(fail_rounds "$PDIR/phases/review.log")" 1 'and its FAIL line does not count as a round'
no 'so the fixer is not sent a list the host refused' fix_pending review
yes 'the refused summary is kept in the record' test -f "$(dirname "$(newest)")/rejected.md"
REVIEW=PASS REVIEW_BODY='RESULT: PASS\n\n## Defects\n- review.a VERIFIED\n- review.b VERIFIED\n'
cmd_run review > "$FIX/out" 2>&1; rc=$?
is "$rc" 0 'the rerun review that carries every id passes'
yes 'and completes' test -f "$PDIR/phases/review.done"

printf '\n%s contract checks passed, %s failed\n' "$PASS" "$FAIL"
exit $((FAIL > 0))
