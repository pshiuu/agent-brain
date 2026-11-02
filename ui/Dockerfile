# The cockpit reads and writes the brain repo through a bind mount. It deliberately
# cannot reach `brain` or `sbx`: those are host binaries, so running a phase stays in
# the terminal and the UI renders the command to paste instead.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs brain.mjs ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=7777 BRAIN_DIR=/brain DEV_MOUNT=/dev-projects NODE_ENV=production
EXPOSE 7777
CMD ["node", "server.mjs"]
