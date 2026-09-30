import type { Vector3 } from 'three';
import { DEG, KT } from './constants';
import type { Conditions } from './conditions';
import { fbm1, noise1 } from './rng';

export interface WindField {
  fromDeg: number;
  baseMps: number;
  gustMps: number;
  dirVarDeg: number;
  turbulence: number;
  seed: number;
}

export interface WindReadout {
  fromDeg: number;
  speedKt: number;
  /** 0..1 current gust intensity. */
  gust: number;
}

export const createWindField = (c: Pick<Conditions, 'windFromDeg' | 'windKt' | 'gustKt' | 'dirVarDeg' | 'turbulence' | 'noiseSeed'>): WindField => ({
  fromDeg: c.windFromDeg,
  baseMps: c.windKt * KT,
  gustMps: c.gustKt * KT,
  dirVarDeg: c.dirVarDeg,
  turbulence: c.turbulence,
  seed: c.noiseSeed >>> 0,
});

/** Surface boundary layer: 10 m reference wind, weaker near the ground. */
export const heightFactor = (h: number): number => {
  const hh = Math.max(0, h);
  if (hh >= 10) return Math.min(1.15, 1 + 0.15 * Math.log10(hh / 10));
  return 0.72 + 0.28 * (hh / 10);
};

const gustShape = (seed: number, t: number): number => {
  const n = fbm1(seed ^ 0x6a09e667, t / 5.5);
  const x = Math.max(0, Math.min(1, (n + 0.55) / 1.2));
  return x * x * (3 - 2 * x);
};

export const windReadout = (w: WindField, t: number, out: WindReadout): WindReadout => {
  const g = w.gustMps > 0 ? gustShape(w.seed, t) : 0;
  const dir = w.fromDeg + w.dirVarDeg * fbm1(w.seed ^ 0x3c6ef372, t / 9.0);
  out.fromDeg = ((dir % 360) + 360) % 360;
  out.speedKt = (w.baseMps + w.gustMps * g) / KT;
  out.gust = g;
  return out;
};

const scratch: WindReadout = { fromDeg: 0, speedKt: 0, gust: 0 };

/** Air-mass velocity (m/s, world frame) at time t and height h above ground. */
export const sampleWind = (w: WindField, t: number, h: number, out: Vector3): Vector3 => {
  const r = windReadout(w, t, scratch);
  const speed = r.speedKt * KT * heightFactor(h);
  const toward = (r.fromDeg + 180) * DEG;
  out.set(Math.sin(toward) * speed, 0, -Math.cos(toward) * speed);
  if (w.turbulence > 0) {
    const amp = w.turbulence * (0.6 + 0.4 * r.gust) * Math.min(1, 0.35 + Math.max(0, h) / 60);
    out.y += amp * 1.1 * (noise1(w.seed ^ 0x510e527f, t * 0.85) + 0.45 * noise1(w.seed ^ 0x9b05688c, t * 2.1));
    out.x += amp * 0.7 * noise1(w.seed ^ 0x1f83d9ab, t * 0.7);
    out.z += amp * 0.7 * noise1(w.seed ^ 0x5be0cd19, t * 0.75);
  }
  return out;
};
