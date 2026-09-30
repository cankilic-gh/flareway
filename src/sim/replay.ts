import type { AircraftState } from './physics';

/** Values per recorded frame. */
export const REPLAY_STRIDE = 22;
export const REPLAY_HZ = 60;
const CAPACITY = REPLAY_HZ * 45;

export interface ReplayFrame {
  t: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  aileron: number;
  elevator: number;
  rudder: number;
  flapDeg: number;
  steerDeg: number;
  propAngle: number;
  rpm: number;
  wheelSpin: [number, number, number];
  compression: [number, number, number];
}

/** Fixed-size ring buffer; recording never allocates. */
export class ReplayRecorder {
  readonly data = new Float32Array(CAPACITY * REPLAY_STRIDE);
  private head = 0;
  count = 0;

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  record(s: AircraftState): void {
    const o = this.head * REPLAY_STRIDE;
    const d = this.data;
    d[o] = s.time;
    d[o + 1] = s.pos.x;
    d[o + 2] = s.pos.y;
    d[o + 3] = s.pos.z;
    d[o + 4] = s.quat.x;
    d[o + 5] = s.quat.y;
    d[o + 6] = s.quat.z;
    d[o + 7] = s.quat.w;
    d[o + 8] = s.aileron;
    d[o + 9] = s.elevator;
    d[o + 10] = s.rudder;
    d[o + 11] = s.flapDeg;
    d[o + 12] = s.steerDeg;
    d[o + 13] = s.propAngle;
    d[o + 14] = s.rpm;
    d[o + 15] = s.wheelSpin[0];
    d[o + 16] = s.wheelSpin[1];
    d[o + 17] = s.wheelSpin[2];
    d[o + 18] = s.gear[0]!.compression;
    d[o + 19] = s.gear[1]!.compression;
    d[o + 20] = s.gear[2]!.compression;
    d[o + 21] = s.groundSpeed;
    this.head = (this.head + 1) % CAPACITY;
    this.count = Math.min(this.count + 1, CAPACITY);
  }

  /** Copies frames with time in [t0, t1] into a compact array (used once per result screen). */
  extract(t0: number, t1: number): Float32Array {
    const start = (this.head - this.count + CAPACITY) % CAPACITY;
    const frames: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % CAPACITY;
      const t = this.data[idx * REPLAY_STRIDE]!;
      if (t >= t0 && t <= t1) frames.push(idx);
    }
    const out = new Float32Array(frames.length * REPLAY_STRIDE);
    frames.forEach((idx, i) => out.set(this.data.subarray(idx * REPLAY_STRIDE, (idx + 1) * REPLAY_STRIDE), i * REPLAY_STRIDE));
    return out;
  }
}
