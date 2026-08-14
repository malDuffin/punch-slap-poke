/**
 * Full-screen funny "in your face" feedback for:
 * - jab (forward punch)
 * - uppercut (fist rockets up)
 * - palm slap vs backhand slap (left/right whoosh)
 */
import { useEffect, useState } from "react";
import type { MotionCue } from "./types";

type ActiveCue = MotionCue & { born: number };

const SPARKS = 14;

export function MotionCueOverlay({ cue }: { cue: MotionCue | null }) {
  const [active, setActive] = useState<ActiveCue | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    if (!cue) return;
    setActive({ ...cue, born: performance.now() });
    setShakeKey((k) => k + 1);
    const t = window.setTimeout(() => setActive(null), 820);
    return () => window.clearTimeout(t);
  }, [cue?.id]);

  if (!active) return null;

  const kind = active.kind;
  const isPunch = kind === "punch";
  const isUpper = kind === "uppercut";
  const isSlap = kind === "slap";
  const isBack = isSlap && active.slapStyle === "backhand";
  const dir = active.dir ?? (isUpper ? "up" : "right");
  const power = active.power;
  const sideBias = active.side === "L" ? 28 : 72;

  const wash = isUpper
    ? `radial-gradient(ellipse at ${sideBias}% 78%, rgba(180,70,255,${0.5 * power}) 0%, rgba(255,200,60,0.15) 40%, transparent 72%)`
    : isPunch
      ? `radial-gradient(circle at ${sideBias}% 58%, rgba(255,80,40,${0.45 * power}) 0%, rgba(255,40,20,0.12) 38%, transparent 70%)`
      : isBack
        ? dir === "left"
          ? `linear-gradient(90deg, rgba(255,60,160,${0.55 * power}) 0%, transparent 55%)`
          : `linear-gradient(270deg, rgba(255,60,160,${0.55 * power}) 0%, transparent 55%)`
        : dir === "left"
          ? `linear-gradient(90deg, rgba(60,200,255,${0.5 * power}) 0%, transparent 55%)`
          : `linear-gradient(270deg, rgba(60,200,255,${0.5 * power}) 0%, transparent 55%)`;

  const labelColor = isUpper ? "#e8b0ff" : isPunch ? "#ffef6a" : isBack ? "#ffb0e0" : "#9ef0ff";
  const stroke = isUpper ? "#4a0868" : isPunch ? "#5a0800" : isBack ? "#5a0838" : "#023040";
  const emoji = isUpper ? "🥊⬆️" : isPunch ? "👊" : isBack ? (dir === "left" ? "🤚💨" : "💨🤚") : dir === "left" ? "🖐️💨" : "💨🖐️";

  return (
    <div
      key={shakeKey}
      className={`pointer-events-none absolute inset-0 z-[80] overflow-hidden ${
        isPunch || isUpper ? "animate-screen-punch" : ""
      }`}
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          background: wash,
          animation: "hit-flash 700ms ease-out both",
        }}
      />

      {/* Uppercut rocket from bottom */}
      {isUpper && (
        <>
          <div
            className="absolute left-1/2 animate-boom-punch select-none"
            style={{
              bottom: "12%",
              marginLeft: -40,
              fontSize: `${clamp(72, 56 + power * 60, 130)}px`,
              filter:
                "drop-shadow(0 8px 0 rgba(0,0,0,0.45)) drop-shadow(0 0 28px rgba(180,70,255,0.95))",
              lineHeight: 1,
            }}
          >
            {emoji}
          </div>
          {/* Rising streaks */}
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="absolute animate-slap-streak"
              style={{
                left: `${sideBias - 18 + i * 5}%`,
                bottom: "8%",
                width: 3 + (i % 3),
                height: `${28 + i * 6}%`,
                background: `linear-gradient(to top, transparent, ${i % 2 ? "#c44dff" : "#ffd24a"}, transparent)`,
                animationDelay: `${i * 25}ms`,
                opacity: 0.75,
                borderRadius: 4,
              }}
            />
          ))}
          <div
            className="absolute animate-impact-ring rounded-full border-4"
            style={{
              left: `${sideBias}%`,
              top: "42%",
              width: 100 + power * 70,
              height: 100 + power * 70,
              marginLeft: -(50 + power * 35),
              marginTop: -(50 + power * 35),
              borderColor: "rgba(196,77,255,0.9)",
              boxShadow: "0 0 40px rgba(180,70,255,0.75)",
            }}
          />
        </>
      )}

      {/* Jab punch */}
      {isPunch && (
        <>
          <div
            className="absolute animate-impact-ring rounded-full border-4"
            style={{
              left: `${sideBias}%`,
              top: "55%",
              width: 120 + power * 80,
              height: 120 + power * 80,
              marginLeft: -(60 + power * 40),
              marginTop: -(60 + power * 40),
              borderColor: "rgba(255,210,80,0.85)",
              boxShadow:
                "0 0 40px rgba(255,100,40,0.7), inset 0 0 30px rgba(255,200,80,0.4)",
            }}
          />
          <div
            className="absolute animate-boom-punch select-none"
            style={{
              left: `${sideBias}%`,
              top: "48%",
              transform: "translate(-50%, -50%)",
              fontSize: `${clamp(64, 48 + power * 56, 120)}px`,
              filter:
                "drop-shadow(0 8px 0 rgba(0,0,0,0.45)) drop-shadow(0 0 24px rgba(255,100,40,0.9))",
              lineHeight: 1,
            }}
          >
            {emoji}
          </div>
        </>
      )}

      {/* Palm / backhand whoosh */}
      {isSlap && (
        <>
          <div
            className="absolute animate-slap-streak"
            style={{
              top: "42%",
              left: dir === "left" ? "5%" : "auto",
              right: dir === "right" ? "5%" : "auto",
              width: "90%",
              height: 18 + power * 28,
              borderRadius: 999,
              background: isBack
                ? dir === "left"
                  ? "linear-gradient(90deg, transparent, rgba(255,80,180,0.95), rgba(255,255,255,0.9), transparent)"
                  : "linear-gradient(270deg, transparent, rgba(255,80,180,0.95), rgba(255,255,255,0.9), transparent)"
                : dir === "left"
                  ? "linear-gradient(90deg, transparent, rgba(100,230,255,0.95), rgba(255,255,255,0.9), transparent)"
                  : "linear-gradient(270deg, transparent, rgba(100,230,255,0.95), rgba(255,255,255,0.9), transparent)",
              boxShadow: isBack
                ? "0 0 40px rgba(255,60,160,0.85)"
                : "0 0 40px rgba(60,200,255,0.8)",
              transformOrigin: dir === "left" ? "right center" : "left center",
            }}
          />
          <div
            className={`absolute select-none ${dir === "left" ? "animate-slap-left" : "animate-slap-right"}`}
            style={{
              left: "50%",
              top: "40%",
              marginLeft: -48,
              fontSize: `${clamp(56, 44 + power * 48, 100)}px`,
              filter: isBack
                ? "drop-shadow(0 6px 0 rgba(0,0,0,0.4)) drop-shadow(0 0 20px rgba(255,60,160,0.95))"
                : "drop-shadow(0 6px 0 rgba(0,0,0,0.4)) drop-shadow(0 0 20px rgba(60,200,255,0.9))",
              lineHeight: 1,
            }}
          >
            {emoji}
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="absolute animate-slap-streak"
              style={{
                top: `${36 + i * 7}%`,
                left: dir === "left" ? "8%" : "auto",
                right: dir === "right" ? "8%" : "auto",
                width: `${50 + i * 8}%`,
                height: 2 + (i % 2),
                background: isBack
                  ? dir === "left"
                    ? "linear-gradient(90deg, transparent, rgba(255,180,230,0.8), transparent)"
                    : "linear-gradient(270deg, transparent, rgba(255,180,230,0.8), transparent)"
                  : dir === "left"
                    ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent)"
                    : "linear-gradient(270deg, transparent, rgba(255,255,255,0.75), transparent)",
                animationDelay: `${i * 30}ms`,
                opacity: 0.7,
              }}
            />
          ))}
        </>
      )}

      {/* Giant gag label */}
      <div
        className={`absolute left-1/2 top-[18%] max-w-[94vw] -translate-x-1/2 text-center ${
          isPunch || isUpper
            ? "animate-boom-punch"
            : dir === "left"
              ? "animate-slap-left"
              : "animate-slap-right"
        }`}
        style={{
          fontFamily: "var(--font-display, ui-rounded, system-ui, sans-serif)",
          fontWeight: 900,
          fontSize: `clamp(2.2rem, ${5.5 + power * 4}vw, 5.2rem)`,
          letterSpacing: "0.02em",
          lineHeight: 0.95,
          color: labelColor,
          textShadow: `
              0 0 0 ${stroke},
              4px 4px 0 ${stroke},
              8px 8px 0 #000,
              0 0 40px ${labelColor}cc,
              0 0 80px ${labelColor}88
            `,
          WebkitTextStroke: `2px ${stroke}`,
          transformOrigin: "center center",
        }}
      >
        {active.label}
      </div>

      {/* Side badge */}
      <div
        className="absolute bottom-[16%] left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-center text-xs font-bold tracking-[0.16em] uppercase"
        style={{
          background: "rgba(8,6,12,0.72)",
          border: `2px solid ${isUpper ? "#c44dff" : isPunch ? "#ff6644" : isBack ? "#ff44aa" : "#3db8e2"}`,
          color: "#f2efe8",
          boxShadow: `0 0 24px ${isUpper ? "rgba(180,70,255,0.55)" : isPunch ? "rgba(255,80,40,0.55)" : isBack ? "rgba(255,60,160,0.55)" : "rgba(60,200,255,0.55)"}`,
          animation: "float-in 400ms ease-out both",
        }}
      >
        {active.side === "L" ? "LEFT" : "RIGHT"}{" "}
        {isUpper
          ? "UPPERCUT ↑"
          : isPunch
            ? "JAB"
            : isBack
              ? dir === "left"
                ? "BACKHAND ←"
                : "BACKHAND →"
              : dir === "left"
                ? "PALM SLAP ←"
                : "PALM SLAP →"}{" "}
        · {Math.round(power * 100)}%
      </div>

      {/* Sparks */}
      {Array.from({ length: SPARKS }).map((_, i) => {
        const ang =
          (i / SPARKS) * Math.PI * 2 +
          (isUpper ? -0.4 : isPunch ? 0 : dir === "left" ? 0.4 : -0.4);
        const dist = 40 + (i % 5) * 18 + power * 30;
        const cx = isPunch || isUpper ? sideBias : 50;
        const cy = isUpper ? 62 : isPunch ? 55 : 48;
        const x = cx + Math.cos(ang) * (dist / 4);
        const y = cy + Math.sin(ang) * (dist / 6) - (isUpper ? i * 1.2 : 0);
        const col = isUpper
          ? i % 2
            ? "#c44dff"
            : "#ffd24a"
          : isPunch
            ? i % 2
              ? "#ffd24a"
              : "#ff5533"
            : isBack
              ? i % 2
                ? "#ff44aa"
                : "#ffffff"
              : i % 2
                ? "#9ef0ff"
                : "#ffffff";
        return (
          <div
            key={i}
            className="absolute animate-[cue-spark_0.65s_ease-out_both] rounded-full"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: 6 + (i % 3) * 3,
              height: 6 + (i % 3) * 3,
              marginLeft: -4,
              marginTop: -4,
              background: col,
              boxShadow: `0 0 10px ${col}`,
              animationDelay: `${i * 18}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

function clamp(min: number, v: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
