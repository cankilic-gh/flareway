import {
  BufferAttribute,
  DataTexture,
  FloatType,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Frustum,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Line,
  LineDashedMaterial,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  Raycaster,
  Sphere,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createGlowPoints, createOceanMaterial, createTerrainMaterial, patchRunwayMaterial, type GlowPoints, type OceanUniforms } from './shaders';
import type { QualityPreset } from './quality';
import { RUNWAYS, sampleGround, type RunwayId } from '../sim/airfield';
import { createRng } from '../sim/rng';
import type { WindReadout } from '../sim/wind';
import { DEG } from '../sim/constants';

const DYNAMIC_ROOTS = new Set([
  'IslandTerrain',
  'BeachRing',
  'OceanReferencePlane',
  'VegetationSpawns',
  'PAPI',
  'WindsockPivot',
  'AirportBeacon',
  'TreeTemplate_Deciduous',
  'TreeTemplate_Conifer',
  'FenceSegmentTemplate',
]);

export interface PapiView {
  white: Mesh[];
  red: Mesh[];
  glowIndex: number;
}

export interface VegetationStats {
  total: number;
  nearVisible: number;
  farVisible: number;
  culled: number;
  nearTriangles: number;
  farTriangles: number;
}

interface Tree {
  pos: Vector3;
  scale: number;
  yaw: number;
  kind: 0 | 1;
  color: Color;
  radius: number;
}

const WHITE = new Color(1.0, 0.95, 0.85);
const RED = new Color(1.0, 0.12, 0.08);
const GREEN = new Color(0.25, 1.0, 0.35);

const stripForMerge = (g: BufferGeometry): BufferGeometry => {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes['normal']) g.computeVertexNormals();
  return g;
};

const mergeTemplate = (template: Object3D, colorFor: (mesh: Mesh) => Color): BufferGeometry | null => {
  template.updateMatrixWorld(true);
  const inv = new Matrix4().copy(template.matrixWorld).invert();
  const parts: BufferGeometry[] = [];
  template.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    let g = stripForMerge(m.geometry.clone());
    g.applyMatrix4(new Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    const c = colorFor(m);
    const n = g.attributes['position']!.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new BufferAttribute(col, 3));
    parts.push(g);
  });
  return parts.length ? mergeGeometries(parts) : null;
};

const colorize = (g: BufferGeometry, c: Color): BufferGeometry => {
  let geo = g.index ? g.toNonIndexed() : g;
  geo = stripForMerge(geo);
  const n = geo.attributes['position']!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new BufferAttribute(col, 3));
  return geo;
};

/**
 * Soft crown lighting: blend the normals of crown-coloured vertices toward the direction from the crown centre,
 * so a low-poly canopy lights as one rounded volume instead of a cluster of facets.
 */
const softenCrown = (g: BufferGeometry, crown: Color, amount = 0.6): BufferGeometry => {
  if (!g.attributes['normal']) g.computeVertexNormals();
  const pos = g.attributes['position'] as BufferAttribute;
  const nor = g.attributes['normal'] as BufferAttribute;
  const col = g.attributes['color'] as BufferAttribute;
  const isCrown = (i: number) => Math.abs(col.getX(i) - crown.r) + Math.abs(col.getY(i) - crown.g) + Math.abs(col.getZ(i) - crown.b) < 1e-4;
  const center = new Vector3();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (!isCrown(i)) continue;
    center.x += pos.getX(i);
    center.y += pos.getY(i);
    center.z += pos.getZ(i);
    n++;
  }
  if (n === 0) return g;
  center.divideScalar(n);
  const p = new Vector3();
  const nv = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (!isCrown(i)) continue;
    p.set(pos.getX(i) - center.x, (pos.getY(i) - center.y) * 1.2, pos.getZ(i) - center.z).normalize();
    nv.set(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(p, amount).normalize();
    nor.setXYZ(i, nv.x, nv.y, nv.z);
  }
  nor.needsUpdate = true;
  return g;
};

/** Angular samples of the visible waterline (normalised island radius per angle). */
export const SHORE_SAMPLES = 256;

/**
 * Visible waterline per angle, found the way the renderer sees it: march outward along each angle and raycast
 * down onto the land meshes; the first point that misses or falls below the sea is the waterline. The ocean's
 * swash band and the terrain's wet band read this, so they hug the shore the player actually sees.
 */
