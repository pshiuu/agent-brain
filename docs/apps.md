# Apps

Domains packaged for the brain — install, update, what an app may declare — and the apps that exist today.

## Installing and updating apps

An app is a domain packaged for the brain: its roles, playbooks and skills in one folder.
Apps live in their own repo, one folder each (`APPS_SOURCE` in `system/brain.conf`, by
default `pshiuu/agent-brain-apps`), and install into `system/apps/<name>/`:

```bash
brain app install seo                         # from APPS_SOURCE
brain app install seo --from ~/code/apps seo  # from a local folder or any git URL
brain app update seo                          # the newer version, keeping this brain's changes
brain app                                     # what is installed, and from which commit
brain app check seo                           # the app-format rules
brain app remove seo                          # refused while a project is partway through it
brain app forget seo                          # after remove: its knowledge pages to memory/archive/
```

The same from the cockpit: **Admin → Apps** is a small app store — every app as a tile,
searchable, filtered by installed or available, and a page per app with its README, its
settings and Install, Update, Revert or Uninstall. `brain watch` checks the repo when it starts and when you
press the button (`brain app catalog` at a terminal), runs each change in the background,
then `brain sync-skills` and `sync-sandbox` as needed, and shows how it went. An app with
its own Studio code asks you to trust it; Uninstall asks once (twice when this brain changed it).
An app you or someone else wrote installs the same way: under **Install from a repo**, give
an `owner/repo` or a git URL and press Scan. `brain watch` clones it (private repos too, with
your git access) and lists every app in it, at its root or one folder down; they join the
grid, marked with where they come from. Installing one always asks for your trust, since its
`cli.sh` runs on your machine, and later updates come from that same repo.
Admin's Playbooks, Roles and Skills pages tag everything an app brought with the app it came
with, linked to its page. None of it can be deleted on its own, since the app's other parts
depend on it; uninstalling the app removes all of it, and `brain app remove` runs
`brain sync-skills` so its skills leave the sandbox store too.

The apps today: `seo` (articles), `web` (websites on PayloadCMS) and `academy` (theses
and papers, with commands of its own: `brain academy …`).

The brain looks into every installed app the way it looks into `system/` itself, so an
app's playbooks show up in `brain playbooks` and the cockpit, and its roles run like any
other. Nothing is copied into the base: removing the folder removes the app, and what its
projects taught the brain stays in `memory/`: removing an app only hides the knowledge
pages tagged with it, and `brain app forget <name>` moves the ones tagged with it alone to
`memory/archive/knowledge/` when you ask. An app may ship starter pages of its own in its
`knowledge/` folder; agents whose scope names the app read them, read-only. Install refuses an app that fails
`brain app check` (both halves of every role inside the app, every playbook clean, no
name the base or another app already uses), and asks before installing one that brings
its own Studio code. `system/apps/` is not in git; `system/apps.lock`, this brain's own and
ignored too, records where each app came from, so you can install the same ones again. The format is
`system/skills/app-format/SKILL.md`.

What your runs teach an app stays on your machine. `brain evolve`, Adjust playbook and the
Roles page change the installed copy in `system/apps/<name>/`, and the untouched copy in
`system/apps/.base/<name>/` is what it is compared with:

```bash
brain app diff seo                  # what this brain changed in the app
brain app revert seo [file]         # drop those changes
brain app update seo                # the new version, merged with yours; stops on a real conflict
brain app promote seo [file]        # app developers: into a checkout matching its installed source, to review
```

**What an app may declare.** Besides its roles, playbooks and skills, an app's `app.conf`
says what its sandboxes reach and what it needs from you:

```
mcp      dataforseo https://mcp.dataforseo.com/http           an MCP server its agents get
secret   dataforseo basic <check-url> DataForSEO API login     that server's key (basic or bearer)
setting  serp toggle on Live Google results                    a value its skills read
allow    api.openalex.org,doi.org                              hosts its sandboxes may reach
```

