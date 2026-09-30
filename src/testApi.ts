import type { App } from './app';
import type { GameMode } from './sim/flow';
import type { AutopilotProfile } from './sim/autopilot';
import { FT, FPM, KT, GEAR } from './sim/constants';
import { headingDeg } from './sim/physics';
import { papiIndication } from './sim/papi';
import { windReadout } from './sim/wind';

/**
 * Deterministic automation surface for Playwright. Installed only when the page is opened with ?test=1,
 * and loaded as a separate chunk so the normal build never exposes it.
 */
export const installTestApi = (app: App): void => {
  const api = {
    ready: true,
    screen: () => app.flow.screen,
    start: (mode: GameMode, code: string, autopilot: AutopilotProfile | null = null, timeScale = 1) => {
      app.setAutopilot(autopilot);
      app.timeScale = timeScale;
      app.start(mode, code);
      return app.session!.conditions;
    },
    setAutopilot: (p: AutopilotProfile | null) => app.setAutopilot(p),
    setTimeScale: (n: number) => {
      app.timeScale = n;
    },
    goAround: () => app.goAround(),
    retry: () => app.retry(),
    cycleCamera: () => {
      app.cycleCamera();
      return app.cameraMode;
    },
    camera: () => app.cameraMode,
    /** Fixed QA camera. With follow=true, pos/target are offsets from the aircraft. */
    qaCamera: (pos: [number, number, number], target: [number, number, number], fov = 50, follow = false) => {
      const f = app.world.rig.free;
      f.pos.fromArray(pos);
      f.target.fromArray(target);
      f.fov = fov;
      f.followAircraft = follow;
      app.cameraMode = 'free';
      app.world.setCamera('free');
    },
    setCamera: (mode: 'chase' | 'cockpit' | 'tower' | 'topdown' | 'orbit') => {
      app.cameraMode = mode;
      app.world.setCamera(mode);
    },
    setSetting: (key: string, value: unknown) => {
      (app as unknown as { applySettings: (s: unknown) => void }).applySettings({ ...app.settings, [key]: value });
    },
    pause: (p: boolean) => {
      app.timeScale = p ? 0 : 1;
    },
    state: () => {
      const s = app.session?.state;
      if (!s) return null;
      return {
        time: s.time,
        pos: s.pos.toArray(),
        kias: s.ias / KT,
        aglFt: s.agl / FT,
        vsFpm: s.vs / FPM,
        heading: headingDeg(s.quat),
        onGround: s.onGround,
        gear: s.gear.map((g) => ({ name: g.name, inContact: g.inContact, surface: g.surface })),
        throttle: s.throttle,
        flapIndex: s.flapIndex,
        stepCount: app.session!.stepCount,
        goArounds: app.session!.goArounds,
        runway: app.session!.runway.id,
      };
    },
    result: () => {
      const r = app.lastResult;
      if (!r) return null;
      return { label: r.score.label, total: r.score.total, grade: r.score.grade, failure: r.failure, touchdown: r.touchdown, takeoff: r.takeoff };
    },
    binding: () => {
      const a = app.world.aircraft;
      const f = app.world.airfield;
      return {
        aircraftFallback: a.isFallback,
        airfieldFallback: f.isFallback,
        missing: a.missing,
        airfieldNodes: f.boundNodes,
        anchors: a.anchorReport,
        expectedAnchors: Object.fromEntries(GEAR.map((g) => [g.name, [...g.offset]])),
        hingeCorrections: a.hingeCorrections,
        loadErrors: app.world.loadErrors,
      };
    },
    surfaces: () => app.world.aircraft.surfaceRotations(),
    fuselageVisible: () => app.world.aircraft.fuselageVisible,
    aircraftOpacity: () => {
      const out: { name: string; transparent: boolean; opacity: number }[] = [];
      app.world.aircraft.root.traverse((o) => {
        const m = (o as unknown as { material?: { name: string; transparent: boolean; opacity: number } }).material;
        if (m && !out.some((x) => x.name === m.name)) out.push({ name: m.name, transparent: m.transparent, opacity: m.opacity });
      });
      return out;
    },
    papi: () => {
      const s = app.session;
      if (!s) return null;
      const view = app.world.airfield.papis[s.runway.id];
      return {
        white: [...s.papi.white],
        indication: papiIndication(s.papi),
        elevationDeg: s.papi.elevationDeg,
        lensWhiteVisible: view.white.map((m) => m.visible),
      };
    },
    windsock: () => {
      const s = app.session;
      const w = s ? windReadout(s.wind, s.state.time, { fromDeg: 0, speedKt: 0, gust: 0 }) : null;
      const pivot = app.world.airfield.windsockPivot;
      return { wind: w, pivotYaw: pivot?.rotation.y ?? null, pivotDroop: pivot?.rotation.z ?? null };
    },
    stats: () => ({ ...app.world.stats, vegetation: { ...app.world.stats.vegetation } }),
    /** Fly the remaining attempt synchronously (bypasses rendering) for fast deterministic checks. */
    fastForward: (seconds: number) => {
      const session = app.session;
      if (!session) return;
      const steps = Math.round(seconds * 120);
      for (let i = 0; i < steps && !session.ended; i++) (app as unknown as { simStep: () => void }).simStep();
    },
  };
  (window as unknown as { __flareway: typeof api }).__flareway = api;
};
