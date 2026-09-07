# PokeFolio current-state audit

Status: 2026-09-07

Audited revision: `ba319fc` (`feature/windows-vision-eos`)

Purpose: evidence baseline for the production-readiness programme

## Executive assessment

PokeFolio already has valuable production candidates that must be evolved rather than replaced:

- a native Android CameraX capture pipeline with ML Kit OCR, EXIF handling, card-edge tracking, perspective correction and profile-specific regions of interest;
- a shared HTML/CSS/JavaScript application used by Android and Windows;
- deterministic collection, recognition, grading, learning and variant modules with a substantial Node test suite;
- a Windows WinForms/WebView2 host with native OpenCV processing, Windows OCR, file import and an optional Canon EDSDK boundary;
- CI builds for Android and Windows.

It is not yet a production-ready multi-user platform. There is no server, account system, PostgreSQL database, user isolation, device/session management or cross-device synchronization. Private state remains in WebView `localStorage`. Several requested product areas are absent or only partial.

## Repository and build topology

The repository currently contains one Android Gradle module (`:app`) and one Windows solution. There are no `backend`, `database` or platform-neutral `shared` source roots yet.

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Android | Java 17, AGP 8.10.1, compile/target SDK 36, min SDK 29 | Established native host and scanner; retain |
| Shared UI/core | `app/src/main/assets` HTML/CSS/JavaScript | Reused successfully, but incorrectly owned by the Android tree |
| Windows | .NET 8 WinForms, WebView2, OpenCvSharp, Windows OCR | Working desktop foundation; framework lifecycle and host security need work |
| Backend/database | Not present | Required before accounts or sync |
| Automated tests | Node tests, Windows xUnit, Android custom instrumentation | Useful baseline, but insufficient end-to-end and image-based coverage |
| CI | Android and Windows build/test jobs | Missing device tests, backend/database tests, security gates and measured recognition benchmarks |

Current release metadata is fragmented: Android reports `0.16.5`/version code 35, while the repository has only one historical tag (`pokefolio-v0.6.4.2-build-6`). A single documented versioning and release policy is required.

## Runtime architecture

### Shared application

`app/src/main/assets/app.js` is the main UI orchestrator. The surrounding modules contain meaningful reusable domain logic:

- `collection-core.js`: schema version 6, migration, quantity-aware collection operations, set progress and portfolio totals;
- `recognition-core.js`: candidate scoring, OCR normalization and profile-specific recognition logic;
- `grading-core.js`: schema version 2 and explicitly estimated pre-grading results;
- `variant-core.js`, `learning-core.js`, `reference-core.js`, `api-core.js` and `bulk-fast-core.js`.

The shared application is a sound evolutionary seam. It should first receive tests and stable host contracts, then move to a neutral `shared/web` location through build-time copying/linking. A big-bang UI rewrite is not justified.

The main maintainability risk is concentration of unrelated responsibilities. `app.js` is about 5,000 lines and mixes UI state, persistence, network response mapping, recognition orchestration, pricing and grading. `recognition-core.js`, `CardImageProcessor.java` and `MainActivity.java` are also large. Splitting must follow stable responsibility boundaries, not line count alone. As one concrete defect indicator, `app.js` currently declares `median` twice with different semantics; JavaScript function hoisting makes the later declaration global to the file.

### Android host and scanner

`CameraActivity.java` binds CameraX preview, image analysis and image capture to one viewport. Preview analysis is kept inexpensive through `KEEP_ONLY_LATEST`, throttling and a reduced working image. `CardDetectionTracker` combines contour confidence and temporal stability. Capture then maps the live quadrilateral to the high-resolution frame, applies perspective correction only for a credible contour and writes a normalized image.

`CardImageProcessor.java` supports all EXIF orientations, profile-specific OCR regions and selective orientation probes. The intended pipeline is already close to the target design:

`preview edge detection -> stability -> capture -> perspective/crop -> ROI OCR -> candidates -> visual comparison when needed`

Important gaps:

- a stable contour changes the capture hint but does not trigger automatic capture;
- bulk scanning still relies on an explicit native capture action;
- the real-photo instrumentation inputs are optional cache files and are not stored as a reproducible dataset;
- the only Android test suite is custom instrumentation; `testDebugUnitTest` currently has no source tests.

