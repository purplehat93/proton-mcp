FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:20-bookworm-slim AS runtime

ARG VERSION=0.0.0

ENV NODE_ENV=production
WORKDIR /app

LABEL org.opencontainers.image.title="Proton MCP" \
      org.opencontainers.image.description="MCP server for Proton Mail via Proton Mail Bridge" \
      org.opencontainers.image.source="https://github.com/purplehat93/proton-mcp" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

ENTRYPOINT ["node", "dist/index.js"]
