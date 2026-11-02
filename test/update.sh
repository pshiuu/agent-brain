#!/usr/bin/env bash
# brain update: what the base's upstream has that this brain does not (memory/.base-update,
# the cockpit's banner), and the update itself keeping this brain's own system/ changes.
#
#   ./test/update.sh

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
fake_brain
# The brain under test is a clone in $T, so git on it is allowed here.
UP="$T/upstream"; BRAIN="$T/brain"; SYS="$BRAIN/system"
git() { command git "$@"; }
mkdir -p "$UP/system" && printf 'v1\n' > "$UP/system/BRAIN.md"
git -C "$UP" init -q -b main && git -C "$UP" add -A && git -C "$UP" commit -qm "the base"
git clone -q "$UP" "$BRAIN"
printf '#!/bin/sh\n' > "$BRAIN/install.sh"; chmod +x "$BRAIN/install.sh"
git -C "$BRAIN" add install.sh && git -C "$BRAIN" commit -qm "a quiet install.sh"

section "check"
base_check >/dev/null 2>&1
is "$(grep -vc '^#' "$MEM/.base-update")" "0" "nothing to come when the clone is current"
printf 'v2\n' > "$UP/system/BRAIN.md"; git -C "$UP" commit -qam "BRAIN.md: v2"
base_check >/dev/null 2>&1
is "$(grep -v '^#' "$MEM/.base-update" | cut -f2)" "BRAIN.md: v2" "one line per upstream commit, its subject"
has "$(head -1 "$MEM/.base-update")" "$(git -C "$UP" rev-parse HEAD)" "the header names the upstream commit"
has "$(cmd_update --check 2>&1)" "BRAIN.md: v2" "brain update --check lists it"

section "update"
mkdir -p "$MEM/projects/p/phases"; : > "$MEM/projects/p/phases/draft.running"; sleep 0
no "refused while a phase runs" cmd_update
rm -rf "$MEM/projects/p"
printf 'mine\n' > "$SYS/roles.md"; git -C "$BRAIN" add system/roles.md; git -C "$BRAIN" commit -qm "a role"; printf 'mine, evolved\n' > "$SYS/roles.md"
( cmd_update ) >/dev/null 2>&1
is "$(cat "$SYS/BRAIN.md")" "v2" "the upstream change arrives"
is "$(cat "$SYS/roles.md")" "mine, evolved" "this brain's uncommitted system/ change is kept"
has "$(git -C "$BRAIN" log --format=%s)" "this brain's own changes to system/" "committed before the pull"
is "$(grep -vc '^#' "$MEM/.base-update")" "0" "and the banner's file says current again"
printf 'x\n' > "$BRAIN/stray"; git -C "$BRAIN" add stray; git -C "$BRAIN" commit -qm stray; printf 'y\n' > "$BRAIN/stray"
no "an uncommitted change outside system/ still stops it" cmd_update

finish
