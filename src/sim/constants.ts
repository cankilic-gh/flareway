// Centralized simulation coefficients. All values are simplified recreational game values,
// not certified aircraft performance or operating data.

export const KT = 0.514444;
export const FT = 0.3048;
export const FPM = FT / 60;
export const NM = 1852;
export const DEG = Math.PI / 180;
export const RHO = 1.225;
export const GRAVITY = 9.80665;

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
export const MAX_STEPS_PER_FRAME = 12;

/** Body frame: +X forward, +Y up, +Z right (matches the exported GLB). */
export const AIRCRAFT = {
  mass: 1000,
  inertia: { roll: 1300, pitch: 1850, yaw: 2700 },
  wingArea: 16.2,
  span: 11.0,
  chord: 1.5,
  aspectRatio: 7.47,
  oswald: 0.75,
  cl0: 0.35,
  clAlpha: 5.2,
  cd0: 0.03,
  cdBeta: 0.25,
  cyBeta: -0.9,
  cyRudder: -0.06,
  flapDetentsDeg: [0, 10, 20, 30] as const,
  flapDeltaCl: [0, 0.25, 0.45, 0.6] as const,
  flapDeltaCd: [0, 0.008, 0.022, 0.042] as const,
  flapDeltaCm: [0, -0.012, -0.022, -0.03] as const,
  alphaStallDeg: [16, 15.2, 14.6, 14] as const,
  stallWarnMarginDeg: 2.3,
  postStallLiftLoss: 0.38,
  flapRateDegPerSec: 8,
  // Moments (per unit normalized control deflection where relevant).
  clAileron: 0.075,
  clRollDamping: -0.47,
  clDihedral: -0.09,
  clYawRate: 0.1,
  cmZero: 0.04,
  cmAlpha: -0.9,
  cmElevator: 0.3,
  cmPitchDamping: -12,
  cnRudder: 0.035,
  cnWeathervane: 0.07,
  cnYawDamping: -0.1,
  cnAdverseYaw: -0.012,
  cnRollRate: -0.03,
  tailPropwash: 0.05,
  propDiskArea: 1.81,
  surfaceTimeConstant: 0.07,
  // Engine / propeller.
  maxPowerW: 100_000,
  idlePowerFraction: 0.04,
  propEfficiency: 0.75,
  maxStaticThrust: 2500,
  windmillDragPerMps: 8,
  engineTimeConstant: 0.55,
  idleRpm: 700,
  maxRpm: 2700,
  /** Wing reference height above the CG, used for ground effect. */
  wingHeight: 0.9,
} as const;

export interface ContactPoint {
  name: 'MainGearContact_L' | 'MainGearContact_R' | 'NoseGearContact';
  /** Body-frame position relative to the CG/AircraftRoot, from the authored GLB. */
  offset: readonly [number, number, number];
  stiffness: number;
  dampingCompress: number;
  dampingExtend: number;
  /** Compression beyond this collapses the strut. */
  collapseCompression: number;
  /** Contact point closing speed (m/s) beyond this collapses the strut. */
  collapseSpeed: number;
  braked: boolean;
  steerable: boolean;
}

/** Authored anchors converted from Blender (x, y, z) to glTF/Three (x, z, -y). */
export const GEAR: readonly ContactPoint[] = [
  {
    name: 'MainGearContact_L',
    offset: [-0.18, -1.08, -1.02],
    stiffness: 62_000,
    dampingCompress: 2_000,
    dampingExtend: 2_000,
    collapseCompression: 0.3,
    collapseSpeed: 3.45,
    braked: true,
    steerable: false,
  },
  {
    name: 'MainGearContact_R',
    offset: [-0.18, -1.08, 1.02],
    stiffness: 62_000,
    dampingCompress: 2_000,
    dampingExtend: 2_000,
    collapseCompression: 0.3,
    collapseSpeed: 3.45,
    braked: true,
    steerable: false,
  },
  {
    name: 'NoseGearContact',
    offset: [2.3, -1.088, 0],
    stiffness: 34_000,
    dampingCompress: 2_600,
    dampingExtend: 5_000,
    collapseCompression: 0.24,
    collapseSpeed: 2.4,
    braked: false,
    steerable: true,
  },
];

export const STRIKE_POINTS = {
  TailStrikePoint: [-4.72, 0.25, 0] as const,
  /** Lowest propeller tip: Propeller node (3.09, 0.04, 0) minus 0.76 m blade radius. */
  PropTip: [3.09, -0.72, 0] as const,
  WingTip_L: [-0.1, 0.95, -5.5] as const,
  WingTip_R: [-0.1, 0.95, 5.5] as const,
};

export const AUTHORED_ANCHORS = {
  CG: [0, 0, 0] as const,
  PilotCamera: [0.1, 0.58, 0.3] as const,
  ChaseCamera: [-10.5, 4.0, 0] as const,
  Propeller: [3.09, 0.04, 0] as const,
};

export const TIRE = {
  runway: { rolling: 0.02, lateral: 0.78, peak: 0.85, sliding: 0.62 },
  grass: { rolling: 0.09, lateral: 0.5, peak: 0.5, sliding: 0.38 },
  lateralSlipRef: 0.35,
  longSlipRef: 0.3,
  brakeMu: 0.62,
  steerMaxLowSpeedDeg: 24,
  steerMaxHighSpeedDeg: 7,
};

export const RUNWAY = {
  length: 900,
  width: 23,
  halfLength: 450,
  halfWidth: 11.5,
  surfaceY: 0.06,
  grassY: -0.08,
  waterY: -2.49,
  thresholdAbsX: 430,
  takeoffStartAbsX: 438,
  papiAbsX: 300,
  papiAbsZ: 18,
  papiLightHeight: 0.39,
  glideDeg: 3,
  plateauAbsX: 520,
  plateauAbsZ: 72,
};

export const PAPI_ANGLES_DEG = [2.5, 2.8333, 3.1667, 3.5] as const;
export const PAPI_HYSTERESIS_DEG = 0.06;

export const SPEEDS_KT = {
  rotate: 55,
  climbMin: 70,
  climbMax: 80,
  finalMin: 60,
  finalMax: 70,
};
