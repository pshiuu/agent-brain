#!/usr/bin/env bash
# One-time setup of this brain on a Mac. Safe to run again: each step checks first.
#
#   ./install.sh              check what it needs, build the sandbox templates, start
#                             `brain watch` at login and the cockpit in Docker, open it
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

if [ "${1:-}" = --uninstall ]; then
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
# Sandboxes: sbx (a VM each) where it runs, plain Docker where it does not. sbx needs Apple
# silicon; on an Intel Mac, or when you would rather not install it, bin/sbx-docker runs the
# same sandboxes as hardened containers behind an egress proxy (docs/setup.md).
if ! command -v sbx >/dev/null; then
  if [ "$(uname -m)" = arm64 ] && command -v brew >/dev/null \
     && ask "sbx (Docker Sandboxes, a VM per sandbox) is missing. Install it with Homebrew now? (no: use plain Docker)"; then
    brew install --cask sbx
  else
    say "sandboxes run on plain Docker (BRAIN_SANDBOX=docker)$([ "$(uname -m)" = arm64 ] || echo ': sbx does not run on an Intel Mac')"
  fi
fi

# ---- settings for compose -----------------------------------------------------------
DEV_DIR="${DEV_DIR:-$(env_get DEV_DIR)}"; DEV_DIR="${DEV_DIR:-$HOME/dev}"
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

  Once, before the first run:
    brain secret set anthropic      the Claude key every sandbox uses (or sign in when
                                    the first run asks), and  brain secret set openai  for Codex
    The first run asks to let brain control Terminal — allow it.

  Optional: an app's keys (DataForSEO for the seo app) — Admin → Apps in the Studio.
EOF
