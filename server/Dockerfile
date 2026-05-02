# SimplePost server — Node.js LTS on Alpine.
# Build context must be the workspace root so the SDK and yarn workspace state are reachable:
#   docker build -t simple-post-server -f server/Dockerfile .
FROM node:20-alpine

RUN yarn global add pm2

WORKDIR /app

# Workspace metadata
COPY package.json yarn.lock .yarnrc.yml* tsconfig.json ./
COPY .yarn ./.yarn

# SDK package metadata (installed as a workspace dependency before the source is copied)
COPY sdk/package.json ./sdk/package.json
COPY sdk/tsconfig.json ./sdk/tsconfig.json
COPY sdk/tsup.config.ts ./sdk/tsup.config.ts

# Server package metadata
COPY server/package.json ./server/package.json
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/tsup.config.ts ./server/tsup.config.ts
COPY server/pm2.config.cjs ./server/pm2.config.cjs

RUN yarn install

# Build the SDK first; the server compiles against its emitted types.
COPY sdk/src ./sdk/src
RUN yarn workspace @simple-post/sdk build

# Build the server (includes config/, services/, routes/, utils/, middleware/).
COPY server/src ./server/src
RUN yarn workspace @simple-post/server build

# Runtime layout:
#   /config/accounts.json — bind-mount your accounts file here (read-only is fine)
#   /data                 — persistent volume for uploaded media
RUN mkdir -p /config /data

# Drop privileges
RUN addgroup -g 1001 -S nodejs \
 && adduser -S simplepost -u 1001 \
 && chown -R simplepost:nodejs /app /config /data

USER simplepost

WORKDIR /app/server

# Defaults — override at run time as needed.
# SIMPLE_POST_API_KEY and SIMPLE_POST_PUBLIC_URL must be supplied by the caller.
ENV SIMPLE_POST_ACCOUNTS_FILE=/config/accounts.json \
    SIMPLE_POST_STORAGE_DIR=/data \
    PORT=3000

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["pm2-runtime", "start", "pm2.config.cjs"]
