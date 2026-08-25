'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const javaRoot = path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'de', 'pokefolio', 'app');
const activity = fs.readFileSync(path.join(javaRoot, 'MainActivity.java'), 'utf8');
const processor = fs.readFileSync(path.join(javaRoot, 'CardImageProcessor.java'), 'utf8');
const matcher = fs.readFileSync(path.join(javaRoot, 'CardVisualMatcher.java'), 'utf8');
const camera = fs.readFileSync(path.join(javaRoot, 'CameraActivity.java'), 'utf8');
const overlay = fs.readFileSync(path.join(javaRoot, 'CardOverlayView.java'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'styles.css'), 'utf8');
const gradle = fs.readFileSync(path.join(__dirname, '..', 'app', 'build.gradle'), 'utf8');

test('schneidet und entzerrt den Scan genau einmal vor den Kandidatenvergleichen', () => {
  assert.match(activity, /prepareCardImage\(String dataUrl, String requestId\)/);
  assert.match(activity, /prepareForVisualComparisonDetailed\(source, true\)/);
  assert.match(activity, /comparePreparedCardImage/);
  assert.match(processor, /fitCardToCanvas\(oriented, 378, 528\)/);
  assert.match(processor, /Scales the whole detected card into 63:88 without discarding any edge pixels/);
  assert.doesNotMatch(processor, /centerCropToCard/);
  assert.match(processor, /base != source && !isVariantBitmap\(variants, base\)/);
  assert.match(processor, /"perspective"/);
  assert.match(processor, /isCardAspectFrame\(scaled\)/);
  assert.match(processor, /!attemptPerspectiveCorrection \|\| framedCard \|\| rectified != null/);
  assert.match(processor, /"framed-card"/);
  assert.doesNotMatch(processor, /alreadyCardCrop/);
  assert.match(processor, /"center-fallback"/);
  assert.match(activity, /"images\.scrydex\.com"/);
});

test('startet Kamera und Aufnahme immer mit ausgeschaltetem Blitz und Torch', () => {
  assert.match(camera, /setFlashMode\(ImageCapture\.FLASH_MODE_OFF\)/);
  assert.doesNotMatch(camera, /FLASH_MODE_AUTO/);
  assert.match(camera, /forceTorchOff\("camera-bound"\)/);
  assert.match(camera, /enableTorch\(false\)/);
  assert.match(camera, /forceTorchOff\("activity-stopped"\)/);
  assert.doesNotMatch(camera, /setCropAspectRatio/);
});

test('hält WebView-Navigation und Kamerasteuerung mit nativen Window Insets in der Safe Area', () => {
  assert.match(activity, /WindowCompat\.setDecorFitsSystemWindows\(getWindow\(\), false\)/);
  assert.match(activity, /WindowInsetsCompat\.Type\.navigationBars\(\)/);
  assert.match(activity, /--android-nav-inset-bottom/);
  assert.match(camera, /WindowCompat\.setDecorFitsSystemWindows\(getWindow\(\), false\)/);
  assert.match(camera, /WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(camera, /navigation\.bottom \+ dp\(16\)/);
  assert.doesNotMatch(camera, /status_bar_height/);
  assert.match(overlay, /setReservedAreas\(int top, int bottom\)/);
  assert.match(overlay, /height - topInset - bottomInset/);
  assert.match(styles, /--android-nav-inset-bottom:0px/);
  assert.match(styles, /var\(--app-nav-height\) \+ max\(var\(--android-nav-inset-bottom\)/);
});

test('bindet lokale ML-Kit-Modelle für Japanisch, Koreanisch und Chinesisch ein', () => {
  assert.match(gradle, /text-recognition-japanese:16\.0\.1/);
  assert.match(gradle, /text-recognition-korean:16\.0\.1/);
  assert.match(gradle, /text-recognition-chinese:16\.0\.1/);
  assert.match(activity, /JapaneseTextRecognizerOptions/);
  assert.match(activity, /KoreanTextRecognizerOptions/);
  assert.match(activity, /ChineseTextRecognizerOptions/);
});

test('erlaubt TCGdex nativ und protokolliert typisierte HTTP-Bridge-Fehler nur im Debug-Build', () => {
  assert.match(activity, /"api\.tcgdex\.net"/);
  assert.match(activity, /connection\.setConnectTimeout\(5000\)/);
  assert.match(activity, /connection\.setReadTimeout\(8000\)/);
  assert.match(activity, /output\.put\("errorType", errorType\)/);
  assert.match(activity, /instanceof SocketTimeoutException/);
  assert.match(activity, /return "allowlist"/);
  assert.match(activity, /return "network"/);
  assert.match(activity, /Art=" \+ errorType/);
  assert.match(activity, /URL=" \+ sanitizeUrlForLog\(url\)/);
  assert.match(activity, /Status=" \+ status/);
  assert.match(activity, /Body=" \+ compactBody/);
  assert.match(activity, /ApplicationInfo\.FLAG_DEBUGGABLE/);
  assert.match(activity, /onConsoleMessage\(ConsoleMessage message\)/);
});

test('bewahrt beim Kamera- und Konturzuschnitt Sicherheitsränder an allen Kartenkanten', () => {
  assert.match(processor, /frameInView\.width\(\) \* 0\.045f/);
  assert.match(processor, /frameInView\.height\(\) \* 0\.045f/);
  assert.match(processor, /rectangleHeight \* scaleY \* 0\.035f/);
  assert.match(processor, /expandQuad\(quad, source\.getWidth\(\), source\.getHeight\(\), 0\.018f\)/);
});

test('berechnet regionale pHash-, dHash-, Graustufen-, Gradienten- und Farbmerkmale', () => {
  assert.match(matcher, /Region WHOLE/);
  assert.match(matcher, /Region HEADER/);
  assert.match(matcher, /Region ARTWORK/);
  assert.match(matcher, /Region TEXT/);
  assert.match(matcher, /Region FOOTER/);
  assert.match(matcher, /perceptualHash/);
  assert.match(matcher, /differenceHash/);
  assert.match(matcher, /normalizedCorrelation/);
  assert.match(matcher, /gradientSimilarity/);
  assert.match(matcher, /colorHistogramSimilarity/);
  assert.match(matcher, /artwork \* 0\.47d/);
  assert.match(matcher, /text \* 0\.14d/);
  assert.match(activity, /output\.put\("text", result\.text\)/);
});

test('liefert gezielte Collector-Number-OCR in mehreren Bildvarianten', () => {
  assert.match(processor, /unterkante-normal-/);
  assert.match(processor, /unterkante-grau-/);
  assert.match(processor, /unterkante-kontrast-/);
  assert.match(processor, /unterkante-scharf-/);
  assert.match(processor, /sharpenForOcr/);
  assert.match(processor, /card\.getHeight\(\) \* 0\.80f/);
});

test('liefert eine enge Kopfzeilen-OCR mit Original, Grau, Kontrast, Schärfe und Skalierungen', () => {
  assert.match(processor, /card\.getHeight\(\) \* 0\.23f/);
  assert.match(processor, /kopfzeile-original-/);
  assert.match(processor, /kopfzeile-grau-/);
  assert.match(processor, /kopfzeile-kontrast-/);
  assert.match(processor, /kopfzeile-scharf-/);
  assert.match(processor, /kopfzeile-2x-/);
  assert.match(processor, /kopfzeile-3x-/);
});
