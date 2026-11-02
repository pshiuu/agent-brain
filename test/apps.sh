#!/usr/bin/env bash
# brain app: installing an app into system/apps/, finding its playbooks and roles from
# there, the checks that refuse a broken one, and removing it again.
#
#   ./test/apps.sh

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
fake_brain
SRC="$T/src"

section "lookup — the base alone"
is "$(sys_roots)" "$SYS" "only the base is a root"
is "$(playbook_dir nothing)" "$SYS/playbooks/nothing" "an unknown playbook points at the base, so [ -d ] fails"
is "$(role_cfg qa)" "claude default " "a base role"

section "install from a folder — copied, checked, recorded"
fake_app "$SRC/seo" seo
git -C "$SRC" init -q && git -C "$SRC" add -A && git -C "$SRC" commit -qm app
app_install seo --from "$SRC" >/dev/null 2>&1
yes "installed into system/apps/seo" test -f "$SYS/apps/seo/app.conf"
is "$(playbook_dir seo-book)" "$SYS/apps/seo/playbooks/seo-book" "its playbook resolves into the app"
is "$(role_file seo-writer)" "$SYS/apps/seo/roles/seo-writer.md" "its role's instructions too"
is "$(role_cfg seo-writer)" "claude default " "and its roles.conf line"
has "$(all_in playbooks)" "seo-book" "brain playbooks lists it"
is "$(awk '{ print $1, $3, $4 }' "$SYS/apps.lock")" "seo $(git -C "$SRC" rev-parse HEAD) seo" "apps.lock: name, commit, path"
hasnt "$(ls -A "$SYS/apps")" ".seo.new" "no staging folder left"
yes "an installed app passes brain app check" app_check "$SYS/apps/seo"
is "$(app_conflicts)" "" "no name is defined twice"

section "install refuses a broken app and leaves nothing behind"
fake_app "$SRC/half" half; rm "$SRC/half/roles/half-writer.md"
no "a role line without its instructions" app_install half --from "$SRC"
no "and nothing was installed" test -e "$SYS/apps/half"
has "$(app_check "$SRC/half" 2>&1)" "has a line in roles.conf but no roles/half-writer.md" "says which half is missing"
fake_app "$SRC/clash" clash qa
no "a role the base already defines" app_install clash --from "$SRC"
has "$(EXTRA_ROOT="$SRC/clash" app_check "$SRC/clash" 2>&1)" "role qa is defined in more than one" "says which name clashes"
fake_app "$SRC/future" future; sed -i '' "s/^brain .*/brain    >= 99/" "$SRC/future/app.conf" 2>/dev/null || sed -i "s/^brain .*/brain    >= 99/" "$SRC/future/app.conf"
no "an app for a newer base" app_install future --from "$SRC"
fake_app "$SRC/needy" needy; echo "requires web" >> "$SRC/needy/app.conf"
no "an app whose requirement is missing" app_install needy --from "$SRC"
fake_app "$SRC/wrongname" other
no "app.conf naming a different app" app_install wrongname --from "$SRC"
fake_app "$SRC/badview" badview; mkdir -p "$SRC/badview/ui"; echo '{ "projectTabs": [ { "id": "x", "view": "spreadsheet", "when": "memory:x" } ] }' > "$SRC/badview/ui/app.json"
no "a project tab with a view the cockpit does not have" app_install badview --from "$SRC"
has "$(app_check "$SRC/badview" 2>&1)" "view 'spreadsheet' is not one of" "names the view"
is "$(names_in "$SYS/apps")" "seo" "only the good app is installed"

section "code in the Studio needs trust"
fake_app "$SRC/studio" studio; mkdir -p "$SRC/studio/ui"; echo 'export default () => {}' > "$SRC/studio/ui/main.js"
no "ui/main.js without a trust answer" app_install studio --from "$SRC"
BRAIN_TRUST_APP=studio app_install studio --from "$SRC" >/dev/null 2>&1
yes "installed once trusted" test -f "$SYS/apps/studio/ui/main.js"

section "reinstall replaces the copy in place"
echo "# changed" >> "$SRC/seo/roles/seo-writer.md"
app_install seo --from "$SRC" >/dev/null 2>&1
has "$(cat "$SYS/apps/seo/roles/seo-writer.md")" "# changed" "the new version is installed"
is "$(grep -c '^seo ' "$SYS/apps.lock")" "1" "one lock line per app"

