# Host-side handoff rules, sourced by brain and run-record.sh. No new runtime.
# Optional playbook contracts:
#   input|output|evidence <project|memory>:<relative file>
#   check <seconds, 1..86400> <shell command run inside the sandbox>
# Structured defects, a `## Defects` block in a review summary (BRAIN.md):
#   - <phase>.<slug> <OPEN|VERIFIED|WAIVED|DEFERRED> [free text, optional "escaped: <phase>"]

contract_validate() { # file; diagnostics on stdout
  local file="$1" kind value seconds command line=0 bad=0
  [ -f "$file" ] || return 0
  while read -r kind value || [ -n "$kind$value" ]; do
    line=$((line + 1))
    case "$kind" in ''|'#'*) continue ;; esac
    case "$kind" in
      input|output|evidence)
        case "$value" in project:*|memory:*) ;; *) echo "err  $file:$line: use project: or memory: before a relative file"; bad=1; continue ;; esac
        local rel="${value#*:}"
        case "/$rel/" in *'//'*|*'/../'*|*'/./'*) echo "err  $file:$line: empty, absolute or traversing file path"; bad=1 ;; esac
        ;;
      check)
        read -r seconds command <<< "$value"
        if ! [[ "$seconds" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$seconds" -gt 86400 ] || [ -z "$command" ]; then
          echo "err  $file:$line: check needs seconds (1..86400) and a command"; bad=1
        fi
        ;;
      *) echo "err  $file:$line: unknown contract directive '$kind'"; bad=1 ;;
    esac
  done < "$file"
  return "$bad"
}

contract_path() { # reference project-root project-memory -> literal path, no symlinks
  local ref="$1" root rel part path
  case "$ref" in project:*) root="$2" ;; memory:*) root="$3" ;; *) return 1 ;; esac
  rel="${ref#*:}"
  case "/$rel/" in *'//'*|*'/../'*|*'/./'*) return 1 ;; esac
  path="$root"
  while [ -n "$rel" ]; do
    part="${rel%%/*}"; path="$path/$part"
    [ ! -L "$path" ] || return 1
    if [ "$rel" = "$part" ]; then break; fi
    rel="${rel#*/}"
  done
  printf '%s\n' "$path"
}

contract_inputs() { # snapshot project-root project-memory; return 1 before launch on missing input
  local file="$1" project_dir="$2" pdir="$3" kind value path bad=0
  [ -f "$file" ] || return 0
  while read -r kind value || [ -n "$kind$value" ]; do
    [ "$kind" = input ] || continue
    if ! path="$(contract_path "$value" "$project_dir" "$pdir")" || [ ! -s "$path" ] || [ ! -f "$path" ]; then
      printf 'Missing, empty or unsafe input: %s\n' "$value"; bad=1
    fi
  done < "$file"
  return "$bad"
}

contract_verify() { # snapshot project-root project-memory sandbox run-dir freshness-marker
  local file="$1" project_dir="$2" pdir="$3" sandbox="$4" record="$5" since="$6"
  local kind value seconds command path n=0 rc bad=0
  [ -f "$file" ] || return 0
  mkdir -p "$record/evidence" || return 1
  while read -r kind value || [ -n "$kind$value" ]; do
    [ "$kind" = check ] || continue
    read -r seconds command <<< "$value"; n=$((n + 1)); rc=0
    printf '%s\n' "$command" > "$record/evidence/check-$n.command" || return 1
    # The shell code comes only from the pre-run snapshot of a human-maintained
    # system contract. Never execute it on the host or read an agent-written script
    # as the contract. Project scripts it invokes remain untrusted sandbox code.
    sbx exec "$sandbox" -- timeout -k 5 "$seconds" sh -c 'cd "$1" && exec sh -c "$2"' _ "$project_dir" "$command" \
      < /dev/null > "$record/evidence/check-$n.log" 2>&1 || rc=$?
    printf '%s\n' "$rc" > "$record/evidence/check-$n.exit" || return 1
    if [ "$rc" -ne 0 ]; then
      printf 'Check %s failed (exit %s): %s\n' "$n" "$rc" "$command"; bad=1
      break
    fi
  done < "$file"
  # Checks may produce artifacts themselves; verify files after the commands.
  n=0
  while read -r kind value || [ -n "$kind$value" ]; do
    case "$kind" in output|evidence) ;; *) continue ;; esac
    if ! path="$(contract_path "$value" "$project_dir" "$pdir")" || [ ! -s "$path" ] || [ ! -f "$path" ]; then
      printf 'Missing, empty or unsafe %s: %s\n' "$kind" "$value"; bad=1; continue
    fi
    if [ "$kind" = evidence ] && [ ! "$path" -nt "$since" ]; then
      printf 'Evidence is stale for this attempt: %s\n' "$value"; bad=1; continue
    fi
    n=$((n + 1))
    # The location -> hash mapping and the evidence bytes outlive the next run.
    printf '%s\n' "$value" > "$record/evidence/artifact-$n.path" || return 1
    shasum -a 256 < "$path" | awk '{print $1}' > "$record/evidence/artifact-$n.sha256" || return 1
    if [ "$kind" = evidence ]; then cp "$path" "$record/evidence/artifact-$n.data" || return 1; fi
  done < "$file"
  return "$bad"
}

