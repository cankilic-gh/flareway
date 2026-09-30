/** Procedural WebAudio: engine/prop, wind, tire chirp, stall horn, grass rumble. No audio files. */
export interface AudioFrame {
  rpm: number;
  power: number;
  airspeed: number;
  stallWarning: boolean;
  rumble: number;
  paused: boolean;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private hornGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.master = master;

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.noise = buf;

    // Engine: two detuned sawtooth harmonics through a lowpass, plus firing-rate pulses.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(master);
    for (const [type, detune] of [['sawtooth', 0], ['square', 7], ['triangle', -1200]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      o.frequency.value = 40;
      const g = ctx.createGain();
      g.gain.value = type === 'triangle' ? 0.6 : 0.22;
      o.connect(g).connect(this.engineFilter);
      o.start();
      this.engineOsc.push(o);
    }

    const noiseLoop = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noiseLoop().connect(this.windFilter).connect(this.windGain).connect(master);

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    noiseLoop().connect(rumbleFilter).connect(this.rumbleGain).connect(master);

    // Stall warning: a reedy tone gated on and off.
    const horn = ctx.createOscillator();
    horn.type = 'sawtooth';
    horn.frequency.value = 1150;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'bandpass';
    hornFilter.frequency.value = 1150;
    hornFilter.Q.value = 5;
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    horn.connect(hornFilter).connect(this.hornGain).connect(master);
    horn.start();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  update(f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineGain || !this.engineFilter || !this.windGain || !this.windFilter || !this.rumbleGain || !this.hornGain) return;
    const t = ctx.currentTime;
    const mute = f.paused ? 0 : 1;
    // Four-cylinder firing rate = rpm/60 * 2; propeller blade pass = rpm/60 * 2.
    const base = (f.rpm / 60) * 2;
    this.engineOsc[0]!.frequency.setTargetAtTime(base, t, 0.05);
    this.engineOsc[1]!.frequency.setTargetAtTime(base * 1.5, t, 0.05);
    this.engineOsc[2]!.frequency.setTargetAtTime(base, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(280 + f.power * 1400, t, 0.08);
    this.engineGain.gain.setTargetAtTime(mute * (0.05 + 0.13 * f.power), t, 0.08);
    const w = Math.min(1, f.airspeed / 45);
    this.windGain.gain.setTargetAtTime(mute * w * w * 0.22, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + w * 1400, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(mute * Math.min(0.5, f.rumble * 0.5), t, 0.05);
    const hornOn = f.stallWarning && !f.paused ? 0.06 * (0.5 + 0.5 * Math.sign(Math.sin(t * 18))) : 0;
    this.hornGain.gain.setTargetAtTime(hornOn, t, 0.01);
  }

  /** Short filtered noise burst; louder and lower for harder contacts. */
  chirp(strength: number, dust: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = dust ? 300 : 2600 - Math.min(1, strength) * 1200;
    f.Q.value = dust ? 0.7 : 2.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const peak = Math.min(0.55, 0.08 + strength * 0.35);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + strength * 0.25);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5, 0.6);
  }

  /** Low thump for a heavy impact. */
  thump(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    g.gain.setValueAtTime(Math.min(0.8, strength * 0.6), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }
}
