import { DEFAULT_BINDINGS, type Bindings } from './bindings';
import type { QualityId } from '../render/quality';

export interface Settings {
  /** Aviation style: the "Up" pitch key pushes the nose down. */
  pitchAviation: boolean;
  stabilityAssist: boolean;
  coordinatedRudder: boolean;
  throttleMode: 'manual' | 'arcade';
  centerlineGuidance: boolean;
  approachMarker: boolean;
  quality: QualityId;
  volume: number;
  reducedMotion: boolean;
  gamepadThrottleOnStick: boolean;
  bindings: Bindings;
}

// v2: A/D became rudder and the arrow keys became roll. Older saved bindings are dropped on load.
const KEY = 'flareway.settings.v2';
const LEGACY_KEYS = ['flareway.settings.v1'];

export const defaultSettings = (): Settings => ({
  pitchAviation: true,
  stabilityAssist: true,
  coordinatedRudder: true,
  throttleMode: 'manual',
  centerlineGuidance: true,
  approachMarker: true,
  quality: 'normal',
  volume: 0.7,
  reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  gamepadThrottleOnStick: false,
  bindings: { ...DEFAULT_BINDINGS },
});

export const loadSettings = (): Settings => {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      for (const k of LEGACY_KEYS) {
        const legacy = localStorage.getItem(k);
        if (!legacy) continue;
        const { bindings: _old, ...rest } = JSON.parse(legacy) as Partial<Settings>;
        return { ...d, ...rest, bindings: { ...d.bindings } };
      }
      return d;
    }
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...parsed, bindings: { ...d.bindings, ...(parsed.bindings ?? {}) } };
  } catch {
    return d;
  }
};

export const saveSettings = (s: Settings): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode); settings still apply for this session.
  }
};
