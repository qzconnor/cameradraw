<div align="center">

<img src="resources/icon.png" width="88" alt="" />

# CameraDraw

**Kamerabild anhalten, darauf zeichnen, sauber ablegen.**

Desktop-App für USB-Mikroskope und Webcams – mit Projekten, Galerie und Zeichnungen,
die auch später noch Form für Form bearbeitbar bleiben.

![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Plattform](https://img.shields.io/badge/Plattform-Windows-0078D4)

<img src="docs/screenshots/editor.jpg" alt="Editor: Mikroskopbild mit Pfeil, Ellipse, Rechteck und Text" width="900" />

</div>

## Funktionen

- **Einfrieren und zeichnen** – `Leertaste` oder die Foto-Taste am Mikroskop hält das Bild an.
  Stift, Textmarker, Linie, Pfeil, Rechteck, Ellipse, Text und Radierer, dazu Rückgängig und
  Wiederholen.
- **Kontextmenü im Editor** – Text genau an der angeklickten Stelle einfügen, Formen nachträglich
  füllen, löschen, alles auswählen.
- **Bleibt bearbeitbar** – Neben jedem Bild liegen das Original und die Zeichnung als Ebenen. Wer
  ein Bild wieder öffnet, kann jede Form und jeden Text einzeln verschieben, ändern oder löschen.
- **Projekte** – Beim Speichern fragt CameraDraw nach Dateiname und Projekt (oder „Kein Projekt“).
  Das zuletzt gewählte Projekt ist beim nächsten Bild schon ausgewählt.
- **Galerie** – Suche über alle Projekte, Sortierung nach Datum, Name oder Größe, Filter nach
  Zeitraum. Bilder lassen sich per Drag & Drop in Projekte ziehen, umbenennen (`F2`), verschieben
  und in den Papierkorb legen.
- **Kamera** – unterscheidet echte von virtuellen Kameras (OBS, DroidCam, …), verbindet sich nach
  dem Abziehen wieder mit genau derselben Kamera, zoomt mit der Kamera selbst oder digital.
- **Geräte-Module** – Gerätetypen bringen eigene Funktionen mit, z. B. Foto- und Zoom-Tasten des
  Generalplus-USB-Mikroskops.

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/gallery.jpg" alt="Galerie mit Projekten oben und Bildern darunter" /></td>
    <td width="33%"><img src="docs/screenshots/drag-and-drop.jpg" alt="Ein Bild wird per Drag & Drop in ein Projekt gezogen" /></td>
    <td width="33%"><img src="docs/screenshots/save-dialog.jpg" alt="Speichern-Dialog mit Dateiname und Projekt" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Galerie mit Projekten</sub></td>
    <td align="center"><sub>Drag & Drop in ein Projekt</sub></td>
    <td align="center"><sub>Speichern mit Name und Projekt</sub></td>
  </tr>
</table>

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org/) 22 oder neuer.

```bash
git clone https://github.com/qzconnor/cameradraw.git
cd cameradraw
npm install
npm run dev
```

Beim ersten Start fragt CameraDraw nach einem Speicherordner und einer Kamera. Beides lässt sich
später in den Einstellungen ändern.

## Bedienung

**Kamera**

| Taste                | Aktion                                                          |
| -------------------- | --------------------------------------------------------------- |
| `Leertaste`          | Kamerabild anhalten und den Editor öffnen                       |
| Foto-Taste am Gerät  | wie `Leertaste` (USB-Mikroskop, braucht den Hintergrunddienst)  |
| `+` / `−` / `0`      | Zoom vergrößern / verkleinern / zurücksetzen (auch per Mausrad) |
| Zoom-Tasten am Gerät | wie `+` / `−` (USB-Mikroskop, ohne Hintergrunddienst)           |
| `G`                  | Galerie öffnen / schließen                                      |

**Editor**

