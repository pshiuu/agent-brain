#!/usr/bin/env bash
# The phase state machine, without a sandbox.
#
# next_phase / fix_pending / phase_finished decide what runs next, and cmd_auto decides
# when to stop. Unattended that is the whole machine: a misfire either hangs forever or
# walks past an unfinished phase, and both look exactly like "still working" from outside.
# Sourcing the launcher with BRAIN_LIB=1 gives us those functions and runs nothing.
#
#   ./test/state.sh

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BRAIN_LIB=1 source "$REPO/bin/brain"
set +e   # the launcher sets -e; a failing assertion must report, not abort the run

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); }
bad()  { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }
is()   { [ "$1" = "$2" ] && ok || bad "$3: got '$1', want '$2'"; }
holds() { local w="$1"; shift; if "$@"; then ok; else bad "$w: expected true"; fi; }
denies(){ local w="$1"; shift; if "$@"; then bad "$w: expected false"; else ok; fi; }
section() { echo; echo "$1"; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cp "$REPO/bin/run-record.sh" "$T/run-record.sh"
cp "$REPO/bin/phase-contract.sh" "$T/phase-contract.sh"
BRAIN="$T/brain"; SYS="$BRAIN/system"; SBXCONF="$SYS/sandbox.conf"
mkdir -p "$BRAIN/bin" "$SYS/roles"
cp "$T/run-record.sh" "$BRAIN/bin/run-record.sh"
cp "$T/phase-contract.sh" "$BRAIN/bin/phase-contract.sh"
printf '# Alpha\n' > "$SYS/roles/alpha.md"
PDIR="$T/project"; PHASES_FILE="$T/phases"; PROJECT="testproj"; PLAYBOOK="testbook"
mkdir -p "$PDIR/phases"
cat > "$PHASES_FILE" <<'EOF'
# phase  role   fix-role
one      alpha
two      rev    alpha
gate     human  alpha
three    beta
EOF

# Explicit mtimes, a minute apart: "newer than" is the whole contract here and sleeping
# for real would make the suite slow and still be at the mercy of filesystem granularity.
OLD=202609230900; MID=202609230901; NEW=202609230902
at() { touch -t "$1" "$2"; }
reset() { rm -rf "$PDIR/phases"; mkdir -p "$PDIR/phases"; }

section "next_phase — the first phase with no .done"
reset
is "$(next_phase)" "one" "nothing done"
touch "$PDIR/phases/one.done"
is "$(next_phase)" "two" "one done"
touch "$PDIR/phases/two.done" "$PDIR/phases/gate.done"
is "$(next_phase)" "three" "three left"
touch "$PDIR/phases/three.done"
is "$(next_phase)" "" "all done"

section "fix_pending — is the next run the fixer or the phase's own role"
reset
denies "phase with no fix-role never has a fix pending" fix_pending one
denies "no summary yet" fix_pending two
echo "RESULT: PASS" > "$PDIR/phases/two.md"
denies "review passed" fix_pending two
echo "RESULT: FAIL" > "$PDIR/phases/two.md"
at "$NEW" "$PDIR/phases/two.md"
holds "review failed, nothing fixed yet" fix_pending two
at "$OLD" "$PDIR/phases/two.md"; at "$NEW" "$PDIR/phases/two.fixed"
denies "fix landed after the review" fix_pending two
at "$NEW" "$PDIR/phases/two.md"; at "$OLD" "$PDIR/phases/two.fixed"
holds "review ran again and failed again" fix_pending two

section "phase_finished — the agent's last write, vs the marker touched before the run"
reset
at "$MID" "$PDIR/phases/two.running"
denies "nothing written yet" phase_finished two
at "$NEW" "$PDIR/phases/two.done"
denies ".done without a summary cannot finish" phase_finished two
echo 'Summary' > "$PDIR/phases/two.md"; at "$NEW" "$PDIR/phases/two.md"
holds ".done with a fresh summary" phase_finished two
reset; at "$MID" "$PDIR/phases/two.running"; at "$NEW" "$PDIR/phases/two.fixed"
denies "empty fix handoff" phase_finished two fix
echo '1. fixed' > "$PDIR/phases/two.fixed"; at "$NEW" "$PDIR/phases/two.fixed"
holds ".fixed after .running (a fix round)" phase_finished two fix
denies "a reviewer cannot hand off as a fixer" phase_finished two review
at "$NEW" "$PDIR/phases/two.done"
denies "a fixer cannot approve its own work" phase_finished two fix
reset; at "$MID" "$PDIR/phases/two.running"
echo "RESULT: FAIL" > "$PDIR/phases/two.md"
at "$NEW" "$PDIR/phases/two.md"
echo '2026-09-23 FAIL' > "$PDIR/phases/two.log"; at "$NEW" "$PDIR/phases/two.log"
holds "failing review ends on its .log line" phase_finished two review
at "$OLD" "$PDIR/phases/two.md"
denies "fresh log cannot revive an old FAIL summary" phase_finished two review
at "$NEW" "$PDIR/phases/two.md"
echo '2026-09-23 PASS' > "$PDIR/phases/two.log"; at "$NEW" "$PDIR/phases/two.log"
denies "log verdict must agree with summary" phase_finished two review
printf 'RESULT: PASS\nRESULT: FAIL\n' > "$PDIR/phases/two.md"
at "$NEW" "$PDIR/phases/two.md"
denies "conflicting verdicts" phase_finished two review
echo 'RESULT: PASS' > "$PDIR/phases/two.md"; at "$NEW" "$PDIR/phases/two.md"
denies "PASS still needs a done marker" phase_finished two review
at "$NEW" "$PDIR/phases/two.done"
holds "matching PASS summary, log and done" phase_finished two review
reset; at "$MID" "$PDIR/phases/two.running"
echo "RESULT: PASS" > "$PDIR/phases/two.md"; at "$NEW" "$PDIR/phases/two.log"
denies "a .log line with no FAIL is not an ending" phase_finished two
# The one that matters most: a marker left over from an earlier round must not count as
# this round finishing, or the sandbox is torn down the moment the next run starts.
reset; at "$OLD" "$PDIR/phases/two.done"; at "$NEW" "$PDIR/phases/two.running"
denies "stale .done from an earlier round" phase_finished two
reset; at "$OLD" "$PDIR/phases/two.fixed"; at "$NEW" "$PDIR/phases/two.running"
denies "stale .fixed from an earlier round" phase_finished two

section "proposals_section — what brain evolve is allowed to act on"
MEM="$T/mem"; mkdir -p "$MEM/knowledge"; : > "$MEM/index.md"   # or lint_memory stops short of the proposals check
printf '# P\n\n## Accepted\n- a one\n\n## Open\n- o one\n- o two\n' > "$MEM/proposals.md"
is "$(proposals_section Accepted | wc -l | tr -d ' ')" "1" "accepted count"
is "$(proposals_section Open | wc -l | tr -d ' ')" "2" "open count"
is "$(proposals_section Accepted)" "- a one" "accepted content"
printf '# P\n\n## Accepted\n\n## Open\n- o one\n\n## Declined\n- d one\n' > "$MEM/proposals.md"
is "$(proposals_section Declined)" "- d one" "declined content"
is "$(proposals_section Accepted)" "" "a declined line is never accepted"
case "$(lint_memory)" in *"proposals.md has"*) bad "a declined line counted as stray" ;; *) ok ;; esac
printf '# P\n- stray\n' > "$MEM/proposals.md"
is "$(proposals_section Accepted)$(proposals_section Open)" "" "a line under no heading is invisible"
case "$(lint_memory)" in *"proposals.md has 1 line(s) under none of"*) ok ;; *) bad "stray line not reported" ;; esac
rm -f "$MEM/proposals.md"
is "$(proposals_section Open)" "" "missing file is empty, not an error"

