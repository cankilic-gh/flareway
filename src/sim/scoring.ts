export type FailureKind =
  | 'runway-excursion'
  | 'gear-collapse'
  | 'prop-strike'
  | 'tail-strike'
  | 'wingtip-strike'
  | 'stall-impact'
  | 'ran-out-of-runway'
  | 'landed-short'
  | 'ditched'
  | 'terrain';

export const FAILURE_LABELS: Record<FailureKind, string> = {
  'runway-excursion': 'Runway excursion',
  'gear-collapse': 'Gear collapse',
  'prop-strike': 'Prop strike',
  'tail-strike': 'Tail strike',
  'wingtip-strike': 'Wingtip strike',
  'stall-impact': 'Stall impact',
  'ran-out-of-runway': 'Ran out of runway',
  'landed-short': 'Landed short',
  ditched: 'Ditched',
  terrain: 'Terrain impact',
};

export const FAILURE_HINTS: Record<FailureKind, string> = {
  'runway-excursion': 'A wheel left the paved runway. Keep the nose on the centerline with rudder and steer gently.',
  'gear-collapse': 'The sink rate at contact broke the gear. Flare earlier and reduce the descent before touchdown.',
  'prop-strike': 'The propeller touched the runway. Land on the mains and lower the nosewheel gently.',
  'tail-strike': 'The tail touched the runway. Raise the nose smoothly and stop at a moderate attitude.',
  'wingtip-strike': 'A wingtip touched the ground. Keep bank small close to the runway.',
  'stall-impact': 'The wing stalled above the runway. Keep flying speed until the flare and add power to recover.',
  'ran-out-of-runway': 'The aircraft passed the runway end. Touch down in the first third and brake earlier.',
  'landed-short': 'Touched down before the runway. Stay on the PAPI glide path until the threshold.',
  ditched: 'The aircraft reached the water. Stay on the glide path to the runway.',
  terrain: 'The aircraft hit terrain. Stay on the approach path and go around if unsure.',
};

export interface TouchdownMetrics {
  sinkFpm: number;
  sinkMps: number;
  /** Runway-frame lateral velocity, m/s (positive right). */
  lateralVelocity: number;
  /** Velocity across the aircraft's own wheels (side-load), m/s. */
  driftVelocity: number;
  centerlineOffset: number;
  yawErrorDeg: number;
  bankDeg: number;
  pitchDeg: number;
  kias: number;
  distancePastThreshold: number;
  firstContact: 'main' | 'nose';
  time: number;
}

export interface LandingSummary {
  touchdown: TouchdownMetrics | null;
  maxSinkFpm: number;
  maxBounceHeight: number;
  bounces: number;
  stableFraction: number;
  stableSamples: number;
  unstableReason: string | null;
  rolloutMaxOffset: number;
  skidTime: number;
  runwayRemaining: number;
  endReason: 'stopped' | 'failure' | 'timeout' | 'touch-and-go';
  failure: FailureKind | null;
}