| Taste               | Aktion                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| `V` `P` `M` `E`     | Auswählen, Stift, Textmarker, Radierer                                 |
| `L` `A` `R` `O` `T` | Linie, Pfeil, Rechteck, Ellipse, Text (`Shift` = gerade / quadratisch) |
| Rechtsklick         | Text hier einfügen, Form füllen / Füllung entfernen, Löschen           |
| `Strg+A`            | Alles auswählen (beim Schreiben: den Text markieren)                   |
| `Strg+Z` / `Strg+Y` | Rückgängig / Wiederholen                                               |
| `Entf`              | Auswahl löschen                                                        |
| `Strg+S`            | Speichern – mit Dateiname und Projekt                                  |
| `Esc`               | Auswahl aufheben, sonst zurück zur Kamera                              |

**Galerie**

| Taste / Geste           | Aktion                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| Bild auf Projekt ziehen | Bild in das Projekt verschieben (mit „Rückgängig“ im Hinweis)         |
| `F2`                    | Bild oder Projekt umbenennen                                          |
| Rechtsklick / `…`       | Bearbeiten, Umbenennen, Verschieben nach …, Im Ordner zeigen, Löschen |
| `Esc`                   | Ziehen abbrechen, Suche leeren, Galerie schließen                     |

## Speicherordner und Projekte

Ein Projekt ist ein Unterordner im Speicherordner, eine Ebene tief. Unterordner, die außerhalb
der App angelegt werden, erscheinen ebenfalls als Projekte.

```
Speicherordner/
├── Schnappschuss 1.png             Bild ohne Projekt
├── .cameradraw/                    versteckt: Original und Ebenen
│   ├── Schnappschuss 1.base.png
│   └── Schnappschuss 1.json
└── Textilprobe/                    Projekt
    ├── Probe 1 – Übersicht.png
    └── .cameradraw/
        ├── Probe 1 – Übersicht.base.png
        └── Probe 1 – Übersicht.json
```

- Jedes Bild liegt als PNG im Ordner und lässt sich ganz normal weiterverwenden.
- Im versteckten Unterordner `.cameradraw/` liegen pro Bild das Originalbild (`*.base.png`) und die
  Zeichnungs-Ebenen (`*.json`).
- Umbenennen und Verschieben nimmt die Ebenen mit. Ist der Name im Zielprojekt schon vergeben,
  hängt CameraDraw eine Nummer an.
- Löschen verschiebt Bilder und Projekte in den Papierkorb.

## Entwicklung

| Befehl                  | Zweck                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `npm run dev`           | App mit Hot Reload starten                                 |
| `npm run typecheck`     | TypeScript für Main und Renderer prüfen                    |
| `npm run lint`          | ESLint                                                     |
| `npm run format`        | Prettier                                                   |
| `npm run build:win`     | Windows-Installer bauen (`dist/`), inkl. Hintergrunddienst |
| `npm run build:service` | nur den Hintergrunddienst bauen (`service/publish/`)       |

