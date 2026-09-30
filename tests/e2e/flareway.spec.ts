import { expect, test, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  screen(): string;
  start(mode: 'landing' | 'takeoff', code: string, autopilot?: string | null, timeScale?: number): unknown;
  fastForward(seconds: number): void;
  state(): { aglFt: number; kias: number; goArounds: number; pos: number[]; onGround: boolean; stepCount: number } | null;
  result(): { label: string; total: number; grade: string; failure: string | null; takeoff: { rotateKias: number; liftoffKias: number } | null } | null;
  binding(): { aircraftFallback: boolean; airfieldFallback: boolean; missing: string[]; airfieldNodes: string[]; anchors: Record<string, number[]>; expectedAnchors: Record<string, number[]> };
  surfaces(): Record<string, number>;
  fuselageVisible(): boolean;
  aircraftOpacity(): { name: string; transparent: boolean; opacity: number }[];
  camera(): string;
  papi(): { white: boolean[]; indication: string; elevationDeg: number; lensWhiteVisible: boolean[] } | null;
  windsock(): { wind: { fromDeg: number; speedKt: number } | null; pivotYaw: number | null; pivotDroop: number | null };
  stats(): { sceneCalls: number; sceneTriangles: number; vegetation: { nearVisible: number; farVisible: number; culled: number; total: number } };
  setTimeScale(n: number): void;
};

declare global {
  interface Window {
    __flareway?: Api;
  }
}

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') list.push(m.text());
  });
});

const openTest = async (page: Page, path = '/?test=1') => {
  await page.goto(path);
  await expect(page.locator('#title')).toBeVisible();
  await page.waitForFunction(() => window.__flareway?.ready === true);
};

const finishAttempt = async (page: Page, mode: 'landing' | 'takeoff', code: string, pilot: string) => {
  await page.evaluate(
    ([m, c, p]) => {
      const f = window.__flareway!;
      f.start(m as 'landing' | 'takeoff', c!, p);
      f.fastForward(220);
    },
    [mode, code, pilot],
  );
  await expect(page.locator('#results')).toBeVisible();
  return page.evaluate(() => window.__flareway!.result()!);
};

test('@smoke production build boots WebGL 2 and defaults to Landing Challenge', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#title')).toBeVisible({ timeout: 45_000 });
  const gl = await page.evaluate(() => {
    const c = document.getElementById('scene') as HTMLCanvasElement;
    const ctx = c.getContext('webgl2');
    return { webgl2: !!ctx && ctx instanceof WebGL2RenderingContext, width: c.width };
  });
  expect(gl.webgl2).toBe(true);
  expect(gl.width).toBeGreaterThan(300);
  await expect(page.locator('input[name="mode"][value="landing"]')).toBeChecked();
  await expect(page.locator('.mode-card').first()).toContainText('Landing Challenge');
  await expect(page.locator('.disclaimer').first()).toContainText('Recreational game, not flight training');
  expect(errors.get(page)).toEqual([]);
});

test('normal public build does not expose the test API', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#title')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(500);
  const exposed = await page.evaluate(() => ({
    api: typeof window.__flareway,
    chunk: performance.getEntriesByType('resource').some((r) => r.name.includes('testApi')),
  }));
  expect(exposed).toEqual({ api: 'undefined', chunk: false });
});

test('test API exists only with ?test=1 and GLB nodes bind', async ({ page }) => {
  await openTest(page);
  const b = await page.evaluate(() => window.__flareway!.binding());
  expect(b.aircraftFallback).toBe(false);
  expect(b.airfieldFallback).toBe(false);
  expect(b.missing).toEqual([]);
  for (const [name, expected] of Object.entries(b.expectedAnchors)) {
    const got = b.anchors[name]!;
    expected.forEach((v, i) => expect(Math.abs(got[i]! - v)).toBeLessThan(1e-4));
  }
  for (const n of ['IslandTerrain', 'OceanReferencePlane', 'VegetationSpawns', 'Runway', 'PAPI', 'PAPI_4_Red', 'WindsockPivot', 'WindsockSleeve', 'BeaconHead']) expect(b.airfieldNodes).toContain(n);
  const opacity = await page.evaluate(() => window.__flareway!.aircraftOpacity());
  for (const m of opacity) {
    if (m.name.startsWith('Glass')) continue;
    expect(m.transparent, m.name).toBe(false);
    expect(m.opacity, m.name).toBe(1);
  }
});

