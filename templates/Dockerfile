# Sandbox template for the agent brain.
# Built twice by `brain init`: once on the Claude base, once on the Codex base.
ARG BASE=claude-code-docker
FROM docker/sandbox-templates:${BASE}

# Keep this in sync with the @playwright/test version your projects use,
# otherwise the agent has to download a matching browser again.
ARG PLAYWRIGHT_VERSION=1.63.0
ARG GRAPHIFY_VERSION=0.9.4

# --- system packages (root) ---------------------------------------------
USER root
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install-deps chromium \
 && apt-get install -y --no-install-recommends jq ripgrep \
 && rm -rf /var/lib/apt/lists/*
COPY bin/ /usr/local/bin/
RUN chmod +x /usr/local/bin/brain-*

# --- user tools (agent) --------------------------------------------------
USER agent
# Playwright installed globally so skill scripts can require() it, plus its Chromium build
RUN npm install -g playwright@${PLAYWRIGHT_VERSION} \
 && "$(npm prefix -g)/bin/playwright" install chromium
# uv + graphify (PyPI package is "graphifyy", the command is "graphify")
RUN curl -LsSf https://astral.sh/uv/install.sh -o /tmp/uv.sh \
 && sh /tmp/uv.sh \
 && "$HOME/.local/bin/uv" tool install "graphifyy==${GRAPHIFY_VERSION}"
# /etc/sandbox-persistent.sh is sourced before every shell in the sandbox
RUN printf '%s\n' \
  'export PATH="$HOME/.local/bin:$PATH"' \
  'export NODE_PATH="$(npm root -g 2>/dev/null)"' \
  >> /etc/sandbox-persistent.sh
