# PokeFolio Android 0.17.0-dev6 – Stabilität und Performance

Stand: 03.10.2026. versionCode 41. Fokus: Aufnahmegeometrie, lokale Suche, Set-Identität und schneller OCR-Pfad.

## 1. Ursache des verschobenen Crops

Der starre Rahmen war in dev5 nur eine Zielhilfe. `CameraActivity` übergab nach Capture das vollständige Foto an `prepareCapturedCardDetailed`. Dessen unabhängige Kantensuche durfte eine andere Kontur wählen. Damit konnte die richtige Live-Position nachträglich verloren gehen. Zusätzlich las die Live-Textprüfung bisher relativ zur beweglichen erkannten Kontur.

Jetzt ist der feste Rahmen die einzige Kamera-Crop-Geometrie. Im Kamera-Capture-Pfad gibt es keinen Aufruf der freien Post-Capture-Detektion mehr. Live-Textprüfung und Capture verwenden den festen Bereich. Zu kleine oder stark versetzte Karten geben Auto-Capture nicht frei. Manuelles Auslösen bleibt manuell.

## 2. Preview → Capture

Beim Auslösen wird der `PreviewView.getOutputTransform()` festgehalten. Overlay-Koordinaten werden zunächst um den tatsächlichen Versatz zwischen Overlay und PreviewView korrigiert. CameraX `FileTransformFactory` liefert die Transformation des gespeicherten JPEG, mit aktivierter EXIF-Orientierung. `CoordinateTransform` bildet den Rahmen zwischen den beiden Ausgaben des gemeinsamen ViewPorts ab. Erst danach wird die tatsächliche Dekodierauflösung berücksichtigt.

Damit werden Preview-FILL_CENTER, ViewPort-Zuschnitt, Rotation und Spiegelung durch die CameraX-Matrizen berücksichtigt. Es wird nicht mehr eine Bildschirmbreite ungefähr auf eine Fotobreite umgerechnet. Um das abgebildete Rechteck bleiben 3 % Rand je Seite, begrenzt durch das Foto. Fehlt die Transformation oder ist das Ergebnis ungültig, wird die Aufnahme nicht mit einem geratenen Zuschnitt fortgesetzt.

Eine weitere Perspektiv-/Kantenkorrektur im Kamera-Capture ist bewusst nicht aktiv: Sie ist optional, und die vollständige Rahmenfläche hat Vorrang. Die bestehende Verarbeitung von Galerie-Uploads bleibt erhalten. Eine spätere sichere 180°-Textorientierung dreht dieselbe Fläche, sie verschiebt oder verkleinert sie nicht.

