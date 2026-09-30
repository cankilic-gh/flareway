import { BufferGeometry, Color, DoubleSide, Group, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG, GEAR } from '../sim/constants';

export const REQUIRED_AIRCRAFT_NODES = [
  'AircraftRoot',
  'Fuselage',
  'WingStatic',
  'Aileron_L',
  'Aileron_R',
  'Flap_L',
  'Flap_R',
  'Elevator',
  'Rudder',
  'Propeller',
  'NoseWheelSteer',
  'NoseWheel',
  'MainWheel_L',
  'MainWheel_R',
  'CG',
  'PilotCamera',
  'ChaseCamera',
  'MainGearContact_L',
  'MainGearContact_R',
  'NoseGearContact',
  'TailStrikePoint',
] as const;

type NodeName = (typeof REQUIRED_AIRCRAFT_NODES)[number];

export interface AircraftPose {
  pos: Vector3;
  quat: Quaternion;
  aileron: number;
  elevator: number;
  rudder: number;
  flapDeg: number;
  steerDeg: number;
  propAngle: number;
  rpm: number;
  wheelSpin: readonly number[];
  compression: readonly number[];
}

const MAX = { aileron: 20, elevator: 25, rudder: 28 };

export class AircraftView {
  readonly root: Group;
  readonly nodes: Record<NodeName, Object3D>;
  readonly missing: string[] = [];
  readonly isFallback: boolean;
  readonly anchorReport: Record<string, [number, number, number]> = {};
  readonly hingeCorrections: Record<string, number> = {};
  private readonly wheelRest: Record<string, number> = {};

  constructor(source: Group) {
    this.root = source;
    this.isFallback = source.userData['fallback'] === true;
    const nodes = {} as Record<NodeName, Object3D>;
    for (const name of REQUIRED_AIRCRAFT_NODES) {
      const o = name === 'AircraftRoot' ? (source.name === 'AircraftRoot' ? source : source.getObjectByName(name)) : source.getObjectByName(name);
      if (o) nodes[name] = o;
      else this.missing.push(name);
    }
    this.nodes = nodes;
    if (this.missing.length) return;
    for (const g of GEAR) {
      const p = nodes[g.name].position;
      this.anchorReport[g.name] = [p.x, p.y, p.z];
    }
    const t = nodes.TailStrikePoint.position;
    this.anchorReport['TailStrikePoint'] = [t.x, t.y, t.z];
    const pc = nodes.PilotCamera.position;
    this.anchorReport['PilotCamera'] = [pc.x, pc.y, pc.z];
    this.fixHinges();
    this.prepareMaterials();
    this.mergeStaticParts();
    for (const w of ['MainWheel_L', 'MainWheel_R'] as const) this.wheelRest[w] = nodes[w].position.y;
  }

  get ok(): boolean {
    return this.missing.length === 0;
  }