test('tutorial opens at its heading, reaches Back by keyboard and scrolls on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 633 });
  await openTest(page);
  await page.click('#tutorial-btn');
  await expect(page.locator('#tutorial')).toBeVisible();
  await expect(page.locator('#tutorial-title')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#tutorial [data-action="close"]')).toBeFocused();
  const scroll = page.locator('#tutorial .dialog__scroll');
  const dims = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(dims.sh).toBeGreaterThan(dims.ch);
  await scroll.focus();
  await page.keyboard.press('End');
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.locator('#tutorial [data-action="close"]').click();
  await expect(page.locator('#tutorial')).toBeHidden();
  await expect(page.locator('#tutorial-btn')).toBeFocused();
});

test('tutorial layout at 1600x900 keeps the dialog within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openTest(page);
  await page.click('#tutorial-btn');
  const box = await page.locator('#tutorial .dialog').boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
});

test('landing starts directly on final with no mandatory tutorial', async ({ page }) => {
  await openTest(page);
  await page.fill('#code-input', 'BRZ-00K1X');
  await page.click('#start-btn');
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#tutorial')).toBeHidden();
  const s = await page.evaluate(() => window.__flareway!.state()!);
  expect(s.aglFt).toBeGreaterThan(400);
  expect(s.aglFt).toBeLessThan(620);
  expect(s.kias).toBeGreaterThan(58);
  await expect(page.locator('#hud-code')).toHaveText('BRZ-00K1X');
});

test('deterministic assisted soft landing completes and scores', async ({ page }) => {
  await openTest(page);
  const r = await finishAttempt(page, 'landing', 'CLM-00042', 'soft');
  expect(r.failure).toBeNull();
  expect(['Butter', 'Smooth']).toContain(r.label);
  expect(r.total).toBeGreaterThan(750);
  await expect(page.locator('#results-label')).toHaveText(r.label);
  await expect(page.locator('#res-breakdown .bar')).toHaveCount(5);
  await expect(page.locator('#res-plot polyline')).toHaveCount(1);
  // Retry is immediate and does not wait for the replay.
  await page.keyboard.press('KeyR');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
});

test('hard landing shows the correct consequence', async ({ page }) => {
  await openTest(page);
  const r = await finishAttempt(page, 'landing', 'CLM-00042', 'hard');
  expect(['Hard landing', 'Bounce', 'Gear collapse']).toContain(r.label);
  const crash = await finishAttempt(page, 'landing', 'CLM-00042', 'crash');
  expect(crash.label).toBe('Gear collapse');
  expect(crash.grade).toBe('F');
  await expect(page.locator('#res-grade')).toHaveText('F');
});

test('runway excursion fails the attempt', async ({ page }) => {
  await openTest(page);
  const r = await finishAttempt(page, 'landing', 'CLM-00042', 'excursion');
  expect(r.failure).toBe('runway-excursion');
  await expect(page.locator('#results-label')).toHaveText('Runway excursion');
});

test('go-around resets safely to final with the same conditions', async ({ page }) => {
  await openTest(page);
  const start = await page.evaluate(() => {
    const f = window.__flareway!;
    f.start('landing', 'GST-00ZZ1', 'soft');
    return f.state()!.pos;
  });
  await page.evaluate(() => window.__flareway!.fastForward(25));
  await page.keyboard.press('KeyT');
  await expect.poll(() => page.evaluate(() => window.__flareway!.state()!.goArounds), { timeout: 10_000 }).toBe(1);
  const s = await page.evaluate(() => ({ st: window.__flareway!.state()!, screen: window.__flareway!.screen() }));
  expect(s.screen).toBe('playing');
  expect(Math.abs(s.st.pos[0]! - start[0]!)).toBeLessThan(60);
  expect(s.st.aglFt).toBeGreaterThan(400);
  await expect(page.locator('#hud-code')).toHaveText('GST-00ZZ1');
});

