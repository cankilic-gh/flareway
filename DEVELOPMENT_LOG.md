# Development log

## 2026-09-30: asset-first preparation

### Scope

Prepared the original aircraft, fictional airfield, runtime contracts and Claude implementation handoff before any game code exists.

### Reference boundary

- Used the official Textron product card only for the 11.00 m wingspan and 8.28 m length envelope and broad high-wing trainer category.
- Used FAA public material only for high-level takeoff/landing terminology, runway markings and four-box PAPI behavior.
- No source artwork, manufacturer drawing, livery, mesh, texture, logo, registration or branded avionics was imported or traced.
- Public asset name is Flareway Trainer FT-172, not Cessna or Skyhawk.

### Blender pipeline

Command:

```bash
tools/blender/build-assets.sh
python3 scripts/inspect_assets.py
```

Blender: 5.2.1 LTS.

The generator writes:

- `assets-src/blender/flareway-assets.blend`
- `public/assets/aircraft/ft172-trainer.glb`
- `public/assets/airport/field-kit.glb`
- eight 1280×720 QA renders under `artifacts/qa/assets/`

### Visual iterations

1. **Initial export:** all GLBs and eight renders generated, but the aircraft was too bulbous, the wing read as a slab, the total gear-to-tail height exceeded the 2.72 m target, the prop/cowling details were oversized and the cockpit/final cameras were not useful.
2. **Geometry polish:** narrowed and flattened the cabin/fuselage stations, rebuilt wing sections with an airfoil profile, moved wing and tail surfaces, corrected landing-gear height, reduced the cowling seam, replaced primitive prop rods with tapered two-blade geometry, resized windows/interior and added airfield tree/fence/beacon templates.
3. **Runway/camera polish:** corrected runway designator rotation, centered the final-approach composition, placed the aircraft on the authored ground contacts and moved the pilot camera above the panel.
4. **Cockpit contract:** the exterior fuselage is a closed procedural shell. Pilot view now uses a documented camera-specific rule: hide only `Fuselage` while in cockpit view, leaving the panel, yokes, windows, controls and other aircraft nodes visible. The QA cockpit render proves the runway view using that contract.

### Initial asset-pass runtime budgets

| Asset | Bytes | Triangles | Materials | Nodes | External URIs |
|---|---:|---:|---:|---:|---:|
| FT-172 aircraft | 489,416 | 8,304 | 14 | 88 | 0 |
| Airfield kit | approximately 1.04 MB | 29,928 | 16 | 212 | 0 |

All required aircraft animation, contact and camera nodes pass `scripts/inspect_assets.py`. All required runway, PAPI, windsock and modular environment nodes pass.

### Export determinism

The Blender Python generator is deterministic in semantic output: node contract, dimensions, triangles, materials and external dependencies remain stable. Blender 5.2's glTF exporter did not produce byte-identical GLBs across repeated clean runs; accessor, buffer-view and binary mesh-buffer ordering changed while contract values remained identical. Do not use a hardcoded GLB SHA as a gameplay contract. Use `scripts/inspect_assets.py`.

### Known visual limits

- The aircraft is a performant browser-game hero asset, not a manufacturer-accurate study model.
- The panel is intentionally simple and has no branded avionics or detailed dial textures.
- Cockpit mode hides the closed exterior `Fuselage` shell for that camera.
- Trees and fence are modular templates; runtime should instance them rather than duplicate heavy geometry.
- The airfield is intentionally fictional and sparse so the game can add performant procedural terrain/detail.
- There are no people or pilots.

### Claude handoff

`CLAUDE_GAME_BUILD_PROMPT.md` specifies the complete game: Landing Challenge as default, Takeoff Practice, deterministic random wind/gusts, PAPI, touchdown scoring, runway consequences, replay, controls, WebGL 2 architecture, TDD and visual QA. Claude must build locally and must not push or deploy.

## 2026-09-30: solid-aircraft and island realism pass

### Transparency root cause

The first exterior QA render looked ghosted even though the paint material used alpha 1. The generator had enabled global `use_backface_culling` on the shared warm-white aircraft material as a cockpit-camera workaround. Combined with the loft face orientation and several thin overlapping parts, exterior fuselage surfaces were culled and the cabin interior showed through.

Fix:

- removed global backface culling from aircraft paint;
- retained the camera-specific cockpit rule that hides only the `Fuselage` node while cockpit view is active;
- reduced glass transmission and raised glass opacity;
- added windshield/side-window frames;
- added cabin roof fairing, wheel fairings, cowling intake, pitot tube and antennas;
- reduced livery geometry so it reads as a paint stripe rather than tubing.

The exterior aircraft is now solid from chase/profile cameras. Only glass uses transmission/alpha.

