import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const LOCAL_URL = { L: "/xr/left.glb", R: "/xr/right.glb" };
const CDN_URL = {
  L: "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/left.glb",
  R: "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/right.glb",
};

const FINGERS: Record<string, string[]> = {
  thumb: ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
  index: [
    "index-finger-metacarpal",
    "index-finger-phalanx-proximal",
    "index-finger-phalanx-intermediate",
    "index-finger-phalanx-distal",
    "index-finger-tip",
  ],
  middle: [
    "middle-finger-metacarpal",
    "middle-finger-phalanx-proximal",
    "middle-finger-phalanx-intermediate",
    "middle-finger-phalanx-distal",
    "middle-finger-tip",
  ],
  ring: [
    "ring-finger-metacarpal",
    "ring-finger-phalanx-proximal",
    "ring-finger-phalanx-intermediate",
    "ring-finger-phalanx-distal",
    "ring-finger-tip",
  ],
  pinky: [
    "pinky-finger-metacarpal",
    "pinky-finger-phalanx-proximal",
    "pinky-finger-phalanx-intermediate",
    "pinky-finger-phalanx-distal",
    "pinky-finger-tip",
  ],
};

/**
 * Per-joint flexion (radians), applied on rest-pose local axes so parent
 * rotation does not spin later joints around the palm (that was the claw /
 * mirror-bend look). Fingers: MCP / PIP / intermediate / distal.
 * Thumb: mcp / proximal / distal.
 */
const CURL: Record<string, Record<string, number[]>> = {
  punch: {
    thumb: [0.45, 1.25, 0.75],
    index: [1.1, 1.65, 1.5, 1.15],
    middle: [1.15, 1.68, 1.52, 1.18],
    ring: [1.05, 1.6, 1.45, 1.1],
    pinky: [0.95, 1.5, 1.35, 1.05],
  },
  slap: {
    thumb: [0, 0, 0],
    index: [0, 0, 0, 0],
    middle: [0, 0, 0, 0],
    ring: [0, 0, 0, 0],
    pinky: [0, 0, 0, 0],
  },
  poke: {
    thumb: [0.35, 0.55, 0.35],
    index: [0, 0, 0, 0],
    middle: [0, 0, 0, 0],
    ring: [0.9, 1.5, 1.35, 1.1],
    pinky: [0.95, 1.52, 1.38, 1.12],
  },
  heart: {
    thumb: [0.06, 0.1, 0.06],
    index: [0.12, 0.32, 0.48, 0.32],
    middle: [0.55, 0.85, 1.15, 0.85],
    ring: [0.8, 1.1, 1.35, 1.0],
    pinky: [0.9, 1.18, 1.42, 1.05],
  },
};

const GHOST_COLOR = 0xb7e4ff;
const GHOST_EMISSIVE = 0x2a6aa8;

const prototypes: { L: THREE.Object3D | null; R: THREE.Object3D | null } = { L: null, R: null };
let loadPromise: Promise<void> | null = null;
const pending: THREE.Group[] = [];

export function poseGuidesReady() {
  return !!(prototypes.L && prototypes.R);
}

export function preloadPoseGuideHands(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (prototypes.L && prototypes.R) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const loader = new GLTFLoader();
    const loadOne = (side: "L" | "R") =>
      new Promise<void>((resolve) => {
        const tryUrl = (url: string, fallback?: string) => {
          loader.load(
            url,
            (gltf) => {
              prototypes[side] = gltf.scene;
              resolve();
            },
            undefined,
            () => {
              if (fallback) tryUrl(fallback);
              else resolve();
            },
          );
        };
        tryUrl(LOCAL_URL[side], CDN_URL[side]);
      });
    try {
      await Promise.all([loadOne("L"), loadOne("R")]);
    } catch {
      /* keep placeholders */
    }
    for (const g of pending.splice(0)) fillGuide(g);
  })();
  return loadPromise;
}

function collectBones(root: THREE.Object3D) {
  const bones: Record<string, THREE.Object3D> = {};
  root.traverse((o) => {
    if (o.name) bones[o.name] = o;
  });
  return bones;
}

