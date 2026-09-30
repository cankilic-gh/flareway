# Flareway

A browser-native takeoff and landing game about one thing: making the softest possible touchdown on a small island runway, in a logo-free high-wing trainer, in seeded wind.

> Recreational game, not flight training or an aircraft operating guide. Simplified fictional physics and performance.

The **Flareway Trainer FT-172** is an original, logo-free four-seat high-wing trainer in the broad Cessna 172 class. It is not an official Cessna/Skyhawk product and contains no manufacturer branding, registration or copied livery. The island airfield (Runway 09/27) is fictional.

## Play locally

```bash
npm install
npm run build
npm run preview
```

Open http://localhost:4174. `npm run dev` serves a hot-reloading build on http://localhost:5178.

A condition code can be shared as a link: `http://localhost:4174/?code=GST-00ZZ1&mode=landing`.

## Modes

**Landing Challenge (default).** You start established on a 1.35–1.5 nm final, 450–600 ft above the runway, crabbed for the wind with 10° of flap. Fly a stabilized approach on the PAPI, add flaps, correct for drift, flare, touch down on the mains, lower the nosewheel and stop on the runway. Press `T` at any time to go around: you return to a safe final with the same conditions. Go-arounds are never penalized.

**Takeoff Practice.** You start stopped on the centerline at idle. Add power, hold the centerline with rudder/nosewheel steering, rotate around 55 KIAS without striking the tail, lift off and climb at 70–80 KIAS on the runway heading to 150 ft.

### Conditions

Every run has a deterministic condition code (`CLM-`, `BRZ-`, `GST-`, `CHL-` plus five base-36 characters). The same code always produces the same wind, gusts, turbulence, runway and spawn point.

| Preset | Wind | Gusts | Notes |
|---|---|---|---|
| Calm | 0–3 kt | ≤ 1 kt | nearly steady |
| Breezy | 4–8 kt | 1–2.5 kt | 25–70° off the runway, a real crosswind |
| Gusty | 7–12 kt | 2–5 kt | direction wanders 12–22° |
| Challenge | 10–15 kt | 3–5 kt | strong crosswind, turbulence; may include a small tailwind, disclosed in the briefing |

Normal presets always land into a headwind or pure crosswind (Runway 09 or 27 is chosen for you). Wind acts on the air mass: it produces drift, crab, weathervaning on the ground, gust loads and a surface wind gradient. The windsock points downwind and fills out with speed.

### Scoring (landing, out of 1000)

| Component | Max | What counts |
|---|---:|---|
| Touchdown softness | 400 | contact sink rate, mains first, bounce, float distance |
| Centerline accuracy | 200 | offset at first main-wheel contact |
| Alignment and side-load | 150 | yaw error, sideways drift across the wheels, bank |
| Stabilized final | 150 | time between 500 and 50 ft within speed, PAPI, centerline, sink and bank limits |
| Rollout and runway remaining | 100 | centerline tracking, skids, runway left at the stop |

Labels: **Butter** (≤ 120 fpm, aligned, on centerline), **Smooth**, **Firm**, **Hard landing**, **Bounce**, **Side-loaded**, **Off centerline**, **Nosewheel first**, **Long landing**, and failures (**Runway excursion**, **Gear collapse**, **Prop strike**, **Tail strike**, **Wingtip strike**, **Stall impact**, **Ran out of runway**, **Landed short**). Sink rate alone never gives a perfect score: floating past the touchdown zone, nosewheel-first contact, side-load and excursions all cost points. Failed attempts grade F and cap at 250.

Takeoffs are scored on centerline (250), rotation speed and attitude (250), climb speed (250), runway heading after liftoff (150) and smoothness (100, wheelbarrowing).

