import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type IUniform,
} from 'three';

/** Shared GLSL: the island shoreline radius, mirrored from the Blender generator. */
const ISLAND_GLSL = /* glsl */ `
float islandR(vec2 xzB) {
  float a = atan(xzB.y / 260.0, xzB.x / 590.0);
  float irr = 1.0 + 0.045 * sin(a * 5.0 + 0.8) + 0.025 * sin(a * 11.0);
  float yIrr = 1.0 + 0.035 * cos(a * 7.0);
  return length(vec2(xzB.x / (590.0 * irr), xzB.y / (260.0 * irr * yIrr)));
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
`;

export interface OceanUniforms {
  [key: string]: IUniform;
  uTime: IUniform<number>;
  uSunDir: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  uDeep: IUniform<Color>;
  uShallow: IUniform<Color>;
  uSkyHorizon: IUniform<Color>;
  uSkyZenith: IUniform<Color>;
}

/**
 * Bounded WebGL2 ocean: two scrolling procedural normal scales, Fresnel sky reflection, analytic shore depth
 * colour, sun glint and a shoreline foam band. One draw call, no reflection render target.
 */
export const createOceanMaterial = (): ShaderMaterial & { uniforms: OceanUniforms } => {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new Color(1.0, 0.95, 0.85) },
      uDeep: { value: new Color('#0b3a5c') },
      uShallow: { value: new Color('#2aa6a8') },
      uSkyHorizon: { value: new Color('#bcd6ea') },
      uSkyZenith: { value: new Color('#4f86c6') },
    },
  ]) as OceanUniforms;
  const mat = new ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSkyZenith;
      varying vec3 vWorld;
      ${ISLAND_GLSL}
      vec2 waveGrad(vec2 p, float t) {
        // Sum of directional sines: analytic gradient, cheap and tile-free.
        vec2 g = vec2(0.0);
        vec2 d1 = normalize(vec2(1.0, 0.35)); float w1 = 0.055; float a1 = 0.6;
        vec2 d2 = normalize(vec2(-0.6, 1.0)); float w2 = 0.083; float a2 = 0.45;
        vec2 d3 = normalize(vec2(0.2, -1.0)); float w3 = 0.21; float a3 = 0.18;
        vec2 d4 = normalize(vec2(-1.0, -0.4)); float w4 = 0.37; float a4 = 0.1;
        g += d1 * cos(dot(d1, p) * w1 + t * 0.9) * w1 * a1;
        g += d2 * cos(dot(d2, p) * w2 + t * 1.1) * w2 * a2;
        g += d3 * cos(dot(d3, p) * w3 + t * 1.7) * w3 * a3;
        g += d4 * cos(dot(d4, p) * w4 + t * 2.3) * w4 * a4;
        return g;
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        // Two scrolling scales, faded with distance to avoid shimmer.
        float detailFade = 1.0 - smoothstep(600.0, 5000.0, dist);
        vec2 g = waveGrad(vWorld.xz, uTime) * (0.22 + 0.78 * detailFade);
        vec2 p2 = vWorld.xz * 0.9 + vec2(uTime * 1.3, uTime * 0.7);
        vec2 g2 = vec2(vnoise(p2) - vnoise(p2 + vec2(0.5, 0.0)), vnoise(p2) - vnoise(p2 + vec2(0.0, 0.5))) * 0.35 * detailFade;
        vec3 N = normalize(vec3(-(g.x + g2.x), 1.0, -(g.y + g2.y)));

        vec2 xzB = vec2(vWorld.x, -vWorld.z);
        float r = islandR(xzB);
        float shore = 1.0 - smoothstep(1.0, 1.45, r);
        float lagoon = 1.0 - smoothstep(1.0, 1.12, r);
        vec3 water = mix(uDeep, uShallow, shore * 0.85);
        water = mix(water, uShallow * 1.15, lagoon * 0.5) * 1.9;

        float cosT = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.6)) * 1.25;
        vec3 col = mix(water, sky, fresnel * 0.85);

        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 420.0) * 6.0 * detailFade + pow(max(dot(N, H), 0.0), 60.0) * 0.06;
        col += uSunColor * spec;

        // Shoreline foam band with animated breakup.
        float band = smoothstep(1.035, 1.0, r) * smoothstep(0.985, 1.0, r);
        float foamNoise = fbm(xzB * 0.08 + vec2(uTime * 0.15, -uTime * 0.1));
        float foamPulse = 0.5 + 0.5 * sin(r * 900.0 - uTime * 1.6);
        float foam = band * smoothstep(0.35, 0.75, foamNoise + foamPulse * 0.35);
        col = mix(col, vec3(0.93, 0.96, 0.97), clamp(foam, 0.0, 0.85));

        // Unlit colours are authored in display range; lift them to match the lit scene at the scene exposure.
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  return mat as ShaderMaterial & { uniforms: OceanUniforms };
};

