package de.pokefolio.app.security;

import java.io.IOException;
import java.security.GeneralSecurityException;

interface SecretProtector {
    byte[] protect(byte[] plaintext) throws GeneralSecurityException, IOException;

    byte[] unprotect(byte[] ciphertext) throws GeneralSecurityException, IOException;
}
