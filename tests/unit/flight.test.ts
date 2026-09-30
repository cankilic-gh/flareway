import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  alphaStall,
  computeAero,
  createAircraftState,
  defaultAssists,
  dragCoefficient,
  liftCoefficient,
  neutralInput,
  stepAircraft,
  type AircraftState,
  type ControlInput,
} from '../../src/sim/physics';
import { createWindField, type WindField } from '../../src/sim/wind';
import { DEG, KT, SIM_DT } from '../../src/sim/constants';

const calm: WindField = createWindField({ windFromDeg: 0, windKt: 0, gustKt: 0, dirVarDeg: 0, turbulence: 0, noiseSeed: 1 });

const airborne = (speedMps: number, headingDeg = 90, altitude = 300): AircraftState => {
  const s = createAircraftState();
  const h = headingDeg * DEG;
  s.pos.set(0, altitude, -2000);
  s.quat.setFromAxisAngle(new Vector3(0, 1, 0), -(h - Math.PI / 2));
  s.vel.set(Math.sin(h) * speedMps, 0, -Math.cos(h) * speedMps);
  s.throttle = 0.5;
  s.power = 0.5;
  return s;
};

const noAssists = { ...defaultAssists(), pitchStability: false, coordinatedRudder: false };

const run = (
  s: AircraftState,
  seconds: number,
  input: ControlInput | ((s: AircraftState) => ControlInput),
  wind = calm,
  assists = defaultAssists(),
): void => {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    const inp = typeof input === 'function' ? input(s) : input;
    stepAircraft(s, inp, assists, wind, SIM_DT);
  }
};

describe('aerodynamics', () => {
  it('lift grows with airspeed squared at a fixed angle of attack', () => {
    const a = airborne(30);
    const b = airborne(42);
    const la = computeAero(a, calm).lift;
    const lb = computeAero(b, calm).lift;
    const ratio = lb / la;
    expect(ratio).toBeCloseTo((42 / 30) ** 2, 2);
  });

  it('lift coefficient is linear before stall and drops after stall', () => {
    const as = alphaStall(0);
    expect(liftCoefficient(4 * DEG, 0)).toBeGreaterThan(liftCoefficient(2 * DEG, 0));
    const atStall = liftCoefficient(as, 0);
    expect(liftCoefficient(as + 6 * DEG, 0)).toBeLessThan(atStall * 0.8);
  });

  it('flaps raise lift and drag and lower stall speed', () => {
    expect(liftCoefficient(3 * DEG, 30)).toBeGreaterThan(liftCoefficient(3 * DEG, 0) + 0.4);
    expect(dragCoefficient(0.8, 30, 1)).toBeGreaterThan(dragCoefficient(0.8, 0, 1) + 0.03);
    const clMaxClean = liftCoefficient(alphaStall(0), 0);
    const clMaxFull = liftCoefficient(alphaStall(30), 30);
    const vs = (cl: number) => Math.sqrt((2 * 1000 * 9.80665) / (1.225 * 16.2 * cl)) / KT;
    expect(vs(clMaxClean) - vs(clMaxFull)).toBeGreaterThan(3);
    // Stall warning bands land in the recreational 43-48 KIAS target range.
    const warn = (flaps: number) => vs(liftCoefficient(alphaStall(flaps) - 2.3 * DEG, flaps));
    expect(warn(0)).toBeGreaterThan(46);
    expect(warn(0)).toBeLessThan(50);
    expect(warn(30)).toBeGreaterThan(42);
    expect(warn(30)).toBeLessThan(45.5);
  });

  it('ground effect reduces induced drag near the runway', () => {
    expect(dragCoefficient(1.2, 0, 0.5)).toBeLessThan(dragCoefficient(1.2, 0, 1));
  });
});

