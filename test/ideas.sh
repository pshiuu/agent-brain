#!/usr/bin/env bash
# brain idea without a sandbox: writing an idea down, what the Studio stages, promoting
# it to a playbook project and deleting it. The session itself needs sbx; `launch` is a
# stub here that records what it was handed.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
fake_brain
printf 'idea-partner  claude  opus  high\n' >> "$SYS/roles.conf"; printf '# Role: idea-partner\n' > "$SYS/roles/idea-partner.md"
commit_memory() { :; }
P="$MEM/projects"

section "an idea is written down under its first words"
idea_new "Custom firmware for the M-Wave FM1 synth" >/dev/null
N=custom-firmware-for-the-m-wave-fm1-synth
is "$IDEA_NAME" "$N" "the name"
has "$(cat "$P/$N/project.env")" "KIND=idea" "it is an idea, not a playbook project"
has "$(cat "$P/$N/brief.md")" "## Stack" "the brief has the stack its knowledge is tagged by"
is "$(idea_title "$P/$N")" "Custom firmware for the M-Wave FM1 synth" "its title is the idea's line"
yes "the living note is there" test -s "$P/$N/idea.md"
is "$(cat "$DEV/ideas/$N/.brain-idea")" "$N" "the scratch folder is marked as the idea's own"
has "$( (idea_new "Custom firmware for the M-Wave FM1 synth") 2>&1 )" "exists already" "the same idea twice is refused"
mkdir -p "$T/mine"; echo code > "$T/mine/main.c"
idea_new "port it" --name port --dir "$T/mine" >/dev/null
no "a folder that was there before is not marked" test -e "$T/mine/.brain-idea"
has "$(cd "$DEV/ideas/$N" && (load_project) 2>&1)" "use brain idea" "playbook commands point at brain idea"

section "brain idea: a name carries on, a sentence starts one, a bare word is a typo"
launch() { echo "$1|$5|${6:-}|$4" > "$T/launched"; }
role_cfg() { echo "claude opus high"; }
cmd_idea "$N" >/dev/null 2>&1
has "$(cat "$T/launched")" "claude|idea-partner|1|" "the session runs the idea's role and resumes the conversation"
has "$(cat "$T/launched")" "Idea memory: $P/$N" "and is told where the idea lives"
has "$(cat "$T/launched")" "Knowledge scope: shared" "and which knowledge it reads"
no "the running marker is gone when the session is" test -e "$P/$N/.idea-running"
printf '# x\n\n## Idea\nx\n\n## Stack\n- stm32\n' > "$P/$N/brief.md"
printf '# STM32\ntags: stm32\nx\n\n## Sources\n- projects/%s/idea.md (2026-01-01)\n' "$N" > "$MEM/knowledge/stm32-dfu.md"
cmd_idea open "$N" "the bootloader" --fresh >/dev/null 2>&1
has "$(cat "$T/launched")" "Knowledge scope: shared stm32" "a stack word that tags a page widens the scope"
has "$(cat "$T/launched")" "|idea-partner||" "--fresh starts a new conversation"
has "$(cat "$T/launched")" "brings to this session: the bootloader" "what the human brought is in the prompt"
has "$( (cmd_idea fm2) 2>&1 )" "no idea 'fm2'" "one word that names no idea creates nothing"
no "and nothing was created" test -e "$P/fm2"
cmd_idea "a sampler for the op-1" >/dev/null 2>&1
yes "a sentence is a new idea" test -f "$P/a-sampler-for-the-op-1/idea.md"

