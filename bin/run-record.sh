#!/usr/bin/env bash
# Host records using the launcher's existing Bash / awk / shasum / Git tools.
# JSON is an output format, never shell input. A NUL-delimited hash ledger allows
# finish to compare inputs without parsing JSON or evaluating filenames as code.
set -euo pipefail
umask 077
export LC_ALL=C
source "$(dirname "$0")/phase-contract.sh"

quote() {
  # The trailing sentinel preserves empty strings and every trailing newline.
  printf '%s.' "$1" | awk '
    function emit(s, i,c) {
      for (i=1; i<=length(s); i++) {
        c=substr(s,i,1)
        if (c=="\"") printf "\\\""
        else if (c=="\\") printf "\\\\"
        else if (c in controls) printf "%s", controls[c]
        else printf "%s", c
      }
    }
    BEGIN { printf "\""; for(i=1;i<32;i++) controls[sprintf("%c",i)]=sprintf("\\u%04x",i) }
    NR>1 { emit(previous); printf "\\n" }
    { previous=$0 }
    END { emit(substr(previous,1,length(previous)-1)); printf "\"" }
  '
}
sha() { shasum -a 256 | awk '{ print $1 }'; }
file_hash() { if [ -f "$1" ]; then sha < "$1"; else printf 'missing'; fi; }
nullable() { if [ "$1" = missing ] || [ -z "$1" ]; then printf null; else quote "$1"; fi; }
field() { quote "$1"; printf ':'; quote "$2"; printf ','; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
number() { [[ "$1" =~ ^(0|[1-9][0-9]*)$ ]] || { echo 'invalid numeric run setting' >&2; exit 1; }; }
slug() { case "$1" in ''|.|..|*[!a-zA-Z0-9_-]*) echo 'invalid run identifier' >&2; exit 1;; esac; }

include() { # append one input and its private comparison record
  local digest bytes=null
  digest="$(file_hash "$1")"
  [ "$digest" = missing ] || bytes="$(wc -c < "$1" | tr -d ' ')"
  printf '%s\0%s\0' "$1" "$digest" >> "$dir/inputs.nul"
  printf '%s{' "$sep"; sep=,
  field path "$1"; field reason "$2"
  printf '"sha256":'; nullable "$digest"; printf ',"bytes":%s}' "$bytes"
}

