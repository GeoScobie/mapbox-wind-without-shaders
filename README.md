# wind-without-shaders

Personal experiment by **Rob Scobie** (GeoScobie): animated GFS wind particles on a map **without WebGL custom shaders**.

CPU canvas tadpoles + `map.project()` — works on MapLibre (preferred here; no token) and Mapbox globe / mercator / pitched views from one path.

## Why

A shader / `projectTile` path is brittle across Mapbox vs MapLibre. This repo keeps the look (fade lifecycle, taper, wind-weighted respawn, viewport density) while projecting with the map’s own API.

## Demo

```bash
# from this directory (needs a local static server for ES modules)
python3 -m http.server 8080
# open http://localhost:8080/demo.html
```

- `demo.html` — tiny MapLibre boot only (no FireMap product chrome).
- `js/wind-particles-cpu.js` — particle simulator.
- `js/wind-ui.js` — LIVE tab / day track / playback.

Local wind frames: put UV PNGs + `manifest.json` under `sample-data/gfs/` (see that README).  
Production data path used by the live product: `https://firemap.live/data/wind/gfs/`.

## Relation to FireMap

**[firemap.live](https://firemap.live)** is the production adopter of this technique. This repository is a personal, stripped sandbox — not the FireMap product, not a full GFS archive, and not a public product release.

## License

MIT draft — see `LICENSE` (confirm before redistributing).

## Scope

See `CUT.md` for what is in vs deliberately out.
