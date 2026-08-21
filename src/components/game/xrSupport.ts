/**
 * Cross-device WebXR detection + entry helpers.
 * Source of truth: .grok/skills/webxr/SKILL.md
 *
 * Four detection layers (never trust one):
 *  1. UA allowlist (stop phones)
 *  2. Spectacles 779×1024 screen
 *  3. Vision Pro = Safari + navigator.xr
 *  4. XRInputSource.profiles once a session exists
 */

export type XrVendor = "pico" | "quest" | "vive" | "vision-pro" | "spectacles" | null;
export type XrMode = "vr" | "ar" | null;
export type XrSessionKind = "immersive-vr" | "immersive-ar";

const FORCE_KEY = "glove-fight-force-webxr";

const HEADSET_UA_PATTERNS = [
  "oculusbrowser",
  "quest",
  "pico",
  "picobrowser",
  "vive",
  "htc",
  "vision pro",
  "visionos",
  "wolvic",
  "helios",
  "spectacles",
  "snap spectacles",
  "snapos",
  "snap os",
  "snapchat",
  "specs",
  "mobile vr",
  "xrbrowser",
];

export function getForceXrEnabled(): boolean {
  try {
    return localStorage.getItem(FORCE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setForceXrEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(FORCE_KEY, "1");
    else localStorage.removeItem(FORCE_KEY);
  } catch {
    /* */
  }
  cachedHeadsetProbe = null;
  cachedRawProbe = null;
}

export function isHeadsetUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator.userAgent || "").toLowerCase();
  if (HEADSET_UA_PATTERNS.some((p) => ua.includes(p))) return true;
  try {
    const uaData = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } })
      .userAgentData;
    const brands = uaData?.brands || [];
    for (const b of brands) {
      if (/oculus|meta|quest|pico|wolvic|helios|snap/i.test(b.brand || "")) return true;
    }
  } catch {
    /* */
  }
  return false;
}

export function isSpectaclesLikeScreen(): boolean {
  if (typeof window === "undefined" || !window.screen) return false;
  const w = window.screen.width;
  const h = window.screen.height;
  const match = (a: number, b: number) => a === 779 && b === 1024;
  return match(w, h) || match(h, w);
}

export function isAppleVisionProLikely(): boolean {
  if (typeof navigator === "undefined") return false;
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return false;
  const ua = navigator.userAgent || "";
  const isSafari = /Safari\//.test(ua) && !/(Chrome|CriOS|FxiOS|EdgiOS|Chromium)\//.test(ua);
  if (!isSafari) return false;
  return /Macintosh|iPad|Mobile|visionOS|Vision/i.test(ua);
}

export function isEmbeddedInIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.parent !== window || window.top !== window;
  } catch {
    return true;
  }
}

export function detectVendor(profiles: string[]): XrVendor {
  const p = profiles.map((s) => s.toLowerCase());
  if (p.some((s) => s.includes("pico"))) return "pico";
  if (p.some((s) => s.includes("apple-vision") || s.includes("visionos"))) return "vision-pro";
  if (p.some((s) => s.includes("snap") || s.includes("spectacles"))) return "spectacles";
  if (p.some((s) => s.includes("meta-quest") || s.includes("oculus"))) return "quest";
  if (p.some((s) => s.includes("htc") || s.includes("vive"))) return "vive";
  return null;
}

export function guessVendorPreSession(): XrVendor {
  if (isSpectaclesLikeScreen()) return "spectacles";
  if (isAppleVisionProLikely()) return "vision-pro";
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
  if (/pico/.test(ua)) return "pico";
  if (/oculus|quest|meta/.test(ua)) return "quest";
  if (/vive|htc|wolvic/.test(ua)) return "vive";
  if (/spectacles|snapos|snapchat/.test(ua)) return "spectacles";
  return null;
}

export function friendlyHeadsetName(vendor: XrVendor, profiles: string[] = []): string {
  if (vendor === "quest") return "Meta Quest";
  if (vendor === "pico") return "Pico";
  if (vendor === "vive") return "Vive / Wolvic";
  if (vendor === "vision-pro") return "Apple Vision Pro";
  if (vendor === "spectacles") return "Snap Spectacles";
  if (isSpectaclesLikeScreen()) return "Snap Spectacles";
  if (isAppleVisionProLikely()) return "Apple Vision Pro";
  if (isHeadsetUserAgent()) return "XR Headset";
  if (profiles.length) return profiles[0] || "XR Headset";
  return "XR Headset";
}

/** Headset-like (or Force XR). Phones with ARCore are false unless forced. */
export function isHeadsetLike(): boolean {
  return (
    isHeadsetUserAgent() ||
    isSpectaclesLikeScreen() ||
    isAppleVisionProLikely() ||
    getForceXrEnabled()
  );
}

export type XrProbe = {
  vr: boolean;
  ar: boolean;
  /** Preferred session string, device-aware */
  preferred: XrSessionKind | null;
  preferredMode: XrMode;
  isHeadset: boolean;
  vendorGuess: XrVendor;
  embedded: boolean;
  deviceName: string;
};

