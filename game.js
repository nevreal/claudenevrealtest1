import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// ============================================================================
// VECTOR SWARM — Quest 3 WebXR Engine (High Performance Build)
// Core gameplay script optimized for stationary lean dodging & front-facing FOV spawning.
// Fully integrated with custom retro synth SoundFX & heightened difficulty tuning.
// ============================================================================

let scene, camera, renderer, clock;
let player;
let rightController, leftController;
let controllerGrip1, controllerGrip2;
let hudCanvas, hudTexture, hudSprite, hudCtx;
let triggerHeld = false;

// Config Constants
const ARENA_RADIUS = 14;
const SHIP_HIT_RADIUS = 0.08; // Small collision radius matching the cyan ship avatar

const state = {
  started: false,
  gameOver: false,
  score: 0,
  health: 100,
  wave: 1,
  spawnedThisWave: 0,
  waveQuota: 8, // Upped from 6
  waveCooldown: 0,
  enemies: [],
  enemyBullets: [],
  playerBullets: [],
  shotCooldown: 0,
  invulnTimer: 0,
  flashTimer: 0,
};

// ============================================================================
// PROCEDURAL RETRO AUDIO SYNTHENGINE (Option A)
// Generates neon arcade sound effects using the Web Audio API (no external asset loads!)
// ============================================================================
class SoundFX {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    
    // Generate high-quality white noise buffer for dynamic physical explosions
    const bufferSize = this.ctx.sampleRate * 0.4;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playLaser() {
    this.resume();
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, this.ctx.currentTime + 0.12);
    
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.12);
  }

  playEnemyHit() {
    this.resume();
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.05);
    
    gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playExplosion(tier = 1) {
    this.resume();
    if (!this.ctx || !this.noiseBuffer) return;
    
    const duration = tier === 4 ? 0.6 : (tier === 3 ? 0.45 : 0.35);
    const volume = tier === 4 ? 0.35 : (tier === 3 ? 0.28 : 0.22);
    
    // Noise source for explosion crackle
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + duration);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    
    // Sub oscillator for bass punch
    const subOsc = this.ctx.createOscillator();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(140, this.ctx.currentTime);
    subOsc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + duration * 0.8);
    
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(volume * 0.6, this.ctx.currentTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration * 0.8);
    
    subOsc.connect(subGain);
    subGain.connect(this.ctx.destination);
    
    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    noiseSource.start();
    subOsc.start();
    
    noiseSource.stop(this.ctx.currentTime + duration);
    subOsc.stop(this.ctx.currentTime + duration);
  }

  playPlayerDamage() {
    this.resume();
    if (!this.ctx || !this.noiseBuffer) return;
    
    const osc = this.ctx.createOscillator();
    const subOsc = this.ctx.createOscillator();
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.42);
    
    subOsc.type = 'square';
    subOsc.frequency.setValueAtTime(90, this.ctx.currentTime);
    subOsc.frequency.linearRampToValueAtTime(30, this.ctx.currentTime + 0.42);
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(300, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + 0.42);
    
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.24, this.ctx.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.42);
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.38, this.ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.42);
    
    osc.connect(oscGain);
    subOsc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    
    osc.start();
    subOsc.start();
    noiseSource.start();
    
    osc.stop(this.ctx.currentTime + 0.45);
    subOsc.stop(this.ctx.currentTime + 0.45);
    noiseSource.stop(this.ctx.currentTime + 0.45);
  }

  playWaveStart() {
    this.resume();
    if (!this.ctx) return;
    
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(261.63, now); // C4
    osc1.frequency.exponentialRampToValueAtTime(523.25, now + 0.4); // C5
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(329.63, now + 0.08); // E4
    osc2.frequency.exponentialRampToValueAtTime(659.25, now + 0.48); // E5
    
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc1.start(now);
    osc2.start(now + 0.08);
    
    osc1.stop(now + 0.6);
    osc2.stop(now + 0.6);
  }

  playGameOver() {
    this.resume();
    if (!this.ctx) return;
    
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(150, now);
    osc1.frequency.linearRampToValueAtTime(60, now + 0.8);
    
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(145, now);
    osc2.frequency.linearRampToValueAtTime(55, now + 0.8);
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(40, now + 0.8);
    
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.82);
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc1.start();
    osc2.start();
    
    osc1.stop(now + 0.85);
    osc2.stop(now + 0.85);
  }
}

