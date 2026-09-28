package de.pokefolio.app;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class AndroidWebViewSecurityPolicyTest {
    @Test
    public void permitsOnlyBundledAndroidAssets() {
        assertTrue(AndroidWebViewSecurityPolicy.isTrustedAssetUrl(
                "file:///android_asset/index.html"));
        assertTrue(AndroidWebViewSecurityPolicy.isTrustedAssetUrl(
                "file:///android_asset/styles.css?v=16#theme"));

        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl("https://example.com/"));
        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl("content://media/card.jpg"));
        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl("file:///sdcard/card.html"));
        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl("file://evil/android_asset/index.html"));
        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl("file:///android_asset/../private.html"));
        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl("file:///android_asset/%2e%2e/private.html"));
        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl(null));
        assertFalse(AndroidWebViewSecurityPolicy.isTrustedAssetUrl("not a uri"));
    }
}
