# PokéFolio Desktop: Vision- und EOS-Grundlage

`PokeFolio.Desktop.sln` enthält den Windows-Host für die vorhandene PokéFolio-Oberfläche. Android bleibt der native Mobile-Host mit CameraX und ML Kit. Windows verwendet .NET 8, WinForms, Microsoft WebView2, lokale Windows-OCR und OpenCvSharp.

## Voraussetzungen und Visual Studio

- Windows 10 Version 2004 (Build 19041) oder neuer
- Visual Studio 2022 mit dem Workload **.NET-Desktopentwicklung**
- .NET 8 SDK
- Microsoft Edge WebView2 Runtime
- für OCR die gewünschten Windows-Sprachpakete unter **Einstellungen → Zeit und Sprache → Sprache und Region**

Öffne `windows/PokeFolio.Desktop.sln` in Visual Studio und starte `PokeFolio.Desktop`. Alternativ:

```powershell
dotnet restore windows/PokeFolio.Desktop.sln
dotnet build windows/PokeFolio.Desktop.sln -c Release
dotnet test windows/PokeFolio.Desktop.sln -c Release
dotnet run --project windows/PokeFolio.Desktop/PokeFolio.Desktop.csproj -- --self-test
dotnet run --project windows/PokeFolio.Desktop/PokeFolio.Desktop.csproj
```

## Gemeinsamer PokéFolio-Core

Das Desktop-Projekt verlinkt `app/src/main/assets` beim Build nach `WebAssets`. Es gibt keine zweite Kopie von `app.js`, `recognition-core.js`, `collection-core.js`, `grading-core.js`, `api-core.js`, `variant-core.js`, `learning-core.js`, `pokemon-asia-core.js`, `pokemon-names.js` oder `bulk-fast-core.js`.

Android lädt weiterhin `file:///android_asset/index.html`. Windows stellt dieselben Dateien nur lokal über `https://app.pokefolio.local` bereit. Collection-, Learning- und Grading-Schemata bleiben dadurch kompatibel. Windows-spezifische UI-Ergänzungen liegen ausschließlich in `windows/PokeFolio.Desktop/WebHost` und werden von Android nicht geladen.

## Windows Vision Pipeline

Die modulare Schicht unter `PokeFolio.Desktop/Vision` verarbeitet Datei- und spätere EOS-Aufnahmen:

1. EXIF-Orientierung genau einmal physisch anwenden und anschließend verwerfen.
2. Auf eine Analysegröße verkleinern, Kanten/Konturen suchen und das größte plausible TCG-Quadrilateral auswählen.
3. Vier Ecken ordnen, eine kleine confidence-abhängige Sicherheitsmarge anwenden und per Homographie auf 900 × 1257 Pixel normalisieren.
4. Bei unsicherer Kontur das vollständige Bild mit `contain` einpassen, statt Ränder aggressiv abzuschneiden.
5. Schärfe, Belichtung, Glare, Abdeckung, Perspektive und vollständige Kartenränder bewerten.
6. Erst danach Rotation, Identifier-OCR und gegebenenfalls weitere Erkennung ausführen.

Quick Scan akzeptiert geringere Qualitätswerte. Precision Scan fordert unter anderem vollständige Ränder, höhere Schärfe und weniger Reflexion. Rohwerte und Confidence bleiben erhalten; ein unsicheres Centering wird nicht als präzise Messung ausgegeben.

## Lokale OCR und Identifier

`ITextRecognitionService` wird unter Windows durch `Windows.Media.Ocr` implementiert. Die OCR läuft lokal, benötigt keinen Cloud-Dienst und keinen API-Schlüssel. Verwendet wird zunächst das angeforderte installierte Sprachpaket, sonst das Windows-Benutzerprofil. Latein/Deutsch/Englisch sind der primäre getestete Pfad; Japanisch, Koreanisch und Chinesisch sind vorbereitet und funktionieren, wenn die entsprechenden Windows-Sprachpakete installiert sind.

Die OCR startet nicht auf dem gesamten hochauflösenden Bild. TCG-spezifische kleine ROIs haben Vorrang:

- Pokémon: untere Identifier-/Collector-Number-Zone
- Yu-Gi-Oh!: Passcode und Setcode im unteren Bereich
- One Piece: OP-/ST-/EB-/PRB-/P-Code

Erst ohne exakten Identifier folgt Header-OCR; Vollkarten-OCR ist der letzte Text-Fallback. Der gemeinsame JavaScript-Core führt API-Kandidaten, lokales Lernen, Preise, Varianten und Collection-Updates weiter aus.

## Visueller Vergleich

`CardVisualMatcher` vergleicht nur eine bereits durch Identifier/API reduzierte Kandidatenmenge. Verwendet werden regionale pHash-/dHash-Signale, normalisierte Korrelation, Gradienten, HSV-Histogramme und ORB-Features. Artwork wird höher gewichtet als sprachabhängige Textregionen. Leere globale Bilddatenbanken oder ein Brute-Force-Vergleich aller Karten sind ausdrücklich nicht Teil der Pipeline.

OpenCvSharp wird als Apache-2.0-lizenzierter NuGet-Wrapper samt Windows-Runtime bezogen; keine ungeprüften nativen Binärdateien werden ins Repository aufgenommen.

## Quick, Bulk und Precision

