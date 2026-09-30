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

export interface Environment {
  sky: Sky;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  sunDir: Vector3;
  fogColor: Color;
  skyHorizon: Color;
  skyZenith: Color;
  update(focus: Vector3): void;
  dispose(): void;
}

const SUN_ELEVATION = 38;

/** Caps sky radiance below the bloom threshold so only lights bloom, and keeps the glare around the sun readable. */
const capSkyLuminance = (sky: Sky): void => {
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    'float skyL = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );\n\t\t\ttexColor *= skyL > 2.6 ? 2.6 / skyL : 1.0;\n\t\t\tgl_FragColor = vec4( texColor, 1.0 );',
  );
};
// Three.js spherical theta: 0 = +Z (south), 90 = +X (east). 335 = south-southwest.
const SUN_AZIMUTH = 335;

/** Bright daytime lighting: Preetham sky, PMREM environment, one coherent sun with a tight shadow frustum. */
export const createEnvironment = (renderer: WebGLRenderer, scene: Scene, q: QualityPreset): Environment => {
  const sunDir = new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(90 - SUN_ELEVATION), MathUtils.degToRad(SUN_AZIMUTH));

  const sky = new Sky();
  capSkyLuminance(sky);
  sky.scale.setScalar(18000);
  const u = sky.material.uniforms;
  u['turbidity']!.value = 2.4;
  u['rayleigh']!.value = 1.1;
  u['mieCoefficient']!.value = 0.0035;
  u['mieDirectionalG']!.value = 0.8;
  u['sunPosition']!.value.copy(sunDir);
  sky.frustumCulled = false;
  scene.add(sky);

  // Environment map from a small copy of the same sky.
  const envScene = new Scene();
  const envSky = new Sky();
  capSkyLuminance(envSky);
  envSky.scale.setScalar(100);
  const eu = envSky.material.uniforms;
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) eu[k]!.value = u[k]!.value;
  eu['sunPosition']!.value.copy(sunDir);
  envScene.add(envSky);
  // The Preetham sky is bright below the horizon; a dark sea-coloured lower hemisphere keeps undersides and
  // cabin interiors from being lit as if the ocean were a bright sky.
  const seaGeo = new CircleGeometry(400, 32);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new Mesh(seaGeo, new MeshBasicMaterial({ color: new Color(0.018, 0.05, 0.065) }));
  sea.position.y = -2;
  envScene.add(sea);
  const pmrem = new PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.4;
  pmrem.dispose();
  seaGeo.dispose();
  envSky.geometry.dispose();
  envSky.material.dispose();

  const fogColor = new Color('#c3d3df');
  scene.fog = new FogExp2(fogColor.getHex(), 0.00007);

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

  return {
    sky,
    sun,
    hemi,
    sunDir,
    fogColor,
    skyHorizon: new Color('#c9dcea'),
    skyZenith: new Color('#5b8fcf'),
    update(focus: Vector3) {
      // Tight, texel-snapped shadow frustum that follows the aircraft/runway focus.
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, 120);
      sun.target.updateMatrixWorld();
    },
    dispose() {
      envRT.dispose();
    },
  };
};
