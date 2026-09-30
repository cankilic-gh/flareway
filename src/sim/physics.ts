import { Quaternion, Vector3 } from 'three';
import { AIRCRAFT, DEG, GEAR, GRAVITY, RHO, STRIKE_POINTS, TIRE, KT } from './constants';
import { sampleGround, type GroundSample, type Surface } from './airfield';
import { sampleWind, type WindField } from './wind';

export interface ControlInput {
  /** +1 nose up. */
  pitch: number;
  /** +1 roll right. */
  roll: number;
  /** +1 yaw right. */
  yaw: number;
  /** 0..1 commanded throttle. */
  throttle: number;
  /** 0..1 wheel brakes. */
  brake: number;
  /** Flap detent 0..3. */
  flaps: number;
}

export interface Assists {
  pitchStability: boolean;
  coordinatedRudder: boolean;
  autoThrottle: boolean;
  autoThrottleTargetKt: number;
}

export const neutralInput = (): ControlInput => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, flaps: 0 });

export const defaultAssists = (): Assists => ({
  pitchStability: true,
  coordinatedRudder: true,
  autoThrottle: false,
  autoThrottleTargetKt: 65,
});

export interface ContactState {
  name: string;
  inContact: boolean;
  compression: number;
  closingSpeed: number;
  load: number;
  surface: Surface;
  lateralSlip: number;
  world: Vector3;
  collapsed: boolean;
  skidding: boolean;
}

export interface StrikeState {
  tail: boolean;
  prop: boolean;
  wingL: boolean;
  wingR: boolean;
}

export interface AircraftState {
  time: number;
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  /** x: roll rate (+right), y: yaw rate (+nose right), z: pitch rate (+nose up); rad/s. */
  rates: Vector3;
  throttle: number;
  power: number;
  rpm: number;
  propAngle: number;
  flapIndex: number;
  flapDeg: number;
  aileron: number;
  elevator: number;
  rudder: number;
  trim: number;
  alphaHold: number;
  steerDeg: number;
  brake: number;
  autoThrottleI: number;
  // Derived each step.
  wind: Vector3;
  ias: number;
  alpha: number;
  beta: number;
  groundSpeed: number;
  vs: number;
  agl: number;
  stallWarning: boolean;
  buffet: number;
  thrust: number;
  gear: ContactState[];
  wheelSpin: [number, number, number];
  onGround: boolean;
  mainsOnGround: boolean;
  noseOnGround: boolean;
  skidding: boolean;
  strikes: StrikeState;
  loadFactor: number;
}

export const createAircraftState = (): AircraftState => ({
  time: 0,
  pos: new Vector3(),
  vel: new Vector3(),
  quat: new Quaternion(),
  rates: new Vector3(),
  throttle: 0,
  power: 0,
  rpm: AIRCRAFT.idleRpm,
  propAngle: 0,
  flapIndex: 0,
  flapDeg: 0,
  aileron: 0,
  elevator: 0,
  rudder: 0,
  trim: 0,
  alphaHold: 0,
  steerDeg: 0,
  brake: 0,
  autoThrottleI: 0,
  wind: new Vector3(),
  ias: 0,
  alpha: 0,
  beta: 0,
  groundSpeed: 0,
  vs: 0,
  agl: 0,
  stallWarning: false,
  buffet: 0,
  thrust: 0,
  gear: GEAR.map((g) => ({
    name: g.name,
    inContact: false,
    compression: 0,
    closingSpeed: 0,
    load: 0,
    surface: 'runway' as Surface,
    lateralSlip: 0,
    world: new Vector3(),
    collapsed: false,
    skidding: false,
  })),
  wheelSpin: [0, 0, 0],
  onGround: false,
  mainsOnGround: false,
  noseOnGround: false,
  skidding: false,
  strikes: { tail: false, prop: false, wingL: false, wingR: false },
  loadFactor: 1,
});

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const flapTable = (table: readonly number[], flapDeg: number): number => {
  const f = clamp(flapDeg / 10, 0, table.length - 1);
  const i = Math.min(Math.floor(f), table.length - 2);
  return lerp(table[i]!, table[i + 1]!, f - i);
};

export const alphaStall = (flapDeg: number): number => flapTable(AIRCRAFT.alphaStallDeg, flapDeg) * DEG;