section "evolve remains independent of phase review state"
if (
  role_cfg() { echo 'claude default'; }
  launch() { [ "$5" = system-editor ]; }
  drop_draft_sandbox() { :; }
  unset run_mode
  cmd_evolve 'Explicit test request'
) > "$T/evolve.out" 2>&1; then ok; else bad "evolve failed: $(cat "$T/evolve.out")"; fi

# ---- one verdict rule, one round rule, one text per human verdict ------------
# test/fixtures/verdicts is shared with ui/test.mjs: the cockpit writes the same bytes.
V="$REPO/test/fixtures/verdicts"
section "verdicts — the rules the cockpit mirrors (test/fixtures/verdicts)"
is "$(fail_rounds "$V/phase.log")" "3" "only host-format FAIL lines are rounds"
is "$(fail_rounds "$T/no-such.log")" "0" "no log is no rounds"
is "$(open_rounds "$V/phase.log")" "1" "the fix limit counts only rounds since the last PASS"
is "$(approve_summary "$V/summary.md" "$V/fixed.txt" 2026-09-24 1 qa.slug-rename-links)" "$(cat "$V/approved.md")" "approval text"
is "$(reject_summary design-gate 2 2026-09-24 'Hero feels generic' 'Footer needs opening hours')" "$(cat "$V/rejected.md")" "rejection text"
reset
printf 'RESULT: PASS\nThe reviewer said RESULT: FAIL in round one.\n' > "$PDIR/phases/two.md"
denies "a FAIL quoted in prose is not a failed review" fix_pending two

section "defects_verify — what a review and a fix handoff are held to"
D="$T/defects"; mkdir -p "$D"
w() { printf '%b' "$2" > "$D/$1"; }
dv() { defects_verify "$@" > /dev/null; }
w none 'RESULT: FAIL\n1. x\n'
holds "no block, before or now: the old rules" dv qa review "$D/none" "$D/none" /dev/null
w fail0 'RESULT: FAIL\n## Defects\n- qa.a VERIFIED\n'
denies "FAIL with nothing open" dv qa review "$D/fail0" /dev/null /dev/null
w pass1 'RESULT: PASS\n## Defects\n- qa.a OPEN\n'
denies "PASS with an open defect" dv qa review "$D/pass1" /dev/null /dev/null
w r1 'RESULT: FAIL\n## Defects\n- qa.a OPEN code\n- qa.b OPEN content — escaped: design-review\n'
holds "a first round" dv qa review "$D/r1" /dev/null /dev/null
w r2drop 'RESULT: FAIL\n## Defects\n- qa.a OPEN\n'
denies "round 2 drops a round-1 id" dv qa review "$D/r2drop" "$D/r1" /dev/null
w r2 'RESULT: PASS\n## Defects\n- qa.a VERIFIED\n- qa.b WAIVED — human\n'
holds "every id carried forward" dv qa review "$D/r2" "$D/r1" /dev/null
denies "dropping the whole block" dv qa review "$D/none" "$D/r1" /dev/null
w alien 'RESULT: FAIL\n## Defects\n- design.a OPEN\n'
denies "an id of another phase" dv qa review "$D/alien" /dev/null /dev/null
w dup 'RESULT: FAIL\n## Defects\n- qa.a OPEN\n- qa.a OPEN\n'
denies "one id twice" dv qa review "$D/dup" /dev/null /dev/null
w badstate 'RESULT: FAIL\n## Defects\n- qa.a OPEN\n- qa.b FIXED\n'
denies "a state that does not exist" dv qa review "$D/badstate" /dev/null /dev/null
w fixed1 '1. qa.a: done\n'
denies ".fixed leaves an OPEN id out" dv qa fix "$D/r1" "$D/r1" "$D/fixed1"
w fixed2 '1. qa.a: done\n2. (qa.b) reseeded.\n'
holds ".fixed names every OPEN id" dv qa fix "$D/r1" "$D/r1" "$D/fixed2"
w prefix '1. qa.ab done\n2. qa.b done\n'
denies "an id is a word, not a prefix of one" dv qa fix "$D/r1" "$D/r1" "$D/prefix"

