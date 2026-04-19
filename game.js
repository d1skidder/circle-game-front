// ═══════════════════════════════════════════════════
//  ARCNE.IO  —  PixiJS WebGL Frontend
//  Controls: WASD/Arrows = move | Q, F, R = skills | LMB = melee
// ═══════════════════════════════════════════════════

const WS_URL = 'wss://circle-game-nzws.onrender.com';
const WORLD = 4000;
const INTERP = 0.2;

// ── CLASS DEFINITIONS ────────────────────────────
const CLASSES = {
  fire: {
    label: 'FIRE', emoji: '🔥', color: 0xff4422, glow: 0xff8844,
    desc: 'High burst damage. Fireball combos & cluster explosion.',
    skills: ['🔥 Fireball', '💥 Big Fireball', '🌋 Cluster Bomb'],
    keys: ['Q', 'F', 'R']
  },
  ice: {
    label: 'ICE', emoji: '❄️', color: 0x44ccff, glow: 0x88eeff,
    desc: 'Control & slow. Triple icicles, ice blade, snowstorm.',
    skills: ['❄️ Triple Icicle', '🌀 Ice Blade', '🌨 Snowstorm'],
    keys: ['Q', 'F', 'R']
  },
  earth: {
    label: 'EARTH', emoji: '🪨', color: 0x88aa44, glow: 0xaacc66,
    desc: 'Tank. Enhanced melee, shockwave, brief invincibility.',
    skills: ['⚡ Power Swing', '💢 Shockwave', '🛡 Invincible'],
    keys: ['Q', 'F', 'R']
  },
  blood: {
    label: 'BLOOD', emoji: '🩸', color: 0xcc1133, glow: 0xff3355,
    desc: 'Lifesteal & frenzy. Spin blades, dash, berserk mode.',
    skills: ['🩸 Spin Blades', '💨 Dash', '😤 Frenzy'],
    keys: ['Q', 'F', 'R']
  },
  lightning: {
    label: 'LIGHTNING', emoji: '⚡', color: 0xffee22, glow: 0xffffaa,
    desc: 'Speed & range. Homing ball, lightning speed, bolt snipe.',
    skills: ['🎯 Homing Ball', '⚡ Speed Burst', '🌩 Bolt Snipe'],
    keys: ['Q', 'F', 'R']
  }
};

const PROJ_COLORS = {
  fireball:        0xff5533,
  chonkyfireball:  0xff7700,
  clusterfireball: 0xff2200,
  icicle:          0x88ddff,
  iceblade:        0x44aaff,
  snowstorm:       0xcceeff,
  shockwave:       0x99bb55,
  bloodblade:      0xdd1144,
  lightningball:   0xffee22,
  lightningbolt:   0xffffbb,
  lightningspark:  0xffff88,
};

// ── STATE ────────────────────────────────────────
let ws = null, myId = null, myClass = null, myName = '';
let dead = false, killcount = 0;
let serverPlayers = {}, serverProj = {}, serverObstacles = [];
let playerSprites = {}, projSprites = {};
let app, worldContainer;
let camera = { x: 0, y: 0 };
const keys = {};
let mouseDir = 0;
let moveInterval = null, pingInterval = null;

// ── LOBBY ────────────────────────────────────────
function buildLobby() {
  const grid = document.getElementById('class-grid');
  for (const [id, cls] of Object.entries(CLASSES)) {
    const hexStr = '#' + cls.color.toString(16).padStart(6, '0');
    const card = document.createElement('div');
    card.className = 'class-card';
    card.style.setProperty('--clr', hexStr);
    card.innerHTML = `
      <div class="class-icon">${cls.emoji}</div>
      <div class="class-info">
        <h3>${cls.label}</h3>
        <p>${cls.desc}</p>
      </div>`;
    card.addEventListener('click', () => {
      document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      myClass = id;
      checkReady();
    });
    grid.appendChild(card);
  }
  document.getElementById('name-input').addEventListener('input', checkReady);
  document.getElementById('play-btn').addEventListener('click', startGame);
  document.getElementById('respawn-btn').addEventListener('click', () => {
    document.getElementById('death-screen').style.display = 'none';
    showLobby();
  });
}

