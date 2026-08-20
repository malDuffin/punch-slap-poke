/**
 * On-screen console via markknol/console-log-viewer
 * https://github.com/markknol/console-log-viewer
 *
 * Script lives at /console-log-viewer.js (public/).
 * Default: debugging OFF.
 */

const STORAGE_KEY = "glove-fight-debugging";
const SCRIPT_ID = "console-log-viewer-script";
/** bottom-aligned so it doesn't cover the title menu as hard */
const SCRIPT_SRC = "/console-log-viewer.js?align=bottom&total=6";
const MAX_ONSCREEN_LINES = 6;

let loadPromise: Promise<void> | null = null;

export function isDebuggingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return false;
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export function setDebuggingPreference(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

function setOverlayVisible(on: boolean) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("debug_console");
  if (el) {
    el.style.display = on ? "" : "none";
    el.style.visibility = on ? "visible" : "hidden";
    el.setAttribute("aria-hidden", on ? "false" : "true");
  }
  // Static props on the viewer constructor (if exposed on window)
  const CLV = (window as unknown as { ConsoleLogViewer?: { LOG_ENABLED?: boolean; IS_CLOSED?: boolean; TOTAL?: number } })
    .ConsoleLogViewer;
  if (CLV) {
    CLV.LOG_ENABLED = on;
    CLV.TOTAL = MAX_ONSCREEN_LINES;
    if (on) CLV.IS_CLOSED = false;
  }
  if (on) {
    watchOnscreenLog();
    trimOnscreenLog();
  }
}

/** Keep the overlay at most six log lines, including a live session that already overflowed. */
function trimOnscreenLog() {
  if (typeof document === "undefined") return;
  const m = document.getElementById("debug_console_messages");
  if (!m) return;
  m.style.maxHeight = "7.8em";
  m.style.overflow = "hidden";
  m.style.lineHeight = "1.3";
  const parts = m.innerHTML.split(/<br\s*\/?>/i).filter((p) => p.trim().length > 0);
  if (parts.length > MAX_ONSCREEN_LINES) {
    m.innerHTML = parts.slice(-MAX_ONSCREEN_LINES).join("<br>");
  }
}

function watchOnscreenLog() {
  if (typeof document === "undefined") return;
  const m = document.getElementById("debug_console_messages");
  if (!m || m.dataset.gfTrim === "1") return;
  m.dataset.gfTrim = "1";
  const obs = new MutationObserver(() => {
    obs.disconnect();
    trimOnscreenLog();
    obs.observe(m, { childList: true, subtree: true, characterData: true });
  });
  obs.observe(m, { childList: true, subtree: true, characterData: true });
}

function loadViewerScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (document.getElementById("debug_console")) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // Wait a tick for init
      window.setTimeout(() => resolve(), 80);
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => {
      // Script self-inits DebugSource.main()
      window.setTimeout(() => resolve(), 50);
    };
    s.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load console-log-viewer"));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/** Apply debugging overlay state (loads script when turning on). */
export async function applyDebugging(on: boolean): Promise<void> {
  if (typeof window === "undefined") return;
  if (on) {
    try {
      await loadViewerScript();
      setOverlayVisible(true);
      console.info("[debug] On-screen console enabled (console-log-viewer)");
    } catch (e) {
      console.warn("[debug] console-log-viewer failed", e);
    }
  } else {
    setOverlayVisible(false);
  }
}

/** Call once on app mount — respects stored preference (default off). */
export function initDebuggingFromPreference(): void {
  if (typeof window === "undefined") return;
  const on = isDebuggingEnabled();
  void applyDebugging(on);
}