# ---- rounds and defects ----------------------------------------------------
# One rule for "how many times has this review failed", used by the fix-round ceiling,
# the run record and (mirrored) the cockpit. Only the host's own line format counts, so a
# summary quoting FAIL, or a log line with prose after it, is not a round.
fail_rounds() { # phase.log -> number of FAIL rounds
  awk '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] FAIL[[:space:]]*$/ { n++ } END { print n + 0 }' "$1" 2>/dev/null || echo 0
}

open_rounds() { # phase.log -> FAIL rounds since the last PASS, what the fix limit counts
  # A PASS ends a review; a reopen starts a new one, so rounds before it are not this one's.
  awk '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] FAIL[[:space:]]*$/ { n++ }
       /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] PASS[[:space:]]*$/ { n = 0 } END { print n + 0 }' "$1" 2>/dev/null || echo 0
}

defects_has() { [ -f "$1" ] && grep -Eq '^## Defects[[:space:]]*$' "$1"; }

defects_block() { # summary -> the "- " lines of its ## Defects block, verbatim
  [ -f "$1" ] || return 0
  awk '/^## / { on = ($0 ~ /^## Defects[[:space:]]*$/); next } on && /^- /' "$1"
}

defects_ids() { # summary [state] -> ids, one per line
  defects_block "$1" | awk -v want="${2:-}" 'want == "" || $3 == want { print $2 }'
}

# Every id-shaped word in a file: how a fix handoff or an approval names a defect.
# Punctuation around an id ("qa.x," "(qa.x)" "qa.x.") is not part of it.
defect_words() { # file -> words, one per line
  [ -f "$1" ] || return 0
  tr -cs 'a-z0-9.-' '\n' < "$1" | sed 's/\.*$//'
}

