/**
 * Webcam hand tracking via MediaPipe GestureRecognizer.
 * Maps Rock / Paper / Scissors + jab motion → modes/strikes,
 * and exposes full pose so viewmodel gloves can follow the hands.
 */

import {
  FilesetResolver,
  GestureRecognizer,
  type GestureRecognizerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { HandMode } from "./types";

export type CamGesture =
  | "punch"
  | "slap"
  | "poke"
  | "thumbs"
  | "thumbsDown"
  | "peace"
  | "spock"
  | "rockOn"
  | "heart"
  | "birdie"
  | "none";

/** Pose in mirrored selfie space (0–1, origin top-left of mirrored view). */
export interface TrackedLandmark {
  /** Mirrored x 0–1 (matches PIP) */
  x: number;
  y: number;
}

export interface TrackedHand {
  side: "L" | "R";
  gesture: CamGesture;
  mode: HandMode | null;
  /** Mirrored wrist (matches PIP preview: your right is on the right) */
  mx: number;
  my: number;
  /** Raw MediaPipe depth (more negative ≈ closer to camera) */
  z: number;
  palmSize: number;
  /** 0 far … 1 close */
  closeness: number;
  /** Palm forward in mirrored image (unit-ish) */
  dirX: number;
  dirY: number;
  /** Palm roll from pinky→index line (radians-ish) */
  roll: number;
  /** 0–1 tracking confidence for this hand */
  score: number;
  /** Forward jab / punch impulse */
  strike: boolean;
  /** Upward uppercut impulse */
  uppercut: boolean;
  /** Horizontal slap / swipe impulse */
  slap: boolean;
  /** Slap direction in mirrored space: -1 left, +1 right, 0 none */
  slapDir: -1 | 0 | 1;
  /** Palm facing camera vs back of hand (at strike time for slaps) */
  slapStyle: "palm" | "backhand" | null;
  /** +1 palm toward camera, -1 backhand toward camera */
  palmFacing: number;
  /** Thrust strength 0–1 from size/z velocity */
  thrust: number;
  /** Horizontal swipe strength 0–1 */
  swipe: number;
  /** Upward lift strength 0–1 */
  lift: number;
  /** Finger-click / snap (thumb+middle) this frame */
  click: boolean;
  /** Scissors snip (index+middle closed together) this frame */
  snip: boolean;
  /** 0–1 snip strength when snip is true */
  snipPower: number;
  /** All 21 landmarks in mirrored space for skeleton overlay */
  landmarks: TrackedLandmark[];
  /** Raw unmirrored wrist for debug */
  wristX: number;
  wristY: number;
}

/** MediaPipe hand topology for overlay drawing (indices into landmarks[21]). */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export interface HandTrackFrame {
  hands: TrackedHand[];
  ready: boolean;
  error: string | null;
}

const WASM_LOCAL = "/mediapipe/wasm";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm";
/** Prefer same-origin model (avoids GCS / CORS / mixed-content failures). */
const MODEL_LOCAL = "/mediapipe/gesture_recognizer.task";
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const GESTURE_TO_MODE: Record<string, HandMode | null> = {
  Closed_Fist: "punch",
  Open_Palm: "slap",
  Victory: "poke",
  Pointing_Up: "poke",
  Thumb_Up: null,
  Thumb_Down: null,
  ILoveYou: null,
  None: null,
};

const GESTURE_TO_CAM: Record<string, CamGesture> = {
  Closed_Fist: "punch",
  Open_Palm: "slap",
  Victory: "peace", // V / peace — combat scissors still from landmark RPS
  Pointing_Up: "poke",
  Thumb_Up: "thumbs",
  ILoveYou: "rockOn",
  Thumb_Down: "thumbsDown",
  None: "none",
};

/**
 * Landmark-based Rock / Paper / Scissors.
 * MediaPipe hand indices:
 *  0 wrist
 *  1–4 thumb, 5–8 index, 9–12 middle, 13–16 ring, 17–20 pinky
 * A finger is "extended" if the tip is clearly farther from the wrist than the PIP joint.
 */
function fingerStraight(lm: NormalizedLandmark[], tip: number, pip: number, mcp: number): boolean {
  const wrist = lm[0]!;
  const t = lm[tip]!;
  const p = lm[pip]!;
  const m = lm[mcp]!;
  const ax = m.x - p.x, ay = m.y - p.y, az = (m.z ?? 0) - (p.z ?? 0);
  const bx = t.x - p.x, by = t.y - p.y, bz = (t.z ?? 0) - (p.z ?? 0);
  const al = Math.hypot(ax, ay, az), bl = Math.hypot(bx, by, bz);
  if (al < 1e-5 || bl < 1e-5) return false;
  const cos = (ax * bx + ay * by + az * bz) / (al * bl);
  const tipD = dist(wrist, t);
  const pipD = dist(wrist, p);
  const palm = dist(lm[5]!, lm[17]!) || 0.08;
  return cos < -0.28 && tipD > pipD * 1.04 && tipD > palm * 0.85;
}

function fingerTucked(lm: NormalizedLandmark[], tip: number, pip: number, mcp: number): boolean {
  return !fingerStraight(lm, tip, pip, mcp);
}

function fingerBlade(lm: NormalizedLandmark[], tip: number, pip: number, mcp: number): boolean {
  const wrist = lm[0]!;
  const t = lm[tip]!;
  const p = lm[pip]!;
  const m = lm[mcp]!;
  const ax = m.x - p.x, ay = m.y - p.y, az = (m.z ?? 0) - (p.z ?? 0);
  const bx = t.x - p.x, by = t.y - p.y, bz = (t.z ?? 0) - (p.z ?? 0);
  const al = Math.hypot(ax, ay, az), bl = Math.hypot(bx, by, bz);
  if (al < 1e-5 || bl < 1e-5) return false;
  const cos = (ax * bx + ay * by + az * bz) / (al * bl);
  const tipD = dist(wrist, t);
  const pipD = dist(wrist, p);
  const palm = dist(lm[5]!, lm[17]!) || 0.08;
  return tipD > pipD * 1.02 && tipD > palm * 0.78 && cos < 0.15;
}

function fingerOpen(lm: NormalizedLandmark[], tip: number, pip: number, mcp: number): boolean {
  const wrist = lm[0]!;
  const t = lm[tip]!;
  const p = lm[pip]!;
  const m = lm[mcp]!;
  const ax = m.x - p.x, ay = m.y - p.y, az = (m.z ?? 0) - (p.z ?? 0);
  const bx = t.x - p.x, by = t.y - p.y, bz = (t.z ?? 0) - (p.z ?? 0);
  const al = Math.hypot(ax, ay, az), bl = Math.hypot(bx, by, bz);
  if (al < 1e-5 || bl < 1e-5) return false;
  const cos = (ax * bx + ay * by + az * bz) / (al * bl);
  const tipD = dist(wrist, t);
  const pipD = dist(wrist, p);
  const palm = dist(lm[5]!, lm[17]!) || 0.08;
  return cos < -0.48 && tipD > pipD * 1.08 && tipD > palm * 0.95;
}

function fingerExtended(lm: NormalizedLandmark[], tip: number, pip: number, mcp: number): boolean {
  const wrist = lm[0]!;
  const t = lm[tip]!;
  const p = lm[pip]!;
  const m = lm[mcp]!;
  const tipDist = dist(wrist, t);
  const pipDist = dist(wrist, p);
  const mcpDist = dist(wrist, m);
  const open = tipDist > pipDist * 1.08 && dist(t, m) > dist(p, m) * 1.15;
  const unfolded = dist(t, m) > mcpDist * 0.55;
  return open && unfolded;
}

function thumbExtended(lm: NormalizedLandmark[]): boolean {
  const tip = lm[4]!;
  const ip = lm[3]!;
  const mcp = lm[2]!;
  const indexMcp = lm[5]!;
  const indexPip = lm[6]!;
  const indexTip = lm[8]!;
  const middlePip = lm[10]!;
  const middleTip = lm[12]!;
  const ringTip = lm[16]!;
  const pinkyMcp = lm[17]!;
  const palm = dist(indexMcp, pinkyMcp) || 0.08;
  // Unfolded along the thumb bones — tucked thumbs fail this
  if (dist(mcp, tip) < dist(mcp, ip) * 1.42) return false;
  // Tip must sit away from the curled-finger bundle, not hugging the fist
  const fist = {
    x: (indexTip.x + middleTip.x + ringTip.x) / 3,
    y: (indexTip.y + middleTip.y + ringTip.y) / 3,
    z: tip.z ?? 0,
  };
  if (dist(tip, fist) < palm * 0.9) return false;
  if (dist(tip, indexPip) < palm * 0.75) return false;
  if (dist(tip, middlePip) < palm * 0.68) return false;
  if (dist(tip, indexMcp) < palm * 0.78) return false;
  return true;
}

function classifyRps(lm: NormalizedLandmark[]): {
  gesture: CamGesture;
  mode: HandMode | null;
  confidence: number;
  label: string;
} {
  const index = fingerExtended(lm, 8, 6, 5);
  const middle = fingerExtended(lm, 12, 10, 9);
  const ring = fingerExtended(lm, 16, 14, 13);
  const pinky = fingerExtended(lm, 20, 18, 17);
  const thumb = thumbExtended(lm);
  const extCount = [index, middle, ring, pinky].filter(Boolean).length;
  const indexOpen = fingerOpen(lm, 8, 6, 5);
  const middleOpen = fingerOpen(lm, 12, 10, 9);
  const ringOpen = fingerOpen(lm, 16, 14, 13);
  const pinkyOpen = fingerOpen(lm, 20, 18, 17);
  const openCount = [indexOpen, middleOpen, ringOpen, pinkyOpen].filter(Boolean).length;

  // Thumbs up/down only when the thumb is clearly sticking OUT of a closed fist.
  // A tucked / wrapping thumb is just rock / punch.
  if (thumb && extCount === 0) {
    const tip = lm[4]!;
    const wrist = lm[0]!;
    const knuckleY = lm[5]!.y;
    // Image y grows downward — need a real stick-up / stick-down, not a 4% wobble
    if (tip.y < Math.min(wrist.y, knuckleY) - 0.07) {
      return { gesture: "thumbs", mode: null, confidence: 0.9, label: "thumbs_up" };
    }
    if (tip.y > Math.max(wrist.y, knuckleY) + 0.07) {
      return { gesture: "thumbsDown", mode: null, confidence: 0.9, label: "thumbs_down" };
    }
    return { gesture: "punch", mode: "punch", confidence: 0.88, label: "rock" };
  }

  // Punch first: thumb + fingers bunched together is never a heart, any orientation.
  {
    const thumbTip = lm[4]!;
    const indexTip = lm[8]!;
    const indexPip = lm[6]!;
    const middleTip = lm[12]!;
    const middlePip = lm[10]!;
    const palm = dist(lm[5]!, lm[17]!) || 0.08;
    const toIndex = dist(thumbTip, indexTip);
    const toPip = dist(thumbTip, indexPip);
    const toMid = dist(thumbTip, middleTip);
    const toMidPip = dist(thumbTip, middlePip);
    const fingersFolded = !index && !middle;
    const thumbOnMass = toIndex < palm * 0.80 || toPip < palm * 0.58 || toMid < palm * 0.80 || toMidPip < palm * 0.58;
    if (fingersFolded && thumbOnMass && extCount <= 2) {
      return { gesture: "punch", mode: "punch", confidence: 0.95, label: "rock" };
    }
    if (extCount === 0 && toIndex < palm * 0.92) {
      return { gesture: "punch", mode: "punch", confidence: 0.93, label: "rock" };
    }
  }

  // Scissors: two blades OUT (together or a wide V), other two not straight. Ignore thumb.
  {
    const indexS = fingerBlade(lm, 8, 6, 5);
    const middleS = fingerBlade(lm, 12, 10, 9);
    const ringT = !fingerStraight(lm, 16, 14, 13) && !fingerOpen(lm, 16, 14, 13);
    const pinkyT = !fingerStraight(lm, 20, 18, 17) && !fingerOpen(lm, 20, 18, 17);
    if (indexS && middleS && ringT && pinkyT) {
      const indexTip = lm[8]!;
      const wristLm = lm[0]!;
      const up = wristLm.y - indexTip.y;
      const side = Math.abs(indexTip.x - wristLm.x);
      if (up > 0.05 && up > side * 1.1) {
        return { gesture: "peace", mode: null, confidence: 0.9, label: "peace" };
      }
      return { gesture: "poke", mode: "poke", confidence: 0.94, label: "scissors" };
    }
  }

  // Half-heart: ONLY thumb + index. Ignore other fingers. Thumb BELOW index (image y grows down).
  {
    const tip = lm[4]!;
    const indexTip = lm[8]!;
    const indexPip = lm[6]!;
    const wristLm = lm[0]!;
    const palm = dist(lm[5]!, lm[17]!) || 0.08;
    const aperture = dist(tip, indexTip);
    const tucked = dist(tip, indexPip) < palm * 0.38;
    const indexReach = dist(indexTip, wristLm) > palm * 0.62;
    const thumbBelow = tip.y > indexTip.y + 0.02;
    const openC = aperture > palm * 0.82 && aperture < palm * 3.2;
    if (!tucked && indexReach && openC && thumbBelow) {
      return { gesture: "heart", mode: null, confidence: 0.92, label: "half_heart" };
    }
  }

  // Rock / fist
  if (extCount === 0 || (extCount === 1 && !index && !middle)) {
    return { gesture: "punch", mode: "punch", confidence: 0.9, label: "rock" };
  }

  // Spock only for a real Vulcan split. Modest spread is still paper.
  if (openCount >= 4) {
    const midTip = lm[12]!;
    const ringTip = lm[16]!;
    const indexTip = lm[8]!;
    const pinkyTip = lm[20]!;
    const gap = dist(midTip, ringTip);
    const idxMid = dist(indexTip, midTip);
    const ringPinky = dist(ringTip, pinkyTip);
    const palm = dist(lm[5]!, lm[17]!) || 0.08;
    const vulcan = gap > palm * 0.9 && gap > idxMid * 1.7 && gap > ringPinky * 1.7;
    if (vulcan) {
      return { gesture: "spock", mode: null, confidence: 0.86, label: "spock" };
    }
    return { gesture: "slap", mode: "slap", confidence: 0.9, label: "paper" };
  }
  if (openCount >= 3) {
    return { gesture: "slap", mode: "slap", confidence: 0.9, label: "paper" };
  }

  // Scissors already handled with a blade test above.
  if (index && middle && !ring && !pinky) {
    const indexS = fingerBlade(lm, 8, 6, 5);
    const middleS = fingerBlade(lm, 12, 10, 9);
    if (indexS && middleS) {
      const indexTip = lm[8]!;
      const wristLm = lm[0]!;
      const up = wristLm.y - indexTip.y;
      const side = Math.abs(indexTip.x - wristLm.x);
      if (up > 0.045 && up > side * 1.05) {
        return { gesture: "peace", mode: null, confidence: 0.9, label: "peace" };
      }
      return { gesture: "poke", mode: "poke", confidence: 0.92, label: "scissors" };
    }
  }
  // Birdie: middle finger only
  if (middle && !index && !ring && !pinky) {
    return { gesture: "birdie", mode: null, confidence: 0.9, label: "birdie" };
  }
  // Rock: fist — 0–1 fingers extended (thumb may peek but not full thumbs pose)
  if (extCount === 0 || (extCount === 1 && !index && !middle && !ring && !pinky && !thumb)) {
    return { gesture: "punch", mode: "punch", confidence: 0.9, label: "rock" };
  }
  if (extCount <= 1 && !index && !middle && !thumb) {
    return { gesture: "punch", mode: "punch", confidence: 0.82, label: "rock" };
  }
  // Fist with tucked thumb
  if (extCount === 0 && !thumb) {
    return { gesture: "punch", mode: "punch", confidence: 0.9, label: "rock" };
  }
  // Paper: open hand — 3–4 fingers actually straight (together or spread is fine)
  if (openCount >= 3) {
    return { gesture: "slap", mode: "slap", confidence: 0.9, label: "paper" };
  }
  // Half-curl is a fist, not paper — keep mode from sticking on slap.
  if (openCount < 3) {
    return { gesture: "punch", mode: "punch", confidence: 0.72, label: "rock" };
  }
  return { gesture: "none", mode: null, confidence: 0.2, label: "unknown" };
}

type Hist = {
  t: number;
  size: number;
  z: number;
  my: number;
  mx: number;
  palmFacing: number;
};
type StrikeInfo = {
  strike: boolean;
  uppercut: boolean;
  slap: boolean;
  slapDir: -1 | 0 | 1;
  slapStyle: "palm" | "backhand" | null;
  palmFacing: number;
  thrust: number;
  swipe: number;
  lift: number;
};

/**
 * Palm toward camera (+1) vs backhand (+/- with magnitude).
 * Uses 2D cross of wrist→indexMCP × wrist→pinkyMCP, signed by handedness.
 * MediaPipe y grows downward; Right palm-to-camera typically has positive cross.
 */
function computePalmFacing(
  lm: NormalizedLandmark[],
  handednessLabel: string,
): number {
  const w = lm[0]!;
  const i = lm[5]!; // index MCP
  const p = lm[17]!; // pinky MCP
  // 2D cross (image plane)
  const cross2 =
    (i.x - w.x) * (p.y - w.y) - (i.y - w.y) * (p.x - w.x);
  // 3D normal z (toward/away from camera)
  const vix = i.x - w.x,
    viy = i.y - w.y,
    viz = (i.z ?? 0) - (w.z ?? 0);
  const vpx = p.x - w.x,
    vpy = p.y - w.y,
    vpz = (p.z ?? 0) - (w.z ?? 0);
  const nz = vix * vpy - viy * vpx;
  const ny = vpz * vix - viz * vpx;
  // Blend 2D cross + 3D cues
  let raw = cross2 * 8 + nz * 4 + ny * 0.5;
  // Left hand mirrors the sign
  const isRight = /right/i.test(handednessLabel);
  if (!isRight) raw = -raw;
  // Positive = palm toward camera
  return Math.max(-1, Math.min(1, raw * 12));
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function palmSize(lm: NormalizedLandmark[]) {
  return dist(lm[0]!, lm[9]!);
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export class HandCameraTracker {
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private recognizer: GestureRecognizer | null = null;
  private active = false;
  private loading = false;
  private lastVideoTime = -1;
  private lastTs = 0;
  private history = new Map<"L" | "R", Hist[]>();
  private strikeCd = new Map<"L" | "R", number>();
  private lastResult: HandTrackFrame = { hands: [], ready: false, error: null };
  private error: string | null = null;
  private modeStableL: HandMode | null = null;
  private modeStableR: HandMode | null = null;
  private modeHoldL: HandMode | null = null;
  private modeHoldR: HandMode | null = null;
  private modeHoldFramesL = 0;
  private modeHoldFramesR = 0;
  /** Finger-click state: thumb-middle pinch → release */
  private clickState = new Map<"L" | "R", {
    wasClosed: boolean;
    lastDist: number;
    cdUntil: number;
    thumbY: number;
    fingerY: number;
  }>();
  private snipState = new Map<"L" | "R", {
    open: boolean;
    peakGap: number;
    lastGap: number;
    cdUntil: number;
    t: number;
  }>();

  constructor() {
    this.video = document.createElement("video");
    this.video.setAttribute("playsinline", "true");
    this.video.setAttribute("webkit-playsinline", "true");
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
  }

  getVideo(): HTMLVideoElement {
    return this.video;
  }

  isActive() {
    return this.active;
  }

  isLoading() {
    return this.loading;
  }

  getError() {
    return this.error;
  }

  getLastFrame() {
    return this.lastResult;
  }

  getStableMode(side?: "L" | "R"): HandMode | null {
    if (side === "L") return this.modeStableL;
    if (side === "R") return this.modeStableR;
    return this.modeStableR ?? this.modeStableL;
  }

  getStableModes(): { L: HandMode | null; R: HandMode | null } {
    return { L: this.modeStableL, R: this.modeStableR };
  }

  async start(): Promise<void> {
    if (this.active || this.loading) return;
    this.loading = true;
    this.error = null;
    let stage = "init";
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera not available in this browser (needs HTTPS or localhost)");
      }
      stage = "camera";
      console.info("[camera] Requesting webcam…");
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
      } catch (camErr) {
        // Fallback: any video device without facingMode constraints
        console.warn("[camera] Ideal constraints failed, retrying simple getUserMedia", camErr);
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }
      this.video.srcObject = this.stream;
      // Ensure metadata before play (some desktops stall otherwise)
      await new Promise<void>((resolve, reject) => {
        const v = this.video;
        if (v.readyState >= 1) {
          resolve();
          return;
        }
        const t = window.setTimeout(() => reject(new Error("Webcam timed out loading video")), 8000);
        v.onloadedmetadata = () => {
          window.clearTimeout(t);
          resolve();
        };
        v.onerror = () => {
          window.clearTimeout(t);
          reject(new Error("Webcam video element error"));
        };
      });
      await this.video.play();
      console.info("[camera] Webcam live", this.video.videoWidth, "x", this.video.videoHeight);

      if (!this.recognizer) {
        stage = "mediapipe";
        console.info("[camera] Loading hand tracker (MediaPipe)…");
        this.recognizer = await this.createRecognizer();
        console.info("[camera] Hand tracker ready");
      }

      this.active = true;
      this.loading = false;
      this.error = null;
      this.lastResult = { hands: [], ready: true, error: null };
    } catch (err) {
      this.loading = false;
      this.active = false;
      this.stopTracks();
      const raw = err instanceof Error ? err : new Error(String(err));
      let msg: string;
      if (raw.name === "NotAllowedError" || /Permission|NotAllowed/i.test(raw.message)) {
        msg = "Camera permission denied — allow camera access and try again";
      } else if (raw.name === "NotFoundError" || /NotFound|no.*device/i.test(raw.message)) {
        msg = "No camera found — plug in a webcam or enable one in system settings";
      } else if (raw.name === "NotReadableError" || /NotReadable|in use/i.test(raw.message)) {
        msg = "Camera is busy — close other apps using the webcam and retry";
      } else if (stage === "mediapipe") {
        msg = `Hand tracker failed to load: ${raw.message || raw.name}`.slice(0, 160);
      } else {
        msg = (raw.message || "Failed to start camera").slice(0, 160);
      }
      console.error("[camera] start failed @", stage, raw);
      this.error = msg;
      this.lastResult = { hands: [], ready: false, error: msg };
      throw new Error(msg);
    }
  }

  stop() {
    this.active = false;
    this.loading = false;
    this.stopTracks();
    this.history.clear();
    this.strikeCd.clear();
    this.modeStableL = null;
    this.modeStableR = null;
    this.modeHoldL = null;
    this.modeHoldR = null;
    this.modeHoldFramesL = 0;
    this.modeHoldFramesR = 0;
    this.lastResult = { hands: [], ready: false, error: this.error };
  }

  dispose() {
    this.stop();
    try {
      this.recognizer?.close();
    } catch {
      /* */
    }
    this.recognizer = null;
  }

  /** Call once per game frame. */
  poll(nowMs: number): HandTrackFrame {
    if (!this.active || !this.recognizer || this.video.readyState < 2) {
      return this.lastResult;
    }

    if (this.video.currentTime === this.lastVideoTime) {
      return this.lastResult;
    }
    this.lastVideoTime = this.video.currentTime;
    const ts = Math.max(nowMs, this.lastTs + 1);
    this.lastTs = ts;

    let result: GestureRecognizerResult;
    try {
      result = this.recognizer.recognizeForVideo(this.video, ts);
    } catch {
      return this.lastResult;
    }

    const hands: TrackedHand[] = [];
    const n = result.landmarks?.length ?? 0;

    for (let i = 0; i < n; i++) {
      const lm = result.landmarks[i]!;
      const handed = result.handedness?.[i]?.[0];
      const label = (handed?.categoryName || "").toLowerCase();
      // MediaPipe labels from the person's perspective
      let side: "L" | "R" = label.includes("left") ? "L" : "R";
      if (!handed) {
        // unmirrored feed: low x ≈ person's right
        side = lm[0]!.x < 0.5 ? "R" : "L";
      }

      const gCat = result.gestures?.[i]?.[0];
      const gName = gCat?.categoryName || "None";
      const mpScore = gCat?.score ?? 0;
      // Landmark RPS is primary (accurate scissors = index+middle only)
      const rps = classifyRps(lm);
      // MediaPipe canned as backup / specials
      const mpGesture = GESTURE_TO_CAM[gName] ?? "none";
      const mpMode = GESTURE_TO_MODE[gName] ?? null;

      let gesture: CamGesture = rps.gesture;
      let mode: HandMode | null = rps.mode;
      let score = rps.confidence;

      // MediaPipe often labels a regular fist as Thumb_Up — only trust it when
      // landmarks also show the thumb sticking away from the fist.
      if (
        (gName === "ILoveYou" || gName === "Victory") &&
        mpScore > 0.55
      ) {
        gesture = mpGesture;
        if (gName === "Victory" && rps.mode === "poke") mode = "poke";
        else mode = null;
        score = mpScore;
      } else if (
        (gName === "Thumb_Up" || gName === "Thumb_Down") &&
        mpScore > 0.7 &&
        (rps.gesture === "thumbs" || rps.gesture === "thumbsDown")
      ) {
        gesture = mpGesture;
        mode = null;
        score = mpScore;
      } else if (
        rps.gesture === "thumbs" ||
        rps.gesture === "thumbsDown" ||
        rps.gesture === "spock" ||
        rps.gesture === "birdie"
      ) {
        gesture = rps.gesture;
        mode = null;
        score = rps.confidence;
      } else if (rps.confidence < 0.55 && mpMode && mpScore > 0.6) {
        // fall back to MediaPipe rock/paper/victory if geometry unsure —
        // never trust Open_Palm when landmarks say the fingers aren't straight
        if (!(mpMode === "slap" && rps.mode === "punch")) {
          gesture = mpGesture;
          mode = mpMode;
          score = mpScore;
        }
      } else if (rps.mode && mpMode && rps.mode === mpMode) {
        score = Math.min(1, rps.confidence * 0.55 + mpScore * 0.5);
      }

      const wrist = lm[0]!;
      const mid = lm[9]!; // middle MCP
      const index = lm[5]!;
      const pinky = lm[17]!;
      const size = palmSize(lm);
      const z = wrist.z ?? 0;

      // Mirror so coords match the mirrored PIP (and natural left/right on screen)
      const mx = 1 - wrist.x;
      const my = wrist.y;
      const midMx = 1 - mid.x;
      const midMy = mid.y;
      const idxMx = 1 - index.x;
      const pkyMx = 1 - pinky.x;

      // Palm points toward fingers in mirrored image space
      let dirX = midMx - mx;
      let dirY = midMy - my;
      const dirLen = Math.hypot(dirX, dirY) || 1;
      dirX /= dirLen;
      dirY /= dirLen;

      // Roll: line from pinky MCP → index MCP (mirrored)
      const roll = Math.atan2(index.y - pinky.y, idxMx - pkyMx);

      // Closeness from palm size + depth
      const sizeClose = clamp01((size - 0.06) / 0.22);
      const zClose = clamp01((-z - 0.0) / 0.18);
      const closeness = clamp01(sizeClose * 0.65 + zClose * 0.35);

      const palmFacing = computePalmFacing(lm, handed?.categoryName || (side === "R" ? "Right" : "Left"));
      const motion = this.detectStrike(side, size, z, my, mx, palmFacing, nowMs);
      const fingerClick = this.detectFingerClick(side, lm, nowMs);
      const snipInfo = this.detectScissorSnip(side, lm, nowMs, mode === "poke" || gesture === "poke");

      // Mirrored landmarks for skeleton overlay
      const landmarks: TrackedLandmark[] = lm.map((p) => ({
        x: 1 - p.x,
        y: p.y,
      }));

      hands.push({
        side,
        gesture,
        mode,
        mx,
        my,
        z,
        palmSize: size,
        closeness,
        dirX,
        dirY,
        roll,
        strike: motion.strike,
        uppercut: motion.uppercut,
        slap: motion.slap,
        slapDir: motion.slapDir,
        slapStyle: motion.slapStyle,
        palmFacing: motion.palmFacing,
        thrust: motion.thrust,
        swipe: motion.swipe,
        lift: motion.lift,
        click: fingerClick,
        snip: snipInfo.snip,
        snipPower: snipInfo.power,
        score,
        landmarks,
        wristX: wrist.x,
        wristY: wrist.y,
      });
    }

    // Per-hand mode lock (L and R can differ: rock+paper, scissors+rock, …)
    for (const side of ["L", "R"] as const) {
      const hand = hands.find((h) => h.side === side);
      const modeCandidate = hand?.mode ?? null;
      if (!modeCandidate) continue;
      if (side === "L") {
        if (modeCandidate === this.modeHoldL) this.modeHoldFramesL++;
        else {
          this.modeHoldL = modeCandidate;
          this.modeHoldFramesL = 1;
        }
        if (this.modeHoldFramesL >= 6) this.modeStableL = modeCandidate;
      } else {
        if (modeCandidate === this.modeHoldR) this.modeHoldFramesR++;
        else {
          this.modeHoldR = modeCandidate;
          this.modeHoldFramesR = 1;
        }
        if (this.modeHoldFramesR >= 6) this.modeStableR = modeCandidate;
      }
    }

    this.lastResult = { hands, ready: true, error: null };
    return this.lastResult;
  }

  
  /**
   * Finger snap: thumb + finger together with thumb BELOW the finger,
   * then thumb flicks up and the finger flicks down.
   */
  private detectFingerClick(
    side: "L" | "R",
    lm: NormalizedLandmark[],
    nowMs: number,
  ): boolean {
    const thumb = lm[4];
    const middle = lm[12];
    const index = lm[8];
    if (!thumb || (!middle && !index)) return false;
    const palm = palmSize(lm) || 0.1;
    const dMid = middle ? dist(thumb, middle) / palm : 99;
    const dIdx = index ? dist(thumb, index) / palm : 99;
    const useMid = dMid <= dIdx * 1.12;
    const finger = useMid && middle ? middle : index;
    if (!finger) return false;
    const d = Math.min(dMid, dIdx);
    let st = this.clickState.get(side);
    if (!st) {
      st = { wasClosed: false, lastDist: d, cdUntil: 0, thumbY: thumb.y, fingerY: finger.y };
      this.clickState.set(side, st);
    }
    if (nowMs < st.cdUntil) {
      st.lastDist = d;
      return false;
    }
    const CLOSED = 0.58;
    const OPEN = 0.88;
    // Image y grows downward — thumb below the finger means a larger y
    const thumbBelow = thumb.y >= finger.y - 0.012;
    let clicked = false;
    if (!st.wasClosed && d < CLOSED && thumbBelow) {
      st.wasClosed = true;
      st.thumbY = thumb.y;
      st.fingerY = finger.y;
    } else if (st.wasClosed) {
      const thumbUp = st.thumbY - thumb.y; // smaller y = higher on screen
      const fingerDown = finger.y - st.fingerY;
      const rightWay = thumbUp > 0.008 && fingerDown > -0.006;
      const snap = thumbUp > 0.014 && fingerDown > 0.006;
      if ((d > OPEN || (d > CLOSED * 1.12 && d - st.lastDist > 0.1)) && (snap || rightWay)) {
        clicked = true;
        st.wasClosed = false;
        st.cdUntil = nowMs + 400;
      } else if (d > OPEN * 1.3 || thumbUp < -0.02) {
        st.wasClosed = false;
      }
    }
    st.lastDist = d;
    return clicked;
  }

  /** Index + middle open into a V, then close together → scissors shot. */
  private detectScissorSnip(
    side: "L" | "R",
    lm: NormalizedLandmark[],
    nowMs: number,
    blades: boolean,
  ): { snip: boolean; power: number } {
    const index = lm[8];
    const middle = lm[12];
    if (!index || !middle) return { snip: false, power: 0 };
    const palm = palmSize(lm) || 0.1;
    const gap = dist(index, middle);
    let st = this.snipState.get(side);
    if (!st) {
      st = { open: false, peakGap: 0, lastGap: gap, cdUntil: 0, t: nowMs };
      this.snipState.set(side, st);
    }
    const dt = Math.min(0.08, Math.max(0.008, (nowMs - (st.t || nowMs)) / 1000));
    st.t = nowMs;
    if (nowMs < st.cdUntil) {
      st.lastGap = gap;
      return { snip: false, power: 0 };
    }
    if (!blades) {
      const indexOut = fingerBlade(lm, 8, 6, 5);
      const middleOut = fingerBlade(lm, 12, 10, 9);
      if (!indexOut || !middleOut) {
        st.open = false;
        st.peakGap = 0;
      }
      st.lastGap = gap;
      return { snip: false, power: 0 };
    }
    const OPEN = palm * 0.42;
    const CLOSE = palm * 0.22;
    const MIN_PEAK = palm * 0.48;
    if (gap > OPEN) {
      st.open = true;
      st.peakGap = Math.max(st.peakGap || 0, gap);
    }
    const vel = ((st.lastGap || gap) - gap) / dt;
    const crossed = st.open && (st.peakGap || 0) >= MIN_PEAK && (st.lastGap || 0) >= CLOSE && gap < CLOSE;
    const snipped = crossed && vel > 0.08;
    st.lastGap = gap;
    if (!snipped) return { snip: false, power: 0 };
    const travel = Math.max(0.01, (st.peakGap || gap) - gap);
    st.open = false;
    st.peakGap = 0;
    st.cdUntil = nowMs + 280;
    const power = Math.max(0.3, Math.min(1.35, 0.32 + travel * 6 + vel * 0.1));
    return { snip: true, power };
  }

  private detectStrike(
    side: "L" | "R",
    size: number,
    z: number,
    my: number,
    mx: number,
    palmFacing: number,
    nowMs: number,
  ): StrikeInfo {
    const none: StrikeInfo = {
      strike: false,
      uppercut: false,
      slap: false,
      slapDir: 0,
      slapStyle: null,
      palmFacing,
      thrust: 0,
      swipe: 0,
      lift: 0,
    };
    let hist = this.history.get(side);
    if (!hist) {
      hist = [];
      this.history.set(side, hist);
    }
    hist.push({ t: nowMs, size, z, my, mx, palmFacing });
    while (hist.length > 14) hist.shift();
    while (hist.length && nowMs - hist[0]!.t > 240) hist.shift();
    if (hist.length < 3) return none;

    const oldest = hist[0]!;
    const newest = hist[hist.length - 1]!;
    const dt = (newest.t - oldest.t) / 1000;
    if (dt < 0.035) return none;

    const sizeVel = (newest.size - oldest.size) / dt;
    const zVel = (oldest.z - newest.z) / dt; // + when approaching camera
    // Image y grows downward → negative yVel = hand rising (uppercut)
    const yVel = (newest.my - oldest.my) / dt;
    const upVel = -yVel; // + when rising
    const mxVel = (newest.mx - oldest.mx) / dt; // mirrored screen x
    // Average palm facing over window (stable)
    let faceSum = 0;
    for (const h of hist) faceSum += h.palmFacing;
    const faceAvg = faceSum / hist.length;
    const faceNow = newest.palmFacing;

    const thrust = Math.max(
      0,
      Math.min(1, Math.max(sizeVel / 0.75, zVel / 0.95) * 0.95),
    );
    const swipe = Math.max(0, Math.min(1, Math.abs(mxVel) / 1.05));
    const lift = Math.max(0, Math.min(1, upVel / 1.55));

    const cd = this.strikeCd.get(side) ?? 0;
    if (nowMs < cd) return { ...none, thrust, swipe, lift, palmFacing: faceNow };

    // --- Priority: uppercut > slap > jab ---
    // Uppercut: fist rockets UP (screen), stronger than forward/side
    const upperHit =
      upVel > 1.05 &&
      lift > 0.48 &&
      upVel > Math.abs(mxVel) * 0.95 &&
      upVel > Math.max(sizeVel, zVel) * 0.75;

    // Horizontal slap: shorter left/right whoosh is enough
    const slapHit =
      !upperHit &&
      Math.abs(mxVel) > 0.48 &&
      Math.abs(mxVel) > Math.max(sizeVel, zVel, upVel * 0.65) * 0.7 &&
      swipe > 0.2;

    // Forward jab: smaller palm grow / depth approach triggers
    const punchHit =
      !upperHit &&
      !slapHit &&
      upVel < 0.9 &&
      (sizeVel > 0.26 || zVel > 0.4 || (sizeVel > 0.16 && zVel > 0.18));

    if (upperHit) {
      this.strikeCd.set(side, nowMs + 520);
      this.history.set(side, []);
      return {
        strike: false,
        uppercut: true,
        slap: false,
        slapDir: 0,
        slapStyle: null,
        palmFacing: faceNow,
        thrust: Math.max(thrust, lift),
        swipe,
        lift: Math.max(lift, 0.88),
      };
    }

    if (slapHit) {
      // Palm slap: palm faces camera (or faces the swipe direction more openly)
      // Backhand: back of hand toward camera
      const slapStyle: "palm" | "backhand" = faceAvg >= 0.08 ? "palm" : "backhand";
      this.strikeCd.set(side, nowMs + 380);
      this.history.set(side, []);
      return {
        strike: false,
        uppercut: false,
        slap: true,
        slapDir: mxVel >= 0 ? 1 : -1,
        slapStyle,
        palmFacing: faceAvg,
        thrust,
        swipe: Math.max(swipe, 0.75),
        lift,
      };
    }

    if (punchHit) {
      this.strikeCd.set(side, nowMs + 380);
      this.history.set(side, []);
      return {
        strike: true,
        uppercut: false,
        slap: false,
        slapDir: 0,
        slapStyle: null,
        palmFacing: faceNow,
        thrust: Math.max(thrust, 0.75),
        swipe,
        lift,
      };
    }
    return { ...none, thrust, swipe, lift, palmFacing: faceNow };
  }

  private stopTracks() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this.lastVideoTime = -1;
  }

  private async createRecognizer(): Promise<GestureRecognizer> {
    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
      new Promise<T>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms);
        p.then(
          (v) => {
            window.clearTimeout(t);
            resolve(v);
          },
          (e) => {
            window.clearTimeout(t);
            reject(e);
          },
        );
      });

    let vision;
    let wasmPath = WASM_LOCAL;
    try {
      vision = await withTimeout(FilesetResolver.forVisionTasks(WASM_LOCAL), 12000, "Local WASM");
      console.info("[camera] MediaPipe WASM (local)");
    } catch (e1) {
      console.warn("[camera] Local WASM failed, trying CDN", e1);
      wasmPath = WASM_CDN;
      vision = await withTimeout(FilesetResolver.forVisionTasks(WASM_CDN), 20000, "CDN WASM");
      console.info("[camera] MediaPipe WASM (CDN)");
    }

    const base = {
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    const models = [MODEL_LOCAL, MODEL_CDN];
    // CPU first — GPU delegate often throws cryptic WebGL errors on desktop
    const delegates: Array<"CPU" | "GPU"> = ["CPU", "GPU"];
    let lastErr: unknown = null;

    for (const model of models) {
      for (const delegate of delegates) {
        try {
          console.info("[camera] GestureRecognizer", { model, delegate, wasmPath });
          const rec = await withTimeout(
            GestureRecognizer.createFromOptions(vision, {
              ...base,
              baseOptions: { modelAssetPath: model, delegate },
            }),
            25000,
            `GestureRecognizer ${delegate}`,
          );
          console.info("[camera] GestureRecognizer OK", delegate, model);
          return rec;
        } catch (e) {
          lastErr = e;
          console.warn("[camera] GestureRecognizer attempt failed", { model, delegate, e });
        }
      }
    }

    const detail =
      lastErr instanceof Error ? lastErr.message : lastErr != null ? String(lastErr) : "unknown";
    throw new Error(`MediaPipe init failed (${detail})`.slice(0, 180));
  }
}

