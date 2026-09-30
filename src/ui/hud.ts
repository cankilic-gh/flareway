import { Vector3, type PerspectiveCamera } from 'three';
import { $, setText, show } from './dom';
import { DEG, FPM, FT, KT, RUNWAY } from '../sim/constants';
import { alongTrack, lateralOffset, type RunwayInfo } from '../sim/airfield';
import { headingDeg, type AircraftState } from '../sim/physics';
import type { PapiState } from '../sim/papi';
import type { LandingTracker, TakeoffTracker } from '../sim/attempt';
import type { WindReadout } from '../sim/wind';
import type { GameMode } from '../sim/flow';
import type { Settings } from '../input/settings';

export interface HudFrame {
  mode: GameMode;
  code: string;
  s: AircraftState;
  runway: RunwayInfo;
  papi: PapiState;
  tracker: LandingTracker | TakeoffTracker;
  wind: WindReadout;
  settings: Settings;
  arcadeTargetKt: number;
  camera: PerspectiveCamera;
  cameraMode: string;
  goArounds: number;
  width: number;
  height: number;
}

const _v = new Vector3();
const pad3 = (n: number): string => String(((Math.round(n) % 360) + 360) % 360 || 360).padStart(3, '0');

export class Hud {
  readonly el = $('hud');
  private readonly kias = $('hud-kias');
  private readonly agl = $('hud-agl');
  private readonly vs = $('hud-vs');
  private readonly hdg = $('hud-hdg');
  private readonly rwy = $('hud-rwy');
  private readonly thr = $('hud-throttle');
  private readonly thrUnit = $('hud-throttle-unit');
  private readonly thrFill = $('hud-throttle-fill');
  private readonly flaps = Array.from($('hud-flaps').querySelectorAll('i'));
  private readonly brake = $('hud-brake');
  private readonly windArrow = document.getElementById('hud-wind-arrow') as unknown as SVGPathElement;
  private readonly windText = $('hud-wind-text');
  private readonly xwind = $('hud-xwind');
  private readonly stability = $('hud-stability');
  private readonly papi = Array.from($('hud-papi').querySelectorAll('i'));
  private readonly papiEl = $('hud-papi');
  private readonly stall = $('hud-stall');
  private readonly slip = $('hud-slip');
  private readonly centerline = $('hud-centerline');
  private readonly clMarker = $('hud-centerline-marker');
  private readonly clText = $('hud-centerline-text');
  private readonly fpv = document.getElementById('hud-fpv') as unknown as SVGGElement;
  private readonly aim = document.getElementById('hud-aim') as unknown as SVGGElement;
  private readonly modeChip = $('hud-mode');
  private readonly codeChip = $('hud-code');
  private readonly assists = $('hud-assists');
  private readonly toast = $('hud-toast');
  private readonly hint = $('hud-hint');
  private hintMode = '';
  private readonly kiasBlock = this.kias.parentElement as HTMLElement;
  private toastTimer = 0;

