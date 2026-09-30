import { DEG, FPM, FT, KT, RUNWAY } from './constants';
import { alongTrack, lateralOffset, runwayRemaining, type RunwayInfo } from './airfield';
import { attitude, headingDeg, type AircraftState } from './physics';
import { papiIndication, type PapiState } from './papi';
import type { FailureKind, LandingSummary, TakeoffSummary, TouchdownMetrics } from './scoring';

const TRACE_CAPACITY = 400;
const TRACE_SPACING = 10;

export interface CenterlineTrace {
  /** Interleaved [alongTrack, lateralOffset] pairs. */
  data: Float32Array;
  count: number;
  lastS: number;
}

const createTrace = (): CenterlineTrace => ({ data: new Float32Array(TRACE_CAPACITY * 2), count: 0, lastS: -Infinity });

const pushTrace = (t: CenterlineTrace, s: number, d: number): void => {
  if (s - t.lastS < TRACE_SPACING) return;
  if (t.count >= TRACE_CAPACITY) {
    t.data.copyWithin(0, 2);
    t.count--;
  }
  t.data[t.count * 2] = s;
  t.data[t.count * 2 + 1] = d;
  t.count++;
  t.lastS = s;
};

const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const att = { pitch: 0, bank: 0 };

/** Checks shared by both modes. Returns a failure or null. */
export const detectFailure = (s: AircraftState, rw: RunwayInfo, phaseBeforeTouchdown: boolean): FailureKind | null => {
  if (s.strikes.prop) return 'prop-strike';
  if (s.strikes.tail) return 'tail-strike';
  if (s.strikes.wingL || s.strikes.wingR) return 'wingtip-strike';
  if (s.pos.y < RUNWAY.waterY + 0.4) {
    for (const g of s.gear) if (g.surface === 'water') return 'ditched';
  }
  let anyContact = false;
  for (const g of s.gear) {
    if (!g.inContact) continue;
    anyContact = true;
    if (g.collapsed) return s.buffet > 0.45 ? 'stall-impact' : 'gear-collapse';
  }
  if (!anyContact) return null;
  if (runwayRemaining(rw, s.pos.x) < 0) return 'ran-out-of-runway';
  for (const g of s.gear) {
    if (!g.inContact || g.surface === 'runway') continue;
    const along = alongTrack(rw, g.world.x);
    if (g.surface === 'terrain' || g.surface === 'beach') return along < 0 ? 'landed-short' : 'terrain';
    if (phaseBeforeTouchdown && along < -(RUNWAY.halfLength - RUNWAY.thresholdAbsX)) return 'landed-short';
    return 'runway-excursion';
  }
  return null;
};

export interface LandingTracker {
  kind: 'landing';
  runway: RunwayInfo;
  phase: 'approach' | 'rollout' | 'ended';
  touchdown: TouchdownMetrics | null;
  firstContact: 'main' | 'nose' | null;
  maxSinkFpm: number;
  bounces: number;
  maxBounceHeight: number;
  bounceCounted: boolean;
  stableSamples: number;
  stableCount: number;
  reasons: Record<'speed' | 'glide path' | 'centerline' | 'sink rate' | 'bank', number>;
  stableNow: boolean;
  unstableNow: string | null;
  rolloutMaxOffset: number;
  skidTime: number;
  stoppedTime: number;
  runwayRemainingAtStop: number;
  failure: FailureKind | null;
  endReason: LandingSummary['endReason'] | null;
  endTime: number;
  overflew: boolean;
  trace: CenterlineTrace;
}

export const createLandingTracker = (runway: RunwayInfo): LandingTracker => ({
  kind: 'landing',
  runway,
  phase: 'approach',
  touchdown: null,
  firstContact: null,
  maxSinkFpm: 0,
  bounces: 0,
  maxBounceHeight: 0,
  bounceCounted: false,
  stableSamples: 0,
  stableCount: 0,
  reasons: { speed: 0, 'glide path': 0, centerline: 0, 'sink rate': 0, bank: 0 },
  stableNow: true,
  unstableNow: null,
  rolloutMaxOffset: 0,
  skidTime: 0,
  stoppedTime: 0,
  runwayRemainingAtStop: 0,
  failure: null,
  endReason: null,
  endTime: 0,
  overflew: false,
  trace: createTrace(),
});

const end = (t: LandingTracker | TakeoffTracker, reason: string, time: number): void => {
  t.phase = 'ended';
  (t as { endReason: string | null }).endReason = reason;
  t.endTime = time;
};

