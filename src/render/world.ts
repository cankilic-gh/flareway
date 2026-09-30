import {
  Group,
  HalfFloatType,
  FloatType,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  PCFShadowMap,
  type Camera,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { createEnvironment, type Environment } from './environment';
import { sampleGround, type GroundSample } from '../sim/airfield';
import { AirfieldView } from './airfieldView';
import { AircraftView, type AircraftPose } from './aircraftView';
import { buildFallbackAircraft, buildFallbackAirfield } from './fallback';
import { CameraRig, type CameraMode } from './cameras';
import { ContactEffects, Shake } from './effects';
import { QUALITY, type QualityId, type QualityPreset } from './quality';
import type { RunwayId } from '../sim/airfield';
import type { WindReadout } from '../sim/wind';

export const AIRCRAFT_URL = 'assets/aircraft/ft172-trainer.glb';
export const AIRFIELD_URL = 'assets/airport/field-kit.glb';

export interface RenderStats {
  calls: number;
  triangles: number;
  sceneCalls: number;
  sceneTriangles: number;
  vegetation: AirfieldView['vegetationStats'];
  fps: number;
  pixelRatio: number;
}

export interface FrameInput {
  pose: AircraftPose;
  vel: Vector3;
  wind: Vector3;
  windReadout: WindReadout;
  runway: RunwayId;
  papiWhite: readonly boolean[];
  papiVisible: boolean;
  time: number;
  dt: number;
  buffet: number;
  rumble: number;
  guidance: boolean;
  reducedMotion: boolean;
  dof: boolean;
}

/** Captures scene-pass-only counters so post-processing quads are reported separately. */
class CountingRenderPass extends RenderPass {
  sceneCalls = 0;
  sceneTriangles = 0;
  override render(...args: Parameters<RenderPass['render']>): void {
    const r = args[0];
    const c0 = r.info.render.calls;
    const t0 = r.info.render.triangles;
    super.render(...args);
    this.sceneCalls = r.info.render.calls - c0;
    this.sceneTriangles = r.info.render.triangles - t0;
  }
}

const loadGlb = (url: string): Promise<Group> =>
  new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        const root = gltf.scene.children.length === 1 ? (gltf.scene.children[0] as Group) : gltf.scene;
        resolve(root);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });

