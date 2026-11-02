# Setup

Installing a brain on a Mac, what it puts where, sandboxes with or without sbx, and the upkeep: templates and disk space.

## Installing

On a Mac with Docker Desktop, from the repo:

```bash
./install.sh              # safe to run again; ./install.sh --uninstall stops it all
```

It checks for git, Docker Desktop and `sbx` (and offers `brew install --cask sbx`),
runs `brain init`, installs `brain watch` as a login item, builds and starts the cockpit
container on the first free port from 7777, opens it, and offers to put this repo's
`bin/` on your PATH. What it cannot do for you: `sbx login`, and the engines' keys —
`sbx secret set anthropic` (and `openai` for Codex), or sign in when the first run asks.

Only the cockpit is a container. `bin/brain` stays on the Mac: it drives `sbx`, which
starts the sandboxes, and opens Terminal windows, and neither works from inside one.
`brain` works on the repo it lives in (or `$BRAIN`), so a second brain on the same Mac
gets its own watcher, its own cockpit and its own port.

By hand, the same thing:

Prerequisites: `sbx` installed and logged in (`sbx login`), and Docker Desktop
running (only needed to build the templates).

```bash
# 1. put the repo in place and add the launcher to your PATH
mv agent-brain ~/agent-brain
echo 'export PATH="$HOME/agent-brain/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc

# 2. say how you like to work (working style, taste — no stack here)
open ~/agent-brain/memory/preferences.md

# 3. build + load both templates, import skills, init git
brain init
```

`brain init` builds `brain-claude:v1` and `brain-codex:v1`, loads them into sbx,
links `system/skills/*` into `~/.agents/skills` and runs `sbx skills import`. At the
end it reminds you to write your first playbook, since `system/playbooks/` starts
empty.

External skills (public or private repos) are listed in `system/skills.list` and
installed by `brain init` / `brain sync-skills`:

```
owner/repo                                    # no names = every skill in it
Leonxlnx/taste-skill design-taste-frontend redesign-existing-projects
https://github.com/YOUR-ORG/YOUR-SKILLS.git html-to-payload
keep: some-skill-you-installed-by-hand       # keep it, don't prune it
```

sbx clones on your Mac with your own git credentials, so a private repo works over
HTTPS once `gh auth setup-git` has run, or over SSH (`git@github.com:…`). The name
after the repo is the `name:` in that skill's `SKILL.md`, which is often not its folder
name. A `keep:` line is not installed from anywhere — it just protects a skill already
in the store from the prune step below.

Check with `sbx skills ls`; update later with `sbx skills update`. `BRAIN_PRUNE_SKILLS=0`
turns the pruning off.

### MCP servers and network rules

`system/sandbox.conf` declares what every sandbox gets beyond skills: MCP servers
and network policy. `brain sync-sandbox` (and `brain init`) applies it.

```
mcp github --url https://api.githubcopilot.com/mcp/   # registered + attached to new sandboxes
deny pastebin.com,*.ngrok.io                          # egress is allow-all by default
allow *.npmjs.org                                     # needed once you narrow that
```

The MCP set is fixed when a sandbox is created, so a server added later reaches
existing sandboxes only via `sbx mcp load <name> --sandbox <sandbox>` (or by
deleting the sandbox and letting `brain run` rebuild it). Policy rules apply to
all sandboxes immediately and are idempotent — re-syncing changes nothing.
Check with `sbx mcp ls` and `sbx policy ls --wide`.

## Choosing the agents

`./install.sh` asks the first time how sandboxes run (`sbx` or Docker; an Intel Mac gets
Docker) and which agents you use. Only those get a sandbox image (a few GB each), and
the cockpit only offers those for a role. The answers are `BRAIN_SANDBOX` and
`BRAIN_ENGINES` in `system/brain.local.conf`; `./install.sh --choose` asks again, and
`./install.sh --sandbox docker --agents claude,codex` answers from a script.

```bash
brain engine                  # every agent the brain knows, and which are installed
brain engine add gemini       # build its image and offer it to roles
brain engine remove codex     # refused while a role still runs on it
```

