import { MAX_STEPS_PER_FRAME } from './constants';

/** Accumulates real frame time and runs whole fixed simulation steps. */
export class FixedStepper {
  private acc = 0;

  constructor(
    readonly dt: number,
    readonly maxSteps = MAX_STEPS_PER_FRAME,
  ) {}

  /** Returns the number of steps run; `alpha` is the leftover fraction for interpolation. */
  advance(frameSeconds: number, step: () => void): number {
    this.acc += Math.max(0, frameSeconds);
    let n = 0;
    // Tolerance keeps accumulated float error from dropping a step at exact multiples.
    while (this.acc >= this.dt - 1e-9 && n < this.maxSteps) {
      step();
      this.acc -= this.dt;
      n++;
    }
    if (n >= this.maxSteps) this.acc = Math.min(this.acc, this.dt);
    return n;
  }

  get alpha(): number {
    return Math.max(0, Math.min(1, this.acc / this.dt));
  }

  reset(): void {
    this.acc = 0;
  }
}
