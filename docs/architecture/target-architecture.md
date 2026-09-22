# PokeFolio target architecture

Status: accepted implementation direction

Approach: evolutionary modular monorepo; no full rewrite

## Architectural shape

PokeFolio will remain one repository with native hosts around shared product logic and a central authenticated backend.

```text
Android (CameraX/ML Kit/WebView) ----\
                                      -> versioned HTTPS API -> PostgreSQL
Windows (.NET/WebView2/OpenCV/OCR) --/             |
             |                                     +-> provider adapters
             +------ shared contracts/core         +-> change notifications
```

The initial server is a modular monolith, not a microservice estate. It gives identity, transactions, migrations and deployment one reliable boundary while keeping modules separable for future scale.

Target repository ownership:

```text
android/ or app/                existing native Android host and scanner
windows/                        native Windows host and device adapters
shared/web/                     shared UI and JavaScript domain/application code
shared/contracts/               generated/documented API and sync schemas
backend/                        ASP.NET Core modular monolith
database/                       reviewed migrations and operational scripts
tests/                          cross-platform fixtures, E2E and benchmarks
docs/                           architecture, operations and decisions
```

The existing Android `app/` path stays in place until moving it provides concrete value. Shared assets move only after both hosts can consume the new location in CI.

## Platform decisions

### Backend

Use ASP.NET Core on .NET 10 LTS for the production backend and converge the Windows application on the same supported runtime. .NET 8 reaches end of support on 2026-11-10, while .NET 10 is supported through 2028-11-14. The runtime upgrade is isolated from feature work and must preserve the current Windows tests and self-contained publish.

Use PostgreSQL with EF Core and Npgsql. Database migrations are reviewed source artifacts and execute as a distinct deployment step; the application must not silently apply destructive migrations at startup.

Initial server modules:

- Identity and Devices
- Catalog and Sets
- Collection and Purchases
- Binders and Wishlists
- Pricing and Portfolio
- Scans and Grading
- Sync and Change Feed

Each module owns its application service and persistence mapping. Cross-module writes occur through explicit services and one database transaction where atomicity is required.

### API contract

Expose `/api/v1` REST endpoints with an OpenAPI document. Clients consume generated or validated contract models rather than hand-mapping arbitrary provider payloads. Breaking changes require a new API version or a backwards-compatible migration window.

All private routes derive the user identifier from the authenticated principal. No private route accepts `user_id` as a query, body or route selector. Resource identifiers are still checked against the current user to prevent IDOR.

Errors use a stable problem-details shape with a correlation identifier and machine-readable error code. Commands that may be retried accept an idempotency key.

### Authentication and device sessions

Use the framework identity/password-hashing implementation, not a custom password scheme. The initial flow supports registration, verified account policy, login, logout, password change/reset and per-device sessions.

- short-lived access tokens are kept in native protected process/storage boundaries;
- refresh tokens are high-entropy, rotated on use, stored hashed on the server and grouped in revocable token families;
- a device record identifies a user-visible session and stores only necessary metadata;
- logout revokes the current token family; “logout other devices” revokes all other families;
- browser `localStorage` never contains bearer or refresh tokens.

External Google, Microsoft and Apple identity is deferred behind the same account-linking boundary.

### User isolation

Every private table has a non-null `user_id` foreign key. Isolation is enforced in three layers:

1. endpoint policy and resource authorization;
2. repository/query filters and explicit ownership predicates;
3. PostgreSQL row-level security for private tables as defence in depth.

Migrations and background jobs set user context explicitly. Integration tests create at least two users and attempt normal and manipulated cross-user access for every private aggregate.

## Data model boundaries

Shared catalog data includes cards, sets, variants, rarities, artists, normalized provider identifiers, market quotes and price history.

Client recognition results carry public provider identifiers, while private holdings reference only stable backend catalog UUIDs. An authenticated resolver normalizes an allowlisted provider/TCG identity and converges concurrent submissions through a unique database key. Client-supplied descriptive metadata remains untrusted until a server-side provider adapter verifies it; conflicting submissions must be surfaced rather than silently overwriting shared catalog data.

Private data includes collection holdings, physical specimens, purchases, binders, wishlists, scans, grading results, devices, settings, sync operations and change events.

