# CUT — what’s in this repo

Personal GeoScobie sandbox for the **Mapbox-globe** CPU wind technique used on firemap.live. Not the FireMap app.

## In

- `js/wind-particles-cpu.js` — CPU tadpoles via `map.project()` (Mapbox globe was the reason this exists)
- `js/wind-ui.js` — LIVE / forecast controls
- `demo.html` — token-free MapLibre boot for local OSS; same JS runs on Mapbox in production
- `sample-data/gfs/` — optional few UV PNG frames + manifest (or hit firemap.live’s playlist)
- `README.md`, `LICENSE` (MIT)

## Out

- FireMap product chrome, other hazard layers, tokens, analytics, mobile shells
- Full GFS archive
- The WebGL / `projectTile` tadpole variant (MapLibre-oriented) — different file, not shipped here
