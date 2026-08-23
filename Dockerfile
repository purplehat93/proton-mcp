FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime

ARG VERSION=0.0.0

ENV NODE_ENV=production
WORKDIR /app

LABEL org.opencontainers.image.title="Proton MCP" \
      org.opencontainers.image.description="MCP server for Proton Mail via Proton Mail Bridge" \
      org.opencontainers.image.source="https://github.com/purplehat93/proton-mcp" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

COPY --from=builder --chown=65532:65532 /app/package.json ./package.json
COPY --from=builder --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=builder --chown=65532:65532 /app/dist ./dist

USER 65532:65532

# The distroless Node image provides the Node.js ENTRYPOINT.
CMD ["dist/index.js"]
