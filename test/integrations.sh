#!/usr/bin/env bash
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
fake_brain
PROJECT=example; PDIR="$MEM/projects/example"; mkdir -p "$PDIR"
section "optional integration preflight"
INTEGRATIONS=''
yes "unlinked projects need no app" project_integrations_check
mkdir -p "$SYS/apps/task-sync"
printf 'name task-sync\nversion 1\nbrain >= 2\n' > "$SYS/apps/task-sync/app.conf"
cat > "$SYS/apps/task-sync/cli.sh" <<'EOF'
cmd_task-sync() { :; }
task-sync_project_check() { echo "$1" > "$MEM/checked"; [ ! -f "$MEM/refuse" ]; }
EOF
INTEGRATIONS=task-sync
project_integrations_check >/dev/null
is "$(cat "$MEM/checked")" example "the installed provider receives the project identity"
touch "$MEM/refuse"
no "a provider conflict blocks launch" project_integrations_check
INTEGRATIONS=missing
no "removing a linked provider fails closed" project_integrations_check
INTEGRATIONS='../bad'
no "integration names cannot traverse paths" project_integrations_check
finish