/** Section-free whole-aircraft lift coefficient with a simple post-stall and flat-plate blend. */
export const liftCoefficient = (alpha: number, flapDeg: number): number => {
  const base = AIRCRAFT.cl0 + flapTable(AIRCRAFT.flapDeltaCl, flapDeg);
  const as = alphaStall(flapDeg);
  const negStall = -12 * DEG;
  let cl: number;
  if (alpha >= negStall && alpha <= as) {
    cl = base + AIRCRAFT.clAlpha * alpha;
  } else if (alpha > as) {
    const clMax = base + AIRCRAFT.clAlpha * as;
    const e = alpha - as;
    cl = clMax * (1 - AIRCRAFT.postStallLiftLoss * smoothstep(0, 5 * DEG, e));
  } else {
    const clMin = base + AIRCRAFT.clAlpha * negStall;
    cl = clMin * (1 - 0.35 * smoothstep(0, 5 * DEG, negStall - alpha));
  }
  // Blend to flat-plate behaviour far outside the normal envelope (ground handling at low speed).
  const plate = 1.1 * Math.sin(2 * alpha);
  const w = smoothstep(24 * DEG, 40 * DEG, Math.abs(alpha));
  return lerp(cl, plate, w);
};

/** groundEffect: 1 out of ground effect, < 1 reduces induced drag. */
export const dragCoefficient = (cl: number, flapDeg: number, groundEffect: number, alpha = 0, beta = 0): number => {
  const k = 1 / (Math.PI * AIRCRAFT.aspectRatio * AIRCRAFT.oswald);
  const as = alphaStall(flapDeg);
  const stallDrag = 0.5 * smoothstep(as - 1 * DEG, as + 8 * DEG, Math.abs(alpha));
  const plate = 1.25 * Math.sin(alpha) ** 2;
  return AIRCRAFT.cd0 + flapTable(AIRCRAFT.flapDeltaCd, flapDeg) + k * cl * cl * groundEffect + AIRCRAFT.cdBeta * beta * beta + Math.max(stallDrag, plate);
};

/** McCormick induced-drag factor from wing height over span. */
export const groundEffectFactor = (wingHeight: number): number => {
  const r = (16 * Math.max(0.05, wingHeight)) / AIRCRAFT.span;
  return (r * r) / (1 + r * r);
};

export interface AeroResult {
  lift: number;
  drag: number;
  /** World-frame aerodynamic force (N). */
  force: Vector3;
  /** Body moments: x roll right, y yaw right, z pitch up (N·m). */
  moment: Vector3;
}

const _qInv = new Quaternion();
const _vb = new Vector3();
const _liftDir = new Vector3();
const _dragDir = new Vector3();
const _zAxis = new Vector3(0, 0, 1);
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _ground: GroundSample = { height: 0, surface: 'runway' };
const aeroOut: AeroResult = { lift: 0, drag: 0, force: new Vector3(), moment: new Vector3() };

const groundHeightUnder = (x: number, z: number): number => sampleGround(x, z, _ground).height;