const sounds = new SoundFX();

init();

function init() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02030a, 0.015);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

  player = new THREE.Group();
  player.add(camera);
  scene.add(player);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.setClearColor(0x02030a, 1);
  document.body.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  buildArena();
  buildLighting();
  setupControllers();
  buildHud();
  setupVRFlow();

  window.addEventListener('resize', onWindowResize);
  renderer.setAnimationLoop(animate);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ----------------------------------------------------------------------------
// Environment & Aesthetics
// ----------------------------------------------------------------------------
function buildArena() {
  // Cyan wireframe floor
  const grid = new THREE.GridHelper(ARENA_RADIUS * 2, 28, 0x5ef3ff, 0x163240);
  scene.add(grid);

  const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS, 48);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x02030a, transparent: true, opacity: 0.7 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);

  // Cylindrical Wireframe Arena Wall
  const wallGeo = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 8, 32, 4, true);
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x113a4a, wireframe: true, transparent: true, opacity: 0.35 });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = 3;
  scene.add(wall);

  // Magenta Vertical Struts
  const strutMat = new THREE.MeshBasicMaterial({ color: 0xff2d92, transparent: true, opacity: 0.5 });
  const strutCount = 16;
  for (let i = 0; i < strutCount; i++) {
    const angle = (i / strutCount) * Math.PI * 2;
    const strutGeo = new THREE.BoxGeometry(0.06, 8, 0.06);
    const strut = new THREE.Mesh(strutGeo, strutMat);
    strut.position.set(Math.cos(angle) * ARENA_RADIUS, 3, Math.sin(angle) * ARENA_RADIUS);
    scene.add(strut);
  }

  // Nebula / Starfield Background
  const starGeo = new THREE.BufferGeometry();
  const starCount = 1000;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 40 + Math.random() * 30;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.5 + 2;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.7 });
  scene.add(new THREE.Points(starGeo, starMat));

  // Slow-rotating decorative core
  const coreGeo = new THREE.OctahedronGeometry(0.4, 0);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x5ef3ff, wireframe: true });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(0, 1.4, -ARENA_RADIUS * 0.9);
  core.name = 'decorCore';
  scene.add(core);
}

function buildLighting() {
  scene.add(new THREE.AmbientLight(0x335566, 1.2));
  const point = new THREE.PointLight(0x5ef3ff, 1.5, 20);
  point.position.set(0, 4, 0);
  scene.add(point);
}

// ----------------------------------------------------------------------------
// Quest 3 Spatial Controllers
// ----------------------------------------------------------------------------
function setupControllers() {
  const controllerModelFactory = new XRControllerModelFactory();

  // RIGHT controller is index 0: player avatar & aim line
  rightController = renderer.xr.getController(0);
  rightController.addEventListener('selectstart', () => { 
    triggerHeld = true; 
    sounds.resume(); 
  });
  rightController.addEventListener('selectend', () => { triggerHeld = false; });
  player.add(rightController);

  controllerGrip1 = renderer.xr.getControllerGrip(0);
  controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
  player.add(controllerGrip1);

  // LEFT controller is index 1: standard pointer model (no weapon/avatar logic)
  leftController = renderer.xr.getController(1);
  player.add(leftController);

  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
  player.add(controllerGrip2);

  // Attach player ship avatar to Right Hand (Cyan Wireframe Cone)
  const shipGroup = buildDroneShip();
  rightController.add(shipGroup);

  // Aiming pointer line
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5ef3ff, transparent: true, opacity: 0.5 });
  const aimLine = new THREE.Line(lineGeo, lineMat);
  aimLine.scale.z = 12;
  rightController.add(aimLine);
}

function buildDroneShip() {
  const group = new THREE.Group();
  const bodyGeo = new THREE.ConeGeometry(0.04, 0.15, 6);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x5ef3ff, wireframe: true });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = -Math.PI / 2;
  group.add(body);
  return group;
}

