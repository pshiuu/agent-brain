#!/usr/bin/env bash
# brain-mem, the memory CLI agents run in the sandbox: each verb against a disposable brain.
# Run: bash test/brain-mem.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
fake_brain
BM="$BRAIN/system/skills/brain-mem/brain-mem"
bm() { BRAIN_SYSTEM="$SYS" BRAIN_MEMORY="$MEM" BRAIN_PROJECT=p0 "$BM" "$@"; }
run() { bm "$@" 2>&1; }

fake_app "$SYS/apps/seo" seo
mkdir -p "$SYS/apps/web" "$MEM/projects/p0" "$MEM/clients/acme"; printf 'name web\n' > "$SYS/apps/web/app.conf"
printf 'PLAYBOOK=seo-book\nCLIENT=acme\n' > "$MEM/projects/p0/project.env"
printf '# Brief\n\n## Stack\n- PayloadCMS behind a Webflow front\n' > "$MEM/projects/p0/brief.md"
printf '# Acme\nWho they are.\n' > "$MEM/clients/acme/profile.md"
page() { printf '# %s\ntags: %s\nAbout %s.\n\n## Sources\n- projects/p0/brief.md\n' "$1" "$2" "$1" > "$MEM/knowledge/$1.md"; }
page crawl shared; page article seo; page site web
cat > "$MEM/index.md" <<'EOF'
# Index

## Knowledge (`knowledge/`)
<!-- - [payload.md](knowledge/payload.md) — one line, under "### payload". -->

### shared
- [crawl.md](knowledge/crawl.md) — crawl limits.

### seo
- [article.md](knowledge/article.md) — articles.

### web
- [site.md](knowledge/site.md) — sites.

## Clients (`clients/`)
- [acme](clients/acme/profile.md) — Acme.
EOF
printf '# Proposals\n\n## Accepted\n\n## Open\n- [system/roles/qa.md] old — why (p9, 2026-01-01)\n\n## Declined\n- [system/roles/qa.md] no — not now (p8, 2026-01-01)\n' > "$MEM/proposals.md"

section "scope — the same tags as the prompt, and what they cover"
out="$(run scope)"
has "$out" "Knowledge scope: shared seo" "the scope line: payload is a stack word, but no page carries it yet"
has "$out" "knowledge/article.md  [seo]" "an seo page"
hasnt "$out" "site.md" "a web page is out of scope"
hasnt "$out" "clients/acme" "without the clients app the project has no client"
mkdir -p "$SYS/apps/clients"; printf 'name clients\nversion 1\nbrain >= 2\n' > "$SYS/apps/clients/app.conf"
out="$(run scope)"
has "$out" "clients/acme/profile.md" "with it, the client's pages"

section "search — only the scope and the client"
has "$(run search 'about article')" "knowledge/article.md:3:About article." "a page in scope"
has "$(run search 'who they are')" "clients/acme/profile.md:2" "the client's page"
no "a page out of scope is not searched" bm search "about site"
mkdir -p "$SYS/apps/seo/knowledge" "$SYS/apps/web/knowledge"
printf '# Search intent\nWhat a query wants.\n' > "$SYS/apps/seo/knowledge/search-intent.md"
printf '# Blocks\nWhat a block holds.\n' > "$SYS/apps/web/knowledge/blocks.md"
has "$(run scope)" "$SYS/apps/seo/knowledge/search-intent.md  [read-only, from the app]  Search intent" "scope lists the app's own pages"
hasnt "$(run scope)" "blocks.md" "not those of an app out of scope"
has "$(run search 'query wants')" "$SYS/apps/seo/knowledge/search-intent.md:2:" "search reads them"
no "nor searches them" bm search "block holds"
rm -rf "$SYS/apps/seo/knowledge" "$SYS/apps/web/knowledge"
no "search with nothing to find fails" bm search zzz

section "page — tagged, sourced, indexed"
no "no title" sh -c "printf 'x\n## Sources\n- y\n' | BRAIN_SYSTEM='$SYS' BRAIN_MEMORY='$MEM' BRAIN_PROJECT=p0 '$BM' page t --summary s"
no "no ## Sources" sh -c "printf '# T\nx\n' | BRAIN_SYSTEM='$SYS' BRAIN_MEMORY='$MEM' BRAIN_PROJECT=p0 '$BM' page t --summary s"
no "a new page needs a summary" sh -c "printf '# T\n## Sources\n- y\n' | BRAIN_SYSTEM='$SYS' BRAIN_MEMORY='$MEM' BRAIN_PROJECT=p0 '$BM' page t"
no "a tag no app and no stack names" sh -c "printf '# T\n## Sources\n- y\n' | BRAIN_SYSTEM='$SYS' BRAIN_MEMORY='$MEM' BRAIN_PROJECT=p0 '$BM' page t --summary s --tags vcv"
no "shared does not combine" sh -c "printf '# T\n## Sources\n- y\n' | BRAIN_SYSTEM='$SYS' BRAIN_MEMORY='$MEM' BRAIN_PROJECT=p0 '$BM' page t --summary s --tags 'shared, seo'"
no "a name that is not a topic slug" sh -c "printf '# T\n## Sources\n- projects/p0/brief.md\n' | BRAIN_SYSTEM='$SYS' BRAIN_MEMORY='$MEM' BRAIN_PROJECT=p0 '$BM' page 'My Notes' --summary s"
is "$(ls "$MEM/knowledge" | paste -sd' ' -)" "article.md crawl.md site.md" "nothing refused was written"

