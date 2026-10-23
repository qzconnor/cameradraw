# End-to-End-Tests

Die Tests starten die gebaute App mit [Playwright](https://playwright.dev/docs/api/class-electron)
und bedienen sie wie ein Mensch: Tasten, Maus, Dialoge, Galerie, Editor. Wo es geht, prüfen sie das
Ergebnis dort, wo es zählt – im gespeicherten PNG, in den Ebenen (`.cameradraw/*.json`), in der
`settings.json` oder in der Zwischenablage. Grundlage ist die
[Electron-Anleitung zu automatisierten Tests](https://www.electronjs.org/docs/latest/tutorial/automated-testing).

## Ausführen

```bash
npm run test:e2e                          # bauen (out-e2e/) und alle Tests
npx playwright test e2e/zoom.spec.ts      # nur eine Datei – ohne neu zu bauen
npx playwright test -g "Speichern unter"  # nur Tests, deren Name passt
```

Nach einer Änderung an der App vorher neu bauen: `npx electron-vite build --outDir out-e2e`. Der
eigene Ausgabeordner sorgt dafür, dass ein laufendes `npm run dev` nicht stört.

## Was jeder Test bekommt

- **Eigenes Profil** – `CAMERADRAW_USER_DATA` zeigt auf einen neuen Ordner unter `%TEMP%`
  (`cameradraw-e2e-*`), der nach dem Test gelöscht wird. Die echten Einstellungen in `%APPDATA%`
  bleiben unberührt.
- **Eigener Speicherordner** mit einem Testbild `Probe.png` (1920 × 1080, Verlauf mit 100-px-Raster).
- **Testkamera** – Chromiums `fake_device_0` statt einer echten Kamera, also auch ohne Mikroskop und
  auf dem CI-Runner.
- **Einstellungen** pro Test oder `describe`-Block: `test.use({ settings: { … } })`.

Auf dem Bildschirm erscheinen dabei kurz die Testfenster. Eingaben gehen direkt an die App, nebenbei
weiterarbeiten geht – nur nichts kopieren, solange die Zwischenablage-Tests laufen. Sie sichern die
Zwischenablage vorher und stellen sie danach wieder her; der Papierkorb-Test holt sein Bild ebenfalls
zurück.

## Wenn ein Test fehlschlägt

Unter `test-results/<Test>/` liegen ein Screenshot vom Moment des Fehlers und der Seitenaufbau
(`error-context.md`). Auf GitHub hängen dieselben Dateien als Artefakt **e2e-results** am Lauf.

## Tests schreiben

| Datei                | Inhalt                                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| `fixtures.ts`        | `page`, `app` (Main-Prozess), `workspace` (Ordner), `launch()` für Neustarts      |
| `helpers/app.ts`     | Galerie, Editor, Zeichnen, Speichern, Toasts, Dialoge, Zugriff auf die Stores     |
| `helpers/library.ts` | Testbilder und Ebenen anlegen (`addImage`), lesen (`readLayers`, `layerPictures`) |
| `helpers/mcp.ts`     | MCP-Client verbinden (`connect`) und Tools aufrufen (`call`, `callImage`, …)      |

- Bilder mit Ebenen, Aufnahmedatum oder Dateidatum: `addImage(workspace.library, 'Name.png', { layers, mtime })`.
- In den Zustand der App schauen: `storeValue(page, 'editor', 'dirty')`; eine Aktion auslösen, für die
  es keine Taste gibt (z. B. die Foto-Taste am Mikroskop): `storeCall(page, 'camera', 'requestCapture')`.
- Im Main-Prozess: `app.evaluate(({ BrowserWindow }) => …)` – so simulieren die Update-Tests
  GitHub, ohne ins Netz zu gehen.
- Ein Neustart in denselben Ordnern: zweimal `launch()` im selben Test (siehe `window.spec.ts`).