export const measureShoreline = (meshes: (Mesh | undefined)[], seaY: number): DataTexture => {
  const land = meshes.filter((m): m is Mesh => !!m?.isMesh);
  const data = new Float32Array(SHORE_SAMPLES);
  const ray = new Raycaster();
  const down = new Vector3(0, -1, 0);
  const origin = new Vector3();
  for (const m of land) m.updateMatrixWorld(true);
  for (let i = 0; i < SHORE_SAMPLES; i++) {
    const a = (i / SHORE_SAMPLES) * Math.PI * 2;
    const irr = 1 + 0.045 * Math.sin(a * 5 + 0.8) + 0.025 * Math.sin(a * 11);
    const yIrr = 1 + 0.035 * Math.cos(a * 7);
    let edge = 1.06;
    for (let r = 0.86; r <= 1.06; r += 0.002) {
      const x = Math.cos(a) * 590 * irr * r;
      const yB = Math.sin(a) * 260 * irr * yIrr * r;
      origin.set(x, 400, -yB);
      ray.set(origin, down);
      const hit = ray.intersectObjects(land, false)[0];
      if (!hit || hit.point.y < seaY + 0.02) {
        edge = r;
        break;
      }
    }
    data[i] = edge;
  }
  // Rocks, spits and ray misses make single-angle spikes: a circular median, then two box passes, keep the
  // surf lines smooth around the island.
  const n = SHORE_SAMPLES;
  const med = new Float32Array(n);
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    win.length = 0;
    for (let k = -5; k <= 5; k++) win.push(data[(i + k + n) % n]!);
    win.sort((x, y) => x - y);
    med[i] = Math.min(Math.max(win[5]!, 0.96), 1.05);
  }
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? med : data;
    const dst = pass === 0 ? data : med;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -4; k <= 4; k++) sum += src[(i + k + n) % n]!;
      dst[i] = sum / 9;
    }
  }
  data.set(med);
  const tex = new DataTexture(data, SHORE_SAMPLES, 1, RedFormat, FloatType);
  tex.wrapS = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

/** Adds gentle wind sway to instanced vegetation. */
const swayMaterial = (uniforms: { uTime: { value: number } }, amount: number, foliage = false): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float seed = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
          float sway = sin(uTime * 1.3 + seed) * 0.6 + sin(uTime * 2.7 + seed * 1.7) * 0.25;
          transformed.x += sway * ${amount.toFixed(3)} * max(transformed.y, 0.0) * max(transformed.y, 0.0);
          transformed.z += sway * ${(amount * 0.6).toFixed(3)} * max(transformed.y, 0.0) * max(transformed.y, 0.0);
        #endif`,
      )
      .replace('#include <common>', '#include <common>\nvarying vec3 vSwWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 sw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            sw = instanceMatrix * sw;
          #endif
          vSwWorld = (modelMatrix * sw).xyz;
        }`,
      );
    // Leaf-cluster breakup for tree crowns: world-space value noise gives each instance its own gaps and clumps.
    if (foliage) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vSwWorld;
          float swHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
          float swNoise(vec3 p) {
            vec3 i = floor(p), f = fract(p);
            vec3 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(swHash(i), swHash(i + vec3(1, 0, 0)), u.x), mix(swHash(i + vec3(0, 1, 0)), swHash(i + vec3(1, 1, 0)), u.x), u.y),
                       mix(mix(swHash(i + vec3(0, 0, 1)), swHash(i + vec3(1, 0, 1)), u.x), mix(swHash(i + vec3(0, 1, 1)), swHash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float clump = swNoise(vSwWorld * 1.6) * 0.65 + swNoise(vSwWorld * 4.1) * 0.35;
            float crownish = step(vColor.r * 1.4, vColor.g);
            diffuseColor.rgb *= mix(1.0, 0.68 + 0.6 * smoothstep(0.25, 0.8, clump), crownish);
          }`,
        );
    } else {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSwWorld;');
    }
  };
  m.customProgramCacheKey = () => `sway-${amount}-${foliage ? 'f' : 'g'}`;
  return m;
};