function checkReady() {
  const name = document.getElementById('name-input').value.trim();
  document.getElementById('play-btn').disabled = !(name.length > 0 && myClass);
}

function showLobby() {
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('leaderboard').style.display = 'none';
  document.getElementById('minimap-wrap').style.display = 'none';
  document.getElementById('killfeed').style.display = 'none';
  if (ws) { ws.close(); ws = null; }
  clearInterval(moveInterval);
  clearInterval(pingInterval);
  myId = null; dead = false; killcount = 0;
  serverPlayers = {}; serverProj = {}; serverObstacles = [];
  clearScene();
}

// ── PIXI ─────────────────────────────────────────
function initPixi() {
  app = new PIXI.Application({
    resizeTo: window,
    backgroundColor: 0x080c12,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  document.getElementById('canvas-container').appendChild(app.view);
  worldContainer = new PIXI.Container();
  app.stage.addChild(worldContainer);
  drawWorldGrid();
  app.ticker.add(gameLoop);
}

function drawWorldGrid() {
  const g = new PIXI.Graphics();
  g.lineStyle(1, 0x1a2a3a, 0.45);
  for (let x = 0; x <= WORLD; x += 100) { g.moveTo(x, 0); g.lineTo(x, WORLD); }
  for (let y = 0; y <= WORLD; y += 100) { g.moveTo(0, y); g.lineTo(WORLD, y); }
  g.lineStyle(3, 0x2244aa, 0.7);
  g.drawRect(0, 0, WORLD, WORLD);
  worldContainer.addChild(g);
}

function clearScene() {
  if (!worldContainer) return;
  while (worldContainer.children.length > 1) worldContainer.removeChildAt(1);
  playerSprites = {}; projSprites = {};
}

// ── START GAME ───────────────────────────────────
function startGame() {
  myName = document.getElementById('name-input').value.trim();
  if (!myName || !myClass) return;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('leaderboard').style.display = 'block';
  document.getElementById('minimap-wrap').style.display = 'block';
  document.getElementById('killfeed').style.display = 'flex';
  buildSkillHUD();
  connectWS();
  moveInterval = setInterval(sendMovement, 50);
}

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name: myName, class: myClass }));
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'ping' }));
    }, 5000);
  };
  ws.onmessage = e => handleMessage(JSON.parse(e.data));
  ws.onerror = () => {};
  ws.onclose = () => clearInterval(pingInterval);
}

// ── MESSAGES ─────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'init':        myId = msg.id; break;
    case 'players':     processPlayers(msg.players); break;
    case 'projectiles': processProjectiles(msg.projectiles); break;
    case 'obstacles':   processObstacles(msg.obstacles); break;
  }
}

function processPlayers(list) {
  const incoming = new Set(list.map(p => p.id));
  for (const p of list) {
    const old = serverPlayers[p.id];
    serverPlayers[p.id] = {
      ...p,
      render_x: old ? old.render_x : p.x,
      render_y: old ? old.render_y : p.y,
    };
    if (!playerSprites[p.id]) createPlayerSprite(p.id, p.gameClass);
    if (p.id === myId) updateHUD(p);
  }
  for (const id of Object.keys(serverPlayers)) {
    if (!incoming.has(id)) {
      if (id === myId && !dead) triggerDeath();
      if (playerSprites[id]) { worldContainer.removeChild(playerSprites[id]); delete playerSprites[id]; }
      delete serverPlayers[id];
    }
  }
  updateLeaderboard();
}

function processProjectiles(list) {
  const incoming = new Set(list.map(p => p.id));
  for (const p of list) {
    const old = serverProj[p.id];
    serverProj[p.id] = {
      ...p,
      render_x: old ? old.render_x : p.x,
      render_y: old ? old.render_y : p.y,
    };
    if (!projSprites[p.id]) createProjSprite(p.id, p.type, p.radius);
  }
  for (const id of Object.keys(projSprites)) {
    if (!incoming.has(id)) {
      if (projSprites[id]) worldContainer.removeChild(projSprites[id]);
      delete projSprites[id];
      delete serverProj[id];
    }
  }
}

