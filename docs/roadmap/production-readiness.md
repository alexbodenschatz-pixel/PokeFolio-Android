# Production-readiness implementation plan

This roadmap converts the product brief into testable increments. Status values are `complete`, `in progress`, `not started` and `blocked`; a phase is not complete until its quality gate passes.

## Current status

| Phase | Status | Exit evidence |
| --- | --- | --- |
| 1. Repository analysis | Complete | Current-state audit and verified build/test baseline |
| 2. Architecture stabilization | In progress | ADRs, host security, contract boundaries, supported runtime plan |
| 3. Regression baseline | In progress | Test taxonomy, CI parity, real-image manifest and E2E harness foundations |
| 4-6. Backend, accounts, isolation | In progress | PostgreSQL integration and cross-user denial tests pass; recovery and deployment remain |
| 7-10. Sync, clients, shared core | In progress | Server push/pull and the shared offline queue are tested; native credentials and platform transport are next |
| 11-21. Product and scanner slices | Not started | Slice-specific tests/builds/benchmarks |
| 22-25. Audit through release | Not started | Security review, restore test, RC builds and release report |

## Workstream ownership

File ownership is used to avoid parallel edits. Cross-cutting contracts land before dependent client changes.

| Workstream | Owns | Depends on |
| --- | --- | --- |
| A Backend/Auth/Database | `backend/`, `database/`, server contract generation | Architecture decisions |
| B Android/Scanner | `app/src/main/java`, Android resources and instrumentation | Host contract; later API contract |
| C Windows | `windows/` | Host contract; later API contract |
| D Collection/Portfolio/Sets | shared domain modules and product UI slices | Shared-core boundary, backend endpoints |
| E Sync | sync contracts, client queues, server change feed | Authenticated API and database model |
| F Grading | grading models, native analysis and reference tests | Image/host contracts |
| G Tests/QA/CI | `tests/`, CI workflows and release evidence | Contracts from all workstreams |

The current branch is based on `feature/windows-vision-eos`; it must not merge to `main` before that dependency or an equivalent rebased change is available.

## Increment sequence

### Foundation increment

1. Record the current architecture and risks.
2. Harden Android and Windows WebView trust boundaries with regression tests.
3. Define versioned native-host messages and persistent-storage adapters.
4. Add browser/WebView behavioural tests for critical shared flows.
5. Add CI execution for the Android instrumentation artifact and document the connected-device job.
6. Establish a recognition dataset manifest and report format without committing unlicensed card images.

### Account and cloud-collection increment

1. Introduce the .NET 10 backend solution and PostgreSQL development stack.
2. Implement Identity, rotating device sessions and account recovery.
3. Create catalog/private schemas and reviewed migrations.
4. Implement `/api/v1/collection` with principal-derived ownership.
5. Prove user isolation, IDOR denial, validation, rate limiting and concurrent atomic quantity deltas in integration tests.
6. Add a non-destructive local collection migration endpoint and fixtures.

### Sync/client increment

1. Implement operation idempotency, user-scoped change cursor and tombstone retention.
2. Add encrypted/native credential storage and offline queues on Android and Windows.
3. Add background/manual sync and SignalR invalidation.
4. Exercise offline interruption, duplicate delivery, out-of-order response, concurrent `+1` and stale edit conflicts.
5. Move web assets to `shared/web` only after both host builds consume them in CI.

### Product increments

Deliver vertical slices in dependency order: purchases/portfolio, sets/master sets, binders, wishlist, normalized pricing/history, scanner corpus and recognition improvements, auto capture, bulk scan, grading, EOS station, import/export. Each slice includes server model/API, both relevant clients, migration, tests, accessibility/error states and observability.

## Quality gates

Every merge requires:

- clean relevant builds and tests;
- a regression test for every material corrected defect where feasible;
- no new secret or production signing material in the repository;
- backward-compatible database and local-state migration or an explicit rollback plan;
- measured scanner/recognition claims with fixture and environment metadata;
- updated documentation and known limitations.

Release-candidate gates additionally require a PostgreSQL restore exercise, Android and self-contained Windows artifacts, multi-user and multi-device E2E evidence, dependency/security review, production signing configuration and zero known critical data-loss/security/crash defects.