section "update — this brain's changes survive a new version of the app"
B="$(app_base seo)"
yes "a pristine copy is kept as the base" test -f "$B/roles/seo-writer.md"
is "$(app_changes seo)" "" "nothing changed yet"
printf "local note\n" >> "$SYS/apps/seo/roles/seo-writer.md"                   # this brain learned something
printf "upstream note\n" >> "$SRC/seo/playbooks/seo-book/playbook.md"          # the developer improved another file
printf "# Notes\n\none\n\ntwo\n\nthree\n" > "$SRC/seo/notes.md"; git -C "$SRC" add -A; git -C "$SRC" commit -qm v2
app_install seo >/dev/null 2>&1; git -C "$SRC" rev-parse HEAD > "$T/c2"
has "$(cat "$SYS/apps/seo/roles/seo-writer.md")" "local note" "the local change is kept"
has "$(cat "$SYS/apps/seo/playbooks/seo-book/playbook.md")" "upstream note" "the upstream change arrives"
yes "and a new upstream file" test -f "$SYS/apps/seo/notes.md"
is "$(app_changes seo)" "M roles/seo-writer.md" "only the local change differs from the new base"
is "$(awk "\$1 == \"seo\" { print \$3 }" "$SYS/apps.lock")" "$(cat "$T/c2")" "the lock moved to the new commit"
sed -i.bak "s/^one$/ONE (local)/" "$SYS/apps/seo/notes.md"; rm -f "$SYS/apps/seo/notes.md.bak"
sed -i.bak "s/^three$/THREE (upstream)/" "$SRC/seo/notes.md"; rm -f "$SRC/seo/notes.md.bak"; git -C "$SRC" commit -qam v3
app_install seo >/dev/null 2>&1
has "$(cat "$SYS/apps/seo/notes.md")" "ONE (local)" "both sides of one file merge: local line"
has "$(cat "$SYS/apps/seo/notes.md")" "THREE (upstream)" "and upstream line"
sed -i.bak "s/^two$/two (here)/" "$SYS/apps/seo/notes.md"; rm -f "$SYS/apps/seo/notes.md.bak"
sed -i.bak "s/^two$/two (there)/" "$SRC/seo/notes.md"; rm -f "$SRC/seo/notes.md.bak"; git -C "$SRC" commit -qam v4
before="$(cat "$SYS/apps/seo/notes.md")"
no "the same line changed on both sides stops the update" app_install seo
is "$(cat "$SYS/apps/seo/notes.md")" "$before" "and the installed app is untouched"
has "$(cat "$SYS/apps/.seo.conflicts/notes.md" 2>&1)" "<<<<<<< local" "the merge with markers is left to look at"
app_revert seo notes.md >/dev/null 2>&1
app_install seo >/dev/null 2>&1
has "$(cat "$SYS/apps/seo/notes.md")" "two (there)" "after revert the update goes through"
no "and the conflicts folder is gone" test -d "$SYS/apps/.seo.conflicts"
git -C "$SRC" rm -q seo/notes.md; git -C "$SRC" commit -qm v5
app_install seo >/dev/null 2>&1
no "a file upstream deleted and this brain left alone goes" test -e "$SYS/apps/seo/notes.md"

section "diff, revert, promote"
printf "promote me\n" >> "$SYS/apps/seo/roles/seo-writer.md"
has "$(app_diff seo)" "+promote me" "diff shows this brain's change"
no "promote needs APPS_DEV" app_promote seo
git clone -q "$SRC" "$T/dev"
printf "APPS_DEV=%s\n" "$T/dev" >> "$SYS/brain.conf"
app_promote seo roles/seo-writer.md >/dev/null 2>&1
has "$(cat "$T/dev/seo/roles/seo-writer.md")" "promote me" "promote writes the change into the developer's checkout"
is "$(git -C "$T/dev" status --porcelain | awk "{print \$2}")" "seo/roles/seo-writer.md" "and nothing else, uncommitted"
app_revert seo >/dev/null 2>&1
is "$(app_changes seo)" "" "revert with no file goes back to the installed version"
printf "x\n" >> "$SYS/apps/seo/roles/seo-writer.md"
no "remove refuses to drop this brain's changes unattended" app_remove seo
app_revert seo >/dev/null 2>&1

