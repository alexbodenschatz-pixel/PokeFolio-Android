# Shared contracts

`openapi/pokefolio-v1.json` is the authoritative, versioned client/server contract for the first account, collection and synchronization increment.

Contract rules:

- server paths are relative to `/api/v1`;
- private ownership is derived from the bearer principal, never from a request `user_id`;
- retriable commands use `Idempotency-Key` and a client-generated operation ID where replay identity is part of the payload;
- quantity changes are signed atomic deltas;
- non-commutative edits use `If-Match` or `baseVersion` and return a conflict instead of silently overwriting;
- SignalR notifications may announce changes later, but `/sync/changes` remains the durable source of truth;
- breaking changes require a new API version or a backwards-compatible migration window.

Run the contract invariants with:

```text
node --test tests/contracts.test.js
```

Generated client/server models will be added only after the backend toolchain is introduced. Generated output must not become a second hand-edited source of truth.