  /**
   * The exported flap/aileron/elevator pivots sit at body height 0 while their hinge lines are on the wing/tail.
   * Move each pivot up to its hinge (leading edge of the surface) and counter-offset the children so the rest pose is
   * unchanged and deflections rotate about the real hinge.
   */
  private fixHinges(): void {
    for (const name of ['Aileron_L', 'Aileron_R', 'Flap_L', 'Flap_R', 'Elevator'] as const) {
      const pivot = this.nodes[name];
      pivot.updateMatrixWorld(true);
      let maxX = -Infinity;
      const pts: Vector3[] = [];
      pivot.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.attributes['position'];
        if (!pos) return;
        const toPivot = pivot.matrixWorld.clone().invert().multiply(m.matrixWorld);
        for (let i = 0; i < pos.count; i++) {
          const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toPivot);
          pts.push(v);
          maxX = Math.max(maxX, v.x);
        }
      });
      const edge = pts.filter((v) => v.x > maxX - 0.04);
      if (!edge.length) continue;
      const hingeY = edge.reduce((a, v) => a + v.y, 0) / edge.length;
      if (Math.abs(hingeY) < 0.02) continue;
      pivot.position.y += hingeY;
      for (const c of pivot.children) c.position.y -= hingeY;
      this.hingeCorrections[name] = hingeY;
    }
  }

  private prepareMaterials(): void {
    const glass = new MeshPhysicalMaterial({
      name: 'Glass_Smoke_Runtime',
      color: new Color('#081116'),
      metalness: 0,
      roughness: 0.05,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 0.9,
      clearcoat: 0.6,
      clearcoatRoughness: 0.04,
      side: DoubleSide,
      depthWrite: false,
    });
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mat = m.material as MeshStandardMaterial | MeshPhysicalMaterial;
      if (mat.name?.startsWith('Glass_Smoke')) {
        m.material = glass;
        m.renderOrder = 5;
        m.castShadow = false;
        return;
      }
      // Only glass may be transparent. Everything else is forced opaque.
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.alphaTest = 0;
      if (mat.name === 'Paint_WarmWhite') {
        mat.color.set('#d6d2c8');
        mat.roughness = 0.38;
        if ((mat as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          (mat as MeshPhysicalMaterial).clearcoat = 0.35;
          (mat as MeshPhysicalMaterial).clearcoatRoughness = 0.18;
        }
        mat.envMapIntensity = 0.45;
      } else if (mat.name?.startsWith('Light_')) {
        mat.toneMapped = false;
      } else {
        mat.envMapIntensity = 0.8;
      }
    });
  }

  /** Number of draw-producing meshes (reported for the performance budget). */
  meshCount = 0;

  /**
   * Merge every mesh that does not move relative to AircraftRoot (wing, struts, glazing frames, cabin, fairings…)
   * into one mesh per material. Animated pivots and the Fuselage shell stay separate; all named nodes remain.
   */
  private mergeStaticParts(): void {
    const keep = new Set<Object3D>(['Aileron_L', 'Aileron_R', 'Flap_L', 'Flap_R', 'Elevator', 'Rudder', 'Propeller', 'NoseWheelSteer', 'MainWheel_L', 'MainWheel_R', 'Fuselage'].map((n) => this.nodes[n as NodeName]));
    const root = this.root;
    root.updateMatrixWorld(true);
    const inv = new Matrix4().copy(root.matrixWorld).invert();
    const groups = new Map<Material, BufferGeometry[]>();
    const remove: Mesh[] = [];
    const visit = (o: Object3D): void => {
      if (keep.has(o)) return;
      const m = o as Mesh;
      if (m.isMesh && !Array.isArray(m.material)) {
        let g = m.geometry.clone();
        for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
        g.applyMatrix4(new Matrix4().multiplyMatrices(inv, m.matrixWorld));
        if (g.index) g = g.toNonIndexed();
        const list = groups.get(m.material) ?? [];
        list.push(g);
        groups.set(m.material, list);
        remove.push(m);
      }
      for (const c of [...o.children]) visit(c);
    };
    for (const c of [...root.children]) visit(c);
    // Detach merged source meshes but keep their (now empty) parents and every named node.
    for (const m of remove) {
      if (m.children.length) {
        const holder = new Object3D();
        holder.name = m.name;
        holder.position.copy(m.position);
        holder.quaternion.copy(m.quaternion);
        holder.scale.copy(m.scale);
        m.parent?.add(holder);
        for (const c of [...m.children]) holder.add(c);
      }
      m.removeFromParent();
    }
    const merged = new Group();
    merged.name = 'MergedStaticParts';
    for (const [mat, geos] of groups) {
      const g = mergeGeometries(geos);
      if (!g) continue;
      const mesh = new Mesh(g, mat);
      const glass = (mat as Material).name?.startsWith('Glass');
      mesh.castShadow = !glass;
      mesh.receiveShadow = true;
      if (glass) mesh.renderOrder = 5;
      merged.add(mesh);
    }
    root.add(merged);
    let n = 0;
    root.traverse((o) => {
      if ((o as Mesh).isMesh) n++;
    });
    this.meshCount = n;
  }

  setFuselageVisible(v: boolean): void {
    this.nodes.Fuselage.visible = v;
  }

  get fuselageVisible(): boolean {
    return this.nodes.Fuselage.visible;
  }

  apply(p: AircraftPose): void {
    const n = this.nodes;
    this.root.position.copy(p.pos);
    this.root.quaternion.copy(p.quat);
    // Right roll: right aileron trailing edge up (negative about +Z), left down.
    n.Aileron_R.rotation.z = -p.aileron * MAX.aileron * DEG;
    n.Aileron_L.rotation.z = p.aileron * MAX.aileron * DEG;
    // Nose-up input raises the elevator trailing edge.
    n.Elevator.rotation.z = -p.elevator * MAX.elevator * DEG;
    // Yaw right moves the rudder trailing edge to starboard.
    n.Rudder.rotation.y = p.rudder * MAX.rudder * DEG;
    n.Flap_L.rotation.z = p.flapDeg * DEG;
    n.Flap_R.rotation.z = p.flapDeg * DEG;
    n.NoseWheelSteer.rotation.y = -p.steerDeg * DEG;
    n.Propeller.rotation.x = p.propAngle;
    n.MainWheel_L.rotation.z = -(p.wheelSpin[0] ?? 0);
    n.MainWheel_R.rotation.z = -(p.wheelSpin[1] ?? 0);
    n.NoseWheel.rotation.z = -(p.wheelSpin[2] ?? 0);
    // Visual suspension: wheels ride up with contact compression.
    n.MainWheel_L.position.y = (this.wheelRest['MainWheel_L'] ?? 0) + Math.min(0.12, (p.compression[0] ?? 0) * 0.7);
    n.MainWheel_R.position.y = (this.wheelRest['MainWheel_R'] ?? 0) + Math.min(0.12, (p.compression[1] ?? 0) * 0.7);
  }

  surfaceRotations(): Record<string, number> {
    const n = this.nodes;
    return {
      Aileron_L: n.Aileron_L.rotation.z,
      Aileron_R: n.Aileron_R.rotation.z,
      Elevator: n.Elevator.rotation.z,
      Rudder: n.Rudder.rotation.y,
      Flap_L: n.Flap_L.rotation.z,
      Flap_R: n.Flap_R.rotation.z,
      NoseWheelSteer: n.NoseWheelSteer.rotation.y,
      Propeller: n.Propeller.rotation.x,
      MainWheel_L: n.MainWheel_L.rotation.z,
    };
  }
}