section "knowledge scope — the app, its stack, nothing else"
mkdir -p "$SYS/apps/web" "$MEM/projects/p0" "$MEM/clients/acme"; printf 'name web\n' > "$SYS/apps/web/app.conf"
page() { printf '# %s\ntags: %s\n%s\n\n## Sources\n- %s\n' "$1" "$2" "${4:-One line.}" "${3:-x}" > "$MEM/knowledge/$1.md"; }
page crawl shared; page article seo; page site web; page blocks "web, payload"; page old "seo, vcv"
printf '# Brief\n\n## Stack\n- PayloadCMS behind a Webflow front\n' > "$MEM/projects/p0/brief.md"
PLAYBOOK=seo-book PDIR="$MEM/projects/p0"
is "$(knowledge_scope)" "shared seo payload" "app + stack word; 'Webflow' does not pull in the web app"
has "$(CLIENT='' PROJECT=p0 header)" "Knowledge scope: shared seo payload" "the prompt says so"
printf '# Index\n## Knowledge\n### shared\n- [c](knowledge/crawl.md)\n### seo\n- [a](knowledge/article.md)\n- [s](knowledge/site.md)\n### payload, web\n- [b](knowledge/blocks.md)\n- [o](knowledge/old.md)\n' > "$MEM/index.md"
out="$(lint_memory)"
hasnt "$out" "knowledge/blocks.md is tagged" "a heading's tags match in any order"
has "$out" "err  knowledge/site.md is tagged 'web' but index.md lists it under '### seo'" "filed under the wrong tags"
has "$out" "knowledge/old.md is tagged 'vcv', which no installed app and no stack names" "a tag nobody reads"
hasnt "$out" "tagged 'payload', which" "a stack word is a known tag"
printf '# Notes\nOne line.\n' > "$MEM/knowledge/bare.md"
has "$(lint_memory)" "err  knowledge/bare.md has no 'tags:' line" "every page is tagged"
printf 'PLAYBOOK=seo-book\nCLIENT=acme\n' > "$MEM/projects/p0/project.env"
page figures seo projects/p0/brief.md "What Acme charges."
hasnt "$(lint_memory)" "is about client acme" "without the clients app, no page is a client's"
has "$( (BRAIN_NONINTERACTIVE=1 cmd_new seo-book x --client acme) 2>&1)" "a client is the clients app's" "brain new --client needs the app"
mkdir -p "$SYS/apps/clients"; printf 'name clients\nversion 1\nbrain >= 2\n' > "$SYS/apps/clients/app.conf"
has "$(lint_memory)" "note knowledge/figures.md is about client acme — move it to clients/acme/" "with it, a client's page"
rm -rf "$SYS/apps/clients"
page figures seo projects/p0/brief.md "What everyone charges."
hasnt "$(lint_memory)" "figures.md is about client" "one client's evidence alone is not a client page"

section "app knowledge — shipped read-only, read through the scope"
mkdir -p "$SYS/apps/seo/knowledge"; printf '# Search intent\nWhat a query wants.\n' > "$SYS/apps/seo/knowledge/search-intent.md"
is "$(app_knowledge "$(knowledge_scope)")" "$SYS/apps/seo/knowledge" "the app in scope brings its folder"
is "$(app_knowledge "shared payload")" "" "no app in scope, no folder"
has "$(CLIENT='' PROJECT=p0 header)" "App knowledge (read-only, shipped with the apps): $SYS/apps/seo/knowledge" "the prompt names it"
printf -- '- [[search-intent]]\n' >> "$MEM/knowledge/article.md"
hasnt "$(lint_memory)" "[[search-intent]] is linked but not written" "a link to an app page resolves"
yes "the app with its pages passes" app_check "$SYS/apps/seo"
printf 'no title\n' > "$SYS/apps/seo/knowledge/Bad_Name.md"
out="$(app_check "$SYS/apps/seo" 2>&1)"
has "$out" "knowledge/Bad_Name.md: name it for the topic" "a page is named for its topic"
has "$out" "knowledge/Bad_Name.md: the first line is its title" "and starts with its title"
rm -rf "$SYS/apps/seo/knowledge"

section "memory — a repo of its own, which forget commits to"
is "$(commit_memory test 2>&1)" "" "no memory repo, no commit: never the base's"
memory_init >/dev/null 2>&1
yes "brain init makes memory/ a repo" test -d "$MEM/.git"
yes "whose .gitignore keeps project records out" grep -qx 'projects/\*' "$MEM/.gitignore"

