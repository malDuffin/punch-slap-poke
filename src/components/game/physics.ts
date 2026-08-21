/**
 * Box3D (Wasm) physics via box3d.js — Erin Catto's Box3D engine bindings.
 * https://github.com/isaac-mason/box3d.js
 *
 * Collision optimisations:
 *  - Category/mask layers (static / crate / projectile / grenade)
 *  - Sleeping + damping so idle pyramids leave the island solver
 *  - Adaptive substeps + fixed timestep accumulator
 *  - CCD (bullet) only on fast projectiles/grenades
 *  - Contact events off; capacity pre-sized for stacks
 *  - Smaller static floor (tighter broadphase)
 */
import Box3D from "box3d.js/inline";

export type B3 = Awaited<ReturnType<typeof Box3D>>;
export type B3Body = ReturnType<B3["b3CreateBody"]>;
export type B3World = ReturnType<B3["b3CreateWorld"]>;

/** Collision categories (bitmasks). */
export const PhysLayer = {
  STATIC: 1n,
  CRATE: 2n,
  PROJECTILE: 4n,
  GRENADE: 8n,
} as const;

const POS: [number, number, number] = [0, 0, 0];
const ROT: [number, number, number, number] = [0, 0, 0, 1];
const VEL: [number, number, number] = [0, 0, 0];

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 2;
const MAX_SUBSTEPS = 3;

export class Box3Physics {
  b3: B3 | null = null;
  world: B3World | null = null;
  ready = false;
  private initPromise: Promise<void> | null = null;
  private ground: B3Body | null = null;
  private walls: B3Body[] = [];
  /** Accumulator for fixed-step integration */
  private acc = 0;
  /** Last awake body count (for adaptive substeps) */
  awakeCount = 0;
  /** Skip mesh sync for sleeping crates */
  private skipSleepSync = true;
  /** Contact Hertz (lower on Quest) */
  private contactHertz = 24;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init() {
    const b3 = await Box3D();
    this.b3 = b3;

    const worldDef = b3.b3DefaultWorldDef();
    worldDef.gravity = [0, -12, 0];
    worldDef.enableSleep = true;
    // Continuous collision only needed for bullets; keep on but bullets alone set isBullet
    worldDef.enableContinuous = true;
    worldDef.maximumLinearSpeed = 80; // clamp tunnels / crazy speeds
    worldDef.restitutionThreshold = 1.2;
    worldDef.hitEventThreshold = 1e9; // effectively disable hit-event generation
    // Slightly softer contacts → fewer solver iterations feel
    worldDef.contactHertz = 24;
    worldDef.contactDampingRatio = 8;
    worldDef.contactSpeed = 2.5;
    // Pre-size for pyramid playground (~150 crates + shots)
    if (worldDef.capacity) {
      worldDef.capacity.staticBodyCount = 8;
      worldDef.capacity.staticShapeCount = 8;
      worldDef.capacity.dynamicBodyCount = 220;
      worldDef.capacity.dynamicShapeCount = 220;
      worldDef.capacity.contactCount = 512;
    }
    this.world = b3.b3CreateWorld(worldDef);

    b3.b3World_EnableSleeping(this.world, true);
    b3.b3World_EnableWarmStarting?.(this.world, true);
    // Speculative contacts help stacks without full CCD cost on every body
    b3.b3World_EnableSpeculative?.(this.world, true);
    b3.b3World_SetMaximumLinearSpeed?.(this.world, 80);
    b3.b3World_SetHitEventThreshold?.(this.world, 1e9);
    b3.b3World_SetContactRecycleDistance?.(this.world, 0.08);
    b3.b3World_SetContactTuning?.(this.world, 24, 8, 2.5);

    // --- Static floor (tight to playground, not 80m) ---
    this.ground = this.createStaticBox(0, -0.5, 0, 14, 0.5, 14, {
      friction: 0.9,
      restitution: 0.08,
    });

    // Playground walls — keep crates in a small AABB
    const wallSpecs: Array<[number, number, number, number, number, number]> = [
      [0, 1.2, 8.2, 10, 1.2, 0.2],
      [-6.5, 1.2, 1, 0.2, 1.2, 10],
      [6.5, 1.2, 1, 0.2, 1.2, 10],
      [0, 1.2, -6, 10, 1.2, 0.2], // front lip so boxes don't spill onto combat path as much
    ];
    for (const [x, y, z, hx, hy, hz] of wallSpecs) {
      const w = this.createStaticBox(x, y, z, hx, hy, hz, { friction: 0.55, restitution: 0.12 });
      if (w) this.walls.push(w);
    }

    b3.b3World_RebuildStaticTree?.(this.world);
    this.ready = true;
  }