export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig: CameraRig;
  readonly effects = new ContactEffects();
  readonly shake = new Shake();
  env!: Environment;
  airfield!: AirfieldView;
  aircraft!: AircraftView;
  quality: QualityPreset;
  loadErrors: string[] = [];
  private composer: EffectComposer | null = null;
  private renderPass: CountingRenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private bokeh: BokehPass | null = null;
  private contactBlob: Mesh | null = null;
  private readonly groundSample: GroundSample = { height: 0, surface: 'runway' };
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  readonly stats: RenderStats = {
    calls: 0,
    triangles: 0,
    sceneCalls: 0,
    sceneTriangles: 0,
    vegetation: { total: 0, nearVisible: 0, farVisible: 0, culled: 0, nearTriangles: 0, farTriangles: 0 },
    fps: 0,
    pixelRatio: 1,
  };

  private constructor(canvas: HTMLCanvasElement, q: QualityPreset) {
    this.quality = q;
    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      stencil: false,
    } as ConstructorParameters<typeof WebGLRenderer>[0]);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.5;
    renderer.shadowMap.enabled = q.shadowMapSize > 0;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
  }

  /** Throws if WebGL 2 is unavailable. Asset failures fall back to procedural geometry and are reported. */
  static async create(canvas: HTMLCanvasElement, quality: QualityId): Promise<World> {
    const world = new World(canvas, QUALITY[quality]);
    if (!world.renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required');
    world.env = createEnvironment(world.renderer, world.scene, world.quality);
    const [fieldRes, craftRes] = await Promise.allSettled([loadGlb(AIRFIELD_URL), world.quality.fallbackAircraft ? Promise.reject(new Error('low quality uses fallback')) : loadGlb(AIRCRAFT_URL)]);
    let fieldRoot: Group;
    if (fieldRes.status === 'fulfilled') fieldRoot = fieldRes.value;
    else {
      world.loadErrors.push(`airfield: ${String(fieldRes.reason?.message ?? fieldRes.reason)}`);
      fieldRoot = buildFallbackAirfield();
    }
    let craftRoot: Group;
    if (craftRes.status === 'fulfilled') craftRoot = craftRes.value;
    else {
      world.loadErrors.push(`aircraft: ${String(craftRes.reason?.message ?? craftRes.reason)}`);
      craftRoot = buildFallbackAircraft();
    }
    world.airfield = new AirfieldView(fieldRoot, world.quality);
    let aircraft = new AircraftView(craftRoot);
    if (!aircraft.ok) {
      world.loadErrors.push(`aircraft nodes missing: ${aircraft.missing.join(', ')}`);
      aircraft = new AircraftView(buildFallbackAircraft());
    }
    world.aircraft = aircraft;
    world.scene.add(world.airfield.root, world.aircraft.root, world.effects.points);
    world.contactBlob = createContactBlob();
    world.scene.add(world.contactBlob);
    world.setupComposer();
    world.resize();
    return world;
  }

  private setupComposer(): void {
    const q = this.quality;
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: q.msaaSamples });
    const composer = new EffectComposer(this.renderer, target);
    this.renderPass = new CountingRenderPass(this.scene, this.rig.camera);
    composer.addPass(this.renderPass);
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.28, 0.3, 4.5);
      composer.addPass(this.bloom);
    }
    this.bokeh = new BokehPass(this.scene, this.rig.camera, { focus: 30, aperture: 0.00005, maxblur: 0.0035 });
    // Full-float depth: the default half-float target quantizes depth near the far plane and blurs the aircraft.
    const depthRT = (this.bokeh as unknown as { _renderTargetDepth?: WebGLRenderTarget })._renderTargetDepth;
    if (depthRT) depthRT.texture.type = FloatType;
    this.bokeh.enabled = false;
    composer.addPass(this.bokeh);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.stats.pixelRatio = pr;
  }

  setCamera(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  setRunway(id: RunwayId): void {
    this.airfield.setRunway(id);
  }

  render(f: FrameInput): void {
    const r = this.renderer;
    r.info.reset();
    const shake = this.shake.update(f.dt, f.buffet, f.rumble, f.reducedMotion);
    this.aircraft.apply(f.pose);
    this.rig.update(f.dt, f.pose.pos, f.pose.quat, f.runway, shake);
    const cam = this.rig.camera;
    // Cockpit view hides only the closed exterior Fuselage shell, restored for every other view.
    this.aircraft.setFuselageVisible(this.rig.mode !== 'cockpit');
    const focus = this.rig.mode === 'orbit' ? _origin : f.pose.pos;
    this.env.update(focus);
    this.env.sky.position.copy(cam.position);
    this.airfield.updateWindsock(f.windReadout, f.time);
    this.airfield.setPapi(f.runway, f.papiWhite, f.papiVisible);
    this.airfield.update(f.time, cam, f.guidance && this.rig.mode !== 'orbit', true);
    const drawH = r.getDrawingBufferSize(_size).y;
    const scale = drawH / (2 * Math.tan((cam.fov * Math.PI) / 360));
    (this.airfield.glow.material.uniforms['uScale'] as { value: number }).value = scale;
    this.effects.scaleUniform.value = scale;
    this.effects.update(f.dt, f.wind);
    if (this.contactBlob) {
      // Soft ambient-occlusion blob that grounds the aircraft near the surface.
      const g = sampleGround(f.pose.pos.x, f.pose.pos.z, this.groundSample);
      const h = f.pose.pos.y - g.height - 1.08;
      const blob = this.contactBlob;
      blob.visible = g.surface !== 'water' && h < 14;
      blob.position.set(f.pose.pos.x, g.height + 0.09, f.pose.pos.z);
      blob.rotation.set(-Math.PI / 2, 0, Math.atan2(-_fwd.set(1, 0, 0).applyQuaternion(f.pose.quat).z, _fwd.x));
      (blob.material as MeshBasicMaterial).opacity = 0.42 * Math.max(0, 1 - h / 14);
    }
    const o = this.airfield.oceanUniforms;
    o.uSunDir.value.copy(this.env.sunDir);
    o.uSkyHorizon.value.copy(this.env.skyHorizon);
    o.uSkyZenith.value.copy(this.env.skyZenith);
    if (this.bokeh) {
      this.bokeh.enabled = f.dof && !f.reducedMotion;
      if (this.bokeh.enabled) {
        const u = this.bokeh.uniforms as Record<string, { value: number }>;
        u['focus']!.value = cam.position.distanceTo(f.pose.pos);
      }
    }
    if (this.composer) this.composer.render(f.dt);
    else r.render(this.scene, cam);
    this.stats.calls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
    this.stats.sceneCalls = this.renderPass?.sceneCalls ?? r.info.render.calls;
    this.stats.sceneTriangles = this.renderPass?.sceneTriangles ?? r.info.render.triangles;
    this.stats.vegetation = this.airfield.vegetationStats;
    this.fpsAcc += f.dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.stats.fps = this.fps;
  }

  /** Test-only: renders `frames` frames back to back with gl.finish() and returns the mean ms per frame. */
  benchmark(frames: number, f: FrameInput): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    // readPixels stalls until the GPU has finished, unlike finish() on some ANGLE backends.
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    sync();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.render({ ...f, dt: 1 / 120 });
      sync();
    }
    return (performance.now() - t0) / frames;
  }

  get camera(): Camera {
    return this.rig.camera;
  }
}

const _origin = new Vector3();
const _fwd = new Vector3();

const createContactBlob = (): Mesh => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 32, 2, 64, 32, 62);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  const mat = new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.4, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const mesh = new Mesh(new PlaneGeometry(9, 5.5), mat);
  mesh.renderOrder = 2;
  mesh.name = 'ContactShadow';
  return mesh;
};
const _size = new Vector2();