section "check_playbook — a review cannot fix its own findings"
PB="$T/pb"; mkdir -p "$PB"
printf 'alpha  claude  default\n' > "$SYS/roles.conf"
printf '# Playbook: t\n> t\n\n## x\nX.\n' > "$PB/playbook.md"
printf 'x  alpha  alpha\n' > "$PB/phases"
out="$(check_playbook "$PB")"
case "$out" in *"cannot fix its own findings"*) ok ;; *) bad "fix-role == role not reported: $out" ;; esac
rm -f "$SYS/roles.conf"

section "lint — provenance"
MEM="$T/lintmem"; mkdir -p "$MEM/knowledge" "$MEM/sources" "$MEM/projects/acme/phases"
printf '# Index\n- [p](knowledge/p.md)\n' > "$MEM/index.md"
printf '# P\nOne line.\n\n## What we know\n- A claim (projects/acme/phases/gone.md).\n' > "$MEM/knowledge/p.md"
printf 'pdf' > "$MEM/sources/Acme_Brandbook.pdf"
printf 'Took the palette from Acme_Brandbook.pdf.\n' > "$MEM/projects/acme/phases/brand.md"
out="$(lint_memory)"
case "$out" in *"err  knowledge/p.md has no '## Sources'"*) ok ;; *) bad "missing ## Sources not an error: $out" ;; esac
case "$out" in *"note knowledge/p.md cites projects/acme/phases/gone.md"*) ok ;; *) bad "missing citation not noted: $out" ;; esac
case "$out" in *"Acme_Brandbook.pdf is cited only by project acme"*) ok ;; *) bad "single-project source not noted: $out" ;; esac

section "lint — staleness"
printf '# Index\n- [p](knowledge/p.md)\n- [old](knowledge/old.md)\n- [new](knowledge/new.md)\n' > "$MEM/index.md"
printf '# Old\nOne line.\n\n## Sources\n- projects/acme/phases/brand.md (2020-01-05)\n- sources/x.pdf (2021-03-02)\n' > "$MEM/knowledge/old.md"
printf '# New\nOne line.\n\n## Sources\n- projects/acme/phases/brand.md (2020-01-05)\n- projects/acme/phases/brand.md (%s)\n' "$(date +%Y-%m-%d)" > "$MEM/knowledge/new.md"
out="$(lint_memory)"
case "$out" in *"note knowledge/old.md was last confirmed 2021-03-02"*) ok ;; *) bad "stale page not noted by its newest source date: $out" ;; esac
case "$out" in *"knowledge/new.md was last confirmed"*) bad "a page confirmed today noted as stale: $out" ;; *) ok ;; esac
printf '# P\nOne line.\n\n## Sources\n- projects/acme/phases/brand.md\n' > "$MEM/knowledge/p.md"
case "$(lint_memory)" in *"note knowledge/p.md has no dated source"*) ok ;; *) bad "undated page not noted" ;; esac

section "scorecard — how a playbook ran, counted from the record"
MEM="$T/scmem"; P="$MEM/projects/acme/phases"
mkdir -p "$P/two.runs" "$SYS/playbooks/book" "$BRAIN/.runs/acme/two/r1" "$BRAIN/.runs/acme/two/r2" "$MEM/projects/fresh"
printf '# phase role fix\none alpha\ntwo rev alpha\n' > "$SYS/playbooks/book/phases"
printf 'PLAYBOOK=book\nCREATED=2026-09-01\n' > "$MEM/projects/acme/project.env"
printf 'PLAYBOOK=book\nCREATED=2026-09-20\n' > "$MEM/projects/fresh/project.env"   # never ran a phase
touch "$P/one.done"
printf '{\n  "model": "m1",\n  "seconds": 1800,\n  "turns": 3,\n  "tokens": {\n    "input": 1000000,\n    "output": 100000,\n    "cache_read": 2000000,\n    "cache_write": 0\n  }\n}\n' > "$P/two.runs/a.json"   # brain-runlog's pretty jq
printf '{"seconds":1200}\n' > "$P/two.runs/b.json"
printf 'm1 4.00 20.00 0.20 5.00\n' > "$SYS/prices.conf"
printf '2026-09-01 FAIL\n2026-09-02 FAIL\n2026-09-03 PASS\n' > "$P/two.log"
printf 'RESULT: PASS\n\n## Defects\n- two.a WAIVED code — x — escaped: one\n- two.b DEFERRED code — y — escaped: one\n' > "$P/two.md"
printf 'RESULT: FAIL\n\n## Defects\n- two.a OPEN code — x — escaped: one\n' > "$P/three.md"
printf '{"host_verdict":{"outcome":"timed_out"}}' > "$BRAIN/.runs/acme/two/r1/result.json"
printf '{"host_verdict":{"outcome":"verified"}}' > "$BRAIN/.runs/acme/two/r2/result.json"
out="$(scorecard acme book)"
is "$(printf '%s\n' "$out" | grep '^| one ')" "| one | alpha | — | — | — | 0 | 2 | — | — |" \
  "unrecorded runs are '—', and a finding carried in two summaries is let through once"
