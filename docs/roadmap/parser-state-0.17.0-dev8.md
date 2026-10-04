# PokeFolio Android 0.17.0-dev8 – Parser, Zustand und Identität

Stand: 4. Oktober 2026. versionCode 43. Fokus ausschließlich auf die gemeldeten Scannerfehler. Aufnahmegeometrie, Kamera-Crop, Sammlung, Grading, Preise und Navigation wurden nicht umgebaut.

## Die 24 angefragten Antworten

1. **Warum blieb 370 im Namen?** Der bisherige Parser entfernte Zahlen nur zusammen mit einem expliziten KP-/HP-Token. An `eX370` angehängte HP und verrauschte Logos wurden nicht getrennt. Jetzt werden Stage, HP und Evolutionszeilen vor der Variantenanalyse bereinigt. Plausible angehängte HP werden separat gespeichert.
2. **Warum fehlte ex?** Der Suffix-Ausdruck erwartete exakt `ex` oder `EX` am Namensende. Gemischtes `eX`, zusätzliches `e/X/×` und anschließende Ziffern verhinderten den Treffer. Die OCR-Formen werden bereinigt. Literales historisches EX bleibt unterscheidbar; bekannter moderner beziehungsweise XY/BW-Setkontext klärt die Schreibweise zusätzlich.
3. **Warum OMEP mit hoher Confidence?** Jeder 2–5-stellige Buchstabenblock vor DE/EN usw. konnte Set-Stimmen sammeln. Die Anzeige berechnete Sicherheit aus der Stimmenzahl statt aus einer Validierung. Jetzt gelten bekannte Codes aus den Katalog-Metadaten; OMEP wird ausdrücklich zu MEP korrigiert und mit 90 % statt 100 % angezeigt.
4. **Warum fehlte 091?** Die alte Promo-Regel verlangte das exakte Token MEP/SVP und nach dessen Entfernung eine reine dreistellige Zahl. Ein zusätzliches O oder weitere Zeichen in derselben Zeile verhinderten die Erkennung. Das neue Set-/Sprach-/Nummernfenster liest die Einzelnummer direkt und erhält zugleich `091` für die Anzeige und `91` für die Identität.
5. **Warum EIN?** Die Set-Voting-Logik validierte gedruckte Buchstabenfolgen nicht gegen den Katalog. EIN/EINE/EINEN/EINES/EINEM/EINER sind jetzt ausdrücklich ungültig und erhalten 0 %. Der konkrete vollständige Geräte-OCR-Dump liegt nicht vor: Aus den hier gelieferten isolierten Flavor-Zeilen allein ließ sich die frühere EIN-Auswahl nicht reproduzieren. Das ist keine behauptete Rekonstruktion aller ursprünglichen OCR-Pässe.
6. **Warum wurde PBL übergangen?** Zuvor entschieden zusammengezählte Stimmen ohne Vorrang eines validierten Identitätsfensters. Ungültige konkurrierende Tokens konnten dadurch den Suchschlüssel bestimmen. Jetzt hat `PBL DE 039/084` Vorrang, insbesondere aus der unteren linken Zone. Bei den bereitgestellten minimalen OCR-Strings wird PBL zuverlässig gewählt; die genaue frühere Stimmenverteilung ist ohne vollständigen Dump nicht belegbar.
7. **Warum Moruda = mega?** Nachweisbarer Regex-Fehler: Der Mega-Kurzpräfix `M` verwendete einen Großbuchstaben-Lookahead zusammen mit dem Flag `i`. Dadurch genügte bereits das M am Anfang von Moruda, Mew oder Mewtu. Nun ist eine echte Präfixgrenze erforderlich.
8. **Echter State-/Cache-Leak?** Das falsche Mega-Präfix ist ohne vorherigen Scan reproduzierbar und somit kein Beleg für einen übernommennen Mega-Scan. Zusätzlich gab es unzureichend isolierte Bildstatusfelder und mögliche verspätete UI-Antworten. OCR-Schlüssel enthalten jetzt Scan-ID, vollständigen Bildinhalt, ROI-Profil und Sprache; Ergebnisse verschiedener Scans teilen keinen OCR-Eintrag. Parser-Ergebnisse sind frische Objekte. Katalog-Lookups löschen flüchtige Artwork-Felder. Späte Lookup-/Bildantworten prüfen die Scan-ID. Persistente Bildbytes bleiben bewusst nach URL gecacht, damit sie scanübergreifend wiederverwendbar sind.
9. **Warum Moruda als Catalog-Miss?** Ein falscher, nicht validierter Set-Schlüssel konnte die Signatur als vollständig markieren; zu EIN + 039 gab es erwartbar keinen exakten Treffer. Nun kann ein ungültiger Code keinen Set-Schlüssel liefern. Mit PBL + 039 ergibt sich canonicalSet `me5`, ein exakter Treffer und kein Catalog-Miss.
10. **Warum nur etwa 39 %?** Ein Set-Widerspruch begrenzte Kandidaten auf 39 %, auch wenn Name und Nummer zu Moruda passten. Die Begrenzung ist für echte Widersprüche richtig; korrigiert wurden die falschen Eingabemerkmale. Das falsche Mega-Debugfeld wird unabhängig davon ebenfalls behoben.
11. **Warum Dragoran als Final Identity?** Die Debug-/Historienzuweisung übernahm unconditionally den ersten Kandidaten, selbst wenn dieser nur eine ähnliche Karte mit niedrigem Score war. Final Identity wird jetzt nur ohne `similarOnly` und ab 60 % gesetzt. Schwache oder widersprüchliche Kandidaten bleiben ähnliche Karten; eine OCR-Identität kann trotzdem angezeigt werden.
12. **Warum unnötiges Remote bei Moruda?** Der beschädigte lokale Schlüssel führte zum vermeintlichen Miss. Ein exakter lokaler Moruda-Treffer beendet die Suche jetzt ohne Remote-Aufruf. Ein echter deutscher Katalog-Miss liefert sofort das lokale Ergebnis und eine nachgelagerte, exakte Online-Prüfung; die breite Remote-Namenssuche wird dabei nicht mehr gestartet.
13. **Warum Bild und „nicht verfügbar“ gleichzeitig?** Der Text wertete unter anderem das fehlende Feld `imageLanguage` als fehlendes Bild, während „Artwork Loaded“ per `some(...)` über sämtliche Kandidaten berechnet wurde. Nun beziehen sich URL, Ladezustand und Fehler auf den fokussierten Kandidaten und seine Referenz; Thumbnail-Ereignisse überschreiben nicht den Hauptbildstatus. Erfolgreiches Laden entfernt den Fehlerplatzhalter und zeigt die Referenzsprache. Bild-Cache und Visual Matching verwenden dieselben gespeicherten Bytes. Bei MEP 091 wird kein ähnliches Dragoran-Bild als Kartenreferenz gezeigt.
14. **Neuer Mega-Parse:** `PHASE2 Mega-Dragoran eX370` → Name `Mega-Dragoran ex`, Basis `Dragoran`, Präfix `mega`, Suffix `ex`, HP `370`; `OMEP DE 091` → Set `MEP`, Sprache `de`, Nummer numerisch `91`, Anzeige `091`, Korrektur `OMEP → MEP`, Set-Confidence `90 %`.
15. **Neuer Moruda-Parse:** `BASIS Moruda KP 140` → Name/Basis `Moruda`, kein Präfix/Suffix, HP `140`; `J PBL DE 039/084` → Regulation `J`, Set `PBL`, Sprache `de`, Nummer `39`, Setgröße `84`, Anzeige `039/084`, canonicalSet `me5`, Setname `Dunkelnacht`.
16. **Neuer Moruda-Score:** 98 % im Regressionstest mit dem echten gebündelten deutschen Katalog; exakt ein Set-/Nummern-Kandidat.
17. **Moruda-Lookup:** `LOCAL_INDEX/set+number`, Catalog-Miss = NEIN, RemoteUsed = false. Gleichwertige gespeicherte Sammlungs-IDs werden weiter über die bestehende kanonische Identität dedupliziert.
18. **Mega-Catalog-Miss korrekt? JA im Regressionstest.** Kein lokaler MEP-091-Datensatz, keine falsche Final Identity. Die erneute reale Anfrage an `https://api.tcgdex.net/v2/de/cards/mep-091` am 4. Oktober 2026 liefert 404. Moruda `/me05-039` liefert 200 einschließlich Referenzbild-Basis-URL. Ähnliche Karten bleiben getrennt und schwach.
19. **Full-OCR Calls:** 0 für beide OCR-Beispiele im getesteten Triggerpfad. Ein plausibler Name mit mindestens 90 % Header-Confidence verhindert den Full-OCR-Fallback auch ohne vollständigen Nummernschlüssel. Keine Behauptung eines neuen nativen Gerätetraces.
20. **Capture→First Result Mega:** Nicht neu auf Android gemessen. Kein adb-Gerät angeschlossen. Die Online-Prüfung wird erst nach der initialen Darstellung gestartet; die OCR-Identität ist unabhängig von ihrem Ergebnis.
21. **Capture→First Result Moruda:** Nicht neu auf Android gemessen. Die vom Nutzer gemeldeten etwa 975 ms für dev7 sind Gerätebeobachtungen des Nutzers, keine eigene Vergleichsmessung. Im Desktop-Benchmark sinkt allein Parser + Lookup + Ranking von Median 1,105 auf 0,268 ms. Mega benötigt für diese Teilschritte 1,303 → 1,393 ms. Diese Werte enthalten weder Kamera, native OCR noch Android-Rendering und dürfen nicht als Scan-Zeiten ausgegeben werden.
22. **Tests:** 410 JavaScript-Tests und 88 native Unit-Tests bestanden, insgesamt **498**. Davon 22 neue dev8-Regressionen. Android Lint: 0 Fehler, 14 Warnungen. Debug-APK und Instrumentation-APK gebaut. CameraX-Instrumentation bleibt ohne Gerät nicht ausgeführt.
23. **Neue Version:** `0.17.0-dev8`, versionCode `43`, Debug-APK, GitHub-Test-Prerelease `v0.17.0-dev8`.
24. **APK-Pfad:** `build/releases/PokeFolio-Android-0.17.0-dev8.apk`. SHA-256: `f25d4bb0c9c5b79297ea260a6f0b15e470b47b7c55f1ac0804becbb48f3acdea`.

