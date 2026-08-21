import * as THREE from "three";

/** Shared materials — fewer draw calls, richer cartoon look */
export function createPalette() {
  return {
    gloveRed: new THREE.MeshStandardMaterial({
      color: 0xe23d3d,
      roughness: 0.32,
      metalness: 0.18,
      emissive: 0x4a0808,
      emissiveIntensity: 0.12,
    }),
    gloveGold: new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      roughness: 0.22,
      metalness: 0.55,
      emissive: 0xff8800,
      emissiveIntensity: 0.75,
    }),
    skin: new THREE.MeshStandardMaterial({ color: 0xf0c8a8, roughness: 0.52, metalness: 0.02 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.78, metalness: 0.15 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xb88852, roughness: 0.86, metalness: 0.02 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }),
    woodBright: new THREE.MeshStandardMaterial({
      color: 0xd4a86a,
      roughness: 0.75,
      metalness: 0.04,
    }),
    leaf: new THREE.MeshStandardMaterial({
      color: 0x3d9a4a,
      roughness: 0.72,
      emissive: 0x0a3010,
      emissiveIntensity: 0.08,
    }),
    leafDark: new THREE.MeshStandardMaterial({ color: 0x2a6e35, roughness: 0.85 }),
    leafLime: new THREE.MeshStandardMaterial({
      color: 0x7dce4a,
      roughness: 0.55,
      emissive: 0x245018,
      emissiveIntensity: 0.14,
    }),
    leafSun: new THREE.MeshStandardMaterial({
      color: 0xc6d44a,
      roughness: 0.58,
      emissive: 0x4a5010,
      emissiveIntensity: 0.12,
    }),
    barkDark: new THREE.MeshStandardMaterial({
      color: 0x3d2414,
      roughness: 0.96,
      metalness: 0.02,
    }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.95 }),
    brawler: new THREE.MeshStandardMaterial({
      color: 0xc45ad4,
      roughness: 0.38,
      metalness: 0.12,
      emissive: 0x5a1070,
      emissiveIntensity: 0.28,
    }),
    rusher: new THREE.MeshStandardMaterial({
      color: 0xe85a5a,
      roughness: 0.35,
      metalness: 0.14,
      emissive: 0x701010,
      emissiveIntensity: 0.32,
    }),
    thrower: new THREE.MeshStandardMaterial({
      color: 0x5ab4e8,
      roughness: 0.35,
      metalness: 0.18,
      emissive: 0x103860,
      emissiveIntensity: 0.28,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x7ec8e3,
      roughness: 0.12,
      metalness: 0.35,
      transparent: true,
      opacity: 0.78,
      emissive: 0x204050,
      emissiveIntensity: 0.15,
    }),
    star: new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      emissive: 0xffaa00,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.5,
    }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32 }),
    black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
    cloud: new THREE.MeshStandardMaterial({
      color: 0xfff8f0,
      roughness: 1,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
    hill: new THREE.MeshStandardMaterial({ color: 0x4a9a58, roughness: 1 }),
    grass: new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.92, metalness: 0.02 }),
    neonPink: new THREE.MeshStandardMaterial({
      color: 0xff66cc,
      emissive: 0xff33aa,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.4,
    }),
    neonCyan: new THREE.MeshStandardMaterial({
      color: 0x44eeff,
      emissive: 0x00ccff,
      emissiveIntensity: 1.35,
      roughness: 0.25,
      metalness: 0.4,
    }),
    neonGold: new THREE.MeshStandardMaterial({
      color: 0xffe08a,
      emissive: 0xffaa22,
      emissiveIntensity: 1.2,
      roughness: 0.28,
      metalness: 0.45,
    }),
    rope: new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      roughness: 0.35,
      metalness: 0.85,
    }),
    fishBody: new THREE.MeshStandardMaterial({
      color: 0x5ec8e8,
      roughness: 0.35,
      metalness: 0.2,
      emissive: 0x0a4060,
      emissiveIntensity: 0.25,
    }),
    fishBelly: new THREE.MeshStandardMaterial({
      color: 0xd8f4ff,
      roughness: 0.45,
      metalness: 0.08,
    }),
    fishFin: new THREE.MeshStandardMaterial({
      color: 0xff8a5c,
      roughness: 0.4,
      metalness: 0.15,
      emissive: 0x802010,
      emissiveIntensity: 0.2,
      side: THREE.DoubleSide,
    }),
    bladeSteel: new THREE.MeshStandardMaterial({
      color: 0xc8d4e0,
      roughness: 0.18,
      metalness: 0.95,
      emissive: 0x304050,
      emissiveIntensity: 0.15,
    }),
    bladeEdge: new THREE.MeshStandardMaterial({
      color: 0xffe8a0,
      roughness: 0.12,
      metalness: 0.9,
      emissive: 0xffaa22,
      emissiveIntensity: 0.65,
    }),
    bladeHilt: new THREE.MeshStandardMaterial({
      color: 0x2a1a12,
      roughness: 0.7,
      metalness: 0.2,
    }),
  };
}

export type Palette = ReturnType<typeof createPalette>;

export function makeGlove(
  palette: Palette,
  side: "L" | "R",
  powered = false,
): THREE.Group {
  const g = new THREE.Group();
  const mat = powered ? palette.gloveGold : palette.gloveRed;
  const dark = new THREE.MeshStandardMaterial({
    color: powered ? 0xaa7700 : 0x8a1515,
    roughness: 0.45,
    metalness: 0.12,
  });
  const lace = palette.white;

  // Main padded fist body — classic boxing mitt silhouette
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 24), mat);
  body.scale.set(1.22, 1.02, 1.38);
  body.castShadow = true;
  g.add(body);

  // Knuckle plateau
  const knucklePad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.2), mat);
  knucklePad.position.set(0, 0.1, 0.16);
  knucklePad.castShadow = true;
  g.add(knucklePad);

  // Four knuckle domes
  for (let i = 0; i < 4; i++) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 14), mat);
    k.position.set(-0.115 + i * 0.076, 0.125, 0.26);
    k.castShadow = true;
    g.add(k);
  }

  // Thumb pouch
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 14), mat);
  thumb.scale.set(0.85, 0.9, 1.25);
  thumb.position.set(side === "L" ? -0.16 : 0.16, -0.02, 0.06);
  thumb.rotation.z = side === "L" ? 0.5 : -0.5;
  thumb.castShadow = true;
  g.add(thumb);

  // Wrist cuff / gauntlet
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.24, 20), palette.cuff);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = -0.2;
  cuff.castShadow = true;
  g.add(cuff);

  // Velcro strap
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.08), dark);
  strap.position.set(0, 0.08, -0.14);
  g.add(strap);

  // Laces on back of hand
  for (let i = 0; i < 4; i++) {
    const laceMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.012), lace);
    laceMesh.position.set(0, 0.04 + i * 0.035, 0.02);
    g.add(laceMesh);
  }

  // Brand circle
  const logo = new THREE.Mesh(
    new THREE.CircleGeometry(0.045, 20),
    powered
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa00, emissiveIntensity: 0.4 })
      : new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xaa6600, emissiveIntensity: 0.35 }),
  );
  logo.position.set(side === "L" ? -0.14 : 0.14, 0.04, 0.08);
  logo.rotation.y = side === "L" ? -0.7 : 0.7;
  g.add(logo);

  // Gloss highlight
  const gloss = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.4),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.75,
      transparent: true,
      opacity: 0.32,
    }),
  );
  gloss.position.set(0.05, 0.12, 0.1);
  g.add(gloss);

  // Soft under-padding
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), dark);
  under.scale.set(1.1, 0.55, 1.15);
  under.position.set(0, -0.1, 0.05);
  g.add(under);

  if (powered) {
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 18, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    g.add(aura);
  }

  // Knuckles were built on +Z; flip so punch-forward = local −Z (Three lookAt / XR −Z)
  // Children stay as-is; root content reoriented via inner pivot.
  const art = new THREE.Group();
  while (g.children.length) art.add(g.children[0]!);
  art.rotation.y = Math.PI; // +Z knuckles → −Z forward
  g.add(art);

  g.scale.x = side === "L" ? 1 : -1;
  return g;
}

export function makeOpenHand(palette: Palette, side: "L" | "R"): THREE.Group {
  // legacy alias → fish
  return makeFishHand(palette, side, false);
}