function dummyPalmOut(dummies: Record<string, THREE.Object3D>) {
  const idx = new THREE.Vector3();
  const pnk = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const wr = new THREE.Vector3();
  dummies["index-finger-metacarpal"]?.getWorldPosition(idx);
  dummies["pinky-finger-metacarpal"]?.getWorldPosition(pnk);
  (dummies["middle-finger-phalanx-proximal"] || dummies["middle-finger-tip"])?.getWorldPosition(mid);
  dummies.wrist?.getWorldPosition(wr);
  const across = pnk.sub(idx);
  const along = mid.sub(wr);
  const n = new THREE.Vector3().crossVectors(across, along);
  if (n.lengthSq() < 1e-12) return new THREE.Vector3(1, 0, 0);
  return n.normalize();
}

/**
 * Rest-pose local flexion axis for every joint: boneDir × palm, expressed in
 * that joint's bind local space. Using this frozen axis (instead of
 * re-crossing after each parent curl) folds fingers onto the palm like a
 * real fist instead of orbiting into a claw or a mirrored bend.
 */
function restFlexAxes(dummies: Record<string, THREE.Object3D>, palm: THREE.Vector3) {
  const axes: Record<string, THREE.Vector3> = {};
  for (const chain of Object.values(FINGERS)) {
    for (let i = 0; i < chain.length - 1; i++) {
      const joint = dummies[chain[i]];
      const next = dummies[chain[i + 1]];
      if (!joint || !next) continue;
      joint.updateMatrixWorld(true);
      next.updateMatrixWorld(true);
      const jpos = new THREE.Vector3();
      const npos = new THREE.Vector3();
      joint.getWorldPosition(jpos);
      next.getWorldPosition(npos);
      const boneDir = npos.sub(jpos);
      if (boneDir.lengthSq() < 1e-12) continue;
      const axisWorld = new THREE.Vector3().crossVectors(boneDir, palm);
      if (axisWorld.lengthSq() < 1e-12) continue;
      axisWorld.normalize();
      const inv = new THREE.Matrix4().copy(joint.matrixWorld).invert();
      const axisLocal = axisWorld.clone().transformDirection(inv);
      if (axisLocal.lengthSq() < 1e-12) continue;
      axes[chain[i]] = axisLocal.normalize();
    }
  }
  return axes;
}

function curlByRestAxis(joint: THREE.Object3D, axisLocal: THREE.Vector3 | undefined, angle: number) {
  if (!joint || !axisLocal || Math.abs(angle) < 1e-4) return;
  joint.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axisLocal, angle));
  joint.updateMatrixWorld(true);
}

/**
 * The generic-hand GLB is a FLAT skeleton (every joint is a sibling under Armature).
 * Skinning uses each bone's world matrix vs its inverse-bind, same as XRHandMeshModel.
 *
 * Do NOT rotate-and-translate those siblings in place — that tears the mesh (the
 * previous pose-guide bug). Instead: pose a temporary parented chain, then bake
 * each dummy's world transform back onto the still-flat bones.
 */
function applyGesturePose(root: THREE.Object3D, kind: string) {
  if (kind === "slap") return;
  const bones = collectBones(root);
  if (!bones.wrist) return;
  const curls = CURL[kind] || CURL.slap;
  const dummyRoot = new THREE.Group();
  const dummies: Record<string, THREE.Object3D> = {};
  const names = ["wrist", ...Object.values(FINGERS).flat()];
  for (const name of names) {
    const src = bones[name];
    if (!src) continue;
    const d = new THREE.Object3D();
    d.name = name;
    d.position.copy(src.position);
    d.quaternion.copy(src.quaternion);
    dummyRoot.add(d);
    dummies[name] = d;
  }
  dummyRoot.updateMatrixWorld(true);
  for (const chain of Object.values(FINGERS)) {
    for (let i = 0; i < chain.length - 1; i++) {
      const p = dummies[chain[i]];
      const c = dummies[chain[i + 1]];
      if (p && c) p.attach(c);
    }
    const mcp = dummies[chain[0]];
    if (mcp && dummies.wrist) dummies.wrist.attach(mcp);
  }
  dummyRoot.updateMatrixWorld(true);

  const palm = dummyPalmOut(dummies);
  const axes = restFlexAxes(dummies, palm);
  for (const [finger, chain] of Object.entries(FINGERS)) {
    const angles = curls[finger] || [];
    let k = 0;
    for (let i = 0; i < chain.length - 1 && k < angles.length; i++, k++) {
      const joint = dummies[chain[i]];
      if (joint) curlByRestAxis(joint, axes[chain[i]], angles[k] || 0);
    }
  }
  dummyRoot.updateMatrixWorld(true);

  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const name of names) {
    if (name === "wrist") continue;
    const d = dummies[name];
    const b = bones[name];
    if (!d || !b) continue;
    d.matrixWorld.decompose(p, q, s);
    b.position.copy(p);
    b.quaternion.copy(q);
  }
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.update();
  });
}

