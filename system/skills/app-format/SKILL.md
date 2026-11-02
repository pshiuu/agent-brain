---
name: app-format
description: The file contract for a brain app — app.conf, its roles, playbooks and skills, and what brain app check enforces. Use when writing, reviewing or repairing an app, or when brain app install refused one.
---

# App format

An app is a domain for the brain — SEO, theses, websites — packaged as a folder. It is
installed with `brain app install <name>`, which copies the folder from its repo
(`APPS_SOURCE` in `system/brain.conf`, by default `pshiuu/agent-brain-apps`, one folder per
app) to `$BRAIN_SYSTEM/apps/<name>/` and records the commit in `system/apps.lock` (the
brain's own, not in the base's git).

The brain looks into every installed app the way it looks into `system/` itself: a
playbook, role or skill is found in the base first, then in the apps. Nothing is copied
into the base, so `brain app remove <name>` takes all of it out again. Knowledge the
projects learned stays in `memory/`; removing the app hides the pages tagged with it, and
`brain app forget <name>` moves those to `memory/archive/knowledge/` only when asked.

## Layout

```
seo/
  app.conf          the manifest (below)
  README.md         what the app is for; its page in the Studio and later the app store
  roles.conf        only this app's roles: role engine model [effort]
  roles/<role>.md   their instructions — both halves live in the app (role-format skill)
  playbooks/<name>/ phases, playbook.md, brief.md, inputs, contracts/ (playbook-format skill)
  skills/<name>/    its own skills, each with a SKILL.md
  skills.list       external skills it pulls in, same format as system/skills.list
  knowledge/*.md    starter knowledge: one topic per page, '# <title>' first. Read-only;
                    every project whose scope names the app reads it, an update replaces it.
                    What projects learn goes into memory/knowledge/, never here
  test/*.sh         its own tests; `brain app test <name>` runs them (source test/lib.sh)
  cli.sh            optional host commands: `brain <name> <verb>` (below)
  ui/main.js        optional code for the Studio — installing it asks for trust
```

Everything but `app.conf` is optional: an app may be only roles and skills that other
apps build on.

## `app.conf`

One `key value` line each, read with awk like `roles.conf` — never sourced.

```
name      seo                    must equal the folder name
label     SEO & content          shown in the Studio
description Articles that …      one or two sentences for the store (else the README's first paragraph)
icon      file-text              a Phosphor icon name, for its tile in the store
version   1.2.0                  required
brain     >= 2                   the base version it works with; required
requires  web                    other apps it needs installed (space-separated)
kind      academy                a workspace kind it owns (KIND= in a project.env); needs cli.sh
```

What its sandboxes reach and what it needs from the human — each may repeat:

```
mcp      <name> <https-url>                         an MCP server its agents get
secret   <name> basic|bearer <check-url|-> <label>  the key of the mcp server of that name
setting  <key> toggle on|off <label>                a value its skills read
setting  <key> choice a,b,c <label>                 (the first option is the default)
setting  <key> text <default> <label>
allow    <host>[,<host>...]                         hosts its sandboxes may reach
```

- A `secret` is always an MCP server's key, sent as `Authorization: Basic|Bearer <key>`;
  basic asks for a login and password and sends them base64'd. The Studio checks it with a
  GET to `<check-url>` (401/403 is a wrong key), `brain watch` stores it in sbx's secret
  store as `mcp:<name>:token` and registers the server. The agent never sees it. The
  server goes into new sandboxes only once its key is stored.
- An `mcp` line without a secret (a public or OAuth server), and every `allow`, is
  registered by `brain sync-sandbox`. A server name belongs to one app, and not to
  `system/sandbox.conf` too.
- Settings are written by the Studio to `$BRAIN_SYSTEM/config/<name>.conf`, one
  `<key> <value>` line each, outside the app's folder so an update keeps them. A key the
  file does not name has its default; say so in the skill that reads it.
- An app's `secret` and `setting` lines become a Settings section on its page in Admin → Apps.

An unknown key is ignored, so an app may carry lines a later base reads.

## Host commands: `cli.sh`

An app that does more than run playbooks brings a `cli.sh`. The launcher sources it when
it is needed and calls, by name:

| Function | When |
| --- | --- |
| `cmd_<name>` | `brain <name> <verb> [args]` — required in every `cli.sh` |
| `<name>_watch` | every `brain watch` tick (move in what the Studio staged, start a queued run) |
| `<name>_studio_new <slug> <stage-dir>` | the Studio's New form asked for the app's `kind`; `memory/.new/<slug>/` holds what the form wrote. Non-zero leaves `log` there as the error |

Everything else it defines starts with `<name>_`, so nothing it sources replaces a function
of the launcher. It may call these of the launcher's, and no others — the rest changes
without notice: `launch`, `role_cfg`, `sandbox_name`, `project_name`, `slug`, `fill_brief`,
`interactive`, `ask`, `info`, `die`, `terminal`, `running_projects`, `sbx`; and read
`BRAIN`, `SYS`, `MEM`, `DEV`, `PROJECT`, `PDIR`, `PHASE_TIMEOUT`, `MAX_PARALLEL`, `QUEUED`.

A `kind` is how a project that is not a playbook run belongs to the app: its `project.env`
says `KIND=<kind>`, the playbook commands refuse it and name the app, and the Studio's
project list leaves it out. Run markers for the run cap are `memory/projects/<p>/.<name>-running`.