test('takeoff accelerates, rotates and lifts off', async ({ page }) => {
  await openTest(page);
  await page.evaluate(() => {
    const f = window.__flareway!;
    f.start('takeoff', 'BRZ-00T4K', 'takeoff');
    f.fastForward(6);
  });
  const mid = await page.evaluate(() => window.__flareway!.state()!);
  expect(mid.onGround).toBe(true);
  expect(mid.kias).toBeGreaterThan(15);
  await page.evaluate(() => window.__flareway!.fastForward(120));
  await expect(page.locator('#results')).toBeVisible();
  const r = await page.evaluate(() => window.__flareway!.result()!);
  expect(r.failure).toBeNull();
  expect(r.takeoff!.rotateKias).toBeGreaterThan(48);
  expect(r.takeoff!.liftoffKias).toBeGreaterThan(50);
});

test('control-surface nodes animate from player input', async ({ page }) => {
  await openTest(page);
  await page.click('#start-btn');
  await expect(page.locator('#hud')).toBeVisible();
  const rest = await page.evaluate(() => window.__flareway!.surfaces());
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(900);
  const active = await page.evaluate(() => window.__flareway!.surfaces());
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowDown');
  await page.keyboard.up('KeyE');
  // Right roll: right aileron up (negative), left aileron down (positive).
  expect(active['Aileron_R']!).toBeLessThan(rest['Aileron_R']! - 0.05);
  expect(active['Aileron_L']!).toBeGreaterThan(rest['Aileron_L']! + 0.05);
  // Nose up (aviation Down arrow) raises the elevator trailing edge.
  expect(active['Elevator']!).toBeLessThan(rest['Elevator']! - 0.05);
  expect(active['Rudder']!).toBeGreaterThan(rest['Rudder']! + 0.05);
  expect(active['Propeller']).not.toBe(rest['Propeller']);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1500);
  const flaps = await page.evaluate(() => window.__flareway!.surfaces());
  expect(flaps['Flap_L']!).toBeGreaterThan(rest['Flap_L']! + 0.05);
});

test('camera cycle hides only the fuselage in cockpit and restores it', async ({ page }) => {
  await openTest(page);
  await page.click('#start-btn');
  await expect(page.locator('#hud')).toBeVisible();
  expect(await page.evaluate(() => window.__flareway!.camera())).toBe('chase');
  expect(await page.evaluate(() => window.__flareway!.fuselageVisible())).toBe(true);
  await page.keyboard.press('KeyC');
  await expect.poll(() => page.evaluate(() => window.__flareway!.camera())).toBe('cockpit');
  await expect.poll(() => page.evaluate(() => window.__flareway!.fuselageVisible())).toBe(false);
  await page.keyboard.press('KeyC');
  await expect.poll(() => page.evaluate(() => window.__flareway!.camera())).toBe('tower');
  await expect.poll(() => page.evaluate(() => window.__flareway!.fuselageVisible())).toBe(true);
  await page.keyboard.press('KeyC');
  await expect.poll(() => page.evaluate(() => window.__flareway!.camera())).toBe('topdown');
  await page.keyboard.press('KeyC');
  await expect.poll(() => page.evaluate(() => window.__flareway!.camera())).toBe('chase');
  expect(await page.evaluate(() => window.__flareway!.fuselageVisible())).toBe(true);
});

