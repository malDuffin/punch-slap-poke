export type HandMode = "punch" | "slap" | "poke";

export type GamePhase = "menu" | "readying" | "playing" | "paused" | "waveClear" | "gameover" | "victory";

export type PlatformKind = "desktop" | "mobile" | "xr";

export interface HudState {
  phase: GamePhase;
  health: number;
  maxHealth: number;
  score: number;
  combo: number;
  wave: number;
  maxWaves: number;
  mode: HandMode;
  /** Left hand weapon (rock/paper/scissors) */
  modeL: HandMode;
  /** Right hand weapon */
  modeR: HandMode;
  power: number;
  enemiesLeft: number;
  message: string;
  highScore: number;
  locked: boolean;
  isMobile: boolean;
  xrSupported: boolean;
  xrActive: boolean;
  /** True while requestSession / setSession is in flight */
  xrEntering?: boolean;
  /** Running in a headset browser / immersive XR device (Quest, Pico, etc.) */
  xrHeadset: boolean;
  /** True when page is in an iframe (WebXR often blocked → SecurityError) */
  xrEmbedded?: boolean;
  /** Device reports immersive-vr */
  xrModeVr?: boolean;
  /** Device reports immersive-ar */
  xrModeAr?: boolean;
  /** Preferred session mode string */
  xrPreferredMode?: string | null;
  /** Active session mode once entered */
  xrSessionMode?: string | null;
  xrBlockReason?: string | null;
  xrLastError?: string;
  xrDeviceName?: string;
  xrVendor?: string | null;
  xrForce?: boolean;
  xrHandsOn?: boolean;
  xrRaysOff?: boolean;
  platform: PlatformKind;
  fps: number;
  /** Webcam hand tracking active */
  cameraHands: boolean;
  /** Model/camera currently loading */
  cameraLoading: boolean;
  /** Last camera error, if any */
  cameraError: string | null;
  /** Detected live gesture label for HUD */
  cameraGesture: string;
  /** How many hands currently tracked (0–2) */
  cameraHandsCount: number;
  /** 0–1 upper-body / hands lock progress before fight */
  trackProgress: number;
  /** True once upper-body track held long enough */
  trackReady: boolean;
  /** Pre-fight countdown (3,2,1) or null */
  countdown: number | null;
  /** Wave-clear banner held ~1s; then punch/slap advances */
  waveClearCanContinue: boolean;
  /** Hand/aim debug overlay active */
  handDebug?: boolean;
  handDebugInfo?: unknown;
  /** XR prop scale (real-world meters factor) */
  xrHandScale?: number;
}

/** Full-screen funny feedback for camera punch / slap motions */
export type MotionCue = {
  kind: "punch" | "slap" | "uppercut";
  side: "L" | "R";
  /** slap: horizontal · uppercut: up · punch: optional */
  dir?: "left" | "right" | "up";
  /** palm slap vs backhand slap */
  slapStyle?: "palm" | "backhand";
  power: number;
  /** Big on-screen gag line */
  label: string;
  id: number;
};

export interface GameCallbacks {
  onHud: (state: HudState) => void;
  onHitFlash: (intensity: number) => void;
  onDamageFlash: () => void;
  onComboPop?: (combo: number) => void;
  onMotionCue?: (cue: MotionCue) => void;
}

export const MODE_META: Record<
  HandMode,
  { label: string; key: string; hint: string; color: string; css: string }
> = {
  punch: {
    label: "Rock · Glove",
    key: "1",
    hint: "Closed fist — boxing gloves",
    color: "var(--color-punch)",
    css: "#e23d3d",
  },
  slap: {
    label: "Paper · Fish",
    key: "2",
    hint: "Open hand — fish missiles",
    color: "var(--color-slap)",
    css: "#3db8e2",
  },
  poke: {
    label: "Scissors · Blades",
    key: "3",
    hint: "Index+middle — scissor blades",
    color: "var(--color-poke)",
    css: "#e2b03d",
  },
};