export function makePokeHand(palette: Palette, side: "L" | "R"): THREE.Group {
  return makeBladeHand(palette, side, false);
}

/** Paper — chunky cartoon fish.
 *  Built nose along +Z then oriented so at identity:
 *  - long body is horizontal
 *  - nose points forward into the scene (−Z, Three lookAt convention)
 *  - side profile faces the camera
 */
export function makeFishHand(palette: Palette, side: "L" | "R", powered = false): THREE.Group {
  const g = new THREE.Group();
  const art = new THREE.Group();
  const bodyMat = powered ? palette.gloveGold : palette.fishBody;
  const bellyMat = powered ? palette.neonGold : palette.fishBelly;
  const finMat = palette.fishFin;
  const scaleMat = new THREE.MeshStandardMaterial({
    color: powered ? 0xffcc44 : 0x3aa8d0,
    roughness: 0.3,
    metalness: 0.25,
    emissive: powered ? 0xaa6600 : 0x0a3048,
    emissiveIntensity: 0.2,
  });

  // Body elongated along +Z (nose +Z in art space)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 20), bodyMat);
  body.scale.set(0.78, 0.72, 1.85);
  body.castShadow = true;
  art.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), bellyMat);
  belly.scale.set(0.7, 0.48, 1.4);
  belly.position.set(0, -0.055, 0.02);
  art.add(belly);

  // Scales along the flanks (face +X so after roll they face camera)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const sc = new THREE.Mesh(new THREE.CircleGeometry(0.028, 8), scaleMat);
      const z = -0.12 + col * 0.06;
      sc.position.set(0.06, -0.01 + row * 0.03, z);
      sc.rotation.y = -Math.PI / 2;
      art.add(sc);
    }
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), bodyMat);
  head.scale.set(0.9, 0.82, 1.1);
  head.position.z = 0.24;
  head.castShadow = true;
  art.add(head);

  // Cone default points +Y → rotate to +Z
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.15, 14), bodyMat);
  snout.rotation.x = Math.PI / 2;
  snout.position.z = 0.38;
  art.add(snout);

  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.032, 0.01, 8, 16, Math.PI),
    palette.black,
  );
  mouth.rotation.x = Math.PI / 2;
  mouth.position.set(0, -0.025, 0.42);
  art.add(mouth);

  // Eyes on the +X flank (becomes camera-facing after orient)
  for (const sy of [-1, 1] as const) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 12), palette.white);
    eyeWhite.position.set(0.07, sy * 0.03, 0.28);
    art.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), palette.black);
    pupil.position.set(0.095, sy * 0.03, 0.3);
    art.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 6), palette.white);
    shine.position.set(0.1, sy * 0.035, 0.31);
    art.add(shine);
  }

  // Forked tail at −Z
  const tailRoot = new THREE.Group();
  tailRoot.position.z = -0.32;
  const tailL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 6), finMat);
  tailL.rotation.x = -Math.PI / 2;
  tailL.rotation.z = 0.5;
  tailL.position.set(0, 0.05, -0.05);
  tailRoot.add(tailL);
  const tailR = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 6), finMat);
  tailR.rotation.x = -Math.PI / 2;
  tailR.rotation.z = -0.5;
  tailR.position.set(0, -0.04, -0.05);
  tailRoot.add(tailR);
  art.add(tailRoot);

  // Pectoral fins
  for (const sy of [-1, 1] as const) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), finMat);
    fin.rotation.z = sy * 1.2;
    fin.position.set(0.02, sy * 0.12, 0.02);
    fin.castShadow = true;
    art.add(fin);
  }

  // Dorsal (points +Y in art space)
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 6), finMat);
  dorsal.position.set(0, 0.14, 0);
  dorsal.rotation.x = -0.15;
  art.add(dorsal);

  if (powered) {
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.022 + i * 0.008, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0xaaffff,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      );
      b.position.set(0.08, 0.04 + i * 0.03, 0.1 + i * 0.04);
      art.add(b);
    }
  }

  // Nose +Z → yaw 180° so nose = local −Z (forward).
  // Roll 180° so belly sits under the hand (dorsal on back) — was rendering upside-down in XR.
  art.rotation.order = "YXZ";
  art.rotation.set(Math.PI, Math.PI, 0);
  g.add(art);

  g.scale.x = side === "L" ? 1 : -1;
  return g;
}

/** Scissors — shears, blades horizontal, tips pointing forward (−Z). */
export function makeBladeHand(palette: Palette, side: "L" | "R", powered = false): THREE.Group {
  const g = new THREE.Group();
  const art = new THREE.Group();
  const steel = powered
    ? new THREE.MeshStandardMaterial({
        color: 0xffe8a0,
        roughness: 0.12,
        metalness: 0.95,
        emissive: 0xffaa22,
        emissiveIntensity: 0.55,
      })
    : palette.bladeSteel;
  const edge = palette.bladeEdge;
  const handle = palette.bladeHilt;
  const ringMat = new THREE.MeshStandardMaterial({
    color: powered ? 0xffd24a : 0xe23d3d,
    roughness: 0.35,
    metalness: 0.55,
    emissive: powered ? 0xaa6600 : 0x600808,
    emissiveIntensity: 0.35,
  });

  // Build in art space with tips along +Z, blades flat in XZ (thin in Y = horizontal)
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.045, 16), palette.metal);
  pivot.rotation.x = Math.PI / 2;
  pivot.position.z = 0;
  art.add(pivot);
  const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 12), edge);
  rivet.position.z = 0;
  art.add(rivet);

  // Open in the horizontal plane (rotate around Y), not vertical (Z)
  const bladeA = new THREE.Group();
  const aLen = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.42), steel);
  aLen.position.set(0.015, 0, 0.22);
  aLen.castShadow = true;
  bladeA.add(aLen);
  const aEdge = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.4), edge);
  aEdge.position.set(0.038, 0, 0.22);
  bladeA.add(aEdge);
  const aTip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 7), steel);
  aTip.rotation.x = Math.PI / 2;
  aTip.position.set(0.015, 0, 0.48);
  bladeA.add(aTip);
  // finger loops behind pivot (−Z in art, near camera after flip)
  const loopA = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.016, 10, 24), ringMat);
  loopA.position.set(0.05, 0, -0.15);
  loopA.rotation.x = Math.PI / 2; // loop in XY… want loop facing camera after orient
  loopA.rotation.y = Math.PI / 2;
  bladeA.add(loopA);
  const gripA = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10), handle);
  gripA.rotation.x = Math.PI / 2;
  gripA.position.set(0.02, 0, -0.05);
  bladeA.add(gripA);
  bladeA.rotation.y = 0.16; // open horizontally
  art.add(bladeA);

  const bladeB = new THREE.Group();
  const bLen = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.42), steel);
  bLen.position.set(-0.015, 0, 0.22);
  bLen.castShadow = true;
  bladeB.add(bLen);
  const bEdge = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.4), edge);
  bEdge.position.set(-0.038, 0, 0.22);
  bladeB.add(bEdge);
  const bTip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 7), steel);
  bTip.rotation.x = Math.PI / 2;
  bTip.position.set(-0.015, 0, 0.48);
  bladeB.add(bTip);
  const loopB = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.016, 10, 24), ringMat);
  loopB.position.set(-0.05, 0, -0.15);
  loopB.rotation.y = Math.PI / 2;
  bladeB.add(loopB);
  const gripB = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10), handle);
  gripB.rotation.x = Math.PI / 2;
  gripB.position.set(-0.02, 0, -0.05);
  bladeB.add(gripB);
  bladeB.rotation.y = -0.16;
  art.add(bladeB);

  const shine = new THREE.Mesh(
    new THREE.BoxGeometry(0.006, 0.008, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  );
  shine.position.set(0.02, 0.012, 0.2);
  art.add(shine);

  if (powered) {
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    glow.position.z = 0.18;
    art.add(glow);
  }

  // Tips were built on +Z → yaw 180° so tips = local −Z (forward).
  // Blades stay flat in XZ (thin in Y = horizontal shears, not vertical).
  art.rotation.order = "YXZ";
  art.rotation.set(0, Math.PI, 0);
  g.add(art);

  g.scale.x = side === "L" ? 1 : -1;
  return g;
}

/** Projectile / viewmodel factory for current mode */
export function makeModeHand(
  palette: Palette,
  mode: "punch" | "slap" | "poke",
  side: "L" | "R",
  powered = false,
): THREE.Group {
  if (mode === "slap") return makeFishHand(palette, side, powered);
  if (mode === "poke") return makeBladeHand(palette, side, powered);
  return makeGlove(palette, side, powered);
}

