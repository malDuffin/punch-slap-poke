/** Layered Web Audio SFX — unlocks on first gesture, pitch-randomized. */

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private rumbleOsc: OscillatorNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rumbleLfo: OscillatorNode | null = null;
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
    this.master.gain.value = 0.46;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.28;
    this.musicGain.connect(this.master);
  }

  unlock() {
    this.ensure();
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.46;
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

  bagThud(power = 0.8) {
    this.thud(power * 1.15);
    this.metalImpact(power * 0.45);
  }

  gumballRattle(power = 0.6) {
    const g = 0.08 + power * 0.1;
    this.tone(720 + Math.random() * 280, 0.04, "triangle", g, -200);
    this.tone(980 + Math.random() * 200, 0.03, "square", g * 0.5, -400);
    this.noise(0.04, g * 0.45, 1800);
  }

  gumballBurst() {
    this.break();
    this.tone(520, 0.12, "triangle", 0.12, 240);
    this.tone(780, 0.16, "sine", 0.08, 180, 0.04);
    this.noise(0.18, 0.16, 1400);
  }

  /** Projectile connects (mode-aware wrapper) */
  projectileHit(mode: "punch" | "slap" | "poke" | string = "punch", power = 0.8) {
    if (mode === "slap") this.impact("wet", power);
    else if (mode === "poke") this.impact("metal", power * 0.95);
    else this.impact("flesh", power);
  }


  heartShield() {
    this.unlock();
    // Big fuse: bass thump + rising sparkle arpeggio
    this.tone(98, 0.28, "sine", 0.22, -30);
    this.tone(196, 0.22, "triangle", 0.16, 40, 0.02);
    this.noise(0.16, 0.14, 1400);
    this.tone(523, 0.16, "sine", 0.18, 80, 0.04);
    this.tone(659, 0.18, "triangle", 0.16, 60, 0.1);
    this.tone(784, 0.22, "sine", 0.14, 40, 0.16);
    this.tone(1046, 0.28, "sine", 0.12, 120, 0.22);
    this.tone(1318, 0.2, "triangle", 0.08, 80, 0.3);
    this.noise(0.12, 0.08, 2400);
  }

  heartShieldHit() {
    this.tone(720, 0.06, "triangle", 0.1, -200);
    this.noise(0.05, 0.12, 1600);
  }

  /** Soft rising ping while two halves get close (engine rate-limits). */
  heartCharge(amount: number) {
    const a = Math.max(0, Math.min(1, amount));
    if (a < 0.28) return;
    this.tone(720 + a * 520, 0.07, "sine", 0.035 + a * 0.07, 80);
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

  /** Funny one-shot when a hand model swaps in. */
  gestureSwap(kind: string) {
    if (kind === "punch") {
      this.tone(88, 0.11, "sine", 0.24, -40);
      this.tone(170, 0.07, "triangle", 0.09, -70);
      this.noise(0.07, 0.1, 420);
      return;
    }
    if (kind === "slap") {
      this.noise(0.13, 0.2, 980);
      this.tone(190, 0.1, "sine", 0.1, -100);
      this.tone(72, 0.14, "triangle", 0.08, -22);
      return;
    }
    if (kind === "poke") {
      this.snip();
      this.tone(1180, 0.045, "square", 0.05, -240, 0.07);
      return;
    }
    if (kind === "thumbs") {
      this.tone(392, 0.08, "square", 0.09, 80);
      this.tone(523, 0.1, "triangle", 0.08, 40, 0.07);
      this.tone(784, 0.14, "sine", 0.07, 0, 0.14);
      return;
    }
    if (kind === "thumbsDown") {
      this.tone(330, 0.16, "sawtooth", 0.1, -90);
      this.tone(220, 0.22, "triangle", 0.1, -60, 0.1);
      this.tone(147, 0.3, "sine", 0.13, -28, 0.2);
      return;
    }
    if (kind === "peace") {
      this.tone(659, 0.08, "sine", 0.08, 40);
      this.tone(880, 0.1, "triangle", 0.07, 60, 0.05);
      this.tone(1318, 0.14, "sine", 0.05, 0, 0.1);
      return;
    }
    if (kind === "spock") {
      this.tone(220, 0.22, "sine", 0.09, 200);
      this.tone(330, 0.26, "triangle", 0.07, 240, 0.05);
      this.tone(110, 0.2, "sine", 0.05, 90, 0.08);
      return;
    }
    if (kind === "heart") {
      this.tone(520, 0.08, "sine", 0.11, 140);
      this.tone(780, 0.12, "triangle", 0.09, 90, 0.05);
      this.noise(0.05, 0.045, 1900);
      return;
    }
    if (kind === "rockOn") {
      this.tone(110, 0.18, "sawtooth", 0.15, 24);
      this.tone(165, 0.14, "square", 0.08, 12, 0.02);
      this.tone(220, 0.2, "sawtooth", 0.07, -18, 0.06);
      this.noise(0.08, 0.08, 620);
      return;
    }
    if (kind === "birdie") {
      this.tone(1480, 0.07, "sine", 0.11, 420);
      this.tone(1860, 0.06, "triangle", 0.08, 180, 0.05);
      this.tone(980, 0.1, "square", 0.07, -280, 0.1);
      this.tone(640, 0.13, "sawtooth", 0.08, -200, 0.16);
      this.noise(0.06, 0.055, 2400);
      return;
    }
    this.taunt();
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

  leverGrab() {
    this.tone(140, 0.08, "triangle", 0.16, -40);
    this.noise(0.05, 0.1, 420);
  }

  leverRelease() {
    this.tone(110, 0.12, "sine", 0.1, -50);
    this.noise(0.04, 0.06, 280);
  }

  walkRumble(amount: number) {
    const a = Math.max(0, Math.min(1, amount));
    this.ensure();
    if (!this.ctx || !this.master) return;
    if (a < 0.02) {
      if (this.rumbleGain) this.rumbleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      return;
    }
    if (!this.rumbleOsc) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 42;
      const lfo = this.ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 8;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 180;
      osc.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      osc.start();
      lfo.start();
      this.rumbleOsc = osc;
      this.rumbleLfo = lfo;
      this.rumbleGain = g;
    }
    this.rumbleOsc.frequency.setTargetAtTime(36 + a * 28, this.ctx.currentTime, 0.08);
    this.rumbleGain.gain.setTargetAtTime(a * 0.07, this.ctx.currentTime, 0.1);
  }

  countdown(beat) {
    if (beat === "GO") {
      this.tone(523, 0.1, "square", 0.12, 40);
      this.tone(784, 0.18, "triangle", 0.14, 80, 0.05);
      this.tone(1046, 0.22, "sine", 0.1, 0, 0.08);
      return;
    }
    const n = Number(beat);
    const f = n === 3 ? 392 : n === 2 ? 440 : 494;
    this.tone(f, 0.12, "square", 0.11, -20);
    this.tone(f * 2, 0.08, "sine", 0.06, 0, 0.02);
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

  /** Leaves ripping off a tree */
  leafRustle(power = 0.8) {
    const p = Math.max(0.35, Math.min(1.3, power));
    this.noise(0.16, 0.1 + p * 0.1, 2200);
    this.noise(0.22, 0.08 + p * 0.08, 1400);
    this.tone(190 + Math.random() * 40, 0.08, "triangle", 0.05 * p, -80);
    this.tone(320, 0.05, "sine", 0.03 * p, -40, 0.03);
  }

  /** Trunk cracking, then a heavy timber fall */
  treeCrack() {
    this.noise(0.08, 0.16, 1600);
    this.tone(180, 0.1, "sawtooth", 0.12, -160);
    this.tone(90, 0.14, "triangle", 0.1, -70);
  }

  treeFall() {
    this.noise(0.18, 0.14, 500);
    this.tone(70, 0.28, "sine", 0.22, -30);
    this.tone(42, 0.35, "sine", 0.16, -12, 0.08);
    this.noise(0.12, 0.18, 280);
    this.tone(140, 0.08, "triangle", 0.08, -80, 0.16);
  }
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
    if (this.muted) return;
    this.ensure();
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const MUSIC_LEVEL = 0.86;
    const already = this.musicOn;
    this.musicOn = true;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(already ? Math.max(0.12, this.musicGain.gain.value) : 0.001, now);
    this.musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + (already ? 0.25 : 0.7));
    this.musicStep = 0;
    this.musicNext = now + 0.04;
    if (!already) this.pumpMusic();
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    for (const o of this.musicOsc) {
      try {
        o.stop();
      } catch {
        /* */
      }
    }
    this.musicOsc = [];
  }

  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicStep = 0;
  private musicNext = 0;

  /** 144 BPM C-major carnival knockout — bounce, claps, shouty hook. */
  private pumpMusic() {
    if (!this.musicOn || !this.ctx || !this.musicGain) return;
    if (!this.muted) {
      const ctx = this.ctx;
      if (this.musicGain.gain.value < 0.78) {
        this.musicGain.gain.setTargetAtTime(0.86, ctx.currentTime, 0.25);
      }
      const stepDur = 60 / 144 / 4;
      const horizon = ctx.currentTime + 0.22;
      while (this.musicNext < horizon) {
        this.playMusicStep(this.musicStep % 128, this.musicNext);
        this.musicNext += stepDur;
        this.musicStep += 1;
      }
    } else {
      this.musicNext = this.ctx.currentTime + 0.05;
    }
    this.musicTimer = setTimeout(() => this.pumpMusic(), 28);
  }

  private midi(n: number) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private playToneAt(
    freq: number,
    t0: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    dest: AudioNode,
    slide = 0,
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private playNoiseAt(t0: number, dur: number, gain: number, freq: number, dest: AudioNode) {
    if (!this.ctx) return;
    const n = Math.max(32, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  private playMusicStep(step: number, t0: number) {
    if (!this.musicGain) return;
    const dest = this.musicGain;
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    // I–V–vi–IV twice: C G Am F C G Am F — bright arcade chant
    const roots = [36, 43, 45, 41, 36, 43, 45, 41]; // C2 G2 A2 F2
    const root = roots[bar]!;
    const third = bar % 4 === 2 ? root + 3 : root + 4; // minor on Am
    const fifth = root + 7;
    const bounce = bar >= 4;

    // Four-on-the-floor kick + skip on the 'and'
    if (s === 0 || s === 4 || s === 8 || s === 12) {
      this.playToneAt(this.midi(26), t0, 0.14, "sine", 0.42, dest, -12);
      this.playToneAt(this.midi(38), t0, 0.07, "triangle", 0.14, dest, -18);
      this.playNoiseAt(t0, 0.04, 0.1, 120, dest);
    }
    if (s === 6 || s === 14) {
      this.playToneAt(this.midi(30), t0, 0.08, "sine", 0.22, dest, -10);
    }
    // Claps on 2 and 4
    if (s === 4 || s === 12) {
      this.playNoiseAt(t0, 0.12, 0.22, 2400, dest);
      this.playNoiseAt(t0, 0.08, 0.12, 1600, dest);
      this.playToneAt(330, t0, 0.06, "triangle", 0.09, dest, -110);
    }
    // Offbeat hats + extra sparkle on the chorus half
    if (s % 2 === 1) this.playNoiseAt(t0, 0.03, bounce ? 0.07 : 0.045, 9000, dest);
    if (s % 4 === 2) this.playNoiseAt(t0, 0.035, 0.06, 7000, dest);
    if (bounce && s === 10) this.playNoiseAt(t0, 0.06, 0.1, 3200, dest);

    // Bouncy octave bass
    if (s === 0 || s === 8) {
      this.playToneAt(this.midi(root), t0, 0.28, "sawtooth", 0.22, dest, -6);
      this.playToneAt(this.midi(root), t0, 0.24, "triangle", 0.16, dest, -3);
    } else if (s === 4 || s === 12) {
      this.playToneAt(this.midi(root + 12), t0, 0.16, "sawtooth", 0.14, dest, -8);
      this.playToneAt(this.midi(root + 7), t0, 0.12, "triangle", 0.1, dest, -10);
    } else if (s === 6 || s === 14) {
      this.playToneAt(this.midi(root + 12), t0, 0.1, "triangle", 0.12, dest, -8);
    }

    // Chord stabs on the downbeat
    if (s === 0) {
      this.playToneAt(this.midi(root + 12), t0, 0.32, "triangle", 0.08, dest, 4);
      this.playToneAt(this.midi(third + 12), t0, 0.3, "sine", 0.07, dest, 6);
      this.playToneAt(this.midi(fifth + 12), t0, 0.28, "sine", 0.06, dest, 8);
    }

    // Call / response hooks — major pentatonic bounce
    const hookA = [72, 0, 76, 79, 76, 0, 72, 74, 76, 0, 79, 76, 74, 72, 67, 0];
    const hookB = [79, 76, 72, 0, 74, 76, 79, 0, 81, 0, 79, 76, 74, 72, 67, 72];
    const hookC = [72, 76, 79, 81, 79, 0, 76, 74, 72, 0, 67, 69, 72, 74, 76, 0];
    const hookD = [84, 0, 81, 79, 76, 79, 81, 0, 79, 76, 74, 72, 74, 76, 72, 0];
    const hooks = [hookA, hookB, hookA, hookC, hookB, hookD, hookC, hookD];
    const lead = hooks[bar]!;
    const note = lead[s] || 0;
    if (note) {
      const gLead = bounce ? 0.16 : 0.13;
      this.playToneAt(this.midi(note), t0, 0.16, "square", gLead, dest, 8);
      this.playToneAt(this.midi(note), t0, 0.2, "triangle", gLead * 0.9, dest, 5);
      this.playToneAt(this.midi(note + 12), t0, 0.12, "sine", gLead * 0.45, dest, 14);
    }

    // Answer riff on the last 2 bars
    if (bar >= 6 && (s === 2 || s === 10)) {
      this.playToneAt(this.midi(root + 19), t0, 0.1, "sine", 0.08, dest, 20);
    }
  }
}
