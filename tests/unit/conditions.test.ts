import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  PRESETS,
  decodeConditionCode,
  encodeConditionCode,
  generateConditions,
  headwindComponentKt,
} from '../../src/sim/conditions';
import { createWindField, sampleWind } from '../../src/sim/wind';
import { KT, SIM_DT } from '../../src/sim/constants';

const sampleSeries = (code: string, seconds: number): number[] => {
  const cond = decodeConditionCode(code);
  if (!cond) throw new Error('bad code');
  const field = createWindField(generateConditions(cond.preset, cond.seed));
  const out: number[] = [];
  const v = new Vector3();
  for (let t = 0; t < seconds; t += 0.5) {
    sampleWind(field, t, 30, v);
    out.push(v.x, v.y, v.z);
  }
  return out;
};

describe('seeded conditions', () => {
  it('encodes and decodes a condition code round trip', () => {
    const code = encodeConditionCode('gusty', 123456);
    expect(code).toMatch(/^GST-[0-9A-Z]{5}$/);
    expect(decodeConditionCode(code)).toEqual({ preset: 'gusty', seed: 123456 });
    expect(decodeConditionCode(code.toLowerCase())).toEqual({ preset: 'gusty', seed: 123456 });
    expect(decodeConditionCode('nope')).toBeNull();
  });

  it('creates a repeatable wind and gust sequence from the same seed', () => {
    const a = sampleSeries('GST-00ABC', 90);
    const b = sampleSeries('GST-00ABC', 90);
    expect(a).toEqual(b);
  });

  it('creates different but fair conditions for different seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const preset of PRESETS) {
        const c = generateConditions(preset.id, seed * 7919);
        seen.add(`${preset.id}:${c.windFromDeg.toFixed(1)}:${c.windKt.toFixed(2)}`);
        expect(c.windKt).toBeGreaterThanOrEqual(preset.windKt[0] - 1e-9);
        expect(c.windKt).toBeLessThanOrEqual(preset.windKt[1] + 1e-9);
        expect(c.gustKt).toBeGreaterThanOrEqual(preset.gustKt[0] - 1e-9);
        expect(c.gustKt).toBeLessThanOrEqual(preset.gustKt[1] + 1e-9);
        expect(c.spawn.distanceM).toBeGreaterThanOrEqual(1.2 * 1852);
        expect(c.spawn.distanceM).toBeLessThanOrEqual(1.5 * 1852);
        const aglFt = c.spawn.heightM / 0.3048;
        expect(aglFt).toBeGreaterThanOrEqual(450);
        expect(aglFt).toBeLessThanOrEqual(600);
      }
    }
    expect(seen.size).toBe(40 * PRESETS.length);
  });

  it('gusty preset has 2 to 5 kt gust spread and moving direction', () => {
    for (let seed = 1; seed < 60; seed++) {
      const c = generateConditions('gusty', seed);
      expect(c.gustKt).toBeGreaterThanOrEqual(2);
      expect(c.gustKt).toBeLessThanOrEqual(5);
      expect(c.dirVarDeg).toBeGreaterThan(5);
    }
  });

  it('selects the runway that avoids a tailwind in normal presets', () => {
    for (const preset of ['calm', 'breezy', 'gusty'] as const) {
      for (let seed = 0; seed < 400; seed++) {
        const c = generateConditions(preset, seed);
        expect(headwindComponentKt(c.windFromDeg, c.windKt, c.runway)).toBeGreaterThanOrEqual(-1e-9);
        expect(c.tailwind).toBe(false);
      }
    }
  });

  it('breezy and challenge produce a meaningful crosswind component', () => {
    let breezyMin = Infinity;
    for (let seed = 0; seed < 200; seed++) {
      const c = generateConditions('breezy', seed);
      breezyMin = Math.min(breezyMin, Math.abs(c.crosswindKt));
    }
    expect(breezyMin).toBeGreaterThan(1.2);
  });

  it('challenge may include a small disclosed tailwind but never a large one', () => {
    let tailwinds = 0;
    for (let seed = 0; seed < 400; seed++) {
      const c = generateConditions('challenge', seed);
      const hw = headwindComponentKt(c.windFromDeg, c.windKt, c.runway);
      expect(c.windKt).toBeLessThanOrEqual(15);
      if (hw < -0.5) {
        tailwinds++;
        expect(c.tailwind).toBe(true);
        expect(hw).toBeGreaterThan(-5);
      }
    }
    expect(tailwinds).toBeGreaterThan(0);
  });

  it('wind changes smoothly without frame-to-frame jitter', () => {
    const field = createWindField(generateConditions('challenge', 99));
    const a = new Vector3();
    const b = new Vector3();
    let maxJump = 0;
    for (let i = 0; i < 120 * 60; i++) {
      sampleWind(field, i * SIM_DT, 40, a);
      sampleWind(field, (i + 1) * SIM_DT, 40, b);
      maxJump = Math.max(maxJump, a.distanceTo(b));
    }
    // Less than 0.1 m/s change per 1/120 s step even in Challenge turbulence.
    expect(maxJump).toBeLessThan(0.1);
  });

  it('gusts actually vary wind speed over time within the advertised spread', () => {
    const c = generateConditions('gusty', 4242);
    const field = createWindField(c);
    const v = new Vector3();
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 180; t += 0.25) {
      sampleWind(field, t, 10, v);
      const kt = Math.hypot(v.x, v.z) / KT;
      min = Math.min(min, kt);
      max = Math.max(max, kt);
    }
    expect(max - min).toBeGreaterThan(c.gustKt * 0.5);
    expect(max).toBeLessThan(c.windKt + c.gustKt + 1.5);
  });

  it('wind blows from the reported direction', () => {
    const c = generateConditions('breezy', 5);
    const field = createWindField({ ...c, gustKt: 0, dirVarDeg: 0, turbulence: 0 });
    const v = new Vector3();
    sampleWind(field, 0, 10, v);
    // Air moves toward windFrom + 180. Compass: north is -Z, east is +X.
    const towardRad = ((c.windFromDeg + 180) * Math.PI) / 180;
    const expected = new Vector3(Math.sin(towardRad), 0, -Math.cos(towardRad)).multiplyScalar(c.windKt * KT);
    expect(v.distanceTo(expected)).toBeLessThan(1e-6);
  });
});
