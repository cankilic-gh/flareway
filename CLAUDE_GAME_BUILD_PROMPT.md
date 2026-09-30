# Claude Build Prompt: Flareway

Copy everything below into Claude Code while its working directory is this repository.

---

## TASK

Build **Flareway**, a polished browser-native recreational takeoff and landing game centered on the satisfying challenge of making the softest possible runway landing in a small high-wing trainer. Use the original Blender assets already present in this repository. Deliver a complete, tested, locally playable product and commit it locally, but do not push, deploy, configure DNS, or edit any other repository.

## CONTEXT

Repository:

`/Users/cankilic/Documents/GitHub/flareway`

Friday has already produced and validated the art package:

- Aircraft source: `assets-src/blender/flareway-assets.blend`
- Aircraft runtime GLB: `public/assets/aircraft/ft172-trainer.glb`
- Airfield runtime GLB: `public/assets/airport/field-kit.glb`
- Deterministic generator: `tools/blender/generate_flareway_assets.py`
- Build command: `tools/blender/build-assets.sh`
- Asset contract inspector: `scripts/inspect_assets.py`
- Asset contract and dimensions: `ASSET_BRIEF.md`
- License ledger: `ASSET_LICENSES.md`
- Source ledger: `SOURCES.md`
- QA renders: `artifacts/qa/assets/`
- Machine-readable report: `artifacts/qa/assets/asset-report.json`

Verified assets:

- FT-172 aircraft: 8,304 triangles, 14 materials, 489,416 bytes
- Airfield kit: 29,928 triangles, 16 materials, 1,038,304 bytes
- No external URI dependencies
- No third-party mesh, texture, branding or registration

The hero aircraft is the original **Flareway Trainer FT-172**, a logo-free high-wing four-seat trainer in the broad Cessna 172 class. It is not an official Cessna/Skyhawk product. Never add Cessna, Skyhawk, Textron, Garmin, Lycoming, real registration numbers, copied liveries, logos or badges.

## PRODUCT DIRECTION

This must feel like a game with immediate purpose, stakes, consequences and replayability, not a technical demo.

The game has two first-class activities:

1. **Landing Challenge**, the primary and default mode.
2. **Takeoff Practice**, the secondary mode.

Landing is the core pleasure. The player should want to retry immediately to improve touchdown softness, runway alignment and rollout control.

### Landing Challenge

Spawn the aircraft established on final approach for the active runway, approximately 1.2 to 1.5 nautical miles from the threshold and roughly 450 to 600 ft AGL. The exact spawn should be deterministic from the condition seed.

The player must:

- maintain a stabilized approach;
- manage airspeed with pitch and throttle;
- use flaps;
- correct for crosswind drift;
- stay aligned with the runway centerline;
- round out and flare at the correct height;
- touch the main wheels first;
- lower the nosewheel under control;
- remain on the runway throughout rollout;
- brake without skidding or departing the pavement.

Allow a go-around at any time. A go-around is good judgment, not a failure. It resets the aircraft to a safe final approach with the same conditions after a brief transition.

### Takeoff Practice

Start stopped and aligned on the runway centerline with the engine running at idle.

The player must:

- smoothly apply power;
- use rudder/nosewheel steering to hold the centerline;
- accelerate through a readable rotate-speed band;
- raise the nose without striking the tail;
- lift off cleanly;
- establish a positive climb while remaining over the runway heading;
- avoid premature rotation, wheelbarrowing and runway excursion.

The basic feel is: throttle up, aircraft accelerates, controls become more effective with airspeed, rotate around a simplified game target near 55 KIAS, then climb around a simplified 70 to 80 KIAS target. These are game values, not certified operating data.

## RANDOM WIND AND CONDITIONS

Wind is always a meaningful gameplay force. Every run receives a deterministic condition code/seed.

Provide at least four condition presets:

- **Calm:** 0 to 3 kt, minimal gust spread.
- **Breezy:** 4 to 8 kt, moderate crosswind component.
- **Gusty:** 7 to 12 kt with a 2 to 5 kt gust spread and smoothly changing direction.
- **Challenge:** up to approximately 15 kt, stronger crosswind and occasional turbulence, clearly labeled as difficult.