const touchdownMetrics = (s: AircraftState, rw: RunwayInfo, first: 'main' | 'nose'): TouchdownMetrics => {
  attitude(s.quat, att);
  const closing = Math.max(s.gear[0]!.closingSpeed, s.gear[1]!.closingSpeed, -s.vs);
  const fwdX = Math.cos((headingDeg(s.quat) - 90) * DEG);
  const fwdZ = Math.sin((headingDeg(s.quat) - 90) * DEG);
  // Aircraft-right on the ground plane is (-fwdZ, fwdX) rotated: right = fwd x up.
  const drift = s.vel.x * -fwdZ + s.vel.z * fwdX;
  return {
    sinkFpm: closing / FPM,
    sinkMps: closing,
    lateralVelocity: s.vel.z * rw.dir,
    driftVelocity: drift,
    centerlineOffset: lateralOffset(rw, s.pos.z),
    yawErrorDeg: wrap180(headingDeg(s.quat) - rw.headingDeg),
    bankDeg: att.bank / DEG,
    pitchDeg: att.pitch / DEG,
    kias: s.ias / KT,
    distancePastThreshold: alongTrack(rw, s.pos.x),
    firstContact: first,
    time: s.time,
  };
};

export const updateLandingTracker = (t: LandingTracker, s: AircraftState, papi: PapiState, dt: number): void => {
  if (t.phase === 'ended') return;
  const rw = t.runway;
  const along = alongTrack(rw, s.pos.x);
  const d = lateralOffset(rw, s.pos.z);
  if (along > -2000) pushTrace(t.trace, along, d);

  if (t.phase === 'approach') {
    const nose = s.gear[2]!.inContact;
    const mains = s.gear[0]!.inContact || s.gear[1]!.inContact;
    if (!t.firstContact && (nose || mains)) t.firstContact = mains ? 'main' : 'nose';
    if (mains && !t.touchdown) {
      t.touchdown = touchdownMetrics(s, rw, t.firstContact ?? 'main');
      t.maxSinkFpm = t.touchdown.sinkFpm;
      t.phase = 'rollout';
    }
  }

  const failure = detectFailure(s, rw, t.phase === 'approach');
  if (failure) {
    t.failure = failure;
    if (!t.touchdown && s.onGround) t.touchdown = touchdownMetrics(s, rw, t.firstContact ?? 'main');
    end(t, 'failure', s.time);
    return;
  }

  if (t.phase === 'approach') {
    const aglFt = s.agl / FT;
    if (aglFt > 50 && aglFt < 500) {
      attitude(s.quat, att);
      const kias = s.ias / KT;
      const ind = papiIndication(papi);
      const dist = Math.max(0, -along) + 300;
      let reason: keyof LandingTracker['reasons'] | null = null;
      if (kias < 55 || kias > 82) reason = 'speed';
      else if (papi.visible && (ind === 'too-high' || ind === 'too-low')) reason = 'glide path';
      else if (Math.abs(d) > 8 + dist * Math.tan(2.5 * DEG)) reason = 'centerline';
      else if (s.vs < -1000 * FPM) reason = 'sink rate';
      else if (Math.abs(att.bank) > 25 * DEG) reason = 'bank';
      t.stableSamples++;
      if (reason) t.reasons[reason]++;
      else t.stableCount++;
      t.stableNow = reason === null;
      t.unstableNow = reason;
    } else {
      t.stableNow = true;
      t.unstableNow = null;
    }
    if (!s.onGround && runwayRemaining(rw, s.pos.x) < 0) t.overflew = true;
    return;
  }

  // Rollout: bounces, centerline, skids, stop.
  if (!s.onGround) {
    t.maxBounceHeight = Math.max(t.maxBounceHeight, s.agl);
    if (s.agl > 0.25 && !t.bounceCounted) {
      t.bounces++;
      t.bounceCounted = true;
    }
    if (s.agl > 12) end(t, 'touch-and-go', s.time);
    return;
  }
  t.bounceCounted = false;
  for (let i = 0; i < 2; i++) {
    const g = s.gear[i]!;
    if (g.inContact && g.closingSpeed > 0) t.maxSinkFpm = Math.max(t.maxSinkFpm, g.closingSpeed / FPM);
  }
  if (s.gear.every((g) => g.inContact)) t.rolloutMaxOffset = Math.max(t.rolloutMaxOffset, Math.abs(d));
  if (s.skidding) t.skidTime += dt;
  if (s.groundSpeed < 1.0) {
    t.stoppedTime += dt;
    if (t.stoppedTime > 0.5) {
      t.runwayRemainingAtStop = runwayRemaining(rw, s.pos.x);
      end(t, 'stopped', s.time);
    }
  } else t.stoppedTime = 0;
  if (t.touchdown && s.time - t.touchdown.time > 75) {
    t.runwayRemainingAtStop = runwayRemaining(rw, s.pos.x);
    end(t, 'timeout', s.time);
  }
};

export const summarizeLanding = (t: LandingTracker): LandingSummary => {
  let worst: string | null = null;
  let worstN = 0;
  for (const [k, v] of Object.entries(t.reasons)) {
    if (v > worstN) {
      worst = k;
      worstN = v;
    }
  }
  return {
    touchdown: t.touchdown,
    maxSinkFpm: t.maxSinkFpm,
    maxBounceHeight: t.maxBounceHeight,
    bounces: t.bounces,
    stableFraction: t.stableSamples > 0 ? t.stableCount / t.stableSamples : 0,
    stableSamples: t.stableSamples,
    unstableReason: worst,
    rolloutMaxOffset: t.rolloutMaxOffset,
    skidTime: t.skidTime,
    runwayRemaining: t.runwayRemainingAtStop,
    endReason: (t.endReason ?? 'timeout') as LandingSummary['endReason'],
    failure: t.failure,
  };
};

