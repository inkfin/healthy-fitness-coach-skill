# Build from the repository root.
FROM node:22-bookworm-slim
WORKDIR /app/mcp/xunji
COPY healthy-fitness-coach-plugin/mcp/xunji/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY healthy-fitness-coach-plugin/mcp/xunji/src ./src
COPY healthy-fitness-coach-plugin/skills /app/skills
ENV XUNJI_CREDENTIAL_FILE=/run/secrets/xunji-api-key \
    XDG_DATA_HOME=/data
RUN mkdir -p /data && chown node:node /data
USER node
# Local stdio only; no network listener.
ENTRYPOINT ["node", "/app/mcp/xunji/src/server.js"]