/** Updates derived air data (wind, ias, alpha, beta) and returns aerodynamic loads. */
export const computeAero = (s: AircraftState, wind: WindField): AeroResult => {
  const gh = groundHeightUnder(s.pos.x, s.pos.z);
  const hCg = s.pos.y - gh;
  sampleWind(wind, s.time, Math.max(0, hCg), s.wind);
  _qInv.copy(s.quat).invert();
  _vb.copy(s.vel).sub(s.wind).applyQuaternion(_qInv);
  const V = _vb.length();
  s.ias = V;
  const out = aeroOut;
  out.force.set(0, 0, 0);
  out.moment.set(0, 0, 0);
  out.lift = 0;
  out.drag = 0;
  if (V < 0.5) {
    s.alpha = 0;
    s.beta = 0;
    s.stallWarning = false;
    s.buffet = 0;
    return out;
  }
  const alpha = Math.atan2(-_vb.y, _vb.x);
  const beta = Math.asin(clamp(_vb.z / V, -1, 1));
  s.alpha = alpha;
  s.beta = beta;

  const qd = 0.5 * RHO * V * V;
  const S = AIRCRAFT.wingArea;
  const ge = groundEffectFactor(hCg + AIRCRAFT.wingHeight);
  const liftBoost = 1 + 0.12 * (1 - smoothstep(0, AIRCRAFT.span * 0.6, hCg + AIRCRAFT.wingHeight));
  const cl = liftCoefficient(alpha, s.flapDeg) * liftBoost;
  const cd = dragCoefficient(cl, s.flapDeg, ge, alpha, beta);
  const cy = AIRCRAFT.cyBeta * beta + AIRCRAFT.cyRudder * s.rudder;

  _dragDir.copy(_vb).divideScalar(-V);
  _liftDir.crossVectors(_zAxis, _vb);
  const ll = _liftDir.length();
  if (ll > 1e-6) _liftDir.divideScalar(ll);
  else _liftDir.set(0, 1, 0);

  out.lift = qd * S * cl;
  out.drag = qd * S * cd;
  _tmp.copy(_liftDir).multiplyScalar(out.lift);
  _tmp.addScaledVector(_dragDir, out.drag);
  _tmp.z += qd * S * cy;
  out.force.copy(_tmp).applyQuaternion(s.quat);

  // Moments.
  const b = AIRCRAFT.span;
  const c = AIRCRAFT.chord;
  const pHat = (s.rates.x * b) / (2 * V);
  const rHat = (s.rates.y * b) / (2 * V);
  const qHat = (s.rates.z * c) / (2 * V);
  const qTail = qd + (AIRCRAFT.tailPropwash * s.thrust) / AIRCRAFT.propDiskArea;
  const as = alphaStall(s.flapDeg);
  const stallDepth = smoothstep(as, as + 4 * DEG, alpha);

  const Cl =
    AIRCRAFT.clAileron * s.aileron * (1 - 0.5 * stallDepth) +
    AIRCRAFT.clRollDamping * pHat +
    AIRCRAFT.clDihedral * beta +
    AIRCRAFT.clYawRate * rHat;
  const Cm =
    AIRCRAFT.cmZero +
    flapTable(AIRCRAFT.flapDeltaCm, s.flapDeg) +
    AIRCRAFT.cmAlpha * clamp(alpha, -20 * DEG, 25 * DEG) +
    AIRCRAFT.cmPitchDamping * qHat -
    0.08 * stallDepth;
  const Cn =
    AIRCRAFT.cnWeathervane * Math.sin(beta) +
    AIRCRAFT.cnYawDamping * rHat +
    AIRCRAFT.cnAdverseYaw * s.aileron +
    AIRCRAFT.cnRollRate * pHat;

  out.moment.set(
    qd * S * b * Cl,
    qd * S * b * Cn + qTail * S * b * AIRCRAFT.cnRudder * s.rudder,
    qd * S * c * Cm + qTail * S * c * AIRCRAFT.cmElevator * s.elevator,
  );

  const warnAlpha = as - AIRCRAFT.stallWarnMarginDeg * DEG;
  s.stallWarning = alpha > warnAlpha && V > 12;
  s.buffet = V > 12 ? smoothstep(warnAlpha, as + 1 * DEG, alpha) : 0;
  return out;
};

/** Elevator deflection that balances pitch moment at the given angle of attack. */
export const trimElevatorFor = (alpha: number, flapDeg: number): number =>
  clamp(-(AIRCRAFT.cmZero + flapTable(AIRCRAFT.flapDeltaCm, flapDeg) + AIRCRAFT.cmAlpha * alpha) / AIRCRAFT.cmElevator, -1, 1);

const _force = new Vector3();
const _torqueW = new Vector3();
const _r = new Vector3();
const _pv = new Vector3();
const _omegaW = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _wheelFwd = new Vector3();
const _wheelLat = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fContact = new Vector3();
const _bodyOmega = new Vector3();
const _dq = new Quaternion();

const worldPoint = (s: AircraftState, offset: readonly [number, number, number], out: Vector3): Vector3 =>
  out.set(offset[0], offset[1], offset[2]).applyQuaternion(s.quat).add(s.pos);

const omegaWorld = (s: AircraftState, out: Vector3): Vector3 =>
  // Body angular velocity vector in the GLB frame: roll about +X, yaw-right about -Y, pitch-up about +Z.
  out.set(s.rates.x, -s.rates.y, s.rates.z).applyQuaternion(s.quat);

