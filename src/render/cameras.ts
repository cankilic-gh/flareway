import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { AUTHORED_ANCHORS } from '../sim/constants';
import { RUNWAYS, type RunwayId } from '../sim/airfield';

export type CameraMode = 'chase' | 'cockpit' | 'tower' | 'replay' | 'topdown' | 'orbit' | 'free';
export const PLAYER_CAMERAS: readonly CameraMode[] = ['chase', 'cockpit', 'tower'];

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Chase',
  cockpit: 'Cockpit',
  tower: 'Runway side',
  replay: 'Replay',
  topdown: 'Top-down (test)',
  orbit: 'Island',
  free: 'QA',
};

const _fwd = new Vector3();
const _tmp = new Vector3();
const _target = new Vector3();
const _q = new Quaternion();
const Y = new Vector3(0, 1, 0);

/** One perspective camera driven by several rigs. */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'orbit';
  private readonly chasePos = new Vector3();
  private readonly chaseLook = new Vector3();
  private initialized = false;
  private orbitAngle = 0.6;
  /** World point of the key event (touchdown, liftoff, failure) for the runway-side replay camera. */
  replayAnchor: Vector3 | null = null;
  /** Test-only fixed camera (position, target, fov) for visual QA captures. */
  free = { pos: new Vector3(), target: new Vector3(), fov: 50, followAircraft: false };

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(55, aspect, 0.05, 40000);
  }

  snap(): void {
    this.initialized = false;
  }

  setMode(mode: CameraMode): void {
    if (mode !== this.mode) this.initialized = false;
    this.mode = mode;
  }

  update(dt: number, pos: Vector3, quat: Quaternion, runway: RunwayId, shake: Vector3): void {
    const cam = this.camera;
    switch (this.mode) {
      case 'orbit': {
        this.orbitAngle += dt * 0.035;
        const r = 1750;
        cam.position.set(Math.cos(this.orbitAngle) * r, 820, Math.sin(this.orbitAngle) * r * 0.9);
        cam.lookAt(0, -30, 0);
        cam.fov = 50;
        cam.near = 1;
        break;
      }
      case 'chase': {
        // Yaw-following chase from the authored ChaseCamera anchor, smoothed with a critically damped spring.
        _fwd.set(1, 0, 0).applyQuaternion(quat);
        const heading = Math.atan2(-_fwd.z, _fwd.x);
        _q.setFromAxisAngle(Y, heading);
        const [cx, cy, cz] = AUTHORED_ANCHORS.ChaseCamera;
        _tmp.set(cx * 1.1, cy * 0.72, cz).applyQuaternion(_q).add(pos);
        _target.copy(pos).addScaledVector(_fwd.set(1, 0, 0).applyQuaternion(_q), 14);
        _target.y += 0.6;
        if (!this.initialized) {
          this.chasePos.copy(_tmp);
          this.chaseLook.copy(_target);
          this.initialized = true;
        }
        const k = 1 - Math.exp(-dt * 6);
        this.chasePos.lerp(_tmp, k);
        this.chaseLook.lerp(_target, 1 - Math.exp(-dt * 12));
        // Never let the chase camera dip below the ground/water.
        this.chasePos.y = Math.max(this.chasePos.y, pos.y > 3 ? -1.8 : 0.7);
        cam.position.copy(this.chasePos).add(shake);
        cam.lookAt(this.chaseLook);
        cam.fov = 58;
        cam.near = 0.2;
        break;
      }
      case 'cockpit': {
        const [px, py, pz] = AUTHORED_ANCHORS.PilotCamera;
        cam.position.set(px, py, pz).applyQuaternion(quat).add(pos).addScaledVector(shake, 0.4);
        cam.quaternion.copy(quat);
        // Camera looks down -Z: rotate so it looks along body +X, slightly down over the panel.
        _q.setFromAxisAngle(Y, -Math.PI / 2);
        cam.quaternion.multiply(_q);
        _q.setFromAxisAngle(_tmp.set(1, 0, 0), -3.5 * MathUtils.DEG2RAD);
        cam.quaternion.multiply(_q);
        cam.fov = 72;
        cam.near = 0.05;
        break;
      }
      case 'tower':
      case 'replay': {
        const rw = RUNWAYS[runway];
        const replay = this.mode === 'replay';
        const side = replay ? -24 : -58;
        const height = replay ? 1.3 : 5;
        const x = replay && this.replayAnchor ? this.replayAnchor.x + rw.dir * 12 : rw.thresholdX + rw.dir * 230;
        const z = side * rw.dir;
        cam.position.set(x, height, z).add(shake);
        cam.lookAt(pos.x, pos.y + 0.3, pos.z);
        const d = cam.position.distanceTo(pos);
        // Keep the aircraft a readable size across the whole approach.
        const want = MathUtils.clamp(2 * Math.atan(9 / Math.max(d, 1)) * MathUtils.RAD2DEG * 2.4, 4, 55);
        cam.fov = want;
        cam.near = replay ? 1 : 0.5;
        break;
      }
      case 'free': {
        if (this.free.followAircraft) {
          cam.position.copy(this.free.pos).add(pos);
          cam.lookAt(_target.copy(this.free.target).add(pos));
        } else {
          cam.position.copy(this.free.pos);
          cam.lookAt(this.free.target);
        }
        cam.fov = this.free.fov;
        cam.near = 0.1;
        break;
      }
      case 'topdown': {
        cam.position.set(pos.x, pos.y + 180, pos.z + 0.01);
        cam.lookAt(pos);
        cam.fov = 50;
        cam.near = 1;
        break;
      }
    }
    // A tighter far plane in replay keeps the depth-of-field depth buffer precise around the aircraft.
    cam.far = this.mode === 'replay' ? 12000 : 40000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