function pickPreferred(vr: boolean, ar: boolean, vendor: XrVendor): XrSessionKind | null {
  // Spectacles: AR only
  if (vendor === "spectacles") return ar ? "immersive-ar" : null;
  // Vision Pro: VR only — never auto-pick AR
  if (vendor === "vision-pro") return vr ? "immersive-vr" : ar ? "immersive-ar" : null;
  // Quest / Pico: VR first (AR selectable)
  if (vendor === "quest" || vendor === "pico" || vendor === "vive") {
    if (vr) return "immersive-vr";
    if (ar) return "immersive-ar";
    return null;
  }
  if (vr) return "immersive-vr";
  if (ar) return "immersive-ar";
  return null;
}

let cachedHeadsetProbe: Promise<XrProbe> | null = null;
let cachedRawProbe: Promise<{ vr: boolean; ar: boolean }> | null = null;

export function resetXrDetectionCache(): void {
  cachedHeadsetProbe = null;
  cachedRawProbe = null;
}

export function detectRawXR(): Promise<{ vr: boolean; ar: boolean }> {
  return (cachedRawProbe ??= (async () => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    let vr = false;
    let ar = false;
    if (xr?.isSessionSupported) {
      try {
        vr = !!(await xr.isSessionSupported("immersive-vr"));
      } catch {
        vr = false;
      }
      try {
        ar = !!(await xr.isSessionSupported("immersive-ar"));
      } catch {
        ar = false;
      }
    }
    return { vr, ar };
  })());
}

export function detectXR(): Promise<XrProbe> {
  return (cachedHeadsetProbe ??= (async () => {
    const vendorGuess = guessVendorPreSession();
    const headset = isHeadsetLike();
    const embedded = isEmbeddedInIframe();
    const raw = await detectRawXR();
    let vr = raw.vr;
    let ar = raw.ar;
    // Headset UA but probe failed (typical sandboxed iframe) — still offer VR affordance
    if (headset && embedded && !vr && !ar) {
      vr = vendorGuess !== "spectacles";
      ar = vendorGuess === "spectacles";
    }
    const isHeadset = headset;
    const preferred = isHeadset ? pickPreferred(vr, ar, vendorGuess) : null;
    return {
      vr,
      ar,
      preferred,
      preferredMode: preferred === "immersive-ar" ? "ar" : preferred === "immersive-vr" ? "vr" : null,
      isHeadset,
      vendorGuess,
      embedded,
      deviceName: friendlyHeadsetName(vendorGuess),
    };
  })());
}

/** Minimal session init. Vision Pro / Snap / Pico reject exotic feature lists. */
export function sessionInitForVendor(_vendor: XrVendor): XRSessionInit {
  // Hand tracking on. Never request transient-pointer (Vision Pro gaze/pinch ray).
  // local-floor is OPTIONAL — Quest needs it for floor space; Pico/VP ignore if unsupported.
  // Do not put it in requiredFeatures (that rejects the whole session).
  return { optionalFeatures: ["hand-tracking", "local-floor"] };
}

/** Probe which reference space this live session actually supports. */
export async function pickXrReferenceSpace(session: XRSession): Promise<"local-floor" | "local" | "viewer"> {
  const enabled = (session as XRSession & { enabledFeatures?: string[] }).enabledFeatures || [];
  const order: Array<"local-floor" | "local" | "viewer"> = [];
  if (!enabled.length || enabled.includes("local-floor")) order.push("local-floor");
  order.push("local", "viewer");
  const seen = new Set<string>();
  for (const type of order) {
    if (seen.has(type)) continue;
    seen.add(type);
    try {
      await session.requestReferenceSpace(type);
      return type;
    } catch {
      /* try next */
    }
  }
  return "local";
}

/** Single mode to request on click. No fallback loop — retries burn activation. */
export function modeToRequest(probe: XrProbe, explicit?: XrMode): XrSessionKind {
  if (explicit === "ar") return "immersive-ar";
  if (explicit === "vr") return "immersive-vr";
  return probe.preferred || "immersive-vr";
}

export function attachInputSourceProfileTracking(
  session: XRSession,
  onChange: (info: { profiles: string[]; vendor: XrVendor }) => void,
): () => void {
  const update = () => {
    const set = new Set<string>();
    session.inputSources.forEach((src) => (src.profiles || []).forEach((x) => set.add(x)));
    const profiles = [...set];
    onChange({ profiles, vendor: detectVendor(profiles) });
  };
  const onEnd = () => {
    session.removeEventListener("inputsourceschange", update);
    session.removeEventListener("end", onEnd);
    onChange({ profiles: [], vendor: null });
  };
  session.addEventListener("inputsourceschange", update);
  session.addEventListener("end", onEnd);
  update();
  return () => {
    try {
      session.removeEventListener("inputsourceschange", update);
      session.removeEventListener("end", onEnd);
    } catch {
      /* */
    }
  };
}

export function isStaleXRSpaceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /XRSpace and XRFrame sessions do not match/i.test(msg) || /sessions do not match/i.test(msg);
}

