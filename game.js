import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// ============================================================
// VECTOR SWARM — original WebXR bullet-hell arcade game
// Genre: stationary omnidirectional swarm shooter. Player
// physically leans/ducks/turns to dodge, aims with one hand,
// reaches to grab floating multiplier orbs with the other.
// All assets, names, and code are original work.
// ============================================================

let scene, camera, renderer, clock;
let player;
let raycastController, grabController;
let controllerGrip1, controllerGrip2;
let hudCanvas, hudTexture, hudSprite, hudCtx;
let triggerHeld = false;

const ARENA_RADIUS = 14;
const PLAYER_HIT_RADIUS = 0.35; // dodge sphere around the headset
const ORB_GRAB_RADIUS = 0.22;

const state = {
  started: false,
  gameOver: false,
  score: 0,
  multiplier: 1,
  health: 100,
  wave: 1,
  spawnedThisWave: 0,
  waveQuota: 6,
  waveCooldown: 0,
  enemies: [],
  enemyBullets: [],
  playerBullets: [],
  orbs: [],
  shotCooldown: 0,
  invulnTimer: 0,
  flashTimer: 0,
};

init();

function init() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02030a, 0.012);

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

// ----------------------------------------------------------
// Environment
// ----------------------------------------------------------
function buildArena() {
  const grid = new THREE.GridHelper(ARENA_RADIUS * 2, 28, 0x5ef3ff, 0x163240);
  scene.add(grid);

  const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS, 48);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x02030a, transparent: true, opacity: 0.6 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);

  const wallGeo = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 8, 32, 4, true);
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x113a4a, wireframe: true, transparent: true, opacity: 0.35 });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = 3;
  scene.add(wall);

  const strutMat = new THREE.MeshBasicMaterial({ color: 0xff2d92, transparent: true, opacity: 0.5 });
  const strutCount = 16;
  for (let i = 0; i < strutCount; i++) {
    const angle = (i / strutCount) * Math.PI * 2;
    const strutGeo = new THREE.BoxGeometry(0.06, 8, 0.06);
    const strut = new THREE.Mesh(strutGeo, strutMat);
    strut.position.set(Math.cos(angle) * ARENA_RADIUS, 3, Math.sin(angle) * ARENA_RADIUS);
    scene.add(strut);
  }

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

// ----------------------------------------------------------
// Controllers
// ----------------------------------------------------------
function setupControllers() {
  const controllerModelFactory = new XRControllerModelFactory();

  raycastController = renderer.xr.getController(0);
  raycastController.addEventListener('selectstart', () => { triggerHeld = true; });
  raycastController.addEventListener('selectend', () => { triggerHeld = false; });
  player.add(raycastController);

  controllerGrip1 = renderer.xr.getControllerGrip(0);
  controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
  player.add(controllerGrip1);

  grabController = renderer.xr.getController(1);
  player.add(grabController);

  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
  player.add(controllerGrip2);

  const shipGroup = buildDroneShip();
  raycastController.add(shipGroup);

  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5ef3ff, transparent: true, opacity: 0.45 });
  const aimLine = new THREE.Line(lineGeo, lineMat);
  aimLine.scale.z = 10;
  raycastController.add(aimLine);

  const grabGlowGeo = new THREE.SphereGeometry(ORB_GRAB_RADIUS, 12, 12);
  const grabGlowMat = new THREE.MeshBasicMaterial({ color: 0xfff066, transparent: true, opacity: 0.18, wireframe: true });
  const grabGlow = new THREE.Mesh(grabGlowGeo, grabGlowMat);
  grabController.add(grabGlow);
}

function buildDroneShip() {
  const group = new THREE.Group();
  const bodyGeo = new THREE.ConeGeometry(0.035, 0.13, 6);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x5ef3ff, wireframe: true });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = -Math.PI / 2;
  group.add(body);
  return group;
}