### Windows host

The Windows application embeds the same web assets in WebView2 and exposes native functionality through `PokeNative`. File decoding, OpenCV card processing, Windows OCR and EOS coordination are separated behind services and concurrency gates. The Canon integration is correctly optional; without proprietary EDSDK binaries the UI reports that file import remains available.

The self-contained publish runs on a clean machine. The framework-dependent build currently requires a separately installed .NET Desktop Runtime. The UI is functional but remains mobile-shaped, with bottom navigation instead of the requested desktop sidebar. Webcam capture, drag-and-drop, CSV/Excel import/export and physical EOS 2000D validation are not implemented.

`LocalDataService` provides validated, atomic files under the user's local application data directory, but the shared application does not use it. Collection and grading data still live in WebView `localStorage`.

## Data, collection and pricing

The collection core groups ownership by card identity and quantity, and the normalized model can carry specimen data. This is a useful migration base, but it does not yet model separately purchased copies with distinct prices as first-class server records.

Pricing is currently read directly from public card-provider responses in the client. Pokémon TCG API, TCGdex, YGOPRODeck and OPTCG endpoints are embedded in client code. Cardmarket/TCGplayer values are snapshots from upstream responses. There is no provider abstraction, server-side credential boundary, normalized quote model or price history store.

Implemented or partial product areas include dashboard totals, collection browsing, search/filtering, set progress, quantity-aware bulk additions, pre-grading and multiple TCG recognition profiles. Missing areas include accounts, cloud collection, binders, wishlists, device management, price history, per-copy purchases, profit/loss, CSV/Excel import/export and a distinct master-set variant model.

## Security findings

No production API key or obvious credential literal was found. `pokefolio-test.keystore` is a documented public debug key and must never be used for release signing.

The highest-priority client risks before authentication is introduced are:

1. Android permits WebView file/content access although the UI is bundled, and grants a WebView permission request based on Android camera permission without constraining request origin and requested resources.
2. Android declares `allowBackup=true` while current private collection state is unencrypted browser storage. Tokens must never be placed in that storage.
3. Windows exposes an `AutoDual` COM host object and maps local resources broadly, but does not yet enforce navigation, popup and permission origin policy in `MainForm`.
4. Authorization cannot currently be evaluated because there is no backend. Future private endpoints must infer `user_id` from the authenticated principal, apply authorization server-side and receive database-level defence in depth.
5. Provider access from clients prevents a reliable credential, quota, caching and audit boundary.

## Verified baseline

The following checks passed on the audited revision:

| Check | Result |
| --- | --- |
| Shared JavaScript tests | 238/238 passed |
| Windows xUnit tests | 41/41 passed |
| Windows native self-test | Passed (13 assets, OpenCV, recognition profiles, OCR adapter, Canon fallback) |
| Android unit/lint/debug build | Passed; JVM test task has no source tests |
| Android test APK build | Passed |
| Android emulator instrumentation | 30/30 passed |
| Android cold start | Activity launched; measured total 1,313 ms on the available emulator |

The instrumentation contour cases are synthetic. The observed detector timing (median about 28.8 ms, P95 about 33.7 ms in that run) is useful as a local baseline, not a real-device performance or recognition-accuracy claim. The Node suite also includes many structural source checks; it does not replace browser/WebView end-to-end tests.

## Risk-ranked debt

1. **Data and identity:** local-only state, no backup-safe migration, no authenticated isolation and no synchronization protocol.
2. **Host security:** WebView origin and permission boundaries need hardening before native capabilities or tokens expand.
3. **Test evidence:** no tracked recognition image corpus, real-card ground truth, multi-user integration suite or multi-device end-to-end suite.
4. **Lifecycle:** Windows targets .NET 8, whose support window ends soon; the production baseline should move to .NET 10 LTS in a controlled build change.
5. **Architecture:** Android owns the shared web core; `app.js` and native bridge classes concentrate responsibilities.
6. **Product gaps:** Windows desktop interaction, accounts/sync, purchases, binders, wishlists, price history and import/export remain unimplemented.
7. **Release engineering:** no production signing flow, database migration deployment, security scan, SBOM or release version policy.

This audit is a baseline, not a claim that unmeasured behaviour is correct. Every material phase must update its evidence and known limitations.