export function makeEnemy(
  palette: Palette,
  type: "brawler" | "rusher" | "thrower",
): THREE.Group {
  // RPS Arena cast:
  //  brawler → punching bag or rock
  //  rusher  → walking scissors
  //  thrower → paper bag or rolled newspaper
  const variant =
    type === "brawler"
      ? Math.random() < 0.55
        ? "bag"
        : "rock"
      : type === "rusher"
        ? "scissors"
        : Math.random() < 0.55
          ? "paper"
          : "news";

  const g =
    variant === "bag"
      ? makePunchingBagEnemy(palette)
      : variant === "rock"
        ? makeRockEnemy(palette)
        : variant === "scissors"
          ? makeScissorsEnemy(palette)
          : variant === "paper"
            ? makePaperBagEnemy(palette)
            : makeNewspaperEnemy(palette);

  g.userData.enemyVariant = variant;
  g.userData.enemyType = type;
  g.userData.damageStage = 0;
  return g;
}

function mat(
  color: number,
  opts: { rough?: number; metal?: number; em?: number; emCol?: number } = {},
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.55,
    metalness: opts.metal ?? 0.08,
    emissive: opts.emCol ?? 0x000000,
    emissiveIntensity: opts.em ?? 0,
  });
}

function addFace(
  g: THREE.Group,
  y: number,
  z: number,
  opts: { scale?: number; skin?: number; angry?: boolean } = {},
) {
  const s = opts.scale ?? 1;
  const face = new THREE.Group();
  face.name = "face";
  face.position.set(0, y, z);
  face.scale.setScalar(s);

  const white = mat(0xfff8f0, { rough: 0.35 });
  const black = mat(0x121014, { rough: 0.45 });
  const pink = mat(0xff6b8a, { rough: 0.4, em: 0.15, emCol: 0x661122 });
  const bruise = mat(0x2a1a40, { rough: 0.7, em: 0.05, emCol: 0x1a0a30 });
  const blood = mat(0x8b1520, { rough: 0.5 });

  for (const side of [-1, 1] as const) {
    const eyeG = new THREE.Group();
    eyeG.name = side < 0 ? "eyeL" : "eyeR";
    eyeG.position.set(side * 0.16, 0.12, 0.02);

    const whiteM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), white);
    whiteM.name = "eyeWhite";
    eyeG.add(whiteM);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), black);
    pupil.name = "pupil";
    pupil.position.set(side * 0.01, 0, 0.07);
    eyeG.add(pupil);

    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    shine.name = "shine";
    shine.position.set(side * -0.02, 0.03, 0.09);
    eyeG.add(shine);

    // Swollen black eye (hidden until damaged)
    const blackEye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), bruise);
    blackEye.name = "blackEye";
    blackEye.visible = false;
    blackEye.scale.set(1.15, 0.85, 0.9);
    eyeG.add(blackEye);

    // Swollen shut slit (when nearly KO — only used on ONE eye so other stays open)
    const shut = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.04), black);
    shut.name = "eyeShut";
    shut.visible = false;
    shut.position.z = 0.06;
    eyeG.add(shut);

    face.add(eyeG);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.028, 0.035), black);
    brow.name = side < 0 ? "browL" : "browR";
    brow.position.set(side * 0.16, 0.26, 0.05);
    brow.rotation.z = side * (opts.angry === false ? -0.15 : -0.45);
    face.add(brow);

    const bruisePatch = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), bruise);
    bruisePatch.name = side < 0 ? "bruiseL" : "bruiseR";
    bruisePatch.position.set(side * 0.22, 0.02, 0.08);
    bruisePatch.scale.set(1.2, 0.7, 0.5);
    bruisePatch.visible = false;
    face.add(bruisePatch);
  }

  // Mouth group
  const mouthG = new THREE.Group();
  mouthG.name = "mouth";
  mouthG.position.set(0, -0.08, 0.06);

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.03), black);
  mouth.name = "mouthBase";
  mouthG.add(mouth);

  // Busted lip — red split (hidden until hit)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.035), pink);
  lip.name = "bustedLip";
  lip.position.set(0.02, -0.02, 0.02);
  lip.rotation.z = 0.2;
  lip.visible = false;
  mouthG.add(lip);

  const lipBlood = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), blood);
  lipBlood.name = "lipBlood";
  lipBlood.position.set(0.04, -0.05, 0.03);
  lipBlood.visible = false;
  mouthG.add(lipBlood);

  // Tooth missing gap look
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.02), mat(0xfff5e0));
  tooth.name = "tooth";
  tooth.position.set(-0.03, 0.02, 0.02);
  tooth.visible = false;
  mouthG.add(tooth);

  face.add(mouthG);

  // Bandage patch (late damage)
  const bandage = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.08, 0.02),
    mat(0xf0ebe0, { rough: 0.9 }),
  );
  bandage.name = "bandage";
  bandage.position.set(-0.18, 0.18, 0.1);
  bandage.rotation.z = 0.4;
  bandage.visible = false;
  face.add(bandage);

  g.add(face);
  return face;
}

/** Update face hurt look from remaining HP. Always keeps ≥1 eye open while alive. */
export function applyEnemyDamageFace(root: THREE.Object3D, hpRatio: number) {
  const face = root.getObjectByName("face");
  if (!face) return;

  // stages: 0 full, 1 nicked, 2 hurt, 3 wrecked (still one eye open), 4 dead
  let stage = 0;
  if (hpRatio <= 0) stage = 4;
  else if (hpRatio < 0.25) stage = 3;
  else if (hpRatio < 0.5) stage = 2;
  else if (hpRatio < 0.78) stage = 1;

  const prev = (root as THREE.Object3D & { userData: { damageStage?: number } }).userData
    .damageStage;
  if (prev === stage) return;
  (root as THREE.Object3D & { userData: { damageStage?: number } }).userData.damageStage =
    stage;

  const eyeL = face.getObjectByName("eyeL");
  const eyeR = face.getObjectByName("eyeR");
  const setEye = (eye: THREE.Object3D | null | undefined, mode: "open" | "black" | "shut") => {
    if (!eye) return;
    const w = eye.getObjectByName("eyeWhite");
    const p = eye.getObjectByName("pupil");
    const sh = eye.getObjectByName("shine");
    const be = eye.getObjectByName("blackEye");
    const shut = eye.getObjectByName("eyeShut");
    if (w) w.visible = mode === "open";
    if (p) p.visible = mode === "open" || mode === "black";
    if (sh) sh.visible = mode === "open";
    if (be) be.visible = mode === "black";
    if (shut) shut.visible = mode === "shut";
    if (mode === "black" && p) {
      p.scale.setScalar(0.7);
      p.position.z = 0.08;
    }
  };

  // Prefer damaging the LEFT eye first; RIGHT stays open until death
  if (stage === 0) {
    setEye(eyeL, "open");
    setEye(eyeR, "open");
  } else if (stage === 1) {
    setEye(eyeL, "black");
    setEye(eyeR, "open");
  } else if (stage === 2) {
    setEye(eyeL, "black");
    setEye(eyeR, "open");
  } else if (stage === 3) {
    setEye(eyeL, "shut");
    setEye(eyeR, "black"); // still open-ish via pupil on bruise
  } else {
    setEye(eyeL, "shut");
    setEye(eyeR, "shut");
  }

  const show = (name: string, v: boolean) => {
    const o = face.getObjectByName(name);
    if (o) o.visible = v;
  };
  show("bruiseL", stage >= 1);
  show("bruiseR", stage >= 2);
  show("bustedLip", stage >= 1);
  show("lipBlood", stage >= 2);
  show("tooth", stage >= 2);
  show("bandage", stage >= 3);

  // Angrier / droopier brows when hurt
  const browL = face.getObjectByName("browL");
  const browR = face.getObjectByName("browR");
  if (browL) browL.rotation.z = stage >= 2 ? -0.15 : -0.45;
  if (browR) browR.rotation.z = stage >= 2 ? 0.15 : 0.45;

  // Mouth: wider grimace when hurt
  const mouthBase = face.getObjectByName("mouthBase");
  if (mouthBase && (mouthBase as THREE.Mesh).scale) {
    const sc = stage >= 2 ? 1.25 : 1;
    mouthBase.scale.set(sc, stage >= 3 ? 1.4 : 1, 1);
  }
}