export function safeGetPose(
  frame: XRFrame,
  space: XRSpace,
  ref: XRReferenceSpace,
): XRPose | null {
  try {
    return frame.getPose(space, ref);
  } catch (err) {
    if (isStaleXRSpaceError(err)) return null;
    throw err;
  }
}

export function safeGetJointPose(
  frame: XRFrame,
  joint: XRJointSpace,
  ref: XRReferenceSpace,
): XRJointPose | null {
  try {
    return frame.getJointPose?.(joint, ref) ?? null;
  } catch (err) {
    if (isStaleXRSpaceError(err)) return null;
    throw err;
  }
}

/** Hide Three.js / runtime pointer rays (gaze + pinch target-ray lines). */
export function hidePointerRays(root: { traverse?: (fn: (o: unknown) => void) => void } | null): void {
  if (!root || typeof root.traverse !== "function") return;
  root.traverse((o: unknown) => {
    const obj = o as { isLine?: boolean; isLineSegments?: boolean; type?: string; name?: string; visible?: boolean };
    if (!obj) return;
    const name = (obj.name || "").toLowerCase();
    if (
      obj.isLine ||
      obj.isLineSegments ||
      obj.type === "Line" ||
      obj.type === "LineSegments" ||
      /ray|pointer|cursor|reticle/.test(name)
    ) {
      obj.visible = false;
    }
  });
}

export function isGazeOrPinchSource(src: XRInputSource | null | undefined): boolean {
  if (!src) return false;
  const mode = src.targetRayMode;
  if (mode === "gaze" || mode === "transient-pointer") return true;
  const profiles = (src.profiles || []).map((s) => s.toLowerCase());
  return profiles.some((p) => p.includes("touch") && p.includes("gaze")) || profiles.some((p) => p.includes("transient"));
}

export type DeviceTuning = {
  cameraFar: number;
  depthNear: number;
  pixelRatioCap: number;
  quality: number;
  trails: boolean;
  hidePointerRays: boolean;
  ignoreSelectForAttack: boolean;
  handTracking: boolean;
  /** 0 disables shadows; otherwise square shadow-map size */
  shadowMapSize: number;
  particleScale: number;
  /** Hard cap on live burst particles */
  maxParticles: number;
  cheapGlass: boolean;
  /** 0–1 WebXR fixed foveation (1 = most savings) */
  foveation: number;
  cheapToneMap: boolean;
  simpleCrates: boolean;
  fogDensity: number;
  /** Box3D contact Hertz; lower = cheaper solver */
  physHertz: number;
};

function baseTune(over: Partial<DeviceTuning>): DeviceTuning {
  return {
    cameraFar: 90,
    depthNear: 0.1,
    pixelRatioCap: 1.6,
    quality: 1,
    trails: true,
    hidePointerRays: false,
    ignoreSelectForAttack: false,
    handTracking: true,
    shadowMapSize: 2048,
    particleScale: 1,
    maxParticles: 140,
    cheapGlass: false,
    foveation: 0,
    cheapToneMap: false,
    simpleCrates: false,
    fogDensity: 0.018,
    physHertz: 24,
    ...over,
  };
}

export function tuningForVendor(vendor: XrVendor): DeviceTuning {
  if (vendor === "vision-pro") {
    return baseTune({
      cameraFar: 1000,
      pixelRatioCap: 1.5,
      quality: 0.75,
      trails: false,
      hidePointerRays: true,
      ignoreSelectForAttack: true,
      shadowMapSize: 1024,
      particleScale: 0.7,
      maxParticles: 80,
      cheapGlass: true,
      foveation: 0.5,
      cheapToneMap: true,
      simpleCrates: true,
      fogDensity: 0.012,
      physHertz: 18,
    });
  }
  if (vendor === "spectacles") {
    return baseTune({
      cameraFar: 1000,
      pixelRatioCap: 1,
      quality: 0.45,
      trails: false,
      hidePointerRays: true,
      shadowMapSize: 0,
      particleScale: 0.4,
      maxParticles: 36,
      cheapGlass: true,
      foveation: 1,
      cheapToneMap: true,
      simpleCrates: true,
      fogDensity: 0.02,
      physHertz: 14,
    });
  }
  // Quest / Pico / Vive — Quest 3 target 72 Hz
  if (vendor === "quest" || vendor === "pico" || vendor === "vive") {
    return baseTune({
      cameraFar: 48,
      depthNear: 0.08,
      pixelRatioCap: 1,
      quality: 0.7,
      trails: false,
      shadowMapSize: 512,
      particleScale: 0.48,
      maxParticles: 48,
      cheapGlass: true,
      foveation: 1,
      cheapToneMap: true,
      simpleCrates: true,
      fogDensity: 0.03,
      physHertz: 16,
    });
  }
  return baseTune({});
}

export function applySessionDepth(session: XRSession, cameraFar: number, depthNear = 0.1): void {
  try {
    session.updateRenderState({
      depthNear,
      depthFar: cameraFar,
    });
  } catch {
    /* */
  }
}
