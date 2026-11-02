# The cockpit reads and writes the brain repo through a bind mount. It deliberately
# cannot reach `brain` or `sbx`: those are host binaries, so running a phase stays in
# the terminal and the UI renders the command to paste instead.
# Its own code is not copied in: it runs from the mounted brain, so `brain update` or an
# edit to ui/ needs no rebuild. public/ is read on every request; --watch restarts the
# server when server.mjs or brain.mjs change. An app's ui/ is served from the mount too.
FROM node:22-alpine
ENV HOST=0.0.0.0 PORT=7777 BRAIN_DIR=/brain DEV_MOUNT=/dev-projects NODE_ENV=production
EXPOSE 7777
CMD ["node", "--watch", "/brain/ui/server.mjs"]
