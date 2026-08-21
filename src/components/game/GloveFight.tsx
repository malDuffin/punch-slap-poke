import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Glasses,
  Hand,
  HandMetal,
  Heart,
  Loader2,
  Pause,
  Play,
  Radio,
  Scissors,
  Users,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { GloveFightEngine, isXrHeadsetBrowser } from "./engine";
import { CameraTrackPip } from "./CameraTrackPip";
import { MotionCueOverlay } from "./MotionCueOverlay";
import { MODE_META, type HandMode, type HudState, type MotionCue } from "./types";
import {
  applyDebugging,
  initDebuggingFromPreference,
  isDebuggingEnabled,
  setDebuggingPreference,
} from "./debugConsole";

function buildInitialHud(): HudState {
  let headset = false;
  try {
    headset = typeof navigator !== "undefined" && isXrHeadsetBrowser();
  } catch {
    headset = false;
  }
  return {
    phase: "booting",
    health: 100,
    maxHealth: 100,
    score: 0,
    combo: 0,
    wave: 0,
    maxWaves: 8,
    mode: "punch",
    modeL: "punch",
    modeR: "punch",
    power: 0,
    enemiesLeft: 0,
    message: "",
    highScore: 0,
    locked: false,
    isMobile: false,
    xrSupported: headset,
    xrActive: false,
    xrEntering: false,
    xrHeadset: headset,
    xrModeVr: false,
    xrModeAr: false,
    xrPreferredMode: null,
    xrSessionMode: null,
    xrBlockReason: null,
    xrLastError: "",
    xrDeviceName: "",
    xrVendor: null,
    xrForce: false,
    xrHandsOn: true,
    fxHitParticles: false,
    fxFlightTrail: true,
    xrEmbedded: false,
    platform: headset ? "xr" : "desktop",
    fps: 60,
    cameraHands: false,
    cameraLoading: false,
    cameraError: null,
    cameraGesture: "",
    cameraHandsCount: 0,
    trackProgress: 0,
    trackReady: false,
    countdown: null,
    waveClearCanContinue: false,
    bootReady: false,
    bootPct: 0,
    bootStep: "Waking the ring…",
    bootLog: [],
    tutorialStep: null,
    tutorialTitle: "",
    tutorialBody: "",
    tutorialHint: "",
    tutorialProgress: 0,
    tutorialNeed: 0,
  };
}

const MODE_ICON = {
  punch: HandMetal,
  slap: Hand,
  poke: Scissors,
} as const;

function modeWeapon(m: HandMode) {
  if (m === "punch") return "Glove";
  if (m === "slap") return "Fish";
  return "Blades";
}

function modeShape(m: HandMode) {
  if (m === "punch") return "Rock";
  if (m === "slap") return "Paper";
  return "Scissors";
}

