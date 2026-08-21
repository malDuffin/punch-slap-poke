// @ts-nocheck
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
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
  setHeartHalfGlow,
  makeHeavyBagRig,
  makeGumballMachine,
  makeGumball,
  GUMBALL_COLORS,
  makeArenaTree,
  makeFallingLeaf,
  makeMovingWalkway,
  makeSpeedLever,
  makeTutorialPoseGuide,
  placePoseGuide,
  preloadPoseGuideHands,
  poseGuidesReady,
} from "./meshes";
import { PartyArena, slotWorldX } from "../../lib/multiplayer/partyClient";
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
const TUTORIAL_ORDER = ["wave", "punch", "slap", "poke", "heart", "enter", "countdown"];
const TUTORIAL_SCRIPT = {
	wave: {
		lock: "wave", need: 5,
		title: "WAVE TO START",
		body: "Wave slowly both ways for five seconds — left then right, up then down from the elbow, or a small wrist twist each way. One-way drifting doesn't count. Keep going to fill the waveometer; stop and it drains back.",
		hint: "Waveometer · 5s",
	},
	punch: {
		lock: "punch", need: 3,
		title: "ROCK — FIST",
		body: "Close a fist. Match the outline above your hand — the glove appears only on a real fist. Then punch three times.",
		hint: "Fist first, then punch",
	},
	slap: {
		lock: "slap", need: 3,
		title: "PAPER — OPEN HAND",
		body: "Open your hand, palm facing forward. Match the outline — the fish appears only on an open palm. Then slap three times.",
		hint: "Open palm, then slap",
	},
	poke: {
		lock: "poke", need: 3,
		title: "SCISSORS",
		body: "Index and middle STRAIGHT out. Ignore the thumb. Ring and pinky half or fully bent. Point them FORWARD (not up). Then jab three times.",
		hint: "Two fingers straight, forward",
	},
	heart: {
		lock: "heart", need: 1,
		title: "HEART SHIELD",
		body: "Make a C with thumb + index only (other fingers ignored). Thumb at the bottom. Match the outline, then push the halves together once.",
		hint: "C + C, then join",
	},
	enter: {
		lock: null, need: 0,
		title: "ENTER THE RING",
		body: "Bad guys ahead. Punch, slap, and snip to take them down. The heart shield blocks hits. Get ready.",
		hint: "Fight!",
	},
	countdown: {
		lock: null, need: 0,
		title: "3",
		body: "Punch the bad guys",
		hint: "",
	},
};
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
	phase = "booting";
	tutorialStep = null;
	tutorialCount = 0;
	tutorialNeed = 0;
	tutorialLockMode = null;
	tutorialAdvanceAt = 0;
	tutorialHold = 0;
	xrLiveL = null;
	xrLiveR = null;
	waveDetL = null;
	waveDetR = null;
	waveDetMouse = null;
	waveMeter = 0;
	waveMeterMax = 5;
	waveWaving = false;
	waveHudAt = 0;
	poseGuideL = null;
	poseGuideR = null;
	poseGuideKind = null;
	waveDemoL = null;
	waveDemoR = null;
	bootReady = false;
	bootPct = 0;
	bootStep = "Waking the ring…";
	bootLog = [];
	_startQueued = false;
	_xrQueued = null;
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
	xrShowSkinnedHands = true;
	fxHitParticles = false;
	fxFlightTrail = true;
	xrSkinnedHands = { 0: null, 1: null };
	xrSkinnedModels = [];
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
	xrHandScale = 0.95;
	xrWristPosL = new THREE.Vector3();
	xrWristPosR = new THREE.Vector3();
	xrWristQuatL = new THREE.Quaternion();
	xrWristQuatR = new THREE.Quaternion();
	xrWristValidL = false;
	xrWristValidR = false;
	xrWristQuatValidL = false;
	xrWristQuatValidR = false;
	xrCurlL = 2;
	xrCurlR = 2;
	_heartChargeAt = 0;
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
	xrIntroT = 0;
	xrIntroBeat = null;
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
	heartWorldBeam = null;
	heartGlow = 0;
	heartSeatL = null;
	heartSeatR = null;
	heartAimL = null;
	heartAimR = null;
	xrGestHoldL = 0;
	xrGestHoldR = 0;
	xrGestKindL = null;
	xrGestKindR = null;
	xrHeartFramesL = 0;
	xrHeartFramesR = 0;
	party = null;
	partyRemotes = new Map();
	partySendAt = 0;
	mpRoom = "arena";
	mpName = "Fighter";
	mpConnected = false;
	mpPeers = 0;
	mpError = null;
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
	walkwayRoot = null;
	walkwayBeltMat = null;
	walkLever = null;
	walkLeverPivot = null;
	walkLeverHandle = null;
	walkLeverHalo = null;
	walkLeverPips = [];
	walkLeverAmount = 0;
	walkLeverGrabSide = null;
	walkLeverWantGrab = false;
	walkLeverArmed = { L: false, R: false };
	walkLeverFistWas = { L: false, R: false };
	walkLeverInZone = { L: false, R: false };
	walkLeverOpenTime = { L: 0, R: 0 };
	walkLeverGrabLocalZ = 0;
	walkLeverGrabAmt = 0;
	xrPalmPosL = new THREE.Vector3();
	xrPalmPosR = new THREE.Vector3();
	xrPalmValidL = false;
	xrPalmValidR = false;
	walkSpeed = 0;
	walkMaxSpeed = 2.85;
	walkTravel = 0;
	walkStartZ = 0;
	walkLoopLength = 96;
	walkLeverOffset = new THREE.Vector3(0.36, 0, -0.4);
	walkLeverSnapped = false;
	walkLeverRestAng = 0.72;
	walkLeverFullAng = -0.68;
	_walkHandle = new THREE.Vector3();
	_walkPivot = new THREE.Vector3();
	tmp = new THREE.Vector3();
	tmp2 = new THREE.Vector3();
	_toyHit = new THREE.Vector3();
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
	lookDragId = null;
	lookDragX = 0;
	lookDragY = 0;
	lookDragFromPanel = false;
	lookDragArmed = false;
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
	xrFpsHud = null;
	xrFpsCanvas = null;
	xrFpsTex = null;
	xrFpsLast = -1;
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
	onPointerDownLook = (e) => this.handlePointerDownLook(e);
	onPointerMoveLook = (e) => this.handlePointerMoveLook(e);
	onPointerUpLook = (e) => this.handlePointerUpLook(e);
	onResize = () => this.resize();
	onBlur = () => {
		this.keys.clear();
		this.charging = false;
		this.mobileFireL = false;
		this.mobileFireR = false;
		this.lookDragId = null;
		this.touchLookId = null;
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
		try {
			const sk = localStorage.getItem("glove-fight-show-xr-hands");
			if (sk === "0") this.xrShowSkinnedHands = false;
			const fx = localStorage.getItem("glove-fight-fx-proj");
			if (fx === "particles") {
				this.fxHitParticles = true;
				this.fxFlightTrail = false;
			} else if (fx === "trail") {
				this.fxHitParticles = false;
				this.fxFlightTrail = true;
			} else {
				const pt = localStorage.getItem("glove-fight-fx-particles");
				const tr = localStorage.getItem("glove-fight-fx-trail");
				if (pt === "1" && tr !== "1") {
					this.fxHitParticles = true;
					this.fxFlightTrail = false;
				} else {
					this.fxHitParticles = false;
					this.fxFlightTrail = true;
				}
			}
		} catch { /* */ }
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
			alpha: true,
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
		this.renderer.setClearColor(0x0b0b0c, 1);
		this.renderer.xr.enabled = true;
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
		this.bootstrapParty();
		this.emitHud();
		this.clock.connect(document);
		this.pushBoot("Renderer online", 0.12);
		this.renderer.setAnimationLoop(() => this.frame());
		void this.runBoot();
		if (typeof window !== "undefined") {
			const w = window;
			w.__gfPauseRender = () => this.renderer.setAnimationLoop(null);
			w.__gfResumeRender = () => this.renderer.setAnimationLoop(() => this.frame());
			w.__gfLever = (v) => {
				const n = Number(v);
				this.applyWalkLeverAmount(Number.isFinite(n) ? n : 1);
				return { amount: this.walkLeverAmount, speed: this.walkSpeed };
			};
			w.__gfHitTree = () => {
				const t = this.entities.find((e) => e.alive && e.kind === "tree");
				if (!t) return { ok: false };
				this.hitTree(t, new THREE.Vector3(1, 0, 0), 10);
				return { ok: true, stripped: !!t.stripped, fallen: !!t.fallen, hits: t.hits };
			};
			w.__gfHitBag = (dx, dy, dz) => {
				const bag = this.entities.find((e) => e.alive && e.kind === "heavyBag");
				if (!bag) return { ok: false };
				const dir = new THREE.Vector3(Number(dx) || 1, Number(dy) || 0, Number(dz) || 0);
				const before = { x: bag.angVelX || 0, z: bag.angVelZ || 0 };
				this.hitHeavyBag(bag, dir, 12);
				return { ok: true, dir: [dir.x, dir.y, dir.z], before, after: { x: bag.angVelX, z: bag.angVelZ } };
			};
			w.__gfStart = () => {
				this.bootReady = true;
				this.startGame();
				return { phase: this.phase };
			};
			w.__gfInspect = () => ({
				phase: this.phase,
				L: this.handMeshKey("L"),
				R: this.handMeshKey("R"),
				gL: this.handGestureL,
				gR: this.handGestureR,
				shield: !!(this.heartShieldEntity && this.heartShieldEntity.alive),
				hold: this.heartDetectHold,
				lever: this.walkLeverAmount,
				speed: this.walkSpeed,
				walkZ: this.getPlayerPos()?.z,
			});
			w.__gfHands = (left, right) => {
				const social = (v) => v === "heart" || v === "thumbs" || v === "thumbsDown" || v === "peace" || v === "spock" || v === "rockOn" || v === "birdie";
				if (social(left)) this.setHandGesture("L", left);
				else if (left) {
					this.setHandGesture("L", null);
					this.applyHandMode("L", left, false);
				}
				if (social(right)) this.setHandGesture("R", right);
				else if (right) {
					this.setHandGesture("R", null);
					this.applyHandMode("R", right, false);
				}
				this.updateHandMeshes();
				this.syncXrGloves();
				return { L: this.handMeshKey("L"), R: this.handMeshKey("R") };
			};
			w.__gfXrCountdown = () => {
				this.xrActive = true;
				this.xrPresentGrace = 30;
				this.startGame();
				return { phase: this.phase, beat: this.xrIntroBeat, queue: this.spawnQueue.length, t: this.xrIntroT };
			};
			w.__gfXrCountdownTick = (dt) => {
				this.tickXrCountdown(Number(dt) || 0.2);
				return {
					phase: this.phase,
					beat: this.xrIntroBeat,
					t: this.xrIntroT,
					queue: this.spawnQueue.length,
					wave: this.wave,
				};
			};
			w.__gfToggleHandDebug = () => this.toggleHandDebug();
			w.__gfHandDebug = () => this.getHandDebugInfo();
			w.__gfSetHandScale = (s) => this.setXrHandScale(Number(s));
			w.__gfGetLook = () => ({ yaw: this.yaw, pitch: this.pitch, phase: this.phase });
			w.__gfLook = (dx, dy) => this.applyLookDelta(Number(dx) || 0, Number(dy) || 0, "mouse");
			w.__gfHitToy = (kind, dx, dy, dz) => {
				const e = this.entities.find((t) => t.alive && t.kind === kind);
				if (!e) return null;
				this.applyPropHit(e, new THREE.Vector3(Number(dx) || 0, Number(dy) || 0, Number(dz) || 0), 10);
				return {
					kind: e.kind,
					hits: e.hits,
					burst: e.burst || false,
					angVelX: e.angVelX || 0,
					angVelZ: e.angVelZ || 0,
					jiggle: e.jiggle || 0,
				};
			};
		}
	}
	dispose() {
		this.disposed = true;
		this.renderer.setAnimationLoop(null);
		this.unbindInput();
		this.audio.stopMusic();
		this.handCam?.stop();
		this.leaveParty();
		if (this.renderer.xr.isPresenting) this.renderer.xr.getSession()?.end();
		this.composer?.dispose();
		this.particleGeo.dispose();
		sharedPhysics.dispose();
		this.renderer.dispose();
	}

	pushBoot(msg, pct) {
		if (typeof pct === "number") this.bootPct = THREE.MathUtils.clamp(pct, 0, 1);
		this.bootStep = msg;
		this.bootLog = [...(this.bootLog || []), msg].slice(-8);
		console.info("[boot]", msg);
		this.emitHud();
	}

	async runBoot() {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		try {
			this.pushBoot("Color pipeline + shadows", 0.18);
			await wait(160);
			this.pushBoot("Arena mesh + lighting", 0.28);
			await wait(180);
			this.pushBoot("Sculpting hand models", 0.4);
			try { await preloadPoseGuideHands(); } catch { /* */ }
			await wait(80);
			this.pushBoot("Post-process + bloom", 0.48);
			await wait(140);
			this.pushBoot("Audio bus", 0.55);
			try { this.audio.unlock?.(); } catch { /* */ }
			await wait(140);
			this.pushBoot("Box3D physics wasm", 0.62);
			try {
				const phys = sharedPhysics.init();
				const to = new Promise((_, rej) => setTimeout(() => rej(new Error("physics timeout")), 2500));
				await Promise.race([phys, to]);
				this.physicsReady = !!sharedPhysics.ready;
				if (this.physicsReady) this.spawnFunBoxStacks();
				this.pushBoot(this.physicsReady ? "Physics world ready" : "Physics still warming", 0.72);
			} catch (err) {
				console.warn("[physics] box3d.js failed to init", err);
				this.physicsReady = !!sharedPhysics.ready;
				this.pushBoot("Physics fallback — continuing", 0.72);
				void sharedPhysics.init().then(() => {
					this.physicsReady = true;
					this.spawnFunBoxStacks();
				}).catch(() => {});
			}
			this.pushBoot("Probing WebXR / headset", 0.8);
			try {
				const xr = this.detectXR();
				const to = new Promise((res) => setTimeout(res, 1800));
				await Promise.race([xr, to]);
			} catch { /* */ }
			this.pushBoot(this.xrSupported ? "WebXR available" : "WebXR not on this browser", 0.88);
			this.pushBoot("Party relay handshake", 0.93);
			await wait(160);
			this.pushBoot("Warming first frame", 0.97);
			await wait(160);
			this.bootReady = true;
			this.bootPct = 1;
			this.pushBoot("Ready — enter the ring", 1);
			if (this.phase === "booting") this.setPhase("menu");
			if (this._startQueued) {
				this._startQueued = false;
				this.startGame();
			}
			if (this._xrQueued) {
				const mode = this._xrQueued;
				this._xrQueued = null;
				this.enterXR(mode);
			}
		} catch (err) {
			console.warn("[boot] failed", err);
			this.bootReady = true;
			this.bootPct = 1;
			this.pushBoot("Ready (with warnings)", 1);
			if (this.phase === "booting") this.setPhase("menu");
		}
	}
	startGame() {
		if (!this.bootReady) {
			this._startQueued = true;
			this.pushBoot("Play queued — finishing load…", this.bootPct);
			return;
		}
		this.audio.unlock();
		this.audio.click();
		this.audio.startMusic();
		this.resetRun();
		this.startTutorial();
		if (!this.xrActive && !this.isMobile) this.requestLock();
	}

	startTutorial() {
		this.spawnQueue = [];
		this.waveEnemies = 0;
		this.waveKills = 0;
		this.tutorialAdvanceAt = 0;
		this.tutorialHold = 0;
		this.setTutorialStep("wave");
		this.setPhase("tutorial");
		this.setSpeedLeverEnabled(false);
		this.layoutXrCountdownHud(true);
		this.pushMsg("Tutorial", 1.1);
	}

	tutorialSpec() {
		return TUTORIAL_SCRIPT[this.tutorialStep] || null;
	}

	liveHandClass(side) {
		if (this.xrActive) return side === "L" ? this.xrLiveL : this.xrLiveR;
		if (this.cameraHands && this.lastTrackFrame?.hands) {
			const h = this.lastTrackFrame.hands.find((x) => x.side === side);
			if (h) return { mode: h.mode || null, gesture: h.gesture || null, curl: h.curl };
		}
		return { mode: this.getHandMode(side), gesture: side === "L" ? this.handGestureL : this.handGestureR, curl: 2 };
	}

	isTutorialShape(side, want) {
		if (want === "heart") {
			const g = side === "L" ? this.handGestureL : this.handGestureR;
			if (g === "heart") return true;
		}
		const cls = this.liveHandClass(side);
		if (!cls) return false;
		if (want === "punch") return cls.mode === "punch" || cls.gesture === "punch";
		if (want === "slap") return cls.mode === "slap" || cls.gesture === "slap";
		if (want === "poke") return cls.mode === "poke" || cls.gesture === "poke";
		if (want === "heart") return cls.gesture === "heart";
		return false;
	}

	noteWaveMotion(side, pos, vel, twistRate = 0) {
		if (this.phase !== "tutorial" || this.tutorialStep !== "wave") return;
		if (this.tutorialAdvanceAt) return;
		if (!pos || !vel) return;
		const stKey = side === "L" ? "waveDetL" : side === "R" ? "waveDetR" : "waveDetMouse";
		let st = this[stKey];
		const now = this.time || 0;
		if (!st) {
			st = this[stKey] = { t: now, twistAng: 0, samples: [], lastMotionT: 0 };
		}
		const dt = Math.min(0.08, Math.max(0.008, now - (st.t || now)));
		st.t = now;
		// Pure world / tracker axes — never the headset. Projecting a still
		// hand onto a yawing HMD looks like a bidirectional wave.
		const lat = vel.x;
		const along = vel.z;
		const vert = vel.y;
		st.twistAng = (st.twistAng || 0) + twistRate * dt;
		st.samples = st.samples || [];
		st.samples.push({ t: now, lat: pos.x, vert: pos.y, along: pos.z, twist: st.twistAng });
		const speed = Math.hypot(lat, along, vert);
		if (speed > 0.12 || Math.abs(twistRate) > 0.35) st.lastMotionT = now;
		while (st.samples.length && now - st.samples[0].t > 1.0) st.samples.shift();
		const tick = (name, value, minVel, minTravel) => {
			const signK = name + "Sign";
			const travelK = name + "Travel";
			const flipsK = name + "Flips";
			const lastK = name + "LastT";
			const posK = name + "Pos";
			const negK = name + "Neg";
			const sign = value > minVel ? 1 : value < -minVel ? -1 : 0;
			if (!sign) return;
			st[travelK] = (st[travelK] || 0) + Math.abs(value) * dt;
			if (st[signK] && sign !== st[signK] && (st[travelK] || 0) >= minTravel && now - (st[lastK] || 0) > 0.1) {
				st[flipsK] = (st[flipsK] || 0) + 1;
				st[lastK] = now;
				if (st[signK] > 0 || sign > 0) st[posK] = true;
				if (st[signK] < 0 || sign < 0) st[negK] = true;
				st[travelK] = 0;
			}
			st[signK] = sign;
			if (now - (st[lastK] || 0) > 0.9) {
				st[flipsK] = 0;
				st[posK] = false;
				st[negK] = false;
				st[travelK] = 0;
			}
		};
		// One-way drift never counts. Need a real reverse on the same axis.
		// lat = world X, vert = world Y, along = world Z, twist = wrist roll.
		tick("lat", lat, 0.045, 0.016);
		tick("vert", vert, 0.045, 0.016);
		tick("along", along, 0.05, 0.02);
		tick("twist", twistRate, 0.22, 0.07);
	}

	waveHistoryLive(st, name, minAmp) {
		if (!st?.samples?.length) return false;
		const now = this.time || 0;
		const recent = st.samples.filter((s) => now - s.t < 0.32);
		if (recent.length < 4) return false;
		let lo = Infinity, hi = -Infinity;
		for (const s of recent) {
			const v = s[name];
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		if (hi - lo < minAmp) return false;
		let flips = 0;
		let lastSign = 0;
		let travel = 0;
		for (let i = 1; i < recent.length; i++) {
			const d = recent[i][name] - recent[i - 1][name];
			const dt = Math.max(1e-3, recent[i].t - recent[i - 1].t);
			const v = d / dt;
			const sign = v > 0.04 ? 1 : v < -0.04 ? -1 : 0;
			travel += Math.abs(d);
			if (sign && lastSign && sign !== lastSign && travel > minAmp * 0.2) {
				flips++;
				travel = 0;
			}
			if (sign) lastSign = sign;
		}
		return flips >= 2;
	}

	isCurrentlyWaving() {
		const now = this.time || 0;
		const axisLive = (st, name) => {
			if (!st) return false;
			if (now - (st.lastMotionT || 0) > 0.12) return false;
			const both = !!(st[name + "Pos"] && st[name + "Neg"]);
			const flips = st[name + "Flips"] || 0;
			const recent = now - (st[name + "LastT"] || 0) < 1.05;
			return both && flips >= 2 && recent;
		};
		for (const st of [this.waveDetL, this.waveDetR, this.waveDetMouse]) {
			if (!st) continue;
			if (now - (st.lastMotionT || 0) > 0.12) continue;
			if (axisLive(st, "lat") || axisLive(st, "vert") || axisLive(st, "along") || axisLive(st, "twist")) return true;
			if (this.waveHistoryLive(st, "lat", 0.05)) return true;
			if (this.waveHistoryLive(st, "vert", 0.05)) return true;
			if (this.waveHistoryLive(st, "along", 0.06)) return true;
			if (this.waveHistoryLive(st, "twist", 0.12)) return true;
		}
		return false;
	}

	clearPoseGuides() {
		for (const g of [this.poseGuideL, this.poseGuideR]) {
			if (g?.parent) g.parent.remove(g);
		}
		this.poseGuideL = null;
		this.poseGuideR = null;
		this.poseGuideKind = null;
	}

	ensurePoseGuides(kind) {
		const ready = poseGuidesReady();
		if (this.poseGuideKind === kind && this.poseGuideL && this.poseGuideR) {
			const skinned = this.poseGuideL.userData.skinnedReady && this.poseGuideR.userData.skinnedReady;
			if (skinned || !ready) return;
			this.clearPoseGuides();
		} else {
			this.clearPoseGuides();
		}
		if (!kind || !makeTutorialPoseGuide) return;
		this.poseGuideKind = kind;
		this.poseGuideL = makeTutorialPoseGuide(kind, "L");
		this.poseGuideR = makeTutorialPoseGuide(kind, "R");
		this.scene.add(this.poseGuideL);
		this.scene.add(this.poseGuideR);
	}

	clearWaveDemo() {
		for (const g of [this.waveDemoL, this.waveDemoR]) {
			if (g?.parent) g.parent.remove(g);
		}
		this.waveDemoL = null;
		this.waveDemoR = null;
	}

	ensureWaveDemo() {
		const ready = poseGuidesReady();
		if (this.waveDemoL && this.waveDemoR) {
			const skinned = this.waveDemoL.userData.skinnedReady && this.waveDemoR.userData.skinnedReady;
			if (skinned || !ready) return;
			this.clearWaveDemo();
		}
		if (!makeTutorialPoseGuide) return;
		this.waveDemoL = makeTutorialPoseGuide("slap", "L");
		this.waveDemoR = makeTutorialPoseGuide("slap", "R");
		this.waveDemoL.name = "waveDemo_L";
		this.waveDemoR.name = "waveDemo_R";
		this.scene.add(this.waveDemoL);
		this.scene.add(this.waveDemoR);
	}

	updateWaveDemo() {
		if (this.phase !== "tutorial" || this.tutorialStep !== "wave") {
			this.clearWaveDemo();
			return;
		}
		this.ensureWaveDemo();
		const camPos = new THREE.Vector3();
		this.camera.getWorldPosition(camPos);
		const fwd = new THREE.Vector3();
		this.camera.getWorldDirection(fwd);
		if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
		fwd.normalize();
		const worldUp = new THREE.Vector3(0, 1, 0);
		const right = new THREE.Vector3().crossVectors(fwd, worldUp);
		if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
		else right.normalize();
		const viewUp = new THREE.Vector3().crossVectors(right, fwd);
		if (viewUp.lengthSq() < 1e-6) viewUp.copy(worldUp);
		else viewUp.normalize();
		const t = this.time || 0;
		const dist = this.xrActive ? 0.58 : 0.78;
		for (const side of ["L", "R"]) {
			const g = side === "L" ? this.waveDemoL : this.waveDemoR;
			if (!g) continue;
			const sign = side === "L" ? -1 : 1;
			const waveAng = Math.sin(t * 4.2 + (side === "L" ? 0 : 0.9)) * 0.62;
			const pos = camPos.clone()
				.addScaledVector(fwd, dist)
				.addScaledVector(right, sign * 0.26)
				.addScaledVector(viewUp, -0.04);
			const towardCam = camPos.clone().sub(pos);
			if (towardCam.lengthSq() < 1e-8) towardCam.copy(fwd).negate();
			towardCam.normalize();
			// Both GLBs have the palmar side on wrist −Y (right +Y is the back).
			const palmDir = towardCam.clone().negate();
			let fingerDir = viewUp.clone().applyAxisAngle(towardCam, waveAng);
			fingerDir.addScaledVector(palmDir, -fingerDir.dot(palmDir));
			if (fingerDir.lengthSq() < 1e-8) fingerDir.copy(viewUp);
			else fingerDir.normalize();
			const zAxis = fingerDir.clone().negate();
			const yAxis = palmDir.clone();
			const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
			if (xAxis.lengthSq() < 1e-8) xAxis.copy(right);
			xAxis.normalize();
			zAxis.crossVectors(xAxis, yAxis).normalize();
			const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
			placePoseGuide(g, pos, q, 0);
			g.visible = true;
			g.traverse((o) => {
				if (!o.isMesh || !o.material) return;
				const mats = Array.isArray(o.material) ? o.material : [o.material];
				for (const m of mats) {
					if (m.color) m.color.setHex(0xb7e4ff);
					if (m.emissive) {
						m.emissive.setHex(0x2a6aa8);
						m.emissiveIntensity = 0.7;
					}
					m.opacity = 0.62;
					m.transparent = true;
					m.depthWrite = false;
				}
			});
		}
	}

	xrRefQuatToWorld(q) {
		const out = q.clone();
		if (this.xrActive && this.playerRig) {
			const pq = new THREE.Quaternion();
			this.playerRig.getWorldQuaternion(pq);
			return pq.multiply(out);
		}
		return out;
	}

	getTrackedWristWorld(side) {
		const want = side === "L" ? "left" : "right";
		const pos = new THREE.Vector3();
		const quat = new THREE.Quaternion();
		const tryHand = (h) => {
			if (!h?.joints) return false;
			if (h.userData.handedness && h.userData.handedness !== want) return false;
			const wrist = h.joints.wrist || h.joints["wrist"];
			if (!wrist) return false;
			wrist.getWorldPosition(pos);
			wrist.getWorldQuaternion(quat);
			return true;
		};
		for (const i of [0, 1]) {
			if (tryHand(this.xrSkinnedHands?.[i])) return { pos, quat };
		}
		const valid = side === "L" ? this.xrWristValidL : this.xrWristValidR;
		if (valid) {
			pos.copy(side === "L" ? this.xrWristPosL : this.xrWristPosR);
			const qValid = side === "L" ? this.xrWristQuatValidL : this.xrWristQuatValidR;
			if (qValid) quat.copy(side === "L" ? this.xrWristQuatL : this.xrWristQuatR);
			else quat.identity();
			return { pos, quat: qValid ? quat : null };
		}
		return null;
	}

	updatePoseGuides() {
		const kind = this.phase === "tutorial" && (this.tutorialLockMode === "punch" || this.tutorialLockMode === "slap" || this.tutorialLockMode === "poke" || this.tutorialLockMode === "heart")
			? this.tutorialLockMode
			: null;
		if (!kind) {
			this.clearPoseGuides();
			return;
		}
		this.ensurePoseGuides(kind);
		const camPos = new THREE.Vector3();
		this.camera.getWorldPosition(camPos);
		const fwd = new THREE.Vector3();
		this.camera.getWorldDirection(fwd);
		fwd.y = 0;
		if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
		fwd.normalize();
		const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
		const pulse = 0.34 + Math.sin((this.time || 0) * 4.2) * 0.1;
		for (const side of ["L", "R"]) {
			const g = side === "L" ? this.poseGuideL : this.poseGuideR;
			if (!g) continue;
			const tracked = this.xrActive ? this.getTrackedWristWorld(side) : null;
			let pos = tracked?.pos || this.worldHandPos(side);
			if (!pos) {
				pos = camPos.clone().addScaledVector(fwd, 0.45).addScaledVector(right, side === "L" ? -0.22 : 0.22);
				pos.y = camPos.y - 0.15;
			}
			let q = tracked?.quat || null;
			if (!q) {
				const glove = this.xrActive
					? (side === "L" ? this.xrGloveL : this.xrGloveR)
					: (side === "L" ? this.leftGlove : this.rightGlove);
				if (glove) {
					q = new THREE.Quaternion();
					glove.getWorldQuaternion(q);
				}
			}
			placePoseGuide(g, pos, q, 0.18);
			const matched = this.isTutorialShape(side, kind);
			g.traverse((o) => {
				if (!o.isMesh || !o.material) return;
				const mats = Array.isArray(o.material) ? o.material : [o.material];
				for (const m of mats) {
					if (m.color) m.color.setHex(matched ? 0x7dffa8 : 0xb7e4ff);
					if (m.emissive) {
						m.emissive.setHex(matched ? 0x1a8a4a : 0x2a6aa8);
						m.emissiveIntensity = matched ? 0.75 : 0.45;
					}
					m.opacity = matched ? 0.88 : pulse;
					m.transparent = true;
					m.depthWrite = false;
				}
			});
			g.visible = true;
		}
	}

	setTutorialStep(step) {
		this.tutorialStep = step;
		this.tutorialCount = 0;
		const spec = TUTORIAL_SCRIPT[step] || null;
		this.tutorialNeed = spec ? spec.need : 0;
		this.tutorialLockMode = spec ? spec.lock : null;
		this.tutorialHold = 0;
		this.tutorialAdvanceAt = 0;
		this.waveDetL = null;
		this.waveDetR = null;
		this.waveDetMouse = null;
		this.waveMeter = 0;
		this.waveWaving = false;
		this._waveHudBucket = -1;
		if (this.tutorialLockMode === "punch" || this.tutorialLockMode === "slap" || this.tutorialLockMode === "poke") {
			this.modeL = this.tutorialLockMode;
			this.modeR = this.tutorialLockMode;
			this.mode = this.tutorialLockMode;
		}
		this.updateHandMeshes();
		this.syncXrGloves();
		if (this.tutorialLockMode === "heart") {
			this.heartShieldCdUntil = 0;
		}
		if (step === "countdown") {
			this.xrIntroT = 4.15;
			this.xrIntroBeat = null;
			this.countdownT = 3;
			this.layoutXrCountdownHud(true);
		}
		if (step !== "wave") this.clearWaveDemo();
		this.paintXrHud(true);
		this.emitHud();
	}

	noteTutorialAction(kind) {
		if (this.phase !== "tutorial") return;
		if (this.tutorialStep !== kind) return;
		if (this.tutorialAdvanceAt) return;
		this.tutorialCount = (this.tutorialCount || 0) + 1;
		const need = this.tutorialNeed || 1;
		this.pushMsg(`${this.tutorialCount} / ${need}`, 0.55);
		if (this.tutorialCount >= need) {
			this.tutorialAdvanceAt = this.time + 0.55;
		}
		this.paintXrHud(true);
		this.emitHud();
	}

	advanceTutorial() {
		const i = TUTORIAL_ORDER.indexOf(this.tutorialStep);
		if (i < 0 || i >= TUTORIAL_ORDER.length - 1) {
			this.finishTutorial();
			return;
		}
		this.setTutorialStep(TUTORIAL_ORDER[i + 1]);
		const spec = this.tutorialSpec();
		if (spec?.title) this.pushMsg(spec.title, 1.2);
	}

	finishTutorial() {
		this.tutorialStep = null;
		this.tutorialLockMode = null;
		this.tutorialCount = 0;
		this.tutorialNeed = 0;
		this.tutorialAdvanceAt = 0;
		this.xrIntroBeat = null;
		this.countdownT = null;
		this.layoutXrCountdownHud(false);
		this.clearPoseGuides();
		this.clearWaveDemo();
		this.setPhase("playing");
		this.setSpeedLeverEnabled(true);
		this.beginWave(1);
		this.pushMsg("Fight!", 1.1);
	}

	tickTutorial(dt) {
		if (this.phase !== "tutorial") return;
		this.updateHandMeshes();
		this.syncXrGloves();
		this.updatePoseGuides();
		this.updateWaveDemo();
		if (this.tutorialAdvanceAt) {
			if (this.time >= this.tutorialAdvanceAt) {
				this.tutorialAdvanceAt = 0;
				this.advanceTutorial();
			}
			return;
		}
		if (this.tutorialStep === "wave") {
			const waving = this.isCurrentlyWaving();
			this.waveWaving = waving;
			if (waving) this.waveMeter = Math.min(this.waveMeterMax, (this.waveMeter || 0) + dt);
			else this.waveMeter = Math.max(0, (this.waveMeter || 0) - dt * 3.0);
			this.tutorialCount = this.waveMeter;
			this.tutorialNeed = this.waveMeterMax;
			if (this.waveMeter >= this.waveMeterMax - 0.0005 && !this.tutorialAdvanceAt) {
				this.waveMeter = this.waveMeterMax;
				this.tutorialCount = this.waveMeterMax;
				this.tutorialAdvanceAt = this.time + 0.4;
				this.pushMsg("Nice wave!", 0.9);
				this.paintXrHud(true);
				this.emitHud();
				return;
			}
			const bucket = Math.floor(this.waveMeter * 16) + (waving ? 1000 : 0);
			if (bucket !== this._waveHudBucket) {
				this._waveHudBucket = bucket;
				this.paintXrHud(true);
				this.emitHud();
			}
			return;
		}
		if (this.tutorialStep === "enter") {
			this.tutorialHold = (this.tutorialHold || 0) + dt;
			if (this.tutorialHold > 2.8) this.advanceTutorial();
			return;
		}
		if (this.tutorialStep !== "countdown") return;
		this.xrIntroT = Math.max(0, (this.xrIntroT || 0) - dt);
		const t = this.xrIntroT;
		let beat = "GO";
		if (t > 3.1) beat = "3";
		else if (t > 2.1) beat = "2";
		else if (t > 1.1) beat = "1";
		else if (t > 0.15) beat = "GO";
		else {
			this.finishTutorial();
			return;
		}
		this.countdownT = beat === "GO" ? 0 : Number(beat);
		if (beat !== this.xrIntroBeat) {
			this.xrIntroBeat = beat;
			if (this.audio.countdown) this.audio.countdown(beat);
			else this.audio.click();
			this.pushMsg(beat === "GO" ? "GO!" : beat, 0.95);
			this.paintXrHud(true);
			this.emitHud();
		}
	}

	startXrCountdown() {
		this.xrIntroT = 4.15;
		this.xrIntroBeat = null;
		this.countdownT = 3;
		this.spawnQueue = [];
		this.waveEnemies = 0;
		this.setPhase("readying");
		this.layoutXrCountdownHud(true);
		this.tickXrCountdown(0);
		this.paintXrHud(true);
		this.emitHud();
	}

	layoutXrCountdownHud(intro) {
		if (!this.xrHud) return;
		if (intro) {
			this.xrHud.position.set(0, 0.08, -0.95);
			this.xrHud.scale.setScalar(1.35);
		} else {
			this.xrHud.position.set(0, 0.22, -1.2);
			this.xrHud.scale.setScalar(1);
		}
	}

	tickXrCountdown(dt) {
		if (this.phase !== "readying" || !this.xrActive) return;
		this.xrIntroT = Math.max(0, (this.xrIntroT || 0) - dt);
		this.readyingElapsed = (this.readyingElapsed || 0) + dt;
		const t = this.xrIntroT;
		let beat = "GO";
		if (t > 3.1) beat = "3";
		else if (t > 2.1) beat = "2";
		else if (t > 1.1) beat = "1";
		else if (t > 0.15) beat = "GO";
		else {
			this.xrIntroBeat = null;
			this.countdownT = null;
			this.layoutXrCountdownHud(false);
			this.setPhase("playing");
			this.beginWave(1);
			this.pushMsg("Fight!", 1.1);
			return;
		}
		this.countdownT = beat === "GO" ? 0 : Number(beat);
		if (beat !== this.xrIntroBeat) {
			this.xrIntroBeat = beat;
			if (this.audio.countdown) this.audio.countdown(beat);
			else this.audio.click();
			this.pushMsg(beat === "GO" ? "GO!" : beat, 0.95);
			this.paintXrHud(true);
			this.emitHud();
		}
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
		if (this.phase === "tutorial" && this.tutorialLockMode && this.tutorialLockMode !== mode
			&& (this.tutorialLockMode === "punch" || this.tutorialLockMode === "slap" || this.tutorialLockMode === "poke")) {
			return;
		}
		if (this.heartPoseActive) this.exitHeartPose();
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
	/** Live combat pose at fire time — flying copy must match fist / open palm / scissors. */
	shotModeForHand(hand) {
		const live = this.liveHandClass(hand);
		if (live?.mode === "punch" || live?.mode === "slap" || live?.mode === "poke") return live.mode;
		const held = this.getHandMode(hand);
		if (held === "punch" || held === "slap" || held === "poke") return held;
		return null;
	}
	isSocialGesture(g) {
		return g === "thumbs" || g === "thumbsDown" || g === "peace" || g === "spock" || g === "heart" || g === "rockOn" || g === "birdie";
	}
	applyHandMode(hand, mode, announce = true) {
		if (this.phase === "tutorial" && (this.tutorialLockMode === "punch" || this.tutorialLockMode === "slap" || this.tutorialLockMode === "poke")) {
			mode = this.tutorialLockMode;
			announce = false;
		}
		if (hand === "L") this.modeL = mode;
		else this.modeR = mode;
		if (this.heartPoseActive && this.handGestureL !== "heart" && this.handGestureR !== "heart") {
			this.heartPoseActive = false;
		}
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
			if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
			else o.material = o.material.clone();
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
			if ((o.name || "").startsWith("heart") || (o.parent && String(o.parent.name || "").startsWith("heart"))) return;
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
		if (this.phase !== "playing" && this.phase !== "waveClear" && this.phase !== "victory" && this.phase !== "menu" && this.phase !== "tutorial") return;
		if (this.phase === "tutorial" && kind === "heart" && this.tutorialLockMode !== "heart") return;
		if (this.phase === "tutorial" && kind !== "heart" && this.tutorialLockMode === "heart") return;
		this.gesturePose = kind;
		this.gestureT = 1.4;
		if (kind === "taunt") this.audio.taunt();
		if (kind === "heart") {
			if (this.heartPoseActive && this.handGestureL === "heart" && this.handGestureR === "heart") {
				this.spawnHeartShield();
			} else {
				this.enterHeartPose();
				this.pushMsg("♥ Half hearts — bring the tips together", 1.8);
			}
		} else if (kind === "thumbs" || kind === "thumbsDown" || kind === "peace" || kind === "spock" || kind === "wave" || kind === "birdie") {
			this.heartPoseActive = false;
			this.setHandGesture("R", kind === "wave" ? "peace" : kind);
			this.setHandGesture("L", kind === "thumbs" || kind === "peace" || kind === "spock" || kind === "birdie" ? kind : null);
			this.power = Math.min(1, this.power + .1);
			const msg =
				kind === "thumbs" ? "👍 Thumbs up!"
				: kind === "thumbsDown" ? "👎 Thumbs down!"
				: kind === "spock" ? "🖖 Live long & prosper!"
				: kind === "peace" ? "✌️ Peace!"
				: kind === "birdie" ? "🐦 Birdie!"
				: "Wave!";
			this.pushMsg(msg, 1.4);
			this.burst(this.camera.position.clone().add(new THREE.Vector3(0, 0, -1)), kind === "thumbsDown" || kind === "birdie" ? 0xe23d3d : 16765514, 14);
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
			this.leftRest.set(-0.22, -0.06, -0.58);
			this.rightRest.set(0.22, -0.06, -0.58);
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
	/** Two-hand heart → temporary damage shield. Optional world-space fuse point. */
	spawnHeartShield(at = null) {
		if (this.time < this.heartShieldCdUntil) {
			this.pushMsg("Shield cooling…", 0.7);
			return;
		}
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
		const dist = this.xrActive ? 1.2 : 1.55;
		const pos = at && at.isVector3 ? at.clone() : origin.clone().addScaledVector(fwd, dist);
		if (!at) pos.y = origin.y;
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
		this.heartShieldCdUntil = this.time + 1.15;
		this.power = Math.min(1, this.power + 0.12);
		this.pushMsg("♥ HEART SHIELD!", 1.6);
		try { this.audio.unlock(); } catch { /* */ }
		if (this.audio.heartShield) this.audio.heartShield();
		else this.audio.powerup();
		this.burst(pos.clone(), 0xff4d8d, 28);
		this.trauma = Math.min(1, this.trauma + 0.12);
		if (this.bloomPass) this.bloomPass.strength = this.isMobile ? 0.9 : 1.25;
		this.noteTutorialAction("heart");
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
		// Tips close, thumbs close — halves must actually meet (forgiving on camera)
		if (indexDist > 0.2 || thumbDist > 0.22 || wristDist > 0.55) return false;
		// In image coords y grows downward — thumbs should be below index tips
		const tipY = (li.y + ri.y) * 0.5;
		const thY = (lt.y + rt.y) * 0.5;
		if (thY < tipY - 0.01) return false; // thumbs not below
		// Heart height reasonable
		if (thY - tipY < 0.03 || thY - tipY > 0.28) return false;
		return true;
	}
	detectTwoHandHeartXR(frame, refSpace, handL, handR) {
		const wp = (hand, name) => {
			const j = hand.get?.(name) || hand.get(name);
			if (!j) return null;
			const pose = safeGetJointPose(frame, j, refSpace);
			if (!pose) return null;
			const p = pose.transform.position;
			return this.xrRefToWorld(new THREE.Vector3(p.x, p.y, p.z));
		};
		const li = wp(handL, "index-finger-tip");
		const ri = wp(handR, "index-finger-tip");
		const lt = wp(handL, "thumb-tip");
		const rt = wp(handR, "thumb-tip");
		const lw = wp(handL, "wrist");
		const rw = wp(handR, "wrist");
		if (!li || !ri || !lt || !rt || !lw || !rw) return false;
		const d = (a, b) => a.distanceTo(b);
		const apL = d(li, lt);
		const apR = d(ri, rt);
		const ap = Math.max(0.05, 0.5 * (apL + apR));
		const indexGap = d(li, ri);
		const thumbGap = d(lt, rt);
		const midL = li.clone().add(lt).multiplyScalar(0.5);
		const midR = ri.clone().add(rt).multiplyScalar(0.5);
		const centerGap = midL.distanceTo(midR);
		// Join when the two C openings meet — no world-upright requirement
		// (looking down at a heart used to fail the old thumbY < indexY test).
		const tipsMeet = indexGap < Math.max(0.18, ap * 1.2) && thumbGap < Math.max(0.2, ap * 1.3);
		const cupsMeet = centerGap < Math.max(0.18, ap * 1.1);
		if (!tipsMeet && !cupsMeet) return false;
		if (d(lw, rw) > 0.72) return false;
		const openL = midL.clone().sub(lw);
		const openR = midR.clone().sub(rw);
		const toR = midR.clone().sub(midL);
		if (openL.lengthSq() > 1e-6 && toR.lengthSq() > 1e-6 && openL.normalize().dot(toR.clone().normalize()) < -0.45) {
			return false;
		}
		if (openR.lengthSq() > 1e-6 && toR.lengthSq() > 1e-6 && openR.normalize().dot(toR.clone().negate().normalize()) < -0.45) {
			return false;
		}
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
		if (!this.bootReady) {
			this._xrQueued = explicitMode || "vr";
			this.pushBoot("WebXR queued — finishing load…", this.bootPct);
			return;
		}
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
			this.paintXrFpsHud(true);
			if (this.playerRig) {
				this.playerRig.position.set(0, 0, 0);
				if (!this.playerRig.parent) this.scene.add(this.playerRig);
				if (this.camera.parent !== this.playerRig) this.playerRig.add(this.camera);
				this.camera.position.set(0, 0, 0);
				this.attachXrTrackingToRig();
				this.walkLeverSnapped = false;
				this.placeSpeedLever();
			}
			this.syncXrGloves();
			for (const g of this.xrGripModels || []) if (g) g.visible = false;
			if (this.phase === "menu" || this.phase === "gameover") this.startGame();
			else if (this.phase === "victory" || this.phase === "waveClear") this.continueFromWaveClear();
			else if (this.phase === "paused") this.setPhase("playing");
			if (this.phase === "tutorial") {
				this.layoutXrCountdownHud(true);
				this.paintXrHud(true);
			} else if (this.phase !== "readying") {
				const label = usedMode === "immersive-ar" ? "AR" : "VR";
				this.pushMsg(label + " ready · hands on · thrust to punch", 3.0);
			}
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
		this.applyArPassthrough(this.xrSessionMode === "immersive-ar");
	}
	/** Hide painted sky / fog so AR camera passthrough shows through. */
	applyArPassthrough(on) {
		if (this.skyDome) this.skyDome.visible = !on;
		if (this.scene) {
			if (on) {
				if (this.scene.fog) this.sceneFog = this.scene.fog;
				this.scene.fog = null;
				this.scene.background = null;
			} else if (this.sceneFog && !this.scene.fog) {
				this.scene.fog = this.sceneFog;
			}
		}
		try {
			if (on) {
				this.renderer.setClearColor(0x000000, 0);
				this.renderer.setClearAlpha(0);
				this.renderer.autoClear = true;
			} else if (!this.xrActive) {
				this.renderer.setClearColor(0x0b0b0c, 1);
				this.renderer.setClearAlpha(1);
			} else {
				this.renderer.setClearColor(0x0b0b0c, 1);
				this.renderer.setClearAlpha(1);
			}
		} catch { /* */ }
	}
	/** Default-on skinned WebXR hands (finger joints) shown *with* game props. */
	setupSkinnedXrHands() {
		if (!this.renderer?.xr?.getHand) return;
		const factory = new XRHandModelFactory(null, (obj) => this.ghostifySkinnedHand(obj));
		this.xrSkinnedModels = [];
		for (const i of [0, 1]) {
			const hand = this.renderer.xr.getHand(i);
			const model = factory.createHandModel(hand, "mesh");
			hand.add(model);
			if (this.playerRig) this.playerRig.add(hand);
			else this.scene.add(hand);
			hand.userData.skinnedXrHand = true;
			hand.addEventListener("connected", (ev) => {
				hand.userData.handedness = ev.data?.handedness || "";
			});
			hand.addEventListener("disconnected", () => {
				hand.userData.handedness = "";
			});
			this.xrSkinnedHands[i] = hand;
			this.xrSkinnedModels.push(model);
			hand.visible = false;
		}
		this.applySkinnedHandVisibility();
	}
	ghostifySkinnedHand(root) {
		if (!root) return;
		root.traverse((o) => {
			if (!o.isMesh || !o.material) return;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) {
				m.transparent = true;
				m.opacity = 0.4;
				m.depthWrite = false;
				m.side = THREE.DoubleSide;
				if (m.color) m.color.setHex(0xb7e4ff);
				if ("emissive" in m) {
					m.emissive.setHex(0x2a6aa8);
					m.emissiveIntensity = 0.45;
				}
			}
			o.renderOrder = 24;
			o.frustumCulled = false;
			o.castShadow = false;
		});
	}
	applySkinnedHandVisibility() {
		const xrOn = !!this.xrActive;
		const ghostOn = !!this.xrShowSkinnedHands && xrOn;
		// Keep the XR hand group live during a session so props parented to
		// wrist/palm joints stay visible even if the ghost mesh is toggled off.
		for (const i of [0, 1]) {
			const h = this.xrSkinnedHands?.[i];
			if (h) h.visible = xrOn;
		}
		for (const m of this.xrSkinnedModels || []) {
			if (m) m.visible = ghostOn;
		}
	}
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
				if (o.userData?.skinnedXrHand) return;
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
		this.applyArPassthrough(false);
		this.leftGlove.visible = true;
		this.rightGlove.visible = true;
		if (this.xrGloveL) this.xrGloveL.visible = false;
		if (this.xrGloveR) this.xrGloveR.visible = false;
		this.applySkinnedHandVisibility();
		if (this.xrHud) {
			this.xrHud.visible = false;
			this.layoutXrCountdownHud(false);
		}
		if (this.xrFpsHud) this.xrFpsHud.visible = false;
		if (this.playerRig && this.camera.parent === this.playerRig) {
			this.scene.add(this.camera);
			this.camera.position.set(0, 1.55, 0);
		}
		this.placeSpeedLever();
		this.emitHud();
		if (this.phase === "playing") this.setPhase("paused");
		else if (this.phase === "readying") {
			this.xrIntroBeat = null;
			this.countdownT = null;
			this.setPhase("menu");
		}
	}
	setForceXr(on) {
		setForceXrEnabled(!!on);
		this.xrForce = !!on;
		resetXrDetectionCache();
		void this.detectXR();
	}
	setShowSkinnedHands(on) {
		this.xrShowSkinnedHands = !!on;
		try { localStorage.setItem("glove-fight-show-xr-hands", on ? "1" : "0"); } catch { /* */ }
		this.applySkinnedHandVisibility();
		this.pushMsg(on ? "XR skinned hands on" : "XR skinned hands off", 1.1);
		this.emitHud();
	}
	setFxHitParticles(on) {
		this.setProjectileFx(on ? "particles" : "trail");
	}
	setFxFlightTrail(on) {
		this.setProjectileFx(on ? "trail" : "particles");
	}
	setProjectileFx(kind) {
		const particles = kind === "particles";
		this.fxHitParticles = particles;
		this.fxFlightTrail = !particles;
		try {
			localStorage.setItem("glove-fight-fx-proj", particles ? "particles" : "trail");
			localStorage.setItem("glove-fight-fx-particles", particles ? "1" : "0");
			localStorage.setItem("glove-fight-fx-trail", particles ? "0" : "1");
		} catch { /* */ }
		this.pushMsg(particles ? "In-flight particles" : "In-flight trails", 1.0);
		this.emitHud();
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
		this.playerRig = new THREE.Group();
		this.playerRig.name = "playerRig";
		this.scene.add(this.playerRig);
		const factory = new XRControllerModelFactory();
		this.controller0 = this.renderer.xr.getController(0);
		this.controller1 = this.renderer.xr.getController(1);
		this.playerRig.add(this.controller0);
		this.playerRig.add(this.controller1);
		this.controllerGrip0 = this.renderer.xr.getControllerGrip(0);
		this.controllerGrip1 = this.renderer.xr.getControllerGrip(1);
		const gripModel0 = factory.createControllerModel(this.controllerGrip0);
		const gripModel1 = factory.createControllerModel(this.controllerGrip1);
		this.controllerGrip0.add(gripModel0);
		this.controllerGrip1.add(gripModel1);
		this.xrGripModels = [gripModel0, gripModel1];
		this.playerRig.add(this.controllerGrip0);
		this.playerRig.add(this.controllerGrip1);
		const gestKeys = ["thumbs", "thumbsDown", "peace", "spock", "heart", "rockOn", "birdie"];
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
			this.uniquifyMaterials(m);
			this.solidifyXrHand(m);
			m.visible = false;
			this.xrGloveL.add(m);
		}
		for (const [k, m] of Object.entries(this.xrGloveMeshesR)) {
			this.uniquifyMaterials(m);
			this.solidifyXrHand(m);
			m.visible = false;
			this.xrGloveR.add(m);
		}
		this.applyXrPropScales();
		this.applyXrGloveOrient(this.xrGloveL, "L", "controller");
		this.applyXrGloveOrient(this.xrGloveR, "R", "controller");
		this.xrGloveL.visible = false;
		this.xrGloveR.visible = false;
		this.xrHandAnchors = { L: new THREE.Group(), R: new THREE.Group() };
		this.playerRig.add(this.xrHandAnchors.L);
		this.playerRig.add(this.xrHandAnchors.R);
		this.controller0.add(this.xrGloveL);
		this.controller1.add(this.xrGloveR);
		this.controller0.userData.side = "L";
		this.controller1.userData.side = "R";
		this.xrCtrlByHand = { L: this.controller0, R: this.controller1 };
		this.setupSkinnedXrHands();
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
		this.setupXrFpsHud();
		if (!this.camera.parent) this.playerRig.add(this.camera);
	}
	setupXrFpsHud() {
		if (this.xrFpsHud) return;
		const c = document.createElement("canvas");
		c.width = 256;
		c.height = 72;
		this.xrFpsCanvas = c;
		this.xrFpsTex = new THREE.CanvasTexture(c);
		this.xrFpsTex.colorSpace = THREE.SRGBColorSpace;
		this.xrFpsTex.minFilter = THREE.LinearFilter;
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.18, 0.05),
			new THREE.MeshBasicMaterial({
				map: this.xrFpsTex,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		mesh.renderOrder = 22;
		const g = new THREE.Group();
		g.add(mesh);
		g.position.set(0.32, 0.2, -0.85);
		g.visible = false;
		this.xrFpsHud = g;
		this.camera.add(g);
		this.paintXrFpsHud(true);
	}
	paintXrFpsHud(force = false) {
		if (!this.xrFpsCanvas || !this.xrFpsTex) return;
		const n = this.fps | 0;
		if (!force && n === this.xrFpsLast && this.xrFpsHud?.visible === !!this.xrActive) {
			if (this.xrFpsHud) this.xrFpsHud.visible = !!this.xrActive;
			return;
		}
		this.xrFpsLast = n;
		if (this.xrFpsHud) this.xrFpsHud.visible = !!this.xrActive;
		const c = this.xrFpsCanvas;
		const ctx = c.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, c.width, c.height);
		const col = n >= 70 ? "#7dffa8" : n >= 50 ? "#ffe08a" : "#ff6b6b";
		ctx.fillStyle = "rgba(8,6,12,0.55)";
		if (typeof ctx.roundRect === "function") {
			ctx.beginPath();
			ctx.roundRect(8, 8, c.width - 16, c.height - 16, 14);
			ctx.fill();
		} else {
			ctx.fillRect(8, 8, c.width - 16, c.height - 16);
		}
		ctx.fillStyle = col;
		ctx.font = "700 36px system-ui, Segoe UI, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(n + " FPS", c.width / 2, c.height / 2 + 1);
		this.xrFpsTex.needsUpdate = true;
	}
	/** Keep WebXR controllers / hands on the locomotion rig so they ride the walkway. */
	attachXrTrackingToRig() {
		const rig = this.playerRig;
		if (!rig) return;
		if (!rig.parent) this.scene.add(rig);
		const nodes = [
			this.controller0, this.controller1,
			this.controllerGrip0, this.controllerGrip1,
			this.xrHandAnchors?.L, this.xrHandAnchors?.R,
			this.xrSkinnedHands?.[0], this.xrSkinnedHands?.[1],
		];
		for (const n of nodes) {
			if (n && n.parent !== rig) rig.add(n);
		}
	}
	/** XR reference-space point → world, accounting for walkway locomotion. */
	xrRefToWorld(p) {
		const v = p && p.isVector3 ? p.clone() : new THREE.Vector3(p?.x || 0, p?.y || 0, p?.z || 0);
		if (this.xrActive && this.playerRig && this.camera.parent === this.playerRig) {
			this.playerRig.updateWorldMatrix(true, false);
			return this.playerRig.localToWorld(v);
		}
		return v;
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
			return this.xrRefToWorld(new THREE.Vector3(p.x, p.y, p.z));
		};
		const wrist = jointPos("wrist");
		const midTip = jointPos("middle-finger-tip") || jointPos("middle-finger-phalanx-distal");
		const midPip = jointPos("middle-finger-phalanx-proximal") || jointPos("middle-finger-metacarpal");
		const midMet = jointPos("middle-finger-metacarpal") || midPip;
		const indexM = jointPos("index-finger-metacarpal") || jointPos("index-finger-phalanx-proximal") || jointPos("index-finger-tip");
		const pinkyM = jointPos("pinky-finger-metacarpal") || jointPos("pinky-finger-phalanx-proximal") || jointPos("pinky-finger-tip");
		const thumbTip = jointPos("thumb-tip");
		const indexTip = jointPos("index-finger-tip");
		if (!wrist) return;

		const key = this.handMeshKey(side);
		const social = key === "thumbs" || key === "thumbsDown" || key === "peace" || key === "spock" || key === "rockOn";
		if (key === "heart") {
			const bag = side === "L" ? this.xrGloveMeshesL : this.xrGloveMeshesR;
			const heart = bag?.heart;
			if (thumbTip && indexTip && wrist) {
				const span = Math.max(0.04, thumbTip.distanceTo(indexTip));
				const yAxis = indexTip.clone().sub(thumbTip);
				if (yAxis.lengthSq() < 1e-8) yAxis.set(0, 1, 0);
				else yAxis.normalize();
				const mid = thumbTip.clone().lerp(indexTip, 0.5);
				// +X = C opening (away from the wrist, toward the other hand).
				let xAxis = mid.clone().sub(wrist);
				xAxis.addScaledVector(yAxis, -xAxis.dot(yAxis));
				if (xAxis.lengthSq() < 1e-8) {
					xAxis.crossVectors(yAxis, new THREE.Vector3(0, 0, 1));
					if (xAxis.lengthSq() < 1e-8) xAxis.crossVectors(yAxis, new THREE.Vector3(1, 0, 0));
				}
				xAxis.normalize();
				const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
				if (zAxis.lengthSq() < 1e-8) zAxis.set(0, 0, 1);
				else zAxis.normalize();
				xAxis.crossVectors(yAxis, zAxis).normalize();
				const camPos = new THREE.Vector3();
				this.camera.getWorldPosition(camPos);
				const towardCam = zAxis.dot(camPos.clone().sub(mid)) < 0 ? -1 : 1;
				const hm = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
				const q = new THREE.Quaternion().setFromRotationMatrix(hm);
				this.placeXrPropWorld(glove, mid, q);
				if (side === "L") this.heartSeatL = mid.clone();
				else this.heartSeatR = mid.clone();
				if (heart) {
					heart.position.set(0, 0, 0.012 * towardCam);
					heart.quaternion.identity();
					heart.scale.setScalar(span * 1.08);
				}
			} else {
				const camPos = new THREE.Vector3();
				this.camera.getWorldPosition(camPos);
				const seat = wrist.clone().add(new THREE.Vector3(0, 0.06, 0));
				const toCam = camPos.clone().sub(seat);
				if (toCam.lengthSq() < 1e-8) toCam.set(0, 0, 1);
				toCam.normalize();
				const yAxis = new THREE.Vector3(0, 1, 0);
				const xAxis = new THREE.Vector3().crossVectors(yAxis, toCam);
				if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
				xAxis.normalize();
				const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
				const hm = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
				this.placeXrPropWorld(glove, seat, new THREE.Quaternion().setFromRotationMatrix(hm));
			}
			return;
		}

		const tip = midTip || midPip;
		if (!tip) return;
		const forward = tip.clone().sub(wrist);
		if (forward.lengthSq() < 1e-8) return;
		forward.normalize();

		let across;
		if (indexM && pinkyM) {
			across = indexM.clone().sub(pinkyM);
			if (across.lengthSq() < 1e-8) across = new THREE.Vector3(1, 0, 0);
			else across.normalize();
		} else {
			across = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
			if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
			across.normalize();
		}

		let up = new THREE.Vector3().crossVectors(across, forward);
		if (up.lengthSq() < 1e-8) {
			up = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward);
			if (up.lengthSq() < 1e-8) up.set(0, 0, 1);
		}
		up.normalize();
		across.crossVectors(forward, up).normalize();
		up.crossVectors(across, forward).normalize();

		// Combat props (glove / fish / scissors): model −Z along fingers, +Y out the back.
		// Articulated social hands: fingers are +Y, palm −Z after built-in yaw.
		let xAxis, yAxis, zAxis;
		if (social) {
			if (key === "thumbs" && thumbTip) {
				const thumbDir = thumbTip.clone().sub(wrist);
				if (thumbDir.lengthSq() > 1e-8) {
					const tu = thumbDir.normalize();
					yAxis = new THREE.Vector3(0, 1, 0).lerp(tu, 0.55);
					if (yAxis.lengthSq() < 1e-8) yAxis.set(0, 1, 0);
					yAxis.normalize();
				} else yAxis = new THREE.Vector3(0, 1, 0);
			} else if (key === "thumbsDown" && thumbTip) {
				const thumbDir = thumbTip.clone().sub(wrist);
				if (thumbDir.lengthSq() > 1e-8) {
					const tu = thumbDir.normalize();
					yAxis = new THREE.Vector3(0, -1, 0).lerp(tu, 0.55);
					if (yAxis.lengthSq() < 1e-8) yAxis.set(0, -1, 0);
					yAxis.normalize();
				} else yAxis = new THREE.Vector3(0, -1, 0);
			} else {
				yAxis = forward.clone();
			}
			zAxis = up.clone();
			xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
			if (xAxis.lengthSq() < 1e-8) xAxis = across.clone();
			xAxis.normalize();
			zAxis.crossVectors(xAxis, yAxis).normalize();
		} else {
			xAxis = across.clone();
			yAxis = up.clone();
			zAxis = forward.clone().negate();
		}
		const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
		const q = new THREE.Quaternion().setFromRotationMatrix(m);
		const palm = (midMet || wrist).clone();
		const along = this.xrPropAlong(key);
		const lift = this.xrPropLift(key);
		const worldPos = palm.addScaledVector(forward, along).addScaledVector(up, lift);
		this.placeXrPropWorld(glove, worldPos, q);
		const bag = side === "L" ? this.xrGloveMeshesL : this.xrGloveMeshesR;
		if (bag?.heart) bag.heart.scale.setScalar(bag.heart.userData.baseScale || this.xrPropWorldScale("heart"));
	}
	xrPropAlong(key) {
		if (key === "poke") return 0.085;
		if (key === "punch") return 0.055;
		if (key === "slap") return 0.04;
		if (key === "birdie") return 0.07;
		return 0.05;
	}
	xrPropLift(key) {
		if (key === "punch") return 0.012;
		if (key === "slap") return 0.004;
		if (key === "birdie") return 0.02;
		return 0.008;
	}
	/** Convert a world pose into the prop's current parent (wrist/palm/controller). */
	placeXrPropWorld(glove, worldPos, worldQuat) {
		const parent = glove.parent;
		if (!parent) {
			glove.position.copy(worldPos);
			glove.quaternion.copy(worldQuat);
			return;
		}
		parent.updateWorldMatrix(true, false);
		const inv = parent.matrixWorld.clone().invert();
		glove.position.copy(worldPos).applyMatrix4(inv);
		const pq = new THREE.Quaternion();
		parent.getWorldQuaternion(pq);
		glove.quaternion.copy(pq.invert()).multiply(worldQuat);
	}
	findXrPalmJoint(side, hintPos) {
		const want = side === "L" ? "left" : "right";
		const names = ["middle-finger-metacarpal", "wrist"];
		const pickFrom = (h) => {
			if (!h?.joints) return null;
			for (const n of names) {
				const j = h.joints[n];
				if (!j) continue;
				if (hintPos) {
					const p = new THREE.Vector3();
					j.getWorldPosition(p);
					if (p.distanceTo(hintPos) > 0.28) continue;
				}
				return j;
			}
			return null;
		};
		for (const i of [0, 1]) {
			const h = this.xrSkinnedHands?.[i];
			if (!h) continue;
			if (h.userData.handedness && h.userData.handedness !== want) continue;
			const j = pickFrom(h);
			if (j) return j;
		}
		let best = null;
		let bestD = 0.28;
		if (hintPos) {
			for (const i of [0, 1]) {
				const h = this.xrSkinnedHands?.[i];
				if (!h?.joints) continue;
				for (const n of names) {
					const j = h.joints[n];
					if (!j) continue;
					const p = new THREE.Vector3();
					j.getWorldPosition(p);
					const d = p.distanceTo(hintPos);
					if (d < bestD) { bestD = d; best = j; }
				}
			}
		}
		return best;
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
			if (this.phase === "tutorial") return;
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
		const showOne = (bag, key) => {
			for (const k of Object.keys(bag)) {
				const m = bag[k];
				if (!m) continue;
				const on = !!key && k === key;
				m.visible = on;
				m.traverse((o) => { o.visible = on; });
			}
		};
		showOne(this.xrGloveMeshesL, this.handMeshKey("L"));
		showOne(this.xrGloveMeshesR, this.handMeshKey("R"));
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
	/** Fit custom props onto a real Quest hand. Gloves were built as FPS viewmodels. */
	xrPropFit(key) {
		if (key === "punch") return 0.38;
		if (key === "slap") return 0.34;
		if (key === "poke") return 0.38;
		if (key === "heart") return 0.44;
		if (key === "birdie") return 0.40;
		return 0.58;
	}
	xrPropWorldScale(key) {
		return this.xrPropFit(key) * (this.xrHandScale / 0.95);
	}
	applyXrPropScales() {
		for (const bag of [this.xrGloveMeshesL, this.xrGloveMeshesR]) {
			if (!bag) continue;
			for (const [k, m] of Object.entries(bag)) {
				if (!m) continue;
				m.userData.baseScale = this.xrPropWorldScale(k);
				m.scale.setScalar(m.userData.baseScale);
			}
		}
	}
	setXrHandScale(s) {
		this.xrHandScale = THREE.MathUtils.clamp(s, 0.28, 1.15);
		this.applyXrPropScales();
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
		this.xrPalmValidL = false;
		this.xrPalmValidR = false;
		if (frame && refSpace) {
			for (const source of session.inputSources) {
				if (isGazeOrPinchSource(source) && !source.hand) continue; // Vision Pro gaze/pinch ray — ignore
				if (!source.hand) continue;
				const side = source.handedness === "left" ? "L" : source.handedness === "right" ? "R" : null;
				if (!side) continue;
				if (side === "L") xrHandL = source.hand;
				else xrHandR = source.hand;
				const cls = this.classifyXRHandGesture(frame, refSpace, source.hand);
				if (side === "L") {
					this.xrCurlL = Number.isFinite(cls?.curl) ? cls.curl : 2;
					this.xrLiveL = cls || null;
				} else {
					this.xrCurlR = Number.isFinite(cls?.curl) ? cls.curl : 2;
					this.xrLiveR = cls || null;
				}
				this.applyXrSocialGesture(side, cls);
				if (this.detectXRFingerClick(frame, refSpace, source.hand, side)) this.armClickBoost(side);
				const wrist = source.hand.get?.("wrist") || source.hand.get("wrist");
				if (!wrist) continue;
				const pose = safeGetJointPose(frame, wrist, refSpace);
				if (!pose) continue;
				sawHand = true;
				const wristPos = this.xrRefToWorld(new THREE.Vector3(
					pose.transform.position.x,
					pose.transform.position.y,
					pose.transform.position.z,
				));
				if (side === "L") { this.xrWristPosL.copy(wristPos); this.xrWristValidL = true; }
				else { this.xrWristPosR.copy(wristPos); this.xrWristValidR = true; }
				const o = pose.transform.orientation;
				if (o) {
					const qWorld = this.xrRefQuatToWorld(new THREE.Quaternion(o.x, o.y, o.z, o.w));
					if (side === "L") { this.xrWristQuatL.copy(qWorld); this.xrWristQuatValidL = true; }
					else { this.xrWristQuatR.copy(qWorld); this.xrWristQuatValidR = true; }
				}
				const glove = side === "L" ? this.xrGloveL : this.xrGloveR;
				const palmJoint = this.findXrPalmJoint(side, wristPos);
				if (palmJoint) {
					palmJoint.getWorldPosition(side === "L" ? this.xrPalmPosL : this.xrPalmPosR);
					if (side === "L") this.xrPalmValidL = true;
					else this.xrPalmValidR = true;
				}
				const anchor = this.xrHandAnchors[side];
				if (glove) {
					const parent = palmJoint || anchor;
					if (parent && glove.parent !== parent) parent.add(glove);
					if (anchor) {
						anchor.position.copy(wristPos);
						anchor.quaternion.identity();
						anchor.visible = !palmJoint;
					}
					const hidingH = (side === "L" ? this.leftReturnAt : this.rightReturnAt) > 0
						&& this.time < (side === "L" ? this.leftReturnAt : this.rightReturnAt);
					glove.visible = !hidingH;
					this.alignXrHandProp(glove, side, frame, refSpace, source.hand);
				}
				this.trackXRMotion(side, this.xrRefToWorld(pose.transform.position), pose.transform.orientation, dt);
			}
		}
		const wasHands = this.xrUsingHands;
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
		this.applySkinnedHandVisibility();
		if (frame && refSpace && xrHandL && xrHandR) {
			const bothHalves = this.handGestureL === "heart" && this.handGestureR === "heart";
			const connected = bothHalves && this.detectTwoHandHeartXR(frame, refSpace, xrHandL, xrHandR);
			if (connected) {
				this.heartDetectHold = (this.heartDetectHold || 0) + Math.max(0.016, dt || 0.016);
				if (this.heartDetectHold > 0.12) {
					this.spawnHeartShield();
					this.heartDetectHold = -0.9;
				}
			} else if ((this.heartDetectHold || 0) > 0) {
				this.heartDetectHold = Math.max(0, this.heartDetectHold - Math.max(0.016, dt || 0.016) * 3);
			}
		}
	}
	applyXrSocialGesture(side, cls) {
		const social = ["thumbs", "thumbsDown", "spock", "rockOn", "birdie"];
		const holdKey = side === "L" ? "xrGestHoldL" : "xrGestHoldR";
		const kindKey = side === "L" ? "xrGestKindL" : "xrGestKindR";
		const heartFramesKey = side === "L" ? "xrHeartFramesL" : "xrHeartFramesR";
		const g = cls?.gesture;
		if (g === "punch" || cls?.mode === "punch") {
			// Closed fist is always punch — never a leftover half-heart.
			this[heartFramesKey] = 0;
			this[kindKey] = null;
			this[holdKey] = 0;
			const curG = side === "L" ? this.handGestureL : this.handGestureR;
			if (curG) this.setHandGesture(side, null);
			this.hideHeartConnector();
			this.holdXRHandMode(side, "punch");
			return;
		}
		if (g === "peace") {
			this[heartFramesKey] = 0;
			if (this[kindKey] !== "peace") this.pushMsg("✌️ Peace", 0.7);
			this[kindKey] = "peace";
			this[holdKey] = 14;
			this.setHandGesture(side, "peace");
			return;
		}
		if (g === "birdie") {
			this[heartFramesKey] = 0;
			if (this[kindKey] !== "birdie") this.pushMsg("🐦 Birdie", 0.7);
			this[kindKey] = "birdie";
			this[holdKey] = 14;
			this.setHandGesture(side, "birdie");
			return;
		}
		if (g === "heart") {
			if (this.phase === "tutorial" && this.tutorialLockMode !== "heart") {
				this[heartFramesKey] = 0;
				this[kindKey] = null;
				this.setHandGesture(side, null);
				return;
			}
			// Wrapping the throttle looks like a C — don't steal the grab.
			if (this.handNearWalkLever(side)) {
				this[heartFramesKey] = 0;
				this[kindKey] = null;
				this.setHandGesture(side, null);
				this.holdXRHandMode(side, "punch");
				return;
			}
			this[heartFramesKey] = Math.min(28, (this[heartFramesKey] || 0) + 4);
			if (this[kindKey] !== "heart") this.pushMsg("♥ Half heart", 0.7);
			this[kindKey] = "heart";
			this[holdKey] = 22;
			this.setHandGesture(side, "heart");
			return;
		}
		// Keep a single-hand half-heart through missed frames only — never through a fist.
		if (this[kindKey] === "heart" || (this[heartFramesKey] || 0) > 0) {
			const hard = g === "peace" || g === "birdie" || g === "thumbs" || g === "thumbsDown"
				|| g === "spock" || g === "rockOn" || cls?.mode === "slap"
				|| (cls?.mode === "poke" && g !== "heart");
			if (hard) {
				this[heartFramesKey] = 0;
			} else {
				this[heartFramesKey] = Math.max(0, (this[heartFramesKey] || 0) - 1);
				if ((this[heartFramesKey] || 0) > 0) {
					this.setHandGesture(side, "heart");
					this[kindKey] = "heart";
					return;
				}
			}
			this[heartFramesKey] = 0;
		}
		// Fist / combat wins over heart, but not over a held peace V
		if (cls?.mode === "slap" || (cls?.mode === "poke" && g !== "peace")) {
			this[heartFramesKey] = 0;
			this[kindKey] = null;
			this[holdKey] = 0;
			const curG = side === "L" ? this.handGestureL : this.handGestureR;
			if (curG) this.setHandGesture(side, null);
			this.hideHeartConnector();
			const mode = cls?.mode || (g === "punch" ? "punch" : null);
			if (mode) this.holdXRHandMode(side, mode);
			return;
		}
		if (g && social.includes(g)) {
			if (this[kindKey] !== g) this.pushMsg(g, 0.7);
			this[kindKey] = g;
			this[holdKey] = 12;
			this.setHandGesture(side, g);
			return;
		}
		if (this[holdKey] > 0) {
			this[holdKey]--;
			if (this[kindKey] && this.isSocialGesture(this[kindKey])) this.setHandGesture(side, this[kindKey]);
			return;
		}
		this[kindKey] = null;
		if (cls?.mode) this.setHandGesture(side, null);
		if (cls?.mode) this.holdXRHandMode(side, cls.mode);
	}
	holdXRHandMode(side, mode) {
		if (!mode) return;
		if (side === "L") {
			if (mode === this.xrHandHoldL) this.xrHandHoldFramesL++;
			else { this.xrHandHoldL = mode; this.xrHandHoldFramesL = 1; }
			if (this.xrHandHoldFramesL >= 2 && this.modeL !== mode) this.applyHandMode("L", mode, true);
		} else {
			if (mode === this.xrHandHoldR) this.xrHandHoldFramesR++;
			else { this.xrHandHoldR = mode; this.xrHandHoldFramesR = 1; }
			if (this.xrHandHoldFramesR >= 2 && this.modeR !== mode) this.applyHandMode("R", mode, true);
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
		const ringPip = joint("ring-finger-phalanx-proximal");
		const pinkyPip = joint("pinky-finger-phalanx-proximal");
		const ringMcp = joint("ring-finger-metacarpal") || ringPip;
		const pinkyMcp = joint("pinky-finger-metacarpal") || pinkyPip;
		const indexMcpJ = joint("index-finger-metacarpal") || indexPip;
		const middleMcp = joint("middle-finger-metacarpal") || middlePip;
		const bendCos = (tip, pip, mcp) => {
			if (!tip || !pip || !mcp) return 1;
			const ax = mcp.x - pip.x, ay = mcp.y - pip.y, az = mcp.z - pip.z;
			const bx = tip.x - pip.x, by = tip.y - pip.y, bz = tip.z - pip.z;
			const al = Math.hypot(ax, ay, az), bl = Math.hypot(bx, by, bz);
			if (al < 1e-5 || bl < 1e-5) return 1;
			return (ax * bx + ay * by + az * bz) / (al * bl);
		};
		const fingerStraight = (tip, pip, mcp) => {
			if (!tip || !pip) return false;
			const mcpP = mcp || wrist;
			const cos = bendCos(tip, pip, mcpP);
			const tipD = dist(wrist, tip);
			const pipD = dist(wrist, pip);
			return cos < -0.28 && tipD > pipD * 1.05 && tipD > palm * 1.12;
		};
		// Paper needs actually-straight fingers — a half curl is not an open palm.
		const fingerOpen = (tip, pip, mcp, dip) => {
			if (!tip || !pip) return false;
			const mcpP = mcp || wrist;
			const cos = bendCos(tip, pip, mcpP);
			const tipD = dist(wrist, tip);
			const pipD = dist(wrist, pip);
			// Straighter than a half-curl, but a natural open palm (together or spread) still counts.
			return cos < -0.48 && tipD > pipD * 1.08 && tipD > palm * 1.18;
		};
		const fingerTucked = (tip, pip, mcp) => {
			if (!tip) return true;
			const mcpP = mcp || wrist;
			const pipP = pip || mcpP;
			const cos = pip ? bendCos(tip, pipP, mcpP) : 1;
			const tipD = dist(wrist, tip);
			const pipD = pip ? dist(wrist, pip) : palm * 0.55;
			return cos > -0.22 || tipD < pipD * 1.14;
		};
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
		const indexStraight = fingerStraight(indexTip, indexPip, indexMcpJ);
		const middleStraight = fingerStraight(middleTip, middlePip, middleMcp);
		const ringTucked = fingerTucked(ringTip, ringPip, ringMcp);
		const pinkyTucked = fingerTucked(pinkyTip, pinkyPip, pinkyMcp);
		const indexDip = joint("index-finger-phalanx-distal");
		const middleDip = joint("middle-finger-phalanx-distal");
		const ringDip = joint("ring-finger-phalanx-distal");
		const pinkyDip = joint("pinky-finger-phalanx-distal");
		const indexOpen = fingerOpen(indexTip, indexPip, indexMcpJ, indexDip);
		const middleOpen = fingerOpen(middleTip, middlePip, middleMcp, middleDip);
		const ringOpen = fingerOpen(ringTip, ringPip, ringMcp, ringDip);
		const pinkyOpen = fingerOpen(pinkyTip, pinkyPip, pinkyMcp, pinkyDip);
		const openCount = [indexOpen, middleOpen, ringOpen, pinkyOpen].filter(Boolean).length;
		const n = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;
		const indexTucked = fingerTucked(indexTip, indexPip, indexMcpJ);
		const middleTucked = fingerTucked(middleTip, middlePip, middleMcp);
		const tuckedCount = [indexTucked, middleTucked, ringTucked, pinkyTucked].filter(Boolean).length;
		const indexTipD = dist(wrist, indexTip);
		const middleTipD = dist(wrist, middleTip);
		const ringTipD = ringTip ? dist(wrist, ringTip) : 0;
		const pinkyTipD = pinkyTip ? dist(wrist, pinkyTip) : 0;
		const avgTip = [indexTipD, middleTipD, ringTipD, pinkyTipD].filter((d) => d > 0).reduce((a, b, _, arr) => a + b / arr.length, 0) || 99;
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
			if (up) return { mode: null, gesture: "thumbs", curl: n };
			if (down) return { mode: null, gesture: "thumbsDown", curl: n };
			return { mode: "punch", gesture: "punch", curl: n };
		}

		// Obvious closed fist (tips near the palm). Ignore thumb.
		// Keep this tight so a half-heart (index still reaching) is not stolen.
		if (!indexStraight && !middleStraight && tuckedCount >= 3 && avgTip < palm * 1.38 && indexTipD < palm * 1.5) {
			return { mode: "punch", gesture: "punch", curl: n };
		}

		// Scissors: index + middle STRAIGHT out. Ignore thumb.
		// Ring + pinky half-bent or fully bent. Pointing up = peace, forward = scissors.
		if (indexStraight && middleStraight && ringTucked && pinkyTucked) {
			const dx = indexTip.x - wrist.x;
			const dy = indexTip.y - wrist.y;
			const dz = indexTip.z - wrist.z;
			const len = Math.max(1e-5, Math.hypot(dx, dy, dz));
			const upAmt = dy / len;
			const horiz = Math.hypot(dx, dz);
			if (upAmt > 0.62 && horiz < Math.abs(dy) * 1.05) {
				return { mode: null, gesture: "peace", curl: n };
			}
			return { mode: "poke", gesture: "poke", curl: n };
		}

		// Half-heart: ONLY thumb + index. Middle / ring / pinky are ignored completely.
		if (thumbTip && indexTip) {
			const aperture = dist(thumbTip, indexTip);
			const toPip = indexPip ? dist(thumbTip, indexPip) : 99;
			const thumbBelow = thumbTip.y < indexTip.y - 0.014;
			const openC = aperture > palm * 0.82 && aperture < palm * 3.4;
			const thumbNotOnKnuckle = toPip > palm * 0.38;
			const indexReach = dist(wrist, indexTip) > palm * 0.62;
			if (openC && thumbBelow && thumbNotOnKnuckle && indexReach) {
				return { mode: null, gesture: "heart", curl: n };
			}
		}

		// Paper: 3–4 straight fingers, together OR modestly spread.
		// Spock only when middle↔ring is a real Vulcan split, not a relaxed open palm.
		if (openCount >= 4) {
			const gap = dist(middleTip, ringTip);
			const idxMid = dist(indexTip, middleTip);
			const ringPinky = pinkyTip ? dist(ringTip, pinkyTip) : 0;
			const vulcan = gap > palm * 0.9 && gap > idxMid * 1.7 && gap > ringPinky * 1.7;
			if (vulcan) return { mode: null, gesture: "spock", curl: n };
			return { mode: "slap", gesture: "slap", curl: n };
		}
		if (openCount >= 3) return { mode: "slap", gesture: "slap", curl: n };
		if (middleUp && !indexUp && !ringUp && !pinkyUp) {
			return { mode: null, gesture: "birdie", curl: n };
		}
		// True fist fallback — 3+ curled fingers, even if one digit reads slightly "up".
		if (tuckedCount >= 3 && !indexStraight && !middleStraight) {
			return { mode: "punch", gesture: "punch", curl: n };
		}
		if (thumbTip && !indexUp && !middleUp) {
			const toIndex = dist(thumbTip, indexTip);
			const toPip = indexPip ? dist(thumbTip, indexPip) : 99;
			const toMid = dist(thumbTip, middleTip);
			const bunched = toIndex < palm * 0.82 && (toPip < palm * 0.62 || toMid < palm * 0.82);
			if (bunched) return { mode: "punch", gesture: "punch", curl: n };
		}
		if (n === 0 && !indexUp) {
			return { mode: "punch", gesture: "punch", curl: n };
		}
		if (n <= 2 && !indexStraight) return { mode: "punch", gesture: "punch", curl: n };
		// Half-curl is a fist, not paper — never leave mode sticky on slap.
		if (openCount < 3) return { mode: "punch", gesture: "punch", curl: n };
		return null;
	}
	/** XR finger snap: thumb under finger (closed), then thumb up + finger down. */
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
		if (!thumb || !wrist || (!middle && !index)) return false;
		const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const palm = Math.max(0.04, dist(wrist, midMet || thumb));
		const dMid = middle ? dist(thumb, middle) / palm : 99;
		const dIdx = index ? dist(thumb, index) / palm : 99;
		const useMid = dMid <= dIdx * 1.12;
		const finger = useMid && middle ? middle : index;
		if (!finger) return false;
		const d = Math.min(dMid, dIdx);
		const key = side === "L" ? "xrClickStateL" : "xrClickStateR";
		let st = this[key];
		if (!st) {
			st = { wasClosed: false, lastDist: d, cdUntil: 0, thumbY: thumb.y, fingerY: finger.y };
			this[key] = st;
		}
		const now = this.time;
		if (now < st.cdUntil) { st.lastDist = d; return false; }
		const CLOSED = 0.5;
		const OPEN = 0.78;
		// World Y up — primed snap has the thumb under the snapping finger
		const thumbBelow = thumb.y <= finger.y + 0.012;
		let clicked = false;
		if (!st.wasClosed && d < CLOSED && thumbBelow) {
			st.wasClosed = true;
			st.thumbY = thumb.y;
			st.fingerY = finger.y;
		} else if (st.wasClosed) {
			const thumbUp = thumb.y - st.thumbY;
			const fingerDown = st.fingerY - finger.y;
			const rightWay = thumbUp > 0.006 && fingerDown > -0.004;
			const snap = thumbUp > 0.01 && fingerDown > 0.004;
			if ((d > OPEN || (d > CLOSED * 1.15 && d - st.lastDist > 0.12)) && (snap || rightWay)) {
				clicked = true;
				st.wasClosed = false;
				st.cdUntil = now + 0.4;
			} else if (d > OPEN * 1.35 || thumbUp < -0.02) {
				// Separated the opposite way (thumb dropped) — not a snap
				st.wasClosed = false;
			}
		}
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
		if (this.walkLeverGrabSide === side) return;
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
			this[qKey] = (orient && !orient.isQuaternion) ? this.xrRefQuatToWorld(curQ) : curQ.clone();
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

		// Motion axes from the hand / controller only — never the headset.
		// WebXR joints: +Y along the bone toward the fingers, +X across the palm.
		// XR controllers: −Z points forward. Fallback: world X / −Z.
		const up = new THREE.Vector3(0, 1, 0);
		let qWorld = curQ;
		if (orient && !orient.isQuaternion) qWorld = this.xrRefQuatToWorld(curQ);
		const isHandJoint = !!(orient && !orient.isQuaternion);
		let handFwd;
		let handAcross;
		if (orient) {
			handFwd = (isHandJoint ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1)).applyQuaternion(qWorld);
			handAcross = new THREE.Vector3(1, 0, 0).applyQuaternion(qWorld);
			if (handFwd.lengthSq() < 1e-6) handFwd.set(0, 0, -1);
			else handFwd.normalize();
			if (handAcross.lengthSq() < 1e-6) handAcross.crossVectors(handFwd, up);
			else handAcross.normalize();
		} else {
			handFwd = new THREE.Vector3(0, 0, -1);
			handAcross = new THREE.Vector3(1, 0, 0);
		}
		const along = vel.dot(handFwd);
		const lateral = vel.dot(handAcross);
		const speed = vel.length();
		const latSpeed = Math.abs(lateral);

		let angSpeed = 0;
		let rollRate = 0;
		let twistRate = 0;
		const prevQ = this[qKey];
		if (prevQ && orient) {
			const inv = prevQ.clone().invert();
			const delta = inv.multiply(qWorld);
			const w = THREE.MathUtils.clamp(delta.w, -1, 1);
			const xyz = Math.hypot(delta.x, delta.y, delta.z);
			const ang = 2 * Math.atan2(xyz, w);
			angSpeed = Math.abs(ang) / dtPos;
			// Signed twist around local Y (forearm / pronation-supination).
			let twistDelta = 2 * Math.atan2(delta.y, w);
			if (twistDelta > Math.PI) twistDelta -= Math.PI * 2;
			if (twistDelta < -Math.PI) twistDelta += Math.PI * 2;
			twistRate = twistDelta / dtPos;
			if (xyz > 1e-8) {
				const ax = new THREE.Vector3(delta.x / xyz, delta.y / xyz, delta.z / xyz);
				const axisWorld = ax.applyQuaternion(prevQ);
				rollRate = angSpeed * Math.max(
					Math.abs(axisWorld.dot(handFwd)),
					Math.abs(axisWorld.dot(up)) * 0.85,
				);
			}
			this[qKey] = qWorld.clone();
		} else if (orient) {
			this[qKey] = qWorld.clone();
		}

		this.noteWaveMotion(side, cur, vel, twistRate);
		if (this.phase === "tutorial" && this.tutorialStep === "wave") {
			return;
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
				const returning = side === "L" ? this.leftReturnAt : this.rightReturnAt;
				const fistReady = !(returning > 0 && now < returning);
				if (cd <= 0 && fistReady) {
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
					} else {
						const poseMode = this.shotModeForHand(side);
						const shot = poseMode || (swing.kind === "punch" ? "punch" : "slap");
						const style = swing.kind === "wrist" ? "wrist" : swing.kind === "sweep" ? "sweep" : null;
						if (shot === "slap") {
							if (side === "L") { this.xrLastSlapStyleL = style || "sweep"; this.xrLastSlapTL = now; }
							else { this.xrLastSlapStyleR = style || "sweep"; this.xrLastSlapTR = now; }
						}
						this.tryAttack(side, {
							forceMode: shot,
							slapStyle: shot === "slap" ? (style || "sweep") : undefined,
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
		if (this.phase === "tutorial") return;
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
		this.skyDome = makeSkyDome();
		this.scene.add(this.skyDome);
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
		this.spawnMovingWalkway();
		this.spawnSpeedLever();
		for (let i = 0; i < 6; i++) {
			const side = i % 2 === 0 ? -1 : 1;
			const banner = makeBanner(this.palette, i % 3 === 0 ? 14826813 : i % 3 === 1 ? 4045026 : 14856253);
			banner.position.set(side * 6.2, 0, -6 - i * 5.5);
			banner.rotation.y = side * .35;
			this.arenaRoot.add(banner);
		}
		this.spawnArenaTrees();
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
		this.spawnStartToys();
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
		const gestKeys = ["thumbs", "thumbsDown", "peace", "spock", "heart", "rockOn", "birdie"];
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
		for (const [k, mesh] of [...Object.entries(this.leftMeshes), ...Object.entries(this.rightMeshes)]) {
			this.uniquifyMaterials(mesh);
			mesh.userData.baseScale = 1;
			mesh.scale.setScalar(1);
			this.solidifyXrHand(mesh);
			if (k !== "heart") this.styleViewmodelHand(mesh);
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
		this.heartWorldBeam = new THREE.Mesh(
			new THREE.CylinderGeometry(0.018, 0.018, 1, 10),
			new THREE.MeshBasicMaterial({
				color: 0xff4d8d,
				transparent: true,
				opacity: 0,
				depthWrite: false,
			}),
		);
		this.heartWorldBeam.visible = false;
		this.scene.add(this.heartWorldBeam);
		this.overlayScene.add(this.leftGlove);
		this.overlayScene.add(this.rightGlove);
		this.leftPos.copy(this.leftRest);
		this.rightPos.copy(this.rightRest);
		this.updateHandMeshes();
	}
	/** Which mesh key to show for a hand (gesture props override combat). */
	handMeshKey(side) {
		if (this.phase === "tutorial") {
			const lock = this.tutorialLockMode;
			const step = this.tutorialStep;
			if (step === "wave" || lock === "wave") return null;
			if (lock === "punch") return this.isTutorialShape(side, "punch") ? "punch" : null;
			if (lock === "slap") return this.isTutorialShape(side, "slap") ? "slap" : null;
			if (lock === "poke") return this.isTutorialShape(side, "poke") ? "poke" : null;
			if (lock === "heart") return this.isTutorialShape(side, "heart") ? "heart" : null;
		}
		const g = side === "L" ? this.handGestureL : this.handGestureR;
		if (g === "heart") return "heart";
		if (g && g !== "none" && g !== "punch" && g !== "slap" && g !== "poke") return g;
		return side === "L" ? this.modeL : this.modeR;
	}
	updateHandMeshes() {
		if (!this.leftMeshes || !this.rightMeshes) return;
		const kL = this.handMeshKey("L");
		const kR = this.handMeshKey("R");
		for (const k of Object.keys(this.leftMeshes)) {
			this.leftMeshes[k].visible = !!kL && k === kL;
		}
		for (const k of Object.keys(this.rightMeshes)) {
			this.rightMeshes[k].visible = !!kR && k === kR;
		}
		this.announceHandModel("L", kL);
		this.announceHandModel("R", kR);
	}
	announceHandModel(side, key) {
		const lastK = side === "L" ? "_lastMeshKeyL" : "_lastMeshKeyR";
		const prev = this[lastK];
		this[lastK] = key;
		if (!key || !prev || prev === key) return;
		const now = this.time || 0;
		const cdK = side === "L" ? "_meshSfxAtL" : "_meshSfxAtR";
		if (now - (this[cdK] || 0) < 0.12) return;
		this[cdK] = now;
		if (this.audio?.gestureSwap) this.audio.gestureSwap(key);
		else this.audio?.taunt?.();
	}
	setHandGesture(side, gesture) {
		const next = gesture && gesture !== "none" ? gesture : null;
		if (side === "L") {
			if (this.handGestureL === next) {
				if (next !== "heart" || this.handGestureR !== "heart") this.hideHeartConnector();
				return;
			}
			this.handGestureL = next;
		} else {
			if (this.handGestureR === next) {
				if (next !== "heart" || this.handGestureL !== "heart") this.hideHeartConnector();
				return;
			}
			this.handGestureR = next;
		}
		if (this.handGestureL !== "heart" || this.handGestureR !== "heart") this.hideHeartConnector();
		this.updateHandMeshes();
		this.syncXrGloves();
	}
	hideHeartConnector() {
		if (this.heartConnectMesh) this.heartConnectMesh.visible = false;
		if (this.heartWorldBeam) this.heartWorldBeam.visible = false;
		this.heartGlow = 0;
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
		window.addEventListener("pointerdown", this.onPointerDownLook, { capture: true });
		window.addEventListener("pointermove", this.onPointerMoveLook, { capture: true });
		window.addEventListener("pointerup", this.onPointerUpLook, { capture: true });
		window.addEventListener("pointercancel", this.onPointerUpLook, { capture: true });
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
		window.removeEventListener("pointerdown", this.onPointerDownLook, { capture: true });
		window.removeEventListener("pointermove", this.onPointerMoveLook, { capture: true });
		window.removeEventListener("pointerup", this.onPointerUpLook, { capture: true });
		window.removeEventListener("pointercancel", this.onPointerUpLook, { capture: true });
		if (document.pointerLockElement === this.canvas) document.exitPointerLock();
	}
	lookTargetBlocks(el) {
		if (!el || typeof el.closest !== "function") return false;
		return Boolean(
			el.closest("button, input, textarea, select, a, label, [data-look-ignore], [contenteditable='true']"),
		);
	}
	lookTargetIsPanel(el) {
		if (!el || typeof el.closest !== "function") return false;
		return Boolean(el.closest("[data-panel]"));
	}
	applyLookDelta(dx, dy, pointerType) {
		if (!dx && !dy) return;
		const touch = pointerType === "touch" || pointerType === "pen";
		const sens = touch ? 0.0048 : 0.0032;
		this.lookX += dx * sens;
		this.lookY += dy * sens;
	}
	handlePointerDownLook(e) {
		if (this.xrActive || this.locked) return;
		if (this.phase === "paused") return;
		if (e.isPrimary === false) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		const el = e.target;
		if (this.lookTargetBlocks(el)) return;
		this.lookDragId = e.pointerId;
		this.lookDragX = e.clientX;
		this.lookDragY = e.clientY;
		this.lookDragFromPanel = this.lookTargetIsPanel(el);
		this.lookDragArmed = !this.lookDragFromPanel;
	}
	handlePointerMoveLook(e) {
		if (this.lookDragId !== e.pointerId) return;
		if (this.xrActive || this.locked || this.phase === "paused") return;
		const dx = e.clientX - this.lookDragX;
		const dy = e.clientY - this.lookDragY;
		if (!this.lookDragArmed) {
			if (Math.abs(dx) + Math.abs(dy) < 8) return;
			// On the menu card: horizontal swipe looks, vertical swipe scrolls
			if (this.lookDragFromPanel && Math.abs(dy) > Math.abs(dx) * 1.15) {
				this.lookDragId = null;
				return;
			}
			this.lookDragArmed = true;
		}
		this.lookDragX = e.clientX;
		this.lookDragY = e.clientY;
		this.applyLookDelta(dx, dy, e.pointerType);
		if (e.cancelable && e.pointerType !== "mouse") e.preventDefault();
	}
	handlePointerUpLook(e) {
		if (this.lookDragId === e.pointerId) this.lookDragId = null;
	}
	onTouchStart = (e) => {
		if (this.xrActive || this.phase === "paused") return;
		if (this.lookDragId !== null) return;
		for (const t of Array.from(e.changedTouches)) {
			if (this.touchLookId !== null) continue;
			this.touchLookId = t.identifier;
			this.touchLookLastX = t.clientX;
			this.touchLookLastY = t.clientY;
			e.preventDefault();
		}
	};
	onTouchMove = (e) => {
		if (this.touchLookId === null || this.lookDragId !== null) return;
		for (const t of Array.from(e.changedTouches)) {
			if (t.identifier !== this.touchLookId) continue;
			const dx = t.clientX - this.touchLookLastX;
			const dy = t.clientY - this.touchLookLastY;
			this.touchLookLastX = t.clientX;
			this.touchLookLastY = t.clientY;
			this.applyLookDelta(dx, dy, "touch");
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
		if (k === "KeyH") { this.doGesture("heart"); return; }
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
		if (k === "KeyM") this.doGesture("birdie");
		if (k === "KeyF") this.doGesture("wave");
		if (k === "Space") {
			e.preventDefault();
			this.charging = true;
		}
	}
	handleMouseMove(e) {
		if (!this.xrActive && this.phase === "tutorial" && this.tutorialStep === "wave") {
			this._waveMouseX = (this._waveMouseX || 0) + (e.movementX || 0) * 0.004;
			this._waveMouseY = (this._waveMouseY || 0) - (e.movementY || 0) * 0.004;
			this.noteWaveMotion("mouse", {
				x: this._waveMouseX,
				y: this._waveMouseY,
				z: 0,
			}, {
				x: e.movementX || 0,
				y: -(e.movementY || 0),
				z: 0,
			});
		}
		if (!this.locked || this.xrActive) return;
		if (this.phase === "paused") return;
		this.lookX += e.movementX * this.lookSens;
		this.lookY += e.movementY * this.lookSens;
	}
	handleMouseDown(e) {
		if (this.phase === "paused") {
			this.resume();
			return;
		}
		// Menu / wave clear / etc: still allow punches for practice
		if (!this.locked && !this.isMobile && !this.xrActive && (this.phase === "playing" || this.phase === "tutorial")) this.requestLock();
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
		} else if (this.phase === "tutorial") {
			if (just(0) || just(7)) this.tryAttack("R");
			if (just(2) || just(6)) this.tryAttack("L");
			if (just(1) || just(3)) this.doGesture("heart");
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
			if (e.ribbon) this.disposeRibbonTrail(e.ribbon);
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
		this.walkTravel = 0;
		this.walkSpeed = 0;
		this.walkLeverAmount = 0;
		this.walkLeverGrabSide = null;
		this.walkLeverArmed = { L: false, R: false };
		this.walkLeverFistWas = { L: false, R: false };
		this.walkLeverInZone = { L: false, R: false };
		this.walkLeverOpenTime = { L: 0, R: 0 };
		this.walkLeverSnapped = false;
		this.tutorialStep = null;
		this.tutorialCount = 0;
		this.tutorialNeed = 0;
		this.tutorialLockMode = null;
		this.tutorialAdvanceAt = 0;
		this.tutorialHold = 0;
		this.waveDetL = null;
		this.waveDetR = null;
		this.waveDetMouse = null;
		this.waveMeter = 0;
		this.waveWaving = false;
		this.applyWalkLeverAmount(0);
		this.setSpeedLeverEnabled(false);
		if (this.playerRig) this.playerRig.position.set(0, 0, this.walkStartZ);
		this.spawnQueue = [];
		this.waveEnemies = 0;
		this.waveKills = 0;
		this.countdownT = null;
		this.xrIntroT = 0;
		this.xrIntroBeat = null;
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
		this.spawnStartToys();
		this.spawnArenaTrees();
	}
	paintXrHud(force = false) {
		if (!this.xrHudCanvas || !this.xrHudTex) return;
		const phase = this.phase;
		const canCont = (phase === "waveClear" || phase === "victory") && this.time >= (this.waveClearReadyAt || 0);
		const msg = this.message || "";
		const key = phase + "|" + this.wave + "|" + canCont + "|" + msg + "|" + Math.floor(this.score) + "|" + this.xrActive + "|" + (this.messageT > 0) + "|" + (this.xrIntroBeat || "") + "|" + (this.tutorialStep || "") + "|" + Math.floor((this.tutorialCount || 0) * 10) + "|" + Math.floor((this.waveMeter || 0) * 12) + "|" + (this.waveWaving ? 1 : 0);
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
			phase === "tutorial" ||
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
		} else if (phase === "readying" || (phase === "tutorial" && this.tutorialStep === "countdown")) {
			const beat = this.xrIntroBeat || "3";
			title = beat === "GO" ? "GO!" : beat;
			sub = beat === "GO" ? "Fight!" : "Get ready";
			foot = "Punch the bad guys";
		} else if (phase === "tutorial") {
			const spec = this.tutorialSpec();
			title = spec?.title || "TUTORIAL";
			sub = spec?.body || "";
			const need = this.tutorialNeed || 0;
			foot = this.tutorialStep === "wave"
				? (this.waveWaving ? "Keep waving…" : "Wave to fill")
				: need > 0
					? (spec?.hint ? spec.hint + "  ·  " : "") + `${this.tutorialCount || 0} / ${need}`
					: (spec?.hint || "");
		} else {
			title = msg;
		}

		const countdownLook = phase === "readying" || (phase === "tutorial" && this.tutorialStep === "countdown");
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#ffe08a";
		ctx.font = countdownLook
			? "bold 160px system-ui, Segoe UI, sans-serif"
			: phase === "tutorial"
				? "bold 48px system-ui, Segoe UI, sans-serif"
				: "bold 64px system-ui, Segoe UI, sans-serif";
		ctx.fillText(title, c.width / 2, c.height * (countdownLook ? 0.38 : phase === "tutorial" ? 0.28 : 0.38), c.width - 80);
		if (sub) {
			ctx.fillStyle = "#f2efe8";
			ctx.font = phase === "tutorial" && !countdownLook
				? "26px system-ui, Segoe UI, sans-serif"
				: "32px system-ui, Segoe UI, sans-serif";
			if (phase === "tutorial" && !countdownLook) {
				const lines = this.wrapHudText(ctx, sub, c.width - 100);
				const startY = c.height * 0.48;
				for (let i = 0; i < lines.length; i++) {
					ctx.fillText(lines[i], c.width / 2, startY + i * 32, c.width - 80);
				}
			} else {
				ctx.fillText(sub, c.width / 2, c.height * 0.58, c.width - 80);
			}
		}
		if (foot) {
			ctx.fillStyle = "rgba(242,239,232,0.78)";
			ctx.font = "28px system-ui, Segoe UI, sans-serif";
			ctx.fillText(foot, c.width / 2, c.height * (phase === "tutorial" && this.tutorialStep === "wave" ? 0.90 : 0.84), c.width - 80);
		}
		if (phase === "tutorial" && this.tutorialStep === "wave") {
			const bx = 90;
			const by = c.height * 0.78;
			const bw = c.width - 180;
			const bh = 32;
			const pct = Math.max(0, Math.min(1, (this.waveMeter || 0) / (this.waveMeterMax || 5)));
			ctx.fillStyle = "rgba(20,16,28,0.9)";
			if (typeof ctx.roundRect === "function") {
				ctx.beginPath();
				ctx.roundRect(bx, by, bw, bh, 12);
				ctx.fill();
			} else ctx.fillRect(bx, by, bw, bh);
			ctx.fillStyle = this.waveWaving ? "#7dffa8" : "#ffe08a";
			if (pct > 0.01) {
				if (typeof ctx.roundRect === "function") {
					ctx.beginPath();
					ctx.roundRect(bx + 3, by + 3, Math.max(8, (bw - 6) * pct), bh - 6, 10);
					ctx.fill();
				} else ctx.fillRect(bx + 3, by + 3, (bw - 6) * pct, bh - 6);
			}
			ctx.strokeStyle = "rgba(255,224,138,0.7)";
			ctx.lineWidth = 3;
			if (typeof ctx.roundRect === "function") {
				ctx.beginPath();
				ctx.roundRect(bx, by, bw, bh, 12);
				ctx.stroke();
			} else ctx.strokeRect(bx, by, bw, bh);
			ctx.fillStyle = "#1a1410";
			ctx.font = "bold 22px system-ui, Segoe UI, sans-serif";
			ctx.fillText("WAVEOMETER  " + (this.waveMeter || 0).toFixed(1) + " / 5.0", c.width / 2, by + bh * 0.55);
		}
		this.xrHudTex.needsUpdate = true;
	}
	wrapHudText(ctx, text, maxWidth) {
		const words = String(text || "").split(/\s+/);
		const lines = [];
		let line = "";
		for (const w of words) {
			const test = line ? line + " " + w : w;
			if (line && ctx.measureText(test).width > maxWidth) {
				lines.push(line);
				line = w;
			} else line = test;
		}
		if (line) lines.push(line);
		return lines.slice(0, 5);
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
			xrHandsOn: !!this.xrShowSkinnedHands,
			fxHitParticles: !!this.fxHitParticles,
			fxFlightTrail: !!this.fxFlightTrail,
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
			mpRoom: this.mpRoom,
			mpName: this.mpName,
			mpConnected: !!this.mpConnected,
			mpPeers: this.mpPeers || 0,
			mpError: this.mpError,
			mpGlow: this.heartGlow || 0,
			walkSpeed: this.walkLeverAmount || 0,
			mpPeerNames: [...(this.party?.remotes?.values() || [])].map((r) => r.name),
			bootReady: !!this.bootReady,
			bootPct: this.bootPct || 0,
			bootStep: this.bootStep || "",
			bootLog: this.bootLog || [],
			tutorialStep: this.phase === "tutorial" ? this.tutorialStep : null,
			tutorialTitle: this.phase === "tutorial" ? (this.tutorialSpec()?.title || "") : "",
			tutorialBody: this.phase === "tutorial" ? (this.tutorialSpec()?.body || "") : "",
			tutorialHint: this.phase === "tutorial" ? (this.tutorialSpec()?.hint || "") : "",
			tutorialProgress: this.phase === "tutorial" && this.tutorialStep === "wave" ? (this.waveMeter || 0) : (this.tutorialCount || 0),
			tutorialNeed: this.tutorialNeed || 0,
			tutorialWaving: this.phase === "tutorial" && this.tutorialStep === "wave" ? !!this.waveWaving : false,
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


	bootstrapParty() {
		let room = "arena";
		let name = "Fighter-" + Math.random().toString(36).slice(2, 6);
		try {
			const q = new URLSearchParams(window.location.search);
			if (q.get("room")) room = q.get("room");
			if (q.get("name")) name = q.get("name");
			const lsR = localStorage.getItem("psp-room");
			const lsN = localStorage.getItem("psp-name");
			if (!q.get("room") && lsR) room = lsR;
			if (!q.get("name") && lsN) name = lsN;
		} catch { /* */ }
		this.joinParty(room, name);
	}
	joinParty(room, name) {
		this.mpRoom = (room || "arena").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "arena";
		this.mpName = (name || "Fighter").slice(0, 24);
		try {
			localStorage.setItem("psp-room", this.mpRoom);
			localStorage.setItem("psp-name", this.mpName);
		} catch { /* */ }
		for (const [, rec] of this.partyRemotes) {
			if (rec.group?.parent) rec.group.parent.remove(rec.group);
		}
		this.partyRemotes.clear();
		if (!this.party) this.party = new PartyArena();
		this.party.onChange = () => {
			this.mpConnected = !!this.party.connected;
			this.mpPeers = this.party.remotes.size;
			this.mpError = this.party.lastError;
			this.emitHud();
		};
		this.party.connect(this.mpRoom, this.mpName);
		this.mpConnected = false;
		this.mpError = null;
		this.emitHud();
	}
	leaveParty() {
		this.party?.close();
		this.mpConnected = false;
		this.mpPeers = 0;
		for (const [, rec] of this.partyRemotes) {
			if (rec.group?.parent) rec.group.parent.remove(rec.group);
		}
		this.partyRemotes.clear();
		this.emitHud();
	}
	/** Face `obj` at the headset, locked to world-up (no headset roll). */
	billboardYUp(obj) {
		if (!obj) return;
		const cam = new THREE.Vector3();
		this.camera.getWorldPosition(cam);
		const pos = new THREE.Vector3();
		obj.getWorldPosition(pos);
		const toCam = cam.sub(pos);
		if (toCam.lengthSq() < 1e-8) return;
		const y = new THREE.Vector3(0, 1, 0);
		const z = toCam.normalize();
		const x = new THREE.Vector3().crossVectors(y, z);
		if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
		x.normalize();
		z.crossVectors(x, y).normalize();
		const worldQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
		const parent = obj.parent;
		if (parent) {
			parent.updateWorldMatrix(true, false);
			const pq = new THREE.Quaternion();
			parent.getWorldQuaternion(pq);
			obj.quaternion.copy(pq.invert()).multiply(worldQ);
		} else {
			obj.quaternion.copy(worldQ);
		}
	}
	hpFillColor(ratio) {
		if (ratio < 0.34) return 0xff0033;
		if (ratio < 0.62) return 0xffee00;
		return 0x00ff66;
	}
	worldHandPos(side) {
		if (this.xrActive) {
			const valid = side === "L" ? this.xrWristValidL : this.xrWristValidR;
			if (valid) return (side === "L" ? this.xrWristPosL : this.xrWristPosR).clone();
			const g = side === "L" ? this.xrGloveL : this.xrGloveR;
			if (g) {
				const p = new THREE.Vector3();
				g.getWorldPosition(p);
				return p;
			}
		}
		const g = side === "L" ? this.leftGlove : this.rightGlove;
		const local = g ? g.position.clone() : (side === "L" ? this.leftRest.clone() : this.rightRest.clone());
		return local.applyQuaternion(this.camera.quaternion).add(this.camera.position);
	}
	handSnap(side) {
		const g = side === "L" ? this.handGestureL : this.handGestureR;
		const key = this.handMeshKey(side);
		const p = this.worldHandPos(side);
		return { p: [p.x, p.y, p.z], g: g || key || "punch" };
	}
	updatePartyNet(dt) {
		this.syncRemoteFighters(dt);
		this.updateHeartGlow(dt);
		if (!this.party) return;
		const now = performance.now();
		if (now - this.partySendAt < 70) return;
		this.partySendAt = now;
		if (!this.party.connected) return;
		const pos = this.getPlayerPos();
		const fwd = new THREE.Vector3();
		this.camera.getWorldDirection(fwd);
		if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
		this.party.sendState({
			p: [pos.x, pos.y, pos.z],
			f: [fwd.x, fwd.y, fwd.z],
			L: this.handSnap("L"),
			R: this.handSnap("R"),
		});
	}
	remoteSlotOffset(st) {
		const theirs = slotWorldX(st?.slot || 0);
		const mine = slotWorldX(this.party?.slot || 0);
		return theirs - mine;
	}
	ensureRemoteFighter(id, name) {
		let rec = this.partyRemotes.get(id);
		if (rec) {
			if (name && name !== rec.name) {
				rec.name = name;
				if (rec.label) rec.label.parent?.remove(rec.label);
				rec.label = this.makeRemoteNameTag(name);
				rec.group.add(rec.label);
			}
			return rec;
		}
		const group = new THREE.Group();
		group.name = "remote_" + id;
		const body = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.22, 0.9, 4, 8),
			new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 0.55, metalness: 0.15 }),
		);
		body.position.y = 0.7;
		group.add(body);
		const head = new THREE.Mesh(
			new THREE.SphereGeometry(0.16, 12, 10),
			new THREE.MeshStandardMaterial({ color: 0xffc9a8, roughness: 0.45 }),
		);
		head.position.y = 1.38;
		group.add(head);
		const visor = new THREE.Mesh(
			new THREE.BoxGeometry(0.22, 0.06, 0.08),
			new THREE.MeshStandardMaterial({ color: 0xff4d8d, emissive: 0xff2a6a, emissiveIntensity: 0.7 }),
		);
		visor.position.set(0, 1.4, 0.12);
		group.add(visor);
		const gloveL = makeGestureHand(this.palette, "heart", "L");
		const gloveR = makeGestureHand(this.palette, "heart", "R");
		gloveL.userData.baseScale = 1.15;
		gloveR.userData.baseScale = 1.15;
		gloveL.scale.setScalar(1.15);
		gloveR.scale.setScalar(1.15);
		gloveL.visible = false;
		gloveR.visible = false;
		this.uniquifyMaterials(gloveL);
		this.uniquifyMaterials(gloveR);
		group.add(gloveL);
		group.add(gloveR);
		const label = this.makeRemoteNameTag(name || "Fighter");
		group.add(label);
		this.scene.add(group);
		rec = { id, name: name || "Fighter", group, gloveL, gloveR, label, last: null, ox: 0 };
		this.partyRemotes.set(id, rec);
		return rec;
	}
	makeRemoteNameTag(name) {
		const c = document.createElement("canvas");
		c.width = 256;
		c.height = 64;
		const ctx = c.getContext("2d");
		ctx.clearRect(0, 0, 256, 64);
		const label = String(name || "Fighter").slice(0, 16);
		ctx.font = "700 26px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.lineWidth = 6;
		ctx.strokeStyle = "rgba(8,6,10,0.85)";
		ctx.strokeText(label, 128, 34);
		ctx.fillStyle = "#ffffff";
		ctx.fillText(label, 128, 34);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.95, 0.24),
			new THREE.MeshBasicMaterial({
				map: tex,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide,
			}),
		);
		mesh.position.y = 1.82;
		mesh.renderOrder = 18;
		mesh.userData.isNameTag = true;
		mesh.userData.billboardYUp = true;
		return mesh;
	}
	syncRemoteFighters() {
		const live = this.party?.remotes || new Map();
		const seen = new Set();
		const stale = performance.now() - 4000;
		for (const [id, st] of live) {
			if (st.at && st.at < stale) continue;
			seen.add(id);
			const rec = this.ensureRemoteFighter(id, st.name);
			const ox = this.remoteSlotOffset(st);
			rec.ox = ox;
			const g = rec.group;
			g.position.lerp(new THREE.Vector3(st.p[0] + ox, 0, st.p[2]), 0.28);
			const face = new THREE.Vector3(st.p[0] + ox + st.f[0], g.position.y, st.p[2] + st.f[2]);
			g.lookAt(face);
			const place = (mesh, snap, fallbackX) => {
				if (!mesh) return;
				if (snap) {
					mesh.position.lerp(
						new THREE.Vector3(
							snap.p[0] + ox - g.position.x,
							snap.p[1] - g.position.y,
							snap.p[2] - g.position.z,
						),
						0.35,
					);
					mesh.visible = snap.g === "heart";
				} else {
					mesh.position.lerp(new THREE.Vector3(fallbackX, 0.95, 0.25), 0.2);
					mesh.visible = false;
				}
			};
			place(rec.gloveL, st.L, -0.28);
			place(rec.gloveR, st.R, 0.28);
			if (rec.label) this.billboardYUp(rec.label);
		}
		for (const [id, rec] of this.partyRemotes) {
			if (seen.has(id)) continue;
			if (rec.group?.parent) rec.group.parent.remove(rec.group);
			this.partyRemotes.delete(id);
		}
		this.mpPeers = this.partyRemotes.size;
	}
	heartPairGlow(a, b) {
		if (!a || !b) return 0;
		const d = a.distanceTo(b);
		// Faint link from ~0.8m, full when the C's nearly touch
		return THREE.MathUtils.clamp(1 - (d - 0.08) / 0.72, 0, 1);
	}
	handsCloseForHeart() {
		const a = this.worldHandPos("L");
		const b = this.worldHandPos("R");
		if (!a || !b) return false;
		return a.distanceTo(b) < 0.18;
	}
	placeHeartBeam(mesh, a, b, glow) {
		if (!mesh) return;
		const dist = Math.max(0.04, a.distanceTo(b));
		const mid = a.clone().add(b).multiplyScalar(0.5);
		mesh.position.copy(mid);
		mesh.scale.set(0.55 + glow * 2.4, dist, 0.55 + glow * 2.4);
		mesh.lookAt(b);
		mesh.rotateX(Math.PI / 2);
		mesh.visible = true;
		if (mesh.material) {
			mesh.material.opacity = 0.1 + glow * 0.88;
			if (mesh.material.color) mesh.material.color.setHex(glow > 0.75 ? 0xffe0ef : 0xff4d8d);
		}
	}
	heartMeshFor(side) {
		if (this.xrActive) return side === "L" ? this.xrGloveMeshesL?.heart : this.xrGloveMeshesR?.heart;
		return side === "L" ? this.leftMeshes?.heart : this.rightMeshes?.heart;
	}
	updateHeartGlow(dt) {
		const bothLocal = this.handGestureL === "heart" && this.handGestureR === "heart";
		const halves = [];
		if (this.handGestureL === "heart") {
			halves.push({ who: "meL", local: true, side: "L", pos: this.heartSeatL || this.worldHandPos("L"), mesh: this.heartMeshFor("L") });
		}
		if (this.handGestureR === "heart") {
			halves.push({ who: "meR", local: true, side: "R", pos: this.heartSeatR || this.worldHandPos("R"), mesh: this.heartMeshFor("R") });
		}
		for (const rec of this.partyRemotes.values()) {
			const st = this.party?.remotes.get(rec.id);
			if (!st) continue;
			const ox = rec.ox || this.remoteSlotOffset(st);
			if (st.L?.g === "heart") {
				halves.push({ who: rec.id + "L", local: false, pos: new THREE.Vector3(st.L.p[0] + ox, st.L.p[1], st.L.p[2]), mesh: rec.gloveL });
			}
			if (st.R?.g === "heart") {
				halves.push({ who: rec.id + "R", local: false, pos: new THREE.Vector3(st.R.p[0] + ox, st.R.p[1], st.R.p[2]), mesh: rec.gloveR });
			}
		}
		let bestAny = 0, pairAny = null, bestMixed = 0, pairMixed = null;
		for (let i = 0; i < halves.length; i++) {
			for (let j = i + 1; j < halves.length; j++) {
				if (halves[i].who === halves[j].who) continue;
				const g = this.heartPairGlow(halves[i].pos, halves[j].pos);
				if (!pairAny || g > bestAny) { bestAny = g; pairAny = [halves[i], halves[j]]; }
				if (halves[i].local !== halves[j].local && g > bestMixed) {
					bestMixed = g;
					pairMixed = [halves[i], halves[j]];
				}
			}
		}
		const useMixed = !!(pairMixed && bestMixed > 0.04);
		const best = useMixed ? bestMixed : bestAny;
		const bestPair = useMixed ? pairMixed : pairAny;
		const pairLive = !!(bestPair && bestPair.length === 2);
		if (!pairLive) {
			this.hideHeartConnector();
			this.heartAimL = null;
			this.heartAimR = null;
			for (const h of halves) {
				if (h.mesh) setHeartHalfGlow(h.mesh, 0.1);
			}
			if (this.heartDetectHold > 0) this.heartDetectHold = Math.max(0, this.heartDetectHold - (dt || 0.016) * 2);
			return;
		}
		this.heartGlow = THREE.MathUtils.lerp(this.heartGlow || 0, best, 1 - Math.exp(-7 * (dt || 0.016)));
		this.heartAimL = null;
		this.heartAimR = null;
		if (bestPair) {
			for (const h of bestPair) {
				if (h.local && h.side === "L") this.heartAimL = bestPair[0] === h ? bestPair[1].pos : bestPair[0].pos;
				if (h.local && h.side === "R") this.heartAimR = bestPair[0] === h ? bestPair[1].pos : bestPair[0].pos;
			}
		}
		const shown = new Set();
		if (bestPair) {
			for (const h of bestPair) {
				if (h.mesh) { setHeartHalfGlow(h.mesh, this.heartGlow); shown.add(h.mesh); }
			}
		}
		for (const h of halves) {
			if (h.mesh && !shown.has(h.mesh)) setHeartHalfGlow(h.mesh, 0.1);
		}
		const distPair = bestPair[0].pos.distanceTo(bestPair[1].pos);
		const localOnly = !!(bestPair[0].local && bestPair[1].local && !this.xrActive);
		if (this.heartGlow > 0.4 && this.time - (this._heartChargeAt || 0) > 0.16) {
			this._heartChargeAt = this.time;
			if (this.audio.heartCharge) this.audio.heartCharge(this.heartGlow);
		}
		const closeEnoughToShowBeam = bothLocal || (distPair < 0.85 && this.heartGlow > 0.02);
		const displayGlow = bothLocal ? Math.max(this.heartGlow, 0.22) : this.heartGlow;
		if (closeEnoughToShowBeam) {
			if (localOnly && this.heartConnectMesh) {
				this.placeHeartBeam(this.heartConnectMesh, this.leftPos.clone(), this.rightPos.clone(), displayGlow);
			} else if (this.heartConnectMesh) {
				this.heartConnectMesh.visible = false;
			}
			if (!localOnly && this.heartWorldBeam) {
				this.placeHeartBeam(this.heartWorldBeam, bestPair[0].pos, bestPair[1].pos, displayGlow);
			} else if (this.heartWorldBeam) {
				this.heartWorldBeam.visible = false;
			}
		} else {
			if (this.heartConnectMesh) this.heartConnectMesh.visible = false;
			if (this.heartWorldBeam) this.heartWorldBeam.visible = false;
		}
		const involvesRemote = !!(bestPair && (!bestPair[0].local || !bestPair[1].local));
		const bothLocalHeart = this.handGestureL === "heart" && this.handGestureR === "heart";
		// Local fusion is handled by XR / camera tip detectors. Only remote pairs fuse here,
		// and only when the halves are actually touching.
		const touch = distPair < 0.13;
		if (involvesRemote && touch) {
			this.heartDetectHold = (this.heartDetectHold || 0) + (dt || 0.016);
			if (this.heartDetectHold > 0.4) {
				const mid = bestPair[0].pos.clone().add(bestPair[1].pos).multiplyScalar(0.5);
				this.spawnHeartShield(mid);
				this.heartDetectHold = -0.9;
			}
		} else if (!this.xrActive && !this.cameraHands && bothLocalHeart && touch) {
			this.heartDetectHold = (this.heartDetectHold || 0) + (dt || 0.016);
			if (this.heartDetectHold > 0.4) {
				this.spawnHeartShield();
				this.heartDetectHold = -0.9;
			}
		} else if (!this.xrActive && !this.cameraHands && (this.heartDetectHold || 0) > 0 && !touch) {
			this.heartDetectHold = Math.max(0, this.heartDetectHold - (dt || 0.016) * 3);
		}
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

	isStartToy(e) {
		return e && (e.kind === "heavyBag" || e.kind === "gumballMachine" || e.kind === "funBox" || e.kind === "tree");
	}

	copyToyHitPos(e, out) {
		const p = out || this.tmp;
		if (e.kind === "heavyBag" && e.bagBody) {
			e.bagBody.updateWorldMatrix(true, false);
			e.bagBody.getWorldPosition(p);
			return p;
		}
		if (e.mesh) {
			e.mesh.updateWorldMatrix(true, false);
			e.mesh.getWorldPosition(p);
		} else {
			p.set(0, 0, 0);
		}
		if (e.kind === "gumballMachine") p.y += 1.05;
		else if (e.kind === "tree") p.y += e.stripped ? 0.55 : 1.55;
		else if (e.kind === "funBox") { /* center */ }
		else if (e.kind !== "heavyBag") p.y += 0.65;
		return p;
	}

	projectileHitsToy(e, pos, prev, projR) {
		if (!e?.mesh) return false;
		const p = this.copyToyHitPos(e, this._toyHit);
		if (e.kind === "tree") {
			e.mesh.getWorldPosition(this.tmp);
			const r = (e.stripped ? 0.62 : 1.25) * (e.mesh.scale?.x || 1) + projR;
			const y0 = this.tmp.y - 0.15;
			const y1 = this.tmp.y + (e.stripped ? (e.trunkH || 1.6) + 0.3 : (e.trunkH || 1.6) + 2.2);
			const xz = (pt) => Math.hypot(pt.x - this.tmp.x, pt.z - this.tmp.z);
			const yOk = (pt) => pt.y >= y0 && pt.y <= y1;
			return (yOk(pos) && xz(pos) < r) || (yOk(prev) && xz(prev) < r);
		}
		if (e.kind === "gumballMachine") {
			e.mesh.getWorldPosition(this.tmp);
			const r = 0.62 + projR;
			const xz = (pt) => Math.hypot(pt.x - this.tmp.x, pt.z - this.tmp.z);
			const yOk = (pt) => pt.y > this.tmp.y + 0.05 && pt.y < this.tmp.y + 2.05;
			return (yOk(pos) && xz(pos) < r) || (yOk(prev) && xz(prev) < r);
		}
		const hitR = (e.radius || 0.5) + projR + (e.kind === "heavyBag" ? 0.28 : 0);
		return pos.distanceTo(p) < hitR || prev.distanceTo(p) < hitR;
	}

	applyPropHit(e, dir, force) {
		if (!e || !e.alive) return false;
		if (e.kind === "funBox") {
			this.knockFunBox(e, dir, force);
			return true;
		}
		if (e.kind === "heavyBag") {
			this.hitHeavyBag(e, dir, force);
			return true;
		}
		if (e.kind === "gumballMachine") {
			this.hitGumballMachine(e, dir, force);
			return true;
		}
		if (e.kind === "tree") {
			this.hitTree(e, dir, force);
			return true;
		}
		return false;
	}

	/** Airport moving walkway — flat rubber belt, glass rails. */
	spawnMovingWalkway() {
		if (this.walkwayRoot?.parent) this.walkwayRoot.parent.remove(this.walkwayRoot);
		const w = makeMovingWalkway(this.palette);
		w.position.set(0, 0, -28);
		this.arenaRoot.add(w);
		this.walkwayRoot = w;
		this.walkwayBeltMat = w.userData.beltMat || null;
		this.walkLoopLength = w.userData.length || 96;
		for (let i = 0; i < 8; i++) {
			const z = -2 - i * 8;
			const L = makeLantern(this.palette, i % 3 === 0 ? "gold" : i % 3 === 1 ? "cyan" : "pink");
			L.position.set(-3.55, 0, z);
			this.arenaRoot.add(L);
			const R = makeLantern(this.palette, i % 3 === 0 ? "pink" : "gold");
			R.position.set(3.55, 0, z);
			this.arenaRoot.add(R);
			if (i % 2 === 0) {
				const light = new THREE.PointLight(i % 4 === 0 ? 16764006 : 6741503, this.isMobile ? .55 : 0.9, 10, 2);
				light.position.set(0, 1.5, z);
				this.arenaRoot.add(light);
			}
		}
	}
	/** Speed lever on the right — default pushed back (idle). Fist-grab and shove forward. */
	spawnSpeedLever() {
		if (this.walkLever?.parent) this.walkLever.parent.remove(this.walkLever);
		const lever = makeSpeedLever(this.palette);
		this.walkLever = lever;
		this.walkLeverPivot = lever.userData.pivot;
		this.walkLeverHandle = lever.userData.handle;
		this.walkLeverHalo = lever.userData.halo;
		this.walkLeverPips = lever.userData.pips || [];
		this.walkLeverRestAng = lever.userData.restAng ?? 0.72;
		this.walkLeverFullAng = lever.userData.fullAng ?? -0.68;
		this.walkLeverAmount = 0;
		this.walkLeverGrabSide = null;
		this.walkSpeed = 0;
		this.walkLeverSnapped = false;
		this.placeSpeedLever();
		this.setSpeedLeverEnabled(false);
	}
	setSpeedLeverEnabled(on) {
		if (!this.walkLever) return;
		this.walkLever.visible = !!on;
		if (!on) {
			this.walkLeverGrabSide = null;
			this.applyWalkLeverAmount(0);
		} else {
			this.snapLeverBesidePlayer();
			this.placeSpeedLever();
		}
	}
	headLocalOnRig() {
		if (!this.camera) return null;
		if (this.xrActive && this.playerRig && this.camera.parent === this.playerRig) {
			return this.camera.position;
		}
		if (this.xrActive && this.playerRig) {
			this.playerRig.updateWorldMatrix(true, false);
			this.camera.updateMatrixWorld();
			return this.playerRig.worldToLocal(this.camera.getWorldPosition(this.tmp.clone()));
		}
		return this.camera.position;
	}
	snapLeverBesidePlayer() {
		if (!this.walkLever) return;
		const head = this.headLocalOnRig();
		if (this.xrActive && this.playerRig && head) {
			this.walkLeverOffset.set(head.x + 0.36, 0, head.z - 0.4);
			this.walkLeverSnapped = true;
			return;
		}
		const p = this.camera?.position;
		if (p) this.walkLeverOffset.set(p.x + 0.5, 0, p.z - 0.75);
		this.walkLeverSnapped = true;
	}
	placeSpeedLever() {
		if (!this.walkLever) return;
		if (this.xrActive && this.playerRig) {
			if (this.walkLever.parent !== this.playerRig) this.playerRig.add(this.walkLever);
			const head = this.headLocalOnRig();
			const headOk = head && (head.y > 0.45 || Math.hypot(head.x, head.z) > 0.08);
			if (headOk && !this.walkLeverSnapped) this.snapLeverBesidePlayer();
			if (headOk && this.walkLeverSnapped && this.walkLeverGrabSide == null) {
				const dx = head.x - this.walkLeverOffset.x;
				const dz = head.z - this.walkLeverOffset.z;
				if (Math.hypot(dx, dz) > 2.2) this.snapLeverBesidePlayer();
			}
			this.walkLever.position.copy(this.walkLeverOffset);
			this.walkLever.rotation.set(0, 0, 0);
			return;
		}
		if (this.walkLever.parent !== this.arenaRoot) this.arenaRoot.add(this.walkLever);
		const p = this.camera.position;
		this.walkLever.position.set(p.x + 0.5, 0, p.z - 0.75);
		this.walkLever.rotation.set(0, 0, 0);
	}
	loopWalkwayToStart() {
		const z0 = this.walkStartZ || 0;
		if (this.xrActive && this.playerRig) {
			this.playerRig.position.z = z0;
		} else if (this.camera) {
			this.camera.position.z = z0;
		}
		this.walkTravel = 0;
		if (this.walkwayBeltMat?.map) {
			this.walkwayBeltMat.map.offset.y = 0;
			this.walkwayBeltMat.map.needsUpdate = true;
		}
		this.walkLeverSnapped = false;
		this.placeSpeedLever();
		this.pushMsg("Back to the start", 1.3);
		if (this.audio.whoosh) this.audio.whoosh();
		else this.audio.click();
	}
	leverHandPos(side) {
		if (this.xrActive) {
			if (side === "L" ? this.xrPalmValidL : this.xrPalmValidR) {
				return (side === "L" ? this.xrPalmPosL : this.xrPalmPosR).clone();
			}
		}
		return this.worldHandPos(side);
	}
	handNearWalkLever(side, radius = 0.34) {
		if (!this.walkLeverHandle) return false;
		this.walkLeverHandle.getWorldPosition(this._walkHandle);
		const palm = this.leverHandPos(side);
		if (palm && palm.distanceTo(this._walkHandle) < radius) return true;
		const wrist = this.worldHandPos(side);
		if (wrist && wrist.distanceTo(this._walkHandle) < radius + 0.08) return true;
		return false;
	}
	setWalkThrottle(v) {
		this.walkLeverWantGrab = !!v;
	}
	applyWalkLeverAmount(amount) {
		const next = THREE.MathUtils.clamp(amount, 0, 1);
		const changed = Math.abs(next - (this.walkLeverAmount || 0)) > 0.04;
		this.walkLeverAmount = next;
		if (this.walkLeverPivot) {
			const rest = this.walkLeverRestAng;
			const full = this.walkLeverFullAng;
			this.walkLeverPivot.rotation.x = rest + (full - rest) * this.walkLeverAmount;
		}
		const pips = this.walkLeverPips || [];
		const lit = Math.round(this.walkLeverAmount * pips.length);
		for (let i = 0; i < pips.length; i++) {
			const m = pips[i]?.material;
			if (!m) continue;
			m.emissiveIntensity = i < lit ? 1.35 : 0.05;
			if (m.color) m.color.setHex(i < lit ? 0x7dce4a : 0x1a2418);
		}
		if (changed) this.emitHud();
	}
	tryGrabWalkLever(side, want) {
		if (!this.walkLeverHandle) return false;
		this.walkLeverHandle.getWorldPosition(this._walkHandle);
		const hand = this.leverHandPos(side);
		if (!hand) return false;
		const d = hand.distanceTo(this._walkHandle);
		const already = this.walkLeverGrabSide === side;
		if (want && d < (already ? 0.55 : 0.38)) {
			if (!already) {
				this.walkLeverGrabSide = side;
				this.walkLever.updateWorldMatrix(true, false);
				const local = this.walkLever.worldToLocal(hand.clone());
				this.walkLeverGrabLocalZ = local.z;
				this.walkLeverGrabAmt = this.walkLeverAmount;
				if (this.audio.leverGrab) this.audio.leverGrab();
				else this.audio.click();
				this.pushMsg("Throttle grabbed — push forward", 0.9);
				try {
					const session = this.renderer?.xr?.getSession?.();
					for (const src of session?.inputSources || []) {
						const gp = src.gamepad;
						const act = gp?.hapticActuators?.[0] || gp?.vibrationActuator;
						if (act?.pulse) act.pulse(0.7, 55);
					}
				} catch { /* */ }
			}
			return true;
		}
		return false;
	}
	updateWalkway(dt) {
		if (!this.walkLever) return;
		if (!this.walkLever.visible || this.phase === "tutorial") {
			if (this.walkLeverAmount) this.applyWalkLeverAmount(0);
			this.placeSpeedLever();
			return;
		}
		this.placeSpeedLever();
		const shift = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.walkLeverWantGrab;
		if (this.xrActive) {
			const isClearlyOpen = (side) => {
				const g = side === "L" ? this.handGestureL : this.handGestureR;
				const curl = side === "L" ? this.xrCurlL : this.xrCurlR;
				if (g === "slap" || g === "peace" || g === "spock") return true;
				if (curl >= 3) return true;
				return false;
			};
			const isClosedFist = (side) => {
				if (isClearlyOpen(side)) return false;
				const g = side === "L" ? this.handGestureL : this.handGestureR;
				const kind = side === "L" ? this.xrGestKindL : this.xrGestKindR;
				const pinched = side === "L" ? this.xrSelectL : this.xrSelectR;
				const curl = side === "L" ? this.xrCurlL : this.xrCurlR;
				if (pinched) return true;
				if (g === "punch" || kind === "punch" || g === "heart") return true;
				if (curl <= 1) return true;
				return false;
			};
			for (const side of ["L", "R"]) {
				const inZone = this.handNearWalkLever(side, 0.32);
				const closed = isClosedFist(side);
				const open = isClearlyOpen(side);
				const wasIn = this.walkLeverInZone[side];
				if (!inZone) {
					if (this.walkLeverGrabSide !== side) {
						this.walkLeverArmed[side] = false;
						this.walkLeverOpenTime[side] = 0;
					}
					this.walkLeverInZone[side] = false;
					this.walkLeverFistWas[side] = closed;
					continue;
				}
				if (!wasIn) {
					// Just entered: never arm from the entry frame. A punch can
					// flicker "open" for a tick as it swings through.
					this.walkLeverArmed[side] = false;
					this.walkLeverOpenTime[side] = 0;
				}
				if (open) {
					this.walkLeverOpenTime[side] += dt;
					if (this.walkLeverOpenTime[side] >= 0.08) this.walkLeverArmed[side] = true;
				} else {
					this.walkLeverOpenTime[side] = 0;
				}
				const justClosed = closed && !this.walkLeverFistWas[side];
				this.walkLeverFistWas[side] = closed;
				this.walkLeverInZone[side] = true;
				// Grab only on the close that happens while already in the zone
				// with an armed (open) hand. Never on a punch swinging through.
				if (this.walkLeverGrabSide !== side && justClosed && this.walkLeverArmed[side]) {
					this.tryGrabWalkLever(side, true);
				}
			}
			if (this.walkLeverGrabSide) {
				const side = this.walkLeverGrabSide;
				const stillNear = this.handNearWalkLever(side, 0.58);
				if (!stillNear || isClearlyOpen(side)) {
					if (this.audio.leverRelease) this.audio.leverRelease();
					this.walkLeverGrabSide = null;
					this.walkLeverArmed[side] = isClearlyOpen(side);
				}
			}
		}
		if (this.walkLeverGrabSide && this.walkLeverPivot) {
			const hand = this.leverHandPos(this.walkLeverGrabSide);
			if (hand) {
				this.walkLever.updateWorldMatrix(true, false);
				const local = this.walkLever.worldToLocal(hand.clone());
				// Relative to the pose at grab time so a wrap-offset wrist still pushes 1:1.
				const zTravel = 0.26;
				const amt = THREE.MathUtils.clamp(
					this.walkLeverGrabAmt + (this.walkLeverGrabLocalZ - local.z) / zTravel,
					0,
					1,
				);
				this.applyWalkLeverAmount(THREE.MathUtils.lerp(this.walkLeverAmount, amt, 1 - Math.exp(-18 * dt)));
			}
		} else if (shift) {
			this.applyWalkLeverAmount(Math.min(1, this.walkLeverAmount + dt * 2.4));
		} else {
			const next = this.walkLeverAmount * Math.exp(-3.1 * dt);
			this.applyWalkLeverAmount(next < 0.008 ? 0 : next);
			this.walkLeverGrabSide = null;
		}

		if (this.walkLeverHalo) {
			let nearHand = false;
			if (this.walkLeverHandle) {
				this.walkLeverHandle.getWorldPosition(this._walkHandle);
				for (const side of ["L", "R"]) {
					const hp = this.worldHandPos(side);
					if (hp && hp.distanceTo(this._walkHandle) < 0.42) nearHand = true;
				}
			}
			const near = this.walkLeverGrabSide || this.walkLeverAmount > 0.02 || nearHand;
			const mat = this.walkLeverHalo.material;
			if (mat) mat.opacity = this.walkLeverGrabSide ? 0.9 : nearHand ? 0.55 : (this.walkLeverAmount > 0.02 ? 0.28 + this.walkLeverAmount * 0.4 : 0.18);
			this.walkLeverHalo.rotation.z += dt * 1.4;
		}

		this.walkSpeed = this.walkLeverAmount * this.walkMaxSpeed;
		if (this.audio.walkRumble) this.audio.walkRumble(this.walkLeverAmount);

		if (this.walkSpeed > 0.01 && this.phase !== "paused") {
			const step = this.walkSpeed * dt;
			this.walkTravel += step;
			if (this.xrActive && this.playerRig) {
				this.playerRig.position.z -= step;
				this.playerRig.position.x = THREE.MathUtils.clamp(this.playerRig.position.x, -2.4, 2.4);
			} else if (!this.xrActive) {
				this.camera.position.z -= step;
			}
			if (this.walkwayBeltMat?.map) {
				this.walkwayBeltMat.map.offset.y = (this.walkTravel / 4) % 1;
				this.walkwayBeltMat.map.needsUpdate = true;
			}
			const pz = this.getPlayerPos().z;
			this.pathMinZ = Math.min(this.pathMinZ, pz - 38);
			this.pathMaxZ = pz + 8;
			const loopAt = (this.walkLoopLength || 96) * 0.5;
			if (this.walkTravel >= loopAt) this.loopWalkwayToStart();
		}
		if (!this.xrActive) this.placeSpeedLever();
	}

	/** Heavy bag + carnival gumball at spawn, just off the lane. */
	spawnStartToys() {
		for (const e of this.entities) {
			if (e.kind === "heavyBag" || e.kind === "gumballMachine") {
				this.destroyEntityBody(e);
				e.alive = false;
				this.scene.remove(e.mesh);
			}
		}
		this.entities = this.entities.filter((e) => e.kind !== "heavyBag" && e.kind !== "gumballMachine");

		const bagRig = makeHeavyBagRig();
		bagRig.position.set(2.55, 0, -1.55);
		bagRig.rotation.y = Math.PI;
		bagRig.scale.setScalar(1.08);
		this.scene.add(bagRig);
		const bagPivot = bagRig.userData.bagPivot;
		const bagBody = bagRig.userData.bagBody;
		this.entities.push({
			id: this.idSeq++,
			kind: "heavyBag",
			mesh: bagRig,
			bagPivot,
			bagBody,
			alive: true,
			hp: 999,
			maxHp: 999,
			radius: 0.78,
			vel: new THREE.Vector3(),
			age: 0,
			life: 9999,
			damage: 0,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 4,
			hand: null,
			powered: false,
			squash: 1,
			angX: 0,
			angZ: 0,
			angVelX: 0,
			angVelZ: 0,
			twist: 0,
			twistVel: 0,
			hitCd: 0,
			hits: 0,
		});

		const machine = makeGumballMachine();
		machine.position.set(-2.55, 0, -1.55);
		machine.rotation.y = 0.48;
		machine.scale.setScalar(1.45);
		this.scene.add(machine);
		this.entities.push({
			id: this.idSeq++,
			kind: "gumballMachine",
			mesh: machine,
			alive: true,
			hp: 999,
			maxHp: 999,
			radius: 0.92,
			vel: new THREE.Vector3(),
			age: 0,
			life: 9999,
			damage: 0,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 6,
			hand: null,
			powered: false,
			squash: 1,
			hits: 0,
			burst: false,
			jiggle: 0,
			hitCd: 0,
			restockT: 0,
		});
	}

	spawnArenaTrees() {
		for (const e of this.entities) {
			if (e.kind === "tree") {
				this.destroyEntityBody(e);
				e.alive = false;
				if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
				else this.scene.remove(e.mesh);
			}
		}
		this.entities = this.entities.filter((e) => e.kind !== "tree");
		if (this.arenaRoot) {
			const stale = this.arenaRoot.children.filter((c) => c.name === "arenaTree");
			for (const c of stale) this.arenaRoot.remove(c);
		}
		const spots = [];
		// Keep trunks + canopy off the wooden walkway (platforms ~6.4–8.5 wide).
		const off = this.pathHalfWidth + 2.55;
		spots.push([-off - 0.1, -2.05, 1.05], [off + 0.15, -2.1, 1.08]);
		spots.push([-off - 0.35, -3.85, 0.98], [off + 0.4, -4.0, 1.02]);
		for (let i = 0; i < 28; i++) {
			const side = i % 2 === 0 ? -1 : 1;
			spots.push([
				side * (off + 0.7 + (i % 5) * 0.5 + (i * 0.13) % 0.8),
				-2.2 - i * 2.55 + ((i * 17) % 9) * 0.08,
				0.85 + (i % 4) * 0.08,
			]);
		}
		for (let i = 0; i < spots.length; i++) {
			const [x0, z, sc] = spots[i];
			const minOff = this.pathHalfWidth + 2.35;
			const x = Math.abs(x0) < minOff ? Math.sign(x0 || 1) * minOff : x0;
			const mesh = makeArenaTree(this.palette, 11 + i * 17);
			mesh.position.set(x, 0, z);
			mesh.rotation.y = (i * 1.7) % (Math.PI * 2);
			mesh.scale.setScalar(sc);
			(this.arenaRoot || this.scene).add(mesh);
			const trunkH = mesh.userData.trunkH || 1.6;
			this.entities.push({
				id: this.idSeq++,
				kind: "tree",
				mesh,
				alive: true,
				hp: 999,
				maxHp: 999,
				radius: 0.95 * sc,
				vel: new THREE.Vector3(),
				age: 0,
				life: 9999,
				damage: 0,
				enemyType: "brawler",
				attackCd: 0,
				flash: 0,
				value: 5,
				hand: null,
				powered: false,
				squash: 1,
				stripped: false,
				fallen: false,
				fallAngle: 0,
				fallVel: 0,
				fallAxis: new THREE.Vector3(1, 0, 0),
				hitCd: 0,
				hits: 0,
				trunkH,
				canopy: mesh.userData.canopy,
				fall: mesh.userData.fall,
			});
		}
	}

	hitTree(e, dir, force = 7) {
		if (!e || !e.alive || e.kind !== "tree") return;
		if (e.hitCd > 0) return;
		e.hitCd = 0.12;
		const d = dir.clone();
		if (d.lengthSq() < 1e-6) d.set(0, 0.1, 1);
		d.y = 0;
		if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
		d.normalize();
		const f = THREE.MathUtils.clamp(force, 2, 18);
		const at = this.copyToyHitPos(e, new THREE.Vector3());

		if (e.fallen) {
			e.mesh.position.addScaledVector(d, 0.04);
			if (this.audio.impact) this.audio.impact("wood", 0.45);
			this.spawnFloatText(at.clone().add(new THREE.Vector3(0, 0.2, 0)), "THUNK", false);
			this.score += 1;
			this.emitHud();
			return;
		}

		if (!e.stripped) {
			e.stripped = true;
			e.hits = (e.hits || 0) + 1;
			const canopy = e.canopy || e.mesh.getObjectByName("canopy");
			e.canopy = canopy;
			if (canopy) canopy.visible = false;
			this.spawnFallingLeaves(at, d, 18 + Math.floor(f));
			if (this.audio.leafRustle) this.audio.leafRustle(0.7 + f * 0.04);
			else this.audio.impact("wood", 0.55);
			this.spawnFloatText(at.clone().add(new THREE.Vector3(0, 0.25, 0)), "RUSTLE", false);
			this.score += e.value || 5;
			this.combo += 1;
			this.comboTimer = 2.2;
			this.trauma = Math.min(1, this.trauma + 0.08);
			this.callbacks.onHitFlash?.(0.1);
			this.emitHud();
			return;
		}

		e.fallen = true;
		e.hits = (e.hits || 0) + 1;
		e.fall = e.fall || e.mesh.getObjectByName("treeFall") || e.mesh;
		e.fallVel = 2.4 + f * 0.18;
		e.fallAxis = new THREE.Vector3(-d.z, 0, d.x);
		if (e.fallAxis.lengthSq() < 1e-6) e.fallAxis.set(1, 0, 0);
		e.fallAxis.normalize();
		if (this.audio.treeCrack) this.audio.treeCrack();
		else this.audio.impact("wood", 0.95);
		this.spawnFloatText(at.clone().add(new THREE.Vector3(0, 0.35, 0)), "TIMBER!", true);
		this.score += 12;
		this.combo += 1;
		this.comboTimer = 2.4;
		this.trauma = Math.min(1, this.trauma + 0.16);
		this.camKick = Math.min(1, this.camKick + 0.18);
		this.hitstop = 0.04;
		this.burst(at, 0x6a4224, 10);
		this.callbacks.onHitFlash?.(0.16);
		this.emitHud();
	}

	spawnFallingLeaves(at, dir, count) {
		const n = Math.max(8, Math.min(28, count | 0));
		for (let i = 0; i < n; i++) {
			const mesh = makeFallingLeaf(this.palette);
			const ox = (Math.random() - 0.5) * 1.1;
			const oy = (Math.random() - 0.2) * 0.7;
			const oz = (Math.random() - 0.5) * 1.1;
			mesh.position.set(at.x + ox, Math.max(0.4, at.y + oy), at.z + oz);
			mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
			this.scene.add(mesh);
			const kick = 1.2 + Math.random() * 2.4;
			this.particles.push({
				mesh,
				vel: new THREE.Vector3(
					dir.x * kick + (Math.random() - 0.5) * 2.4,
					1.6 + Math.random() * 3.2,
					dir.z * kick + (Math.random() - 0.5) * 2.4,
				),
				life: 1.6 + Math.random() * 1.4,
				maxLife: 2.4,
				leaf: true,
				spin: (Math.random() - 0.5) * 8,
			});
		}
	}

	updateBagRope(e, dt) {
		if (!e?.mesh || !e.bagBody) return;
		const links = e.mesh.userData.chainLinks;
		if (!links || !links.length) return;
		const n = links.length + 1;
		const hookLocal = e.mesh.userData.hookLocal || new THREE.Vector3(0.62, 3.02, 0);
		e.mesh.updateWorldMatrix(true, false);
		e.bagBody.updateWorldMatrix(true, false);
		const hook = hookLocal.clone();
		e.mesh.localToWorld(hook);
		const bagTop = new THREE.Vector3(0, 0.62, 0);
		e.bagBody.localToWorld(bagTop);
		if (!e.ropePts || e.ropePts.length !== n) {
			e.ropePts = [];
			e.ropePrev = [];
			for (let i = 0; i < n; i++) {
				const t = i / (n - 1);
				const p = hook.clone().lerp(bagTop, t);
				e.ropePts.push(p);
				e.ropePrev.push(p.clone());
			}
			e.ropeRest = hook.distanceTo(bagTop) / Math.max(1, n - 1) + 0.016;
		}
		const pts = e.ropePts;
		const prev = e.ropePrev;
		pts[0].copy(hook);
		pts[n - 1].copy(bagTop);
		const dtClamped = Math.min(0.033, Math.max(0.001, dt || 0.016));
		const g = 22;
		for (let i = 1; i < n - 1; i++) {
			const p = pts[i];
			const o = prev[i];
			const vx = (p.x - o.x) * 0.96;
			const vy = (p.y - o.y) * 0.96;
			const vz = (p.z - o.z) * 0.96;
			o.copy(p);
			p.x += vx;
			p.y += vy - g * dtClamped * dtClamped;
			p.z += vz;
		}
		const rest = e.ropeRest || 0.1;
		for (let iter = 0; iter < 8; iter++) {
			pts[0].copy(hook);
			pts[n - 1].copy(bagTop);
			for (let i = 0; i < n - 1; i++) {
				const a = pts[i];
				const b = pts[i + 1];
				const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
				const dist = Math.hypot(dx, dy, dz) || 1e-6;
				const corr = (dist - rest) / dist;
				if (i === 0) {
					b.x -= dx * corr;
					b.y -= dy * corr;
					b.z -= dz * corr;
				} else if (i === n - 2) {
					a.x += dx * corr;
					a.y += dy * corr;
					a.z += dz * corr;
				} else {
					a.x += dx * corr * 0.5;
					a.y += dy * corr * 0.5;
					a.z += dz * corr * 0.5;
					b.x -= dx * corr * 0.5;
					b.y -= dy * corr * 0.5;
					b.z -= dz * corr * 0.5;
				}
			}
		}
		pts[0].copy(hook);
		pts[n - 1].copy(bagTop);
		for (let i = 0; i < links.length; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			const link = links[i];
			link.position.copy(a).add(b).multiplyScalar(0.5);
			e.mesh.worldToLocal(link.position);
			const dir = b.clone().sub(a);
			if (dir.lengthSq() < 1e-8) continue;
			dir.normalize();
			const up = Math.abs(dir.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
			const m = new THREE.Matrix4();
			m.lookAt(new THREE.Vector3(), dir, up);
			link.quaternion.setFromRotationMatrix(m);
			const pq = new THREE.Quaternion();
			e.mesh.getWorldQuaternion(pq);
			link.quaternion.premultiply(pq.invert());
			if (i % 2) link.rotateZ(Math.PI / 2);
		}
	}

	hitHeavyBag(e, dir, force = 7) {
		if (!e || !e.alive || e.kind !== "heavyBag") return;
		if (e.hitCd > 0) return;
		e.hitCd = 0.05;
		const d = dir.clone();
		if (d.lengthSq() < 1e-6) d.set(-1, 0.1, 0);
		d.y *= 0.15;
		if (d.lengthSq() < 1e-6) d.set(-1, 0, 0);
		d.normalize();
		const f = THREE.MathUtils.clamp(force, 2, 18);
		const kick = f * 0.72;
		// World-space: hanging bag COM should accelerate along the punch.
		// ω = down × punchDir so any stand yaw stays correct.
		const axisWorld = new THREE.Vector3().crossVectors(new THREE.Vector3(0, -1, 0), d);
		if (axisWorld.lengthSq() < 1e-8) axisWorld.set(1, 0, 0);
		axisWorld.normalize();
		const pivot = e.bagPivot || e.mesh;
		pivot.updateWorldMatrix(true, false);
		const pq = new THREE.Quaternion();
		pivot.getWorldQuaternion(pq);
		const axisLocal = axisWorld.clone().applyQuaternion(pq.invert());
		e.angVelX += axisLocal.x * kick;
		e.angVelZ += axisLocal.z * kick;
		e.twistVel += (d.x + d.z) * f * 0.12;
		if (e.ropePts && e.ropePts.length > 2) {
			for (let i = 2; i < e.ropePts.length - 1; i++) {
				const w = i / e.ropePts.length;
				e.ropePts[i].addScaledVector(d, kick * 0.014 * w);
			}
		}
		e.squash = 0.72;
		e.hits = (e.hits || 0) + 1;
		const p = this.copyToyHitPos(e, new THREE.Vector3());
		if (this.audio.bagThud) this.audio.bagThud(THREE.MathUtils.clamp(f / 10, 0.45, 1.25));
		else this.audio.impact("thud", 0.9);
		this.score += e.value || 4;
		this.combo += 1;
		this.comboTimer = 2.2;
		const label = e.hits % 5 === 0 ? `${e.hits}!` : f > 10 ? "WHAM" : "THUD";
		this.spawnFloatText(p.clone().add(new THREE.Vector3(0, 0.25, 0)), label, f > 10);
		this.burst(p.clone(), 0x8a2a28, 10);
		this.trauma = Math.min(1, this.trauma + 0.14 + f * 0.012);
		this.camKick = Math.min(1, this.camKick + 0.16);
		this.hitstop = 0.035;
		this.callbacks.onHitFlash?.(0.16);
		this.emitHud();
	}

	setGumballBowl(e, state) {
		if (!e?.mesh) return;
		const globe = e.mesh.getObjectByName("globe");
		const candy = e.mesh.getObjectByName("candy");
		const glass = e.mesh.getObjectByName("globeGlass");
		const cracks = e.mesh.getObjectByName("cracks");
		const full = state !== "empty";
		if (globe) globe.visible = full;
		if (candy) candy.visible = full;
		if (glass) glass.visible = full;
		if (cracks) cracks.visible = state === "cracked";
	}

	hitGumballMachine(e, dir, force = 7) {
		if (!e || !e.alive || e.kind !== "gumballMachine") return;
		if (e.hitCd > 0) return;
		e.hitCd = 0.09;
		const d = dir.clone();
		if (d.lengthSq() < 1e-6) d.set(1, 0.2, 0);
		d.normalize();
		const f = THREE.MathUtils.clamp(force, 2, 18);
		e.jiggle = 1;
		const globePos = e.mesh.position.clone();
		globePos.y += 0.95;

		// Empty husk after JACKPOT — clank only. Never show cracks without a bowl.
		if (e.burst) {
			this.setGumballBowl(e, "empty");
			if (this.audio.gumballRattle) this.audio.gumballRattle(0.45);
			else this.audio.impact("metal", 0.45);
			this.spawnFloatText(globePos.clone().add(new THREE.Vector3(0, 0.15, 0)), "CLANK", false);
			this.score += 2;
			this.combo += 1;
			this.comboTimer = 2.2;
			this.callbacks.onHitFlash?.(0.08);
			this.emitHud();
			return;
		}

		e.hits = (e.hits || 0) + 1;

		// First punch: bowl stays, cracks appear on the glass, a few balls drop from the chute.
		if (e.hits < 2) {
			this.setGumballBowl(e, "cracked");
			this.spitGumballsFromChute(e, 3 + Math.floor(f * 0.2));
			if (this.audio.gumballRattle) this.audio.gumballRattle(0.75 + f * 0.03);
			else this.audio.impact("metal", 0.6);
			this.spawnFloatText(globePos.clone().add(new THREE.Vector3(0, 0.2, 0)), "RATTLE", false);
			this.score += e.value || 6;
			this.trauma = Math.min(1, this.trauma + 0.1);
			this.camKick = Math.min(1, this.camKick + 0.12);
		} else {
			// Second punch: the whole bowl vanishes and candy sprays out.
			e.burst = true;
			e.restockT = 7;
			this.setGumballBowl(e, "empty");
			this.spawnGumballBurst(globePos, d, 20 + Math.floor(f));
			if (this.audio.gumballBurst) this.audio.gumballBurst();
			else this.audio.break();
			this.spawnFloatText(globePos.clone().add(new THREE.Vector3(0, 0.3, 0)), "JACKPOT!", true);
			this.score += 40;
			this.trauma = Math.min(1, this.trauma + 0.28);
			this.camKick = Math.min(1, this.camKick + 0.32);
			this.hitstop = 0.06;
			this.burst(globePos, 0xffcc22, 22);
			this.burst(globePos, 0xff3355, 16);
			this.burst(globePos, 0xc8f0ff, 12);
		}
		this.combo += 1;
		this.comboTimer = 2.2;
		this.callbacks.onHitFlash?.(0.14);
		this.emitHud();
	}

	spitGumballsFromChute(e, count) {
		const n = Math.max(1, Math.min(6, count | 0));
		e.mesh.updateWorldMatrix(true, false);
		const at = new THREE.Vector3(0, 0.24, 0.3).applyMatrix4(e.mesh.matrixWorld);
		const out = new THREE.Vector3(0, 0.15, 1).transformDirection(e.mesh.matrixWorld).normalize();
		this.spawnGumballBurst(at, out, n, { chute: true });
	}

	spawnGumballBurst(at, dir, count, opts = {}) {
		const n = Math.max(0, Math.min(28, count | 0));
		if (n <= 0) return;
		const chute = Boolean(opts.chute);
		const basis = dir.clone();
		if (basis.lengthSq() < 1e-6) basis.set(0, 1, 0);
		basis.normalize();
		for (let i = 0; i < n; i++) {
			const col = GUMBALL_COLORS[i % GUMBALL_COLORS.length];
			const mesh = makeGumball(col);
			const ox = (Math.random() - 0.5) * (chute ? 0.06 : 0.22);
			const oy = Math.random() * (chute ? 0.04 : 0.16);
			const oz = (Math.random() - 0.5) * (chute ? 0.06 : 0.22);
			const x = at.x + ox;
			const y = Math.max(0.12, at.y + oy);
			const z = at.z + oz;
			mesh.position.set(x, y, z);
			this.scene.add(mesh);
			let vx;
			let vy;
			let vz;
			if (chute) {
				const kick = 1.4 + Math.random() * 1.1;
				vx = basis.x * kick + (Math.random() - 0.5) * 0.6;
				vy = 1.1 + Math.random() * 1.4;
				vz = basis.z * kick + (Math.random() - 0.5) * 0.6;
			} else {
				const kick = 3.2 + Math.random() * 4.5;
				vx = basis.x * kick + (Math.random() - 0.5) * 3.2;
				vy = 2.4 + Math.random() * 3.8 + Math.max(0, basis.y) * 1.4;
				vz = basis.z * kick + (Math.random() - 0.5) * 3.2;
			}
			const body = sharedPhysics.ready
				? sharedPhysics.createSphere(x, y, z, 0.07, {
					role: "ball",
					density: 150,
					friction: 0.35,
					restitution: 0.62,
					gravityScale: 1,
				})
				: null;
			if (body) sharedPhysics.setLinearVelocity(body, vx, vy, vz);
			this.entities.push({
				id: this.idSeq++,
				kind: "funBox",
				mesh,
				alive: true,
				hp: 1,
				maxHp: 1,
				radius: 0.09,
				vel: new THREE.Vector3(vx, vy, vz),
				angVel: new THREE.Vector3(),
				age: 0,
				life: 9999,
				damage: 0,
				enemyType: "brawler",
				attackCd: 0,
				flash: 0,
				value: 3,
				hand: null,
				powered: false,
				squash: 1,
				boxSize: 0.14,
				settled: false,
				homeY: y,
				body,
			});
		}
	}

	updateStartToys(dt) {
		const bag = this.entities.find((e) => e.alive && e.kind === "heavyBag");
		const machine = this.entities.find((e) => e.alive && e.kind === "gumballMachine");
		if (!bag || !machine || !machine.mesh?.parent || !bag.mesh?.parent) {
			this.spawnStartToys();
		}
		for (const e of this.entities) {
			if (!e.alive) continue;
			if (e.kind === "heavyBag") {
				if (e.hitCd > 0) e.hitCd = Math.max(0, e.hitCd - dt);
				const L = 1.42;
				const g = 14;
				const w2 = g / L;
				e.angVelX += -Math.sin(e.angX || 0) * w2 * dt;
				e.angVelZ += -Math.sin(e.angZ || 0) * w2 * dt;
				// Tiny idle sway so the bag never looks frozen
				if (Math.abs(e.angVelX) < 0.08 && Math.abs(e.angX) < 0.04) {
					e.angVelX += Math.sin(this.time * 1.15) * 0.012 * dt;
				}
				if (Math.abs(e.angVelZ) < 0.08 && Math.abs(e.angZ) < 0.04) {
					e.angVelZ += Math.cos(this.time * 0.9) * 0.01 * dt;
				}
				const damp = Math.exp(-1.55 * dt);
				e.angVelX *= damp;
				e.angVelZ *= damp;
				e.twistVel = (e.twistVel || 0) * Math.exp(-2.2 * dt);
				e.angX = THREE.MathUtils.clamp((e.angX || 0) + e.angVelX * dt, -0.85, 0.85);
				e.angZ = THREE.MathUtils.clamp((e.angZ || 0) + e.angVelZ * dt, -0.85, 0.85);
				e.twist = (e.twist || 0) + e.twistVel * dt;
				if (e.bagPivot) {
					e.bagPivot.rotation.order = "XZY";
					e.bagPivot.rotation.x = e.angX;
					e.bagPivot.rotation.z = e.angZ;
					e.bagPivot.rotation.y = e.twist * 0.35;
				}
				e.squash += (1 - e.squash) * (1 - Math.exp(-10 * dt));
				if (e.bagBody) {
					const s = e.squash || 1;
					e.bagBody.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
				}
				this.updateBagRope(e, dt);
			} else if (e.kind === "gumballMachine") {
				if (e.hitCd > 0) e.hitCd = Math.max(0, e.hitCd - dt);
				if (e.burst && e.restockT > 0) {
					e.restockT = Math.max(0, e.restockT - dt);
					if (e.restockT <= 0) {
						e.burst = false;
						e.hits = 0;
						this.setGumballBowl(e, "full");
						this.spawnFloatText(e.mesh.position.clone().add(new THREE.Vector3(0, 1.15, 0)), "REFILL", false);
					}
				}
				e.jiggle = Math.max(0, (e.jiggle || 0) - dt * 3.4);
				const j = e.jiggle || 0;
				if (j > 0) {
					e.mesh.rotation.z = Math.sin(this.time * 38) * 0.12 * j;
					e.mesh.rotation.x = Math.cos(this.time * 31) * 0.07 * j;
				} else {
					e.mesh.rotation.z *= Math.exp(-8 * dt);
					e.mesh.rotation.x *= Math.exp(-8 * dt);
				}
				const candy = e.mesh.getObjectByName("candy");
				if (candy && candy.visible) {
					candy.rotation.y += dt * (0.6 + j * 8);
				}
			} else if (e.kind === "tree") {
				if (e.hitCd > 0) e.hitCd = Math.max(0, e.hitCd - dt);
				if (e.fallen && e.fallAngle < Math.PI * 0.5) {
					e.fallVel += 9.2 * dt;
					e.fallAngle = Math.min(Math.PI * 0.5, (e.fallAngle || 0) + e.fallVel * dt);
					const fall = e.fall || e.mesh;
					fall.setRotationFromAxisAngle(e.fallAxis || new THREE.Vector3(1, 0, 0), e.fallAngle);
					if (e.fallAngle >= Math.PI * 0.5 - 0.01 && !e.thud) {
						e.thud = true;
						e.fallVel = 0;
						if (this.audio.treeFall) this.audio.treeFall();
						else this.audio.impact("thud", 1);
						this.trauma = Math.min(1, this.trauma + 0.12);
					}
				}
			}
		}
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
		if (this.walkLeverGrabSide === hand) return;
		if (this.phase === "paused") return;
		if (this.phase === "tutorial") {
			if (this.tutorialLockMode === "heart" || this.tutorialLockMode === "wave" || this.tutorialStep === "wave" || this.tutorialStep === "enter" || this.tutorialStep === "countdown") return;
			if (opts.forceMode === "grenade") return;
			if (this.tutorialLockMode === "punch" || this.tutorialLockMode === "slap" || this.tutorialLockMode === "poke") {
				if (!this.isTutorialShape(hand, this.tutorialLockMode)) return;
			}
		}
		const practicing = this.phase === "waveClear" || this.phase === "victory" || this.phase === "tutorial";
		const returning = hand === "L" ? this.leftReturnAt : this.rightReturnAt;
		if (returning > 0 && this.time < returning) return;
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
		// Projectile mesh follows the live pose (glove / fish / scissors)
		let mode = opts.forceMode || this.shotModeForHand(hand) || this.getHandMode(hand);
		if (this.phase === "tutorial" && (this.tutorialLockMode === "punch" || this.tutorialLockMode === "slap" || this.tutorialLockMode === "poke")) {
			mode = this.tutorialLockMode;
		}
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
		if (mode === "punch" || mode === "slap" || mode === "poke") this.noteTutorialAction(mode);
		// Between waves: punches still fly for practice; after hold, punch also advances
		if (practicing && this.phase !== "tutorial" && this.time >= (this.waveClearReadyAt || 0)) {
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
		// Small spawn offset only — slight L/R fan so the start toys are hittable
		origin.add(flat.clone().multiplyScalar(0.85));
		origin.add(right.multiplyScalar(hand === "L" ? -0.16 : 0.16));
		origin.y -= 0.08;
		const fan = hand === "L" ? -0.36 : 0.36;
		const aim = flat.clone().addScaledVector(right, fan).normalize();
		return { origin, forward: aim, ctrlFwd: aim.clone(), camFwd: flat.clone(), used: "desktop" };
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
	createRibbonTrail(hexColor, opts = {}) {
		const segs = opts.segs || 22;
		const positions = new Float32Array(segs * 2 * 3);
		const colors = new Float32Array(segs * 2 * 3);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		const idx = [];
		for (let i = 0; i < segs - 1; i++) {
			const a = i * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		geo.setIndex(idx);
		const mat = new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.92,
			side: THREE.DoubleSide,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			toneMapped: false,
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.frustumCulled = false;
		mesh.renderOrder = 8;
		return {
			mesh,
			positions,
			colors,
			segs,
			hist: [],
			color: new THREE.Color(hexColor),
			width: opts.width || 0.05,
		};
	}
	updateRibbonTrail(rb, worldPos) {
		if (!rb) return;
		rb.hist.push(worldPos.clone());
		if (rb.hist.length > rb.segs) rb.hist.shift();
		const cam = new THREE.Vector3();
		this.camera.getWorldPosition(cam);
		const col = rb.color;
		const n = rb.segs;
		for (let i = 0; i < n; i++) {
			const hi = Math.max(0, rb.hist.length - n + i);
			const p = rb.hist[hi] || worldPos;
			const prev = rb.hist[Math.max(0, hi - 1)] || p;
			const next = rb.hist[Math.min(rb.hist.length - 1, hi + 1)] || p;
			const tan = next.clone().sub(prev);
			if (tan.lengthSq() < 1e-8) tan.set(0, 0, 1);
			tan.normalize();
			const toCam = cam.clone().sub(p);
			let side = new THREE.Vector3().crossVectors(tan, toCam);
			if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
			const fade = i / Math.max(1, n - 1);
			side.normalize().multiplyScalar(rb.width * (0.25 + 0.75 * fade));
			const a = i * 6;
			rb.positions[a] = p.x + side.x;
			rb.positions[a + 1] = p.y + side.y;
			rb.positions[a + 2] = p.z + side.z;
			rb.positions[a + 3] = p.x - side.x;
			rb.positions[a + 4] = p.y - side.y;
			rb.positions[a + 5] = p.z - side.z;
			const cr = col.r * fade;
			const cg = col.g * fade;
			const cb = col.b * fade;
			rb.colors[a] = cr; rb.colors[a + 1] = cg; rb.colors[a + 2] = cb;
			rb.colors[a + 3] = cr; rb.colors[a + 4] = cg; rb.colors[a + 5] = cb;
		}
		rb.mesh.geometry.attributes.position.needsUpdate = true;
		rb.mesh.geometry.attributes.color.needsUpdate = true;
		rb.mesh.geometry.computeBoundingSphere();
	}
	disposeRibbonTrail(rb) {
		if (!rb?.mesh) return;
		this.scene.remove(rb.mesh);
		rb.mesh.geometry.dispose();
		rb.mesh.material.dispose();
	}
	disposeProjectileFx(e) {
		if (!e) return;
		if (e.trail) {
			if (e.trail.points) this.disposeLaceTrail(e.trail);
			else this.scene.remove(e.trail);
			e.trail = null;
		}
		if (e.ribbon) {
			this.disposeRibbonTrail(e.ribbon);
			e.ribbon = null;
		}
	}
	killProjectile(e, pos, color) {
		if (!e || !e.alive) return;
		e.alive = false;
		e.vel?.set(0, 0, 0);
		if (pos) this.spawnImpactBoom(pos, color);
		this.destroyEntityBody(e);
		if (e.mesh) {
			e.mesh.visible = false;
			this.scene.remove(e.mesh);
		}
		this.disposeProjectileFx(e);
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
		const mode = opts.forceMode || this.shotModeForHand(hand) || this.getHandMode(hand);
		const isSlap = mode === "slap";
		const isPoke = mode === "poke";
		// wrist = small/straight · sweep = big side-to-side · default sweep for trigger slaps
		const slapStyle = isSlap ? (opts.slapStyle || (this.xrActive ? "sweep" : "sweep")) : null;
		const isWristSlap = slapStyle === "wrist";
		const isSweepSlap = isSlap && !isWristSlap;
		const mesh = makeModeHand(this.palette, mode, hand, powered);
		const baseScale = this.xrActive
			? (isWristSlap ? 0.95 : isSlap ? 1.12 : isPoke ? 1.02 : 1.05)
			: (isSlap ? 1.12 : isPoke ? 1.05 : 1.08);
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
		const trailCol = this.trailColorForMode(mode, powered);
		let trail = null;
		let ribbon = null;
		if (this.fxHitParticles) {
			trail = this.createLaceTrail(trailCol, {
				size: isSlap ? 0.09 : isPoke ? 0.065 : 0.075,
				life: isSlap ? 1.15 : 0.95,
				emitBoost: isSlap ? 1.3 : 1,
				count: isSlap ? 420 : 360,
			});
			this.scene.add(trail.points);
		} else if (this.fxFlightTrail) {
			ribbon = this.createRibbonTrail(trailCol, { width: isSlap ? 0.07 : 0.048, segs: 24 });
			this.scene.add(ribbon.mesh);
		}
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
			vel: forward.clone().multiplyScalar(speed), age: 0, life: isSlap ? (isWristSlap ? 6.4 : 8.8) : isPoke ? 7.2 : 7.4, damage,
			enemyType: "brawler", attackCd: 0, flash: 0, value: 0, hand, powered, trail, ribbon, squash: 1,
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
		if (ribbon) this.updateRibbonTrail(ribbon, origin);
		// Hide hand prop for a few seconds so the flying copy is obvious (desktop + XR)
		const returnIn = 1.0;
		if (!this.xrActive) {
			if (hand === "L") { this.leftGlove.visible = false; this.setViewHandOpacity("L", 0); this.leftReturnAt = this.time + returnIn; }
			else { this.rightGlove.visible = false; this.setViewHandOpacity("R", 0); this.rightReturnAt = this.time + returnIn; }
		} else {
			const glove = hand === "L" ? this.xrGloveL : this.xrGloveR;
			if (glove) glove.visible = false;
			if (hand === "L") this.leftReturnAt = this.time + returnIn;
			else this.rightReturnAt = this.time + returnIn;
		}
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
		const scale = this.xrActive ? 1.05 : 1.05;
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
		let lace = null;
		let ribbon = null;
		if (this.fxHitParticles) {
			lace = this.createLaceTrail(trailCol, { size: 0.06, life: 0.55, emitBoost: 1.1, count: 300 });
			this.scene.add(lace.points);
			this.updateLaceTrail(lace, origin, 0.016);
		} else if (this.fxFlightTrail) {
			ribbon = this.createRibbonTrail(trailCol, { width: 0.06, segs: 20 });
			this.scene.add(ribbon.mesh);
			this.updateRibbonTrail(ribbon, origin);
		}

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
			ribbon,
			squash: 1,
			hitIds: new Set(),
			gravity: 9.5,
			bounced: false,
			tickAcc: 0,
			body,
		});

		const returnIn = 1.0;
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
			if (other.kind !== "enemy" && other.kind !== "hazard" && !this.isStartToy(other)) continue;
			const body = this.copyToyHitPos(other, this._toyHit).clone();
			if (other.kind === "hazard") body.y += 0.15;
			const d = body.distanceTo(pos);
			if (d <= R) {
				const falloff = 1 - (d / R) * 0.45;
				const knock = body.clone().sub(pos);
				knock.y = 0.35;
				if (knock.lengthSq() < 1e-6) knock.set(0, 0.35, -1);
				knock.normalize();
				if (other.kind === "hazard") this.destroyHazard(other, true);
				else if (this.isStartToy(other)) this.applyPropHit(other, knock, 10 + falloff * 8);
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
		this.disposeProjectileFx(e);
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
			if (!e.alive || (e.kind !== "enemy" && e.kind !== "hazard" && !this.isStartToy(e))) continue;
			const body = this.copyToyHitPos(e, this._toyHit);
			const to = body.clone().sub(origin);
			if (e.kind === "hazard") to.y += 0.15;
			const reach = range + (e.radius || 0.5) + (e.kind === "tree" ? 0.8 : e.kind === "gumballMachine" ? 0.5 : 0);
			if (to.length() > reach) continue;
			to.normalize();
			const needDot = this.isStartToy(e) ? 0.15 : (1 - cone);
			if (to.dot(forward) < needDot) continue;
			if (e.kind === "hazard") {
				this.destroyHazard(e, true);
				hitAny = true;
				continue;
			}
			if (this.isStartToy(e)) {
				this.applyPropHit(e, to, mode === "slap" ? 11 : 7);
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
		if (this.fxHitParticles) this.burst(origin.clone().add(forward.multiplyScalar(1)), mode === "slap" ? 4045026 : 14856253, mode === "slap" ? 22 : 12);
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
			const col = this.hpFillColor(hpRatio);
			const fill = e.bar.getObjectByName("hpFill");
			if (fill) {
				fill.scale.x = Math.max(0.001, hpRatio);
				fill.material.color.setHex(col);
			}
			const glow = e.bar.getObjectByName("hpGlow");
			if (glow) {
				glow.scale.x = Math.max(0.001, hpRatio);
				glow.material.color.setHex(col);
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
	/** Mini colored boom at a projectile impact. Always plays — separate from in-flight FX. */
	spawnImpactBoom(pos, color) {
		const at = pos.clone();
		this.burst(at, color, 26);
		this.burst(at, 0xffffff, 10);
		this.spawnRing(at, color);
		const flash = new THREE.Mesh(
			new THREE.SphereGeometry(0.22, 12, 10),
			new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.9,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		flash.position.copy(at);
		this.scene.add(flash);
		this.entities.push({
			id: this.idSeq++,
			kind: "blastSphere",
			mesh: flash,
			alive: true,
			hp: 1,
			maxHp: 1,
			radius: 0.2,
			vel: new THREE.Vector3(),
			age: 0,
			life: 0.22,
			damage: 0,
			enemyType: "brawler",
			attackCd: 0,
			flash: 0,
			value: 0,
			hand: null,
			powered: false,
			squash: 1,
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
			if (this.xrActive) this.paintXrFpsHud();
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
						rig.position.x = THREE.MathUtils.clamp(rig.position.x, -2.4, 2.4);
						const pz = rig.position.z;
						rig.position.z = THREE.MathUtils.clamp(pz, this.pathMinZ + 2, this.pathMaxZ);
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
			if (fr.hands?.length >= 2 && this.handGestureL === "heart" && this.handGestureR === "heart" && this.detectTwoHandHeartCam(fr.hands)) {
				this.heartDetectHold = (this.heartDetectHold || 0) + 0.032;
				if (this.heartDetectHold > 0.12) {
					this.spawnHeartShield();
					this.heartDetectHold = -0.9;
				}
			} else if (!this.xrActive && (this.heartDetectHold || 0) > 0) {
				this.heartDetectHold = Math.max(0, this.heartDetectHold - 0.06);
			}
			for (const h of fr.hands || []) {
				this.cameraGesture = `${h.side}:${h.gesture || h.mode || "?"}${h.click ? "·CLICK" : ""}`;
				if (h.side === "L") this.xrLiveL = { mode: h.mode || null, gesture: h.gesture || null, curl: h.curl };
				else this.xrLiveR = { mode: h.mode || null, gesture: h.gesture || null, curl: h.curl };
				if (!this.xrActive && this.phase === "tutorial" && this.tutorialStep === "wave") {
					const prevK = h.side === "L" ? "_camWavePrevL" : "_camWavePrevR";
					const pos = { x: h.mx || 0, y: h.my || 0, z: h.z || 0 };
					const prev = this[prevK];
					if (prev) {
						const vel = {
							x: (pos.x - prev.x) / 0.016,
							y: (pos.y - prev.y) / 0.016,
							z: 0,
						};
						this.noteWaveMotion(h.side, pos, vel);
					}
					this[prevK] = pos;
				}
				if (h.click) this.armClickBoost(h.side);
				// Social / emoji gesture props (hide combat models while held)
				const social = ["thumbs", "thumbsDown", "spock", "rockOn", "heart", "birdie"];
				if (h.gesture === "heart") {
					if (this.phase === "tutorial" && this.tutorialLockMode !== "heart") continue;
					const fk = h.side === "L" ? "camHeartFramesL" : "camHeartFramesR";
					this[fk] = Math.min(24, (this[fk] || 0) + 4);
					this.setHandGesture(h.side, "heart");
				} else if (h.gesture === "peace") {
					const fk = h.side === "L" ? "camHeartFramesL" : "camHeartFramesR";
					this[fk] = 0;
					this.setHandGesture(h.side, "peace");
				} else if (h.gesture && social.includes(h.gesture)) {
					const fk = h.side === "L" ? "camHeartFramesL" : "camHeartFramesR";
					this[fk] = 0;
					this.setHandGesture(h.side, h.gesture);
				} else if (h.mode === "punch" || h.gesture === "punch") {
					const fk = h.side === "L" ? "camHeartFramesL" : "camHeartFramesR";
					this[fk] = 0;
					const curG = h.side === "L" ? this.handGestureL : this.handGestureR;
					if (curG) this.setHandGesture(h.side, null);
				} else if (h.mode === "slap" || h.mode === "poke") {
					const fk = h.side === "L" ? "camHeartFramesL" : "camHeartFramesR";
					const curG = h.side === "L" ? this.handGestureL : this.handGestureR;
					this[fk] = 0;
					if (curG && curG !== "peace") this.setHandGesture(h.side, null);
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
					const shot = this.shotModeForHand(h.side)
						|| (h.mode === "punch" || h.mode === "slap" || h.mode === "poke" ? h.mode : "punch");
					const opts = { strikePower, fromMotion: true, forceMode: shot };
					if (shot === "slap") {
						opts.slapStyle = Math.abs(h.swipe || 0) > 0.55 ? "sweep" : "wrist";
						opts.slapDir = h.slapDir || 0;
					}
					this.tryAttack(h.side, opts);
				}
			}
		}
		this.updatePartyNet(dt);
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
		if (this.xrActive) {
			this.paintXrHud(false);
			if (this.xrFpsHud && !this.xrFpsHud.visible) this.paintXrFpsHud(true);
		}
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
		if (this.phase !== "playing" && this.phase !== "tutorial") {
			if (this.xrActive && this.phase === "readying") this.tickXrCountdown(dt);
			if (!this.xrActive && this.phase !== "paused") {
				this.yaw -= this.lookX + this.gamepadLookX;
				this.pitch -= this.lookY + this.gamepadLookY;
				this.lookX = 0;
				this.lookY = 0;
				this.gamepadLookX = 0;
				this.gamepadLookY = 0;
				this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
				this.camera.rotation.order = "YXZ";
				this.camera.rotation.y = this.yaw;
				this.camera.rotation.x = this.pitch;
			}
			this.updateHandsVisual(dt);
			this.updateWalkway(dt);
			this.updateParticles(dt);
			this.updateRings(dt);
			this.updateStartToys(dt);
			// Practice punches fly with UI up (menu / wave clear / readying / etc.)
			if (this.phase !== "paused") {
				this.updatePracticeShots(dt);
			}
			this.trauma = Math.max(0, this.trauma - dt * 1.5);
			this.camKick = Math.max(0, this.camKick - dt * 2);
			return;
		}
		if (this.phase === "tutorial") this.tickTutorial(dt);
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
			this.railZ = Math.max(this.railZ, -this.camera.position.z);
			this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -2.4, 2.4);
			this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, this.pathMinZ + 2, this.pathMaxZ);
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
		if (this.phase === "playing") {
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
		}
		this.updateEntities(dt);
		this.updateStartToys(dt);
		this.updateParticles(dt);
		this.updateRings(dt);
		this.updateFloatTexts(dt);
		this.updateHandsVisual(dt);
		this.updateWalkway(dt);
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
				if (e.ribbon) this.updateRibbonTrail(e.ribbon, e.mesh.position);
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
				continue;
			}
			if (e.kind !== "gloveShot") continue;
			e.age += dt;
			this.stepGloveShot(e, dt);
		}
	}
	stepGloveShot(e, dt) {
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
		if (e.body && sharedPhysics.ready) {
			const p = e.mesh.position;
			if (sharedPhysics.setTransform) sharedPhysics.setTransform(e.body, p.x, p.y, p.z);
			sharedPhysics.setLinearVelocity(e.body, e.vel.x, e.vel.y, e.vel.z);
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
		if (e.ribbon) this.updateRibbonTrail(e.ribbon, e.mesh.position);
		const hitColor = this.trailColorForMode(e.shotMode || (e.slapWave ? "slap" : "punch"), e.powered);
		const groundY = Math.max(0.12, (e.radius || 0.25) * 0.45);
		if (e.mesh.position.y <= groundY) {
			const p = e.mesh.position.clone();
			p.y = groundY;
			if (this.audio.projectileHit) this.audio.projectileHit(e.shotMode || "punch", 0.55);
			this.killProjectile(e, p, hitColor);
			return;
		}
		for (const other of this.entities) {
			if (!other.alive || (other.kind !== "enemy" && other.kind !== "hazard" && !this.isStartToy(other))) continue;
			if (e.hitIds && e.hitIds.has(other.id)) continue;
			const hit =
				this.isStartToy(other)
					? this.projectileHitsToy(other, e.mesh.position, prev, e.radius || 0.28)
					: (() => {
						const body = this.copyToyHitPos(other, this._toyHit);
						if (other.kind === "hazard") body.y += 0.15;
						const hitR = other.radius + e.radius;
						return body.distanceTo(e.mesh.position) < hitR || body.distanceTo(prev) < hitR;
					})();
			if (hit) {
				if (e.hitIds) e.hitIds.add(other.id);
				const knock = e.vel.lengthSq() > 1e-6 ? e.vel.clone().normalize() : new THREE.Vector3(0, 0, -1);
				if (other.kind === "hazard" && typeof this.destroyHazard === "function") this.destroyHazard(other, true);
				else if (this.isStartToy(other)) this.applyPropHit(other, knock, e.slapWave ? 12 : Math.min(14, 4 + (e.speed || 8) * 0.35));
				else if (other.kind === "enemy") {
					this._suppressHitSfx = true;
					this.damageEnemy(other, e.damage, knock);
					this._suppressHitSfx = false;
				}
				if (!this.isStartToy(other)) {
					const mode = e.shotMode || (e.slapWave ? "slap" : "punch");
					const pow = THREE.MathUtils.clamp((e.speed || 10) / 24, 0.45, 1.2);
					if (this.audio.projectileHit) this.audio.projectileHit(mode, pow);
					else this.audio.hit();
				}
				this.killProjectile(e, e.mesh.position.clone(), hitColor);
				return;
			}
		}
		e.life -= dt;
		if (e.life <= 0) {
			this.killProjectile(e, e.mesh.position.clone(), hitColor);
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
				if (e.bar) this.billboardYUp(e.bar);
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
				this.stepGloveShot(e, dt);
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
				if (e.ribbon) this.updateRibbonTrail(e.ribbon, e.mesh.position);
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
			if (p.leaf) {
				p.vel.y -= 4.6 * dt;
				p.vel.x += Math.sin(this.time * 6 + i) * 1.6 * dt;
				p.vel.z += Math.cos(this.time * 5 + i) * 1.2 * dt;
				p.vel.multiplyScalar(Math.exp(-0.35 * dt));
				p.mesh.position.addScaledVector(p.vel, dt);
				p.mesh.rotation.x += dt * (2.2 + (p.spin || 0));
				p.mesh.rotation.z += dt * (3.4 + (p.spin || 0) * 0.4);
				p.mesh.rotation.y += dt * 1.6;
				if (p.mesh.position.y < 0.04) {
					p.mesh.position.y = 0.04;
					p.vel.y *= -0.15;
					p.vel.x *= 0.7;
					p.vel.z *= 0.7;
				}
				const t = Math.max(0, p.life / p.maxLife);
				p.mesh.scale.setScalar(0.7 + t * 0.5);
				if (p.mesh.material && p.mesh.material.opacity != null) p.mesh.material.opacity = 0.35 + t * 0.65;
			} else {
				p.vel.y -= 11 * dt;
				p.mesh.position.addScaledVector(p.vel, dt);
				p.mesh.rotation.x += dt * 10;
				p.mesh.rotation.y += dt * 8;
				const t = p.life / p.maxLife;
				p.mesh.scale.setScalar(.4 + t * 1.1);
				p.mesh.material.opacity = Math.max(0, t);
			}
			if (p.life <= 0) {
				this.scene.remove(p.mesh);
				if (!p.leaf && this.particlePool.length < 80) this.particlePool.push(p.mesh);
				else {
					if (p.mesh.geometry && p.leaf) p.mesh.geometry.dispose();
					if (p.mesh.material && p.leaf) p.mesh.material.dispose();
				}
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
		if (this.xrActive) {
			this.updateHandPropMotion(dt);
			return;
		}
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
		if (this.handGestureL === "heart" && this.handGestureR === "heart") {
			if (this.heartPoseActive) {
				lTarget.set(-0.16, -0.02, -0.5);
				rTarget.set(0.16, -0.02, -0.5);
			}
			this.leftGlove.rotation.set(-0.04, 0.16, 0.06);
			this.rightGlove.rotation.set(-0.04, -0.16, -0.06);
		} else {
			if (this.handMeshKey("L") === "heart") this.leftGlove.rotation.set(-0.04, 0.16, 0.06);
			if (this.handMeshKey("R") === "heart") this.rightGlove.rotation.set(-0.04, -0.16, -0.06);
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
		// Clear social gesture props when the desktop pose timer ends (XR holds its own)
		if (!this.xrActive && this.gestureT <= 0 && (this.handGestureL || this.handGestureR) && !this.heartPoseActive) {
			const social = ["thumbs", "thumbsDown", "peace", "spock", "rockOn", "birdie"];
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
		this.updateHandPropMotion(dt);
	}

	updateHandPropMotion(dt) {
		for (const side of ["L", "R"]) {
			const key = this.handMeshKey(side);
			const bag = this.xrActive
				? (side === "L" ? this.xrGloveMeshesL : this.xrGloveMeshesR)
				: (side === "L" ? this.leftMeshes : this.rightMeshes);
			const mesh = bag?.[key] || bag?.slap;
			const joints = mesh?.userData?.wiggleJoints;
			const shears = mesh?.userData?.shearHalves;
			const wings = mesh?.userData?.wingJoints;
			if (wings && wings.length >= 2) {
				const flap = Math.sin(this.time * 16) * 0.72;
				const twist = Math.sin(this.time * 11) * 0.14;
				wings[0].rotation.z = flap;
				wings[1].rotation.z = -flap;
				wings[0].rotation.y = twist;
				wings[1].rotation.y = -twist;
			}
			if (shears && shears.length >= 2) {
				const open = 0.16 + Math.sin(this.time * 14) * 0.045;
				shears[0].rotation.z = open;
				shears[1].rotation.z = -open;
			}
			if (!joints || !joints.length) continue;
			const pos = this.worldHandPos(side);
			const prevKey = side === "L" ? "_fishPrevL" : "_fishPrevR";
			const prev = this[prevKey] || pos.clone();
			const vx = THREE.MathUtils.clamp((pos.x - prev.x) / Math.max(dt, 0.008), -4, 4);
			const vy = THREE.MathUtils.clamp((pos.y - prev.y) / Math.max(dt, 0.008), -4, 4);
			this[prevKey] = pos.clone();
			if (key !== "slap") {
				for (const j of joints) {
					j.rotation.y *= Math.exp(-10 * dt);
					j.rotation.z *= Math.exp(-10 * dt);
				}
				continue;
			}
			for (let i = 0; i < joints.length; i++) {
				const lag = i * 0.42;
				const paper = Math.sin(this.time * 16 - lag) * 0.07;
				const sway = Math.sin(this.time * 11 - lag * 1.2) * 0.045;
				const fromMove = THREE.MathUtils.clamp(vx * 0.22 * (i + 1), -0.55, 0.55);
				const lift = THREE.MathUtils.clamp(vy * 0.08 * (i + 1), -0.2, 0.2);
				joints[i].rotation.y = paper + fromMove;
				joints[i].rotation.z = sway + lift;
			}
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