// ----------------------------------------------------------
// HUD — world-locked canvas-texture panel above the core
// ----------------------------------------------------------
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
  ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  ctx.fillStyle = 'rgba(2,3,10,0.55)';
  ctx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
  ctx.strokeStyle = '#5ef3ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, hudCanvas.width - 4, hudCanvas.height - 4);

  ctx.fillStyle = '#5ef3ff';
  ctx.font = 'bold 40px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE ' + state.score, 20, 55);

  ctx.fillStyle = '#fff066';
  ctx.font = 'bold 32px monospace';
  ctx.fillText('x' + state.multiplier, 20, 100);

  ctx.fillStyle = '#ff2d92';
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('WAVE ' + state.wave, hudCanvas.width - 20, 55);

  ctx.font = 'bold 28px monospace';
  const hpColor = state.health > 50 ? '#5ef3ff' : (state.health > 20 ? '#fff066' : '#ff4444');
  ctx.fillStyle = hpColor;
  ctx.fillText('HP ' + Math.max(0, Math.round(state.health)), hudCanvas.width - 20, 100);

  if (state.gameOver) {
    ctx.fillStyle = '#ff2d92';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER — pull trigger to restart', hudCanvas.width / 2, 140);
  }

  hudTexture.needsUpdate = true;
}

// ----------------------------------------------------------
// VR session bootstrap
// ----------------------------------------------------------
function setupVRFlow() {
  const reqMsg = document.getElementById('reqMsg');
  const enterBtn = document.getElementById('enterBtn');
  const status = document.getElementById('status');

  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      if (supported) {
        reqMsg.textContent = 'Headset detected. Put it on and tap below.';
        enterBtn.disabled = false;
      } else {
        reqMsg.textContent = 'No VR headset detected on this browser/device.';
      }
    }).catch(() => { reqMsg.textContent = 'Could not query WebXR support.'; });
  } else {
    reqMsg.textContent = 'This browser does not support WebXR. Open this page in the Meta Quest Browser.';
  }

  enterBtn.addEventListener('click', async () => {
    try {
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
      status.textContent = 'Failed to start VR session: ' + err.message;
    }
  });
}

// ----------------------------------------------------------
// Game lifecycle
// ----------------------------------------------------------
function startGame() {
  state.started = true;
  state.gameOver = false;
  state.score = 0;
  state.multiplier = 1;
  state.health = 100;
  state.wave = 1;
  state.spawnedThisWave = 0;
  state.waveQuota = 6;
  state.waveCooldown = 1.0;
  state.shotCooldown = 0;
  state.invulnTimer = 1.0;
  clearEntities();
}

function clearEntities() {
  [...state.enemies].forEach(removeEnemy);
  [...state.enemyBullets].forEach(removeEnemyBullet);
  [...state.playerBullets].forEach(removePlayerBullet);
  [...state.orbs].forEach(removeOrb);
}

function restartGame() {
  startGame();
}

// ----------------------------------------------------------
// Enemies
// ----------------------------------------------------------
function spawnEnemy() {
  const tierRoll = Math.random();
  let tier = 1;
  if (state.wave >= 3 && tierRoll > 0.75) tier = 2;
  if (state.wave >= 5 && tierRoll > 0.92) tier = 3;

  const colorByTier = [0xff2d92, 0xff2d92, 0xfff066, 0xff4444];
  const sizeByTier = [0, 0.22, 0.32, 0.42];
  const hpByTier = [0, 1, 2, 4];
  const valueByTier = [0, 10, 30, 50];

  const geo = new THREE.IcosahedronGeometry(sizeByTier[tier], 0);
  const mat = new THREE.MeshBasicMaterial({ color: colorByTier[tier], wireframe: true });
  const mesh = new THREE.Mesh(geo, mat);

  const angle = Math.random() * Math.PI * 2;
  const height = 0.8 + Math.random() * 2.0;
  const dist = ARENA_RADIUS * 0.85;
  mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);

  scene.add(mesh);

  const enemy = {
    mesh,
    tier,
    hp: hpByTier[tier],
    value: valueByTier[tier],
    radius: sizeByTier[tier],
    speed: 0.5 + Math.random() * 0.4 + state.wave * 0.03,
    fireTimer: 1 + Math.random() * 2,
    orbitOffset: Math.random() * Math.PI * 2,
    strafeSpeed: (Math.random() - 0.5) * 0.6,
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
    state.waveCooldown = Math.max(0.35, 1.1 - state.wave * 0.04);
    spawnEnemy();
  } else if (state.enemies.length === 0) {
    state.wave++;
    state.spawnedThisWave = 0;
    state.waveQuota = Math.min(20, 6 + state.wave * 2);
    state.waveCooldown = 2.0;
  }
}

