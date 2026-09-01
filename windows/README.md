# PokéFolio Desktop Foundation

`PokeFolio.Desktop.sln` enthält den ersten Windows-Host für die vorhandene PokéFolio-Weboberfläche. Die Android-App bleibt der native Mobile-Host mit CameraX, ML Kit, Karten-Crop und Perspektivkorrektur. Windows verwendet WinForms, .NET 8 und Microsoft WebView2.

## Gemeinsamer Core

Das Desktop-Projekt verlinkt die Dateien aus `app/src/main/assets` beim Build nach `WebAssets`. Es existiert keine zweite Kopie von `app.js`, `recognition-core.js`, `collection-core.js`, `grading-core.js` oder den übrigen Fachmodulen. Android lädt weiterhin `file:///android_asset/index.html`; Windows stellt dieselben Dateien über den nur lokal erreichbaren virtuellen Host `https://app.pokefolio.local` bereit. Das bestehende LocalStorage-Schema und damit das Sammlungsformat bleiben unverändert.

Windows-spezifische Ergänzungen liegen ausschließlich unter `windows/PokeFolio.Desktop/WebHost`. `desktop-bootstrap.js` bindet `PokeNative` ein und ergänzt EOS Studio; Android lädt diese Datei nicht.

## Öffnen und bauen

Voraussetzungen:

- Windows 10/11
- Visual Studio 2022 mit **.NET Desktop Development**
- .NET 8 SDK für Entwicklung und Builds
- Microsoft Edge WebView2 Runtime; das veröffentlichte CI-Artefakt enthält die .NET-Runtime bereits selbst

```powershell
dotnet restore windows/PokeFolio.Desktop.sln
dotnet build windows/PokeFolio.Desktop.sln -c Release
dotnet test windows/PokeFolio.Desktop.sln -c Release
dotnet run --project windows/PokeFolio.Desktop/PokeFolio.Desktop.csproj -- --self-test
```

## Bereits unterstützt

- gemeinsame Oberfläche: Dashboard, Sammlung, Portfolio, Suche, Preise, Varianten, Sprachen und Grading-UI
- unverändertes Collection-/Learning-Datenmodell über den gemeinsamen JavaScript-Core
- HTTPS-Bridge mit Host-Allowlist, Timeout, Fehlerklassen und begrenztem 5xx/429-Retry
- Windows-Dateiauswahl und Bildübergabe als Data URL
- persistentes WebView2-LocalStorage plus kleine native JSON-Ablage für Backups/Hostdaten
- fehlertolerante Kompatibilitätsmethoden für Android-spezifische `PokeNative`-Aufrufe
- EOS-Studio-Oberfläche mit Front, Back, Bulk und Precision-Modus

## Bewusste Foundation-Grenzen

- ML Kit bleibt Android-spezifisch. Windows liefert bei OCR-Aufrufen einen nicht fatalen, leeren strukturierten Befund; manuelle Suche, API-Abfragen und der gemeinsame UI-Core funktionieren weiter.
- Native Windows-Kartenlokalisierung, Perspektivkorrektur und Bildvergleich sind noch nicht implementiert. Importierte Bilder werden in Phase 1 verlustfrei an die bestehende Web-Pipeline übergeben.
- `CanonEosCapture` ist ausschließlich ein sauberer, nicht abstürzender Stub. Es befinden sich keine Canon-EDSDK-Dateien im Repository.
- Live View, Kameraerkennung, Bildtransfer, Auto-Capture und Hardware-Trigger folgen in der nächsten Phase über `ICardCaptureDevice`.

## EOS-2000D-Erweiterung

Eine spätere Canon-Integration implementiert `ICardCaptureDevice` in einem getrennten Adapterprojekt. Notwendige Schritte sind: EDSDK-Lizenz prüfen, SDK außerhalb des öffentlichen Repositorys bereitstellen, Geräte-Lifecycle/Callbacks kapseln, Live-View-Frames asynchron liefern, JPEG-Transfer implementieren und Ressourcen beim Trennen zuverlässig freigeben. Recognition, Sammlung und Grading bleiben vom konkreten Aufnahmegerät unabhängig.

## Sicherheit und Signierung

API-Schlüssel, Zugangsdaten, private Keystores und proprietäre Canon-Bibliotheken dürfen nicht eingecheckt werden. `pokefolio-test.keystore` ist der bereits vorhandene öffentliche Testschlüssel und ausschließlich für Debug-/Testartefakte bestimmt. Eine Veröffentlichung muss einen privaten Release-Key außerhalb des Repositorys über eine geschützte CI-Secret-Konfiguration verwenden.
