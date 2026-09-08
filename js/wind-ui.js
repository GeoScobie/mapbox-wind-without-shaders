// ---------------------------------------------------------------------------
// Wind layer UI — button dot, bottom day tab, expandable controls.
//
// SHAPE. A tab sits at the bottom of the map whenever wind is on, the way Windy
// does it. Collapsed it shows live state, the valid time, and the day blocks --
// so the length of the outlook is visible, and any day is one tap away, without
// opening anything. Expanding adds playback, Now, hour ticks and the run label.
//
// The day track is therefore built ONCE and lives outside the collapsible body.
// Two tracks (a mini one and a real one) would mean two sets of geometry and
// two playheads to keep in sync, for no gain.
//
// Earlier attempts are kept alongside: .barversion is a permanent bottom bar,
// .popversion hangs off the toolbar button, .tabv1 is this tab with the track
// still hidden inside the body.
//
// The track is laid out by TIME and driven by the manifest, so a longer run or
// a mixed-cadence one (hourly then 3-hourly) needs no change here, and every
// label states what the run actually holds rather than what was hoped for.
// ---------------------------------------------------------------------------

// No import of the sibling module. A static `import ... from
// './wind-particles-cpu.js'` here loaded a SECOND, unversioned copy alongside
// the versioned one the bootstrap imports -- two module instances, with the
// refresh path using whichever stale copy the browser had cached. The loader is
// passed in through opts.loadManifest instead.

const OUTLOOK_HOURS = 120;
// How often to re-read the manifest. GFS publishes a new cycle every 6h and the
// ETL appends hourly, so 10 minutes is far more often than strictly needed --
// but it is cheap (a few KB) and it bounds how stale a long-lived tab can get.
const REFRESH_MS = 10 * 60e3;

const LS = { on: 'fm.wind.on', expanded: 'fm.wind.expanded', hint: 'fm.wind.hintSeen' };
const readLS = (k, d) => {
  // Private mode and blocked storage both throw; a remembered preference is
  // never worth taking the layer down for.
  try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; }
  catch (e) { return d; }
};
const writeLS = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} };

