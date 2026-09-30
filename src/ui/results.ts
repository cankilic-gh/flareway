import { $, escapeHtml, setText } from './dom';
import type { AttemptResult } from '../sim/session';
import type { CenterlineTrace } from '../sim/attempt';
import { RUNWAY } from '../sim/constants';

export interface ResultsCallbacks {
  onRetry(): void;
  onNew(): void;
  onReplay(): void;
  onTitle(): void;
}

const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : '—');

export class ResultsUI {
  readonly el = $('results');
  private readonly replayTag = $('replay-tag');
  private readonly replaySpeed = $('replay-speed');

  constructor(cb: ResultsCallbacks) {
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset['action'];
      if (a === 'retry') cb.onRetry();
      else if (a === 'new') cb.onNew();
      else if (a === 'replay') cb.onReplay();
      else if (a === 'title') cb.onTitle();
    });
  }

  show(r: AttemptResult, trace: CenterlineTrace): void {
    const sc = r.score;
    const grade = $('res-grade');
    setText(grade, sc.grade);
    grade.dataset['grade'] = sc.grade;
    setText($('res-mode'), `${r.mode === 'landing' ? 'Landing Challenge' : 'Takeoff Practice'} · ${r.code}${r.goArounds ? ` · ${r.goArounds} go-around${r.goArounds > 1 ? 's' : ''}` : ''}`);
    setText($('results-label'), sc.label);
    setText($('res-total'), String(sc.total));
    setText($('res-loss'), sc.biggestLoss);
    $('res-breakdown').innerHTML = sc.breakdown
      .map(
        (b) => `<div class="bar"><span>${escapeHtml(b.label)} <span class="bar__note">${escapeHtml(b.note)}</span></span><span class="bar__pts">${Math.round(b.points)}/${b.max}</span><div class="bar__track"><div class="bar__fill" style="width:${((b.points / b.max) * 100).toFixed(1)}%"></div></div></div>`,
      )
      .join('');
    const m: [string, string][] = [];
    if (r.mode === 'landing' && r.touchdown) {
      const td = r.touchdown;
      m.push(
        ['Sink rate', `${Math.round(td.sinkFpm)} fpm`],
        ['Sink', `${fmt(td.sinkMps, 2)} m/s`],
        ['First contact', td.firstContact === 'main' ? 'Mains' : 'Nosewheel'],
        ['Centerline', `${fmt(Math.abs(td.centerlineOffset))} m ${td.centerlineOffset >= 0 ? 'R' : 'L'}`],
        ['Lateral vel.', `${fmt(td.lateralVelocity, 2)} m/s`],
        ['Side-load', `${fmt(Math.abs(td.driftVelocity), 2)} m/s`],
        ['Yaw error', `${fmt(td.yawErrorDeg)}°`],
        ['Bank', `${fmt(td.bankDeg)}°`],
        ['Pitch', `${fmt(td.pitchDeg)}°`],
        ['Airspeed', `${Math.round(td.kias)} KIAS`],
        ['Touchdown', `${Math.round(td.distancePastThreshold)} m past thr.`],
        ['Bounce', r.maxBounceHeight > 0.15 ? `${fmt(r.maxBounceHeight)} m` : 'none'],
      );
      if (!r.failure) m.push(['Runway left', `${Math.round(r.runwayRemaining)} m`]);
    } else if (r.takeoff) {
      const t = r.takeoff;
      m.push(
        ['Rotate', t.rotateKias !== null ? `${Math.round(t.rotateKias)} KIAS` : '—'],
        ['Liftoff', t.liftoffKias !== null ? `${Math.round(t.liftoffKias)} KIAS` : '—'],
        ['Ground roll', t.liftoffDistance !== null ? `${Math.round(t.liftoffDistance)} m` : '—'],
        ['Max offset', `${fmt(t.maxRollOffset)} m`],
        ['Max pitch', `${fmt(t.maxPitchOnGroundDeg)}°`],
        ['Climb speed', t.climbAvgKias !== null ? `${Math.round(t.climbAvgKias)} KIAS` : '—'],
      );
    }
    $('res-metrics').innerHTML = m.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
    this.drawPlot(trace, r);
    this.el.hidden = false;
    ($('results-label') as HTMLElement).focus({ preventScroll: true });
  }

  private drawPlot(trace: CenterlineTrace, r: AttemptResult): void {
    const svg = $('res-plot');
    const W = 320;
    const H = 90;
    const n = trace.count;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(trace.data[i * 2]!);
      ys.push(trace.data[i * 2 + 1]!);
    }
    const x0 = r.mode === 'landing' ? -700 : -20;
    const x1 = RUNWAY.length - (RUNWAY.halfLength - RUNWAY.thresholdAbsX);
    const yMax = 16;
    const px = (x: number) => ((x - x0) / (x1 - x0)) * W;
    const py = (y: number) => H / 2 - (Math.max(-yMax, Math.min(yMax, y)) / yMax) * (H / 2 - 4);
    const rw0 = px(-(RUNWAY.halfLength - RUNWAY.thresholdAbsX));
    const edge = (RUNWAY.halfWidth / yMax) * (H / 2 - 4);
    let pts = '';
    for (let i = 0; i < xs.length; i++) if (xs[i]! >= x0 && xs[i]! <= x1) pts += `${px(xs[i]!).toFixed(1)},${py(ys[i]!).toFixed(1)} `;
    let td = '';
    if (r.touchdown) td = `<circle cx="${px(r.touchdown.distancePastThreshold).toFixed(1)}" cy="${py(r.touchdown.centerlineOffset).toFixed(1)}" r="4" fill="#f5b53d"/>`;
    svg.innerHTML = `
      <rect x="${rw0.toFixed(1)}" y="${(H / 2 - edge).toFixed(1)}" width="${(W - rw0).toFixed(1)}" height="${(edge * 2).toFixed(1)}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,90,79,0.5)"/>
      <line x1="${rw0.toFixed(1)}" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="rgba(243,239,230,0.5)" stroke-dasharray="6 6"/>
      <line x1="${px(0).toFixed(1)}" x2="${px(0).toFixed(1)}" y1="${(H / 2 - edge).toFixed(1)}" y2="${(H / 2 + edge).toFixed(1)}" stroke="rgba(243,239,230,0.7)"/>
      <polyline points="${pts}" fill="none" stroke="#5fe3ff" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${td}`;
  }

  hide(): void {
    this.el.hidden = true;
    this.replayTag.hidden = true;
  }

  setReplay(active: boolean, slow: boolean): void {
    this.replayTag.hidden = !active;
    setText(this.replaySpeed, slow ? '· slow motion' : '');
  }
}