- **Quick:** Bild lokalisieren, normalisieren, primären Identifier lesen, Kandidaten bestimmen und nur bei Bedarf visuell vergleichen.
- **Bulk:** bestehende `BulkFast`-/Collection-Logik nutzen; ein Session-Cache vermeidet wiederholte Identifier-Arbeit und bestehende Einträge werden über Quantity erhöht.
- **Precision:** Front und Back separat normalisieren und streng prüfen; hochwertige Bilder, Qualitätswerte, Capture-Quelle, Kameramodell und konservatives Centering werden für das bestehende Grading vorbereitet.

Ein normalisiertes Bild wird nicht erneut ausgeschnitten oder perspektivisch transformiert. OCR, Netzwerk und Bildvergleich laufen asynchron und nicht im WebView-/UI-Thread.

## EOS Studio

EOS Studio bietet Kamerastatus, Enumeration, Verbinden/Trennen, Live View, Quick/Bulk/Precision, Front/Back, Auto-Capture-Status, Qualitätswerte und Scan-Verlauf. Ohne Canon-Komponente startet PokéFolio normal und Dateiimport bleibt vollständig nutzbar.

Der Live-View-Pfad analysiert nur verkleinerte Frames auf Kartenkontur, Bewegung, Schärfe und Belichtung. Er führt weder OCR noch API-Aufrufe oder Kandidaten-/Artwork-Suchen pro Frame aus. Die `AutoCaptureStateMachine` verlangt mehrere stabile Frames, nutzt einen Cooldown und wartet nach der Aufnahme auf Kartenentfernung oder einen geänderten Fingerprint.

## Canon EDSDK lokal einrichten

Canon EDSDK ist proprietär und wird **nicht** verteilt oder eingecheckt. Die öffentliche Lösung enthält nur `ICanonEosSdkAdapter` und einen sicheren Fallback. Für eine echte Kameraanbindung ist ein separat lizenzierter Adapter erforderlich:

1. Canon EDSDK gemäß Canon-Lizenzbedingungen lokal installieren.
2. Ein separates Assembly `PokeFolio.Canon.EdsdkAdapter.dll` bauen, das `ICanonEosSdkAdapter` implementiert und Canon-Ressourcen/Callbacks kapselt.
3. Adapter und Canon-DLLs außerhalb des Repositorys ablegen.
4. Entweder `POKEFOLIO_CANON_ADAPTER_PATH` auf den vollständigen Adapterpfad setzen oder `POKEFOLIO_CANON_EDSDK_PATH` auf den Ordner, der `PokeFolio.Canon.EdsdkAdapter.dll` enthält.
5. PokéFolio neu starten und in EOS Studio **Aktualisieren** wählen.

Der Adapter muss Enumeration, Verbindung, Trennung, Capture-Download und optional Live-View-Frames bereitstellen. USB-Verlust, Timeouts und fehlende SDK-Dateien werden kontrolliert an die UI gemeldet. Canon-DLLs, Header, SDK-Beispiele oder Lizenzdateien gehören nicht in Git.

## EOS 2000D anschließen

1. Kamera ausschalten und per USB verbinden.
2. Andere Canon-Tethering-Anwendungen schließen, damit das Gerät nicht exklusiv belegt ist.
3. Kamera einschalten, PokéFolio öffnen, EOS Studio aufrufen und **Aktualisieren** wählen.
4. Kamera auswählen und **Verbinden** drücken.
5. Quick, Bulk oder Precision wählen; Live View beziehungsweise EOS-Auslösung starten.

Eine physische EOS 2000D war in der Entwicklungs-/CI-Umgebung nicht verfügbar. Geräteerkennung, echter EDSDK-Live-View und Auslösung benötigen daher weiterhin: **Requires physical EOS 2000D validation**.

## Fehlerdiagnose

- **EDSDK nicht verfügbar:** Umgebungsvariablen und vollständigen Adapterpfad prüfen; Dateiimport funktioniert unabhängig davon.
- **Keine Kamera:** USB-Kabel, Kamerastrom und exklusive Canon-Anwendungen prüfen.
- **OCR leer:** gewünschtes Windows-Sprachpaket installieren; gute, aufrechte Aufnahme und lesbare untere Identifier-Zone verwenden.
- **Kartenrand fehlt:** mehr Abstand, kontrastreicheren Hintergrund oder gleichmäßigere Beleuchtung verwenden.
- **Reflexion:** Lichtwinkel ändern; Precision Scan setzt die Surface-/Qualitäts-Confidence herab.
- **API nicht erreichbar:** Allowlist/Netzwerk prüfen; lokale Sammlung und Bildverarbeitung bleiben verfügbar.

Desktop-Logs liegen in `%LOCALAPPDATA%\PokeFolio\Logs`, rotieren bei ungefähr 1 MB und enthalten keine Bilddaten, API-Antworten oder personenbezogenen Scan-Inhalte.

## Sicherheit und Veröffentlichung

API-Schlüssel, Zugangsdaten, private Keystores, proprietäre Canon-Bibliotheken und Capture-Dateien dürfen nicht eingecheckt werden. `pokefolio-test.keystore` ist ausschließlich der bereits vorhandene öffentliche Debug-/Testschlüssel. Eine Veröffentlichung muss einen privaten Release-Key außerhalb des Repositorys über CI-Secrets verwenden.
