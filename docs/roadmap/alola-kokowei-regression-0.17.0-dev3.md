# Alola-Kokowei – v0.17.0-dev3

## Ursache und Änderungen

Im bisherigen Kamerapfad wurde das EXIF-orientierte Foto **vor** der Kartendetektion mit
`cropPreviewRegionDetailed` auf den eingeblendeten Guide begrenzt. Der 2,5-%-Rand bezog
sich auf diesen Guide, nicht auf die tatsächlichen Kartenkanten. Außerhalb liegende
Namens- oder Footerpixel waren anschließend unwiederbringlich verloren. Zusätzlich
konnten Vorschau-Ecken die Kontur des Standbilds ersetzen; bei schwacher Detektion
konnte `cropLikelyCardBounds` nochmals anhand innerer Bildkanten zuschneiden.

Diese Fehlerpfade sind im Code belegt. Das konkrete Nutzerfoto liegt nicht vor;
welcher davon beim gemeldeten Foto ausgelöst wurde, ist daher nicht nachgewiesen.

- Die Standbilddetektion erhält jetzt das vollständige Foto. Vorschau-Ecken überschreiben
  die Standbildkontur nicht mehr.
- Vier endliche, innerhalb des Bilds liegende, konvexe Ecken und ein konservatives
  Seitenverhältnis sind Voraussetzung für den Perspektivzuschnitt. Starke Verkürzung,
  fehlende Ecken oder unsichere Konturen führen zum vollständigen Originalbild als
  Fallback. Die abschließende Skalierung erhält alle Pixel durch Einpassen.
- Der Sicherheitsrand beträgt 2,4–3 %, bei hoher Confidence 2,5 %. Der unsichere
  achsenparallele Fallback wird nicht mehr aufgerufen.
- Geometrieprüfungen schützen Kopf-/Footerbereiche gegen die getesteten verkürzten
  Rechtecke. Sie sind kein semantischer Beweis, dass ein real fotografierter Titel
  lesbar ist; die Fotoregression auf einem Gerät bleibt erforderlich.
- Namens-ROI: obere 20 %; zusätzliche KP-ROI oben rechts; bestehende Footer- und
  Mittelfeld-ROIs sowie Vollbild-OCR bleiben erhalten. Der einzelne Pokémon-Scan führt
  auch nach einem Footer-Treffer die vollständige OCR aus.
- `094` wird nur mit `MEP` oder `SVP` im selben Footer-Durchlauf als einzelne
  dreistellige Nummer akzeptiert. Isolierte Zahlen, KP, Schaden, Pokédex und Jahre
  bleiben ausgeschlossen. KP funktionieren vor und nach der Zahl.
- Erkannte regionale Namenspräfixe bleiben im Haupttitel sichtbar. Bekannte Spezies,
  normalisierte Schreibweisen und Tippfehler können regionale Kandidaten bestätigen.
- Unabhängige API-Wege: Nummer/Set, Nummer, Nummer/Name, Teilname, Name/KP,
  Attacke und Fähigkeit. Fehler eines Endpunkts brechen die übrigen Wege nicht ab.
- Im westlichen textuellen Ranking erhalten Nummer/Set zusammen 35 %, Name 30 %,
  Attacke/Fähigkeit 15 % und KP 5 %; zusätzliche Merkmale teilen die übrigen 15 %.
  Das vorhandene separate visuelle Ranking und die Sicherheitsgrenzen bleiben bestehen.
- Diagnoseanzeige ergänzt um Name-ROI, Vollbildnamen, Fähigkeiten, Kontur-Bounding-Box,
  Suchwege, Kandidatenzahl vor Filterung/Ranking und Scores der angezeigten Kandidaten.

## Datenbankprüfung

