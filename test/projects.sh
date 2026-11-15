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
section "a project's end: archive, restore, delete"
rm -f "$MEM/projects/my-fix/.run-request"
SBX_RM=""; sbx() { case "$1" in ls) printf 'SANDBOX AGENT STATUS\nrel-claude claude stopped\nmy-fix-claude claude stopped\n' ;; rm) SBX_RM="$SBX_RM $3" ;; esac; }
printf 'claude a b c d\ncodex a b c d\n' > "$SYS/engines.conf"
: > "$MEM/projects/rel/phases/build.running"
has "$(project_archive rel)" "is running" "a running project is not archived"
rm "$MEM/projects/rel/phases/build.running"
project_archive rel >/dev/null
no "archived, it is no longer a project" test -e "$MEM/projects/rel"
yes "its record is in the archive" test -f "$MEM/projects/.archive/rel/project.env"
is "$SBX_RM" " rel-claude" "and its sandbox is removed, nobody else's"
is "$(names_in "$MEM/projects" | grep -c archive)" "0" "the archive is no project to any list"
project_restore rel >/dev/null
yes "restored, it is back" test -f "$MEM/projects/rel/project.env"
mkdir -p "$MEM/projects/rel"; has "$(project_archive nope)" "no project" "an unknown name is refused"

printf '# Mine\ntags: shared\nx\n\n## Sources\n- projects/rel/phases/build.md (2026-01-01)\n' > "$MEM/knowledge/mine.md"
printf '# Both\ntags: shared\nx\n\n## Sources\n- projects/rel/phases/build.md\n- projects/my-fix/phases/build.md\n' > "$MEM/knowledge/both.md"
printf '# Index\n\n## Knowledge\n\n### shared\n- [Mine](knowledge/mine.md) — x\n- [Both](knowledge/both.md) — x\n' > "$MEM/index.md"
is "$(project_pages rel)" "mine.md" "the pages only this project backs"
project_archive rel >/dev/null
echo "delete keep" > "$MEM/projects/.archive/rel/.end-request"; echo "restore now" > "$MEM/projects/my-fix/.end-request"
watch_ends >/dev/null 2>&1
no "the Studio's delete of an archived project removes it" test -e "$MEM/projects/.archive/rel"
yes "keep leaves its knowledge" test -f "$MEM/knowledge/mine.md"
has "$(cat "$MEM/projects/my-fix/.end-error")" "not something" "a request that is no verb is refused, with the reason left for the page"
yes "and its project is untouched" test -f "$MEM/projects/my-fix/project.env"
cmd_new build rel --dir "$T/elsewhere/folder-name" >/dev/null 2>&1
idea_project_deleted() { echo "$*" > "$T/hook"; }; kind_app() { [ "$1" = idea ] && echo idea; }; app_cli() { [ "$1" = idea ]; }
echo "KIND=idea" >> "$MEM/projects/rel/project.env"
has "$(project_delete rel all)" "mine.md" "delete all names the knowledge it took"
no "the page only it backed is gone" test -e "$MEM/knowledge/mine.md"
yes "a page another project backs too stays" test -f "$MEM/knowledge/both.md"
hasnt "$(cat "$MEM/index.md")" "mine.md" "and the index no longer lists the deleted page"
has "$(cat "$MEM/index.md")" "both.md" "but still the other"
yes "the code folder is never touched" test -d "$T/elsewhere/folder-name"
is "$(cat "$T/hook")" "rel $T/elsewhere/folder-name all" "the app that owns its kind is told, with the folder and the choice"
sbx() { return 0; }
finish