Requirements:

- Randomize wind direction, base speed, gust amplitude and gust timing from a seed.
- Use smooth deterministic noise, not frame-to-frame random jitter.
- Animate `WindsockPivot` to point downwind and deform/oscillate `WindsockSleeve` based on speed/gusts.
- Select Runway 09 or 27 to avoid a large tailwind in normal presets.
- Challenge mode may deliberately include a small tailwind, but disclose it before start.
- Apply wind to air mass, groundspeed, crab angle, crosswind drift, weathervaning on the ground and gust response.
- Do not fake wind only as a HUD number.
- Display wind direction/speed/gust before the player starts and in a compact HUD.
- Show the deterministic condition code so the same run can be replayed or shared.

## SIMULATION CONTRACT

Use a deterministic fixed-step simulation independent from rendering. Keep it approachable but physically coherent.

Implement a simplified small-airplane model with at least:

- world position and velocity in 3D;
- pitch, roll and yaw attitude;
- angular rates;
- airspeed versus groundspeed;
- lift driven by airspeed squared, wing area, angle of attack and flap state;
- drag including parasite and induced components;
- propeller thrust driven by throttle and airspeed;
- gravity and mass;
- pitch/roll/yaw control authority that increases with airspeed;
- trim-neutral or stable pitch tendency appropriate for an accessible game;
- stall onset and buffet near critical angle of attack;
- ground effect close to the runway;
- crosswind drift and rudder/crab/slip response;
- fixed tricycle landing-gear contacts;
- spring/damper response for each gear contact;
- tire lateral friction and braking;
- runway versus grass rolling resistance;
- bounce from excessive vertical impact energy;
- prop strike, tail strike and wingtip strike checks;
- runway excursion detection.

Do not implement a full professional flight simulator. Prioritize predictable, tunable, satisfying behavior and clear visual feedback. Keep all coefficients centralized and covered by deterministic tests.

### Ground and touchdown contacts

Use the authored contact anchors:

- `MainGearContact_L`
- `MainGearContact_R`
- `NoseGearContact`
- `TailStrikePoint`

The aircraft should not be represented by one ground-point or one bounding box. Detect first contact, main-wheel versus nose-wheel order, vertical sink rate, lateral velocity, bank angle and yaw misalignment.

### Suggested simplified speed bands

These are recreational game targets only:

- stall warning begins roughly 43 to 48 KIAS depending on flap state;
- rotate target around 55 KIAS;
- initial climb target roughly 70 to 80 KIAS;
- normal final target roughly 60 to 70 KIAS depending on wind/flaps;
- touchdown normally occurs below final-approach speed after flare.

Tune by play feel and deterministic test expectations. Do not market any number as real-aircraft operating guidance.

## LANDING SCORE AND CONSEQUENCES

Score a completed landing out of 1,000 points. Keep the calculation transparent and show a breakdown.

Suggested weighting:

- **Touchdown softness:** 400
- **Centerline accuracy:** 200
- **Yaw/runway alignment and side-load:** 150
- **Stabilized final approach:** 150
- **Rollout/runway remaining:** 100

Record at first main-wheel contact:

- vertical speed in ft/min and m/s;
- lateral velocity;
- centerline offset;
- heading/yaw error relative to runway;
- bank angle;
- pitch attitude;
- indicated airspeed;
- touchdown point beyond threshold;
- whether mains or nosewheel contacted first.

Use understandable result labels such as:

- **Butter**
- **Smooth**
- **Firm**
- **Hard landing**
- **Bounce**
- **Side-loaded**
- **Off centerline**
- **Runway excursion**

Reasonable game bands may begin around:

- Butter: approximately 0 to 120 ft/min downward, aligned and on centerline
- Smooth: approximately 120 to 240 ft/min
- Firm: approximately 240 to 400 ft/min
- Hard: above approximately 400 ft/min

Do not score sink rate alone. A very low sink rate with excessive float, side-load, nosewheel-first contact or runway excursion must not receive a perfect result.

