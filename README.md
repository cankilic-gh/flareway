# Flareway

Browser-native recreational takeoff and landing game preparation. The core game will be implemented by Claude using the original assets already produced here.

> Recreational game, not flight training or an aircraft operating guide. Simplified fictional physics and performance.

## Prepared assets

| Asset | Runtime file | Verified budget |
|---|---|---|
| Flareway Trainer FT-172 | `public/assets/aircraft/ft172-trainer.glb` | 8,304 triangles, 14 materials, 488 KB |
| Fictional Runway 09/27 field kit | `public/assets/airport/field-kit.glb` | 29,928 triangles, 16 materials, 1.04 MB |
| Editable source | `assets-src/blender/flareway-assets.blend` | Blender 5.2.1 LTS |

The FT-172 is an original, logo-free high-wing trainer in the broad Cessna 172 class. It is not an official Cessna/Skyhawk product and contains no manufacturer branding or copied livery.

## Rebuild assets

```bash
tools/blender/build-assets.sh
python3 scripts/inspect_assets.py
```

Fast QA render pass:

```bash
tools/blender/build-assets.sh --quick
```

## Claude handoff

- Full task: [`CLAUDE_GAME_BUILD_PROMPT.md`](CLAUDE_GAME_BUILD_PROMPT.md)
- Short instructions: [`CLAUDE_HANDOFF.md`](CLAUDE_HANDOFF.md)
- Asset contract: [`ASSET_BRIEF.md`](ASSET_BRIEF.md)
- Sources: [`SOURCES.md`](SOURCES.md)
- Licenses: [`ASSET_LICENSES.md`](ASSET_LICENSES.md)

## Planned product

- Landing Challenge is the default and primary mode.
- Takeoff Practice is the secondary mode.
- Deterministic random wind, crosswind and gust conditions.
- Soft-touchdown, centerline, alignment and rollout scoring.
- PAPI, windsock, runway lights and fictional airfield.
- Optional Tutorial, no forced training flow.
- Static browser deployment with WebGL 2, Chrome and WebKit coverage.

## Release boundary

Claude should build and verify locally but must not push or deploy. GitHub, Vercel, `flareway.thegridbase.com`, public QA and the later Steerageway/Flareway TheGridBase portfolio update are reserved for Friday after user acceptance. See [`PORTFOLIO_RELEASE_PLAN.md`](PORTFOLIO_RELEASE_PLAN.md).
