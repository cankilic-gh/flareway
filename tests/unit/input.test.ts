import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, keyLabel, rebind } from '../../src/input/bindings';
import { InputManager } from '../../src/input/controls';
import { defaultSettings } from '../../src/input/settings';
import { neutralInput } from '../../src/sim/physics';
import { SIM_DT } from '../../src/sim/constants';

const press = (code: string, _down: boolean) => ({ code, target: null, preventDefault: () => undefined }) as unknown as KeyboardEvent;

const withKeys = (m: InputManager, codes: string[]) => {
  for (const c of codes) (m as unknown as { onKey: (e: KeyboardEvent, d: boolean) => void }).onKey(press(c, true), true);
};

describe('key bindings', () => {
  it('uses the documented defaults', () => {
    expect(DEFAULT_BINDINGS.throttleUp).toBe('KeyW');
    expect(DEFAULT_BINDINGS.pitchUpKey).toBe('ArrowUp');
    expect(DEFAULT_BINDINGS.brake).toBe('Space');
    expect(DEFAULT_BINDINGS.goAround).toBe('KeyT');
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ArrowUp')).toBe('↑');
  });

  it('rebinding swaps a conflicting key instead of leaving an action unbound', () => {
    const b = rebind(DEFAULT_BINDINGS, 'brake', 'KeyW');
    expect(b.brake).toBe('KeyW');
    expect(b.throttleUp).toBe('Space');
    expect(new Set(Object.values(b)).size).toBe(Object.values(b).length);
  });
});

describe('keyboard control mapping', () => {
  it('aviation pitch keys: Down arrow raises the nose, and keys ramp in over time', () => {
    const m = new InputManager(defaultSettings());
    withKeys(m, ['ArrowDown']);
    const out = neutralInput();
    m.sample(SIM_DT, out);
    expect(out.pitch).toBeGreaterThan(0);
    expect(out.pitch).toBeLessThan(0.05);
    for (let i = 0; i < 120; i++) m.sample(SIM_DT, out);
    expect(out.pitch).toBeCloseTo(1, 5);
  });

  it('direct pitch mode inverts the keys', () => {
    const m = new InputManager({ ...defaultSettings(), pitchAviation: false });
    withKeys(m, ['ArrowDown']);
    const out = neutralInput();
    for (let i = 0; i < 60; i++) m.sample(SIM_DT, out);
    expect(out.pitch).toBeLessThan(0);
  });

  it('manual throttle holds position and flaps step through detents', () => {
    const m = new InputManager(defaultSettings());
    withKeys(m, ['KeyW']);
    const out = neutralInput();
    for (let i = 0; i < 120; i++) m.sample(SIM_DT, out);
    expect(out.throttle).toBeGreaterThan(0.5);
    (m as unknown as { onKey: (e: KeyboardEvent, d: boolean) => void }).onKey(press('KeyW', false), false);
    const held = out.throttle;
    for (let i = 0; i < 120; i++) m.sample(SIM_DT, out);
    expect(out.throttle).toBe(held);
    m.applyFlapEdges(['flapsDown', 'flapsDown', 'flapsDown', 'flapsDown']);
    m.sample(SIM_DT, out);
    expect(out.flaps).toBe(3);
    m.applyFlapEdges(['flapsUp']);
    m.sample(SIM_DT, out);
    expect(out.flaps).toBe(2);
  });
});
