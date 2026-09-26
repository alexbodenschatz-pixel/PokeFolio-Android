# Private Android scanner corpus

Keep original S23 Ultra photos in `private/` (Git-ignored). Only publish images with
documented redistribution rights. `manifest.example.json` is a format example, not
an actual card or measurement. Copy it to `private/manifest.json` and replace all
example values with verified ground truth. Keep filenames unique.

Record device model, Android version, APK version, lighting, sleeve and orientation.
Cover German, English and Japanese cards; old and modern prints; normal, holo,
reverse and full art. Include difficult reflections, motion and out-of-focus images.
Keep repetitions of the same physical card separate from different copies.

Per replay or real scan, record the ground-truth filename, predicted set, number,
language and variant (or `unknown`), capture-to-crop, OCR, lookup, variant,
collection-write and total times in milliseconds. Record whether storage occurred
automatically or after manual confirmation. Do not count a manual correction as
an automatic recognition success.

For N attempted scans report: correct identity / N (accuracy), wrong accepted
identity / N (false-positive rate), unknown identity / N, and correct variant / N.
Also report wrong accepted identities / all accepted identities. Identity includes
TCG, set, number and language. Report latency median and P95 with sample count and
failure count; never discard timeouts silently. Do not infer real-card accuracy
from synthetic unit tests.

For duplicate prevention separately run: same card held still, short occlusion,
card removed for at least one second after camera reopens, two identical copies,
A → B → A, cancel/reopen, background/resume and process recreation. Verify collection
quantity after every step, including failed OCR and failed persistence.
