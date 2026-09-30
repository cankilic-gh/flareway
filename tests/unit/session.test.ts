import { describe, expect, it } from 'vitest';
import { FlightSession } from '../../src/sim/session';
import { FixedStepper } from '../../src/sim/stepper';
import { createAutopilot } from '../../src/sim/autopilot';
import { neutralInput, type ControlInput } from '../../src/sim/physics';
import { flowReduce, initialFlow } from '../../src/sim/flow';
import { FT, KT, SIM_DT } from '../../src/sim/constants';
import { alongTrack, RUNWAYS } from '../../src/sim/airfield';

const fly = (session: FlightSession, profile: Parameters<typeof createAutopilot>[0], maxSeconds = 200) => {
  const ap = createAutopilot(profile);
  const input = neutralInput();
  const steps = Math.round(maxSeconds / SIM_DT);
  for (let i = 0; i < steps && !session.ended; i++) {
    ap.control(session, input);
    session.step(input);
  }
  return session;
};

describe('landing spawn', () => {
  it('starts established on final 1.2-1.5 nm out at 450-600 ft, deterministic from the code', () => {
    const a = new FlightSession('landing', 'BRZ-00K1X');
    const b = new FlightSession('landing', 'BRZ-00K1X');
    expect(a.state.pos.toArray()).toEqual(b.state.pos.toArray());
    const rw = RUNWAYS[a.conditions.runway];
    const dist = -alongTrack(rw, a.state.pos.x);
    expect(dist / 1852).toBeGreaterThan(1.2);
    expect(dist / 1852).toBeLessThan(1.5);
    expect(a.state.agl / FT).toBeGreaterThan(450);
    expect(a.state.agl / FT).toBeLessThan(600);
    expect(a.state.ias / KT).toBeGreaterThan(60);
    expect(a.state.ias / KT).toBeLessThan(75);
    // Crabbed so the ground track follows the runway.
    const lateralGround = a.state.vel.z * rw.dir;
    expect(Math.abs(lateralGround)).toBeLessThan(0.3);
  });

  it('holds a stable glide with neutral controls for a few seconds', () => {
    const s = new FlightSession('landing', 'CLM-00001');
    const vs0 = s.state.vs;
    for (let i = 0; i < 120 * 5; i++) s.step({ ...neutralInput(), throttle: s.state.throttle, flaps: s.state.flapIndex });
    expect(Math.abs(s.state.vs - vs0)).toBeLessThan(1.2);
    expect(s.state.ias / KT).toBeGreaterThan(58);
    expect(s.state.ias / KT).toBeLessThan(78);
  });
});

describe('landing scenarios through real simulation state', () => {
  it('an assisted soft landing completes and scores well', () => {
    const s = fly(new FlightSession('landing', 'CLM-00042'), 'soft');
    expect(s.ended).toBe(true);
    const r = s.result!;
    expect(r.failure).toBeNull();
    expect(r.touchdown!.firstContact).toBe('main');
    expect(r.touchdown!.sinkFpm).toBeLessThan(240);
    expect(r.score.total).toBeGreaterThan(750);
    expect(['Butter', 'Smooth']).toContain(r.score.label);
  });

  it('a soft landing in a breezy crosswind still completes on the runway', () => {
    const s = fly(new FlightSession('landing', 'BRZ-00B7Q'), 'soft');
    const r = s.result!;
    expect(r.failure).toBeNull();
    expect(Math.abs(r.touchdown!.centerlineOffset)).toBeLessThan(6);
    expect(r.score.total).toBeGreaterThan(550);
  });

  it('a late flare produces a hard landing or bounce', () => {
    const s = fly(new FlightSession('landing', 'CLM-00042'), 'hard');
    const r = s.result!;
    expect(r.touchdown!.sinkFpm).toBeGreaterThan(400);
    expect(['Hard landing', 'Bounce', 'Gear collapse']).toContain(r.score.label);
  });

  it('no flare at all collapses the gear and ends the attempt', () => {
    const s = fly(new FlightSession('landing', 'CLM-00042'), 'crash');
    expect(s.result!.failure).toBe('gear-collapse');
    expect(s.result!.score.grade).toBe('F');
  });

  it('steering off the pavement during rollout is a runway excursion', () => {
    const s = fly(new FlightSession('landing', 'CLM-00042'), 'excursion');
    expect(s.result!.failure).toBe('runway-excursion');
  });

  it('go-around resets to a safe final with the same conditions', () => {
    const s = new FlightSession('landing', 'GST-00ZZ1');
    const start = s.state.pos.clone();
    fly(s, 'soft', 40);
    expect(s.state.pos.distanceTo(start)).toBeGreaterThan(500);
    s.goAround();
    expect(s.goArounds).toBe(1);
    expect(s.state.pos.distanceTo(start)).toBeLessThan(1e-6);
    expect(s.conditions.code).toBe('GST-00ZZ1');
    expect(s.ended).toBe(false);
  });
});