function makePunchingBagEnemy(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  const leather = mat(0xa67c52, { rough: 0.85 });
  const leatherDark = mat(0x6b4a2e, { rough: 0.9 });
  const patch = mat(0x8a6a45, { rough: 0.88 });
  const chain = mat(0x9aa0a8, { rough: 0.35, metal: 0.85, em: 0.05, emCol: 0x445055 });
  const wrap = mat(0x2a3038, { rough: 0.7 });

  // Main bag body
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 8, 16), leather);
  body.position.y = 0.95;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Top cap
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), leatherDark);
  top.position.y = 1.45;
  top.scale.y = 0.55;
  g.add(top);

  // Bottom
  const bot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), leatherDark);
  bot.position.y = 0.45;
  bot.scale.y = 0.55;
  g.add(bot);

  // Vertical stitch seams
  for (const a of [-0.6, 0, 0.6]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.95, 0.02), patch);
    seam.position.set(Math.sin(a) * 0.4, 0.95, Math.cos(a) * 0.4);
    g.add(seam);
  }

  // Patches
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.04), patch);
  p1.position.set(-0.28, 1.1, 0.28);
  p1.rotation.y = 0.5;
  g.add(p1);
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.04), leatherDark);
  p2.position.set(0.3, 0.75, 0.25);
  p2.rotation.y = -0.4;
  g.add(p2);

  // Chain + ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 16), chain);
  ring.position.y = 1.72;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (let i = 0; i < 3; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), chain);
    link.position.y = 1.82 + i * 0.09;
    link.rotation.x = i % 2 ? Math.PI / 2 : 0;
    link.rotation.z = i % 2 ? 0 : Math.PI / 2;
    g.add(link);
  }

  // Stubby arms + rock fists
  for (const sx of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.22, 4, 8), leather);
    arm.position.set(sx * 0.52, 0.95, 0.05);
    arm.rotation.z = sx * 0.5;
    g.add(arm);
    const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), mat(0x6a6e75, { rough: 0.7, metal: 0.2 }));
    fist.position.set(sx * 0.7, 0.78, 0.18);
    fist.castShadow = true;
    g.add(fist);
  }

  // Little feet wraps
  for (const sx of [-1, 1] as const) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), wrap);
    foot.position.set(sx * 0.16, 0.12, 0.06);
    foot.scale.set(1.1, 0.55, 1.3);
    g.add(foot);
  }

  addFace(g, 1.15, 0.4, { scale: 1.05, angry: true });
  return g;
}

function makeRockEnemy(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0x7a7e86, { rough: 0.92, metal: 0.12 });
  const stoneDark = mat(0x4a4e55, { rough: 0.95 });
  const moss = mat(0x3d6b42, { rough: 0.9 });

  const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48, 0), stone);
  core.position.y = 0.7;
  core.scale.set(1.05, 1.2, 0.95);
  core.castShadow = true;
  core.receiveShadow = true;
  g.add(core);

  // Chunks
  for (let i = 0; i < 5; i++) {
    const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14 + Math.random() * 0.08, 0), i % 2 ? stoneDark : stone);
    const a = (i / 5) * Math.PI * 2;
    chunk.position.set(Math.cos(a) * 0.35, 0.55 + (i % 3) * 0.15, Math.sin(a) * 0.3);
    chunk.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(chunk);
  }
  const mossP = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), moss);
  mossP.position.set(0.2, 0.95, 0.25);
  mossP.scale.set(1.2, 0.5, 0.8);
  g.add(mossP);

  // Stubby stone arms
  for (const sx of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneDark);
    arm.position.set(sx * 0.55, 0.65, 0.1);
    g.add(arm);
  }
  // Feet
  for (const sx of [-1, 1] as const) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.26), stoneDark);
    foot.position.set(sx * 0.18, 0.08, 0.04);
    g.add(foot);
  }

  addFace(g, 0.85, 0.42, { scale: 1.1, angry: true });
  return g;
}

function makeScissorsEnemy(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xe23d3d, { rough: 0.4, metal: 0.25, em: 0.12, emCol: 0x5a1010 });
  const blue = mat(0x3d7ae2, { rough: 0.4, metal: 0.25, em: 0.12, emCol: 0x10285a });
  const steel = mat(0xc8d0d8, { rough: 0.25, metal: 0.85 });
  const dark = mat(0x1a1c22, { rough: 0.5 });

  // Body (pivot area)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 14), red);
  body.position.y = 0.85;
  body.scale.set(1.05, 1.15, 0.85);
  body.castShadow = true;
  g.add(body);

  // Blue blade half overlay
  const bodyB = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 14), blue);
  bodyB.position.set(0.08, 0.85, 0);
  bodyB.scale.set(0.7, 1.05, 0.8);
  g.add(bodyB);

  // Blade arms (up)
  const bladeL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.06), steel);
  bladeL.position.set(-0.22, 1.35, 0);
  bladeL.rotation.z = 0.35;
  bladeL.castShadow = true;
  g.add(bladeL);
  const bladeR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.06), steel);
  bladeR.position.set(0.22, 1.35, 0);
  bladeR.rotation.z = -0.35;
  g.add(bladeR);
  // Tips
  for (const sx of [-1, 1] as const) {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 8), steel);
    tip.position.set(sx * 0.34, 1.72, 0);
    tip.rotation.z = sx * 0.35;
    g.add(tip);
  }

  // Handle rings as legs/feet (walking scissors)
  for (const sx of [-1, 1] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 8, 18), sx < 0 ? red : blue);
    ring.position.set(sx * 0.22, 0.22, 0.05);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    g.add(ring);
    // Inner grip
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14), dark);
    grip.position.copy(ring.position);
    grip.rotation.x = Math.PI / 2;
    g.add(grip);
  }

  // Screw pivot
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12), mat(0xffd24a, { metal: 0.7, rough: 0.3 }));
  screw.position.set(0, 0.85, 0.32);
  screw.rotation.x = Math.PI / 2;
  g.add(screw);

  // Stitch scars
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), dark);
    st.position.set(-0.1 + i * 0.08, 1.05, 0.34);
    st.rotation.z = 0.5;
    g.add(st);
  }

  addFace(g, 0.95, 0.38, { scale: 1.0, angry: true });
  return g;
}

function makePaperBagEnemy(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  const paper = mat(0xe8d4a8, { rough: 0.9 });
  const paperDark = mat(0xc4a882, { rough: 0.92 });
  const ink = mat(0x2a2520, { rough: 0.6 });
  const tape = mat(0xd8c090, { rough: 0.75 });

  // Bag body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.42), paper);
  body.position.y = 0.85;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Folded top
  const fold = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 0.44), paperDark);
  fold.position.y = 1.4;
  g.add(fold);
  const fold2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.2), paper);
  fold2.position.set(0, 1.52, 0);
  g.add(fold2);

  // Doodle marks
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.08 + Math.random() * 0.1, 0.02, 0.01), ink);
    d.position.set((Math.random() - 0.5) * 0.45, 0.55 + Math.random() * 0.6, 0.22);
    d.rotation.z = (Math.random() - 0.5) * 1.2;
    g.add(d);
  }
  // Tape
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.02), tape);
  t1.position.set(0.15, 1.15, 0.22);
  t1.rotation.z = -0.3;
  g.add(t1);

  // Paper arms
  for (const sx of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.08), paper);
    arm.position.set(sx * 0.48, 0.85, 0);
    arm.rotation.z = sx * -0.25;
    g.add(arm);
    // Glove/hand paper
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.08), paperDark);
    hand.position.set(sx * 0.55, 0.62, 0.06);
    g.add(hand);
  }

  // Legs
  for (const sx of [-1, 1] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.28, 0.12), paperDark);
    leg.position.set(sx * 0.16, 0.22, 0);
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.2), ink);
    foot.position.set(sx * 0.16, 0.06, 0.04);
    g.add(foot);
  }

  addFace(g, 1.05, 0.24, { scale: 1.05, angry: false });
  return g;
}

