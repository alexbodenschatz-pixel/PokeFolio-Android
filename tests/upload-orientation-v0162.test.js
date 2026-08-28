'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root,
  'app/src/main/java/de/pokefolio/app/MainActivity.java'), 'utf8');
const processor = fs.readFileSync(path.join(root,
  'app/src/main/java/de/pokefolio/app/CardImageProcessor.java'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app/src/main/assets/app.js'), 'utf8');
const recognition = require(path.join(root, 'app/src/main/assets/recognition-core.js'));

test('Galerie-URI wird vor WebView genau einmal per EXIF normalisiert', () => {
  assert.match(main, /normalizeGalleryUpload\(selectedUri\)/);
  assert.match(main, /CardImageProcessor\.decodeAndOrient\(\s*getContentResolver\(\), sourceUri/);
  assert.match(main, /sourceExifApplied/);
  assert.match(main, /sourceExifOrientation[^\n]+ORIENTATION_NORMAL/);
  assert.match(main, /FileProvider\.getUriForFile/);
  assert.match(processor, /resolver\.openInputStream\(uri\)/);
  assert.doesNotMatch(main, /getRealPathFromUri|MediaStore\.Images\.Media\.DATA/);
});

test('alle acht EXIF-Lagen einschließlich Spiegelung sind implementiert', () => {
  [
    'ORIENTATION_FLIP_HORIZONTAL', 'ORIENTATION_ROTATE_180',
    'ORIENTATION_FLIP_VERTICAL', 'ORIENTATION_TRANSPOSE',
    'ORIENTATION_ROTATE_90', 'ORIENTATION_TRANSVERSE', 'ORIENTATION_ROTATE_270'
  ].forEach(value => assert.match(processor, new RegExp('case ExifInterface\\.' + value)));
  assert.match(processor, /isMirroredExifOrientation/);
  assert.match(processor, /applyExifOrientation\(decoded, orientation\)/);
});

test('JavaScript enthält keine EXIF-Nachdrehung und übernimmt normalisierte Pixel', () => {
  assert.match(app, /EXIF_NORMALIZED/);
  assert.match(app, /bitmapOrientationNormalized/);
  assert.doesNotMatch(app, /sourceExifOriginalOrientation[^\n]*(?:rotate|drawRotated)/);
  assert.doesNotMatch(app, /transform:\s*rotate/);
});

test('unsichere Kartenorientierung behält die normalisierte Ausgangslage', () => {
  const ambiguous = recognition.selectBestOrientation({passes: [
    {variant: 'probe-0', text: 'Raichu'},
    {variant: 'probe-90', text: 'Raichu'},
    {variant: 'probe-180', text: 'Raichu'},
    {variant: 'probe-270', text: 'Raichu'}
  ]}, 'pokemon');
  assert.equal(ambiguous.rotation, 0);
  assert.equal(ambiguous.confident, ambiguous.bestRotation === 0);
  assert.ok(ambiguous.margin < 1.15);
  assert.match(main, /score >= 2\.0f/);
  assert.match(main, /margin\(\) >= Math\.max\(1\.15f/);
  assert.match(app, /KEEP_SOURCE reason=low-margin/);
});

test('klarer 180-Grad-Layoutvorteil bleibt erlaubt', () => {
  const result = recognition.selectBestOrientation({passes: [
    {variant: 'probe-0', text: 'Nintendo', lines: [{text: 'Nintendo', y: 0.10}]},
    {variant: 'probe-180', text: 'Raichu\n120 KP\n050/195', lines: [
      {text: 'Raichu', y: 0.12}, {text: '120 KP', y: 0.20}, {text: '050/195', y: 0.85}
    ]}
  ]}, 'pokemon');
  assert.equal(result.rotation, 180);
  assert.equal(result.confident, true);
  assert.ok(result.margin >= 1.15);
});