const CSS = `
.wind-ui, .wind-ui * { box-sizing: border-box; font-family: system-ui, sans-serif; }

/* Live dot to the LEFT of the wind glyph, so the toolbar reads
   "[status] [what]" rather than hanging a badge off the corner. The offset is
   negative because a 40px button centred in the 60px rail leaves a 10px gutter,
   and anything >= 0 sits on top of the 24px glyph instead of beside it. */
.wind-dot {
  position: absolute; left: -9px; top: 50%; transform: translateY(-50%);
  width: 7px; height: 7px; border-radius: 50%;
  background: #34d17c; box-shadow: 0 0 6px rgba(52,209,124,.9);
  animation: windPulse 2.4s ease-in-out infinite; pointer-events: none;
}
.wind-dot.forecast { background: #f0b352; box-shadow: none; animation: none; }
@keyframes windPulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

/* Live, this is a small nub parked at the right edge; hitting it expands the
   forecast leftward into the full day bar. Anchoring RIGHT rather than centre
   is what makes that work -- the bottom-right edge stays pinned, so the bar
   opens away from the map controls instead of over them, and the nub you just
   pressed does not move out from under your finger.
   --wind-right clears whatever Mapbox has in that corner; it is measured, not
   assumed, because the control stack differs between the two maps. */
.wind-tab {
  position: absolute; left: auto; transform: none;
  right: var(--wind-right, 12px); bottom: 22px;
  z-index: 3; display: none; user-select: none;
  /* Width is deliberately NOT transitioned. Its value depends on
     --wind-right, which JS rewrites on resize; every rewrite restarted the
     animation, and under repeated resize events the tab latched at its 120px
     start value while carrying the .open class -- an expanded bar stuck at nub
     width. Animating width also forces a layout per frame over a WebGL map. */
  width: 120px;
  padding: 8px 11px 9px;
  background: rgba(18,20,24,.90); border: 1px solid rgba(255,255,255,.10);
  border-radius: 11px; color: #e6ebf1; backdrop-filter: blur(8px);
  box-shadow: 0 6px 22px rgba(0,0,0,.42);
}
.wind-tab.on { display: block; }
/* "Forecast" is a longer word than "Live"; widening only in that state keeps
   the resting nub tight and still lets the width animate. */
.wind-tab:not(.open).scrubbed { width: 158px; }
.wind-tab.open { width: min(430px, calc(100vw - var(--wind-right, 12px) - 12px)); }
/* Extra width is a desktop affordance, gated on there being room for it. */
@media (min-width: 900px) {
  .wind-tab.open { width: min(680px, calc(100vw - var(--wind-right, 12px) - 12px)); }
}

/* Collapsed, everything except the status pill and its chevron is folded away.
   The nub is a status light you can press, not a strip of information. */
.wind-tab:not(.open) .wind-when,
.wind-tab:not(.open) .wind-track,
.wind-tab:not(.open) .wind-body,
.wind-tab:not(.open) .wind-offer-text { display: none; }
.wind-tab:not(.open) .wind-row { margin-bottom: 0; }
.wind-tab:not(.open) .wind-offer {
  margin-left: auto; padding: 3px 5px; background: none; border-color: transparent;
}

.wind-row {
  display: flex; align-items: center; gap: 9px;
  margin-bottom: 7px; cursor: pointer; white-space: nowrap;
}
.wind-pill {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
  font-size: 9.5px; font-weight: 700; letter-spacing: .9px; text-transform: uppercase;
  padding: 3px 7px; border-radius: 4px;
  color: #34d17c; background: rgba(52,209,124,.12); border: 1px solid rgba(52,209,124,.35);
}
.wind-pill svg { width: 13px; height: 13px; flex: 0 0 auto; }
.wind-pill b { width: 6px; height: 6px; border-radius: 50%; background: #34d17c;
  box-shadow: 0 0 6px rgba(52,209,124,.9); animation: windPulse 2.4s ease-in-out infinite; }
.wind-pill.forecast { color: #f0b352; background: rgba(240,179,82,.10); border-color: rgba(240,179,82,.35); }
.wind-pill.forecast b { background: #f0b352; box-shadow: none; animation: none; }

/* Time is context, not the headline: small, muted, and pushed to the right so
   the forecast chip is what the eye lands on. Local sits over UTC rather than
   beside it -- on a 318px phone bar the single line "Tue 08:00 AM HST
   (Wed 06:00 UTC)" overruns the space the pill and chip leave and ellipsises
   away the very thing it is there to disambiguate. */
.wind-when {
  margin-left: auto; overflow: hidden;
  display: flex; flex-direction: column; align-items: flex-end; gap: 1px;
  font-family: 'Lexend', system-ui, sans-serif;
  font-variant-numeric: tabular-nums; line-height: 1.25;
}
.wind-local { font-size: 11px; font-weight: 500; color: #97a3af; white-space: nowrap; }
.wind-local i { font-style: normal; color: #6e7a86; font-weight: 400; margin-left: 4px; }
.wind-utc { font-size: 9.5px; font-weight: 400; color: #6b7681; white-space: nowrap; }

/* The forecast is the offer, so it is drawn as a chip rather than as a link. */
.wind-offer {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
  padding: 4px 9px; border-radius: 6px;
  font-size: 11.5px; font-weight: 700; letter-spacing: .3px; color: #7fd4ff;
  background: rgba(127,212,255,.13); border: 1px solid rgba(127,212,255,.40);
}
.wind-offer svg { transition: transform .16s ease; }
.wind-tab.open .wind-offer svg { transform: rotate(180deg); }
.wind-row:hover .wind-offer { color: #bfe9ff; background: rgba(127,212,255,.20); }
/* Open, the chip leaves the head row entirely and becomes a handle on the top
   edge. It was costing ~70px of the one row that has to fit the time, the zone
   and UTC -- and once the bar is open, closing it is a secondary action that
   does not deserve inline space. */
.wind-tab.open .wind-offer { display: none; }
.wind-handle {
  position: absolute; top: -16px; right: 14px; display: none;
  align-items: center; justify-content: center; gap: 4px;
  height: 17px; padding: 0 9px; cursor: pointer;
  font-size: 9px; font-weight: 700; letter-spacing: .7px; text-transform: uppercase;
  color: #97a3af; background: rgba(18,20,24,.92);
  border: 1px solid rgba(255,255,255,.10); border-bottom: none;
  border-radius: 8px 8px 0 0;
}
.wind-tab.open .wind-handle { display: flex; }
.wind-handle:hover { color: #dce7f0; background: rgba(30,34,40,.95); }
.wind-handle svg { transform: rotate(180deg); }

/* Day blocks -- always visible, collapsed or open. Widths are proportional to
   each day's DURATION, not its frame count. GFS is hourly only to f120 and most
   runs drop to 3-hourly after f048, so counting frames would draw a 3-hourly
   day a third as wide as an hourly one despite both being 24 hours. Everything
   below -- fill, ticks, hit-testing -- is likewise keyed on time. */
.wind-track { display: flex; gap: 5px; height: 30px; cursor: pointer; touch-action: none; }
.wind-tab.open .wind-track { height: 36px; }
.wind-day { position: relative; border-radius: 6px; overflow: hidden; min-width: 0;
  background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.07); }
.wind-day.now { border-color: rgba(127,212,255,.30); }
.wind-day-fill { position: absolute; inset: 0; width: 0;
  background: linear-gradient(90deg, rgba(127,212,255,.30), rgba(127,212,255,.16));
  border-right: 1px solid rgba(127,212,255,.75);
  pointer-events: none; transition: width .06s linear; }
.wind-day-label { position: absolute; left: 7px; top: 50%; transform: translateY(-50%);
  font-size: 10px; letter-spacing: .5px; text-transform: uppercase; white-space: nowrap;
  color: #93a1b0; pointer-events: none; }
.wind-day.now .wind-day-label { color: #cfe6f5; }
/* A part day at either end of the run can be only a few pixels wide. Better to
   show no label than a clipped one -- the fill still reads as a timeline. */
.wind-day.tiny .wind-day-label { display: none; }
/* Long labels ("Tue, Sep 1") only where the tab actually widens -- at 430px a
   5-day run gives each block ~80px, which fits "Tue" and not the date. */
.wind-day-label .lg { display: none; }
@media (min-width: 900px) {
  .wind-tab.open .wind-day-label .sm { display: none; }
  .wind-tab.open .wind-day-label .lg { display: inline; }
}

.wind-hours { position: absolute; inset: 0; display: none; pointer-events: none; }
.wind-tab.open .wind-hours { display: block; }
.wind-hours i { position: absolute; bottom: 3px; height: 5px;
  border-left: 1px solid rgba(255,255,255,.13); }
.wind-hours i.six { height: 9px; border-left-color: rgba(255,255,255,.26); }

.wind-body { display: none; align-items: center; gap: 8px; padding-top: 8px; }
.wind-tab.open .wind-body { display: flex; }
.wind-play {
  width: 28px; height: 28px; flex: 0 0 auto; border-radius: 7px; cursor: pointer;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
  color: #cfd6de; display: grid; place-items: center; padding: 0;
}
.wind-play:hover { color: #fff; background: rgba(255,255,255,.13); }
.wind-play.playing { color: #7fd4ff; border-color: rgba(127,212,255,.45); }
.wind-now {
  font-size: 10px; letter-spacing: .8px; text-transform: uppercase; background: none;
  color: #7fd4ff; border: 1px solid rgba(127,212,255,.4);
  border-radius: 4px; padding: 3px 8px; cursor: pointer;
}
/* Just the source. The run timestamp lived here and was a third time on a panel
   that already shows local and UTC -- explaining it cost more space than it was
   worth, so it is gone rather than annotated. */
.wind-meta { margin-left: auto; font-size: 10px; letter-spacing: .4px; color: #6f7b88; white-space: nowrap; }

/* Only the OPEN bar is wide enough to reach Mapbox's bottom-left block (scale
   bar + the attribution logo, which must stay visible). The nub is far away on
   the right, so it lifts nothing -- shoving the scale bar around for a 120px
   status light would be worse than the collision it avoids. */
@media (max-width: 900px) {
  .wind-lift .mapboxgl-ctrl-bottom-left,
  .wind-lift .maplibregl-ctrl-bottom-left {
    transform: translateY(calc(-1 * var(--wind-tab-h, 0px)));
    transition: transform .18s ease;
  }
}

.wind-hint {
  position: absolute; z-index: 6; width: 250px;
  background: rgba(20,23,28,.97); border: 1px solid rgba(127,212,255,.35);
  border-radius: 10px; padding: 12px 13px 11px; color: #e6ebf1;
  box-shadow: 0 8px 28px rgba(0,0,0,.55);
}
.wind-hint h5 { margin: 0 0 5px; font-family: 'Lexend', system-ui, sans-serif;
  font-size: 13px; font-weight: 700; color: #7fd4ff; letter-spacing: .2px; }
.wind-hint p { margin: 0 0 9px; font-size: 12px; line-height: 1.45; color: #cbd4de; }
.wind-hint button { font-size: 11px; font-weight: 600; letter-spacing: .3px; cursor: pointer;
  color: #06232f; background: #7fd4ff; border: 0; border-radius: 6px; padding: 5px 11px; }
.wind-hint-arrow { position: absolute; right: -6px; top: 20px; width: 10px; height: 10px;
  background: rgba(20,23,28,.97);
  border-right: 1px solid rgba(127,212,255,.35); border-top: 1px solid rgba(127,212,255,.35);
  transform: rotate(45deg); }
`;

