// ---------------------------------------------------------------------------
// Wind tadpoles, CPU edition — runs on Mapbox globe.
//
// WHY THIS EXISTS. The WebGL version (wind-particles-tadpole.js) projects by
// injecting MapLibre's own `projectTile` GLSL prelude, which is what makes it
// globe-correct. Mapbox hands custom layers no equivalent: a probe triangle
// drawn through a plain matrix on a Mapbox globe came out ~30% too wide and
// displaced, with error growing away from the view centre.
//
// The way out is to stop projecting ourselves. `map.project()` IS globe-correct
// on Mapbox -- it is the same call Markers use, and in that probe it was the
// thing that correctly said where the triangle SHOULD have been. So this
// version simulates on the CPU and asks the map to project, which works on
// Mapbox globe, MapLibre globe, mercator, terrain and pitch from one code path.
//
// The trade is that simulation cost is now linear in particle count on the main
// thread. At the ~400 sprites this look settled on that is nothing (400
// project() calls is well under a millisecond). At 50k it would be hopeless --
// that is when Mapbox's renderToTile hook becomes worth the effort instead.
//
// Everything that makes the look work is projection-agnostic and carried over
// unchanged: the lifecycle (fade in, grow, fade out), the head-leading taper,
// per-particle speed jitter, wind-weighted respawn, and viewport-relative
// density.
//
// TWO BUGS ARE DELIBERATELY DESIGNED OUT HERE, both of which cost real time in
// the GL version -- see advect() and viewBounds().
// ---------------------------------------------------------------------------

const MAX_LAT = 85.051129;

// ---------------------------------------------------------------------------
// SCALE RULES
//
// Everything that must change with zoom is defined at TWO anchor zooms and
// interpolated geometrically between them. This replaces a scatter of separate
// exponents (speedZoomK, dropZoomK, a fixed count) that each had to be re-tuned
// independently and interacted in ways nobody could hold in their head.
//
// The two anchors are the two views that actually matter, and the numbers read
// as what they are -- "at city zoom, 180 tadpoles moving at 340x real time".
//
// Why each quantity moves the way it does:
//
//   count      Respawn is viewport-relative, so this is particles ON SCREEN at
//              any zoom. Zoomed out there is a whole hemisphere of weather to
//              describe and the field should read as dense flow; zoomed into a
//              city there is essentially one GFS cell in view, so a crowd of
//              sprites says nothing a handful would not.
//   screenSpeed  PIXELS PER SECOND for a 10 m/s wind -- NOT a simulation
//              multiplier. This distinction matters enormously and got it wrong
//              once already: pixels-per-metre rises by 2^z, so between z2 and
//              z11 the same simulation speed renders 512x faster. Cutting the
//              multiplier ~6x over that range left global at 1.3 px/s (a
//              twinkle) and city at 131 px/s (frantic) -- a 100x error in the
//              wrong direction. Specify what the eye judges and derive the
//              multiplier from zoom and latitude instead.
//
//              Note the two anchors are now nearly equal (22 vs 26 px/s), and
//              global is the SLOWER of the two. Equal px/s is not equal
//              perceived speed: zoomed right out the whole world spans only a
//              few hundred pixels, so a given px/s crosses the visible earth
//              far quicker than it crosses a city view. Global therefore needs
//              to sit slightly below city, not above it.
//   pointSize  Bigger when zoomed in: fewer sprites, each carrying more weight.
//              Smaller when zoomed out, where big heads with short trails read
//              as blobs rather than flow.
//   dropRate   LOWER when zoomed in, and this reverses an earlier guess. The
//   fadeOpacity  reasoning had been that a near-uniform field needs churn or
//   lifetime   long-lived particles trace identical rails. In practice the
//              opposite failure dominates: with a short life and a short trail
//              a city-zoom particle draws a 12 px streak behind an 11 px head,
//              which reads as a twinkle carrying no direction or speed at all.
//              Rails are held off by the per-particle speed jitter instead.
//
//              These three set STREAK LENGTH together, and it is worth being
//              able to compute it rather than tune blind:
//                  trail_px  = screenSpeed * ln(0.05)/ln(fadeOpacity) / fps
//                  life_s    = min(lifetime, 1/dropRate/fps)
//              A streak reads as a comet at roughly 4-6x the head size, and is
//              pointless below about 2x. life_s must exceed the trail duration
//              or trails are truncated no matter how high fadeOpacity goes --
//              which is exactly what dropRate 0.035 was doing.
//
// Interpolation is geometric (not linear) because these are all multiplicative
// quantities -- halving zoom should halve the count, not subtract a constant.
const SCALE_ANCHORS = {
  // Global was cut 22 -> 15 px/s: at this zoom one pixel is ~80 km, so a speed
  // that reads correctly over a city reads as a blur over an ocean basin.
  // fadeOpacity rises with it to hold trail length constant -- trail_px scales
  // as screenSpeed * ln(.05)/ln(fadeOpacity), so 15/0.945 gives the same ~13 px
  // comet as 22/0.920 did, and only the motion slows.
  global: { zoom: 2,  count: 1500, screenSpeed: 15, pointSize: 6.5,
            dropRate: 0.012, fadeOpacity: 0.945, lifetime: 2.5 },
  // Anchored at z13, not z11: at street scale the interpolation was clamping
  // well before the zooms actually in use, so everything past z11 got identical
  // treatment. Trails here are long on purpose -- at this scale the wind field
  // is uniform across the whole viewport, so a streak IS the only cue for
  // direction and speed. 86 px against an 11 px head (~8x) reads as streaming
  // rather than twinkling.
  city:   { zoom: 13, count: 180,  screenSpeed: 26, pointSize: 11.0,
            dropRate: 0.003, fadeOpacity: 0.985, lifetime: 6.0 }
};

