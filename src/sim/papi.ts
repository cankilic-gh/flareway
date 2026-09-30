import type { Vector3 } from 'three';
import { DEG, PAPI_ANGLES_DEG, PAPI_HYSTERESIS_DEG } from './constants';
import type { RunwayInfo } from './airfield';

export type PapiIndication = 'too-high' | 'slightly-high' | 'on-path' | 'slightly-low' | 'too-low';

export interface PapiState {
  runway: RunwayInfo;
  /** Box 1 (outermost, lowest setting angle) to box 4 (nearest the runway). */
  white: [boolean, boolean, boolean, boolean];
  elevationDeg: number;
  visible: boolean;
}

export const createPapi = (runway: RunwayInfo): PapiState => ({
  runway,
  white: [true, true, false, false],
  elevationDeg: 3,
  visible: true,
});

/** Updates light states from the pilot eye position. `reset` skips hysteresis (spawn). */
export const updatePapi = (p: PapiState, eye: Vector3, reset: boolean): PapiState => {
  const u = p.runway.papi;
  const ahead = (u.x - eye.x) * p.runway.dir;
  const horiz = Math.hypot(u.x - eye.x, u.z - eye.z);
  p.visible = ahead > 5;
  if (!p.visible) return p;
  const elev = Math.atan2(eye.y - u.y, Math.max(1, horiz)) / DEG;
  p.elevationDeg = elev;
  for (let i = 0; i < 4; i++) {
    const a = PAPI_ANGLES_DEG[i]!;
    if (reset) p.white[i] = elev > a;
    else if (p.white[i] && elev < a - PAPI_HYSTERESIS_DEG) p.white[i] = false;
    else if (!p.white[i] && elev > a + PAPI_HYSTERESIS_DEG) p.white[i] = true;
  }
  return p;
};

export const papiIndication = (p: PapiState): PapiIndication => {
  const n = p.white.filter(Boolean).length;
  return (['too-low', 'slightly-low', 'on-path', 'slightly-high', 'too-high'] as const)[n]!;
};