API-Grundlagen: [CameraX CoordinateTransform](https://developer.android.com/reference/androidx/camera/view/transform/CoordinateTransform), [FileTransformFactory](https://developer.android.com/reference/androidx/camera/view/transform/FileTransformFactory), [Capture-Transformation](https://developer.android.com/media/camera/camerax/transform-output).

## 3. Dunkelnacht: Ursache und Nachweisgrenze

Die bisherige Sammlung gruppierte nach `setId || setCode || set`. Dadurch bildeten etwa Provider-ID, gedrucktes Kürzel und Legacy-ID verschiedene Gruppen, auch bei demselben Anzeigenamen und derselben Sprache. Ein offizieller Abgleich bestätigt: Dunkelnacht hat TCGdex-ID `me05`, gedrucktes Kürzel `PBL`, 84 reguläre Karten. Eine bloße Normalisierung der Groß-/Kleinschreibung konnte diese IDs nicht zusammenführen.

Die konkreten zwei Datensätze auf dem Handy liegen hier nicht vor. Deshalb ist nicht behauptet, welche beiden IDs dort tatsächlich gespeichert sind. Der nachweisbare Gruppierungsfehler und die belegten Aliase sind durch Tests abgedeckt.

## 4. Kanonische Sets und sichere Migration

Ein kanonischer Schlüssel enthält Spiel, Sprache und normalisierte Provider-Set-ID, z. B. `pokemon:de:me5`. Offizielle gedruckte Kürzel aller verfügbaren Sets und eindeutige Katalognamen verweisen auf diese Identität. `me05`, `me5`, `PBL` und der eindeutige Katalogname Dunkelnacht gehören damit zur gleichen Set-Kachel. Deutsch und Englisch bleiben getrennt.

Schema 7 ergänzt die kanonische Set-Identität. Vor dem Speichern wird pro Sammlung eine vollständige Sicherung unter `<collection storage key>:before-canonical-v7` angelegt. Scheitert die Sicherung, wird der Altbestand nicht überschrieben. Der Test prüft die Idempotenz der Migration.

Es werden keine individuellen Kartenbestände wegen einer Set-Alias-Korrektur gelöscht oder destruktiv zusammengelegt. Die logische Set-Kachel aggregiert Mengen und Werte; Nummern mit/ohne führende Nullen zählen einmal. Einzelbestände behalten Zustand, Favoriten, Preise, Bilder und Scan-Historie. Die bisherige Karten-Merge-Identität wird nicht pauschal umgeschrieben. Auch Set-Filter verstehen die Aliase.

## 5. Alola-Kokowei und Candidate Retrieval

Zuvor war die normale Suche netzwerkabhängig; ein lokaler vollständiger Kartenindex existierte nicht. Dazu kamen harte Nummern-/Identitätsfilter und die Übertragung gedruckter Kürzel als vermeintliche Provider-IDs. Ein korrekt gelesener Name konnte deshalb nach dem Retrieval wieder ohne Kandidaten enden.

Die neue Suche vereinigt Set+Nummer, Nummer, normalisierten Namen und regionale/fuzzy Namensvarianten. Exakte Set+Nummer-Treffer stehen oben; ein Tippfehler im Namen blockiert den Kandidaten nicht. Ein deutlich widersprechender Name verhindert weiterhin eine sichere automatische Auswahl. Nummern ohne Slash sind Suchmerkmale; eine unbestätigte Einzelnummer wird nicht allein als sichere Identität behandelt.

Bei einer klar gelesenen Kombination, die lokal fehlt, steht ausdrücklich „Karte erkannt, Datensatz im lokalen Katalog nicht vorhanden“. Der vorhandene TCGdex-Dienst wird dann als zweite Stufe abgefragt. Ergebnisse landen im persistenten lokalen Katalogcache. Die Tests belegen: ein lokaler PAL-Treffer macht keinen Remote-Aufruf; ein später gelieferter MEP-Treffer wird beim nächsten Scan lokal wiederverwendet.

## 6. Katalogprüfung und fehlende Daten

Snapshot der bestehenden Quelle [TCGdex Deutsch](https://api.tcgdex.net/v2/de/sets), abgerufen am 02.10.2026:

- 144 physische Sets, 18.980 deutsche Karten im APK-Katalog.
- Digitale Pokémon-Pocket-Sets wurden ausgeschlossen.
- Gedruckte Kürzel für 137 Sets vorhanden. Bei `basep`, `exu`, `dpp`, `hgssp`, `xya`, `sma`, `swshp` liefert die Quelle kein offizielles Kürzel; Provider-ID und Name bleiben nutzbar.
- `PAL` → `sv02`: [Kwaks 206](https://api.tcgdex.net/v2/de/cards/sv02-206) und [Britzigel 073](https://api.tcgdex.net/v2/de/cards/sv02-073) sind tatsächlich vorhanden und lokal enthalten.
- `MEP` existiert, aber `mep-094` lieferte HTTP 404 und fehlt sowohl in der globalen Kartenliste als auch in der Set-Liste. Es wurde kein Alola-Kokowei-Datensatz erfunden. Andere Ausgaben dieses Namens können als Alternativen erscheinen, werden bei der fehlenden Kombination nicht automatisch übernommen.

Vorher waren diese PAL-Datensätze nicht als vollständiger Offline-Katalog gebündelt. Die Namenliste allein ist kein Kartendatensatz. Der neue Snapshot behebt diese lokale Lücke; eine echte upstream fehlende Karte kann erst nach Lieferung durch die Quelle gecacht werden.

`catalog-audit-0.17.0-dev6.json` enthält die vollständige Set-Liste mit geladenen Anzahlen, Provider-Gesamtzahlen und fehlenden Kürzeln. Differenzen zu Provider-Gesamtzahlen sind Diagnostik: manche Zahlen umfassen Varianten und beweisen nicht automatisch fehlende nummerierte Karten.

## 7. Suchindizes

`catalog-core.js` hält Maps für Set+Nummer, Nummer, normalisierten Namen und kanonisches Set. Kandidaten werden anhand Set+Nummer+Sprache dedupliziert. Fuzzy-Suche besucht eindeutige Namen statt bei jedem Scan sämtliche Karten zu filtern. Indexaufbau, Suche und Ranking laufen in einem Blob-Web-Worker ohne Netzwerk- oder importScripts-Abhängigkeit. Kleine vorbereitende Datenscheiben geben den UI-Thread beim Kaltstart frei.

## 8. OCR und Wartezeiten

Im Pokémon-/Auto-Primary-Pfad werden NAME_ROI und BOTTOM_ROI einmal vorbereitet und mit zwei ML-Kit-Tasks parallel gelesen. Die vier vollständigen Orientierungsscans entfallen vor dem schnellen Lookup. Gleiche Primary-OCR-Anfragen für dasselbe Bild, dieselbe Sprache und dasselbe Profil werden in einem begrenzten Promise-Cache zusammengeführt.

Ein eindeutiger lokaler Treffer überspringt die zuvor bei Pokémon unbedingt ausgeführte ausführliche OCR. Kandidaten erscheinen vor dem Warten auf Lern-Fingerprints, Bildvergleich oder Referenzbilder. Bilder lädt die bestehende Anzeige asynchron. Umfangreiche OCR und die konservative Orientierungsbewertung bleiben Fallbacks für schwache Merkmale. Die Mengenfunktion und die TCG-spezifischen Bulk-Identifier wurden nicht neu geschrieben.

Doppelte JPEG-Kodierung als Vollbild-Fallback und synchrone Debug-Bilddateien wurden aus dem festen Capture-Pfad entfernt. Die Diagnostik zeigt tatsächliche Crop-, ROI-, Lookup-, Ranking-, Remote- und First-Result-Zeiten; bei nativen Aufnahmen beginnt die letzte Messung am Capture-Zeitstempel einschließlich Übergabe an die WebView.

## 9. Gemessene Performance und Grenzen

Ein Android-Gerät/Emulator war nicht verbunden (`adb devices -l` leer). Deshalb sind weder eine vorherige noch eine neue durchschnittliche Android-Gesamterkennungszeit gemessen. Das Ziel unter 1,5 Sekunden wird nicht als erreicht behauptet.

Reproduzierbarer Index-Mikrobenchmark auf dem Windows-Entwicklungsrechner mit Node 24.19.0, 18.980 Karten, je 20 Aufwärmdurchläufe und 200 Messungen:

| Abfrage | Lookup Mittel | Ranking Mittel |
| --- | ---: | ---: |
| Kwaks / PAL / 206 | 0,187 ms | 0,134 ms |
| Britzigel / PAL / 073 | 0,168 ms | 0,520 ms |
| Alola-Kokowei / MEP / 094 (Miss) | 0,164 ms | 0,661 ms |
| Britzgel / PAL / 073 (Tippfehler) | 3,135 ms | 0,500 ms |

Indexaufbau: 57,246 ms in diesem Lauf. Das sind ausschließlich Desktop-Indexzeiten, keine OCR-, Android-, Kamera-, Worker-Transfer- oder Netzwerkzeiten. Rohwerte: `index-benchmark-0.17.0-dev6.json`.

## 10. Tests und APK

- 376/376 JavaScript-Tests bestanden.
- 83/83 Java-/JUnit-Tests bestanden.
- Insgesamt **459 bestandene Tests**, darunter 18 neue ausgeführte Tests (17 JavaScript, 1 Java).
- Android-Lint: 0 Fehler, 14 Warnungen.
- Danach `assembleDebug` und `assembleDebugAndroidTest` erfolgreich.
- APK-Version und Signatur geprüft: 0.17.0-dev6, code 41, App-ID `app.pokefolio.mobile`.
- 24 neue instrumentierte Fälle für CameraX-Dateitransformationen mit allen acht EXIF-Orientierungen, Spiegelung, Versatz/Letterboxing, Dekodierskalierung und erhaltenen Header-/Footer-Markern. Diese und die bisherigen Gerätefälle wurden kompiliert, mangels Gerät aber **nicht ausgeführt**.
- Installierbare APK: `build/releases/PokeFolio-Android-0.17.0-dev6.apk`.
- Instrumentierung: `build/releases/PokeFolio-Android-0.17.0-dev6-androidTest.apk`.
- SHA256: `aa414616505c595ffcd77399c3f54c9b22168ac2d5f8159efc6cd0faea2c1387`.

## 11. Geänderte Dateien

- `app/build.gradle`
- `app/src/androidTest/java/de/pokefolio/app/CardCropInstrumentation.java`
- `app/src/main/assets/app.js`
- `app/src/main/assets/catalog-core.js`
- `app/src/main/assets/catalog-de.js`
- `app/src/main/assets/collection-core.js`
- `app/src/main/assets/index.html`
- `app/src/main/assets/recognition-core.js`
- `app/src/main/java/de/pokefolio/app/CameraActivity.java`
- `app/src/main/java/de/pokefolio/app/CardImageProcessor.java`
- `app/src/main/java/de/pokefolio/app/FixedCaptureFrame.java`
- `app/src/main/java/de/pokefolio/app/FixedFrameCrop.java`
- `app/src/main/java/de/pokefolio/app/MainActivity.java`
- `app/src/test/java/de/pokefolio/app/FixedCaptureFrameTest.java`
- `docs/roadmap/catalog-audit-0.17.0-dev6.json`
- `docs/roadmap/index-benchmark-0.17.0-dev6.json`
- `docs/roadmap/stability-performance-0.17.0-dev6.md`
- `tests/catalog-stability.test.js`
- `tests/collection-core.test.js`
- `tests/fixed-frame-regression.test.js`
- `tests/learning-ui.test.js`
- `tests/multi-tcg-master-fix.test.js`
- `tests/native-visual-pipeline.test.js`
- `tests/pokemon-bottom-left-v0165.test.js`

## 12. Veröffentlichung

Quellcode auf Branch `codex/android-017-crop-stability`; Testrelease `v0.17.0-dev6` mit Debug-APK. Die Veröffentlichung erfolgt nach erfolgreicher Prüfung; der GitHub-Upload wird gegen die lokale SHA256 geprüft. Main wird dadurch nicht automatisch gemergt.
