# CUT — what’s in this repo

Mapbox-globe CPU wind technique from firemap.live. Personal GeoScobie sandbox — not the FireMap product.

## In

- `demo.html` — **default** Mapbox GL JS globe demo (you paste your own `pk.` token)
- `js/wind-particles-cpu.js` — CPU tadpoles via `map.project()` (exists because Mapbox globe custom layers lack a projection prelude)
- `js/wind-ui.js` — optional LIVE / forecast UI
- `sample-data/gfs/` — optional local UV frames (else demo uses firemap.live playlist)
- `demo-maplibre.html` — optional token-free MapLibre check only
- `README.md`, `LICENSE` (MIT)

## Out

- FireMap product UI / other hazard layers / analytics / mobile
- A shipped Mapbox access token
- Full GFS archive
- WebGL `projectTile` tadpole variant (MapLibre-oriented) — not this path