### Exact Three.js reference review

Analyzed the two supplied Three.js X posts from their exact IDs and downloaded their exact videos for time-sampled contact sheets. Details and source URLs are in `VISUAL_REFERENCE_RESEARCH.md`.

- Boring Forest uses a TSL/WebGPU-heavy forest/water pipeline. Its author reported 5.6M grass triangles before finding 95% were off-screen and still reported 45–50 W GPU draw in hot scenes. Flareway transfers its lighting, fog, shoreline and culling lessons, not its raw density.
- Dan Greenheck's island experiment demonstrates terrain shaping, water, shore material zones and vegetation placement, but the author describes it as a possible premium Water Pro/starter pack. No code or asset is copied.

### Island airfield

Replaced the rectangular grass slab with:

- `IslandTerrain`, an irregular low-cost terrain mesh with a flattened runway plateau;
- `BeachRing` shoreline transition;
- `OceanReferencePlane`, a scale placeholder for the runtime WebGL2 ocean shader;
- shoreline rock silhouettes;
- 48 deterministic `VegetationSpawn_*` anchors for runtime `InstancedMesh` trees;
- an additional full-island aerial QA render.

The runway remains 900×23 m and both approach ends are close to the shoreline. Runtime must preserve WebGL2 as baseline and implement bounded ocean, fog, terrain blending and vegetation LODs under the budgets in the revised Claude prompt.

### Updated asset metrics

| Asset | Triangles | Materials | Approximate GLB size |
|---|---:|---:|---:|
| FT-172 aircraft | 10,852 | 14 | 581 KB |
| Island airfield | 33,552 | 19 | 1.13 MB |

Both remain comfortably inside browser budgets and have no external URI dependencies.

## 2026-09-30: game build, deterministic simulation core (TDD)

Branch: `feature/flareway-game`, created from the prepared asset commit `4715f7b`.

Toolchain: TypeScript 5.9.3 strict, Three.js 0.186.1 (r186), Vite 8, Vitest 5, Playwright 1.63, ESLint 10 + typescript-eslint.
TypeScript 7 was available but typescript-eslint 8.71 only supports `<6.1`, so 5.9.3 is pinned.

### Asset integration finding

`scripts`-level inspection of the GLB JSON confirmed the exported frame is +X forward, +Y up, +Z starboard and all
anchors match `ASSET_BRIEF.md`. One verified integration defect: `Aileron_*`, `Flap_*` and `Elevator` pivot empties sit
at body height y = 0 while their hinge lines are about 0.5–0.9 m higher (the generator places the pivot at
`(hinge_x, 0, 0)`). Rotating the named pivot would swing the surface off the wing. Runtime fix (no regeneration):
at bind time the renderer moves each pivot up to its measured hinge line and counter-offsets the child mesh, so the
visual rest pose is unchanged and runtime still writes deflections only to the named pivot nodes. Suggested
generator fix for a future asset pass: `control_panel()` should create the pivot at `(hinge_x, 0, z_hinge)`.

### RED/GREEN evidence

Each slice: test file first, run, record failure, implement, run again.

| Slice | RED | GREEN |
|---|---|---|
| Seeded conditions + wind (`tests/unit/conditions.test.ts`) | Suite failed to import `src/sim/conditions` (0 tests) | 10/10 |
| Flight dynamics (`flight.test.ts`) | Import failure; first implementation run 3 failed: lift ratio 1.0 (test read a shared result object twice), roll-authority ratio measured with damping included, weathervane test conflated with the coordinated-rudder assist | Tests corrected to measure pure authority and to separate air-mass drift from weathervaning; 9/9 |
| Ground contacts (`ground.test.ts`) | 2 failed: contact positions lag one step (tolerance), and a 0.5 m/s touchdown "bounced" because the test began with lift = 1.36 W | Realistic flare state (L ≈ W, light back-pressure). Probe sweep over sink 0.3–4.2 m/s tuned main-gear damping from 3600/9500 to 2000/2000 N·s/m (spring-steel mains): no bounce ≤ 300 fpm, ~0.7 m bounce at 570 fpm, collapse ≥ 680 fpm. 10/10 |
| PAPI (`papi.test.ts`) | Import failure | 5/5 |
| Scoring (`scoring.test.ts`) | Import failure | 11/11 |
| Session, flow, fixed step, scenarios (`session.test.ts`) | Import failure; then 2 failed (takeoff spawn tail strike from propwash; test pilot turning the wrong way), then 3 failed | See fixes below; 15/15 |

Defects the scenario tests exposed in the simulation itself (not the tests):

