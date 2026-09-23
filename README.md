# Mapbox Wind Without Shaders

For years I wondered why my favorite wind styling wasn’t available on Mapbox WebGL — especially on **[Mapbox Globe](https://docs.mapbox.com/mapbox-gl-js/guides/globe/)**. So I built it.

The look is **tadpoles**: short living heads with fading trails that read as direction and speed without turning the map into a comet blur. (Same family of motion as streamlets or flow ticks, if “tadpoles” feels too cute.)

Under the hood it’s deliberately **not** a custom WebGL shader layer. Particles advect on the CPU, place with **`map.project()`** (the same path Markers use), and draw on a fading canvas so they stay globe-correct on **[Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/)**.

**Live on [firemap.live](https://firemap.live)** — turn on wind in the map UI.  
By [Rob Scobie](https://github.com/GeoScobie) ([GeoScobie](https://github.com/GeoScobie)).

## How it works

Particle wind is usually a WebGL custom layer. That path is awkward on Mapbox Globe when you only have plain UV PNGs and want particles that sit correctly on the sphere.

So this layer:

1. Advects on the CPU  
2. Places with **`map.project()`**  
3. Draws tadpoles on a fading canvas  

A few hundred sprites is cheap. Tens of thousands would not be — then prefer Mapbox [`raster-particle`](https://docs.mapbox.com/mapbox-gl-js/example/raster-particle-layer/) (raster-array) if that pipeline fits you.

| Mapbox piece | Role here |
|--------------|-----------|
| **Mapbox GL JS** | Host map (`mapboxgl.Map`) |
| **Mapbox Globe** | Why this path exists |
| **Mapbox styles** (`outdoors-v12`, Standard, …) | Basemap; any style works |
| **`map.project()`** | Globe-correct particle placement |
| **Mapbox Access Tokens** | You bring your own `pk.` — none are shipped |

Optional: same JS also runs on MapLibre. **Mapbox is the intended target.**

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
});
```

## Run this repo

```bash
git clone https://github.com/GeoScobie/mapbox-wind-without-shaders.git
cd mapbox-wind-without-shaders
python3 -m http.server 8081
```

Open [http://localhost:8081/demo.html](http://localhost:8081/demo.html) → paste a Mapbox public token (or `?access_token=pk.…`).

Token-free MapLibre check only: `demo-maplibre.html`

## Data

This repo ships **three sample GFS 0.25° UV PNGs** under `sample-data/gfs/` (plus `manifest.json`). The demo loads **only those local files**.

NOAA GFS 10 m U/V → equirectangular PNG (R=u, G=v, B=mask). Encoding in the sample manifest is ±50 m/s.

For your own app, generate or host your own UV playlist.

## License

MIT — see `LICENSE`.
