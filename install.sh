#!/usr/bin/env bash
# One-time setup of this brain on a Mac. Safe to run again: each step checks first.
#
#   ./install.sh              check what it needs, build the sandbox templates, start
#                             `brain watch` at login and the cockpit in Docker, open it.
#                             The first time it asks how sandboxes run and which agents
#                             you use; after that it keeps the answers (brain update runs
#                             it again and asks nothing)
#   ./install.sh --choose     ask both again
#   ./install.sh --sandbox sbx|docker --agents claude,codex   the answers, for a script
#   ./install.sh --uninstall  stop the watcher and the cockpit; every file stays
#
# What runs where: the cockpit is a container (Docker Desktop restarts it). The engine,
# bin/brain, stays on the Mac — it drives sbx and opens Terminal windows, which nothing
# inside a container can do — and launchd keeps `brain watch` running.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
say() { printf '▸ %s\n' "$*"; }
stop() { printf '✗ %s\n' "$*" >&2; exit 1; }
ask() { [ -t 0 ] || return 1; local a; read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy] ]]; }
dc() { docker compose --project-directory "$REPO" "$@"; }
env_get() { [ -f "$REPO/.env" ] && sed -n "s/^$1=//p" "$REPO/.env" | tail -1 || true; }
in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
brain() { BRAIN="$REPO" DEV_DIR="$DEV_DIR" "$REPO/bin/brain" "$@"; }

choose="" want_sandbox="" want_agents=""
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) uninstall=1; shift ;;
    --choose) choose=1; shift ;;
    --sandbox) want_sandbox="${2:?--sandbox needs sbx or docker}"; shift 2 ;;
    --agents) want_agents="$(printf '%s' "${2:?--agents needs a list}" | tr ',' ' ')"; shift 2 ;;
    *) stop "unknown option $1 (--choose, --sandbox sbx|docker, --agents a,b, --uninstall)" ;;
  esac
done

if [ -n "${uninstall:-}" ]; then
  DEV_DIR="$(env_get DEV_DIR)"; DEV_DIR="${DEV_DIR:-$HOME/dev}"
  brain watch uninstall
  dc down 2>/dev/null || say "the cockpit was not running"
  say "stopped. The repo, memory/, your projects and the sandbox templates are untouched."
  exit 0
fi

# ---- what it needs ------------------------------------------------------------------
[ "$(uname -s)" = Darwin ] || stop "this brain runs on macOS: brain watch opens Terminal windows and launchd keeps it running"
command -v git >/dev/null || stop "git is missing. Install it with: xcode-select --install"
command -v docker >/dev/null || stop "Docker Desktop is missing. Install it from https://www.docker.com/products/docker-desktop/ and open it once."
if ! docker info >/dev/null 2>&1; then
  say "starting Docker Desktop"
  open -a Docker 2>/dev/null || true
  for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || stop "Docker Desktop did not come up. Start it, then run ./install.sh again."
fi
# ---- your choices: how sandboxes run, which agents --------------------------------
# Asked the first time (or with --choose) and kept in system/brain.local.conf.
DEV_DIR="${DEV_DIR:-$(env_get DEV_DIR)}"; DEV_DIR="${DEV_DIR:-$HOME/dev}"
known="$(awk '$1 !~ /^#/ && NF >= 5 { print $1 }' "$REPO/system/engines.conf")"
label() { awk -v e="$1" '$1 == e { $1 = $2 = $3 = $4 = ""; sub(/^ +/, ""); print }' "$REPO/system/engines.conf"; }
# First means a brain installed for the first time. One installed before these questions
# existed (it has .env) keeps what it had — Claude and Codex, sbx or not — and is not asked.
first=""; [ -n "$(brain config get BRAIN_ENGINES)" ] || [ -f "$REPO/.env" ] || first=1
arch="$(uname -m)"