/**
 * Map a tracked hand (mirrored selfie space) into first-person overlay glove space.
 * Overlay camera looks down −Z; more negative z = further into the scene (away from lens).
 */
export function trackedHandToOverlay(
  h: TrackedHand,
  opts?: { mobile?: boolean },
): {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
} {
  const mobile = !!opts?.mobile;
  // Horizontal: mirrored x → screen left/right (tighter on mobile so hands stay on-screen)
  const xSpan = mobile ? 1.05 : 1.4;
  const x = (h.mx - 0.5) * xSpan;
  // Vertical: top of frame is up — slight upward bias on mobile (above controls)
  const y = (0.52 - h.my) * (mobile ? 0.95 : 1.15) + (mobile ? 0.08 : 0);
  // Depth: far from camera into the arena (was too close to the lens)
  // Range roughly −1.15 … −1.85 (mobile a bit deeper)
  const z = mobile
    ? -1.25 - h.closeness * 0.45
    : -1.05 - h.closeness * 0.5;

  // Palm-follow, but keep weapons mostly horizontal / pointing into the scene.
  const rotX = h.dirY * 0.35 - 0.12 + h.closeness * -0.18 + (mobile ? -0.06 : 0);
  const rotY = (h.mx - 0.5) * -0.45 + (h.side === "L" ? 0.12 : -0.12);
  const rotZ = h.roll * 0.45 + h.dirX * -0.4;

  // Scale for depth — a bit larger so deep placement still reads
  const scale = (mobile ? 1.45 : 1.15) + h.closeness * (mobile ? 0.22 : 0.18);
  return { x, y, z, rotX, rotY, rotZ, scale };
}
