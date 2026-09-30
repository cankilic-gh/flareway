import { BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial, Vector3 } from 'three';

const MAX = 220;

/** Pooled tire-smoke / grass-dust puffs. One draw call, no per-frame allocation. */
export class ContactEffects {
  readonly points: Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(1e9);
  private readonly life = new Float32Array(MAX).fill(1);
  private readonly maxSize = new Float32Array(MAX).fill(1);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly tint = new Float32Array(MAX * 3);
  private next = 0;
  private readonly geo: BufferGeometry;

  constructor() {
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('size', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    this.geo.setAttribute('tint', new BufferAttribute(this.tint, 3));
    const mat = new ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float size;
        attribute float alpha;
        attribute vec3 tint;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(size * uScale / max(-mv.z, 0.1), 400.0);
          vAlpha = alpha;
          vTint = tint;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.2, r) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vTint, a);
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
  }

  get scaleUniform(): { value: number } {
    return (this.points.material as ShaderMaterial).uniforms['uScale'] as { value: number };
  }

  /** Emits `count` puffs at a contact point. `dust` uses a warm grass/earth tint. */
  emit(at: Vector3, groundVel: Vector3, strength: number, count: number, dust: boolean): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const j = (i * 2654435761) >>> 0;
      const rx = ((j & 0xff) / 255 - 0.5) * 0.6;
      const rz = (((j >> 8) & 0xff) / 255 - 0.5) * 0.6;
      this.pos[i * 3] = at.x + rx;
      this.pos[i * 3 + 1] = at.y + 0.15;
      this.pos[i * 3 + 2] = at.z + rz;
      // Puffs are left behind in the air mass: keep a little of the wheel velocity.
      this.vel[i * 3] = groundVel.x * 0.12 + rx;
      this.vel[i * 3 + 1] = 0.5 + strength * 0.6;
      this.vel[i * 3 + 2] = groundVel.z * 0.12 + rz;
      this.age[i] = 0;
      this.life[i] = 0.7 + strength * 1.8;
      this.maxSize[i] = 0.9 + strength * 2.6;
      const c = dust ? [0.55, 0.5, 0.38] : [0.86, 0.86, 0.86];
      this.tint.set(c, i * 3);
      this.size[i] = 0.6;
    }
  }

  update(dt: number, wind: Vector3): void {
    for (let i = 0; i < MAX; i++) {
      const a = (this.age[i]! += dt);
      const t = a / this.life[i]!;
      if (t >= 1) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.pos[i * 3] = this.pos[i * 3]! + (this.vel[i * 3]! + wind.x * 0.6) * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + (this.vel[i * 3 + 2]! + wind.z * 0.6) * dt;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * (1 - dt * 1.5);
      this.size[i] = 0.4 + t * this.maxSize[i]!;
      this.alpha[i] = 0.5 * (1 - t) * Math.min(1, a * 10);
    }
    for (const n of ['position', 'size', 'alpha', 'tint']) (this.geo.attributes[n] as BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.age.fill(1e9);
    this.alpha.fill(0);
    this.size.fill(0);
  }
}

/** Impulse-driven camera shake; a butter landing stays quiet, a hard one feels heavy. */
export class Shake {
  private energy = 0;
  private buffet = 0;
  private t = 0;
  readonly offset = new Vector3();

  impulse(strength: number): void {
    this.energy = Math.min(1.5, this.energy + strength);
  }

  update(dt: number, buffet: number, rumble: number, reducedMotion: boolean): Vector3 {
    this.t += dt;
    this.energy *= Math.exp(-dt * 5);
    this.buffet += (buffet - this.buffet) * Math.min(1, dt * 6);
    const scale = reducedMotion ? 0.15 : 1;
    const e = (this.energy * 0.09 + this.buffet * 0.025 + rumble * 0.012) * scale;
    this.offset.set(
      Math.sin(this.t * 37.1) * e + Math.sin(this.t * 13.3) * e * 0.5,
      Math.sin(this.t * 41.7 + 1.3) * e,
      Math.sin(this.t * 29.9 + 2.1) * e * 0.6,
    );
    return this.offset;
  }

  reset(): void {
    this.energy = 0;
    this.buffet = 0;
  }
}