section "what the Studio stages"
mkdir -p "$MEM/.new/fresh-one"; printf 'A fresh one\nwith a second line\n' > "$MEM/.new/fresh-one/text.md"; : > "$MEM/.new/fresh-one/open.md"
echo "idea fresh-one" > "$MEM/.new/fresh-one/request"
watch_new >/dev/null 2>&1
no "the staged request is taken" test -e "$MEM/.new/fresh-one"
has "$(cat "$P/fresh-one/brief.md")" "with a second line" "the form's text is the idea"
is "$(cat "$P/fresh-one/.idea-request")" "open" "and it asked to start talking"
LAUNCHED=""; terminal() { LAUNCHED="$2"; }; MAX_PARALLEL=0; info() { :; }
idea_watch
is "$LAUNCHED" "brain idea open fresh-one" "the watcher opens the session in a Terminal"
no "and takes the request" test -e "$P/fresh-one/.idea-request"
mkdir -p "$DEV/started" "$T/outside"; echo code > "$DEV/started/main.c"
mkdir -p "$MEM/.new/in-a-folder"; echo "Go on with it" > "$MEM/.new/in-a-folder/text.md"; echo "$DEV/started" > "$MEM/.new/in-a-folder/dir.md"
idea_studio_new in-a-folder "$MEM/.new/in-a-folder" >/dev/null 2>&1
has "$(cat "$P/in-a-folder/project.env")" "PROJECT_DIR=$(cd "$DEV/started" && pwd)" "an idea can start in a folder with work in it"
no "which is not marked as the idea's to delete" test -e "$DEV/started/.brain-idea"
cmd_idea open in-a-folder >/dev/null 2>&1
has "$(cat "$T/launched")" "is NOT a scratch folder" "and its session is told the folder is the human's"
cmd_idea open fresh-one >/dev/null 2>&1
hasnt "$(cat "$T/launched")" "is NOT a scratch folder" "an idea's own scratch folder is not"
mkdir -p "$MEM/.new/out"; echo "x y" > "$MEM/.new/out/text.md"; echo "$T/outside" > "$MEM/.new/out/dir.md"
no "from the Studio, a folder outside ~/dev is refused" idea_studio_new out "$MEM/.new/out"
has "$(cat "$MEM/.new/out/log")" "--dir" "with the terminal command that does it"
rm -f "$P/fresh-one/.launching"
echo "$$ open" > "$P/fresh-one/.idea-running"; echo open > "$P/fresh-one/.idea-request"; LAUNCHED=""; rm -f "$P/fresh-one/.launching"
idea_watch
is "$LAUNCHED" "" "an idea that is open is not opened twice"
rm -f "$P/fresh-one/.idea-running"
echo "rm -rf /" > "$P/fresh-one/.idea-request"; idea_watch
no "a request that is no verb is dropped" test -e "$P/fresh-one/.idea-request"

section "promote: the same project, now a playbook's"
mkdir -p "$SYS/playbooks/build"; printf 'build  qa\n' > "$SYS/playbooks/build/phases"
printf '# Brief\n\n## Goal\n<!-- what -->\n\n## Stack\n- \n\n## Done means\n' > "$SYS/playbooks/build/brief.md"
echo "promote nope" > "$P/$N/.idea-request"; idea_watch
has "$(cat "$P/$N/idea-error.txt")" "usage: brain idea promote" "an unknown playbook is refused, with the reason left for the page"
yes "and it is still an idea" idea_is "$N"
echo "promote build" > "$P/$N/.idea-request"; idea_watch
has "$(cat "$P/$N/project.env")" "PLAYBOOK=build" "it is a build project now"
hasnt "$(cat "$P/$N/project.env")" "KIND" "and no longer an idea"
has "$(awk '/^## Stack/ { on = 1; next } /^## / { on = 0 } on' "$P/$N/brief.md")" "stm32" "its stack is in the playbook's brief"
has "$(awk '/^## Goal/ { on = 1; next } /^## / { on = 0 } on' "$P/$N/brief.md")" "x" "its words are under Goal"
yes "the note is kept where the phases read it" test -s "$P/$N/sources/idea.md"
has "$(cat "$P/$N/decisions.md")" "grew out of an idea" "and the first decision says so"
(cd "$DEV/ideas/$N" && load_project) >/dev/null 2>&1 && ok || bad "the playbook commands do not take the promoted project"

section "deleting: the choice is asked, the scratch folder goes only with everything"
has "$( (idea_rm fresh-one) 2>&1 )" "--keep" "without a terminal the choice has to be given"
printf '# Op\ntags: shared\nx\n\n## Sources\n- projects/fresh-one/idea.md\n' > "$MEM/knowledge/op.md"
printf '# Index\n\n## Knowledge\n\n### shared\n- [Op](knowledge/op.md) — x\n' > "$MEM/index.md"
idea_rm fresh-one --keep >/dev/null 2>&1
no "the idea is gone" test -e "$P/fresh-one"
yes "what it taught stays" test -f "$MEM/knowledge/op.md"
yes "and so does its scratch folder" test -d "$DEV/ideas/fresh-one"
printf '# Op2\ntags: shared\nx\n\n## Sources\n- projects/a-sampler-for-the-op-1/idea.md\n' > "$MEM/knowledge/op2.md"
idea_rm a-sampler-for-the-op-1 --all >/dev/null 2>&1
no "with everything, the page only it backed goes" test -e "$MEM/knowledge/op2.md"
no "and the scratch folder it made" test -e "$DEV/ideas/a-sampler-for-the-op-1"
idea_rm port --all >/dev/null 2>&1
yes "a folder of your own is never removed" test -f "$T/mine/main.c"
finish
