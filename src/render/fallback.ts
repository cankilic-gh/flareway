import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { AUTHORED_ANCHORS, GEAR, STRIKE_POINTS } from '../sim/constants';

const mat = (name: string, color: string, roughness = 0.6, metalness = 0, emissive?: string): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
  m.name = name;
  if (emissive) {
    m.emissive = new Color(emissive);
    m.emissiveIntensity = 4;
  }
  return m;
};

const node = (name: string, parent: Object3D, x = 0, y = 0, z = 0): Object3D => {
  const o = new Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
  return o;
};

const mesh = (name: string, geo: BufferGeometry, m: MeshStandardMaterial, parent: Object3D, x = 0, y = 0, z = 0): Mesh => {
  const o = new Mesh(geo, m);
  o.name = name;
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
};

/** Low-detail procedural FT-172 with the same node and anchor contract as the GLB. Frame: +X fwd, +Y up, +Z right. */
export const buildFallbackAircraft = (): Group => {
  const root = new Group();
  root.name = 'AircraftRoot';
  root.userData['fallback'] = true;
  const white = mat('Paint_WarmWhite', '#e9e6df', 0.35);
  const cyan = mat('Paint_Cyan', '#0e7fa0', 0.3);
  const dark = mat('Rubber_Charcoal', '#1a1d21', 0.6);
  const metal = mat('Brushed_Aluminum', '#9aa3a8', 0.3, 0.8);
  const glass = mat('Glass_Smoke', '#15232c', 0.1);
  glass.transparent = true;
  glass.opacity = 0.6;

  const fus = new CapsuleGeometry(0.62, 5.6, 6, 12);
  fus.rotateZ(Math.PI / 2);
  const fuselage = mesh('Fuselage', fus, white, root, -0.9, 0.05, 0);
  fuselage.scale.set(1, 1, 1.15);
  mesh('Windshield', new BoxGeometry(0.06, 0.55, 1.2), glass, root, 1.15, 0.55, 0).rotation.z = 0.35;
  mesh('Livery', new BoxGeometry(5.5, 0.05, 1.46), cyan, root, -0.8, 0.2, 0);
  const wing = node('WingStatic', root);
  mesh('Wing', new BoxGeometry(1.4, 0.14, 11), white, wing, 0, 0.9, 0);
  for (const [name, z] of [['Aileron_L', -4.2], ['Aileron_R', 4.2]] as const) {
    const p = node(name, root, -0.7, 0.88, 0);
    mesh(`${name}_Surface`, new BoxGeometry(0.34, 0.06, 2.1), white, p, -0.17, 0, z);
  }
  for (const [name, z] of [['Flap_L', -2.0], ['Flap_R', 2.0]] as const) {
    const p = node(name, root, -0.7, 0.86, 0);
    mesh(`${name}_Surface`, new BoxGeometry(0.4, 0.06, 2.3), white, p, -0.2, 0, z);
  }
  mesh('Stabilizer', new BoxGeometry(0.7, 0.07, 3.6), white, root, -3.8, 0.5, 0);
  const elev = node('Elevator', root, -4.15, 0.5, 0);
  mesh('Elevator_Surface', new BoxGeometry(0.5, 0.05, 3.4), white, elev, -0.25, 0, 0);
  mesh('Fin', new BoxGeometry(0.9, 1.2, 0.07), white, root, -3.85, 1.0, 0);
  const rud = node('Rudder', root, -4.03, 0.41, 0);
  mesh('Rudder_Surface', new BoxGeometry(0.45, 1.2, 0.06), cyan, rud, -0.22, 0.6, 0);
  const prop = node('Propeller', root, ...AUTHORED_ANCHORS.Propeller);
  mesh('Spinner', new ConeGeometry(0.2, 0.4, 12).rotateZ(-Math.PI / 2), metal, prop);
  mesh('Blade', new BoxGeometry(0.05, 1.5, 0.12), dark, prop);
  for (const [name, z] of [['MainWheel_L', -1.02], ['MainWheel_R', 1.02]] as const) {
    const w = node(name, root, -0.18, -0.8, z);
    mesh(`${name}_Tire`, new TorusGeometry(0.2, 0.08, 8, 16), dark, w);
  }
  const steer = node('NoseWheelSteer', root, 2.25, -0.28, 0);
  mesh('NoseStrut', new CylinderGeometry(0.04, 0.04, 0.55, 8), metal, steer, 0.03, -0.28, 0);
  const nw = node('NoseWheel', steer, 0.05, -0.59, 0);
  mesh('NoseWheel_Tire', new TorusGeometry(0.15, 0.06, 8, 14), dark, nw);
  node('CG', root);
  node('PilotCamera', root, ...AUTHORED_ANCHORS.PilotCamera);
  node('ChaseCamera', root, ...AUTHORED_ANCHORS.ChaseCamera);
  for (const g of GEAR) node(g.name, root, g.offset[0], g.offset[1], g.offset[2]);
  node('TailStrikePoint', root, ...STRIKE_POINTS.TailStrikePoint);
  return root;
};

