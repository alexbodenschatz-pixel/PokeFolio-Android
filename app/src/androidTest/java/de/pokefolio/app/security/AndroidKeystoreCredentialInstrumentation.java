package de.pokefolio.app.security;

import android.content.Context;
import android.content.ContextWrapper;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;

/** Device-side evidence that the production Android Keystore implementation round-trips. */
public final class AndroidKeystoreCredentialInstrumentation {
    private AndroidKeystoreCredentialInstrumentation() {
    }

    public static int run(Context targetContext) throws Exception {
        File root = new File(
                targetContext.getNoBackupFilesDir(),
                "credential-instrumentation-" + UUID.randomUUID());
        Context isolatedContext = new ContextWrapper(targetContext) {
            @Override
            public File getNoBackupFilesDir() {
                return root;
            }
        };
        ProtectedRefreshTokenStore store = new ProtectedRefreshTokenStore(isolatedContext);
        UUID deviceId = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        String token = "instrumentation-refresh-token-0123456789abcdef";
        try {
            store.save(new RefreshTokenCredential(deviceId, token));
            RefreshTokenCredential loaded = store.load();
            require(loaded != null, "Android Keystore credential missing");
            require(deviceId.equals(loaded.getDeviceId()), "Android Keystore device mismatch");
            require(token.equals(loaded.getRefreshToken()), "Android Keystore token mismatch");
            byte[] ciphertext = Files.readAllBytes(new File(
                    new File(root, "security"),
                    "refresh-token.bin").toPath());
            require(!new String(ciphertext, StandardCharsets.UTF_8).contains(token),
                    "Android Keystore credential contains plaintext");
            store.delete();
            require(store.load() == null, "Android Keystore credential was not deleted");
            return 1;
        } finally {
            deleteRecursively(root);
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        if (!file.delete() && file.exists()) file.deleteOnExit();
    }
}