function makeNewspaperEnemy(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  const paper = mat(0xf2ebe0, { rough: 0.88 });
  const ink = mat(0x1a1a1a, { rough: 0.55 });
  const grey = mat(0xb8b0a4, { rough: 0.85 });

  // Rolled newspaper body
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 1.0, 16), paper);
  roll.position.y = 0.85;
  roll.rotation.z = Math.PI / 2;
  roll.castShadow = true;
  g.add(roll);

  // Spiral end caps
  for (const sx of [-1, 1] as const) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.33, 16), grey);
    cap.position.set(sx * 0.5, 0.85, 0);
    cap.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(cap);
    const spiral = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 16), ink);
    spiral.position.set(sx * 0.52, 0.85, 0);
    spiral.rotation.y = Math.PI / 2;
    g.add(spiral);
  }

  // Print lines
  for (let i = 0; i < 5; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.015, 0.01), ink);
    line.position.set(0, 0.55 + i * 0.12, 0.33);
    g.add(line);
  }
  // Masthead
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.01), ink);
  head.position.set(0, 1.15, 0.33);
  g.add(head);

  // Arms
  for (const sx of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), paper);
    arm.position.set(sx * 0.35, 0.7, 0.15);
    arm.rotation.z = sx * 0.6;
    g.add(arm);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), grey);
    fist.position.set(sx * 0.48, 0.55, 0.22);
    g.add(fist);
  }

  // Little legs
  for (const sx of [-1, 1] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.14), grey);
    leg.position.set(sx * 0.14, 0.2, 0);
    g.add(leg);
  }

  addFace(g, 0.95, 0.36, { scale: 0.95, angry: true });
  return g;
}

export function makeGrenade(palette: Palette, powered = false): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: powered ? 0x5a9a3a : 0x3d6b2e,
    roughness: 0.55,
    metalness: 0.35,
    emissive: powered ? 0x2a5010 : 0x0a2008,
    emissiveIntensity: 0.2,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0xb0b8c0,
    roughness: 0.28,
    metalness: 0.85,
  });
  const pinMat = new THREE.MeshStandardMaterial({
    color: 0xffd24a,
    roughness: 0.3,
    metalness: 0.7,
    emissive: 0xaa6600,
    emissiveIntensity: 0.35,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), bodyMat);
  body.scale.set(1, 1.15, 1);
  body.castShadow = true;
  g.add(body);

  // pineapple ridges
  for (let i = 0; i < 6; i++) {
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 20), bodyMat);
    ridge.position.y = -0.08 + i * 0.035;
    ridge.scale.set(1, 1, 0.85);
    g.add(ridge);
  }

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 12), metal);
  cap.position.y = 0.16;
  g.add(cap);

  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.02), metal);
  lever.position.set(0.06, 0.14, 0);
  lever.rotation.z = -0.4;
  g.add(lever);

  const pin = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14), pinMat);
  pin.position.set(-0.02, 0.2, 0);
  pin.rotation.y = Math.PI / 2;
  g.add(pin);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0x66ff44,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  g.add(glow);
  return g;
}

export function makeBottle(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.3, 14), palette.glass);
  body.castShadow = true;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.055, 0.13, 12), palette.glass);
  neck.position.y = 0.2;
  g.add(neck);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12),
    new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.35, metalness: 0.3 }),
  );
  cap.position.y = 0.28;
  g.add(cap);
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.11, 0.08, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  label.position.y = 0.02;
  g.add(label);
  return g;
}

export function makeCrate(palette: Palette, opts: { size?: number; tint?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const s = opts.size ?? 0.34;
  const wood = opts.tint
    ? new THREE.MeshStandardMaterial({
        color: opts.tint,
        roughness: 0.86,
        metalness: 0.02,
      })
    : palette.wood;
  const dark = palette.woodDark;
  const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood);
  box.castShadow = true;
  box.receiveShadow = true;
  g.add(box);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(s * 1.06, s * 0.14, s * 1.06), dark);
  edge.position.y = s * 0.44;
  g.add(edge);
  const edge2 = edge.clone();
  edge2.position.y = -s * 0.44;
  g.add(edge2);
  // X brace
  const brace = new THREE.Mesh(new THREE.BoxGeometry(s * 1.06, s * 0.09, s * 0.12), dark);
  brace.rotation.z = 0.7;
  g.add(brace);
  const brace2 = brace.clone();
  brace2.rotation.z = -0.7;
  g.add(brace2);
  // Side stencil mark for variety
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(s * 0.35, s * 0.22),
    new THREE.MeshBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.45 }),
  );
  mark.position.set(0, 0.02, s * 0.51);
  g.add(mark);
  return g;
}

export function makeStar(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), palette.star);
  core.castShadow = true;
  g.add(core);
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 5), palette.star);
    const a = (i / 5) * Math.PI * 2;
    spike.position.set(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0);
    spike.rotation.z = a - Math.PI / 2;
    g.add(spike);
  }
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 18, 14),
    new THREE.MeshBasicMaterial({
      color: 0xffd24a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  g.add(glow);
  const outer = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    }),
  );
  g.add(outer);
  return g;
}

export function makeHpBar(): THREE.Group {
  const g = new THREE.Group();
  g.name = "hpBar";
  g.renderOrder = 10;

  // Soft dark plate behind the bar
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.08, 0.22),
    new THREE.MeshBasicMaterial({
      color: 0x0a090e,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  plate.renderOrder = 10;
  g.add(plate);

  // Track / background
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 0.12),
    new THREE.MeshBasicMaterial({
      color: 0x2a2633,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  bg.position.z = 0.005;
  bg.renderOrder = 11;
  g.add(bg);

  // Fill — pivot left so scale.x drains cleanly
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.08),
    new THREE.MeshBasicMaterial({
      color: 0x3dd68c,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  fill.geometry.translate(0.46, 0, 0); // left edge at origin
  fill.position.set(-0.46, 0, 0.01);
  fill.name = "hpFill";
  fill.renderOrder = 12;
  g.add(fill);

  // Thin top highlight
  const gloss = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.025),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  gloss.geometry.translate(0.46, 0, 0);
  gloss.position.set(-0.46, 0.02, 0.012);
  gloss.name = "hpGloss";
  gloss.renderOrder = 13;
  g.add(gloss);

  // Float above enemy head (body ~0.8–1.0 tall)
  g.position.set(0, 1.95, 0);
  g.userData.isHpBar = true;
  return g;
}

export function makeSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(70, 48, 24);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + 18) / 55, 0, 1);
    // warm cartoon sunset → cool zenith
    const r = 0.95 * (1 - t) + 0.35 * t;
    const g = 0.55 * (1 - t) + 0.62 * t;
    const b = 0.35 * (1 - t) + 0.95 * t;
    // horizon band glow
    const band = Math.exp(-Math.pow((y - 2) / 8, 2)) * 0.25;
    colors[i * 3] = Math.min(1, r + band * 0.4);
    colors[i * 3 + 1] = Math.min(1, g + band * 0.15);
    colors[i * 3 + 2] = Math.min(1, b);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

export function makeImpactRing(color: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.12, 0.38, 40);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function makeLantern(palette: Palette, color: "pink" | "cyan" | "gold" = "gold"): THREE.Group {
  const g = new THREE.Group();
  const mat =
    color === "pink" ? palette.neonPink : color === "cyan" ? palette.neonCyan : palette.neonGold;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 8), palette.woodDark);
  post.position.y = 0.7;
  post.castShadow = true;
  g.add(post);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), mat);
  lamp.position.y = 1.45;
  g.add(lamp);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    new THREE.MeshBasicMaterial({
      color: mat.emissive,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  );
  glow.position.y = 1.45;
  g.add(glow);
  return g;
}

export function makeBanner(palette: Palette, hue: number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.2, 8), palette.woodDark);
  pole.position.y = 1.1;
  pole.castShadow = true;
  g.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 1.0),
    new THREE.MeshStandardMaterial({
      color: hue,
      roughness: 0.7,
      side: THREE.DoubleSide,
      emissive: hue,
      emissiveIntensity: 0.15,
    }),
  );
  cloth.position.set(0.35, 1.5, 0);
  g.add(cloth);
  return g;
}