// Wind speed the screenSpeed anchors are quoted for.
const REF_WIND = 10;

// Extra thinning applied BELOW the continental zooms, on top of the anchor
// interpolation. Cutting the global anchor itself would also thin z5-z8, which
// is the range that already looks right, so the reduction is confined to the
// wide views where the field reads as a solid mat rather than as lines.
const WIDE_THIN = { fullZoom: 5, wideZoom: 2, floor: 0.32 };
function wideThin(zoom) {
  const { fullZoom, wideZoom, floor } = WIDE_THIN;
  const t = Math.max(0, Math.min(1, (fullZoom - zoom) / (fullZoom - wideZoom)));
  return 1 - (1 - floor) * t;
}

/**
 * Simulation multiplier that renders a REF_WIND wind at `pxPerSec` on screen.
 *
 * A particle moving w m/s advances w*T/110540 degrees of latitude per second,
 * which is w*T/(110540*360*cos lat) of mercator y, which is that times the
 * world width in pixels (512 * 2^zoom) on screen. Invert for T.
 */
function timeScaleFor(pxPerSec, zoom, latDeg) {
  const cosLat = Math.max(Math.cos(latDeg * Math.PI / 180), 0.05);
  const worldPx = 512 * Math.pow(2, zoom);
  return pxPerSec * 110540 * 360 * cosLat / (REF_WIND * worldPx);
}

/** Geometric interpolation between the two anchors, clamped outside them. */
function scaleFor(zoom, anchors, latDeg = 0) {
  const g = anchors.global, c = anchors.city;
  const t = Math.max(0, Math.min(1, (zoom - g.zoom) / (c.zoom - g.zoom)));
  const mix = (a, b) => a * Math.pow(b / a, t);
  const pxPerSec = mix(g.screenSpeed, c.screenSpeed);
  return {
    count: Math.max(24, Math.round(mix(g.count, c.count) * wideThin(zoom))),
    screenSpeed: pxPerSec,
    speed: timeScaleFor(pxPerSec, zoom, latDeg),   // derived, never set directly
    pointSize: mix(g.pointSize, c.pointSize),
    dropRate: mix(g.dropRate, c.dropRate),
    fadeOpacity: mix(g.fadeOpacity, c.fadeOpacity),
    lifetime: mix(g.lifetime, c.lifetime)
  };
}