// ----------------------------------------------------------------------------
// HUD Interface (World-Locked Canvas Plate)
// ----------------------------------------------------------------------------
function buildHud() {
  hudCanvas = document.createElement('canvas');
  hudCanvas.width = 512;
  hudCanvas.height = 160;
  hudCtx = hudCanvas.getContext('2d');
  hudTexture = new THREE.CanvasTexture(hudCanvas);
  const mat = new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true });
  const geo = new THREE.PlaneGeometry(1.6, 0.5);
  hudSprite = new THREE.Mesh(geo, mat);
  hudSprite.position.set(0, 2.3, -3.2);
  player.add(hudSprite);
  drawHud();
}

function drawHud() {
  const ctx = hudCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  ctx.fillStyle = 'rgba(2,3,10,0.8)';
  ctx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
  ctx.strokeStyle = '#5ef3ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, hudCanvas.width - 4, hudCanvas.height - 4);

  // Score
  ctx.fillStyle = '#5ef3ff';
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE ' + state.score, 24, 60);

  // Wave info (Right)
  ctx.fillStyle = '#ff2d92';
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('WAVE ' + state.wave, hudCanvas.width - 24, 60);

  // Health Status bar
  const pct = Math.max(0, state.health) / 100;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(24, 90, hudCanvas.width - 48, 20);
  const hpColor = state.health > 50 ? '#5ef3ff' : (state.health > 20 ? '#ffea00' : '#ff4444');
  ctx.fillStyle = hpColor;
  ctx.fillRect(24, 90, (hudCanvas.width - 48) * pct, 20);

  if (state.gameOver) {
    ctx.fillStyle = '#ff2d92';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER — Try again! Pull Right Trigger', hudCanvas.width / 2, 142);
  } else if (!state.started) {
    ctx.fillStyle = '#9fb6c4';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('READY — Pull trigger to start', hudCanvas.width / 2, 142);
  }

  hudTexture.needsUpdate = true;
}

// ----------------------------------------------------------------------------
// VR Session Flow
// ----------------------------------------------------------------------------
function setupVRFlow() {
  const reqMsg = document.getElementById('reqMsg');
  const enterBtn = document.getElementById('enterBtn');
  const status = document.getElementById('status');

  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      if (supported) {
        reqMsg.innerHTML = 'Headset detected! Standard Meta VR flow ready.';
        enterBtn.disabled = false;
      } else {
        reqMsg.innerHTML = 'No VR headset detected. Run on your Meta Quest 3 Browser.';
      }
    }).catch(() => { reqMsg.textContent = 'WebXR browser permission error.'; });
  } else {
    reqMsg.textContent = 'WebXR Device API not found. Please load in Meta Quest Browser.';
  }

  enterBtn.addEventListener('click', async () => {
    try {
      sounds.resume();
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      await renderer.xr.setSession(session);
      document.getElementById('overlay').classList.add('hidden');
      startGame();
      
      session.addEventListener('end', () => {
        document.getElementById('overlay').classList.remove('hidden');
        state.started = false;
        clearEntities();
      });
    } catch (err) {
      status.textContent = 'VR entry failed: ' + err.message;
    }
  });
}

function startGame() {
  state.started = true;
  state.gameOver = false;
  state.score = 0;
  state.health = 100;
  state.wave = 1;
  state.spawnedThisWave = 0;
  state.waveQuota = 8; // Upped quota for higher intense firefights
  state.waveCooldown = 1.0;
  state.shotCooldown = 0;
  state.invulnTimer = 1.0;
  clearEntities();
  sounds.playWaveStart();
}

function clearEntities() {
  [...state.enemies].forEach(removeEnemy);
  [...state.enemyBullets].forEach(removeEnemyBullet);
  [...state.playerBullets].forEach(removePlayerBullet);
}

function restartGame() {
  startGame();
}