# The rules the host holds a review or fix handoff to, checked after the agent exits —
# never from phase_finished, which the watcher polls: a bad block there would keep the
# sandbox open until the timeout instead of failing the attempt. They apply once either
# this summary or the one before it has a block, so an old summary still passes and a
# new one cannot drop the block to lose the previous round's findings.
defects_verify() { # phase mode summary previous-summary fixed-file -> problems on stdout; 1 when any
  local phase="$1" mode="$2" md="$3" prev="$4" fixed="$5" bad=0 dash id st rest seen=" " verdict open id_re
  defects_has "$md" || defects_has "$prev" || return 0
  if [ "$mode" = fix ]; then
    # The fixer answers the reviewer's list: every OPEN id is named in .fixed.
    while read -r id; do
      defect_words "$fixed" | grep -qxF "$id" || { echo "The fix handoff does not name open defect $id"; bad=1; }
    done < <(defects_ids "$md" OPEN)
    return "$bad"
  fi
  defects_has "$md" || { echo "The summary has no ## Defects block, but the previous round had one"; return 1; }
  id_re='^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$'
  while read -r dash id st rest; do
    if ! [[ "$id" =~ $id_re ]]; then echo "Defect line with a malformed id: - $id $st"; bad=1; continue; fi
    case "$st" in OPEN|VERIFIED|WAIVED|DEFERRED) ;; *) echo "Defect $id has state '$st'; use OPEN, VERIFIED, WAIVED or DEFERRED"; bad=1 ;; esac
    [ "${id%%.*}" = "$phase" ] || { echo "Defect $id belongs to phase '${id%%.*}', not '$phase'"; bad=1; }
    case "$seen" in *" $id "*) echo "Defect $id is listed twice"; bad=1 ;; esac
    seen="$seen$id "
  done < <(defects_block "$md")
  verdict="$(sed -nE 's/^RESULT: (PASS|FAIL)[[:space:]]*$/\1/p' "$md")"
  open="$(defects_ids "$md" OPEN | wc -l | tr -d ' ')"
  if [ "$verdict" = FAIL ] && [ "$open" -eq 0 ]; then echo "RESULT: FAIL with no OPEN defect"; bad=1; fi
  if [ "$verdict" = PASS ] && [ "$open" -gt 0 ]; then echo "RESULT: PASS with $open OPEN defect(s): $(defects_ids "$md" OPEN | tr '\n' ' ')"; bad=1; fi
  while read -r id; do
    case "$seen" in *" $id "*) ;; *) echo "Open defect $id from the previous round is missing — mark it VERIFIED, OPEN, WAIVED or DEFERRED"; bad=1 ;; esac
  done < <(defects_ids "$prev" OPEN)
  return "$bad"
}

# ---- human verdicts --------------------------------------------------------
# One text for each verdict, whether it is typed at the terminal or clicked in the
# cockpit; ui/brain.mjs has the twins and test/fixtures/verdicts pins both to the same
# bytes. Approval keeps the summary, which is the next role's handoff input: it turns
# the verdict line into PASS and each OPEN defect into DEFERRED (when named), VERIFIED
# (when a fix round landed after the summary and names it), or WAIVED.
approve_summary() { # summary fixed-file date fix-landed(0|1) "deferred ids" -> approved summary
  { [ -f "$1" ] && cat "$1"; true; } | awk -v fixedf="$2" -v day="$3" -v since="$4" -v defer=" $5 " '
    BEGIN {
      if (since == 1) while ((getline l < fixedf) > 0) {
        gsub(/[^a-z0-9.-]+/, " ", l); m = split(l, w, " ")
        for (j = 1; j <= m; j++) { sub(/\.+$/, "", w[j]); named[w[j]] = 1 }
      }
    }
    { line[++n] = $0 }
    END {
      for (i = 1; i <= n; i++) if (line[i] ~ /^RESULT: (PASS|FAIL)[[:space:]]*$/) { line[i] = "RESULT: PASS"; has = 1 }
      on = 0
      for (i = 1; i <= n; i++) {
        l = line[i]
        if (l ~ /^## /) on = (l ~ /^## Defects[[:space:]]*$/)
        else if (on && l ~ /^- /) {
          split(l, f, " ")
          if (f[3] == "OPEN") {
            st = index(defer, " " f[2] " ") ? "DEFERRED" : (f[2] in named) ? "VERIFIED" : "WAIVED"
            sub(/ OPEN/, " " st, l); l = l " — human " day
          }
        }
        line[i] = l
      }
      while (n > 0 && line[n] ~ /^[[:space:]]*$/) n--
      if (n > 0) sub(/[[:space:]]+$/, "", line[n])
      if (!has) print "RESULT: PASS"
      for (i = 1; i <= n; i++) print line[i]
      print ""
      print "Approved by human on " day "."
    }'
}

# A rejection is a numbered list for the fixer to read, and the same items as OPEN
# defects so the fix handoff has to answer each one. Ids carry the round, because the
# next rejection's first item is a different defect from this one's.
reject_summary() { # phase round date item... -> the summary
  local phase="$1" round="$2" day="$3" i=0 item; shift 3
  echo "RESULT: FAIL"
  echo "Feedback from the human ($day):"
  for item in "$@"; do i=$((i + 1)); echo "$i. $item"; done
  echo
  echo "## Defects"
  i=0
  for item in "$@"; do i=$((i + 1)); echo "- $phase.r$round-$i OPEN — item $i"; done
}