const applyGear = (s: AircraftState, dt: number, force: Vector3, torque: Vector3): void => {
  omegaWorld(s, _omegaW);
  _fwd.set(1, 0, 0).applyQuaternion(s.quat);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-8) _fwd.set(1, 0, 0);
  _fwd.normalize();
  _right.crossVectors(_fwd, _up).normalize();
  s.onGround = false;
  s.mainsOnGround = false;
  s.noseOnGround = false;
  s.skidding = false;
  let mains = 0;
  for (let i = 0; i < GEAR.length; i++) {
    const g = GEAR[i]!;
    const cs = s.gear[i]!;
    worldPoint(s, g.offset, cs.world);
    sampleGround(cs.world.x, cs.world.z, _ground);
    cs.surface = _ground.surface;
    const comp = _ground.height - cs.world.y;
    _r.copy(cs.world).sub(s.pos);
    _pv.crossVectors(_omegaW, _r).add(s.vel);
    const wasInContact = cs.inContact;
    cs.skidding = false;
    if (comp <= 0 || _ground.surface === 'water') {
      cs.inContact = false;
      cs.compression = 0;
      cs.load = 0;
      cs.lateralSlip = 0;
      if (comp <= 0) cs.closingSpeed = 0;
      continue;
    }
    cs.inContact = true;
    if (!wasInContact) cs.closingSpeed = Math.max(0, -_pv.y);
    cs.compression = comp;
    const damping = _pv.y < 0 ? g.dampingCompress : g.dampingExtend;
    let n = g.stiffness * comp - damping * _pv.y;
    if (n < 0) n = 0;
    if (cs.collapsed) n *= 0.35;
    cs.load = n;

    // Wheel axes on the ground plane.
    let steer = 0;
    if (g.steerable) steer = s.steerDeg * DEG;
    const cosS = Math.cos(steer);
    const sinS = Math.sin(steer);
    _wheelFwd.copy(_fwd).multiplyScalar(cosS).addScaledVector(_right, sinS);
    _wheelLat.crossVectors(_wheelFwd, _up).normalize();
    const vLong = _pv.dot(_wheelFwd);
    const vLat = _pv.dot(_wheelLat);
    cs.lateralSlip = vLat;

    const surf = cs.surface === 'runway' || cs.surface === 'shoulder' ? TIRE.runway : TIRE.grass;
    let fLong = -n * surf.rolling * Math.tanh(vLong / TIRE.longSlipRef);
    if (g.braked && s.brake > 0) fLong -= n * TIRE.brakeMu * s.brake * Math.tanh(vLong / 0.4);
    let fLat = -n * surf.lateral * Math.tanh(vLat / TIRE.lateralSlipRef);
    const mag = Math.hypot(fLong, fLat);
    const peak = surf.peak * n;
    if (mag > peak && mag > 1) {
      const scale = (surf.sliding * n) / mag;
      fLong *= scale;
      fLat *= scale;
      if (Math.abs(vLong) > 2 || Math.abs(vLat) > 0.8) {
        cs.skidding = true;
        s.skidding = true;
      }
    }
    if (cs.collapsed) {
      fLong -= n * 0.6 * Math.tanh(vLong / 0.5);
    }
    _fContact.set(0, n, 0).addScaledVector(_wheelFwd, fLong).addScaledVector(_wheelLat, fLat);
    force.add(_fContact);
    _tmp2.crossVectors(_r, _fContact);
    torque.add(_tmp2);

    if (!cs.collapsed && (comp > g.collapseCompression || cs.closingSpeed > g.collapseSpeed)) cs.collapsed = true;
    s.onGround = true;
    if (g.steerable) s.noseOnGround = true;
    else mains++;
  }
  s.mainsOnGround = mains > 0;
  // Wheel spin for rendering (rolling without slip when loaded, free-wheel decay otherwise).
  const gsAlong = s.vel.dot(_fwd);
  for (let i = 0; i < 3; i++) {
    const radius = i === 2 ? 0.218 : 0.28;
    const cs = s.gear[i]!;
    const braked = i < 2 && s.brake > 0.6 && cs.inContact;
    if (!braked) s.wheelSpin[i] = (s.wheelSpin[i]! + (gsAlong / radius) * dt * (cs.inContact ? 1 : 0.985)) % (Math.PI * 2);
  }
};

const belowGround = (s: AircraftState, offset: readonly [number, number, number]): boolean => {
  worldPoint(s, offset, _tmp);
  return _tmp.y < groundHeightUnder(_tmp.x, _tmp.z) - 0.02;
};

