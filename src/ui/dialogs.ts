import { $ } from './dom';
import { ACTION_LABELS, DEFAULT_BINDINGS, keyLabel, rebind, type Action } from '../input/bindings';
import type { Settings } from '../input/settings';
import type { InputManager } from '../input/controls';

type DialogId = 'tutorial' | 'settings' | 'pause';

/** Accessible modal dialogs: focus moves to the heading, Escape closes, focus returns to the opener. */
export class Dialogs {
  private open: DialogId | null = null;
  private stack: DialogId[] = [];
  private returnFocus: HTMLElement | null = null;
  onClose: ((id: DialogId) => void) | null = null;

  constructor() {
    for (const id of ['tutorial', 'settings'] as const) {
      $(id).addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-action="close"]') || t === $(id)) this.close();
      });
    }
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.open || this.open === 'pause') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      },
      true,
    );
    // Explicit focus cycling inside dialogs: consistent across browsers, including Safari, which skips buttons on Tab.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this.open) return;
      const root = $(this.open);
      const f = Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!f.length) return;
      e.preventDefault();
      const i = f.indexOf(document.activeElement as HTMLElement);
      const next = i === -1 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
      f[next]!.focus();
    });
  }

  get current(): DialogId | null {
    return this.open;
  }

  /** `opener` is needed on Safari, where clicking a button does not focus it. */
  show(id: DialogId, opener?: HTMLElement): void {
    if (this.open && this.open !== id) this.stack.push(this.open);
    if (!this.stack.length) {
      const active = document.activeElement as HTMLElement | null;
      this.returnFocus = opener ?? (active && active !== document.body ? active : null);
    }
    if (this.open) $(this.open).hidden = true;
    this.open = id;
    const el = $(id);
    el.hidden = false;
    const scroll = el.querySelector<HTMLElement>('.dialog__scroll');
    if (scroll) scroll.scrollTop = 0;
    (el.querySelector<HTMLElement>('h2') ?? el).focus({ preventScroll: true });
  }

  close(): void {
    if (!this.open) return;
    const id = this.open;
    $(id).hidden = true;
    this.open = this.stack.pop() ?? null;
    if (this.open) {
      $(this.open).hidden = false;
      $(this.open).querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    } else {
      this.returnFocus?.focus({ preventScroll: true });
    }
    this.onClose?.(id);
  }

  closeAll(): void {
    for (const id of ['tutorial', 'settings', 'pause'] as const) $(id).hidden = true;
    this.open = null;
    this.stack = [];
  }
}

export const renderTutorialKeys = (s: Settings): void => {
  const b = s.bindings;
  const rows: [string, string][] = [
    ['Throttle up / down', `${keyLabel(b.throttleUp)} / ${keyLabel(b.throttleDown)}`],
    ['Bank left / right', `${keyLabel(b.rollLeft)} / ${keyLabel(b.rollRight)}`],
    [s.pitchAviation ? 'Nose down / nose up' : 'Nose up / nose down', `${keyLabel(b.pitchUpKey)} / ${keyLabel(b.pitchDownKey)}`],
    ['Rudder / nosewheel left / right', `${keyLabel(b.rudderLeft)} / ${keyLabel(b.rudderRight)}`],
    ['Flaps down / up', `${keyLabel(b.flapsDown)} / ${keyLabel(b.flapsUp)}`],
    ['Brakes', keyLabel(b.brake)],
    ['Go around', keyLabel(b.goAround)],
    ['Camera', keyLabel(b.camera)],
    ['Retry', keyLabel(b.retry)],
    ['Pause', keyLabel(b.pause)],
  ];
  $('tutorial-keys').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><kbd>${v}</kbd></div>`).join('');
};

export class SettingsUI {
  constructor(
    private settings: Settings,
    private readonly input: InputManager,
    private readonly onChange: (s: Settings) => void,
  ) {
    const root = $('settings');
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((el) => {
      el.addEventListener('change', () => this.read(el));
      if (el instanceof HTMLInputElement && el.type === 'range') el.addEventListener('input', () => this.read(el));
    });
    $('reset-bindings').addEventListener('click', () => {
      this.settings = { ...this.settings, bindings: { ...DEFAULT_BINDINGS } };
      this.onChange(this.settings);
      this.render();
    });
    this.render();
  }

  update(s: Settings): void {
    this.settings = s;
    this.render();
  }

  private read(el: HTMLInputElement | HTMLSelectElement): void {
    const key = el.dataset['setting'] as keyof Settings;
    let value: unknown;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
    else if (el instanceof HTMLInputElement && el.type === 'range') value = Number(el.value);
    else if (key === 'pitchAviation') value = el.value === 'true';
    else value = el.value;
    const prevQuality = this.settings.quality;
    this.settings = { ...this.settings, [key]: value } as Settings;
    if (key === 'quality') $('quality-note').hidden = this.settings.quality === prevQuality;
    this.onChange(this.settings);
  }

  render(): void {
    const s = this.settings;
    const root = $('settings');
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((el) => {
      const key = el.dataset['setting'] as keyof Settings;
      const v = s[key];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = String(v);
    });
    const list = $('bindings');
    list.innerHTML = '';
    for (const a of Object.keys(ACTION_LABELS) as Action[]) {
      const row = document.createElement('div');
      row.className = 'binding';
      const label = document.createElement('span');
      label.textContent = ACTION_LABELS[a];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost';
      btn.textContent = keyLabel(s.bindings[a]);
      btn.setAttribute('aria-label', `${ACTION_LABELS[a]}: ${keyLabel(s.bindings[a])}. Press to change.`);
      btn.addEventListener('click', () => {
        btn.dataset['listening'] = '';
        btn.textContent = 'Press a key…';
        this.input.capture = (code) => {
          delete btn.dataset['listening'];
          if (code !== 'Escape' || a === 'pause') {
            this.settings = { ...this.settings, bindings: rebind(this.settings.bindings, a, code) };
            this.onChange(this.settings);
          }
          this.render();
          (list.querySelectorAll('button')[Object.keys(ACTION_LABELS).indexOf(a)] as HTMLButtonElement | undefined)?.focus();
        };
      });
      row.append(label, btn);
      list.append(row);
    }
    renderTutorialKeys(s);
  }
}
