# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @owui/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
# The generated API client is committed, so the build does not need the API.
RUN pnpm --filter @owui/web build

FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
USER 65532:65532
EXPOSE 8080
