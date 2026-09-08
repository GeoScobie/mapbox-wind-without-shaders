# sample-data/gfs

Optional local UV wind frames for `demo.html` when served from localhost.

## Expected layout (TBD)

Add **2–4** encoded UV PNG frames plus a small `manifest.json` (same shape as production). Do **not** commit a full GFS archive.

```
sample-data/gfs/
  README.md          # this file
  manifest.json      # TBD
  *.png              # TBD — a few frames only
```

## Production

Live product frames (hourly ETL):  
`https://firemap.live/data/wind/gfs/`  
(`manifest.json` + PNG frames; CORS required for canvas `getImageData`).

Until local sample frames exist, run the demo against that production base (non-localhost host) or drop a minimal manifest + PNGs here.
