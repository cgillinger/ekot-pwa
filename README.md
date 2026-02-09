# Ekot - Sveriges Radio

En minimal PWA (Progressive Web App) för att lyssna på Sveriges Radios Ekot-sändningar direkt i mobilen.

## Funktioner

- **Fyra dagliga sändningar** - 08:00, 12:30, 16:45 och 17:45
- **Senaste sändningen markerad** - Gul ram och "SENAST"-badge, alltid placerad uppe till vänster
- **Visuella uppspelningsindikatorer** - Blå ram för aktivt spelande sändning, pulserande röd prick
- **Pausindikator** - Svagt pulserande tile när uppspelning är pausad
- **Ljudfokus vid paus** - Behåller ljudfokus i upp till 15 minuter vid paus så att andra appar inte tar över
- **Smart polling** - Aktiv polling när sändningar förväntas, gles polling annars
- **Mediakontroller** - Stöd för hörlurar och låsskärmskontroller via Media Session API
- **Hoppa +/- 15 sekunder** - Snabbnavigation i sändningar
- **Mörkt gränssnitt** - Mobiloptimerat, dark mode, stöd för notch/safe areas
- **Offline-stöd** - Service Worker cachar app-skal och API-svar för offline-användning
- **Installerbar** - PWA med manifest för hemskärmsinstallation

## Arkitektur

Version 2.0.0 är helt serverlös — appen pratar direkt med Sveriges Radios publika JSON-API utan någon backend. Den kan köras på vilken statisk webbserver som helst (GitHub Pages, Netlify, etc.).

## Installation

1. Klona repot:
   ```bash
   git clone https://github.com/cgillinger/ekot-pwa.git
   cd ekot-pwa
   ```

2. Servera filerna med valfri statisk webbserver, t.ex.:
   ```bash
   npx serve .
   ```
   eller öppna `index.html` direkt i webbläsaren.

3. För PWA-funktionalitet (Service Worker, installation) krävs HTTPS eller localhost.

## Projektstruktur

```
ekot-pwa/
├── index.html              # Huvudsida (single-page)
├── app.js                  # Applikationslogik
├── style.css               # Stilmall (mobil-först, responsiv)
├── sw.js                   # Service Worker för offline-stöd
├── manifest.webmanifest    # PWA-manifest
├── ekot.png                # Applogotyp
└── assets/                 # Ikoner och ljudfiler
    ├── icon-*.png          # Appikoner i olika storlekar
    ├── icon-gray-*.png     # Gråa ikoner (inaktiva sändningar)
    ├── icon-favicon.ico    # Favicon
    └── silence.wav         # Tyst ljud för ljudfokus
```

## Visuella tillstånd

| Tillstånd | Utseende |
|-----------|----------|
| Senaste sändningen | Gul ram med sken + "SENAST"-badge |
| Spelar (ej senaste) | Ljusblå ram + pulserande röd prick |
| Spelar (senaste) | Gul ram + pulserande röd prick |
| Pausad | Tile pulserar svagt, röd prick statisk |
| Inaktiv | Grå tile, ej klickbar |

## Teknikstack

- **Frontend**: Vanilla JavaScript, CSS3, HTML5
- **API**: Sveriges Radio JSON API (`api.sr.se/api/v2/podfiles`)
- **PWA**: Service Worker, Web App Manifest, Media Session API
- **Beroenden**: Inga — helt utan externa dependencies

## Version

Aktuell version: **2.0.0** (Serverless)

## Licens

MIT
