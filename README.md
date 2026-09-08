# Wind Without Shaders

Personal experiment by **Rob Scobie** ([GeoScobie](https://github.com/GeoScobie)): live global wind on a 3D globe **without writing custom WebGL shaders**.

CPU simulation + `map.project()` + a fading 2D canvas. One path that stays projection-correct on MapLibre and Mapbox — globe, mercator, pitch, and terrain.

Production adopter: **[firemap.live](https://firemap.live)** (this repo is a stripped personal sandbox, not the FireMap product).

---

## Why not the GPU?

Particle wind is classically a GPU job: positions in a texture, advection in a fragment shader, never touch the CPU. That works beautifully on a flat Mercator map. On a **3D globe**, you need the map’s projection inside your shader.

[MapLibre](https://maplibre.org/) hands custom layers a GLSL prelude (`projectTile`) that is correct for whichever projection is live. Mapbox’s custom-layer contract is built differently — a hand-rolled matrix on a Mapbox globe was ~30% too wide in our probe, and reimplementing their projection was not the job.

We stopped projecting ourselves. **`map.project()` is already projection-correct** on both libraries. The simulation runs in ordinary JavaScript; we draw to a canvas over the map.

That costs the million-particle GPU path and buys correctness on five projections from one code path. A few hundred viewport-relative particles look like weather because they constantly die and respawn inside the current view — density stays right at every zoom instead of thinning as you fly in.

### Standing on prior work (gratefully)

- [Vladimir Agafonkin — How I built a wind map with WebGL](https://medium.com/mapbox/how-i-built-a-wind-map-with-webgl-b63022b5537f) / [`mapbox/webgl-wind`](https://github.com/mapbox/webgl-wind) — the GPU ancestor. Fade-buffer trails, state-in-texture, the demo everyone clones. This repo deliberately takes the opposite trade: fewer particles, no shaders, globe-correct on both GL stacks.
- Mapbox’s built-in [`raster-particle`](https://docs.mapbox.com/mapbox-gl-js/example/raster-particle-layer/) layer is excellent when you are on their raster-array / MRT path. We needed **plain UV PNGs on our own CDN**, so we went another way — not a knock on the product.

---

## The data

NOAA **GFS 0.25°** 10 m U/V (~22 km cells, 1440×721). GRIB never reaches the browser. Each forecast hour is a static PNG:

| Channel | Meaning |
|--------|---------|
| **R** | Eastward wind, 0–255 → ±40 m/s |
| **G** | Northward wind, 0–255 → ±40 m/s |
| **B** | Valid mask (255 = data) |

Equirectangular, north-up, −180°…180°. A small manifest lists valid times. Local demo frames go under `sample-data/gfs/` (see that folder). Live FireMap frames: `https://firemap.live/data/wind/gfs/`.

---

## The loop (~60 fps)

1. **Sample** — bilinear UV from the PNG at the particle’s position  
2. **Advect** — move in Web Mercator (never round-trip lat for the step — see bugs below)  
3. **Project** — `map.project()` for screen position  
4. **Draw** — paint a head; only partially clear the canvas so older positions decay into a trail (**comets**)

Trail length ≈ how far a particle travels before the fade eats it:

`trail_px ≈ screenSpeed × ln(0.05) / ln(fadeOpacity) / fps`

Speed and trail length are the same knob once you understand that.

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
| `demo.html` | MapLibre-only boot (no token, no FireMap chrome) |
| `js/wind-particles-cpu.js` | CPU particle simulator |
| `js/wind-ui.js` | LIVE tab / day track / playback |
| `sample-data/gfs/` | A few UV PNG frames + manifest (TBD) |
| `CUT.md` | What’s in vs deliberately out |

---

## Relation to FireMap

**[firemap.live](https://firemap.live)** ships this technique in production (toolbar wind control + forecast). This repository is personal OSS staging — not product UI, not a full GFS archive, not analytics or mobile shells. See `CUT.md`.

---

## License

MIT — see `LICENSE`. Confirm before redistributing.

---

## Ship checklist (when going public)

- [ ] Rob green-lights public visibility  
- [ ] LinkedIn short cut of the write-up  
- [ ] Post to **Mapbox Developer Discord** (Mapbox-friendly tone)  
- [ ] Sample GFS frames committed under `sample-data/gfs/`  