  private makeFilter(category: bigint, mask: bigint) {
    const f = this.b3!.b3DefaultFilter();
    f.categoryBits = category;
    f.maskBits = mask;
    f.groupIndex = 0;
    return f;
  }

  private createStaticBox(
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    mat: { friction?: number; restitution?: number } = {},
  ): B3Body | null {
    if (!this.b3 || !this.world) return null;
    const b3 = this.b3;
    const def = b3.b3DefaultBodyDef();
    def.position = [x, y, z];
    if (b3.b3BodyType?.b3_staticBody != null) def.type = b3.b3BodyType.b3_staticBody;
    def.enableSleep = true;
    const body = b3.b3CreateBody(this.world, def);
    const sd = b3.b3DefaultShapeDef();
    sd.enableContactEvents = false;
    sd.enableHitEvents = false;
    sd.enableSensorEvents = false;
    sd.filter = this.makeFilter(
      PhysLayer.STATIC,
      PhysLayer.CRATE | PhysLayer.GRENADE,
    );
    if (sd.baseMaterial) {
      sd.baseMaterial.friction = mat.friction ?? 0.8;
      sd.baseMaterial.restitution = mat.restitution ?? 0.1;
    }
    b3.b3CreateBoxShape(body, sd, hx, hy, hz);
    return body;
  }

  /**
   * Fixed-step + adaptive substeps.
   * Sleeping islands ⇒ 0 work; busy scenes get more substeps only when needed.
   */
  step(dt: number) {
    if (!this.ready || !this.b3 || !this.world) return;
    const b3 = this.b3;
    const world = this.world;

    // Soft clamp huge frame spikes
    this.acc += Math.min(dt, 0.05);

    // Early-out: if nothing is awake and no leftover time budget, skip
    this.awakeCount = b3.b3World_GetAwakeBodyCount?.(world) ?? 1;
    if (this.awakeCount === 0 && this.acc < FIXED_DT * 2) {
      this.acc = Math.min(this.acc, FIXED_DT);
      return;
    }

    // Adaptive substeps: calm stacks = 2, chaos = 3 (never 4 — Quest budget)
    let sub = 2;
    if (this.awakeCount > 50) sub = MAX_SUBSTEPS;

    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      b3.b3World_Step(world, FIXED_DT, sub);
      this.acc -= FIXED_DT;
      steps++;
    }
    // Don't spiral if we can't catch up
    if (this.acc > FIXED_DT * 2) this.acc = 0;