is "$(printf '%s\n' "$out" | grep '^| two ')" "| two | rev | 2 | 50 | ≥\$6.40 | 2 | 0 | 0 / 1 / 1 | 1 |" \
  "runs, minutes, dollars (a receipt with no priced model makes it a floor), FAIL rounds, what shipped, and only the attempt that did not hand off"
is "$(runs_usd "$P/two.runs/a.json")" "\$6.40" "4 in + 2 out + 0.40 cache read"
is "$(runs_usd "$P/two.runs/b.json")" "?" "no priced run: unknown, not \$0"
is "$(playbook_projects book)" "acme" "a project that never finished a phase has no run to learn from"

section "playbook analyse — the analyst gets the numbers, and only files proposals"
printf '# P\n\n## Accepted\n\n## Open\n- [system/roles/alpha.md] old (acme, 2026-09-01)\n' > "$MEM/proposals.md"
(
  role_cfg() { echo 'claude default'; }
  # The analyst files one proposal, and only if the scorecard reached its prompt.
  launch() {
    [ "$5" = playbook-analyst ] || return 0
    case "$4" in *"| two | rev | 2 | 50 | ≥\$6.40 | 2 |"*) printf -- '- [system/playbooks/book/playbook.md] new (acme, 2026-09-23)\n' >> "$MEM/proposals.md" ;; esac
  }
  drop_draft_sandbox() { :; }; commit_memory() { :; }
  cmd_evolve() { echo "EVOLVE RAN"; }
  cmd_playbook_analyse book
) > "$T/pe.out" 2>&1; out="$(cat "$T/pe.out")"
case "$out" in *"1 new proposal(s) for book"*"1. [system/playbooks/book/playbook.md] new"*) ok ;; *) bad "new proposal not reported: $out" ;; esac
case "$out" in *"EVOLVE RAN"*) bad "step one applied something — choosing is a separate step" ;; *"apply what you accepted:  brain playbook evolve book"*) ok ;; *) bad "no next step given: $out" ;; esac
rm -f "$MEM/proposals.md"
case "$(cmd_playbook_analyse nobook 2>&1)" in *"no playbook 'nobook'"*) ok ;; *) bad "unknown playbook not refused" ;; esac

section "playbook evolve — one playbook's accepted proposals, and the rest wait"
printf -- '- [system/playbooks/book/playbook.md] a\n- [system/roles/alpha.md step 2] b — see roles/zeta.md\n- [system/roles/zeta.md] c — evidence in playbooks/book\n- [system/playbooks/book-two/phases] d\n- [system/skills/x] e\n' > "$T/lines"
is "$(targets_playbook book < "$T/lines" | sed 's/\].*/]/' | tr '\n' '|')" "- [system/playbooks/book/playbook.md]|- [system/roles/alpha.md step 2]|" \
  "its folder and its roles, by target only — not the evidence, not book-two"
printf '# P\n\n## Accepted\n- [system/playbooks/book/phases] mine (acme, 2026-09-23)\n- [system/skills/x] theirs (acme, 2026-09-23)\n\n## Open\n' > "$MEM/proposals.md"
evolve_run() { # what the stubbed editor does -> its output in $T/ev.out, its prompt in $T/ev.prompt
  (
    role_cfg() { echo 'claude default'; }
    drop_draft_sandbox() { :; }
    launch() { printf '%s' "$4" > "$T/ev.prompt"; eval "$EDIT"; }
    BRAIN_NONINTERACTIVE=1 cmd_playbook_evolve book
  ) > "$T/ev.out" 2>&1
}
EDIT='printf "# P\n\n## Accepted\n- [system/skills/x] theirs (acme, 2026-09-23)\n\n## Open\n" > "$MEM/proposals.md"'; evolve_run
case "$(cat "$T/ev.prompt")" in *"] mine"*) ok ;; *) bad "the playbook's line is not in the queue" ;; esac
case "$(cat "$T/ev.prompt")" in *"] theirs"*) bad "another playbook's line was queued" ;; *) ok ;; esac
case "$(cat "$T/ev.out")" in *"accepted for other playbooks"*) bad "warned although the other line stayed put" ;; *) ok ;; esac
# acme has run 'one' but not 'two': the command says so before it applies anything.
case "$(cat "$T/ev.out")" in *"partway through book: acme"*) ok ;; *) bad "in-flight project not reported: $(cat "$T/ev.out")" ;; esac
printf '# P\n\n## Accepted\n- [system/playbooks/book/phases] mine (acme, 2026-09-23)\n- [system/skills/x] theirs (acme, 2026-09-23)\n\n## Open\n' > "$MEM/proposals.md"
EDIT='printf "# P\n\n## Accepted\n\n## Open\n" > "$MEM/proposals.md"'; evolve_run
case "$(cat "$T/ev.out")" in *"accepted for other playbooks and are no longer under"*"] theirs"*) ok ;; *) bad "a lost foreign accepted line went unreported" ;; esac
printf '# P\n\n## Accepted\n- [system/skills/x] theirs (acme, 2026-09-23)\n\n## Open\n' > "$MEM/proposals.md"
case "$(BRAIN_NONINTERACTIVE=1 cmd_playbook_evolve book 2>&1)" in *"nothing accepted for playbook 'book'"*) ok ;; *) bad "ran with nothing accepted for the playbook" ;; esac
rm -f "$MEM/proposals.md"

