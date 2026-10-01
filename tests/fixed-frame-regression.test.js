const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'../app/src/main/java/de/pokefolio/app');
test('live frame and label zones never use tracked corners for drawing', () => {
  const overlay = fs.readFileSync(path.join(root,'CardOverlayView.java'),'utf8');
  const drawing = overlay.slice(overlay.indexOf('protected void onDraw'));
  const rois = overlay.slice(overlay.indexOf('private void drawRoiGuides'),overlay.indexOf('public RectF getCardRect'));
  assert.doesNotMatch(drawing,/detectedQuad|detectedBorder/);
  assert.doesNotMatch(rois,/detectedQuad/);
  assert.match(drawing,/width \* 0\.78f/);
});
test('fixed guide is not a destructive post-capture crop', () => {
  const camera = fs.readFileSync(path.join(root,'CameraActivity.java'),'utf8');
  assert.doesNotMatch(camera,/cropPreviewRegionDetailed\(/);
  assert.match(camera,/new RectF\(0, 0, oriented\.getWidth\(\), oriented\.getHeight\(\)\)/);
  assert.match(camera,/prepareCapturedCardDetailed/);
  assert.match(camera,/FixedCaptureFrame.ready/);
});