- **Coordinated-rudder assist sign was inverted.** It added rudder that increased sideslip; a 15° left bank turned the
  aircraft right with 7° of slip and a spiral dive. Fixed to `+1.6·β`; a 15° bank now turns at 3.8°/s (ideal 4.2°/s)
  with near-zero slip.
- **Propwash on the elevator was too strong** (0.30): full aft stick at standstill lifted the nose into a tail strike.
  Reduced to 0.05; the nose now lifts around 45 KIAS with half stick.
- **Aileron authority was too high** (full deflection ≈ 124°/s roll). Reduced `clAileron` 0.16 → 0.075 (≈ 60°/s).
- The test pilot's flare began too late and its rollout held no aileron into the wind, which let strong crosswinds roll
  the aircraft onto a wingtip. Progressive flare and wings-level rollout fixed both.

Autopilot sweep after tuning (16 seeds per preset, scripted soft-landing pilot flying through the normal input channel):

| Preset | Avg score | Avg sink | Labels |
|---|---:|---:|---|
| Calm | 957 | 118 fpm | 13 Butter, 3 Smooth |
| Breezy | 917 | 124 fpm | 12 Smooth, 3 Side-loaded, 1 Butter |
| Gusty | 878 | 135 fpm | 10 Side-loaded, 3 Smooth, 3 Butter |
| Challenge | 774 | 132 fpm | 16 Side-loaded |

The takeoff pilot scored 973–1000 across all presets with no failures.

## 2026-09-30: renderer, UI, input, audio and browser verification

### Process note

The simulation slices above were strictly test-first. The renderer, HUD and UI were implemented first and then
covered by the Playwright suite and by real-browser captures; the input-mapping unit tests (`tests/unit/input.test.ts`)
were also written after `src/input/controls.ts`. Where the browser checks found defects they are recorded below as the
RED side of the loop.

### Browser-found defects (RED) and fixes (GREEN)

| Found by | Defect | Fix |
|---|---|---|
| First chase-camera capture | Sky and aircraft blown out; bloom halo on white paint | Exposure 0.95 → 0.5, bloom threshold 4.5 (lights only), sun 5.2 |
| QA capture looking north | Sun placed in the north (Three.js spherical theta 205° = north); Preetham sky HDR above bloom threshold | Sun moved to 335° (south-southwest); sky radiance capped below the bloom threshold in the sky shader |
| Tower/replay capture | Terrain, grass and trees pale: sRGB values used as linear albedo | Linear-space albedos in terrain shader and vegetation vertex colours |
| Replay capture | Aircraft looked ghosted with depth of field | BokehPass depth used a half-float target; switched to float depth and a 12 km replay far plane; aperture reduced |
| Cockpit capture | Cabin headliner rendered as a bright white wall | PMREM environment had a bright below-horizon sky; added a dark sea lower hemisphere to the environment scene |
| E2E budget test (228 > 220 draw calls) | Aircraft GLB has 89 separate meshes drawn in the main and shadow passes | Static aircraft parts merged per material (animated pivots and `Fuselage` kept); scene draw calls 183 → 65 |
| E2E WebKit tutorial test | Safari does not tab to buttons and does not focus a clicked button, so focus was lost | Explicit focus cycling inside dialogs and explicit opener for focus return |
| Mobile capture (375 px) | Setup panel covered the wordmark; HUD chips overlapped | Explicit grid rows on narrow screens, compact HUD placement |

### Playtest finding: flap balloon under the stability assist

A keyboard start in the production preview showed that one flap notch with no other input made the aircraft balloon
(+280 fpm, 68 → 59 KIAS) because the assist held angle of attack while the flaps added lift. Test first:
`tests/unit/flight.test.ts › re-trims for a flap change` compares holding 10° against selecting 20° from the same
settled glide. RED with the assist unchanged: 13.2 m higher after 6 s. GREEN after the assist re-trims the held angle of
attack by the flap lift increment (like a pilot re-trimming): under 6 m and speed within 3 kt. The autopilot sweep was
re-run with identical results (calm 958 avg, 13 Butter), and a no-input run still fails (drift off the centerline or a
hard arrival), so the game does not fly itself.

### Verification results

- `npm run lint`: 0 problems. `npm run typecheck`: clean. `npm test`: 67/67 (Vitest).
- `npm run test:e2e`: 36/36 across Chromium (GPU new-headless) and WebKit, against the production build.
- CI smoke (`CI=true npm run test:e2e:smoke`, SwiftShader): 1/1.
- Performance (Apple M5, Normal, 2400×1350 buffer, GPU-synchronized): 5.7–8.5 ms per frame, ≤ 108 scene draw calls,
  ≤ 180 k scene triangles, ≤ 73 k near vegetation triangles. See `README.md`.

### Visual QA

