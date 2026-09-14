package de.pokefolio.app.backend;

import java.io.IOException;
import java.util.HashSet;
import java.util.Set;

/** Small dependency-free JSON syntax and duplicate-key validator for native trust boundaries. */
public final class StrictJsonValidator {
    private static final int MAXIMUM_DEPTH = 64;

    private StrictJsonValidator() {
    }

    public static void validateObject(String json) throws IOException {
        if (json == null) throw new IOException("JSON is missing.");
        Parser parser = new Parser(json);
        parser.skipWhitespace();
        if (!parser.hasNext() || parser.peek() != '{') {
            throw new IOException("JSON root must be an object.");
        }
        parser.readObject(0);
        parser.skipWhitespace();
        if (parser.hasNext()) throw new IOException("JSON contains trailing data.");
    }

    private static final class Parser {
        private final String input;
        private int index;

        Parser(String input) {
            this.input = input;
        }

        boolean hasNext() {
            return index < input.length();
        }

        char peek() throws IOException {
            if (!hasNext()) throw new IOException("Unexpected end of JSON.");
            return input.charAt(index);
        }

        void skipWhitespace() {
            while (hasNext()) {
                char value = input.charAt(index);
                if (value != ' ' && value != '\t' && value != '\r' && value != '\n') break;
                index++;
            }
        }

        void readValue(int depth) throws IOException {
            if (depth > MAXIMUM_DEPTH) throw new IOException("JSON nesting is too deep.");
            skipWhitespace();
            char value = peek();
            if (value == '{') readObject(depth);
            else if (value == '[') readArray(depth);
            else if (value == '"') readString();
            else if (value == 't') readLiteral("true");
            else if (value == 'f') readLiteral("false");
            else if (value == 'n') readLiteral("null");
            else readNumber();
        }

        void readObject(int depth) throws IOException {
            expect('{');
            skipWhitespace();
            if (hasNext() && input.charAt(index) == '}') {
                index++;
                return;
            }
            Set<String> properties = new HashSet<>();
            while (true) {
                skipWhitespace();
                String property = readString();
                if (!properties.add(property)) {
                    throw new IOException("JSON contains duplicate property " + property + ".");
                }
                skipWhitespace();
                expect(':');
                readValue(depth + 1);
                skipWhitespace();
                char separator = peek();
                index++;
                if (separator == '}') return;
                if (separator != ',') throw new IOException("JSON object is malformed.");
            }
        }

        void readArray(int depth) throws IOException {
            expect('[');
            skipWhitespace();
            if (hasNext() && input.charAt(index) == ']') {
                index++;
                return;
            }
            while (true) {
                readValue(depth + 1);
                skipWhitespace();
                char separator = peek();
                index++;
                if (separator == ']') return;
                if (separator != ',') throw new IOException("JSON array is malformed.");
            }
        }

        String readString() throws IOException {
            expect('"');
            StringBuilder output = new StringBuilder();
            while (hasNext()) {
                char value = input.charAt(index++);
                if (value == '"') return output.toString();
                if (value < 0x20) throw new IOException("JSON string contains a control character.");
                if (value != '\\') {
                    output.append(value);
                    continue;
                }
                if (!hasNext()) throw new IOException("JSON escape is incomplete.");
                char escaped = input.charAt(index++);
                switch (escaped) {
                    case '"': output.append('"'); break;
                    case '\\': output.append('\\'); break;
                    case '/': output.append('/'); break;
                    case 'b': output.append('\b'); break;
                    case 'f': output.append('\f'); break;
                    case 'n': output.append('\n'); break;
                    case 'r': output.append('\r'); break;
                    case 't': output.append('\t'); break;
                    case 'u': output.append(readUnicodeEscape()); break;
                    default: throw new IOException("JSON escape is invalid.");
                }
            }
            throw new IOException("JSON string is unterminated.");
        }

        char readUnicodeEscape() throws IOException {
            if (index + 4 > input.length()) throw new IOException("JSON unicode escape is incomplete.");
            int value = 0;
            for (int offset = 0; offset < 4; offset++) {
                int digit = Character.digit(input.charAt(index++), 16);
                if (digit < 0) throw new IOException("JSON unicode escape is invalid.");
                value = value * 16 + digit;
            }
            return (char) value;
        }

        void readLiteral(String literal) throws IOException {
            if (!input.startsWith(literal, index)) throw new IOException("JSON literal is invalid.");
            index += literal.length();
        }

        void readNumber() throws IOException {
            int start = index;
            if (hasNext() && input.charAt(index) == '-') index++;
            if (!hasNext()) throw new IOException("JSON number is incomplete.");
            if (input.charAt(index) == '0') {
                index++;
            } else {
                if (!isDigit(input.charAt(index), '1', '9')) {
                    throw new IOException("JSON number is invalid.");
                }
                while (hasNext() && isDigit(input.charAt(index), '0', '9')) index++;
            }
            if (hasNext() && input.charAt(index) == '.') {
                index++;
                int fractionStart = index;
                while (hasNext() && isDigit(input.charAt(index), '0', '9')) index++;
                if (fractionStart == index) throw new IOException("JSON fraction is invalid.");
            }
            if (hasNext() && (input.charAt(index) == 'e' || input.charAt(index) == 'E')) {
                index++;
                if (hasNext() && (input.charAt(index) == '+' || input.charAt(index) == '-')) index++;
                int exponentStart = index;
                while (hasNext() && isDigit(input.charAt(index), '0', '9')) index++;
                if (exponentStart == index) throw new IOException("JSON exponent is invalid.");
            }
            if (start == index) throw new IOException("JSON value is invalid.");
        }

        void expect(char expected) throws IOException {
            if (!hasNext() || input.charAt(index) != expected) {
                throw new IOException("JSON syntax is invalid.");
            }
            index++;
        }

        private static boolean isDigit(char value, char minimum, char maximum) {
            return value >= minimum && value <= maximum;
        }
    }
}