  showToast(text: string, ms = 1600): void {
    setText(this.toast, text);
    this.toast.dataset['show'] = '';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => delete this.toast.dataset['show'], ms);
  }

  update(f: HudFrame): void {
    const s = f.s;
    const kias = s.ias / KT;
    setText(this.kias, kias.toFixed(0));
    this.kiasBlock.dataset['state'] = s.stallWarning ? 'slow' : '';
    setText(this.agl, (s.agl / FT).toFixed(0));
    const vsFpm = s.vs / FPM;
    setText(this.vs, `${vsFpm > 0 ? '+' : ''}${(Math.round(vsFpm / 10) * 10).toFixed(0)}`);
    const hdg = headingDeg(s.quat);
    setText(this.hdg, pad3(hdg));
    setText(this.rwy, `RWY ${f.runway.id}`);
    if (f.settings.throttleMode === 'arcade') {
      setText(this.thr, f.arcadeTargetKt.toFixed(0));
      setText(this.thrUnit, 'kt tgt');
    } else {
      setText(this.thr, (s.throttle * 100).toFixed(0));
      setText(this.thrUnit, '%');
    }
    this.thrFill.style.height = `${(s.throttle * 100).toFixed(1)}%`;
    const detent = [0, 10, 20, 30][s.flapIndex] ?? 0;
    this.flaps.forEach((el, i) => {
      const on = i === s.flapIndex;
      if (on) el.dataset['on'] = '';
      else delete el.dataset['on'];
      if (on && Math.abs(s.flapDeg - detent) > 0.5) el.dataset['moving'] = '';
      else delete el.dataset['moving'];
    });
    show(this.brake, s.brake > 0.05);

    // Wind: arrow points where the wind blows, relative to the nose (up).
    const rel = f.wind.fromDeg + 180 - hdg;
    this.windArrow.setAttribute('transform', `rotate(${rel.toFixed(1)})`);
    const gust = f.wind.gust > 0.15 ? ' gusting' : '';
    setText(this.windText, `${pad3(f.wind.fromDeg)}° ${f.wind.speedKt.toFixed(0)} kt`);
    const relFrom = (f.wind.fromDeg - f.runway.headingDeg) * DEG;
    const xw = f.wind.speedKt * Math.sin(relFrom);
    const hw = f.wind.speedKt * Math.cos(relFrom);
    setText(this.xwind, `XW ${Math.abs(xw).toFixed(0)} ${xw >= 0 ? 'R' : 'L'} · ${hw >= 0 ? 'HW' : 'TW'} ${Math.abs(hw).toFixed(0)}${gust}`);

    // Approach stability (landing only, 50-500 ft).
    const t = f.tracker;
    const landing = t.kind === 'landing';
    const aglFt = s.agl / FT;
    const onApproach = landing && t.phase === 'approach' && aglFt > 50 && aglFt < 500;
    show(this.stability, onApproach);
    if (onApproach && t.kind === 'landing') {
      this.stability.dataset['state'] = t.stableNow ? 'stable' : 'unstable';
      setText(this.stability, t.stableNow ? 'STABLE' : `UNSTABLE · ${t.unstableNow ?? ''}`.toUpperCase());
    }
    const showPapi = landing && f.settings.centerlineGuidance && f.papi.visible && t.phase === 'approach';
    show(this.papiEl, showPapi);
    if (showPapi) {
      this.papi.forEach((el, i) => {
        if (f.papi.white[i]) delete el.dataset['red'];
        else el.dataset['red'] = '';
      });
    }
    show(this.stall, s.stallWarning);

    // Slip indicator: the ball moves opposite to sideslip.
    const ball = Math.max(-1, Math.min(1, -s.beta / (10 * DEG)));
    this.slip.style.transform = `translateX(${(ball * 40).toFixed(1)}px)`;

    // Centerline deviation near the runway.
    const along = alongTrack(f.runway, s.pos.x);
    const d = lateralOffset(f.runway, s.pos.z);
    const nearRunway = f.settings.centerlineGuidance && (s.onGround || (along > -1500 && s.agl < 150) || !landing);
    show(this.centerline, nearRunway);
    if (nearRunway) {
      const frac = Math.max(-1, Math.min(1, d / RUNWAY.halfWidth));
      this.clMarker.style.transform = `translateX(${(frac * 150).toFixed(1)}px)`;
      setText(this.clText, `${Math.abs(d).toFixed(1)} m ${Math.abs(d) < 0.2 ? '' : d > 0 ? 'right' : 'left'}`.trim());
    }

    // Approach markers: flight path vector and touchdown aim box.
    const markers = f.settings.approachMarker && (f.cameraMode === 'chase' || f.cameraMode === 'cockpit');
    const cam = f.camera;
    if (markers && s.groundSpeed > 5) {
      _v.copy(s.vel).normalize().multiplyScalar(500).add(cam.position).project(cam);
      this.place(this.fpv, _v, f.width, f.height);
    } else this.fpv.setAttribute('visibility', 'hidden');
    if (markers && landing && t.phase === 'approach') {
      const aimAlong = RUNWAY.thresholdAbsX - RUNWAY.papiAbsX + 20;
      _v.set(f.runway.thresholdX + f.runway.dir * aimAlong, RUNWAY.surfaceY, 0).project(cam);
      this.place(this.aim, _v, f.width, f.height);
    } else this.aim.setAttribute('visibility', 'hidden');

    if (this.hintMode !== f.mode) {
      this.hintMode = f.mode;
      const b = f.settings.bindings;
      const k = (c: string) => `<kbd>${c.replace(/^Key/, '').replace('Escape', 'Esc')}</kbd>`;
      this.hint.innerHTML =
        f.mode === 'landing'
          ? `${k(b.goAround)} go around · ${k(b.camera)} camera · ${k(b.pause)} pause`
          : `${k(b.camera)} camera · ${k(b.retry)} retry · ${k(b.pause)} pause`;
    }
    setText(this.modeChip, f.mode === 'landing' ? `Landing${f.goArounds ? ` · GA ${f.goArounds}` : ''}` : 'Takeoff');
    setText(this.codeChip, f.code);
    const a: string[] = [];
    if (f.settings.stabilityAssist) a.push('Pitch');
    if (f.settings.coordinatedRudder) a.push('Rudder');
    if (f.settings.throttleMode === 'arcade') a.push('Speed');
    if (f.settings.centerlineGuidance) a.push('Guide');
    setText(this.assists, a.length ? `Assists: ${a.join(' · ')}` : 'No assists');
  }

  private place(g: SVGGElement, ndc: Vector3, w: number, h: number): void {
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) {
      g.setAttribute('visibility', 'hidden');
      return;
    }
    g.setAttribute('visibility', 'visible');
    g.setAttribute('transform', `translate(${((ndc.x * 0.5 + 0.5) * w).toFixed(1)} ${((-ndc.y * 0.5 + 0.5) * h).toFixed(1)})`);
  }
}
