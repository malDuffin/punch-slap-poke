/** Layered Web Audio SFX — unlocks on first gesture, pitch-randomized. */

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  muted = false;
  private musicOsc: OscillatorNode[] = [];
  private musicOn = false;

  private ensure() {
    if (this.ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.38;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.05;
    this.musicGain.connect(this.master);
  }

  unlock() {
    this.ensure();
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.38;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.2,
    slide = 0,
    delay = 0,
  ) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const detune = (Math.random() - 0.5) * 28;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.setValueAtTime(detune, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain * (0.85 + Math.random() * 0.3), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain = 0.12, freq = 800) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx || !this.master) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain * (0.85 + Math.random() * 0.25);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
  }

  punch() {
    this.tone(88, 0.14, "sine", 0.32, -45);
    this.tone(180, 0.08, "triangle", 0.1, -60);
    this.noise(0.09, 0.12, 600);
  }

  slap() {
    this.noise(0.12, 0.22, 1400);
    this.tone(240, 0.07, "triangle", 0.14, -120);
    this.tone(90, 0.1, "sine", 0.1, -30);
  }

  poke() {
    this.tone(520, 0.05, "square", 0.07, 140);
    this.tone(780, 0.04, "triangle", 0.05, 80);
  }

  hit() {
    this.fleshImpact(0.75);
  }

  crit() {
    this.tone(220, 0.08, "square", 0.12, 100);
    this.tone(440, 0.1, "sine", 0.1, 200);
    this.noise(0.12, 0.14, 1200);
  }

  hurt() {
    this.tone(70, 0.24, "sine", 0.28, -35);
    this.noise(0.15, 0.1, 300);
  }

  break() {
    this.noise(0.16, 0.18, 700);
    this.tone(280, 0.12, "triangle", 0.1, -220);
    this.tone(140, 0.15, "sine", 0.08, -80, 0.03);
  }

  /** Rate-limit noisy impacts so crate piles don't clip the bus */
  private lastImpactAt = 0;
  private impactBudget(minGap = 0.028): boolean {
    const now = performance.now() / 1000;
    if (now - this.lastImpactAt < minGap) return false;
    this.lastImpactAt = now;
    return true;
  }

  /**
   * Generic impact. kind:
   *  - "flesh" enemy body hit
   *  - "wood"  crate / box
   *  - "metal" scissors / steel
   *  - "wet"   fish slap connect
   *  - "thud"  heavy ground land
   * power 0–1 scales loudness & body
   */
  impact(kind: "flesh" | "wood" | "metal" | "wet" | "thud" = "flesh", power = 0.7) {
    if (this.muted) return;
    if (!this.impactBudget(kind === "thud" ? 0.04 : 0.022)) return;
    const p = Math.max(0.2, Math.min(1.4, power));
    if (kind === "wood") this.crateImpact(p);
    else if (kind === "metal") this.metalImpact(p);
    else if (kind === "wet") this.wetImpact(p);
    else if (kind === "thud") this.thud(p);
    else this.fleshImpact(p);
  }

  fleshImpact(power = 0.7) {
    const g = 0.1 + power * 0.16;
    this.noise(0.06 + power * 0.04, g * 0.9, 700 + power * 400);
    this.tone(120 + power * 40, 0.09, "sawtooth", g, -70);
    this.tone(280 + power * 60, 0.05, "triangle", g * 0.55, -100, 0.015);
    this.tone(90, 0.12, "sine", g * 0.7, -40);
  }

  /** Wooden crate / box smash */
  crateImpact(power = 0.7) {
    const g = 0.12 + power * 0.18;
    // dry wood crack
    this.noise(0.05, g, 1800);
    this.noise(0.09, g * 0.7, 900);
    this.tone(220 + Math.random() * 80, 0.07, "triangle", g * 0.7, -160);
    this.tone(140, 0.1, "sine", g * 0.5, -60);
    // clack layer
    this.tone(520 + Math.random() * 120, 0.03, "square", g * 0.35, -200);
  }

  metalImpact(power = 0.7) {
    const g = 0.1 + power * 0.14;
    this.tone(900 + Math.random() * 200, 0.06, "square", g * 0.4, -500);
    this.tone(1400, 0.04, "triangle", g * 0.3, -800);
    this.noise(0.05, g * 0.6, 2400);
    this.tone(180, 0.08, "sine", g * 0.45, -50);
  }

  wetImpact(power = 0.7) {
    const g = 0.12 + power * 0.16;
    this.noise(0.1, g, 600);
    this.noise(0.14, g * 0.7, 300);
    this.tone(160, 0.1, "sine", g * 0.5, -80);
    this.tone(70, 0.14, "triangle", g * 0.4, -30);
  }

  thud(power = 0.7) {
    const g = 0.14 + power * 0.2;
    this.noise(0.08, g * 0.6, 250);
    this.tone(55 + Math.random() * 15, 0.16, "sine", g, -25);
    this.tone(110, 0.08, "triangle", g * 0.4, -40);
  }

  /** Projectile connects (mode-aware wrapper) */
  projectileHit(mode: "punch" | "slap" | "poke" | string = "punch", power = 0.8) {
    if (mode === "slap") this.impact("wet", power);
    else if (mode === "poke") this.impact("metal", power * 0.95);
    else this.impact("flesh", power);
  }


  heartShield() {
    this.tone(440, 0.12, "sine", 0.14, 220);
    this.tone(660, 0.18, "triangle", 0.12, 180, 0.04);
    this.tone(880, 0.22, "sine", 0.1, 120, 0.08);
    this.noise(0.1, 0.08, 900);
  }

  heartShieldHit() {
    this.tone(720, 0.06, "triangle", 0.1, -200);
    this.noise(0.05, 0.12, 1600);
  }

  powerup() {
    this.tone(440, 0.1, "sine", 0.12, 220);
    this.tone(660, 0.12, "sine", 0.1, 180, 0.05);
    this.tone(880, 0.16, "sine", 0.08, 120, 0.1);
  }

  taunt() {
    this.tone(330, 0.08, "square", 0.08, 80);
    this.tone(440, 0.1, "square", 0.07, 40, 0.06);
  }

  waveClear() {
    this.tone(523, 0.12, "sine", 0.12, 0);
    this.tone(659, 0.14, "sine", 0.1, 0, 0.08);
    this.tone(784, 0.2, "sine", 0.1, 0, 0.16);
  }

  gameOver() {
    this.tone(200, 0.25, "sawtooth", 0.15, -100);
    this.tone(120, 0.4, "sine", 0.18, -40, 0.1);
  }

  click() {
    this.tone(600, 0.04, "square", 0.05, 0);
  }

  /** Finger snap / click charge */
  fingerClick() {
    this.noise(0.04, 0.16, 2200);
    this.tone(980, 0.05, "triangle", 0.1, -400);
    this.tone(1480, 0.035, "square", 0.06, -600, 0.01);
    this.tone(220, 0.08, "sine", 0.08, 80, 0.02);
  }

  clickCharge() {
    this.tone(520, 0.08, "sine", 0.12, 280);
    this.tone(780, 0.12, "triangle", 0.1, 220, 0.04);
    this.noise(0.08, 0.1, 1400);
  }

  whoosh() {
    this.noise(0.1, 0.08, 400);
    this.tone(200, 0.08, "sine", 0.06, 300);
  }

  grenadePin() {
    this.tone(880, 0.04, "square", 0.06, -200);
    this.noise(0.05, 0.08, 2200);
  }

  grenadeThrow() {
    this.noise(0.1, 0.1, 500);
    this.tone(160, 0.1, "sine", 0.08, 80);
  }

  grenadeBoom() {
    this.noise(0.35, 0.35, 180);
    this.noise(0.22, 0.22, 420);
    this.tone(55, 0.4, "sine", 0.4, -30);
    this.tone(90, 0.25, "sawtooth", 0.18, -50);
    this.tone(40, 0.5, "sine", 0.22, -15, 0.05);
  }

  grenadeTick() {
    this.tone(1200, 0.03, "square", 0.04, 0);
  }

  /** One snip of scissors */
  snip() {
    this.noise(0.045, 0.14, 2800);
    this.tone(1400, 0.03, "square", 0.05, -400);
    this.tone(900, 0.04, "triangle", 0.04, -200, 0.015);
  }

  private scissorLoopTimer: ReturnType<typeof setInterval> | null = null;
  private scissorLoopUntil = 0;

  /** Looping cut sound while scissors projectile is in flight */
  startScissorsLoop(duration = 2.0) {
    if (this.muted) return;
    this.ensure();
    this.scissorLoopUntil = performance.now() + duration * 1000;
    this.snip();
    if (this.scissorLoopTimer) return;
    this.scissorLoopTimer = setInterval(() => {
      if (this.muted || performance.now() > this.scissorLoopUntil) {
        this.stopScissorsLoop();
        return;
      }
      this.snip();
    }, 110);
  }

  stopScissorsLoop() {
    if (this.scissorLoopTimer) {
      clearInterval(this.scissorLoopTimer);
      this.scissorLoopTimer = null;
    }
    this.scissorLoopUntil = 0;
  }

  startMusic() {
    if (this.musicOn || this.muted) return;
    this.ensure();
    if (!this.ctx || !this.musicGain) return;
    this.musicOn = true;
    const notes = [130.81, 164.81, 196.0, 246.94];
    notes.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      g.gain.value = 0.12;
      osc.connect(g);
      g.connect(this.musicGain!);
      osc.start();
      this.musicOsc.push(osc);
    });
    // subtle LFO pulse
    if (this.musicGain) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.setValueAtTime(0.04, now);
      this.musicGain.gain.linearRampToValueAtTime(0.07, now + 2);
    }
  }

  stopMusic() {
    for (const o of this.musicOsc) {
      try {
        o.stop();
      } catch {
        /* */
      }
    }
    this.musicOsc = [];
    this.musicOn = false;
  }
}