Failures/consequences:

- Leaving the paved runway during takeoff or rollout ends the attempt.
- Severe touchdown can collapse/damage gear or prop and ends the attempt.
- Stall impact, prop strike, tail strike or wingtip strike ends the attempt.
- Minor bounce remains recoverable if the player controls it.
- Running out of runway ends the attempt.

After every attempt, show:

- score and grade;
- touchdown metrics;
- centerline plot or lateral-offset summary;
- what most reduced the score;
- instant Retry same conditions;
- New conditions;
- Return to title.

Add a short 5 to 8 second replay from a runway-side camera, with optional slow motion around first contact. Do not force the replay if the player presses Retry.

## PAPI, RUNWAY AND AIRFIELD

Load `public/assets/airport/field-kit.glb`.

Use authored nodes:

- `Runway`
- `RunwayMarkings`
- `RunwayLights`
- `PAPI`
- `PAPI_1_White/Red` through `PAPI_4_White/Red`
- `WindsockPivot`
- `WindsockSleeve`
- `TreeTemplate_Deciduous`
- `TreeTemplate_Conifer`
- `FenceSegmentTemplate`
- `AirportBeacon`
- `BeaconHead`

PAPI behavior:

- Four white: too high.
- Three white / one red: slightly high.
- Two white / two red: on glide path.
- One white / three red: slightly low.
- Four red: too low.

Calculate PAPI indication from aircraft eye/camera position relative to the PAPI and threshold, using a nominal 3-degree glide path. Avoid flickering at boundaries by using small hysteresis.

Airfield rendering:

- Preserve the fictional Runway 09/27 layout.
- Instance trees, fence sections and repeated runway lights where useful.
- Add procedural terrain variation, distant tree line and atmospheric perspective without changing the authored runway dimensions.
- Keep the runway, centerline, threshold, aiming blocks and edge lights readable from final approach.
- Add subtle tire marks near the touchdown zone and grass color variation procedurally.
- Do not copy a real airport.

## AIRCRAFT ASSET INTEGRATION

Load `public/assets/aircraft/ft172-trainer.glb` through Three.js `GLTFLoader`.

Required nodes:

- `AircraftRoot`
- `Fuselage`
- `WingStatic`
- `Aileron_L`, `Aileron_R`
- `Flap_L`, `Flap_R`
- `Elevator`
- `Rudder`
- `Propeller`
- `NoseWheelSteer`, `NoseWheel`, `MainWheel_L`, `MainWheel_R`
- `CG`, `PilotCamera`, `ChaseCamera`
- all four ground/strike anchors listed above

Animate:

- ailerons opposite each other from roll input;
- elevator from pitch input;
- rudder and nosewheel steering from yaw input on the ground;
- flaps through discrete positions;
- propeller from engine RPM;
- wheels from ground speed;
- suspension visually from contact compression if practical.

The authored exterior `Fuselage` is a closed shell. In cockpit camera mode, hide only `Fuselage` for that camera/view and keep instrument panel, yokes, windows, cowling-related children and control surfaces visible. Restore it atomically when leaving cockpit view. Do not delete or globally detach the node.

Keep a procedural low-detail fallback aircraft and runway so asset-load failure never blocks play. Show the GLB on normal/high quality; low quality may use fallback deliberately.

## CONTROLS

Desktop keyboard defaults:

- `W` / `S`: throttle increase/decrease; throttle holds position
- `A` / `D`: roll left/right in flight; coordinated nosewheel/rudder steering on ground
- `Up` / `Down`: pitch down/up or use a clearly documented aviation-style inversion setting
- `Q` / `E`: rudder left/right
- `F` / `G`: flaps down/up through discrete steps
- `Space`: wheel brakes
- `C`: cycle camera
- `R`: instant retry after result/failure
- `Esc`: pause

Add gamepad support:

- left stick: pitch/roll
- triggers or right stick: rudder
- throttle on shoulder/buttons or right-stick vertical in an accessible mode
- buttons for flaps, brakes, camera and pause

Controls must be remappable in Settings. Provide separate settings for pitch inversion, coordinated-rudder assist, stability assist and arcade versus manual throttle.

