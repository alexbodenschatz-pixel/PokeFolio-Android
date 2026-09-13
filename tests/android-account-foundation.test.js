'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Android backend origin is build-configured without embedding credentials', () => {
  const gradle = read('app/build.gradle');
  const configuration = read(
    'app/src/main/java/de/pokefolio/app/backend/PokeFolioBackendConfiguration.java');

  assert.match(gradle, /providers\.gradleProperty\('pokefolioBackendOrigin'\)/);
  assert.match(gradle, /providers\.environmentVariable\('POKEFOLIO_BACKEND_ORIGIN'\)/);
  assert.match(gradle, /buildConfigField 'String', 'POKEFOLIO_BACKEND_ORIGIN'/);
  assert.match(configuration, /"https"\.equals\(scheme\)/);
  assert.match(configuration, /"http"\.equals\(scheme\) && isLoopbackHost\(host\)/);
  assert.match(configuration, /candidate\.getRawUserInfo\(\) != null/);
  assert.doesNotMatch(gradle, /https:\/\/[A-Za-z0-9._~%-]+:[^@\s]+@/);
});

test('Android cleartext policy is deny-by-default with only explicit loopback development hosts', () => {
  const manifest = read('app/src/main/AndroidManifest.xml');
  const policy = read('app/src/main/res/xml/network_security_config.xml');
  const domains = [...policy.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)]
    .map(match => match[1]);

  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(policy, /<base-config cleartextTrafficPermitted="false"\s*\/>/);
  assert.deepEqual(domains, ['localhost', '127.0.0.1', '::1']);
  assert.doesNotMatch(policy, /includeSubdomains="true"/);
});

test('Android refresh credentials stay in no-backup native AES-GCM storage', () => {
  const store = read(
    'app/src/main/java/de/pokefolio/app/security/ProtectedRefreshTokenStore.java');
  const protector = read(
    'app/src/main/java/de/pokefolio/app/security/AndroidKeystoreSecretProtector.java');
  const activity = read('app/src/main/java/de/pokefolio/app/MainActivity.java');

  assert.match(store, /context\.getNoBackupFilesDir\(\)/);
  assert.match(store, /output\.getFD\(\)\.sync\(\)/);
  assert.match(store, /StandardCopyOption\.ATOMIC_MOVE/);
  assert.match(protector, /AndroidKeyStore/);
  assert.match(protector, /AES\/GCM\/NoPadding/);
  assert.match(protector, /updateAAD\(AAD\)/);
  assert.match(protector, /setRandomizedEncryptionRequired\(true\)/);
  assert.doesNotMatch(activity, /getRefreshToken|loadRefreshToken|saveRefreshToken/);
});

test('Android test APK compiles the device-side Keystore roundtrip', () => {
  const instrumentation = read(
    'app/src/androidTest/java/de/pokefolio/app/CardCropInstrumentation.java');
  const workflow = read('.github/workflows/build-pokefolio.yml');
  assert.match(instrumentation, /AndroidKeystoreCredentialInstrumentation\.run/);
  assert.match(workflow, /:app:assembleDebugAndroidTest/);
  assert.match(workflow, /app-debug-androidTest\.apk/);
});