describe('takeoff', () => {
  it('starts stopped on the centerline at idle', () => {
    const s = new FlightSession('takeoff', 'CLM-00007');
    expect(s.state.groundSpeed).toBeLessThan(0.2);
    expect(s.state.gear.every((g) => g.inContact)).toBe(true);
    expect(Math.abs(s.state.pos.z)).toBeLessThan(0.05);
    expect(s.state.throttle).toBe(0);
  });

  it('rotation and liftoff happen only after sufficient airspeed', () => {
    const s = new FlightSession('takeoff', 'CLM-00007');
    // Full aft stick from the start: the aircraft cannot lift off early.
    const input: ControlInput = { ...neutralInput(), throttle: 1, pitch: 0 };
    let liftoffKias = 0;
    for (let i = 0; i < 120 * 40 && !s.ended; i++) {
      input.pitch = s.state.ias / KT > 30 ? 0.5 : 1;
      s.step(input);
      if (!s.state.onGround && liftoffKias === 0) liftoffKias = s.state.ias / KT;
    }
    expect(liftoffKias).toBeGreaterThan(40);
  });

  it('assisted takeoff accelerates, rotates, lifts off and climbs', () => {
    const s = fly(new FlightSession('takeoff', 'BRZ-00T4K'), 'takeoff', 120);
    const r = s.result!;
    expect(r.failure).toBeNull();
    expect(r.takeoff!.rotateKias!).toBeGreaterThan(48);
    expect(r.takeoff!.rotateKias!).toBeLessThan(62);
    expect(r.takeoff!.liftoffKias!).toBeGreaterThan(50);
    expect(r.score.success).toBe(true);
    expect(r.score.total).toBeGreaterThan(700);
  });

  it('yanking full aft stick early in the roll strikes the tail', () => {
    const s = fly(new FlightSession('takeoff', 'CLM-00007'), 'tailstrike', 60);
    expect(s.result!.failure).toBe('tail-strike');
  });
});

describe('fixed-step determinism', () => {
  const scripted = (t: number, input: ControlInput) => {
    input.throttle = 0.45;
    input.flaps = t > 5 ? 3 : 1;
    input.pitch = Math.sin(t * 0.7) * 0.08;
    input.roll = Math.sin(t * 0.9) * 0.1;
    input.yaw = 0;
  };

  const runWithFrames = (frameMs: (i: number) => number) => {
    const s = new FlightSession('landing', 'GST-00F00');
    const stepper = new FixedStepper(SIM_DT);
    const input = neutralInput();
    let i = 0;
    let guard = 0;
    while (s.stepCount < 120 * 20 && !s.ended && guard++ < 100_000) {
      stepper.advance(frameMs(i++) / 1000, () => {
        if (s.stepCount >= 120 * 20 || s.ended) return;
        scripted(s.stepCount * SIM_DT, input);
        s.step(input);
      });
    }
    expect(s.ended).toBe(false);
    return [...s.state.pos.toArray(), ...s.state.quat.toArray(), ...s.state.vel.toArray()];
  };

  it('produces identical results regardless of render frame cadence', () => {
    const a = runWithFrames(() => 16.6667);
    const b = runWithFrames(() => 6.944);
    const c = runWithFrames((i) => 4 + ((i * 7919) % 29));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('clamps the number of steps after a long stall', () => {
    const stepper = new FixedStepper(SIM_DT);
    let n = 0;
    stepper.advance(5, () => n++);
    expect(n).toBeLessThanOrEqual(12);
  });
});

describe('game flow', () => {
  it('handles start, pause, resume, go-around, result, retry and new conditions', () => {
    let f = initialFlow();
    expect(f.screen).toBe('title');
    expect(f.mode).toBe('landing');
    f = flowReduce(f, { type: 'start', mode: 'landing', code: 'BRZ-00001' });
    expect(f.screen).toBe('playing');
    const attempt = f.attempt;
    f = flowReduce(f, { type: 'pause' });
    expect(f.screen).toBe('paused');
    f = flowReduce(f, { type: 'goAround' });
    expect(f.screen).toBe('paused');
    f = flowReduce(f, { type: 'resume' });
    expect(f.screen).toBe('playing');
    f = flowReduce(f, { type: 'goAround' });
    expect(f.screen).toBe('goaround');
    f = flowReduce(f, { type: 'goAroundDone' });
    expect(f.screen).toBe('playing');
    expect(f.goArounds).toBe(1);
    f = flowReduce(f, { type: 'finish' });
    expect(f.screen).toBe('result');
    f = flowReduce(f, { type: 'pause' });
    expect(f.screen).toBe('result');
    f = flowReduce(f, { type: 'retry' });
    expect(f.screen).toBe('playing');
    expect(f.code).toBe('BRZ-00001');
    expect(f.attempt).toBe(attempt + 1);
    expect(f.goArounds).toBe(0);
    f = flowReduce(f, { type: 'finish' });
    f = flowReduce(f, { type: 'newConditions', code: 'GST-00002' });
    expect(f.screen).toBe('playing');
    expect(f.code).toBe('GST-00002');
    f = flowReduce(f, { type: 'title' });
    expect(f.screen).toBe('title');
  });
});