Am 28.09.2026 lieferte die öffentliche TCGdex-Abfrage `de/cards?name=Kokowei`
auch Alola-Kokowei-Karten. Teilnamen sind bereits ein dokumentiertes
[TCGdex-Suchverhalten](https://tcgdex.dev/rest/filtering-sorting-pagination).
`de/sets/mep` war verfügbar; `de/cards/mep-094` und `de/cards/MEP-094` lieferten 404.
In der Namensabfrage war ebenfalls kein Alola-Kokowei mit Nummer 094 enthalten.

Die neue Regression verwendet deshalb ausdrücklich einen vom Nutzer beschriebenen
**Vertrags-Testdatensatz**, keinen vorgeblich live vorhandenen API-Eintrag. Die App
erfindet keine Karte, falls Anbieter den Print noch nicht führen. Ein verfügbarer
passender Eintrag wird trotz unvollständigem OCR-Namen gefunden und hoch bewertet.

## Geänderte Dateien

| Datei relativ zum Repository | Zweck |
| --- | --- |
| `app/src/main/java/de/pokefolio/app/CameraActivity.java` | Vollständiges Standbild für Detektion, Original-Fallback, Bounding-Box-Weitergabe |
| `app/src/main/java/de/pokefolio/app/CardImageProcessor.java` | Zuschnittvalidierung, kein enger unsicherer Fallback, Namens-/KP-ROIs |
| `app/src/main/java/de/pokefolio/app/CardCropSafety.java` | Neue reine Java-Geometrieprüfung |
| `app/src/main/java/de/pokefolio/app/MainActivity.java` | Crop-Diagnostik und Versionskennung |
| `app/src/main/assets/recognition-core.js` | Korroborierte Promo-Nummern, regionale Namen, KP/Fähigkeiten, Ranking |
| `app/src/main/assets/api-core.js` | Promo-Endpunkt und unabhängige Suchwege |
| `app/src/main/assets/app.js` | Zusammengeführte OCR und zusätzliche Diagnosewerte |
| `app/src/main/assets/index.html` | Versionsanzeige |
| `app/build.gradle` | Version 0.17.0-dev3, versionCode 38 |
| `tests/alola-kokowei-regression.test.js` | Acht neue OCR-/Such-/Ranking-Regressionsfälle |
| `app/src/test/java/de/pokefolio/app/CardCropSafetyTest.java` | Sieben neue Geometrie-Unit-Tests |
| `app/src/androidTest/java/de/pokefolio/app/CardCropInstrumentation.java` | Neuer Pixeltest gegen abgeschnittene Vorschau-Namenszone |
| `tests/native-visual-pipeline.test.js` | Bestehende Verdrahtungsprüfungen auf Original-Fallback und 20-%-ROI angepasst |
| `tests/pokemon-bottom-left-v0165.test.js` | Bestehende Prüfung auf zusätzliche Pokémon-Voll-OCR angepasst |
| `docs/roadmap/alola-kokowei-regression-0.17.0-dev3.md` | Dieser Nachweis |

## Testnachweis

Vor dem APK-Build ausgeführt:

- JavaScript: **351/351 bestanden**, darunter acht neue Regressionstests.
- Java/JUnit: **69/69 bestanden**, darunter sieben neue Geometrietests.
- Zusammen: **420 bestandene automatisierte Tests**, keine Fehlschläge.
- Android-Lint: **0 Fehler, 10 Warnungen**.

Neue JavaScript-Fälle: bestätigte MEP/094-Kennung mit KP-Suffix; abgelehnte isolierte
Zahlen; unabhängige Suchwege; partielle/fehlerhafte/regional variierte Namen mit
korrektem Ranking; sichtbares Alola-Präfix; Vulpix/Raichu/Knogga-Regionalformen;
keine automatische Auswahl durch den Basisnamen allein; unabhängiger API-Fallback.

Neue Java-Fälle: vollständige Karte; abgeschnittener Kopf; abgeschnittener Footer;
abgeschnittene Seite; Ecken außerhalb des Fotos; Querformat/anderes Kartenformat;
ungültige beziehungsweise gekreuzte Ecken.

Der neue Android-Pixeltest vergleicht das Ergebnis einer vollständigen synthetischen
Karte mit einem Durchlauf, der zusätzlich eine falsche, oben gekürzte Live-Kontur
mit 99 % Confidence erhält. Die Bitmaps müssen identisch bleiben und obere sowie
untere Außenkante sichtbar sein.

**Geräteprüfung offen:** `adb devices` meldete kein Ziel; lokal ist kein Emulator
installiert. Der Android-Pixeltest wird kompiliert, ist jedoch nicht ausgeführt.
Kein erfolgreicher Scan des realen Nutzerfotos und keine physische Geräteprüfung
werden behauptet.

## APK

Nach erfolgreichen Tests: `assembleDebug assembleDebugAndroidTest` erfolgreich.
`apksigner verify --verbose` bestätigt die APK-Signatur. Paket
`app.pokefolio.mobile`, versionCode `38`, versionName `0.17.0-dev3`, minSdk 29.

- Installierbare Datei: `build/releases/PokeFolio-Android-0.17.0-dev3.apk`
- Testpaket: `build/releases/PokeFolio-Android-0.17.0-dev3-androidTest.apk`
- APK-Größe: 64.532.926 Bytes
- APK-SHA256: `4e07c39b2826cc66027dfc6ccdfafd31d6cf1c6763a91e0dc32ddb6426e4dc0d`

Diese Version wurde lokal gebaut; für dev3 wurde noch kein GitHub-Release veröffentlicht.
