# Multi-stage Dockerfile for @carbon-cashmere/x402-mcp
# Designed for stdio MCP transport — Glama / MCP marketplaces can introspect
# the tool catalog without any required env vars (discovery-only mode).
#
# Build:   docker build -t carbon-cashmere/x402-mcp .
# Run:     docker run --rm -i \
#            -e EVM_PRIVATE_KEY=0x... \
#            carbon-cashmere/x402-mcp

# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Strip dev dependencies after build
RUN npm prune --omit=dev

# ---- Runtime ----
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json LICENSE README.md ./

# stdio MCP transport — stdin/stdout are the protocol channel; stderr is logs.
ENTRYPOINT ["node", "dist/index.js"]
