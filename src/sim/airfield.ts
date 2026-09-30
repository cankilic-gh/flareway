import { RUNWAY } from './constants';

export type RunwayId = '09' | '27';
export type Surface = 'runway' | 'shoulder' | 'grass' | 'terrain' | 'beach' | 'water';

export interface RunwayInfo {
  id: RunwayId;
  headingDeg: number;
  /** Landing direction along world X (+1 for 09 heading east, -1 for 27 heading west). */
  dir: 1 | -1;
  thresholdX: number;
  takeoffStartX: number;
  /** Paved end the aircraft rolls toward. */
  farEndX: number;
  papi: { x: number; y: number; z: number };
}

export const RUNWAYS: Record<RunwayId, RunwayInfo> = {
  '09': {
    id: '09',
    headingDeg: 90,
    dir: 1,
    thresholdX: -RUNWAY.thresholdAbsX,
    takeoffStartX: -RUNWAY.takeoffStartAbsX,
    farEndX: RUNWAY.halfLength,
    papi: { x: -RUNWAY.papiAbsX, y: RUNWAY.papiLightHeight, z: RUNWAY.papiAbsZ },
  },
  '27': {
    id: '27',
    headingDeg: 270,
    dir: -1,
    thresholdX: RUNWAY.thresholdAbsX,
    takeoffStartX: RUNWAY.takeoffStartAbsX,
    farEndX: -RUNWAY.halfLength,
    papi: { x: RUNWAY.papiAbsX, y: RUNWAY.papiLightHeight, z: -RUNWAY.papiAbsZ },
  },
};

/** Distance past the landing threshold along the landing direction. */
export const alongTrack = (rw: RunwayInfo, x: number): number => (x - rw.thresholdX) * rw.dir;

/** Signed centerline offset, positive to the right of the landing direction. */
export const lateralOffset = (rw: RunwayInfo, z: number): number => z * rw.dir;

/** Remaining paved runway ahead of a point, in meters. */
export const runwayRemaining = (rw: RunwayInfo, x: number): number => (rw.farEndX - x) * rw.dir;

export interface GroundSample {
  height: number;
  surface: Surface;
}

// Island shape, mirrored from tools/blender/generate_flareway_assets.py build_island_terrain().
// Blender Y (north) is -Z in the runtime frame.
const islandRadius = (x: number, yB: number): { r: number; angle: number } => {
  const angle0 = Math.atan2(yB / 260, x / 590);
  const irr = 1 + 0.045 * Math.sin(angle0 * 5 + 0.8) + 0.025 * Math.sin(angle0 * 11);
  const yIrr = 1 + 0.035 * Math.cos(angle0 * 7);
  const r = Math.hypot(x / (590 * irr), yB / (260 * irr * yIrr));
  return { r, angle: angle0 < 0 ? angle0 + Math.PI * 2 : angle0 };
};

const terrainHeight = (x: number, yB: number, r: number, angle: number): number => {
  const coast = -2.35 + 2.3 * Math.pow(Math.max(0, 1 - r), 0.52);
  const shoulder = Math.max(0, Math.min(1, (Math.abs(yB) - 55) / 175));
  const hills = shoulder * (1 - r * 0.55) * (10 + 16 * (0.5 + 0.5 * Math.sin(x * 0.018 + angle * 3)));
  return coast + hills;
};

/** Deterministic analytic ground query used by the simulation. */
export const sampleGround = (x: number, z: number, out: GroundSample): GroundSample => {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax <= RUNWAY.halfLength && az <= RUNWAY.halfWidth) {
    out.height = RUNWAY.surfaceY;
    out.surface = 'runway';
    return out;
  }
  if (ax <= RUNWAY.halfLength && az <= RUNWAY.halfWidth + 3) {
    out.height = 0.03;
    out.surface = 'shoulder';
    return out;
  }
  if (ax < RUNWAY.plateauAbsX && az < RUNWAY.plateauAbsZ) {
    out.height = RUNWAY.grassY;
    out.surface = 'grass';
    return out;
  }
  const yB = -z;
  const { r, angle } = islandRadius(x, yB);
  if (r > 1.015) {
    out.height = RUNWAY.waterY;
    out.surface = 'water';
    return out;
  }
  let h = terrainHeight(x, yB, r, angle);
  let surface: Surface = 'terrain';
  if (r >= 0.88) {
    const beach = -0.78 + ((r - 0.88) / (1.015 - 0.88)) * (-2.25 + 0.78);
    if (beach >= h) {
      h = beach;
      surface = 'beach';
    }
  }
  if (h < RUNWAY.waterY) {
    out.height = RUNWAY.waterY;
    out.surface = 'water';
    return out;
  }
  out.height = h;
  out.surface = surface;
  return out;
};

export const isPaved = (s: Surface): boolean => s === 'runway';
