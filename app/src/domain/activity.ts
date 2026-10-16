/**
 * Active study time. Time only accrues while the page is visible AND the learner did something
 * within `idleMs`; a hidden tab or a pause stops the clock. Pure: callers feed timestamps.
 */
export class ActiveTimer {
  private ms = 0;
  private last: number | null = null;
  private lastInput: number | null = null;
  constructor(readonly idleMs = 60000) {}

  /** Start or continue counting (call on user input). */
  touch(now: number): void {
    this.accrue(now);
    this.lastInput = now;
    this.last = now;
  }
  /** Page hidden / session paused. */
  pause(now: number): void { this.accrue(now); this.last = null; }
  private accrue(now: number): void {
    if (this.last === null || this.lastInput === null) return;
    const until = Math.min(now, this.lastInput + this.idleMs);
    if (until > this.last) this.ms += until - this.last;
    this.last = now;
  }
  /** Milliseconds counted so far, as of `now`. */
  elapsed(now: number): number { this.accrue(now); return this.ms; }
  /** Returns and clears the counted time (for writing an interval event). */
  take(now: number): number { const v = this.elapsed(now); this.ms = 0; return v; }
}
