# PokeFolio backend

The backend is a .NET 10 modular-monolith foundation backed by PostgreSQL 15 or newer (PostgreSQL 17 is the CI baseline). It defines framework Identity storage, user-owned collection/device/sync data, ownership query filters, idempotent operation records and durable change records. Versioned auth, device-management, collection reads, idempotent holding mutations, durable sync pulls and per-operation sync batch pushes are exposed under `/api/v1`.

## Local commands

Use a PostgreSQL connection string from environment/secret configuration; do not place a password in source control.

```powershell
$env:ConnectionStrings__PokeFolio='Host=localhost;Port=5432;Database=pokefolio;Username=pokefolio;Password=<local-secret>'
$env:Auth__SigningKey='<base64-encoded-random-secret-with-at-least-32-bytes>'
dotnet restore backend/PokeFolio.Backend.slnx
dotnet build backend/PokeFolio.Backend.slnx -c Release --no-restore
dotnet test backend/PokeFolio.Backend.slnx -c Release --no-build
dotnet run --project backend/src/PokeFolio.Api/PokeFolio.Api.csproj
```

For EF migration tooling, set `POKEFOLIO_DB_CONNECTION` to a development database. Migrations are reviewed artifacts and must not be auto-applied by application startup.

The `BoundHoldingQuantity` migration preserves legacy rows above the current one-million-copy limit. It installs the range constraint as `NOT VALID`, which still rejects new invalid writes, and validates it automatically when no legacy exception exists. If an upgraded database keeps the constraint unvalidated, inventory owners must review and explicitly normalize or split those exceptional rows after a backup; the migration never truncates quantities silently.

`PreserveHoldingTombstones` is intentionally forward-only: removing `deleted_at` could resurrect deleted inventory or merge replacement identities. Back up the database before deployment and roll forward with a corrective migration instead of attempting an automatic downgrade.

`CanonicalizeChangeActions` maps the known legacy `created`/`updated`/`deleted` values to `upsert`/`delete`. It fails closed without altering unknown values if an installation contains an unrecognized action; inspect and explicitly map that data before retrying so a later sync feed cannot emit events outside the API contract.

`Auth:SigningKey` is mandatory and intentionally empty in `appsettings.json`. Supply it through environment or deployment secret configuration. Access tokens are short-lived JWTs with validated signature, issuer, audience and expiry. Refresh tokens are random opaque values; only SHA-256 hashes are stored. Every access token is also checked against its active server-side device session, so logout and replay revocation take effect immediately.

The PostgreSQL integration test creates and removes a uniquely named temporary database. Point `POKEFOLIO_TEST_POSTGRES` at an administrative test server to enable it; without that variable, the test is reported as skipped. Never point it at a production server.

```powershell
$env:POKEFOLIO_TEST_POSTGRES='Host=localhost;Port=5432;Database=postgres;Username=postgres'
dotnet test backend/PokeFolio.Backend.slnx -c Release
```

## Current safety properties

- private EF aggregates have non-null `UserId` and authenticated-user query filters;
- the global catalog has no private ownership filter;
- processed sync operation IDs are unique per user;
- a sync operation can reference only a device owned by the same user;
- holding versions are optimistic-concurrency tokens;
- nullable variant IDs cannot bypass the unique holding identity;
- quantity changes are bounded signed deltas and cannot underflow;
- refresh token material is represented only by a server-side hash field;
- refresh tokens rotate atomically and consumed hashes remain available for replay detection;
- access tokens are rejected when their device session has expired or been revoked;
- registration and login use ASP.NET Core Identity password hashing and lockout;
- device listing and revocation are scoped to the authenticated account, and cross-user device IDs remain undisclosed;
- password changes require the current password and atomically revoke every other device session;
- collection reads use bounded keyset pagination, expose optimistic-concurrency ETags and return no cross-user object signal beyond `404`;
- collection creation and quantity deltas require stable idempotency UUIDs, emit durable user changes and serialize same-operation retries with PostgreSQL transaction advisory locks;
- quantity deltas are committed as bounded SQL increments, so concurrent devices accumulate instead of overwriting each other;
- absolute holding edits require a strong `If-Match` ETag and fail stale writes with `412`;
- deletes retain versioned, user-owned soft tombstones so old offline commands cannot target a newly reused identifier;
- durable collection changes use the contract-level `upsert` and `delete` actions;
- sync pulls use bounded keyset pagination over monotonic change sequences and never accept a request `user_id`;
- sync pushes commit operations independently in input order, use each `operationId` as the retry identity and report `applied`, `duplicate`, `conflict` or `rejected` per item;
- anonymous auth operations have per-client rate limits and machine-readable 429 responses;
- missing database configuration fails startup instead of silently selecting an unsafe store.