const checkStrikes = (s: AircraftState): void => {
  s.strikes.tail = belowGround(s, STRIKE_POINTS.TailStrikePoint);
  s.strikes.prop = belowGround(s, STRIKE_POINTS.PropTip);
  s.strikes.wingL = belowGround(s, STRIKE_POINTS.WingTip_L);
  s.strikes.wingR = belowGround(s, STRIKE_POINTS.WingTip_R);
};

const approach = (current: number, target: number, rate: number, dt: number): number => {
  const d = target - current;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
};

/** One deterministic fixed step. Mutates the state in place; allocation free. */
export const stepAircraft = (s: AircraftState, input: ControlInput, assists: Assists, wind: WindField, dt: number): void => {
  // Flaps, engine.
  s.flapIndex = clamp(Math.round(input.flaps), 0, 3);
  const prevFlapDeg = s.flapDeg;
  s.flapDeg = approach(s.flapDeg, AIRCRAFT.flapDetentsDeg[s.flapIndex]!, AIRCRAFT.flapRateDegPerSec, dt);
  if (assists.pitchStability && s.flapDeg !== prevFlapDeg) {
    // Re-trim for the flap change like a pilot would: keep the held lift coefficient so the aircraft does not balloon.
    s.alphaHold -= (flapTable(AIRCRAFT.flapDeltaCl, s.flapDeg) - flapTable(AIRCRAFT.flapDeltaCl, prevFlapDeg)) / AIRCRAFT.clAlpha;
  }
  let throttle = clamp(input.throttle, 0, 1);
  if (assists.autoThrottle) {
    const err = assists.autoThrottleTargetKt - s.ias / KT;
    s.autoThrottleI = clamp(s.autoThrottleI + err * dt * 0.02, -0.4, 0.6);
    throttle = clamp(0.35 + err * 0.06 + s.autoThrottleI, 0, 1);
  }
  s.throttle = throttle;
  const powerTarget = AIRCRAFT.idlePowerFraction + (1 - AIRCRAFT.idlePowerFraction) * throttle;
  s.power += (powerTarget - s.power) * (1 - Math.exp(-dt / AIRCRAFT.engineTimeConstant));
  const rpmTarget = clamp(AIRCRAFT.idleRpm + (AIRCRAFT.maxRpm - 150 - AIRCRAFT.idleRpm) * Math.pow(throttle, 0.75) + s.ias * 5.5, AIRCRAFT.idleRpm, AIRCRAFT.maxRpm);
  s.rpm += (rpmTarget - s.rpm) * (1 - Math.exp(-dt / 0.45));
  s.propAngle = (s.propAngle + (s.rpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);

  // Control surfaces with assists.
  const onGroundPrev = s.mainsOnGround || s.noseOnGround;
  let pitchCmd = clamp(input.pitch, -1, 1);
  const rollCmd = clamp(input.roll, -1, 1);
  let yawCmd = clamp(input.yaw, -1, 1);
  if (assists.pitchStability && !onGroundPrev && s.ias > 18) {
    if (Math.abs(pitchCmd) < 0.04) {
      const target = trimElevatorFor(s.alphaHold, s.flapDeg);
      s.trim += (target - s.trim) * (1 - Math.exp(-dt / 1.2));
    } else {
      s.alphaHold = s.alpha;
    }
    pitchCmd -= 0.12 * s.rates.z;
  } else if (!assists.pitchStability) {
    // Fixed trim, speed-stable around a typical approach attitude.
    s.alphaHold = s.alpha;
  } else {
    s.alphaHold = s.alpha;
  }
  if (assists.coordinatedRudder && !onGroundPrev && s.ias > 15) {
    yawCmd += clamp(1.6 * s.beta + 0.25 * rollCmd, -0.5, 0.5);
  }
  const k = 1 - Math.exp(-dt / AIRCRAFT.surfaceTimeConstant);
  s.aileron += (rollCmd - s.aileron) * k;
  s.elevator += (clamp(pitchCmd + s.trim, -1, 1) - s.elevator) * k;
  const groundYaw = onGroundPrev ? clamp(yawCmd + rollCmd * 0.8, -1, 1) : yawCmd;
  s.rudder += (clamp(groundYaw, -1, 1) - s.rudder) * k;
  const gs = Math.hypot(s.vel.x, s.vel.z);
  const steerMax = lerp(TIRE.steerMaxLowSpeedDeg, TIRE.steerMaxHighSpeedDeg, smoothstep(2, 22, gs));
  s.steerDeg += (clamp(groundYaw, -1, 1) * steerMax - s.steerDeg) * (1 - Math.exp(-dt / 0.12));
  s.brake = clamp(input.brake, 0, 1);

  // Forces.
  const aero = computeAero(s, wind);
  const V = s.ias;
  const P = AIRCRAFT.maxPowerW * s.power;
  const staticThrust = AIRCRAFT.maxStaticThrust * s.power;
  s.thrust = Math.min(staticThrust, (AIRCRAFT.propEfficiency * P) / Math.max(V, 1)) - AIRCRAFT.windmillDragPerMps * V * (1 - s.power);

  _force.copy(aero.force);
  _fwd.set(1, 0, 0).applyQuaternion(s.quat);
  _force.addScaledVector(_fwd, s.thrust);
  _force.y -= AIRCRAFT.mass * GRAVITY;
  _torqueW.set(0, 0, 0);
  applyGear(s, dt, _force, _torqueW);

  // Deterministic stall wing-drop tendency.
  const as = alphaStall(s.flapDeg);
  const stallDepth = smoothstep(as, as + 3 * DEG, s.alpha);
  const wingDrop = stallDepth * 0.5 * AIRCRAFT.mass * GRAVITY * (Math.sin(s.time * 0.9) * 0.25 + Math.sign(s.beta || 1) * 0.15);

  // Body torques from gear (world -> body, then to pilot convention).
  _torqueW.applyQuaternion(_qInv.copy(s.quat).invert());
  const mRoll = aero.moment.x + _torqueW.x + wingDrop;
  const mYaw = aero.moment.y - _torqueW.y;
  const mPitch = aero.moment.z + _torqueW.z;

  // Integrate (semi-implicit Euler).
  const m = AIRCRAFT.mass;
  s.loadFactor = aero.lift / (m * GRAVITY);
  s.vel.addScaledVector(_force, dt / m);
  s.pos.addScaledVector(s.vel, dt);
  s.rates.x += (mRoll / AIRCRAFT.inertia.roll) * dt;
  s.rates.y += (mYaw / AIRCRAFT.inertia.yaw) * dt;
  s.rates.z += (mPitch / AIRCRAFT.inertia.pitch) * dt;
  // Numerical safety on the ground at very low speed.
  if (s.onGround && gs < 0.3) {
    s.rates.x *= 0.96;
    s.rates.y *= 0.96;
  }
  _bodyOmega.set(s.rates.x, -s.rates.y, s.rates.z);
  const w = _bodyOmega.length();
  if (w > 1e-9) {
    _dq.setFromAxisAngle(_bodyOmega.divideScalar(w), w * dt);
    s.quat.multiply(_dq).normalize();
  }

  s.time += dt;
  // Derived readouts.
  s.groundSpeed = Math.hypot(s.vel.x, s.vel.z);
  s.vs = s.vel.y;
  let minH = Infinity;
  for (let i = 0; i < 2; i++) {
    worldPoint(s, GEAR[i]!.offset, _tmp);
    minH = Math.min(minH, _tmp.y - groundHeightUnder(_tmp.x, _tmp.z));
  }
  s.agl = Math.max(0, minH);
  checkStrikes(s);
};

/** Heading in degrees (0 = north/-Z, 90 = east/+X). */
export const headingDeg = (q: Quaternion): number => {
  _fwd.set(1, 0, 0).applyQuaternion(q);
  const h = Math.atan2(_fwd.x, -_fwd.z) / DEG;
  return (h + 360) % 360;
};

/** Pitch attitude (+nose up) and bank (+right wing down), radians. */
export const attitude = (q: Quaternion, out: { pitch: number; bank: number }): { pitch: number; bank: number } => {
  _fwd.set(1, 0, 0).applyQuaternion(q);
  out.pitch = Math.asin(clamp(_fwd.y, -1, 1));
  _right.set(0, 0, 1).applyQuaternion(q);
  out.bank = -Math.asin(clamp(_right.y, -1, 1));
  return out;
};

export const pilotEye = (s: AircraftState, offset: readonly [number, number, number], out: Vector3): Vector3 => worldPoint(s, offset, out);