export interface ScoreLine {
  key: string;
  label: string;
  points: number;
  max: number;
  note: string;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScoreResult {
  total: number;
  grade: Grade;
  label: string;
  breakdown: ScoreLine[];
  biggestLoss: string;
  success: boolean;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (x: number, zeroAt: number, fullAt: number): number => clamp01((x - zeroAt) / (fullAt - zeroAt));

const piecewise = (x: number, pts: readonly (readonly [number, number])[]): number => {
  if (x <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x0, y0] = pts[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1]![1];
};

export const SINK_BANDS = { butter: 120, smooth: 240, firm: 400 } as const;

const gradeFor = (total: number): Grade => (total >= 920 ? 'S' : total >= 800 ? 'A' : total >= 650 ? 'B' : total >= 500 ? 'C' : 'D');

export const FLOAT_START_M = 400;
export const LONG_LANDING_M = 450;

export const scoreLanding = (s: LandingSummary): ScoreResult => {
  const td = s.touchdown;
  const lines: ScoreLine[] = [];
  const notes: { loss: number; text: string }[] = [];

  // Touchdown softness (400).
  let soft = 0;
  let softNote = 'No touchdown';
  if (td) {
    const sink = Math.max(td.sinkFpm, 0);
    soft = piecewise(sink, [
      [60, 400],
      [120, 360],
      [240, 270],
      [400, 140],
      [680, 0],
    ]);
    softNote = `${Math.round(td.sinkFpm)} ft/min`;
    if (td.firstContact === 'nose') {
      soft *= 0.35;
      softNote += ', nosewheel first';
      notes.push({ loss: 150, text: 'Nosewheel touched first. Hold the nose up in the flare and land on the mains.' });
    }
    if (s.maxBounceHeight > 0.15) {
      const pen = Math.min(200, s.maxBounceHeight * 250);
      soft -= pen;
      softNote += `, bounced ${s.maxBounceHeight.toFixed(1)} m`;
      notes.push({ loss: pen, text: 'The aircraft bounced. Arrive slower with less sink and keep holding the flare.' });
    }
    const d = td.distancePastThreshold;
    if (d > FLOAT_START_M) {
      const pen = Math.min(250, (d - FLOAT_START_M) * 0.9);
      soft -= pen;
      softNote += `, floated to ${Math.round(d)} m`;
      notes.push({ loss: pen, text: `Floated ${Math.round(d - FLOAT_START_M)} m past the touchdown zone. Reduce speed on short final so the flare is short.` });
    } else if (d < 30) {
      const pen = Math.min(150, (30 - d) * 5);
      soft -= pen;
      softNote += ', very short';
      notes.push({ loss: pen, text: 'Touched down at the very start of the runway. Aim at the touchdown zone markers.' });
    }
    soft = Math.max(0, soft);
    if (400 - soft > 40 && td.firstContact === 'main' && sink > SINK_BANDS.smooth) {
      notes.push({ loss: 400 - soft, text: `Firm contact at ${Math.round(sink)} ft/min. Begin the flare earlier and let the speed bleed off.` });
    }
  }
  lines.push({ key: 'softness', label: 'Touchdown softness', points: soft, max: 400, note: softNote });

  // Centerline (200).
  let center = 0;
  if (td) {
    const off = Math.abs(td.centerlineOffset);
    center = 200 * (1 - ramp(off, 0.6, 9));
    if (200 - center > 30) notes.push({ loss: 200 - center, text: `Touched down ${off.toFixed(1)} m off the centerline. Correct drift earlier on final.` });
  }
  lines.push({ key: 'centerline', label: 'Centerline accuracy', points: center, max: 200, note: td ? `${Math.abs(td.centerlineOffset).toFixed(1)} m ${td.centerlineOffset >= 0 ? 'right' : 'left'}` : '—' });

  // Alignment and side-load (150).
  let align = 0;
  if (td) {
    const yaw = 75 * (1 - ramp(Math.abs(td.yawErrorDeg), 1, 10));
    const drift = 50 * (1 - ramp(Math.abs(td.driftVelocity), 0.2, 2));
    const bank = 25 * (1 - ramp(Math.abs(td.bankDeg), 2, 10));
    align = yaw + drift + bank;
    if (150 - align > 30) notes.push({ loss: 150 - align, text: 'The nose was not aligned with the runway at contact. Remove the crab with rudder and hold a wing low into the wind.' });
  }
  lines.push({ key: 'alignment', label: 'Alignment & side-load', points: align, max: 150, note: td ? `${Math.abs(td.yawErrorDeg).toFixed(1)}° yaw, ${Math.abs(td.driftVelocity).toFixed(1)} m/s drift` : '—' });

  // Stabilized approach (150).
  const stab = s.stableSamples > 0 ? 150 * clamp01(s.stableFraction) : 0;
  if (150 - stab > 30) {
    const why = s.unstableReason ? ` (mostly ${s.unstableReason})` : '';
    notes.push({ loss: 150 - stab, text: `Approach was not stabilized${why}. Hold 60–70 KIAS with two white and two red on the PAPI.` });
  }
  lines.push({ key: 'stabilized', label: 'Stabilized final', points: stab, max: 150, note: `${Math.round(clamp01(s.stableFraction) * 100)}% stable` });

  // Rollout (100).
  let roll = 0;
  if (td && s.endReason === 'stopped') {
    roll = 60 * (1 - ramp(s.rolloutMaxOffset, 1.5, 9)) + 25 * (1 - ramp(s.skidTime, 0, 2)) + 15 * clamp01(s.runwayRemaining / 300);
    if (100 - roll > 25) notes.push({ loss: 100 - roll, text: 'Rollout wandered or skidded. Track the centerline with rudder and brake progressively.' });
  }
  lines.push({ key: 'rollout', label: 'Rollout & runway remaining', points: roll, max: 100, note: s.endReason === 'stopped' ? `${Math.round(s.runwayRemaining)} m remaining` : s.endReason });

  let total = Math.round(lines.reduce((a, l) => a + l.points, 0));
  let label: string;
  let grade: Grade;
  let success = true;
  if (s.failure) {
    total = Math.min(total, 250);
    grade = 'F';
    label = FAILURE_LABELS[s.failure];
    success = false;
    notes.push({ loss: 10_000, text: FAILURE_HINTS[s.failure] });
  } else if (!td) {
    grade = 'F';
    total = 0;
    label = 'No landing';
    success = false;
  } else {
    grade = gradeFor(total);
    const sink = td.sinkFpm;
    const offset = Math.abs(td.centerlineOffset);
    const sideLoaded = Math.abs(td.driftVelocity) > 1.2 || Math.abs(td.yawErrorDeg) > 7;
    if (s.endReason === 'touch-and-go') label = 'Touch-and-go';
    else if (s.maxBounceHeight > 0.3) label = 'Bounce';
    else if (td.firstContact === 'nose') label = 'Nosewheel first';
    else if (sideLoaded) label = 'Side-loaded';
    else if (offset > 5) label = 'Off centerline';
    else if (sink > SINK_BANDS.firm) label = 'Hard landing';
    else if (sink > SINK_BANDS.smooth) label = 'Firm';
    else if (td.distancePastThreshold > LONG_LANDING_M) label = 'Long landing';
    else if (sink > SINK_BANDS.butter || offset > 2.5 || Math.abs(td.yawErrorDeg) > 4 || Math.abs(td.driftVelocity) > 0.8) label = 'Smooth';
    else label = 'Butter';
  }
  notes.sort((a, b) => b.loss - a.loss);
  const biggestLoss = notes[0]?.text ?? 'Nothing major. That was a textbook arrival.';
  return { total, grade, label, breakdown: lines, biggestLoss, success };
};

export interface TakeoffSummary {
  rotateKias: number | null;
  liftoffKias: number | null;
  liftoffDistance: number | null;
  maxRollOffset: number;
  maxPitchOnGroundDeg: number;
  wheelbarrowTime: number;
  climbFraction: number;
  climbAvgKias: number | null;
  maxTrackOffset: number;
  endReason: 'climb-established' | 'failure' | 'timeout';
  failure: FailureKind | null;
}

export const scoreTakeoff = (s: TakeoffSummary): ScoreResult => {
  const lines: ScoreLine[] = [];
  const notes: { loss: number; text: string }[] = [];
  const center = 250 * (1 - ramp(s.maxRollOffset, 1, 8));
  if (250 - center > 40) notes.push({ loss: 250 - center, text: `Wandered ${s.maxRollOffset.toFixed(1)} m from the centerline on the roll. Small, early rudder corrections.` });
  lines.push({ key: 'centerline', label: 'Centerline on the roll', points: center, max: 250, note: `${s.maxRollOffset.toFixed(1)} m max` });

  let rot = 0;
  const premature = s.liftoffKias !== null && s.liftoffKias < 48;
  if (s.rotateKias !== null) {
    rot += 150 * (1 - ramp(Math.abs(s.rotateKias - 55), 3, 15));
    rot += 100 * (1 - ramp(s.maxPitchOnGroundDeg, 12, 16));
    if (premature) rot = Math.max(0, rot - 100);
  }
  if (premature) notes.push({ loss: 180, text: 'Rotated and lifted off too early. Wait for about 55 KIAS before raising the nose.' });
  else if (250 - rot > 40) notes.push({ loss: 250 - rot, text: 'Rotation was off. Raise the nose smoothly around 55 KIAS to a moderate attitude.' });
  lines.push({ key: 'rotation', label: 'Rotation', points: rot, max: 250, note: s.rotateKias !== null ? `${Math.round(s.rotateKias)} KIAS, ${s.maxPitchOnGroundDeg.toFixed(0)}° max on ground` : 'no rotation' });

  const climb = 250 * clamp01(s.climbFraction);
  if (250 - climb > 40) notes.push({ loss: 250 - climb, text: 'Climb speed drifted outside 70–80 KIAS. Use pitch to hold the climb speed at full power.' });
  lines.push({ key: 'climb', label: 'Climb speed', points: climb, max: 250, note: s.climbAvgKias !== null ? `${Math.round(s.climbAvgKias)} KIAS avg` : '—' });

  const track = s.liftoffKias !== null ? 150 * (1 - ramp(s.maxTrackOffset, 10, 60)) : 0;
  if (150 - track > 30) notes.push({ loss: 150 - track, text: 'Drifted off the runway heading after liftoff. Crab into the wind to hold the extended centerline.' });
  lines.push({ key: 'track', label: 'Runway heading', points: track, max: 150, note: `${Math.round(s.maxTrackOffset)} m max offset` });

  const smooth = 100 * (1 - ramp(s.wheelbarrowTime, 0, 3));
  if (100 - smooth > 25) notes.push({ loss: 100 - smooth + 60, text: 'The nosewheel was carrying too much weight at speed (wheelbarrowing). Relax forward pressure as you accelerate.' });
  lines.push({ key: 'smoothness', label: 'Smoothness', points: smooth, max: 100, note: `${s.wheelbarrowTime.toFixed(1)} s wheelbarrow` });

  let total = Math.round(lines.reduce((a, l) => a + l.points, 0));
  let grade: Grade;
  let label: string;
  let success = true;
  if (s.failure) {
    total = Math.min(total, 250);
    grade = 'F';
    label = FAILURE_LABELS[s.failure];
    success = false;
    notes.push({ loss: 10_000, text: FAILURE_HINTS[s.failure] });
  } else if (s.endReason === 'timeout') {
    grade = 'F';
    label = 'No takeoff';
    total = Math.min(total, 100);
    success = false;
  } else {
    grade = gradeFor(total);
    if (premature) label = 'Premature rotation';
    else if (s.wheelbarrowTime > 1) label = 'Wheelbarrowing';
    else if (s.maxRollOffset > 5) label = 'Off centerline';
    else if (s.climbFraction < 0.5) label = s.climbAvgKias !== null && s.climbAvgKias < 70 ? 'Slow climb' : 'Fast climb';
    else if (total >= 850) label = 'Clean takeoff';
    else label = 'Good takeoff';
  }
  notes.sort((a, b) => b.loss - a.loss);
  return { total, grade, label, breakdown: lines, biggestLoss: notes[0]?.text ?? 'Clean, centered and on speed.', success };
};
