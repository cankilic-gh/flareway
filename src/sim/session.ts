import { Quaternion, Vector3 } from 'three';
import { AIRCRAFT, AUTHORED_ANCHORS, DEG, GRAVITY, KT, RHO, RUNWAY, SIM_DT } from './constants';
import { RUNWAYS, type RunwayInfo } from './airfield';
import { decodeConditionCode, generateConditions, type Conditions } from './conditions';
import { createWindField, sampleWind, type WindField } from './wind';
import {
  alphaStall,
  createAircraftState,
  defaultAssists,
  dragCoefficient,
  liftCoefficient,
  pilotEye,
  stepAircraft,
  trimElevatorFor,
  type AircraftState,
  type Assists,
  type ControlInput,
} from './physics';
import { createPapi, updatePapi, type PapiState } from './papi';
import {
  createLandingTracker,
  createTakeoffTracker,
  summarizeLanding,
  summarizeTakeoff,
  updateLandingTracker,
  updateTakeoffTracker,
  type LandingTracker,
  type TakeoffTracker,
} from './attempt';
import { scoreLanding, scoreTakeoff, type FailureKind, type ScoreResult, type TakeoffSummary, type TouchdownMetrics } from './scoring';
import { ReplayRecorder } from './replay';
import type { GameMode } from './flow';

export interface AttemptResult {
  mode: GameMode;
  code: string;
  score: ScoreResult;
  failure: FailureKind | null;
  touchdown: TouchdownMetrics | null;
  takeoff: TakeoffSummary | null;
  endTime: number;
  /** Time of the key event (touchdown, liftoff or failure) for the replay window. */
  eventTime: number;
  maxBounceHeight: number;
  runwayRemaining: number;
  goArounds: number;
}

export const APPROACH_KIAS = 68;

/** Throttle and angle of attack for steady flight at speed V on flight-path angle gamma. */
export const solveTrim = (V: number, flapDeg: number, gamma: number): { alpha: number; throttle: number; power: number } => {
  const W = AIRCRAFT.mass * GRAVITY;
  const q = 0.5 * RHO * V * V * AIRCRAFT.wingArea;
  const clNeed = (W * Math.cos(gamma)) / q;
  let lo = -8 * DEG;
  let hi = alphaStall(flapDeg);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (liftCoefficient(mid, flapDeg) < clNeed) lo = mid;
    else hi = mid;
  }
  const alpha = (lo + hi) / 2;
  const drag = q * dragCoefficient(clNeed, flapDeg, 1, alpha, 0);
  const thrustNeed = drag + W * Math.sin(gamma);
  const thrustAt = (p: number) =>
    Math.min(AIRCRAFT.maxStaticThrust * p, (AIRCRAFT.propEfficiency * AIRCRAFT.maxPowerW * p) / Math.max(V, 1)) - AIRCRAFT.windmillDragPerMps * V * (1 - p);
  let plo: number = AIRCRAFT.idlePowerFraction;
  let phi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (plo + phi) / 2;
    if (thrustAt(mid) < thrustNeed) plo = mid;
    else phi = mid;
  }
  const power = (plo + phi) / 2;
  const throttle = Math.max(0, Math.min(1, (power - AIRCRAFT.idlePowerFraction) / (1 - AIRCRAFT.idlePowerFraction)));
  return { alpha, throttle, power };
};

const _tmp = new Vector3();
const _eye = new Vector3();
const _qYaw = new Quaternion();
const _qPitch = new Quaternion();
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

export const orientation = (headingDegrees: number, pitchRad: number, out: Quaternion): Quaternion => {
  _qYaw.setFromAxisAngle(Y_AXIS, -(headingDegrees - 90) * DEG);
  _qPitch.setFromAxisAngle(Z_AXIS, pitchRad);
  return out.copy(_qYaw).multiply(_qPitch);
};

export class FlightSession {
  readonly mode: GameMode;
  readonly conditions: Conditions;
  readonly runway: RunwayInfo;
  readonly wind: WindField;
  assists: Assists;
  state: AircraftState;
  papi: PapiState;
  tracker: LandingTracker | TakeoffTracker;
  readonly replay = new ReplayRecorder();
  stepCount = 0;
  goArounds = 0;
  result: AttemptResult | null = null;
  /** Sim time carried across go-arounds so the wind keeps evolving. */
  private timeBase = 0;

  constructor(mode: GameMode, code: string, assists: Assists = defaultAssists()) {
    const decoded = decodeConditionCode(code);
    if (!decoded) throw new Error(`Invalid condition code: ${code}`);
    this.mode = mode;
    this.conditions = generateConditions(decoded.preset, decoded.seed);
    this.runway = RUNWAYS[this.conditions.runway];
    this.wind = createWindField(this.conditions);
    this.assists = { ...assists };
    this.state = createAircraftState();
    this.papi = createPapi(this.runway);
    this.tracker = this.createTracker();
    this.spawn();
  }

  get ended(): boolean {
    return this.result !== null;
  }