function updateEnemies(dt) {
  const playerPos = new THREE.Vector3();
  camera.getWorldPosition(playerPos);

  for (const enemy of [...state.enemies]) {
    const toPlayer = new THREE.Vector3().subVectors(playerPos, enemy.mesh.position);
    const dist = toPlayer.length();

    const desiredDist = 4.5;
    if (dist > desiredDist) {
      toPlayer.normalize().multiplyScalar(enemy.speed * dt);
      enemy.mesh.position.add(toPlayer);
    } else if (dist < desiredDist - 1.5) {
      toPlayer.normalize().multiplyScalar(-enemy.speed * dt * 0.5);
      enemy.mesh.position.add(toPlayer);
    }

    // orbital strafe for swarm feel
    const tangent = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize();
    enemy.mesh.position.addScaledVector(tangent, enemy.strafeSpeed * dt);

    enemy.mesh.position.y = THREE.MathUtils.clamp(enemy.mesh.position.y, 0.5, 3.2);
    enemy.mesh.lookAt(playerPos);
    enemy.mesh.rotation.x += dt * 1.5;

    enemy.fireTimer -= dt;
    if (enemy.fireTimer <= 0 && dist < ARENA_RADIUS) {
      enemy.fireTimer = 1.6 + Math.random() * 1.6 - state.wave * 0.03;
      enemy.fireTimer = Math.max(0.6, enemy.fireTimer);
      fireEnemyBullet(enemy, playerPos);
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

// ----------------------------------------------------------
// Bullets
// ----------------------------------------------------------
function fireEnemyBullet(enemy, targetPos) {
  const geo = new THREE.SphereGeometry(0.07, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(enemy.mesh.position);
  scene.add(mesh);

  const dir = new THREE.Vector3().subVectors(targetPos, enemy.mesh.position).normalize();
  // slight aim imperfection so it's dodgeable, scaling tighter with wave
  const spread = Math.max(0.04, 0.22 - state.wave * 0.015);
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread * 0.5;
  dir.z += (Math.random() - 0.5) * spread;
  dir.normalize();

  state.enemyBullets.push({ mesh, dir, speed: 3.2 + state.wave * 0.1, life: 6 });
}

function updateEnemyBullets(dt) {
  const playerPos = new THREE.Vector3();
  camera.getWorldPosition(playerPos);

  for (const b of [...state.enemyBullets]) {
    b.mesh.position.addScaledVector(b.dir, b.speed * dt);
    b.life -= dt;

    if (b.life <= 0 || b.mesh.position.length() > ARENA_RADIUS * 1.6) {
      removeEnemyBullet(b);
      continue;
    }

    if (state.invulnTimer <= 0) {
      const d = b.mesh.position.distanceTo(playerPos);
      if (d < PLAYER_HIT_RADIUS) {
        takeDamage(8);
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
  }
}

function firePlayerBullet() {
  const geo = new THREE.SphereGeometry(0.045, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0x5ef3ff });
  const mesh = new THREE.Mesh(geo, mat);

  const origin = new THREE.Vector3();
  raycastController.getWorldPosition(origin);
  const dir = new THREE.Vector3(0, 0, -1);
  dir.applyQuaternion(raycastController.getWorldQuaternion(new THREE.Quaternion()));

  mesh.position.copy(origin);
  scene.add(mesh);

  state.playerBullets.push({ mesh, dir, speed: 14, life: 3 });
}

function updatePlayerBullets(dt) {
  for (const b of [...state.playerBullets]) {
    b.mesh.position.addScaledVector(b.dir, b.speed * dt);
    b.life -= dt;

    let hit = false;
    for (const enemy of state.enemies) {
      if (b.mesh.position.distanceTo(enemy.mesh.position) < 0.22 + enemy.radius) {
        enemy.hp -= 1;
        hit = true;
        if (enemy.hp <= 0) {
          state.score += enemy.value * state.multiplier;
          spawnOrbChance(enemy.mesh.position);
          removeEnemy(enemy);
        }
        break;
      }
    }

    if (hit || b.life <= 0 || b.mesh.position.length() > ARENA_RADIUS * 1.6) {
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

// ----------------------------------------------------------
// Orbs (multiplier pickups — reach/lean to grab)
// ----------------------------------------------------------
function spawnOrbChance(position) {
  if (Math.random() < 0.35) {
    spawnOrb(position);
  }
}

function spawnOrb(position) {
  const geo = new THREE.SphereGeometry(0.13, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff066, wireframe: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.position.y = THREE.MathUtils.clamp(mesh.position.y + (Math.random() - 0.3) * 0.6, 0.3, 2.2);
  scene.add(mesh);
  state.orbs.push({ mesh, life: 9, bobPhase: Math.random() * Math.PI * 2 });
}

function updateOrbs(dt) {
  for (const orb of [...state.orbs]) {
    orb.life -= dt;
    orb.bobPhase += dt * 2;
    orb.mesh.position.y += Math.sin(orb.bobPhase) * 0.002;
    orb.mesh.rotation.y += dt;
    if (orb.life <= 0) removeOrb(orb);
  }
}

function removeOrb(orb) {
  scene.remove(orb.mesh);
  orb.mesh.geometry.dispose();
  orb.mesh.material.dispose();
  const idx = state.orbs.indexOf(orb);
  if (idx >= 0) state.orbs.splice(idx, 1);
}

function updateGrab(dt) {
  const grabPos = new THREE.Vector3();
  grabController.getWorldPosition(grabPos);

  for (const orb of [...state.orbs]) {
    if (orb.mesh.position.distanceTo(grabPos) < ORB_GRAB_RADIUS) {
      state.multiplier = Math.min(10, state.multiplier + 1);
      if (state.multiplier >= 10) {
        state.score += 1000;
      }
      removeOrb(orb);
    }
  }
}

// ----------------------------------------------------------
// Damage / health
// ----------------------------------------------------------
function takeDamage(amount) {
  state.health -= amount;
  state.invulnTimer = 0.6;
  state.flashTimer = 0.15;
  state.multiplier = 1;
  if (state.health <= 0) {
    state.health = 0;
    state.gameOver = true;
  }
}

// ----------------------------------------------------------
// Main loop
// ----------------------------------------------------------
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state.started) {
    if (!state.gameOver) {
      updateShooting(dt);
      updateWaveSpawning(dt);
      updateEnemies(dt);
      updatePlayerBullets(dt);
      updateEnemyBullets(dt);
      updateOrbs(dt);
      updateGrab(dt);
      if (state.invulnTimer > 0) state.invulnTimer -= dt;
      if (state.flashTimer > 0) {
        state.flashTimer -= dt;
        scene.fog.color.setHex(0x4a0808);
      } else {
        scene.fog.color.setHex(0x02030a);
      }
    } else {
      updateShooting(dt); // allow restart via trigger
    }
    drawHud();
  }

  const core = scene.getObjectByName('decorCore');
  if (core) core.rotation.y += dt * 0.4;

  renderer.render(scene, camera);
}