function ghostify(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = mats.map((m) => {
      const c = (m as THREE.Material).clone() as THREE.MeshStandardMaterial;
      c.transparent = true;
      c.opacity = 0.42;
      c.depthWrite = false;
      c.side = THREE.DoubleSide;
      if (c.color) c.color.setHex(GHOST_COLOR);
      if ("emissive" in c && c.emissive) {
        c.emissive.setHex(GHOST_EMISSIVE);
        c.emissiveIntensity = 0.45;
      }
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
    mesh.renderOrder = 26;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

function fillGuide(g: THREE.Group) {
  const kind = g.userData.poseKind as string;
  const side = g.userData.poseSide as "L" | "R";
  const proto = prototypes[side];
  if (!proto) return;
  while (g.children.length) g.remove(g.children[0]);
  const cloned = cloneSkinned(proto);
  applyGesturePose(cloned, kind);
  ghostify(cloned);
  g.add(cloned);
  g.updateMatrixWorld(true);
  const wrist = cloned.getObjectByName("wrist");
  if (wrist) {
    const restP = new THREE.Vector3();
    const restQ = new THREE.Quaternion();
    wrist.getWorldPosition(restP);
    wrist.getWorldQuaternion(restQ);
    g.worldToLocal(restP);
    const gq = new THREE.Quaternion();
    g.getWorldQuaternion(gq);
    restQ.premultiply(gq.invert());
    g.userData.restWristPos = restP;
    g.userData.restWristQuat = restQ;
  }
  g.userData.skinnedReady = true;
  cloned.traverse((o) => {
    o.frustumCulled = false;
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
  });
}

/** Same generic-hand GLB the tracked XR hands use, posed to the target gesture. */
export function makeTutorialPoseGuide(
  kind: "punch" | "slap" | "poke" | "heart",
  side: "L" | "R",
): THREE.Group {
  const g = new THREE.Group();
  g.name = "poseGuide_" + kind + "_" + side;
  g.userData.poseKind = kind;
  g.userData.poseSide = side;
  g.userData.skinnedReady = false;
  g.frustumCulled = false;
  g.scale.setScalar(1.04);
  if (prototypes[side]) fillGuide(g);
  else if (typeof window !== "undefined") {
    pending.push(g);
    void preloadPoseGuideHands();
  }
  return g;
}

/**
 * Place a guide so its wrist bone matches a live wrist pose, then lift it
 * world-up (never along the camera).
 */
export function placePoseGuide(
  guide: THREE.Group,
  worldPos: THREE.Vector3,
  worldQuat: THREE.Quaternion | null,
  worldUpLift = 0.18,
) {
  const restP: THREE.Vector3 | undefined = guide.userData.restWristPos;
  const restQ: THREE.Quaternion | undefined = guide.userData.restWristQuat;
  const target = worldPos.clone();
  target.y += worldUpLift;
  if (worldQuat) {
    const q = worldQuat.clone();
    if (restQ) q.multiply(restQ.clone().invert());
    guide.quaternion.copy(q);
    if (restP) {
      const offset = restP.clone().applyQuaternion(q);
      guide.position.copy(target).sub(offset);
    } else {
      guide.position.copy(target);
    }
  } else {
    guide.position.copy(target);
  }
}
