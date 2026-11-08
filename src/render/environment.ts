import {
  CircleGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  PMREMGenerator,
  Scene,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { QualityPreset } from './quality';

export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface Environment {
  sky: Sky;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  /** Direction of the key light: the sun by day, a stand-in moon at night (the sky's own sun sits below the horizon). */
  sunDir: Vector3;
  sunColor: Color;
  fogColor: Color;
  skyHorizon: Color;
  skyZenith: Color;
  timeOfDay: TimeOfDay;
  /** How much the airfield lights should glow: 1 by day, more as it gets dark. */
  lightGlow: number;
  daylight: number;
  setTimeOfDay(t: TimeOfDay): void;
  update(focus: Vector3): void;
  dispose(): void;
}

interface Look {
  /** Sun elevation for the sky (degrees; negative = below the horizon). */
  skySunElevation: number;
  /** Elevation of the light that actually lights the scene. */
  lightElevation: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envIntensity: number;
  fog: string;
  fogDensity: number;
  horizon: string;
  zenith: string;
  lightGlow: number;
  /** Scales unlit surface colours (the water body) that the light rig does not reach. */
  daylight: number;
}

const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    skySunElevation: 38, lightElevation: 38, turbidity: 2.4, rayleigh: 1.1, mie: 0.0035,
    sunColor: '#fff3df', sunIntensity: 5.2, hemiSky: '#bfd9f2', hemiGround: '#5a6a3a', hemiIntensity: 0.35,
    envIntensity: 1.4, fog: '#c3d3df', fogDensity: 0.00007, horizon: '#c9dcea', zenith: '#5b8fcf', lightGlow: 1, daylight: 1,
  },
  dusk: {
    // Sun a few degrees up: long shadows, amber light, the runway lights already reading against the ground.
    skySunElevation: 4, lightElevation: 6, turbidity: 6, rayleigh: 2.2, mie: 0.012,
    sunColor: '#ffb473', sunIntensity: 3.2, hemiSky: '#7f8fb8', hemiGround: '#3c3a30', hemiIntensity: 0.38,
    envIntensity: 0.9, fog: '#b58e86', fogDensity: 0.00012, horizon: '#e0a888', zenith: '#3c5a94', lightGlow: 1.9, daylight: 0.55,
  },
  night: {
    // Sky sun below the horizon keeps a faint glow; a cool moon from the opposite side lights the scene.
    skySunElevation: 1.2, lightElevation: 28, turbidity: 9, rayleigh: 0.35, mie: 0.002,
    sunColor: '#9fb4d8', sunIntensity: 0.9, hemiSky: '#2a3752', hemiGround: '#141614', hemiIntensity: 0.3,
    envIntensity: 0.35, fog: '#1b2433', fogDensity: 0.00016, horizon: '#2b3a55', zenith: '#070b16', lightGlow: 2.8, daylight: 0.14,
  },
};

/** Caps sky radiance below the bloom threshold so only lights bloom, and keeps the glare around the sun readable. */
const capSkyLuminance = (sky: Sky): void => {
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    'float skyL = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );\n\t\t\ttexColor *= skyL > 2.6 ? 2.6 / skyL : 1.0;\n\t\t\tgl_FragColor = vec4( texColor, 1.0 );',
  );
};
// Three.js spherical theta: 0 = +Z (south), 90 = +X (east). 335 = south-southwest.
const SUN_AZIMUTH = 335;

const dirFor = (elevation: number): Vector3 =>
  new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(90 - elevation), MathUtils.degToRad(SUN_AZIMUTH));

