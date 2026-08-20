# Punch Slap Poke

First-person beat-em-up: **Rock** punches, **Paper** slaps, **Scissors** pokes.

Desktop (mouse + WASD), mobile, webcam hand tracking, and **WebXR** (Quest, Pico, Vision Pro).

Realtime co-op over **PartyKit** — share a room, make half-hearts, fuse a shield.

## Play

```bash
npm install
npm run dev:all   # Vite :8080 + PartyKit :1999
# or: npm run dev   (app only; join stays offline)
```

Then open the app and:

- **Desktop** — click to lock, WASD to move, click / space to punch
- **Camera hands** — enable the camera, make rock / paper / scissors
- **VR** — tap **Enter VR** on a headset (Quest, Pico, Vision Pro). Vision Pro needs a full Safari tab, not an embed.
- **Multiplayer** — pick a room code, share the link, press **Join room**

## Gestures

| Shape | Visual | Attack |
| --- | --- | --- |
| Closed fist | Boxing glove | Punch (long range) |
| Open palm | Fish | Slap (2×, short range) |
| Index + middle | Scissor blades | Poke |
| Thumb out (up / down) | Thumbs prop | Social only — tucked thumb stays a fist |
| Half heart (index + loose thumb) | Half-heart on that hand | Walk two halves together — they glow, then fuse a shield |
| Fist high + throw + open | Grenade | 3s fuse, then blast |

Finger-click (thumb + middle) powers up the next hit (2× glow). **H** toggles half-heart pose.

## Multiplayer (PartyKit)

The arena is a PartyKit room (`party/server.ts`). Clients send pose + hand-gesture snapshots; the server relays them. Two fighters in the same room see each other as capsules.

- Same room code → same arena
- A half-heart on your hand becomes a half-heart model
- When two halves (yours + a friend’s, or both of yours) close in, they glow harder
- Full glow creates the heart shield

Local preview proxies `/parties` to PartyKit on port 1999. Deploy the party with `npx partykit deploy` and set `VITE_PARTYKIT_HOST` to the `*.partykit.dev` host.

## Stack

React 19 · Vite · TanStack Start · Three.js · Box3D Wasm · MediaPipe Hands · WebXR · PartyKit

MediaPipe WASM is fetched from the CDN at runtime (not checked into git).