describe('control authority', () => {
  const rollAccel = (speed: number): number => {
    const s = airborne(speed);
    s.rates.set(0, 0, 0);
    s.aileron = 1;
    stepAircraft(s, { ...neutralInput(), roll: 1, throttle: 0.5 }, { ...defaultAssists(), coordinatedRudder: false }, calm, SIM_DT);
    return s.rates.x / SIM_DT;
  };

  it('gains roll authority with airspeed', () => {
    const slow = rollAccel(22);
    const fast = rollAccel(42);
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it('gains pitch authority with airspeed', () => {
    const pitchRateAfter = (speed: number) => {
      const s = airborne(speed);
      run(s, 0.4, { ...neutralInput(), pitch: 1, throttle: 0.5 });
      return s.rates.z;
    };
    expect(pitchRateAfter(42)).toBeGreaterThan(pitchRateAfter(22) * 1.5);
  });
});

describe('stall', () => {
  it('stall reduces lift, increases sink and is recoverable with nose down and power', () => {
    const s = airborne(30);
    s.flapDeg = 0;
    s.flapIndex = 0;
    let warned = false;
    let maxAlpha = 0;
    run(s, 12, (st) => {
      if (st.stallWarning) warned = true;
      maxAlpha = Math.max(maxAlpha, st.alpha);
      return { ...neutralInput(), pitch: 1, throttle: 0 };
    });
    expect(warned).toBe(true);
    expect(maxAlpha).toBeGreaterThan(alphaStall(0));
    const stalledSink = -s.vel.y;
    expect(stalledSink).toBeGreaterThan(4);
    const altBefore = s.pos.y;
    run(s, 3, { ...neutralInput(), pitch: -0.6, throttle: 1 });
    expect(s.alpha).toBeLessThan(alphaStall(0) - 2 * DEG);
    run(s, 6, (st) => ({ ...neutralInput(), pitch: st.vel.y < -1 ? 0.35 : 0, throttle: 1 }));
    expect(s.stallWarning).toBe(false);
    expect(s.vel.y).toBeGreaterThan(-2.5);
    expect(s.pos.y).toBeLessThan(altBefore);
  });
});

describe('crosswind', () => {
  it('drifts downwind with the air mass when the heading is held along the runway', () => {
    // Wind from the south (180) blows toward north (-Z) across an east-bound aircraft.
    const wind = createWindField({ windFromDeg: 180, windKt: 12, gustKt: 0, dirVarDeg: 0, turbulence: 0, noiseSeed: 2 });
    const s = airborne(33);
    // In equilibrium with the air mass: ground velocity = air velocity + wind.
    s.vel.set(33, 0, -12 * KT);
    run(s, 8, { ...neutralInput(), throttle: 0.55 }, wind, noAssists);
    expect(s.pos.z).toBeLessThan(-2000 - 12 * KT * 8 * 0.8);
  });

  it('weathervanes toward a sudden crosswind', () => {
    const wind = createWindField({ windFromDeg: 180, windKt: 12, gustKt: 0, dirVarDeg: 0, turbulence: 0, noiseSeed: 2 });
    const s = airborne(33);
    const startQuat = new Quaternion().copy(s.quat);
    run(s, 8, { ...neutralInput(), throttle: 0.55 }, wind, noAssists);
    // Nose yawed right toward the southerly relative wind: forward vector gains +Z.
    const fwd = new Vector3(1, 0, 0).applyQuaternion(s.quat);
    const fwd0 = new Vector3(1, 0, 0).applyQuaternion(startQuat);
    expect(fwd.z).toBeGreaterThan(fwd0.z + 0.05);
  });

  it('crabbing into the wind keeps the ground track aligned', () => {
    const wind = createWindField({ windFromDeg: 180, windKt: 10, gustKt: 0, dirVarDeg: 0, turbulence: 0, noiseSeed: 3 });
    const s = airborne(33);
    const crab = Math.asin((10 * KT) / 33);
    // Heading east rotated toward the wind (right, toward +Z/south).
    s.quat.setFromAxisAngle(new Vector3(0, 1, 0), -crab);
    s.vel.set(Math.cos(crab) * 33, 0, 0);
    const z0 = s.pos.z;
    run(s, 6, { ...neutralInput(), throttle: 0.55 }, wind, noAssists);
    expect(Math.abs(s.pos.z - z0)).toBeLessThan(12);
  });
});
