# Chennai Metro 3D

**Explore the journey.** An interactive, real-time 3D ride along the first open stretch of Chennai Metro Line 4 (Yellow Line):
Poonamallee Bypass → Vadapalani, 14.64 km, 11 served stations.

Pick any two served stations, then watch a three-car train depart, accelerate, cruise, brake into each platform, open its doors and carry on.
You can watch from five cameras, by day or night, in sun or rain.

- **₹0 to run.** No API keys and no paid services. Everything runs client-side from local JSON data, with procedural textures and the browser's own speech synthesis.
- **Data first.** Every real-world fact is sourced in `src/data/*.json`. Every approximation is labelled as one (see [Data](#data)).

**Live:** https://madesh-ops.github.io/chennai-metro-3d/

## Run it

```bash
cd chennai-metro-3d
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build && npm start` | Production build and server |
| `npm run build:pages` / `npm run preview:pages` | Static export for GitHub Pages (served under `/chennai-metro-3d/`) and a local preview of it. Pushing to `main` deploys automatically via `.github/workflows/pages.yml` |
| `npm test` | Simulation tests: route model, stop accuracy, speed limits, playback (Node test runner) |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |

Requires Node 20.9+. No environment variables are needed.

### Troubleshooting

**Stuck on "Preparing your journey…" when opening the dev server from another device or address.**
In development, Next.js 16 only serves its internal files (`/_next/*` and the live-reload socket) to localhost and to hosts listed in `allowedDevOrigins`. From anywhere else, the simulator's code never arrives.

- **Private network addresses are already allowed.** That covers your phone on the same Wi-Fi (`192.168.*.*`, `10.*.*.*`, `172.16–31.*.*`, `*.local`).
- **Other hosts (tunnels, custom domains) need opting in.** Restart with them listed:

  ```bash
  ALLOWED_DEV_ORIGINS=my-tunnel.example.com,*.trycloudflare.com npm run dev
  ```

- **Production has no such restriction.** `npm run build && npm start` works from any address.

If loading takes longer than 12 seconds, the page says so, explains the likely cause (including this one) and offers a Retry. If the 3D scene itself stalls, you can continue on the 2D route map.

## What's in it

| Route | Purpose |
| --- | --- |
| `/` | Landing page with a live 3D dusk scene of the real alignment (Thelliyaragaram → Porur Junction) |
| `/routes` | Journey planner: From/To selects, a clickable route map, distance and simulated journey time |
| `/simulator?from=…&to=…` | The 3D simulator |
| `/explore` | Line overview: sections, speed limits, the Arcot Road double-decker, trains, service |
| `/stations`, `/stations/[id]` | Every station in English and Tamil, with position, status, sources and context |
| `/about` | What is verified, reported, assumed or approximated, plus sources and licences |

### Simulator

- **Cameras:** Cinematic (an automatic shot director: chase, front-quarter, street-level fly-by, side, aerial, platform shots on arrival), Driver, Passenger (inside the car, with seats, poles and windows), Map (whole route from above), and Free: drag to rotate, right-drag or Shift-drag to pan, scroll or pinch to zoom, or use the on-screen pad (pan, zoom, rotate, tilt, recentre, follow train). Switches glide rather than snap.
- **Street sounds:** in the Cinematic and Free cameras, a synthesised road hum, pass-bys of the nearest vehicles (with Doppler) and the occasional horn. It fades and muffles as the camera rises or zooms out, and dips during announcements. On/off and volume are in Settings.
- **Train sounds:** in the Driver and Passenger cameras, recorded departure, running (looped) and braking sounds. The braking sound ends exactly as the train halts, and all three stay in sync at every playback speed. On/off and volume are in Settings.
- **Landmarks and street life:** real public landmarks near the line (temples with gopurams, Porur Lake, the government hospital, bus stands and the metro depot) as stylised models with English and Tamil name boards, and shopfronts with invented Chennai-style names that light up at night.
- **Passenger experience:** in the Passenger camera, drag to look around (pinch or scroll to zoom) and switch between a window seat, standing by the doors, and the car end. Inside the cars: amber LED next-station displays and a lit route map in English and Tamil, passengers by crowd level (Auto follows peak hours), the leading car as the women's coach, grab straps that swing under braking, and cabin sounds (AC hum, door chimes). Announcements are spoken in English then Tamil (when the browser has a Tamil voice).
- **Ticket and fare:** a mobile QR ticket card at the start (CMRL distance-band fare with the 20% digital discount; Singara Chennai card) and a journey summary at the end.
- **Station sequence:** "Next station" card with countdown → name in English and Tamil → *Doors opening…* → dwell → *Doors closing…* → depart. Optional chime and spoken announcement via `speechSynthesis`.
- **Controls:** play/pause, 0.5×/1×/2×/4×, a scrubbable timeline, next station, speed and distance.
- **Environment:** day/night and clear/cloudy/rain, all blended smoothly; street, building, station and train lighting at night.
- **Settings:** graphics quality, reduced motion, audio, weather, shadows, traffic and camera shake, saved per browser.
- **Keyboard:** Space (play/pause), 1–5 (cameras), `[` `]` (speed), ← → (skip 10 s), N (night), W (weather), S (route panel), F (fullscreen), `,` (settings).
- **Resilience:**
  - Without WebGL (or if the scene crashes), the same journey continues on a live 2D route map. Force this with `?webgl=0`.
  - Bad route data shows a readable error instead of a blank screen.

## Architecture

```
src/
  app/           Next.js App Router pages
  components/    DOM UI: navigation, route planner + map, simulator HUD, station pages
  three/         React Three Fiber scene: Train, Track, Stations, City, Ground, Traffic,
                 Lighting (sky, sun, fog), Weather (rain), Cameras, MapOverlay
  simulation/    Framework-agnostic engine (no React):
                   RouteController  JSON → validated route model + arc-length spline
                   Journey          any two served stations, either direction
                   TrainController  jerk-limited motion profile, precomputed trajectory
                   StationController arrival phases (approaching → … → departed)
                   SimulationClock  pause / speed / seek
                   SimulationEngine owns clock + trajectory; single source of truth
  data/          stations.json, routes.json, tracks.json, landmarks.json
  lib/           Serializable route summary for pages that don't need three.js
  hooks/, utils/
```

Key decisions:

- **The trajectory is computed once, then played back.** The whole journey is integrated up front at 50 Hz with braking curves for each stop and each speed restriction. Playback is then a lookup, so pause, 4× speed and scrubbing are exact, and braking looks identical at every playback speed. The tests check that the train stops within 1 mm of each mark, never exceeds a limit, and never jerks.
- **One source of truth, no per-frame React renders.** The 3D scene reads `engine.sample` inside `useFrame`. The DOM HUD subscribes through `useSyncExternalStore` to snapshots throttled to 10 Hz. View preferences live in a small Zustand store.
- **The city is cheap to render.**
  - ~10k buildings are instanced boxes.
  - Windows, floors, shopfronts and lit-at-night windows come from one shader, driven by instance scale and a seed.
  - Chunks of 500–800 m are frustum-culled individually.
  - Generation is seeded, so the city is identical on every load, and it is spread across frames so loading progress is real.
- **Light pages stay light.** `/routes` and `/stations` receive a JSON route summary from the server, including per-segment run times taken from the real simulation. They never download three.js.

## Data

Verified on **3 Oct 2026**. Full provenance is on `/about`.

| Item | Status |
| --- | --- |
| Station names, order, which 11 are served / 6 passed | Verified (CMRS-approval, fare and opening coverage) |
| Length 14.64 km, opening 11 Oct 2026, 10-min headway, ₹10–40 | Reported |
| Coordinates: 6 stations from their Wikipedia articles, 5 from same-name bus stop/locality | Verified / approximate (±150–300 m) |
| Unopened Arcot Road station positions | Approximate (spaced to match the reported 3.75 km double-decker) |
| Alignment between stations | Approximate (spline through stations, not the surveyed viaduct) |
| Train: Alstom Metropolis, 3 cars, 67.8 m, 80 km/h operating | Verified |
| Porur–Vadapalani limit 40 km/h | Reported (May 2026) |
| Acceleration, braking, dwell | Assumed (typical metro values) |
| Landmarks drawn in 3D: Vadapalani Murugan Temple, Sri Varadaraja Perumal Temple (Poonamallee), Porur Lake | Verified coordinates (Wikipedia); models stylised, lake outline simplified |
| Bus stands and depots (Poonamallee, Iyyappanthangal, Vadapalani), Government Hospital Poonamallee, Poonamallee metro depot | Approximate (stop point or street address; footprint and side of road not published) |
| Line 5 viaduct leaving the double-decker after Porur Junction (towards Mugalivakkam) | Approximate: path traced from satellite imagery; descent to normal rail level assumed. Drawn without trains (Line 5 is under construction) |
| Line 5 viaduct leaving the double-decker past Alwarthirunagar, curving north towards Virugambakkam | Approximate: turn-off traced from a satellite view supplied by the project owner (just past Chandra Metro Mall), route from the CMRL Phase II map; radius and descent assumed. Drawn without trains |
| MGR Flyover on Mount–Poonamallee Road at Porur Junction (505 m, 4 lanes, opened 25 Jun 2017), Kundrathur Main Road | Length, lanes and opening verified; route along Mount–Poonamallee Road traced from satellite imagery (shares the metro corridor west of the junction, then veers east-south-east while the metro turns up Arcot Road); width assumed; height drawn lower than real so buses clear the metro's steel portal beams |
| Nexus Vijaya Mall, Kamala Cinemas (Vadapalani) | Approximate positions traced from satellite imagery supplied by the project owner; stylised models from reference photos; hoardings and film posters invented |
| Chandra Metro Mall (Arcot Road, Virugambakkam) | Between Alwarthirunagar and Saligramam on the north side, per the project owner and their satellite view; footprint (narrow front, deep white-roofed hall, car park) traced from that view; stylised facade from street photos; ads and films invented. Mappls address kept as the source |
| Virugambakkam neighbourhood around the mall | Approximate: packed 2–4 storey houses on the mall side and 5-storey apartment blocks round a courtyard opposite, after the same satellite view |
| Fare bands (₹10 up to 2 km, ₹20 up to 5, ₹30 up to 12, ₹40 up to 21, ₹50 beyond) | Approximate (passenger guides; CMRL's fare page was unavailable); matches the published Line 4 range ₹10–40. 20% QR / NCMC discount verified (CMRL) |
| Women's coach (first coach in the direction of travel) | Assumed for Line 4 (CMRL reserves women's coaches; not yet published for the 3-car trains) |
| Crowd levels, in-car displays, film posters, hoardings | Illustrative |
| Shop signboards | Invented names (English + Tamil); real chains and brands are excluded |
| Train look: blue rounded cab, blue roof band, stainless sides with a blue stripe under the windows, after photos of CMRL Alstom Metropolis trainsets | Stylised from reference photos |
| Interior, buildings, traffic | Stylised / procedural |

As a sanity check, the spline through the published coordinates measures **14.61 km** against the official **14.64 km** (0.2 % difference).

To correct anything, edit the JSON. Components read the route model, never hard-coded values. Stations can be added, removed or re-ordered; `validateBundle()` reports problems in plain language.

## Licences

Code dependencies are MIT-licensed: Next.js, React, three.js, React Three Fiber, drei, Zustand and Tailwind CSS. The Geist fonts and Noto Sans Tamil (bundled subset in `src/fonts`) are under the SIL Open Font License 1.1. The train recordings in `public/audio/` were supplied by the project owner and are not covered by the code licences; check their source licence before redistributing. No OpenStreetMap data is bundled; if any is added, attribute it as "© OpenStreetMap contributors" (ODbL).

This is an independent visualisation, not affiliated with or endorsed by Chennai Metro Rail Limited.
