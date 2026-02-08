# Ekot - Sveriges Radio

En minimal PWA (Progressive Web App) for att lyssna pa Sveriges Radios Ekot-sandningar direkt i mobilen.

## Funktioner

- **Fyra dagliga sandningar** - 08:00, 12:30, 16:45 och 17:45
- **Senaste sandningen markerad** - Gul ram och "SENAST"-badge, alltid placerad uppe till vanster
- **Visuella uppspelningsindikatorer** - Bla ram for aktivt spelande sandning, pulserande rod prick
- **Pausindikator** - Svagt pulserande tile nar uppspelning ar pausad
- **Ljudfokus vid paus** - Behaller ljudfokus i upp till 15 minuter vid paus sa att andra appar inte tar over
- **Smart polling** - Aktiv polling nar sandningar forvantas, gles polling anrars
- **Mediakontroller** - Stod for horlurar och lassskarmskontroller via Media Session API
- **Hoppa +/- 15 sekunder** - Snabbnavigation i sandningar
- **Morklagt granssnitt** - Mobiloptimerat, dark mode, stod for notch/safe areas
- **Offline-redo** - PWA med manifest for hemskarminstallation

## Krav

- Node.js (v14 eller nyare)

## Installation

1. Klona repot:
   ```bash
   git clone https://github.com/cgillinger/ekot.git
   cd ekot
   ```

2. Starta servern:
   ```bash
   node server.js
   ```

3. Oppna `http://localhost:8095` i webblasaren.

### Synology NAS

Projektet inkluderar start/stopp-skript for Synology Task Scheduler:

1. Redigera `EKOT_DIR` i `start.sh` och `stop.sh` till din installationssokag.
2. I DSM: Kontrollpanel -> Schemalagda aktiviteter -> Skapa -> Utlost aktivitet -> Egendefinierat skript.
3. Stall in pa boot-up och peka pa `start.sh`.

## Projektstruktur

```
ekot/
├── index.html              # Huvudsida (single-page)
├── app.js                  # Applikationslogik
├── style.css               # Stilmall (mobil-forst, responsiv)
├── server.js               # Node.js-server med RSS-proxy
├── manifest.webmanifest    # PWA-manifest
├── package.json            # Projektmetadata
├── start.sh                # Startskript (Synology)
├── stop.sh                 # Stoppskript (Synology)
└── assets/                 # Ikoner och ljudfiler
    ├── icon-*.png          # Appikoner i olika storlekar
    ├── icon-gray-*.png     # Gra ikoner (inaktiva sandningar)
    ├── icon-favicon.ico    # Favicon
    └── silence.wav         # Tyst ljud for ljudfokus
```

## Visuella tillstand

| Tillstand | Utseende |
|-----------|----------|
| Senaste sandningen | Gul ram med sken + "SENAST"-badge |
| Spelar (ej senaste) | Ljusbla ram + pulserande rod prick |
| Spelar (senaste) | Gul ram + pulserande rod prick |
| Pausad | Tile pulserar svagt, rod prick statisk |
| Inaktiv | Gra tile, ej klickbar |

## Teknikstack

- **Frontend**: Vanilla JavaScript, CSS3, HTML5
- **Backend**: Node.js (ingen extern dependency)
- **API**: Sveriges Radio RSS (`api.sr.se/api/rss/pod/3795`)
- **PWA**: Web App Manifest, Media Session API

## Konfiguration

Serverns port kan andras med miljovariabler:

```bash
PORT=3000 node server.js
```

Standard ar port `8095`.

## Version

Aktuell version: **1.3.0**

## Licens

MIT
