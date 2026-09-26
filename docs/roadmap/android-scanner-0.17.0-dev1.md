# Android scanner milestone: 0.17.0-dev1

Android first. Continue on `codex/production-foundation` with one worker by default.
Windows/EOS feature development remains frozen until Android RC. Existing Windows
code and backend contracts remain intact. Do not begin another product area before
the scanner/bulk milestone passes real-device validation.

## Implemented

- CameraX auto-capture reuses FastCardDetector and CardDetectionTracker. Requires
  complete detected border, plausible aspect/coverage, tracker stability and a
  card-interior luminance/detail check, then at least six good frames over 650 ms.
- Persistent user toggle; manual capture remains available after the previous card
  has been removed. No OCR or provider lookup runs on preview frames.
- Bulk capture persists a removal latch across camera activity reopening and
  process restarts. At least six absent-contour frames over 700 ms release it.
  A short detection dropout or elapsed time alone does not release the latch.
- Automatic continuation no longer marks a card removed after an arbitrary timer.
  Native removal evidence releases the existing collection scan lock. Cancel,
  capture errors and concurrent open attempts are covered by regression tests.
- A failed crop retains removal evidence for the subsequent retry. Capture errors
  impose a 2.5-second retry cooldown; background/stale frames do not accrue stability.
- Automatic capture rejects an unreliable final crop; manual capture remains an
  explicit recovery path. Existing identifier-first Pokémon OCR, cache and lookup
  remain in use. Uncertain-variant fallback now requires the same collector,
  set/name, language, contradiction and candidate-gap checks as confirmed variants.
- Capture-to-crop timing includes native capture/normalization/file writing. Total
  recognition includes that measured interval plus the web recognition interval;
  bridge transfer overhead is not separately measured. Variant resolution timing
  covers fallback candidate resolution; cache hits perform no new variant analysis.
- Private real-image corpus format and evaluation guidance: `tests/corpus/`.

## Automated validation

- 330 JavaScript tests passed.
- 62 JVM tests passed, including 9 new auto-capture/quality tests.
- `testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest` passed.
- Lint: 0 errors, 14 warnings (including native Switch styling and intentionally
  synchronous off-main-thread persistence before finishing the capture activity).
- App and instrumentation APK signatures verified with apksigner (v3).
- Version code 36, version name 0.17.0-dev1; application ID app.pokefolio.mobile.
- Test signing certificate SHA-256:
  `5a5abde6616df317558b463f035d1b4702695d9b520abd7ac4fdc9f92f071bd5`.
  Updating a prior installation requires that same certificate and a lower version.
- Local artifact: `build/releases/PokeFolio-Android-0.17.0-dev1.apk`.
- APK SHA-256: `b94426a816e5b48def1bc230e043c6f1aa0df6ebadac0371176f3a3216a01a3e`.
- CI workflow retains Android, backend and Windows checks. Check its result for the
  exact milestone commit; a successful older run is not validation of this change.

## Real device required / known limits

No device was attached during validation. Installation, camera UI, instrumentation
execution and recognition on an S23 Ultra have **not** been tested. This is an
implemented and automatically tested development build, not a beta or RC claim.

The quality thresholds are heuristic, not calibrated to real S23 Ultra images.
Persistent detector failure can resemble removal; the 700 ms gate reduces short
dropouts but does not prove physical absence. Fingerprint-based rearming is not
implemented. After the camera reopens, remove the previous card for at least one
second, then insert the next. Removal while recognition hides the camera cannot
be observed. If removal was missed, briefly clear the frame again. The preview
still uses the existing portrait orientation lock.

Enable “Automatisch zur nächsten Karte” in Bulk for automatic continuation. Unknown
identity pauses for correction; an unknown printing variant remains explicitly
unknown and can be corrected in the collection. No recognition accuracy or latency
percentile is claimed without a real corpus.

On SM-S918B / Android 16 test:

1. Update installation with a known collection; confirm data and visible version.
2. Permission denied/granted, manual capture, auto toggle, torch, background/resume,
   cancel/reopen, display rotation and process recreation; check for crashes/locks.
3. German/English/Japanese, old/modern, sleeve/no sleeve, holo/reverse/full art,
   indoor and controlled illumination, distance, blur, movement and reflections.
4. Hold the same card through continuation: no second capture/write. Remove it,
   scan an identical second copy: exactly +1. Repeat A → B → A and 20-card runs.
5. No internet, timeout, no readable identifier, ambiguous candidates, bad crop,
   failed write: no guessed identity or unexpected quantity change.
6. Record ground truth and measured phase timings using `tests/corpus/README.md`.

Next milestone: real-device scanner calibration and bulk endurance testing, then
variant robustness. Keep the wider Android product roadmap pending that evidence.