Der Hintergrunddienst (`service/`, C#) braucht zum Bauen das .NET-SDK (10) und die
Visual-Studio-C++-Build-Tools (NativeAOT). Ohne ihn läuft die App normal, nur die Foto-Taste am
Mikroskop fehlt.

**UI-Komponenten:** [shadcn-vue](https://www.shadcn-vue.com/) – neue Komponenten mit
`npx shadcn-vue@latest add <name>` (siehe `components.json`). Da electron-vite nicht als Framework
erkannt wird, braucht nur `init` einen temporären `vite.config.ts`; `add` funktioniert direkt. Die
Schrift (Geist) kommt lokal über `@fontsource-variable/geist` – deshalb hat `components.json`
bewusst keinen `font`-Eintrag, sonst fügt die CLI bei jedem `add` wieder einen Google-Fonts-Import
ein (den die CSP blockiert).

### Projektstruktur

```
src/
  shared/            Typen, IPC-Kanäle und Namensregeln (names.ts) für Main, Preload und Renderer
  main/              settings.ts (JSON in userData), library.ts (Bilder und Projekte im
                     Speicherordner), protocol.ts (cdraw:// für Bilder/Thumbnails), cameras.ts
                     (Windows-Geräteverwaltung: echte vs. virtuelle Kameras), buttons.ts (Dienst),
                     controls.ts (Helligkeit lesen für Zoom-Tasten), ipc.ts
  preload/           window.api (contextBridge, sandboxed)
  renderer/src/
    stores/          Pinia: settings, camera (Verbindung/Reconnect/Zoom), gallery (Projekte,
                     Suche, Sortierung), editor, panels, hardware, modules
    composables/     useDrawingCanvas (fabric.js-Canvas, Werkzeuge, Undo/Redo, Export),
                     useGalleryDrag (Drag & Drop in der Galerie)
    editor/          Werkzeug-Definitionen, Formen, History
    lib/             gallery.ts (Filtern und Sortieren), Bild- und Kamera-Hilfen
    modules/         Geräte-Module – eine Datei pro Gerätetyp, Liste in index.ts
    components/      camera/, editor/, gallery/, settings/, modules/, layout/, common/,
                     ui/ (shadcn-vue)
service/             Windows-Dienst „CameraDraw Buttons“ (C#, NativeAOT) für Kamera-Foto-Tasten
scripts/             build-service.mjs
```

## Technische Details

<details>
<summary><b>Echte und virtuelle Kameras, Wiederverbinden</b></summary>

<br />

USB-Kameras tragen ihre USB-ID im Namen (z. B. `(1b3f:2002)`). Alle anderen werden mit der
Windows-Geräteverwaltung abgeglichen – virtuelle Kameras (OBS, DroidCam, …) sind dort nicht oder
nur als Software-Gerät eingetragen. Die Kameraauswahl gruppiert danach.

Wird die gewählte Kamera abgezogen, wartet die App, bis genau diese Kamera wieder verbunden ist
(gleiche Geräte-ID oder eindeutig gleicher Name). Sie wechselt nie selbstständig zu einer anderen
Kamera – das geht nur über die Kameraauswahl.

</details>

<details>
<summary><b>Geräte-Module</b></summary>

<br />

Ein Modul beschreibt einen Gerätetyp (USB-IDs, Funktionen, Hinweise) und kann über `activate()`
eigene Logik ausführen, solange seine Kamera live ist. Kameras werden automatisch per USB-ID
zugeordnet oder manuell („Kein Modul“ / bestimmtes Modul).

Das geht im Panel „Geräte-Module“ (Blöcke-Symbol rechts neben den Einstellungen). Dort stehen die
Module als Kacheln, das gerade benutzte ist als „In Benutzung“ markiert. Eine Kachel öffnet die
Einstellungen des Moduls: an/aus, Funktionen und Hintergrunddienst.

Neues Gerät: Datei in `src/renderer/src/modules/` anlegen und in `modules/index.ts` eintragen.

</details>

<details>
<summary><b>Mikroskop-Tasten (Generalplus 1b3f:2002)</b></summary>

<br />

Per USBPcap/Wireshark und am Programm V-SCOPE untersucht:

| Taste      | Signal                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| Foto       | Interrupt-Endpunkt `0x83`, UVC-Statuspaket `02 01 00 01` (gedrückt) / `02 01 00 00` (los) |
| Zoom + / − | UVC-Helligkeit (Unit 5, Selector 2): `0x33` nach Zoom +, `0x32` nach Zoom −, sonst `0x31` |
| Foto lang  | keiner – schaltet das Gerät aus/an                                                        |

Die Zoom-Tasten schickt das Mikroskop nicht von selbst, und es zoomt auch nicht selbst. Es setzt nur
den Wert, den `GET_CUR` für die Helligkeit liefert, für genau eine Abfrage auf `0x33` bzw. `0x32`.
Man muss also regelmäßig fragen. V-SCOPE fragt alle 65 ms über `IAMVideoProcAmp`, CameraDraw liest
den Wert genauso oft über `IOCTL_KS_PROPERTY` am Kameratreiber und zoomt dann digital. Dafür reicht
`cameradraw-buttons.exe brightness 1b3f:2002` als normaler Benutzer, ohne Dienst und ohne USBPcap
(`src/main/controls.ts`, ein Prozess pro Gerät, endet mit der App). Chromium hilft hier nicht:
`getSettings().brightness` liefert nur einen zwischengespeicherten Wert. Die Helligkeit darf nie
gesetzt werden.

Das Foto-Signal verarbeitet der Windows-Kameratreiber (`usbvideo.sys`) selbst: Das Mikroskop meldet
Standbild-Methode 2, also macht der Treiber aus dem Druck eine eigene Standbild-Aufnahme. Das
Ereignis `KSEVENT_VIDCAPTOSTI_EXT_TRIGGER` lässt sich zwar ohne Admin-Rechte abonnieren, wird aber
nie ausgelöst (getestet, auch während CameraDraw streamt). Media Foundation, WinRT und DirectShow
geben die Taste an ein zweites Programm ebenfalls nicht weiter.

</details>

<details>
<summary><b>Hintergrunddienst „CameraDraw Buttons“</b></summary>

<br />

Der Dienst (`service/`) liest die Foto-Taste deshalb über USBPcap aus dem USB-Verkehr.

- Er läuft als SYSTEM, weil nur Admins und SYSTEM `\\.\USBPcapN` lesen dürfen. Er gibt alle
  Windows-Rechte bis auf `SeChangeNotifyPrivilege` ab.
- Er sucht die beobachteten Geräte per VID/PID im USB-Baum (Root-Hub + aktuelle Adresse, alle 2 s
  neu, damit Umstecken funktioniert).
- Er zeichnet nur diese Adressen auf und liest dabei pro Paket nur die ersten 128 Bytes.
- Er erkennt UVC-Statuspakete allgemein (Interrupt-IN, `bStatusType` 2, `bEvent` 0). Damit
  funktioniert er für jede UVC-Kamera mit Auslöser.
- Er zeichnet nur auf, solange CameraDraw eine Kamera mit Foto-Taste live zeigt.
- USBPcap muss installiert sein. Es erlaubt pro Root-Hub nur eine Aufzeichnung gleichzeitig: Läuft
  Wireshark oder `USBPcapCMD` am selben Anschluss, meldet der Dienst „belegt“.

| Weg      | Details                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| Pipe     | `\\.\pipe\cameradraw-buttons`, eine JSON-Zeile pro Nachricht (`service/Protocol.cs`)     |
| → Dienst | `{"watch":[{"vendorId":"1b3f","productId":"2002"}]}` – welche Geräte beobachtet werden   |
| ← Dienst | `{"type":"status","state":"ready",…}` und `{"type":"button",…,"pressed":true}`           |
| Electron | `src/main/buttons.ts` verbindet sich (Node `net`), IPC → `window.api.buttons`            |
| Modul    | `activate()` bekommt `onPhotoButton()` und `capture()`; Aufnahme nur in der Live-Ansicht |
| Zoom     | `onBrightness()` und `zoom()` – ohne Dienst, siehe Mikroskop-Tasten                      |

Installieren und Entfernen geht im Panel „Geräte-Module“ beim Mikroskop-Modul, einmalig mit
UAC-Abfrage. CameraDraw startet dazu `cameradraw-buttons.exe install` mit Admin-Rechten. Die `.exe`
kopiert sich nach `C:\Program Files\CameraDraw Buttons\`, damit ein SYSTEM-Dienst nicht aus dem vom
Benutzer beschreibbaren App-Ordner startet. Danach startet der Dienst automatisch mit Windows.

- Log: `C:\ProgramData\CameraDraw Buttons\service.log`
- `cameradraw-buttons devices` listet die USB-Geräte je USBPcap-Hub (ohne Admin-Rechte).
- `cameradraw-buttons parse <datei.pcap>` sucht Tastenpakete in einer Aufzeichnung (ohne
  Admin-Rechte).

</details>
