# Wind on a Mapbox globe — without custom shaders

Personal project by **Rob Scobie** ([GeoScobie](https://github.com/GeoScobie)): live GFS wind on a **Mapbox** 3D globe **without writing custom WebGL shaders**.

**The constraint was Mapbox.** I needed animated wind on a globe in production. Particle wind is usually a GPU job — but a Mapbox custom layer does not get a globe-correct projection prelude (the way MapLibre’s `projectTile` GLSL kit does). A hand-built matrix on a Mapbox globe landed ~30% too wide in our probe. Reimplementing Mapbox’s projection was not the job.

**The fix:** simulate on the CPU, place with `map.project()`, draw comets on a fading 2D canvas. `map.project()` is already projection-correct on Mapbox — globe, mercator, pitch, and terrain — so one path stays honest without fighting the shader contract.

Same code also runs on MapLibre (bonus compatibility, not the headline).

Production adopter: **[firemap.live](https://firemap.live)**. This repo is a stripped personal sandbox, not the FireMap product.

---

## Why not Mapbox `raster-particle`?

Mapbox’s built-in [`raster-particle`](https://docs.mapbox.com/mapbox-gl-js/example/raster-particle-layer/) layer is excellent when you are on their raster-array / MRT path. We needed **plain UV PNGs on our own CDN** — no proprietary tile encode step — so we built this instead. Grateful for the platform; different data constraint.

Standing on prior art: [Vladimir Agafonkin — How I built a wind map with WebGL](https://medium.com/mapbox/how-i-built-a-wind-map-with-webgl-b63022b5537f) / [`mapbox/webgl-wind`](https://github.com/mapbox/webgl-wind) — the GPU ancestor (fade-buffer trails, state-in-texture). This repo takes the opposite trade on purpose: fewer particles, no shaders, **Mapbox-globe correct**.

---

## The data

NOAA **GFS 0.25°** 10 m U/V (~22 km cells). GRIB never reaches the browser. Each forecast hour is a static PNG:

| Channel | Meaning |
|--------|---------|
| **R** | Eastward wind, 0–255 → ±40 m/s |
| **G** | Northward wind, 0–255 → ±40 m/s |
| **B** | Valid mask (255 = data) |

Equirectangular, north-up, −180°…180°. A small manifest lists valid times. Local demo frames: `sample-data/gfs/`. Live FireMap frames: `https://firemap.live/data/wind/gfs/`.

---

## The loop (~60 fps)

1. **Sample** — bilinear UV from the PNG at the particle’s position  
2. **Advect** — move in Web Mercator (never round-trip lat for the step — see bugs)  
3. **Project** — `map.project()` for screen position (this is the Mapbox-globe fix)  
4. **Draw** — paint a head; only partially clear the canvas so older positions decay into a trail (**comets**)

Trail length ≈ how far a particle travels before the fade eats it:

`trail_px ≈ screenSpeed × ln(0.05) / ln(fadeOpacity) / fps`

A few hundred **viewport-relative** particles look like weather because they constantly die and respawn inside the current view — density stays right at every zoom instead of thinning as you fly in.

---

## Three bugs worth knowing

| Symptom | Cause | Fix |
|--------|--------|-----|
| Particles drifted south in a northward wind | Mercator↔lat round-trip in float32 larger than one frame’s motion | Stay in Mercator; advance with analytic `dy/dlat` |
| Respawns bunched in a corner on globe | `getBounds()` meaningless under globe (~1.4° box vs all of western Europe) | Unproject a 5×5 screen grid instead |
| Horizon / pole matted white | Even-on-sphere ≠ even-on-screen near the limb | Thin spawns by `cos(γ)` (orthographic foreshortening) |

Plus an iOS Safari footgun: scrubbing the forecast killed the tab — each PNG decode ~12.5 MB. Reuse one scratch canvas; decode at most every ~180 ms while the playhead follows the finger.

---

## Demo

```bash
python3 -m http.server 8080
# open http://localhost:8080/demo.html
```

| Path | Role |
|------|------|
| `demo.html` | Minimal boot (MapLibre token-free for local OSS; same particle path is what we run on Mapbox in production) |
| `js/wind-particles-cpu.js` | CPU particle simulator |
| `js/wind-ui.js` | LIVE tab / day track / playback |
| `sample-data/gfs/` | A few UV PNG frames + manifest (TBD) |
| `CUT.md` | What’s in vs deliberately out |

---

## MapLibre note

MapLibre *does* expose a custom-layer projection prelude (`projectTile`). A GPU particle layer is viable there. We still ship this CPU + `map.project()` path so **one** implementation stays correct on **Mapbox globe** (the hard case) and everywhere else. MapLibre support is compatibility — Mapbox globe was the design driver.

---

## Relation to FireMap

**[firemap.live](https://firemap.live)** ships this technique in production (toolbar wind + forecast). This repository is personal OSS staging — not product UI, not a full GFS archive, not analytics or mobile shells. See `CUT.md`.

---

## License

MIT — see `LICENSE`. Confirm before redistributing.

---

## Ship checklist (when going public)

- [ ] Rob green-lights public visibility  
- [ ] LinkedIn short cut (Maps Community Day peg optional)  
- [ ] Post to **Mapbox Developer Discord** (grateful / factual — not a dunk)  
- [ ] Sample GFS frames committed under `sample-data/gfs/`  
