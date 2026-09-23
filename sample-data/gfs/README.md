# sample-data/gfs

Three sample GFS 0.25° UV wind PNGs (10 m U/V) for the local demo.

- `manifest.json` — playlist (relative frame ids)
- `20260923T12Z.png` / `T15Z` / `T18Z` — equirectangular R=u, G=v (±50 m/s encode)

**The demo only loads these local files.** Bring your own UV PNGs + manifest for other hours; do not point the demo at firemap.live (or any third-party CDN) unless you operate that host.

Source model: NOAA GFS (cycle 2026-09-23 00Z). Frames are static samples for OSS, not a live feed.