out="$(printf '# Keyword research\nWhat works. [[article]]\n\n## Sources\n- projects/p0/brief.md\n' | bm page keyword-research --summary "what works" 2>&1)"
has "$out" "wrote knowledge/keyword-research.md [seo]" "no --tags: the playbook's app"
is "$(sed -n 2p "$MEM/knowledge/keyword-research.md")" "tags: seo" "tags: is line 2"
is "$(awk '/^### seo/{f=1;next} f && /^- /{print; exit}' "$MEM/index.md")" "- [keyword-research.md](knowledge/keyword-research.md) — what works" "filed under ### seo"

printf '# Blocks\ntags: web\nPayload blocks.\n\n## Sources\n- projects/p0/brief.md\n' | bm page blocks --tags "Payload, web" --summary "blocks" >/dev/null 2>&1
is "$(sed -n 2p "$MEM/knowledge/blocks.md")" "tags: payload, web" "--tags wins over the body's own tags: line, lowercased"
has "$(cat "$MEM/index.md")" "### payload, web
- [blocks.md](knowledge/blocks.md) — blocks" "a new heading for a new tag set"
is "$(grep -n '^## Clients' "$MEM/index.md" | cut -d: -f1)" "$(( $(grep -n 'knowledge/blocks.md' "$MEM/index.md" | cut -d: -f1) + 2 ))" "made inside ## Knowledge, before ## Clients"

printf '# Blocks\nPayload blocks, rewritten.\n\n## Sources\n- projects/p0/brief.md\n' | bm page blocks >/dev/null 2>&1
is "$(sed -n 2p "$MEM/knowledge/blocks.md")" "tags: payload, web" "a rewrite keeps the page's tags"
is "$(grep -c 'knowledge/blocks.md' "$MEM/index.md")" "1" "and its one index line"
has "$(grep 'knowledge/blocks.md' "$MEM/index.md")" "— blocks" "and its summary"
printf '# Blocks\nx\n\n## Sources\n- projects/p0/brief.md\n' | bm page blocks --tags "web, payload" >/dev/null 2>&1
is "$(grep -c '^### ' "$MEM/index.md")" "4" "tags in another order find the same heading"
printf '# Blocks\nx\n\n## Sources\n- projects/p0/brief.md\n' | bm page blocks --tags seo >/dev/null 2>&1
is "$(awk '/knowledge\/blocks.md/{print h} /^### /{h=$0}' "$MEM/index.md")" "### seo" "retagged: moved to its new heading"
has "$(cat "$MEM/index.md")" "(knowledge/payload.md)" "the template comment is left alone"
yes "the wiki is consistent after all that" bm check
[ ! -e "$MEM/.brain-mem.lock" ] && ok || bad "the lock is released"

section "propose — into ## Open, in the queue's format"
no "no [target]" bm propose "change qa — because"
no "a target that does not exist" bm propose "[system/roles/nope.md] x — y"
no "no why" bm propose "[system/roles/qa.md] change it"
out="$(run propose "[system/roles/qa.md step 2] check the form — it broke on p0")"
has "$out" "the human declined a change to the same target" "a declined target is pointed out"
is "$(awk '/^## Open/{f=1;next} /^## /{f=0} f && /^- /' "$MEM/proposals.md" | tail -1)" "- [system/roles/qa.md step 2] check the form — it broke on p0 (p0, $(date +%F))" "appended last under Open, with (project, date)"
is "$(proposals_section Open | wc -l | tr -d ' ')" "2" "still one list"
bm propose "[system/roles/qa.md] y — z (p0, 2026-10-01)" >/dev/null 2>&1
is "$(grep -c '2026-10-01)' "$MEM/proposals.md")" "1" "a given (project, date) is kept, not doubled"
hasnt "$(lint_memory)" "proposals.md has" "no stray lines"

section "decide — dated, appended"
no "a decision needs its reason" bm decide "use web search"
bm decide "use web search" "no dataforseo tool in the session" >/dev/null
is "$(tail -1 "$MEM/projects/p0/decisions.md")" "$(date +%F) — use web search — no dataforseo tool in the session" "the BRAIN.md format"
has "$(head -1 "$MEM/projects/p0/decisions.md")" "# Decisions" "a new file gets its header"
no "outside a project" env BRAIN_SYSTEM="$SYS" BRAIN_MEMORY="$MEM" BRAIN_PROJECT=nope "$BM" decide a b

section "check — the lint, with an exit code"
printf '# Bare\nx\n' > "$MEM/knowledge/bare.md"
no "an error fails" bm check
has "$(run check)" "knowledge/bare.md has no 'tags:' line" "and says why"

finish