section "forget — an uninstalled app's pages to the archive"
no "not while the app is installed" app_forget seo
mv "$SYS/apps/seo" "$T/seo.away"
app_forget seo >/dev/null 2>&1
yes "a page tagged with it alone moves" test -f "$MEM/archive/knowledge/article.md"
no "and leaves knowledge/" test -e "$MEM/knowledge/article.md"
yes "a page another tag still reads stays" test -f "$MEM/knowledge/old.md"
hasnt "$(cat "$MEM/index.md")" "knowledge/article.md" "its index line is gone"
has "$(cat "$MEM/index.md")" "### seo" "the heading stays while a page is under it"
page solo seo; printf '# Index\n## Knowledge\n### shared\n- [c](knowledge/crawl.md)\n\n### seo\n- [s](knowledge/solo.md)\n\n## Clients\n' > "$MEM/index.md"
page article seo; app_forget seo >/dev/null 2>&1
yes "a second page of the same name is kept beside the first" test "$(ls "$MEM/archive/knowledge" | grep -c '^article')" = 2
is "$(cat "$MEM/index.md")" "$(printf '# Index\n## Knowledge\n### shared\n- [c](knowledge/crawl.md)\n\n## Clients')" "an emptied heading goes too"
is "$(git -C "$MEM" log -1 --format=%s)" "memory: forget seo" "and it is committed in memory's repo"
mv "$T/seo.away" "$SYS/apps/seo"
rm -rf "$SYS/apps/web" "$MEM/projects/p0" "$MEM/knowledge"/*.md "$MEM/index.md" "$MEM/archive"

section "remove — refused mid-project, then clean"
mkdir -p "$MEM/projects/p1/phases"; printf 'PLAYBOOK=seo-book\nCREATED=2026-10-29\n' > "$MEM/projects/p1/project.env"
touch "$MEM/projects/p1/phases/write.done"
no "an app with a project partway through it" app_remove seo
yes "is still there" test -d "$SYS/apps/seo"
touch "$MEM/projects/p1/phases/review.done"
mkdir -p "$SYS/apps/seo/skills/seo-skill"; printf -- '---\nname: seo-skill\n---\n' > "$SYS/apps/seo/skills/seo-skill/SKILL.md"
( cmd_sync_skills() { touch "$T/synced"; }; BRAIN_FORCE=1 app_remove seo >/dev/null 2>&1 )
no "removed once the project is finished" test -e "$SYS/apps/seo"
hasnt "$(cat "$SYS/apps.lock")" "seo " "and its lock line is gone"
is "$(playbook_dir seo-book)" "$SYS/playbooks/seo-book" "its playbook no longer resolves"
is "$(role_cfg seo-writer)" "" "nor its role"
yes "and its skills leave the sandbox store: remove runs sync-skills" test -f "$T/synced"

section "an app's host side — cli.sh, its kind, brain <app> <verb>"
fake_app "$SRC/lab" lab
printf 'kind      lab\n' >> "$SRC/lab/app.conf"
cat > "$SRC/lab/cli.sh" <<'EOF'
cmd_lab() { echo "lab:$*"; }
lab_watch() { echo watched > "$MEM/lab-watched"; }
lab_studio_new() { mkdir -p "$MEM/projects/$1"; printf 'KIND=lab\n' > "$MEM/projects/$1/project.env"; }
EOF
git -C "$SRC" add -A && git -C "$SRC" commit -qm lab
app_install lab --from "$SRC" >/dev/null 2>&1
yes "an app with a cli.sh and a kind installs" test -f "$SYS/apps/lab/cli.sh"
is "$(kind_app lab)" "lab" "the kind resolves to its app"
no "an unknown kind does not" kind_app nothing
is "$(app_cli lab && cmd_lab run x)" "lab:run x" "brain lab run x reaches cmd_lab"
no "an app without a cli.sh" app_cli seo
no "a name that is not an app's" app_cli "../lab"
watch_apps; yes "each watch tick calls <app>_watch" test -f "$MEM/lab-watched"
mkdir -p "$MEM/.new/bench"; echo "lab bench" > "$MEM/.new/bench/request"
watch_new >/dev/null 2>&1
has "$(cat "$MEM/projects/bench/project.env" 2>&1)" "KIND=lab" "the Studio's New form for a kind goes to <app>_studio_new"
no "and its staging is gone" test -d "$MEM/.new/bench"
mkdir -p "$T/work/bench"
has "$(cd "$T/work/bench" && (load_project) 2>&1)" "belongs to the lab app (KIND=lab), not to a playbook — use brain lab" "playbook commands refuse a kind's workspace"
printf 'KIND=gone\n' > "$MEM/projects/bench/project.env"
has "$(cd "$T/work/bench" && (load_project) 2>&1)" "no installed app owns" "a kind whose app is gone"
fake_app "$SRC/sneaky" sneaky; printf 'cmd_sneaky() { :; }\ndie() { :; }\n' > "$SRC/sneaky/cli.sh"
has "$(app_check "$SRC/sneaky" 2>&1)" "cli.sh defines die()" "a cli.sh may not replace a launcher function"
fake_app "$SRC/twin" twin; printf 'kind      lab\n' >> "$SRC/twin/app.conf"; printf 'cmd_twin() { :; }\n' > "$SRC/twin/cli.sh"
has "$(app_check "$SRC/twin" 2>&1)" "kind 'lab' is already owned by the app 'lab'" "one kind, one app"
fake_app "$SRC/mute" mute; printf 'mute_x() { :; }\n' > "$SRC/mute/cli.sh"
has "$(app_check "$SRC/mute" 2>&1)" "defines no cmd_mute" "brain mute needs cmd_mute"
rm -rf "$SYS/apps/lab" "$MEM/projects/bench" "$MEM/lab-watched"

section "secrets, settings, network and MCP from app.conf"
fake_app "$SRC/data" data; SBXCONF="$SYS/sandbox.conf"
cat >> "$SRC/data/app.conf" <<'EOF'
mcp      datahub https://mcp.example.com/http
secret   datahub basic https://api.example.com/me Datahub API login and password
mcp      open https://open.example.com/mcp
setting  volumes toggle on Keyword volumes
setting  market choice de,fr,us Default market
allow    api.example.com,cdn.example.com
EOF
checked() { EXTRA_ROOT="$1" app_check "$1"; }
yes "an app with all four kinds of line passes" checked "$SRC/data"
SBXCALLS="$T/sbx-calls"; : > "$SBXCALLS"
sbx() { echo "$*" >> "$SBXCALLS"; case "$1 ${2:-}" in "mcp inspect") return 1 ;; "ls "*) printf 'NAME\nbox-1\n' ;; esac; return 0; }
app_install data --from "$SRC" >/dev/null 2>&1
is "$(mcp_names)" "open" "a server without a secret is on once installed; one with a secret is not"
cmd_sync_sandbox >/dev/null 2>&1
has "$(cat "$SBXCALLS")" "mcp add open --url https://open.example.com/mcp" "sync-sandbox registers the app's open server"
hasnt "$(cat "$SBXCALLS")" "mcp add datahub" "but not the one whose key is not stored yet"
has "$(cat "$SBXCALLS")" "policy allow network api.example.com,cdn.example.com" "and allows the app's hosts"
: > "$SBXCALLS"; printf 'dXNlcjpwYXNz' > "$MEM/.secret-datahub.request"
is "$(secret_connect datahub)" "connected $(date +%F)" "a staged secret connects"
no "the request file is gone" test -f "$MEM/.secret-datahub.request"
has "$(cat "$SBXCALLS")" "secret set mcp:datahub:token" "the key goes into sbx's secret store"
has "$(cat "$SBXCALLS")" 'mcp add datahub --url https://mcp.example.com/http --header Authorization: Basic ${token}' "the server is registered with the header that uses it"
has "$(cat "$SBXCALLS")" "mcp load datahub --sandbox box-1" "and loaded into existing sandboxes"
echo "connected $(date +%F)" > "$MEM/.secret-datahub.status"
is "$(mcp_names)" "datahub,open" "once connected it goes into new sandboxes"
printf 'x' > "$MEM/.secret-nothere.request"
has "$(secret_connect nothere)" "no installed app has a secret and an MCP server called nothere" "a secret no app declares"
sbx() { return 0; }
rm -rf "$SYS/apps/data" "$MEM"/.secret-*; sed -i.bak '/^data /d' "$SYS/apps.lock"
fake_app "$SRC/loose" loose; printf 'secret   lonely bearer - A token\nsetting  x toggle maybe Flag\nmcp      bad http://insecure.example.com\n' >> "$SRC/loose/app.conf"
out="$(checked "$SRC/loose" 2>&1)"
has "$out" "secret lonely has no mcp line" "a secret without its server"
has "$out" "a toggle is on or off, not maybe" "a toggle's default"
has "$out" "mcp <name> <https-url>" "an MCP server over plain http"
printf 'mcp clash --url https://x.example.com\n' > "$SYS/sandbox.conf"
fake_app "$SRC/clashy" clashy; printf 'mcp      clash https://y.example.com/mcp\n' >> "$SRC/clashy/app.conf"
has "$(checked "$SRC/clashy" 2>&1)" "mcp server 'clash' is also in system/sandbox.conf" "a server name is one owner's"
rm -f "$SYS/sandbox.conf"

section "the Studio's Apps page — catalog and requests through brain watch"
CAT="$T/catalog"; mkdir -p "$CAT"
fake_app "$CAT/shop" shop; printf '# shop\n\nSells things,\nin two lines.\n\nMore.\n' > "$CAT/shop/README.md"
fake_app "$CAT/paint" paint; mkdir -p "$CAT/paint/ui"; echo 'export default () => {}' > "$CAT/paint/ui/main.js"; printf 'setting  x toggle on X\nicon     brush\ndescription Paints walls.\n' >> "$CAT/paint/app.conf"
git -C "$CAT" init -q && git -C "$CAT" add -A && git -C "$CAT" commit -qm apps
printf 'APPS_SOURCE=%s\n' "$CAT" > "$SYS/brain.conf"
cmd_sync_skills() { echo synced >> "$T/synced"; }
request() { echo "$1" > "$MEM/.apps-running"; apps_request; head -1 "$MEM/.apps-status" | cut -d' ' -f1; }
is "$(request catalog)" "ok" "a catalog request"
has "$(cat "$MEM/.apps-catalog")" "$(printf 'shop\t1.0.0\tshop\t\t\t-\tSells things, in two lines.')" "one line per app: its README's first paragraph, not installed"
has "$(cat "$MEM/.apps-catalog")" "$(printf 'paint\t1.0.0\tpaint\tbrush\tcode,settings\t-\tPaints walls.')" "its icon, what it brings, app.conf's description first"
has "$(cat "$MEM/.apps-catalog.d/shop.md")" "Sells things" "the README is kept for the app's page"
is "$(request 'install shop')" "ok" "install from the Studio"
yes "it is installed" test -f "$SYS/apps/shop/app.conf"
no "the running marker is gone" test -f "$MEM/.apps-running"
has "$(grep '^shop' "$MEM/.apps-catalog")" "$(printf '\tno\t')" "and the catalog says it is current"
echo "# new" >> "$CAT/shop/roles/shop-writer.md"; git -C "$CAT" commit -qam newer
request catalog >/dev/null
has "$(grep '^shop' "$MEM/.apps-catalog")" "$(printf '\tyes\t')" "a newer version in the repo shows as an update"
is "$(request 'update shop')" "ok" "update from the Studio"
has "$(cat "$SYS/apps/shop/roles/shop-writer.md")" "# new" "the update landed"
is "$(request 'install paint')" "error" "Studio code without the trust tick is refused"
has "$(cat "$MEM/.apps-status")" "runs code in the Studio" "and the status says why"
is "$(request 'install paint trust')" "ok" "with the tick it installs"
is "$(request 'install shop')" "error" "installing what is installed"
is "$(request 'install ../x')" "error" "a name that is not an app's"
echo "# mine" >> "$SYS/apps/shop/roles/shop-writer.md"
is "$(request 'remove shop')" "error" "removing an app this brain changed needs force"
is "$(request 'revert shop')" "ok" "revert drops this brain's changes"
hasnt "$(cat "$SYS/apps/shop/roles/shop-writer.md")" "# mine" "they are gone"
is "$(request 'remove shop')" "ok" "remove from the Studio"
no "it is gone" test -d "$SYS/apps/shop"
is "$(request 'frobnicate shop')" "error" "an unknown verb"
rm -rf "$SYS/apps/paint" "$SYS/apps/.base/paint" "$SYS/brain.conf"; sed -i.bak '/^paint /d' "$SYS/apps.lock"

section "app test runs the app's own tests"
mkdir -p "$SYS/apps/studio/test"; printf 'exit 0\n' > "$SYS/apps/studio/test/ok.sh"
yes "a passing app test" app_test studio
printf 'exit 1\n' > "$SYS/apps/studio/test/fail.sh"
no "a failing one fails" app_test studio

finish
