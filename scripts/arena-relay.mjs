#!/usr/bin/env node
/**
 * Local-only PartySocket-compatible arena relay.
 * Binds 127.0.0.1:1999 so the live preview never mistakes this for the app.
 * Vite proxies /parties and /party here. Same hello/join/leave/s protocol
 * as party/server.ts.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PARTY_PORT || 1999);

/** @type {Map<string, Map<string, { ws: import('ws').WebSocket, name: string, slot: number }>>} */
const rooms = new Map();

function roomIdFromUrl(url) {
  const path = String(url || "/").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  // /parties/main/<room>  or  /party/<room>
  if (parts[0] === "parties" && parts[2]) return parts[2];
  if (parts[0] === "party" && parts[1]) return parts[1];
  return parts[parts.length - 1] || "arena";
}

function nextSlot(room) {
  const used = new Set([...room.values()].map((c) => c.slot));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

function peerList(room) {
  return [...room.entries()].map(([id, c]) => ({
    id,
    name: c.name || "Fighter",
    slot: c.slot,
  }));
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, exceptId) {
  const raw = typeof obj === "string" ? obj : JSON.stringify(obj);
  for (const [id, c] of room) {
    if (id === exceptId) continue;
    if (c.ws.readyState === 1) c.ws.send(raw);
  }
}

const http = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("ok");
});

const wss = new WebSocketServer({ noServer: true });

http.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const id = randomUUID();
  const rid = roomIdFromUrl(req.url || "");
  if (!rooms.has(rid)) rooms.set(rid, new Map());
  const room = rooms.get(rid);
  const slot = nextSlot(room);
  room.set(id, { ws, name: "Fighter", slot });

  send(ws, { t: "hello", id, room: rid, slot, peers: peerList(room) });

  ws.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (!data || typeof data.t !== "string") return;
    const rec = room.get(id);
    if (!rec) return;

    if (data.t === "hello") {
      rec.name = String(data.name || "Fighter").slice(0, 24);
      broadcast(room, { t: "peers", peers: peerList(room) });
      broadcast(room, { t: "join", id, name: rec.name, slot: rec.slot }, id);
      return;
    }
    broadcast(room, text, id);
  });

  const gone = () => {
    if (!room.has(id)) return;
    room.delete(id);
    broadcast(room, { t: "leave", id });
    if (room.size === 0) rooms.delete(rid);
  };
  ws.on("close", gone);
  ws.on("error", gone);
});

http.listen(PORT, HOST, () => {
  console.log(`[arena-relay] ${HOST}:${PORT}`);
});