function processObstacles(obs) {
  serverObstacles = obs;
  for (const ob of obs) {
    const g = new PIXI.Graphics();
    g.beginFill(0x182818, 0.95);
    g.lineStyle(2.5, 0x3a5a30, 1);
    g.drawCircle(0, 0, ob.radius);
    g.endFill();
    // crack lines for texture
    const angles = [0.4, 1.2, 2.5, 3.8, 5.0];
    for (const a of angles) {
      const r2 = ob.radius * 0.65;
      g.lineStyle(1, 0x2a4828, 0.5);
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    }
    g.x = ob.x; g.y = ob.y;
    worldContainer.addChild(g);
  }
}

// ── PLAYER SPRITES ───────────────────────────────
function createPlayerSprite(id, gameClass) {
  const cls = CLASSES[gameClass] || CLASSES.fire;
  const c = new PIXI.Container();

  // glow
  const glow = new PIXI.Graphics();
  glow.beginFill(cls.glow, 0.06);
  glow.drawCircle(0, 0, 42);
  glow.endFill();
  glow.beginFill(cls.glow, 0.03);
  glow.drawCircle(0, 0, 56);
  glow.endFill();

  // body
  const body = new PIXI.Graphics();
  body.beginFill(cls.color);
  body.lineStyle(2.5, lighten(cls.color, 0.35), 0.75);
  body.drawCircle(0, 0, 20);
  body.endFill();
  body.name = 'body';

  // direction pointer
  const ptr = new PIXI.Graphics();
  ptr.beginFill(0xffffff, 0.65);
  ptr.drawPolygon([19, 0, 29, -5, 29, 5]);
  ptr.endFill();
  ptr.name = 'ptr';

  // emoji icon
  const icon = new PIXI.Text(cls.emoji, { fontSize: 16 });
  icon.anchor.set(0.5);

  // name tag
  const nt = new PIXI.Text('', {
    fontSize: 12, fill: 0xffffff, fontWeight: '700',
    dropShadow: true, dropShadowBlur: 4, dropShadowColor: 0x000000, dropShadowDistance: 0,
  });
  nt.anchor.set(0.5);
  nt.y = -40;
  nt.name = 'nametag';

  // hp bar
  const hpBg = new PIXI.Graphics();
  hpBg.beginFill(0x000000, 0.5);
  hpBg.drawRoundedRect(-24, 26, 48, 6, 3);
  hpBg.endFill();

  const hpFill = new PIXI.Graphics();
  hpFill.name = 'hpfill';

  c.addChild(glow, body, ptr, icon, nt, hpBg, hpFill);
  worldContainer.addChild(c);
  playerSprites[id] = c;
}

function updatePlayerSprite(id) {
  const p = serverPlayers[id];
  const s = playerSprites[id];
  if (!p || !s) return;
  s.x = p.render_x;
  s.y = p.render_y;

  const ptr = s.getChildByName('ptr');
  if (ptr) ptr.rotation = p.dir;

  const nt = s.getChildByName('nametag');
  if (nt) {
    nt.text = p.name + (p.killcount > 0 ? ` ☠${p.killcount}` : '');
    nt.style.fill = (id === myId) ? 0xaabbff : 0xffffff;
  }

  const hpFill = s.getChildByName('hpfill');
  if (hpFill) {
    hpFill.clear();
    const pct = Math.max(0, Math.min(1, p.health / 100));
    const col = pct > 0.6 ? 0x44ee88 : pct > 0.3 ? 0xffcc44 : 0xff3344;
    hpFill.beginFill(col, 0.9);
    hpFill.drawRoundedRect(-24, 26, 48 * pct, 6, 3);
    hpFill.endFill();
  }

  const body = s.getChildByName('body');
  if (body) {
    const cls = CLASSES[p.gameClass] || CLASSES.fire;
    if (p.isInvincible)        body.tint = 0xffffff;
    else if (p.isFrenzy)       body.tint = 0xff0044;
    else if (p.isLightningSpeed) body.tint = 0xffffaa;
    else                       body.tint = cls.color;
  }
}

