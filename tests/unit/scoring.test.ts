import { describe, expect, it } from 'vitest';
import { scoreLanding, scoreTakeoff, type LandingSummary, type TakeoffSummary } from '../../src/sim/scoring';

const perfect = (): LandingSummary => ({
  touchdown: {
    sinkFpm: 70,
    sinkMps: 70 * 0.00508,
    lateralVelocity: 0.05,
    driftVelocity: 0.05,
    centerlineOffset: 0.2,
    yawErrorDeg: 0.4,
    bankDeg: 0.5,
    pitchDeg: 5,
    kias: 50,
    distancePastThreshold: 220,
    firstContact: 'main',
    time: 90,
  },
  maxSinkFpm: 70,
  maxBounceHeight: 0,
  bounces: 0,
  stableFraction: 1,
  stableSamples: 600,
  unstableReason: null,
  rolloutMaxOffset: 0.8,
  skidTime: 0,
  runwayRemaining: 350,
  endReason: 'stopped',
  failure: null,
});

describe('landing score', () => {
  it('rewards a soft, centered, aligned, stabilized landing near 1000', () => {
    const r = scoreLanding(perfect());
    expect(r.total).toBeGreaterThanOrEqual(950);
    expect(r.label).toBe('Butter');
    expect(r.grade).toBe('S');
    const sum = r.breakdown.reduce((a, b) => a + b.points, 0);
    expect(Math.round(sum)).toBe(r.total);
    expect(r.breakdown.map((b) => b.max)).toEqual([400, 200, 150, 150, 100]);
  });

  it('does not score sink rate alone: a soft but crabbed, off-center landing loses to a firmer aligned one', () => {
    const soft = perfect();
    soft.touchdown!.sinkFpm = 60;
    soft.touchdown!.centerlineOffset = 7;
    soft.touchdown!.yawErrorDeg = 9;
    soft.touchdown!.driftVelocity = 1.8;
    const aligned = perfect();
    aligned.touchdown!.sinkFpm = 190;
    aligned.maxSinkFpm = 190;
    expect(scoreLanding(aligned).total).toBeGreaterThan(scoreLanding(soft).total + 100);
    expect(scoreLanding(soft).label).toBe('Side-loaded');
  });

  it('excessive float cannot score perfectly', () => {
    const f = perfect();
    f.touchdown!.distancePastThreshold = 640;
    const r = scoreLanding(f);
    expect(r.total).toBeLessThan(800);
    expect(r.biggestLoss.toLowerCase()).toContain('float');
  });

  it('penalizes nosewheel-first contact', () => {
    const n = perfect();
    n.touchdown!.firstContact = 'nose';
    const r = scoreLanding(n);
    expect(r.label).toBe('Nosewheel first');
    expect(r.breakdown[0]!.points).toBeLessThan(200);
  });

  it('labels by sink band and centerline', () => {
    const band = (fpm: number) => {
      const l = perfect();
      l.touchdown!.sinkFpm = fpm;
      l.maxSinkFpm = fpm;
      return scoreLanding(l).label;
    };
    expect(band(100)).toBe('Butter');
    expect(band(180)).toBe('Smooth');
    expect(band(320)).toBe('Firm');
    expect(band(520)).toBe('Hard landing');
    const off = perfect();
    off.touchdown!.centerlineOffset = -6.5;
    expect(scoreLanding(off).label).toBe('Off centerline');
    const b = perfect();
    b.maxBounceHeight = 0.9;
    b.bounces = 1;
    expect(scoreLanding(b).label).toBe('Bounce');
  });

  it('butter requires alignment and centerline too', () => {
    const l = perfect();
    l.touchdown!.centerlineOffset = 3.5;
    expect(scoreLanding(l).label).toBe('Smooth');
  });

  it('failures grade F with a capped score and a failure label', () => {
    const l = perfect();
    l.failure = 'runway-excursion';
    l.endReason = 'failure';
    const r = scoreLanding(l);
    expect(r.grade).toBe('F');
    expect(r.total).toBeLessThanOrEqual(250);
    expect(r.label).toBe('Runway excursion');
    const c = perfect();
    c.failure = 'gear-collapse';
    c.endReason = 'failure';
    expect(scoreLanding(c).label).toBe('Gear collapse');
  });

  it('an unstable approach costs the stabilized component', () => {
    const l = perfect();
    l.stableFraction = 0.3;
    l.unstableReason = 'speed';
    const r = scoreLanding(l);
    expect(r.breakdown[3]!.points).toBeCloseTo(45, 0);
  });
});

const cleanTakeoff = (): TakeoffSummary => ({
  rotateKias: 55,
  liftoffKias: 58,
  liftoffDistance: 320,
  maxRollOffset: 0.6,
  maxPitchOnGroundDeg: 10,
  wheelbarrowTime: 0,
  climbFraction: 1,
  climbAvgKias: 75,
  maxTrackOffset: 6,
  endReason: 'climb-established',
  failure: null,
});

describe('takeoff score', () => {
  it('scores a clean takeoff highly', () => {
    const r = scoreTakeoff(cleanTakeoff());
    expect(r.total).toBeGreaterThan(930);
    expect(r.label).toBe('Clean takeoff');
  });

  it('penalizes premature rotation and wheelbarrowing', () => {
    const p = cleanTakeoff();
    p.rotateKias = 41;
    p.liftoffKias = 44;
    expect(scoreTakeoff(p).label).toBe('Premature rotation');
    const w = cleanTakeoff();
    w.wheelbarrowTime = 3;
    expect(scoreTakeoff(w).label).toBe('Wheelbarrowing');
    expect(scoreTakeoff(w).total).toBeLessThan(scoreTakeoff(cleanTakeoff()).total);
  });

  it('fails on tail strike', () => {
    const t = cleanTakeoff();
    t.failure = 'tail-strike';
    t.endReason = 'failure';
    const r = scoreTakeoff(t);
    expect(r.grade).toBe('F');
    expect(r.label).toBe('Tail strike');
  });
});