## Studio code: `ui/main.js`

What `ui/app.json` cannot say — whole pages of the app's own — is an ES module the Studio
imports from `/apps/<name>/main.js` (put `{ "type": "module" }` in `ui/package.json` so node
tests can import it too). Its default export is called once with the kit:

| Kit | What it does |
| --- | --- |
| `route(key, fn, active?)` | `#/<key>/<a>/<b>/<c>` renders `fn(a, b, c)`; `active(a)` names the nav item it lights up. The Studio's own keys are taken |
| `nav({ label, items })` | a sidebar group; `items()` runs on every render and returns `[{ href, label, icon, key, n }]` |
| `state`, `refresh()`, `render()` | the live `/api/state` (`state.apps[].projects` lists a kind's projects with their run markers); reload it; draw again |
| `read(project, paths, where)` | many files or folders (`dir/`) in one call. `where`: `work` (the project's folder under `~/dev`), `memory` (its folder in `memory/projects/`) or `app` (the app's own folder, project `null`). Text files come with their content, others with their size; outside the scope is refused |
| `request(project, file, { content \| data, prev, against })` | stages `.<name>-request` (one at a time), `inbox/<file>` (`data`, base64) or `<name>.staged` (with `prev`: refused when the workspace's `against` file changed) in `memory/projects/<p>/`. `<name>_watch` in `cli.sh` takes it from there |
| `create(name, files)` | a new project of the app's kind: `memory/.new/<slug>/` with `files` and the request; `<name>_studio_new` makes it |
| `api`, `upload`, `inputsForm`, `projectTable`, `sorted`, `status`, `titleOf`, `clientName`, `newButton` | the rest of the cockpit, for an app built on the Studio's own pages (the clients app) |
| `frame`, `head`, `card`, `pad`, `table`, `td`, `rowLink`, `empty`, `note`, `toast`, `keep`, `link`, `btn`, `withIcon`, `tagOf`, `watchingNote`, `human`, `ago`, `$`, `icon`, `md`, `graphView`, `readB64` | the Studio's own building blocks, so an app's pages look like the rest |

The cockpit runs no app code on its server: it serves `ui/` as files and answers the two
endpoints above. In the browser the code can call every cockpit API, which is why install
asks for trust. Parse in pure functions that take a `read`, and test them in node against
the cockpit's real `appRead` (the academy's `test/ui.test.mjs` does).

## In the Studio

Admin → Apps lists the installed apps and what `APPS_SOURCE` offers (`memory/.apps-catalog`,
written by `brain watch` / `brain app catalog`: version, label, the first paragraph of the
README, and whether the app brings Studio code, commands or settings). Install, update,
revert and remove are staged as `memory/.apps-request` and run by `brain watch`; the trust
question becomes a confirm dialog. Each app has a page there: its tile, its actions, its
settings and its README rendered, so write the README for the person deciding to install it.

## What `brain app check` enforces

Install and update refuse an app that fails any of these; nothing is left behind.

- `app.conf` exists, `name` matches the folder, `version` is set, `brain >= N` is met.
- Every app in `requires` is installed.
- Every role has both halves inside the app: its `roles.conf` line and `roles/<role>.md`.
  A half in another app or in the base would break the day that one is removed.
- Every skill folder has a `SKILL.md`.
- Every playbook passes `brain playbook check` (its roles resolve across base and apps).
- No playbook, role or skill name is also defined by the base or another app. A name is
  never overridden; rename yours.
- `cli.sh` parses, defines `cmd_<name>`, and defines nothing outside `cmd_<name>` and `<name>_*`.
- `mcp`, `secret`, `setting` and `allow` lines have the shape above; every secret names an
  mcp line of the app; no server name is also another app's or in `system/sandbox.conf`.
- A `kind` has a `cli.sh` to run it, is owned by no other app and is no playbook's name.
- An app with `ui/main.js` installs only after the human trusts it: that code runs in the
  Studio with everything the Studio may do.

## Whose change is whose

An installed app exists three times, and each copy has one owner:

| Copy | Changed by | Where |
| --- | --- | --- |
| the app as published | its developer, by pushing to the apps repo | the repo; `system/apps.lock` pins a commit |
| the app as this brain runs it | this brain: `brain evolve`, Adjust playbook, a model changed in Roles | `system/apps/<name>/` |
| the app as installed, untouched | nobody | `system/apps/.base/<name>/` |

What a brain learns from its runs stays in that brain: `system/apps/` is not in git and
never goes back upstream on its own. `brain app update <name>` merges each file three
ways (base → this brain, base → new version), so local changes survive an update; when
both changed the same lines it stops and installs nothing. `brain app diff <name>` shows
this brain's changes, `brain app revert <name> [file]` drops them, and for the app's
developer `brain app promote <name> [file]` merges them into the apps repo checkout named
by `APPS_DEV` — to read, commit and push, so everyone gets them with their next update.

## Writing one

1. Start from a folder in `pshiuu/agent-brain-apps`, or `brain app install x --from <dir>`
   while you build it — a local folder installs without a repo.
2. Name roles and playbooks for the app (`seo-writer`, not `writer`): names are global.
3. `brain app check <dir>` until it passes, then `brain app test <name>`.
