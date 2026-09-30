# Scanner: feste ROIs und vorsichtige Orientierung – 0.17.0-dev4

## Ursachen

Die bisherige native Orientierungswahl erlaubte eine Drehung ab einem OCR-Score von
2,0 und einem Vorsprung von 1,15 beziehungsweise 14 %. Einzelne erkannte Wörter und
Zahlen konnten deshalb eine 180°-Variante bevorzugen, ohne dass Name oben und
Kennung unten bestätigt waren. Die JavaScript-Seite akzeptierte außerdem eine
gemeldete Rotation auch bei fehlendem explizitem Confidence-Nachweis. Eine bereits
plausible aufrechte Struktur hatte keinen verbindlichen Vorrang.

Die bisherigen OCR-Zonen waren unterschiedlich breit und hoch: Kopf bis 20 %,
primärer Footer ab 80 % auf 72 % der Breite, zusätzlicher Footer-Kontext ab 84 %.
Einzelne Nummern ohne bekanntes Promo-Set wurden verworfen. Wiederholte
Vollbild-Namen konnten mit der gezielten Kopfzeile konkurrieren. Diese Codepfade
erklären die Schwachstellen; das konkrete Solgaleo-Foto liegt nicht vor und wurde
nicht auf einem Gerät reproduziert.

## Änderungen

- Gemeinsame Kartenkoordinaten in `CardRoiLayout`: horizontal 2,5–97,5 %;
  NAME_ROI vertikal 1,5–18 %; BOTTOM_ROI vertikal 84–99,5 %.
- Die OCR schneidet diese Zonen aus der entzerrten Karte aus. Die Kamera zeichnet
  dezente, beschriftete Hilfszonen über eine projektive Abbildung in die erkannte
  Kontur. Solange keine Kontur vorliegt, dienen die Zonen im bestehenden Guide
  ausschließlich als Ausrichtungshilfe.
- Auto-Capture prüft zusätzlich lokale Textpräsenz in diesen beiden Zonen, höchstens
  einmal pro 700 ms und nur mit einer gleichzeitig laufenden OCR-Anfrage. Instabile
  oder veraltete Ergebnisse werden verworfen. Schärfe-, Bewegungs-, Vierkanten- und
  Entfernungsprüfungen bleiben bestehen. Keine Datenbanksuche vor der Aufnahme.
- Eine vollständige 0°-Struktur sperrt die OCR-Drehung. Eine andere Orientierung
  benötigt beide passenden Zonen, mindestens sechs Punkte Vorsprung gegenüber 0°
  und mindestens vier Punkte beziehungsweise 35 % gegenüber dem Zweitplatzierten.
  Ein einzelnes Wort reicht nicht. Sensor-/EXIF-Normalisierung bleibt bestehen.
- Ein unsicheres Originalbild im Querformat wird nicht mehr allein aufgrund seines
  Seitenverhältnisses um 90° gedreht. Perspektivkorrektur bleibt erhalten.
- Bei fehlendem Namen oder fehlender Kennung nach der Crop-OCR wird im einzelnen
  Pokémon-Scan einmal auf das EXIF-normalisierte Originalfoto zurückgegriffen.
  Das Original wird kurzzeitig im App-Cache gespeichert und über eine URI übergeben;
  große Bilddaten werden nicht in den Activity-Intent geschrieben. Nach Übernahme
  wird ausschließlich die eigene generierte Cache-Datei gelöscht.
- Ein verwertbarer Pokémon-Name aus NAME_ROI erhält Vorrang vor Vollbildnamen.
  Evolutionshinweise bleiben ausgeschlossen; regionale Namen und Varianten bleiben
  erhalten.
- Eine alleinstehende dreistellige Nummer wie `094` wird ausschließlich aus der
  Footer-ROI als Suchhinweis übernommen. Ohne zusätzliche Bestätigung begrenzt sie
  den Score auf 69 % und löst keine sichere automatische Auswahl aus.
- Europäische Pokémon-Abfragen ergänzen Name/Nummer/Set, Name/Nummer, Name/Set und
  partielle Namen wie `Solga...`. Unabhängige Nummern- und Namenswege bleiben erhalten.
  Bestehende asiatische sowie Trainer-/Energie-Suchreihenfolgen bleiben bestehen.
- Explizite Sprachcodes aus dem Footer und Diagnosewerte für Nummer, Set, Rotation
  und Rotationsquelle werden übernommen beziehungsweise angezeigt.

