# Cockpit

The local web UI: the Studio for the people the work is for, and Admin for whoever runs the brain.

One local server, two front ends on the same API:

- **Studio** at `/` — for the people the work is for, with no engine words. Projects
  grouped by **area** — the `Area:` line under a playbook's description (`Content`,
  `Websites`, …); a playbook without one is in `Other` — each with a step bar, and what
  waits on you on top. **New project** offers every playbook with a brief or an
  `inputs` file, the most used first: its inputs are the form, its brief's headings the
  rest, and a client's answers are asked once. The review, where you select a passage to
  comment on it and **Send back** turns each comment into one numbered fix that must be
  answered (`brain reject`, with the quote), or **Approve** (`brain approve`) — both
  start the next steps. **Copy** when the project wrote `content/article.md`; progress
  and brief for every project. **Adjust playbook** (on a finished project: **Feedback on
  the playbook**) when a playbook's results do not come out as wished (below); and
  **Clients**. A project page is built from the files the project has, not from its
  area, so a new kind of work needs no Studio change; a tab for a new kind of output is
  one entry in `tabs` in `ui/public/studio.js`.
- **Admin** at `/admin` — the engine room below: everything that is not running a
  phase, for whoever runs the brain.

Admin is a local web UI for cross-project status, the playbooks and their instructions,
roles, skills, human gates and QA screenshots.

```bash
docker compose up -d            # http://127.0.0.1:7777 (COCKPIT_PORT in .env)
docker compose down
```

The image is only node: the cockpit runs from `ui/` in the mounted brain, so an edit to
`ui/`, `brain update` or an app's Studio code needs no rebuild. The server restarts itself
when `server.mjs` or `brain.mjs` change, and an open Studio reloads when an app changes.

It bind-mounts the brain read-write and `~/dev` read-only, and binds to loopback only.
It deliberately cannot call `brain` or `sbx` (those are host binaries), so running a
phase stays in your terminal; the UI shows the command to paste. `./install.sh` writes
`.env` with this Mac's paths and port; without one, compose mounts the folder you run it
from and `~/dev`.

## From the browser, with no terminal

Someone who never opens a terminal can run the whole loop from the cockpit once
`brain watch` is a login item (`brain watch install`, once, by you):

| | |
|---|---|
| New project | the Overview form: playbook, name, client, and one box per heading of the playbook's brief. It stages `memory/.new/<slug>/` and `brain watch` runs `brain new` for it a tick later — the container cannot, since `~/dev` is mounted read-only. A refusal stays on the row until you discard it |
| Run | a button per project, with the same **then start** picker as the verdict box. It leaves the `.run-request` a verdict does. `BRAIN_MAX_PARALLEL` in `system/brain.conf` (default 3) caps how many projects run at once; the rest show as queued and start as windows close |
| Inputs | what a playbook asks for when a project starts, typed: short or long text, a web address, a list of them, a number, a choice, files. Each is asked for every project or once per client. The playbook's page edits them as rows with the form beside it; the author drafts them with the playbook. They live in `system/playbooks/<name>/inputs`, one line each (`<input> <type> <per> <need> <label>`), and `brain playbook check` holds them to the same rules as the cockpit. A per-project answer lands in the project's `brief.md` under its label, so no agent reads anything new; a per-client one in `memory/clients/<client>/profile.md`, with its files in `clients/<client>/sources/` (not committed, like project sources). URLs are checked as you paste and `example.com/page` gets its `https://` |
| New playbook | describe the work and the `playbook-author` drafts it in a Terminal window `brain watch` opens, asking its questions there. The draft gets its own page under Playbooks: phases, sections, the roles it proposes with an engine, model and effort picker each, and the problems `brain playbook check` would find. **Install** writes the playbook and both halves of every proposed role, then asks `brain watch` to commit `system/`, so an installed draft is one `git revert` away. **Open the author again** sends it back with your changes; it revises instead of starting over |
| Adjust with AI | for a playbook that did not come out as wished: say what should be different, on the playbook's page in Admin or with **Adjust playbook** on any project in the Studio. The draft starts as a copy of the installed playbook (never its `playbook.env`, which `brain new` sources on the host), the `playbook-author` revises it, and the draft page marks each phase new, changed or removed against the installed one. **Install changes** (Studio: **Apply changes**) writes it over the playbook and asks `brain watch` to commit; **Discard** leaves the playbook as it was. Role instructions are shared between playbooks and stay `brain evolve`'s; an adjustment changes the playbook's own sections |

Each of these leaves a request file under `memory/` (`.new/`, `.run-request`,
`.draft-request`, `.commit-request`) and `brain watch` acts on it; nothing in the
container runs a host command. When nobody is listening the cockpit says so on the
page, with the one command that fixes it for good.

## Starting the run from the cockpit