An app's `secret` and `setting` lines become a Settings section on its page in Admin → Apps. A key is checked at the check URL, stored by `brain watch` in sbx's secret store (the
agent never sees it) and only then goes into new sandboxes; settings land in
`system/config/<app>.conf`, outside the app's folder, so an update keeps them. `mcp` lines
without a secret and `allow` lines are registered by `brain sync-sandbox`, like those in
`system/sandbox.conf`.

`brain test` runs everything that says the brain works — the test suites, the lint,
every playbook check and every installed app's check and tests — in one go.

## Academy workspaces (theses, papers, research)

Playbooks run a project through phases to "done". A thesis is not that: it runs for
months, in many short tasks in no fixed order. The **academy** app is that second way of
working: `brain app install academy`, then `brain academy new <name>` and its verbs
(`find`, `ingest`, `ask`, `talk`, `draft`, `review`, `check`, `export`, …). Its README is
the manual. A workspace is its own git repo with `KIND=academy` in its `project.env`; the
playbook commands refuse it.

An app gets commands of its own this way: its `cli.sh` defines `cmd_<app>`, and
`brain <app> <verb>` sources it (`system/skills/app-format/`).

Admin → Memory draws the brain's own `knowledge/` as a graph.

## SEO, AEO and GEO content

Two playbooks, four roles and one skill that they share. Each article is a project.

| Playbook | Steps (**you** = a gate in the cockpit) |
|---|---|
| `seo-article` | research → outline → **you** → images → draft → editor check ⇄ writer → **you** → retro |
| `aeo-refresh` | research: the live page, and a plan per section → **you** → rewrite → editor check ⇄ writer → **you** → retro |

- **Roles**: `seo-researcher` (what ranks, what people ask, a primary source per number),
  `seo-writer` (outline, article and every fix round, in the client's voice),
  `seo-reviewer` (the editor check — it never edits), `image-researcher`. `retro` is
  shared with every path; each playbook's `## retro` names what it should learn.
- **Inputs**: keyword, language, audience, angle, pages to beat — per article. Website,
  market, author, tone of voice, texts in their voice, competitors — once per client,
  the same labels in both playbooks, so a client is entered once.
- **The article** is `memory/projects/<name>/content/article.md`, in the format
  the SEO app's `skills/seo-content/SKILL.md` fixes: front matter for the CMS fields, a 50-word
  opening answer, question headings answered at once, a `## FAQ`, a link beside every
  number, images with a licence.
- **The editor check** is half script, half judgement. `article.mjs check` measures
  (✓ / ! / ✗ per check, exit 1 on a ✗): the keyword, meta lengths, headings, length
  against the research, internal links, alt text and licences, the opening answer, the
  FAQ, sourced numbers, author and date, dead links. The writer runs it before handing
  over, the reviewer runs it, and `contracts/editor-check` runs it again after a PASS or
  a fix, so neither can hand over an article it fails. The reviewer judges the rest:
  coverage, intent, every fact against its source, the voice.
- **Webflow** by copy and paste: a project with an article has a **Copy** tab with a
  Copy button per field, the body copied as rich text, the images to upload with their
  alt text and credit, tables as Embeds, and the Article + FAQPage JSON-LD. It is rebuilt
  from the file on every open. Approve the final gate once it is in Webflow.
- **Images**: royalty-free, from Openverse and Wikimedia Commons (no API key): CC0,
  public domain, CC BY and CC BY-SA, never NC or ND, licence confirmed on the source page,
  the file URL recorded rather than downloaded.
- **DataForSEO** is optional. Without it the research uses web search and writes
  volume and difficulty as `unknown`. Connect it on the app's page, **Admin → Apps → SEO & content**,
  in the Settings section its `app.conf` generates (see "What an app may declare"): the API login and password
  (from the API Access tab) are checked against DataForSEO, then `brain watch` stores them in
  sbx's secret store, registers the server and loads it into the sandboxes that exist. The
  key is never written to a file in the brain. The same page switches each use on or off —
  volume and difficulty, the live SERP, what AI engines answer — in `system/config/seo.conf`;
  a use that is off is researched as if DataForSEO were not connected.

`APPS_DEV` can list checkouts separated by spaces or colons. Promotion matches each
checkout’s origin against the app’s recorded source, and refuses unrelated or
ambiguous matches. An app installed from a local checkout promotes back there.
