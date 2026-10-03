# PokeFolio Android 0.17.0-dev7

Stand: 3. Oktober 2026. versionCode 42. Gezielte Korrekturen an Identifikation, Referenzbildern und Orientierung; feste Aufnahmegeometrie und Sammlungsmigration bleiben unverändert.

## Ergebnisse der 15 angefragten Prüfpunkte

1. **MEP 091 lokal vorhanden? Nein.** Der gebündelte deutsche Katalog enthält diesen Datensatz nicht. Es wurde kein Ersatzdatensatz erfunden.
2. **Remote vorhanden?** Der geprüfte TCGdex-Endpunkt `/v2/de/cards/mep-091` liefert HTTP 404. Der Lookup versucht Set und Nummer vor der breiteren Suche. Ein fehlender Datensatz wird mit Set und Nummer als Katalog-Miss angezeigt.
3. **Ursache des falschen Dragoran-Treffers:** Die Namenssuche konnte den gemeinsamen Basisnamen stark gewichten, ohne widersprechende Form, Set und Nummer ausreichend zu begrenzen. Eine spätere Confidence-Anhebung konnte diesen Fehler verstärken. Diese Widersprüche werden jetzt vor und nach solchen Anhebungen geprüft. Im echten Katalog erhält Dragoran-ex δ im Referenzfall 27 % Ähnlichkeit statt einer sicheren Identität.
4. **Variantenparser:** Vollständiger Name, Basis-Pokémon, Präfix, Suffix und Delta-Merkmal bleiben getrennt erhalten. Mega, regionale Formen, Shiny, ex/EX, V, VMAX, VSTAR, GX und TAG TEAM werden berücksichtigt; ex und EX bleiben unterscheidbar. Bindestriche und Unicode werden normalisiert.
5. **Set und Nummer:** Exakte Set-/Nummern-Treffer werden zuerst aus dem Index geladen. Sind sie vorhanden, wird keine fuzzy Kandidatenfamilie beigemischt. Widersprechende Varianten werden dennoch nicht sicher ausgewählt. Ohne exakten Datensatz folgen Remote-Prüfung und getrennte ähnliche Karten. Lernen und Visual Matching dürfen widersprüchliche Kandidaten nicht wieder hochstufen.
6. **Fehlende Referenzbilder:** Falsche Kandidatenfamilien führten teilweise zu alten Datensätzen ohne Bildfeld. Zusätzlich wurden nicht alle Provider-Bildfelder/Basis-URLs einheitlich ausgewertet. Der alte deutsche Dragoran-ex-δ-Bildpfad liefert tatsächlich 404. URLs werden jetzt normalisiert, fehlende Detaildaten optional nachgeladen und erfolgreiche Bilder in einem gemeinsamen nativen Cache für Anzeige und Bildvergleich gespeichert. Fehlende Bilder verhindern keine Identifikation.
7. **Artwork-Zahlen:** Die lokale Mega-Abfrage liefert 41 ähnliche Kandidaten, davon 28 mit Bild-URL; vier der ersten fünf haben eine URL. Das sind vorhandene URLs, keine behaupteten erfolgreichen Geräteladevorgänge. Moruda hat eine URL; sein konkretes Referenzbild antwortet mit HTTP 200 und `image/webp`. Keine Referenz für das fehlende MEP 091 verfügbar.
8. **Moruda:** Der reale lokale Datensatz `me05-039`, PBL 039/084, bleibt im Regressionstest der eindeutige Treffer mit Score 0,98 und Referenzbild-URL. Ein erneuter Kameratest auf einem Gerät steht aus.
9. **Mega-Dragoran ex:** Name und Variante bleiben erhalten. Der aktuelle reale Katalog führt korrekt zum Katalog-Miss, nicht zu einer falschen sicheren Dragoran-Identität. Ein separat gekennzeichneter Testdatensatz prüft zusätzlich das Verhalten bei künftig vorhandenem MEP 091.
10. **Deoxys:** Die normale schnelle Pokémon-Erkennung übernimmt zunächst die Sensor-/EXIF-Orientierung. Nur bei vertauschter Header-/Footer-Struktur wird einmal zusätzlich 180° geprüft; der neue Score muss mindestens 8 erreichen und mindestens 6 Punkte besser sein. Die nachgelagerte vollständige Pokémon-OCR startet keine erneute Vierfach-Rotationssuche. Aufrechter Deoxys, vertauschte Struktur und unsichere Texte sind native Regressionstests. Die bisherige allgemeine Rotationsheuristik konnte mit unsicheren Texten eine falsche Orientierung bevorzugen. Eine Bestätigung mit dem konkreten Deoxys-Foto steht mangels Gerät/Bild noch aus.
11. **Time to First Result vorher/nachher:** Auf Android nicht gemessen: kein angeschlossenes Gerät. Daher keine erfundenen Zeiten. Der beigefügte Desktop-Benchmark misst ausschließlich lokalen Index und Ranking (200 Messungen nach 20 Warmups): Mega Median 0,8353 ms, P95 1,0214 ms; Moruda Median 0,0087 ms, P95 0,0121 ms. Nicht mit Capture/OCR oder Android-Zeiten gleichsetzen. Textresultate warten nicht mehr auf den visuellen Vergleich; dieser arbeitet nachgelagert mit höchstens drei starken Kandidaten. Referenzbilder werden asynchron geladen.
12. **Tests:** 388 JavaScript-Tests und 88 native Unit-Tests bestanden, zusammen 476. Android Lint: 0 Fehler, 14 Warnungen. Debug-APK und AndroidTest-APK erfolgreich gebaut. Instrumentation wurde ohne angeschlossenes Android-Gerät nicht ausgeführt.
13. **Geänderte Dateien:** siehe Liste unten.
14. **Neue APK:** PokeFolio Android 0.17.0-dev7, versionCode 42, Debug-Signatur.
15. **APK-Pfad:** `build/releases/PokeFolio-Android-0.17.0-dev7.apk`. Veröffentlichung als GitHub-Prerelease `v0.17.0-dev7`.