/** Temporary love-barrier shield — translucent heart panel in front of the player. */
export function makeHeartShield(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = "heartShield";

  // Soft disc barrier
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 40),
    new THREE.MeshStandardMaterial({
      color: 0xff4d8d,
      emissive: 0xff2a6a,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );
  disc.position.z = 0;
  g.add(disc);

  // Outer rim glow ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.12, 0.045, 10, 48),
    new THREE.MeshStandardMaterial({
      color: 0xff9ec4,
      emissive: 0xff4d8d,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.35,
      roughness: 0.25,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.rotation.x = 0; // face camera plane (xy), torus in xy
  // Torus default is in XY plane which faces +Z — good for shield facing player look dir
  g.add(ring);

  // Heart shape from two lobes + point (simple geometric heart)
  const heartMat = new THREE.MeshStandardMaterial({
    color: 0xff2d6a,
    emissive: 0xff1a55,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.28,
    roughness: 0.3,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const heart = new THREE.Group();
  const lobeL = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), heartMat);
  lobeL.position.set(-0.2, 0.18, 0.04);
  lobeL.scale.set(1.05, 0.95, 0.55);
  heart.add(lobeL);
  const lobeR = lobeL.clone();
  lobeR.position.x = 0.2;
  heart.add(lobeR);
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.55, 4), heartMat);
  point.rotation.z = Math.PI;
  point.position.set(0, -0.22, 0.04);
  point.scale.set(1, 1, 0.45);
  heart.add(point);
  heart.scale.setScalar(1.15);
  g.add(heart);

  // Soft back-glow
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff6aa8,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glow.position.z = -0.05;
  g.add(glow);

  g.userData.disc = disc;
  g.userData.ring = ring;
  g.userData.heart = heart;
  return g;
}

/** Shared pink heart material */
function heartMat(opacity = 0.92) {
  return new THREE.MeshStandardMaterial({
    color: 0xff3d7a,
    emissive: 0xff1a55,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity,
    roughness: 0.28,
    metalness: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/**
 * Left lobe of a classic heart, open edge on x=0, bulge toward −X,
 * y from −0.5 (thumb) to +0.5 (index). Same local C for both hands —
 * the hand frame aims +X at the opening (the other hand).
 */
function halfHeartCurvePoints(n = 32): THREE.Vector3[] {
  const raw: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (Math.PI * i) / n;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push(new THREE.Vector3(x, y, 0));
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const h = Math.max(1e-6, maxY - minY);
  return raw.map((p) => new THREE.Vector3(p.x / h, (p.y - minY) / h - 0.5, 0));
}

function makeHeartOutlineTube(radius: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(halfHeartCurvePoints(32), false, "centripetal");
  const geo = new THREE.TubeGeometry(curve, 48, radius, 7, false);
  return new THREE.Mesh(geo, mat);
}

/** 3D half-heart outline — a C that sits on thumb + index, open toward the other hand. */
export function makeHeartHalf(_palette: Palette, side: "L" | "R"): THREE.Group {
  const g = new THREE.Group();
  g.name = "heartHalf_" + side;

  const stroke = new THREE.MeshStandardMaterial({
    color: 0xff4d8d,
    emissive: 0xff2a6a,
    emissiveIntensity: 1.15,
    roughness: 0.22,
    metalness: 0.18,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff7eb0,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const glow = makeHeartOutlineTube(0.055, glowMat);
  glow.name = "heartHalfGlow";
  glow.renderOrder = 24;
  g.add(glow);

  const tube = makeHeartOutlineTube(0.028, stroke);
  tube.name = "heartHalfStroke";
  tube.renderOrder = 25;
  g.add(tube);

  g.scale.setScalar(0.2);
  g.userData.gesture = "heart";
  g.userData.heartMats = [stroke, glowMat];
  g.userData.heartHalo = glow;
  g.userData.heartStroke = tube;
  g.userData.poseSide = side;
  return g;
}

/** Full heart prop (for desktop taunt / shield preview). */
export function makeHeartProp(_palette: Palette): THREE.Group {
  const g = new THREE.Group();
  g.name = "heartProp";
  const mat = heartMat(0.88);
  const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), mat);
  l.position.set(-0.07, 0.06, 0);
  l.scale.set(1.05, 0.95, 0.55);
  g.add(l);
  const r = l.clone();
  r.position.x = 0.07;
  g.add(r);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.18, 4), mat);
  tip.rotation.z = Math.PI;
  tip.position.set(0, -0.1, 0);
  tip.scale.set(1, 1, 0.5);
  g.add(tip);
  g.userData.gesture = "heart";
  return g;
}

function skinMat(palette: Palette) {
  return (palette.skin as THREE.MeshStandardMaterial).clone();
}

/** Cartoon thumbs-up fist + upright thumb. */
export function makeThumbsUpHand(palette: Palette, side: "L" | "R"): THREE.Group {
  const g = new THREE.Group();
  g.name = "thumbsUp_" + side;
  const skin = skinMat(palette);
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.14), skin);
  fist.position.set(0, -0.02, 0);
  g.add(fist);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.1, 4, 8), skin);
  thumb.position.set(side === "L" ? 0.06 : -0.06, 0.1, 0.02);
  thumb.rotation.z = side === "L" ? -0.25 : 0.25;
  g.add(thumb);
  // green + badge
  const badge = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x3dd68c, emissive: 0x1a8a4a, emissiveIntensity: 0.9 }),
  );
  badge.position.set(0, 0.18, 0);
  g.add(badge);
  g.scale.x = side === "L" ? 1 : -1;
  g.userData.gesture = "thumbs";
  return g;
}

/** Thumbs-down. */
export function makeThumbsDownHand(palette: Palette, side: "L" | "R"): THREE.Group {
  const g = makeThumbsUpHand(palette, side);
  g.name = "thumbsDown_" + side;
  g.rotation.z = Math.PI;
  // recolor badge red
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (m && m.color && m.emissive && m.color.getHex() === 0x3dd68c) {
        m.color.setHex(0xe23d3d);
        m.emissive.setHex(0x6a1010);
      }
    }
  });
  g.userData.gesture = "thumbsDown";
  return g;
}

/** Peace / V sign — index + middle extended. */
export function makePeaceHand(palette: Palette, side: "L" | "R"): THREE.Group {
  const g = new THREE.Group();
  g.name = "peace_" + side;
  const skin = skinMat(palette);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.05), skin);
  g.add(palm);
  const mkFinger = (x: number) => {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.14, 4, 8), skin);
    f.position.set(x, 0.12, 0);
    return f;
  };
  g.add(mkFinger(-0.03));
  g.add(mkFinger(0.03));
  // curled ring/pinky stubs
  const stub = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.04), skin);
  stub.position.set(0.02, 0.02, 0.02);
  g.add(stub);
  // purple peace glow
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  glow.position.set(0, 0.22, 0);
  g.add(glow);
  g.scale.x = side === "L" ? 1 : -1;
  g.userData.gesture = "peace";
  return g;
}

/** Spock / Vulcan salute — V split (index+middle | ring+pinky). */
export function makeSpockHand(palette: Palette, side: "L" | "R"): THREE.Group {
  const g = new THREE.Group();
  g.name = "spock_" + side;
  const skin = skinMat(palette);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.05), skin);
  g.add(palm);
  const mk = (x: number, rot = 0) => {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.13, 4, 8), skin);
    f.position.set(x, 0.12, 0);
    f.rotation.z = rot;
    return f;
  };
  // index + middle cluster
  g.add(mk(-0.045, 0.12));
  g.add(mk(-0.015, 0.05));
  // ring + pinky cluster (gap in middle)
  g.add(mk(0.015, -0.05));
  g.add(mk(0.045, -0.12));
  const badge = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x3db8e2, emissive: 0x1a6a8a, emissiveIntensity: 1 }),
  );
  badge.position.set(0, 0.24, 0);
  g.add(badge);
  g.scale.x = side === "L" ? 1 : -1;
  g.userData.gesture = "spock";
  return g;
}

export type GestureKind = "thumbs" | "thumbsDown" | "peace" | "spock" | "heart" | "rockOn" | "birdie" | "none";

/** Pulse half-heart materials. amount 0 = idle, 1 = about to fuse. */
export function setHeartHalfGlow(g: THREE.Object3D | null | undefined, amount = 0) {
  if (!g) return;
  const t = THREE.MathUtils.clamp(amount, 0, 1);
  const mats = (g as THREE.Group).userData?.heartMats as THREE.MeshStandardMaterial[] | undefined;
  if (mats) {
    for (const m of mats) {
      if (!m) continue;
      m.emissiveIntensity = 0.85 + t * 1.6;
      if (m.opacity != null) m.opacity = 0.88 + t * 0.12;
    }
  }
  const halo = (g as THREE.Group).userData?.heartHalo as THREE.Mesh | undefined;
  if (halo && (halo.material as THREE.MeshBasicMaterial)) {
    (halo.material as THREE.MeshBasicMaterial).opacity = 0.16 + t * 0.55;
    halo.scale.setScalar(1 + t * 0.45);
  }
}

