# Famieps recognition regression — 0.17.0-dev2

## Reproduction and fix

Reproduced against the preceding implementation with a TOP_HEADER OCR pass containing
`Famieps KP 90 Entwickelt sich aus Zwieps` and another header pass containing `Zwieps`.
The old implementation discarded the entire merged line, including Famieps, and
selected Zwieps. The new implementation retains the title prefix and excludes the
evolution species across OCR passes. Wrapped evolution markers and German/English
“from”, “into” and “to” forms are covered. Main-name extraction remains restricted
to the existing header region; evolution text is never promoted into title evidence.

Collector parsing previously replaced the original line context with the matched
fraction. It now retains that context, rejects HP/damage and Pokédex contexts,
rejects year pairs, and requires the lower card area for positioned OCR. A bare
number remains insufficient. Structured patterns such as 013/091, TG01/TG30 and
SV001/SV122 remain supported. Legacy text-only inputs have no physical coordinates
and retain the existing fraction parser for compatibility.

Ranking deduplicates before applying the result limit, using the existing card/set,
number, language and finish identity. When scored duplicate records disagree,
the better-supported candidate wins before metadata completeness. Wrong-species
candidates cannot become safe matches through a matching number or artwork alone.
Confidence below 0.72 cannot confirm an identity via the strong-partial-evidence
shortcut. Uncertain UI results use “Möglicher Treffer” and an explicit selection /
rescan message; manual selection remains available.

## Reference images

Live TCGdex verification returned an image base for German Famieps sv04.5-074;
both its low.webp and high.webp endpoints returned HTTP 200 with image/webp.
Other returned Famieps records (B2a-082, B2a-099) had null image fields. Thus absent
provider imagery is one confirmed cause, not proof of the cause of the user's
specific failed reference. No original screenshot, card image or OCR log was supplied.

The local visual matcher now tries the other supplied image resolution when a
download/comparison fails. The single-scan reference view and candidate thumbnails
also try the supplied alternative before showing a placeholder. Missing URLs are
not invented; existing localized/English fallback selection remains in place.
The candidate-level error handler still preserves text-only recognition when both
image attempts fail. Retries are bounded and duplicate URLs are attempted once.

## Validation

- 343 JavaScript tests passed, including 12 new regression tests covering Famieps,
  Raichu, Glurak, Bisaflor, merged/wrapped OCR, numbers, ranking, confidence,
  deduplication and reference-image recovery.
- 62 JVM tests passed.
- Android testDebugUnitTest, lintDebug, assembleDebug and assembleDebugAndroidTest
  passed. Lint: 0 errors, 14 warnings.
- Application and instrumentation APK signatures verified (v3).
- VersionCode 37, versionName 0.17.0-dev2, same application ID and test signing key.
- Artifact: build/releases/PokeFolio-Android-0.17.0-dev2.apk
- SHA-256: 4081f642ec4c3339bea74b5827200ae31e36f7631f8fd82171ec76ba46121bba

Camera, crop, upload, native auto-capture and collection implementation were not
changed. MainActivity changes only update the version in user-agent strings.

Real S23 Ultra testing remains required: rescan the affected Famieps card, verify
the printed collector number and reference image, then scan an evolution-card
sequence in single and bulk mode. These are automated regression results, not a
claim of verified real-camera accuracy or successful on-device installation.
