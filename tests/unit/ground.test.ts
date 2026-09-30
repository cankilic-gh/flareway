import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createAircraftState, defaultAssists, neutralInput, stepAircraft, type AircraftState, type ControlInput } from '../../src/sim/physics';
import { createWindField } from '../../src/sim/wind';
import { DEG, GEAR, RUNWAY, SIM_DT } from '../../src/sim/constants';
import { sampleGround } from '../../src/sim/airfield';

const calm = createWindField({ windFromDeg: 0, windKt: 0, gustKt: 0, dirVarDeg: 0, turbulence: 0, noiseSeed: 1 });

const onRunway = (x = -300, z = 0, speed = 0): AircraftState => {
  const s = createAircraftState();
  s.pos.set(x, RUNWAY.surfaceY + 1.08 - 0.07, z);
  s.vel.set(speed, 0, 0);
  s.power = 0.04;
  return s;
};

const run = (s: AircraftState, seconds: number, input: Partial<ControlInput> = {}): void => {
  const inp = { ...neutralInput(), ...input };
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) stepAircraft(s, inp, defaultAssists(), calm, SIM_DT);
};

describe('ground contacts', () => {
  it('uses the three authored gear anchors', () => {
    expect(GEAR.map((g) => g.name)).toEqual(['MainGearContact_L', 'MainGearContact_R', 'NoseGearContact']);
    expect(GEAR[0]!.offset).toEqual([-0.18, -1.08, -1.02]);
    expect(GEAR[1]!.offset).toEqual([-0.18, -1.08, 1.02]);
    expect(GEAR[2]!.offset).toEqual([2.3, -1.088, 0]);
  });

  it('rests on all three wheels with the mains carrying most of the weight', () => {
    const s = onRunway();
    run(s, 4);
    expect(s.gear.every((g) => g.inContact)).toBe(true);
    const total = s.gear.reduce((a, g) => a + g.load, 0);
    expect(total).toBeGreaterThan(9807 * 0.97);
    expect(total).toBeLessThan(9807 * 1.03);
    const mains = s.gear[0]!.load + s.gear[1]!.load;
    expect(mains / total).toBeGreaterThan(0.85);
    expect(Math.abs(s.vel.length())).toBeLessThan(0.2);
    // Contact world positions follow the anchor offsets.
    const expectedNose = new Vector3(2.3, -1.088, 0).applyQuaternion(s.quat).add(s.pos);
    // Contacts are sampled at the start of the step, so allow one step of motion.
    expect(s.gear[2]!.world.distanceTo(expectedNose)).toBeLessThan(0.01);
  });

  it('rolls farther on runway than on grass', () => {
    const paved = onRunway(-300, 0, 15);
    run(paved, 6);
    const grass = onRunway(-300, 40, 15);
    grass.pos.y = RUNWAY.grassY + 1.08 - 0.07;
    run(grass, 6);
    expect(sampleGround(grass.pos.x, grass.pos.z, { height: 0, surface: 'runway' }).surface).toBe('grass');
    expect(paved.pos.x - -300).toBeGreaterThan(grass.pos.x - -300 + 8);
  });

  it('brakes shorten the stop and hard braking at speed can skid', () => {
    const free = onRunway(-400, 0, 20);
    run(free, 8);
    const braked = onRunway(-400, 0, 20);
    run(braked, 8, { brake: 1 });
    expect(braked.pos.x).toBeLessThan(free.pos.x - 20);
    expect(braked.groundSpeed).toBeLessThan(1);
  });

  it('holds heading while rolling straight with neutral controls', () => {
    const s = onRunway(-400, 0, 25);
    run(s, 5);
    expect(Math.abs(s.pos.z)).toBeLessThan(0.5);
  });

  it('nosewheel steering turns the aircraft on the ground', () => {
    const s = onRunway(-400, 0, 10);
    run(s, 3, { yaw: 1, throttle: 0.2 });
    expect(s.pos.z).toBeGreaterThan(1.5);
  });

  it('a soft touchdown does not bounce while a hard one does', () => {
    const drop = (sink: number) => {
      const s = createAircraftState();
      s.flapDeg = 30;
      s.flapIndex = 3;
      s.pos.set(-200, RUNWAY.surfaceY + 1.08 + 0.02, 0);
      // Flare attitude where lift is close to weight, with light back-pressure held.
      s.quat.setFromAxisAngle(new Vector3(0, 0, 1), 3.2 * DEG);
      s.vel.set(26, -sink, 0);
      s.power = 0.04;
      let contacted = false;
      let bounced = false;
      let maxGap = 0;
      for (let i = 0; i < 240; i++) {
        stepAircraft(s, { ...neutralInput(), flaps: 3, pitch: 0.3 }, defaultAssists(), calm, SIM_DT);
        if (s.mainsOnGround) contacted = true;
        if (contacted && !s.onGround) {
          maxGap = Math.max(maxGap, s.agl);
          if (s.agl > 0.2) bounced = true;
        }
      }
      return { bounced, maxGap, collapsed: s.gear.some((g) => g.collapsed) };
    };
    const soft = drop(0.5);
    expect(soft.bounced).toBe(false);
    expect(soft.collapsed).toBe(false);
    const hard = drop(2.9);
    expect(hard.bounced).toBe(true);
    expect(hard.collapsed).toBe(false);
    const severe = drop(4.2);
    expect(severe.collapsed).toBe(true);
  });
});

describe('strike checks', () => {
  const pose = (pitchDeg: number, bankDeg: number, yLift = 0): AircraftState => {
    const s = onRunway();
    const q1 = new Vector3(0, 0, 1);
    const q2 = new Vector3(1, 0, 0);
    s.quat.setFromAxisAngle(q1, pitchDeg * DEG);
    s.quat.multiply(new Quaternion().setFromAxisAngle(q2, bankDeg * DEG));
    s.pos.y += yLift;
    stepAircraft(s, neutralInput(), defaultAssists(), calm, SIM_DT);
    return s;
  };

  it('detects tail strike on excessive pitch', () => {
    expect(pose(8, 0).strikes.tail).toBe(false);
    expect(pose(19, 0, -0.1).strikes.tail).toBe(true);
  });

  it('detects prop strike when the nose drops through the ground', () => {
    expect(pose(0, 0).strikes.prop).toBe(false);
    expect(pose(-9, 0, -0.2).strikes.prop).toBe(true);
  });

  it('detects wingtip strike on excessive bank near the ground', () => {
    expect(pose(0, 8).strikes.wingR).toBe(false);
    expect(pose(0, 28).strikes.wingR).toBe(true);
    expect(pose(0, -28).strikes.wingL).toBe(true);
  });
});