Approving or requesting changes only writes the verdict — the container has no way to
reach your terminal, and a web server on your Mac that can run host commands is a worse
trade than typing eight characters. `brain watch` is the bridge, and it runs as you:

```bash
brain watch          # leave it in a spare tab
```

With it running, the verdict box's **then start** picker (per browser, remembered)
opens a new Terminal window on the project and runs `brain auto` or `brain run` for you.
The cockpit writes one word into `memory/projects/<name>/.run-request`; `brain watch`
accepts `run` and `auto` and nothing else, skips a project that already has a phase in a
sandbox, and keeps a heartbeat at `memory/.watch` so the cockpit can tell you when
nothing is listening instead of looking broken. Stop it and the buttons go back to
saving the verdict and showing you the command.

What it is good for:

| | |
|---|---|
| Overview | every project at once, which phase is next, and what is blocked on **you**. `brain status` is one project at a time and only from inside its folder |
| Blocked states | `brain status` shows done / failed / pending. The cockpit also separates "waiting for the fixer", "fixed, waiting for the reviewer" and "failed N/3, `brain run` will stop and ask you" |
| Playbooks | each phase row next to its `## <phase>` section of `playbook.md`, which today live in two different files. Edit the section in place; create from a skeleton or a copy, and delete (blocked while a project still points at it) |
| Checks | cross-file problems that otherwise surface mid-run: a role in `phases` that is not in `roles.conf`, a phase with no section in `playbook.md`, a review phase with no fix-role, a `#` comment on a data line that parses as a field |
| Human gates | approve, reject or send the playbook back with the design and the QA screenshots on the same page. Open findings are listed with a box each to defer instead of waive. Same texts and records as `brain approve`, `reject` and `reopen` |
| Runs | every run the project has made, newest first: how long, how many turns, tokens written, which skills the role declared and which it actually invoked. A phase that failed twice has three runs, under two different roles, and each carries the role file it ran against as it read at the time |
| Roles | engine, model and reasoning effort per role, from dropdowns; each rewrites that one line of `roles.conf` |
| Skills per role | tick which skills a role should reach for. Neither CLI can restrict a run's skill set, so this writes a `Skills:` line into the role's instructions: it directs the role, it does not sandbox it |
| Skills | every skill the brain declares, own and external, in one list. This is the set `sync-skills` installs and prunes to, so it should match `sbx skills ls`; the container cannot run `sbx` to confirm it |
| Installing a skill | paste a GitHub repo, pick from the skills it actually contains, and it writes the `skills.list` line for you. It reads each `SKILL.md` for the real name, which is often not the folder name (`output-skill/` is `full-output-enforcement`) |
| Removing a skill | **Remove** on any external or host skill drops it from `skills.list`; your own skills get a type-the-name confirm on their page. Both only change what the brain declares — the cockpit then shows the `sbx` command that actually uninstalls |

## Adding someone else's skill

Two steps, and the order matters:

1. In the cockpit, **Skills -> Add skills from a repo**. Paste `owner/repo` or a GitHub
   URL, pick the ones you want, and it merges them into the right `skills.list` line.
2. `brain sync-skills` in the terminal. Nothing is installed until you do.

Do **not** run `sbx skills add` yourself: `sync-skills` builds its keep list from
`skills.list` and removes everything that is not on it, so a skill added directly is
installed and then pruned on the next sync.

## Removing a skill

Same two steps, same order. In **Skills**, hit **Remove** next to an external or host
skill and it comes out of `skills.list` — if that empties a repo line, the line goes too,
because a repo with no names installs everything in it and the next sync prunes it all
back out. Your own skills are directories, so they get the type-the-name confirm on their
own page, like a role or a playbook.

Then apply it in the terminal. The cockpit shows both options:

```bash
brain sync-skills                  # prunes everything off the keep list in one pass
sbx skills rm --force <name>       # or just this one, now
```

Neither runs from the cockpit: it is a container with the brain repo bind-mounted, and
`sbx` is a host binary. That is deliberate — it has read-write access to the whole brain
and no auth, so it edits files and hands you commands rather than executing them.

The name in `skills.list` is the `name:` field of the skill's `SKILL.md`, which is often
not the folder name. The lookup reads the frontmatter so you get the right one. Private
repos still work in `skills.list` (sbx clones them on your Mac with your git
credentials), the lookup just cannot enumerate them, so type the names by hand.

Saves are atomic, refuse to overwrite a file you changed in your editor meanwhile, and
skip writing when nothing changed (rewriting a phase summary with identical bytes would
bump its mtime past the `.fixed` marker and re-run the fixer). Edits to `system/` are not
auto-committed, so `git -C ~/agent-brain diff` is your undo.

```bash
node ui/test.mjs        # self-check for the file-contract invariants
node ui/server.mjs      # run on the host instead of Docker, if you prefer
```