# ---- the phase timeout, through the real watcher ---------------------------
# The one unattended feature that cannot be checked by inspection: a phase that never
# writes a handoff file has to be torn down. Everything that needs a sandbox is stubbed;
# the watcher subshell, the TIMEDOUT handoff and cmd_run's reaction to it are real.
# Costs a few seconds of wall clock, which is why it is last.
section "phase timeout — an agent that never writes a handoff file (~5s)"
reset
load_project() { :; }   # the fixture already sets PDIR / PHASES_FILE / PROJECT
PHASE_TIMEOUT=3
rm -f "$T/stopped"
sbx() { [ "${1:-}" = "stop" ] && echo "${2:-}" > "$T/stopped"; return 0; }
write_runlog() { :; }
commit_memory() { :; }
header() { echo "hdr"; }
role_cfg() { echo "claude default"; }
launch() { command sleep 6; return 0; }   # works forever, writes nothing
unset -f sleep                            # the watcher needs a real one
cmd_run one > "$T/out" 2>&1; rc=$?; out="$(cat "$T/out")"
is "$rc" "3" "cmd_run returns 3 on timeout"
is "$RUN_STATUS" "timeout" "and says so to auto"
is "$(cat "$T/stopped" 2>/dev/null)" "testproj-claude" "the sandbox was stopped"
case "$out" in *"wrote no handoff file in 3s"*) ok ;; *) bad "no timeout message: $out" ;; esac
denies "the phase is not marked done" test -f "$PDIR/phases/one.done"
# the shutdown race: the budget lapses, but the agent lands its handoff file while the
# sandbox is being torn down. The marker wins — that phase finished.
reset
launch() { command sleep 4; echo 'Summary' > "$PDIR/phases/one.md"; touch "$PDIR/phases/one.done"; command sleep 3; return 0; }
rm -f "$T/stopped"
cmd_run one > "$T/out" 2>&1; rc=$?
is "$rc" "0" "handoff file landed during teardown: not a timeout"
is "$RUN_STATUS" "" "and auto is not told to stop"
# and the mirror image: a phase that does finish must not be reported as a timeout
reset
launch() { command sleep 2; echo 'Summary' > "$PDIR/phases/one.md"; touch "$PDIR/phases/one.done"; command sleep 4; return 0; }
rm -f "$T/stopped"
cmd_run one > "$T/out" 2>&1; rc=$?; out="$(cat "$T/out")"
is "$rc" "0" "a phase that finishes returns 0"
is "$RUN_STATUS" "" "and is not flagged as a timeout"
case "$out" in *"is complete"*) ok ;; *) bad "no completion message: $out" ;; esac

section "host rejects false completion after the agent exits"
reset
BRAIN_AUTOSTOP=0
launch() { command sleep 1; touch "$PDIR/phases/one.done"; return 0; }
cmd_run one > "$T/out" 2>&1; rc=$?
is "$rc" "2" "done with no summary returns incomplete"
denies "invalid completion marker no longer advances auto" test -f "$PDIR/phases/one.done"
holds "every attempt has a host result, without a transcript" test -n "$(find "$BRAIN/.runs" -name result.json -print)"
unset BRAIN_AUTOSTOP

# ---- human verdicts and dead launchers --------------------------------------
section "approve — open findings are closed on the record, never erased"
reset; rm -rf "$BRAIN/.runs"
printf 'RESULT: FAIL\n1. two.a\n\n## Defects\n- two.a OPEN\n- two.b OPEN\n' > "$PDIR/phases/two.md"
( cmd_approve two --defer two.zz ) > "$T/out" 2>&1
is "$?" "1" "deferring an id that is not open is refused"
denies "and nothing was approved" test -f "$PDIR/phases/two.done"
cmd_approve two --defer two.b > "$T/out" 2>&1
holds "approved" test -f "$PDIR/phases/two.done"
holds "the verdict line is PASS" verdict_is PASS "$PDIR/phases/two.md"
holds "the summary is kept" grep -qx '1. two.a' "$PDIR/phases/two.md"
holds "the unnamed one is waived" grep -qx -- "- two.a WAIVED — human $(date +%F)" "$PDIR/phases/two.md"
holds "the named one is deferred" grep -qx -- "- two.b DEFERRED — human $(date +%F)" "$PDIR/phases/two.md"
rec="$(ls -d "$BRAIN/.runs/testproj/two/"*/ | tail -1)"
holds "a human record" grep -q '"actor":"human"' "$rec/result.json"
holds "listing what it waived and deferred" grep -q '"waived":\["two.a"\],"deferred":\["two.b"\]' "$rec/result.json"

