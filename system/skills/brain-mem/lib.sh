# The memory half of the brain, shared by bin/brain on the host and brain-mem in the
# sandbox, where system/ is mounted read-only and bin/ is not mounted at all. So it lives
# here, in system/, and bin/brain sources it. Functions only, nothing runs: the caller
# sets SYS (system/) and MEM (memory/), and for knowledge_scope PLAYBOOK and PDIR.
# bash 3.2, no node, no jq: the macOS host runs it too.

names_in() { local d; for d in "$1"/*/; do [ -d "$d" ] && basename "$d"; done; }

# EXTRA_ROOT and SKIP_APP are for brain app install and check: an app being checked is looked
# up as if installed, in place of the copy it would replace.
sys_roots() {
  echo "$SYS"; local d
  for d in "$SYS"/apps/*/; do
    [ -f "$d/app.conf" ] && [ "$(basename "$d")" != "${SKIP_APP:-}" ] && echo "${d%/}"
  done
  [ -n "${EXTRA_ROOT:-}" ] && echo "$EXTRA_ROOT"; return 0
}
in_roots() { # relpath -> the first root that has it, as a full path; non-zero when none does
  local r; while read -r r; do [ -e "$r/$1" ] && { echo "$r/$1"; return 0; }; done < <(sys_roots); return 1
}
# Not found -> the base path, so a caller's own [ -d ] / [ -f ] fails and its message names
# where a new one would go.
playbook_dir() { in_roots "playbooks/$1" || echo "$SYS/playbooks/$1"; }

# Client work is an app: without system/apps/clients/ a project has no client, whatever its
# project.env says, and nothing suggests moving a page into memory/clients/. The folder and
# what it holds stay; installing the app brings them back.
clients_on() { [ -f "$SYS/apps/clients/app.conf" ]; }

app_field() { # app-dir key -> the rest of its first "<key> ..." line in app.conf
  awk -v k="$2" '$1 == k { sub(/^[^[:space:]]+[[:space:]]*/, ""); print; exit }' "$1/app.conf" 2>/dev/null
}

brief_body() { # heading brief-file -> the lines under it, up to the next heading
  awk -v s="$1" '$0 == s { on = 1; next } on && /^##/ { exit } on' "$2"
}

# proposals.md is three lists under three headings. Agents append to `## Open`; moving a
# line to `## Accepted` is the human's approval, and it is the only thing `brain evolve`
# is allowed to act on. `## Declined` is what the human turned down, kept so the next
# retro does not file it again. The split exists because evolve is the one command that
# rewrites the instructions every other agent reads, so "the agent judged the evidence"
# is not a strong enough gate on its own.
proposals_section() { # heading -> the "- " lines under it
  [ -f "$MEM/proposals.md" ] || return 0
  awk -v want="## $1" '
    /^## / { on = ($0 == want); next }
    on && /^- / { print }
  ' "$MEM/proposals.md"
}

