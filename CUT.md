# CUT — in vs out

Personal GeoScobie sandbox for the CPU wind-particle technique. Not FireMap product code.

## In

- `js/wind-particles-cpu.js` — CPU canvas particles (`map.project()`)
- `js/wind-ui.js` — bottom LIVE tab / forecast track / play
- `demo.html` — MapLibre-only boot (no token)
- `sample-data/gfs/` — placeholder for a few UV PNG frames + manifest (TBD)
- Docs: README, LICENSE (MIT draft), this CUT list

## Out (deliberately)

- FireMap product UI / `script-test.js` / `styles3.css` / toolbar chrome
- `us-fwi.js`, GDACS, hurricanes, aircraft, fire icons, Font Awesome pack
- Mapbox GL + any `pk.` / access tokens
- Full GFS archive / multi-cycle history (prod serves frames at firemap.live `/data/wind/gfs/`)
- WebGL / tadpole-shader / `projectTile` variant (`wind-particles-tadpole.js`)
- Analytics (GTM), SEO pages, Capacitor / mobile shells
- Publishing this repo as **public** (keep private unless Rob says otherwise)
