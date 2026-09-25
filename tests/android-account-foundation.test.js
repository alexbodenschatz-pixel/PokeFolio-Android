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

test('Android native account transport keeps tokens outside the WebView boundary', () => {
  const client = read(
    'app/src/main/java/de/pokefolio/app/backend/PokeFolioApiClient.java');
  const transport = read(
    'app/src/main/java/de/pokefolio/app/backend/PokeFolioHttpTransport.java');
  const payloads = read(
    'app/src/main/java/de/pokefolio/app/backend/PokeFolioApiPayloads.java');
  const publicSession = read(
    'app/src/main/java/de/pokefolio/app/backend/PokeFolioSession.java');
  const activity = read('app/src/main/java/de/pokefolio/app/MainActivity.java');

  assert.match(client, /private final Object sessionGate/);
  assert.match(client, /refreshAfterUnauthorized\(current\.accessToken\)/);
  assert.match(client, /refreshTokenStore\.save/);
  assert.match(transport, /setInstanceFollowRedirects\(false\)/);
  assert.match(transport, /readBounded\(raw, maximumResponseBytes\)/);
  assert.match(transport, /!target\.getRawPath\(\)\.startsWith\("\/api\/v1\/"\)/);
  assert.match(payloads, /value\.keys\(\)/);
  assert.doesNotMatch(payloads, /\.keySet\(\)/);
  assert.doesNotMatch(publicSession, /getAccessToken\s*\(|getRefreshToken\s*\(/);
  assert.doesNotMatch(activity, /getAccessToken|refreshToken|Authorization/);
});

test('Android test APK compiles the device-side Keystore roundtrip', () => {
  const instrumentation = read(
    'app/src/androidTest/java/de/pokefolio/app/CardCropInstrumentation.java');
  const workflow = read('.github/workflows/build-pokefolio.yml');
  assert.match(instrumentation, /AndroidKeystoreCredentialInstrumentation\.run/);
  assert.match(workflow, /:app:assembleDebugAndroidTest/);
  assert.match(workflow, /app-debug-androidTest\.apk/);
});

test('Android process owns cloud state while Activity owns token-free bridges', () => {
  const activity = read('app/src/main/java/de/pokefolio/app/MainActivity.java');
  const application = read('app/src/main/java/de/pokefolio/app/PokeFolioApplication.java');
  const manifest = read('app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:name="\.PokeFolioApplication"/);
  assert.match(application, /new PokeFolioCloudService\(/);
  assert.match(application, /new AccountSyncStateStore\(/);
  assert.match(activity, /application\.getCloudService\(\)/);
  assert.match(activity, /new PokeFolioCloudBridge\(/);
  assert.match(activity, /new PokeFolioSyncStateBridge\(/);
  assert.match(activity, /public String getAccountStatus\(\)/);
  assert.match(activity, /public void loginAccount\(/);
  assert.match(activity, /public void requestPasswordReset\(/);
  assert.match(activity, /public void confirmPasswordReset\(/);
  assert.match(activity, /public void listAccountDevices\(/);
  assert.match(activity, /public void revokeAccountDevice\(/);
  assert.match(activity, /public void revokeOtherAccountDevices\(/);
  assert.match(activity, /public void restoreAccountSession\(/);
  assert.match(activity, /accountBridge\.close\(\)/);
  assert.match(activity, /cloudBridge\.close\(\)/);
  assert.match(activity, /public String loadAccountSyncSnapshot\(\)/);
  assert.doesNotMatch(activity, /getAccessToken\s*\(|getRefreshToken\s*\(/);
});
