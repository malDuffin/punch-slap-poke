import type * as Party from "partykit/server";

/**
 * Shared arena room. Clients send pose + hand-gesture snapshots;
 * the server fans them out. No gameplay authority — just a relay.
 */
export default class ArenaServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  names = new Map<string, string>();
  slots = new Map<string, number>();

  onConnect(conn: Party.Connection) {
    const slot = this.nextSlot();
    this.slots.set(conn.id, slot);
    conn.send(
      JSON.stringify({
        t: "hello",
        id: conn.id,
        room: this.room.id,
        slot,
        peers: this.peerList(),
      }),
    );
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (typeof message !== "string") return;
    let data: { t?: string; name?: string };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (!data || typeof data.t !== "string") return;

    if (data.t === "hello") {
      const name = String(data.name || "Fighter").slice(0, 24);
      this.names.set(sender.id, name);
      this.room.broadcast(JSON.stringify({ t: "peers", peers: this.peerList() }));
      this.room.broadcast(
        JSON.stringify({
          t: "join",
          id: sender.id,
          name,
          slot: this.slots.get(sender.id) ?? 0,
        }),
        [sender.id],
      );
      return;
    }

    // Pose / heart events: fan out to everyone else in the room
    this.room.broadcast(message, [sender.id]);
  }

  onClose(conn: Party.Connection) {
    this.names.delete(conn.id);
    this.slots.delete(conn.id);
    this.room.broadcast(JSON.stringify({ t: "leave", id: conn.id }));
  }

  onError(conn: Party.Connection) {
    this.onClose(conn);
  }

  onRequest() {
    return new Response("ok", { status: 200 });
  }

  nextSlot() {
    const used = new Set(this.slots.values());
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }

  peerList() {
    const out: { id: string; name: string; slot: number }[] = [];
    for (const c of this.room.getConnections()) {
      out.push({
        id: c.id,
        name: this.names.get(c.id) || "Fighter",
        slot: this.slots.get(c.id) ?? 0,
      });
    }
    return out;
  }
}

ArenaServer satisfies Party.Worker;