    this.awakeCount = b3.b3World_GetAwakeBodyCount?.(world) ?? this.awakeCount;
  }

  /** Drop solver stiffness on Quest-class devices (cheaper contacts, still stable stacks). */
  applyHeadsetTune(hertz = 16) {
    this.contactHertz = hertz;
    if (!this.ready || !this.b3 || !this.world) return;
    try {
      this.b3.b3World_SetContactTuning?.(this.world, hertz, 7, 2.8);
    } catch {
      /* */
    }
  }

  createBox(
    x: number,
    y: number,
    z: number,
    half: number,
    opts: {
      dynamic?: boolean;
      density?: number;
      friction?: number;
      restitution?: number;
      layer?: bigint;
      mask?: bigint;
    } = {},
  ): B3Body | null {
    if (!this.ready || !this.b3 || !this.world) return null;
    const b3 = this.b3;
    const def = b3.b3DefaultBodyDef();
    def.position = [x, y, z];
    if (opts.dynamic !== false) {
      def.type = b3.b3BodyType.b3_dynamicBody;
    } else if (b3.b3BodyType?.b3_staticBody != null) {
      def.type = b3.b3BodyType.b3_staticBody;
    }
    def.enableSleep = true;
    def.isAwake = true;
    def.isBullet = false; // crates never need CCD
    def.linearDamping = 0.35;
    def.angularDamping = 0.55;
    def.sleepThreshold = 0.08;
    def.gravityScale = 1;

    const body = b3.b3CreateBody(this.world, def);
    b3.b3Body_EnableSleep?.(body, true);
    b3.b3Body_SetSleepThreshold?.(body, 0.08);

    const sd = b3.b3DefaultShapeDef();
    sd.density = opts.density ?? 400;
    sd.enableContactEvents = false;
    sd.enableHitEvents = false;
    sd.enableSensorEvents = false;
    sd.filter = this.makeFilter(
      opts.layer ?? PhysLayer.CRATE,
      opts.mask ??
        (PhysLayer.STATIC | PhysLayer.CRATE | PhysLayer.PROJECTILE | PhysLayer.GRENADE),
    );
    if (sd.baseMaterial) {
      sd.baseMaterial.friction = opts.friction ?? 0.78;
      sd.baseMaterial.restitution = opts.restitution ?? 0.12;
    }
    b3.b3CreateBoxShape(body, sd, half, half, half);
    return body;
  }

  createSphere(
    x: number,
    y: number,
    z: number,
    radius: number,
    opts: {
      density?: number;
      friction?: number;
      restitution?: number;
      bullet?: boolean;
      /** "projectile" | "grenade" | "ball" */
      role?: "projectile" | "grenade" | "ball";
      gravityScale?: number;
    } = {},
  ): B3Body | null {
    if (!this.ready || !this.b3 || !this.world) return null;
    const b3 = this.b3;
    const role = opts.role ?? (opts.bullet ? "projectile" : "grenade");
    const def = b3.b3DefaultBodyDef();
    def.position = [x, y, z];
    def.type = b3.b3BodyType.b3_dynamicBody;
    def.isBullet = !!opts.bullet || role === "projectile";
    def.enableSleep = true;
    def.isAwake = true;
    def.linearDamping = role === "projectile" ? 0 : role === "ball" ? 0.28 : 0.12;
    def.angularDamping = role === "projectile" ? 0.05 : role === "ball" ? 0.35 : 0.2;
    // Projectiles fly straight; only grenades (and explicit overrides) feel gravity
    def.gravityScale = opts.gravityScale ?? (role === "projectile" ? 0 : 1);
    def.sleepThreshold = 0.12;

    const body = b3.b3CreateBody(this.world, def);
    if (def.isBullet && b3.b3Body_SetBullet) b3.b3Body_SetBullet(body, true);
    const gScale = def.gravityScale ?? (role === "projectile" ? 0 : 1);
    if (b3.b3Body_SetGravityScale) b3.b3Body_SetGravityScale(body, gScale);

    const sd = b3.b3DefaultShapeDef();
    sd.density = opts.density ?? (role === "grenade" ? 600 : role === "ball" ? 160 : 220);
    sd.enableContactEvents = false;
    sd.enableHitEvents = false;
    sd.enableSensorEvents = false;

    if (role === "projectile") {
      // Fly through playground walls/floor — only shove crates
      sd.filter = this.makeFilter(
        PhysLayer.PROJECTILE,
        PhysLayer.CRATE,
      );
    } else if (role === "ball") {
      sd.filter = this.makeFilter(
        PhysLayer.CRATE,
        PhysLayer.STATIC | PhysLayer.CRATE | PhysLayer.PROJECTILE | PhysLayer.GRENADE,
      );
    } else {
      sd.filter = this.makeFilter(
        PhysLayer.GRENADE,
        PhysLayer.STATIC | PhysLayer.CRATE | PhysLayer.GRENADE | PhysLayer.PROJECTILE,
      );
    }

    if (sd.baseMaterial) {
      sd.baseMaterial.friction = opts.friction ?? (role === "projectile" ? 0.02 : 0.35);
      sd.baseMaterial.restitution = opts.restitution ?? (role === "projectile" ? 0 : 0.12);
    }
    b3.b3CreateSphereShape(body, sd, { center: [0, 0, 0], radius });
    return body;
  }

  destroyBody(body: B3Body | null | undefined) {
    if (!body || !this.b3 || !this.ready) return;
    try {
      this.b3.b3DestroyBody(body);
    } catch {
      /* already gone */
    }
  }

  isAwake(body: B3Body): boolean {
    if (!this.b3 || !this.ready) return true;
    return this.b3.b3Body_IsAwake?.(body) ?? true;
  }

  setTransform(body: B3Body, x: number, y: number, z: number) {
    if (!this.b3 || !this.ready || !body) return;
    try {
      this.b3.b3Body_SetTransform?.(body, [x, y, z], [0, 0, 0, 1]);
      this.b3.b3Body_SetAwake?.(body, true);
    } catch {
      /* ignore */
    }
  }

  setLinearVelocity(body: B3Body, vx: number, vy: number, vz: number) {
    if (!this.b3 || !this.ready) return;
    this.b3.b3Body_SetLinearVelocity(body, [vx, vy, vz]);
    this.b3.b3Body_SetAwake?.(body, true);
  }

  setAngularVelocity(body: B3Body, wx: number, wy: number, wz: number) {
    if (!this.b3 || !this.ready) return;
    this.b3.b3Body_SetAngularVelocity(body, [wx, wy, wz]);
    this.b3.b3Body_SetAwake?.(body, true);
  }

  applyImpulse(body: B3Body, ix: number, iy: number, iz: number) {
    if (!this.b3 || !this.ready) return;
    this.b3.b3Body_ApplyLinearImpulseToCenter(body, [ix, iy, iz], true);
  }

  applyImpulseAt(body: B3Body, ix: number, iy: number, iz: number, px: number, py: number, pz: number) {
    if (!this.b3 || !this.ready) return;
    this.b3.b3Body_ApplyLinearImpulse(body, [ix, iy, iz], [px, py, pz], true);
  }

  getPosition(body: B3Body, out?: { x: number; y: number; z: number }) {
    const o = out ?? { x: 0, y: 0, z: 0 };
    if (!this.b3 || !this.ready) return o;
    this.b3.b3Body_GetPosition(POS, body);
    o.x = POS[0] ?? 0;
    o.y = POS[1] ?? 0;
    o.z = POS[2] ?? 0;
    return o;
  }

  getRotation(body: B3Body, out?: { x: number; y: number; z: number; w: number }) {
    const o = out ?? { x: 0, y: 0, z: 0, w: 1 };
    if (!this.b3 || !this.ready) return o;
    this.b3.b3Body_GetRotation(ROT, body);
    o.x = ROT[0] ?? 0;
    o.y = ROT[1] ?? 0;
    o.z = ROT[2] ?? 0;
    o.w = ROT[3] ?? 1;
    return o;
  }

  getLinearVelocity(body: B3Body, out?: { x: number; y: number; z: number }) {
    const o = out ?? { x: 0, y: 0, z: 0 };
    if (!this.b3 || !this.ready || !body) return o;
    try {
      this.b3.b3Body_GetLinearVelocity(VEL, body);
      o.x = VEL[0] ?? 0;
      o.y = VEL[1] ?? 0;
      o.z = VEL[2] ?? 0;
    } catch {
      o.x = 0; o.y = 0; o.z = 0;
    }
    return o;
  }

  getMass(body: B3Body): number {
    if (!this.b3 || !this.ready) return 1;
    return this.b3.b3Body_GetMass(body) || 1;
  }

  /** Sync mesh only when body is awake (sleeping crates stay put). */
  syncMesh(
    body: B3Body,
    mesh: {
      position: { set: (x: number, y: number, z: number) => void };
      quaternion: { set: (x: number, y: number, z: number, w: number) => void };
    },
    force = false,
  ) {
    if (!this.b3 || !this.ready) return;
    if (!force && this.skipSleepSync && this.b3.b3Body_IsAwake && !this.b3.b3Body_IsAwake(body)) {
      return;
    }
    this.b3.b3Body_GetPosition(POS, body);
    this.b3.b3Body_GetRotation(ROT, body);
    mesh.position.set(POS[0], POS[1], POS[2]);
    mesh.quaternion.set(ROT[0], ROT[1], ROT[2], ROT[3]);
  }

  explode(
    bodies: Array<{ body: B3Body; meshPos: { x: number; y: number; z: number } }>,
    origin: { x: number; y: number; z: number },
    radius: number,
    strength: number,
  ) {
    if (!this.ready || !this.b3) return;
    const r2 = radius * radius;
    for (const item of bodies) {
      const dx = item.meshPos.x - origin.x;
      const dy = item.meshPos.y - origin.y;
      const dz = item.meshPos.z - origin.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const falloff = 1 - d / radius;
      const mag = strength * falloff * falloff;
      const inv = mag / d;
      this.applyImpulse(item.body, dx * inv, dy * inv + mag * 0.35, dz * inv);
    }
  }

  dispose() {
    if (this.b3 && this.world) {
      try {
        this.b3.b3DestroyWorld(this.world);
      } catch {
        /* */
      }
    }
    this.world = null;
    this.ground = null;
    this.walls = [];
    this.ready = false;
    this.initPromise = null;
    this.acc = 0;
    this.awakeCount = 0;
  }
}

export const sharedPhysics = new Box3Physics();
