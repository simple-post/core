# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.14.0
ARG UBUNTU_VERSION=24.04
ARG DISTROLESS_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
ENV NODE_ENV=development
COPY package.json yarn.lock .yarnrc.yml tsconfig.json ./
COPY .yarn ./.yarn
COPY sdk/package.json ./sdk/package.json
COPY scheduler/package.json ./scheduler/package.json
COPY server/package.json ./server/package.json
COPY cli/package.json ./cli/package.json
COPY examples/package.json ./examples/package.json
COPY scheduler/prisma ./scheduler/prisma
RUN yarn install --immutable

FROM deps AS builder
COPY sdk ./sdk
COPY scheduler ./scheduler
RUN yarn workspace @simple-post/sdk build
RUN yarn workspace @simple-post/scheduler build

FROM ${DISTROLESS_IMAGE} AS runtime-distroless
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=deps --chown=nonroot:nonroot /app/scheduler/node_modules ./scheduler/node_modules
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json
COPY --from=builder --chown=nonroot:nonroot /app/sdk/package.json ./sdk/package.json
COPY --from=builder --chown=nonroot:nonroot /app/sdk/dist ./sdk/dist
COPY --from=builder --chown=nonroot:nonroot /app/scheduler/package.json ./scheduler/package.json
COPY --from=builder --chown=nonroot:nonroot /app/scheduler/next.config.mjs ./scheduler/next.config.mjs
COPY --from=builder --chown=nonroot:nonroot /app/scheduler/public ./scheduler/public
COPY --from=builder --chown=nonroot:nonroot /app/scheduler/data ./scheduler/data
COPY --from=builder --chown=nonroot:nonroot /app/scheduler/.next ./scheduler/.next
USER nonroot:nonroot
WORKDIR /app/scheduler
EXPOSE 3000
CMD ["../node_modules/next/dist/bin/next", "start"]

FROM ubuntu:${UBUNTU_VERSION} AS runtime-ubuntu
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs nextjs
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nextjs:nodejs /app/scheduler/node_modules ./scheduler/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/sdk/package.json ./sdk/package.json
COPY --from=builder --chown=nextjs:nodejs /app/sdk/dist ./sdk/dist
COPY --from=builder --chown=nextjs:nodejs /app/scheduler/package.json ./scheduler/package.json
COPY --from=builder --chown=nextjs:nodejs /app/scheduler/next.config.mjs ./scheduler/next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scheduler/public ./scheduler/public
COPY --from=builder --chown=nextjs:nodejs /app/scheduler/data ./scheduler/data
COPY --from=builder --chown=nextjs:nodejs /app/scheduler/.next ./scheduler/.next
USER nextjs
WORKDIR /app/scheduler
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "node"]
CMD ["../node_modules/next/dist/bin/next", "start"]

ARG RUNTIME_FLAVOR=distroless
FROM runtime-${RUNTIME_FLAVOR} AS runtime
