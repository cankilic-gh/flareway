export type Action =
  | 'throttleUp'
  | 'throttleDown'
  | 'rollLeft'
  | 'rollRight'
  | 'pitchUpKey'
  | 'pitchDownKey'
  | 'rudderLeft'
  | 'rudderRight'
  | 'flapsDown'
  | 'flapsUp'
  | 'brake'
  | 'camera'
  | 'retry'
  | 'pause'
  | 'goAround';

export const ACTION_LABELS: Record<Action, string> = {
  throttleUp: 'Throttle up',
  throttleDown: 'Throttle down',
  rollLeft: 'Roll left (bank)',
  rollRight: 'Roll right (bank)',
  pitchUpKey: 'Pitch key "Up" (nose down, aviation)',
  pitchDownKey: 'Pitch key "Down" (nose up, aviation)',
  rudderLeft: 'Rudder left / steer left',
  rudderRight: 'Rudder right / steer right',
  flapsDown: 'Flaps down one step',
  flapsUp: 'Flaps up one step',
  brake: 'Wheel brakes (hold)',
  camera: 'Cycle camera',
  retry: 'Retry',
  pause: 'Pause',
  goAround: 'Go around',
};

export type Bindings = Record<Action, string>;

export const DEFAULT_BINDINGS: Bindings = {
  throttleUp: 'KeyW',
  throttleDown: 'KeyS',
  rollLeft: 'ArrowLeft',
  rollRight: 'ArrowRight',
  pitchUpKey: 'ArrowUp',
  pitchDownKey: 'ArrowDown',
  rudderLeft: 'KeyA',
  rudderRight: 'KeyD',
  flapsDown: 'KeyF',
  flapsUp: 'KeyG',
  brake: 'Space',
  camera: 'KeyC',
  retry: 'KeyR',
  pause: 'Escape',
  goAround: 'KeyT',
};

export const keyLabel = (code: string): string => {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    Escape: 'Esc',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
  };
  return map[code] ?? code;
};

/** Returns a new bindings object with `action` on `code`; a conflicting action gets the previous key (swap). */
export const rebind = (b: Bindings, action: Action, code: string): Bindings => {
  const next = { ...b };
  const clash = (Object.keys(next) as Action[]).find((a) => a !== action && next[a] === code);
  if (clash) next[clash] = b[action];
  next[action] = code;
  return next;
};
