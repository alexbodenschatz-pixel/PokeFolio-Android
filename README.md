# PokéFolio für Android und Windows

PokéFolio ist eine eigenständige App zum Scannen, Erkennen, Vorprüfen und Sammeln von Trading Cards. Android kombiniert CameraX und ML Kit mit dem gemeinsamen HTML/CSS/JavaScript-Core. Der Windows-Host nutzt .NET 8, WinForms, WebView2, lokale Windows-OCR und OpenCV-basierte Kartenverarbeitung, ohne den Android-Scanner zu ersetzen.

## Android bauen

Voraussetzungen: JDK 17 und Android SDK 36.

```text
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Die Debug-APK liegt anschließend unter `app/build/outputs/apk/debug/app-debug.apk`.

## Windows bauen

```text
dotnet restore windows/PokeFolio.Desktop.sln
dotnet build windows/PokeFolio.Desktop.sln -c Release
dotnet test windows/PokeFolio.Desktop.sln -c Release
dotnet run --project windows/PokeFolio.Desktop/PokeFolio.Desktop.csproj -- --self-test
```

Die Windows-App verwendet direkt die Web-Assets aus `app/src/main/assets`; Recognition-, Collection-, Grading-, Varianten-, Learning-, Preis- und Bulk-Logik werden nicht dupliziert. Details zu Vision, lokaler OCR, EOS Studio und der optionalen Canon-Adaptereinrichtung stehen in [windows/README.md](windows/README.md).

GitHub Actions baut und testet Android sowie Windows und veröffentlicht ein Debug-APK und einen selbstenthaltenden Windows-Publish-Ordner als Artefakte.

## Sicherheit

Der vorhandene `pokefolio-test.keystore` ist ausschließlich ein öffentlicher Test-/Debug-Schlüssel. Release-Signierung muss einen privaten Schlüssel außerhalb des Repositorys verwenden. API-Schlüssel, Zugangsdaten und proprietäre Canon-EDSDK-Dateien dürfen nicht versioniert werden.
