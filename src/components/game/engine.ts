// @ts-nocheck
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { GameAudio } from "./audio";
import {
  createPalette,
  makeGlove,
  makeOpenHand,
  makePokeHand,
  makeModeHand,
  makeEnemy,
  makeGrenade,
  applyEnemyDamageFace,
  makeBottle,
  makeCrate,
  makeStar,
  makeHpBar,
  makeSkyDome,
  makeImpactRing,
  makeLantern,
  makeBanner,
  type Palette,
  makeHeartShield,
  makeGestureHand,
  makeHeartHalf,
  makeHeartProp,
} from "./meshes";
import { HandCameraTracker, trackedHandToOverlay, type HandTrackFrame } from "./handCamera";
import type { GameCallbacks, GamePhase, HandMode, HudState, MotionCue, PlatformKind } from "./types";
import { sharedPhysics } from "./physics";
import {
	isHeadsetLike,
	isEmbeddedInIframe,
	isAppleVisionProLikely,
	detectXR as probeXr,
	modeToRequest,
	sessionInitForVendor,
	attachInputSourceProfileTracking,
	safeGetJointPose,
	safeGetPose,
	hidePointerRays,
	isGazeOrPinchSource,
	tuningForVendor,
	applySessionDepth,
	friendlyHeadsetName,
	getForceXrEnabled,
	setForceXrEnabled,
	resetXrDetectionCache,
	pickXrReferenceSpace,
	type XrVendor,
	type XrMode,
	type XrProbe,
	type DeviceTuning,
} from "./xrSupport";