section "reject — every item is an OPEN defect the fixer must answer"
reset
cmd_reject two "hero is generic" "footer needs hours" > "$T/out" 2>&1
holds "the fixer runs next" fix_pending two
holds "ids carry the round" grep -qx -- '- two.r1-2 OPEN — item 2' "$PDIR/phases/two.md"

section "reopen — the way back from a gate with no fix-role"
reset; rm -rf "$BRAIN/.runs"
printf 'Agent summary for one\n' > "$PDIR/phases/one.md"
touch "$PDIR/phases/one.done" "$PDIR/phases/two.done" "$PDIR/phases/gate.done"
cmd_reopen one "the hero is wrong" > "$T/out" 2>&1
is "$(next_phase)" "one" "the playbook is back at the reopened phase"
denies "later phases lose .done too" test -f "$PDIR/phases/gate.done"
holds "the summary is kept" grep -qx 'Agent summary for one' "$PDIR/phases/one.md"
holds "the feedback is appended" grep -qx '1. the hero is wrong' "$PDIR/phases/one.md"
rec="$(ls -d "$BRAIN/.runs/testproj/one/"*/ | tail -1)"
holds "the .done files are kept in the record" test -f "$rec/gate.done"
holds "which it names" grep -q '"reopened":\["one","two","gate"\]' "$rec/result.json"

section "sweep_stale — an attempt whose launcher is gone"
reset; rm -rf "$BRAIN/.runs"
dead="$(bash -c 'echo $$')"   # a process that has already exited
begin_as() { printf 'p\n' | BRAIN_LAUNCHER="$1" bash "$BRAIN/bin/run-record.sh" begin "$BRAIN" "$PDIR" "$T" testproj testbook "$2" alpha claude default '' work 0 3 v1 ''; }
d1="$(begin_as "$dead" one)"
printf '%s\n' "${d1##*/}" > "$PDIR/phases/one.running"; at "$MID" "$PDIR/phases/one.running"
echo 'Summary' > "$PDIR/phases/one.md"; touch "$PDIR/phases/one.done"; at "$NEW" "$PDIR/phases/one.done"
d2="$(begin_as "$$" two)"
printf '%s\n' "${d2##*/}" > "$PDIR/phases/two.running"
d3="$(begin_as "$dead" gate)"
is "$(live_leases testproj "$PDIR")" "two " "a lease is live while its launcher is"
sweep_stale testproj "$PDIR" > "$T/out" 2>&1
holds "the dead attempt is closed as crashed" grep -q '"outcome":"crashed"' "$d1/result.json"
denies "its lease is gone" test -f "$PDIR/phases/one.running"
denies "the unchecked .done it wrote does not advance the playbook" test -f "$PDIR/phases/one.done"
holds "it is kept as rejected" test -f "$d1/rejected.done"
holds "a live attempt is left alone" test -f "$PDIR/phases/two.running"
denies "and gets no result" test -f "$d2/result.json"
holds "an orphan with no lease is closed too" grep -q '"outcome":"crashed"' "$d3/result.json"
printf '' > "$PDIR/phases/gate.running"
sweep_stale testproj "$PDIR" > "$T/out" 2>&1
denies "a lease from before leases named their attempt is cleared" test -f "$PDIR/phases/gate.running"
rm -f "$PDIR/phases/two.running"; rm -rf "$BRAIN/.runs"

section "run record — a role and a playbook that live in an app"
reset; rm -rf "$BRAIN/.runs"
A="$SYS/apps/fx"; mkdir -p "$A/roles" "$A/playbooks/appbook" "$A/skills/fx-skill"
printf '# Role: fx-writer\nSkills: fx-skill\n' > "$A/roles/fx-writer.md"; printf 'fx-writer  claude  default\n' > "$A/roles.conf"
printf 'one  fx-writer\n' > "$A/playbooks/appbook/phases"; printf '# Playbook: appbook\n' > "$A/playbooks/appbook/playbook.md"
printf -- '---\nname: fx-skill\n---\n' > "$A/skills/fx-skill/SKILL.md"
app_begin() { printf 'p\n' | BRAIN_LAUNCHER=$$ BRAIN_ROLE_FILE="$A/roles/fx-writer.md" BRAIN_PLAYBOOK_DIR="$A/playbooks/appbook" bash "$BRAIN/bin/run-record.sh" begin "$BRAIN" "$PDIR" "$T" testproj appbook one fx-writer claude default '' work 0 3 v1 ''; }
d="$(app_begin 2>"$T/err")"
holds "begin finds the app's role where the launcher says it is" test -f "$d/role.md"
holds "and records the app's playbook and roles.conf as inputs" grep -q 'apps/fx/playbooks/appbook/phases' "$d/context.json"
holds "its roles.conf too" grep -q 'apps/fx/roles.conf' "$d/context.json"
holds "and fingerprints the app's skill" grep -q '"name":"fx-skill","scope":"declared, not observed invocation","sha256":"[0-9a-f]' "$d/context.json"
denies "without the launcher's word, an app role is not found" bash -c "printf 'p\n' | bash '$BRAIN/bin/run-record.sh' begin '$BRAIN' '$PDIR' '$T' testproj appbook one fx-writer claude default '' work 0 3 v1 '' 2>/dev/null"
rm -rf "$A" "$BRAIN/.runs"

