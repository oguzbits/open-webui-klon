# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /repo
# The "packageManager" field in package.json pins the pnpm version; Node 24 ships Corepack.
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @owui/api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @owui/api build
# Production dependencies plus the "files" entries (dist) in one self-contained folder.
RUN pnpm --filter @owui/api deploy --prod --legacy /out

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 3000
# Apply pending migrations, then start the server (exec: PID 1 is node, so SIGTERM reaches the app).
CMD ["sh", "-c", "node dist/database/migrate-cli.js && exec node --import ./dist/instrumentation.js dist/main.js"]