Default assists should make the game approachable without flying itself:

- mild pitch stability;
- mild coordinated-rudder assist;
- optional centerline guidance overlay;
- optional approach path marker;
- assists visibly labeled and removable.

## CAMERA AND FEEDBACK

Provide at least:

- chase camera;
- cockpit/pilot camera at `PilotCamera`;
- runway-side cinematic camera;
- replay camera;
- optional top-down/debug camera only under `?test=1`.

Landing feedback should be tactile and readable:

- suspension compression;
- tire chirp and brief smoke on contact;
- camera vibration proportional to impact, with reduced-motion support;
- prop and engine audio responding to RPM/load;
- wind noise responding to airspeed;
- stall buffet and warning cue;
- grass rumble on excursion;
- PAPI, windsock and runway centerline remain visible.

Do not overuse screen shake. A butter landing should feel quiet and controlled; a hard landing should feel heavy.

## UI AND GAME FLOW

Use a polished title screen with **Landing Challenge selected by default**, followed by Takeoff Practice.

Primary flow:

1. Title
2. Select Landing or Takeoff
3. Select condition preset and seed
4. Start immediately
5. Fly the attempt
6. Result/replay
7. Retry same conditions or randomize

Add an optional **Tutorial** button that opens an accessible scrollable popup. Tutorial never auto-opens and is not required.

Tutorial sections:

- Controls
- Airspeed, pitch and throttle
- Crosswind/crab/slip in simple language
- PAPI colors
- Flare and touchdown
- Go-around
- Runway centerline and excursion

HUD should be compact and readable, not an avionics wall. Include:

- KIAS
- altitude AGL
- vertical speed
- heading/runway
- throttle
- flap position
- wind/gust
- slip/skid cue
- compact approach-stability state
- centerline deviation near the runway

Do not show landing score during the approach. Score only after touchdown/rollout or failure.

Add the disclaimer prominently but concisely:

> Recreational game, not flight training or an aircraft operating guide. Simplified fictional physics and performance.

## TECHNOLOGY

Use the same proven browser-native architecture as Steerageway unless this repository already contains a stronger compatible setup:

- TypeScript strict mode
- Three.js r186 or current compatible pinned version
- Vite
- WebGL 2 baseline
- HTML/CSS UI outside the canvas
- Vitest
- Playwright Chrome and WebKit
- deterministic fixed-step simulation

Do not use Unreal Pixel Streaming, Unity WebGL, WebGPU-only rendering, a backend, database, login, analytics, AI API, paid service or external runtime asset CDN.

Everything must run locally and deploy as a static site.

## PERFORMANCE BUDGET

Normal quality target on Apple Silicon/mid-range desktop:

- 60 fps minimum; aim for 120 fps on the current development Mac
- <= 220 draw calls in the representative landing scene
- <= 750,000 visible triangles
- device pixel ratio capped by quality preset
- instancing for repeated lights, trees, fence and grass/detail props
- load both provided GLBs without external network dependencies
- no unbounded allocations in the frame loop

Provide Low, Normal and High presets. Low may use procedural fallback and fewer environment instances.

## TDD AND REQUIRED TESTS

Use strict RED-GREEN-REFACTOR. Write focused failing tests before each behavior slice and record RED/GREEN evidence in `DEVELOPMENT_LOG.md`.

Required deterministic unit coverage:

- seed creates repeatable wind/gust sequence;
- different seeds create different fair conditions;
- runway selection avoids strong tailwind in normal modes;
- lift increases with airspeed squared in the expected range;
- stall reduces lift/increases sink and is recoverable with nose-down/airspeed;
- flap changes lift/drag and target approach feel;
- controls gain authority with airspeed;
- crosswind produces drift and crab/slip response;
- ground contacts use all three gear anchors;
- main-wheel-first versus nosewheel-first contact;
- sink-rate/bounce response;
- runway versus grass friction;
- braking and runway excursion;
- tail/prop/wingtip strike;
- PAPI red/white states and hysteresis;
- landing score rewards softness, centerline and alignment together;
- excessive float cannot score perfectly;
- takeoff rotation and liftoff only after sufficient airspeed;
- fixed-step result is independent of render frame cadence;
- pause/retry/new-seed state transitions.