// ----------------------------------------------------------------------------
// Game Mechanics: Waves, Spawning & peripheral view seeking
// ----------------------------------------------------------------------------
function spawnEnemy() {
  const tierRoll = Math.random();
  let tier = 1;
  
  // Escalated tier distributions (Option B - Harder parameters)
  if (state.wave >= 2) {
    if (tierRoll > 0.85) tier = 4; // Purple ELITE spread-shot unit
    else if (tierRoll > 0.60) tier = 3; // Yellow HARD unit
    else if (tierRoll > 0.35) tier = 2; // Medium unit
  } else if (state.wave === 1 && tierRoll > 0.70) {
    tier = 2;
  }

  const colorByTier = [0, 0xff2d92, 0xffbe3b, 0xff3259, 0xb82eff];
  const sizeByTier = [0, 0.16, 0.24, 0.34, 0.44];
  const hpByTier = [0, 1, 2, 4, 8]; // Increased HP for Elites
  const valueByTier = [0, 10, 30, 60, 150];

  const geo = new THREE.IcosahedronGeometry(sizeByTier[tier], 0);
  const mat = new THREE.MeshBasicMaterial({ color: colorByTier[tier], wireframe: true });
  const mesh = new THREE.Mesh(geo, mat);

  // --- 70-DEGREE FRONT-FACING CONE SPAWNING CONFIG ---
  // Get camera orientation around Y-axis to see where player is looking
  const dir = new THREE.Vector3(0, 0, -1);
  dir.applyQuaternion(camera.quaternion);
  const cameraYaw = Math.atan2(dir.x, dir.z);

  // Generate a random angle within the 70-degree cone (-35deg to +35deg)
  const coneHalfAngle = (35 * Math.PI) / 180;
  const offsetAngle = (Math.random() - 0.5) * 2 * coneHalfAngle;
  const spawnAngle = cameraYaw + offsetAngle;

  const height = 0.6 + Math.random() * 1.5;
  const dist = ARENA_RADIUS * 0.78;

  mesh.position.set(Math.sin(spawnAngle) * dist, height, Math.cos(spawnAngle) * dist);
  scene.add(mesh);

  // Significantly increased enemy movement speeds (Option B)
  const enemy = {
    mesh,
    tier,
    hp: hpByTier[tier],
    value: valueByTier[tier],
    radius: sizeByTier[tier],
    speed: 0.65 + Math.random() * 0.5 + state.wave * 0.08, // Upped from 0.4
    fireTimer: 0.8 + Math.random() * 1.4, // Faster initial fire times
    strafeSpeed: (Math.random() - 0.5) * 0.7,
  };
  state.enemies.push(enemy);
  state.spawnedThisWave++;
}

function updateWaveSpawning(dt) {
  if (state.waveCooldown > 0) {
    state.waveCooldown -= dt;
    return;
  }
  if (state.spawnedThisWave < state.waveQuota) {
    // Tighter wave spawn rate gap for immediate swarm engagement (Option B)
    state.waveCooldown = Math.max(0.18, 0.75 - state.wave * 0.05);
    spawnEnemy();
  } else if (state.enemies.length === 0) {
    state.wave++;
    state.spawnedThisWave = 0;
    // Accelerated wave size escalations
    state.waveQuota = Math.min(30, 8 + state.wave * 3.5);
    state.waveCooldown = 1.8; // Lower transition cooldown
    sounds.playWaveStart();
  }
}