/** Preetham sky, PMREM environment, one coherent key light with a tight shadow frustum; day, dusk or night. */
export const createEnvironment = (renderer: WebGLRenderer, scene: Scene, q: QualityPreset, initial: TimeOfDay = 'day'): Environment => {
  const sunDir = new Vector3();
  const skySunDir = new Vector3();

  const sky = new Sky();
  capSkyLuminance(sky);
  sky.scale.setScalar(18000);
  const u = sky.material.uniforms;
  u['mieDirectionalG']!.value = 0.8;
  sky.frustumCulled = false;
  scene.add(sky);

  // Environment map from a small copy of the same sky, rebuilt whenever the time of day changes.
  const envScene = new Scene();
  const envSky = new Sky();
  capSkyLuminance(envSky);
  envSky.scale.setScalar(100);
  const eu = envSky.material.uniforms;
  envScene.add(envSky);
  // The Preetham sky is bright below the horizon; a dark sea-coloured lower hemisphere keeps undersides and
  // cabin interiors from being lit as if the ocean were a bright sky.
  const seaGeo = new CircleGeometry(400, 32);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new Mesh(seaGeo, new MeshBasicMaterial({ color: new Color(0.018, 0.05, 0.065) }));
  sea.position.y = -2;
  envScene.add(sea);
  let envRT: ReturnType<PMREMGenerator['fromScene']> | null = null;
  const bakeEnvironment = () => {
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) eu[k]!.value = u[k]!.value;
    eu['sunPosition']!.value.copy(skySunDir);
    const pmrem = new PMREMGenerator(renderer);
    const next = pmrem.fromScene(envScene, 0, 0.1, 1000);
    pmrem.dispose();
    envRT?.dispose();
    envRT = next;
    scene.environment = next.texture;
  };

  const fogColor = new Color();
  scene.fog = new FogExp2(0xffffff, 0.00007);

  const sun = new DirectionalLight(new Color('#fff3df'), 5.2);
  sun.castShadow = q.shadowMapSize > 0;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -18;
    cam.right = 18;
    cam.top = 18;
    cam.bottom = -18;
    cam.near = 1;
    cam.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2.5;
  }
  scene.add(sun, sun.target);

  const hemi = new HemisphereLight(new Color('#bfd9f2'), new Color('#5a6a3a'), 0.35);
  scene.add(hemi);

  const env: Environment = {
    sky,
    sun,
    hemi,
    sunDir,
    sunColor: new Color('#fff3df'),
    fogColor,
    skyHorizon: new Color('#c9dcea'),
    skyZenith: new Color('#5b8fcf'),
    timeOfDay: initial,
    lightGlow: 1,
    daylight: 1,
    setTimeOfDay(t: TimeOfDay) {
      const look = LOOKS[t];
      env.timeOfDay = t;
      skySunDir.copy(dirFor(look.skySunElevation));
      sunDir.copy(dirFor(look.lightElevation));
      u['turbidity']!.value = look.turbidity;
      u['rayleigh']!.value = look.rayleigh;
      u['mieCoefficient']!.value = look.mie;
      u['sunPosition']!.value.copy(skySunDir);
      sun.color.set(look.sunColor);
      sun.intensity = look.sunIntensity;
      env.sunColor.set(look.sunColor);
      hemi.color.set(look.hemiSky);
      hemi.groundColor.set(look.hemiGround);
      hemi.intensity = look.hemiIntensity;
      scene.environmentIntensity = look.envIntensity;
      fogColor.set(look.fog);
      const fog = scene.fog as FogExp2;
      fog.color.copy(fogColor);
      fog.density = look.fogDensity;
      env.skyHorizon.set(look.horizon);
      env.skyZenith.set(look.zenith);
      env.lightGlow = look.lightGlow;
      env.daylight = look.daylight;
      bakeEnvironment();
    },
    update(focus: Vector3) {
      // Tight, texel-snapped shadow frustum that follows the aircraft/runway focus.
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, 120);
      sun.target.updateMatrixWorld();
    },
    dispose() {
      envRT?.dispose();
      seaGeo.dispose();
      envSky.geometry.dispose();
      envSky.material.dispose();
    },
  };
  env.setTimeOfDay(initial);
  return env;
};