Collection quantities and physical specimens serve different needs:

- `collection_holding` is the fast aggregate for one user/card/variant/language/condition identity;
- `card_specimen` represents a physical copy when per-copy purchase, note, condition or grading data exists;
- `purchase` records money, currency, date and fees without forcing unrelated copies to share a price.

Aggregate quantity must never fall below the number of attached physical specimens. Money is stored as decimal amount plus ISO currency; timestamps are UTC; public IDs are UUID/ULID-style non-sequential identifiers.

## Synchronization protocol

The HTTPS change feed is the source of truth. SignalR is an optional low-latency notification that tells a client to pull changes; it is not the durable data channel.

Each client stores:

- a stable installation/device ID;
- an ordered offline operation queue;
- a server change cursor;
- local entity versions and sync state.

Each operation carries a client-generated operation ID. The server records processed IDs per user/device so retries are idempotent.

Conflict semantics are field-appropriate:

- quantity changes use atomic signed deltas in a transaction, so concurrent `+1` operations both survive;
- creates use client-generated public IDs and idempotency;
- editable records use a version token/optimistic concurrency; a stale absolute update returns the current server representation;
- delete is a tombstone/change event until all supported clients have passed the retention window;
- notes and other user-authored text are never silently overwritten after a version conflict.

The server change log contains user-scoped sequence numbers. A client commits local state and its cursor atomically after applying a page. Retries use bounded exponential backoff with jitter.

On Windows, the native session selects the account snapshot; WebView JavaScript cannot provide a `userId` or storage key. Queue, cursor, conflict history, entity versions and pulled entities are replaced atomically after every transition in an account-separated `%LOCALAPPDATA%\PokeFolio\Sync` file. Invalid state fails closed and remains recoverable. This file contains no credentials and is outside the generic WebView-addressable local-data namespace. The current whole-snapshot format is bounded to 32 MiB; migration to transactional SQLite must precede workloads that approach that limit or require multiple concurrent desktop processes.

The shared collection-cloud layer only hydrates after a complete idle pull with an empty pending queue. It resolves global card IDs through the token-free catalog facade, links holdings to unbound legacy entries by provider identity plus language/variant/condition, and never rebinds an entry that already belongs to another holding. Local rich scan metadata remains client-side while server quantity, editable fields and version form the synchronization baseline. Quantity differences become ordered signed deltas; supported text/identity edits become optimistic versioned updates. Invalid remote holdings, stale-account responses and snapshots overtaken by a newly queued local operation fail closed without replacing the local cache.

## Local-data migration

Existing browser collection schema 6 and grading schema 2 are supported migration inputs. Collection schema 6 now follows this non-destructive first-account workflow; grading-state upload remains a later extension:

1. detect and validate local state;
2. show an explicit import preview and keep incomplete identities local;
3. bind the legacy area to the confirmed account so other accounts and signed-out guests cannot render or overwrite it;
4. derive deterministic account/legacy-key UUIDv8 holding and operation IDs before network work;
5. resolve allowlisted provider identities to global catalog IDs and choose create or atomic quantity delta against pulled cloud holdings;
6. persist operations in bounded atomic queue batches and compare completed/conflict/rejected states;
7. mark the local plan complete, but do not delete the legacy collection automatically.

Android and Windows migration fixtures must cover older schemas, malformed records, interruption and retry.

After migration, pulled holdings can therefore render on a second device and later mutations of already linked holdings enter the durable queue automatically. A completely new post-migration scan receives a persistent, account-bound create intent only after the local area is safely owned. The outbox resolves its allowlisted provider identity, deduplicates against the complete pulled snapshot, and derives holding and operation UUIDs deterministically from the persisted intent key. The intent is cleared only after every operation is no longer pending and the resulting holding is present in the pulled entity snapshot. If another device created the same identity concurrently, a pulled matching holding converts the failed create into deterministic additive deltas; other rejected/conflicting intents remain local and block hydration from silently replacing their quantity.

## Scanner and recognition

Keep the current native scanner pipeline and introduce stable host contracts around it. Preview work stays cheap: contour, blur/exposure and stability only. OCR begins after a captured or uploaded image has been normalized. Visual comparison runs only when identifier/set/name candidates remain ambiguous.