## Regressionen und Messgrenzen

`tests/dev8-parser-state.test.js` prüft die beiden Gerätestrings, sechs verrauschte ex-/HP-Schreibweisen, Generationstrennung, Moruda ohne Mega-Präfix, aufeinanderfolgende Scans, ungültige Setwörter, Vorrang der linken Identitätszone, Confidence-Grenze, Full-OCR-Trigger, keinen Remote-Aufruf bei Moruda, verzögerten exakten Remote-Lookup bei Mega, veraltete Scan-Antworten, erfolgreiche Bildanzeige ohne Fehlertext und das Zurücksetzen flüchtiger Bildfelder.

Die bisherigen Tests wurden an die explizit gewünschte verzögerte Remote-Prüfung, die Anzeige führender Nullen und Scan-ID-gebundene Bildereignisse angepasst. Der Desktop-Vergleich verwendet 200 Messungen nach 20 Warmups auf denselben OCR-Strings; Details stehen in `parser-lookup-benchmark-dev8.json`.

Die Debugansicht gliedert sich in HEADER, BOTTOM, LOOKUP, IDENTITY, ARTWORK und PERFORMANCE. `FIRST RESULT RENDERED` wird nach zwei Animation-Frame-Callbacks erfasst und ist damit eine UI-Zeitmessung, kein extern gemessener Display-Photonenzeitpunkt. Cache Hit bezeichnet das Vorhandensein eines URL-spezifischen Bildes im nativen Cache vor dem Laden. Die tatsächliche Bilddarstellung und das Cache-Verhalten auf einem Handy müssen weiterhin geräteseitig bestätigt werden.

## Geänderte Dateien

- `app/build.gradle`
- `app/src/main/assets/app.js`
- `app/src/main/assets/catalog-core.js`
- `app/src/main/assets/index.html`
- `app/src/main/assets/recognition-core.js`
- `app/src/main/java/de/pokefolio/app/MainActivity.java`
- `tests/catalog-stability.test.js`
- `tests/dev8-parser-state.test.js`
- `tests/famieps-regression.test.js`
- `tests/pokemon-bottom-left-v0165.test.js`
- `docs/roadmap/parser-lookup-benchmark-dev8.json`
- `docs/roadmap/parser-state-0.17.0-dev8.md`
