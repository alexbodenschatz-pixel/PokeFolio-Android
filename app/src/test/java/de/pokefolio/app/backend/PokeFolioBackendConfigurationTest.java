package de.pokefolio.app.backend;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public final class PokeFolioBackendConfigurationTest {
    @Test
    public void acceptsPathFreeHttpsAndNormalizesTheOrigin() {
        PokeFolioBackendConfiguration configuration =
                PokeFolioBackendConfiguration.parse(" HTTPS://API.Example.COM:8443/ ");

        assertTrue(configuration.isConfigured());
        assertEquals("https://api.example.com:8443/", configuration.getBackendOrigin().toString());
        assertNull(configuration.getError());
    }

    @Test
    public void permitsOnlyExplicitLoopbackHostsForHttpDevelopment() {
        assertTrue(PokeFolioBackendConfiguration.parse("http://localhost:5080").isConfigured());
        assertTrue(PokeFolioBackendConfiguration.parse("http://127.0.0.1:5080/").isConfigured());
        assertTrue(PokeFolioBackendConfiguration.parse("http://[::1]:5080/").isConfigured());

        assertFalse(PokeFolioBackendConfiguration.parse("http://api.example.com/").isConfigured());
        assertFalse(PokeFolioBackendConfiguration.parse("http://127.0.0.2:5080/").isConfigured());
        assertFalse(PokeFolioBackendConfiguration.parse("http://localhost.example.com/").isConfigured());
    }

    @Test
    public void rejectsCredentialsPathsQueriesFragmentsAndAmbiguousOrigins() {
        String[] invalid = {
                "https://user:password@api.example.com/",
                "https://api.example.com/api/v1",
                "https://api.example.com/?tenant=other",
                "https://api.example.com/#fragment",
                "//api.example.com/",
                "javascript:alert(1)",
                "https://api.example.com\\@evil.example/"
        };
        for (String value : invalid) {
            PokeFolioBackendConfiguration configuration =
                    PokeFolioBackendConfiguration.parse(value);
            assertFalse(value, configuration.isConfigured());
            assertNull(value, configuration.getBackendOrigin());
            assertTrue(value, configuration.getError().contains("path-free HTTPS"));
        }
    }

    @Test
    public void emptyConfigurationKeepsCloudFeaturesDisabledWithoutAnError() {
        PokeFolioBackendConfiguration configuration =
                PokeFolioBackendConfiguration.parse("  ");
        assertFalse(configuration.isConfigured());
        assertNull(configuration.getBackendOrigin());
        assertNull(configuration.getError());
    }
}