Required browser E2E in Chrome and WebKit:

- production build boots WebGL 2;
- title defaults to Landing Challenge;
- Tutorial opens at heading, keyboard reaches Back, short viewport scroll works;
- Landing starts directly on final with no mandatory tutorial;
- deterministic assisted soft-landing scenario completes and scores;
- hard landing shows correct consequence;
- runway excursion fails;
- go-around resets safely;
- Takeoff mode accelerates, rotates and lifts off;
- control-surface nodes animate;
- cockpit/chase camera cycle works and Fuselage visibility restores;
- PAPI and windsock react to the seeded condition;
- blocked aircraft GLB falls back without breaking play;
- blocked airfield GLB falls back without breaking play;
- normal public build does not expose test/devtools API;
- test API exists only with `?test=1`.

Hosted CI should use one focused truthful WebGL smoke test, while the full Chrome/WebKit suite runs locally.

## VISUAL QA

Do not declare completion from tests alone.

Capture and inspect at least:

- title with Landing default;
- calm final approach;
- crosswind final approach;
- cockpit view;
- flare just before contact;
- main-wheel touchdown;
- runway rollout;
- runway excursion/failure;
- takeoff roll;
- rotation/liftoff;
- result/replay screen;
- Tutorial at 1280x633 and 1600x900.

Check console/network errors, GLB node binding, control-surface directions, wheel contact, runway scale, PAPI transitions, windsock direction and visual clipping.

## FILES AND DOCUMENTATION

Create or update:

- `package.json`, Vite/TypeScript/test configs
- `src/sim/**` deterministic simulation modules
- `src/render/**` Three.js renderer and asset integration
- `src/ui/**` title, HUD, settings, tutorial, results and replay UI
- `src/input/**` keyboard/gamepad mapping
- `tests/unit/**`
- `tests/e2e/**`
- `.github/workflows/ci.yml`
- `README.md`
- `DEVELOPMENT_LOG.md`

Preserve:

- existing Blender generator and source assets;
- `ASSET_BRIEF.md`;
- `ASSET_LICENSES.md`;
- `SOURCES.md`;
- `PORTFOLIO_RELEASE_PLAN.md`;
- this prompt.

README must explain controls, modes, disclaimer, local commands, asset regeneration, tests and architecture.

## SAFETY AND SCOPE

- This is a recreational game, not real flight instruction.
- Do not claim FAA approval, certification, realistic POH performance or training value.
- Do not add real manufacturer branding.
- Do not add people/human models.
- Do not add combat, crashes for spectacle, passengers or unrelated open-world scope.
- Do not add a backend, accounts, monetization or telemetry.
- Do not touch Steerageway or TheGridBase repositories.
- Do not push, deploy, create a GitHub repository, configure Vercel, Cloudflare or a domain. Friday will handle release after user acceptance.

## GIT DISCIPLINE

- Work on a new local feature branch created from the current prepared asset commit.
- Keep commits reversible and conventional.
- Never force-push or rewrite prepared asset history.
- Do not commit secrets, `.env`, Claude logs, local Vercel metadata, bulk test output or machine-specific caches.

## DONE WHEN

The task is complete only when:

- both Landing Challenge and Takeoff Practice are genuinely playable;
- landing is the default and most polished loop;
- random seeded wind materially changes flight and runway handling;
- the player can make a butter landing, hard landing, bounce and runway excursion through real simulation state;
- the provided GLBs load and every required animated node is bound correctly;
- fallback works;
- deterministic tests, lint, strict typecheck, build and full Chrome/WebKit suite pass;
- real browser visual QA is complete;
- the user has a local production preview URL to test;
- changes are committed locally but not pushed or deployed;
- remaining realism limitations are stated honestly.

Deliver the complete working artifact. Do not stop at a plan, architecture, stub or greybox. Do not ask avoidable questions; make reasonable assumptions, document them and verify the result with real execution.

---
