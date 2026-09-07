# PokeFolio backend

The backend is a .NET 10 modular-monolith foundation backed by PostgreSQL 15 or newer (PostgreSQL 17 is the CI baseline). The first committed slice defines framework Identity storage, user-owned collection/device/sync data, ownership query filters, idempotent operation records and durable change records. Auth and collection HTTP endpoints are intentionally not exposed until token rotation and authorization are implemented and tested together.

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
- anonymous auth operations have per-client rate limits and machine-readable 429 responses;
- missing database configuration fails startup instead of silently selecting an unsafe store.