// ── PROJECTILE SPRITES ───────────────────────────
function createProjSprite(id, type, radius) {
  const g = new PIXI.Graphics();
  const col = PROJ_COLORS[type] || 0xffffff;
  const r = Math.max(4, radius || 8);

  if (type === 'shockwave') {
    g.lineStyle(4, col, 0.75);
    g.drawCircle(0, 0, r);
    g.lineStyle(2, col, 0.3);
    g.drawCircle(0, 0, r * 1.6);
  } else if (type === 'iceblade' || type === 'bloodblade') {
    g.beginFill(col, 0.9);
    g.drawPolygon([0, -r * 2, r * 0.5, 0, 0, r * 1.2, -r * 0.5, 0]);
    g.endFill();
    g.beginFill(col, 0.25);
    g.drawCircle(0, 0, r * 1.5);
    g.endFill();
  } else if (type === 'lightningbolt') {
    g.beginFill(col, 0.95);
    g.drawPolygon([r*0.2,-r*2.2, r*0.65,-r*0.3, r*0.25,-r*0.3, r*0.7,r*2, -r*0.35,r*0.3, r*0.05,r*0.3]);
    g.endFill();
  } else if (type === 'snowstorm') {
    // spinning snowflake-ish
    g.lineStyle(2, col, 0.8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.beginFill(col, 0.3);
    g.drawCircle(0, 0, r * 0.4);
    g.endFill();
  } else {
    // standard glowing circle
    g.beginFill(col, 0.9);
    g.drawCircle(0, 0, r);
    g.endFill();
    g.beginFill(col, 0.18);
    g.drawCircle(0, 0, r * 2.0);
    g.endFill();
  }

  worldContainer.addChild(g);
  projSprites[id] = g;
}

// ── GAME LOOP ────────────────────────────────────
function gameLoop() {
  if (!myId || dead) return;
  interpolate();
  updateCamera();
  for (const id of Object.keys(playerSprites)) updatePlayerSprite(id);
  for (const id of Object.keys(projSprites)) {
    const p = serverProj[id], s = projSprites[id];
    if (!p || !s) continue;
    s.x = p.render_x; s.y = p.render_y; s.rotation = p.dir || 0;
  }
  drawMinimap();
}

function interpolate() {
  for (const p of Object.values(serverPlayers)) {
    p.render_x += (p.x - p.render_x) * INTERP;
    p.render_y += (p.y - p.render_y) * INTERP;
  }
  for (const p of Object.values(serverProj)) {
    p.render_x += (p.x - p.render_x) * INTERP;
    p.render_y += (p.y - p.render_y) * INTERP;
  }
}

function updateCamera() {
  const me = serverPlayers[myId];
  if (!me) return;
  const tx = app.screen.width  / 2 - me.render_x;
  const ty = app.screen.height / 2 - me.render_y;
  camera.x += (tx - camera.x) * 0.13;
  camera.y += (ty - camera.y) * 0.13;
  worldContainer.x = camera.x;
  worldContainer.y = camera.y;
}

// ── INPUT ────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (dead || !myId) return;
  if (e.code === 'KeyQ') sendAttack('skill1');
  if (e.code === 'KeyF') sendAttack('skill2');
  if (e.code === 'KeyR') sendAttack('skill3');
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

window.addEventListener('mousemove', e => {
  const me = serverPlayers[myId];
  if (!me) return;
  mouseDir = Math.atan2(
    e.clientY - (me.render_y + camera.y),
    e.clientX - (me.render_x + camera.x)
  );
});

let lastMeleeTime = 0;
window.addEventListener('mousedown', e => {
  if (dead || !myId || e.button !== 0) return;
  const now = Date.now();
  if (now - lastMeleeTime > 220) { lastMeleeTime = now; sendAttack('basicMelee'); }
});

function sendMovement() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !myId || dead) return;
  let x = 0, y = 0;
  if (keys['KeyW'] || keys['ArrowUp'])    y -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  y += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) x += 1;
  if (x !== 0 && y !== 0) { x *= 0.707; y *= 0.707; }
  ws.send(JSON.stringify({ type: 'move', x, y, dir: mouseDir }));
}