# Sandboxes. sbx gives each sandbox a VM of its own and needs Apple silicon; the Docker
# driver (bin/sbx-docker) runs them as hardened containers behind an egress proxy, on any
# Mac (docs/setup.md, "Sandboxes without sbx").
sandbox="$want_sandbox"
if [ -z "$sandbox" ] && { [ -n "$first" ] || [ -n "$choose" ]; }; then
  if [ "$arch" != arm64 ]; then
    say "this is an Intel Mac: sbx does not run here, so sandboxes run on plain Docker"
    sandbox=docker
  elif [ -t 0 ]; then
    echo
    echo "How should the agents' sandboxes run?"
    echo "  1) sbx     a VM of its own for each sandbox, agents may use sudo  (recommended)"
    echo "  2) docker  hardened containers behind an egress proxy that holds the keys"
    read -r -p "1 or 2 [1] " a
    case "$a" in 2|docker) sandbox=docker ;; *) sandbox=sbx ;; esac
  else
    sandbox=auto
  fi
fi
if [ -n "$sandbox" ]; then
  case "$sandbox" in sbx|docker|auto) ;; *) stop "--sandbox is sbx or docker, not '$sandbox'" ;; esac
  brain config set BRAIN_SANDBOX "$sandbox"
fi
sandbox="$(brain config get BRAIN_SANDBOX)"; sandbox="${sandbox:-auto}"
if [ "$sandbox" = sbx ] || { [ "$sandbox" = auto ] && [ "$arch" = arm64 ]; }; then
  if ! command -v sbx >/dev/null; then
    if command -v brew >/dev/null && { [ "$sandbox" = sbx ] || ask "sbx (Docker Sandboxes, a VM per sandbox) is missing. Install it with Homebrew now? (no: use plain Docker)"; }; then
      brew install --cask sbx
    elif [ "$sandbox" = sbx ]; then
      stop "sbx is missing. Install it with: brew install --cask sbx — or run ./install.sh --sandbox docker"
    fi
  fi
fi
command -v sbx >/dev/null || [ "$sandbox" = docker ] || say "sandboxes run on plain Docker: sbx is not installed"

# Agents. Only the chosen ones are built (several GB each); brain engine add <name> adds one later.
agents="$want_agents"
if [ -z "$agents" ] && { [ -n "$first" ] || [ -n "$choose" ]; }; then
  if [ -t 0 ]; then
    echo
    echo "Which agents will you use? Each gets its own sandbox image; add more later with: brain engine add <name>"
    i=0; for e in $known; do i=$((i + 1)); printf '  %d) %-9s %s\n' "$i" "$e" "$(label "$e")"; done
    cur="$(brain config get BRAIN_ENGINES)"
    read -r -p "numbers or names, separated by spaces [${cur:-claude}] " a
    a="${a:-${cur:-claude}}"
    for x in $(printf '%s' "$a" | tr ',' ' '); do
      case "$x" in *[!0-9]*) e="$x" ;; *) e="$(printf '%s\n' $known | sed -n "${x}p")" ;; esac
      printf '%s\n' $known | grep -qx "$e" || stop "'$x' is not one of: $(printf '%s ' $known)"
      agents="$agents $e"
    done
  else
    agents=claude
  fi
fi
if [ -n "$agents" ]; then
  for e in $agents; do printf '%s\n' $known | grep -qx "$e" || stop "'$e' is not an agent the brain knows: $(printf '%s ' $known)"; done
  brain config set BRAIN_ENGINES "$(printf '%s\n' $agents | awk '!seen[$0]++' | paste -sd' ' -)"
fi
say "sandboxes: $(sb="$(brain config get BRAIN_SANDBOX)"; echo "${sb:-auto}")   agents: $(ag="$(brain config get BRAIN_ENGINES)"; echo "${ag:-claude codex}")"

# ---- settings for compose -----------------------------------------------------------
mkdir -p "$DEV_DIR" "$REPO/.runs"
# Keep the port the cockpit already has; otherwise the first free one from 7777, so a
# second brain on this Mac sits next to the first instead of failing to start.
port="$(dc port cockpit 7777 2>/dev/null | sed -n 's/.*://p' | head -1 || true)"
if [ -z "$port" ]; then
  port="$(env_get COCKPIT_PORT)"; port="${port:-7777}"
  while in_use "$port"; do port=$((port + 1)); done
