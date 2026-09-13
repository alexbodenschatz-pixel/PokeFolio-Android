# PokéFolio für Android und Windows

PokéFolio ist eine eigenständige App zum Scannen, Erkennen, Vorprüfen und Sammeln von Trading Cards. Android kombiniert CameraX und ML Kit mit dem gemeinsamen HTML/CSS/JavaScript-Core. Der Windows-Host nutzt .NET 10 LTS, WinForms, WebView2, lokale Windows-OCR und OpenCV-basierte Kartenverarbeitung, ohne den Android-Scanner zu ersetzen.

## Android bauen

Voraussetzungen: JDK 17 und Android SDK 36.

```text
./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
```

Die Debug-APK liegt anschließend unter `app/build/outputs/apk/debug/app-debug.apk`; das Instrumentierungs-APK liegt unter `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`.

Die nicht geheime Backend-Origin wird beim Build über die Gradle-Property `pokefolioBackendOrigin` oder ersatzweise `POKEFOLIO_BACKEND_ORIGIN` gesetzt. Produktive Origins müssen pfadfreies HTTPS verwenden. Für lokale Entwicklung sind ausschließlich `localhost`, `127.0.0.1` und `::1` über HTTP erlaubt, etwa zusammen mit `adb reverse tcp:5080 tcp:5080`.

Persistente Android-Refresh-Tokens werden nicht in WebView-/JavaScript-Speichern abgelegt. Der native Store schreibt einen AES-GCM-Datensatz unter `noBackupFilesDir`; der nicht exportierbare Schlüssel liegt im Android Keystore. Der Instrumentierungslauf prüft Roundtrip, fehlenden Klartext und Löschung in einem isolierten Testpfad, ohne vorhandene App-Anmeldedaten anzutasten.

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
