import { Quaternion, Vector3 } from 'three';
import { World, type FrameInput } from './render/world';
import { PLAYER_CAMERAS, CAMERA_LABELS, type CameraMode } from './render/cameras';
import type { AircraftPose } from './render/aircraftView';
import { FlightSession, type AttemptResult } from './sim/session';
import { FixedStepper } from './sim/stepper';
import { flowReduce, initialFlow, type FlowEvent, type FlowState, type GameMode } from './sim/flow';
import { neutralInput, type ControlInput } from './sim/physics';
import { SIM_DT } from './sim/constants';
import { decodeConditionCode, encodeConditionCode, randomSeed } from './sim/conditions';
import { windReadout, type WindReadout } from './sim/wind';
import { REPLAY_STRIDE } from './sim/replay';
import { createAutopilot, type Autopilot, type AutopilotProfile } from './sim/autopilot';
import { InputManager } from './input/controls';
import { loadSettings, saveSettings, type Settings } from './input/settings';
import { GameAudio } from './audio/audio';
import { TitleUI } from './ui/title';
import { Hud } from './ui/hud';
import { ResultsUI } from './ui/results';
import { Dialogs, SettingsUI } from './ui/dialogs';
import { $ } from './ui/dom';

interface PoseSnapshot {
  pos: Vector3;
  quat: Quaternion;
  aileron: number;
  elevator: number;
  rudder: number;
  flapDeg: number;
  steerDeg: number;
  propAngle: number;
  rpm: number;
  wheelSpin: [number, number, number];
  compression: [number, number, number];
}

const snapshot = (): PoseSnapshot => ({
  pos: new Vector3(),
  quat: new Quaternion(),
  aileron: 0,
  elevator: 0,
  rudder: 0,
  flapDeg: 0,
  steerDeg: 0,
  propAngle: 0,
  rpm: 0,
  wheelSpin: [0, 0, 0],
  compression: [0, 0, 0],
});