function updateEnemies(dt) {
  const cameraPos = new THREE.Vector3();
  camera.getWorldPosition(cameraPos);

  const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
  const maxAngle = (55 * Math.PI) / 180; // 55-degree peripheral view constraint

  for (const enemy of [...state.enemies]) {
    const toPlayer = new THREE.Vector3().subVectors(cameraPos, enemy.mesh.position);
    const dist = toPlayer.length();

    // Core movement: maintain distance around player closer and faster
    const desiredDist = 4.4; // Slightly closer
    if (dist > desiredDist) {
      toPlayer.normalize().multiplyScalar(enemy.speed * dt);
      enemy.mesh.position.add(toPlayer);
    } else if (dist < desiredDist - 1.2) {
      toPlayer.normalize().multiplyScalar(-enemy.speed * dt * 0.4);
      enemy.mesh.position.add(toPlayer);
    }

    // Orbital slow strafe behavior
    const tangent = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize();
    enemy.mesh.position.addScaledVector(tangent, enemy.strafeSpeed * dt);
    enemy.mesh.position.y = THREE.MathUtils.clamp(enemy.mesh.position.y, 0.6, 2.8);

    // --- 55-DEGREE FOV SEEKING SEEK-TO-VIEW MECHANISM ---
    const enemyFlatDir = new THREE.Vector3().subVectors(enemy.mesh.position, cameraPos).setY(0).normalize();
    const currentAngle = camDir.angleTo(enemyFlatDir);

    if (currentAngle > maxAngle) {
      const correctionDir = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
      const dot = enemyFlatDir.dot(correctionDir);
      const intensity = (currentAngle - maxAngle) * 1.5;
      const rotAngle = (dot > 0 ? -1 : 1) * intensity * dt;
      enemy.mesh.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotAngle);
    }

    // Facing angles
    enemy.mesh.lookAt(cameraPos);
    enemy.mesh.rotation.y += dt * 1.5;

    // Bullets fired with much shorter fire cooldowns (Option B)
    enemy.fireTimer -= dt;
    if (enemy.fireTimer <= 0 && dist < ARENA_RADIUS) {
      enemy.fireTimer = 0.9 + Math.random() * 1.1 - state.wave * 0.05;
      enemy.fireTimer = Math.max(0.35, enemy.fireTimer);
      fireEnemyBullet(enemy, cameraPos);
    }
  }
}

function removeEnemy(enemy) {
  scene.remove(enemy.mesh);
  enemy.mesh.geometry.dispose();
  enemy.mesh.material.dispose();
  const idx = state.enemies.indexOf(enemy);
  if (idx >= 0) state.enemies.splice(idx, 1);
}

// ----------------------------------------------------------------------------
// Weaponry: Firing & Hits
// ----------------------------------------------------------------------------
function fireEnemyBullet(enemy, targetPos) {
  if (enemy.tier === 4) {
    // ==== ELITE BARRAGE (Option B - Multiple Bullets) ====
    // Fire a spread fan of 3 purple bullets aimed tightly at player
    for (let i = -1; i <= 1; i++) {
      const geo = new THREE.SphereGeometry(0.08, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xb82eff }); // Elite Purple Bullet
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(enemy.mesh.position);
      scene.add(mesh);

      const dir = new THREE.Vector3().subVectors(targetPos, enemy.mesh.position).normalize();
      // Fan offset
      const tangent = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      dir.addScaledVector(tangent, i * 0.12).normalize();

      // Elite bullets have super high speed and incredibly tight spread
      const spread = 0.04;
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread * 0.4;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();

      state.enemyBullets.push({ 
        mesh, 
        dir, 
        speed: 5.6 + state.wave * 0.22, // High speed bullet 
        life: 6.0 
      });
    }
  } else {
    // Standard and Hard units fire single high-velocity, high-accuracy bullets
    const bulletGeo = new THREE.SphereGeometry(enemy.tier === 3 ? 0.075 : 0.065, 8, 8);
    const bulletColor = enemy.tier === 3 ? 0xff3259 : (enemy.tier === 2 ? 0xffbe3b : 0xff2d92);
    const bulletMat = new THREE.MeshBasicMaterial({ color: bulletColor });
    const mesh = new THREE.Mesh(bulletGeo, bulletMat);
    mesh.position.copy(enemy.mesh.position);
    scene.add(mesh);

    const dir = new THREE.Vector3().subVectors(targetPos, enemy.mesh.position).normalize();
    // Drastically narrowed spread vector for lethal tracking (Option B)
    const spread = Math.max(0.015, 0.12 - state.wave * 0.012);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread * 0.4;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    state.enemyBullets.push({ 
      mesh, 
      dir, 
      speed: 4.8 + state.wave * 0.18, // Upped from 2.8; faster, hyper-active threats
      life: 6.2 
    });
  }
}

function updateEnemyBullets(dt) {
  const avatarPos = new THREE.Vector3();
  rightController.getWorldPosition(avatarPos); // Collision is exclusively against Right Controller (ship avatar)

  for (const b of [...state.enemyBullets]) {
    b.mesh.position.addScaledVector(b.dir, b.speed * dt);
    b.life -= dt;

    if (b.life <= 0 || b.mesh.position.length() > ARENA_RADIUS * 1.5) {
      removeEnemyBullet(b);
      continue;
    }

    // Check hit against Right-Hand ship visual
    if (state.invulnTimer <= 0) {
      const dist = b.mesh.position.distanceTo(avatarPos);
      if (dist < SHIP_HIT_RADIUS) {
        takeDamage(12); // Slightly increased damage per hit
        removeEnemyBullet(b);
      }
    }
  }
}

