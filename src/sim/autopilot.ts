import { DEG, KT, RUNWAY, SIM_DT } from './constants';
import { alongTrack, lateralOffset } from './airfield';
import { attitude, headingDeg, type ControlInput } from './physics';
import type { FlightSession } from './session';

/**
 * Deterministic scripted "test pilot". It flies through the same ControlInput channel a player uses,
 * so every scenario exercises real simulation state. Used by unit tests, the ?test=1 API and E2E.
 */
export type AutopilotProfile = 'soft' | 'hard' | 'crash' | 'excursion' | 'nose-first' | 'takeoff' | 'tailstrike';

export interface Autopilot {
  profile: AutopilotProfile;
  control(session: FlightSession, out: ControlInput): void;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const att = { pitch: 0, bank: 0 };

export const createAutopilot = (profile: AutopilotProfile): Autopilot => {
  let speedI = 0;
  let thr = -1;
  let touchdownSeen = false;
  let rotateStarted = false;
  let lastPitchCmd = 0;

  const flareSink = profile === 'hard' ? 2.7 : profile === 'crash' ? 4.6 : profile === 'nose-first' ? 1.6 : 0.3;
  const flareHeight = profile === 'crash' ? 0 : profile === 'hard' ? 2.5 : 7;

  const landing = (session: FlightSession, out: ControlInput): void => {
    const s = session.state;
    const rw = session.runway;
    const along = alongTrack(rw, s.pos.x);
    const d = lateralOffset(rw, s.pos.z);
    const dDot = s.vel.z * rw.dir;
    const vAlong = s.vel.x * rw.dir;
    const kias = s.ias / KT;
    const hdgErr = wrap180(headingDeg(s.quat) - rw.headingDeg) * DEG;
    attitude(s.quat, att);
    if (thr < 0) thr = s.throttle;

    out.flaps = along > -1100 ? 3 : along > -1900 ? 2 : Math.max(1, s.flapIndex);
    out.brake = 0;
    if (s.mainsOnGround) touchdownSeen = true;

    if (!touchdownSeen) {
      // Vertical path: 3 degree glide to an aim point just past the PAPI abeam.
      const aim = RUNWAY.thresholdAbsX - RUNWAY.papiAbsX + 20;
      const glide = Math.tan(RUNWAY.glideDeg * DEG);
      const hPath = Math.max(0, (aim - along) * glide);
      const glideSink = vAlong * glide;
      let vsCmd = clamp(-glideSink + 0.18 * (hPath - s.agl), -5, 1.5);
      const flaring = s.agl < flareHeight;
      if (flaring) {
        // Progressive flare: sink shrinks with height toward the touchdown target.
        const f = s.agl / flareHeight;
        vsCmd = -(flareSink + (Math.max(glideSink, flareSink) - flareSink) * f * f);
      } else if (profile === 'crash' && s.agl < 25) vsCmd = -flareSink;
      else if (profile === 'hard' && s.agl < 15) vsCmd = Math.min(vsCmd, -flareSink);
      const gain = flaring ? 0.4 : 0.2;
      const pitchCmd = clamp(gain * (vsCmd - s.vs) - 0.9 * s.rates.z, -0.6, 0.8);
      lastPitchCmd += (pitchCmd - lastPitchCmd) * 0.2;
      out.pitch = lastPitchCmd;
      // Speed with throttle.
      const target = out.flaps >= 3 ? 63 : 67;
      const err = target - kias;
      speedI = clamp(speedI + err * SIM_DT * 0.02, -0.3, 0.3);
      thr = clamp(thr + (0.035 * err + speedI - (thr - 0.35)) * SIM_DT * 1.5, 0, 1);
      out.throttle = flaring || s.agl < 4 ? Math.max(0, thr - (flareHeight - s.agl) * 0.12) : thr;
      if (profile === 'crash' || profile === 'hard') out.throttle = s.agl < 15 ? 0.15 : thr;

      // Lateral: track the extended centerline, decrab in the flare.
      if (s.agl > 6) {
        const trackCmd = clamp(-(0.015 * d + 0.08 * dDot), -0.22, 0.22);
        const track = Math.atan2(dDot, Math.max(vAlong, 1));
        const bankCmd = clamp(2.4 * (trackCmd - track), -18 * DEG, 18 * DEG);
        out.roll = clamp(3.2 * (bankCmd - att.bank) - 0.6 * s.rates.x, -1, 1);
        out.yaw = 0;
      } else {
        out.yaw = clamp(-2.6 * hdgErr - 1.2 * s.rates.y, -1, 1);
        const bankCmd = clamp(-(0.3 * dDot + 0.02 * d), -7 * DEG, 7 * DEG);
        out.roll = clamp(3.2 * (bankCmd - att.bank) - 0.6 * s.rates.x, -1, 1);
      }
      return;
    }

    // Rollout: wings level with aileron into the wind, nose down, then steer and brake.
    out.throttle = 0;
    out.roll = clamp(-3 * att.bank - 0.6 * s.rates.x, -1, 1);
    const excursion = profile === 'excursion' && s.noseOnGround && kias < 45;
    if (excursion) {
      out.yaw = 1;
      out.brake = 0;
    } else {
      out.yaw = clamp(-0.06 * d - 0.2 * dDot - 1.2 * hdgErr - 1.5 * s.rates.y, -0.6, 0.6);
      out.brake = s.noseOnGround && kias < 50 ? 0.45 : 0;
    }
    // Hold a gentle nose-up attitude, then let the nosewheel down.
    const pitchTarget = kias > 50 ? 2.5 * DEG : 0;
    out.pitch = s.noseOnGround ? -0.05 : clamp(1.5 * (pitchTarget - att.pitch) - 0.5 * s.rates.z, -0.3, 0.4);
  };

  const takeoff = (session: FlightSession, out: ControlInput): void => {
    const s = session.state;
    const rw = session.runway;
    const d = lateralOffset(rw, s.pos.z);
    const dDot = s.vel.z * rw.dir;
    const vAlong = s.vel.x * rw.dir;
    const kias = s.ias / KT;
    const hdgErr = wrap180(headingDeg(s.quat) - rw.headingDeg) * DEG;
    attitude(s.quat, att);
    out.flaps = 0;
    out.brake = 0;
    out.throttle = clamp(s.time * 0.6 + s.throttle, 0, 1);
    if (s.onGround) {
      out.yaw = clamp(-0.12 * d - 0.45 * dDot - 3.0 * hdgErr - 1.0 * s.rates.y, -1, 1);
      out.roll = 0;
      if (kias >= (profile === 'tailstrike' ? 40 : 54)) rotateStarted = true;
      if (profile === 'tailstrike' && rotateStarted) {
        out.pitch = 1;
      } else if (rotateStarted) {
        out.pitch = clamp(0.12 * ((9 * DEG - att.pitch) / DEG) - 1.2 * s.rates.z, -0.4, 0.8);
      } else {
        out.pitch = -0.05;
      }
      return;
    }
    if (profile === 'tailstrike') {
      out.pitch = 1;
      return;
    }
    // Airborne: pitch for 75 KIAS, bank to hold the extended centerline.
    const pitchTarget = clamp(8 * DEG + (kias - 72) * 0.5 * DEG, 5 * DEG, 12 * DEG);
    out.pitch = clamp(0.1 * ((pitchTarget - att.pitch) / DEG) - 1.0 * s.rates.z, -0.5, 0.5);
    const trackCmd = clamp(-(0.01 * d + 0.06 * dDot), -0.2, 0.2);
    const track = Math.atan2(dDot, Math.max(vAlong, 1));
    const bankCmd = s.agl > 8 ? clamp(2.0 * (trackCmd - track), -12 * DEG, 12 * DEG) : 0;
    out.roll = clamp(3.0 * (bankCmd - att.bank) - 0.6 * s.rates.x, -1, 1);
    out.yaw = s.agl < 8 ? clamp(-2.0 * hdgErr, -0.5, 0.5) : 0;
  };

  return {
    profile,
    control: (session, out) => (profile === 'takeoff' || profile === 'tailstrike' ? takeoff(session, out) : landing(session, out)),
  };
};