## Geänderte Dateien

| Datei relativ zum Repository | Zweck |
| --- | --- |
| `app/src/main/java/de/pokefolio/app/CardRoiLayout.java` | Gemeinsame ROI-Koordinaten, Strukturprüfung, Rotationsfreigabe |
| `app/src/main/java/de/pokefolio/app/CardImageProcessor.java` | Kartenrelative ROIs, Live-ROI-Probe, Orientierung des Original-Fallbacks |
| `app/src/main/java/de/pokefolio/app/CardOverlayView.java` | Hilfsbereiche NAME und SET / NUMMER |
| `app/src/main/java/de/pokefolio/app/CameraActivity.java` | Begrenzte lokale Textprüfung, Originalfoto-Fallback |
| `app/src/main/java/de/pokefolio/app/MainActivity.java` | Strukturgesicherte Rotationswahl, Metadaten und Cache-Übernahme |
| `app/src/main/assets/recognition-core.js` | Namensvorrang, einzelne Footer-Nummer, Sprachcode, Confidence-Begrenzung |
| `app/src/main/assets/api-core.js` | Kombinierte und partielle Namensabfragen |
| `app/src/main/assets/app.js` | Sichere Rotationsübernahme, semantischer Crop-Fallback, Diagnose |
| `app/src/main/assets/index.html` | Versionsanzeige und Scannerbeschreibung |
| `app/build.gradle` | Version 0.17.0-dev4, versionCode 39 |
| `app/src/test/java/de/pokefolio/app/CardRoiLayoutTest.java` | Acht neue native Logiktests |
| `tests/fixed-roi-regression.test.js` | Sechs neue JavaScript-Regressionstests |
| `tests/alola-kokowei-regression.test.js` | Alte Ablehnung einer nackten 094 an neue Anforderung angepasst |
| `tests/native-visual-pipeline.test.js` | Geänderte ROI-Verdrahtung prüfen |
| `tests/pokemon-bottom-left-v0165.test.js` | Gemeinsame Footer-Geometrie prüfen |
| `docs/roadmap/fixed-rois-orientation-0.17.0-dev4.md` | Dieser Bericht |

## Neue Tests

Java: aufrechtes Solgaleo bleibt bei 0°; unsichere manuelle Aufnahme dreht nicht;
eindeutig verkehrte Struktur darf drehen; einzelnes Wort reicht nicht; regionale
Namen und Suffixe; ausgeschlossene Labels/Evolutionszeilen; gültige und ungültige
Footer-Kennungen; feste ROI-Grenzen und ignorierte Mittelfeldzahlen.

JavaScript: Solgaleo mit `094` statt KP/Schaden; Famieps gegen wiederholte falsche
Vollbildnamen; vollständiges und verkürztes Alola-Kokowei; keine automatische Auswahl
nur durch `094`; Teilname `Solga...` plus Nummer; keine manuelle Drehung bei fehlender
oder unsicherer Rotations-Confidence.

## Prüfung

- **357/357 JavaScript-Tests bestanden**, einschließlich sechs neuer Regressionen.
- **77/77 Java-/JUnit-Tests bestanden**, einschließlich acht neuer ROI-/Rotationstests.
- Insgesamt **434 bestandene Tests**, keine Fehlschläge.
- Android-Lint: **0 Fehler, 9 Warnungen**.
- Nach den Tests: `assembleDebug assembleDebugAndroidTest` erfolgreich.
- APK-Signatur mit `apksigner verify --verbose` geprüft.
- Paket: `app.pokefolio.mobile`, versionCode **39**, versionName **0.17.0-dev4**.
- APK: `build/releases/PokeFolio-Android-0.17.0-dev4.apk` (64.611.509 Bytes).
- Testpaket: `build/releases/PokeFolio-Android-0.17.0-dev4-androidTest.apk`.
- APK-SHA256: `4a9f864b4c48ea8fb9f647cfa1965d170c461534342d1924edbd4d2163385244`.
- `adb devices`: kein Gerät/Emulator verbunden. Instrumentierung gebaut, nicht ausgeführt.
- dev4 wurde lokal gebaut und noch nicht auf GitHub veröffentlicht.

Der Geräte-/Kameratest bleibt gesondert zu prüfen: Die Logiktests ersetzen keine
Aufnahme mit einem realen Android-Gerät. Das konkrete Nutzerfoto liegt nicht vor.
