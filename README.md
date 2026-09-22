# Wind on a Mapbox globe — without custom shaders

CPU wind particles that stay correct on a **Mapbox** 3D globe.

Built for [firemap.live](https://firemap.live). Personal sandbox by [Rob Scobie](https://github.com/GeoScobie) — not the FireMap product.

## The Mapbox problem

Animated wind is usually a WebGL custom layer. On **MapLibre**, that works: custom layers get a `projectTile` GLSL prelude that is globe-correct.

**Mapbox does not give you that.** A probe triangle drawn with a hand-built matrix on a Mapbox globe came out ~30% too wide, worse toward the edges. Reimplementing Mapbox’s projection was not worth it.

`map.project()` *is* globe-correct on Mapbox — same call Markers use. So this layer simulates on the CPU and lets the map project.

~400 sprites is cheap. 50k would not be; that is when Mapbox’s `renderToTile` path would matter instead.

## What you get

- Works on **Mapbox globe** (the hard case), mercator, pitch, terrain
- Same file also runs on MapLibre
- GFS UV wind as plain PNGs (R=u, G=v, B=mask) — no Mapbox raster-array / MRT encode
- Tadpole look: fade-in / grow / fade-out, tapered head, viewport-relative density

Not a replacement for Mapbox [`raster-particle`](https://docs.mapbox.com/mapbox-gl-js/example/raster-particle-layer/). That layer is great on their raster-array path. We needed our own UV PNGs on a CDN.

Ancestor worth knowing: [Agafonkin / mapbox webgl-wind](https://github.com/mapbox/webgl-wind) — GPU, fade buffer, flat map. Different trade.

## Quick start

```bash
python3 -m http.server 8080
# http://localhost:8080/demo.html
```

`demo.html` boots MapLibre without a token so the OSS demo runs cold. Production on firemap.live uses this same particle code on **Mapbox**.

| Path | What |
|------|------|
| `js/wind-particles-cpu.js` | Simulator (`map.project()` + canvas) |
| `js/wind-ui.js` | LIVE / forecast UI |
| `sample-data/gfs/` | Optional local UV frames (or use `https://firemap.live/data/wind/gfs/`) |
| `CUT.md` | In vs out of this repo |

Wire it on a Mapbox map the same way: construct `WindParticlesCPU` with your `mapboxgl.Map`, point the manifest at your UV PNG playlist.

## Bugs that matter

These burned real time. Both are documented in the source.

1. **South drift in a north wind** — Mercator↔lat round-trip in float32 was larger than one frame of motion. Stay in Mercator; advect with analytic `dy/dlat`.
2. **Respawns piled in a corner on globe** — `map.getBounds()` is nonsense under globe projection. Unproject a screen grid instead.
3. **White mat on the limb / pole** — uniform-on-sphere is not uniform-on-screen. Thin spawns by foreshortening (`cos γ`).

iOS: do not decode a full UV PNG every scrub frame (~12 MB). Reuse a canvas; throttle decodes.

## Data

NOAA GFS 0.25° 10 m U/V → equirectangular PNG per forecast hour:

- R / G → u / v in ±40 m/s  
- B → valid mask  

Manifest lists frames. Live playlist: `https://firemap.live/data/wind/gfs/`.

## License

MIT — see `LICENSE`.
