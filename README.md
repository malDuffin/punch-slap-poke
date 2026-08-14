# Punch Slap Poke

First-person beat-em-up: **Rock** punches, **Paper** slaps, **Scissors** pokes.

Desktop (mouse + WASD), mobile, webcam hand tracking, and **WebXR** (Quest, Pico, Vision Pro).

## Play

```bash
npm install
npm run dev
```

Then open the app and:

- **Desktop** — click to lock, WASD to move, click / space to punch
- **Camera hands** — enable the camera, make rock / paper / scissors
- **VR** — tap **Enter VR** on a headset (Quest, Pico, Vision Pro). Vision Pro needs a full Safari tab, not an embed.

## Gestures

| Shape | Visual | Attack |
| --- | --- | --- |
| Closed fist | Boxing glove | Punch (long range) |
| Open palm | Fish | Slap (2×, short range) |
| Index + middle | Scissor blades | Poke |
| Thumb out (up / down) | Thumbs prop | Social only — tucked thumb stays a fist |
| Two-hand heart | Heart shield | Damages incoming enemies |
| Fist high + throw + open | Grenade | 3s fuse, then blast |

Finger-click (thumb + middle) powers up the next hit (2× glow).

## Stack

React 19 · Vite · TanStack Start · Three.js · Box3D Wasm · MediaPipe Hands · WebXR

MediaPipe WASM is fetched from the CDN at runtime (not checked into git).
