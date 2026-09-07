# ADR 0001: Evolve PokeFolio as a modular monorepo

- Status: Accepted
- Date: 2026-09-07

## Context

PokeFolio has a working native Android camera pipeline, a shared web application and a Windows native host. The requested product also needs accounts, PostgreSQL, strict user isolation, offline synchronization and future clients. Replacing the current clients would discard tested capture and recognition work, while continuing to add all responsibilities to `app.js` and client-local storage would make secure synchronization impractical.

## Decision

Evolve the repository in place:

1. Preserve native Android and Windows device capabilities.
2. Stabilize explicit host and API contracts before relocating shared code.
3. Move reusable web assets to a neutral shared source through a reversible build change.
4. Add an ASP.NET Core modular monolith and PostgreSQL as the authoritative multi-user system.
5. Use REST/OpenAPI for durable operations and SignalR only for change notification.
6. Add modules and tests by bounded vertical slices; do not introduce microservices until measured operational needs justify them.

## Consequences

Benefits:

- existing scanner and desktop investments remain usable;
- Android and Windows can migrate incrementally against stable contracts;
- authentication, authorization, transactions and backups get one server boundary;
- future web/iOS/macOS clients can reuse API contracts without inheriting native implementation details.

Costs:

- shared assets temporarily remain under the Android source tree;
- client-local and server models need explicit adapters during migration;
- a modular monolith requires ownership checks to prevent accidental module coupling;
- .NET runtime convergence and backend introduction add build matrix work.

## Rejected alternatives

- **Full Flutter/React Native/MAUI rewrite:** high regression risk and no technical need for replacing CameraX/ML Kit or the current shared core.
- **Client-only synchronization:** cannot guarantee user isolation, idempotency, concurrent updates or provider-secret protection.
- **Microservices first:** adds deployment and data-consistency costs before workload boundaries are measured.
- **Realtime channel as source of truth:** makes offline recovery and durable replay fragile; notifications must point clients back to a durable change feed.
