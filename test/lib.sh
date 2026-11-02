# The brain's test harness, for the base's suites and for an app's own test/*.sh.
#
#   source "$BRAIN/test/lib.sh"      # BRAIN = the brain repo; an app test gets it from brain app test
#   fake_brain                       # a disposable system/ + memory/, launcher functions loaded
#   is "$got" "$want" "label"; has "$text" "needle" "label"; yes "label" cmd...; no "label" cmd...
#   finish                           # prints the count, exits non-zero on any failure
#
# The launcher is sourced with BRAIN_LIB=1, so it defines its functions and runs nothing.
# sbx is a function here that does nothing, so no test can reach a real sandbox; a suite
# that needs one to answer redefines it.

BRAIN="${BRAIN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRAIN_LIB=1 source "$BRAIN/bin/brain"
set +e
export BRAIN_NONINTERACTIVE=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }
is()  { [ "$1" = "$2" ] && ok || bad "$3: got '$1', wanted '$2'"; }
has() { case "$1" in *"$2"*) ok ;; *) bad "$3: no '$2' in: $1" ;; esac; }
hasnt() { case "$1" in *"$2"*) bad "$3: unexpected '$2' in: $1" ;; *) ok ;; esac; }
# In a subshell: a launcher function that fails calls die, and die exits.
yes() { local l="$1"; shift; ( "$@" ) >/dev/null 2>&1 && ok || bad "$l"; }
no()  { local l="$1"; shift; if ( "$@" ) >/dev/null 2>&1; then bad "$l"; else ok; fi; }
section() { echo; echo "$1"; }
finish() { echo; [ "$FAIL" -eq 0 ] && echo "✓ $PASS passed" || echo "✗ $FAIL failed, $PASS passed"; exit $((FAIL > 0)); }

sbx() { return 0; }
# A suite works on the fake brain under $T, never on the brain it runs from: git aimed at that
# one is refused, so a launcher function that still names $BRAIN fails the test instead of
# committing your memory or your system/.
git() {
  case " $* " in *" $BRAIN "*|*" $BRAIN/"*) echo "test/lib.sh: a test reached the real brain's git: git $*" >&2; return 1 ;; esac
  command git "$@"
}
notify() { :; }

fake_brain() { # -> T, SYS, MEM, DEV point at a fresh brain with one base role and no playbooks
  T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
  SYS="$T/system"; MEM="$T/memory"; DEV="$T/dev"
  mkdir -p "$SYS/roles" "$SYS/playbooks" "$SYS/skills" "$MEM/projects" "$MEM/knowledge" "$DEV"
  printf 'qa  claude  default\n' > "$SYS/roles.conf"
  printf '# Role: qa\n' > "$SYS/roles/qa.md"
}

fake_app() { # dir name [role] -> a minimal app that passes brain app check: one role, one playbook
  local d="$1" n="$2" r="${3:-$2-writer}"
  mkdir -p "$d/roles" "$d/playbooks/$n-book"
  printf 'name     %s\nlabel    %s\nversion  1.0.0\nbrain    >= %s\n' "$n" "$n" "$BRAIN_VERSION" > "$d/app.conf"
  printf '%s  claude  default\n' "$r" > "$d/roles.conf"
  printf '# Role: %s\n' "$r" > "$d/roles/$r.md"
  printf 'write  %s\nreview  qa  %s\n' "$r" "$r" > "$d/playbooks/$n-book/phases"
  printf '# Playbook: %s-book\n> A test playbook\n\n## write\nWrite.\n## review\nReview.\n' "$n" > "$d/playbooks/$n-book/playbook.md"
}