| agent | runs | signs in with | model | effort |
|---|---|---|---|---|
| `claude` | Claude Code | `brain secret set anthropic [--oauth]`: API key or Pro/Max | `opus`, `sonnet`, … | yes |
| `codex` | Codex | `brain secret set openai [--oauth]`: API key or ChatGPT | from Codex's catalog | yes |
| `gemini` | Gemini CLI | `brain secret set google`: a Gemini API key | `gemini-2.5-pro`, … | no |
| `opencode` | OpenCode | the providers' keys: `anthropic`, `openai`, `google` | `provider/model` | no |

The list is `system/engines.conf`: each agent's Docker Sandboxes template, where its role
instructions go, and the efforts it takes. A role reaches every agent before its first
token — Claude as a system prompt, the others as the file each reads from its home first
(`~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.config/opencode/AGENTS.md`). Under the
Docker driver each agent's traffic goes through the egress proxy, which puts the key in;
a Google subscription sign-in for Gemini, and subscriptions through OpenCode, are not
supported there (use an API key, or sbx).

## Sandboxes without sbx: the Docker driver

`sbx` gives every sandbox a VM with its own kernel, and it is what the brain uses wherever
it is installed. It needs Apple silicon (or Windows 11 x64, or Linux with KVM), so on an
**Intel Mac** — or when you would rather not install it — the brain runs the same sandboxes
on plain Docker. `install.sh` picks this on its own when `sbx` is missing; to choose,
set `BRAIN_SANDBOX=sbx`, `docker` or `auto` (the default: `sbx` when it is on PATH) in
`system/brain.local.conf`.

Nothing else changes: `bin/sbx-docker` answers the `sbx` commands the brain uses, so
`brain run`, `brain auto`, `brain up`, the cockpit and the apps work as they do with `sbx`.

### Signing the engines in: API key or subscription

The same commands under both drivers:

```bash
brain secret set anthropic           # a Claude API key
brain secret set anthropic --oauth   # or your Claude Pro / Max subscription
brain secret set openai              # an OpenAI API key
brain secret set openai --oauth      # or your ChatGPT subscription, for Codex
```

Under `sbx` these are `sbx secret set … [--oauth]`: sbx signs you in on the Mac and its
proxy keeps the token. The Docker driver does the same thing its own way, and in both the
token never enters a sandbox:

- **Claude subscription**: `claude setup-token` runs in a throwaway container — sign in in
  the browser, paste the token it prints. It lasts a year. The proxy sends it as the bearer
  token; Claude Code in the sandbox holds a placeholder.
- **ChatGPT subscription**: `codex login --device-auth` runs in a throwaway container — open
  the link, enter the code. The proxy keeps the tokens (`~/.agent-brain/oauth/`) and
  refreshes them; Codex in the sandbox holds placeholders with your account's details, and
  its own refresh requests come to the proxy.
- These are sign-ins of their own, separate from Claude Code or Codex on your Mac, so
  neither logs the other out. An API key, when one is stored, is used first.

What keeps a sandbox in, without a VM of its own:

| | |
|---|---|
| network | each sandbox is on an internal Docker network of its own — no route out, and no way to another sandbox. Its only way out is the `brain-egress` proxy (`bin/docker/egress.mjs`), which applies the `allow` / `deny` rules from `sandbox.conf` and the apps, and never connects to this Mac or its network (the cockpit, `host.docker.internal`, `10.*`, `192.168.*`…) unless an `allow` line names that host |
| keys | API keys and subscription tokens are stored in `~/.agent-brain/` and read only by the proxy, which puts them into requests to Anthropic, OpenAI (ChatGPT for a subscription) and the apps' MCP servers. A sandbox holds a placeholder |
| privileges | every capability dropped and `no-new-privileges`, so no `sudo`: an agent cannot `apt-get install` here as it can under sbx. Put a tool it always needs into `templates/Dockerfile` |
| Docker | there is no Docker inside. An agent's `docker compose …` becomes a request that `brain watch` runs on this Mac after `bin/docker/stack.mjs` checked it: no privileged service, no capabilities or devices, no host network or PID namespace, no bind mount, build context, env file or secret from outside the project, no Docker socket. The services share the sandbox's network, so `localhost:<port>` and service names work as before; `docker run` and the rest are refused |
| files | the project, `system/` (read-only) and `memory/` are mounted, as under sbx; the skill store read-only |

