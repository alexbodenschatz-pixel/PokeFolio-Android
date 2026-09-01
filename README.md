# PokéFolio Android + Windows Desktop Foundation

PokéFolio ist eine eigenständige Android-App zum Scannen, Erkennen, Vorprüfen und Sammeln von Trading Cards. Die App kombiniert eine native CameraX-Kamera und ML-Kit-OCR mit einer lokalen deutschsprachigen Oberfläche.

## Build

Voraussetzungen: JDK 17 und Android SDK 36.

```text
./gradlew :app:assembleDebug
```

Die Debug-APK wird unter `app/build/outputs/apk/debug/app-debug.apk` erzeugt. GitHub Actions baut Android und die Windows-Desktop-Grundlage und lädt beide Ergebnisse als Artefakte hoch.

## Windows Desktop

Die Windows-Grundlage unter `windows/PokeFolio.Desktop` verwendet .NET 8, WinForms und Microsoft WebView2. Sie bindet den vorhandenen Web-Core direkt aus `app/src/main/assets` ein; Recognition-, Collection-, Grading-, Varianten-, Learning- und API-Logik werden nicht dupliziert.

```text
dotnet build windows/PokeFolio.Desktop.sln -c Release
dotnet test windows/PokeFolio.Desktop.sln -c Release
```

Weitere Architektur- und Visual-Studio-Hinweise stehen in `windows/README.md`. Der vorhandene `pokefolio-test.keystore` ist nur für öffentliche Test-/Debug-Builds vorgesehen. Ein Release muss mit einem privaten Schlüssel außerhalb des Repositorys signiert werden; proprietäre Canon-EDSDK-Dateien werden nicht versioniert.