The result screen shows the grade, the breakdown, touchdown metrics (fpm and m/s, lateral velocity, offset, yaw, bank, pitch, KIAS, touchdown distance, first contact), a centerline plot, what cost the most points, and a runway-side replay with slow motion around contact. Retry never waits for the replay.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle up / down (holds) | `W` / `S` | RB / LB (or right stick in the accessible mode) |
| Roll left / right, nosewheel steering on the ground | `A` / `D` | left stick X |
| Nose down / nose up (aviation style) | `↑` / `↓` | left stick Y (pull back = nose up) |
| Rudder left / right | `Q` / `E` | LT / RT |
| Flaps down / up one step | `F` / `G` | Y / X |
| Wheel brakes | `Space` | A |
| Camera (chase, cockpit, runway side) | `C` | B |
| Go around | `T` | Back |
| Retry | `R` | — |
| Pause | `Esc` | Start |
| Results: new conditions / replay | `N` / `P` | — |

Keys ramp in: a tap is a small correction, a hold is full deflection. Every key is remappable in Settings (conflicts swap). Settings also offer pitch-key inversion ("Direct: Up = nose up"), the pitch stability assist, the coordinated-rudder assist, manual versus arcade throttle (arcade: `W`/`S` set a target speed), centerline guidance (extended centerline, deviation bar, PAPI repeater), the approach path marker (flight path vector and touchdown aim box), quality, volume and reduced motion. All assists are labeled in the HUD and can be switched off.

## Architecture

```
src/
  sim/        deterministic simulation, no rendering or DOM
    constants.ts   every coefficient (aircraft, gear, tires, runway, PAPI, speed bands)
    physics.ts     6-DOF rigid body, aero, engine/propeller, three gear contacts, strikes
    conditions.ts  presets, condition codes, seeded wind parameters, runway selection
    wind.ts        smooth deterministic gusts, direction drift, turbulence, surface gradient
    airfield.ts    runway geometry and an analytic island ground/surface query
    papi.ts        four-box PAPI with hysteresis from the pilot eye position
    attempt.ts     landing/takeoff trackers: contacts, bounces, stability, failures, traces
    scoring.ts     transparent landing and takeoff scores, labels, hints
    session.ts     spawn, fixed step, go-around, result
    stepper.ts     fixed 120 Hz stepper independent of render cadence
    flow.ts        pure title / playing / paused / go-around / result transitions
    autopilot.ts   scripted test pilot that flies through the normal input channel
    replay.ts      allocation-free ring buffer for the result replay
  render/     Three.js r186 WebGL 2 renderer
    world.ts        renderer, loaders, composer (MSAA, restrained bloom, replay-only depth of field)
    environment.ts  Preetham sky, PMREM environment, sun with a tight aircraft-following shadow frustum, fog
    airfieldView.ts GLB binding, terrain/ocean materials, merged statics, light glows, PAPI x2, windsock,
                    beacon, instanced vegetation with per-instance culling and LOD, fence, grass
    aircraftView.ts GLB binding, hinge correction, materials, control-surface animation, cockpit rule
    shaders.ts      ocean, terrain, runway wear and light-glow shaders
    fallback.ts     procedural aircraft and airfield with the same node contract
    cameras.ts, effects.ts, quality.ts
  input/      remappable keyboard, gamepad, settings persistence
  audio/      procedural WebAudio (engine, wind, tire chirp, stall horn, rumble)
  ui/         HTML/CSS title, HUD, results, tutorial, settings
  app.ts      game loop and orchestration
  testApi.ts  automation API, loaded only with ?test=1
```

Key decisions:

- **Fixed-step simulation.** The simulation runs at 120 Hz regardless of frame rate and renders interpolated poses. Identical inputs give bit-identical results at 60, 144 or irregular frame cadences (unit tested).
- **Authored anchors drive physics.** Gear contacts, tail strike point and pilot eye come from the GLB contract (`ASSET_BRIEF.md`) and are mirrored in `src/sim/constants.ts`; E2E tests assert the loaded GLB matches.
- **Cockpit rule.** Only the closed `Fuselage` shell is hidden in cockpit view and restored for every other view. Exterior materials are forced opaque; only the glass is transparent.
- **Logarithmic depth buffer** keeps 1 cm-high runway markings free of z-fighting from 3 km out.
- **One ocean draw.** `OceanReferencePlane` keeps its node and transform; its placeholder material is replaced by a procedural WebGL 2 ocean shader and its geometry is extended to the horizon so the approach is flown over water.
- **Instanced vegetation** from the 48 authored `VegetationSpawns` anchors plus a ridge tree line, with per-instance frustum and distance culling and near/far tiers, reported by runtime counters.

