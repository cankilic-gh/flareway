import type { Action, Bindings } from './bindings';
import type { ControlInput } from '../sim/physics';
import type { Settings } from './settings';

export type EdgeAction = 'flapsDown' | 'flapsUp' | 'camera' | 'retry' | 'pause' | 'goAround';
const EDGE_ACTIONS = new Set<Action>(['flapsDown', 'flapsUp', 'camera', 'retry', 'pause', 'goAround']);

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Keyboard axes ramp in over time so taps give small corrections and holds give full deflection. */
const rampAxis = (current: number, neg: boolean, pos: boolean, dt: number, riseTime: number): number => {
  const target = (pos ? 1 : 0) - (neg ? 1 : 0);
  if (target === 0) {
    const decay = dt / 0.18;
    return Math.abs(current) <= decay ? 0 : current - Math.sign(current) * decay;
  }
  if (Math.sign(current) !== target && current !== 0) return current + target * (dt / 0.12);
  return clamp(current + target * (dt / riseTime), -1, 1);
};

/**
 * Merges keyboard and gamepad into the simulation ControlInput. Held state is sampled per fixed step; one-shot
 * actions are queued and drained by the game loop.
 */
export class InputManager {
  private readonly down = new Set<string>();
  private readonly edges: EdgeAction[] = [];
  private pitchKey = 0;
  private rollKey = 0;
  private yawKey = 0;
  throttle = 0;
  flaps = 0;
  arcadeTargetKt = 65;
  private padPrev: boolean[] = [];
  gamepadConnected = false;
  private listening = false;
  capture: ((code: string) => void) | null = null;

  constructor(private settings: Settings) {}

  setSettings(s: Settings): void {
    this.settings = s;
  }

  attach(target: Window): void {
    if (this.listening) return;
    this.listening = true;
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.down.clear());
  }

  private actionFor(code: string): Action | null {
    const b: Bindings = this.settings.bindings;
    for (const a of Object.keys(b) as Action[]) if (b[a] === code) return a;
    return null;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if (this.capture && isDown) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && e.code !== 'Escape') return;
    const a = this.actionFor(e.code);
    if (!a) return;
    if (a !== 'pause' || isDown) e.preventDefault();
    if (isDown) {
      if (!this.down.has(e.code) && EDGE_ACTIONS.has(a)) this.edges.push(a as EdgeAction);
      this.down.add(e.code);
    } else this.down.delete(e.code);
  }

  isDown(a: Action): boolean {
    return this.down.has(this.settings.bindings[a]);
  }

  /** Test/automation hook and UI buttons use this to inject one-shot actions. */
  push(a: EdgeAction): void {
    this.edges.push(a);
  }

  private readonly drained: EdgeAction[] = [];

  /** Returns the queued one-shot actions in a reused array (valid until the next call). */
  drainEdges(): EdgeAction[] {
    this.drained.length = 0;
    for (const e of this.edges) this.drained.push(e);
    this.edges.length = 0;
    return this.drained;
  }

  resetAxes(throttle: number, flaps: number): void {
    this.pitchKey = 0;
    this.rollKey = 0;
    this.yawKey = 0;
    this.throttle = throttle;
    this.flaps = flaps;
    this.down.clear();
  }

  /** Handles flap one-shots; call before sampling. Returns remaining edges. */
  applyFlapEdges(edges: EdgeAction[]): EdgeAction[] {
    return edges.filter((e) => {
      if (e === 'flapsDown') this.flaps = Math.min(3, this.flaps + 1);
      else if (e === 'flapsUp') this.flaps = Math.max(0, this.flaps - 1);
      else return true;
      return false;
    });
  }

  private pollGamepad(): { pitch: number; roll: number; yaw: number; throttleDelta: number; brake: number; throttleAbs: number | null } | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected) ?? null;
    this.gamepadConnected = !!pad;
    if (!pad) return null;
    const dz = (v: number | undefined) => {
      const x = v ?? 0;
      return Math.abs(x) < 0.08 ? 0 : (x - Math.sign(x) * 0.08) / 0.92;
    };
    const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
    const val = (i: number) => pad.buttons[i]?.value ?? 0;
    // Edge buttons: Y flaps down, X flaps up, B camera, Start pause, Back go-around.
    const map: [number, EdgeAction][] = [
      [3, 'flapsDown'],
      [2, 'flapsUp'],
      [1, 'camera'],
      [9, 'pause'],
      [8, 'goAround'],
    ];
    for (const [i, a] of map) {
      if (btn(i) && !this.padPrev[i]) this.edges.push(a);
    }
    this.padPrev = pad.buttons.map((b) => b.pressed);
    const stickY = dz(pad.axes[1]);
    const invert = !this.settings.pitchAviation;
    const rightX = dz(pad.axes[2]);
    const rightY = dz(pad.axes[3]);
    const yawTriggers = val(7) - val(6);
    return {
      // Pulling the stick back (positive Y) raises the nose in aviation mode.
      pitch: invert ? -stickY : stickY,
      roll: dz(pad.axes[0]),
      yaw: Math.abs(yawTriggers) > 0.05 ? yawTriggers : this.settings.gamepadThrottleOnStick ? 0 : rightX,
      throttleDelta: (btn(5) ? 1 : 0) - (btn(4) ? 1 : 0) + (btn(12) ? 1 : 0) - (btn(13) ? 1 : 0),
      brake: btn(0) ? 1 : 0,
      throttleAbs: this.settings.gamepadThrottleOnStick ? (1 - rightY) / 2 : null,
    };
  }

  /** Samples controls for one fixed simulation step. */
  sample(dt: number, out: ControlInput): ControlInput {
    const aviation = this.settings.pitchAviation;
    const upKey = this.isDown('pitchUpKey');
    const downKey = this.isDown('pitchDownKey');
    const noseUp = aviation ? downKey : upKey;
    const noseDown = aviation ? upKey : downKey;
    this.pitchKey = rampAxis(this.pitchKey, noseDown, noseUp, dt, 0.9);
    this.rollKey = rampAxis(this.rollKey, this.isDown('rollLeft'), this.isDown('rollRight'), dt, 0.6);
    this.yawKey = rampAxis(this.yawKey, this.isDown('rudderLeft'), this.isDown('rudderRight'), dt, 0.5);
    const pad = this.pollGamepad();
    let tDelta = (this.isDown('throttleUp') ? 1 : 0) - (this.isDown('throttleDown') ? 1 : 0);
    if (pad) tDelta += pad.throttleDelta;
    if (this.settings.throttleMode === 'arcade') {
      this.arcadeTargetKt = clamp(this.arcadeTargetKt + tDelta * dt * 12, 45, 110);
    } else {
      this.throttle = clamp(this.throttle + tDelta * dt * 0.55, 0, 1);
      if (pad?.throttleAbs !== null && pad?.throttleAbs !== undefined) this.throttle = pad.throttleAbs;
    }
    out.pitch = clamp(this.pitchKey + (pad?.pitch ?? 0), -1, 1);
    out.roll = clamp(this.rollKey + (pad?.roll ?? 0), -1, 1);
    out.yaw = clamp(this.yawKey + (pad?.yaw ?? 0), -1, 1);
    out.throttle = this.throttle;
    out.brake = Math.max(this.isDown('brake') ? 1 : 0, pad?.brake ?? 0);
    out.flaps = this.flaps;
    return out;
  }
}