## Neue Regressionen

`tests/mega-family-regression.test.js`: 12 Tests für Namens-/Varianten-Erhalt, Vorrang exakter Set-/Nummern-Treffer, echten MEP-Katalog-Miss, schwache falsche Dragoran-Varianten, erneute Confidence-Begrenzung, Moruda, Provider-Bildfelder, fehlende Bilder und Cache-/Orientierungsverdrahtung.

`HeaderFooterOrientationTest.java`: 5 Tests für aufrechten Deoxys, eindeutig vertauschte Struktur, unsichere OCR ohne Rotation, aufrechte Mega-/Moruda-Struktur und Ausschluss von Copyright/Setcode als Name. Cache- und UI-Verdrahtungstests ersetzen keinen erfolgreichen Lade- oder Kameratest auf einem echten Gerät.

## Geänderte Dateien

- `app/build.gradle`
- `app/src/main/assets/app.js`
- `app/src/main/assets/catalog-core.js`
- `app/src/main/assets/index.html`
- `app/src/main/assets/recognition-core.js`
- `app/src/main/assets/reference-core.js`
- `app/src/main/java/de/pokefolio/app/CardRoiLayout.java`
- `app/src/main/java/de/pokefolio/app/MainActivity.java`
- `app/src/test/java/de/pokefolio/app/HeaderFooterOrientationTest.java`
- `tests/catalog-stability.test.js`
- `tests/mega-family-regression.test.js`
- `tests/premium-dashboard-ui.test.js`
- `tests/visual-candidates-ui.test.js`
- `docs/roadmap/mega-orientation-benchmark-dev7.json`
- `docs/roadmap/mega-orientation-0.17.0-dev7.md`

## Noch am Handy zu prüfen

Konkrete Mega-/Deoxys-/Moruda-Aufnahmen, tatsächliche Bildanzeige und Wiederverwendung aus dem Cache, Offline-Verhalten und Capture-bis-Ergebnis-Zeiten. Bestehende CameraX-Instrumentation ist gebaut, aber weiterhin nicht auf einem Gerät ausgeführt. Die Version ist deshalb ausdrücklich ein Test-Prerelease.