const lerpAngle = (a: number, b: number, t: number): number => {
  let d = b - a;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

interface ContactEvent {
  pos: Vector3;
  strength: number;
  dust: boolean;
  closing: number;
}

export class App {
  readonly world: World;
  readonly input: InputManager;
  readonly audio = new GameAudio();
  settings: Settings;
  flow: FlowState = initialFlow();
  session: FlightSession | null = null;
  readonly stepper = new FixedStepper(SIM_DT);
  readonly title: TitleUI;
  readonly hud = new Hud();
  readonly results: ResultsUI;
  readonly dialogs = new Dialogs();
  readonly settingsUI: SettingsUI;
  readonly testMode: boolean;
  timeScale = 1;
  autopilot: Autopilot | null = null;
  lastResult: AttemptResult | null = null;
  cameraMode: CameraMode = 'orbit';
  private readonly ctrl: ControlInput = neutralInput();
  private readonly prev = snapshot();
  private readonly curr = snapshot();
  private readonly pose: AircraftPose;
  private readonly wind: WindReadout = { fromDeg: 0, speedKt: 0, gust: 0 };
  private readonly contacts: ContactEvent[] = [];
  private readonly lastContact = [false, false, false];
  private skidTick = 0;
  private rumble = 0;
  private last = 0;
  private fadeTimer = -1;
  private replay: { frames: Float32Array; t: number; t0: number; t1: number; event: number; active: boolean } | null = null;
  private readonly parked = { pos: new Vector3(236, 1.08, -70), quat: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI * 0.85) };
  private readonly titleWind: WindReadout = { fromDeg: 240, speedKt: 8, gust: 0.3 };
  frameCount = 0;
  lastFrame: FrameInput | null = null;

  constructor(world: World, testMode: boolean) {
    this.world = world;
    this.testMode = testMode;
    this.settings = loadSettings();
    this.input = new InputManager(this.settings);
    this.input.attach(window);
    this.audio.setVolume(this.settings.volume);
    this.pose = {
      pos: new Vector3(),
      quat: new Quaternion(),
      aileron: 0,
      elevator: 0,
      rudder: 0,
      flapDeg: 0,
      steerDeg: 0,
      propAngle: 0,
      rpm: 0,
      wheelSpin: [0, 0, 0],
      compression: [0, 0, 0],
    };
    this.title = new TitleUI({
      onStart: (mode, code) => this.start(mode, code),
      onTutorial: () => this.dialogs.show('tutorial', $('tutorial-btn')),
      onSettings: () => this.dialogs.show('settings', $('settings-btn')),
    });
    this.results = new ResultsUI({
      onRetry: () => this.retry(),
      onNew: () => this.newConditions(),
      onReplay: () => this.toggleReplay(),
      onTitle: () => this.toTitle(),
    });
    this.settingsUI = new SettingsUI(this.settings, this.input, (s) => this.applySettings(s));
    $('pause').addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset['action'];
      if (a === 'resume') this.resume();
      else if (a === 'retry') this.retry();
      else if (a === 'settings') this.dialogs.show('settings');
      else if (a === 'tutorial') this.dialogs.show('tutorial');
      else if (a === 'title') this.toTitle();
    });
    window.addEventListener('keydown', (e) => {
      if (this.dialogs.current && this.dialogs.current !== 'pause') return;
      if (this.flow.screen === 'result') {
        if (e.code === 'KeyN') this.newConditions();
        else if (e.code === 'KeyP') this.toggleReplay();
      } else if (this.flow.screen === 'title' && e.code === 'Enter' && document.activeElement?.tagName !== 'BUTTON' && document.activeElement?.tagName !== 'INPUT') {
        this.start(this.title.mode, this.title.code);
      }
    });
    window.addEventListener('resize', () => this.world.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.flow.screen === 'playing') this.pause();
    });
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (code && decodeConditionCode(code)) this.title.setCode(code.toUpperCase());
    const mode = url.searchParams.get('mode');
    if (mode === 'takeoff' || mode === 'landing') this.title.setMode(mode);
    $('device-note').hidden = !(window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(pointer: fine)').matches);
    this.world.setCamera('orbit');
    this.world.setRunway('09');
  }

  showTitle(): void {
    $('loading').hidden = true;
    this.title.el.hidden = false;
    this.title.focus();
  }

  private dispatch(e: FlowEvent): void {
    this.flow = flowReduce(this.flow, e);
  }

  private assists() {
    return {
      pitchStability: this.settings.stabilityAssist,
      coordinatedRudder: this.settings.coordinatedRudder,
      autoThrottle: this.settings.throttleMode === 'arcade',
      autoThrottleTargetKt: this.input.arcadeTargetKt,
    };
  }

  start(mode: GameMode, code: string): void {
    this.audio.start();
    this.dialogs.closeAll();
    this.results.hide();
    this.replay = null;
    this.session = new FlightSession(mode, code, this.assists());
    this.lastResult = null;
    this.dispatch({ type: 'start', mode, code });
    this.beginSession();
  }

  private beginSession(): void {
    const s = this.session!;
    this.world.setRunway(s.conditions.runway);
    this.stepper.reset();
    this.input.resetAxes(s.state.throttle, s.state.flapIndex);
    this.input.arcadeTargetKt = s.mode === 'landing' ? 67 : 75;
    this.capture(this.prev);
    this.capture(this.curr);
    this.lastContact.fill(false);
    s.state.gear.forEach((g, i) => (this.lastContact[i] = g.inContact));
    this.world.effects.clear();
    this.world.shake.reset();
    if (!PLAYER_CAMERAS.includes(this.cameraMode) && this.cameraMode !== 'topdown') this.cameraMode = 'chase';
    this.world.setCamera(this.cameraMode);
    this.world.rig.snap();
    this.title.el.hidden = true;
    this.hud.el.hidden = false;
    $('pause').hidden = true;
    this.title.setCode(s.conditions.code);
    this.title.setMode(s.mode);
  }

  retry(): void {
    if (!this.session) return;
    const { mode } = this.session;
    const code = this.session.conditions.code;
    this.audio.start();
    this.dialogs.closeAll();
    this.results.hide();
    this.replay = null;
    this.session = new FlightSession(mode, code, this.assists());
    this.dispatch({ type: 'retry' });
    this.beginSession();
  }

  newConditions(): void {
    if (!this.session) return;
    const d = decodeConditionCode(this.session.conditions.code)!;
    const code = encodeConditionCode(d.preset, randomSeed(Date.now() + this.frameCount));
    this.results.hide();
    this.replay = null;
    this.session = new FlightSession(this.session.mode, code, this.assists());
    this.dispatch({ type: 'newConditions', code });
    this.beginSession();
  }

  pause(): void {
    if (this.flow.screen !== 'playing') return;
    this.dispatch({ type: 'pause' });
    this.dialogs.show('pause');
  }

  resume(): void {
    if (this.flow.screen !== 'paused') return;
    this.dialogs.closeAll();
    this.dispatch({ type: 'resume' });
    this.stepper.reset();
    this.last = performance.now();
  }

  toTitle(): void {
    this.dialogs.closeAll();
    this.results.hide();
    this.replay = null;
    this.hud.el.hidden = true;
    this.dispatch({ type: 'title' });
    this.cameraMode = PLAYER_CAMERAS.includes(this.cameraMode) ? this.cameraMode : 'chase';
    this.world.setCamera('orbit');
    this.title.el.hidden = false;
    this.title.focus();
  }

  goAround(): void {
    if (this.flow.screen !== 'playing' || this.session?.mode !== 'landing') return;
    this.dispatch({ type: 'goAround' });
    $('fade').dataset['on'] = '';
    this.fadeTimer = this.testMode && this.timeScale > 1 ? 0.05 : 0.55;
    this.hud.showToast('Go-around: back to final, same conditions');
  }

  cycleCamera(): void {
    const list: CameraMode[] = this.testMode ? [...PLAYER_CAMERAS, 'topdown'] : [...PLAYER_CAMERAS];
    const i = list.indexOf(this.cameraMode);
    this.cameraMode = list[(i + 1) % list.length]!;
    this.world.setCamera(this.cameraMode);
    this.hud.showToast(`Camera: ${CAMERA_LABELS[this.cameraMode]}`);
  }

  setAutopilot(profile: AutopilotProfile | null): void {
    this.autopilot = profile ? createAutopilot(profile) : null;
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    this.input.setSettings(s);
    this.audio.setVolume(s.volume);
    if (this.session) this.session.assists = this.assists();
  }

  private capture(p: PoseSnapshot): void {
    const s = this.session!.state;
    p.pos.copy(s.pos);
    p.quat.copy(s.quat);
    p.aileron = s.aileron;
    p.elevator = s.elevator;
    p.rudder = s.rudder;
    p.flapDeg = s.flapDeg;
    p.steerDeg = s.steerDeg;
    p.propAngle = s.propAngle;
    p.rpm = s.rpm;
    p.wheelSpin[0] = s.wheelSpin[0];
    p.wheelSpin[1] = s.wheelSpin[1];
    p.wheelSpin[2] = s.wheelSpin[2];
    for (let i = 0; i < 3; i++) p.compression[i] = s.gear[i]!.compression;
  }

  private simStep = (): void => {
    const session = this.session;
    if (!session || session.ended) return;
    this.capture(this.prev);
    session.assists.autoThrottleTargetKt = this.input.arcadeTargetKt;
    if (this.autopilot) this.autopilot.control(session, this.ctrl);
    else this.input.sample(SIM_DT, this.ctrl);
    session.step(this.ctrl);
    this.capture(this.curr);
    const s = session.state;
    for (let i = 0; i < 3; i++) {
      const g = s.gear[i]!;
      if (g.inContact && !this.lastContact[i]) {
        const horiz = Math.min(1, s.groundSpeed / 30);
        this.contacts.push({
          pos: g.world.clone(),
          strength: Math.min(1.5, g.closingSpeed / 1.6 + horiz * 0.15),
          dust: g.surface !== 'runway',
          closing: g.closingSpeed,
        });
      }
      this.lastContact[i] = g.inContact;
    }
    if (s.skidding && ++this.skidTick % 6 === 0) {
      for (const g of s.gear) if (g.skidding) this.contacts.push({ pos: g.world.clone(), strength: 0.35, dust: g.surface !== 'runway', closing: 0 });
    }
    const onGrass = s.gear.some((g) => g.inContact && g.surface !== 'runway');
    this.rumble = onGrass ? Math.min(1, s.groundSpeed / 15) : s.onGround ? Math.min(0.25, s.groundSpeed / 120) : 0;
  };

  private finish(): void {
    const session = this.session!;
    const r = session.result!;
    this.lastResult = r;
    this.dispatch({ type: 'finish' });
    this.hud.el.hidden = true;
    const t0 = r.failure ? r.endTime - 6 : r.eventTime - 4.5;
    const t1 = r.failure ? r.endTime + 0.2 : Math.min(r.endTime, r.eventTime + 3.5);
    const frames = session.replay.extract(t0, t1);
    if (frames.length >= REPLAY_STRIDE * 10) {
      this.replay = { frames, t: frames[0]!, t0: frames[0]!, t1: frames[frames.length - REPLAY_STRIDE]!, event: r.eventTime, active: true };
      const i = this.frameIndexAt(r.eventTime);
      const o = i * REPLAY_STRIDE;
      this.world.rig.replayAnchor = new Vector3(frames[o + 1]!, frames[o + 2]!, frames[o + 3]!);
      this.world.setCamera('replay');
    } else {
      this.replay = null;
    }
    this.results.show(r, session.tracker.trace);
    this.results.setReplay(!!this.replay?.active, false);
  }

  toggleReplay(): void {
    if (!this.replay) return;
    this.replay.active = !this.replay.active;
    this.replay.t = this.replay.t0;
    this.world.setCamera(this.replay.active ? 'replay' : 'chase');
    this.results.setReplay(this.replay.active, false);
  }

  private frameIndexAt(t: number): number {
    const f = this.replay?.frames;
    if (!f) return 0;
    const n = f.length / REPLAY_STRIDE;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid * REPLAY_STRIDE]! <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private replayPose(dt: number): boolean {
    const r = this.replay;
    if (!r || !r.active) return false;
    const slow = Math.abs(r.t - r.event) < 0.7 && !this.settings.reducedMotion;
    r.t += dt * (slow ? 0.3 : 1);
    if (r.t > r.t1) r.t = r.t0;
    this.results.setReplay(true, slow);
    const f = r.frames;
    const i = this.frameIndexAt(r.t);
    const j = Math.min(i + 1, f.length / REPLAY_STRIDE - 1);
    const a = i * REPLAY_STRIDE;
    const b = j * REPLAY_STRIDE;
    const span = f[b]! - f[a]!;
    const k = span > 0 ? Math.min(1, (r.t - f[a]!) / span) : 0;
    const L = (o: number) => f[a + o]! + (f[b + o]! - f[a + o]!) * k;
    const p = this.pose;
    p.pos.set(L(1), L(2), L(3));
    p.quat.set(f[a + 4]!, f[a + 5]!, f[a + 6]!, f[a + 7]!).slerp(_q.set(f[b + 4]!, f[b + 5]!, f[b + 6]!, f[b + 7]!), k);
    p.aileron = L(8);
    p.elevator = L(9);
    p.rudder = L(10);
    p.flapDeg = L(11);
    p.steerDeg = L(12);
    p.propAngle = lerpAngle(f[a + 13]!, f[b + 13]!, k);
    p.rpm = L(14);
    (p.wheelSpin as number[])[0] = f[a + 15]!;
    (p.wheelSpin as number[])[1] = f[a + 16]!;
    (p.wheelSpin as number[])[2] = f[a + 17]!;
    (p.compression as number[])[0] = L(18);
    (p.compression as number[])[1] = L(19);
    (p.compression as number[])[2] = L(20);
    return true;
  }

  private interpolatePose(alpha: number): void {
    const p = this.pose;
    const a = this.prev;
    const b = this.curr;
    p.pos.lerpVectors(a.pos, b.pos, alpha);
    p.quat.slerpQuaternions(a.quat, b.quat, alpha);
    p.aileron = a.aileron + (b.aileron - a.aileron) * alpha;
    p.elevator = a.elevator + (b.elevator - a.elevator) * alpha;
    p.rudder = a.rudder + (b.rudder - a.rudder) * alpha;
    p.flapDeg = a.flapDeg + (b.flapDeg - a.flapDeg) * alpha;
    p.steerDeg = a.steerDeg + (b.steerDeg - a.steerDeg) * alpha;
    p.propAngle = lerpAngle(a.propAngle, b.propAngle, alpha);
    p.rpm = b.rpm;
    for (let i = 0; i < 3; i++) {
      (p.wheelSpin as number[])[i] = lerpAngle(a.wheelSpin[i]!, b.wheelSpin[i]!, alpha);
      (p.compression as number[])[i] = a.compression[i]! + (b.compression[i]! - a.compression[i]!) * alpha;
    }
  }

  private handleEdges(): void {
    let edges = this.input.drainEdges();
    if (this.dialogs.current && this.dialogs.current !== 'pause') return;
    const screen = this.flow.screen;
    if (screen === 'playing') edges = this.input.applyFlapEdges(edges);
    for (const e of edges) {
      if (screen === 'playing') {
        if (e === 'pause') this.pause();
        else if (e === 'goAround') this.goAround();
        else if (e === 'camera') this.cycleCamera();
        else if (e === 'retry') this.retry();
      } else if (screen === 'paused') {
        if (e === 'pause') this.resume();
        else if (e === 'retry') this.retry();
      } else if (screen === 'result') {
        if (e === 'retry') this.retry();
      }
    }
  }

  tick = (now: number): void => {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.frameCount++;
    this.handleEdges();
    const session = this.session;
    const screen = this.flow.screen;

    if (screen === 'playing' && session) {
      this.stepper.advance(dt * this.timeScale, this.simStep);
      if (session.ended) this.finish();
    }
    if (screen === 'goaround' && session) {
      this.fadeTimer -= dt;
      if (this.fadeTimer <= 0) {
        session.goAround();
        this.dispatch({ type: 'goAroundDone' });
        this.input.resetAxes(session.state.throttle, session.state.flapIndex);
        this.capture(this.prev);
        this.capture(this.curr);
        this.world.effects.clear();
        this.world.rig.snap();
        delete $('fade').dataset['on'];
        this.fadeTimer = -1;
      }
    }

    // Pose and render.
    let vel = _zero;
    let windVec = _zero;
    let papiWhite: readonly boolean[] = [true, true, false, false];
    let papiVisible = false;
    let runway = this.world.airfield.runwayId;
    let buffet = 0;
    let dof = false;
    const time = now / 1000;
    if (this.flow.screen === 'title' || !session) {
      this.pose.pos.copy(this.parked.pos);
      this.pose.quat.copy(this.parked.quat);
      this.pose.propAngle = 0;
      this.pose.flapDeg = 0;
      Object.assign(this.wind, this.titleWind);
    } else {
      if (this.flow.screen === 'result' && this.replayPose(dt)) {
        dof = true;
      } else {
        this.interpolatePose(this.flow.screen === 'playing' ? this.stepper.alpha : 1);
      }
      const s = session.state;
      vel = s.vel;
      windVec = s.wind;
      papiWhite = session.papi.white;
      papiVisible = session.papi.visible && session.mode === 'landing';
      runway = session.runway.id;
      buffet = this.flow.screen === 'playing' ? s.buffet : 0;
      windReadout(session.wind, s.time, this.wind);
      for (const c of this.contacts) {
        this.world.effects.emit(c.pos, s.vel, c.strength, Math.round(2 + c.strength * 10), c.dust);
        this.audio.chirp(c.strength, c.dust);
        this.world.shake.impulse(c.closing * 0.28);
        if (c.closing > 2.4) this.audio.thump(c.closing / 3);
      }
      this.contacts.length = 0;
    }
    const frame: FrameInput = {
      pose: this.pose,
      vel,
      wind: windVec,
      windReadout: this.wind,
      runway,
      papiWhite,
      papiVisible,
      time,
      dt,
      buffet,
      rumble: this.flow.screen === 'playing' ? this.rumble : 0,
      guidance: this.settings.centerlineGuidance && session?.mode === 'landing' && this.flow.screen !== 'result',
      reducedMotion: this.settings.reducedMotion,
      dof,
    };
    this.lastFrame = frame;
    this.world.render(frame);

    if (session && (this.flow.screen === 'playing' || this.flow.screen === 'paused' || this.flow.screen === 'goaround')) {
      const canvas = this.world.renderer.domElement;
      this.hud.update({
        mode: session.mode,
        code: session.conditions.code,
        s: session.state,
        runway: session.runway,
        papi: session.papi,
        tracker: session.tracker,
        wind: this.wind,
        settings: this.settings,
        arcadeTargetKt: this.input.arcadeTargetKt,
        camera: this.world.rig.camera,
        cameraMode: this.cameraMode,
        goArounds: session.goArounds,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    }
    const s = session?.state;
    this.audio.update({
      rpm: s && this.flow.screen !== 'title' ? s.rpm : 0,
      power: s ? s.power : 0,
      airspeed: s ? s.ias : 0,
      stallWarning: !!s && this.flow.screen === 'playing' && s.stallWarning,
      rumble: this.flow.screen === 'playing' ? this.rumble : 0,
      paused: this.flow.screen !== 'playing' && this.flow.screen !== 'goaround',
    });
  };

  run(): void {
    const loop = (t: number) => {
      this.tick(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

const _zero = new Vector3();
const _q = new Quaternion();
