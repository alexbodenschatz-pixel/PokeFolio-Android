package de.pokefolio.app.security;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM envelope whose non-exportable key lives in Android Keystore. */
final class AndroidKeystoreSecretProtector implements SecretProtector {
    private static final int MAGIC = 0x50464B31; // PFK1
    private static final int VERSION = 1;
    private static final int TAG_BITS = 128;
    private static final int MAXIMUM_ENVELOPE_BYTES = 128 * 1024;
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "pokefolio.refresh-token.v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte[] AAD =
            "PokeFolio.Android.RefreshToken.v1".getBytes(StandardCharsets.UTF_8);
    private static final Object KEY_GATE = new Object();

    @Override
    public byte[] protect(byte[] plaintext) throws GeneralSecurityException, IOException {
        if (plaintext == null || plaintext.length == 0) {
            throw new IllegalArgumentException("Plaintext must not be empty.");
        }
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        cipher.updateAAD(AAD);
        byte[] ciphertext = cipher.doFinal(plaintext);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length < 12 || iv.length > 16
                || 12 + iv.length + ciphertext.length > MAXIMUM_ENVELOPE_BYTES) {
            throw new IOException("Android Keystore returned an invalid AES-GCM envelope.");
        }

        ByteBuffer envelope = ByteBuffer.allocate(12 + iv.length + ciphertext.length);
        envelope.putInt(MAGIC);
        envelope.putInt(VERSION);
        envelope.putInt(iv.length);
        envelope.put(iv);
        envelope.put(ciphertext);
        return envelope.array();
    }

    @Override
    public byte[] unprotect(byte[] envelope) throws GeneralSecurityException, IOException {
        if (envelope == null || envelope.length < 12 + 12 + 16
                || envelope.length > MAXIMUM_ENVELOPE_BYTES) {
            throw new IOException("Protected refresh-token envelope has an invalid size.");
        }
        ByteBuffer reader = ByteBuffer.wrap(envelope);
        if (reader.getInt() != MAGIC || reader.getInt() != VERSION) {
            throw new IOException("Protected refresh-token envelope has an unsupported format.");
        }
        int ivLength = reader.getInt();
        if (ivLength < 12 || ivLength > 16 || reader.remaining() < ivLength + 16) {
            throw new IOException("Protected refresh-token envelope is malformed.");
        }
        byte[] iv = new byte[ivLength];
        reader.get(iv);
        byte[] ciphertext = new byte[reader.remaining()];
        reader.get(ciphertext);

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(TAG_BITS, iv));
        cipher.updateAAD(AAD);
        return cipher.doFinal(ciphertext);
    }

    private static SecretKey getOrCreateKey() throws GeneralSecurityException, IOException {
        synchronized (KEY_GATE) {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            Key existing = keyStore.getKey(KEY_ALIAS, null);
            if (existing != null) {
                if (!(existing instanceof SecretKey)) {
                    throw new GeneralSecurityException("Android Keystore alias is not an AES key.");
                }
                return (SecretKey) existing;
            }

            KeyGenerator generator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES,
                    KEYSTORE);
            generator.init(new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .setUserAuthenticationRequired(false)
                    .build());
            return generator.generateKey();
        }
    }
}