test('PAPI and windsock react to the seeded condition', async ({ page }) => {
  await openTest(page);
  const a = await page.evaluate(() => {
    const f = window.__flareway!;
    f.start('landing', 'CHL-00AB1', null);
    return { papi: f.papi()!, sock: f.windsock() };
  });
  await page.waitForTimeout(400);
  const expectedWhites = (e: number) => [2.5, 2.8333, 3.1667, 3.5].filter((x) => e > x).length;
  expect(a.papi.white.filter(Boolean).length).toBe(expectedWhites(a.papi.elevationDeg));
  // Exactly one lens colour per box is shown and matches the simulation.
  const view = await page.evaluate(() => window.__flareway!.papi()!);
  expect(view.lensWhiteVisible).toEqual(view.white);
  const sockA = await page.evaluate(() => window.__flareway!.windsock());
  const toward = ((sockA.wind!.fromDeg + 180) * Math.PI) / 180;
  const yawErr = Math.atan2(Math.sin(sockA.pivotYaw! - (Math.PI / 2 - toward)), Math.cos(sockA.pivotYaw! - (Math.PI / 2 - toward)));
  expect(Math.abs(yawErr)).toBeLessThan(0.15);
  const b = await page.evaluate(() => {
    const f = window.__flareway!;
    f.start('landing', 'CLM-0QQQQ', null);
    return f.windsock();
  });
  await page.waitForTimeout(400);
  const sockB = await page.evaluate(() => window.__flareway!.windsock());
  expect(b.wind!.speedKt).toBeLessThan(sockA.wind!.speedKt);
  // Light wind droops the sleeve more.
  expect(sockB.pivotDroop!).toBeLessThan(sockA.pivotDroop!);
  // Pushing the nose down below the glide path turns the PAPI red.
  await page.evaluate(() => window.__flareway!.start('landing', 'CLM-0QQQQ', null));
  const before = await page.evaluate(() => window.__flareway!.papi()!.white.filter(Boolean).length);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2500);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2500);
  const low = await page.evaluate(() => window.__flareway!.papi()!);
  expect(low.white.filter(Boolean).length).toBeLessThan(before);
  expect(['slightly-low', 'too-low']).toContain(low.indication);
});

for (const [asset, pattern] of [
  ['aircraft', '**/ft172-trainer.glb'],
  ['airfield', '**/field-kit.glb'],
] as const) {
  test(`blocked ${asset} GLB falls back without breaking play`, async ({ page }) => {
    await page.route(pattern, (r) => r.abort());
    await openTest(page);
    const b = await page.evaluate(() => window.__flareway!.binding());
    if (asset === 'aircraft') expect(b.aircraftFallback).toBe(true);
    else expect(b.airfieldFallback).toBe(true);
    await page.click('#start-btn');
    await expect(page.locator('#hud')).toBeVisible();
    const s0 = await page.evaluate(() => window.__flareway!.state()!.stepCount);
    await page.waitForTimeout(800);
    const s1 = await page.evaluate(() => window.__flareway!.state()!.stepCount);
    expect(s1).toBeGreaterThan(s0);
    const r = await finishAttempt(page, 'landing', 'CLM-00042', 'soft');
    expect(r.total).toBeGreaterThan(500);
    // Only the blocked request errors are expected.
    expect((errors.get(page) ?? []).filter((e) => !/Failed to load resource|net::ERR|glb|fetch/i.test(e))).toEqual([]);
  });
}

test('vegetation is instanced and culled with runtime counters', async ({ page }) => {
  await openTest(page);
  await page.evaluate(() => {
    const f = window.__flareway!;
    f.start('landing', 'CLM-00042', 'soft');
    f.fastForward(80);
  });
  await page.waitForTimeout(600);
  const s = await page.evaluate(() => window.__flareway!.stats());
  expect(s.vegetation.total).toBeGreaterThan(300);
  expect(s.vegetation.culled).toBeGreaterThan(0);
  expect(s.vegetation.nearVisible + s.vegetation.farVisible).toBeLessThan(s.vegetation.total);
  expect(s.sceneCalls).toBeLessThanOrEqual(220);
  expect(s.sceneTriangles).toBeLessThanOrEqual(750_000);
});

test('pause, resume and retry via keyboard', async ({ page }) => {
  await openTest(page);
  await page.click('#start-btn');
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  const a = await page.evaluate(() => window.__flareway!.state()!.stepCount);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__flareway!.state()!.stepCount)).toBe(a);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__flareway!.state()!.stepCount)).toBeGreaterThan(a);
});