# ---- cmd_auto: the loop that runs unattended -------------------------------
# cmd_run is the thing that costs money and needs a sandbox, so it is scripted here.
# What is under test is which exit code auto returns, and whether it waits at a gate.
NOTES=""
notify() { NOTES="$NOTES|$1"; }
RUN_I=0; GATE_PHASE=""; SLEEPS=0
sleep() { # stands in for the gate poll, and approves on the second tick
  SLEEPS=$((SLEEPS + 1))
  if [ "$SLEEPS" -ge 2 ] && [ -n "$GATE_PHASE" ]; then touch "$PDIR/phases/$GATE_PHASE.done"; fi
  return 0
}
cmd_run() {
  local act="${SCRIPTED[$RUN_I]:-unscripted}"; RUN_I=$((RUN_I + 1))
  RUN_STATUS=""
  case "$act" in
    done:*)  touch "$PDIR/phases/${act#done:}.done"; return 0 ;;
    gate)    RUN_STATUS="gate"; return 0 ;;
    timeout) RUN_STATUS="timeout"; return 3 ;;
    notdone) return 0 ;;
    *)       echo "  ! cmd_run called more times than scripted"; return 1 ;;
  esac
}
run_auto() { # resets the fixture, then runs cmd_auto and echoes its exit code
  reset; RUN_I=0; SLEEPS=0; NOTES=""
  cmd_auto >/dev/null 2>&1
  echo $?
}

section "cmd_auto — one exit code per outcome"
SCRIPTED=(done:one done:two done:gate done:three)
is "$(run_auto)" "0" "playbook complete"
SCRIPTED=(notdone)
is "$(run_auto)" "2" "a phase came back not marked done"
SCRIPTED=(timeout)
is "$(run_auto)" "3" "a phase timed out"
MAX_RUNS=2; SCRIPTED=(done:one done:two done:gate done:three)
is "$(run_auto)" "3" "run ceiling reached"
MAX_RUNS=50

section "cmd_auto — a human gate waits instead of exiting"
GATE_PHASE="gate"
SCRIPTED=(done:one done:two gate done:three)
is "$(run_auto)" "0" "waits at the gate, then finishes once it is approved"
# and the same, when the verdict is a rejection rather than an approval
GATE_PHASE=""
sleep() { SLEEPS=$((SLEEPS + 1)); if [ "$SLEEPS" -ge 2 ]; then echo "RESULT: FAIL" > "$PDIR/phases/gate.md"; fi; return 0; }
SCRIPTED=(done:one done:two gate done:gate done:three)
is "$(run_auto)" "0" "a rejection also ends the wait"

section "cmd_auto — it says so, for whoever is not at the terminal"
sleep() { return 0; }
SCRIPTED=(done:one done:two done:gate done:three)
run_auto >/dev/null
case "$NOTES" in *"finished the testbook playbook"*) ok ;; *) bad "no completion notice: '$NOTES'" ;; esac
SCRIPTED=(notdone); run_auto >/dev/null
case "$NOTES" in *"came back not done"*) ok ;; *) bad "no stop notice: '$NOTES'" ;; esac

section "brain watch — the run cap"
MEM="$T/mem"; mkdir -p "$MEM/projects"
mkproj() { mkdir -p "$MEM/projects/$1/phases" "$T/dev/$1"; printf 'PLAYBOOK=testbook\nPROJECT_DIR=%s\n' "$T/dev/$1" > "$MEM/projects/$1/project.env"; }
for p in a b c d; do mkproj "$p"; done
LAUNCHED=""; terminal() { LAUNCHED="$LAUNCHED $(basename "$1")"; }
info() { :; }
MAX_PARALLEL=2
for p in a b c d; do echo auto > "$MEM/projects/$p/.run-request"; done
watch_runs
is "$LAUNCHED" " a b" "two start"
is "$QUEUED" "2" "two wait"
holds "a waiting request stays where it is" test -f "$MEM/projects/c/.run-request"
is "$(running_projects)" "2" "a fresh launch counts before its lease appears"
LAUNCHED=""; watch_runs
is "$LAUNCHED" "" "nothing more while the slots are taken"
rm -f "$MEM/projects/a/.launching"; touch "$MEM/projects/b/phases/one.running"
is "$(running_projects)" "1" "a lease counts; a launch marker without one is dropped"
watch_runs
is "$LAUNCHED" " c" "one slot freed, one started"
MAX_PARALLEL=0; LAUNCHED=""; watch_runs
is "$LAUNCHED" " d" "0 is no cap"
echo "rm -rf" > "$MEM/projects/a/.run-request"; LAUNCHED=""; watch_runs
is "$LAUNCHED" "" "only run and auto are commands"
denies "and the bad request is dropped" test -f "$MEM/projects/a/.run-request"
echo run > "$MEM/projects/b/.run-request"; LAUNCHED=""; watch_runs
is "$LAUNCHED" "" "a project with a phase in a sandbox is not started twice"
denies "and that request is dropped too" test -f "$MEM/projects/b/.run-request"
echo $$ > "$MEM/projects/a/.waiting"; echo auto > "$MEM/projects/a/.run-request"; LAUNCHED=""; watch_runs
is "$LAUNCHED" "" "a brain auto waiting at its gate is not started twice"
denies "and the request is dropped, since that one carries on" test -f "$MEM/projects/a/.run-request"
echo 999999 > "$MEM/projects/a/.waiting"; echo auto > "$MEM/projects/a/.run-request"; LAUNCHED=""; watch_runs
is "$LAUNCHED" " a" "a waiting marker left by a dead launcher does not block"

