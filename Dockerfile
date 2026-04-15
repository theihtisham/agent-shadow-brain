FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production image
FROM node:20-alpine

LABEL org.opencontainers.image.title="Agent Shadow Brain"
LABEL org.opencontainers.image.description="Real-time intelligence layer for AI coding agents"
LABEL org.opencontainers.image.source="https://github.com/theihtisham/agent-shadow-brain"
LABEL org.opencontainers.image.author="theihtisham"

RUN apk add --no-cache git

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/README.md ./
COPY --from=builder /app/LICENSE ./

RUN npm ci --omit=dev

# Configurable via environment variables
ENV SHADOW_BRAIN_PROVIDER=ollama
ENV SHADOW_BRAIN_MODEL=llama3
ENV SHADOW_BRAIN_PERSONALITY=balanced
ENV SHADOW_BRAIN_DEPTH=standard
ENV SHADOW_BRAIN_PORT=7341
ENV SHADOW_BRAIN_MCP_PORT=7342
ENV SHADOW_BRAIN_AUTO_INJECT=true

# Mount your project here
VOLUME /workspace
WORKDIR /workspace

EXPOSE 7341 7342

ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["start", "/workspace"]
