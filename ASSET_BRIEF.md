# Flareway Asset Brief

## Product boundary

Flareway is a browser-native recreational takeoff and landing game. It is not flight training, not a flight dynamics certification tool, and not a substitute for instruction or an aircraft POH.

## Hero aircraft

The runtime aircraft is the original **Flareway Trainer FT-172**, a logo-free high-wing, four-seat, fixed-tricycle-gear trainer inspired by the general proportions and visual category of a Cessna 172 Skyhawk. It must never be described as an official Cessna model and must not contain Cessna, Skyhawk, Textron, real registrations, manufacturer paint schemes, or avionics branding.

### Verified dimensional envelope

- Length: 8.28 m
- Wingspan: 11.00 m
- Height: approximately 2.72 m
- Four-seat high-wing trainer configuration

Source for reference dimensions: Textron Aviation Skyhawk product card, listed in `SOURCES.md`. These dimensions establish scale only; all geometry and materials are original.

### Coordinate and animation contract

Blender authoring axes:

- +X: nose/forward
- +Y: port/left
- +Z: up
- Root origin: approximate center of gravity at the wing spar

Three.js runtime convention after glTF export:

- +X: forward
- +Y: up
- +Z: starboard/right

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
- `MainGearContact_L`, `MainGearContact_R`, `NoseGearContact`, `TailStrikePoint`

Runtime writes control deflections only to named pivot nodes. Visual rest angles belong on child meshes or parent mounts.

### Target budgets

- Aircraft LOD0: <= 45,000 triangles
- Materials: <= 16
- GLB: <= 2.5 MB
- No external URI dependencies
- No third-party meshes, textures, fonts, HDRIs, or logos
- One small generated normal map is allowed if embedded

## Island airfield kit

A fictional non-towered island training field using a 900 m x 23 m paved Runway 09/27. The runway sits on a flattened central plateau, with both approaches near the coast. The asset includes:

- irregular `IslandTerrain`;
- `BeachRing` shoreline transition;
- `OceanReferencePlane` authoring placeholder for a runtime WebGL2 ocean shader;
- `VegetationSpawns` anchors for instanced runtime trees;
- asphalt runway and shoulder;
- threshold, designation, centerline, aiming-point and edge markings;
- modular edge, threshold and approach-light geometry;
- four-box PAPI assembly with separate red/white lens nodes;
- windsock with `WindsockPivot` and `WindsockSleeve` animation nodes;
- runway/taxiway sign, cones, hangar and small apron;
- grass field base.

The runtime may recreate repeated lights and markings with instancing. The GLB is the authoritative scale/style kit.

Airfield budget after the island pass: <= 45,000 triangles, <= 20 materials and <= 3 MB. Runtime vegetation is not duplicated in the GLB; authored spawn anchors must feed `InstancedMesh` tiers.

## Visual QA

Required renders:

1. aircraft front three-quarter;
2. aircraft port profile;
3. aircraft top/control-surface view;
4. cockpit and instrument-panel detail;
5. landing gear/propeller detail;
6. runway threshold and PAPI overview;
7. stabilized final-approach view;
8. runway rollout view.
9. full island aerial overview.