/** Factory for social / emoji hand props. */
export function makeGestureHand(
  palette: Palette,
  kind: GestureKind,
  side: "L" | "R",
): THREE.Group {
  if (kind === "thumbs") return makeThumbsUpHand(palette, side);
  if (kind === "thumbsDown") return makeThumbsDownHand(palette, side);
  if (kind === "peace") return makePeaceHand(palette, side);
  if (kind === "spock") return makeSpockHand(palette, side);
  if (kind === "heart") return makeHeartHalf(palette, side);
  if (kind === "rockOn") {
    const g = makePeaceHand(palette, side);
    g.name = "rockOn_" + side;
    g.userData.gesture = "rockOn";
    return g;
  }
  if (kind === "birdie") return makeBirdHand(palette, side);
  return makeThumbsUpHand(palette, side);
}

/** Flapping bird prop for the middle-finger gesture. */
export function makeBirdHand(palette: Palette, side: "L" | "R"): THREE.Group {
  const g = new THREE.Group();
  g.name = "birdie_" + side;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xf2c14e,
    roughness: 0.45,
    metalness: 0.08,
    emissive: 0x5a3a08,
    emissiveIntensity: 0.18,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xffef9a,
    roughness: 0.5,
    metalness: 0.05,
    side: THREE.DoubleSide,
    emissive: 0x6a5010,
    emissiveIntensity: 0.12,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), bodyMat);
  body.scale.set(1, 0.85, 1.25);
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), bodyMat);
  head.position.set(0, 0.03, -0.07);
  g.add(head);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.012, 0.04, 6),
    new THREE.MeshStandardMaterial({ color: 0xff7722, roughness: 0.4 }),
  );
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.028, -0.1);
  g.add(beak);
  const wingL = new THREE.Group();
  const wingR = new THREE.Group();
  const wMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), wingMat);
  wMesh.position.x = 0.055;
  wingL.add(wMesh);
  const wMeshR = wMesh.clone();
  wMeshR.position.x = -0.055;
  wingR.add(wMeshR);
  wingL.position.set(0.02, 0.01, 0);
  wingR.position.set(-0.02, 0.01, 0);
  g.add(wingL);
  g.add(wingR);
  g.userData.gesture = "birdie";
  g.userData.baseScale = 1;
  g.userData.modelSpace = "prop";
  g.userData.wingJoints = [wingL, wingR];
  void palette;
  void side;
  return g;
}

/** Gym heavy bag on a steel gantry. Pivot child `bagPivot` swings; `bagBody` is the leather. */
export function makeHeavyBagRig(): THREE.Group {
  const root = new THREE.Group();
  root.name = "heavyBagRig";
  const steel = mat(0x4a515c, { rough: 0.32, metal: 0.88, em: 0.04, emCol: 0x1a2028 });
  const steelDark = mat(0x2a3038, { rough: 0.4, metal: 0.82 });
  const leather = mat(0x6a2a22, { rough: 0.62, metal: 0.08, em: 0.08, emCol: 0x2a0808 });
  const leatherDark = mat(0x3a1612, { rough: 0.7, metal: 0.06 });

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.15, 10), steel);
  post.position.set(-0.05, 1.58, 0);
  post.castShadow = true;
  root.add(post);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 12), steelDark);
  foot.position.set(-0.05, 0.04, 0);
  root.add(foot);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), steel);
  arm.position.set(0.38, 3.02, 0);
  arm.castShadow = true;
  root.add(arm);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 14, Math.PI), steel);
  hook.position.set(0.62, 2.94, 0);
  hook.rotation.z = Math.PI;
  root.add(hook);

  const links: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 10), steel);
    link.position.set(0.62, 2.86 - i * 0.09, 0);
    root.add(link);
    links.push(link);
  }

  const pivot = new THREE.Group();
  pivot.name = "bagPivot";
  pivot.position.set(0.62, 2.18, 0);
  root.add(pivot);

  const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.18, 16), leather);
  bag.position.y = -0.72;
  bag.castShadow = true;
  bag.name = "bagBody";
  pivot.add(bag);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), leatherDark);
  cap.scale.y = 0.45;
  cap.position.y = -0.14;
  pivot.add(cap);
  const heel = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), leatherDark);
  heel.scale.y = 0.4;
  heel.position.y = -1.28;
  pivot.add(heel);
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.012, 6, 16), leatherDark);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = -0.35 - i * 0.22;
    pivot.add(stripe);
  }

  root.userData.bagPivot = pivot;
  root.userData.bagBody = bag;
  root.userData.chainLinks = links;
  root.userData.hookLocal = new THREE.Vector3(0.62, 3.02, 0);
  return root;
}

export const GUMBALL_COLORS = [0xff3355, 0xffcc22, 0x33dd66, 0x3399ff, 0xcc55ff, 0xff7722, 0xffef6a];

/** Carnival gumball machine — globe / candy / cracks named for hit states. */
export function makeGumballMachine(): THREE.Group {
  const root = new THREE.Group();
  root.name = "gumballMachine";
  const chrome = mat(0xc8d4de, { rough: 0.22, metal: 0.92, em: 0.06, emCol: 0x304050 });
  const chromeDark = mat(0x3a444c, { rough: 0.35, metal: 0.8 });
  const red = mat(0xc42a2a, { rough: 0.4, metal: 0.15, em: 0.2, emCol: 0x4a0808 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.42, 16), red);
  base.position.y = 0.21;
  base.castShadow = true;
  root.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 8, 20), chrome);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.42;
  root.add(ring);

  const candy = new THREE.Group();
  candy.name = "candy";
  for (let i = 0; i < 18; i++) {
    const col = GUMBALL_COLORS[i % GUMBALL_COLORS.length];
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mat(col, { rough: 0.25, metal: 0.15, em: 0.1, emCol: col }));
    const a = (i / 18) * Math.PI * 2;
    const r = 0.11 + (i % 3) * 0.03;
    b.position.set(Math.cos(a) * r, 0.72 + (i % 5) * 0.07, Math.sin(a) * r);
    candy.add(b);
  }
  root.add(candy);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xc8f0ff,
      roughness: 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: 0.28,
      emissive: 0x204050,
      emissiveIntensity: 0.08,
    }),
  );
  globe.position.y = 0.78;
  globe.name = "globe";
  root.add(globe);
  const glass = globe.clone();
  glass.name = "globeGlass";
  glass.scale.setScalar(1.01);
  root.add(glass);

  const cracks = new THREE.Group();
  cracks.name = "cracks";
  cracks.visible = false;
  const crackMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.22, 0.004), crackMat);
    c.position.set((i - 2) * 0.05, 0.78, 0.3);
    c.rotation.z = (i - 2) * 0.35;
    cracks.add(c);
  }
  root.add(cracks);

  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), chrome);
  knob.position.y = 1.14;
  root.add(knob);
  const spout = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.1), chrome);
  spout.position.set(0, 0.22, 0.28);
  root.add(spout);

  root.userData.globe = globe;
  root.userData.candy = candy;
  root.userData.cracks = cracks;
  return root;
}

export function makeGumball(color = 0xff3355): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 10),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.22,
      metalness: 0.18,
      emissive: color,
      emissiveIntensity: 0.12,
    }),
  );
  m.castShadow = true;
  m.name = "gumball";
  return m;
}

function leafClusterMat(palette: Palette, i: number) {
  const mats = [palette.leaf, palette.leafDark, palette.leafLime || palette.leaf, palette.leafSun || palette.leaf];
  return mats[i % mats.length];
}

/** A single fluttering leaf for the punch-off burst. */
export function makeFallingLeaf(palette: Palette): THREE.Mesh {
  const mats = [palette.leaf, palette.leafDark, palette.leafLime || palette.leaf, palette.leafSun || palette.leaf];
  const src = mats[(Math.random() * mats.length) | 0] as THREE.MeshStandardMaterial;
  const mat = src.clone();
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 5), mat);
  mesh.scale.set(0.55, 0.12, 1.05);
  mesh.castShadow = true;
  mesh.name = "fallingLeaf";
  return mesh;
}