const MAX_WAVES = 999; // endless prototype — UI still shows "loop" milestones
const LOOP_LEN = 8; // champion banner every N waves, then harder
const HS_KEY = "glove-fight-highscore-v2";
/** Vignette + chromatic aberration driven by trauma (juice pass) */
const JuiceShader = {
	uniforms: {
		tDiffuse: { value: null },
		vignette: { value: .42 },
		chroma: { value: 0 },
		time: { value: 0 },
		pulse: { value: 0 }
	},
	vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
	fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float chroma;
    uniform float time;
    uniform float pulse;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float d = length(c);
      float ab = chroma * (0.004 + d * 0.012);
      float r = texture2D(tDiffuse, uv + c * ab).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - c * ab).b;
      vec3 col = vec3(r, g, b);
      // warm film grade + punch pulse
      col *= vec3(1.04, 1.0, 0.96);
      col += pulse * 0.08 * vec3(1.0, 0.85, 0.5);
      float vig = smoothstep(0.95, 0.25, d * (0.9 + vignette));
      col *= mix(1.0 - vignette * 0.55, 1.0, vig);
      // subtle scanline shimmer when juiced
      col += chroma * 0.02 * sin(uv.y * 900.0 + time * 20.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `
};
function loadHighScore() {
	try {
		return Number(localStorage.getItem(HS_KEY) || 0) || 0;
	} catch {
		return 0;
	}
}
function saveHighScore(n) {
	try {
		localStorage.setItem(HS_KEY, String(n));
	} catch {}
}
function detectMobile() {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 820;
}
function prefersReducedMotion() {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/**
 * True when the page is running inside a headset's browser shell
 * (Quest Browser, Pico, Vision Pro, Spectacles) — NOT phones with ARCore.
 */
export function isXrHeadsetBrowser() {
	return isHeadsetLike();
}
function radialDeadzone(x, y, dz = .18) {
	const m = Math.hypot(x, y);
	if (m < dz) return {
		x: 0,
		y: 0
	};
	const scale = (m - dz) / (1 - dz) / m;
	return {
		x: x * scale,
		y: y * scale
	};
}
export class GloveFightEngine {
	canvas;
	callbacks;
	renderer;
	scene;
	camera;
	overlayScene;
	overlayCam;
	composer = null;
	bloomPass = null;
	fxaaPass = null;
	juicePass = null;
	clock = new THREE.Timer();
	disposed = false;
	palette;
	audio = new GameAudio();
	keys = /* @__PURE__ */ new Set();
	phase = "menu";
	mode = "punch";
	modeL = "punch";
	modeR = "punch";
	health = 100;
	maxHealth = 100;
	score = 0;
	combo = 0;
	comboTimer = 0;
	wave = 0;
	power = 0;
	highScore = loadHighScore();
	message = "";
	messageT = 0;
	hitstop = 0;
	trauma = 0;
	camKick = 0;
	timeScale = 1;
	idSeq = 1;
	entities = [];
	spawnQueue = [];
	waveEnemies = 0;
	waveKills = 0;
	nextHazard = 0;
	time = 0;
	yaw = 0;
	pitch = 0;
	lookX = 0;
	lookY = 0;
	locked = false;
	isMobile = false;
	xrSupported = false;
	xrModeVr = false;
	xrModeAr = false;
	/** "immersive-ar" | "immersive-vr" | null — AR preferred when both available */
	xrPreferredMode = null;
	xrSessionMode = null;
	/** null | "iframe" | "insecure-context" | "permissions-policy" | "no-webxr" */
	xrBlockReason = null;
	xrLastError = "";
	xrVendor = null;
	xrVendorGuess = null;
	xrProfiles = [];
	xrDeviceName = "";
	xrForce = false;
	xrTuning = null;
	_xrProfileUnsub = null;
	_xrGlReady = false;
	_xrGlWarming = false;
	xrActive = false;
	xrHeadset = false;
	playerRig = null;
	xrCtrlByHand = { L: null, R: null };
	xrSession = null;
	xrEntering = false;
	xrUsingHands = false;
	xrHandScale = 0.38;
	xrHandHoldL = null;
	xrHandHoldR = null;
	xrHandHoldFramesL = 0;
	xrHandHoldFramesR = 0;
	xrPrevCtrlPosL = null;
	xrPrevCtrlPosR = null;
	xrPrevCtrlTL = 0;
	xrPrevCtrlTR = 0;
	xrLastThrustDirL = null;
	xrLastThrustDirR = null;
	xrLastThrustTL = 0;
	xrLastThrustTR = 0;
	xrPrevQuatL = null;
	xrPrevQuatR = null;
	/** @type {"wrist"|"sweep"|null} last slap style per hand */
	xrLastSlapStyleL = null;
	xrLastSlapStyleR = null;
	xrLastSlapTL = 0;
	xrLastSlapTR = 0;
	xrSlapTravelL = 0;
	xrSlapTravelR = 0;
	/** Active punch/slap swing waiting for release (fire on stop) */
	xrSwingL = null;
	xrSwingR = null;
	/** Last computed strike strength 0.2–1.4 for scaling projectiles */
	xrStrikePowerL = 1;
	xrStrikePowerR = 1;
	xrLastPeakSpeedL = 0;
	xrLastPeakSpeedR = 0;
	xrGrenadeWindL = null;
	xrGrenadeWindR = null;
	xrGripModels = [];
	xrHandAnchors = { L: null, R: null };
	waveClearReadyAt = 0;
	handDebug = false;
	debugArrowAim = null;
	debugArrowCtrl = null;
	debugArrowCam = null;
	debugLastFire = null;
	pathHalfWidth = 2.65;
	pathMinZ = -42;
	pathMaxZ = 2;
	handCam = null;
	cameraHands = false;
	cameraLoading = false;
	cameraError = null;
	cameraGesture = "";
	cameraHandsCount = 0;
	trackProgress = 0;
	trackReady = false;
	trackHoldT = 0;
	countdownT = null;
	readyingElapsed = 0;
	leftReturnAt = 0;
	heartShieldUntil = 0;
	heartShieldCdUntil = 0;
	heartShieldEntity = null;
	heartDetectHold = 0;
	/** Social / emoji gesture props on hands (null = show combat RPS mesh) */
	handGestureL = null;
	handGestureR = null;
	/** Heart pose active — half-hearts on hands, combat models hidden */
	heartPoseActive = false;
	heartConnectMesh = null;
	/** Camera grenade: fist high then open on release */
	camGrenadeL = null;
	camGrenadeR = null;
	clickBoostL = false;
	clickBoostR = false;
	clickGlowL = 0;
	clickGlowR = 0;
	xrClickStateL = null;
	xrClickStateR = null;
	rightReturnAt = 0;
	viewHandFillOpacity = 0.36;
	lastTrackFrame = null;
	motionCueId = 0;
	platform = "desktop";
	fps = 60;
	fpsAcc = 0;
	fpsFrames = 0;
	quality = 1;
	reducedMotion = false;
	leftGlove;
	rightGlove;
	leftMeshes;
	rightMeshes;
	leftRest = new THREE.Vector3(-.4, -.34, -.65);
	rightRest = new THREE.Vector3(.4, -.34, -.65);
	leftPos = new THREE.Vector3();
	rightPos = new THREE.Vector3();
	leftPunchT = 0;
	rightPunchT = 0;
	leftCd = 0;
	rightCd = 0;
	gesturePose = "none";
	gestureT = 0;
	powerSpin = 0;
	charging = false;
	bob = 0;
	railZ = 0;
	tmp = new THREE.Vector3();
	tmp2 = new THREE.Vector3();
	_physVel = { x: 0, y: 0, z: 0 };
	_physPos = { x: 0, y: 0, z: 0 };
	arenaRoot = new THREE.Group();
	particles = [];
	rings = [];
	floatTexts = [];
	hudRoot = null;
	dust = null;
	ambientMotes = null;
	touchLookId = null;
	touchLookLastX = 0;
	touchLookLastY = 0;
	mobileFireL = false;
	mobileFireR = false;
	lookSens = .0024;
	controller0 = null;
	controller1 = null;
	controllerGrip0 = null;
	controllerGrip1 = null;
	xrGloveL = null;
	xrGloveR = null;
	xrGloveMeshesL = null;
	xrGloveMeshesR = null;
	xrHud = null;
	xrSelectL = false;
	xrSelectR = false;
	xrPrevSelectL = false;
	xrPrevSelectR = false;
	dummyCam = new THREE.Vector3();
	sun;
	punchLight = null;
	punchLightT = 0;
	gamepadLookX = 0;
	gamepadLookY = 0;
	prevPadButtons = /* @__PURE__ */ new Set();
	noiseSeed = Math.random() * 1e3;
	particleGeo = new THREE.IcosahedronGeometry(.045, 0);
	particlePool = [];
	onKeyDown = (e) => this.handleKey(e, true);
	onKeyUp = (e) => this.handleKey(e, false);
	onMouseMove = (e) => this.handleMouseMove(e);
	onMouseDown = (e) => this.handleMouseDown(e);
	onContext = (e) => e.preventDefault();
	onLockChange = () => this.handleLockChange();
	onResize = () => this.resize();
	onBlur = () => {
		this.keys.clear();
		this.charging = false;
		this.mobileFireL = false;
		this.mobileFireR = false;
	};
	onVis = () => {
		if (document.hidden && this.phase === "playing" && !this.xrActive) this.setPhase("paused");
		if (document.hidden) this.keys.clear();
		if (!document.hidden) this.audio.unlock();
	};
	constructor(canvas, callbacks, hudRoot) {
		this.canvas = canvas;
		this.callbacks = callbacks;
		this.hudRoot = hudRoot ?? null;
		this.isMobile = detectMobile();
		this.xrHeadset = isHeadsetLike();
		this.xrForce = getForceXrEnabled();
		this.xrVendorGuess = isAppleVisionProLikely() ? "vision-pro" : null;
		this.xrDeviceName = this.xrHeadset ? friendlyHeadsetName(this.xrVendorGuess) : "";
		this.platform = this.xrHeadset ? "xr" : this.isMobile ? "mobile" : "desktop";
		this.reducedMotion = prefersReducedMotion();
		this.palette = createPalette();
		// Ensure power meter state is always a number (avoids ReferenceError / NaN UI paths)
		this.power = 0;
		this.powerSpin = 0;
		this.charging = false;
		this.quality = this.isMobile ? .85 : 1;
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: !this.isMobile,
			alpha: false,
			powerPreference: "high-performance",
			stencil: false
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.6 : 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.18;
		this.renderer.autoClear = false;
		this.renderer.xr.enabled = true;
		try { this.renderer.xr.setReferenceSpaceType("local"); } catch { /* */ }
		// Do NOT call makeXRCompatible on load — desktop GL throws InvalidStateError
		// and spams the console. We only warm after an XR session is granted.
		this.scene = new THREE.Scene();
		this.scene.fog = new THREE.FogExp2(13146216, .018);
		this.camera = new THREE.PerspectiveCamera(78, 1, .05, 90);
		this.camera.position.set(0, 1.55, 0);
		this.overlayScene = new THREE.Scene();
		this.overlayCam = new THREE.PerspectiveCamera(50, 1, .05, 10);
		this.buildWorld();
		this.buildHands();
		this.buildPost();
		this.buildDust();
		this.setupXR();
		this.resize();
		this.bindInput();
		this.detectXR();
		this.emitHud();
		this.clock.connect(document);
		// Box3D Wasm physics (box3d.js) — crates, grenades, projectile bodies
		void sharedPhysics.init().then(() => {
			this.physicsReady = true;
			this.spawnFunBoxStacks();
		}).catch((err) => {
			console.warn("[physics] box3d.js failed to init", err);
			this.physicsReady = false;
		});
		this.renderer.setAnimationLoop(() => this.frame());
		if (typeof window !== "undefined") {
			const w = window;
			w.__gfPauseRender = () => this.renderer.setAnimationLoop(null);
			w.__gfResumeRender = () => this.renderer.setAnimationLoop(() => this.frame());
			w.__gfStart = () => this.startGame();
			w.__gfToggleHandDebug = () => this.toggleHandDebug();
			w.__gfHandDebug = () => this.getHandDebugInfo();
			w.__gfSetHandScale = (s) => this.setXrHandScale(Number(s));
		}
	}
	dispose() {
		this.disposed = true;
		this.renderer.setAnimationLoop(null);
		this.unbindInput();
		this.audio.stopMusic();
		this.handCam?.stop();
		if (this.renderer.xr.isPresenting) this.renderer.xr.getSession()?.end();
		this.composer?.dispose();
		this.particleGeo.dispose();
		sharedPhysics.dispose();
		this.renderer.dispose();
	}
	startGame() {
		this.audio.unlock();
		this.audio.click();
		this.audio.startMusic();
		this.resetRun();
		this.setPhase("playing");
		this.beginWave(1);
		if (!this.isMobile && !this.xrActive) this.requestLock();
	}
	resume() {
		this.audio.unlock();
		if (this.phase === "paused") {
			this.setPhase("playing");
			if (!this.isMobile && !this.xrActive) this.requestLock();
		}
	}
	pause() {
		if (this.phase === "playing" && !this.xrActive) this.setPhase("paused");
	}
	setMode(mode, hand = "both") {
		if (hand === "L" || hand === "both") this.modeL = mode;
		if (hand === "R" || hand === "both") this.modeR = mode;
		this.mode = this.modeR;
		this.updateHandMeshes();
		this.syncXrGloves();
		this.emitHud();
		this.audio.click();
	}
	getHandMode(hand) {
		return hand === "L" ? this.modeL : this.modeR;
	}
	applyHandMode(hand, mode, announce = true) {
		if (hand === "L") this.modeL = mode;
		else this.modeR = mode;
		this.mode = mode;
		this.updateHandMeshes();
		this.syncXrGloves();
		if (announce) {
			const label = mode === "punch" ? "Rock" : mode === "slap" ? "Paper" : "Scissors";
			this.pushMsg(`${hand} ${label}`, 1.2);
		}
		this.emitHud();
	}
	uniquifyMaterials(root) {
		root.traverse((o) => {
			if (!o.isMesh || !o.material) return;
			if (Array.isArray(o.material)) o.material = o.material.map((m) => { const c = m.clone(); c.transparent = true; return c; });
			else { const c = o.material.clone(); c.transparent = true; o.material = c; }
		});
	}
	styleViewmodelHand(root) {
		root.traverse((o) => {
			if (!o.isMesh || !o.material || o.userData?.isOutline) return;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const mat of mats) {
				mat.transparent = true;
				mat.opacity = this.viewHandFillOpacity;
				mat.depthWrite = false;
			}
		});
	}
	setViewHandOpacity(hand, opacity) {
		const root = hand === "L" ? this.leftGlove : this.rightGlove;
		if (!root) return;
		root.traverse((o) => {
			if (!o.isMesh || !o.material) return;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const mat of mats) { mat.transparent = true; mat.opacity = opacity * this.viewHandFillOpacity; }
		});
	}
	// --- Camera hands API (used by UI / PIP) ---
	async toggleCameraHands() {
		if (this.cameraHands) { this.disableCameraHands(); return; }
		await this.enableCameraHands();
	}
	async enableCameraHands() {
		if (this.cameraHands || this.cameraLoading) return;
		this.cameraLoading = true;
		this.cameraError = null;
		this.emitHud();
		try {
			if (!this.handCam) this.handCam = new HandCameraTracker();
			await this.handCam.start();
			this.cameraHands = true;
			this.cameraLoading = false;
			this.pushMsg("Camera hands on — fist/open/scissors", 2.0);
		} catch (err) {
			this.cameraLoading = false;
			this.cameraHands = false;
			this.cameraError = err?.message || "Camera failed";
			console.error("[glove-fight] Camera hands failed:", this.cameraError, err);
			this.pushMsg(this.cameraError, 3.5);
		}
		this.emitHud();
	}
	disableCameraHands() {
		this.handCam?.stop();
		this.cameraHands = false;
		this.cameraLoading = false;
		this.cameraHandsCount = 0;
		this.cameraGesture = "";
		this.trackProgress = 0;
		this.trackReady = false;
		this.emitHud();
	}
	getCameraVideo() { return this.handCam?.getVideo() || null; }
	getHandTrackFrame() { return this.handCam?.getLastFrame() || this.lastTrackFrame; }
	clampToPath(x, z) {
		return {
			x: THREE.MathUtils.clamp(x, -this.pathHalfWidth, this.pathHalfWidth),
			z: THREE.MathUtils.clamp(z, this.pathMinZ, this.pathMaxZ),
		};
	}
	keepEnemyOnPath(e) {
		const p = this.clampToPath(e.mesh.position.x, e.mesh.position.z);
		e.mesh.position.x = p.x;
		e.mesh.position.z = p.z;
	}
	getViewForward() {
		return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
	}
	getViewRight() {
		return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
	}
	fireLeft() {
		this.tryAttack("L");
	}
	fireRight() {
		this.tryAttack("R");
	}
	setMobileFire(side, down) {
		if (side === "L") this.mobileFireL = down;
		else this.mobileFireR = down;
	}
	setCharging(v) {
		this.charging = v;
	}
	doGesture(kind) {
		if (this.phase !== "playing" && this.phase !== "waveClear" && this.phase !== "victory" && this.phase !== "menu") return;
		this.gesturePose = kind;
		this.gestureT = 1.4;
		this.audio.taunt();
		if (kind === "heart") {
			this.enterHeartPose();
			this.spawnHeartShield();
		} else if (kind === "thumbs" || kind === "thumbsDown" || kind === "peace" || kind === "spock" || kind === "wave") {
			this.heartPoseActive = false;
			this.setHandGesture("R", kind === "wave" ? "peace" : kind);
			this.setHandGesture("L", kind === "thumbs" || kind === "peace" || kind === "spock" ? kind : null);
			this.power = Math.min(1, this.power + .1);
			const msg =
				kind === "thumbs" ? "👍 Thumbs up!"
				: kind === "thumbsDown" ? "👎 Thumbs down!"
				: kind === "spock" ? "🖖 Live long & prosper!"
				: kind === "peace" ? "✌️ Peace!"
				: "Wave!";
			this.pushMsg(msg, 1.4);
			this.burst(this.camera.position.clone().add(new THREE.Vector3(0, 0, -1)), kind === "thumbsDown" ? 0xe23d3d : 16765514, 14);
		} else {
			this.heartPoseActive = false;
			this.setHandGesture("L", kind === "rockOn" ? "rockOn" : null);
			this.setHandGesture("R", kind === "rockOn" ? "rockOn" : null);
			this.combo = Math.max(this.combo, 1);
			this.comboTimer = 3;
			this.pushMsg(kind === "rockOn" ? "🤘 Rock on!" : "Taunt!");
			this.trauma = Math.min(1, this.trauma + .18);
		}
		this.updateHandMeshes();
		this.emitHud();
	}
	enterHeartPose() {
		this.heartPoseActive = true;
		this.handGestureL = "heart";
		this.handGestureR = "heart";
		this.updateHandMeshes();
		this.syncXrGloves();
		// Pull hands toward center so halves meet
		if (!this.xrActive) {
			this.leftRest.set(-0.12, -0.08, -0.55);
			this.rightRest.set(0.12, -0.08, -0.55);
		}
		if (this.heartConnectMesh) this.heartConnectMesh.visible = true;
	}
	exitHeartPose() {
		if (!this.heartPoseActive) return;
		this.heartPoseActive = false;
		this.handGestureL = null;
		this.handGestureR = null;
		this.leftRest.set(-0.4, -0.34, -0.65);
		this.rightRest.set(0.4, -0.34, -0.65);
		if (this.heartConnectMesh) this.heartConnectMesh.visible = false;
		this.updateHandMeshes();
		this.syncXrGloves();
	}
	/** Two-hand heart → temporary damage shield in front of the player. */
	spawnHeartShield() {
		if (this.time < this.heartShieldCdUntil) {
			this.pushMsg("Shield cooling…", 0.7);
			return;
		}
		// Refresh existing
		if (this.heartShieldEntity && this.heartShieldEntity.alive) {
			this.heartShieldEntity.alive = false;
			if (this.heartShieldEntity.mesh?.parent) this.heartShieldEntity.mesh.parent.remove(this.heartShieldEntity.mesh);
		}
		this.enterHeartPose();
		const mesh = makeHeartShield(this.palette);
		const origin = this.getPlayerPos().clone();
		const fwd = new THREE.Vector3();
		this.camera.getWorldDirection(fwd);
		if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
		fwd.y = 0;
		if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
		fwd.normalize();
		// In front of player, same height as camera/player (getPlayerPos is already eye-level)
		const dist = this.xrActive ? 1.2 : 1.55;
		const pos = origin.clone().addScaledVector(fwd, dist);
		pos.y = origin.y; // match player height — do not stack extra lift
		mesh.position.copy(pos);
		mesh.lookAt(pos.clone().add(fwd));
		this.scene.add(mesh);
		const ent = {
			id: this.idSeq++,
			kind: "heartShield",
			mesh,
			alive: true,
			hp: 1,
			maxHp: 1,
			radius: 1.35,
			vel: new THREE.Vector3(),
			age: 0,
			life: 5.2,
			damage: 22,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 0,
			hand: null,
			powered: true,
			squash: 1,
			fwd: fwd.clone(),
		};
		this.entities.push(ent);
		this.heartShieldEntity = ent;
		this.heartShieldUntil = this.time + ent.life;
		this.heartShieldCdUntil = this.time + 2.4;
		this.power = Math.min(1, this.power + 0.12);
		this.pushMsg("♥ HEART SHIELD!", 1.4);
		if (this.audio.heartShield) this.audio.heartShield();
		else this.audio.powerup();
		this.burst(pos.clone(), 0xff4d8d, 28);
		this.trauma = Math.min(1, this.trauma + 0.12);
		if (this.bloomPass) this.bloomPass.strength = this.isMobile ? 0.9 : 1.25;
		this.emitHud();
	}
	/**
	 * Detect two hands forming a heart (index tips together on top, thumbs together below).
	 * @param hands TrackedHand[] with landmarks
	 */
	detectTwoHandHeartCam(hands) {
		const L = hands.find((h) => h.side === "L");
		const R = hands.find((h) => h.side === "R");
		if (!L?.landmarks || !R?.landmarks) return false;
		if (L.landmarks.length < 21 || R.landmarks.length < 21) return false;
		const li = L.landmarks[8], ri = R.landmarks[8];
		const lt = L.landmarks[4], rt = R.landmarks[4];
		const lw = L.landmarks[0], rw = R.landmarks[0];
		if (!li || !ri || !lt || !rt || !lw || !rw) return false;
		const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
		const indexDist = d(li, ri);
		const thumbDist = d(lt, rt);
		const wristDist = d(lw, rw);
		// Tips close, thumbs close, wrists not too far (hands together)
		if (indexDist > 0.13 || thumbDist > 0.16 || wristDist > 0.42) return false;
		// In image coords y grows downward — thumbs should be below index tips
		const tipY = (li.y + ri.y) * 0.5;
		const thY = (lt.y + rt.y) * 0.5;
		if (thY < tipY - 0.01) return false; // thumbs not below
		// Heart height reasonable
		if (thY - tipY < 0.03 || thY - tipY > 0.28) return false;
		return true;
	}
	detectTwoHandHeartXR(frame, refSpace, handL, handR) {
		const joint = (hand, name) => {
			const j = hand.get?.(name) || hand.get(name);
			if (!j) return null;
			const pose = safeGetJointPose(frame, j, refSpace);
			return pose ? pose.transform.position : null;
		};
		const li = joint(handL, "index-finger-tip");
		const ri = joint(handR, "index-finger-tip");
		const lt = joint(handL, "thumb-tip");
		const rt = joint(handR, "thumb-tip");
		const lw = joint(handL, "wrist");
		const rw = joint(handR, "wrist");
		if (!li || !ri || !lt || !rt || !lw || !rw) return false;
		const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		if (d(li, ri) > 0.08 || d(lt, rt) > 0.1 || d(lw, rw) > 0.45) return false;
		const tipY = (li.y + ri.y) * 0.5;
		const thY = (lt.y + rt.y) * 0.5;
		// World Y up — thumbs below index tips
		if (thY > tipY + 0.01) return false;
		if (tipY - thY < 0.03 || tipY - thY > 0.22) return false;
		return true;
	}
	toggleMute() {
		this.audio.setMuted(!this.audio.muted);
	}
	continueFromWaveClear() {
		if (this.phase === "waveClear" || this.phase === "victory") this.nextWaveFromClear();
	}
	isEmbeddedFrame() {
		return isEmbeddedInIframe();
	}
	/** True when Permissions-Policy / Feature-Policy denies WebXR. */
	isXrPolicyBlocked() {
		try {
			const fp = document.featurePolicy;
			if (fp && typeof fp.allowsFeature === "function" && !fp.allowsFeature("xr-spatial-tracking")) {
				return true;
			}
		} catch { /* */ }
		try {
			const pp = document.permissionsPolicy;
			if (pp && typeof pp.allowsFeature === "function" && !pp.allowsFeature("xr-spatial-tracking")) {
				return true;
			}
		} catch { /* */ }
		return false;
	}
	/** Diagnose why requestSession would throw SecurityError before we call it. */
	getXrBlockReason() {
		if (typeof window === "undefined") return "no-webxr";
		if (!window.isSecureContext) return "insecure-context";
		if (!navigator.xr) return "no-webxr";
		if (this.isEmbeddedFrame()) return "iframe";
		if (this.isXrPolicyBlocked()) return "permissions-policy";
		return null;
	}
	/** Vision Pro / Safari: WebXR is blocked in embeds — open a real top-level page. */
	openTopLevelForVR() {
		const url = typeof location !== "undefined" ? location.href : "";
		if (!url) return false;
		try {
			// Prefer user-activated window.open
			const w = window.open(url, "_blank", "noopener,noreferrer");
			if (w) {
				this.pushMsg("Opened full window — tap Enter XR there", 5);
				this.xrLastError = ""; // not an error
				this.emitHud();
				return true;
			}
		} catch (e) {
			console.warn("[glove-fight] window.open blocked", e);
		}
		try {
			if (window.top && window.top !== window.self) {
				window.top.location.href = url;
				return true;
			}
		} catch { /* cross-origin */ }
		this.pushMsg("Copy the page URL → open in Safari (not the embed)", 5);
		this.xrLastError = "Could not break out of iframe — open URL in Safari manually";
		this.emitHud();
		return false;
	}
	/**
	 * Click-handler entry. requestSession is the FIRST XR call (same tick as click).
	 * Pico drops user activation on pointerdown and across any await.
	 */
	enterXR(explicitMode) {
		const xr = typeof navigator !== "undefined" ? navigator.xr : null;
		if (!xr || typeof xr.requestSession !== "function") {
			this.xrBlockReason = "no-webxr";
			this.xrLastError = "navigator.xr missing";
			this.pushMsg("WebXR not available on this browser", 4);
			this.emitHud();
			return;
		}
		if (typeof window !== "undefined" && window.isSecureContext === false) {
			this.xrBlockReason = "insecure-context";
			this.xrLastError = "Not HTTPS — WebXR requires a secure context";
			this.pushMsg(this.xrLastError, 5);
			this.emitHud();
			return;
		}
		if (this.xrActive || this.renderer.xr.isPresenting) {
			this.pushMsg("Already in XR", 1.5);
			return;
		}
		if (this.xrEntering) return;

		const vendor = this.xrVendor || this.xrVendorGuess;
		const probe = {
			vr: this.xrModeVr,
			ar: this.xrModeAr,
			preferred: this.xrPreferredMode,
			preferredMode: this.xrPreferredMode === "immersive-ar" ? "ar" : this.xrPreferredMode === "immersive-vr" ? "vr" : null,
			isHeadset: this.xrHeadset,
			vendorGuess: vendor,
			embedded: this.isEmbeddedFrame(),
			deviceName: this.xrDeviceName,
		};
		const mode = modeToRequest(probe, explicitMode || null);
		const init = sessionInitForVendor(vendor);

		this.xrEntering = true;
		this.xrLastError = "";
		this.xrBlockReason = this.isEmbeddedFrame() ? "iframe" : null;

		// FIRST XR API call — nothing async / HUD / audio / GL before this.
		let sessionPromise;
		try {
			sessionPromise = xr.requestSession(mode, init);
		} catch (err) {
			this.xrEntering = false;
			this.failXrEntry(err);
			return;
		}

		// Safe after the call is in flight
		try { this.audio.unlock(); } catch { /* */ }
		try { this.renderer.xr.enabled = true; } catch { /* */ }
		console.info("[xr] enter", { mode, init, vendor });

		sessionPromise.then((session) => this.onXrSession(session, mode)).catch((err) => {
			this.xrEntering = false;
			this.failXrEntry(err);
		});
	}
	failXrEntry(err) {
		const name = err && err.name ? String(err.name) : "";
		const raw = err && err.message ? String(err.message) : name || "unavailable";
		console.error("[xr] enter blocked", name, raw);
		let tip = raw;
		if (name === "SecurityError" || /insecure/i.test(raw)) {
			this.xrBlockReason = this.isEmbeddedFrame() ? "iframe" : "permissions-policy";
			tip = "SecurityError — open a full browser tab, then Enter XR";
		} else if (/reference space/i.test(raw)) {
			tip = "Floor tracking unavailable — using local space. Tap Enter VR again.";
		} else if (name === "NotSupportedError") {
			tip = "That XR mode or space is not supported on this device";
		} else if (name === "InvalidStateError") {
			tip = "Tap Enter XR again (needs a fresh gesture)";
		} else if (name === "NotAllowedError" || /user activation/i.test(raw)) {
			tip = "Tap Enter XR again — Pico/Vision Pro need a fresh tap for permission";
		}
		this.xrLastError = (name ? name + ": " : "") + tip;
		this.pushMsg("XR failed: " + tip.slice(0, 80), 6);
		this.emitHud();
	}
	async onXrSession(session, usedMode) {
		let live = session;
		try {
			// Inline GL warmup — do NOT call this.warmXRCompatible (method was removed;
			// Pico crashed here with TypeError and immediately ended the session).
			try {
				const gl = this.renderer?.getContext?.();
				if (gl && typeof gl.makeXRCompatible === "function") {
					await gl.makeXRCompatible();
					this._xrGlReady = true;
				}
			} catch (e) {
				const name = e && e.name;
				if (name && name !== "InvalidStateError") {
					console.warn("[xr] makeXRCompatible", name, e && e.message);
				}
				this._xrGlReady = false;
			}
			try { this.renderer.xr.enabled = true; } catch { /* */ }
			// Probe what THIS session can do. setReferenceSpaceType does not throw —
			// Three.js fails later inside setSession via requestReferenceSpace.
			// Last change dropped optional local-floor, so Quest died here.
			const spaceType = await pickXrReferenceSpace(session);
			try { this.renderer.xr.setReferenceSpaceType(spaceType); } catch { /* */ }
			console.info("[xr] reference space", spaceType);
			this.renderer.setAnimationLoop(() => this.frame());
			try {
				await this.renderer.xr.setSession(session);
			} catch (bindErr) {
				// Rare: probe passed but Three still asked for the constructor default (local-floor)
				if (/reference space/i.test(String(bindErr && bindErr.message))) {
					console.warn("[xr] setSession retry with local", bindErr && bindErr.message);
					try { this.renderer.xr.setReferenceSpaceType("local"); } catch { /* */ }
					await this.renderer.xr.setSession(session);
				} else {
					throw bindErr;
				}
			}

			this.xrSession = session;
			this.xrSessionMode = usedMode;
			this.xrActive = true;
			this.xrHeadset = true;
			this.platform = "xr";
			this.xrPresentGrace = 3.0;
			this.xrBlockReason = null;
			this.xrLastError = "";
			this.renderer.autoClear = true;

			if (this._xrProfileUnsub) try { this._xrProfileUnsub(); } catch { /* */ }
			this._xrProfileUnsub = attachInputSourceProfileTracking(session, ({ profiles, vendor }) => {
				this.xrProfiles = profiles;
				if (vendor) this.xrVendor = vendor;
				this.xrDeviceName = friendlyHeadsetName(this.xrVendor || this.xrVendorGuess, profiles);
				this.applyXrDeviceTuning();
				this.emitHud();
			});

			this.applyXrDeviceTuning();
			this.applyXrPointerPolicy();

			const onEnd = () => {
				this.cleanupAfterXrEnd();
			};
			session.addEventListener("end", onEnd);

			this.leftGlove.visible = false;
			this.rightGlove.visible = false;
			if (this.xrGloveL) this.xrGloveL.visible = true;
			if (this.xrGloveR) this.xrGloveR.visible = true;
			this.paintXrHud(true);
			if (this.playerRig) {
				this.playerRig.position.set(0, 0, 0);
				if (!this.playerRig.parent) this.scene.add(this.playerRig);
				if (this.camera.parent !== this.playerRig) this.playerRig.add(this.camera);
				this.camera.position.set(0, 0, 0);
			}
			this.syncXrGloves();
			for (const g of this.xrGripModels || []) if (g) g.visible = false;
			if (this.phase === "menu" || this.phase === "gameover") this.startGame();
			else if (this.phase === "victory" || this.phase === "waveClear") this.continueFromWaveClear();
			else if (this.phase === "paused" || this.phase === "readying") this.setPhase("playing");
			const label = usedMode === "immersive-ar" ? "AR" : "VR";
			this.pushMsg(label + " ready · hands on · thrust to punch", 3.0);
			this.xrEntering = false;
			console.info("[xr] session active", usedMode, this.xrVendor || this.xrVendorGuess, this.xrDeviceName);
			this.emitHud();
		} catch (err) {
			this.xrEntering = false;
			this.xrActive = false;
			this.xrSession = null;
			this.xrSessionMode = null;
			try { live?.end?.(); } catch { /* */ }
			this.failXrEntry(err);
		}
	}
	applyXrDeviceTuning() {
		const vendor = this.xrVendor || this.xrVendorGuess;
		const t = tuningForVendor(vendor);
		this.xrTuning = t;
		if (this.camera) {
			this.camera.near = t.depthNear;
			this.camera.far = t.cameraFar;
			this.camera.updateProjectionMatrix();
		}
		try {
			this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pixelRatioCap));
		} catch { /* */ }
		this.quality = t.quality;
		if (this.xrSession) applySessionDepth(this.xrSession, t.cameraFar, t.depthNear);
		// AR passthrough: keep autoClear and no opaque clear if AR
		if (this.xrSessionMode === "immersive-ar") {
			try { this.renderer.setClearAlpha(0); } catch { /* */ }
			if (this.scene) this.scene.background = null;
		}
	}
	/** Vision Pro: hands on, gaze/pinch rays off. */
	applyXrPointerPolicy() {
		const t = this.xrTuning || tuningForVendor(this.xrVendor || this.xrVendorGuess);
		const hide = t.hidePointerRays || this.xrVendor === "vision-pro" || this.xrVendorGuess === "vision-pro";
		if (!hide) return;
		for (const c of [this.controller0, this.controller1, this.controllerGrip0, this.controllerGrip1]) {
			hidePointerRays(c);
		}
		for (const g of this.xrGripModels || []) if (g) g.visible = false;
		// Keep hand props; hide any leftover ray helpers in the scene
		if (this.scene) {
			this.scene.traverse((o) => {
				const n = (o.name || "").toLowerCase();
				if (o.isLine || /target.?ray|pointer|reticle|gaze/.test(n)) o.visible = false;
			});
		}
	}
	cleanupAfterXrEnd() {
		this.xrActive = false;
		this.xrSession = null;
		this.xrSessionMode = null;
		this.xrEntering = false;
		this.xrPresentGrace = 0;
		this.xrVendor = null;
		this.xrProfiles = [];
		if (this._xrProfileUnsub) {
			try { this._xrProfileUnsub(); } catch { /* */ }
			this._xrProfileUnsub = null;
		}
		this.platform = this.xrHeadset ? "xr" : this.isMobile ? "mobile" : "desktop";
		this.renderer.autoClear = false;
		this.leftGlove.visible = true;
		this.rightGlove.visible = true;
		if (this.xrGloveL) this.xrGloveL.visible = false;
		if (this.xrGloveR) this.xrGloveR.visible = false;
		if (this.xrHud) this.xrHud.visible = false;
		if (this.playerRig && this.camera.parent === this.playerRig) {
			this.scene.add(this.camera);
			this.camera.position.set(0, 1.55, 0);
		}
		this.emitHud();
		if (this.phase === "playing") this.setPhase("paused");
	}
	setForceXr(on) {
		setForceXrEnabled(!!on);
		this.xrForce = !!on;
		resetXrDetectionCache();
		void this.detectXR();
	}
	async detectXR() {
		try {
			const probe = await probeXr();
			this.xrModeVr = !!probe.vr;
			this.xrModeAr = !!probe.ar;
			this.xrPreferredMode = probe.preferred;
			this.xrHeadset = !!probe.isHeadset;
			this.xrVendorGuess = probe.vendorGuess;
			this.xrDeviceName = probe.deviceName;
			this.xrForce = getForceXrEnabled();
			// Offer headset UI only for real headsets (or Force XR). Phones stay on camera path.
			this.xrSupported = this.xrHeadset && (!!probe.vr || !!probe.ar || probe.embedded);
			if (this.xrHeadset) this.platform = "xr";
			this.xrBlockReason = this.getXrBlockReason();
			console.info("[xr] probe", {
				vr: this.xrModeVr,
				ar: this.xrModeAr,
				preferred: this.xrPreferredMode,
				headset: this.xrHeadset,
				vendor: this.xrVendorGuess,
				device: this.xrDeviceName,
				embedded: probe.embedded,
				force: this.xrForce,
			});
		} catch (e) {
			console.warn("[xr] detectXR", e);
			this.xrSupported = isHeadsetLike();
		}
		this.emitHud();
	}
	/** Clear sticky XR error banner (user dismiss or new attempt). */
	clearXrError() {
		this.xrLastError = "";
		this.xrBlockReason = this.isEmbeddedFrame() ? "iframe" : null;
		this.emitHud();
	}

	setupXR() {
		const factory = new XRControllerModelFactory();
		this.controller0 = this.renderer.xr.getController(0);
		this.controller1 = this.renderer.xr.getController(1);
		this.scene.add(this.controller0);
		this.scene.add(this.controller1);
		this.controllerGrip0 = this.renderer.xr.getControllerGrip(0);
		this.controllerGrip1 = this.renderer.xr.getControllerGrip(1);
		const gripModel0 = factory.createControllerModel(this.controllerGrip0);
		const gripModel1 = factory.createControllerModel(this.controllerGrip1);
		this.controllerGrip0.add(gripModel0);
		this.controllerGrip1.add(gripModel1);
		this.xrGripModels = [gripModel0, gripModel1];
		this.scene.add(this.controllerGrip0);
		this.scene.add(this.controllerGrip1);
		const xrS = this.xrHandScale;
		const gestKeys = ["thumbs", "thumbsDown", "peace", "spock", "heart", "rockOn"];
		this.xrGloveMeshesL = {
			punch: makeModeHand(this.palette, "punch", "L"),
			slap: makeModeHand(this.palette, "slap", "L"),
			poke: makeModeHand(this.palette, "poke", "L"),
		};
		this.xrGloveMeshesR = {
			punch: makeModeHand(this.palette, "punch", "R"),
			slap: makeModeHand(this.palette, "slap", "R"),
			poke: makeModeHand(this.palette, "poke", "R"),
		};
		for (const k of gestKeys) {
			this.xrGloveMeshesL[k] = makeGestureHand(this.palette, k, "L");
			this.xrGloveMeshesR[k] = makeGestureHand(this.palette, k, "R");
		}
		this.xrGloveL = new THREE.Group();
		this.xrGloveR = new THREE.Group();
		for (const [k, m] of Object.entries(this.xrGloveMeshesL)) {
			m.scale.setScalar(xrS);
			this.uniquifyMaterials(m);
			this.solidifyXrHand(m);
			m.visible = false;
			this.xrGloveL.add(m);
		}
		for (const [k, m] of Object.entries(this.xrGloveMeshesR)) {
			m.scale.setScalar(xrS);
			this.uniquifyMaterials(m);
			this.solidifyXrHand(m);
			m.visible = false;
			this.xrGloveR.add(m);
		}
		this.applyXrGloveOrient(this.xrGloveL, "L", "controller");
		this.applyXrGloveOrient(this.xrGloveR, "R", "controller");
		this.xrGloveL.visible = false;
		this.xrGloveR.visible = false;
		this.xrHandAnchors = { L: new THREE.Group(), R: new THREE.Group() };
		this.scene.add(this.xrHandAnchors.L);
		this.scene.add(this.xrHandAnchors.R);
		this.controller0.add(this.xrGloveL);
		this.controller1.add(this.xrGloveR);
		this.controller0.userData.side = "L";
		this.controller1.userData.side = "R";
		this.xrCtrlByHand = { L: this.controller0, R: this.controller1 };
		this.wireXRController(this.controller0, 0);
		this.wireXRController(this.controller1, 1);
		this.syncXrGloves();
		this.applyXrPointerPolicy();
		this.xrHud = new THREE.Group();
		this.xrHudCanvas = document.createElement("canvas");
		this.xrHudCanvas.width = 768;
		this.xrHudCanvas.height = 384;
		this.xrHudTex = new THREE.CanvasTexture(this.xrHudCanvas);
		this.xrHudTex.colorSpace = THREE.SRGBColorSpace;
		this.xrHudMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.72, 0.36),
			new THREE.MeshBasicMaterial({
				map: this.xrHudTex,
				transparent: true,
				depthTest: false,
				toneMapped: false,
			}),
		);
		this.xrHudMesh.renderOrder = 20;
		this.xrHud.add(this.xrHudMesh);
		// Slightly above eye-line so wave-clear panel does not block the path
		this.xrHud.position.set(0, 0.22, -1.2);
		this.xrHud.visible = false;
		this.camera.add(this.xrHud);
		this.xrHudLastKey = "";
		this.paintXrHud(true);
		if (!this.camera.parent) this.scene.add(this.camera);
		// Player rig for XR locomotion
		this.playerRig = new THREE.Group();
		this.playerRig.name = "playerRig";
	}
	solidifyXrHand(root) {
		root.traverse((o) => {
			if (!o.isMesh || !o.material) return;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const mat of mats) {
				mat.transparent = false; mat.opacity = 1; mat.depthWrite = true;
			}
		});
	}
	/**
	 * Controllers: prop −Z matches target-ray −Z (point forward).
	 * Hands: orientation is built from finger joints each frame (see alignXrHandProp).
	 */
	applyXrGloveOrient(glove, side, attach = "controller") {
		if (!glove) return;
		glove.rotation.order = "YXZ";
		if (attach === "hand") {
			// Placeholder — overwritten every frame by alignXrHandProp from bone positions
			glove.quaternion.identity();
			return;
		}
		// Controller / ray: model forward is −Z, ray forward is −Z → identity
		// (previous ±90° yaw made gloves/fish/scissors point sideways)
		glove.quaternion.identity();
		// Tiny drop so the prop sits on the ray instead of through it
		glove.position.set(0, -0.02, -0.05);
	}
	/**
	 * Aim prop −Z along fingers and prop +Y out the back of the hand,
	 * using joint *positions* (more reliable than wrist quaternion conventions).
	 */
	alignXrHandProp(glove, side, frame, refSpace, xrHand) {
		if (!glove || !xrHand || !frame || !refSpace) return;
		const jointPos = (name) => {
			const j = xrHand.get?.(name) || (xrHand.get && xrHand.get(name));
			if (!j) return null;
			const pose = safeGetJointPose(frame, j, refSpace);
			if (!pose) return null;
			const p = pose.transform.position;
			return new THREE.Vector3(p.x, p.y, p.z);
		};
		const wrist = jointPos("wrist");
		const midTip = jointPos("middle-finger-tip") || jointPos("middle-finger-phalanx-distal");
		const midPip = jointPos("middle-finger-phalanx-proximal") || jointPos("middle-finger-metacarpal");
		const indexM = jointPos("index-finger-metacarpal") || jointPos("index-finger-phalanx-proximal") || jointPos("index-finger-tip");
		const pinkyM = jointPos("pinky-finger-metacarpal") || jointPos("pinky-finger-phalanx-proximal") || jointPos("pinky-finger-tip");
		if (!wrist) return;

		// Forward = wrist → fingertips (along the hand)
		const tip = midTip || midPip;
		if (!tip) return;
		const forward = tip.clone().sub(wrist);
		if (forward.lengthSq() < 1e-8) return;
		forward.normalize();

		// Across palm: pinky → index (thumb side). Flip sense per hand if needed after scale.x.
		let across;
		if (indexM && pinkyM) {
			across = indexM.clone().sub(pinkyM);
			if (across.lengthSq() < 1e-8) across = new THREE.Vector3(1, 0, 0);
			else across.normalize();
		} else {
			// Fallback: horizontal perpendicular to fingers
			across = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
			if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
			across.normalize();
		}

		// Back-of-hand normal (out of knuckles side): across × forward
		// Right-hand rule with across = pinky→index gives back-of-hand for a right hand palm-down-ish;
		// re-orthogonalize for stability.
		let up = new THREE.Vector3().crossVectors(across, forward);
		if (up.lengthSq() < 1e-8) {
			up = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward);
			if (up.lengthSq() < 1e-8) up.set(0, 0, 1);
		}
		up.normalize();
		// Recompute across so basis is orthonormal (X = forward × up? see below)
		across.crossVectors(forward, up).normalize();
		up.crossVectors(across, forward).normalize();

		// Prop basis (models: −Z = knuckles/nose/tips, +Y = dorsal / top):
		//   +Z_prop → −forward
		//   +Y_prop → up (back of hand)
		//   +X_prop → Y × Z = up × (−forward) = forward × up = across
		const xAxis = across.clone();
		const yAxis = up.clone();
		const zAxis = forward.clone().negate();
		// Right hand uses scale.x = −1 on the mesh — that mirrors X. Keep basis as-is;
		// negative scale already flips the thumb to the correct side.

		const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
		// Anchor carries world position only; full world rotation on the glove
		glove.quaternion.setFromRotationMatrix(m);
		// Sit slightly toward fingertips so prop covers the palm/fingers
		glove.position.copy(forward.multiplyScalar(0.06));
	}
	wireXRController(controller, index) {
		controller.addEventListener("connected", (ev) => {
			const handed = (ev.data && ev.data.handedness) || "";
			let side = index === 0 ? "L" : "R";
			if (handed === "left") side = "L";
			else if (handed === "right") side = "R";
			controller.userData.side = side;
			this.xrCtrlByHand[side] = controller;
			if (!this.xrUsingHands) {
				const glove = side === "L" ? this.xrGloveL : this.xrGloveR;
				if (glove && glove.parent !== controller) {
					controller.add(glove);
					glove.position.set(0, 0, -0.04);
					this.applyXrGloveOrient(glove, side, "controller");
				}
			}
			this.syncXrGloves();
		});
		const setSel = (v) => () => {
			const side = controller.userData.side === "R" ? "R" : "L";
			if (side === "L") this.xrSelectL = v; else this.xrSelectR = v;
			// Vision Pro: pinch/gaze select must NOT punch — hand tracking motion does
			const tune = this.xrTuning || tuningForVendor(this.xrVendor || this.xrVendorGuess);
			if (tune.ignoreSelectForAttack) return;
			if (v && this.xrActive && this.phase !== "paused") this.tryAttack(side);
		};
		controller.addEventListener("selectstart", setSel(true));
		controller.addEventListener("selectend", setSel(false));
		controller.addEventListener("squeezestart", () => {
			const side = controller.userData.side === "R" ? "R" : "L";
			const order = ["punch", "slap", "poke"];
			const cur = this.getHandMode(side);
			this.applyHandMode(side, order[(order.indexOf(cur) + 1) % 3], true);
			this.syncXrGloves();
			this.audio.whoosh();
		});
	}
	syncXrGloves() {
		if (!this.xrGloveMeshesL || !this.xrGloveMeshesR) return;
		const kL = this.handMeshKey("L");
		const kR = this.handMeshKey("R");
		for (const k of Object.keys(this.xrGloveMeshesL)) {
			const mL = this.xrGloveMeshesL[k];
			if (mL) {
				mL.visible = k === kL;
				mL.traverse((o) => { if (o !== mL) o.visible = mL.visible; });
			}
		}
		for (const k of Object.keys(this.xrGloveMeshesR)) {
			const mR = this.xrGloveMeshesR[k];
			if (mR) {
				mR.visible = k === kR;
				mR.traverse((o) => { if (o !== mR) o.visible = mR.visible; });
			}
		}
		for (const g of this.xrGripModels || []) if (g) g.visible = false;
	}
	toggleHandDebug(force) {
		this.handDebug = force == null ? !this.handDebug : !!force;
		if (this.handDebug) {
			this.ensureDebugArrows();
			this.pushMsg("Hand debug ON · D toggle · [ ] scale", 2.2);
		} else {
			this.clearDebugArrows();
			this.pushMsg("Hand debug OFF", 1.0);
		}
		this.emitHud();
		return this.handDebug;
	}
	ensureDebugArrows() {
		if (this.debugArrowAim) return;
		const mk = (color) => {
			const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 0.55, color, 0.1, 0.06);
			a.visible = false;
			this.scene.add(a);
			return a;
		};
		this.debugArrowAim = mk(0x3dd68c);
		this.debugArrowCtrl = mk(0x3db8e2);
		this.debugArrowCam = mk(0xffd24a);
	}
	clearDebugArrows() {
		for (const a of [this.debugArrowAim, this.debugArrowCtrl, this.debugArrowCam]) if (a) a.visible = false;
	}
	updateDebugArrows(origin, aim, ctrlFwd, camFwd) {
		this.ensureDebugArrows();
		const place = (arrow, dir, len = 0.55) => {
			if (!arrow || !dir || dir.lengthSq() < 1e-8) return;
			arrow.position.copy(origin);
			arrow.setDirection(dir.clone().normalize());
			arrow.setLength(len, 0.1, 0.06);
			arrow.visible = true;
		};
		place(this.debugArrowAim, aim, 0.7);
		place(this.debugArrowCtrl, ctrlFwd, 0.45);
		place(this.debugArrowCam, camFwd, 0.55);
		for (const g of [this.xrGloveL, this.xrGloveR, this.leftGlove, this.rightGlove]) {
			if (!g) continue;
			let ax = g.getObjectByName("handDebugAxes");
			if (!ax) { ax = new THREE.AxesHelper(0.12); ax.name = "handDebugAxes"; g.add(ax); }
			ax.visible = true;
		}
	}
	getHandDebugInfo() {
		const lf = this.debugLastFire;
		const fmt = (v) => (v ? `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}` : "—");
		return {
			enabled: this.handDebug,
			xr: this.xrActive,
			usingHands: this.xrUsingHands,
			scale: this.xrHandScale,
			modeL: this.modeL,
			modeR: this.modeR,
			last: lf ? {
				hand: lf.hand, mode: lf.mode, used: lf.used,
				origin: fmt(lf.origin), forward: fmt(lf.forward),
				ctrlFwd: fmt(lf.ctrlFwd), camFwd: fmt(lf.camFwd),
				pitchDeg: ((lf.pitch * 180) / Math.PI).toFixed(1),
				age: (this.time - lf.t).toFixed(2),
			} : null,
		};
	}
	setXrHandScale(s) {
		this.xrHandScale = THREE.MathUtils.clamp(s, 0.18, 0.9);
		for (const bag of [this.xrGloveMeshesL, this.xrGloveMeshesR]) {
			if (!bag) continue;
			for (const m of Object.values(bag)) m.scale.setScalar(this.xrHandScale);
		}
		this.pushMsg(`XR hand scale ${this.xrHandScale.toFixed(2)}`, 1.0);
		this.emitHud();
	}
	updateXRInput(dt) {
		if (!this.xrActive) return;
		const session = this.renderer.xr.getSession();
		if (!session) return;
		const frame = typeof this.renderer.xr.getFrame === "function" ? this.renderer.xr.getFrame() : null;
		const refSpace = typeof this.renderer.xr.getReferenceSpace === "function" ? this.renderer.xr.getReferenceSpace() : null;
		let sawHand = false;
		let xrHandL = null, xrHandR = null;
		if (frame && refSpace) {
			for (const source of session.inputSources) {
				if (isGazeOrPinchSource(source) && !source.hand) continue; // Vision Pro gaze/pinch ray — ignore
				if (!source.hand) continue;
				const side = source.handedness === "left" ? "L" : source.handedness === "right" ? "R" : null;
				if (!side) continue;
				if (side === "L") xrHandL = source.hand;
				else xrHandR = source.hand;
				const cls = this.classifyXRHandGesture(frame, refSpace, source.hand);
				if (cls?.mode) this.holdXRHandMode(side, cls.mode);
				if (cls?.gesture && !this.heartPoseActive) {
					const social = ["thumbs", "thumbsDown", "peace", "spock", "rockOn", "heart"];
					if (social.includes(cls.gesture)) this.setHandGesture(side, cls.gesture);
					else if (cls.mode) this.setHandGesture(side, null);
				} else if (cls?.mode && !this.heartPoseActive) {
					this.setHandGesture(side, null);
				}
				if (this.detectXRFingerClick(frame, refSpace, source.hand, side)) this.armClickBoost(side);
				const wrist = source.hand.get?.("wrist") || source.hand.get("wrist");
				if (!wrist) continue;
				const pose = safeGetJointPose(frame, wrist, refSpace);
				if (!pose) continue;
				sawHand = true;
				const anchor = this.xrHandAnchors[side];
				const glove = side === "L" ? this.xrGloveL : this.xrGloveR;
				if (anchor && glove) {
					// Position from wrist; orientation from finger bones (not wrist quat alone)
					anchor.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
					anchor.quaternion.identity();
					if (glove.parent !== anchor) anchor.add(glove);
					anchor.visible = true;
					const hidingH = (side === "L" ? this.leftReturnAt : this.rightReturnAt) > 0
						&& this.time < (side === "L" ? this.leftReturnAt : this.rightReturnAt);
					glove.visible = !hidingH;
					this.alignXrHandProp(glove, side, frame, refSpace, source.hand);
				}
				this.trackXRMotion(side, pose.transform.position, pose.transform.orientation, dt);
			}
		}
		const wasHands = this.xrUsingHands;
		// Two-hand heart in XR
		if (frame && refSpace && typeof xrHandL !== "undefined" && xrHandL && xrHandR) {
			if (this.detectTwoHandHeartXR(frame, refSpace, xrHandL, xrHandR)) {
				this.heartDetectHold = (this.heartDetectHold || 0) + dt;
				if (this.heartDetectHold > 0.25) {
					this.spawnHeartShield();
					this.heartDetectHold = -0.8;
				}
			} else if (this.heartDetectHold > 0) {
				this.heartDetectHold = Math.max(0, this.heartDetectHold - dt * 2);
			}
		}
		this.xrUsingHands = sawHand;
		if (wasHands && !sawHand) {
			for (const side of ["L", "R"]) {
				const glove = side === "L" ? this.xrGloveL : this.xrGloveR;
				const ctrl = this.xrCtrlByHand[side] || (side === "L" ? this.controller0 : this.controller1);
				if (glove && ctrl && glove.parent !== ctrl) {
					ctrl.add(glove);
					glove.position.set(0, 0, -0.04);
					glove.rotation.set(0, 0, 0);
				}
				if (this.xrHandAnchors[side]) this.xrHandAnchors[side].visible = false;
			}
		}
		if (!sawHand) {
			for (const side of ["L", "R"]) {
				const ctrl = this.xrCtrlByHand[side] || (side === "L" ? this.controller0 : this.controller1);
				if (!ctrl) continue;
				const wp = new THREE.Vector3();
				ctrl.getWorldPosition(wp);
				const wq = new THREE.Quaternion();
				ctrl.getWorldQuaternion(wq);
				this.trackXRMotion(side, wp, wq, dt);
			}
		}
		this.syncXrGloves();
		// Keep prop hidden while the projectile copy flies into the scene
		if (this.xrGloveL) {
			const hiding = this.leftReturnAt > 0 && this.time < this.leftReturnAt;
			this.xrGloveL.visible = !hiding;
		}
		if (this.xrGloveR) {
			const hiding = this.rightReturnAt > 0 && this.time < this.rightReturnAt;
			this.xrGloveR.visible = !hiding;
		}
		this.applyXrPointerPolicy();
	}
	holdXRHandMode(side, mode) {
		if (!mode) return;
		if (side === "L") {
			if (mode === this.xrHandHoldL) this.xrHandHoldFramesL++;
			else { this.xrHandHoldL = mode; this.xrHandHoldFramesL = 1; }
			if (this.xrHandHoldFramesL >= 5 && this.modeL !== mode) this.applyHandMode("L", mode, true);
		} else {
			if (mode === this.xrHandHoldR) this.xrHandHoldFramesR++;
			else { this.xrHandHoldR = mode; this.xrHandHoldFramesR = 1; }
			if (this.xrHandHoldFramesR >= 5 && this.modeR !== mode) this.applyHandMode("R", mode, true);
		}
	}
	classifyXRHandGesture(frame, refSpace, hand) {
		const joint = (name) => {
			const j = hand.get?.(name) || hand.get(name);
			if (!j) return null;
			const pose = safeGetJointPose(frame, j, refSpace);
			return pose ? pose.transform.position : null;
		};
		const wrist = joint("wrist");
		const indexTip = joint("index-finger-tip");
		const middleTip = joint("middle-finger-tip");
		const ringTip = joint("ring-finger-tip");
		const pinkyTip = joint("pinky-finger-tip");
		const thumbTip = joint("thumb-tip");
		const indexPip = joint("index-finger-phalanx-proximal");
		const middlePip = joint("middle-finger-phalanx-proximal");
		if (!wrist || !indexTip || !middleTip) return null;
		const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const midMet = joint("middle-finger-metacarpal") || middlePip || middleTip;
		const palm = Math.max(0.04, dist(wrist, midMet));
		const ext = (tip, pip) => {
			if (!tip) return false;
			const tipD = dist(wrist, tip);
			const pipD = pip ? dist(wrist, pip) : palm * 0.6;
			return tipD > pipD * 1.18 && tipD > palm * 1.35;
		};
		const indexUp = ext(indexTip, indexPip);
		const middleUp = ext(middleTip, middlePip);
		const ringUp = ext(ringTip, joint("ring-finger-phalanx-proximal"));
		const pinkyUp = ext(pinkyTip, joint("pinky-finger-phalanx-proximal"));
		const n = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;
		const thumbIp = joint("thumb-phalanx-distal") || joint("thumb-phalanx-proximal");
		const thumbMcp = joint("thumb-metacarpal") || joint("thumb-phalanx-proximal");
		const indexMcp = joint("index-finger-metacarpal") || indexPip;
		const thumbOut = (() => {
			if (!thumbTip || !thumbMcp) return false;
			const unfolded = thumbIp ? dist(thumbMcp, thumbTip) > dist(thumbMcp, thumbIp) * 1.4 : dist(wrist, thumbTip) > palm * 1.7;
			if (!unfolded) return false;
			// Tip must sit away from the fist (index/middle knuckles), not wrapped across it
			if (indexPip && dist(thumbTip, indexPip) < palm * 0.85) return false;
			if (middlePip && dist(thumbTip, middlePip) < palm * 0.8) return false;
			if (indexTip && dist(thumbTip, indexTip) < palm * 0.75) return false;
			if (indexMcp && dist(thumbTip, indexMcp) < palm * 0.8) return false;
			return true;
		})();

		// Thumbs up / down: thumb sticking OUT of a closed fist. Tucked thumb = punch.
		if (thumbOut && n === 0) {
			const knuckleY = indexPip ? indexPip.y : wrist.y;
			const up = thumbTip.y > Math.max(wrist.y, knuckleY) + 0.055;
			const down = thumbTip.y < Math.min(wrist.y, knuckleY) - 0.055;
			if (up) return { mode: null, gesture: "thumbs" };
			if (down) return { mode: null, gesture: "thumbsDown" };
			return { mode: "punch", gesture: "punch" };
		}
		// Spock: all four fingers out with gap middle↔ring
		if (indexUp && middleUp && ringUp && pinkyUp) {
			const gap = dist(middleTip, ringTip);
			if (gap > palm * 0.55) return { mode: null, gesture: "spock" };
			return { mode: "slap", gesture: "slap" };
		}
		// Peace / scissors V
		if (indexUp && middleUp && !ringUp && !pinkyUp) {
			return { mode: "poke", gesture: "peace" };
		}
		if (n >= 3) return { mode: "slap", gesture: "slap" };
		if (n <= 1) return { mode: "punch", gesture: "punch" };
		if (indexUp && middleUp) return { mode: "poke", gesture: "peace" };
		return null;
	}
	/** XR finger click: thumb tip meets middle/index tip then releases. */
	detectXRFingerClick(frame, refSpace, hand, side) {
		const joint = (name) => {
			const j = hand.get?.(name) || hand.get(name);
			if (!j) return null;
			const pose = safeGetJointPose(frame, j, refSpace);
			return pose ? pose.transform.position : null;
		};
		const thumb = joint("thumb-tip");
		const middle = joint("middle-finger-tip");
		const index = joint("index-finger-tip");
		const wrist = joint("wrist");
		const midMet = joint("middle-finger-metacarpal") || middle;
		if (!thumb || !middle || !wrist) return false;
		const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const palm = Math.max(0.04, dist(wrist, midMet));
		const d = Math.min(dist(thumb, middle), index ? dist(thumb, index) : 99) / palm;
		const key = side === "L" ? "xrClickStateL" : "xrClickStateR";
		let st = this[key];
		if (!st) {
			st = { wasClosed: false, lastDist: d, cdUntil: 0 };
			this[key] = st;
		}
		const now = this.time;
		if (now < st.cdUntil) { st.lastDist = d; return false; }
		const CLOSED = 0.45;
		const OPEN = 0.85;
		let clicked = false;
		if (!st.wasClosed && d < CLOSED) st.wasClosed = true;
		else if (st.wasClosed && d > OPEN) {
			clicked = true; st.wasClosed = false; st.cdUntil = now + 0.45;
		} else if (st.wasClosed && d > CLOSED * 1.2 && d - st.lastDist > 0.15) {
			clicked = true; st.wasClosed = false; st.cdUntil = now + 0.45;
		}
		if (st.wasClosed && d > OPEN * 1.25) st.wasClosed = false;
		st.lastDist = d;
		return clicked;
	}
	/**
	 * XR motion: forward punch, wrist snap slap, or full-arm sweep slap.
	 * @param pos world position of wrist/controller
	 * @param orient DOMPointReadOnly | THREE.Quaternion | null
	 */
	/** Strength 0.22–1.45 from peak speed + travel distance */
	computeStrikePower(peakSpeed, travel, kind) {
		// Short jab: low speed + low travel → weak/slow. Full extension → strong/fast.
		const speedN = THREE.MathUtils.clamp(peakSpeed / 3.8, 0, 1.2);
		const travelN = THREE.MathUtils.clamp(travel / (kind === "punch" ? 0.45 : 0.55), 0, 1.2);
		const raw = speedN * 0.62 + travelN * 0.38;
		return THREE.MathUtils.clamp(0.22 + raw * 1.05, 0.22, 1.45);
	}
	trackXRMotion(side, pos, orient, dt) {
		if (this.phase === "paused") return;
		const now = this.time;
		const key = side === "L" ? "xrPrevCtrlPosL" : "xrPrevCtrlPosR";
		const tKey = side === "L" ? "xrPrevCtrlTL" : "xrPrevCtrlTR";
		const qKey = side === "L" ? "xrPrevQuatL" : "xrPrevQuatR";
		const swingKey = side === "L" ? "xrSwingL" : "xrSwingR";
		const prev = this[key];
		const prevT = this[tKey] || 0;
		const cur = new THREE.Vector3(pos.x, pos.y, pos.z);
		const curQ = new THREE.Quaternion();
		if (orient) {
			if (orient.isQuaternion) curQ.copy(orient);
			else curQ.set(orient.x, orient.y, orient.z, orient.w);
		}

		if (!prev || !prevT || now - prevT > 0.4) {
			this[key] = cur;
			this[tKey] = now;
			this[qKey] = curQ.clone();
			// Don't hard-reset an active swing on a hitch — only if ancient
			const sw0 = this[swingKey];
			if (sw0 && now - sw0.armedAt > 0.55) this[swingKey] = null;
			return;
		}
		const dtPos = Math.max(0.01, now - prevT);
		const vel = cur.clone().sub(prev).multiplyScalar(1 / dtPos);
		const step = cur.distanceTo(prev);
		this[key] = cur;
		this[tKey] = now;

		const camFwd = new THREE.Vector3();
		this.camera.getWorldDirection(camFwd);
		if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1);
		camFwd.normalize();
		const up = new THREE.Vector3(0, 1, 0);
		const right = new THREE.Vector3().crossVectors(camFwd, up);
		if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
		right.normalize();

		const along = vel.dot(camFwd);
		const lateral = vel.dot(right);
		const speed = vel.length();
		const latSpeed = Math.abs(lateral);

		// Wrist / controller angular velocity
		let angSpeed = 0;
		let rollRate = 0;
		const prevQ = this[qKey];
		if (prevQ && orient) {
			const inv = prevQ.clone().invert();
			const delta = inv.multiply(curQ);
			const w = THREE.MathUtils.clamp(delta.w, -1, 1);
			const ang = 2 * Math.acos(Math.abs(w));
			angSpeed = ang / dtPos;
			const ax = new THREE.Vector3(delta.x, delta.y, delta.z);
			if (ax.lengthSq() > 1e-8) {
				ax.normalize();
				const axisWorld = ax.applyQuaternion(prevQ);
				rollRate = angSpeed * Math.max(
					Math.abs(axisWorld.dot(camFwd)),
					Math.abs(axisWorld.dot(up)) * 0.85,
				);
			}
			this[qKey] = curQ.clone();
		} else if (orient) {
			this[qKey] = curQ.clone();
		}

		const cd = side === "L" ? this.leftCd : this.rightCd;
		let swing = this[swingKey];

		// ---------- Update active swing; fire ONLY when motion stops ----------
		if (swing) {
			// Still collecting peak stats while moving in swing direction
			const primary =
				swing.kind === "punch" ? along :
				swing.kind === "sweep" || swing.kind === "wrist" ? (swing.slapDir >= 0 ? lateral : -lateral) :
				speed;
			const stillGoing =
				swing.kind === "punch" || swing.kind === "grenade"
					? along > 0.2 && speed > 0.35
					: latSpeed > 0.25 || rollRate > 2.5 || angSpeed > 3;

			if (step > 0) {
				swing.travel += step;
				if (speed > swing.peakSpeed) swing.peakSpeed = speed;
				if (Math.abs(along) > Math.abs(swing.peakAlong || 0)) swing.peakAlong = along;
				if (latSpeed > (swing.peakLat || 0)) swing.peakLat = latSpeed;
				if (rollRate > (swing.peakRoll || 0)) swing.peakRoll = rollRate;
			}
			// Prefer punch aim direction at peak
			if (swing.kind === "punch" && along > 0.3) {
				const dir = vel.clone();
				dir.y = THREE.MathUtils.clamp(dir.y, -0.35, 0.45);
				if (dir.lengthSq() > 1e-6) {
					dir.normalize();
					swing.dir = dir;
					if (side === "L") { this.xrLastThrustDirL = dir; this.xrLastThrustTL = now; }
					else { this.xrLastThrustDirR = dir; this.xrLastThrustTR = now; }
				}
			}
			if (swing.kind !== "punch" && latSpeed > 0.2) {
				swing.slapDir = lateral >= 0 ? 1 : -1;
			}

			const age = now - swing.armedAt;
			// RELEASE only after the hand slows / stops — never mid-acceleration
			const decelerated =
				swing.peakSpeed > 0.55 &&
				speed < Math.max(0.32, swing.peakSpeed * 0.42);
			const reversed =
				swing.kind === "punch" || swing.kind === "grenade"
					? along < -0.12 && swing.peakAlong > 0.35
					: (swing.slapDir >= 0 ? lateral : -lateral) < -0.12 && swing.peakLat > 0.35;
			const minSwingDone = swing.travel > 0.035 && age > 0.048;
			// Safety: if swing ran long and has already peaked, force release even if still drifting
			const timeout = age > 0.38 && swing.peakSpeed > 0.55 && speed < swing.peakSpeed * 0.65;

			if (minSwingDone && (decelerated || reversed || timeout) && (decelerated || reversed || !stillGoing || age > 0.45)) {
				// Commit projectile at end of motion
				if (cd <= 0) {
					const power = this.computeStrikePower(
						swing.peakSpeed,
						swing.travel,
						swing.kind === "punch" ? "punch" : "slap",
					);
					// Hand speed m/s → projectile flies at the same speed as the punch
					const handSpeed = swing.peakSpeed;
					if (side === "L") { this.xrStrikePowerL = power; this.xrLastPeakSpeedL = handSpeed; }
					else { this.xrStrikePowerR = power; this.xrLastPeakSpeedR = handSpeed; }

					if (swing.kind === "grenade") {
						this.tryAttack(side, { forceMode: "grenade", strikePower: power, handSpeed, fromMotion: true });
					} else if (swing.kind === "punch") {
						this.tryAttack(side, { strikePower: power, handSpeed, fromMotion: true });
					} else {
						const style = swing.kind === "wrist" ? "wrist" : "sweep";
						if (side === "L") { this.xrLastSlapStyleL = style; this.xrLastSlapTL = now; }
						else { this.xrLastSlapStyleR = style; this.xrLastSlapTR = now; }
						this.tryAttack(side, {
							forceMode: "slap",
							slapStyle: style,
							slapDir: swing.slapDir || 0,
							strikePower: power,
							handSpeed,
							fromMotion: true,
						});
					}
				}
				this[swingKey] = null;
				return;
			}

			// Abort stale swings that never peaked
			if (age > 0.55 && swing.peakSpeed < 0.55) {
				this[swingKey] = null;
			}
			return; // don't start a new swing while one is active
		}

		if (cd > 0) return;

		// ---------- Grenade: closed fist high (ears+) → throw → OPEN HAND at release ----------
		// Sequence: fist @ height → pull back / fling forward → open palm finishes the throw.
		const windKey = side === "L" ? "xrGrenadeWindL" : "xrGrenadeWindR";
		const handMode = this.getHandMode ? this.getHandMode(side) : this.mode;
		const isFist = handMode === "punch";
		const isOpen = handMode === "slap"; // open palm / paper
		const headPos = this.tmpHead || (this.tmpHead = new THREE.Vector3());
		this.camera.getWorldPosition(headPos);
		const earY = headPos.y - 0.08;
		const handAtEars = cur.y >= earY - 0.05;
		const handHigh = cur.y >= earY - 0.12;

		// Cock: fist raised to ear height
		if (isFist && handAtEars) {
			let w = this[windKey];
			if (!w) {
				w = {
					armedAt: now,
					maxBack: 0,
					travelBack: 0,
					peakSpeed: 0,
					peakY: cur.y,
					atEars: true,
					hadFist: true,
					throwing: false,
					travelFwd: 0,
				};
				this[windKey] = w;
			}
			w.hadFist = true;
			w.peakY = Math.max(w.peakY || 0, cur.y);
			w.atEars = true;
			if (along < -0.25 && speed > 0.25) {
				w.travelBack += step;
				w.maxBack = Math.max(w.maxBack, -along);
				w.peakSpeed = Math.max(w.peakSpeed, speed);
			}
		}

		// Throwing phase: still high, moving forward after cock
		if (this[windKey] && this[windKey].hadFist && handHigh && along > 0.2 && speed > 0.45) {
			const w = this[windKey];
			w.throwing = true;
			w.travelFwd = (w.travelFwd || 0) + step;
			w.peakSpeed = Math.max(w.peakSpeed || 0, speed);
			w.peakY = Math.max(w.peakY || 0, cur.y);
			w.lastDir = vel.clone();
		}

		// Release: OPEN hand at end of throw while still elevated / moving out
		const wind = this[windKey];
		const grenadeThrow =
			wind &&
			wind.hadFist &&
			(wind.throwing || wind.travelBack > 0.06) &&
			isOpen &&
			handHigh &&
			(wind.peakY || 0) >= earY - 0.1 &&
			(wind.peakSpeed > 0.55 || speed > 0.6) &&
			(along > 0.15 || (wind.travelFwd || 0) > 0.08);

		if (this[windKey] && !handHigh && !isFist) {
			// Dropped low without open release → cancel
			if (!this[windKey].throwing || now - this[windKey].armedAt > 0.9) this[windKey] = null;
		}
		if (this[windKey] && now - this[windKey].armedAt > 1.4) this[windKey] = null;

		if (grenadeThrow) {
			const dir = (wind.lastDir && wind.lastDir.lengthSq() > 1e-6)
				? wind.lastDir.clone()
				: vel.clone();
			if (dir.lengthSq() > 1e-6) dir.normalize();
			else {
				this.camera.getWorldDirection(dir);
				dir.y += 0.35;
				dir.normalize();
			}
			this[swingKey] = {
				kind: "grenade",
				armedAt: now,
				startPos: cur.clone(),
				peakSpeed: Math.max(speed, wind.peakSpeed || 0),
				peakAlong: along,
				peakLat: latSpeed,
				peakRoll: 0,
				travel: Math.max(step, wind.travelFwd || 0, wind.travelBack || 0),
				dir,
				slapDir: 0,
			};
			this[windKey] = null;
			if (side === "L") { this.xrLastThrustDirL = dir; this.xrLastThrustTL = now; }
			else { this.xrLastThrustDirR = dir; this.xrLastThrustTR = now; }
			return;
		}

		// ---------- Arm new swings (do NOT fire yet) ----------

		// Forward punch arm
		if (along > 0.55 && speed > 0.7 && Math.abs(along) >= latSpeed * 0.7) {
			const dir = vel.clone();
			dir.y = THREE.MathUtils.clamp(dir.y, -0.35, 0.45);
			if (dir.lengthSq() > 1e-6) dir.normalize();
			this[swingKey] = {
				kind: "punch",
				armedAt: now,
				startPos: cur.clone(),
				peakSpeed: speed,
				peakAlong: along,
				peakLat: latSpeed,
				peakRoll: 0,
				travel: step,
				dir,
				slapDir: 0,
			};
			if (side === "L") { this.xrLastThrustDirL = dir; this.xrLastThrustTL = now; }
			else { this.xrLastThrustDirR = dir; this.xrLastThrustTR = now; }
			return;
		}

		// Lateral sweep arm
		if (latSpeed > 1.0 && speed > 0.9 && latSpeed > Math.abs(along) * 0.8) {
			this[swingKey] = {
				kind: "sweep",
				armedAt: now,
				startPos: cur.clone(),
				peakSpeed: speed,
				peakAlong: along,
				peakLat: latSpeed,
				peakRoll: rollRate,
				travel: step,
				dir: null,
				slapDir: lateral >= 0 ? 1 : -1,
			};
			return;
		}

		// Wrist flick arm
		if (
			(rollRate > 4.2 && latSpeed > 0.2) ||
			(angSpeed > 5.2 && latSpeed > 0.3 && speed < 2.5)
		) {
			this[swingKey] = {
				kind: "wrist",
				armedAt: now,
				startPos: cur.clone(),
				peakSpeed: Math.max(speed, rollRate * 0.15),
				peakAlong: along,
				peakLat: latSpeed,
				peakRoll: rollRate,
				travel: step,
				dir: null,
				slapDir: lateral >= 0 ? 1 : -1,
			};
		}
	}
	// Back-compat alias
	trackXRThrust(side, pos, dt) {
		this.trackXRMotion(side, pos, null, dt);
	}

	cycleMode() {
		const order = [
			"punch",
			"slap",
			"poke"
		];
		this.setMode(order[(order.indexOf(this.mode) + 1) % 3]);
		this.audio.whoosh();
	}
	buildPost() {
		const w = this.canvas.clientWidth || 1;
		const h = this.canvas.clientHeight || 1;
		this.composer = new EffectComposer(this.renderer);
		this.composer.addPass(new RenderPass(this.scene, this.camera));
		this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), this.isMobile ? .42 : .68, .45, .78);
		this.composer.addPass(this.bloomPass);
		this.juicePass = new ShaderPass(JuiceShader);
		this.composer.addPass(this.juicePass);
		this.fxaaPass = new ShaderPass(FXAAShader);
		this.fxaaPass.material.uniforms["resolution"].value.set(1 / w, 1 / h);
		this.composer.addPass(this.fxaaPass);
		this.composer.addPass(new OutputPass());
	}
	buildWorld() {
		this.scene.add(makeSkyDome());
		this.scene.add(new THREE.HemisphereLight(16771280, 4863272, .85));
		this.sun = new THREE.DirectionalLight(16769208, 1.45);
		this.sun.position.set(12, 20, 6);
		this.sun.castShadow = true;
		const mapSize = this.isMobile ? 1024 : 2048;
		this.sun.shadow.mapSize.set(mapSize, mapSize);
		this.sun.shadow.camera.near = 1;
		this.sun.shadow.camera.far = 55;
		this.sun.shadow.camera.left = -22;
		this.sun.shadow.camera.right = 22;
		this.sun.shadow.camera.top = 22;
		this.sun.shadow.camera.bottom = -22;
		this.sun.shadow.bias = -25e-5;
		this.scene.add(this.sun);
		const fill = new THREE.DirectionalLight(8956671, .32);
		fill.position.set(-10, 8, -6);
		this.scene.add(fill);
		const rim = new THREE.DirectionalLight(16737962, .22);
		rim.position.set(0, 4, 12);
		this.scene.add(rim);
		this.scene.add(this.arenaRoot);
		const ground = new THREE.Mesh(new THREE.PlaneGeometry(52, 100), this.palette.grass);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		this.arenaRoot.add(ground);
		const path = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 80), new THREE.MeshStandardMaterial({
			color: 13938816,
			emissive: 16755268,
			emissiveIntensity: .15,
			roughness: .9
		}));
		path.rotation.x = -Math.PI / 2;
		path.position.set(0, .015, -20);
		path.receiveShadow = true;
		this.arenaRoot.add(path);
		for (let i = 0; i < 8; i++) {
			const platform = new THREE.Group();
			const w = 6.4 + i * .3;
			const base = new THREE.Mesh(new THREE.BoxGeometry(w, .2, 4.4), this.palette.wood);
			base.receiveShadow = true;
			base.castShadow = true;
			platform.add(base);
			for (let p = 0; p < 5; p++) {
				const plank = new THREE.Mesh(new THREE.BoxGeometry(w - .2, .045, .72), p % 2 === 0 ? this.palette.woodBright : this.palette.woodDark);
				plank.position.set(0, .12, -1.55 + p * .78);
				plank.receiveShadow = true;
				platform.add(plank);
			}
			const neonMat = i % 2 === 0 ? this.palette.neonCyan : this.palette.neonPink;
			for (const sx of [-1, 1]) {
				const edge = new THREE.Mesh(new THREE.BoxGeometry(.06, .05, 4.2), neonMat);
				edge.position.set(sx * (w * .5 - .08), .14, 0);
				platform.add(edge);
				const post = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, .85, 10), this.palette.woodDark);
				post.position.set(sx * (w * .5 - .2), .45, 1.7);
				post.castShadow = true;
				platform.add(post);
				const post2 = post.clone();
				post2.position.z = -1.7;
				platform.add(post2);
				const rail = new THREE.Mesh(new THREE.BoxGeometry(.1, .08, 3.5), this.palette.rope);
				rail.position.set(sx * (w * .5 - .2), .78, 0);
				rail.castShadow = true;
				platform.add(rail);
				const orb = new THREE.Mesh(new THREE.SphereGeometry(.08, 12, 10), neonMat);
				orb.position.set(sx * (w * .5 - .2), .95, 1.7);
				platform.add(orb);
			}
			platform.position.set(0, .02, -3.2 - i * 5);
			this.arenaRoot.add(platform);
			if (i % 2 === 0) {
				const L = makeLantern(this.palette, i % 4 === 0 ? "gold" : "cyan");
				L.position.set(-3.8 - i * .1, 0, -3.2 - i * 5);
				this.arenaRoot.add(L);
				const R = makeLantern(this.palette, i % 4 === 0 ? "pink" : "gold");
				R.position.set(3.8 + i * .1, 0, -3.2 - i * 5);
				this.arenaRoot.add(R);
				const light = new THREE.PointLight(i % 4 === 0 ? 16764006 : 6741503, this.isMobile ? .6 : 1, 10, 2);
				light.position.set(0, 1.5, -3.2 - i * 5);
				this.arenaRoot.add(light);
			}
		}
		for (let i = 0; i < 6; i++) {
			const side = i % 2 === 0 ? -1 : 1;
			const banner = makeBanner(this.palette, i % 3 === 0 ? 14826813 : i % 3 === 1 ? 4045026 : 14856253);
			banner.position.set(side * 6.2, 0, -6 - i * 5.5);
			banner.rotation.y = side * .35;
			this.arenaRoot.add(banner);
		}
		for (let i = 0; i < 24; i++) {
			const side = i % 2 === 0 ? -1 : 1;
			const tree = new THREE.Group();
			const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.14, .24, 1.55, 10), this.palette.trunk);
			trunk.position.y = .78;
			trunk.castShadow = true;
			tree.add(trunk);
			for (let L = 0; L < 3; L++) {
				const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(.58 + L * .14, 1), L === 2 ? this.palette.leafDark : this.palette.leaf);
				leaves.position.y = 1.6 + L * .38;
				leaves.position.x = (L - 1) * .12;
				leaves.castShadow = true;
				tree.add(leaves);
			}
			tree.position.set(side * (6 + Math.random() * 3.8), 0, -1 - i * 2.6 + (Math.random() - .5));
			tree.rotation.y = Math.random() * Math.PI;
			tree.scale.setScalar(.9 + Math.random() * .35);
			this.arenaRoot.add(tree);
		}
		for (let i = 0; i < 12; i++) {
			const hill = new THREE.Mesh(new THREE.SphereGeometry(4.8 + Math.random() * 3.2, 16, 12), this.palette.hill);
			hill.position.set((i - 5.5) * 6.2, -1.9, -50 - Math.random() * 12);
			hill.scale.y = .4;
			this.arenaRoot.add(hill);
		}
		for (let i = 0; i < 14; i++) {
			const cloud = new THREE.Group();
			for (let c = 0; c < 4; c++) {
				const p = new THREE.Mesh(new THREE.SphereGeometry(1.15 + Math.random() * .55, 12, 10), this.palette.cloud);
				p.position.set(c * .95 - 1.2, Math.random() * .35, (Math.random() - .5) * .7);
				p.scale.set(1.7, .55, 1.05);
				cloud.add(p);
			}
			cloud.position.set((Math.random() - .5) * 55, 11 + Math.random() * 6, -6 - Math.random() * 48);
			this.arenaRoot.add(cloud);
		}
		for (let i = 0; i < 8; i++) {
			const orb = new THREE.Mesh(new THREE.SphereGeometry(.12, 12, 10), i % 2 === 0 ? this.palette.neonGold : this.palette.neonCyan);
			orb.position.set((Math.random() - .5) * 5, 1.2 + Math.random() * 2, -2 - Math.random() * 8);
			orb.userData.bob = Math.random() * Math.PI * 2;
			orb.name = "ambientOrb";
			this.arenaRoot.add(orb);
		}
		this.spawnFunBoxStacks();
		this.punchLight = new THREE.PointLight(16746564, 0, 6, 2);
		this.camera.add(this.punchLight);
		const handKey = new THREE.DirectionalLight(16773344, 1.05);
		handKey.position.set(.35, .7, .55);
		this.overlayScene.add(handKey);
		this.overlayScene.add(new THREE.AmbientLight(16777215, .5));
		const handFill = new THREE.PointLight(16765088, .85, 4);
		handFill.position.set(0, .1, -.15);
		this.overlayScene.add(handFill);
		const handRim = new THREE.PointLight(6737151, .4, 3);
		handRim.position.set(-.4, .2, .2);
		this.overlayScene.add(handRim);
	}
	buildDust() {
		const n = this.isMobile ? 70 : 140;
		const pos = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			pos[i * 3] = (Math.random() - .5) * 22;
			pos[i * 3 + 1] = Math.random() * 7 + .3;
			pos[i * 3 + 2] = -Math.random() * 42;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
			color: 16773328,
			size: .07,
			transparent: true,
			opacity: .5,
			depthWrite: false,
			sizeAttenuation: true,
			blending: THREE.AdditiveBlending
		}));
		this.scene.add(this.dust);
		const mn = this.isMobile ? 36 : 72;
		const mpos = new Float32Array(mn * 3);
		for (let i = 0; i < mn; i++) {
			mpos[i * 3] = (Math.random() - .5) * 8;
			mpos[i * 3 + 1] = Math.random() * 3;
			mpos[i * 3 + 2] = (Math.random() - .5) * 8;
		}
		const mgeo = new THREE.BufferGeometry();
		mgeo.setAttribute("position", new THREE.BufferAttribute(mpos, 3));
		this.ambientMotes = new THREE.Points(mgeo, new THREE.PointsMaterial({
			color: 16771232,
			size: .05,
			transparent: true,
			opacity: .4,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		}));
		this.scene.add(this.ambientMotes);
	}
	buildHands() {
		// Combat RPS + social gesture props
		const gestKeys = ["thumbs", "thumbsDown", "peace", "spock", "heart", "rockOn"];
		this.leftMeshes = {
			punch: makeModeHand(this.palette, "punch", "L"),
			slap: makeModeHand(this.palette, "slap", "L"),
			poke: makeModeHand(this.palette, "poke", "L"),
		};
		this.rightMeshes = {
			punch: makeModeHand(this.palette, "punch", "R"),
			slap: makeModeHand(this.palette, "slap", "R"),
			poke: makeModeHand(this.palette, "poke", "R"),
		};
		for (const k of gestKeys) {
			this.leftMeshes[k] = makeGestureHand(this.palette, k, "L");
			this.rightMeshes[k] = makeGestureHand(this.palette, k, "R");
		}
		for (const mesh of [...Object.values(this.leftMeshes), ...Object.values(this.rightMeshes)]) {
			this.uniquifyMaterials(mesh);
			this.styleViewmodelHand(mesh);
		}
		this.leftGlove = new THREE.Group();
		this.rightGlove = new THREE.Group();
		for (const m of Object.values(this.leftMeshes)) this.leftGlove.add(m);
		for (const m of Object.values(this.rightMeshes)) this.rightGlove.add(m);
		// Connecting beam for two-hand heart
		this.heartConnectMesh = new THREE.Mesh(
			new THREE.CylinderGeometry(0.012, 0.012, 1, 8),
			new THREE.MeshBasicMaterial({
				color: 0xff4d8d,
				transparent: true,
				opacity: 0.55,
				depthWrite: false,
			}),
		);
		this.heartConnectMesh.visible = false;
		this.overlayScene.add(this.heartConnectMesh);
		this.overlayScene.add(this.leftGlove);
		this.overlayScene.add(this.rightGlove);
		this.leftPos.copy(this.leftRest);
		this.rightPos.copy(this.rightRest);
		this.updateHandMeshes();
	}
	/** Which mesh key to show for a hand (gesture props override combat). */
	handMeshKey(side) {
		if (this.heartPoseActive) return "heart";
		const g = side === "L" ? this.handGestureL : this.handGestureR;
		if (g && g !== "none" && g !== "punch" && g !== "slap" && g !== "poke") return g;
		return side === "L" ? this.modeL : this.modeR;
	}
	updateHandMeshes() {
		if (!this.leftMeshes || !this.rightMeshes) return;
		const kL = this.handMeshKey("L");
		const kR = this.handMeshKey("R");
		for (const k of Object.keys(this.leftMeshes)) {
			this.leftMeshes[k].visible = k === kL;
		}
		for (const k of Object.keys(this.rightMeshes)) {
			this.rightMeshes[k].visible = k === kR;
		}
	}
	setHandGesture(side, gesture) {
		const next = gesture && gesture !== "none" ? gesture : null;
		// Don't override combat rock/paper with null unless clearing social
		if (side === "L") {
			if (this.handGestureL === next) return;
			this.handGestureL = next;
		} else {
			if (this.handGestureR === next) return;
			this.handGestureR = next;
		}
		this.updateHandMeshes();
		this.syncXrGloves();
	}
	bindInput() {
		window.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("keyup", this.onKeyUp);
		window.addEventListener("mousemove", this.onMouseMove);
		this.canvas.addEventListener("mousedown", this.onMouseDown);
		this.canvas.addEventListener("contextmenu", this.onContext);
		document.addEventListener("pointerlockchange", this.onLockChange);
		window.addEventListener("resize", this.onResize);
		window.addEventListener("blur", this.onBlur);
		document.addEventListener("visibilitychange", this.onVis);
		this.canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
		this.canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
		this.canvas.addEventListener("touchend", this.onTouchEnd, { passive: true });
		this.canvas.addEventListener("touchcancel", this.onTouchEnd, { passive: true });
	}
	unbindInput() {
		window.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("keyup", this.onKeyUp);
		window.removeEventListener("mousemove", this.onMouseMove);
		this.canvas.removeEventListener("mousedown", this.onMouseDown);
		this.canvas.removeEventListener("contextmenu", this.onContext);
		document.removeEventListener("pointerlockchange", this.onLockChange);
		window.removeEventListener("resize", this.onResize);
		window.removeEventListener("blur", this.onBlur);
		document.removeEventListener("visibilitychange", this.onVis);
		this.canvas.removeEventListener("touchstart", this.onTouchStart);
		this.canvas.removeEventListener("touchmove", this.onTouchMove);
		this.canvas.removeEventListener("touchend", this.onTouchEnd);
		this.canvas.removeEventListener("touchcancel", this.onTouchEnd);
		if (document.pointerLockElement === this.canvas) document.exitPointerLock();
	}
	onTouchStart = (e) => {
		if (this.phase !== "playing") return;
		for (const t of Array.from(e.changedTouches)) if (t.clientX > window.innerWidth * .38 && this.touchLookId === null) {
			this.touchLookId = t.identifier;
			this.touchLookLastX = t.clientX;
			this.touchLookLastY = t.clientY;
			e.preventDefault();
		}
	};
	onTouchMove = (e) => {
		if (this.touchLookId === null) return;
		for (const t of Array.from(e.changedTouches)) {
			if (t.identifier !== this.touchLookId) continue;
			const dx = t.clientX - this.touchLookLastX;
			const dy = t.clientY - this.touchLookLastY;
			this.touchLookLastX = t.clientX;
			this.touchLookLastY = t.clientY;
			this.lookX += dx * .0048;
			this.lookY += dy * .0048;
			e.preventDefault();
		}
	};
	onTouchEnd = (e) => {
		for (const t of Array.from(e.changedTouches)) if (t.identifier === this.touchLookId) this.touchLookId = null;
	};
	handleKey(e, down) {
		const k = e.code;
		if (down) this.keys.add(k);
		else this.keys.delete(k);
		if (!down) {
			if (k === "Space") this.charging = false;
			return;
		}
		if (k === "KeyD") { this.toggleHandDebug(); return; }
		if (k === "BracketLeft") { this.setXrHandScale(this.xrHandScale - 0.04); return; }
		if (k === "BracketRight") { this.setXrHandScale(this.xrHandScale + 0.04); return; }
		if (k === "Escape") {
			if (this.phase === "playing") this.setPhase("paused");
			else if (this.phase === "paused") this.resume();
			return;
		}
		if (this.phase !== "playing" && this.phase !== "paused") return;
		if (k === "Digit1" || k === "Numpad1" || k === "KeyQ") this.setMode("punch");
		if (k === "Digit2" || k === "Numpad2" || k === "KeyE") this.setMode("slap");
		if (k === "Digit3" || k === "Numpad3" || k === "KeyR") this.setMode("poke");
		if (this.phase !== "playing") return;
		if (k === "KeyT") this.doGesture("taunt");
		if (k === "KeyG") this.doGesture("thumbs");
		if (k === "KeyB") {
			// Desktop grenade lob (B = bomb)
			this.tryAttack("R", { forceMode: "grenade", strikePower: 1.05, handSpeed: 12, fromMotion: true });
		}
		if (k === "KeyV") this.doGesture("peace");
		if (k === "KeyH") this.doGesture("heart");
		if (k === "KeyY") this.doGesture("rockOn");
		if (k === "KeyF") this.doGesture("wave");
		if (k === "Space") {
			e.preventDefault();
			this.charging = true;
		}
	}
	handleMouseMove(e) {
		if (!this.locked || this.phase !== "playing" || this.xrActive) return;
		this.lookX += e.movementX * this.lookSens;
		this.lookY += e.movementY * this.lookSens;
	}
	handleMouseDown(e) {
		if (this.phase === "paused") {
			this.resume();
			return;
		}
		// Menu / wave clear / etc: still allow punches for practice
		if (!this.locked && !this.isMobile && !this.xrActive && this.phase === "playing") this.requestLock();
		if (e.button === 0) this.tryAttack("L");
		if (e.button === 2) this.tryAttack("R");
		if (e.button === 1) {
			e.preventDefault();
			this.cycleMode();
		}
	}
	handleLockChange() {
		this.locked = document.pointerLockElement === this.canvas;
		this.emitHud();
	}
	requestLock() {
		if (this.isMobile || this.xrActive) return;
		const el = this.canvas;
		try {
			const p = el.requestPointerLock({ unadjustedMovement: true });
			if (p && typeof p.catch === "function") p.catch(() => {
				try {
					el.requestPointerLock();
				} catch {}
			});
		} catch {
			try {
				el.requestPointerLock();
			} catch {}
		}
	}
	pollGamepad(dt) {
		if (this.xrActive || typeof navigator.getGamepads !== "function") {
			this._gpMx = 0;
			this._gpMz = 0;
			return;
		}
		const pads = navigator.getGamepads();
		let pad = null;
		for (let i = 0; i < pads.length; i++) if (pads[i]) {
			pad = pads[i];
			break;
		}
		if (!pad) {
			this._gpMx = 0;
			this._gpMz = 0;
			return;
		}
		const ls = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
		const rs = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, .14);
		this.gamepadLookX = rs.x * 2.8 * dt;
		this.gamepadLookY = rs.y * 2.2 * dt;
		this._gpMx = ls.x;
		this._gpMz = -ls.y;
		const pressed = (i) => !!pad.buttons[i]?.pressed;
		const just = (i) => pressed(i) && !this.prevPadButtons.has(i);
		if (this.phase === "playing") {
			if (just(0) || just(7)) this.tryAttack("R");
			if (just(2) || just(6)) this.tryAttack("L");
			if (just(3)) this.cycleMode();
			if (just(1)) this.doGesture("taunt");
			if (pressed(4) || pressed(5)) this.charging = true;
			else if (!this.keys.has("Space")) this.charging = false;
		}
		if (just(9)) {
			if (this.phase === "playing") this.pause();
			else if (this.phase === "paused") this.resume();
			else if (this.phase === "victory" || this.phase === "waveClear") this.continueFromWaveClear();
			else if (this.phase === "menu" || this.phase === "gameover") this.startGame();
		}
		if (just(12)) this.setMode("punch");
		if (just(13)) this.setMode("poke");
		if (just(14) || just(15)) this.setMode("slap");
		this.prevPadButtons.clear();
		for (let i = 0; i < pad.buttons.length; i++) if (pad.buttons[i]?.pressed) this.prevPadButtons.add(i);
	}
	_gpMx = 0;
	_gpMz = 0;
	resize() {
		const w = this.canvas.clientWidth || window.innerWidth;
		const h = this.canvas.clientHeight || window.innerHeight;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.overlayCam.aspect = w / h;
		this.overlayCam.updateProjectionMatrix();
		this.composer?.setSize(w, h);
		this.bloomPass?.resolution.set(w, h);
		this.fxaaPass?.material.uniforms["resolution"].value.set(1 / w, 1 / h);
		this.isMobile = detectMobile();
		if (!this.xrActive) this.platform = this.isMobile ? "mobile" : "desktop";
	}
	resetRun() {
		for (const e of this.entities) {
			this.destroyEntityBody(e);
			this.scene.remove(e.mesh);
			if (e.ring) this.scene.remove(e.ring);
			if (e.trail) {
				if (e.trail.points) this.disposeLaceTrail(e.trail);
				else this.scene.remove(e.trail);
			}
		}
		this.entities = [];
		for (const p of this.particles) this.scene.remove(p.mesh);
		this.particles = [];
		for (const r of this.rings) this.scene.remove(r.mesh);
		this.rings = [];
		this.health = this.maxHealth;
		this.score = 0;
		this.combo = 0;
		this.comboTimer = 0;
		this.wave = 0;
		this.power = 0;
		this.yaw = 0;
		this.pitch = 0;
		this.railZ = 0;
		this.spawnQueue = [];
		this.waveEnemies = 0;
		this.waveKills = 0;
		this.nextHazard = 1.6;
		this.leftPunchT = 0;
		this.rightPunchT = 0;
		this.leftCd = 0;
		this.rightCd = 0;
		this.leftReturnAt = 0;
		this.rightReturnAt = 0;
		this.heartShieldUntil = 0;
		this.heartShieldCdUntil = 0;
		this.heartShieldEntity = null;
		this.heartDetectHold = 0;
		this.clickBoostL = false;
		this.clickBoostR = false;
		this.clickGlowL = 0;
		this.clickGlowR = 0;
		this.xrClickStateL = null;
		this.xrClickStateR = null;
		this.xrGrenadeWindL = null;
		this.xrGrenadeWindR = null;
		this.xrSwingL = null;
		this.xrSwingR = null;
		this.gesturePose = "none";
		this.gestureT = 0;
		this.trauma = 0;
		this.hitstop = 0;
		this.camKick = 0;
		this.timeScale = 1;
		this.mode = "punch";
		if (!this.xrActive) {
			this.leftGlove.visible = true;
			this.rightGlove.visible = true;
		}
		this.updateHandMeshes();
		this.syncXrGloves();
		this.camera.position.set(0, 1.55, 0);
		this.spawnFunBoxStacks();
	}
	paintXrHud(force = false) {
		if (!this.xrHudCanvas || !this.xrHudTex) return;
		const phase = this.phase;
		const canCont = (phase === "waveClear" || phase === "victory") && this.time >= (this.waveClearReadyAt || 0);
		const msg = this.message || "";
		const key = phase + "|" + this.wave + "|" + canCont + "|" + msg + "|" + Math.floor(this.score) + "|" + this.xrActive + "|" + (this.messageT > 0);
		if (!force && key === this.xrHudLastKey) return;
		this.xrHudLastKey = key;
		const c = this.xrHudCanvas;
		const ctx = c.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, c.width, c.height);

		const showPanel =
			phase === "waveClear" ||
			phase === "paused" ||
			phase === "gameover" ||
			phase === "victory" ||
			phase === "readying" ||
			(!!msg && this.messageT > 0);
		if (this.xrHud) this.xrHud.visible = !!(this.xrActive && showPanel);
		if (!showPanel) {
			this.xrHudTex.needsUpdate = true;
			return;
		}

		const r = 36;
		ctx.fillStyle = "rgba(12, 10, 18, 0.86)";
		ctx.strokeStyle = "rgba(255, 210, 80, 0.6)";
		ctx.lineWidth = 6;
		ctx.beginPath();
		if (typeof ctx.roundRect === "function") ctx.roundRect(24, 24, c.width - 48, c.height - 48, r);
		else ctx.rect(24, 24, c.width - 48, c.height - 48);
		ctx.fill();
		ctx.stroke();

		let title = "";
		let sub = "";
		let foot = "";
		if (phase === "waveClear") {
			title = "WAVE " + this.wave + " CLEAR!";
			sub = canCont ? "Punch or slap to continue" : "Get ready…";
			foot = "Score " + Math.floor(this.score).toLocaleString();
		} else if (phase === "paused") {
			title = "PAUSED";
			sub = "Trigger to resume";
			foot = "Score " + Math.floor(this.score).toLocaleString();
		} else if (phase === "victory") {
			title = "CHAMPION!";
			sub = canCont ? "Punch for a harder level" : "Get ready…";
			foot = "Wave " + this.wave + " · Score " + Math.floor(this.score).toLocaleString();
		} else if (phase === "gameover") {
			// Unused in endless prototype — kept as fallback
			title = "STILL STANDING";
			sub = "Punch to keep going";
			foot = "Score " + Math.floor(this.score).toLocaleString();
		} else if (phase === "readying") {
			title = "GET READY";
			sub = "Show your hands";
			foot = msg || "";
		} else {
			title = msg;
		}

		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#ffe08a";
		ctx.font = "bold 64px system-ui, Segoe UI, sans-serif";
		ctx.fillText(title, c.width / 2, c.height * 0.38, c.width - 80);
		if (sub) {
			ctx.fillStyle = "#f2efe8";
			ctx.font = "32px system-ui, Segoe UI, sans-serif";
			ctx.fillText(sub, c.width / 2, c.height * 0.58, c.width - 80);
		}
		if (foot) {
			ctx.fillStyle = "rgba(242,239,232,0.78)";
			ctx.font = "28px system-ui, Segoe UI, sans-serif";
			ctx.fillText(foot, c.width / 2, c.height * 0.74, c.width - 80);
		}
		this.xrHudTex.needsUpdate = true;
	}
	setPhase(p) {
		this.phase = p;
		this.paintXrHud(true);
		this.emitHud();
	}
	pushMsg(m, t = 1.6) {
		this.message = m;
		this.messageT = t;
		this.paintXrHud(true);
		this.emitHud();
	}
	emitHud() {
		this.callbacks.onHud({
			phase: this.phase,
			health: this.health,
			maxHealth: this.maxHealth,
			score: this.score,
			combo: this.combo,
			wave: this.wave,
			maxWaves: MAX_WAVES,
			mode: this.mode,
			modeL: this.modeL,
			modeR: this.modeR,
			power: typeof this.power === "number" && !Number.isNaN(this.power) ? this.power : 0,
			enemiesLeft: Math.max(0, this.waveEnemies - this.waveKills + this.spawnQueue.length),
			message: this.message,
			highScore: this.highScore,
			locked: this.locked,
			isMobile: this.isMobile,
			xrSupported: this.xrSupported,
			xrActive: this.xrActive,
			xrEntering: !!this.xrEntering,
			xrHeadset: this.xrHeadset || this.xrActive || this.platform === "xr",
			xrEmbedded: this.isEmbeddedFrame(),
			xrModeVr: !!this.xrModeVr,
			xrModeAr: !!this.xrModeAr,
			xrPreferredMode: this.xrPreferredMode,
			xrSessionMode: this.xrSessionMode,
			xrBlockReason: this.xrBlockReason,
			xrLastError: this.xrLastError || "",
			xrDeviceName: this.xrDeviceName || "",
			xrVendor: this.xrVendor || this.xrVendorGuess || null,
			xrForce: !!this.xrForce,
			xrHandsOn: true,
			xrRaysOff: !!(this.xrTuning?.hidePointerRays || this.xrVendor === "vision-pro" || this.xrVendorGuess === "vision-pro"),
			platform: this.platform,
			fps: this.fps,
			cameraHands: this.cameraHands,
			cameraLoading: this.cameraLoading,
			cameraError: this.cameraError,
			cameraGesture: this.cameraGesture,
			cameraHandsCount: this.cameraHandsCount,
			trackProgress: this.trackProgress,
			trackReady: this.trackReady,
			waveClearCanContinue: (this.phase === "waveClear" || this.phase === "victory") && this.time >= (this.waveClearReadyAt || 0),
			countdown: this.countdownT != null && this.countdownT > 0 ? Math.max(1, Math.ceil(this.countdownT)) : null,
			handDebug: this.handDebug,
			handDebugInfo: this.handDebug ? this.getHandDebugInfo() : null,
			xrHandScale: this.xrHandScale,
		});
	}
	beginWave(n) {
		this.wave = n;
		this.waveKills = 0;
		this.spawnQueue = [];
		// Endless ramp: starts gentle, keeps getting denser (cap per-wave count only)
		const count = n <= 1 ? 1 : n === 2 ? 2 : Math.min(12, 1 + Math.ceil(n * 0.7));
		this.waveEnemies = count;
		// Difficulty tier for messaging (loop 1 = waves 1–8, loop 2 = 9–16, …)
		const loop = Math.max(1, Math.ceil(n / LOOP_LEN));
		for (let i = 0; i < count; i++) {
			let type = "brawler";
			if (n >= 4 && i % 3 === 1) type = "rusher";
			if (n >= 5 && i % 4 === 2) type = "thrower";
			if (n >= 7 && i % 5 === 0) type = "thrower";
			// Later loops: more rushers/throwers
			if (loop >= 2 && i % 2 === 0) type = i % 3 === 0 ? "thrower" : "rusher";
			if (loop >= 3 && i % 4 === 1) type = "thrower";
			const gap = n <= 2 ? 2.4 : Math.max(0.85, 2.1 - n * 0.07 - (loop - 1) * 0.12);
			this.spawnQueue.push({
				t: 0.9 + i * gap,
				type
			});
		}
		const label = loop > 1 ? `Wave ${n} · Harder ${loop}` : `Wave ${n}`;
		this.pushMsg(label, 1.8);
		this.trauma = Math.min(1, this.trauma + .22);
		this.camKick = Math.min(1, this.camKick + .35);
		this.emitHud();
	}
	getPlayerPos() {
		if (this.xrActive) {
			this.camera.getWorldPosition(this.dummyCam);
			return this.dummyCam;
		}
		return this.camera.position;
	}

	/** Physics: Box3D Wasm via box3d.js (https://github.com/isaac-mason/box3d.js) */
	/** Spawn one pyramid: bottom row = `base` crates, top row = 1. */
	spawnPyramidStack(cx, cz, base = 5, size = 0.32) {
		const tints = [0xb88852, 0xc49a62, 0xa67c4a, 0x8b6a3e, 0xd4a86a, 0x9a7348];
		const gap = 0.02;
		const pitch = size + gap;
		// levels: base (bottom) … 1 (top)
		for (let level = 0; level < base; level++) {
			const count = base - level; // bottom widest, top = 1
			const y = size * 0.5 + level * pitch;
			for (let i = 0; i < count; i++) {
				const x = cx + (i - (count - 1) * 0.5) * pitch;
				// slight row stagger for pyramid depth look
				const z = cz + (level % 2 === 0 ? 0 : pitch * 0.08);
				const tint = tints[(level + i + Math.floor(Math.abs(cx))) % tints.length];
				const mesh = makeCrate(this.palette, { size, tint });
				mesh.position.set(x, y, z);
				mesh.rotation.y = (Math.random() - 0.5) * 0.06;
				this.scene.add(mesh);
				// Box3D dynamic rigid body (half-extents = size/2)
				const half = size * 0.5;
				const body = sharedPhysics.ready
					? sharedPhysics.createBox(x, y, z, half, { dynamic: true, density: 450, friction: 0.8, restitution: 0.18 })
					: null;
				this.entities.push({
					id: this.idSeq++,
					kind: "funBox",
					mesh,
					alive: true,
					hp: 1,
					maxHp: 1,
					radius: size * 0.55,
					vel: new THREE.Vector3(),
					angVel: new THREE.Vector3(),
					age: 0,
					life: 9999,
					damage: 0,
					enemyType: "brawler",
					attackCd: 0,
					flash: 0,
					value: 2,
					hand: null,
					powered: false,
					squash: 1,
					boxSize: size,
					settled: true,
					homeY: y,
					body, // Box3D body id
				});
			}
		}
	}
	/** Decorative knockable pyramid crates — playground behind + flanks. */
	spawnFunBoxStacks() {
		// Need Box3D world ready — called again after init
		if (!sharedPhysics.ready) return;
		for (const e of this.entities) {
			if (e.kind === "funBox") {
				if (e.body) sharedPhysics.destroyBody(e.body);
				e.alive = false;
				this.scene.remove(e.mesh);
			}
		}
		this.entities = this.entities.filter((e) => e.kind !== "funBox");

		// === PLAYGROUND BEHIND PLAYER (+Z) — bigger pyramids ===
		const behind = [
			{ x: 0.0, z: 3.4, base: 6, size: 0.34 },
			{ x: -2.4, z: 2.8, base: 5, size: 0.32 },
			{ x: 2.4, z: 2.8, base: 5, size: 0.32 },
			{ x: -4.0, z: 2.2, base: 4, size: 0.3 },
			{ x: 4.0, z: 2.2, base: 4, size: 0.3 },
			{ x: -1.2, z: 4.6, base: 5, size: 0.3 },
			{ x: 1.2, z: 4.6, base: 5, size: 0.3 },
			{ x: 0.0, z: 5.8, base: 4, size: 0.28 },
			{ x: -3.2, z: 4.0, base: 3, size: 0.3 },
			{ x: 3.2, z: 4.0, base: 3, size: 0.3 },
		];
		// Flanks (sides of pier path, clear of combat lane)
		const flanks = [
			{ x: -3.7, z: -0.4, base: 4, size: 0.3 },
			{ x: -3.9, z: -2.6, base: 5, size: 0.3 },
			{ x: -3.8, z: -5.0, base: 4, size: 0.28 },
			{ x: -4.1, z: -7.5, base: 3, size: 0.3 },
			{ x: -4.3, z: -10.2, base: 4, size: 0.28 },
			{ x: 3.7, z: -0.4, base: 4, size: 0.3 },
			{ x: 3.9, z: -2.6, base: 5, size: 0.3 },
			{ x: 3.8, z: -5.0, base: 4, size: 0.28 },
			{ x: 4.1, z: -7.5, base: 3, size: 0.3 },
			{ x: 4.3, z: -10.2, base: 4, size: 0.28 },
		];
		for (const p of [...behind, ...flanks]) {
			this.spawnPyramidStack(p.x, p.z, p.base, p.size);
		}
	}
	/** Send a fun crate flying — pure juice, tiny score nibble. */
	knockFunBox(e, dir, force = 6) {
		if (!e || !e.alive || e.kind !== "funBox") return;
		const d = dir.clone();
		if (d.lengthSq() < 1e-6) d.set(0, 0.2, 1);
		d.normalize();
		const f = THREE.MathUtils.clamp(force, 2, 18);
		e.settled = false;
		e.age = 0;
		// Box3D linear + angular impulse
		if (e.body && sharedPhysics.ready) {
			const mass = sharedPhysics.getMass(e.body);
			const imp = mass * f * 0.55;
			sharedPhysics.applyImpulse(e.body, d.x * imp, d.y * imp + mass * (1.5 + f * 0.12), d.z * imp);
			sharedPhysics.setAngularVelocity(
				e.body,
				(Math.random() - 0.5) * 8,
				(Math.random() - 0.5) * 6,
				(Math.random() - 0.5) * 8,
			);
		} else {
			// Fallback if physics not ready
			e.vel.addScaledVector(d, f);
			e.vel.y += f * 0.45 + 1.2;
		}
		const p = THREE.MathUtils.clamp(f / 12, 0.35, 1.2);
		if (this.audio.impact) this.audio.impact("wood", p);
		else this.audio.break();
		this.score += e.value || 2;
		this.spawnFloatText(e.mesh.position.clone().add(new THREE.Vector3(0, 0.3, 0)), "BONK", false);
		this.burst(e.mesh.position.clone(), 0xc49a62, 8);
		this.callbacks.onHitFlash?.(0.12);
		this.emitHud();
	}

	spawnEnemy(type) {
		const mesh = makeEnemy(this.palette, type);
		const player = this.getPlayerPos();
		const ahead = 7.2 + Math.random() * 2.8;
		const lane = (Math.random() - 0.5) * 2;
		const rawX = THREE.MathUtils.clamp(player.x * 0.35 + lane * this.pathHalfWidth * 0.85, -this.pathHalfWidth, this.pathHalfWidth);
		const p = this.clampToPath(rawX, player.z - ahead);
		const pos = new THREE.Vector3(p.x, 0, p.z);
		mesh.position.copy(pos);
		this.scene.add(mesh);
		const loop = Math.max(1, Math.ceil(this.wave / LOOP_LEN));
		const hp = type === "brawler" ? 42 + this.wave * 8 + (loop - 1) * 10 : type === "rusher" ? 24 + this.wave * 5 + (loop - 1) * 6 : 32 + this.wave * 6 + (loop - 1) * 8;
		const bar = makeHpBar();
		// Sit above the tallest RPS props (bags / scissors blades)
		bar.position.y = type === "rusher" ? 2.05 : 1.95;
		mesh.add(bar);
		this.entities.push({
			id: this.idSeq++,
			kind: "enemy",
			mesh,
			alive: true,
			hp,
			maxHp: hp,
			radius: type === "rusher" ? .55 : .6,
			vel: new THREE.Vector3(),
			age: 0,
			life: 999,
			damage: type === "rusher" ? 8 : type === "thrower" ? 6 : 10,
			enemyType: type,
			attackCd: 1 + Math.random(),
			flash: 0,
			value: type === "rusher" ? 120 : type === "thrower" ? 150 : 100,
			hand: null,
			powered: false,
			bar,
			squash: 1
		});
		mesh.scale.setScalar(.01);
		this.burst(pos.clone().add(new THREE.Vector3(0, .5, 0)), 16777215, 10);
		this.spawnRing(pos.clone().add(new THREE.Vector3(0, .05, 0)), 16777215);
	}
	spawnHazard() {
		const mesh = Math.random() > .5 ? makeBottle(this.palette) : makeCrate(this.palette);
		const side = (Math.random() - .5) * 2.2;
		const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		const origin = this.getPlayerPos().clone().add(forward.multiplyScalar(9)).add(right.multiplyScalar(side));
		origin.y = 1.2 + Math.random() * .6;
		mesh.position.copy(origin);
		this.scene.add(mesh);
		const toPlayer = this.getPlayerPos().clone().sub(origin).normalize();
		toPlayer.y += .1;
		toPlayer.normalize();
		this.entities.push({
			id: this.idSeq++,
			kind: "hazard",
			mesh,
			alive: true,
			hp: 1,
			maxHp: 1,
			radius: .22,
			vel: toPlayer.multiplyScalar(6.5 + this.wave * .35),
			age: 0,
			life: 5,
			damage: 12,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 50,
			hand: null,
			powered: false,
			squash: 1
		});
	}
	spawnPickup(pos) {
		const mesh = makeStar(this.palette);
		mesh.position.copy(pos);
		mesh.position.y = 1.15;
		this.scene.add(mesh);
		this.entities.push({
			id: this.idSeq++,
			kind: "pickup",
			mesh,
			alive: true,
			hp: 1,
			maxHp: 1,
			radius: .4,
			vel: new THREE.Vector3(),
			age: 0,
			life: 9,
			damage: 0,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 0,
			hand: null,
			powered: false,
			squash: 1
		});
	}
	armClickBoost(hand) {
		if (hand === "L") { this.clickBoostL = true; this.clickGlowL = 1; }
		else { this.clickBoostR = true; this.clickGlowR = 1; }
		if (this.audio.fingerClick) this.audio.fingerClick();
		if (this.audio.clickCharge) this.audio.clickCharge();
		else this.audio.powerup();
		this.pushMsg((hand === "L" ? "L" : "R") + " CLICK ×2!", 1.1);
		this.flashPunchLight(0xffe08a, 1.8);
		if (this.bloomPass) this.bloomPass.strength = this.isMobile ? 0.85 : 1.2;
		this.applyClickGlow(hand, true);
		this.emitHud();
	}
	applyClickGlow(hand, on) {
		const root = this.xrActive
			? (hand === "L" ? this.xrGloveL : this.xrGloveR)
			: (hand === "L" ? this.leftGlove : this.rightGlove);
		if (!root) return;
		root.traverse((o) => {
			const m = o;
			if (!m.isMesh || !m.material) return;
			const mats = Array.isArray(m.material) ? m.material : [m.material];
			for (const mat of mats) {
				if (!mat) continue;
				if (!mat.userData) mat.userData = {};
				if (on) {
					if (mat.userData._clickSaved == null && "emissiveIntensity" in mat) {
						mat.userData._clickSaved = {
							ei: mat.emissiveIntensity ?? 0,
							ec: mat.emissive ? mat.emissive.getHex() : 0,
						};
					}
					if ("emissive" in mat) {
						mat.emissive = new THREE.Color(0xffe08a);
						mat.emissiveIntensity = 1.35;
					}
				} else if (mat.userData._clickSaved && "emissiveIntensity" in mat) {
					const s = mat.userData._clickSaved;
					if (mat.emissive) mat.emissive.setHex(s.ec || 0);
					mat.emissiveIntensity = s.ei ?? 0.28;
					delete mat.userData._clickSaved;
				}
			}
		});
	}
	tryAttack(hand, opts = {}) {
		// Always allow punch FX unless the player explicitly paused
		if (this.phase === "paused") return;
		const practicing = this.phase === "waveClear" || this.phase === "victory";
		if ((hand === "L" ? this.leftCd : this.rightCd) > 0) return;
		const clickBoost = hand === "L" ? !!this.clickBoostL : !!this.clickBoostR;
		// Defensive: power meter must always be numeric
		if (typeof this.power !== "number" || Number.isNaN(this.power)) this.power = 0;
		const meterPowered = this.power >= .95;
		const powered = meterPowered || clickBoost;
		// 0.22–1.45 from motion release; button/click defaults to mid strength
		let strikePower = typeof opts.strikePower === "number"
			? opts.strikePower
			: (opts.fromMotion
				? (hand === "L" ? this.xrStrikePowerL : this.xrStrikePowerR)
				: 0.85);
		if (clickBoost) strikePower = Math.min(1.6, strikePower * 2);
		// Motion can force a slap (wrist / sweep) even if mode is rock
		let mode = opts.forceMode || this.getHandMode(hand);
		let slapStyle = opts.slapStyle || null;
		if (!slapStyle && mode === "slap" && this.xrActive) {
			const st = hand === "L" ? this.xrLastSlapStyleL : this.xrLastSlapStyleR;
			const stT = hand === "L" ? this.xrLastSlapTL : this.xrLastSlapTR;
			if (st && this.time - (stT || 0) < 0.35) slapStyle = st;
		}
		if (mode === "grenade" || opts.forceMode === "grenade") {
			const cd = 0.55;
			if (hand === "L") { this.leftCd = cd; this.leftPunchT = 1; }
			else { this.rightCd = cd; this.rightPunchT = 1; }
			this.fireGrenade(hand, powered, { strikePower, handSpeed: opts.handSpeed });
			this.flashPunchLight(0x66ff44, 1.4);
		} else if (mode === "punch") {
			const cdBase = powered ? .2 : .3;
			// Weaker jabs recover a bit faster
			const cd = cdBase * THREE.MathUtils.clamp(0.75 + strikePower * 0.35, 0.7, 1.15);
			if (hand === "L") { this.leftCd = cd; this.leftPunchT = 1; }
			else { this.rightCd = cd; this.rightPunchT = 1; }
			this.fireGlove(hand, powered, { strikePower, handSpeed: opts.handSpeed });
			this.audio.punch();
			this.trauma = Math.min(1, this.trauma + .1 + strikePower * 0.12);
			this.camKick = Math.min(1, this.camKick + .18 + strikePower * 0.18);
			this.flashPunchLight(powered ? 16765514 : 16737860, (powered ? 2.0 : 1.2) * (0.7 + strikePower * 0.5));
		} else if (mode === "slap") {
			const wrist = slapStyle === "wrist";
			const cd = (wrist ? 0.28 : 0.4) * THREE.MathUtils.clamp(0.8 + strikePower * 0.3, 0.75, 1.15);
			if (hand === "L") { this.leftCd = cd; this.leftPunchT = 1; }
			else { this.rightCd = cd; this.rightPunchT = 1; }
			this.fireGlove(hand, powered, {
				forceMode: "slap",
				slapStyle: slapStyle || "sweep",
				slapDir: opts.slapDir || 0,
				strikePower,
				handSpeed: opts.handSpeed,
			});
			this.audio.slap();
			this.audio.whoosh();
			this.trauma = Math.min(1, this.trauma + (wrist ? 0.1 : 0.18) * strikePower);
			this.camKick = Math.min(1, this.camKick + (wrist ? 0.16 : 0.3) * (0.6 + strikePower * 0.5));
			this.flashPunchLight(wrist ? 0x5ec8e8 : 4045026, (wrist ? 1.0 : 1.6) * (0.65 + strikePower * 0.5));
			if (this.xrActive && opts.fromMotion) {
				const tag = wrist ? "Wrist slap" : "Sweep slap";
				this.pushMsg(`${tag} ${Math.round(strikePower * 100)}%`, 0.75);
			}
		} else {
			// Scissors: fire a flying blade at the same speed as the punch/thrust
			const cd = 0.22 * THREE.MathUtils.clamp(0.75 + strikePower * 0.35, 0.7, 1.15);
			if (hand === "L") { this.leftCd = cd; this.leftPunchT = 1; }
			else { this.rightCd = cd; this.rightPunchT = 1; }
			this.fireGlove(hand, powered, {
				forceMode: "poke",
				strikePower,
				handSpeed: opts.handSpeed,
			});
			this.audio.poke();
			this.audio.startScissorsLoop?.(2.1);
			this.trauma = Math.min(1, this.trauma + .1 + strikePower * 0.08);
			this.camKick = Math.min(1, this.camKick + .15 + strikePower * 0.12);
			this.flashPunchLight(14856253, 1.1 + strikePower * 0.5);
		}
		if (meterPowered) {
			this.power = 0;
			this.pushMsg("POWERED!", .9);
			this.audio.crit();
			if (this.bloomPass) this.bloomPass.strength = this.isMobile ? .9 : 1.35;
			this.timeScale = .35;
		} else if (clickBoost) {
			this.audio.crit();
			this.pushMsg("CLICK HIT ×2!", 0.85);
			if (this.bloomPass) this.bloomPass.strength = this.isMobile ? 0.8 : 1.15;
			this.timeScale = Math.min(this.timeScale, 0.5);
		}
		if (clickBoost) {
			if (hand === "L") { this.clickBoostL = false; this.clickGlowL = 0; }
			else { this.clickBoostR = false; this.clickGlowR = 0; }
			this.applyClickGlow(hand, false);
		}
		// Between waves: punches still fly for practice; after hold, punch also advances
		if (practicing && this.time >= (this.waveClearReadyAt || 0)) {
			this.nextWaveFromClear();
		}
	}
	flashPunchLight(color, intensity) {
		if (!this.punchLight) return;
		this.punchLight.color.setHex(color);
		this.punchLight.intensity = intensity;
		this.punchLightT = .12;
	}
	getFireAim(hand) {
		const camFwd = new THREE.Vector3();
		this.camera.getWorldDirection(camFwd);
		if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1);
		camFwd.normalize();
		const origin = new THREE.Vector3();
		const ctrlFwd = new THREE.Vector3(0, 0, -1);
		let used = "camera";
		if (this.xrActive) {
			const anchor = this.xrHandAnchors && this.xrHandAnchors[hand];
			const ctrl = (this.xrCtrlByHand && this.xrCtrlByHand[hand]) || (hand === "L" ? this.controller0 : this.controller1);
			const src = (this.xrUsingHands && anchor && anchor.visible) ? anchor : ctrl;
			if (src) {
				src.getWorldPosition(origin);
				const q = new THREE.Quaternion();
				src.getWorldQuaternion(q);
				if (this.xrUsingHands && src === anchor) ctrlFwd.set(0, 1, 0).applyQuaternion(q);
				else ctrlFwd.set(0, 0, -1).applyQuaternion(q);
				used = this.xrUsingHands ? "hand" : "controller";
			} else {
				origin.copy(this.getPlayerPos());
			}

			// Fire STRAIGHT down the path (where you look). Hand only sets spawn point.
			// Controllers naturally splay outward — ignore that lateral bias completely.
			const pathAim = camFwd.clone();
			pathAim.y = 0;
			if (pathAim.lengthSq() < 1e-6) pathAim.set(0, 0, -1);
			pathAim.normalize();

			const thrustDir = hand === "L" ? this.xrLastThrustDirL : this.xrLastThrustDirR;
			const thrustT = hand === "L" ? this.xrLastThrustTL : this.xrLastThrustTR;
			const thrustFresh = thrustDir && (this.time - (thrustT || 0)) < 0.28;

			let aim = pathAim.clone();
			// Tiny optional pitch from thrust / controller (high or low jab), never yaw drift
			let pitch = 0;
			if (thrustFresh && thrustDir.lengthSq() > 1e-6) {
				pitch = THREE.MathUtils.clamp(thrustDir.y * 0.35, -0.12, 0.18);
				used = "path+thrust";
			} else if (ctrlFwd.lengthSq() > 1e-6) {
				const raw = ctrlFwd.clone().normalize();
				pitch = THREE.MathUtils.clamp(raw.y * 0.25, -0.1, 0.14);
				used = "path";
			} else {
				used = "path";
			}
			aim.y = pitch;
			if (aim.lengthSq() < 1e-6) aim.copy(pathAim);
			aim.normalize();

			// Spawn slightly ahead of the hand, along path (not off to the side)
			origin.addScaledVector(aim, 0.16);
			return {
				origin,
				forward: aim,
				ctrlFwd: ctrlFwd.lengthSq() > 1e-6 ? ctrlFwd.clone().normalize() : aim.clone(),
				camFwd: camFwd.clone(),
				used,
			};
		}
		// Desktop / mobile: straight camera aim (no lateral bias on direction)
		const flat = camFwd.clone();
		flat.y = 0;
		if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
		flat.normalize();
		origin.copy(this.getPlayerPos());
		const right = new THREE.Vector3().crossVectors(flat, new THREE.Vector3(0, 1, 0)).normalize();
		// Small spawn offset only — direction stays straight
		origin.add(flat.clone().multiplyScalar(0.85));
		origin.add(right.multiplyScalar(hand === "L" ? -0.12 : 0.12));
		origin.y -= 0.08;
		return { origin, forward: flat, ctrlFwd: flat.clone(), camFwd: flat.clone(), used: "desktop" };
	}
	/** Mode → trail lace colour */
	trailColorForMode(mode, powered = false) {
		if (mode === "grenade") return powered ? 0xffaa33 : 0x6baf3a;
		if (mode === "slap") return powered ? 0x9ef0ff : 0x3db8e2;
		if (mode === "poke") return powered ? 0xffe08a : 0xc8d0d8;
		// rock / boxing glove fist
		return powered ? 0xffd24a : 0xe23d3d;
	}
	/**
	 * Continuous lace particle ribbon (not stepped chunks).
	 * Dense spawn along the flight path with soft fade.
	 */
	/** Soft circular sprite for Points (avoids square gl_Point). */
	getSoftCircleTexture() {
		if (this._softCircleTex) return this._softCircleTex;
		const s = 64;
		const c = document.createElement("canvas");
		c.width = s;
		c.height = s;
		const ctx = c.getContext("2d");
		const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 0, s * 0.5, s * 0.5, s * 0.5);
		g.addColorStop(0, "rgba(255,255,255,1)");
		g.addColorStop(0.35, "rgba(255,255,255,0.75)");
		g.addColorStop(0.7, "rgba(255,255,255,0.22)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, s, s);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.needsUpdate = true;
		this._softCircleTex = tex;
		return tex;
	}
	createLaceTrail(hexColor, opts = {}) {
		const N = opts.count || 360;
		const positions = new Float32Array(N * 3);
		const colors = new Float32Array(N * 3);
		const ages = new Float32Array(N);
		ages.fill(-1);
		// park dead particles off-screen
		for (let i = 0; i < N; i++) {
			positions[i * 3 + 1] = -999;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		const mat = new THREE.PointsMaterial({
			size: opts.size || 0.09,
			map: this.getSoftCircleTexture(),
			alphaMap: this.getSoftCircleTexture(),
			vertexColors: true,
			transparent: true,
			opacity: opts.opacity != null ? opts.opacity : 0.42,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
			alphaTest: 0.02,
		});
		const points = new THREE.Points(geo, mat);
		points.frustumCulled = false;
		const base = new THREE.Color(hexColor);
		return {
			points,
			positions,
			colors,
			ages,
			N,
			head: 0,
			base,
			life: opts.life || 0.42,
			last: null,
			emitBoost: opts.emitBoost || 1,
		};
	}
	/** Spawn lace particles densely along the segment since last frame */
	updateLaceTrail(lace, worldPos, dt) {
		if (!lace) return;
		const { positions, colors, ages, N, base, life } = lace;
		// age + fade (dim vertex colour)
		for (let i = 0; i < N; i++) {
			if (ages[i] < 0) continue;
			ages[i] += dt;
			const u = ages[i] / life;
			if (u >= 1) {
				ages[i] = -1;
				positions[i * 3 + 1] = -999;
				continue;
			}
			const fade = 1 - u * u;
			// Softer / more transparent lace (vertex colour drives additive intensity)
			const spark = 0.28 + 0.42 * fade;
			colors[i * 3] = base.r * spark;
			colors[i * 3 + 1] = base.g * spark;
			colors[i * 3 + 2] = base.b * spark;
		}
		const cur = worldPos.clone();
		if (!lace.last) lace.last = cur.clone();
		const dist = lace.last.distanceTo(cur);
		// denser spacing = continuous lace (not chunky steps)
		const spacing = 0.028 / (lace.emitBoost || 1);
		const steps = Math.max(1, Math.min(48, Math.ceil(dist / spacing) || 1));
		for (let s = 1; s <= steps; s++) {
			const t = s / steps;
			const x = lace.last.x + (cur.x - lace.last.x) * t;
			const y = lace.last.y + (cur.y - lace.last.y) * t;
			const z = lace.last.z + (cur.z - lace.last.z) * t;
			// soft lateral jitter for ribbon body
			const j = 0.012;
			this._spawnLaceParticle(lace, x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, z + (Math.random() - 0.5) * j);
			// second layer for thicker lace
			if (s % 2 === 0) {
				this._spawnLaceParticle(lace, x + (Math.random() - 0.5) * j * 2, y + (Math.random() - 0.5) * j * 2, z + (Math.random() - 0.5) * j * 2);
			}
		}
		lace.last.copy(cur);
		lace.points.geometry.attributes.position.needsUpdate = true;
		lace.points.geometry.attributes.color.needsUpdate = true;
	}
	_spawnLaceParticle(lace, x, y, z) {
		const i = lace.head % lace.N;
		lace.head++;
		lace.ages[i] = 0;
		lace.positions[i * 3] = x;
		lace.positions[i * 3 + 1] = y;
		lace.positions[i * 3 + 2] = z;
		lace.colors[i * 3] = lace.base.r;
		lace.colors[i * 3 + 1] = lace.base.g;
		lace.colors[i * 3 + 2] = lace.base.b;
	}
	disposeLaceTrail(lace) {
		if (!lace) return;
		this.scene.remove(lace.points);
		lace.points.geometry.dispose();
		lace.points.material.dispose();
	}
	destroyEntityBody(e) {
		if (e && e.body) {
			sharedPhysics.destroyBody(e.body);
			e.body = null;
		}
	}
	/** Step Box3D Wasm world and sync crate meshes. */
	syncPhysics(dt) {
		if (!sharedPhysics.ready) return;
		sharedPhysics.step(dt);
		// If entire world is sleeping, crates don't need mesh pulls
		if (sharedPhysics.awakeCount === 0) return;
		for (const e of this.entities) {
			if (!e.alive || !e.body || e.kind !== "funBox") continue;
			// syncMesh skips sleeping bodies internally
			sharedPhysics.syncMesh(e.body, e.mesh);
		}
	}

	fireGlove(hand, powered, opts = {}) {
		const mode = opts.forceMode || this.getHandMode(hand);
		const isSlap = mode === "slap";
		const isPoke = mode === "poke";
		// wrist = small/straight · sweep = big side-to-side · default sweep for trigger slaps
		const slapStyle = isSlap ? (opts.slapStyle || (this.xrActive ? "sweep" : "sweep")) : null;
		const isWristSlap = slapStyle === "wrist";
		const isSweepSlap = isSlap && !isWristSlap;
		const mesh = makeModeHand(this.palette, mode, hand, powered);
		const baseScale = this.xrActive
			? this.xrHandScale * (isWristSlap ? 1.05 : isSlap ? 1.4 : isPoke ? 1.15 : 1.2)
			: (isSlap ? 1.45 : isPoke ? 1.2 : 1.25);
		const preSp = typeof opts.strikePower === "number" ? opts.strikePower : 0.85;
		mesh.scale.multiplyScalar(baseScale * (0.85 + preSp * 0.25));
		const aim = this.getFireAim(hand);
		const origin = aim.origin;
		const forward = aim.forward.clone();
		const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
		if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
		right.normalize();
		// Sweep starts offset; wrist slap stays nearly on-path
		if (isSlap) {
			const lat = isWristSlap ? (this.xrActive ? 0.06 : 0.2) : (this.xrActive ? 0.35 : 0.55);
			const dirSign = opts.slapDir ? Math.sign(opts.slapDir) : (hand === "L" ? -1 : 1);
			origin.add(right.clone().multiplyScalar(dirSign * lat));
		}
		mesh.position.copy(origin);
		mesh.lookAt(origin.clone().add(forward));
		this.scene.add(mesh);
		this.debugLastFire = {
			hand, mode, used: aim.used + (slapStyle ? `/${slapStyle}` : ""),
			origin: origin.clone(), forward: forward.clone(),
			ctrlFwd: aim.ctrlFwd.clone(), camFwd: aim.camFwd.clone(),
			pitch: Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)),
			t: this.time,
		};
		if (this.handDebug) this.updateDebugArrows(origin, forward, aim.ctrlFwd, aim.camFwd);
		// Continuous lace trail tinted by launched item (fist red · paper cyan · blades steel)
		const trailCol = this.trailColorForMode(mode, powered);
		const lace = this.createLaceTrail(trailCol, {
			size: isSlap ? 0.09 : isPoke ? 0.065 : 0.075,
			life: isSlap ? 0.5 : 0.4,
			emitBoost: isSlap ? 1.3 : 1,
			count: isSlap ? 420 : 360,
		});
		this.scene.add(lace.points);
		const trail = lace; // entity.trail is lace object now
		const sp = typeof opts.strikePower === "number"
			? THREE.MathUtils.clamp(opts.strikePower, 0.2, 1.5)
			: 0.85;
		// Damage still scales with how hard you swung
		const baseDmg = isWristSlap
			? (powered ? 44 : 26)
			: isSlap
				? (powered ? 120 : 68)
				: isPoke
					? (powered ? 50 : 26)
					: (powered ? 54 : 28);
		const baseRad = isWristSlap
			? (powered ? 0.38 : 0.3)
			: isSlap
				? (powered ? 0.9 : 0.68)
				: isPoke
					? (powered ? 0.36 : 0.26)
					: (powered ? 0.4 : 0.28);
		// Projectile speed = actual hand punch speed (m/s). Fallback if button click.
		let handSpeed = typeof opts.handSpeed === "number" ? opts.handSpeed : 0;
		if (!(handSpeed > 0.05)) {
			// Desktop / button: map strikePower to a reasonable flight speed
			handSpeed = (isSlap ? 12 : isPoke ? 18 : 21) * (0.45 + sp * 0.7);
		}
		// Keep same speed as the punch — only clamp so it always travels and never goes insane
		const speed = THREE.MathUtils.clamp(handSpeed, 2.5, 48);
		const damage = Math.round(baseDmg * (0.38 + sp * 0.72));
		const radius = baseRad * (0.7 + sp * 0.4);
		// Amplitude: wrist almost straight; sweep exaggerated — also scales with power
		let slapAmp = 0;
		if (isWristSlap) slapAmp = (this.xrActive ? (powered ? 0.28 : 0.18) : (powered ? 0.55 : 0.4)) * (0.6 + sp * 0.5);
		else if (isSlap) slapAmp = (this.xrActive ? (powered ? 1.8 : 1.45) : (powered ? 2.8 : 2.2)) * (0.55 + sp * 0.55);
		const slapFreq = isWristSlap ? (powered ? 9 : 7) : isSlap ? (powered ? 13 : 11) : 0;
		const slapPhase = opts.slapDir
			? (opts.slapDir >= 0 ? 0 : Math.PI)
			: (hand === "L" ? 0 : Math.PI);
		this.entities.push({
			id: this.idSeq++, kind: "gloveShot", mesh, alive: true, hp: 1, maxHp: 1, radius,
			vel: forward.clone().multiplyScalar(speed), age: 0, life: isSlap ? (isWristSlap ? 1.8 : 2.5) : isPoke ? 2.0 : 2.1, damage,
			enemyType: "brawler", attackCd: 0, flash: 0, value: 0, hand, powered, trail, squash: 1,
			slapWave: isSlap, slapStyle: slapStyle || null, shotMode: mode, fwd: forward.clone(), rightAxis: right.clone(),
			pathOrigin: origin.clone(), speed,
			slapAmp,
			slapFreq,
			slapPhase,
			hitIds: new Set(),
			lace: true,
			body: null,
		});
		// Box3D bullet sphere so punches shove crates for real
		if (sharedPhysics.ready) {
			const shot = this.entities[this.entities.length - 1];
			const rad = Math.max(0.1, radius * 0.55);
			const body = sharedPhysics.createSphere(origin.x, origin.y, origin.z, rad, {
				density: 220, friction: 0.15, restitution: 0.08, bullet: true,
				role: "projectile", gravityScale: 0,
			});
			if (body) {
				const v = shot.vel;
				sharedPhysics.setLinearVelocity(body, v.x, v.y, v.z);
				shot.body = body;
			}
		}
		// Seed lace at muzzle
		if (trail && trail.points) this.updateLaceTrail(trail, origin, 0.016);
		// Hide hand prop for a few seconds so the flying copy is obvious (desktop + XR)
		const returnIn = 2.0;
		if (!this.xrActive) {
			if (hand === "L") { this.leftGlove.visible = false; this.setViewHandOpacity("L", 0); this.leftReturnAt = this.time + returnIn; }
			else { this.rightGlove.visible = false; this.setViewHandOpacity("R", 0); this.rightReturnAt = this.time + returnIn; }
		} else {
			const glove = hand === "L" ? this.xrGloveL : this.xrGloveR;
			if (glove) glove.visible = false;
			if (hand === "L") this.leftReturnAt = this.time + returnIn;
			else this.rightReturnAt = this.time + returnIn;
		}
		this.burst(origin, trailCol, isSlap ? 14 : isPoke ? 10 : 8);
		if (isPoke) {
			// Snip-snip loop while the blades fly
			if (this.audio.startScissorsLoop) this.audio.startScissorsLoop(Math.min(2.4, 2.0));
		} else if (!isSlap) {
			this.audio.whoosh();
		}
	}
	/** Fist + pull-back + throw → lobbed grenade (fuse 3s, blast sphere). */
	fireGrenade(hand, powered, opts = {}) {
		const mesh = makeGrenade(this.palette, powered);
		const scale = this.xrActive ? this.xrHandScale * 1.4 : 1.15;
		mesh.scale.multiplyScalar(scale);
		const aim = this.getFireAim(hand);
		const origin = aim.origin.clone();
		origin.y += 0.05;
		// Throw direction: use thrust if available, else look; loft for grenade arc
		let forward = aim.forward.clone();
		const thrustDir = hand === "L" ? this.xrLastThrustDirL : this.xrLastThrustDirR;
		const thrustT = hand === "L" ? this.xrLastThrustTL : this.xrLastThrustTR;
		if (thrustDir && (this.time - (thrustT || 0)) < 0.35) {
			forward = thrustDir.clone().normalize();
		}
		// Arc loft — classic underhand/overhand grenade lob
		forward.y = THREE.MathUtils.clamp(forward.y + 0.42, 0.15, 0.85);
		forward.normalize();
		mesh.position.copy(origin);
		this.scene.add(mesh);

		const sp = typeof opts.strikePower === "number" ? opts.strikePower : 0.85;
		let handSpeed = typeof opts.handSpeed === "number" ? opts.handSpeed : 0;
		if (!(handSpeed > 0.05)) handSpeed = 8 * (0.5 + sp * 0.7);
		// Match throw speed; grenades a bit slower than punches but still scale
		const speed = THREE.MathUtils.clamp(handSpeed * 0.92, 2.2, 28);

		const trailCol = this.trailColorForMode("grenade", powered);
		const lace = this.createLaceTrail(trailCol, { size: 0.06, life: 0.55, emitBoost: 1.1, count: 300 });
		this.scene.add(lace.points);
		this.updateLaceTrail(lace, origin, 0.016);

		const fuse = 3.0;
		const blastRadius = powered ? 3.8 : 3.1;
		const gVel = forward.clone().multiplyScalar(speed);
		// Box3D sphere for the grenade
		let body = null;
		if (sharedPhysics.ready) {
			body = sharedPhysics.createSphere(origin.x, origin.y, origin.z, 0.13, {
				density: 600, friction: 0.5, restitution: 0.35, bullet: true,
				role: "grenade", gravityScale: 1,
			});
			if (body) sharedPhysics.setLinearVelocity(body, gVel.x, gVel.y, gVel.z);
		}
		this.entities.push({
			id: this.idSeq++,
			kind: "grenade",
			mesh,
			alive: true,
			hp: 1,
			maxHp: 1,
			radius: 0.18,
			vel: gVel,
			age: 0,
			life: fuse + 0.05,
			fuse,
			blastRadius,
			damage: powered ? 95 : 62,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 0,
			hand,
			powered,
			trail: lace,
			squash: 1,
			hitIds: new Set(),
			gravity: 9.5,
			bounced: false,
			tickAcc: 0,
			body,
		});

		const returnIn = 1.2;
		if (!this.xrActive) {
			if (hand === "L") { this.leftGlove.visible = false; this.setViewHandOpacity("L", 0); this.leftReturnAt = this.time + returnIn; }
			else { this.rightGlove.visible = false; this.setViewHandOpacity("R", 0); this.rightReturnAt = this.time + returnIn; }
		} else {
			const glove = hand === "L" ? this.xrGloveL : this.xrGloveR;
			if (glove) glove.visible = false;
			if (hand === "L") this.leftReturnAt = this.time + returnIn;
			else this.rightReturnAt = this.time + returnIn;
		}
		if (this.audio.grenadePin) this.audio.grenadePin();
		if (this.audio.grenadeThrow) this.audio.grenadeThrow();
		this.burst(origin, trailCol, 10);
		this.pushMsg("GRENADE!", 0.8);
		this.trauma = Math.min(1, this.trauma + 0.12);
	}
	explodeGrenade(e) {
		if (!e || !e.alive) return;
		const pos = e.mesh.position.clone();
		const R = e.blastRadius || 3.1;
		// Translucent blast-range sphere
		const sphereMat = new THREE.MeshBasicMaterial({
			color: 0xff6622,
			transparent: true,
			opacity: 0.38,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 18), sphereMat);
		sphere.position.copy(pos);
		this.scene.add(sphere);
		// Soft outer ring
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0xffaa44,
			transparent: true,
			opacity: 0.28,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		const ring = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 24, 16), ringMat);
		ring.position.copy(pos);
		this.scene.add(ring);

		this.entities.push({
			id: this.idSeq++,
			kind: "blastSphere",
			mesh: sphere,
			ring,
			alive: true,
			hp: 1,
			maxHp: 1,
			radius: R,
			vel: new THREE.Vector3(),
			age: 0,
			life: 0.85,
			damage: 0,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 0,
			hand: null,
			powered: false,
			squash: 1,
		});

		// Damage everyone in range
		for (const other of this.entities) {
			if (!other.alive || other.id === e.id) continue;
			if (other.kind !== "enemy" && other.kind !== "hazard" && other.kind !== "funBox") continue;
			const body = other.mesh.position.clone();
			body.y += other.kind === "hazard" ? 0.15 : other.kind === "funBox" ? 0 : 0.65;
			const d = body.distanceTo(pos);
			if (d <= R) {
				const falloff = 1 - (d / R) * 0.45;
				const knock = body.clone().sub(pos);
				knock.y = 0.35;
				if (knock.lengthSq() < 1e-6) knock.set(0, 0.35, -1);
				knock.normalize();
				if (other.kind === "hazard") this.destroyHazard(other, true);
				else if (other.kind === "funBox") this.knockFunBox(other, knock, 10 + falloff * 8);
				else this.damageEnemy(other, Math.round(e.damage * falloff), knock);
			}
		}

		this.burst(pos, 0xff6622, 48);
		this.burst(pos, 0xffd24a, 28);
		this.burst(pos, 0xffffff, 16);
		this.spawnRing(pos, 0xff6622);
		this.spawnRing(pos.clone().add(new THREE.Vector3(0, 0.2, 0)), 0xffaa44);
		if (this.audio.grenadeBoom) this.audio.grenadeBoom();
		else this.audio.break();
		this.trauma = Math.min(1, this.trauma + 0.55);
		this.camKick = Math.min(1, this.camKick + 0.7);
		this.hitstop = 0.08;
		if (this.bloomPass) this.bloomPass.strength = this.isMobile ? 1.0 : 1.5;
		this.timeScale = 0.35;

		// Box3D radial shove on nearby rigid bodies (crates etc.)
		if (sharedPhysics.ready) {
			const payload = [];
			for (const o of this.entities) {
				if (!o.alive || !o.body) continue;
				if (o.kind !== "funBox" && o.kind !== "grenade") continue;
				if (o.id === e.id) continue;
				payload.push({ body: o.body, meshPos: o.mesh.position });
			}
			sharedPhysics.explode(payload, pos, R, powered ? 55 : 38);
		}
		e.alive = false;
		if (e.body) sharedPhysics.destroyBody(e.body);
		e.body = null;
		this.scene.remove(e.mesh);
		if (e.trail) this.disposeLaceTrail(e.trail);
	}
	doMelee(mode, hand, powered) {
		const forward = new THREE.Vector3();
		this.camera.getWorldDirection(forward);
		if (this.xrActive) {
			const ctrl = hand === "L" ? this.controller0 : this.controller1;
			if (ctrl) {
				const q = new THREE.Quaternion();
				ctrl.getWorldQuaternion(q);
				forward.set(0, 0, -1).applyQuaternion(q);
			}
		}
		const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
		const origin = this.getPlayerPos().clone().add(forward.clone().multiplyScalar(.45));
		if (!this.xrActive) origin.add(right.multiplyScalar(hand === "L" ? -.2 : .2));
		const range = mode === "slap" ? powered ? 3.6 : 2.7 : powered ? 4.6 : 3.5;
		const cone = mode === "slap" ? .92 : .42;
		const damage = mode === "slap" ? powered ? 42 : 24 : powered ? 20 : 13;
		let hitAny = false;
		for (const e of this.entities) {
			if (!e.alive || (e.kind !== "enemy" && e.kind !== "hazard" && e.kind !== "funBox")) continue;
			const to = e.mesh.position.clone().sub(origin);
			to.y += e.kind === "funBox" ? 0.1 : .6;
			if (to.length() > range + e.radius) continue;
			to.normalize();
			if (to.dot(forward) < 1 - cone) continue;
			if (e.kind === "hazard") {
				this.destroyHazard(e, true);
				hitAny = true;
				continue;
			}
			if (e.kind === "funBox") {
				this.knockFunBox(e, forward, mode === "slap" ? 11 : 7);
				hitAny = true;
				continue;
			}
			this._suppressHitSfx = true;
			this.damageEnemy(e, damage, forward);
			this._suppressHitSfx = false;
			if (this.audio.projectileHit) this.audio.projectileHit(mode, 0.9);
			else this.audio.hit();
			hitAny = true;
		}
		if (hitAny) {
			this.hitstop = mode === "slap" ? .06 : .04;
			this.callbacks.onHitFlash(mode === "slap" ? .35 : .2);
			this.spawnRing(origin.clone().add(forward.multiplyScalar(1.1)), mode === "slap" ? 4045026 : 14856253);
		}
		this.burst(origin.clone().add(forward.multiplyScalar(1)), mode === "slap" ? 4045026 : 14856253, mode === "slap" ? 22 : 12);
	}
	damageEnemy(e, dmg, dir) {
		e.hp -= dmg;
		e.flash = .14;
		e.squash = .65;
		e.mesh.position.add(dir.clone().multiplyScalar(.45));
		this.keepEnemyOnPath(e);
		// SFX: projectiles play mode-specific impact at the call site; melee uses flesh here
		if (!this._suppressHitSfx) {
			const hitP = THREE.MathUtils.clamp(dmg / 40, 0.4, 1.25);
			if (this.audio.fleshImpact) this.audio.fleshImpact(hitP);
			else this.audio.hit();
		}
		this.trauma = Math.min(1, this.trauma + .2);
		this.hitstop = .05;
		this.combo += 1;
		this.comboTimer = 2.6;
		this.score += Math.floor(10 * (1 + this.combo * .18));
		this.spawnFloatText(e.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0)), `-${dmg}`, dmg > 30);
		this.callbacks.onHitFlash(.25);
		this.callbacks.onComboPop?.(this.combo);
		this.power = Math.min(1, this.power + .07);
		this.camKick = Math.min(1, this.camKick + .22);
		if (this.combo > 0 && this.combo % 5 === 0) {
			this.pushMsg(`${this.combo} COMBO!`, 1);
			this.trauma = Math.min(1, this.trauma + .25);
			this.burst(e.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), 16765514, 16);
		}
		e.mesh.traverse((o) => {
			const m = o;
			if (m.isMesh && m.material && "emissive" in m.material) {
				const mat = m.material;
				mat.emissive = new THREE.Color(16777215);
				mat.emissiveIntensity = 1.25;
			}
		});
		const hpRatio = Math.max(0, e.hp / e.maxHp);
		if (e.bar) {
			const fill = e.bar.getObjectByName("hpFill");
			if (fill) {
				fill.scale.x = hpRatio;
				fill.material.color.set(hpRatio < .35 ? 14834237 : 4052620);
			}
		}
		if (e.mesh) applyEnemyDamageFace(e.mesh, hpRatio);
		if (e.hp <= 0) this.killEnemy(e);
		this.emitHud();
	}
	killEnemy(e) {
		if (!e.alive) return;
		e.alive = false;
		this.waveKills += 1;
		this.score += e.value * (1 + Math.floor(this.combo / 5));
		const p = e.mesh.position.clone().add(new THREE.Vector3(0, .75, 0));
		this.burst(p, 12868308, 32);
		this.burst(p, 16777215, 14);
		this.burst(p, 16765514, 10);
		this.spawnRing(p, 12868308);
		this.spawnRing(p.clone().add(new THREE.Vector3(0, .1, 0)), 16777215);
		this.audio.break();
		this.audio.crit();
		if (this.audio.impact) this.audio.impact("flesh", 1.15);
		this.trauma = Math.min(1, this.trauma + .4);
		this.camKick = Math.min(1, this.camKick + .45);
		this.timeScale = Math.min(this.timeScale, .45);
		if (this.bloomPass) this.bloomPass.strength = this.isMobile ? .7 : 1.05;
		this.scene.remove(e.mesh);
		if (Math.random() < .25) this.spawnPickup(e.mesh.position.clone());
		this.emitHud();
		this.checkWaveClear();
	}
	destroyHazard(e, scored) {
		if (!e.alive) return;
		e.alive = false;
		this.scene.remove(e.mesh);
		this.burst(e.mesh.position.clone(), 8308963, 24);
		this.spawnRing(e.mesh.position.clone(), 8308963);
		if (this.audio.impact) this.audio.impact("wood", 0.9);
		else this.audio.break();
		if (scored) {
			this.combo += 1;
			this.comboTimer = 2.6;
			this.score += e.value;
			this.power = Math.min(1, this.power + .12);
			this.spawnFloatText(e.mesh.position.clone(), "+SLAP", true);
			this.callbacks.onHitFlash(.4);
			this.trauma = Math.min(1, this.trauma + .28);
		}
		this.emitHud();
	}
	checkWaveClear() {
		if (!this.entities.some((e) => e.alive && e.kind === "enemy") && this.spawnQueue.length === 0 && this.phase === "playing") {
			this.audio.waveClear();
			this.power = Math.min(1, this.power + .28);
			this.health = Math.min(this.maxHealth, this.health + 18);
			// Endless: every LOOP_LEN waves → Champion milestone, then harder loop
			const champion = this.wave > 0 && this.wave % LOOP_LEN === 0;
			this.waveClearReadyAt = this.time + 1.0;
			if (champion) {
				const loop = Math.floor(this.wave / LOOP_LEN);
				this.score += 800 + loop * 250;
				if (this.score > this.highScore) {
					this.highScore = this.score;
					saveHighScore(this.highScore);
				}
				this.setPhase("victory");
				this.pushMsg(`CHAMPION! Punch for harder · loop ${loop + 1}`, 2.4);
				this.burst(this.getPlayerPos().clone().add(new THREE.Vector3(0, 1, -2)), 16765514, 48);
				this.timeScale = .3;
			} else {
				this.setPhase("waveClear");
				this.pushMsg(`Wave ${this.wave} clear!`, 2);
				this.burst(this.getPlayerPos().clone().add(new THREE.Vector3(0, 1, -1.5)), 4052620, 28);
			}
			if (document.pointerLockElement) document.exitPointerLock();
			this.emitHud();
		}
	}
	nextWaveFromClear() {
		// Continuous run — never ends; each wave is harder via beginWave scaling
		this.beginWave(this.wave + 1);
		this.setPhase("playing");
		if (!this.isMobile && !this.xrActive) this.requestLock();
	}
	hurtPlayer(dmg) {
		// Soft invuln after a near-KO shake-off
		if (this.reviveIFrames && this.time < this.reviveIFrames) return;
		this.health = Math.max(0, this.health - dmg);
		this.combo = 0;
		this.trauma = Math.min(1, this.trauma + .55);
		this.camKick = Math.min(1, this.camKick + .55);
		this.audio.hurt();
		this.callbacks.onDamageFlash();
		this.emitHud();
		// Prototype: no real game over — shake it off and keep fighting harder
		if (this.health <= 0) {
			this.health = Math.ceil(this.maxHealth * 0.55);
			this.reviveIFrames = this.time + 2.2;
			this.power = Math.min(1, this.power + 0.35);
			this.audio.powerup();
			this.pushMsg("Still standing! Keep punching", 2.0);
			this.burst(this.getPlayerPos().clone().add(new THREE.Vector3(0, 1, -0.5)), 16765514, 22);
			this.timeScale = 0.45;
			if (this.score > this.highScore) {
				this.highScore = this.score;
				saveHighScore(this.highScore);
			}
			this.emitHud();
		}
	}
	allocParticle(color) {
		let mesh = this.particlePool.pop();
		if (!mesh) mesh = new THREE.Mesh(this.particleGeo, new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 1,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		}));
		else {
			const mat = mesh.material;
			mat.color.setHex(color);
			mat.opacity = 1;
		}
		return mesh;
	}
	burst(pos, color, n) {
		const count = Math.ceil(n * (this.isMobile ? .6 : 1) * this.quality);
		for (let i = 0; i < count; i++) {
			const mesh = this.allocParticle(color);
			mesh.position.copy(pos);
			mesh.scale.setScalar(.7 + Math.random() * 1.2);
			this.scene.add(mesh);
			const life = .35 + Math.random() * .5;
			this.particles.push({
				mesh,
				vel: new THREE.Vector3((Math.random() - .5) * 9, Math.random() * 7 + 1.5, (Math.random() - .5) * 9),
				life,
				maxLife: life
			});
		}
	}
	spawnRing(pos, color) {
		const mesh = makeImpactRing(color);
		mesh.position.copy(pos);
		this.scene.add(mesh);
		this.rings.push({
			mesh,
			life: .4,
			maxLife: .4,
			grow: 5.2
		});
	}
	spawnFloatText(worldPos, text, big = false) {
		if (!this.hudRoot || this.xrActive) return;
		const el = document.createElement("div");
		el.textContent = text;
		const size = big ? 20 : 15;
		const color = big ? "#ffd24a" : "#f2efe8";
		el.style.cssText = `position:absolute;pointer-events:none;font-weight:800;font-size:${size}px;color:${color};text-shadow:0 2px 8px rgba(0,0,0,.8),0 0 12px ${color}55;transform:translate(-50%,-50%) scale(0.5);white-space:nowrap;z-index:20;transition:transform 80ms cubic-bezier(.34,1.4,.64,1);`;
		this.hudRoot.appendChild(el);
		requestAnimationFrame(() => {
			el.style.transform = "translate(-50%,-50%) scale(1.15)";
		});
		const projected = worldPos.clone().project(this.camera);
		el.style.left = `${(projected.x * .5 + .5) * (this.canvas.clientWidth || 1)}px`;
		el.style.top = `${(-projected.y * .5 + .5) * (this.canvas.clientHeight || 1)}px`;
		this.floatTexts.push({
			el,
			life: .85,
			vy: 56
		});
	}
	frame = () => {
		if (this.disposed) return;
		this.clock.update();
		let dt = this.clock.getDelta();
		if (dt > .1) dt = .1;
		this.fpsAcc += dt;
		this.fpsFrames++;
		if (this.fpsAcc >= .5) {
			this.fps = Math.round(this.fpsFrames / this.fpsAcc);
			this.fpsAcc = 0;
			this.fpsFrames = 0;
			if (this.fps < 40 && this.quality > .7) {
				this.quality = .7;
				this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.25 : 1.5));
				if (this.bloomPass) this.bloomPass.strength = this.isMobile ? .3 : .45;
			} else if (this.fps > 55 && this.quality < 1) {
				this.quality = 1;
				this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.6 : 2));
			}
		}
		if (this.timeScale < 1) {
			this.timeScale += dt * 1.8;
			if (this.timeScale > 1) this.timeScale = 1;
		}
		const sdt = dt * this.timeScale;
		this.pollGamepad(sdt);
		this.update(sdt);
		this.render();
	};
	update(dt) {
		this.time += dt;
		if (this.bloomPass) {
			const target = this.isMobile ? .42 : .68;
			this.bloomPass.strength += (target - this.bloomPass.strength) * (1 - Math.exp(-2.8 * dt));
		}
		if (this.juicePass) {
			const shake = this.trauma * this.trauma;
			this.juicePass.uniforms.chroma.value = this.reducedMotion ? 0 : shake * 1.2;
			this.juicePass.uniforms.time.value = this.time;
			this.juicePass.uniforms.pulse.value = this.power >= .95 ? .5 + Math.sin(this.time * 8) * .5 : this.camKick;
			this.juicePass.uniforms.vignette.value = .38 + shake * .25;
		}
		if (this.punchLight && this.punchLightT > 0) {
			this.punchLightT -= dt;
			this.punchLight.intensity *= Math.max(0, 1 - dt * 14);
			if (this.punchLightT <= 0) this.punchLight.intensity = 0;
		}
		this.arenaRoot.traverse((o) => {
			if (o.name === "ambientOrb") {
				const bob = o.userData.bob || 0;
				o.position.y += Math.sin(this.time * 2 + bob) * .004;
				o.rotation.y += dt * 1.5;
			}
		});
		if (this.messageT > 0) {
			this.messageT -= dt;
			if (this.messageT <= 0) {
				this.message = "";
				this.paintXrHud(true);
				this.emitHud();
			}
		}
		if (this.dust) {
			this.dust.rotation.y += dt * .025;
			const arr = this.dust.geometry.attributes.position.array;
			for (let i = 0; i < arr.length; i += 3) arr[i + 1] += Math.sin(this.time + i) * .0025;
			this.dust.geometry.attributes.position.needsUpdate = true;
		}
		if (this.ambientMotes) {
			this.ambientMotes.position.copy(this.getPlayerPos());
			this.ambientMotes.rotation.y = this.time * .12;
		}
		// WebXR hands / thrust / exclusive mode mesh every frame while presenting
		if (this.xrActive) {
			this.updateXRInput(dt);
			if (this.phase === "playing") {
				this.xrPrevSelectL = this.xrSelectL;
				this.xrPrevSelectR = this.xrSelectR;
				const session = this.renderer.xr.getSession();
				const rig = this.playerRig;
				if (session && rig) for (const source of session.inputSources) {
					const gp = source.gamepad;
					if (!gp) continue;
					const stick = radialDeadzone(gp.axes[2] ?? gp.axes[0] ?? 0, gp.axes[3] ?? gp.axes[1] ?? 0, .18);
					if (stick.x !== 0 || stick.y !== 0) {
						const forward = new THREE.Vector3();
						this.camera.getWorldDirection(forward);
						forward.y = 0;
						if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
						forward.normalize();
						const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
						rig.position.addScaledVector(right, stick.x * 3.4 * dt);
						rig.position.addScaledVector(forward, -stick.y * 3.4 * dt);
						rig.position.x = THREE.MathUtils.clamp(rig.position.x, -3.2, 3.2);
						rig.position.z = THREE.MathUtils.clamp(rig.position.z, -8, 8);
						rig.position.y = 0;
					}
				}
			}
			// Only drop XR after grace period + sustained non-presenting
			// (isPresenting can be false for a few frames right after setSession)
			if (this.xrPresentGrace > 0) this.xrPresentGrace -= dt;
			else if (!this.renderer.xr.isPresenting && !this.xrEntering) {
				if (this.xrSession) {
					// Session object still around but not presenting — wait for end event
				} else {
					this.xrActive = false;
					this.platform = this.xrHeadset ? "xr" : this.isMobile ? "mobile" : "desktop";
				}
			}
		}
		// Webcam hand tracking
		if (this.cameraHands && this.handCam) {
			const fr = this.handCam.poll(performance.now());
			this.lastTrackFrame = fr;
			this.cameraHandsCount = fr.hands?.length || 0;
			const modes = this.handCam.getStableModes?.();
			if (modes?.L && modes.L !== this.modeL) this.applyHandMode("L", modes.L, false);
			if (modes?.R && modes.R !== this.modeR) this.applyHandMode("R", modes.R, false);
			for (const h of fr.hands || []) {
				this.cameraGesture = `${h.side}:${h.gesture || h.mode || "?"}${h.click ? "·CLICK" : ""}`;
				if (h.click) this.armClickBoost(h.side);
				// Social / emoji gesture props (hide combat models while held)
				const social = ["thumbs", "thumbsDown", "peace", "spock", "rockOn"];
				if (h.gesture && social.includes(h.gesture) && !this.heartPoseActive) {
					this.setHandGesture(h.side, h.gesture);
				} else if (!this.heartPoseActive && h.mode) {
					// Clear social prop when back to combat shape
					const curG = h.side === "L" ? this.handGestureL : this.handGestureR;
					if (curG && social.includes(curG)) this.setHandGesture(h.side, null);
				}

				// Grenade (camera): fist high → fling → open palm
				const gk = h.side === "L" ? "camGrenadeL" : "camGrenadeR";
				const high = (h.my ?? 0.5) < 0.42; // image y: smaller = higher
				const fist = h.mode === "punch" || h.gesture === "punch";
				const open = h.mode === "slap" || h.gesture === "slap";
				let cg = this[gk];
				if (fist && high) {
					if (!cg) cg = this[gk] = { t: this.time, peakThrust: 0, high: true, hadFist: true };
					cg.hadFist = true;
					cg.high = true;
					cg.peakThrust = Math.max(cg.peakThrust || 0, h.thrust || 0, h.lift || 0);
					cg.t = this.time;
				} else if (cg && cg.hadFist) {
					cg.peakThrust = Math.max(cg.peakThrust || 0, h.thrust || 0, h.lift || 0);
					// Open hand finishes the grenade throw
					if (open && high && (cg.peakThrust > 0.28 || (h.thrust || 0) > 0.35)) {
						const sp = THREE.MathUtils.clamp(0.4 + cg.peakThrust * 1.1, 0.35, 1.4);
						const hs = THREE.MathUtils.clamp(4 + cg.peakThrust * 22, 4, 28);
						this.tryAttack(h.side, {
							forceMode: "grenade",
							strikePower: sp,
							handSpeed: hs,
							fromMotion: true,
						});
						this[gk] = null;
						continue;
					}
					if (this.time - cg.t > 1.2 || !high) this[gk] = null;
				}

				if (h.strike || h.slap || h.uppercut) {
					// Skip normal punch if this looked like grenade windup still open-pending
					if (this[gk] && this[gk].hadFist && high) continue;
					const mag = h.slap
						? Math.max(h.swipe || 0, h.thrust || 0)
						: h.uppercut
							? Math.max(h.lift || 0, h.thrust || 0)
							: Math.max(h.thrust || 0, 0.35);
					const strikePower = THREE.MathUtils.clamp(0.25 + mag * 0.95, 0.25, 1.35);
					const opts = { strikePower, fromMotion: true };
					if (h.slap) {
						opts.forceMode = "slap";
						opts.slapStyle = Math.abs(h.swipe || 0) > 0.55 ? "sweep" : "wrist";
						opts.slapDir = h.slapDir || 0;
					}
					this.tryAttack(h.side, opts);
				}
			}
		}
		// Two-hand heart → shield
		if (this.cameraHands && this.lastTrackFrame?.hands) {
			const ok = this.detectTwoHandHeartCam(this.lastTrackFrame.hands);
			if (ok) {
				this.heartDetectHold = (this.heartDetectHold || 0) + dt;
				if (this.heartDetectHold > 0.28) {
					this.spawnHeartShield();
					this.heartDetectHold = -0.8; // debounce hold
				}
			} else {
				this.heartDetectHold = Math.max(0, (this.heartDetectHold || 0) - dt * 2);
			}
		}
		// Restore hands after projectile hide
		if (this.leftReturnAt > 0 && this.time >= this.leftReturnAt) {
			if (!this.xrActive) { this.leftGlove.visible = true; this.setViewHandOpacity("L", 1); }
			else if (this.xrGloveL) { this.xrGloveL.visible = true; this.syncXrGloves(); }
			this.leftReturnAt = 0;
		}
		if (this.rightReturnAt > 0 && this.time >= this.rightReturnAt) {
			if (!this.xrActive) { this.rightGlove.visible = true; this.setViewHandOpacity("R", 1); }
			else if (this.xrGloveR) { this.xrGloveR.visible = true; this.syncXrGloves(); }
			this.rightReturnAt = 0;
		}
		// Keep click-charge glow on current hand models (mode swaps rebuild meshes)
		if (this.clickBoostL) {
			this.clickGlowL = Math.min(1, this.clickGlowL + dt * 0.5);
			if ((Math.floor(this.time * 8) % 2) === 0) this.applyClickGlow("L", true);
		}
		if (this.clickBoostR) {
			this.clickGlowR = Math.min(1, this.clickGlowR + dt * 0.5);
			if ((Math.floor(this.time * 8) % 2) === 0) this.applyClickGlow("R", true);
		}
		if (this.xrActive) this.paintXrHud(false);
		// Box3D Wasm step (crates / grenades / shots)
		if (this.phase !== "paused" && sharedPhysics.ready) {
			this.syncPhysics(dt);
		}
		// Always tick attack cooldowns (except hard pause) so punches never stick
		if (this.phase !== "paused") {
			this.leftCd = Math.max(0, this.leftCd - dt);
			this.rightCd = Math.max(0, this.rightCd - dt);
			this.leftPunchT = Math.max(0, this.leftPunchT - dt * 3.8);
			this.rightPunchT = Math.max(0, this.rightPunchT - dt * 3.8);
			if (this.timeScale < 1) {
				this.timeScale = Math.min(1, this.timeScale + dt * 1.8);
			}
		}
		if (this.phase !== "playing") {
			this.updateHandsVisual(dt);
			this.updateParticles(dt);
			this.updateRings(dt);
			// Practice punches fly with UI up (menu / wave clear / readying / etc.)
			if (this.phase !== "paused") {
				this.updatePracticeShots(dt);
			}
			this.trauma = Math.max(0, this.trauma - dt * 1.5);
			this.camKick = Math.max(0, this.camKick - dt * 2);
			return;
		}
		if (this.hitstop > 0) {
			this.hitstop -= dt / Math.max(.2, this.timeScale);
			this.updateHandsVisual(dt * .15);
			this.updateParticles(dt);
			this.updateRings(dt);
			// Keep projectiles moving during hitstop
			this.updatePracticeShots(dt);
			return;
		}
		if (!this.xrActive) {
			this.yaw -= this.lookX + this.gamepadLookX;
			this.pitch -= this.lookY + this.gamepadLookY;
			this.lookX = 0;
			this.lookY = 0;
			this.gamepadLookX = 0;
			this.gamepadLookY = 0;
			this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
			const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
			const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
			let mx = this._gpMx;
			let mz = this._gpMz;
			if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) mz += 1;
			if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) mz -= 1;
			if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mx -= 1;
			if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mx += 1;
			const move = forward.multiplyScalar(mz).add(right.multiplyScalar(mx));
			let moving = false;
			if (move.lengthSq() > 0) {
				moving = true;
				move.normalize().multiplyScalar(3.5 * dt);
				this.camera.position.x += move.x;
				this.camera.position.z += move.z;
			}
			this.railZ += dt * .4;
			this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -3.2, 3.2);
			this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -this.railZ - 2, -this.railZ + 4);
			this.camera.position.y = 1.55;
			this.camera.rotation.order = "YXZ";
			this.camera.rotation.y = this.yaw;
			this.camera.rotation.x = this.pitch;
			this.bob += dt * (moving ? 12 : 3.2);
		}
		if (this.charging || this.keys.has("Space")) {
			if (typeof this.powerSpin !== "number") this.powerSpin = 0;
			if (typeof this.power !== "number" || Number.isNaN(this.power)) this.power = 0;
			this.powerSpin += dt * 5.5;
			this.power = Math.min(1, this.power + dt * .4);
			this.emitHud();
		}
		this.leftCd = Math.max(0, this.leftCd - dt);
		this.rightCd = Math.max(0, this.rightCd - dt);
		this.leftPunchT = Math.max(0, this.leftPunchT - dt * 3.8);
		this.rightPunchT = Math.max(0, this.rightPunchT - dt * 3.8);
		if (this.gestureT > 0) {
			this.gestureT -= dt;
			if (this.gestureT <= 0) this.gesturePose = "none";
		}
		if (this.comboTimer > 0) {
			this.comboTimer -= dt;
			if (this.comboTimer <= 0) {
				this.combo = 0;
				this.emitHud();
			}
		}
		if (this.mobileFireL) this.tryAttack("L");
		if (this.mobileFireR) this.tryAttack("R");
		for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
			const s = this.spawnQueue[i];
			s.t -= dt;
			if (s.t <= 0) {
				this.spawnEnemy(s.type);
				this.spawnQueue.splice(i, 1);
				this.emitHud();
			}
		}
		this.nextHazard -= dt;
		if (this.nextHazard <= 0) {
			this.spawnHazard();
			this.nextHazard = Math.max(1.1, 2.8 - this.wave * .18) + Math.random();
		}
		this.updateEntities(dt);
		this.updateParticles(dt);
		this.updateRings(dt);
		this.updateFloatTexts(dt);
		this.updateHandsVisual(dt);
		this.trauma = Math.max(0, this.trauma - dt * 1.45);
		this.camKick = Math.max(0, this.camKick - dt * 2.2);
	}
	/** Move glove / slap projectiles without advancing combat (safe for UI phases). */
	updatePracticeShots(dt) {
		for (const e of this.entities) {
			if (!e.alive) continue;
			if (e.kind === "grenade") {
				if (e.body && sharedPhysics.ready) {
					sharedPhysics.syncMesh(e.body, e.mesh);
				} else {
					e.vel.y -= (e.gravity || 9.5) * dt;
					e.mesh.position.addScaledVector(e.vel, dt);
				}
				if (e.trail && e.trail.points) this.updateLaceTrail(e.trail, e.mesh.position, dt);
				e.age += dt; e.life -= dt;
				if (e.age >= (e.fuse || 3) || e.life <= 0) this.explodeGrenade(e);
				continue;
			}
			if (e.kind === "blastSphere") {
				e.age += dt; e.life -= dt;
				const u = Math.max(0, e.life / 0.85);
				if (e.mesh && e.mesh.material) { e.mesh.material.opacity = 0.38 * u; e.mesh.scale.setScalar(1 + (1 - u) * 0.25); }
				if (e.ring && e.ring.material) { e.ring.material.opacity = 0.28 * u; e.ring.scale.setScalar(1 + (1 - u) * 0.4); }
				if (e.life <= 0) { e.alive = false; this.scene.remove(e.mesh); if (e.ring) this.scene.remove(e.ring); }
				continue;
			}
			if (e.kind === "funBox") {
				// Driven by sharedPhysics.step in frame
				continue;
			}
			if (e.kind !== "gloveShot") continue;
			e.age += dt;
			const prev = this.tmp2.copy(e.mesh.position);
			if (e.slapWave && e.fwd && e.rightAxis && e.pathOrigin) {
				const tt = e.age;
				const lat = Math.sin(tt * e.slapFreq + e.slapPhase) * e.slapAmp;
				e.mesh.position.copy(e.pathOrigin).addScaledVector(e.fwd, e.speed * tt).addScaledVector(e.rightAxis, lat);
				const latVel = Math.cos(tt * e.slapFreq + e.slapPhase) * e.slapAmp * e.slapFreq;
				const travel = e.fwd.clone().multiplyScalar(e.speed).addScaledVector(e.rightAxis, latVel);
				if (travel.lengthSq() > 1e-6) {
					e.vel.copy(travel);
					e.mesh.lookAt(e.mesh.position.clone().add(travel));
				}
			} else {
				e.mesh.position.addScaledVector(e.vel, dt);
				e.mesh.rotateZ(dt * 16);
			}
			if (e.trail) {
				if (e.trail.points) this.updateLaceTrail(e.trail, e.mesh.position, dt);
				else if (e.trail.geometry) {
					const arr = e.trail.geometry.attributes.position.array;
					for (let i = arr.length - 3; i >= 3; i -= 3) {
						arr[i] = arr[i - 3];
						arr[i + 1] = arr[i - 2];
						arr[i + 2] = arr[i - 1];
					}
					arr[0] = e.mesh.position.x;
					arr[1] = e.mesh.position.y;
					arr[2] = e.mesh.position.z;
					e.trail.geometry.attributes.position.needsUpdate = true;
				}
			}
			const hitColor = this.trailColorForMode(e.shotMode || (e.slapWave ? "slap" : "punch"), e.powered);
			for (const other of this.entities) {
				if (!other.alive || (other.kind !== "enemy" && other.kind !== "hazard" && other.kind !== "funBox")) continue;
				if (e.hitIds && e.hitIds.has(other.id)) continue;
				const body = other.mesh.position.clone();
				body.y += other.kind === "hazard" ? 0.15 : other.kind === "funBox" ? 0 : 0.65;
				const hitR = other.radius + e.radius;
				if (body.distanceTo(e.mesh.position) < hitR || body.distanceTo(prev) < hitR) {
					if (e.hitIds) e.hitIds.add(other.id);
					const knock = e.vel.lengthSq() > 1e-6 ? e.vel.clone().normalize() : new THREE.Vector3(0, 0, -1);
					if (other.kind === "hazard" && typeof this.destroyHazard === "function") this.destroyHazard(other, true);
					else if (other.kind === "funBox") this.knockFunBox(other, knock, e.slapWave ? 12 : 8);
					else if (other.kind === "enemy") {
						this._suppressHitSfx = true;
						this.damageEnemy(other, e.damage, knock);
						this._suppressHitSfx = false;
					}
					if (other.kind !== "funBox") {
						const mode = e.shotMode || (e.slapWave ? "slap" : "punch");
						if (this.audio.projectileHit) this.audio.projectileHit(mode, 0.85);
						else this.audio.hit();
					}
					this.spawnRing(body, hitColor);
					this.burst(body, hitColor, e.slapWave ? 18 : 12);
					if (other.kind === "funBox") continue;
					if (!e.slapWave && !e.powered) {
						e.alive = false;
						this.scene.remove(e.mesh);
						if (e.trail) { if (e.trail.points) this.disposeLaceTrail(e.trail); else this.scene.remove(e.trail); }
						break;
					}
				}
			}
			e.life -= dt;
			if (e.life <= 0) {
				e.alive = false;
				this.scene.remove(e.mesh);
				if (e.trail) { if (e.trail.points) this.disposeLaceTrail(e.trail); else this.scene.remove(e.trail); }
			}
		}
	}
	updateEntities(dt) {
		const playerPos = this.getPlayerPos();
		for (const e of this.entities) {
			if (!e.alive) continue;
			e.age += dt;
			if (e.kind === "enemy" && e.age < .35) e.mesh.scale.setScalar(1 - Math.pow(1 - e.age / .35, 3));
			else if (e.kind === "enemy") {
				e.squash += (1 - e.squash) * (1 - Math.exp(-10 * dt));
				e.mesh.scale.set(1 / Math.sqrt(e.squash), e.squash, 1 / Math.sqrt(e.squash));
			}
			if (e.kind === "heartShield") {
				// Follow player aim, pulse, damage touchers
				const fwd = new THREE.Vector3();
				this.camera.getWorldDirection(fwd);
				if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
				const flat = fwd.clone(); flat.y = 0;
				if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
				flat.normalize();
				const dist = this.xrActive ? 1.2 : 1.55;
				const base = playerPos.clone().addScaledVector(flat, dist);
				base.y = playerPos.y; // stay at player/camera height
				e.mesh.position.lerp(base, 1 - Math.exp(-10 * dt));
				e.mesh.lookAt(base.clone().add(flat));
				const lifeLeft = Math.max(0, (e.life || 5) - e.age);
				const pulse = 1 + Math.sin(this.time * 6) * 0.06;
				const fade = lifeLeft < 1.2 ? Math.max(0.15, lifeLeft / 1.2) : 1;
				e.mesh.scale.setScalar(pulse * (0.85 + 0.15 * fade));
				e.mesh.traverse((o) => {
					const m = o;
					if (m.isMesh && m.material && "opacity" in m.material) {
						m.material.opacity = (m.userData.baseOp ?? m.material.opacity) * fade;
						if (m.userData.baseOp == null) m.userData.baseOp = m.material.opacity / Math.max(0.01, fade);
					}
				});
				e.attackCd -= dt;
				// Damage + shove enemies that touch the shield
				if (e.attackCd <= 0) {
					let hitAny = false;
					for (const other of this.entities) {
						if (!other.alive || other === e) continue;
						if (other.kind !== "enemy" && other.kind !== "hazard") continue;
						const d = e.mesh.position.distanceTo(other.mesh.position);
						const reach = e.radius + (other.radius || 0.5);
						if (d < reach) {
							hitAny = true;
							const knock = other.mesh.position.clone().sub(e.mesh.position);
							knock.y = 0.2;
							if (knock.lengthSq() < 1e-6) knock.copy(flat);
							knock.normalize();
							if (other.kind === "enemy") {
								this.damageEnemy(other, e.damage, knock);
								other.mesh.position.addScaledVector(knock, 1.1);
								this.keepEnemyOnPath(other);
							} else {
								other.alive = false;
								if (other.mesh?.parent) other.mesh.parent.remove(other.mesh);
								this.burst(other.mesh.position.clone(), 0xff6aa8, 10);
							}
						}
					}
					if (hitAny) {
						e.attackCd = 0.22;
						if (this.audio.heartShieldHit) this.audio.heartShieldHit();
						this.burst(e.mesh.position.clone(), 0xff4d8d, 8);
					}
				}
				if (e.age >= (e.life || 5)) {
					e.alive = false;
					if (e.mesh?.parent) e.mesh.parent.remove(e.mesh);
					if (this.heartShieldEntity === e) this.heartShieldEntity = null;
					this.exitHeartPose();
				}
			} else if (e.kind === "enemy") {
				const toPlayer = this.tmp.copy(playerPos).sub(e.mesh.position);
				toPlayer.y = 0;
				const dist = toPlayer.length();
				const speed = e.enemyType === "rusher" ? 0.95 + this.wave * .04 : e.enemyType === "thrower" ? 0.4 : 0.58;
				if (dist > 1.45) {
					toPlayer.normalize();
					e.mesh.position.addScaledVector(toPlayer, speed * dt);
				}
				this.keepEnemyOnPath(e);
				e.mesh.lookAt(playerPos.x, e.mesh.position.y, playerPos.z);
				e.mesh.position.y = Math.sin(this.time * 5 + e.id) * .06;
				if (e.bar) e.bar.quaternion.copy(this.camera.quaternion);
				e.attackCd -= dt;
				if (e.enemyType === "thrower" && e.attackCd <= 0 && dist < 14 && dist > 3) {
					e.attackCd = 2.1;
					this.throwFromEnemy(e);
				}
				// Block melee if heart shield is up and roughly in front
				const shieldUp = this.heartShieldEntity && this.heartShieldEntity.alive;
				const blocked = shieldUp && dist < 2.4 && e.mesh.position.distanceTo(this.heartShieldEntity.mesh.position) < 1.8;
				if (dist < 1.4 && e.attackCd <= 0) {
					e.attackCd = e.enemyType === "rusher" ? .85 : 1.25;
					if (blocked) {
						this.damageEnemy(e, 14, toPlayer.clone().normalize().multiplyScalar(-1));
						this.burst(this.heartShieldEntity.mesh.position.clone(), 0xff4d8d, 12);
						if (this.audio.heartShieldHit) this.audio.heartShieldHit();
					} else {
						this.hurtPlayer(e.damage);
						this.burst(playerPos.clone(), 16737894, 12);
					}
				}
				if (e.flash > 0) {
					e.flash -= dt;
					if (e.flash <= 0) e.mesh.traverse((o) => {
						const m = o;
						if (m.isMesh && m.material && "emissive" in m.material) m.material.emissiveIntensity = .28;
					});
				}
			} else if (e.kind === "gloveShot") {
				const prev = this.tmp2.copy(e.mesh.position);
				if (e.slapWave && e.fwd && e.rightAxis && e.pathOrigin) {
					const tt = e.age;
					const lat = Math.sin(tt * e.slapFreq + e.slapPhase) * e.slapAmp;
					e.mesh.position.copy(e.pathOrigin).addScaledVector(e.fwd, e.speed * tt).addScaledVector(e.rightAxis, lat);
					const latVel = Math.cos(tt * e.slapFreq + e.slapPhase) * e.slapAmp * e.slapFreq;
					const travel = e.fwd.clone().multiplyScalar(e.speed).addScaledVector(e.rightAxis, latVel);
					if (travel.lengthSq() > 1e-6) {
						e.vel.copy(travel);
						e.mesh.lookAt(e.mesh.position.clone().add(travel));
					}
				} else if (e.body && sharedPhysics.ready && !e.slapWave) {
					// Non-slap projectiles: Box3D drives the mesh
					sharedPhysics.syncMesh(e.body, e.mesh);
					if (!this._physVel) this._physVel = { x: 0, y: 0, z: 0 };
					sharedPhysics.getLinearVelocity(e.body, this._physVel);
					e.vel.set(this._physVel.x, this._physVel.y, this._physVel.z);
					e.mesh.rotateZ(dt * 16);
				} else {
					e.mesh.position.addScaledVector(e.vel, dt);
					e.mesh.rotateZ(dt * 16);
					// Keep kinematic body following slap path if present
					if (e.body && sharedPhysics.ready) {
						sharedPhysics.setLinearVelocity(e.body, e.vel.x, e.vel.y, e.vel.z);
					}
				}
				if (e.trail) {
					if (e.trail.points) this.updateLaceTrail(e.trail, e.mesh.position, dt);
					else if (e.trail.geometry) {
						const arr = e.trail.geometry.attributes.position.array;
						for (let i = arr.length - 3; i >= 3; i -= 3) {
							arr[i] = arr[i - 3];
							arr[i + 1] = arr[i - 2];
							arr[i + 2] = arr[i - 1];
						}
						arr[0] = e.mesh.position.x;
						arr[1] = e.mesh.position.y;
						arr[2] = e.mesh.position.z;
						e.trail.geometry.attributes.position.needsUpdate = true;
					}
				}
				const hitColor = this.trailColorForMode(e.shotMode || (e.slapWave ? "slap" : "punch"), e.powered);
				for (const other of this.entities) {
					if (!other.alive || (other.kind !== "enemy" && other.kind !== "hazard" && other.kind !== "funBox")) continue;
					if (e.hitIds && e.hitIds.has(other.id)) continue;
					const body = other.mesh.position.clone();
					body.y += other.kind === "hazard" ? 0.15 : other.kind === "funBox" ? 0 : 0.65;
					const hitR = other.radius + e.radius;
					if (body.distanceTo(e.mesh.position) < hitR || body.distanceTo(prev) < hitR) {
						if (e.hitIds) e.hitIds.add(other.id);
						const knock = e.vel.lengthSq() > 1e-6 ? e.vel.clone().normalize() : new THREE.Vector3(0, 0, -1);
						if (other.kind === "hazard") this.destroyHazard(other, true);
						else if (other.kind === "funBox") this.knockFunBox(other, knock, e.slapWave ? 12 : Math.min(14, 4 + e.speed * 0.35));
						else {
							this._suppressHitSfx = true;
							this.damageEnemy(other, e.damage, knock);
							this._suppressHitSfx = false;
						}
						// Impact SFX for projectile connect (wood handled in knockFunBox)
						if (other.kind !== "funBox") {
							const mode = e.shotMode || (e.slapWave ? "slap" : "punch");
							const pow = THREE.MathUtils.clamp((e.speed || 10) / 24, 0.45, 1.2);
							if (this.audio.projectileHit) this.audio.projectileHit(mode, pow);
							else this.audio.hit();
						}
						this.spawnRing(body, hitColor);
						this.burst(body, hitColor, e.slapWave ? 22 : 16);
						if (other.kind === "funBox") {
							// Projectiles keep going through crates for more mess
							continue;
						}
						if (e.slapWave) e.damage *= 0.88;
						else if (!e.powered) {
							e.alive = false;
							this.destroyEntityBody(e);
							this.scene.remove(e.mesh);
							if (e.trail) { if (e.trail.points) this.disposeLaceTrail(e.trail); else this.scene.remove(e.trail); }
							break;
						} else e.damage *= 0.65;
					}
				}
				e.life -= dt;
				if (e.life <= 0) {
					e.alive = false;
					this.destroyEntityBody(e);
					this.scene.remove(e.mesh);
					if (e.trail) { if (e.trail.points) this.disposeLaceTrail(e.trail); else this.scene.remove(e.trail); }
				}
			} else if (e.kind === "grenade") {
				const prev = this.tmp2.copy(e.mesh.position);
				if (e.body && sharedPhysics.ready) {
					// Position/rotation from Box3D
					sharedPhysics.syncMesh(e.body, e.mesh);
					if (!this._physVel) this._physVel = { x: 0, y: 0, z: 0 };
					sharedPhysics.getLinearVelocity(e.body, this._physVel);
					e.vel.set(this._physVel.x, this._physVel.y, this._physVel.z);
				} else {
					e.vel.y -= (e.gravity || 9.5) * dt;
					e.mesh.position.addScaledVector(e.vel, dt);
					e.mesh.rotation.x += dt * 8;
					e.mesh.rotation.z += dt * 5;
					if (e.mesh.position.y < 0.12) {
						e.mesh.position.y = 0.12;
						if (e.vel.y < 0) e.vel.y *= -0.35;
						e.vel.x *= 0.82; e.vel.z *= 0.82;
					}
				}
				if (e.trail && e.trail.points) this.updateLaceTrail(e.trail, e.mesh.position, dt);
				// Fuse tick sound
				e.tickAcc = (e.tickAcc || 0) + dt;
				const fuseLeft = (e.fuse || 3) - e.age;
				const tickRate = fuseLeft < 1 ? 0.12 : 0.28;
				if (e.tickAcc > tickRate) {
					e.tickAcc = 0;
					if (this.audio.grenadeTick) this.audio.grenadeTick();
				}
				e.age += dt;
				e.life -= dt;
				if (e.age >= (e.fuse || 3) || e.life <= 0) {
					this.explodeGrenade(e);
				}
			} else if (e.kind === "blastSphere") {
				e.age += dt;
				e.life -= dt;
				const u = Math.max(0, e.life / 0.85);
				if (e.mesh && e.mesh.material) {
					e.mesh.material.opacity = 0.38 * u;
					const s = 1 + (1 - u) * 0.25;
					e.mesh.scale.setScalar(s);
				}
				if (e.ring && e.ring.material) {
					e.ring.material.opacity = 0.28 * u;
					e.ring.scale.setScalar(1 + (1 - u) * 0.4);
				}
				if (e.life <= 0) {
					e.alive = false;
					this.scene.remove(e.mesh);
					if (e.ring) this.scene.remove(e.ring);
				}
						} else if (e.kind === "funBox") {
				// Mesh is driven by Box3D Wasm each frame in syncPhysics()
				e.age += dt;
				if (e.body && sharedPhysics.ready) {
					if (!this._physVel) this._physVel = { x: 0, y: 0, z: 0 };
					sharedPhysics.getLinearVelocity(e.body, this._physVel);
					const sp2 = this._physVel.x ** 2 + this._physVel.y ** 2 + this._physVel.z ** 2;
					e.settled = sp2 < 0.04;
					// Landing thud
					if (!e._wasSettled && e.settled && e.age > 0.2) {
						if (this.audio.impact) this.audio.impact("thud", 0.55);
					}
					e._wasSettled = e.settled;
				}
				if (e.age > 18 && e.mesh.position.distanceTo(this.getPlayerPos()) > 24) {
					e.alive = false;
					this.destroyEntityBody(e);
					this.scene.remove(e.mesh);
				}
			} else if (e.kind === "hazard") {
				e.mesh.position.addScaledVector(e.vel, dt);
				e.vel.y -= 4.5 * dt;
				e.mesh.rotation.x += dt * 5;
				e.mesh.rotation.z += dt * 3.5;
				e.life -= dt;
				if (e.mesh.position.distanceTo(playerPos) < .6 + e.radius) {
					this.destroyHazard(e, false);
					this.hurtPlayer(e.damage);
				} else if (e.life <= 0 || e.mesh.position.y < -1) {
					e.alive = false;
					this.scene.remove(e.mesh);
				}
			} else if (e.kind === "pickup") {
				e.mesh.position.y = 1.15 + Math.sin(this.time * 3.5 + e.id) * .18;
				e.mesh.rotation.y += dt * 2.6;
				e.mesh.rotation.z = Math.sin(this.time * 2) * .15;
				e.mesh.scale.setScalar(1 + Math.sin(this.time * 5) * .08);
				e.life -= dt;
				if (e.mesh.position.distanceTo(playerPos) < 1.3) {
					e.alive = false;
					this.scene.remove(e.mesh);
					this.power = 1;
					this.health = Math.min(this.maxHealth, this.health + 14);
					this.score += 80;
					this.audio.powerup();
					this.pushMsg("POWER STAR!", 1.2);
					this.burst(e.mesh.position.clone(), 16765514, 28);
					this.spawnRing(e.mesh.position.clone(), 16765514);
					if (this.bloomPass) this.bloomPass.strength = 1.2;
					this.timeScale = .4;
					this.emitHud();
				} else if (e.life <= 0) {
					e.alive = false;
					this.scene.remove(e.mesh);
				}
			}
		}
		this.entities = this.entities.filter((e) => e.alive);
	}
	throwFromEnemy(e) {
		const mesh = Math.random() > .5 ? makeBottle(this.palette) : makeCrate(this.palette);
		mesh.position.copy(e.mesh.position);
		mesh.position.y = 1.25;
		this.scene.add(mesh);
		const to = this.getPlayerPos().clone().sub(mesh.position).normalize();
		to.y += .14;
		to.normalize();
		this.entities.push({
			id: this.idSeq++,
			kind: "hazard",
			mesh,
			alive: true,
			hp: 1,
			maxHp: 1,
			radius: .22,
			vel: to.multiplyScalar(7.2 + this.wave * .2),
			age: 0,
			life: 4,
			damage: 10,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 60,
			hand: null,
			powered: false,
			squash: 1
		});
	}
	updateParticles(dt) {
		for (let i = this.particles.length - 1; i >= 0; i--) {
			const p = this.particles[i];
			p.life -= dt;
			p.vel.y -= 11 * dt;
			p.mesh.position.addScaledVector(p.vel, dt);
			p.mesh.rotation.x += dt * 10;
			p.mesh.rotation.y += dt * 8;
			const t = p.life / p.maxLife;
			p.mesh.scale.setScalar(.4 + t * 1.1);
			p.mesh.material.opacity = Math.max(0, t);
			if (p.life <= 0) {
				this.scene.remove(p.mesh);
				if (this.particlePool.length < 80) this.particlePool.push(p.mesh);
				else p.mesh.material.dispose();
				this.particles.splice(i, 1);
			}
		}
	}
	updateRings(dt) {
		for (let i = this.rings.length - 1; i >= 0; i--) {
			const r = this.rings[i];
			r.life -= dt;
			const t = 1 - r.life / r.maxLife;
			r.mesh.scale.setScalar(1 + t * r.grow);
			r.mesh.material.opacity = Math.max(0, 1 - t);
			if (r.life <= 0) {
				this.scene.remove(r.mesh);
				r.mesh.material.dispose();
				r.mesh.geometry.dispose();
				this.rings.splice(i, 1);
			}
		}
	}
	updateFloatTexts(dt) {
		for (let i = this.floatTexts.length - 1; i >= 0; i--) {
			const f = this.floatTexts[i];
			f.life -= dt;
			f.el.style.top = `${parseFloat(f.el.style.top || "0") - f.vy * dt}px`;
			f.el.style.opacity = String(Math.max(0, f.life / .85));
			if (f.life <= 0) {
				f.el.remove();
				this.floatTexts.splice(i, 1);
			}
		}
	}
	updateHandsVisual(dt) {
		if (this.xrActive) return;
		const bobY = Math.sin(this.bob) * .024;
		const bobX = Math.cos(this.bob * .5) * .014;
		const punchOffset = (t) => 1 - Math.pow(1 - Math.min(1, t > .5 ? (1 - t) * 2 : t * 2), 2);
		const lTarget = this.leftRest.clone();
		const rTarget = this.rightRest.clone();
		lTarget.y += bobY;
		rTarget.y += bobY;
		lTarget.x += bobX;
		rTarget.x -= bobX;
		if (this.leftPunchT > 0) {
			const p = punchOffset(1 - this.leftPunchT);
			lTarget.z -= .58 * p;
			lTarget.y += .14 * p;
			if (this.mode === "slap") {
				lTarget.x -= .22 * p;
				this.leftGlove.rotation.z = -1.15 * p;
			} else if (this.mode === "poke") lTarget.z -= .22 * p;
			else this.leftGlove.rotation.x = -.55 * p;
			this.leftGlove.scale.setScalar(1 + p * .08);
		} else {
			this.leftGlove.rotation.x *= .78;
			this.leftGlove.rotation.z *= .78;
			this.leftGlove.scale.setScalar(1);
		}
		if (this.rightPunchT > 0) {
			const p = punchOffset(1 - this.rightPunchT);
			rTarget.z -= .58 * p;
			rTarget.y += .14 * p;
			if (this.mode === "slap") {
				rTarget.x += .22 * p;
				this.rightGlove.rotation.z = 1.15 * p;
			} else if (this.mode === "poke") rTarget.z -= .22 * p;
			else this.rightGlove.rotation.x = -.55 * p;
			this.rightGlove.scale.setScalar(1 + p * .08);
		} else {
			this.rightGlove.rotation.x *= .78;
			this.rightGlove.rotation.z *= .78;
			this.rightGlove.scale.setScalar(1);
		}
		if (this.heartPoseActive) {
			// Halves meet in front of camera
			lTarget.set(-0.1, -0.06, -0.52);
			rTarget.set(0.1, -0.06, -0.52);
			this.leftGlove.rotation.set(0, 0.35, 0.15);
			this.rightGlove.rotation.set(0, -0.35, -0.15);
			if (this.heartConnectMesh) {
				const a = this.leftPos.clone();
				const b = this.rightPos.clone();
				const mid = a.clone().add(b).multiplyScalar(0.5);
				const dist = a.distanceTo(b);
				this.heartConnectMesh.position.copy(mid);
				this.heartConnectMesh.scale.set(1, Math.max(0.05, dist), 1);
				this.heartConnectMesh.lookAt(b);
				this.heartConnectMesh.rotateX(Math.PI / 2);
				this.heartConnectMesh.visible = dist > 0.04;
			}
		} else if (this.heartConnectMesh) {
			this.heartConnectMesh.visible = false;
		}
		if (this.gesturePose !== "none" && !this.heartPoseActive) {
			const g = Math.min(1, this.gestureT * 2);
			if (this.gesturePose === "thumbs") {
				rTarget.set(.22, .08, -.5);
				this.rightGlove.rotation.z = .2 * g;
			} else if (this.gesturePose === "thumbsDown") {
				rTarget.set(.22, -.05, -.5);
				this.rightGlove.rotation.z = Math.PI * g;
			} else if (this.gesturePose === "peace" || this.gesturePose === "spock") {
				rTarget.set(.2, .1, -.5);
				lTarget.set(-.2, .1, -.5);
			} else if (this.gesturePose === "wave") {
				rTarget.set(.4, .2, -.48);
				this.rightGlove.rotation.z = Math.sin(this.time * 12) * .55 * g;
			} else if (this.gesturePose === "taunt" || this.gesturePose === "rockOn") {
				rTarget.set(.18, .14, -.48);
				lTarget.set(-.18, .14, -.48);
			} else {
				rTarget.set(.14, .1, -.5);
				lTarget.set(-.14, .1, -.5);
			}
		}
		// Clear social gesture props when timer ends
		if (this.gestureT <= 0 && (this.handGestureL || this.handGestureR) && !this.heartPoseActive) {
			const social = ["thumbs", "thumbsDown", "peace", "spock", "rockOn"];
			if (this.handGestureL && social.includes(this.handGestureL)) this.setHandGesture("L", null);
			if (this.handGestureR && social.includes(this.handGestureR)) this.setHandGesture("R", null);
		}
		if (this.charging || this.keys.has("Space")) {
			const a = this.powerSpin;
			lTarget.x = -.28 + Math.cos(a) * .18;
			lTarget.y = -.22 + Math.sin(a) * .18;
			rTarget.x = .28 + Math.cos(a + Math.PI) * .18;
			rTarget.y = -.22 + Math.sin(a + Math.PI) * .18;
		}
		this.leftPos.lerp(lTarget, 1 - Math.exp(-16 * dt));
		this.rightPos.lerp(rTarget, 1 - Math.exp(-16 * dt));
		this.leftGlove.position.copy(this.leftPos);
		this.rightGlove.position.copy(this.rightPos);
		if (this.leftPunchT <= 0 && this.gesturePose === "none") {
			this.leftGlove.rotation.x = Math.sin(this.time * 2.1) * .06;
			this.leftGlove.rotation.y = .22;
		}
		if (this.rightPunchT <= 0 && this.gesturePose === "none") {
			this.rightGlove.rotation.x = Math.sin(this.time * 2.1 + 1) * .06;
			this.rightGlove.rotation.y = -.22;
		}
	}
	render() {
		const shakeAmt = this.reducedMotion ? 0 : this.trauma * this.trauma;
		const t = this.time * 40 + this.noiseSeed;
		const n1 = Math.sin(t * 1.7) * Math.cos(t * 1.1);
		const n2 = Math.sin(t * 2.3 + 1.3) * Math.cos(t * .9);
		const n3 = Math.sin(t * 1.9 + 2.1);
		const ox = !this.xrActive ? n1 * shakeAmt * .16 : 0;
		const oy = !this.xrActive ? n2 * shakeAmt * .14 : 0;
		const orot = !this.xrActive ? n3 * shakeAmt * .035 : 0;
		const kick = this.camKick * this.camKick * .1;
		const base = this.camera.position.clone();
		const baseRotZ = this.camera.rotation.z;
		if (!this.xrActive) {
			this.camera.position.x += ox;
			this.camera.position.y += oy;
			this.camera.rotation.z = orot;
			this.camera.fov = 78 + kick * 28;
			this.camera.updateProjectionMatrix();
		}
		if (this.xrActive || this.renderer.xr.isPresenting) {
			// XR path: let Three/WebXR own the framebuffer — no manual clear, no composer, no overlay
			this.renderer.render(this.scene, this.camera);
		} else {
			this.renderer.clear();
			if (!this.composer) this.renderer.render(this.scene, this.camera);
			else this.composer.render();
			this.renderer.clearDepth();
			this.renderer.render(this.overlayScene, this.overlayCam);
			this.camera.position.copy(base);
			this.camera.rotation.z = baseRotZ;
			this.camera.fov = 78;
			this.camera.updateProjectionMatrix();
		}
	}
}