/** Procedural island, runway, PAPI and windsock with the airfield node contract. */
export const buildFallbackAirfield = (): Group => {
  const root = new Group();
  root.name = 'AirfieldRoot';
  root.userData['fallback'] = true;
  const grass = mat('Grass', '#2c4a1c', 0.95);
  const asphalt = mat('Runway_Asphalt', '#2a2d31', 0.9);
  const marking = mat('Runway_Marking', '#dcdcd2', 0.7);
  const papiBox = mat('PAPI_Housing', '#9ea2a2', 0.5);
  const white = mat('Light_White', '#ffffff', 0.2, 0, '#ffffff');
  const red = mat('Light_Red', '#ff2020', 0.2, 0, '#ff1010');
  const green = mat('Light_Green', '#20ff40', 0.2, 0, '#10ff30');
  const orange = mat('Windsock_Orange', '#e25a12', 0.6);
  const water = mat('Ocean_Reference', '#0c3d5e', 0.3);

  // Island: same polar construction as the Blender generator.
  const segments = 72;
  const rings = 18;
  const verts: number[] = [0, -0.08, 0];
  for (let ring = 1; ring <= rings; ring++) {
    const r = ring / rings;
    for (let i = 0; i < segments; i++) {
      const a = (2 * Math.PI * i) / segments;
      const irr = 1 + 0.045 * Math.sin(a * 5 + 0.8) + 0.025 * Math.sin(a * 11);
      const x = Math.cos(a) * 590 * r * irr;
      const yB = Math.sin(a) * 260 * r * (1 + 0.035 * Math.cos(a * 7));
      const coast = -2.35 + 2.3 * Math.pow(1 - r, 0.52);
      const flat = Math.abs(yB) < 72 && Math.abs(x) < 520;
      const shoulder = Math.max(0, Math.min(1, (Math.abs(yB) - 55) / 175));
      const hills = shoulder * (1 - r * 0.55) * (10 + 16 * (0.5 + 0.5 * Math.sin(x * 0.018 + a * 3)));
      verts.push(x, flat ? -0.08 : coast + hills, -yB);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) idx.push(0, 1 + i, 1 + ((i + 1) % segments));
  for (let ring = 1; ring < rings; ring++) {
    const a0 = 1 + (ring - 1) * segments;
    const b0 = 1 + ring * segments;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      idx.push(a0 + i, b0 + i, a0 + j, a0 + j, b0 + i, b0 + j);
    }
  }
  const tg = new BufferGeometry();
  tg.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const terrain = mesh('IslandTerrain', tg, grass, root);
  terrain.castShadow = false;
  const ocean = mesh('OceanReferencePlane', new BoxGeometry(2200, 0.12, 1600), water, root, 0, -2.55, 0);
  ocean.castShadow = false;
  node('BeachRing', root);
  node('VegetationSpawns', root);

  mesh('Runway', new BoxGeometry(900, 0.12, 23), asphalt, root).castShadow = false;
  const markings = node('RunwayMarkings', root);
  for (let x = -405; x <= 405; x += 30) mesh(`Centerline_${x}`, new BoxGeometry(15, 0.02, 0.45), marking, markings, x, 0.073, 0).castShadow = false;
  for (const end of [-1, 1]) {
    for (let i = -4; i <= 4; i++) mesh(`Threshold_${end}_${i}`, new BoxGeometry(18, 0.02, 1), marking, markings, end * 430, 0.075, i * 2.1).castShadow = false;
    for (const side of [-1, 1]) mesh(`Aiming_${end}_${side}`, new BoxGeometry(28, 0.02, 2.7), marking, markings, end * 250, 0.075, side * 5).castShadow = false;
  }
  const lights = node('RunwayLights', root);
  const lens = new SphereGeometry(0.075, 8, 6);
  for (let x = -420; x <= 420; x += 60) {
    for (const side of [-1, 1]) mesh(`EdgeLightLens_${x}_${side}`, lens, white, lights, x, 0.3, -side * 12);
  }
  for (const end of [-445, 445]) {
    for (let y = -10; y <= 10; y += 2) mesh(`ThresholdLight_${end}_${y}`, lens, end < 0 ? green : red, lights, end, 0.18, -y);
  }
  const papi = node('PAPI', root, -300, 0, 18);
  for (let i = 0; i < 4; i++) {
    const z = -i * 1.1;
    mesh(`PAPI_Box_${i + 1}`, new BoxGeometry(0.65, 0.35, 0.72), papiBox, papi, 0, 0.35, z);
    mesh(`PAPI_${i + 1}_White`, lens, white, papi, -0.32, 0.39, z + 0.14);
    mesh(`PAPI_${i + 1}_Red`, lens, red, papi, -0.32, 0.39, z - 0.14);
  }
  mesh('WindsockPole', new CylinderGeometry(0.06, 0.06, 6, 8), papiBox, root, -170, 3, -34);
  const pivot = node('WindsockPivot', root, -170, 5.8, -34);
  const sleeveGeo = new ConeGeometry(0.45, 3.2, 12, 1, true);
  sleeveGeo.rotateZ(Math.PI / 2);
  mesh('WindsockSleeve', sleeveGeo, orange, pivot, 1.6, 0, 0);
  const props = node('AirfieldProps', root);
  const dec = node('TreeTemplate_Deciduous', props, 335, 0, 78);
  mesh('Tree_Deciduous_Trunk', new CylinderGeometry(0.26, 0.26, 4, 8), mat('Roof_Metal', '#4a3a2a'), dec, 0, 2, 0);
  mesh('Tree_Deciduous_Crown', new IcosahedronGeometry(2.2, 1), grass, dec, 0, 5.2, 0);
  const con = node('TreeTemplate_Conifer', props, 350, 0, 82);
  mesh('Tree_Conifer_Trunk', new CylinderGeometry(0.22, 0.22, 3.6, 8), mat('Roof_Metal', '#4a3a2a'), con, 0, 1.8, 0);
  mesh('Tree_Conifer_Crown', new ConeGeometry(2.2, 5.5, 10), grass, con, 0, 4, 0);
  node('FenceSegmentTemplate', props, 165, 0, 52);
  const beacon = node('AirportBeacon', props, 210, 0, -108);
  node('BeaconHead', beacon, 0, 9.1, 0);
  return root;
};