export interface TakeoffTracker {
  kind: 'takeoff';
  runway: RunwayInfo;
  phase: 'roll' | 'airborne' | 'ended';
  startX: number;
  rotateKias: number | null;
  liftoffKias: number | null;
  liftoffDistance: number | null;
  liftoffTime: number;
  airborneTime: number;
  maxRollOffset: number;
  maxPitchOnGroundDeg: number;
  wheelbarrowTime: number;
  climbSamples: number;
  climbGood: number;
  climbKiasSum: number;
  maxTrackOffset: number;
  failure: FailureKind | null;
  endReason: TakeoffSummary['endReason'] | null;
  endTime: number;
  trace: CenterlineTrace;
}

export const createTakeoffTracker = (runway: RunwayInfo, startX: number): TakeoffTracker => ({
  kind: 'takeoff',
  runway,
  phase: 'roll',
  startX,
  rotateKias: null,
  liftoffKias: null,
  liftoffDistance: null,
  liftoffTime: 0,
  airborneTime: 0,
  maxRollOffset: 0,
  maxPitchOnGroundDeg: 0,
  wheelbarrowTime: 0,
  climbSamples: 0,
  climbGood: 0,
  climbKiasSum: 0,
  maxTrackOffset: 0,
  failure: null,
  endReason: null,
  endTime: 0,
  trace: createTrace(),
});

export const TAKEOFF_SUCCESS_AGL = 150 * FT;

export const updateTakeoffTracker = (t: TakeoffTracker, s: AircraftState, dt: number): void => {
  if (t.phase === 'ended') return;
  const rw = t.runway;
  const along = alongTrack(rw, s.pos.x);
  const d = lateralOffset(rw, s.pos.z);
  pushTrace(t.trace, along, d);
  const failure = detectFailure(s, rw, false);
  if (failure) {
    t.failure = failure;
    end(t, 'failure', s.time);
    return;
  }
  const kias = s.ias / KT;
  attitude(s.quat, att);
  const mains = s.gear[0]!.inContact || s.gear[1]!.inContact;
  const nose = s.gear[2]!.inContact;
  if (t.phase === 'roll') {
    if (s.onGround) {
      t.maxRollOffset = Math.max(t.maxRollOffset, Math.abs(d));
      if (mains) t.maxPitchOnGroundDeg = Math.max(t.maxPitchOnGroundDeg, att.pitch / DEG);
      if (t.rotateKias === null && mains && !nose && kias > 15) t.rotateKias = kias;
      const total = s.gear.reduce((a, g) => a + g.load, 0);
      if (nose && kias > 48 && total > 0 && s.gear[2]!.load / total > 0.3) t.wheelbarrowTime += dt;
      t.airborneTime = 0;
    } else {
      if (t.airborneTime === 0) {
        t.liftoffKias = kias;
        t.liftoffDistance = (s.pos.x - t.startX) * rw.dir;
        t.liftoffTime = s.time;
        if (t.rotateKias === null) t.rotateKias = kias;
      }
      t.airborneTime += dt;
      if (t.airborneTime > 0.5 && s.agl > 0.5) t.phase = 'airborne';
    }
  } else if (t.phase === 'airborne') {
    t.maxTrackOffset = Math.max(t.maxTrackOffset, Math.abs(d));
    if (s.time - t.liftoffTime > 3) {
      t.climbSamples++;
      t.climbKiasSum += kias;
      if (kias >= 68 && kias <= 82) t.climbGood++;
    }
    if (s.agl > TAKEOFF_SUCCESS_AGL && s.vs > 0.3) end(t, 'climb-established', s.time);
    if (s.onGround) t.phase = 'roll';
  }
  if ((t.phase as TakeoffTracker['phase']) !== 'ended' && s.time > 150) end(t, 'timeout', s.time);
};

export const summarizeTakeoff = (t: TakeoffTracker): TakeoffSummary => ({
  rotateKias: t.rotateKias,
  liftoffKias: t.liftoffKias,
  liftoffDistance: t.liftoffDistance,
  maxRollOffset: t.maxRollOffset,
  maxPitchOnGroundDeg: t.maxPitchOnGroundDeg,
  wheelbarrowTime: t.wheelbarrowTime,
  climbFraction: t.climbSamples > 0 ? t.climbGood / t.climbSamples : 0,
  climbAvgKias: t.climbSamples > 0 ? t.climbKiasSum / t.climbSamples : null,
  maxTrackOffset: t.maxTrackOffset,
  endReason: (t.endReason ?? 'timeout') as TakeoffSummary['endReason'],
  failure: t.failure,
});
