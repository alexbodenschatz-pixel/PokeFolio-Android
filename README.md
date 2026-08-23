# PokéFolio Android

PokéFolio ist eine eigenständige Android-App zum Scannen, Erkennen, Vorprüfen und Sammeln von Trading Cards. Die App kombiniert eine native CameraX-Kamera und ML-Kit-OCR mit einer lokalen deutschsprachigen Oberfläche.

## Build

Voraussetzungen: JDK 17 und Android SDK 36.

```text
./gradlew :app:assembleDebug
```

Die Debug-APK wird unter `app/build/outputs/apk/debug/app-debug.apk` erzeugt. Bei Pushes auf `main` baut GitHub Actions dieselbe Projektstruktur und lädt die APK als Artefakt `PokeFolio-Android-debug-apk` hoch.
