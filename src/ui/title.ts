import { $, escapeHtml } from './dom';
import {
  PRESETS,
  decodeConditionCode,
  encodeConditionCode,
  generateConditions,
  randomSeed,
  type PresetId,
} from '../sim/conditions';
import type { GameMode } from '../sim/flow';

export interface TitleCallbacks {
  onStart(mode: GameMode, code: string): void;
  onTutorial(): void;
  onSettings(): void;
}

const pad3 = (n: number): string => String(Math.round(n) % 360 || 360).padStart(3, '0');

export const describeWind = (code: string): string => {
  const d = decodeConditionCode(code);
  if (!d) return '';
  const c = generateConditions(d.preset, d.seed);
  return `${pad3(c.windFromDeg)}° ${Math.round(c.windKt)}${c.gustKt >= 1 ? `G${Math.round(c.windKt + c.gustKt)}` : ''} kt`;
};

export class TitleUI {
  readonly el = $('title');
  private readonly codeInput = $<HTMLInputElement>('code-input');
  private readonly briefing = $('briefing');
  private readonly presetGroup = $('preset-group');
  private preset: PresetId = 'breezy';
  private seed = randomSeed(Date.now());

  constructor(private readonly cb: TitleCallbacks) {
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset['preset'] = p.id;
      b.textContent = p.label;
      b.title = p.blurb;
      if (p.difficult) b.dataset['difficult'] = '';
      b.addEventListener('click', () => this.setPreset(p.id, true));
      this.presetGroup.append(b);
    }
    this.presetGroup.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = PRESETS.findIndex((p) => p.id === this.preset);
      const n = (i + (e.key === 'ArrowRight' ? 1 : PRESETS.length - 1)) % PRESETS.length;
      this.setPreset(PRESETS[n]!.id, true);
      (this.presetGroup.querySelector(`[data-preset="${PRESETS[n]!.id}"]`) as HTMLButtonElement | null)?.focus();
      e.preventDefault();
    });
    $('shuffle-btn').addEventListener('click', () => {
      this.seed = randomSeed(Date.now() + Math.floor(performance.now() * 1000));
      this.syncCode();
    });
    this.codeInput.addEventListener('input', () => {
      const d = decodeConditionCode(this.codeInput.value);
      this.codeInput.setAttribute('aria-invalid', d ? 'false' : 'true');
      if (d) {
        this.preset = d.preset;
        this.seed = d.seed;
        this.syncPresetButtons();
        this.renderBriefing();
      }
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.start();
    });
    $('start-btn').addEventListener('click', () => this.start());
    $('tutorial-btn').addEventListener('click', () => this.cb.onTutorial());
    $('settings-btn').addEventListener('click', () => this.cb.onSettings());
    this.el.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) => r.addEventListener('change', () => this.renderBriefing()));
    this.setPreset(this.preset, false);
  }

  get mode(): GameMode {
    const checked = this.el.querySelector<HTMLInputElement>('input[name="mode"]:checked');
    return (checked?.value as GameMode) ?? 'landing';
  }

  get code(): string {
    return encodeConditionCode(this.preset, this.seed);
  }

  setCode(code: string): void {
    const d = decodeConditionCode(code);
    if (!d) return;
    this.preset = d.preset;
    this.seed = d.seed;
    this.syncPresetButtons();
    this.syncCode();
  }

  setMode(mode: GameMode): void {
    const r = this.el.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
    if (r) r.checked = true;
    this.renderBriefing();
  }

  private setPreset(id: PresetId, _user: boolean): void {
    this.preset = id;
    this.syncPresetButtons();
    this.syncCode();
  }

  private syncPresetButtons(): void {
    this.presetGroup.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = b.dataset['preset'] === this.preset;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  private syncCode(): void {
    this.codeInput.value = this.code;
    this.codeInput.setAttribute('aria-invalid', 'false');
    this.renderBriefing();
  }

  private renderBriefing(): void {
    const c = generateConditions(this.preset, this.seed);
    const xw = Math.abs(c.crosswindKt);
    const xwSide = c.crosswindKt >= 0 ? 'right' : 'left';
    const hw = c.headwindKt;
    const def = PRESETS.find((p) => p.id === this.preset)!;
    const gust = c.gustKt >= 1 ? `, gusts ${Math.round(c.windKt + c.gustKt)}` : '';
    const rows = [
      ['Runway', `${c.runway} · ${this.mode === 'landing' ? '1.4 nm final' : 'lined up'}`],
      ['Wind', `${pad3(c.windFromDeg)}° ${Math.round(c.windKt)} kt${gust}`],
      ['Crosswind', xw < 0.5 ? 'none' : `${xw.toFixed(0)} kt from ${xwSide}`],
      [hw >= 0 ? 'Headwind' : 'Tailwind', `${Math.abs(hw).toFixed(0)} kt`],
    ];
    let html = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v!)}</dd></div>`).join('');
    if (c.tailwind) html += `<p class="warn" role="note">Tailwind of ${Math.abs(hw).toFixed(0)} kt on runway ${c.runway}: expect a longer float and rollout.</p>`;
    else if (def.difficult) html += `<p class="warn" role="note">Challenge: strong crosswind and turbulence. Difficult.</p>`;
    this.briefing.innerHTML = `<dl class="briefing" style="display:contents">${html}</dl>`;
  }

  private start(): void {
    const d = decodeConditionCode(this.codeInput.value);
    if (d) {
      this.preset = d.preset;
      this.seed = d.seed;
    }
    this.cb.onStart(this.mode, this.code);
  }

  focus(): void {
    ($('start-btn') as HTMLButtonElement).focus({ preventScroll: true });
  }
}
