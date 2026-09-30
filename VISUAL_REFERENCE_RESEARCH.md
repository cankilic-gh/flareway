# Three.js visual reference research

Research date: 2026-09-30.

This document analyzes the exact X posts supplied by the user and converts their transferable visual techniques into a bounded Flareway rendering plan. No third-party source code, model, texture, terrain data or paid package is included in this repository.

## Reference 1: Boring Forest

- Three.js repost: https://x.com/threejs/status/2105276283815129169
- Original author post: https://x.com/AndreiProvkin/status/2105028422141428086
- Live demo: https://boring-forest.vercel.app/
- Exact media: 91.56 seconds, 1394×720, H.264, 30 fps
- Original author: Andrei Provkin

The exact author post states that the demo uses Three.js/TSL and reports a performance pass. The author measured approximately 5.6 million grass triangles per frame before identifying that about 95% were off-screen. The post reports a 26–28% GPU-time reduction after optimization, while the hottest scenes still drew roughly 45–50 W on a MacBook GPU. On the laptop's native Retina display, reported frame rate rose from approximately 24 to 49 with water filling the screen and from 32 to a 60 fps cap at spawn.

Observed visual language across the sampled video:

- dense conifer forest and layered grass;
- low camera near water/ground, which amplifies detail and scale;
- bright sun glints and coherent water reflections;
- shoreline rocks, moss, reeds, ferns and flower clusters;
- fog/atmospheric perspective hiding distant LOD transitions;
- dark forest exposure with controlled bright highlights;
- animated particles/fireflies used as focal points;
- subtle depth-of-field and bloom-like glow;
- water, vegetation, light and camera all supporting one coherent mood.

Transferable to Flareway:

- coherent sunlight, atmospheric fog and color management;
- shoreline transition with sand, rock and vegetation zones;
- instanced vegetation with frustum/distance culling;
- two-scale water normals, Fresnel, sun glint and shoreline foam;
- dense detail only near the camera/runway, simplified distant silhouettes;
- performance instrumentation and visibility-driven budgets.

Not transferable directly:

- millions of grass triangles;
- WebGPU/TSL-only baseline;
- forest darkness that would reduce runway readability;
- fireflies, fantasy mushrooms and gameplay unrelated to aviation;
- source code/assets from the demo.

## Reference 2: Water Pro island/terrain editor experiment

- Three.js repost: https://x.com/threejs/status/2105218618535628930
- Original author post: https://x.com/dangreenheck/status/2105063750822691261
- Exact media: 102.53 seconds, 1920×1080, H.264, 60 fps
- Original author: Dan Greenheck

The author describes the work as a Water Pro v4 demo that expanded into an island/terrain editor with possible terrain tools, texture painting and vegetation placement. The author explicitly discusses potentially selling it as a premium asset/starter pack. Therefore Flareway must not copy or redistribute Water Pro or editor code/assets without a separate license purchase and review.

Observed visual language:

- complete tropical island visible from aerial and ground cameras;
- procedural or editor-driven terrain height shaping;
- beach, grass and rock materials distributed by height/slope/paint masks;
- rivers/inlets connected to the surrounding ocean;
- shallow-water color and transparency variation;
- foam/caustic cues at shoreline and in water;
- instanced vegetation placed in clusters rather than uniform scatter;
- distant mountain silhouettes and atmospheric haze;
- adjustable sun, fog, water and terrain parameters;
- camera transitions between aerial overview and eye-level detail.

Transferable to Flareway:

- a fictional island with the runway on a central flattened plateau;
- runway thresholds close enough to the coast to make final approach visually dramatic;
- island terrain authored at low geometric cost, with runtime material blending;
- one ocean surface around the island;
- sand/grass/rock zones by height and slope;
- vegetation spawn anchors and `InstancedMesh` trees;
- aerial island overview for title/replay, chase view for flight and runway-side touchdown camera;
- fog/haze, sky and sun tuned as one lighting system.

Not transferable directly:

- Water Pro or any paid/premium implementation;
- editor UI or terrain painting tools, because Flareway is a game rather than a terrain editor;
- WebGPU-only shaders;
- excessive vegetation density that obscures approach visibility or exceeds browser budgets.

## Flareway decision

Flareway will use a **fictional island airfield**. The Blender airfield GLB now contains:

- `IslandTerrain`
- `BeachRing`
- `OceanReferencePlane`
- `VegetationSpawns`
- Runway 09/27 and all existing PAPI, windsock, light and airfield nodes

`OceanReferencePlane` is an authoring/scale placeholder. Runtime should replace its material with a performance-bounded WebGL2 ocean shader, not import third-party water code.

### WebGL2 visual pipeline

Baseline remains WebGL2 for Chrome and WebKit. WebGPU may be an optional future enhancement only; no required gameplay or visual contract can depend on it.

Recommended runtime stack:

1. `WebGLRenderer` with sRGB output, ACES filmic tone mapping and measured exposure.
2. PMREM environment lighting plus one directional sun.
3. One shadow-casting sun; fit shadow camera tightly around aircraft/runway instead of shadowing the whole island at high resolution.
4. Island terrain material blending sand, grass and rock by height/slope masks.
5. Ocean shader with two scrolling normal scales, Fresnel, depth/shore color, sun glint and cheap shoreline foam.
6. Distance fog/atmospheric haze to blend island edge and distant LODs.
7. `InstancedMesh` vegetation from authored spawn anchors; clustered species/scale/yaw variation.
8. Distance-based vegetation tiers: near geometry, mid simplified cards, far tree-line silhouette.
9. Subtle SSAO/GTAO only if measured cost fits Normal/High; no gameplay dependency.
10. Minimal post-processing: anti-aliasing and restrained bloom for runway/PAPI lights. Depth of field only during replay, never during active landing.

### Performance limits

Normal quality target:

- <= 220 draw calls in the representative landing scene;
- <= 750,000 visible triangles;
- <= 250,000 visible vegetation triangles near the runway;
- one ocean draw plus bounded reflection/normal work;
- capped device pixel ratio;
- frustum and distance culling proven with measurements;
- no recreation of the Boring Forest 5.6M-grass-triangle profile.

The strongest realism gains should come from solid PBR aircraft materials, coherent outdoor lighting, island scale, shoreline transitions, instanced vegetation, fog and contact cues rather than unrestricted polygon count.
