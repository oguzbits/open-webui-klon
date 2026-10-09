# ADR 0001: Technologie-Stack

Status: angenommen (2026-10-09)

## Kontext

Open WebUI wird als Lern- und Privatprojekt nachgebaut. Das Backend soll NestJS nach den Konventionen der
NestJS-Dokumentation sein; das Frontend wird neu in React + Vite gebaut. Der Stack soll einfach bleiben und
trotzdem Enterprise-Anforderungen erfüllen.

## Entscheidung

pnpm-Monorepo; NestJS mit TypeORM und PostgreSQL/pgvector; Cookie-Sessions; SSE statt WebSocket; pg-boss
statt Redis (ab Teilprojekt 3); Vercel AI SDK für Modellanbieter; DTOs mit class-validator, OpenAPI und
Orval-generierter Client; React, Vite, Tailwind, shadcn/ui, TanStack Query, react-i18next; ESLint + Prettier;
Vitest; OpenTelemetry; Caddy als Reverse Proxy im Web-Image.

## Folgen

- Weniger bewegliche Teile (kein Redis, kein WebSocket-Gateway).
- TypeORM ist Nest-nativ, hat aber schwächere Query-Typisierung als Prisma/Drizzle; Raw-SQL für Vektorsuche
  bleibt möglich.
- Gründe und Alternativen im Detail: [Spec Abschnitt 2](../superpowers/specs/2026-10-09-open-webui-nestjs-design.md).