function sendAttack(move) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'attack', move, dir: mouseDir }));
}

// ── HUD ──────────────────────────────────────────
function buildSkillHUD() {
  const cls = CLASSES[myClass];
  if (!cls) return;
  const row = document.getElementById('skills-row');
  row.innerHTML = '';
  cls.skills.forEach((s, i) => {
    const slot = document.createElement('div');
    slot.className = 'skill-slot';
    slot.id = `skill-slot-${i}`;
    const icon = s.split(' ')[0];
    slot.innerHTML = `<span class="key">${cls.keys[i]}</span><span class="icon">${icon}</span>`;
    row.appendChild(slot);
  });
}

function updateHUD(p) {
  document.getElementById('hp-fill').style.width = Math.max(0, p.health) + '%';
  document.getElementById('mp-fill').style.width = Math.max(0, p.mana) + '%';
  killcount = p.killcount;
  // skill CDs — server sends ratio 0..1
  [[p.skill1cd, 0], [p.skill2cd, 1], [p.skill3cd, 2]].forEach(([cd, i]) => {
    const slot = document.getElementById(`skill-slot-${i}`);
    if (!slot) return;
    let overlay = slot.querySelector('.skill-cd-overlay');
    if (cd > 0.02) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'skill-cd-overlay';
        slot.appendChild(overlay);
      }
      overlay.textContent = (cd * 10).toFixed(1) + 's';
    } else if (overlay) {
      overlay.remove();
    }
  });
}

// ── LEADERBOARD ──────────────────────────────────
function updateLeaderboard() {
  const list = document.getElementById('lb-list');
  const sorted = Object.values(serverPlayers)
    .sort((a, b) => b.killcount - a.killcount).slice(0, 8);
  list.innerHTML = sorted.map(p => {
    const cls = CLASSES[p.gameClass];
    return `<div class="lb-row">
      <span class="lb-name${p.id === myId ? ' lb-me' : ''}">${cls?.emoji || ''} ${p.name}</span>
      <span class="lb-kills">${p.killcount}</span>
    </div>`;
  }).join('');
}

// ── MINIMAP ──────────────────────────────────────
function drawMinimap() {
  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const scale = W / WORLD;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(4,10,18,0.8)';
  ctx.fillRect(0, 0, W, H);

  for (const ob of serverObstacles) {
    ctx.fillStyle = '#253522';
    ctx.beginPath();
    ctx.arc(ob.x * scale, ob.y * scale, Math.max(2, ob.radius * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  for (const [id, p] of Object.entries(serverPlayers)) {
    if (id === myId) continue;
    const cls = CLASSES[p.gameClass];
    ctx.fillStyle = cls ? '#' + cls.color.toString(16).padStart(6, '0') : '#ffffff';
    ctx.beginPath();
    ctx.arc(p.render_x * scale, p.render_y * scale, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const me = serverPlayers[myId];
  if (me) {
    ctx.fillStyle = '#88aaff';
    ctx.shadowColor = '#88aaff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(me.render_x * scale, me.render_y * scale, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);
}

// ── DEATH ────────────────────────────────────────
function triggerDeath() {
  dead = true;
  document.getElementById('death-msg').textContent =
    `You got ${killcount} kill${killcount !== 1 ? 's' : ''}.`;
  document.getElementById('death-screen').style.display = 'flex';
}

// ── UTILS ────────────────────────────────────────
function lighten(hex, amt) {
  const r = Math.min(255, ((hex >> 16) & 0xff) + Math.round(255 * amt));
  const g = Math.min(255, ((hex >> 8)  & 0xff) + Math.round(255 * amt));
  const b = Math.min(255, ( hex        & 0xff) + Math.round(255 * amt));
  return (r << 16) | (g << 8) | b;
}

// ── BOOT ─────────────────────────────────────────
buildLobby();
initPixi();