function removeEnemyBullet(b) {
  scene.remove(b.mesh);
  b.mesh.geometry.dispose();
  b.mesh.material.dispose();
  const idx = state.enemyBullets.indexOf(b);
  if (idx >= 0) state.enemyBullets.splice(idx, 1);
}

function updateShooting(dt) {
  if (state.shotCooldown > 0) state.shotCooldown -= dt;

  if (state.gameOver) {
    if (triggerHeld && state.shotCooldown <= 0) {
      state.shotCooldown = 0.5;
      restartGame();
    }
    return;
  }

  if (triggerHeld && state.shotCooldown <= 0) {
    state.shotCooldown = 0.18;
    firePlayerBullet();
    sounds.playLaser(); // Laser firing sound
  }
}

function firePlayerBullet() {
  const geo = new THREE.SphereGeometry(0.04, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0x5ef3ff });
  const mesh = new THREE.Mesh(geo, mat);

  const origin = new THREE.Vector3();
  rightController.getWorldPosition(origin);
  const dir = new THREE.Vector3(0, 0, -1);
  dir.applyQuaternion(rightController.getWorldQuaternion(new THREE.Quaternion()));

  mesh.position.copy(origin);
  scene.add(mesh);

  state.playerBullets.push({ mesh, dir, speed: 15, life: 2.5 });
}

function updatePlayerBullets(dt) {
  for (const b of [...state.playerBullets]) {
    b.mesh.position.addScaledVector(b.dir, b.speed * dt);
    b.life -= dt;

    let hit = false;
    for (const enemy of state.enemies) {
      if (b.mesh.position.distanceTo(enemy.mesh.position) < 0.2 + enemy.radius) {
        enemy.hp -= 1;
        hit = true;
        
        if (enemy.hp <= 0) {
          state.score += enemy.value;
          sounds.playExplosion(enemy.tier); // Epic tier-based explosion SoundFX
          removeEnemy(enemy);
        } else {
          sounds.playEnemyHit(); // Light hit registration blip
        }
        break;
      }
    }

    if (hit || b.life <= 0 || b.mesh.position.length() > ARENA_RADIUS * 1.5) {
      removePlayerBullet(b);
    }
  }
}

function removePlayerBullet(b) {
  scene.remove(b.mesh);
  b.mesh.geometry.dispose();
  b.mesh.material.dispose();
  const idx = state.playerBullets.indexOf(b);
  if (idx >= 0) state.playerBullets.splice(idx, 1);
}

function takeDamage(amount) {
  state.health -= amount;
  state.invulnTimer = 0.5;
  state.flashTimer = 0.12;
  
  if (state.health <= 0) {
    state.health = 0;
    state.gameOver = true;
    sounds.playGameOver(); // Sad down-sweep arcade game over SoundFX
  } else {
    sounds.playPlayerDamage(); // Alarm / static drone crash SoundFX
  }
}

// ----------------------------------------------------------------------------
// Main Animation Loop
// ----------------------------------------------------------------------------
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state.started) {
    if (!state.gameOver) {
      updateShooting(dt);
      updateWaveSpawning(dt);
      updateEnemies(dt);
      updatePlayerBullets(dt);
      updateEnemyBullets(dt);
      if (state.invulnTimer > 0) state.invulnTimer -= dt;
      if (state.flashTimer > 0) {
        state.flashTimer -= dt;
        scene.fog.color.setHex(0x3d0606); // Dark red damage warning fog
      } else {
        scene.fog.color.setHex(0x02030a);
      }
    } else {
      updateShooting(dt); // allows restart triggers
    }
    drawHud();
  }

  const core = scene.getObjectByName('decorCore');
  if (core) core.rotation.y += dt * 0.35;

  renderer.render(scene, camera);
}