/** Terrain blending sand, grass and rock by height/slope masks with procedural grass colour variation. */
export const createTerrainMaterial = (): MeshStandardMaterial => {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrWorld;\nvarying vec3 vTerrNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTerrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTerrWorld;\nvarying vec3 vTerrNormal;\n${ISLAND_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec2 xzB = vec2(vTerrWorld.x, -vTerrWorld.z);
          float r = islandR(xzB);
          float h = vTerrWorld.y;
          float slope = 1.0 - clamp(vTerrNormal.y, 0.0, 1.0);
          float n = fbm(xzB * 0.035);
          float n2 = fbm(xzB * 0.21 + 3.0);
          // Linear-space albedos.
          vec3 grassA = vec3(0.038, 0.085, 0.018);
          vec3 grassB = vec3(0.07, 0.12, 0.028);
          vec3 dry = vec3(0.15, 0.14, 0.06);
          vec3 grass = mix(grassA, grassB, n);
          grass = mix(grass, dry, smoothstep(0.62, 0.8, n2) * 0.45);
          // Mown strip beside the runway reads lighter and more uniform.
          float strip = 1.0 - smoothstep(34.0, 52.0, abs(vTerrWorld.z));
          grass = mix(grass, vec3(0.06, 0.115, 0.03) * (0.9 + 0.15 * n2), strip * step(abs(vTerrWorld.x), 470.0) * 0.7);
          vec3 sand = vec3(0.5, 0.41, 0.26) * (0.9 + 0.15 * n2);
          vec3 rock = vec3(0.12, 0.105, 0.09) * (0.8 + 0.3 * n);
          float sandMask = smoothstep(0.86, 0.95, r + (n - 0.5) * 0.04) + (1.0 - smoothstep(-1.1, -0.2, h));
          float rockMask = smoothstep(0.32, 0.55, slope + (n2 - 0.5) * 0.15) * smoothstep(2.5, 6.0, h);
          vec3 col = mix(grass, sand, clamp(sandMask, 0.0, 1.0));
          col = mix(col, rock, clamp(rockMask, 0.0, 1.0));
          diffuseColor.rgb = col;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'flareway-terrain-v1';
  return mat;
};

/** Runway asphalt with subtle wear, patching and tire marks in both touchdown zones. */
export const patchRunwayMaterial = (mat: MeshStandardMaterial): void => {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRwWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRwWorld;\n${ISLAND_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec2 p = vRwWorld.xz;
          float n = fbm(p * vec2(0.08, 0.3));
          float grit = vnoise(p * 3.1);
          vec3 c = diffuseColor.rgb * (0.86 + 0.22 * n + 0.08 * grit);
          // Tire marks: streaks along X, concentrated in the touchdown zones of both ends.
          float ax = abs(p.x);
          float zone = smoothstep(420.0, 360.0, ax) * smoothstep(160.0, 250.0, ax);
          float lane = exp(-pow((abs(p.y) - 1.1) / 1.4, 2.0));
          float streak = smoothstep(0.55, 0.8, vnoise(vec2(p.x * 0.02, p.y * 2.6)));
          c *= 1.0 - zone * lane * (0.22 + 0.35 * streak);
          diffuseColor.rgb = c;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'flareway-runway-v1';
};

export interface GlowPoints {
  geometry: BufferGeometry;
  material: ShaderMaterial;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
}

/**
 * Screen-space light glows (runway, PAPI, approach and beacon lights) as one Points draw.
 * Size is world-space but never smaller than a minimum pixel footprint, so lights stay readable on final.
 */
export const createGlowPoints = (count: number): GlowPoints => {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('size', new BufferAttribute(sizes, 1));
  const material = new ShaderMaterial({
    uniforms: { uScale: { value: 800 }, uMinPx: { value: 2.5 }, uMaxPx: { value: 26 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size;
      attribute vec3 color;
      uniform float uScale;
      uniform float uMinPx;
      uniform float uMaxPx;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = max(-mv.z, 0.1);
        float px = size * uScale / d;
        gl_PointSize = clamp(px, uMinPx, uMaxPx) * step(0.001, size);
        vFade = clamp(px / uMinPx, 0.35, 1.0) * (1.0 - smoothstep(4000.0, 9000.0, d));
        vColor = color;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vColor;
      varying float vFade;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        float core = smoothstep(0.55, 0.0, r);
        float halo = smoothstep(1.0, 0.0, r) * 0.35;
        float a = (core + halo) * vFade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a * 6.0, a);
        #include <colorspace_fragment>
      }
    `,
  });
  return { geometry, material, positions, colors, sizes };
};