page_tags() { # knowledge-page -> its tags, one per line, from the "tags:" line under its title
  awk 'NR <= 3 && /^tags:/ { sub(/^tags:[[:space:]]*/, ""); gsub(/,/, " "); print; exit }' "$1" | tr -s ' ' '\n' | grep .
}
wiki_tags() { local f; for f in "$MEM"/knowledge/*.md; do [ -e "$f" ] && page_tags "$f"; done | sort -u; }
known_tags() { # -> what a tag may name: shared, every installed app, and every brief's ## Stack text
  local f; printf 'shared\n'; names_in "$SYS/apps"
  for f in "$MEM"/projects/*/brief.md "$SYS"/apps/*/playbooks/*/brief.md "$SYS"/playbooks/*/brief.md; do
    [ -f "$f" ] && brief_body '## Stack' "$f"; done; return 0
}
# A stack names a tag when a word of it starts with the tag: "Payload", "PayloadCMS".
stack_names() { printf '%s' "$2" | tr '[:upper:]' '[:lower:]' | grep -qE "(^|[^a-z0-9])$1"; } # tag text

knowledge_scope() { # -> the tags this project's agents read: shared, the playbook's app and the
  # apps it requires, and every tag of the wiki its brief's ## Stack names. An app's tag comes
  # from the app alone, so "Webflow" in a stack does not pull in the web app's pages.
  local dir app out="shared" stack t
  dir="$(playbook_dir "$PLAYBOOK")"
  case "$dir" in "$SYS"/apps/*)
    app="${dir#"$SYS"/apps/}"; app="${app%%/*}"
    out="$out $app $(app_field "$SYS/apps/$app" requires)" ;;
  esac
  stack="$(brief_body '## Stack' "$PDIR/brief.md" 2>/dev/null || true)"
  while read -r t; do
    [ -n "$t" ] && [ ! -f "$SYS/apps/$t/app.conf" ] && stack_names "$t" "$stack" && out="$out $t"
  done < <(wiki_tags)
  printf '%s\n' $out | awk '!seen[$0]++' | paste -sd' ' -
}

# An app may ship starter knowledge in its own knowledge/: read-only like the rest of system/,
# replaced by an update, read by every project whose scope names the app. What projects learn
# goes into memory/knowledge/, so an update never overwrites a lesson.
app_knowledge() { # scope -> the knowledge/ folders of the installed apps it names
  local a; for a in $1; do compgen -G "$SYS/apps/$a/knowledge/*.md" >/dev/null && echo "$SYS/apps/$a/knowledge"; done; return 0
}

# ---------- memory lint ------------------------------------------------------
# The wiki's only enforcement: pages and index must agree. Everything else about
# how memory is written lives in BRAIN.md, which the agents read.
lint_memory() { # prints findings, one per line, prefixed err|note
  local k="$MEM/knowledge" idx="$MEM/index.md" f name
  [ -d "$k" ] || return 0
  for f in "$k"/*.md; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    grep -v '^[[:space:]]*<!--' "$idx" 2>/dev/null | grep -q "knowledge/$name" || echo "err  knowledge/$name is not listed in index.md"
  done
  grep -v '^[[:space:]]*<!--' "$idx" 2>/dev/null | grep -o 'knowledge/[A-Za-z0-9._-]*\.md' | sort -u | while read -r rel; do
    [ -e "$MEM/$rel" ] || echo "err  index.md links $rel, which does not exist"
  done
  # Scope. A page's tags say whose agents read it, and index.md files it under a "### "
  # heading naming exactly those tags, which is all an agent's scope line points it at.
  local tags under known c cl
  known="$(known_tags)"
  for f in "$k"/*.md; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    tags="$(page_tags "$f" | sort | paste -sd' ' - || true)"
    if [ -z "$tags" ]; then echo "err  knowledge/$name has no 'tags:' line under its title — the app it is for, a stack word, or shared"; continue; fi
    under="$(awk -v n="knowledge/$name" '/^## /{ h = "" } /^### /{ h = substr($0, 5) } !/^[[:space:]]*<!--/ && index($0, n) { print h; exit }' "$idx" 2>/dev/null \
      | tr ',' ' ' | tr -s ' ' '\n' | grep . | sort | paste -sd' ' - || true)"
    [ -z "$(grep -v '^[[:space:]]*<!--' "$idx" 2>/dev/null | grep "knowledge/$name")" ] || [ "$under" = "$tags" ] \
      || echo "err  knowledge/$name is tagged '$tags' but index.md lists it under '### ${under:-(no tag heading)}' — file it under '### ${tags// /, }'"
    for t in $tags; do
      stack_names "$t" "$known" || echo "note knowledge/$name is tagged '$t', which no installed app and no stack names — no agent reads it"
    done
    # A page about one client: its title or summary names them and every project it cites is theirs.
    cl="$(grep -oE 'projects/[A-Za-z0-9._-]+' "$f" | sort -u | while read -r c; do
      awk -F= '$1 == "CLIENT" { c = $2 } END { print (c == "" ? "-" : c) }' "$MEM/$c/project.env" 2>/dev/null || echo -; done | sort -u || true)"
    clients_on && [ -n "$cl" ] && [ "$cl" != - ] && [ "$(printf '%s\n' "$cl" | grep -c .)" = 1 ] && head -3 "$f" | grep -qiE "$cl|$(echo "$cl" | tr '-' ' ')" \
      && echo "note knowledge/$name is about client $cl — move it to clients/$cl/"
  done
  grep -ho '\[\[[^]]*\]\]' "$k"/*.md 2>/dev/null | tr -d '[]' | sort -u | while read -r want; do
    [ -n "$want" ] || continue
    [ -e "$k/$want.md" ] || compgen -G "$SYS/apps/*/knowledge/$want.md" >/dev/null || echo "note [[$want]] is linked but not written yet"
  done
  for f in "$k"/*.md; do
    [ -e "$f" ] || continue
    name="$(basename "$f" .md)"
    grep -lq "\[\[$name\]\]" "$k"/*.md "$MEM"/clients/*/*.md 2>/dev/null || echo "note knowledge/$name.md has no inbound links"
  done
  # Growth tripwires. A page that keeps growing has turned back into the append-only
  # log the wiki replaced, and an index nobody can scan stops being read at all.
  local n
  for f in "$k"/*.md; do
    [ -e "$f" ] || continue
    n="$(wc -l < "$f" | tr -d ' ')"
    if [ "$n" -gt 250 ]; then echo "note knowledge/$(basename "$f") is $n lines — that is a log again, split it by topic"; fi
  done
  n="$(wc -l < "$idx" 2>/dev/null | tr -d ' ' || echo 0)"
  if [ "${n:-0}" -gt 150 ]; then echo "note index.md is $n lines — group it by area before it stops being scannable"; fi
  # A proposal under no heading is one `brain evolve` will never see: it is not
  # accepted, and it is not in the inbox the next agent appends to either.
  local stray
  stray="$(( $(grep '^- ' "$MEM/proposals.md" 2>/dev/null | wc -l) - $(proposals_section Accepted | wc -l) - $(proposals_section Open | wc -l) - $(proposals_section Declined | wc -l) ))"
  [ "${stray:-0}" -gt 0 ] && echo "err  proposals.md has $stray line(s) under none of '## Accepted', '## Open' or '## Declined' — brain evolve cannot see them"
  # Provenance. A claim is only checkable if the page says where it came from, and a
  # citation only helps while the file it names is there. Project memory is local and
  # gitignored, so on a fresh clone every projects/ citation is missing — a note, not an
  # error. Globs and placeholders (qa/*.png, <phase>) name no one file and are skipped.
  local cite
  for f in "$k"/*.md; do
    [ -e "$f" ] || continue
    grep -q '^## Sources[[:space:]]*$' "$f" || echo "err  knowledge/$(basename "$f") has no '## Sources' section — say which records its claims come from"
    grep -oE '(projects|sources)/[A-Za-z0-9._/-]+' "$f" | sed 's/[.]*$//' | sort -u | while read -r cite; do
      [ -e "$MEM/$cite" ] || echo "note knowledge/$(basename "$f") cites $cite, which is not here"
    done
  done
  # Dropped-in material nobody compiled. A page cites the filename under ## Sources,
  # so an uncited source has not made it into the wiki yet — and one that only a single
  # project's records ever cite is most likely that client's document, which BRAIN.md
  # keeps in the project's own sources/, where the next project's agents cannot read it.
  local users
  for f in "$MEM"/sources/*; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    case "$name" in .*) continue ;; esac
    grep -rqlF "$name" "$k" 2>/dev/null && continue
    users="$(for d in "$MEM"/projects/*/; do grep -rqlF --include='*.md' "$name" "$d" 2>/dev/null && basename "$d"; done)"
    if [ "$(printf '%s' "$users" | grep -c .)" = 1 ]; then
      echo "note sources/$name is cited only by project $users — a client document belongs in projects/$users/sources/"
    else
      echo "note sources/$name is not compiled into any knowledge page yet"
    fi
  done
}
