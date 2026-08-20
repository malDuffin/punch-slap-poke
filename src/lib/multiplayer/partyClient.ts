import PartySocket from "partysocket";

export type HandSnap = {
  p: [number, number, number];
  g: string;
};

export type RemoteState = {
  id: string;
  name: string;
  slot: number;
  p: [number, number, number];
  f: [number, number, number];
  L: HandSnap | null;
  R: HandSnap | null;
  at: number;
};

export function partyHost(): string {
  if (typeof window === "undefined") return "127.0.0.1:8080";
  const env = (import.meta as { env?: { VITE_PARTYKIT_HOST?: string } }).env?.VITE_PARTYKIT_HOST;
  if (env && String(env).trim()) return String(env).replace(/^https?:\/\//, "");
  // Same-origin — arena WebSocket is hosted on the Vite/dev game server.
  return window.location.host;
}

/** Lateral spawn offset so two desktop fighters don't stack at the origin. */
export function slotWorldX(slot: number): number {
  if (!slot) return 0;
  const n = Math.ceil(slot / 2);
  return (slot % 2 === 1 ? 1 : -1) * n * 2.15;
}

export class PartyArena {
  socket: PartySocket | null = null;
  selfId = "";
  slot = 0;
  room = "arena";
  name = "Fighter";
  connected = false;
  remotes = new Map<string, RemoteState>();
  onChange: (() => void) | null = null;
  lastError: string | null = null;
  #gen = 0;

  connect(room: string, name: string) {
    this.close();
    this.room = (room || "arena").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "arena";
    this.name = (name || "Fighter").slice(0, 24);
    this.lastError = null;
    this.slot = 0;
    const gen = ++this.#gen;
    try {
      this.socket = new PartySocket({
        host: partyHost(),
        room: this.room,
        party: "main",
      });
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : "connect failed";
      return;
    }
    const sock = this.socket;
    sock.addEventListener("open", () => {
      if (this.#gen !== gen || this.socket !== sock) return;
      this.connected = true;
      this.selfId = sock.id || "";
      sock.send(JSON.stringify({ t: "hello", name: this.name }));
      this.onChange?.();
    });
    sock.addEventListener("close", () => {
      if (this.#gen !== gen || this.socket !== sock) return;
      this.connected = false;
      this.onChange?.();
    });
    sock.addEventListener("error", () => {
      if (this.#gen !== gen || this.socket !== sock) return;
      this.lastError = "PartyKit socket error";
      this.onChange?.();
    });
    sock.addEventListener("message", (ev) => {
      if (this.#gen !== gen || this.socket !== sock) return;
      this.handle(String(ev.data || ""));
    });
  }

  handle(raw: string) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const t = data.t;
    if (t === "hello") {
      this.selfId = String(data.id || this.selfId);
      if (typeof data.slot === "number") this.slot = data.slot;
      this.ingestPeers(data.peers);
    } else if (t === "peers") {
      this.ingestPeers(data.peers);
    } else if (t === "join") {
      const id = String(data.id || "");
      if (id && id !== this.selfId && !this.remotes.has(id)) {
        this.remotes.set(
          id,
          blankRemote(id, String(data.name || "Fighter"), Number(data.slot) || 0),
        );
      }
    } else if (t === "leave") {
      this.remotes.delete(String(data.id || ""));
    } else if (t === "s") {
      const id = String(data.id || "");
      if (!id || id === this.selfId) return;
      const prev = this.remotes.get(id) || blankRemote(id, String(data.name || "Fighter"), Number(data.slot) || 0);
      prev.p = asVec3(data.p, prev.p);
      prev.f = asVec3(data.f, prev.f);
      prev.L = asHand(data.L);
      prev.R = asHand(data.R);
      if (typeof data.name === "string" && data.name) prev.name = data.name.slice(0, 24);
      if (typeof data.slot === "number") prev.slot = data.slot;
      prev.at = performance.now();
      this.remotes.set(id, prev);
    }
    this.onChange?.();
  }

  ingestPeers(list: unknown) {
    if (!Array.isArray(list)) return;
    const seen = new Set<string>();
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { id?: string; name?: string; slot?: number };
      const id = String(rec.id || "");
      if (!id || id === this.selfId) continue;
      seen.add(id);
      if (!this.remotes.has(id)) {
        this.remotes.set(id, blankRemote(id, String(rec.name || "Fighter"), Number(rec.slot) || 0));
      } else {
        const n = String(rec.name || "");
        if (n) this.remotes.get(id)!.name = n.slice(0, 24);
        if (typeof rec.slot === "number") this.remotes.get(id)!.slot = rec.slot;
      }
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
  }

  sendState(payload: {
    p: [number, number, number];
    f: [number, number, number];
    L: HandSnap | null;
    R: HandSnap | null;
  }) {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        t: "s",
        id: this.selfId,
        name: this.name,
        slot: this.slot,
        ...payload,
      }),
    );
  }

  close() {
    this.#gen += 1;
    const sock = this.socket;
    this.socket = null;
    this.connected = false;
    this.remotes.clear();
    try {
      sock?.close();
    } catch {
      /* */
    }
  }
}

function blankRemote(id: string, name: string, slot = 0): RemoteState {
  return { id, name, slot, p: [0, 1.5, -4], f: [0, 0, -1], L: null, R: null, at: 0 };
}

function asVec3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v) || v.length < 3) return fallback;
  return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
}

function asHand(v: unknown): HandSnap | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { p?: unknown; g?: unknown };
  if (!Array.isArray(o.p) || o.p.length < 3) return null;
  return {
    p: [Number(o.p[0]) || 0, Number(o.p[1]) || 0, Number(o.p[2]) || 0],
    g: String(o.g || "punch"),
  };
}
