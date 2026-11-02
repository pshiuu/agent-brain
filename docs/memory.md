# Memory

How agents learn: a wiki compiled from every project, and why the base and your memory are two repos.

## Memory is a wiki, not a log

Agents don't append notes that nobody reads later. They **compile**: each retro takes
what a finished project taught and rewrites the `knowledge/` page that owns that topic,
updates `index.md`, and appends one line to `log.md`. New evidence that contradicts a
page changes the page. Pages cross-link with `[[page-name]]`.

That means a session starts by reading `index.md` and opening three relevant pages,
not by reading all of memory. It keeps working as the wiki grows.

`projects/` and `sources/` are the raw record and never change. `knowledge/` is what
we learned from them and is always current. The rules the agents follow are in
`system/BRAIN.md`.

```bash
brain lint      # pages missing from the index, index links that point nowhere,
                # pages linked but not written yet, pages nothing links to,
                # pages with no ## Sources, citations of files that are not here,
                # pages with no tags: line or under the wrong ### of the index, a tag
                # no app and no stack names, a page about one client (move it there),
                # proposals under no heading, sources nobody compiled — and a
                # brain-wide source only one project cites, which is that client's
```

`brain` runs the same check after every phase and warns if a page and the index
disagree. (The pattern is [Karpathy's LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).)

### Feeding it documents

Two places, and which one matters. A client's brand book, their logos, a contract, a
call transcript belong to **one project**: upload them on that project's **Sources**
tab, and they stay in `memory/projects/<name>/sources/` where only that project's
phases read them. Something every project may need — an article, a process doc, a
standard you work to — goes brain-wide into `memory/sources/`, or **Memory ->
sources/** in the cockpit. Either way it is kept byte-for-byte and never edited.

A brain-wide source is then compiled into the wiki by an agent:

```bash
brain open     # "compile the new sources into knowledge/"
```

The agent writes or updates the knowledge page and cites the filename under
`## Sources`. That citation is how `brain lint` and the cockpit know a source has
actually been read, so an uncompiled document keeps showing up as work waiting.

### Does this grow out of control?

Not the part that gets read. `index.md` is what every session loads; the pages under it
are opened on demand, and a retro *rewrites* a page rather than appending to it, so 20
projects worth of lessons about one topic stay one page. `brain lint` warns when a page passes
250 lines (it has turned back into a log — split it) or the index passes 150.

Nor does every agent read all of it. Each page carries a `tags:` line (`seo`,
`web, payload`, `shared`) and sits in the index under the `###` heading of its tags. A
phase's prompt names its **Knowledge scope**: `shared`, the app its playbook comes from
and the apps that one requires, and every tag a word of the brief's `## Stack` starts
with. An SEO article for a Payload site reads `shared seo payload`, never the redesign
lessons. Remove an app and its tag drops out of every scope; the pages stay. Facts about
one client live beside their profile in `clients/<client>/`, not in `knowledge/`.

Agents write all of this through `brain-mem` (`system/skills/brain-mem/`), a CLI in the
sandbox: `scope`, `search`, `page` (tags it, files it under its `###`), `propose`, `decide`,
`check`. It refuses a write the rules forbid instead of leaving it for `brain lint` to find.
It shares its code with `bin/brain` (`lib.sh`), so the lint and the scope are one implementation.

What does grow fast is project memory, and QA screenshots worst of all: `brain-shoot`
writes full-page PNGs at three widths per URL, every review round. So `memory/projects/`
is gitignored in full — briefs, decisions, phase summaries, crawled content and those
PNGs are working material, and they stay on the machine that made them. The part meant to
outlive one project (`index.md`, `knowledge/`, `clients/`, `preferences.md`) is tracked in
memory's own repo (below). Project memory is yours to back up; git is not doing it for you.

## The base and your memory: two repos

The brain folder is two git repos. The outer one is the **base** — `bin/`, `ui/`,
`system/`, `templates/`, the tests — and it is the same for everyone who runs the brain.
`memory/` is a repo of its own, which the base ignores: your clients, the wiki your retros
compiled, the proposals, the log. It never travels with the base.

- **Your settings are not the base's.** `system/brain.local.conf` (read before
  `brain.conf`), `system/apps.lock`, `system/skills.lock` and `system/config/` are this
  brain's own and git ignores them, so they never reach the base and an update never
  touches them.
- **Updating.** `brain update` pulls the base from upstream. What `brain evolve` taught your
  roles and playbooks is commits of your own on that checkout, so the update is a merge
  that keeps them and stops on a real conflict, as `brain app update` does for an app.
- **Backing up memory.** Give it a private remote: `git -C memory remote add origin <url>`,
  then `git -C memory push -u origin HEAD`. Each phase commits memory on its own
  (`commit_memory`); pushing is yours.
- **Giving the brain to someone.** Give them the base's URL. They clone it and run
  `./install.sh`; `brain init` starts an empty memory from `examples/memory/` as its own repo.
  A knowledge page you want them to have travels by hand: a compiled page cites the
  project records it came from, so read it first.
- **Moving to another machine.** Clone the base, clone your memory repo into `memory/`, copy
  your settings files across, run `./install.sh`, then `brain app install <name>` for each
  line of `system/apps.lock`.

A brain from before the split tracked `memory/` in the base. Its old commits still hold
that memory, so a base repo you hand to anyone else starts from a fresh history.

**Developing the base.** Keep two folders: `agent-brain-main`, the shared base you change,
commit and push, with a throwaway memory; and `agent-brain-local`, the brain you work in, a
clone of main that only pulls (`brain update`; its push URL is disabled). Test a change in
main with `./bin/brain test` and `./bin/brain test --fresh` — the second runs every suite on
a copy of the base without anything git ignores, which is exactly what someone who clones it
gets. The suites refuse to run git on the brain they run from, so a test can never commit
into a real brain. Use `./bin/brain` there: `brain` on your PATH is the local brain.