What it does not have is a kernel of its own per sandbox: Docker Desktop puts one VM
between all the sandboxes and the Mac, not one between each sandbox and the next. On a Linux
server, run them under gVisor (`BRAIN_DOCKER_RUNTIME=runsc`) to get that boundary back.

Things to know:

- `brain watch` must be running for an agent's `docker compose` (it is a login item after
  `install.sh`). Without it the command waits 30 seconds and says so.
- A stack's own containers have no internet; Docker pulls and builds their images on the
  Mac. Give Docker Desktop enough memory (Settings → Resources), since every sandbox and
  its stack share that VM.
- The store (`~/.agent-brain`: secrets, MCP servers, policy, skills) is per user, like
  sbx's, and shared by every brain on the Mac.
- `node test/docker.mjs` checks the stack rules and the proxy without Docker.

## Updating the template

`brain init` never bumps anything: it reads `templates/VERSION` and builds
`brain-<engine>:<that version>`. The file is yours to edit.

**Rebuilding the same version** (the usual case, for an additive change like a new
`templates/bin/` script) replaces the tag. Two things follow: the previous image loses
its tag and becomes a dangling `<none>` — that is where most of Docker's "reclaimable"
space in a brain comes from — and **existing sandboxes keep the image they were created
from**. `ensure_sandbox` passes the tag only when creating one. To pull a change into a
sandbox that already exists, delete it and let the next `brain run` rebuild it:

```bash
sbx rm --force <project>-<engine>     # ~6s to recreate, nothing is lost:
                                      # memory, system and the code are host mounts
```

**Bumping to `v2`** is the deliberate break: new projects get v2, running projects keep
v1 until their sandbox is deleted. It also means two ~5 GB images in Docker and two in
sbx's store until you remove the old one by hand:

```bash
docker image rm brain-claude:v1 brain-codex:v1
sbx template rm brain-claude:v1       # and brain-codex:v1
```

Bump when a change would break a project mid-flight; rebuild in place when it would not.

## Disk space

A brain is not small, and it is stored twice: `brain init` builds a Docker image and
then loads a copy into sbx's own containerd store. On the machine this was written on,
`brain-claude:v1` and `brain-codex:v1` are 4.7 and 5.0 GB in Docker, with ~6.5 GB in
`~/Library/Application Support/com.docker.sandboxes`.

**Sandboxes are nearly free.** They share the template's layers and add only their own
writable diff, which is why one costs ~6 s to create. The exception is anything
installed *inside* one — `brain-crawl` pulling crawl4ai is 730 MB in that sandbox alone.

What actually stacks up: template versions you keep, per-sandbox installs, and ordinary
Docker leftovers.

```bash
docker image prune        # dangling <none> only — the orphans left by rebuilds
docker builder prune      # build cache; costs you a slower next build
sbx prune                 # stopped sandboxes; each is ~6s to recreate
```

**`docker image prune -a` is not one of these.** It deletes every image no container
references, and a brain image has no container — sbx runs from its own store — so it
takes out both templates along with anything else you have pulled but are not running
right now. A *stopped* container does protect its image, so databases you restart
survive; `docker container prune` removes those containers and with them that
protection. `docker volume prune` can delete database data from containers you removed.

## Things to check on first run

These depend on sbx behavior that changes quickly (kits/skills are experimental):

- `sbx ls` output: `brain` expects the sandbox name in the first column after a
  header line. If sandboxes get re-created every run, adjust `sandbox_exists` in `bin/brain`.
- Mounts: `system` (read-only) and `memory` (read-write) go in as extra workspaces on
  the `sbx create` line, in its `HOST:ro` form, and land on the same path they have on
  your Mac — which is what `$BRAIN_SYSTEM` and `$BRAIN_MEMORY` point at. `sbx mount`
  takes a different spec (`HOST:CTR_TARGET:ro`), so if you add a mount by hand, give it
  the target path twice. Check one with
  `sbx exec <sandbox> -- touch $BRAIN_SYSTEM/x` — it must fail read-only.
- If template builds or in-sandbox installs fail on downloads, allow the domain:
  `sbx policy allow network <domain>`.
- If you don't have Docker Desktop: `sbx run claude`, install Playwright/graphify
  inside by hand, then `sbx template save <sandbox> brain-claude:v1` (same for codex).