section "brain watch — projects the cockpit staged"
cmd_new() { echo "$*" > "$T/new-args"; mkdir -p "$MEM/projects/$2/phases"; printf 'PLAYBOOK=%s\nPROJECT_DIR=%s\n' "$1" "$T/dev/$2" > "$MEM/projects/$2/project.env"; echo template > "$MEM/projects/$2/brief.md"; }
mkdir -p "$SYS/playbooks/testbook" "$MEM/.new/fresh"
printf 'testbook fresh acme\n' > "$MEM/.new/fresh/request"; echo filled > "$MEM/.new/fresh/brief.md"; echo auto > "$MEM/.new/fresh/then"
rm -f "$T/new-args"; watch_new
is "$(cat "$T/new-args")" "testbook fresh --client acme" "brain new, with the client, nothing asked"
is "$(cat "$MEM/projects/fresh/brief.md")" "filled" "the brief the human filled in replaces the template"
is "$(cat "$MEM/projects/fresh/.run-request")" "auto" "and the run it asked for is queued"
denies "the staging folder is gone" test -d "$MEM/.new/fresh"
mkdir -p "$MEM/.new/quiet"; printf 'testbook quiet\n' > "$MEM/.new/quiet/request"; watch_new
holds "no then, no run request, nothing asked" test -f "$MEM/projects/quiet/project.env"
denies "and no run request" test -f "$MEM/projects/quiet/.run-request"
denies "and its staging folder is gone too" test -d "$MEM/.new/quiet"
mkdir -p "$MEM/.new/bad"; printf 'testbook other\n' > "$MEM/.new/bad/request"; rm -f "$T/new-args"; watch_new
holds "a request whose slug is not its folder is refused" test -f "$MEM/.new/bad/error"
mkdir -p "$MEM/.new/evil"; printf 'testbook evil; rm -rf /\n' > "$MEM/.new/evil/request"; watch_new
holds "a slug that is not a slug is refused" test -f "$MEM/.new/evil/error"
mkdir -p "$MEM/.new/nobook"; printf 'nosuch nobook\n' > "$MEM/.new/nobook/request"; watch_new
holds "an unknown playbook is refused" test -f "$MEM/.new/nobook/error"
denies "none of those reached brain new" test -f "$T/new-args"
cmd_new() { echo "brain: boom" >&2; return 1; }
mkdir -p "$MEM/.new/boom"; printf 'testbook boom\n' > "$MEM/.new/boom/request"; watch_new
is "$(cat "$MEM/.new/boom/error")" "brain: boom" "a refusal is kept for the cockpit to show"
cmd_new() { echo retried > "$T/new-args"; }; watch_new
denies "and not retried every tick" test -f "$T/new-args"

section "brain watch — files the form uploaded move in with the project"
cmd_new() { mkdir -p "$MEM/projects/$2/phases"; printf 'PLAYBOOK=%s\nPROJECT_DIR=%s\n' "$1" "$T/dev/$2" > "$MEM/projects/$2/project.env"; }
mkdir -p "$MEM/.new/withfiles/sources"; printf 'testbook withfiles\n' > "$MEM/.new/withfiles/request"
echo pdf > "$MEM/.new/withfiles/sources/2026-10-02-brief.pdf"; echo b > "$MEM/.new/withfiles/brief.md"
watch_new
is "$(cat "$MEM/projects/withfiles/sources/2026-10-02-brief.pdf" 2>/dev/null)" "pdf" "the upload is in the project's sources"
denies "and the staging folder is gone" test -d "$MEM/.new/withfiles"

section "brain playbook check — the inputs file"
IP="$T/pb-inputs"; mkdir -p "$IP"
printf '# Brief\n\n## Primary keyword\n\n## Language\n' > "$IP/brief.md"
printf '# input type per need label\nkeyword  text  project  yes  Primary keyword\nlang  choice:en,de  project  no  Language\ncompetitors  urls  client  no  Competitors we beat\n' > "$IP/inputs"
is "$(check_inputs "$IP")" "" "a clean file says nothing"
holds "and passes" check_inputs "$IP"
printf 'a text project yes\nB text project yes Bee\nc colour project yes Cee\nd choice:x project yes Dee\ne url team maybe Eee\nf text project no Eee\ng url:x project no Gee # note\nc text project no Cee two\n' > "$IP/inputs"
OUT="$(check_inputs "$IP")"
denies "a broken file fails the check" check_inputs "$IP"
for want in "needs five columns" "not a usable input name" "type 'colour'" "at least two options" "per is 'project' or 'client'" "need is 'yes' or 'no'" "used twice" "only a choice takes options" "'#' in the label" "appears twice"; do
  case "$OUT" in *"$want"*) ok ;; *) bad "check_inputs does not say: $want" ;; esac
done
printf 'keyword  text  project  yes  Missing heading\n' > "$IP/inputs"
case "$(check_inputs "$IP")" in "note inputs:1 input 'keyword' has no '## Missing heading' heading"*) ok ;; *) bad "a per-project input without its brief heading is a note: '$(check_inputs "$IP")'" ;; esac
holds "and only a note" check_inputs "$IP"

echo
[ "$FAIL" -eq 0 ] && echo "✓ $PASS passed" || echo "✗ $FAIL failed, $PASS passed"
exit $((FAIL > 0))
