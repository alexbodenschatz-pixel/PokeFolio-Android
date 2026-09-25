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

Der native Android-Account-Client validiert die Auth-Antworten strikt, rotiert Refresh-Tokens serialisiert und hält Access-Tokens nur im Prozessspeicher. Die gebündelte WebView erhält über `window.PokeAccount` ausschließlich tokenfreien Konto- und Gerätestatus. Die gemeinsame Systemseite bietet Registrierung, Login, authentifizierten Passwortwechsel, Passwort-Wiederherstellung, manuellen Sync, Logout und „Meine Geräte“, ohne Passwörter oder Tokens im Browser-Speicher abzulegen. Ein erfolgreicher Passwortwechsel erhält die aktuelle Sitzung und widerruft serverseitig alle anderen Geräte; aktuelle und neue Passwortwerte werden weder in Bridge-Antworten noch im Browser-Speicher abgelegt und nach jedem Versuch aus dem Formular entfernt. Aktive Sitzungen können außerdem einzeln oder – unter Erhalt der aktuellen Sitzung – gemeinsam widerrufen werden; Geräte-IDs stammen ausschließlich aus einer nativ validierten Serverantwort. Reset-Code und neues Passwort werden nur für den einmaligen nativen Aufruf gehalten, anschließend aus den Eingabefeldern entfernt; ein Link-Fragment wird nach der Übernahme sofort aus der sichtbaren Adresse entfernt.

Das Backend unterstützt zusätzlich eine neutrale Passwort-Wiederherstellung über konfiguriertes SMTP: unbekannte und bekannte gültige E-Mail-Adressen erhalten dieselbe API-Antwort, in PostgreSQL liegt nur der kurzlebige Token-Hash, und eine erfolgreiche Einmalbestätigung widerruft alle vorhandenen Gerätesitzungen. Android und Windows verwenden dafür denselben versionierten Vertrag über native, anonyme HTTPS-Aufrufe; nach erfolgreicher Bestätigung werden auch die lokalen Sitzungsdaten beider Clients verworfen.

Katalogauflösung und Push/Pull-Synchronisation laufen auf Android und Windows über denselben tokenfreien `cloud-bootstrap.js` und denselben persistenten `sync-driver.js`. Android legt den strikt validierten Queue-Snapshot atomar und nach serverseitig authentifiziertem Konto getrennt unter dem App-Dateibereich ab; der Dateiname enthält nur einen SHA-256-Kontoschlüssel. Beschädigte Snapshots werden nicht automatisch überschrieben. Die sichtbare Kontoseite übernimmt einen bestehenden lokalen Bestand nur nach Bestätigung: Provider-Karten werden zuerst auf globale UUIDs aufgelöst, Create/Quantity-Delta-Operationen erhalten kontogebundene deterministische UUIDv8-IDs, und Wiederholungen bleiben serverseitig idempotent. Die lokale Kopie wird nicht gelöscht. Eine Besitzmarkierung blendet den Legacy-Bestand für andere Konten und abgemeldete Gäste aus; deren neue lokale Daten liegen in getrennten Bereichen.

`collection-cloud-driver.js` materialisiert gezogene Cloud-Holdings auf beiden Plattformen über den globalen Kartenkatalog in die aktive Sammlung. Lokale Bilder, Scan-Daten und Favoriten bleiben erhalten; serverseitige Menge und Version werden kontogebunden verknüpft. Mengenänderungen werden als additive Deltas, Notiz-/Sprach-/Varianten-/Zustandsänderungen als versionierte Updates vor der lokalen Speicherung in die Offline-Queue geschrieben. Während ausstehender Operationen oder unvollständiger Pull-Seiten wird kein älterer Cloud-Snapshot gerendert. Vollständig neue Scans erhalten nach sicherer Kontozuordnung einen persistenten Create-Outbox-Marker: Die Provider-Identität wird asynchron aufgelöst, gegen vorhandene Holdings dedupliziert und mit deterministischen Holding-/Operations-IDs queued. Erst ein bestätigter Pull entfernt den Marker; Konflikte oder Ablehnungen lassen die lokale Karte sichtbar und prüfbar.

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