export class AirfieldView {
  readonly root: Group;
  readonly isFallback: boolean;
  readonly ocean: Mesh;
  readonly oceanUniforms: OceanUniforms;
  readonly glow: GlowPoints;
  readonly glowPoints: Points;
  readonly papis: Record<RunwayId, PapiView>;
  readonly windsockPivot: Object3D | null;
  readonly windsockSleeve: Object3D | null;
  readonly beaconHead: Object3D | null;
  readonly vegetationStats: VegetationStats = { total: 0, nearVisible: 0, farVisible: 0, culled: 0, nearTriangles: 0, farTriangles: 0 };
  readonly boundNodes: string[] = [];
  readonly guidance: Line;
  private readonly thresholdGroups: { west: Mesh | null; east: Mesh | null } = { west: null, east: null };
  private readonly thresholdGlow: { start: number; count: number; x: number }[] = [];
  private approachGlow: { start: number; count: number; runway: RunwayId } [] = [];
  private beaconGlowIndex = -1;
  private trees: Tree[] = [];
  private nearMeshes: InstancedMesh[] = [];
  private farMeshes: InstancedMesh[] = [];
  private nearTris = [0, 0];
  private farTris = [0, 0];
  private readonly swayUniforms = { uTime: { value: 0 } };
  private cullFrame = 0;
  private activeRunway: RunwayId = '09';
  private readonly greenMat = new MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 5 });
  private readonly redMat = new MeshStandardMaterial({ color: RED, emissive: RED, emissiveIntensity: 5 });

  constructor(source: Group, q: QualityPreset) {
    this.root = source;
    this.isFallback = source.userData['fallback'] === true;
    source.updateMatrixWorld(true);
    for (const name of ['IslandTerrain', 'BeachRing', 'OceanReferencePlane', 'VegetationSpawns', 'Runway', 'RunwayMarkings', 'RunwayLights', 'PAPI', 'WindsockPivot', 'WindsockSleeve', 'TreeTemplate_Deciduous', 'TreeTemplate_Conifer', 'FenceSegmentTemplate', 'AirportBeacon', 'BeaconHead']) {
      if (source.getObjectByName(name)) this.boundNodes.push(name);
    }
    for (let i = 1; i <= 4; i++) for (const c of ['White', 'Red']) if (source.getObjectByName(`PAPI_${i}_${c}`)) this.boundNodes.push(`PAPI_${i}_${c}`);

    // Terrain and beach share the height/slope blended material; the wet swash band runs on the ocean's clock.
    const oceanMat = createOceanMaterial();
    const terrainMat = createTerrainMaterial(oceanMat.uniforms.uTime, oceanMat.uniforms.uShore);
    for (const name of ['IslandTerrain', 'BeachRing']) {
      const m = source.getObjectByName(name) as Mesh | undefined;
      if (m?.isMesh) {
        m.material = terrainMat;
        m.receiveShadow = true;
        m.castShadow = false;
      }
    }

    // Ocean: keep the authored node and its transform; replace the placeholder material with the ocean shader and
    // extend its geometry to the horizon so final approach is flown over water.
    this.oceanUniforms = oceanMat.uniforms;
    let ocean = source.getObjectByName('OceanReferencePlane') as Mesh | undefined;
    if (!ocean?.isMesh) {
      ocean = new Mesh();
      ocean.name = 'OceanReferencePlane';
      ocean.position.set(0, -2.55, 0);
      source.add(ocean);
    }
    const plane = new PlaneGeometry(60000, 60000, 1, 1);
    plane.rotateX(-Math.PI / 2);
    plane.translate(0, 0.06, 0);
    ocean.geometry.dispose();
    ocean.geometry = plane;
    ocean.material = oceanMat;
    // Key the shoreline effects to the waterline as rendered (the ocean node's height plus the plane offset).
    ocean.updateMatrixWorld(true);
    const seaY = new Vector3(0, 0.06, 0).applyMatrix4(ocean.matrixWorld).y;
    // Lagoon caustics and surf lace are skipped on Low.
    oceanMat.uniforms['uShoreDetail']!.value = q.id === 'low' ? 0 : 1;
    oceanMat.uniforms.uShore.value = measureShoreline(
      [source.getObjectByName('IslandTerrain') as Mesh | undefined, source.getObjectByName('BeachRing') as Mesh | undefined],
      seaY,
    );
    ocean.receiveShadow = false;
    ocean.castShadow = false;
    ocean.renderOrder = -1;
    this.ocean = ocean;

    // Runway surface detail and marking depth offset.
    const runway = source.getObjectByName('Runway') as Mesh | undefined;
    if (runway?.isMesh) {
      const rm = (runway.material as MeshStandardMaterial).clone();
      patchRunwayMaterial(rm);
      runway.material = rm;
    }
    source.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mat = m.material as MeshStandardMaterial;
      if (mat.name === 'Runway_Marking') {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -4;
      }
      if (mat.name?.startsWith('Light_')) mat.toneMapped = false;
      if (mat.name === 'Runway_Asphalt' || mat.name === 'Runway_Shoulder' || mat.name === 'Apron_Concrete') mat.envMapIntensity = 0.45;
    });

    // Glow points: runway edge, thresholds, approach lights (both ends), PAPI x2, beacon.
    const lensWorld: { pos: Vector3; color: Color; size: number; kind: string; x: number }[] = [];
    const lights = source.getObjectByName('RunwayLights');
    lights?.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const p = new Vector3();
      o.getWorldPosition(p);
      if (o.name.startsWith('EdgeLightLens')) lensWorld.push({ pos: p, color: WHITE, size: 0.55, kind: 'edge', x: p.x });
      else if (o.name.startsWith('ThresholdLight')) lensWorld.push({ pos: p, color: p.x < 0 ? GREEN : RED, size: 0.6, kind: 'threshold', x: p.x });
      else if (o.name.startsWith('ApproachLight')) lensWorld.push({ pos: p, color: WHITE, size: 0.7, kind: 'approach09', x: p.x });
    });
    const approach27 = lensWorld.filter((l) => l.kind === 'approach09').map((l) => ({ ...l, pos: new Vector3(-l.pos.x, l.pos.y, -l.pos.z), kind: 'approach27', x: -l.x }));
    lensWorld.push(...approach27);
    const glowCount = lensWorld.length + 8 + 1;
    this.glow = createGlowPoints(glowCount);
    lensWorld.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.x - b.x));
    lensWorld.forEach((l, i) => {
      this.glow.positions.set([l.pos.x, l.pos.y + 0.05, l.pos.z], i * 3);
      this.glow.colors.set([l.color.r, l.color.g, l.color.b], i * 3);
      this.glow.sizes[i] = l.size;
    });
    for (const x of [-1, 1]) {
      const idxs = lensWorld.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'threshold' && Math.sign(l.x) === x);
      if (idxs.length) this.thresholdGlow.push({ start: idxs[0]!.i, count: idxs.length, x });
    }
    for (const rw of ['09', '27'] as const) {
      const idxs = lensWorld.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === `approach${rw}`);
      if (idxs.length) this.approachGlow.push({ start: idxs[0]!.i, count: idxs.length, runway: rw });
    }

    // PAPI: authored unit for 09, mirrored clone for 27.
    const papi09 = source.getObjectByName('PAPI');
    this.papis = { '09': { white: [], red: [], glowIndex: lensWorld.length }, '27': { white: [], red: [], glowIndex: lensWorld.length + 4 } };
    if (papi09) {
      const papi27 = papi09.clone(true);
      papi27.name = 'PAPI_27';
      const rw27 = RUNWAYS['27'].papi;
      papi27.position.set(rw27.x, 0, rw27.z);
      papi27.rotation.y = Math.PI;
      papi09.parent?.add(papi27);
      papi27.updateMatrixWorld(true);
      for (const [id, unit] of [['09', papi09], ['27', papi27]] as const) {
        for (let i = 1; i <= 4; i++) {
          const w = unit.getObjectByName(`PAPI_${i}_White`) as Mesh | undefined;
          const r = unit.getObjectByName(`PAPI_${i}_Red`) as Mesh | undefined;
          if (w && r) {
            this.papis[id].white.push(w);
            this.papis[id].red.push(r);
            const p = new Vector3();
            w.getWorldPosition(p);
            const rp = new Vector3();
            r.getWorldPosition(rp);
            p.add(rp).multiplyScalar(0.5);
            const gi = this.papis[id].glowIndex + i - 1;
            this.glow.positions.set([p.x, p.y + 0.05, p.z], gi * 3);
            this.glow.sizes[gi] = 1.1;
          }
        }
      }
    }
    this.beaconGlowIndex = glowCount - 1;
    this.glow.sizes[this.beaconGlowIndex] = 1.4;
    this.glowPoints = new Points(this.glow.geometry, this.glow.material);
    this.glowPoints.frustumCulled = false;
    this.glowPoints.renderOrder = 10;
    source.add(this.glowPoints);

    this.windsockPivot = source.getObjectByName('WindsockPivot') ?? null;
    this.windsockSleeve = source.getObjectByName('WindsockSleeve') ?? null;
    this.beaconHead = source.getObjectByName('BeaconHead') ?? null;

    // Threshold lens meshes: two merged groups so colours swap with the active runway.
    this.mergeThresholdLenses();
    // Static merge by material for everything that does not animate.
    this.mergeStatics();

    // Vegetation, fence, grass tufts.
    this.buildVegetation(q);
    this.buildFence();
    if (q.grassTufts > 0) this.buildGrass(q.grassTufts);

    // Extended centerline guidance (optional overlay).
    const gGeo = new BufferGeometry().setFromPoints([new Vector3(-450, 0.3, 0), new Vector3(-3200, -2.2, 0)]);
    this.guidance = new Line(gGeo, new LineDashedMaterial({ color: 0x5fe3ff, dashSize: 30, gapSize: 30, transparent: true, opacity: 0.75 }));
    this.guidance.computeLineDistances();
    this.guidance.frustumCulled = false;
    source.add(this.guidance);
  }

  private mergeThresholdLenses(): void {
    const lights = this.root.getObjectByName('RunwayLights');
    if (!lights) return;
    const west: BufferGeometry[] = [];
    const east: BufferGeometry[] = [];
    const remove: Object3D[] = [];
    lights.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.name.startsWith('ThresholdLight')) return;
      let g = stripForMerge(m.geometry.clone()).applyMatrix4(m.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      const p = new Vector3();
      m.getWorldPosition(p);
      (p.x < 0 ? west : east).push(g);
      remove.push(m);
    });
    for (const m of remove) m.removeFromParent();
    if (west.length) {
      this.thresholdGroups.west = new Mesh(mergeGeometries(west), this.greenMat);
      this.root.add(this.thresholdGroups.west);
    }
    if (east.length) {
      this.thresholdGroups.east = new Mesh(mergeGeometries(east), this.redMat);
      this.root.add(this.thresholdGroups.east);
    }
  }

  private mergeStatics(): void {
    const groups = new Map<Material, BufferGeometry[]>();
    const toRemove: Mesh[] = [];
    const visit = (o: Object3D): void => {
      if (DYNAMIC_ROOTS.has(o.name) || o.name === 'PAPI_27' || o === this.glowPoints) return;
      const m = o as Mesh;
      if (m.isMesh && m !== this.ocean && m.name !== 'Runway' && !Array.isArray(m.material)) {
        let g = stripForMerge(m.geometry.clone()).applyMatrix4(m.matrixWorld);
        if (g.index) g = g.toNonIndexed();
        const list = groups.get(m.material) ?? [];
        list.push(g);
        groups.set(m.material, list);
        toRemove.push(m);
      }
      for (const c of [...o.children]) visit(c);
    };
    for (const c of [...this.root.children]) visit(c);
    for (const m of toRemove) m.removeFromParent();
    const merged = new Group();
    merged.name = 'MergedStatics';
    for (const [mat, geos] of groups) {
      const g = mergeGeometries(geos);
      if (!g) continue;
      const mesh = new Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      merged.add(mesh);
    }
    this.root.add(merged);
    const runway = this.root.getObjectByName('Runway') as Mesh | undefined;
    if (runway) {
      runway.receiveShadow = true;
      runway.castShadow = false;
    }
  }

  private allowedTree(x: number, z: number): boolean {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    if (ax < 545 && az < 88) return false;
    if (ax > 430 && az < 75 + (ax - 430) * 0.3) return false;
    if (x > 140 && x < 350 && z < -25 && z > -150) return false;
    const s = sampleGround(x, z, { height: 0, surface: 'grass' });
    return s.surface === 'terrain';
  }

  private buildVegetation(q: QualityPreset): void {
    const dec = this.root.getObjectByName('TreeTemplate_Deciduous');
    const con = this.root.getObjectByName('TreeTemplate_Conifer');
    // Linear-space vertex colours (Color(r, g, b) is not colour-managed).
    const trunk = new Color(0.07, 0.045, 0.025);
    const crownDec = new Color(0.05, 0.12, 0.028);
    const crownCon = new Color(0.028, 0.075, 0.03);
    const nearGeo: (BufferGeometry | null)[] = [
      dec ? softenCrown(mergeTemplate(dec, (m) => (m.name.includes('Trunk') ? trunk : crownDec))!, crownDec) : null,
      con ? softenCrown(mergeTemplate(con, (m) => (m.name.includes('Trunk') ? trunk : crownCon))!, crownCon, 0.45) : null,
    ];
    const farDec = new IcosahedronGeometry(2.2, 0);
    farDec.scale(1, 1.15, 1).translate(0, 5.2, 0);
    const farCon = new ConeGeometry(2.1, 6.2, 6);
    farCon.translate(0, 3.6, 0);
    const farGeo = [softenCrown(colorize(farDec, crownDec), crownDec), softenCrown(colorize(farCon, crownCon), crownCon, 0.45)];
    if (dec) dec.visible = false;
    if (con) con.visible = false;

    // Clustered placement from the authored spawn anchors plus a ridge tree line.
    const rng = createRng(0x7ee5);
    const spawns = this.root.getObjectByName('VegetationSpawns');
    const anchors: { pos: Vector3; kind: 0 | 1; scale: number }[] = [];
    spawns?.children.forEach((a) => {
      const p = new Vector3();
      a.getWorldPosition(p);
      anchors.push({ pos: p, kind: a.userData['variant'] === 'conifer' ? 1 : 0, scale: Number(a.userData['scaleSeed'] ?? 1) });
    });
    const terrain = this.root.getObjectByName('IslandTerrain') as Mesh | undefined;
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const groundAt = (x: number, z: number): number | null => {
      if (!terrain) return sampleGround(x, z, { height: 0, surface: 'terrain' }).height;
      ray.set(new Vector3(x, 200, z), down);
      const hit = ray.intersectObject(terrain, false)[0];
      return hit ? hit.point.y : null;
    };
    const place = (x: number, z: number, kind: 0 | 1, scale: number): void => {
      if (rng() > q.treeDensity) return;
      if (!this.allowedTree(x, z)) return;
      const y = groundAt(x, z);
      if (y === null || y < -0.6) return;
      const tint = 0.82 + rng() * 0.36;
      const color = new Color(tint * (0.95 + rng() * 0.1), tint, tint * (0.9 + rng() * 0.15));
      this.trees.push({ pos: new Vector3(x, y - 0.15, z), scale, yaw: rng() * Math.PI * 2, kind, color, radius: 7 * scale });
    };
    for (const a of anchors) {
      const n = 6 + Math.floor(rng() * 10);
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const rad = 3 + Math.sqrt(rng()) * 30;
        const kind: 0 | 1 = rng() < 0.72 ? a.kind : a.kind === 0 ? 1 : 0;
        place(a.pos.x + Math.cos(ang) * rad, a.pos.z + Math.sin(ang) * rad, kind, a.scale * (0.75 + rng() * 0.6));
      }
    }
    for (let i = 0; i < 900; i++) {
      const ang = rng() * Math.PI * 2;
      const r = 0.4 + rng() * 0.45;
      const x = Math.cos(ang) * 575 * r;
      const z = -Math.sin(ang) * 250 * r;
      place(x, z, rng() < 0.5 ? 1 : 0, 0.8 + rng() * 0.6);
    }

    const max = this.trees.length;
    this.vegetationStats.total = max;
    const makeInstanced = (geo: BufferGeometry | null, amount: number): InstancedMesh | null => {
      if (!geo) return null;
      const m = new InstancedMesh(geo, swayMaterial(this.swayUniforms, amount, q.id !== 'low'), Math.max(1, max));
      m.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, max) * 3), 3);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = q.id === 'high';
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    this.nearMeshes = nearGeo.map((g) => makeInstanced(g, 0.0022)).filter((m): m is InstancedMesh => m !== null);
    this.farMeshes = farGeo.map((g) => makeInstanced(g, 0.0015)).filter((m): m is InstancedMesh => m !== null);
    const tris = (g: BufferGeometry | null) => (g ? (g.index ? g.index.count : g.attributes['position']!.count) / 3 : 0);
    this.nearTris = [tris(nearGeo[0] ?? null), tris(nearGeo[1] ?? null)];
    this.farTris = [tris(farGeo[0]!), tris(farGeo[1]!)];
    this.nearDistance = q.nearTreeDistance;
    this.farDistance = q.farTreeDistance;
  }

  private nearDistance = 380;
  private farDistance = 6500;
  private readonly _frustum = new Frustum();
  private readonly _pv = new Matrix4();
  private readonly _sphere = new Sphere();
  private readonly _m = new Matrix4();
  private readonly _q = new Quaternion();
  private readonly _s = new Vector3();
  private readonly _up = new Vector3(0, 1, 0);
  private readonly _beaconPos = new Vector3();

  /** Per-instance frustum + distance culling and LOD tiering; rewrites compact instance buffers. */
  updateVegetation(camera: Camera, force = false): void {
    if (!force && this.cullFrame++ % 3 !== 0) return;
    if (this.nearMeshes.length < 2 || this.farMeshes.length < 2) return;
    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);
    const cam = camera.position;
    const counts = [0, 0, 0, 0];
    let culled = 0;
    for (const t of this.trees) {
      this._sphere.center.set(t.pos.x, t.pos.y + 4 * t.scale, t.pos.z);
      this._sphere.radius = t.radius;
      const d = cam.distanceTo(this._sphere.center);
      if (d > this.farDistance || !this._frustum.intersectsSphere(this._sphere)) {
        culled++;
        continue;
      }
      const near = d < this.nearDistance;
      const mesh = near ? this.nearMeshes[t.kind]! : this.farMeshes[t.kind]!;
      const slot = (near ? 0 : 2) + t.kind;
      const i = counts[slot]!++;
      this._q.setFromAxisAngle(this._up, t.yaw);
      this._s.setScalar(t.scale);
      this._m.compose(t.pos, this._q, this._s);
      mesh.setMatrixAt(i, this._m);
      mesh.setColorAt(i, t.color);
    }
    for (let k = 0; k < 2; k++) {
      const n = this.nearMeshes[k]!;
      const f = this.farMeshes[k]!;
      n.count = counts[k]!;
      f.count = counts[2 + k]!;
      n.instanceMatrix.needsUpdate = true;
      f.instanceMatrix.needsUpdate = true;
      if (n.instanceColor) n.instanceColor.needsUpdate = true;
      if (f.instanceColor) f.instanceColor.needsUpdate = true;
    }
    const s = this.vegetationStats;
    s.nearVisible = counts[0]! + counts[1]!;
    s.farVisible = counts[2]! + counts[3]!;
    s.culled = culled;
    s.nearTriangles = counts[0]! * this.nearTris[0]! + counts[1]! * this.nearTris[1]!;
    s.farTriangles = counts[2]! * this.farTris[0]! + counts[3]! * this.farTris[1]!;
  }

  private buildFence(): void {
    const tpl = this.root.getObjectByName('FenceSegmentTemplate');
    if (!tpl) return;
    const metal = new Color(0.6, 0.62, 0.64);
    const geo = mergeTemplate(tpl, () => metal);
    tpl.visible = false;
    if (!geo) return;
    const spots: [number, number, number][] = [];
    for (let x = 150; x <= 350; x += 12) spots.push([x, -152, Math.PI / 2]);
    for (let z = -152; z <= -28; z += 12) spots.push([144, z, 0]);
    const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 }), spots.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3(1, 1, 1);
    spots.forEach(([x, z, yaw], i) => {
      const y = sampleGround(x, z, { height: 0, surface: 'grass' }).height;
      q.setFromAxisAngle(this._up, yaw);
      m.compose(new Vector3(x, Math.max(y, -0.08), z), q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'FenceInstances';
    this.root.add(mesh);
  }

  private buildGrass(count: number): void {
    // A tuft of five thin blades; reads as texture at distance and as grass up close.
    const blades = 5;
    const verts: number[] = [];
    const cols: number[] = [];
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * Math.PI + 0.3;
      const lean = 0.05 + (b % 2) * 0.05;
      const w = 0.035;
      const h = 0.26 + (b % 3) * 0.07;
      const cx = Math.cos(a) * w;
      const cz = Math.sin(a) * w;
      const tx = Math.cos(a + 1.57) * lean;
      const tz = Math.sin(a + 1.57) * lean;
      verts.push(-cx, 0, -cz, cx, 0, cz, tx, h, tz);
      cols.push(0.03, 0.06, 0.015, 0.03, 0.06, 0.015, 0.11, 0.16, 0.05);
    }
    const blade = new BufferGeometry();
    blade.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    blade.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
    blade.computeVertexNormals();
    const mesh = new InstancedMesh(blade, swayMaterial(this.swayUniforms, 0.18), count);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const rng = createRng(0x9a55);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      const x = (rng() * 2 - 1) * 470;
      const side = rng() < 0.5 ? -1 : 1;
      const z = side * (16 + Math.pow(rng(), 1.6) * 50);
      // Keep the apron and hangar area clear.
      if (x > 165 && x < 340 && z < -14) {
        m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, m);
        continue;
      }
      q.setFromAxisAngle(this._up, rng() * Math.PI);
      const sc = 0.7 + rng() * 0.9;
      s.set(sc, sc * (0.7 + rng() * 0.7), sc);
      m.compose(new Vector3(x, -0.08, z), q, s);
      mesh.setMatrixAt(i, m);
      c.setRGB(0.75 + rng() * 0.4, 0.8 + rng() * 0.3, 0.7 + rng() * 0.3);
      mesh.setColorAt(i, c);
    }
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'GrassTufts';
    this.root.add(mesh);
  }

  setRunway(id: RunwayId): void {
    this.activeRunway = id;
    const landingWest = id === '09';
    if (this.thresholdGroups.west) this.thresholdGroups.west.material = landingWest ? this.greenMat : this.redMat;
    if (this.thresholdGroups.east) this.thresholdGroups.east.material = landingWest ? this.redMat : this.greenMat;
    for (const g of this.thresholdGlow) {
      const green = (g.x < 0) === landingWest;
      const c = green ? GREEN : RED;
      for (let i = 0; i < g.count; i++) this.glow.colors.set([c.r, c.g, c.b], (g.start + i) * 3);
    }
    for (const g of this.approachGlow) {
      for (let i = 0; i < g.count; i++) this.glow.sizes[g.start + i] = g.runway === id ? 0.7 : 0;
    }
    const rw = RUNWAYS[id];
    const pos = this.guidance.geometry.attributes['position'] as BufferAttribute;
    pos.setXYZ(0, rw.thresholdX - rw.dir * 20, 0.3, 0);
    pos.setXYZ(1, rw.thresholdX - rw.dir * 3200, -2.2, 0);
    pos.needsUpdate = true;
    this.guidance.computeLineDistances();
    (this.glow.geometry.attributes['color'] as BufferAttribute).needsUpdate = true;
    (this.glow.geometry.attributes['size'] as BufferAttribute).needsUpdate = true;
  }

  /** Show exactly one lens colour per PAPI box. */
  setPapi(id: RunwayId, white: readonly boolean[], visible: boolean): void {
    for (const rid of ['09', '27'] as const) {
      const v = this.papis[rid];
      const active = rid === id;
      for (let i = 0; i < v.white.length; i++) {
        const isWhite = active ? white[i]! : true;
        v.white[i]!.visible = isWhite;
        v.red[i]!.visible = !isWhite;
        const gi = v.glowIndex + i;
        const c = isWhite ? WHITE : RED;
        this.glow.colors.set([c.r, c.g, c.b], gi * 3);
        this.glow.sizes[gi] = active && visible ? 1.1 : 0;
      }
    }
    (this.glow.geometry.attributes['color'] as BufferAttribute).needsUpdate = true;
    (this.glow.geometry.attributes['size'] as BufferAttribute).needsUpdate = true;
  }

  /** Windsock points downwind; the sleeve fills out and flutters with speed and gusts. */
  updateWindsock(w: WindReadout, time: number): void {
    const pivot = this.windsockPivot;
    if (!pivot) return;
    const towardRad = (w.fromDeg + 180) * DEG;
    const fill = Math.min(1, w.speedKt / 15);
    const flutter = (0.4 + w.gust) * (0.2 + fill);
    pivot.rotation.order = 'YXZ';
    pivot.rotation.y = Math.PI / 2 - towardRad + Math.sin(time * 2.3) * 0.04 * flutter;
    pivot.rotation.z = -(1 - fill) * 1.2 + Math.sin(time * 5.1) * 0.05 * flutter;
    const sleeve = this.windsockSleeve;
    if (sleeve) {
      const s = 0.72 + 0.28 * fill;
      sleeve.scale.set(1, s + Math.sin(time * 9) * 0.03 * flutter, 1);
    }
    this.windsockYawRad = towardRad;
  }

  windsockYawRad = 0;

  update(time: number, camera: Camera, guidanceVisible: boolean, beaconVisible: boolean): void {
    this.oceanUniforms.uTime.value = time;
    this.swayUniforms.uTime.value = time;
    if (this.beaconHead) {
      this.beaconHead.rotation.y = time * 1.26;
      const p = this.beaconHead.getWorldPosition(this._beaconPos);
      const phase = (time * 1.26) % (Math.PI * 2);
      const green = phase > Math.PI;
      const c = green ? GREEN : WHITE;
      const i = this.beaconGlowIndex;
      this.glow.positions.set([p.x, p.y, p.z], i * 3);
      this.glow.colors.set([c.r, c.g, c.b], i * 3);
      this.glow.sizes[i] = beaconVisible ? 1.4 * (0.4 + 0.6 * Math.abs(Math.sin(phase))) : 0;
      (this.glow.geometry.attributes['position'] as BufferAttribute).needsUpdate = true;
      (this.glow.geometry.attributes['size'] as BufferAttribute).needsUpdate = true;
      (this.glow.geometry.attributes['color'] as BufferAttribute).needsUpdate = true;
    }
    this.guidance.visible = guidanceVisible;
    this.updateVegetation(camera);
  }

  get runwayId(): RunwayId {
    return this.activeRunway;
  }
}
