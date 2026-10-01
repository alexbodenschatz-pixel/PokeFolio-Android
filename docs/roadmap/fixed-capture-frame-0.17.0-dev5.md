# Starrer Scanrahmen – Android 0.17.0-dev5

## Umsetzung

Der sichtbare Scannerrahmen wird ausschließlich aus der Größe des Kamerafensters
und den festen Abständen zu Kamerasteuerung/Systemleisten berechnet: maximal 78 %
der Breite, Seitenverhältnis 63:88, mittig im verfügbaren Kamerabereich. Bei weniger
verfügbarer Höhe wird er entsprechend begrenzt. Kartenerkennung, Zoom auf die Karte
oder gemessene Ecken verändern seine Position, Größe und Form nicht.

NAME und SET / NUMMER sind fest mit diesem Zielrahmen verbunden. Nur die Farbe des
Rahmens wechselt: orange bei fehlender/passend zu positionierender Karte, gelb bei
passender Geometrie ohne vollständige Aufnahmefreigabe und grün bei erfüllten
Aufnahmebedingungen. Hinweise erklären Positionierung, Schärfe/Beleuchtung,
Bewegung und sichtbare Textbereiche.

**Die dynamische Live-Darstellung ist deaktiviert. Es gibt keinen Legacy-Umschalter.**
Die vorhandene interne Rechteck- und Bewegungsprüfung bleibt als begrenzte
Qualitätsprüfung innerhalb der festen Zielbox erhalten. Ihre gemessenen Ecken
werden nicht mehr als mitwandernde Kontur gezeichnet.

## Aufnahme und Nachbearbeitung

- Alle vier gemessenen Ecken müssen innerhalb des Zielbereichs liegen, mit 1 %
  Abstand zum Rand des analysierten Bereichs. Eine abgeschnittene Karte wird nicht
  automatisch aufgenommen.
- Die Kartenfläche muss mindestens 50 % des Zielbereichs belegen; ihre Begrenzung
  muss mindestens 65 % von dessen Breite und Höhe erreichen. Kleine Rechtecke im
  Umfeld sollen nicht als Hauptmotiv akzeptiert werden.
- Vorhandene Schärfe-/Belichtungsprüfung, Bewegungsstabilität, lokale Name-/Footer-
  Textprüfung und die zeitliche Auto-Capture-Sperre bleiben erforderlich.
- Manuelles Auslösen bestimmt weiterhin den Aufnahmezeitpunkt. Es verwendet
  denselben festen sichtbaren Rahmen.
- Das endgültige Foto wird weiterhin vollständig an die separate Kartendetektion
  übergeben. Die Zielbox wird nicht als harter Bildzuschnitt verwendet.
- Perspektivkorrektur, Sicherheitsrand, Originalbild-Fallback, vorsichtige
  0°/180°-Orientierungsprüfung und finale Karten-ROIs bleiben unverändert.
- Diagnostik ergänzt um Frame-Modus, Karte im Zielrahmen, Schärfe/Beleuchtung,
  Bewegung, Aufnahmebereitschaft und Erfolg des finalen Crops.

## Geänderte Dateien

| Datei relativ zum Repository | Änderung |
| --- | --- |
| `app/src/main/java/de/pokefolio/app/CardOverlayView.java` | Starr verankerte Hilfszonen, keine bewegliche Kontur, 78-%-Breite, Farbzustand |
| `app/src/main/java/de/pokefolio/app/FixedCaptureFrame.java` | Neue reine Java-Prüfung für Lage/Größe und Aufnahmebedingungen |
| `app/src/main/java/de/pokefolio/app/FastCardDetector.java` | Kartenlage gegen festen Suchbereich prüfen; getrennte Lage-/Schärfewerte |
| `app/src/main/java/de/pokefolio/app/CameraActivity.java` | Feste Aufnahmefreigabe, Hinweise und Capture-Diagnostik |
| `app/src/main/java/de/pokefolio/app/MainActivity.java` | Diagnoseübergabe und Versionskennung |
| `app/src/main/assets/app.js` | Zusätzliche erkannte Merkmale anzeigen |
| `app/src/main/assets/index.html` | Versionsanzeige |
| `app/build.gradle` | 0.17.0-dev5, versionCode 40 |
| `app/src/test/java/de/pokefolio/app/FixedCaptureFrameTest.java` | Fünf neue Logiktests |
| `tests/fixed-frame-regression.test.js` | Zwei neue Prüfungen für feste Darstellung und unveränderten vollständigen Capture-Eingang |
| `tests/multi-tcg-master-fix.test.js` | Alte Erwartung einer dynamischen Kontur an die neue Vorgabe angepasst |
| `app/src/androidTest/java/de/pokefolio/app/CardCropInstrumentation.java` | Neuer Pixelvergleich des Overlays bei veränderten Erkennungsecken |
| `docs/roadmap/fixed-capture-frame-0.17.0-dev5.md` | Dieser Bericht |

## Tests

Neue Java-Fälle: vollständig mittige Karte; teilweise außerhalb; unscharf/bewegt;
fehlender Name/Footer; zu kleines oder ungültiges Rechteck. Neue JavaScript-Fälle:
Overlay/Hilfszonen unabhängig von Erkennungsecken; vollständiges Foto für den
nachgelagerten Crop und feste Aufnahmefreigabe.

Der neue Android-Pixeltest zeichnet das Overlay vor und nach einer stark
verschobenen/schrägen Erkennungskontur und verlangt identische Pixel und identische
Rahmengrenzen. Bestehende native Crop-Tests für Namen und unteren Kartenrand bleiben
in der Instrumentierung enthalten. Ein erfolgreicher Geräte-/Kameratest wird erst
nach Ausführung dieser Instrumentierung beziehungsweise echten Aufnahmen behauptet.

## Ergebnis

- **359/359 JavaScript-Tests bestanden**.
- **82/82 Java-/JUnit-Tests bestanden**.
- Insgesamt **441 bestandene Tests**, darunter sieben neue ausgeführte Tests.
- Android-Lint: **0 Fehler, 14 Warnungen**.
- Anschließend Debug- und Instrumentierungs-APK erfolgreich gebaut.
- APK-Signatur erfolgreich geprüft; versionCode **40**, versionName **0.17.0-dev5**.
- Installierbare Datei: `build/releases/PokeFolio-Android-0.17.0-dev5.apk`.
- Testpaket: `build/releases/PokeFolio-Android-0.17.0-dev5-androidTest.apk`.
- APK-SHA256: `725bc8c8c5b6b15105df57e5193834b09fd3a41471dd25b1836eff0c7e173d80`.
- `adb devices` meldete kein Ziel. Der neue Overlay-Pixeltest und die bestehenden
  Crop-Instrumentierungstests sind kompiliert, in diesem Durchlauf nicht ausgeführt.
- Lokal gebaut; dev5 ist noch nicht auf GitHub veröffentlicht.