  private createTracker(): LandingTracker | TakeoffTracker {
    return this.mode === 'landing' ? createLandingTracker(this.runway) : createTakeoffTracker(this.runway, this.runway.takeoffStartX);
  }

  private spawn(): void {
    const s = createAircraftState();
    s.time = this.timeBase;
    this.state = s;
    const rw = this.runway;
    if (this.mode === 'landing') {
      const c = this.conditions.spawn;
      const x = rw.thresholdX - rw.dir * c.distanceM;
      const z = c.lateralM * rw.dir;
      const y = RUNWAY.surfaceY + c.heightM + 1.08;
      s.pos.set(x, y, z);
      const V = APPROACH_KIAS * KT;
      const gamma = -RUNWAY.glideDeg * DEG;
      s.flapIndex = 1;
      s.flapDeg = 10;
      const trim = solveTrim(V, s.flapDeg, gamma);
      sampleWind(this.wind, s.time, c.heightM, _tmp);
      const windLat = _tmp.z * rw.dir;
      const crab = Math.asin(Math.max(-0.5, Math.min(0.5, -windLat / V)));
      const heading = rw.headingDeg + crab / DEG;
      orientation(heading, trim.alpha + gamma, s.quat);
      // Air-relative velocity along the flight path, plus the air mass.
      const h = heading * DEG;
      s.vel.set(Math.sin(h) * V * Math.cos(gamma), V * Math.sin(gamma), -Math.cos(h) * V * Math.cos(gamma)).add(_tmp);
      s.throttle = trim.throttle;
      s.power = trim.power;
      s.rpm = 2000;
      s.trim = trimElevatorFor(trim.alpha, s.flapDeg);
      s.alphaHold = trim.alpha;
      s.alpha = trim.alpha;
      s.ias = V;
      s.agl = c.heightM;
      s.vs = s.vel.y;
      s.groundSpeed = Math.hypot(s.vel.x, s.vel.z);
    } else {
      s.pos.set(rw.takeoffStartX, RUNWAY.surfaceY + 1.08 - 0.072, 0);
      orientation(rw.headingDeg, 0, s.quat);
      s.trim = trimElevatorFor(4 * DEG, 0);
      // Settle on the gear with brakes held so play starts from rest.
      const hold: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 1, flaps: 0 };
      for (let i = 0; i < 180; i++) stepAircraft(s, hold, this.assists, this.wind, SIM_DT);
      s.time = this.timeBase;
      s.vel.set(0, 0, 0);
      s.rates.set(0, 0, 0);
      s.pos.x = rw.takeoffStartX;
      s.pos.z = 0;
    }
    this.papi = createPapi(rw);
    pilotEye(s, AUTHORED_ANCHORS.PilotCamera, _eye);
    updatePapi(this.papi, _eye, true);
    this.tracker = this.createTracker();
    this.replay.clear();
    this.replay.record(s);
    this.result = null;
  }

  /** Restart from the same conditions (retry). */
  restart(): void {
    this.timeBase = 0;
    this.goArounds = 0;
    this.stepCount = 0;
    this.spawn();
  }

  /** Reset to a safe final with the same conditions; wind time keeps flowing. */
  goAround(): void {
    if (this.mode !== 'landing') return;
    this.timeBase = this.state.time;
    this.goArounds++;
    this.spawn();
  }

  step(input: ControlInput): void {
    if (this.result) return;
    const s = this.state;
    stepAircraft(s, input, this.assists, this.wind, SIM_DT);
    this.stepCount++;
    pilotEye(s, AUTHORED_ANCHORS.PilotCamera, _eye);
    updatePapi(this.papi, _eye, false);
    if (this.tracker.kind === 'landing') updateLandingTracker(this.tracker, s, this.papi, SIM_DT);
    else updateTakeoffTracker(this.tracker, s, SIM_DT);
    if ((this.stepCount & 1) === 0) this.replay.record(s);
    if (this.tracker.phase === 'ended') this.finish();
  }

  private finish(): void {
    const t = this.tracker;
    if (t.kind === 'landing') {
      const summary = summarizeLanding(t);
      this.result = {
        mode: 'landing',
        code: this.conditions.code,
        score: scoreLanding(summary),
        failure: t.failure,
        touchdown: t.touchdown,
        takeoff: null,
        endTime: t.endTime,
        eventTime: t.touchdown ? t.touchdown.time : t.endTime,
        maxBounceHeight: t.maxBounceHeight,
        runwayRemaining: summary.runwayRemaining,
        goArounds: this.goArounds,
      };
    } else {
      const summary = summarizeTakeoff(t);
      this.result = {
        mode: 'takeoff',
        code: this.conditions.code,
        score: scoreTakeoff(summary),
        failure: t.failure,
        touchdown: null,
        takeoff: summary,
        endTime: t.endTime,
        eventTime: t.failure ? t.endTime : t.liftoffTime || t.endTime,
        maxBounceHeight: 0,
        runwayRemaining: 0,
        goArounds: 0,
      };
    }
  }
}
