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

### Verified runtime budgets

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
