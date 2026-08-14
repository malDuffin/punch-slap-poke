import { useEffect, useRef } from "react";
import { HAND_CONNECTIONS, type HandTrackFrame, type TrackedHand } from "./handCamera";
import type { GloveFightEngine } from "./engine";

const L_COLOR = "#3db8e2";
const R_COLOR = "#e23d3d";
const L_GLOW = "rgba(61,184,226,0.55)";
const R_GLOW = "rgba(226,61,61,0.55)";

type CoverMap = { ox: number; oy: number; dw: number; dh: number };

function coverMap(videoW: number, videoH: number, boxW: number, boxH: number): CoverMap {
  const vw = Math.max(1, videoW);
  const vh = Math.max(1, videoH);
  const scale = Math.max(boxW / vw, boxH / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  return { ox: (boxW - dw) / 2, oy: (boxH - dh) / 2, dw, dh };
}

function lmToPx(nx: number, ny: number, m: CoverMap) {
  return { x: m.ox + nx * m.dw, y: m.oy + ny * m.dh };
}

function gestureLabel(h: TrackedHand) {
  if (h.uppercut) return "UPPER↑";
  if (h.strike) return "JAB→";
  if (h.slap) {
    const d = h.slapDir >= 0 ? "→" : "←";
    return h.slapStyle === "backhand" ? `BACK${d}` : `PALM${d}`;
  }
  switch (h.gesture) {
    case "punch":
      return "ROCK";
    case "slap":
      return "PAPER";
    case "poke":
      return "SCISSORS";
    case "thumbs":
      return "👍";
    case "thumbsDown":
      return "👎";
    case "peace":
      return "✌️";
    case "spock":
      return "🖖";
    case "rockOn":
      return "🤘";
    default:
      return h.mode === "punch"
        ? "ROCK"
        : h.mode === "slap"
          ? "PAPER"
          : h.mode === "poke"
            ? "SCISSORS"
            : "…";
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  len: number,
  color: string,
  alpha: number,
  width: number,
) {
  if (len < 4 || alpha < 0.05) return;
  const ang = Math.atan2(dy, dx);
  const ex = x + Math.cos(ang) * len;
  const ey = y + Math.sin(ang) * len;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const hs = Math.max(6, width * 2.2);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(ang - 0.4) * hs, ey - Math.sin(ang - 0.4) * hs);
  ctx.lineTo(ex - Math.cos(ang + 0.4) * hs, ey - Math.sin(ang + 0.4) * hs);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHand(ctx: CanvasRenderingContext2D, h: TrackedHand, m: CoverMap) {
  const color = h.side === "L" ? L_COLOR : R_COLOR;
  const glow = h.side === "L" ? L_GLOW : R_GLOW;
  const conf = Math.max(0.25, Math.min(1, h.score));
  const close = h.closeness;
  const pts = h.landmarks;
  if (!pts.length) return;
  const palm = pts[9] ?? pts[0];
  const { x: px, y: py } = lmToPx(palm.x, palm.y, m);
  const ringR = (18 + close * 36) * (0.85 + conf * 0.2);
  ctx.save();
  ctx.globalAlpha = 0.15 + close * 0.45;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 + close * 3;
  ctx.beginPath();
  ctx.arc(px, py, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.06 + close * 0.18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, ringR * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.35 + conf * 0.55;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.shadowColor = glow;
  ctx.shadowBlur = 6;
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = pts[a];
    const pb = pts[b];
    if (!pa || !pb) continue;
    const A = lmToPx(pa.x, pa.y, m);
    const B = lmToPx(pb.x, pb.y, m);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.shadowBlur = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const { x, y } = lmToPx(p.x, p.y, m);
    const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
    const isWrist = i === 0;
    const r = isWrist ? 4.5 : isTip ? 3.2 : 2.2;
    ctx.globalAlpha = 0.45 + conf * 0.5;
    ctx.fillStyle = isTip ? "#fff" : color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const dirLen = 28 + close * 40;
  drawArrow(ctx, px, py, h.dirX, h.dirY, dirLen, color, 0.4 + conf * 0.5, 2.5);
  if (h.thrust > 0.08) {
    const t = h.thrust;
    ctx.save();
    ctx.globalAlpha = 0.35 + t * 0.6;
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 2 + t * 2;
    for (let i = 0; i < 3; i++) {
      const s = 10 + t * 18 + i * 8;
      ctx.beginPath();
      ctx.moveTo(px - s, py + s * 0.35);
      ctx.lineTo(px, py - s * 0.15);
      ctx.lineTo(px + s, py + s * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (h.strike || h.uppercut || h.slap) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, ringR + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const wrist = pts[0]!;
  const wpt = lmToPx(wrist.x, wrist.y, m);
  const by = Math.max(14, wpt.y - 16);
  const label = `${h.side} ${gestureLabel(h)}`;
  ctx.save();
  ctx.font = "bold 11px ui-monospace, SF Mono, Menlo, monospace";
  const tw = ctx.measureText(label).width;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = "rgba(8,6,12,0.75)";
  roundRect(ctx, wpt.x - tw / 2 - 6, by - 11, tw + 12, 16, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, wpt.x, by - 2);
  const face = h.palmFacing ?? 0;
  const faceLabel = face > 0.15 ? "PALM" : face < -0.15 ? "BACK" : "EDGE";
  const faceCol = face > 0.15 ? "#7ee0ff" : face < -0.15 ? "#ff8ad0" : "#aaa";
  ctx.font = "bold 9px ui-monospace, SF Mono, Menlo, monospace";
  ctx.fillStyle = faceCol;
  ctx.globalAlpha = 0.85;
  ctx.fillText(faceLabel, wpt.x, by + 12);
  ctx.restore();
}

function drawMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  color: string,
  label: string,
) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.35 + value * 0.65;
  const fw = Math.max(0, (w - 2) * Math.min(1, Math.max(0, value)));
  roundRect(ctx, x + 1, y + 1, fw, h - 2, 2);
  ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "#f2efe8";
  ctx.font = "bold 9px ui-monospace, SF Mono, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 4, y + h / 2 + 0.5);
  ctx.restore();
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: HandTrackFrame | null | undefined,
  w: number,
  h: number,
  map: CoverMap,
) {
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = "#f2efe8";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.15);
  ctx.lineTo(w * 0.5, h * 0.85);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.save();
  ctx.font = "bold 10px ui-monospace, SF Mono, Menlo, monospace";
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = L_COLOR;
  ctx.textAlign = "left";
  ctx.fillText("L", 8, 16);
  ctx.fillStyle = R_COLOR;
  ctx.textAlign = "right";
  ctx.fillText("R", w - 8, 16);
  ctx.restore();
  const hands = frame?.hands ?? [];
  for (const hand of hands) drawHand(ctx, hand, map);
  const left = hands.find((x) => x.side === "L");
  const right = hands.find((x) => x.side === "R");
  const meterW = (w - 18) / 2;
  const my = h - 36;
  drawMeter(ctx, 6, my, meterW, 10, left?.closeness ?? 0, L_COLOR, `L near ${Math.round((left?.closeness ?? 0) * 100)}`);
  drawMeter(ctx, 12 + meterW, my, meterW, 10, right?.closeness ?? 0, R_COLOR, `R near ${Math.round((right?.closeness ?? 0) * 100)}`);
  drawMeter(
    ctx,
    6,
    my + 13,
    meterW,
    10,
    left ? Math.max(left.score, left.thrust) : 0,
    L_COLOR,
    `L power ${Math.round((left ? Math.max(left.score, left.thrust) : 0) * 100)}`,
  );
  drawMeter(
    ctx,
    12 + meterW,
    my + 13,
    meterW,
    10,
    right ? Math.max(right.score, right.thrust) : 0,
    R_COLOR,
    `R power ${Math.round((right ? Math.max(right.score, right.thrust) : 0) * 100)}`,
  );
  ctx.save();
  ctx.font = "9px ui-monospace, SF Mono, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#f2efe8";
  if (!hands.length) {
    ctx.fillText("Searching for hands… step into frame", w / 2, h - 4);
  } else {
    ctx.fillText("jab→ · upper↑ · palm/back swipe · ring=near · chevrons=thrust", w / 2, h - 4);
  }
  ctx.restore();
}

export function CameraTrackPip({
  engine,
  active,
}: {
  engine: GloveFightEngine | null;
  active: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active || !engine) return;
    const host = videoHostRef.current;
    if (!host) return;
    const video = engine.getCameraVideo?.();
    if (!video) return;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    video.style.objectPosition = "center center";
    video.style.transform = "scaleX(-1)";
    video.style.display = "block";
    host.replaceChildren(video);
    return () => {
      if (video.parentElement === host) host.removeChild(video);
    };
  }, [active, engine]);

  useEffect(() => {
    if (!active || !engine) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const host = videoHostRef.current;
      const rect = host?.getBoundingClientRect();
      const cssW = rect?.width ?? 240;
      const cssH = rect?.height ?? 180;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.max(1, Math.round(cssW * dpr));
      const bh = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const video = engine.getCameraVideo?.();
      const vw = video?.videoWidth || 640;
      const vh = video?.videoHeight || 480;
      const map = coverMap(vw, vh, cssW, cssH);
      const frame = engine.getHandTrackFrame?.();
      drawOverlay(ctx, frame, cssW, cssH, map);
      const n = frame?.hands?.length ?? 0;
      const el = rootRef.current;
      if (el) {
        el.style.borderColor = n > 0 ? (n > 1 ? "#3dd68c" : "#e2b03d") : "";
        el.style.boxShadow =
          n > 0
            ? "0 0 0 1px rgba(61,214,140,0.25), 0 12px 40px rgba(0,0,0,0.55)"
            : "0 12px 40px rgba(0,0,0,0.55)";
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, engine]);

  if (!active) return null;

  return (
    <div
      className="pointer-events-none absolute z-[60]"
      style={{
        right: "max(0.75rem, env(safe-area-inset-right))",
        top: "max(0.75rem, env(safe-area-inset-top))",
        width: "min(44vw, 280px)",
      }}
    >
      <div
        ref={rootRef}
        className="relative overflow-hidden rounded-[14px] border-2 shadow-[0_12px_40px_rgba(0,0,0,0.55)] transition-[border-color,box-shadow] duration-200"
        style={{ borderColor: "var(--color-border)", background: "#0a090e" }}
      >
        <div className="relative aspect-[4/3] w-full">
          <div ref={videoHostRef} className="absolute inset-0 overflow-hidden bg-black" />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ display: "block" }} />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/80 bg-surface/95 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hp opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-hp" />
            </span>
            <span className="text-[10px] font-semibold tracking-wide text-fg uppercase">Cam track</span>
          </div>
          <span className="text-[9px] text-muted">L cyan · R red · jab = chevrons</span>
        </div>
      </div>
    </div>
  );
}
