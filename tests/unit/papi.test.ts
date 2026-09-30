import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createPapi, papiIndication, updatePapi } from '../../src/sim/papi';
import { RUNWAYS } from '../../src/sim/airfield';
import { PAPI_HYSTERESIS_DEG } from '../../src/sim/constants';

const eyeAt = (distance: number, angleDeg: number, runway: '09' | '27' = '09'): Vector3 => {
  const rw = RUNWAYS[runway];
  const x = rw.papi.x - rw.dir * distance;
  const y = rw.papi.y + Math.tan((angleDeg * Math.PI) / 180) * distance;
  return new Vector3(x, y, 0);
};

describe('PAPI', () => {
  it('shows the five standard indications around a 3 degree path', () => {
    const cases: [number, number, string][] = [
      [4.0, 4, 'too-high'],
      [3.35, 3, 'slightly-high'],
      [3.0, 2, 'on-path'],
      [2.65, 1, 'slightly-low'],
      [2.0, 0, 'too-low'],
    ];
    for (const [angle, whites, label] of cases) {
      const p = createPapi(RUNWAYS['09']);
      updatePapi(p, eyeAt(1500, angle), true);
      expect(p.white.filter(Boolean).length).toBe(whites);
      expect(papiIndication(p)).toBe(label);
    }
  });

  it('turns the inner boxes red first as the aircraft goes low', () => {
    const p = createPapi(RUNWAYS['09']);
    updatePapi(p, eyeAt(1200, 3.0), true);
    // Box 1 is outermost (lowest angle), box 4 is nearest the runway (highest angle).
    expect(p.white).toEqual([true, true, false, false]);
  });

  it('works for the mirrored runway 27 unit', () => {
    const p = createPapi(RUNWAYS['27']);
    updatePapi(p, eyeAt(1500, 3.0, '27'), true);
    expect(papiIndication(p)).toBe('on-path');
  });

  it('uses hysteresis so a boundary crossing does not flicker', () => {
    const p = createPapi(RUNWAYS['09']);
    const boundary = 3.1667;
    updatePapi(p, eyeAt(1500, boundary - 0.2), true);
    expect(p.white[2]).toBe(false);
    let changes = 0;
    let last = p.white[2];
    for (let i = 0; i < 200; i++) {
      const wobble = (PAPI_HYSTERESIS_DEG * 0.8) * Math.sin(i * 0.7);
      updatePapi(p, eyeAt(1500, boundary + wobble), false);
      if (p.white[2] !== last) changes++;
      last = p.white[2];
    }
    expect(changes).toBeLessThanOrEqual(1);
    updatePapi(p, eyeAt(1500, boundary + PAPI_HYSTERESIS_DEG * 2), false);
    expect(p.white[2]).toBe(true);
    updatePapi(p, eyeAt(1500, boundary - PAPI_HYSTERESIS_DEG * 2), false);
    expect(p.white[2]).toBe(false);
  });

  it('is only visible from the approach side of the unit', () => {
    const p = createPapi(RUNWAYS['09']);
    updatePapi(p, eyeAt(1500, 3.0), true);
    expect(p.visible).toBe(true);
    updatePapi(p, new Vector3(RUNWAYS['09'].papi.x + 50, 10, 0), false);
    expect(p.visible).toBe(false);
  });
});