const FALLBACK_ICON = `<svg width="21" height="21" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
  <path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h9"/></svg>`;
const PLAY = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.6v8.8L10 6z"/></svg>`;
const PAUSE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2.4" y="1.6" width="2.6" height="8.8" rx=".6"/><rect x="7" y="1.6" width="2.6" height="8.8" rx=".6"/></svg>`;
const WIND_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h9"/></svg>`;
const CHEV = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round"><path d="M2.5 7.5 6 4l3.5 3.5"/></svg>`;

// No `timeZone` option means the BROWSER's zone -- the viewer's device, not the
// part of the map they are looking at. That is the right default (people read a
// forecast in their own time), but it has to be stated on screen or it reads as
// ambiguous, so every local time is labelled with its zone and paired with UTC.
const hhmm = (d, utc) => d.toLocaleString([], utc
  ? { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit' }
  : { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// Derived from the instant being shown, not from now: a frame on the far side of
// a DST boundary is labelled PDT while the current hour is still PST.
const tzOf = (d) => {
  try {
    const parts = new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(d);
    return (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
  } catch (e) { return ''; }
};

export function mountWindUI(map, layer, manifest, opts = {}) {
  const host = map.getContainer();
  // Always rewrite: guarding on the id existing keeps stale CSS after an edit,
  // and new rules then silently do nothing.
  let st = document.getElementById('wind-ui-css');
  if (!st) { st = document.createElement('style'); st.id = 'wind-ui-css'; document.head.appendChild(st); }
  st.textContent = CSS;

  // --- forward-only outlook, clamped to what the run actually holds ---------
  //
  // Everything here is RECOMPUTED, not computed once. A map left open overnight
  // would otherwise keep yesterday's frame list forever: "live" is whichever
  // frame was nearest to now at mount, the horizon is measured from that frame,
  // and old frames eventually 404 as cycles roll off the server.
  const horizon = opts.outlookHours ?? OUTLOOK_HOURS;
  let man = manifest;
  let all = man.frames;
  let startIdx = 0, frames = [], days = [], spanH = 0, spanLabel = '', todayKey = '';

  function computeWindow() {
    const now = Date.now();
    startIdx = all.reduce((b, f, i) =>
      Math.abs(f.t - now) < Math.abs(all[b].t - now) ? i : b, 0);
    const cutoff = all[startIdx].t + horizon * 3600e3;
    frames = all.slice(startIdx).filter((f) => f.t <= cutoff);
    spanH = Math.round((frames[frames.length - 1].t - frames[0].t) / 3600e3);
    // Never promise more than the run holds: a short ETL says "36h", not "5-day".
    spanLabel = spanH >= 40 ? `${Math.round(spanH / 24)}-day forecast` : `${spanH}h forecast`;

    days = [];
    for (const f of frames) {
      const key = new Date(f.t).toDateString();
      const last = days[days.length - 1];
      if (last && last.key === key) last.frames.push(f); else days.push({ key, frames: [f] });
    }
    // Recomputed too: left open past midnight, "Today" is a different day.
    todayKey = new Date().toDateString();

    // Each day spans from its first frame to the next day's first frame. The
    // tail of the run has no successor, so it is extended by one median step --
    // without that the final frame would occupy zero width and be unclickable.
    const steps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b);
    const stepMs = steps.length ? steps[steps.length >> 1] : 3600e3;
    days.forEach((day, i) => {
      day.t0 = day.frames[0].t;
      day.t1 = i + 1 < days.length
        ? days[i + 1].frames[0].t
        : day.frames[day.frames.length - 1].t + stepMs;
      day.dur = Math.max(1, day.t1 - day.t0);
    });
  }
  computeWindow();

  // --- button: adopt the one in the page markup if present -----------------
  const rail = document.querySelector(opts.toolbarSelector || '.vertical-toolbar');
  const existing = document.getElementById(opts.buttonId || 'windBtn');
  const btn = existing || document.createElement('button');
  const adopted = !!existing;
  if (!adopted) {
    if (rail) {
      btn.className = 'toolbar-btn'; btn.id = 'windBtn';
      btn.setAttribute('aria-label', 'Wind'); btn.setAttribute('data-tip', 'Wind');
      btn.innerHTML = '<i class="fa-solid fa-wind"></i>';
    } else {
      btn.className = 'wind-btn'; btn.title = 'Wind'; btn.innerHTML = FALLBACK_ICON;
    }
  }
  // The dot lives inside the button, so the button must be a positioning context.
  btn.style.position = 'relative';
  const dot = document.createElement('span');
  dot.className = 'wind-dot';
  dot.style.display = 'none';
  btn.appendChild(dot);

  const wrap = document.createElement('div');
  wrap.className = 'wind-ui';
  const tab = document.createElement('div');
  tab.className = 'wind-tab';
  tab.innerHTML = `
    <button class="wind-handle" type="button" aria-label="Hide forecast">Hide${CHEV}</button>
    <div class="wind-row" role="button" tabindex="0">
      <span class="wind-pill">${WIND_GLYPH}<b></b><span class="wind-pill-text">Live</span></span>
      <span class="wind-offer"><span class="wind-offer-text"></span>${CHEV}</span>
      <span class="wind-when"></span>
    </div>
    <div class="wind-track"></div>
    <div class="wind-body">
      <button class="wind-play" type="button" aria-label="Play forecast"></button>
      <button class="wind-now" type="button">Now</button>
      <span class="wind-meta"></span>
    </div>`;

  const row = tab.querySelector('.wind-row');
  const pill = tab.querySelector('.wind-pill');
  const pillText = tab.querySelector('.wind-pill-text');
  const when = tab.querySelector('.wind-when');
  const offerText = tab.querySelector('.wind-offer-text');
  const handle = tab.querySelector('.wind-handle');
  const elPlay = tab.querySelector('.wind-play');
  const elNow = tab.querySelector('.wind-now');
  const track = tab.querySelector('.wind-track');
  const meta = tab.querySelector('.wind-meta');

  function buildTrack() {
    track.textContent = '';
    days.forEach((day) => {
    const d = document.createElement('div');
    d.className = 'wind-day' + (day.key === todayKey ? ' now' : '');
    d.style.flex = String(day.dur);
    const dt = new Date(day.frames[0].t);
    const isToday = day.key === todayKey;
    const sm = isToday ? 'Today' : dt.toLocaleDateString([], { weekday: 'short' });
    const lg = isToday ? 'Today'
      : dt.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    // Ticks every 3h, emphasised every 6h -- placed by time, so they stay put
    // whatever cadence the run uses.
    let ticks = '';
    const first = new Date(day.t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime(); t < day.t1; t += 3 * 3600e3) {
      if (t < day.t0) continue;
      const h = new Date(t).getHours();
      ticks += `<i class="${h % 6 === 0 ? 'six' : ''}" style="left:${
        ((t - day.t0) / day.dur) * 100}%"></i>`;
    }
    d.innerHTML =
      `<div class="wind-hours">${ticks}</div>` +
      `<div class="wind-day-fill"></div>` +
      `<span class="wind-day-label"><span class="sm">${sm}</span><span class="lg">${lg}</span></span>`;
    day.el = d;
    day.fill = d.querySelector('.wind-day-fill');
    track.appendChild(d);
    });
    meta.textContent = man.model.toUpperCase();
  }
  buildTrack();

  // --- state ---------------------------------------------------------------
  let cur = 0, pending = null, busy = false, playing = false, timer = null;
  const DWELL = opts.dwellMs ?? 1400;
  let on = readLS(LS.on, opts.defaultOn !== false);
  let expanded = readLS(LS.expanded, false);

  function paint(i) {
    const t = frames[i].t;
    for (const day of days) {
      const local = (t - day.t0) / day.dur;
      day.fill.style.width = (local <= 0 ? 0 : local >= 1 ? 100 : local * 100) + '%';
    }
    const f = frames[i], d = new Date(f.t), live = i === 0;
    pill.classList.toggle('forecast', !live);
    tab.classList.toggle('scrubbed', !live);
    pillText.textContent = live ? 'Live' : 'Forecast';
    // The UTC line keeps its weekday: local Tue evening is already Wed in UTC,
    // so a bare "06:00 UTC" would be worse than no second line at all.
    const zone = tzOf(d);
    const ahead = live ? '' : ` <i>+${f.fh - frames[0].fh}h</i>`;
    when.innerHTML =
      `<span class="wind-local">${hhmm(d, false)}${zone ? ' ' + zone : ''}${ahead}</span>` +
      `<span class="wind-utc">(${hhmm(d, true)} UTC)</span>`;
    dot.classList.toggle('forecast', !live);
    btn.setAttribute('data-tip', live ? 'Wind — live' : 'Wind — forecast');
    elNow.style.visibility = live ? 'hidden' : 'visible';
    // Collapsed, the tab advertises the outlook; open, it offers the way back.
    offerText.textContent = expanded ? 'Hide' : spanLabel;
  }

  async function loadFrame(i) {
    cur = i; paint(i);
    try { await layer.setFrameUrl(frames[i].href); } catch (e) { console.warn('[wind]', e.message); }
    const nxt = frames[(i + 1) % frames.length];
    // Must match the decoder's CORS mode, or the browser caches the preload
    // separately and the real load downloads all 840 KB a second time.
    if (nxt) { const im = new Image(); im.crossOrigin = 'anonymous'; im.src = nxt.href; }
  }

  async function show(i) {
    i = Math.max(0, Math.min(frames.length - 1, i));
    cur = i; paint(i);
    // Dragging outruns an 840 KB decode; keep only the newest request.
    pending = frames[i];
    if (busy) return;
    busy = true;
    while (pending) {
      const want = pending; pending = null;
      try { await layer.setFrameUrl(want.href); } catch (e) { console.warn('[wind]', e.message); }
    }
    busy = false;
  }

  function setPlaying(v) {
    playing = v;
    elPlay.classList.toggle('playing', v);
    elPlay.innerHTML = v ? PAUSE : PLAY;
    elPlay.title = v ? 'Pause' : 'Play';
    if (v) step(); else { clearTimeout(timer); timer = null; }
  }
  async function step() {
    if (!playing) return;
    await loadFrame(cur >= frames.length - 1 ? 0 : cur + 1);
    if (playing) timer = setTimeout(step, DWELL);
  }

  // Published as a CSS variable rather than applied directly, so the media
  // query decides whether the lift applies at all.
  // Day widths change with the tab width, so label fitting rides along with the
  // same resize/expand events that drive the lift.
  //
  // Un-hide every label BEFORE measuring: scrollWidth on a display:none element
  // is 0, so measuring in place would compare against nothing and latch every
  // label off once it had been hidden a single time.
  function fitLabels() {
    for (const day of days) day.el.classList.remove('tiny');
    for (const day of days) {
      const el = day.el.querySelector('.wind-day-label');
      const w = day.el.getBoundingClientRect().width;
      day.el.classList.toggle('tiny', w < el.scrollWidth + 16);
    }
  }

  function syncLift() {
    fitLabels();
    // Park the tab clear of the zoom BUTTONS in the bottom-right corner.
    //
    // Measure the control group specifically, not the whole bottom-right
    // container: that container also holds the attribution, which is a compact
    // icon on phones but expands to the full "(c) Mapbox (c) OpenStreetMap ..."
    // strip on desktop. Measuring the container pushed the tab ~335px in at
    // desktop widths and ran it off the left edge. The attribution sits below
    // the tab anyway, so it needs no clearance.
    const hostW = host.getBoundingClientRect().width;
    let right = 12;
    const grp = host.querySelector('.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-group');
    if (grp) {
      const r = grp.getBoundingClientRect();
      if (r.width > 0) right = Math.round(r.width) + 16;
    }
    // Never let the offset push the tab off the opposite edge, whatever ends up
    // in that corner.
    const tabW = tab.getBoundingClientRect().width || 120;
    right = Math.max(12, Math.min(right, Math.max(12, hostW - tabW - 12)));
    host.style.setProperty('--wind-right', right + 'px');

    const need = on && expanded;
    host.classList.toggle('wind-lift', need);
    // + the tab's own 22px bottom offset, + a little air.
    host.style.setProperty('--wind-tab-h', need ? (tab.offsetHeight + 32) + 'px' : '0px');
  }

  function setExpanded(v, persist = true) {
    expanded = v;
    tab.classList.toggle('open', v);
    if (!v) setPlaying(false);
    refit();
    // Note: collapsing no longer snaps back to the live hour. The day blocks
    // stay on screen either way, so a scrubbed frame remains visible and
    // labelled -- resetting it would silently throw away the user's position.
    paint(cur);
    syncLift();
    if (persist) writeLS(LS.expanded, v);
  }

  function setOn(v, persist = true) {
    on = v;
    btn.classList.toggle('on', v);
    btn.setAttribute('aria-pressed', String(v));
    tab.classList.toggle('on', v);
    dot.style.display = v ? 'block' : 'none';
    if (!v) setPlaying(false);
    layer.tune({ opacity: v ? (opts.opacity ?? 0.62) : 0 });
    syncLift();
    if (persist) writeLS(LS.on, v);
  }

  // --- staying current -----------------------------------------------------
  //
  // Two separate kinds of staleness, and both bite a tab left open overnight:
  //   1. the hour rolls over, so "now" lands on a different frame of the SAME
  //      run -- no refetch needed, just a recompute;
  //   2. a new cycle publishes, replacing the frame list entirely, and the old
  //      frames are eventually deleted from the server.
  const MANIFEST_URL = opts.manifestUrl || layer.manifestUrl || null;
  const loadManifest = opts.loadManifest || null;

  /** Recompute the window and rebuild the track, holding the user's place. */
  function rebuild() {
    const wasLive = cur === 0;
    const keepT = frames[cur] ? frames[cur].t : Date.now();
    const prevHref = frames[cur] && frames[cur].href;
    computeWindow();
    buildTrack();
    if (wasLive) {
      cur = 0;                       // pinned to live: follow it forward
    } else {
      // Scrubbed: hold the valid TIME the user chose, not the index -- the
      // index shifts under them every time the window slides forward.
      let best = 0, near = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const dt = Math.abs(frames[i].t - keepT);
        if (dt < near) { near = dt; best = i; }
      }
      cur = best;
    }
    paint(cur);
    syncLift();
    // Only touch the layer if the frame actually changed; otherwise a refresh
    // would re-decode an 840 KB PNG for nothing.
    const nextHref = frames[cur] && frames[cur].href;
    if (nextHref && nextHref !== prevHref) show(cur);
  }

  /** Has "now" moved onto a different frame of the run we already have? */
  function syncNow() {
    const now = Date.now();
    const want = all.reduce((b, f, i) =>
      Math.abs(f.t - now) < Math.abs(all[b].t - now) ? i : b, 0);
    if (want !== startIdx) rebuild();
  }

  async function refreshManifest() {
    // No loader passed in means no manifest refresh; the minute clock below
    // still advances "live" within the run we already hold.
    if (!MANIFEST_URL || !loadManifest || playing) return;
    try {
      const next = await loadManifest(MANIFEST_URL);
      if (!next.frames || !next.frames.length) return;
      const isNew = next.cycle !== man.cycle ||
                    next.updated !== man.updated ||
                    next.frames.length !== all.length;
      if (!isNew) { syncNow(); return; }
      man = next; all = next.frames;
      rebuild();
    } catch (e) {
      // A failed refresh must never blank a layer that is currently fine.
      console.warn('[wind] refresh failed:', e.message);
    }
  }

  const clockTimer = setInterval(syncNow, 60e3);
  const pollTimer = setInterval(refreshManifest, opts.refreshMs ?? REFRESH_MS);
  // Background tabs throttle intervals hard -- a phone left on the map all night
  // may fire almost none. Catching the wake-up is what actually fixes the
  // overnight case, so refresh the moment the tab becomes visible again.
  const onVisible = () => { if (!document.hidden) { syncNow(); refreshManifest(); } };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onVisible);

  row.addEventListener('click', () => setExpanded(!expanded));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); }
  });
  handle.addEventListener('click', (e) => { e.stopPropagation(); setExpanded(false); });
  elPlay.addEventListener('click', (e) => { e.stopPropagation(); setPlaying(!playing); });
  elNow.addEventListener('click', (e) => { e.stopPropagation(); setPlaying(false); show(0); });
  btn.addEventListener('click', () => setOn(!on));

  // Hit-test against each day's own rect rather than the track as a whole: the
  // 5px gaps between blocks are not time, and mapping across them would drift
  // the playhead away from the block the pointer is actually over.
  const idxFromEvent = (ev) => {
    const x = ev.clientX;
    let best = days[0], bestDist = Infinity;
    for (const day of days) {
      const r = day.el.getBoundingClientRect();
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (dist < bestDist) { bestDist = dist; best = day; }
      if (dist === 0) break;
    }
    const r = best.el.getBoundingClientRect();
    const t = best.t0 + Math.max(0, Math.min(1, (x - r.left) / r.width)) * best.dur;
    let idx = 0, near = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const dt = Math.abs(frames[i].t - t);
      if (dt < near) { near = dt; idx = i; }
    }
    return idx;
  };
  // Scrubbing is throttled, and deliberately not by coalescing alone.
  //
  // show() already keeps only the newest pending request, so decodes never run
  // concurrently -- but that still means a decode starts the instant the last
  // one finishes, and each costs ~8 MB of short-lived allocation. Dragging the
  // full width of the track that way was enough to have iOS kill the tab.
  //
  // Painting is separated from decoding instead: the playhead and the clock
  // follow the finger every frame (pure DOM, no allocation), while the field is
  // decoded at most every DRAG_DECODE_MS, plus once more when the finger lifts
  // so the frame under it is always the one finally shown.
  const DRAG_DECODE_MS = opts.scrubDecodeMs ?? 180;
  let dragging = false, dragTimer = null, lastDecode = 0;

  function scrub(i) {
    i = Math.max(0, Math.min(frames.length - 1, i));
    if (i === cur && dragTimer) return;
    cur = i; paint(i);                       // instant feedback, no decode
    clearTimeout(dragTimer);
    const wait = Math.max(0, DRAG_DECODE_MS - (performance.now() - lastDecode));
    dragTimer = setTimeout(() => {
      dragTimer = null; lastDecode = performance.now(); show(cur);
    }, wait);
  }
  function endScrub() {
    if (!dragging) return;
    dragging = false;
    clearTimeout(dragTimer); dragTimer = null;
    lastDecode = performance.now();
    show(cur);                               // settle on the released frame
  }

  track.addEventListener('pointerdown', (e) => {
    if (playing) setPlaying(false);
    dragging = true;
    try { track.setPointerCapture(e.pointerId); } catch (err) {}
    scrub(idxFromEvent(e));
  });
  track.addEventListener('pointermove', (e) => { if (dragging) scrub(idxFromEvent(e)); });
  track.addEventListener('pointerup', endScrub);
  track.addEventListener('pointercancel', endScrub);

  wrap.appendChild(tab);
  host.appendChild(wrap);
  if (!adopted) { if (rail) rail.appendChild(btn); else wrap.appendChild(btn); }

  elPlay.innerHTML = PLAY;
  setOn(on, false);
  setExpanded(expanded, false);
  show(0);
  syncLift();
  // Rotating a phone changes both the tab height (labels rewrap) and whether
  // the media query applies at all.
  const onResize = () => syncLift();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  // Width changes apply synchronously now, so setExpanded's own fitLabels() sees
  // the final size. The rAF is a belt-and-braces re-fit for any late reflow
  // (web font swap, scrollbar appearing) that would change the block widths.
  // Function declaration, not a const: setExpanded() runs during mount, before
  // this line is reached, and a const would still be in its temporal dead zone.
  function refit() { requestAnimationFrame(fitLabels); }

  // --- first-run hint ------------------------------------------------------
  let hintEl = null;
  function dismissHint() {
    if (!hintEl) return;
    hintEl.remove(); hintEl = null;
    writeLS(LS.hint, true);
  }
  if (!readLS(LS.hint, false) && opts.hint !== false && on) {
    hintEl = document.createElement('div');
    hintEl.className = 'wind-hint';
    hintEl.innerHTML = `
      <div class="wind-hint-arrow"></div>
      <h5>New — Wind layer</h5>
      <p>Current and future wind conditions worldwide, from NOAA's global GFS model.
         Tap the <strong>LIVE</strong> tab to view the forecast.</p>
      <button type="button">Got it</button>`;
    wrap.appendChild(hintEl);
    const b = btn.getBoundingClientRect(), h = host.getBoundingClientRect();
    hintEl.style.top = Math.max(8, b.top - h.top - 6) + 'px';
    hintEl.style.left = Math.max(8, b.left - h.left - hintEl.offsetWidth - 12) + 'px';
    hintEl.querySelector('button').addEventListener('click', dismissHint);
    btn.addEventListener('click', dismissHint, { once: true });
    setTimeout(dismissHint, opts.hintMs ?? 15000);
  }

  return {
    el: wrap, show, days, button: btn,
    get frames() { return frames; },
    get manifest() { return man; },
    refresh: refreshManifest,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    expand: (v = true) => setExpanded(v),
    setOn,
    get playing() { return playing; },
    get on() { return on; },
    get expanded() { return expanded; },
    remove: () => {
      setPlaying(false); dismissHint();
      clearInterval(clockTimer); clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      host.classList.remove('wind-lift');
      host.style.removeProperty('--wind-tab-h');
      if (adopted) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); }
      else btn.remove();
      dot.remove(); wrap.remove();
    }
  };
}
