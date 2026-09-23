# Mapbox Wind Without Shaders

CPU wind particles for **[Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/)** — including **[Mapbox Globe](https://docs.mapbox.com/mapbox-gl-js/guides/globe/)** — without writing a custom WebGL shader layer.

**Live demo in production:** [firemap.live](https://firemap.live) (turn on wind in the map UI).

Personal sandbox by [Rob Scobie](https://github.com/GeoScobie) of the technique used on FireMap — not the FireMap product itself.

## Where it sits in the Mapbox stack

| Mapbox piece | Role here |
|--------------|-----------|
| **Mapbox GL JS** | Host map (`mapboxgl.Map`) |
| **Mapbox Globe** | Why this exists — globe custom-layer projection is the hard case |
| **Mapbox styles** (`outdoors-v12`, Standard, etc.) | Basemap; any style works |
| **`map.project()`** | How particles stay globe-correct (same path Markers use) |
| **[`raster-particle`](https://docs.mapbox.com/mapbox-gl-js/example/raster-particle-layer/)** | Mapbox’s built-in GPU particles on **raster-array / MRT** tiles — great when you’re on that pipeline; we needed plain UV PNGs on our CDN instead |
| **Mapbox Access Tokens** | You bring your own `pk.` — none are shipped in this repo |

Optional: same JS also runs on MapLibre. **Mapbox is the intended target.**

## The problem

Particle wind is usually a WebGL **custom layer**. MapLibre custom layers get a `projectTile` GLSL prelude that is globe-correct.

**Mapbox does not give you that.** A hand-built matrix on a Mapbox globe was ~30% too wide in our probe.

So this layer:

1. Advects on the CPU  
2. Places with **`map.project()`**  
3. Draws tadpoles on a fading canvas  

~400 sprites is cheap. Tens of thousands would not be — then prefer Mapbox `raster-particle` (raster-array) or a tile/render hook.

## Drop into a Mapbox app

### 1. Copy

```
js/wind-particles-cpu.js
js/wind-ui.js          # optional LIVE / forecast chrome (not used by demo.html)
```

### 2. Mapbox GL JS + your token

```html
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
```

```js
mapboxgl.accessToken = 'pk.YOUR_TOKEN'; // https://account.mapbox.com/access-tokens/
```

### 3. Globe map + wind

```js
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/outdoors-v12',
  center: [-119.7, 46.2],
  zoom: 3.6,
  projection: 'globe'
});

map.on('load', async () => {
  const { loadWindManifest, WindParticlesCPU } = await import('./js/wind-particles-cpu.js');

  const manifestUrl = './sample-data/gfs/manifest.json'; // or your own UV playlist

  await loadWindManifest(manifestUrl);
  await WindParticlesCPU.fromManifest(map, manifestUrl, {
    uRange: [-40, 40],
    vRange: [-40, 40]
  });

  // Optional forecast / LIVE chrome:
  // const { mountWindUI } = await import('./js/wind-ui.js');
  // mountWindUI(map, layer, manifest, { loadManifest: loadWindManifest });
});
```

## Run this repo

```bash
git clone https://github.com/GeoScobie/mapbox-wind-without-shaders.git
cd mapbox-wind-without-shaders
python3 -m http.server 8081
```

Open [http://localhost:8081/demo.html](http://localhost:8081/demo.html) → paste a Mapbox public token (or `?access_token=pk.…`).

- **See it live:** [firemap.live](https://firemap.live)  
- Token-free MapLibre check only: `demo-maplibre.html`

## Data

This repo ships **three sample GFS 0.25° UV PNGs** under `sample-data/gfs/` (plus `manifest.json`). The demo loads **only those local files**.

NOAA GFS 10 m U/V → equirectangular PNG (R=u, G=v, B=mask). Encoding in the sample manifest is ±50 m/s.

For your own app, generate or host your own UV playlist — **do not point clients at firemap.live** for wind tiles; that host is the product demo, not a public CDN.

## Prior art

[mapbox/webgl-wind](https://github.com/mapbox/webgl-wind) (Agafonkin) — GPU particles, flat map. Different trade.

## License

MIT — see `LICENSE`.
