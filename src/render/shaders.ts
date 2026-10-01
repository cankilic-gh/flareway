import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  MeshStandardMaterial,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';

/**
 * Baked tileable cellular edge distance (8 x 8 cells per tile): r = (F2 - F1) / 0.6. Sampling it replaces a
 * 3 x 3 Voronoi search per pixel for caustics and surf lace.
 */
export const makeCellTexture = (size = 256, cells = 8): DataTexture => {
  const data = new Uint8Array(size * size * 4);
  const hash = (i: number, j: number, s: number) => {
    const h = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const pts: [number, number][] = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([i + 0.15 + 0.7 * hash(i, j, 1), j + 0.15 + 0.7 * hash(i, j, 2)]);
  const wrap = (v: number) => ((v % cells) + cells) % cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * cells;
      const py = ((y + 0.5) / size) * cells;
      let d1 = 9;
      let d2 = 9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = Math.floor(px) + di;
          const j = Math.floor(py) + dj;
          const p = pts[wrap(j) * cells + wrap(i)]!;
          const d = Math.hypot(p[0] + (i - wrap(i)) - px, p[1] + (j - wrap(j)) - py);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      }
      const k = (y * size + x) * 4;
      data[k] = Math.round(Math.min(1, (d2 - d1) / 0.6) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
};

/** A shoreline texture at r = 1 everywhere, until the authored island has been measured. */
export const flatShoreline = (): DataTexture => {
  const t = new DataTexture(new Float32Array([1]), 1, 1, RedFormat, FloatType);
  t.needsUpdate = true;
  return t;
};

/** Shared GLSL: the island shoreline radius, mirrored from the Blender generator. */
const ISLAND_GLSL = /* glsl */ `
float islandRA(vec2 xzB, float a) {
  float irr = 1.0 + 0.045 * sin(a * 5.0 + 0.8) + 0.025 * sin(a * 11.0);
  float yIrr = 1.0 + 0.035 * cos(a * 7.0);
  return length(vec2(xzB.x / (590.0 * irr), xzB.y / (260.0 * irr * yIrr)));
}
float islandR(vec2 xzB) { return islandRA(xzB, atan(xzB.y / 260.0, xzB.x / 590.0)); }
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
// Distance outward from the visible waterline in metres (negative inland); shore holds its radius per angle.
float shoreRadius(sampler2D shore, vec2 xzB) {
  float a = atan(xzB.y / 260.0, xzB.x / 590.0);
  return texture(shore, vec2(fract(a / 6.2831853), 0.5)).r;
}
float shoreDistance(vec2 xzB, float r, float rs) {
  float a = atan(xzB.y / 260.0, xzB.x / 590.0);
  float radius = length(vec2(590.0 * cos(a), 260.0 * sin(a)));
  return (r - rs) * radius;
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
  /** Visible waterline radius per island angle (1D, see measureShoreline). */
  uShore: IUniform<Texture>;
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
      uShore: { value: null },
      uCell: { value: null },
      uShoreDetail: { value: 1 },
    },
  ]) as OceanUniforms;
  uniforms.uShore.value = flatShoreline();
  uniforms['uCell']!.value = makeCellTexture();
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
      uniform sampler2D uShore;
      uniform sampler2D uCell;
      uniform float uShoreDetail;
      varying vec3 vWorld;
      // Cellular edge distance in cell units (0 on cell borders), from the baked tile; t scrolls the field.
      float cellEdge(vec2 x, float t) { return texture2D(uCell, x / 8.0 + vec2(t * 0.013, t * 0.007)).r * 0.6; }
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
        float ang = atan(xzB.y / 260.0, xzB.x / 590.0);
        float r = islandRA(xzB, ang);
        float dS = (r - texture2D(uShore, vec2(fract(ang / 6.2831853), 0.5)).r) * length(vec2(590.0 * cos(ang), 260.0 * sin(ang)));
        float shore = 1.0 - smoothstep(1.0, 1.45, r);
        vec3 water = mix(uDeep, uShallow, shore * 0.85) * 1.9;

        // Clear lagoon over a sand shelf: a reef edge ~75 m out, then the drop-off. The bottom shows through with
        // per-channel absorption and moving caustics, fading into the open-ocean colour with depth.
        float nearShore = 1.0 - smoothstep(110.0, 220.0, dS);
        if (uShoreDetail > 0.5 && nearShore > 0.0) {
          float depth = dS < 75.0 ? 0.25 + max(dS, 0.0) * 0.045 : 3.6 + (dS - 75.0) * 0.32;
          depth += (vnoise(xzB * 0.012) - 0.5) * 1.6 * smoothstep(0.0, 40.0, dS);
          depth = clamp(depth, 0.15, 60.0);
          vec3 bed = vec3(0.62, 0.52, 0.34) * (0.82 + 0.3 * vnoise(xzB * 0.09 + 4.0));
          bed = mix(bed, vec3(0.4, 0.35, 0.24), smoothstep(0.6, 0.8, vnoise(xzB * 0.025 + 9.0)) * smoothstep(20.0, 70.0, dS) * 0.5);
          float cd = 1.0 - smoothstep(600.0, 2500.0, dist);
          float ca = cd > 0.0 ? (1.0 - smoothstep(0.0, 0.18, cellEdge(xzB * 0.22 + vec2(uTime * 0.05, uTime * 0.03), uTime * 0.6))) : 0.0;
          float cb = cd > 0.0 ? (1.0 - smoothstep(0.0, 0.16, cellEdge(xzB * 0.31 - vec2(uTime * 0.04, -uTime * 0.02) + 7.3, uTime * 0.45))) : 0.0;
          float caustic = (ca * 0.6 + cb * 0.45 + ca * cb) * cd * exp(-depth * 0.22);
          vec3 lit = bed * (1.0 + caustic * 0.9) * 1.55;
          vec3 absorb = vec3(0.42, 0.075, 0.05);
          vec3 T = exp(-absorb * depth * 1.8);
          vec3 scatter = vec3(0.04, 0.42, 0.5);
          vec3 lagoon = lit * T + scatter * (1.0 - T);
          water = mix(water, lagoon, nearShore * (1.0 - smoothstep(18.0, 45.0, depth)));
        }

        float cosT = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.6)) * 1.25;
        vec3 col = mix(water, sky, fresnel * 0.85);

        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 420.0) * 6.0 * detailFade + pow(max(dot(N, H), 0.0), 60.0) * 0.06;
        col += uSunColor * spec;

        // Surf: wave fronts roll in toward the island, break on the reef edge and again in the swash, drawn as
        // cellular lace that thins into holes between sets.
        if (dS > -12.0 && dS < 140.0) {
          float lod = (1.0 - smoothstep(900.0, 4000.0, dist)) * uShoreDetail;
          float along = ang * 120.0;
          float phase = dS / 24.0 + uTime * 0.16 + fbm(vec2(along * 0.02, 1.7)) * 1.4;
          float fp = fract(phase);
          float crest = pow(1.0 - fp, 3.0) * smoothstep(0.0, 0.06, fp);
          float breakZone = smoothstep(95.0, 70.0, dS) * (0.45 + 0.55 * smoothstep(40.0, 72.0, dS)) + smoothstep(22.0, 2.0, dS);
          float sets = 0.55 + 0.45 * sin(uTime * 0.07 + along * 0.004);
          float swash = smoothstep(-12.0, -8.0, dS) * (1.0 - smoothstep(2.0, 10.0, dS)) * (0.55 + 0.45 * sin(uTime * 0.5 + along * 0.01));
          float broken = smoothstep(0.3, 0.62, vnoise(xzB * 0.016 + vec2(uTime * 0.012, -uTime * 0.008)) * 0.7 + vnoise(xzB * 0.05) * 0.3);
          float amount = clamp(crest * breakZone * sets * 1.7 * broken + swash * 1.1, 0.0, 1.0);
          float lace = 1.0;
          if (lod > 0.0) {
            float l1 = 1.0 - smoothstep(0.0, 0.25, cellEdge(xzB * 0.18 + vec2(0.0, uTime * 0.02), uTime * 0.3));
            float l2 = 1.0 - smoothstep(0.0, 0.3, cellEdge(xzB * 0.47 + 3.1, uTime * 0.5));
            float pat = l1 * 0.6 + l2 * 0.5 + vnoise(xzB * 0.3) * 0.25;
            lace = mix(1.0, smoothstep(1.05 - amount * 0.9, 1.2 - amount * 0.9, pat + 0.15), lod);
          }
          float foamS = smoothstep(0.06, 0.45, amount) * (0.45 + 0.55 * lace) * 0.92;
          col = mix(col, vec3(0.94, 0.97, 0.98) * 1.05, foamS);
        }

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
export const createTerrainMaterial = (time: IUniform<number> = { value: 0 }, shore: IUniform<Texture> = { value: flatShoreline() }): MeshStandardMaterial => {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uFwTime'] = time;
    shader.uniforms['uShore'] = shore;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrWorld;\nvarying vec3 vTerrNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTerrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTerrWorld;\nvarying vec3 vTerrNormal;\nuniform float uFwTime;\nuniform sampler2D uShore;\n${ISLAND_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float wetSand = 0.0;
        {
          vec2 xzB = vec2(vTerrWorld.x, -vTerrWorld.z);
          float ang = atan(xzB.y / 260.0, xzB.x / 590.0);
          float r = islandRA(xzB, ang);
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
          // Grass: blade-scale speckle and clump mottling up close.
          float px = length(fwidth(xzB));
          float nearG = 1.0 - smoothstep(0.03, 0.12, px);
          if (nearG > 0.0) {
            float speck = vnoise(xzB * 7.1);
            grass *= mix(1.0, 0.72 + 0.55 * speck, nearG);
          }
          // Sand: wind ripples and grain; the swash darkens a band that breathes with the surf.
          float sm = clamp(sandMask, 0.0, 1.0);
          float nearS = 1.0 - smoothstep(0.03, 0.1, px);
          if (sm > 0.0) {
            if (nearS > 0.0) {
              float warp = (vnoise(xzB * 0.05) + 0.5 * vnoise(xzB * 0.11)) * 5.0;
              float ripple = sin(dot(xzB, vec2(0.83, 0.56)) * 5.5 + warp) * 0.5 + 0.5;
              sand *= mix(1.0, 0.9 + 0.16 * ripple + 0.08 * (vnoise(xzB * 9.0) - 0.5), nearS);
            }
            if (r > 0.93) {
              float along = ang * 120.0;
              float reach = texture2D(uShore, vec2(fract(ang / 6.2831853), 0.5)).r - 0.016 + 0.011 * (0.5 + 0.5 * sin(uFwTime * 0.5 + along * 0.01)) + (vnoise(xzB * 0.12) - 0.5) * 0.004;
              float wet = smoothstep(reach - 0.006, reach, r);
              sand = mix(sand, sand * vec3(0.66, 0.62, 0.56), wet);
              wetSand = wet * sm;
            }
          }
          vec3 col = mix(grass, sand, sm);
          col = mix(col, rock, clamp(rockMask, 0.0, 1.0));
          diffuseColor.rgb = col;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.38, wetSand);');
  };
  mat.customProgramCacheKey = () => 'flareway-terrain-v2';
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