## Tests

```bash
npm run lint
npm run typecheck
npm test                 # Vitest: deterministic simulation, scoring, flow, input
npm run test:e2e         # Playwright: production build, Chrome and WebKit
npm run test:e2e:smoke   # the single WebGL 2 smoke test used by hosted CI
npm run verify           # lint + typecheck + unit + build
```

The E2E suite builds and serves the production bundle and covers WebGL 2 boot, Landing default, tutorial focus and scrolling, direct landing start, an assisted soft landing, hard landing and gear collapse, runway excursion, go-around, takeoff, control-surface animation, cockpit/chase camera fuselage rule, PAPI and windsock, blocked GLB fallback for both assets, vegetation culling and draw-call/triangle budgets, pause/resume, and the test API isolation. Hosted CI runs lint, typecheck, unit tests, the build and one SwiftShader WebGL smoke test; the full suite runs locally.

`?test=1` exposes `window.__flareway` (start with a scripted pilot, fast-forward, inspect state, bindings, PAPI, windsock, stats, QA camera). It is a separate chunk that the normal page never loads.

## Assets

| Asset | Runtime file | Budget |
|---|---|---|
| Flareway Trainer FT-172 | `public/assets/aircraft/ft172-trainer.glb` | 10,852 triangles, 14 materials, about 581 KB |
| Island Runway 09/27 kit | `public/assets/airport/field-kit.glb` | 33,552 triangles, 19 materials, about 1.13 MB |
| Editable source | `assets-src/blender/flareway-assets.blend` | Blender 5.2.1 LTS |

Rebuild and inspect:

```bash
tools/blender/build-assets.sh
python3 scripts/inspect_assets.py
```

See `ASSET_BRIEF.md`, `ASSET_LICENSES.md`, `SOURCES.md` and `VISUAL_REFERENCE_RESEARCH.md`. Game QA captures are in `artifacts/qa/game/`.

## Performance

Measured on the development Mac (Apple M5, Chrome, Normal quality, 1600×900 at device pixel ratio 2 → 2400×1350 drawing buffer, MSAA 4×, bloom), with a GPU-synchronized benchmark in the test API:

| Scene | Scene draw calls | Scene triangles | Near vegetation triangles | ms/frame (GPU-synced) |
|---|---:|---:|---:|---:|
| 1.4 nm final | 108 | 120 k | 0 | 5.7 |
| short final | 96 | 180 k | 73 k | 8.5 |
| on the runway | 96 | 157 k | 52 k | 8.1 |

Budgets: ≤ 220 draw calls, ≤ 750 k triangles, ≤ 250 k near vegetation triangles; the E2E suite fails if the draw-call or triangle budget is exceeded.

## Honest limitations

- The flight model is a simplified, tuned game model: linear lift with a simple post-stall, no propeller torque/P-factor/slipstream swirl, no gyroscopic coupling, a single pitch/roll/yaw inertia set, and an auto-trim stability assist rather than a trim wheel. Speeds (stall warning ~43–48 KIAS, rotate ~55, climb 70–80, final 60–70) are game targets, not operating data.
- Main gear use a lightly damped spring (spring-steel style) tuned for readable bounces; the nose strut is an oleo-like damper. There is no tire model beyond a saturating friction curve.
- The simulation's ground height away from the runway plateau uses an analytic copy of the Blender island formula, so off-airport terrain contact is approximate; buildings and trees have no collision.
- Approach lights and the PAPI for Runway 27 are mirrored copies of the authored Runway 09 units.
- GTAO is not used: Three.js GTAO does not support the logarithmic depth buffer needed for marking precision. Contact grounding comes from a tight shadow frustum and a soft contact shadow under the aircraft.
- The authored cabin roof sits a few centimeters above the authored pilot eye, so the cockpit view has a low headliner.
- Gamepad support follows the standard mapping and was verified in code, not with physical controllers.
- No backend, accounts, analytics, telemetry or network dependencies; everything runs from static files.

## Release

This repository is built and verified locally only. GitHub, deployment, DNS and the portfolio update are handled separately after acceptance; see `PORTFOLIO_RELEASE_PLAN.md`.