Auto capture is a native state machine with explicit gates for complete contour, confidence, sharpness, perspective, stability duration and cooldown. It must be user-disableable and share measured behaviour with bulk scan. A failed recognition keeps the captured image available for retry/candidate selection without automatically modifying the collection.

The recognition test corpus stores licensed or user-provided test images outside normal application artifacts where licensing requires it, plus versioned ground truth manifests in the repository. Reports contain accuracy, false-positive/unknown rates and median/P95 latency with device/runtime metadata.

## Provider and pricing boundary

Clients never call commercial price providers with production credentials. Backend adapters implement a common quote/history interface, normalize currency and condition, cache according to provider terms, preserve source timestamps and record provenance. Product logic consumes normalized quotes and can operate when one provider is unavailable.

## Client security boundary

Both hosts permit only the packaged application origin, block untrusted navigation/popups and grant native permissions only for explicit trusted-origin resource requests. Native bridge methods validate size, type, path and command parameters. Sensitive tokens stay outside JavaScript storage. Logs redact tokens, personal notes, file contents and provider credentials.

Android receives the non-secret backend origin from a build property and accepts only path-free HTTPS, plus explicit loopback HTTP for `adb reverse` development. Rotating refresh credentials are serialized in a bounded native envelope under `noBackupFilesDir`, encrypted with AES-GCM and a randomized nonce, and authenticated with fixed application AAD. The non-exportable AES key is generated by Android Keystore. Writes use a same-directory temporary file, disk flush and atomic replacement; malformed or undecryptable state fails closed instead of being silently discarded.

The Android API client keeps access tokens only in native process memory, exposes a token-free public session, validates strict authentication envelopes and persists every rotated refresh credential before activating the corresponding access token. Authenticated requests retry at most once after HTTP 401. Concurrent 401 responses serialize through one session gate, so the first request rotates the token and later requests reuse that result instead of replaying an already consumed refresh token. HTTP responses are caller-bounded, redirects are disabled, and request paths are constrained to the configured origin below `/api/v1/`.

One process-scoped Android cloud service owns that session for the account, catalog and sync bridges. Activity recreation reuses this single session gate, preventing two host instances from racing the same rotating refresh credential. The packaged WebView receives only token-free account/device state and strictly validated catalog/sync envelopes through bounded callback facades; it cannot select a user ID or read credentials. A configured unauthenticated host attempts one persistent-session restore during page startup. Activity shutdown drops its pending callbacks without closing the process-owned session.

Android and Windows load one shared cloud facade and one shared persistent sync driver. The driver persists each enqueue, push reconciliation, retry transition and pull page before exposing the new state. Native storage derives its partition only from the authenticated session, hashes the UUID used in filenames, validates the exact snapshot envelope and replaces files atomically. Corrupt snapshots fail closed and remain available for recovery. Android stores this token-free state below its application files directory; refresh credentials remain separately encrypted under `noBackupFilesDir`. Shared visible account controls, non-destructive collection migration, second-device hydration, linked edits and the post-migration scan create outbox are implemented. Physical Android/Windows end-to-end automation, background scheduling and grading-state migration remain subsequent product steps.

## Observability and operations

Backend requests receive a correlation ID and structured logs. Metrics cover latency, error rate, database health, auth failures, sync backlog, provider failures and job duration without high-cardinality user data. Audit events record session revocation, account security changes and administrative data operations.

Backups require encrypted PostgreSQL base backups plus point-in-time recovery and periodic restore tests. Health endpoints distinguish liveness from readiness. Production secrets come from deployment secret storage; CI uses GitHub environments and protected secrets.

## Definition of architectural completion

The architecture foundation is complete only when:

- both existing client builds remain green;
- API and sync contracts have executable compatibility tests;
- a PostgreSQL-backed multi-user integration test proves isolation and atomic concurrent quantity updates;
- a PostgreSQL-backed API end-to-end test proves the 20-scan Android-to-Windows flow, reverse edits and cross-account denial;
- existing local state has a tested, non-destructive migration path;
- authentication tokens never enter WebView storage;
- both clients can consume the same account collection and recover from offline retry;
- deployment, backup, restore and incident procedures are documented and exercised.