fi
# Without Codex there is no catalog to mount, and a missing source makes Docker create a
# folder in its place — exactly where Codex would later write this file.
models="${CODEX_HOME:-$HOME/.codex}/models_cache.json"
if [ ! -f "$models" ]; then
  models="$REPO/.runs/no-codex-models.json"
  [ -f "$models" ] || echo '{}' > "$models"
fi
cat > "$REPO/.env" <<EOF
# Written by install.sh for docker compose. Run ./install.sh again instead of editing.
BRAIN=$REPO
DEV_DIR=$DEV_DIR
COCKPIT_PORT=$port
CODEX_MODELS=$models
EOF

# ---- the engine on the Mac ----------------------------------------------------------
say "sandbox templates, skills and sandbox rules (the first time takes a few minutes)"
command -v sbx >/dev/null && say "if sbx asks you to sign in: run  sbx login  and then ./install.sh again"
brain init
brain watch install

# ---- signing the agents in -----------------------------------------------------------
# Only when the choices were just made: a re-run or an update has them signed in already.
signin() { # agent
  local a
  case "$1" in
    claude|codex)
      local svc; [ "$1" = claude ] && svc=anthropic || svc=openai
      read -r -p "Sign $1 in now? [s]ubscription / [k] API key / [l]ater: " a
      case "$a" in s*|S*) brain secret set "$svc" --oauth || say "later: brain secret set $svc --oauth" ;;
        k*|K*) brain secret set "$svc" || say "later: brain secret set $svc" ;; *) say "later: brain secret set $svc [--oauth]" ;; esac ;;
    gemini) ask "Store a Gemini API key now?" && brain secret set google || say "later: brain secret set google" ;;
    opencode) say "OpenCode uses the providers' API keys: brain secret set anthropic | openai | google (a model is then provider/model)" ;;
  esac
}
if { [ -n "$first" ] || [ -n "$choose" ] || [ -n "$want_agents" ]; } && [ -t 0 ]; then
  for e in $(brain config get BRAIN_ENGINES); do signin "$e"; done
fi

# ---- the cockpit in Docker ----------------------------------------------------------
say "building and starting the cockpit"
dc up -d --build
url="http://127.0.0.1:$port"
for _ in $(seq 30); do curl -fsS "$url/api/state" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$url/api/state" >/dev/null 2>&1 || stop "the cockpit did not answer at $url — see: docker compose --project-directory '$REPO' logs cockpit"

# ---- the terminal command, for whoever administers it -------------------------------
here="$(type -P brain || true)"   # the PATH only: brain() above is a function
line="export PATH=\"$REPO/bin:\$PATH\""
rc="$HOME/.zshrc"; [ "${SHELL##*/}" = bash ] && rc="$HOME/.bash_profile"
if [ "$here" = "$REPO/bin/brain" ] || grep -qxF "$line" "$rc" 2>/dev/null; then :
elif [ -z "$here" ] || ask "'brain' in your terminal is another brain ($here). Make it this one?"; then
  printf '\n# agent-brain: %s\n%s\n' "$REPO" "$line" >> "$rc"
  say "added $REPO/bin to your PATH in $rc (new terminal windows)"
fi

open "$url" 2>/dev/null || true
cat <<EOF

✓ Installed. The cockpit is at $url

  Running now, and again after every login:
    brain watch   starts the runs the cockpit asks for (launchd; log: $REPO/.runs/watch.log)
    cockpit       Docker Desktop restarts it; keep "start Docker Desktop when you sign in" on

  Agents: $(brain config get BRAIN_ENGINES)   (more: brain engine add gemini | opencode | …)
  Signing one in, now or later:
    brain secret set anthropic --oauth   your Claude subscription (an API key: leave out --oauth),
    brain secret set openai --oauth      your ChatGPT subscription for Codex,
    brain secret set google              a Gemini API key
    The first run asks to let brain control Terminal — allow it.

  Optional: an app's keys (DataForSEO for the seo app) — Admin → Apps in the Studio.
EOF
