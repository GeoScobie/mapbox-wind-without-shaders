# Wind on a Mapbox globe — without custom shaders

Drop-in CPU wind particles for **Mapbox GL JS**, including **globe** projection.

Built for [firemap.live](https://firemap.live) by [Rob Scobie](https://github.com/GeoScobie). This repo is a personal sandbox of the production technique — not the FireMap app.

## Why Mapbox-specific

Particle wind is usually a WebGL custom layer. On MapLibre, custom layers get a `projectTile` GLSL prelude that is globe-correct.

**Mapbox does not give you that.** A hand-built matrix on a Mapbox globe was ~30% too wide in our probe. Markers still project correctly, because they use `map.project()`.

So this layer:

1. Advects particles on the CPU  
2. Places them with **`map.project()`**  
3. Draws tadpoles on a fading canvas  

That is the Mapbox-globe fix. Same module also runs on MapLibre, but **Mapbox is the intended host.**

~400 sprites is cheap. Tens of thousands would not be — then look at Mapbox `renderWorldCopies` / tile hooks or `raster-particle` on their raster-array path.

## Use it in your Mapbox app

### 1. Copy the JS

```
js/wind-particles-cpu.js
js/wind-ui.js          # optional LIVE / forecast chrome
```

### 2. Add Mapbox GL JS (you bring the token)

```html
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
```

```js
mapboxgl.accessToken = 'pk.YOUR_TOKEN'; // from https://account.mapbox.com/
```

No token is shipped in this repo.

### 3. Create a globe map and mount wind

```js
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/dark-v11',
  center: [-119.7, 46.2],
  zoom: 3.6,
  projection: 'globe'
});

map.on('load', async () => {
  const { loadWindManifest, WindParticlesCPU } = await import('./js/wind-particles-cpu.js');
  const { mountWindUI } = await import('./js/wind-ui.js'); // optional

  const manifestUrl = 'https://firemap.live/data/wind/gfs/manifest.json';
  // Or your own UV PNG playlist — see "Data" below.

  const manifest = await loadWindManifest(manifestUrl);
  const layer = await WindParticlesCPU.fromManifest(map, manifestUrl, {
    uRange: [-40, 40],
    vRange: [-40, 40]
  });

  mountWindUI(map, layer, manifest, { loadManifest: loadWindManifest });
});
```

That is the whole integration: any `mapboxgl.Map` (globe or mercator).

## Run this repo’s demo

```bash
git clone https://github.com/GeoScobie/wind-without-shaders.git
cd wind-without-shaders
python3 -m http.server 8080
```

Open [http://localhost:8080/demo.html](http://localhost:8080/demo.html), paste a Mapbox **public** token (or use `?access_token=pk.…`). Token is stored in `localStorage` on that browser only.

Optional token-free MapLibre boot: `demo-maplibre.html` (compat check only).

## Data (UV PNGs)

NOAA GFS 0.25° 10 m U/V → one equirectangular PNG per forecast hour:

| Channel | Meaning |
|--------|---------|
| R | u (east), 0–255 → ±40 m/s |
| G | v (north), 0–255 → ±40 m/s |
| B | valid mask (255 = data) |

`manifest.json` lists frames. Live example playlist: `https://firemap.live/data/wind/gfs/`. Put a few frames under `sample-data/gfs/` for fully offline demos.

## Not a replacement for `raster-particle`

Mapbox [`raster-particle`](https://docs.mapbox.com/mapbox-gl-js/example/raster-particle-layer/) is the right tool on their raster-array / MRT pipeline. This project is for **your own UV PNGs** on a Mapbox **globe**, when you need `map.project()` instead of a custom-layer matrix.

Prior art: [mapbox/webgl-wind](https://github.com/mapbox/webgl-wind) (Agafonkin) — GPU, flat map.

## Bugs we hit on Mapbox globe

Documented in `js/wind-particles-cpu.js`:

1. Mercator↔lat float error → stay in Mercator when advecting  
2. `getBounds()` under globe → unproject a screen grid  
3. Limb overdraw → thin spawns by foreshortening  

## License

MIT — see `LICENSE`.
