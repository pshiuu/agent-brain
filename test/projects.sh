#!/usr/bin/env bash
# Which project a command acts on, when several share one code folder (a feature and a fix
# on one Frappe app), and the rule that keeps them from running in it at the same time.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
fake_brain
mkdir -p "$SYS/playbooks/build"
printf 'build  qa\n' > "$SYS/playbooks/build/phases"
printf '# Playbook: build\n> b\n\n## build\nBuild.\n' > "$SYS/playbooks/build/playbook.md"
commit_memory() { :; }
APP="$T/apps/my_app"; mkdir -p "$APP" "$T/elsewhere/folder-name"

section "brain new keeps the name it is given"
cmd_new build my-feature --dir "$APP" >/dev/null 2>&1
yes "the project is the name, not the folder" test -f "$MEM/projects/my-feature/project.env"
is "$(awk -F= '$1 == "PROJECT_DIR" { print $2 }' "$MEM/projects/my-feature/project.env")" "$APP" "with the folder it works in"
(cd "$T/elsewhere" && cmd_new build rel --dir folder-name >/dev/null 2>&1)
is "$(awk -F= '$1 == "PROJECT_DIR" { print $2 }' "$MEM/projects/rel/project.env")" "$T/elsewhere/folder-name" "a relative --dir is stored absolute"

section "a playbook links its projects to an app from the start"
printf 'INTEGRATIONS=github\n' > "$SYS/playbooks/build/playbook.env"
cmd_new build linked --dir "$T/linked" >/dev/null 2>&1
has "$(cat "$MEM/projects/linked/project.env")" "INTEGRATIONS=github" "playbook.env's INTEGRATIONS lands in project.env"
printf 'INTEGRATIONS="a; rm -rf x"\n' > "$SYS/playbooks/build/playbook.env"
cmd_new build odd --dir "$T/odd" >/dev/null 2>&1
hasnt "$(cat "$MEM/projects/odd/project.env")" "INTEGRATIONS" "a value that is not one app name is not copied"
rm "$SYS/playbooks/build/playbook.env"

section "finding the project from the folder"
is "$(cd "$APP" && project_name)" "my-feature" "the one project in a folder, whatever the folder is called"
is "$(cd "$T/elsewhere" && project_name)" "elsewhere" "a folder no project works in falls back to its own name"
cmd_new build my-fix --dir "$APP" >/dev/null 2>&1
pn_at() { cd "$1" && project_name; }
no "two projects in one folder: the folder alone does not decide" pn_at "$APP"
has "$(cd "$APP" && project_name 2>&1)" "BRAIN_PROJECT=<name>" "and it says how to choose"
is "$(cd "$APP" && BRAIN_PROJECT=my-fix project_name)" "my-fix" "BRAIN_PROJECT chooses"

section "one run per code folder"
: > "$MEM/projects/my-feature/.launching"
yes "a launch reservation holds the folder before its phase starts" shared_busy my-fix "$APP"
rm "$MEM/projects/my-feature/.launching"
no "nothing runs in the folder yet" shared_busy my-fix "$APP"
: > "$MEM/projects/my-feature/phases/build.running"
yes "the feature's phase holds the folder against the fix" shared_busy my-fix "$APP"
no "but not against itself" shared_busy my-feature "$APP"
no "nor against a project in another folder" shared_busy rel "$T/elsewhere/folder-name"
: > "$MEM/projects/my-fix/.run-request"; printf 'run\n' > "$MEM/projects/my-fix/.run-request"
terminal() { echo "$*" >> "$T/launched"; }; MAX_PARALLEL=0
watch_runs >/dev/null 2>&1
no "the Studio's run for the fix waits while the feature runs" test -s "$T/launched"
yes "and its request is kept for later" test -f "$MEM/projects/my-fix/.run-request"
rm "$MEM/projects/my-feature/phases/build.running"
watch_runs >/dev/null 2>&1
has "$(cat "$T/launched" 2>/dev/null)" "BRAIN_PROJECT=my-fix brain run" "once the folder is free it starts, naming its project"
finish
