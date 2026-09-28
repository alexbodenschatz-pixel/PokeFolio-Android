package de.pokefolio.app.backend;

import org.junit.Test;

import java.io.IOException;

import static org.junit.Assert.assertThrows;

public final class StrictJsonValidatorTest {
    @Test
    public void acceptsNestedStrictJsonObjects() throws Exception {
        StrictJsonValidator.validateObject(
                "{\"text\":\"escaped \\\" value\",\"array\":[1,-2.5e+2,true,null,{\"id\":1}]}" );
    }

    @Test
    public void validatesArrayRootsAndRejectsDuplicateNestedProperties() throws Exception {
        StrictJsonValidator.validateArray("[{\"id\":1},true,null]");
        assertThrows(IOException.class, () ->
                StrictJsonValidator.validateArray("[{\"id\":1,\"id\":2}]"));
        assertThrows(IOException.class, () -> StrictJsonValidator.validateArray("{}"));
    }

    @Test
    public void rejectsDuplicateKeysIncludingEquivalentUnicodeEscapes() {
        assertThrows(IOException.class, () ->
                StrictJsonValidator.validateObject("{\"userId\":1,\"userId\":2}"));
        assertThrows(IOException.class, () ->
                StrictJsonValidator.validateObject("{\"userId\":1,\"user\\u0049d\":2}"));
        assertThrows(IOException.class, () ->
                StrictJsonValidator.validateObject("{\"device\":{\"id\":1,\"id\":2}}"));
    }

    @Test
    public void rejectsTrailingMalformedAndExcessivelyNestedInput() {
        assertThrows(IOException.class, () -> StrictJsonValidator.validateObject("{} trailing"));
        assertThrows(IOException.class, () -> StrictJsonValidator.validateObject("{\"x\":01}"));
        assertThrows(IOException.class, () -> StrictJsonValidator.validateObject("{\"x\":true,}"));
        String nested = "{\"x\":" + "[".repeat(66) + "0" + "]".repeat(66) + "}";
        assertThrows(IOException.class, () -> StrictJsonValidator.validateObject(nested));
    }
}