Captured with Playwright on the real GPU at 1600×900 (plus 1280×633 and 375×812) into `artifacts/qa/game/`:
title (Landing default), aerial island establishing view, calm final, crosswind final with crab, low approach over the
beach with PAPI, cockpit, flare, main-wheel touchdown with tire smoke and shadow, rollout, runway excursion result,
takeoff roll, rotation/liftoff, takeoff result, tutorial at 1280×633 and 1600×900, settings, and mobile title, HUD
and results. Each capture was inspected for aircraft opacity, control-surface hinge placement, wheel contact,
runway scale, ocean/shoreline continuity, PAPI state, windsock direction, vegetation and fog readability.
Console errors during captures: none.

## 2026-09-30: control layout change after user playtest

User feedback: A/D only banked the aircraft and yawing from the tail felt like it did nothing; move the rudder to A/D and
put the turning (bank) on the left/right arrow keys.

- Investigation: a new test (`flight.test.ts › player rudder yaws the aircraft even with the coordinated-rudder assist
  on`) showed full rudder already yaws 46° in 4 s without the assist and 53° with it, so the assist was not cancelling
  rudder. The problem was discoverability: rudder lived on Q/E.
- RED: `input.test.ts` asserted the new defaults (A/D rudder, ←/→ roll) and failed on the old bindings.
- GREEN: defaults changed to A/D = rudder and nosewheel steering, ←/→ = roll, ↑/↓ = pitch. Ailerons no longer steer the
  nosewheel on the ground, so holding the upwind wing down in a crosswind rollout does not turn the aircraft.
  Settings storage moved to `flareway.settings.v2`; older saved bindings are dropped so the new layout applies.
- Autopilot sweep unchanged (calm 958 avg, 13 Butter; takeoff 973–1000). Unit 69/69, E2E 36/36 (Chrome + WebKit).

## 2026-10-01: lagoon, surf and shoreline pass (ported from Shore Water)

A visual pass that brings the shoreline techniques from the Shore Water diorama (https://shorewater.thegridbase.com) to the island. Nothing in `src/sim` changed in behaviour. `islandRadius` stays private, and the flight model, scoring and ground queries are untouched.

- **Lagoon.** Near the island the ocean now shows a sand shelf through clear water:
  - A reef edge about 75 m out, then the drop-off, with noise-varied depth.
  - Per-channel Beer–Lambert absorption and turquoise in-scatter.
  - Moving caustics from a baked tileable cellular texture (`makeCellTexture`), fading into the open-ocean colour with depth.
- **Surf.** Wave fronts roll in toward the shore, break on the reef edge and again in the swash, and are broken up along the shore by noise and slow sets. They are drawn as cellular lace that thins into holes. This replaces the old thin pulsing foam ring.
- **Measured waterline.** The visible waterline differs from the analytic radius by angle (hills reach the south shore, the beach ring floats on the east tip).
  - At load, `measureShoreline` marches outward along 256 angles and raycasts down onto `IslandTerrain` and `BeachRing`. A sample that misses or falls below the sea marks the waterline.
  - The samples get a circular median and two box passes, then go into a 1D texture.
  - The swash band, the surf phase and the terrain's wet band all read it, so they sit on the shore the player sees.
- **Terrain.**
  - Wind ripples and grain on sand, and blade-scale speckle on grass. Both apply only within ~10 cm per pixel, so they cost nothing at approach altitude.
  - A wet band on the beach that breathes with the swash on the ocean's clock, with glossier roughness.
- **Trees.**
  - Crown normals are bent away from the crown centre (`softenCrown`), so the low-poly canopies light as soft volumes.
  - World-space leaf-cluster noise breaks up instanced crowns.
- **Quality.** On Low the lagoon caustics, surf lace and foliage noise are skipped (`uShoreDetail`). The surf bands remain as soft foam.

Tests:
- New `tests/unit/shoreline.test.ts`: one sample per angle, inner and outer clamps, land below the sea ignored. Written with the implementation, not RED first.
- `npm run verify`: lint, typecheck, 73/73 unit tests and build.
- `npm run test:e2e`: 36/36 (Chromium + WebKit).

Performance (headless Chromium on the Apple M5, Normal, 1600×900 at DPR 1.5, production build served locally, two fixed QA poses: oblique over the south shore and low over the beach):

| | Before | After |
|---|---|---|
| fps, pose 1 | 79 | 65 |
| fps, pose 2 | 85 | 76 |

The cost is the lagoon and surf shading near the shore plus the beach wet band. Low quality is unaffected.

Known gaps:
- The waterline sampling uses 256 angles. A spit narrower than about 15 m is smoothed out of the swash band.
- Caustics and lace scroll a baked tile instead of evolving.