/** Punchable arena tree. `canopy` hides when stripped; trunk group topples from the base. */
export function makeArenaTree(palette: Palette, seed = 1): THREE.Group {
  const root = new THREE.Group();
  root.name = "arenaTree";
  const rnd = (n: number) => {
    const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const fall = new THREE.Group();
  fall.name = "treeFall";
  const trunkH = 1.45 + rnd(2) * 0.55;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 + rnd(3) * 0.04, 0.16 + rnd(4) * 0.05, trunkH, 8),
    palette.trunk,
  );
  trunk.position.y = trunkH * 0.5;
  trunk.castShadow = true;
  fall.add(trunk);
  const canopy = new THREE.Group();
  canopy.name = "canopy";
  const crownY = trunkH + 0.15;
  for (let i = 0; i < 5; i++) {
    const clump = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42 + rnd(10 + i) * 0.22, 1),
      leafClusterMat(palette, i),
    );
    clump.position.set((rnd(20 + i) - 0.5) * 0.55, crownY + rnd(30 + i) * 0.45, (rnd(40 + i) - 0.5) * 0.55);
    clump.castShadow = true;
    canopy.add(clump);
  }
  fall.add(canopy);
  root.add(fall);
  root.userData.canopy = canopy;
  root.userData.fall = fall;
  root.userData.trunkH = trunkH;
  return root;
}

/** Airport-style rubber belt: grooves + yellow chevrons pointing along −Z travel. */
function makeWalkwayBeltTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#2a2e32";
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = "#23262a";
  for (let y = 0; y < 512; y += 18) ctx.fillRect(0, y, 256, 7);
  ctx.fillStyle = "#1a1d20";
  for (let y = 8; y < 512; y += 18) ctx.fillRect(0, y + 4, 256, 2);
  ctx.strokeStyle = "#e8c43a";
  ctx.lineWidth = 10;
  ctx.lineJoin = "miter";
  for (let y = 28; y < 512; y += 86) {
    ctx.beginPath();
    ctx.moveTo(48, y + 38);
    ctx.lineTo(128, y);
    ctx.lineTo(208, y + 38);
    ctx.stroke();
  }
  ctx.fillStyle = "#c9a227";
  ctx.fillRect(0, 0, 14, 512);
  ctx.fillRect(242, 0, 14, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeLeverLabelTexture(text: string, color = "#ffe08a"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#14181c";
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 56);
  ctx.fillStyle = color;
  ctx.font = "bold 32px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Flat airport moving walkway — rubber belt, metal comb, glass side rails.
 * Belt UVs run along Z so `beltMat.map.offset.y` can stick to the rider.
 */
export function makeMovingWalkway(_palette: Palette): THREE.Group {
  const root = new THREE.Group();
  root.name = "movingWalkway";
  const length = 96;
  const width = 5.6;
  const halfW = width * 0.5;
  const beltTex = makeWalkwayBeltTexture();
  beltTex.repeat.set(1, length / 4);
  const beltMat = new THREE.MeshStandardMaterial({
    map: beltTex,
    roughness: 0.92,
    metalness: 0.08,
    color: 0xffffff,
  });
  const belt = new THREE.Mesh(new THREE.BoxGeometry(width - 0.28, 0.08, length), beltMat);
  belt.position.y = 0.06;
  belt.receiveShadow = true;
  belt.name = "walkwayBelt";
  root.add(belt);

  const under = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.2, 0.18, length),
    new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.7, metalness: 0.45 }),
  );
  under.position.y = -0.08;
  under.receiveShadow = true;
  root.add(under);

  const steel = _palette.metal;
  const yellow = new THREE.MeshStandardMaterial({
    color: 0xe8c43a,
    roughness: 0.42,
    metalness: 0.18,
    emissive: 0x5a4010,
    emissiveIntensity: 0.35,
  });
  for (const sx of [-1, 1] as const) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, length), yellow);
    stripe.position.set(sx * (halfW - 0.22), 0.12, 0);
    root.add(stripe);
    const railBase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, length), steel);
    railBase.position.set(sx * (halfW + 0.02), 0.18, 0);
    railBase.castShadow = true;
    root.add(railBase);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, length - 0.4), _palette.glass.clone());
    glass.position.set(sx * (halfW + 0.02), 0.7, 0);
    root.add(glass);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, length), steel);
    cap.position.set(sx * (halfW + 0.02), 1.08, 0);
    cap.castShadow = true;
    root.add(cap);
    for (let i = 0; i < 16; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), steel);
      post.position.set(sx * (halfW + 0.02), 0.55, -length * 0.45 + i * (length / 16));
      post.castShadow = true;
      root.add(post);
    }
  }
  const comb = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.05, 0.55), yellow);
  comb.position.set(0, 0.12, length * 0.5 - 0.2);
  root.add(comb);

  root.userData.beltMat = beltMat;
  root.userData.belt = belt;
  root.userData.length = length;
  root.userData.width = width;
  return root;
}

/**
 * Throttle lever. Default is pushed BACK (amount 0).
 * Pivot rotates around X: +rest = back / idle, −full = forward / max speed.
 */
export function makeSpeedLever(_palette: Palette): THREE.Group {
  const root = new THREE.Group();
  root.name = "speedLever";
  const steel = new THREE.MeshStandardMaterial({
    color: 0x8a97a6, roughness: 0.28, metalness: 0.88, emissive: 0x1a222c, emissiveIntensity: 0.12,
  });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x2a323c, roughness: 0.4, metalness: 0.72 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.78, metalness: 0.08 });
  const grip = new THREE.MeshStandardMaterial({
    color: 0xc42a2a, roughness: 0.45, metalness: 0.12, emissive: 0x4a0808, emissiveIntensity: 0.35,
  });
  const panel = new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.55, metalness: 0.4 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 14), steelDark);
  base.position.y = 0.06;
  base.castShadow = true;
  root.add(base);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.82, 12), steel);
  column.position.y = 0.5;
  column.castShadow = true;
  root.add(column);
  const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.42), panel);
  consoleBox.position.set(0, 0.9, 0.02);
  consoleBox.rotation.x = -0.18;
  consoleBox.castShadow = true;
  root.add(consoleBox);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.055),
    new THREE.MeshBasicMaterial({ map: makeLeverLabelTexture("SPEED"), toneMapped: false }),
  );
  label.position.set(0, 0.95, 0.18);
  label.rotation.x = -0.35;
  root.add(label);

  const pips: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const pip = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 6),
      new THREE.MeshStandardMaterial({
        color: 0x1a2418, roughness: 0.4, emissive: 0x3aaa4c, emissiveIntensity: 0.05,
      }),
    );
    pip.position.set(-0.08 + i * 0.04, 0.955, 0.08);
    root.add(pip);
    pips.push(pip);
  }

  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.18), steelDark);
  housing.position.set(0, 0.88, -0.06);
  housing.castShadow = true;
  root.add(housing);

  const pivot = new THREE.Group();
  pivot.name = "leverPivot";
  pivot.position.set(0, 0.92, -0.06);
  root.add(pivot);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.4, 10), steel);
  stick.position.y = 0.2;
  stick.castShadow = true;
  pivot.add(stick);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), grip);
  handle.position.y = 0.42;
  handle.castShadow = true;
  handle.name = "leverHandle";
  pivot.add(handle);
  const ridges = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 8, 16), rubber);
  ridges.rotation.x = Math.PI / 2;
  ridges.position.y = 0.42;
  pivot.add(ridges);
  const knobCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, 0.045, 10),
    new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0x8a7010, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }),
  );
  knobCap.position.y = 0.5;
  pivot.add(knobCap);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.012, 8, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false,
    }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.42;
  halo.name = "leverHalo";
  pivot.add(halo);
  // Idle = pushed BACK toward the player (+X rotation)
  pivot.rotation.x = 0.72;

  const slot = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.01, 6, 18, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x1a222c, metalness: 0.5, roughness: 0.4, emissive: 0x243040, emissiveIntensity: 0.2 }),
  );
  slot.rotation.y = Math.PI / 2;
  slot.rotation.z = -0.72;
  slot.position.set(0.07, 0.92, -0.06);
  root.add(slot);

  root.userData.pivot = pivot;
  root.userData.handle = handle;
  root.userData.halo = halo;
  root.userData.pips = pips;
  root.userData.restAng = 0.72;
  root.userData.fullAng = -0.68;
  return root;
}

export { makeTutorialPoseGuide, preloadPoseGuideHands, poseGuidesReady, placePoseGuide } from "./poseGuides";