const toMercY = (lat) => {
  const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const mercYToLat = (y) =>
  (2 * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - Math.PI / 2) * 180 / Math.PI;

/** Soft radial sprite, drawn once and blitted per particle. */
function makeSprite(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Deliberately no hard core. A stop at alpha 1.0 gives each sprite a crisp
  // white centre that pops on arrival; starting lower and falling away sooner
  // reads as a glow rather than a dot.
  grad.addColorStop(0.0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/**
 * Load a wind manifest and resolve the frame nearest a given time.
 *
 * The manifest sits beside its own PNGs and `url` is relative to it, so a
 * sibling model (ecmwf/, icon/) drops in by changing one path.
 *
 * Two defensive details, both learned from the live file:
 *  - It is fetched as TEXT and the UTF-8 BOM stripped before parsing. The live
 *    manifest carries one, and JSON.parse rejects a leading U+FEFF outright.
 *  - `url` may or may not carry the .png extension. Both currently resolve, but
 *    only because Apache content negotiation fills it in -- and the
 *    extensionless response comes back with NO Content-Type. Append it when it
 *    is missing rather than depending on server behaviour that will not survive
 *    a move to nginx, a CDN, or object storage.
 */
export async function loadWindManifest(manifestUrl) {
  const res = await fetch(manifestUrl, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const raw = (await res.text()).replace(/^\uFEFF/, '');
  const m = JSON.parse(raw);

  const base = manifestUrl.replace(/[^/]*$/, '');
  const frames = (m.frames || [])
    .map((f) => ({
      ...f,
      t: Date.parse(f.valid),
      href: base + (/\.png$/i.test(f.url) ? f.url : f.url + '.png')
    }))
    .sort((a, b) => a.t - b.t);

  const e = m.encoding || {};
  return {
    raw: m,
    model: m.model,
    cycle: m.cycle,
    updated: m.updated,
    frames,
    encoding: {
      uRange: [e.u_min ?? -40, e.u_max ?? 40],
      vRange: [e.v_min ?? -40, e.v_max ?? 40],
      width: e.width,
      height: e.height,
      bounds: e.bounds,
      // "png-rg" advertises red+green only, but the live PNGs also carry a
      // constant blue 255. Treating blue as a validity mask therefore works for
      // both, so long as a genuinely absent channel is not read as no-data.
      hasMask: e.format !== 'png-rg'
    },
    /** Frame whose valid time is nearest `when`; honours `current` if set. */
    frameFor(when = Date.now()) {
      if (m.current) {
        const c = frames.find((f) => f.valid === m.current);
        if (c) return c;
      }
      let best = frames[0], gap = Infinity;
      for (const f of frames) {
        const d = Math.abs(f.t - when);
        if (d < gap) { gap = d; best = f; }
      }
      return best;
    }
  };
}

export class WindParticlesCPU {
  /**
   * @param {object} map    a Mapbox GL JS or MapLibre GL JS map
   * @param {object} opts   image, count, uRange/vRange, and the look options
   */
  constructor(map, opts = {}) {
    this.map = map;
    this.image = opts.image;
    this.uRange = opts.uRange || [-40, 40];
    this.vRange = opts.vRange || [-40, 40];
    // Set when constructed from a manifest; drives setValid()/setFrame().
    this.manifest = opts.manifest || null;
    this._hasMask = opts.hasMask !== false;

    // Scale rules live in one table now; count/speed/pointSize/dropRate are
    // DERIVED per frame from the current zoom. Override the table, not the
    // derived values.
    this.anchors = opts.anchors || {
      global: { ...SCALE_ANCHORS.global },
      city: { ...SCALE_ANCHORS.city }
    };
    this._scale = scaleFor(map.getZoom(), this.anchors, map.getCenter().lat);
    this.count = this._scale.count;
    this.pointSize = this._scale.pointSize;
    this.lifetime = opts.lifetime ?? 3.0;       // seconds, birth to fade-out
    this.shrink = opts.shrink ?? 0.60;          // how much narrower the tail is
    this.fadeOpacity = opts.fadeOpacity ?? 0.90;

    // Master transparency for the whole field. Everything else is multiplied
    // by this, so it is the one knob to reach for when the layer competes with
    // the basemap instead of sitting behind it.
    this.opacity = opts.opacity ?? 0.62;

    this.densityBias = opts.densityBias ?? 0.85;
    this.jitter = opts.jitter ?? 0.5;
    this.maxSpeed = opts.maxSpeed ?? 30;
    this.dropRate = this._scale.dropRate;
    this.minZoom = opts.minZoom ?? 0;
    this.maxZoom = opts.maxZoom ?? 22;

    this.colorLo = opts.colorLo || [217, 235, 255];
    this.colorHi = opts.colorHi || [255, 255, 255];

    this._sprite = makeSprite();
    this._particles = [];
    this._field = null;
    this._view = null;
    this._centre = null;
    this._globe = false;
    this._lastCam = '';
    this._raf = null;
    this._last = 0;

    this._mount();
    this._loadField().then(() => this._start());
  }

  // --- plumbing ------------------------------------------------------------

  _mount() {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    // Above the map canvas but below the map's own DOM controls/markers.
    this.map.getCanvasContainer().appendChild(cv);
    this.canvas = cv;
    this.ctx = cv.getContext('2d');
    this._resize();
    this._onResize = () => this._resize();
    this.map.on('resize', this._onResize);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = this.map.getCanvas();
    const w = c.clientWidth, h = c.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._dpr = dpr;
    this._w = w; this._h = h;
  }

  /**
   * Decode one frame into a u/v lookup.
   *
   * MEMORY. Every swap costs a decoded 1440x721 bitmap (~4 MB) plus a
   * getImageData array (~4 MB). Allocating a THIRD copy -- a fresh canvas
   * backing store -- on every swap took the churn to ~12 MB per frame, and
   * dragging the scrub track fires those back to back as fast as decodes
   * finish. On a phone that reliably crossed iOS Safari's per-tab ceiling and
   * the tab was killed, which reads to the user as a crash.
   *
   * So the scratch canvas is allocated once and reused: every frame in a run
   * has identical dimensions, so it only ever resizes if the grid changes. The
   * decoded image is released explicitly too -- dropping the last reference is
   * not enough to make a mobile browser hand the decode buffer back promptly.
   */
  async _loadField() {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    try {
      await new Promise((ok, bad) => {
        img.onload = ok;
        img.onerror = () => bad(new Error('cannot load ' + this.image));
        img.src = this.image;
      });

      const w = img.naturalWidth, h = img.naturalHeight;
      let c = this._scratch;
      if (!c) {
        c = this._scratch = document.createElement('canvas');
        this._scratchCtx = c.getContext('2d', { willReadFrequently: true });
      }
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = this._scratchCtx;
      // Reused canvas: clear it, or a smaller frame would leave stale pixels.
      g.clearRect(0, 0, w, h);
      g.drawImage(img, 0, 0);
      this._field = { data: g.getImageData(0, 0, w, h).data, w, h };
    } finally {
      img.onload = null; img.onerror = null;
      img.src = '';
    }
  }

  // --- wind field ----------------------------------------------------------

  /**
   * Bilinear sample of u/v at a mercator position.
   *
   * Indices are TEXEL-CENTRED: values sit at cell centres (row 0 is lat +90,
   * column 0 is lon -180), so the naive (90-lat)/180 * h is off by half a cell
   * -- about 14 km. Invisible in uniform flow, but along a coastline or a front
   * it blends the neighbouring cell and the direction visibly rotates, which
   * shows up as isolated patches of wrong-looking wind.
   */
  _sample(mx, my) {
    const f = this._field;
    if (!f) return null;
    const lat = mercYToLat(my);
    const fx = mx * f.w;
    const fy = ((90 - lat) / 180) * (f.h - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (xi, yi) => {
      const c = ((xi % f.w) + f.w) % f.w;             // longitude wraps
      const r = Math.min(f.h - 1, Math.max(0, yi));   // latitude clamps
      const o = (r * f.w + c) * 4;
      // Only treat blue as a mask when the encoding actually has one; a
      // format that writes R/G only would otherwise be read as entirely
      // no-data and the whole field would silently vanish.
      if (this._hasMask && f.data[o + 2] < 128) return null;
      return [
        (f.data[o] / 255) * (this.uRange[1] - this.uRange[0]) + this.uRange[0],
        (f.data[o + 1] / 255) * (this.vRange[1] - this.vRange[0]) + this.vRange[0]
      ];
    };
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    if (!a || !b || !c || !d) return null;
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  // --- viewport ------------------------------------------------------------

  /**
   * Visible extent as a mercator bbox.
   *
   * NOT map.getBounds(). Under a globe projection that returns a far smaller
   * box than what is on screen -- measured returning 1.4 degrees while the view
   * spanned all of western Europe. Respawning into that sliver leaves most of
   * the map empty and looks like a density bug that no amount of count tuning
   * fixes. Unprojecting a grid of screen points is projection-agnostic and
   * correct on globe, mercator, pitched and terrain views alike.
   */
  /**
   * Cache the view centre and whether a globe is actually in play.
   *
   * Both feed _limbKeep. getProjection() reports 'globe' on Mapbox and
   * {type:'globe'} on MapLibre; anything else -- or a library too old to have
   * the method -- means no limb, and the cull disables itself.
   */
  _syncCentre() {
    const c = this.map.getCenter();
    const rad = c.lat * Math.PI / 180;
    this._centre = { lng: c.lng, sin: Math.sin(rad), cos: Math.cos(rad) };
    let name = null;
    try {
      const pr = this.map.getProjection && this.map.getProjection();
      name = pr && (pr.name || pr.type);
    } catch (e) { name = null; }
    this._globe = name === 'globe';
  }

  _viewBounds() {
    this._syncCentre();
    const N = 5, map = this.map, centre = map.getCenter();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, seen = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        let ll;
        try { ll = map.unproject([(i / N) * this._w, (j / N) * this._h]); } catch (e) { continue; }
        if (!ll || !isFinite(ll.lng) || !isFinite(ll.lat) || Math.abs(ll.lat) > MAX_LAT) continue;
        let dLng = ll.lng - centre.lng;
        while (dLng > 180) dLng -= 360;
        while (dLng < -180) dLng += 360;
        if (Math.abs(dLng) > 170) continue;   // past the limb on a globe
        const mx = (centre.lng + dLng + 180) / 360, my = toMercY(ll.lat);
        x0 = Math.min(x0, mx); x1 = Math.max(x1, mx);
        y0 = Math.min(y0, my); y1 = Math.max(y1, my);
        seen++;
      }
    }
    if (seen < 4 || !isFinite(x0)) return [0, 0, 1, 1];
    const pad = 0.08, dx = (x1 - x0) * pad, dy = (y1 - y0) * pad;
    return [x0 - dx, y0 - dy, x1 + dx, y1 + dy];
  }

  // --- particles -----------------------------------------------------------

  /**
   * Fraction of a seed's density to keep at a given position, 0..1.
   *
   * On a globe the surface turns away from the camera towards the limb, so a
   * distribution that is even on the sphere piles up into a dense rim at the
   * horizon -- and when the view is centred at mid-latitude the north pole sits
   * in exactly that rim, which is why it mats over first. Orthographic
   * foreshortening goes as cos(gamma), the great-circle angle from the view
   * centre, so thinning by cos(gamma) restores an even SCREEN density.
   *
   * Computed from spherical trig rather than by projecting: it costs no
   * map.project() call, and it is only meaningful under a globe -- on mercator
   * there is no limb, and this correctly returns 1 everywhere.
   */
  _limbKeep(mx, my) {
    const c = this._centre;
    if (!c) return 1;
    const lat = mercYToLat(my) * Math.PI / 180;
    let dLng = (mx * 360 - 180) - c.lng;
    while (dLng > 180) dLng -= 360;
    while (dLng < -180) dLng += 360;
    const cosGamma = c.sin * Math.sin(lat) +
                     c.cos * Math.cos(lat) * Math.cos(dLng * Math.PI / 180);
    // Full density inside cos 0.55 (~57 deg out); nothing past cos 0.12 (~83 deg).
    return Math.max(0, Math.min(1, (cosGamma - 0.12) / (0.55 - 0.12)));
  }

  /** Respawn, biased toward the windiest of three candidate positions. */
  _spawn(p) {
    const v = this._view;
    const pick = () => [
      v[0] + Math.random() * (v[2] - v[0]),
      v[1] + Math.random() * (v[3] - v[1])
    ];
    const globe = this._globe;
    // Rejection sampling. A few tries is enough away from the limb; when the
    // view really is mostly horizon the last candidate is spawned already dead
    // so it retries next frame rather than spinning here.
    let best = pick(), dead = false;
    if (globe) {
      let tries = 0;
      while (Math.random() >= this._limbKeep(best[0], best[1])) {
        if (++tries >= 6) { dead = true; break; }
        best = pick();
      }
    }
    if (!dead && Math.random() < this.densityBias) {
      let bestS = -1;
      for (let i = 0; i < 3; i++) {
        const c = i === 0 ? best : pick();
        if (globe && Math.random() >= this._limbKeep(c[0], c[1])) continue;
        const w = this._sample(c[0], c[1]);
        const s = w ? Math.hypot(w[0], w[1]) : -1;
        if (s > bestS) { bestS = s; best = c; }
      }
    }
    p.x = best[0]; p.y = best[1];
    if (dead) { p.age = 1; p.k = 1; return; }
    p.age = Math.random() * 0.35;                       // stagger rebirths
    p.k = 1 + (Math.random() - 0.5) * 2 * this.jitter;  // lifelong speed offset
  }

  /**
   * One simulation step.
   *
   * Position is advanced INCREMENTALLY in mercator, using the analytic
   * derivative dy/dlat = -1/(360*cos lat). The obvious alternative -- convert y
   * to latitude, add dLat, convert back -- is numerically fatal: that round trip
   * carries a systematic error larger than a single frame's motion, so
   * particles drift steadily in whichever direction the error biases. In the GL
   * version that produced tadpoles marching south through a northward wind
   * while the sampled wind, the latitude delta and the projection were each
   * provably correct in isolation.
   */
  _advect(dt) {
    const speed = this._scale.speed;
    const drop = Math.min(0.25, this._scale.dropRate);
    const v = this._view;
    const ageStep = dt / Math.max(0.1, this._scale.lifetime);

    for (const p of this._particles) {
      const w = this._sample(p.x, p.y);
      if (!w) { this._spawn(p); continue; }

      const lat = mercYToLat(p.y);
      const cosLat = Math.max(Math.cos(lat * Math.PI / 180), 0.01);
      const dLon = (w[0] * p.k * dt * speed) / (111320 * cosLat);
      const dLat = (w[1] * p.k * dt * speed) / 110540;

      p.x += dLon / 360;
      p.y -= dLat / (360 * cosLat);
      p.x = p.x - Math.floor(p.x);                  // wrap the antimeridian
      p.age += ageStep;
      p.speed = Math.hypot(w[0], w[1]);

      // The view box may straddle the date line, in which case v[0] > 1 or
      // v[0] < 0. Shift the particle into the same frame before comparing, or
      // everything near the seam is judged offscreen and instantly recycled.
      let px = p.x;
      while (px < v[0]) px += 1;
      while (px > v[0] + 1) px -= 1;
      const off = px > v[2] || p.y < v[1] || p.y > v[3];
      if (p.age >= 1 || off || Math.random() < drop) this._spawn(p);
    }
  }

  // --- rendering -----------------------------------------------------------

  _draw() {
    const ctx = this.ctx, dpr = this._dpr;
    // Fade what is already there rather than clearing: this is the trail.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${1 - this._scale.fadeOpacity})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    const [r0, g0, b0] = this.colorLo, [r1, g1, b1] = this.colorHi;
    const sprite = this._sprite;
    const centreLng = this.map.getCenter().lng;

    for (const p of this._particles) {
      const age = Math.min(1, Math.max(0, p.age));
      // Fade in over the first fifth of the run and out over the last half,
      // both eased with smoothstep rather than a straight ramp. A linear fade
      // over 10% of life is short enough that sprites still visibly POP into
      // existence -- the eye catches the arrival, not the motion. Easing over a
      // longer window makes them bloom instead.
      const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
      const envelope = smooth(age / 0.20) * (1 - smooth((age - 0.50) / 0.50));
      if (envelope <= 0.01) continue;

      // ANTIMERIDIAN. Particle x lives in [0,1), so a particle just west of
      // 180 and one just east of it are at opposite ends of that range and
      // project into DIFFERENT world copies -- the field appears to stop dead
      // at the date line. Shift each particle into the copy nearest the view
      // centre before projecting, so the seam is continuous.
      let lng = p.x * 360 - 180;
      let d = lng - centreLng;
      while (d > 180) { lng -= 360; d -= 360; }
      while (d < -180) { lng += 360; d += 360; }
      const lat = mercYToLat(p.y);
      let s;
      try { s = this.map.project([lng, lat]); } catch (e) { continue; }
      if (!s || !isFinite(s.x) || !isFinite(s.y)) continue;
      if (s.x < -50 || s.y < -50 || s.x > this._w + 50 || s.y > this._h + 50) continue;

      // GROWING with age, so the widest mark is the newest one at the leading
      // edge and the trail tapers backwards. Shrinking with age puts the fat end
      // at the BACK and the whole thing reads as swimming backwards.
      const size = this._scale.pointSize * (1 - this.shrink * (1 - age)) * dpr;
      const t = Math.min(1, (p.speed || 0) / this.maxSpeed);
      const cr = Math.round(r0 + (r1 - r0) * t);
      const cg = Math.round(g0 + (g1 - g0) * t);
      const cb = Math.round(b0 + (b1 - b0) * t);

      // Master opacity, then a speed term: calm air stays a faint wash and only
      // genuinely windy air approaches full strength.
      ctx.globalAlpha = this.opacity * envelope * (0.30 + 0.55 * t);
      // Tint by drawing the white sprite then multiplying colour through it.
      ctx.drawImage(sprite, s.x * dpr - size / 2, s.y * dpr - size / 2, size, size);
      if (cr !== 255 || cg !== 255 || cb !== 255) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = this.opacity * envelope * 0.5;
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(s.x * dpr - size / 2, s.y * dpr - size / 2, size, size);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- loop ----------------------------------------------------------------

  _start() {
    this._view = this._viewBounds();
    this._scale = scaleFor(this.map.getZoom(), this.anchors, this.map.getCenter().lat);
    this._particles = Array.from({ length: this._scale.count }, () => {
      const p = { x: 0, y: 0, age: 0, k: 1, speed: 0 };
      this._spawn(p);
      return p;
    });

    const frame = (now) => {
      this._raf = requestAnimationFrame(frame);
      const dt = this._last ? Math.min((now - this._last) / 1000, 0.1) : 0.016;
      this._last = now;

      const z = this.map.getZoom();
      if (z < this.minZoom || z > this.maxZoom) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        return;
      }

      const prev = this._view;
      this._view = this._viewBounds();

      // Re-derive the scale rules for this zoom, then grow or shrink the
      // population toward the target. Resizing is gradual (a fraction per
      // frame) so a zoom gesture does not visibly dump or spawn a crowd in one
      // step -- except on a big view change, where everything is respawned
      // anyway and the jump is hidden.
      this._scale = scaleFor(z, this.anchors, this.map.getCenter().lat);
      const target = this._scale.count;
      const have = this._particles.length;
      if (have !== target) {
        const step = Math.max(1, Math.ceil(Math.abs(target - have) * 0.12));
        if (have < target) {
          for (let i = 0; i < Math.min(step, target - have); i++) {
            const p = { x: 0, y: 0, age: 0, k: 1, speed: 0 };
            this._spawn(p);
            this._particles.push(p);
          }
        } else {
          this._particles.length = Math.max(target, have - step);
        }
      }

      // Camera moved: screen-space trails no longer correspond to ground
      // positions, so clear them.
      const c = this.map.getCenter();
      const cam = [c.lng.toFixed(5), c.lat.toFixed(5), z.toFixed(3),
                   this.map.getBearing().toFixed(2), this.map.getPitch().toFixed(2)].join(',');
      if (cam !== this._lastCam) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this._lastCam = cam;
      }

      // Big view change: everything is still bunched inside the OLD box, and
      // the offscreen test will not recycle it because it is technically still
      // in view. Redistribute immediately or a visible knot of sprites lingers.
      if (prev) {
        const pw = prev[2] - prev[0], ph = prev[3] - prev[1];
        const nw = this._view[2] - this._view[0], nh = this._view[3] - this._view[1];
        const grew = Math.max(nw / pw, pw / nw, nh / ph, ph / nh);
        const movedOff = this._view[0] > prev[2] || this._view[2] < prev[0] ||
                         this._view[1] > prev[3] || this._view[3] < prev[1];
        if (grew > 1.6 || movedOff) {
          this._particles.length = this._scale.count;
          for (let i = 0; i < this._particles.length; i++) {
            if (!this._particles[i]) this._particles[i] = { x: 0, y: 0, age: 0, k: 1, speed: 0 };
            this._spawn(this._particles[i]);
          }
        }
      }

      this._advect(dt);
      this._draw();
    };
    this._raf = requestAnimationFrame(frame);
  }

  /** Live tuning; `count` is the only one that rebuilds the population. */
  tune(opts = {}) {
    for (const k of ['shrink', 'opacity', 'densityBias', 'jitter',
                     'maxSpeed', 'colorLo', 'colorHi', 'minZoom', 'maxZoom']) {
      if (k in opts) this[k] = opts[k];
    }
    // Scale-dependent values are derived, so they are tuned through the anchor
    // table rather than set directly:
    //   tune({ anchors: { city: { count: 120, speed: 260 } } })
    if (opts.anchors) {
      for (const end of ['global', 'city']) {
        if (opts.anchors[end]) Object.assign(this.anchors[end], opts.anchors[end]);
      }
      this._scale = scaleFor(this.map.getZoom(), this.anchors, this.map.getCenter().lat);
    }
    return this;
  }

  /** Swap to a different frame (the time slider). Keeps particles alive. */
  async setFrameUrl(url) {
    this.image = url;
    await this._loadField();
    return this;
  }

  /** Swap to whichever frame is valid nearest `when`. Needs a manifest. */
  async setValid(when = Date.now()) {
    if (!this.manifest) throw new Error('no manifest; construct with fromManifest()');
    const f = this.manifest.frameFor(when instanceof Date ? +when : when);
    if (f.href !== this.image) await this.setFrameUrl(f.href);
    return f;
  }

  /**
   * Build from a manifest, taking the velocity range and mask convention from
   * the file rather than hardcoding them.
   */
  static async fromManifest(map, manifestUrl, opts = {}) {
    const man = await loadWindManifest(manifestUrl);
    const frame = man.frameFor(opts.when ?? Date.now());
    // Manifest-derived values are DEFAULTS; explicit opts win. Spreading opts
    // first instead silently discarded any caller override of uRange/vRange --
    // which matters because a manifest can and does ship wrong encoding bounds,
    // and the override is the only way to correct speeds without a redeploy.
    // Keep the URL: the UI re-reads it to stay current on a long-lived tab.
    const inst = new WindParticlesCPU(map, {
      manifest: man,
      image: frame.href,
      uRange: man.encoding.uRange,
      vRange: man.encoding.vRange,
      hasMask: man.encoding.hasMask,
      ...opts
    });
    inst.manifestUrl = manifestUrl;
    return inst;
  }

  remove() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.map.off('resize', this._onResize);
    this.canvas.remove();
    // Collapse the scratch canvas rather than just dropping the reference:
    // a 1440x721 backing store can outlive the object otherwise.
    if (this._scratch) { this._scratch.width = this._scratch.height = 0; }
    this._scratch = this._scratchCtx = this._field = null;
  }
}
