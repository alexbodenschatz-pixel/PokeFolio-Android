'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const javaRoot = path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'de', 'pokefolio', 'app');
const activity = fs.readFileSync(path.join(javaRoot, 'MainActivity.java'), 'utf8');
const processor = fs.readFileSync(path.join(javaRoot, 'CardImageProcessor.java'), 'utf8');
const matcher = fs.readFileSync(path.join(javaRoot, 'CardVisualMatcher.java'), 'utf8');

test('schneidet und entzerrt den Scan genau einmal vor den Kandidatenvergleichen', () => {
  assert.match(activity, /prepareCardImage\(String dataUrl, String requestId\)/);
  assert.match(activity, /prepareForVisualComparisonDetailed\(source, true\)/);
  assert.match(activity, /comparePreparedCardImage/);
  assert.match(processor, /Bitmap\.createScaledBitmap\(crop, 378, 528, true\)/);
  assert.match(processor, /"perspective"/);
  assert.match(processor, /!attemptPerspectiveCorrection \|\| rectified != null/);
  assert.doesNotMatch(processor, /alreadyCardCrop/);
  assert.match(processor, /"center-fallback"/);
});

test('berechnet regionale pHash-, dHash-, Graustufen-, Gradienten- und Farbmerkmale', () => {
  assert.match(matcher, /Region WHOLE/);
  assert.match(matcher, /Region HEADER/);
  assert.match(matcher, /Region ARTWORK/);
  assert.match(matcher, /Region FOOTER/);
  assert.match(matcher, /perceptualHash/);
  assert.match(matcher, /differenceHash/);
  assert.match(matcher, /normalizedCorrelation/);
  assert.match(matcher, /gradientSimilarity/);
  assert.match(matcher, /colorHistogramSimilarity/);
  assert.match(matcher, /artwork \* 0\.54d/);
});

test('liefert gezielte Collector-Number-OCR in mehreren Bildvarianten', () => {
  assert.match(processor, /unterkante-normal-/);
  assert.match(processor, /unterkante-grau-/);
  assert.match(processor, /unterkante-kontrast-/);
  assert.match(processor, /unterkante-scharf-/);
  assert.match(processor, /sharpenForOcr/);
});
