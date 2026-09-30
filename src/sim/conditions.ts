import { NM, RUNWAY } from './constants';
import { RUNWAYS, type RunwayId } from './airfield';
import { createRng, hash32, range } from './rng';

export type PresetId = 'calm' | 'breezy' | 'gusty' | 'challenge';

export interface PresetDef {
  id: PresetId;
  label: string;
  code: string;
  blurb: string;
  windKt: readonly [number, number];
  gustKt: readonly [number, number];
  /** Wind angle off the runway axis, degrees. Above 90 means a tailwind component. */
  crossAngleDeg: readonly [number, number];
  dirVarDeg: readonly [number, number];
  turbulence: number;
  difficult: boolean;
}

export const PRESETS: readonly PresetDef[] = [
  {
    id: 'calm',
    label: 'Calm',
    code: 'CLM',
    blurb: '0–3 kt, nearly steady air.',
    windKt: [0, 3],
    gustKt: [0, 1],
    crossAngleDeg: [0, 90],
    dirVarDeg: [2, 6],
    turbulence: 0,
    difficult: false,
  },
  {
    id: 'breezy',
    label: 'Breezy',
    code: 'BRZ',
    blurb: '4–8 kt with a moderate crosswind.',
    windKt: [4, 8],
    gustKt: [1, 2.5],
    crossAngleDeg: [25, 70],
    dirVarDeg: [5, 10],
    turbulence: 0.1,
    difficult: false,
  },
  {
    id: 'gusty',
    label: 'Gusty',
    code: 'GST',
    blurb: '7–12 kt, 2–5 kt gusts, shifting direction.',
    windKt: [7, 12],
    gustKt: [2, 5],
    crossAngleDeg: [15, 75],
    dirVarDeg: [12, 22],
    turbulence: 0.3,
    difficult: false,
  },
  {
    id: 'challenge',
    label: 'Challenge',
    code: 'CHL',
    blurb: 'Up to 15 kt, strong crosswind, turbulence. Difficult.',
    windKt: [10, 15],
    gustKt: [3, 5],
    crossAngleDeg: [45, 100],
    dirVarDeg: [15, 25],
    turbulence: 0.75,
    difficult: true,
  },
];

export const presetById = (id: PresetId): PresetDef => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset ${id}`);
  return p;
};

export const SEED_SPACE = 36 ** 5;

export interface Conditions {
  code: string;
  preset: PresetId;
  seed: number;
  windFromDeg: number;
  windKt: number;
  gustKt: number;
  dirVarDeg: number;
  turbulence: number;
  runway: RunwayId;
  headwindKt: number;
  /** Positive when the wind comes from the right of the landing direction. */
  crosswindKt: number;
  tailwind: boolean;
  noiseSeed: number;
  spawn: { distanceM: number; heightM: number; lateralM: number };
}

export const encodeConditionCode = (preset: PresetId, seed: number): string => {
  const s = ((Math.floor(seed) % SEED_SPACE) + SEED_SPACE) % SEED_SPACE;
  return `${presetById(preset).code}-${s.toString(36).toUpperCase().padStart(5, '0')}`;
};

export const decodeConditionCode = (code: string): { preset: PresetId; seed: number } | null => {
  const m = /^([A-Za-z]{3})-([0-9A-Za-z]{5})$/.exec(code.trim());
  if (!m || !m[1] || !m[2]) return null;
  const preset = PRESETS.find((p) => p.code === m[1]!.toUpperCase());
  if (!preset) return null;
  const seed = parseInt(m[2].toLowerCase(), 36);
  if (!Number.isFinite(seed)) return null;
  return { preset: preset.id, seed };
};

const wrap360 = (d: number): number => ((d % 360) + 360) % 360;

export const headwindComponentKt = (windFromDeg: number, windKt: number, runway: RunwayId): number =>
  windKt * Math.cos(((windFromDeg - RUNWAYS[runway].headingDeg) * Math.PI) / 180);

export const crosswindComponentKt = (windFromDeg: number, windKt: number, runway: RunwayId): number =>
  windKt * Math.sin(((windFromDeg - RUNWAYS[runway].headingDeg) * Math.PI) / 180);

export const generateConditions = (preset: PresetId, seed: number): Conditions => {
  const def = presetById(preset);
  const presetIndex = PRESETS.indexOf(def);
  const rng = createRng(hash32(seed, 0x464c5259 + presetIndex));
  const windKt = range(rng, def.windKt[0], def.windKt[1]);
  const gustKt = Math.min(range(rng, def.gustKt[0], def.gustKt[1]), preset === 'calm' ? windKt * 0.5 : Infinity);
  const axis: RunwayId = rng() < 0.5 ? '09' : '27';
  const side = rng() < 0.5 ? -1 : 1;
  const crossAngle = range(rng, def.crossAngleDeg[0], def.crossAngleDeg[1]);
  const windFromDeg = wrap360(RUNWAYS[axis].headingDeg + side * crossAngle);
  const dirVarDeg = range(rng, def.dirVarDeg[0], def.dirVarDeg[1]);

  let runway: RunwayId = axis;
  let hw = headwindComponentKt(windFromDeg, windKt, runway);
  let tailwind = false;
  if (def.difficult) {
    tailwind = hw < -0.5;
  } else if (hw < 0) {
    runway = axis === '09' ? '27' : '09';
    hw = headwindComponentKt(windFromDeg, windKt, runway);
  }

  const distanceM = range(rng, 1.35, 1.5) * NM;
  const rw = RUNWAYS[runway];
  const papiPastThreshold = RUNWAY.thresholdAbsX - RUNWAY.papiAbsX;
  const glideHeight = (distanceM + papiPastThreshold) * Math.tan((RUNWAY.glideDeg * Math.PI) / 180);
  const heightM = glideHeight + range(rng, 5, 15);
  const lateralM = range(rng, -12, 12);
  void rw;

  return {
    code: encodeConditionCode(preset, seed),
    preset,
    seed,
    windFromDeg,
    windKt,
    gustKt,
    dirVarDeg,
    turbulence: def.turbulence,
    runway,
    headwindKt: hw,
    crosswindKt: crosswindComponentKt(windFromDeg, windKt, runway),
    tailwind,
    noiseSeed: hash32(seed, 0x57494e44 + presetIndex),
    spawn: { distanceM, heightM, lateralM },
  };
};

export const randomSeed = (entropy: number): number => hash32(Math.floor(entropy), 0x5eed) % SEED_SPACE;