export function GloveFight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudLayerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GloveFightEngine | null>(null);
  const [hud, setHud] = useState<HudState>(() => buildInitialHud());
  const [hitFlash, setHitFlash] = useState(0);
  const [dmgFlash, setDmgFlash] = useState(false);
  const [muted, setMuted] = useState(false);
  const [comboKey, setComboKey] = useState(0);
  const [chromeFlash, setChromeFlash] = useState(0);
  const [motionCue, setMotionCue] = useState<MotionCue | null>(null);
  const prevCombo = useRef(0);
  const [engineReady, setEngineReady] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [roomDraft, setRoomDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");

  // On-screen console (markknol/console-log-viewer) — default OFF, max 6 lines when on
  useEffect(() => {
    const on = isDebuggingEnabled();
    setDebugging(on);
    initDebuggingFromPreference();
    try {
      setPageUrl(typeof window !== "undefined" ? window.location.href : "");
    } catch {
      setPageUrl("");
    }
  }, []);

  const toggleDebugging = useCallback(() => {
    setDebugging((prev) => {
      const next = !prev;
      setDebuggingPreference(next);
      void applyDebugging(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GloveFightEngine(
      canvas,
      {
        onHud: (s: HudState) => setHud({ ...s }),
        onHitFlash: (i: number) => {
          setHitFlash(i);
          setChromeFlash(i);
          window.setTimeout(() => setHitFlash(0), 100);
          window.setTimeout(() => setChromeFlash(0), 180);
        },
        onDamageFlash: () => {
          setDmgFlash(true);
          window.setTimeout(() => setDmgFlash(false), 200);
        },
        onComboPop: () => setComboKey((k) => k + 1),
        onMotionCue: (cue: MotionCue) => setMotionCue(cue),
      },
      hudLayerRef.current,
    );
    engineRef.current = engine;
    setEngineReady(true);
    return () => {
      engine.dispose();
      engineRef.current = null;
      setEngineReady(false);
    };
  }, []);

  useEffect(() => {
    if (hud.combo > prevCombo.current && hud.combo > 1) setComboKey((k) => k + 1);
    prevCombo.current = hud.combo;
  }, [hud.combo]);

  useEffect(() => {
    if (hud.mpRoom) setRoomDraft((r) => r || hud.mpRoom || "");
    if (hud.mpName) setNameDraft((n) => n || hud.mpName || "");
  }, [hud.mpRoom, hud.mpName]);

  const joinRoom = useCallback(() => {
    engineRef.current?.joinParty(roomDraft || "arena", nameDraft || "Fighter");
  }, [roomDraft, nameDraft]);

  const copyRoomLink = useCallback(() => {
    const room = (roomDraft || hud.mpRoom || "arena").replace(/[^a-zA-Z0-9_-]/g, "") || "arena";
    let base = pageUrl || "";
    try {
      const u = new URL(pageUrl || window.location.href);
      u.searchParams.set("room", room);
      if (nameDraft) u.searchParams.set("name", nameDraft);
      base = u.toString();
    } catch {
      base = `${pageUrl || ""}?room=${encodeURIComponent(room)}`;
    }
    void navigator.clipboard?.writeText(base).catch(() => {});
  }, [pageUrl, roomDraft, nameDraft, hud.mpRoom]);
  const start = useCallback(() => engineRef.current?.startGame(), []);
  const resume = useCallback(() => {
    if (hud.phase === "waveClear" || hud.phase === "victory") {
      engineRef.current?.continueFromWaveClear();
    } else engineRef.current?.resume();
  }, [hud.phase]);
  const setMode = useCallback((m: HandMode) => engineRef.current?.setMode(m), []);
  const enterXR = useCallback((mode?: "vr" | "ar") => {
    engineRef.current?.enterXR(mode);
  }, []);
  const setForceXr = useCallback((on: boolean) => {
    engineRef.current?.setForceXr?.(on);
  }, []);
  const setShowSkinnedHands = useCallback((on: boolean) => {
    engineRef.current?.setShowSkinnedHands?.(on);
  }, []);
  const setFxHitParticles = useCallback((on: boolean) => {
    engineRef.current?.setFxHitParticles?.(on);
  }, []);
  const setFxFlightTrail = useCallback((on: boolean) => {
    engineRef.current?.setFxFlightTrail?.(on);
  }, []);
  const openFullForVR = useCallback(() => {
    engineRef.current?.openTopLevelForVR?.();
  }, []);
  const clearXrError = useCallback(() => {
    engineRef.current?.clearXrError?.();
  }, []);
  const toggleCamera = useCallback(() => void engineRef.current?.toggleCameraHands(), []);
  const toggleMute = useCallback(() => {
    engineRef.current?.toggleMute();
    setMuted((m) => !m);
  }, []);
  const pause = useCallback(() => engineRef.current?.pause(), []);

  const hpPct = Math.max(0, (hud.health / hud.maxHealth) * 100);
  const powerPct = Math.max(0, hud.power * 100);
  const playing = hud.phase === "playing";
  const readying = hud.phase === "readying";
  const tutorial = hud.phase === "tutorial";
  const booting = hud.phase === "booting" || !hud.bootReady;
  const showOverlay =
    !hud.xrActive &&
    !booting &&
    (hud.phase === "menu" ||
      hud.phase === "paused" ||
      hud.phase === "waveClear" ||
      hud.phase === "gameover" ||
      hud.phase === "victory");

  const showMobileChrome = hud.isMobile || hud.platform === "mobile";
  const inFight = playing || readying || tutorial;
  /** Quest / Pico / active WebXR — no flat "Enter ring" or webcam hands */
  const onHeadset =
    hud.xrHeadset ||
    hud.xrActive ||
    hud.platform === "xr" ||
    // Belt-and-suspenders: if engine says immersive-vr works and device is not desktop-like
    (hud.xrSupported && hud.isMobile && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || ""));
  const showXrLaunch =
    showOverlay &&
    hud.phase === "menu" &&
    (onHeadset || hud.xrSupported || hud.xrActive || hud.xrForce);

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-bg text-fg select-none"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <filter id="liquidGlassDistort" x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="2" result="noise">
            <animate attributeName="baseFrequency" dur="9s" repeatCount="indefinite" values="0.01 0.018;0.016 0.014;0.01 0.018" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-0 h-full w-full touch-none"
        style={{ display: "block", touchAction: "none" }}
      />

      <div ref={hudLayerRef} className="pointer-events-none absolute inset-0 z-10" />

      {hud.cameraHands && !hud.xrActive && (
        <CameraTrackPip
          engine={engineReady ? engineRef.current : null}
          active={hud.cameraHands && engineReady}
        />
      )}

      {/* Hand / aim debug (toggle with D, scale with [ ]) */}
      {hud.handDebug && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[60] max-w-[min(92vw,22rem)] rounded-xl border border-amber-400/40 bg-black/80 p-3 font-mono text-[10px] leading-relaxed text-amber-100 shadow-lg backdrop-blur-sm">
          <div className="mb-1 text-[11px] font-bold text-amber-300">HAND DEBUG · D to close · [ ] XR scale</div>
          <div>XR: {hud.xrActive ? "yes" : "no"} · scale {hud.xrHandScale?.toFixed?.(2) ?? "—"}</div>
          <div>
            modes L={hud.modeL} R={hud.modeR}
          </div>
          {(() => {
            const info = hud.handDebugInfo as {
              usingHands?: boolean;
              last?: {
                hand: string;
                mode: string;
                used: string;
                origin: string;
                forward: string;
                ctrlFwd: string;
                camFwd: string;
                pitchDeg: string;
                age: string;
              } | null;
            } | null;
            if (!info) return null;
            return (
              <>
                <div>tracked hands: {info.usingHands ? "yes" : "no"}</div>
                {info.last ? (
                  <>
                    <div className="mt-1 text-emerald-300">
                      last fire {info.last.hand} {info.last.mode} via {info.last.used} ({info.last.age}s)
                    </div>
                    <div>origin {info.last.origin}</div>
                    <div className="text-emerald-200">aim (green) {info.last.forward}</div>
                    <div className="text-cyan-300">ctrl (cyan) {info.last.ctrlFwd}</div>
                    <div className="text-yellow-200">cam (yellow) {info.last.camFwd}</div>
                    <div>pitch {info.last.pitchDeg}°</div>
                  </>
                ) : (
                  <div className="opacity-70">punch once to capture aim vectors</div>
                )}
              </>
            );
          })()}
          <div className="mt-1 opacity-60">
            green=fire · cyan=controller · yellow=camera · RGB axes on gloves
          </div>
        </div>
      )}

      {/* Full-screen punch / slap WOW cues */}
      {!hud.xrActive && <MotionCueOverlay cue={motionCue} />}

      <div
        className="pointer-events-none absolute inset-0 z-[15]"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 42%, rgba(8,6,12,0.45) 100%)",
          opacity: playing ? 1 : 0.5,
        }}
      />

      {hitFlash > 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            background: `radial-gradient(circle at center, rgba(255,255,255,${hitFlash * 0.25}) 0%, transparent 55%)`,
            animation: "hit-flash 100ms ease-out both",
          }}
        />
      )}
      {dmgFlash && (
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            boxShadow: "inset 0 0 100px rgba(226,60,60,0.7)",
            background: "rgba(226,40,40,0.14)",
          }}
        />
      )}
      {chromeFlash > 0 && powerPct >= 99 && (
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            boxShadow: `inset 0 0 60px rgba(255,210,74,${chromeFlash * 0.4})`,
          }}
        />
      )}

      {/* Readying / tutorial countdown */}
      {(readying || (tutorial && hud.tutorialStep === "countdown")) && !hud.xrActive && (
        <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 p-6">
          <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-border bg-surface/88 px-6 py-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-md">
            <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
              {tutorial ? "Here they come" : hud.cameraHands ? "Calibrating track" : "Get ready"}
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
              {hud.countdown != null
                ? hud.countdown
                : hud.message === "GO!"
                  ? "GO!"
                  : hud.cameraHands
                    ? "Show your upper body"
                    : "Starting soon"}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {tutorial ? "Punch the bad guys." : hud.cameraHands
                ? "Stand back so chest and both hands are in the camera. Fight waits until the lock is solid."
                : "Ease in — first wave starts slowly."}
            </p>
            {hud.cameraHands && (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full border border-border bg-surface-2">
                  <div
                    className="h-full rounded-full transition-[width] duration-150"
                    style={{
                      width: `${Math.round(hud.trackProgress * 100)}%`,
                      background: hud.trackReady
                        ? "var(--color-hp)"
                        : "linear-gradient(90deg, var(--color-slap), var(--color-hp))",
                    }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-faint">
                  {hud.cameraGesture || "Waiting for hands…"}
                </p>
              </div>
            )}
            {hud.message && (
              <p className="mt-3 text-sm font-semibold text-fg">{hud.message}</p>
            )}
          </div>
        </div>
      )}

      {tutorial && hud.tutorialStep !== "countdown" && !hud.xrActive && (
        <div className="pointer-events-none absolute inset-x-0 top-[12%] z-40 flex justify-center px-4">
          <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-amber-400/40 bg-surface/90 px-5 py-4 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-amber-300 uppercase">
              Tutorial
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-amber-100">
              {hud.tutorialTitle || "Lesson"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fg/90">{hud.tutorialBody}</p>
            {!!hud.tutorialNeed && (
              <div className="mt-3">
                <p className="mb-1 text-[10px] font-bold tracking-[0.18em] text-amber-300 uppercase">
                  {hud.tutorialStep === "wave" ? "Waveometer" : "Progress"}
                </p>
                <div className="mx-auto h-3 max-w-[16rem] overflow-hidden rounded-full border border-amber-400/40 bg-surface-2">
                  <div
                    className="h-full rounded-full transition-[width] duration-100"
                    style={{
                      width: `${Math.round(((hud.tutorialProgress || 0) / Math.max(0.001, hud.tutorialNeed || 1)) * 100)}%`,
                      background: hud.tutorialWaving
                        ? "linear-gradient(90deg, #3dd68c, #ffe08a)"
                        : "linear-gradient(90deg, #c9a227, #ffe08a)",
                    }}
                  />
                </div>
                <p className="mt-1.5 text-sm font-bold tabular-nums text-amber-200">
                  {hud.tutorialStep === "wave"
                    ? `${(hud.tutorialProgress || 0).toFixed(1)} / 5.0 s`
                    : `${hud.tutorialProgress || 0} / ${hud.tutorialNeed}`}
                </p>
              </div>
            )}
            {hud.tutorialHint && (
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {hud.tutorialHint}
              </p>
            )}
          </div>
        </div>
      )}

      {/* In-fight HUD */}
      {inFight && !hud.xrActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                <span>Wave {hud.wave}</span>
                <span className="text-faint">·</span>
                <span className="tabular-nums text-fg">{hud.score.toLocaleString()}</span>
                {hud.combo > 1 && (
                  <span
                    key={comboKey}
                    className="animate-combo-pop rounded-full bg-punch/20 px-2 py-0.5 text-punch"
                  >
                    x{hud.combo}
                  </span>
                )}
                <span
                  className="ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal"
                  style={{
                    borderColor: hud.mpConnected ? "var(--color-hp)" : "var(--color-border)",
                    color: hud.mpConnected ? "var(--color-hp)" : "var(--color-faint)",
                  }}
                >
                  {hud.mpConnected
                    ? `${hud.mpRoom || "arena"} · ${(hud.mpPeers || 0) + 1}`
                    : "solo"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-7 text-[10px] font-bold tracking-wider text-muted">HP</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full transition-[width] duration-150"
                    style={{
                      width: `${hpPct}%`,
                      background:
                        hpPct < 30
                          ? "#ff2244"
                          : hpPct < 62
                            ? "#ffee22"
                            : "linear-gradient(90deg, #14ff7a, #7dffb0)",
                      boxShadow: "0 0 10px currentColor",
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-7 text-[10px] font-bold tracking-wider text-muted">PWR</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full border border-border bg-surface-2">
                  <div
                    className={`h-full rounded-full transition-[width] duration-100 ${powerPct >= 99 ? "animate-[power-pulse_0.8s_ease-in-out_infinite]" : ""}`}
                    style={{
                      width: `${powerPct}%`,
                      background:
                        powerPct >= 99
                          ? "linear-gradient(90deg, #ffd24a, #fff0a8)"
                          : "linear-gradient(90deg, #5a4a20, #c9a227)",
                    }}
                  />
                </div>
              </div>
              {(hud.mpGlow || 0) > 0.08 && (
                <div className="flex items-center gap-2">
                  <Heart className="size-3.5 shrink-0 text-punch" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full border border-border bg-surface-2">
                    <div
                      className="h-full rounded-full transition-[width] duration-100"
                      style={{
                        width: `${Math.round((hud.mpGlow || 0) * 100)}%`,
                        background:
                          (hud.mpGlow || 0) > 0.85
                            ? "linear-gradient(90deg, var(--color-punch), var(--color-accent))"
                            : "linear-gradient(90deg, #7a2048, var(--color-punch))",
                      }}
                    />
                  </div>
                </div>
              )}
              {(hud.walkSpeed || 0) > 0.02 && (
                <div className="flex items-center gap-2">
                  <Zap className="size-3.5 shrink-0 text-accent" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full border border-border bg-surface-2">
                    <div
                      className="h-full rounded-full transition-[width] duration-75"
                      style={{
                        width: `${Math.round((hud.walkSpeed || 0) * 100)}%`,
                        background: "linear-gradient(90deg, #3aaa4c, #ffe08a)",
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-bold tabular-nums text-muted">
                    {Math.round((hud.walkSpeed || 0) * 100)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {hud.message && (
            <div className="pointer-events-none absolute top-[18%] left-1/2 max-w-[90vw] -translate-x-1/2 rounded-full border border-border bg-surface/80 px-4 py-2 text-center text-sm font-semibold shadow-lg backdrop-blur-sm">
              {hud.message}
            </div>
          )}

          <div className="space-y-3">
            {hud.cameraHands && (
              <div className="mx-auto max-w-md rounded-2xl border border-border/80 bg-surface/75 px-3 py-2 text-center text-[11px] text-muted backdrop-blur-md">
                Each hand is independent · <span className="text-punch">fist glove</span> ·{" "}
                <span className="text-slap">open fish</span> ·{" "}
                <span className="text-poke">✌ blades</span> · jab throws that hand's copy
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="pointer-events-auto flex flex-col gap-2">
                <div className="flex gap-1.5">
                  {(["punch", "slap", "poke"] as HandMode[]).map((m) => {
                    if (tutorial && hud.tutorialStep && hud.tutorialStep !== m && hud.tutorialStep !== "enter" && hud.tutorialStep !== "countdown") {
                      return null;
                    }
                    const Icon = MODE_ICON[m];
                    const active = hud.modeL === m || hud.modeR === m;
                    const both = hud.modeL === m && hud.modeR === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className="flex size-12 flex-col items-center justify-center rounded-xl border text-[10px] font-bold transition active:scale-95"
                        style={{
                          borderColor: active ? MODE_META[m].css : "var(--color-border)",
                          background: both
                            ? `${MODE_META[m].css}33`
                            : active
                              ? "var(--color-surface-2)"
                              : "var(--color-surface)",
                          color: active ? MODE_META[m].css : "var(--color-muted)",
                          boxShadow: both ? `0 0 0 2px ${MODE_META[m].css}` : undefined,
                        }}
                        aria-label={MODE_META[m].label}
                      >
                        <Icon className="size-5" />
                        <span className="mt-0.5">
                          {m === "punch" ? "L·R" : m === "slap" ? "2" : "3"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-full border border-border bg-surface/90 px-3 py-1 text-center text-[11px] font-semibold tabular-nums">
                  <span style={{ color: MODE_META[hud.modeL].css }}>L {modeShape(hud.modeL)}</span>
                  <span className="mx-1.5 text-faint">|</span>
                  <span style={{ color: MODE_META[hud.modeR].css }}>R {modeShape(hud.modeR)}</span>
                </div>
              </div>

              <div className="pointer-events-auto flex items-center gap-2">
                {!onHeadset && (
                  <button
                    type="button"
                    onClick={toggleCamera}
                    className="flex size-12 items-center justify-center rounded-xl border-2 transition active:scale-95"
                    style={{
                      borderColor: hud.cameraHands ? "var(--color-hp)" : "var(--color-border)",
                      background: hud.cameraHands ? "rgba(61,214,140,0.15)" : "var(--color-surface)",
                      color: hud.cameraHands ? "var(--color-hp)" : "var(--color-muted)",
                    }}
                    aria-label="Toggle camera hands"
                  >
                    {hud.cameraLoading ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : hud.cameraHands ? (
                      <Camera className="size-5" />
                    ) : (
                      <CameraOff className="size-5" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleMute}
                  className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-muted transition active:scale-95"
                  aria-label="Mute"
                >
                  {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                </button>
                {playing && (
                  <button
                    type="button"
                    onClick={pause}
                    className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-muted transition active:scale-95"
                    aria-label="Pause"
                  >
                    <Pause className="size-5" />
                  </button>
                )}
              </div>
            </div>

            {showMobileChrome && (
              <div className="pointer-events-auto flex items-end justify-between gap-3 pb-1">
                <div className="flex gap-3">
                  <FirePad
                    label="L"
                    onDown={() => engineRef.current?.setMobileFire("L", true)}
                    onUp={() => engineRef.current?.setMobileFire("L", false)}
                  />
                  <FirePad
                    label="R"
                    onDown={() => engineRef.current?.setMobileFire("R", true)}
                    onUp={() => engineRef.current?.setMobileFire("R", false)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onPointerDown={() => engineRef.current?.setWalkThrottle(true)}
                    onPointerUp={() => engineRef.current?.setWalkThrottle(false)}
                    onPointerLeave={() => engineRef.current?.setWalkThrottle(false)}
                    className="flex size-12 items-center justify-center rounded-full border border-border bg-surface/90 text-accent shadow-lg active:scale-95"
                    aria-label="Walkway throttle"
                  >
                    <Zap className="size-5" />
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => engineRef.current?.setCharging(true)}
                    onPointerUp={() => engineRef.current?.setCharging(false)}
                    onPointerLeave={() => engineRef.current?.setCharging(false)}
                    className="flex size-12 items-center justify-center rounded-full border border-border bg-surface/90 text-poke shadow-lg active:scale-95"
                    aria-label="Power charge"
                  >
                    <Zap className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => engineRef.current?.doGesture("heart")}
                    className="flex size-12 items-center justify-center rounded-full border border-border bg-surface/90 text-punch shadow-lg active:scale-95"
                    aria-label="Heart shield"
                    hidden={!!tutorial && hud.tutorialStep !== "heart" && hud.tutorialStep !== "enter"}
                  >
                    <Heart className="size-5" />
                  </button>
                </div>
              </div>
            )}

            {!showMobileChrome && (
              <p className="text-center text-[11px] text-faint">
                Drag to look · Click to lock · LMB / RMB punch · 1 2 3 modes · H heart · M birdie · Space
                power · WASD · Hold Shift = throttle the walkway
              </p>
            )}
          </div>
        </div>
      )}

      {/* Progressive boot — play / WebXR locked until the ring is fully loaded */}
      {booting && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-bg px-5">
          <div className="w-full max-w-md">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-muted uppercase">
              Loading
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Glove Fight</h1>
            <p className="mt-2 text-sm text-muted">{hud.bootStep || "Waking the ring…"}</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full border border-border bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.round((hud.bootPct || 0) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-right text-[11px] tabular-nums text-faint">
              {Math.round((hud.bootPct || 0) * 100)}%
            </p>
            <ol className="mt-4 max-h-48 space-y-1 overflow-hidden font-mono text-[11px] leading-relaxed text-muted">
              {(hud.bootLog || []).map((line, i) => (
                <li key={`${i}-${line}`} className={i === (hud.bootLog?.length || 1) - 1 ? "text-fg" : ""}>
                  <span className="text-faint">›</span> {line}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {showOverlay && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg/55 p-4 backdrop-blur-[2px]">
          <div
            data-panel
            className="liquid-glass pointer-events-auto animate-float-in my-4 w-full max-w-md max-h-[min(92dvh,46rem)] overflow-y-auto rounded-[var(--radius-xl)] p-6"
            style={{ touchAction: "pan-y" }}
          >
            {hud.phase === "menu" && (
              <>
                <p className="text-[11px] font-semibold tracking-[0.22em] text-muted uppercase">
                  First-person beat-em-up
                </p>
                <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">
                  Glove Fight
                </h1>
                {showXrLaunch && (
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {hud.xrDeviceName && (
                        <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 font-semibold text-fg">
                          {hud.xrDeviceName}
                        </span>
                      )}
                      <span
                        className="rounded-full border bg-surface-2 px-2.5 py-1 font-semibold"
                        style={{
                          borderColor: hud.xrModeAr ? "var(--color-hp)" : "var(--color-border)",
                          color: hud.xrModeAr ? "var(--color-hp)" : "var(--color-faint)",
                        }}
                      >
                        AR {hud.xrModeAr ? "ok" : "no"}
                      </span>
                      <span
                        className="rounded-full border bg-surface-2 px-2.5 py-1 font-semibold"
                        style={{
                          borderColor: hud.xrModeVr ? "var(--color-hp)" : "var(--color-border)",
                          color: hud.xrModeVr ? "var(--color-hp)" : "var(--color-faint)",
                        }}
                      >
                        VR {hud.xrModeVr ? "ok" : "no"}
                      </span>
                      {hud.xrRaysOff && (
                        <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 font-semibold text-muted">
                          Hands on · rays off
                        </span>
                      )}
                    </div>
                    {(hud.xrModeVr || onHeadset || hud.xrForce) && hud.xrVendor !== "spectacles" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          enterXR("vr");
                        }}
                        disabled={!!hud.xrActive || !!hud.xrEntering}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-base font-bold text-accent-fg shadow-lg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                      >
                        {hud.xrEntering && hud.xrPreferredMode !== "immersive-ar" ? (
                          <Loader2 className="size-5 animate-spin" />
                        ) : (
                          <Glasses className="size-5" />
                        )}
                        {hud.xrActive && hud.xrSessionMode === "immersive-vr"
                          ? "VR active"
                          : hud.xrEntering
                            ? "Entering VR…"
                            : "Enter VR"}
                      </button>
                    )}
                    {hud.xrModeAr && hud.xrVendor !== "vision-pro" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          enterXR("ar");
                        }}
                        disabled={!!hud.xrActive || !!hud.xrEntering}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface-2 py-3 text-sm font-semibold text-fg shadow-md transition hover:text-fg disabled:opacity-60"
                      >
                        {hud.xrEntering && hud.xrPreferredMode === "immersive-ar" ? (
                          <Loader2 className="size-5 animate-spin" />
                        ) : (
                          <Glasses className="size-5" />
                        )}
                        {hud.xrActive && hud.xrSessionMode === "immersive-ar" ? "AR active" : "Enter AR"}
                      </button>
                    )}
                  </div>
                )}
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Punch, slap, poke — Rock / Paper / Scissors. Drag to look around. Use mouse,
                  touch, gamepad, camera, or VR.
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <HandMetal className="mt-0.5 size-4 shrink-0 text-punch" />
                    <span>
                      <strong className="text-fg">Rock</strong> (fist) — boxing gloves
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Hand className="mt-0.5 size-4 shrink-0 text-slap" />
                    <span>
                      <strong className="text-fg">Paper</strong> (open hand) — cartoon fish
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Scissors className="mt-0.5 size-4 shrink-0 text-poke" />
                    <span>
                      <strong className="text-fg">Scissors</strong> (✌) — scissor blades
                    </span>
                  </li>
                  {!onHeadset && (
                    <li className="flex items-start gap-2">
                      <Camera className="mt-0.5 size-4 shrink-0 text-hp" />
                      <span>
                        <strong className="text-fg">Camera</strong> — track your real hands · jab
                        forward for POW · swipe for WHAP
                      </span>
                    </li>
                  )}
                  {onHeadset && (
                    <li className="flex items-start gap-2">
                      <Glasses className="mt-0.5 size-4 shrink-0 text-hp" />
                      <span>
                        <strong className="text-fg">VR hands</strong> — tracked controllers / hand
                        tracking drive your gloves
                      </span>
                    </li>
                  )}
                  <li className="flex items-start gap-2">
                    <Heart className="mt-0.5 size-4 shrink-0 text-punch" />
                    <span>
                      <strong className="text-fg">Half heart</strong> — make a C (thumb + index
                      gap) on either hand. Each hand shows its half on its own. Bring the two
                      pink halves close until they sparkle to fuse a shield.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Zap className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span>
                      <strong className="text-fg">Walkway throttle</strong> — red SPEED ball on
                      your right, idle is pushed back. Reach it and close your hand around the
                      handle, then shove it forward to ride. Open your hand or pull away to let
                      go — it springs back to zero.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 size-4 shrink-0 text-center text-sm leading-none">🐦</span>
                    <span>
                      <strong className="text-fg">Birdie</strong> — middle finger up.
                      A flapping 3D bird pops onto that hand.
                    </span>
                  </li>
                </ul>

                {!onHeadset && (
                  <button
                    type="button"
                    onClick={start}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-base font-bold text-accent-fg shadow-lg transition hover:brightness-110 active:scale-[0.98]"
                  >
                    <Play className="size-5 fill-current" />
                    Enter the ring
                  </button>
                )}

                {!onHeadset && (
                  <>
                    <button
                      type="button"
                      onClick={toggleCamera}
                      disabled={hud.cameraLoading}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60"
                      style={{
                        borderColor: hud.cameraHands ? "var(--color-hp)" : "var(--color-border)",
                        color: hud.cameraHands ? "var(--color-hp)" : "var(--color-fg)",
                        background: hud.cameraHands ? "rgba(61,214,140,0.08)" : "transparent",
                      }}
                    >
                      {hud.cameraLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Camera className="size-4" />
                      )}
                      {hud.cameraLoading
                        ? "Starting camera…"
                        : hud.cameraHands
                          ? "Camera hands on · tap to disable"
                          : "Enable camera hands"}
                    </button>
                    {hud.cameraError && (
                      <p className="mt-2 text-center text-xs text-danger">{hud.cameraError}</p>
                    )}

                    {hud.cameraHands && (
                      <div className="mt-4 rounded-2xl border border-border bg-surface-2/80 px-4 py-3 text-center">
                        <p className="text-sm font-semibold text-fg">Preview your loadout</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                          Hold shapes — left and right can differ. After Enter, the fight waits until
                          your upper body + both hands are tracked.{" "}
                          <strong className="text-fg">Jab forward</strong> or{" "}
                          <strong className="text-fg">swipe L/R</strong> for big screen gags.
                        </p>
                        <p className="mt-2 text-xs text-faint">
                          Fist glove · Open fish · Index+middle blades · Middle-only bird
                        </p>
                        <p className="mt-1 text-sm font-semibold tabular-nums">
                          <span style={{ color: MODE_META[hud.modeL].css }}>
                            L {modeShape(hud.modeL)} · {modeWeapon(hud.modeL)}
                          </span>
                          <span className="mx-2 text-faint">·</span>
                          <span style={{ color: MODE_META[hud.modeR].css }}>
                            R {modeShape(hud.modeR)} · {modeWeapon(hud.modeR)}
                          </span>
                        </p>
                        {hud.cameraGesture && (
                          <p className="mt-1 text-[11px] text-muted">{hud.cameraGesture}</p>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="mt-4 rounded-2xl border border-border bg-surface-2/80 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                      <Users className="size-4 text-punch" />
                      Shared arena
                    </p>
                    <span
                      className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        borderColor: hud.mpConnected ? "var(--color-hp)" : "var(--color-border)",
                        color: hud.mpConnected ? "var(--color-hp)" : "var(--color-faint)",
                      }}
                    >
                      <Radio className="size-3" />
                      {hud.mpConnected ? `${(hud.mpPeers || 0) + 1} online` : "offline"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Same room code = same fight. Make a half-heart; when two halves meet they glow,
                    then become a shield.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Room
                      </span>
                      <input
                        value={roomDraft}
                        onChange={(e) => setRoomDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                        spellCheck={false}
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                        placeholder="arena"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Name
                      </span>
                      <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                        maxLength={24}
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                        placeholder="Fighter"
                      />
                    </label>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={joinRoom}
                      className="flex-1 rounded-xl border border-border bg-surface py-2 text-xs font-semibold text-fg transition active:scale-[0.98]"
                    >
                      Join room
                    </button>
                    <button
                      type="button"
                      onClick={copyRoomLink}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-muted transition active:scale-[0.98]"
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      onClick={() => engineRef.current?.doGesture("heart")}
                      className="flex items-center justify-center rounded-xl border border-border bg-surface px-3 py-2 text-punch transition active:scale-[0.98]"
                      aria-label="Half heart pose"
                    >
                      <Heart className="size-4" />
                    </button>
                  </div>
                  {hud.mpError && (
                    <p className="mt-2 text-center text-[11px] text-danger">{hud.mpError}</p>
                  )}
                  {!!hud.mpPeerNames?.length && (
                    <p className="mt-2 text-center text-[11px] text-muted">
                      With you: {hud.mpPeerNames.join(", ")}
                    </p>
                  )}
                </div>

                {onHeadset && !hud.xrActive && !hud.xrEntering && (
                  <p className="mt-3 text-center text-xs text-muted">
                    {hud.xrVendor === "vision-pro" || hud.xrDeviceName?.includes("Vision")
                      ? "Vision Pro: hand tracking on, gaze/pinch rays off. Thrust to punch."
                      : "Tap Enter VR — allow the headset permission if it appears."}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setForceXr(!hud.xrForce)}
                  className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-left text-xs font-semibold"
                  style={{
                    borderColor: hud.xrForce ? "var(--color-accent)" : "var(--color-border)",
                    background: hud.xrForce ? "rgba(255, 210, 74, 0.1)" : "transparent",
                    color: "var(--color-fg)",
                  }}
                  aria-pressed={!!hud.xrForce}
                >
                  <span>
                    Force WebXR
                    <span className="mt-0.5 block text-[10px] font-normal text-muted">
                      For unrecognised headsets / override phone gate
                    </span>
                  </span>
                  <span className="text-[11px] font-bold uppercase text-muted">{hud.xrForce ? "On" : "Off"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSkinnedHands(!hud.xrHandsOn)}
                  className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-left text-xs font-semibold"
                  style={{
                    borderColor: hud.xrHandsOn ? "var(--color-hp)" : "var(--color-border)",
                    background: hud.xrHandsOn ? "rgba(61,214,140,0.1)" : "transparent",
                    color: "var(--color-fg)",
                  }}
                  aria-pressed={!!hud.xrHandsOn}
                >
                  <span>
                    Show skinned XR hands
                    <span className="mt-0.5 block text-[10px] font-normal text-muted">
                      Default on — real finger mesh plus punch / paper / scissors / heart
                    </span>
                  </span>
                  <span className="text-[11px] font-bold uppercase text-muted">{hud.xrHandsOn ? "On" : "Off"}</span>
                </button>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFxHitParticles(true)}
                    className="flex flex-col items-start gap-1 rounded-2xl border px-3 py-2.5 text-left text-xs font-semibold"
                    style={{
                      borderColor: hud.fxHitParticles ? "var(--color-punch)" : "var(--color-border)",
                      background: hud.fxHitParticles ? "rgba(226,61,61,0.1)" : "transparent",
                      color: "var(--color-fg)",
                    }}
                    aria-pressed={!!hud.fxHitParticles}
                  >
                    <span>Projectile particles</span>
                    <span className="text-[10px] font-normal text-muted">
                      Spark dots behind the shot
                    </span>
                    <span className="text-[11px] font-bold uppercase text-muted">{hud.fxHitParticles ? "On" : "Off"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFxFlightTrail(true)}
                    className="flex flex-col items-start gap-1 rounded-2xl border px-3 py-2.5 text-left text-xs font-semibold"
                    style={{
                      borderColor: hud.fxFlightTrail ? "var(--color-slap)" : "var(--color-border)",
                      background: hud.fxFlightTrail ? "rgba(61,184,226,0.12)" : "transparent",
                      color: "var(--color-fg)",
                    }}
                    aria-pressed={!!hud.fxFlightTrail}
                  >
                    <span>Projectile trails</span>
                    <span className="text-[10px] font-normal text-muted">
                      Default — ribbon behind the shot
                    </span>
                    <span className="text-[11px] font-bold uppercase text-muted">{hud.fxFlightTrail ? "On" : "Off"}</span>
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-faint">One in-flight look at a time. Hits always explode.</p>
                {/* Only show after a real Enter-XR failure (not makeXRCompatible noise) */}
                {!hud.xrActive && !!hud.xrLastError && (
                  <div className="mt-3 rounded-2xl border border-border bg-surface-2/90 px-3 py-3 text-center text-[11px] leading-relaxed text-muted">
                    <p className="font-semibold text-fg">Couldn’t stay in VR</p>
                    <p className="mt-1">
                      {/reference space|NotSupported/i.test(hud.xrLastError)
                        ? "This headset didn’t accept the floor tracking space. Reload and tap Enter VR again — it will use a simpler space."
                        : /SecurityError|insecure|iframe/i.test(hud.xrLastError)
                          ? "This preview is often inside an embed. Quest can usually enter from this button; Vision Pro needs a full browser tab."
                          : "Entry started then stopped. Tap Enter VR again. If it repeats, open a full browser tab."}
                    </p>
                    {hud.xrLastError && (
                      <p className="mt-1 break-words text-[10px] text-faint">{hud.xrLastError}</p>
                    )}
                    <div className="mt-2 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          clearXrError();
                          enterXR("vr");
                        }}
                        className="flex w-full items-center justify-center rounded-xl bg-accent py-2.5 text-xs font-bold text-accent-fg"
                      >
                        Try Enter VR again
                      </button>
                      <button
                        type="button"
                        onClick={clearXrError}
                        className="w-full rounded-xl border border-border bg-surface py-2 text-xs font-semibold text-fg transition active:scale-[0.98]"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={toggleDebugging}
                  className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition active:scale-[0.99]"
                  style={{
                    borderColor: debugging ? "var(--color-accent)" : "var(--color-border)",
                    background: debugging ? "rgba(255, 210, 74, 0.1)" : "transparent",
                    color: "var(--color-fg)",
                  }}
                  aria-pressed={debugging}
                >
                  <span>
                    <span className="block">Debugging</span>
                    <span className="mt-0.5 block text-[11px] font-normal text-muted">
                      On-screen console logs (console-log-viewer)
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase"
                    style={{
                      background: debugging ? "var(--color-accent)" : "var(--color-surface-2)",
                      color: debugging ? "var(--color-accent-fg, #111)" : "var(--color-muted)",
                    }}
                  >
                    {debugging ? "On" : "Off"}
                  </span>
                </button>

                <p className="mt-5 text-center text-[11px] text-faint">
                  Desktop · Mobile · Camera · WebXR · PartyKit
                  {hud.highScore > 0 ? ` · Best ${hud.highScore.toLocaleString()}` : ""}
                </p>
              </>
            )}

            {hud.phase === "paused" && (
              <PausePanel
                title="Paused"
                score={hud.score}
                onResume={resume}
                onMenu={() => window.location.reload()}
              />
            )}
            {hud.phase === "waveClear" && (
              <PausePanel
                title={`Wave ${hud.wave} clear!`}
                score={hud.score}
                cta={hud.waveClearCanContinue ? "Next wave" : "Hold on…"}
                subtitle={
                  hud.waveClearCanContinue
                    ? "Punch or slap to continue"
                    : "Get ready…"
                }
                onResume={resume}
                disableCta={!hud.waveClearCanContinue}
              />
            )}
            {hud.phase === "victory" && (
              <PausePanel
                title="Champion!"
                score={hud.score}
                cta={hud.waveClearCanContinue ? "Harder level" : "Hold on…"}
                subtitle={
                  hud.waveClearCanContinue
                    ? "Punch or slap for a harder level"
                    : "Get ready…"
                }
                onResume={resume}
                disableCta={!hud.waveClearCanContinue}
              />
            )}
            {hud.phase === "gameover" && (
              <PausePanel
                title="Still standing!"
                score={hud.score}
                cta="Keep fighting"
                onResume={start}
                subtitle="No game over — punch on"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FirePad({
  label,
  onDown,
  onUp,
}: {
  label: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="flex size-[4.5rem] items-center justify-center rounded-full border-2 border-border bg-surface/90 text-lg font-black text-fg shadow-[0_8px_24px_rgba(0,0,0,0.4)] active:scale-95 active:border-accent"
      aria-label={`Fire ${label}`}
    >
      {label}
    </button>
  );
}

function PausePanel({
  title,
  score,
  cta = "Resume",
  subtitle,
  onResume,
  onMenu,
  disableCta = false,
}: {
  title: string;
  score: number;
  cta?: string;
  subtitle?: string;
  onResume: () => void;
  onMenu?: () => void;
  disableCta?: boolean;
}) {
  return (
    <>
      <h2 className="font-display text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted">
        Score <span className="font-bold text-fg tabular-nums">{score.toLocaleString()}</span>
      </p>
      {subtitle && <p className="mt-1 text-xs text-faint">{subtitle}</p>}
      <button
        type="button"
        onClick={onResume}
        disabled={disableCta}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-base font-bold text-accent-fg transition active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100"
      >
        <Play className="size-5 fill-current" />
        {cta}
      </button>
      {onMenu && (
        <button
          type="button"
          onClick={onMenu}
          className="mt-2 w-full py-2 text-sm text-muted hover:text-fg"
        >
          Main menu
        </button>
      )}
    </>
  );
}