begin() {
  local brain="$1" pdir="$2" project_dir="$3" project="$4" playbook="$5" phase="$6" role="$7"
  local engine="$8" model="$9" effort="${10}" mode="${11}" timeout="${12}" max_fix="${13}" template="${14}" mcp="${15}"
  local sys="$brain/system" mem="$brain/memory" dir id path name sep= digest commit=missing dirty=missing fix_round=0
  local repo="$project_dir" repo_path=missing
  local contract="$brain/system/playbooks/$playbook/contracts/$phase" kind value
  slug "$project"; slug "$phase"; slug "$role"; slug "$playbook"
  number "$timeout"; number "$max_fix"
  [ -f "$sys/roles/$role.md" ] || { echo "missing role: $role" >&2; return 1; }
  contract_validate "$contract" >&2 || return 1
  mkdir -p "$brain/.runs/$project/$phase"
  dir="$(mktemp -d "$brain/.runs/$project/$phase/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")"
  id="${dir##*/}"
  # Which launcher holds this attempt, written before plan.json: a record with a plan, no
  # result and a dead launcher is one nobody will finish (brain: sweep_stale).
  [ -z "${BRAIN_LAUNCHER:-}" ] || printf '%s\n' "$BRAIN_LAUNCHER" > "$dir/launcher"
  cp "$sys/roles/$role.md" "$dir/role.md"
  if [ -f "$contract" ]; then
    cp "$contract" "$dir/contract"
    contract_validate "$dir/contract" >&2 || return 1
  fi
  cat > "$dir/prompt.md"
  # The phase's own files as this attempt found them, mtimes kept: the defect rules
  # compare against the previous round, and an attempt the host rejects is rolled back
  # to exactly this state.
  [ ! -f "$pdir/phases/$phase.md" ] || cp -p "$pdir/phases/$phase.md" "$dir/previous-summary.md"
  [ ! -f "$pdir/phases/$phase.log" ] || cp -p "$pdir/phases/$phase.log" "$dir/previous.log"
  : > "$dir/inputs.nul"
  {
    printf '{"kind":"declared input inventory; not a transcript or frozen filesystem","inputs":['
    include "$sys/roles/$role.md" role
    for name in BRAIN.md roles.conf brain.conf sandbox.conf skills.list skills.lock; do include "$sys/$name" instructions/configuration; done
    for name in phases playbook.md playbook.env; do include "$sys/playbooks/$playbook/$name" playbook; done
    include "$contract" 'phase contract'
    if [ -f "$dir/contract" ]; then
      while read -r kind value || [ -n "$kind$value" ]; do
        [ "$kind" = input ] || continue
        path="$(contract_path "$value" "$project_dir" "$pdir")" || continue
        include "$path" 'required contract input'
      done < "$dir/contract"
    fi
    for name in index.md preferences.md; do include "$mem/$name" 'session instructions'; done
    for name in brief.md decisions.md project.env; do include "$pdir/$name" project; done
    for path in "$pdir/phases/"*.md "$pdir/phases/"*.fixed; do
      [ ! -f "$path" ] || include "$path" 'phase handoff'
    done
    if [ -d "$pdir/sources" ]; then
      while IFS= read -r -d '' path; do include "$path" 'available project source; reading not proven'; done < <(find "$pdir/sources" -type f -print0)
    fi
    printf '],"skills":['; sep=
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      printf '%s{' "$sep"; sep=,
      field name "$name"; field scope 'declared, not observed invocation'
      # Fingerprint available local skill files, in shell glob order. External
      # skills remain explicitly unresolved; do not substitute the host store.
      local skill_hash=missing
      if [[ "$name" != *[!a-zA-Z0-9_-]* ]] && [ -d "$sys/skills/$name" ]; then
        skill_hash="$(skill_files "$sys/skills/$name" "$sys/skills/$name" | sha)"
      fi
      printf '"sha256":'; nullable "$skill_hash"
      printf ',"unresolved":'; if [ "$skill_hash" = missing ]; then printf true; else printf false; fi
      printf '}'
    done < <(sed -n 's/^Skills:[[:space:]]*//p' "$dir/role.md" | head -1 | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    printf '],"omissions":["On-demand knowledge, client profiles and external skills are not resolved.","Ignored project files, effective sandbox policy and actual model behind aliases are not captured."]}\n'
  } > "$dir/context.json"
  # A workspace that is not a repo itself keeps its code repo one level down
  # (redesign-website: only the site folder is committed).
  # ponytail: first nested repo wins; name the repo in project.env if a workspace ever holds two.
  if [ ! -e "$project_dir/.git" ]; then
    for path in "$project_dir"/*/.git; do [ -e "$path" ] && { repo="${path%/.git}"; break; }; done
  fi
  if git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    repo_path="$repo"
    commit="$(git -C "$repo" rev-parse --verify HEAD 2>/dev/null || printf missing)"
    # Hash each component, including staged files before the first commit.
    # Keep NUL delimiters in a pipe: shell variables cannot preserve them.
    dirty="$( {
      git -C "$repo" status --porcelain=v1 -z --untracked-files=all | sha
      git -C "$repo" diff --binary -- | sha
      git -C "$repo" diff --cached --binary -- | sha
      while IFS= read -r -d '' path; do
        printf '%s\0' "$path"
        if [ -L "$repo/$path" ]; then readlink "$repo/$path" | sha
        else file_hash "$repo/$path"; fi
        printf '\0'
      done < <(git -C "$repo" ls-files --others --exclude-standard -z)
    } | sha )"
  fi
  [ ! -f "$pdir/phases/$phase.log" ] || fix_round="$(fail_rounds "$pdir/phases/$phase.log")"
  {
    printf '{"schema":1,'
    field run_id "$id"; field attempt_id "$id"; field started "$(now)"
    field project "$project"; field playbook "$playbook"; field phase "$phase"; field role "$role"; field mode "$mode"
    printf '"fix_round":%s,' "$fix_round"
    field engine "$engine"; field requested_model "$model"; field requested_effort "${effort:-default}"
    printf '"resolved_model":null,"git":{"repo":'; nullable "$repo_path"
    printf ',"commit":'; nullable "$commit"
    printf ',"dirty_sha256":'; nullable "$dirty"; printf '},'
    field context_sha256 "$(file_hash "$dir/context.json")"; field role_sha256 "$(file_hash "$dir/role.md")"; field prompt_sha256 "$(file_hash "$dir/prompt.md")"
    printf '"contract_sha256":'; nullable "$(file_hash "$dir/contract")"; printf ','
    printf '"declared_sandbox":{'; field template "$template"; field mcp "$mcp"
    printf '"system":"read-only","memory":"read-write","project":"read-write","effective_policy_verified":false},'
    printf '"limits":{"timeout_seconds":%s,"max_fix_rounds":%s,"automatic_retries":0},' "$timeout" "$max_fix"
    printf '"expected_outputs":['
    if [ "$mode" = fix ]; then quote "$phase.fixed"
    else quote "$phase.md"; printf ','
      if [ "$mode" = review ]; then quote "$phase.log"; printf ','; quote "$phase.done on PASS"
      else quote "$phase.done"; fi
    fi
    if [ -f "$dir/contract" ]; then
      while read -r kind value || [ -n "$kind$value" ]; do
        case "$kind" in output|evidence) printf ','; quote "$value" ;; esac
      done < "$dir/contract"
    fi
    printf '],"verification_commands":['; sep=
    if [ -f "$dir/contract" ]; then
      local seconds command
      while read -r kind value || [ -n "$kind$value" ]; do
        [ "$kind" = check ] || continue
        read -r seconds command <<< "$value"
        printf '%s{' "$sep"; sep=,; field command "$command"
        printf '"timeout_seconds":%s}' "$seconds"
      done < "$dir/contract"
    fi
    printf '],"verification":"handoff plus optional snapshotted phase contract"}\n'
  } > "$dir/plan.json"
  printf '%s\n' "$dir"
}

skill_files() {
  local path
  for path in "$1/"* "$1/".[!.]* "$1/"..?*; do
    [ ! -L "$path" ] || continue
    if [ -d "$path" ]; then skill_files "$path" "$2"
    elif [ -f "$path" ]; then printf '%s\0%s\0' "${path#"$2/"}" "$(file_hash "$path")"; fi
  done
}

finish() {
  local dir="$1" pdir="$2" phase="$3" outcome="$4" code="${5:-}" ext path old digest sep= verdict model=missing
  slug "$phase"; [ -z "$code" ] || number "$code"
  [ -f "$dir/plan.json" ] && [ -f "$dir/inputs.nul" ] || return 1
  # Atomic claim: neither another finalizer nor a retry can overwrite evidence.
  mkdir "$dir/.finalizing" || return 1
  [ ! -e "$dir/result.json" ] || return 1
  for ext in md log fixed done; do
    path="$pdir/phases/$phase.$ext"
    [ ! -f "$dir/proposed.$ext" ] || path="$dir/proposed.$ext"
    # A crashed attempt is closed by a later launcher: the phase files are whatever came
    # after it, so only the markers it held back are its own.
    [ "$outcome" != crashed ] || [ "$path" = "$dir/proposed.$ext" ] || continue
    [ -f "$path" ] || continue
    if [ "$ext" = md ]; then cp "$path" "$dir/summary.md"
    else cp "$path" "$dir/handoff.$ext"; fi
  done
  verdict="$(sed -nE 's/^RESULT: (PASS|FAIL)[[:space:]]*$/\1/p' "$dir/summary.md" 2>/dev/null || true)"
  [ "$verdict" = PASS ] || [ "$verdict" = FAIL ] || verdict=missing
  # The sandbox's transcript receipt for this attempt, named by run id (write_runlog).
  # It is the only place the model behind an alias like "opus" is written down.
  path="$pdir/phases/$phase.runs/${dir##*/}.json"
  if [ -f "$path" ]; then
    cp "$path" "$dir/transcript.json"
    model="$(sed -nE 's/^[[:space:]]*"model":[[:space:]]*"([^"]*)".*/\1/p' "$dir/transcript.json" | head -1)"
  fi
  {
    printf '{"schema":1,'; field run_id "${dir##*/}"; field ended "$(now)"
    printf '"exit_code":%s,"resolved_model":' "${code:-null}"; nullable "$model"
    printf ',"agent_claim":{"verdict":'; nullable "$verdict"
    printf ',"outputs":['
    for path in "$dir/summary.md" "$dir/"handoff.*; do
      [ -f "$path" ] || continue
      printf '%s{' "$sep"; sep=,
      field path "${path##*/}"; printf '"sha256":'; quote "$(file_hash "$path")"; printf '}'
    done
    printf ']},"host_verdict":{'; field outcome "$outcome"
    printf '"scope":"handoff and declared mechanical checks; not human acceptance"},"evidence":['; sep=
    for path in "$dir/preflight.log" "$dir/defects.log" "$dir/verification.log" "$dir/evidence/"*; do
      [ -f "$path" ] || continue
      printf '%s{' "$sep"; sep=,
      field path "${path#"$dir/"}"; printf '"sha256":'; quote "$(file_hash "$path")"; printf '}'
    done
    printf '],"changed_inputs":['; sep=
    while IFS= read -r -d '' path && IFS= read -r -d '' old; do
      digest="$(file_hash "$path")"
      if [ "$digest" != "$old" ]; then printf '%s' "$sep"; sep=,; quote "$path"; fi
    done < "$dir/inputs.nul"
    printf ']}\n'
  } > "$dir/.finalizing/result.json"
  mv "$dir/.finalizing/result.json" "$dir/result.json"
}

# A human verdict is a transition too: approve, reject and reopen each leave one
# write-once record beside the agent attempts, so every change of phase state has one.
# stdin: one "<kind> <value>" line each — item (feedback), waived|deferred|verified (a
# defect id), reopened (a phase whose .done this verdict took back).
human() { # brain pdir project playbook phase outcome -> prints the record dir
  local brain="$1" pdir="$2" project="$3" playbook="$4" phase="$5" outcome="$6" dir id kind value k sep
  slug "$project"; slug "$playbook"; slug "$phase"
  case "$outcome" in approved|rejected|reopened) ;; *) echo 'invalid human outcome' >&2; return 1 ;; esac
  mkdir -p "$brain/.runs/$project/$phase"
  dir="$(mktemp -d "$brain/.runs/$project/$phase/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")"
  id="${dir##*/}"
  cat > "$dir/verdict.txt"
  [ ! -f "$pdir/phases/$phase.md" ] || cp "$pdir/phases/$phase.md" "$dir/summary.md"
  [ ! -f "$pdir/phases/$phase.log" ] || cp "$pdir/phases/$phase.log" "$dir/handoff.log"
  {
    printf '{"schema":1,'; field run_id "$id"; field attempt_id "$id"; field started "$(now)"
    field actor human; field project "$project"; field playbook "$playbook"; field phase "$phase"
    printf '"mode":"verdict"}\n'
  } > "$dir/plan.json"
  list() { # kind -> JSON array of that kind's values
    printf '['; sep=
    while read -r k value || [ -n "$k" ]; do
      [ "$k" = "$1" ] || continue
      printf '%s' "$sep"; sep=,; quote "$value"
    done < "$dir/verdict.txt"
    printf ']'
  }
  {
    printf '{"schema":1,'; field run_id "$id"; field ended "$(now)"; field actor human
    printf '"exit_code":null,"host_verdict":{'; field outcome "$outcome"
    printf '"scope":"a human verdict; the host records it and checks nothing"},"items":'; list item
    printf ',"defects":{"waived":'; list waived; printf ',"deferred":'; list deferred; printf ',"verified":'; list verified
    printf '},"reopened":'; list reopened; printf '}\n'
  } > "$dir/result.json"
  printf '%s\n' "$dir"
}

case "${1:-}" in
  begin) shift; begin "$@" ;;
  finish) shift; finish "$@" ;;
  human) shift; human "$@" ;;
  *) echo 'usage: bash run-record.sh begin|finish|human ...' >&2; exit 1 ;;
esac
