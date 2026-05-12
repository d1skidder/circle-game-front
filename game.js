// ═══════════════════════════════════════════════════
//  ARCNE.IO  —  PixiJS WebGL frontend
//  Controls: WASD/arrows=move | Q,E,F=skills | LMB=melee
// ═══════════════════════════════════════════════════

const WS_URL = "https://circle-game-5y2k.onrender.com";
let MAP_DIM = 4000;
const SERVER_TICK = 100;

const CLASS_STYLES = {
  fire:      { body: 0xd14821, bodyHi: 0xff7744, arm: 0xb03010, outline: 0x661500 },
  ice:       { body: 0x88ddff, bodyHi: 0xccf4ff, arm: 0x44aadd, outline: 0x2266aa },
  earth:     { body: 0x7a6a50, bodyHi: 0x9a8a70, arm: 0x55473a, outline: 0x2a2018 },
  blood:     { body: 0xaa1122, bodyHi: 0xff3355, arm: 0x880011, outline: 0x440008 },
  lightning: { body: 0xffee22, bodyHi: 0xffff99, arm: 0xddcc00, outline: 0x886600 },
  void:      { body: 0x48315c, bodyHi: 0x7f6890, arm: 0x3a2e48, outline: 0x1a1220 },
  crusader:  { body: 0xffffff, bodyHi: 0xeeeeee, arm: 0xcccccc, outline: 0x444444 },
};

// ── STATE ────────────────────────────────────────
let ws = null, myId = null, myClass = null, myName = '';
let dead = false, killcount = 0, gameStartTime = 0;
let pingIntervalId = null;
let players = {}, projectiles = {}, obstacles = {};
let capturePoint = {}, cpRenderPercent = 0;
let zoom = 1.1, direction = 0;
const pressed = {};
let lastMoveSend = 0;
// ── PIXI OBJECTS ─────────────────────────────────
let app, mapContainer, uiContainer;
let obstacleLayer, projLayer, playerLayer, trailLayer;
let frenzyTrails = [];
let lightningParticles = [];
let mapBg = null;
let capturePointGraphic = null;
let playerContainers = {}, projContainers = {}, obstacleSprites = {};
let texCache = {};
let pixiReady = false;
// –– GAME DATA ───────────────────────────────────────
let sessionId = 0;
let gamemode = 0;
let teamSelect = null;
let team0score = 0, team1score = 0;

// ── DAMAGE TEXT STATE ─────────────────────────────
let damageTexts = [];

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let c = b - a;
  while (c < -Math.PI) c += Math.PI * 2;
  while (c >  Math.PI) c -= Math.PI * 2;
  return a + c * t;
}

// ═══════════════════════════════════════════════════
//  JOIN SCREEN — wired in DOMContentLoaded
// ═══════════════════════════════════════════════════
let selectedClass = null;

function initJoinScreen() {
  document.querySelectorAll('.class-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedClass = card.dataset.class;
      checkReady();
    });
  });

  document.getElementById('name-input').addEventListener('input', checkReady);

  document.getElementById('session-select').addEventListener('change', () => {
    const val = parseInt(document.getElementById('session-select').value, 10);
    document.getElementById('team-select').style.display = (val === 1 || val === 2) ? 'block' : 'none';
  });

  document.getElementById('join-btn').addEventListener('click', () => {
    myName = document.getElementById('name-input').value.trim();
    myClass = selectedClass;
    sessionId = parseInt(document.getElementById('session-select').value, 10);
    teamSelect = (sessionId === 1 || sessionId === 2)
      ? parseInt(document.getElementById('team-select').value, 10)
      : null;
    if (!myName || !myClass) return;
    document.getElementById('joinScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    gameStartTime = Date.now();
    dead = false; killcount = 0;
    players = {}; projectiles = {}; obstacles = {};
    clearScene();
    if (!pixiReady) initPixi();
    connectWS();
  });

  document.getElementById('respawn-btn').addEventListener('click', () => {
    document.getElementById('deathScreen').style.display = 'none';
    document.getElementById('joinScreen').style.display = 'flex';
    document.getElementById('gameScreen').style.display = 'none';
    ws = null;
    myId = null; dead = false; killcount = 0;
    players = {}; projectiles = {}; obstacles = {};
    clearScene();
  });
}

function checkReady() {
  const name = document.getElementById('name-input').value.trim();
  document.getElementById('join-btn').disabled = !(name.length > 0 && selectedClass);
}

// ═══════════════════════════════════════════════════
//  PIXI INIT
// ═══════════════════════════════════════════════════
function drawMapBg() {
  if (!mapBg) return;
  mapBg.clear();
  mapBg.beginFill(0x427e3a);
  mapBg.drawRect(0, 0, MAP_DIM, MAP_DIM);
  mapBg.endFill();
  mapBg.lineStyle(1, 0x326420, 0.4);
  for (let x = 0; x <= MAP_DIM; x += 100) { mapBg.moveTo(x,0); mapBg.lineTo(x,MAP_DIM); }
  for (let y = 0; y <= MAP_DIM; y += 100) { mapBg.moveTo(0,y); mapBg.lineTo(MAP_DIM,y); }
  mapBg.lineStyle(5, 0x223e1a, 1);
  mapBg.drawRect(0, 0, MAP_DIM, MAP_DIM);
  // ── dim overlay ──
  mapBg.lineStyle(0);
  mapBg.beginFill(0x000000, 0.15);
  mapBg.drawRect(0, 0, MAP_DIM, MAP_DIM);
  mapBg.endFill();
}

function initPixi() {
  pixiReady = true;
  app = new PIXI.Application({
    resizeTo: document.getElementById('gameScreen'),
    backgroundColor: 0x427e3a,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  document.getElementById('gameScreen').appendChild(app.view);

  mapContainer = new PIXI.Container();
  uiContainer    = new PIXI.Container();
  app.stage.addChild(mapContainer, uiContainer);

  mapBg = new PIXI.Graphics();
  mapContainer.addChild(mapBg);
  drawMapBg();

  obstacleLayer = new PIXI.Container();
  projLayer = new PIXI.Container();
  trailLayer = new PIXI.Container();
  playerLayer = new PIXI.Container();
  capturePointGraphic = new PIXI.Graphics();
  mapContainer.addChild(capturePointGraphic, projLayer, obstacleLayer, trailLayer, playerLayer);

  generateTextures();
  initUI();
  app.ticker.add(gameLoop);
}

function clearScene() {
  if (!mapContainer) return;
  while (mapContainer.children.length > 1) {
    const child = mapContainer.removeChildAt(1);
    child.destroy({ children: true });
  }
  obstacleLayer = new PIXI.Container();
  projLayer = new PIXI.Container();
  trailLayer = new PIXI.Container();
  playerLayer = new PIXI.Container();
  capturePointGraphic = new PIXI.Graphics();
  mapContainer.addChild(projLayer, obstacleLayer, trailLayer, playerLayer, capturePointGraphic);
  playerContainers = {}; projContainers = {}; obstacleSprites = {};
  frenzyTrails = [];
  lightningParticles = [];

  for (const d of damageTexts) {
    if (d.obj && !d.obj.destroyed) {
      if (d.obj.parent) d.obj.parent.removeChild(d.obj);
      d.obj.destroy();
    }
  }
  damageTexts = [];

  for (const id of Object.keys(uiPlayerUI)) removePlayerUI(id);
  for (const id of Object.keys(uiMmDots)) {
    uiContainer.removeChild(uiMmDots[id]);
    uiMmDots[id].destroy();
    delete uiMmDots[id];
  }
}

// ═══════════════════════════════════════════════════
//  TEXTURE GENERATION
// ═══════════════════════════════════════════════════
function generateTextures() {
  texCache.sword         = PIXI.Texture.from('https://d1skidder.github.io/circle-game-front/assets/swordSprite.png');
  texCache.enhancedSword = PIXI.Texture.from('https://d1skidder.github.io/circle-game-front/assets/enhancedsword_placeholder.png');
  texCache.voidOuter  = PIXI.Texture.from('https://d1skidder.github.io/circle-game-front/assets/voidOuterRingClean.png');
  texCache.voidMiddle = PIXI.Texture.from('https://d1skidder.github.io/circle-game-front/assets/voidMiddleRingClean.png');
  texCache.voidInner  = PIXI.Texture.from('https://d1skidder.github.io/circle-game-front/assets/voidInnerRingClean.png');
  texCache.voidHand = PIXI.Texture.from('https://d1skidder.github.io/circle-game-front/assets/voidHandClean.png');
  texCache.crusadeWing = PIXI.Texture.from('assets/CrusadeWingClean.png');
  texCache.holySword = PIXI.Texture.from('https://d1skidder.github.io/circle-game-front/assets/HolySwordClean.png');
  texCache.iceSword      = PIXI.Texture.from('assets/iceblade.png');
  texCache.rock          = makeRockTexture();
}

function bakeGraphic(g, w, h, cx, cy) {
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  g.x = cx; g.y = cy;
  app.renderer.render(g, { renderTexture: rt });
  g.destroy();
  return rt;
}

function makeRockTexture() {
  const g = new PIXI.Graphics();
  const cx = 50, cy = 50, r = 42;
  g.lineStyle(3, 0x1a2a1a, 0.9);
  g.beginFill(0x4a5e3a, 1);
  g.moveTo(cx + r * Math.cos(-Math.PI/2), cy + r * Math.sin(-Math.PI/2));
  for (let i = 1; i <= 8; i++) {
    const ang = -Math.PI/2 + (i / 8) * Math.PI * 2;
    g.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
  }
  g.endFill();
  g.lineStyle(0);
  g.beginFill(0x6a7e55, 0.5);
  g.moveTo(cx + (r*0.55)*Math.cos(-Math.PI/2), cy + (r*0.55)*Math.sin(-Math.PI/2));
  for (let i = 1; i <= 8; i++) {
    const ang = -Math.PI/2 + (i/8)*Math.PI*2;
    g.lineTo(cx + (r*0.55)*Math.cos(ang), cy + (r*0.55)*Math.sin(ang));
  }
  g.endFill();
  return bakeGraphic(g, 100, 100, 0, 0);
}

// ═══════════════════════════════════════════════════
//  DEBUG OVERLAY
// ═══════════════════════════════════════════════════
function dbgSet(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'debug-line ' + (type || 'info');
}
function showDebug() { document.getElementById('debug-overlay').style.display = 'flex'; }
function hideDebug() { document.getElementById('debug-overlay').style.display = 'none'; }

let pingStart = 0;
function updateDebugPlayers() {
  const count = Object.keys(players).length;
  dbgSet('dbg-players', `⬤ Players in game: ${count}`, count > 0 ? 'ok' : 'warn');
}

// ═══════════════════════════════════════════════════
//  WS
// ═══════════════════════════════════════════════════
function connectWS() {
  dbgSet('dbg-ws', '⬤ WebSocket: connecting to server...', 'warn');
  showDebug();

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    dbgSet('dbg-ws', '⬤ WebSocket: connected ✓', 'ok');
    dbgSet('dbg-id', '⬤ Session ID: joining...', 'warn');
    const joinMsg = { type: 'join', name: myName, class: myClass, session: sessionId };
    if (teamSelect !== null) joinMsg.team = teamSelect;
    ws.send(JSON.stringify(joinMsg));
    if (pingIntervalId) clearInterval(pingIntervalId);
    pingIntervalId = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        pingStart = Date.now();
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 2000);
  };

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'ping') {
      const ms = Date.now() - pingStart;
      dbgSet('dbg-ping', `⬤ Ping: ${ms}ms`, ms < 100 ? 'ok' : ms < 250 ? 'warn' : 'error');
    }
    handleMessage(msg);
  };

  ws.onerror = () => {
    dbgSet('dbg-ws', '⬤ WebSocket: ERROR — cannot reach server', 'error');
    dbgSet('dbg-id', '⬤ Session ID: failed', 'error');
  };

  ws.onclose = () => {
    dbgSet('dbg-ws', '⬤ WebSocket: disconnected', 'error');
    if (pingIntervalId) { clearInterval(pingIntervalId); pingIntervalId = null; }
  };
}

function handleMessage(msg) {
  const now = Date.now();
  if (msg.type === 'init') {
    myId = msg.id;
    dbgSet('dbg-id', `⬤ Session ID: ${sessionId}`, 'ok');
  }

  if (msg.type === 'death') {
    triggerDeath();
  }

  if (msg.type === 'players') {
    msg.players.forEach(p => {
      if (!players[p.id]) {
        players[p.id] = { ...p, renderX: p.x, renderY: p.y, renderDir: p.dir,
          renderHealth: p.health, renderMana: p.mana,
          renderSkill1cd: p.skill1cd, renderSkill2cd: p.skill2cd, renderSkill3cd: p.skill3cd,
          lastUpdateTime: now, team: p.team };
      } else {
        const prev = players[p.id];
        const prevHealth = prev.health ?? p.health;
        const prevdir = prev.renderDir;
        Object.assign(prev, p, { lastUpdateTime: now });
        if (p.id === myId) players[myId].dir = prevdir;

        // Spawn damage text if this player took damage
        const dmg = Math.round(prevHealth - p.health);
        if (dmg > 0 || dmg < -1) {
          spawnDamageText(p.x, p.y - 24, dmg, dmg >= 20);
        }
      }
    });
    for (const id in players) {
      if (players[id].lastUpdateTime !== now) {
        console.log(`Player ${id} died`);
        if (id === myId && !dead) triggerDeath();
        removePlayerSprite(id); delete players[id];
      }
    }
    updateDebugPlayers();
  }

  if (msg.type === 'projectiles') {
    msg.projectiles.forEach(p => {
  if (!projectiles[p.id]) {
    projectiles[p.id] = { ...p, renderX: p.x, renderY: p.y, lastUpdateTime: now };
  } else {
    const prev = projectiles[p.id];
    const prevX = prev.x;
    const prevY = prev.y;
    Object.assign(prev, p, { lastUpdateTime: now, last_x: prevX, last_y: prevY });
  }
});
    for (const id in projectiles) {
      if (projectiles[id].lastUpdateTime !== now) { removeProjSprite(id); delete projectiles[id]; }
    }
  }

  if (msg.type === 'gameStart') {
    msg.obstacles.forEach(p => { if (!obstacles[p.id]) obstacles[p.id] = { ...p }; });
    sessionId = msg.sessionId;
    gamemode = msg.gamemode;
    MAP_DIM = msg.mapDim || MAP_DIM;
    drawMapBg();
    console.log(msg.sessionId);
    let modeText = '';
    if (gamemode == 0) modeText = 'Free For All';
    else if (gamemode == 1) modeText = 'Team Deathmatch';
    else if (gamemode == 2) modeText = 'Capture Point';
    dbgSet('dbg-id', `⬤ Session ID: ${sessionId}, Gamemode: ${modeText}`, 'ok');
  }

  if (msg.type === 'capturepoint') {
    capturePoint = { x: msg.x, y: msg.y, radius: msg.radius, captureState: msg.captureState, text: msg.text, percentage: msg.percentage };
  }

  if (msg.type === 'gameState') {
    team0score = msg.team0score;
    team1score = msg.team1score;
  }
}

// ═══════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  pressed[e.key] = true;
  if (!myId || dead) return;
  if (e.key === 'q') sendAttack('skill1');
  if (e.key === 'e') sendAttack('skill2');
  if (e.key === 'f') sendAttack('skill3');
});
document.addEventListener('keyup', e => { pressed[e.key] = false; });
document.addEventListener('mousemove', e => {
  if (!app) return;
  const pl = players[myId];
  if (!pl) return;
  const wx = (e.clientX - app.screen.width  / 2) / zoom + pl.renderX;
  const wy = (e.clientY - app.screen.height / 2) / zoom + pl.renderY;
  direction = Math.atan2(wy - pl.renderY, wx - pl.renderX);
  pl.renderDir = direction;
});
document.addEventListener('mousedown', e => {
  if (myId && !dead && document.getElementById('gameScreen').style.display === 'block')
    sendAttack('basicMelee');
});
document.addEventListener('wheel', e => {
  zoom = e.deltaY > 0 ? Math.min(2.0, zoom + 0.05) : Math.max(0.4, zoom - 0.05);
});
function sendAttack(move) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: 'attack', move, dir: direction }));
}

// ═══════════════════════════════════════════════════
//  DAMAGE TEXT  ── upgraded: pop scale, heal green, crit punch
// ═══════════════════════════════════════════════════
function spawnDamageText(x, y, amount, isCrit = false) {
  const isHeal = amount < 0;
  const style = new PIXI.TextStyle({
    fontSize: isCrit ? 24 : 17,
    fill: isHeal ? 0x44ee66 : (isCrit ? 0xff2200 : 0xffffff),
    fontWeight: '900',
    dropShadow: true,
    dropShadowBlur: isCrit ? 6 : 3,
    dropShadowColor: 0x000000,
    dropShadowDistance: 0,
    dropShadowAlpha: 0.85,
    stroke: isHeal ? 0x006600 : 0x000000,
    strokeThickness: isCrit ? 5 : 3,
  });
  const label = isHeal
    ? `+${Math.abs(amount)}`
    : (isCrit ? `${Math.abs(amount)}!` : `${Math.abs(amount)}`);
  const text = new PIXI.Text(label, style);
  text.anchor.set(0.5);
  text.x = x + (Math.random() - 0.5) * 20;
  text.y = y - 40;
  mapContainer.addChild(text);
  damageTexts.push({
    obj: text,
    vy: -(2.4 + Math.random() * 0.8),
    life: 1.0,
    decay: isCrit ? 0.015 : 0.019,
    isCrit,
    popPhase: 1.0,   // counts down from 1 → drives initial scale pop
  });
}

function updateDamageTexts() {
  for (let i = damageTexts.length - 1; i >= 0; i--) {
    const d = damageTexts[i];
    d.obj.y += d.vy;
    d.vy *= 0.89;
    d.life -= d.decay;

    // Pop: start oversized, ease to 1.0 quickly
    if (d.popPhase > 0) {
      d.popPhase = Math.max(0, d.popPhase - 0.10);
      const scale = 1.0 + d.popPhase * (d.isCrit ? 0.5 : 0.25);
      d.obj.scale.set(scale);
    } else {
      d.obj.scale.set(1.0);
    }

    d.obj.alpha = d.life > 0.4 ? 1.0 : d.life / 0.4;
    if (d.life <= 0) {
      mapContainer.removeChild(d.obj);
      d.obj.destroy();
      damageTexts.splice(i, 1);
    }
  }
}

function updateLightningParticles(now) {
  const TTL = 60;
  for (let i = lightningParticles.length - 1; i >= 0; i--) {
    const t = lightningParticles[i];
    if (now - t.born >= TTL) {
      trailLayer.removeChild(t.g);
      t.g.destroy();
      lightningParticles.splice(i, 1);
    }
  }
}

function updateFrenzyTrails(now) {
  const DURATION = 400;
  for (let i = frenzyTrails.length - 1; i >= 0; i--) {
    const t = frenzyTrails[i];
    const age = now - t.born;
    if (age >= DURATION) {
      trailLayer.removeChild(t.g);
      t.g.destroy();
      frenzyTrails.splice(i, 1);
    } else {
      const p = 1 - age / DURATION;
      t.g.alpha = p * 0.7;
      t.g.scale.set(0.3 + p * 0.7);
    }
  }
}

// ═══════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════
const FPS_CAP = 120;
const FRAME_MIN_MS = 1000 / FPS_CAP;
let lastFrameTime = 0;

function gameLoop() {
  const now = Date.now();
  if (now - lastFrameTime < FRAME_MIN_MS) return;
  lastFrameTime = now;
  if (!myId) return;
  if (now - 100000 > gameStartTime && !players[myId] && !dead) { triggerDeath(); return; }

  if (now - lastMoveSend >= 50 && ws && ws.readyState === WebSocket.OPEN) {
    let x = 0, y = 0;
    if (pressed['ArrowUp']    || pressed['w']) y--;
    if (pressed['ArrowDown']  || pressed['s']) y++;
    if (pressed['ArrowLeft']  || pressed['a']) x--;
    if (pressed['ArrowRight'] || pressed['d']) x++;
    if (x !== 0 && y !== 0) { x *= 0.707; y *= 0.707; }
    ws.send(JSON.stringify({ type: 'move', x, y, dir: direction }));
    lastMoveSend = now;
  }

  const pl = players[myId];
  if (!pl) return;

  for (const p of Object.values(players)) {
    const t = Math.min((now - p.lastUpdateTime) / SERVER_TICK, 1);
    p.renderX = lerp(p.last_x ?? p.x, p.x, t);
    p.renderY = lerp(p.last_y ?? p.y, p.y, t);
    if (p === players[myId]) {
      p.renderDir = direction;
    } else {
      p.renderDir = lerpAngle(p.last_dir ?? p.dir, p.dir, t);
    }
    p.renderHealth = lerp(p.renderHealth ?? p.health, p.health, 0.12);
    p.renderMana   = lerp(p.renderMana   ?? p.mana,   p.mana,   0.12);
    p.renderSkill1cd = lerp(p.renderSkill1cd ?? p.skill1cd, p.skill1cd, 0.25);
    p.renderSkill2cd = lerp(p.renderSkill2cd ?? p.skill2cd, p.skill2cd, 0.25);
    p.renderSkill3cd = lerp(p.renderSkill3cd ?? p.skill3cd, p.skill3cd, 0.25);
  }
  for (const p of Object.values(projectiles)) {
    const t = Math.min((now - p.lastUpdateTime) / SERVER_TICK, 1);
    p.renderX = lerp(p.last_x ?? p.x, p.x, t);
    p.renderY = lerp(p.last_y ?? p.y, p.y, t);
  }

  mapContainer.scale.set(zoom);
  mapContainer.x = app.screen.width  / 2 - pl.renderX * zoom;
  mapContainer.y = app.screen.height / 2 - pl.renderY * zoom;

  for (const [id, ob] of Object.entries(obstacles)) getOrCreateObstacle(id, ob);
  for (const [id, p]  of Object.entries(projectiles)) updateProjSprite(id, p, now);
  for (const id of Object.keys(projContainers))    { if (!projectiles[id]) removeProjSprite(id); }
  for (const [id, p]  of Object.entries(players))  updatePlayerSprite(id, p, now);
  for (const id of Object.keys(playerContainers))  { if (!players[id]) removePlayerSprite(id); }

  capturePointGraphic.clear();
  if (gamemode === 2 && capturePoint.radius) {
    capturePointGraphic.lineStyle(3, 0xffffff, 0.9);
    capturePointGraphic.beginFill(0xffffff, 0.1);
    capturePointGraphic.drawCircle(capturePoint.x, capturePoint.y, capturePoint.radius);
    capturePointGraphic.endFill();
  }

  updateDamageTexts();
  updateLightningParticles(now);
  updateFrenzyTrails(now);
  drawUI(now, pl);
}

// ═══════════════════════════════════════════════════
//  PLAYER SPRITES
// ═══════════════════════════════════════════════════

// Builds 8 offset shadow sprites behind the main sprite to fake an outline
function buildSpriteOutline(texture, scaleX, scaleY, rotation, outlineColor, thickness) {
  const container = new PIXI.Container();
  const offsets = [
    [-thickness,  0], [thickness,  0],
    [0, -thickness], [0,  thickness],
    [-thickness, -thickness], [ thickness, -thickness],
    [-thickness,  thickness], [ thickness,  thickness],
  ];
  for (const [ox, oy] of offsets) {
    const shadow = new PIXI.Sprite(texture);
    shadow.anchor.set(0.5, 0.5);
    shadow.scale.set(scaleX, scaleY);
    shadow.rotation = rotation;
    shadow.tint = outlineColor;
    shadow.x = ox;
    shadow.y = oy;
    container.addChild(shadow);
  }
  return container;
}

function buildPlayerContainer(c, gameClass) {
  const st = CLASS_STYLES[gameClass] || CLASS_STYLES.fire;

  // Aura — behind everything
  const aura = new PIXI.Graphics(); aura.name = 'aura'; c.addChild(aura);

  // Sword outline container (8 tinted shadows behind the real sprite)
  const swordOutline = buildSpriteOutline(
    texCache.sword,
    0.09, 0.11,
    -Math.PI / 2,
    0x000000,
    1.5
  );
  swordOutline.x = 30; swordOutline.y = -30;
  swordOutline.name = 'swordOutline';
  c.addChild(swordOutline);

  // Sword sprite — on top of outline
  const sword = new PIXI.Sprite(texCache.sword);
  sword.anchor.set(0.5, 0.5);
  sword.x = 30; sword.y = -30;
  sword.scale.set(0.09, 0.11);
  sword.rotation = -Math.PI / 2;
  sword.name = 'sword';
  c.addChild(sword);

  // Arm circles
  const arm1 = new PIXI.Graphics();
  arm1.lineStyle(3, 0x000000, 0.75);
  arm1.beginFill(st.arm, 1);
  arm1.drawCircle(18, -12, 7);
  arm1.endFill();
  arm1.name = 'arm1'; c.addChild(arm1);

  const arm2 = new PIXI.Graphics();
  arm2.lineStyle(3, 0x000000, 0.75);
  arm2.beginFill(st.arm, 1);
  arm2.drawCircle(18, 12, 7);
  arm2.endFill();
  arm2.name = 'arm2'; c.addChild(arm2);

  // Body circle
  const body = new PIXI.Graphics();
  body.lineStyle(3.5, 0x000000, 0.90);
  body.beginFill(st.body, 1);
  body.drawCircle(0, 0, 20);
  body.endFill();
  body.name = 'body'; c.addChild(body);

  // Crusader cross
  if (gameClass === 'crusader') {
    const cross = new PIXI.Graphics();
    cross.beginFill(0xcc0000, 1);
    cross.drawRect(-6, -9, 6, 18);   // vertical bar
    cross.drawRect(-12, -3, 24, 6);   // horizontal bar
    cross.endFill();
    cross.name = 'cross'; c.addChild(cross);
  }

  // Armor overlay
  const armor = new PIXI.Graphics(); armor.name = 'armor'; c.addChild(armor);

  // Earth shield rings — counter-rotated so rocks orbit in world space
  const earthShields = new PIXI.Container(); earthShields.name = 'earthShields'; c.addChild(earthShields);

  // Charge wings — shown when isCharging is true
  const wingGlow = new PIXI.Graphics(); wingGlow.name = 'wingGlow'; wingGlow.visible = false; c.addChild(wingGlow);
  const wingL = new PIXI.Sprite(texCache.crusadeWing); wingL.anchor.set(0.5); wingL.name = 'wingL'; wingL.visible = false; c.addChild(wingL);
  const wingR = new PIXI.Sprite(texCache.crusadeWing); wingR.anchor.set(0.5); wingR.name = 'wingR'; wingR.visible = false; c.addChild(wingR);

  // Name tag
  const nt = new PIXI.Text('', {
    fontSize: 16,
    fill: 0xffffff,
    fontWeight: '900',
    stroke: 0x000000,
    strokeThickness: 4,
  });
  nt.anchor.set(0.5); nt.y = -40; nt.name = 'nametag'; c.addChild(nt);
}

function updatePlayerSprite(id, p, now) {
  if (!playerContainers[id]) {
    const c = new PIXI.Container();
    buildPlayerContainer(c, p.gameClass);
    playerLayer.addChild(c);
    playerContainers[id] = c;
  }
  const c = playerContainers[id];

  c.x = p.renderX;
  c.y = p.renderY;

  if (p.isFrenzy && trailLayer) {
    const dot = new PIXI.Graphics();
    dot.beginFill(0x990011, 0.7); dot.drawCircle(0, 0, 14 + Math.random() * 6); dot.endFill();
    dot.x = p.renderX; dot.y = p.renderY;
    trailLayer.addChild(dot);
    frenzyTrails.push({ g: dot, born: Date.now() });
  }

  const facing = p.renderDir ?? p.dir;

  if (p.isHitting && (!p._swingStart || now - p._swingStart > 399)) {
    p._swingStart = now;
  }
  if (p._swingStart) {
    const elapsed = now - p._swingStart;
    if (elapsed < 200) {
      p._swingAngle = (elapsed / 200) * Math.PI * 0.9;
    } else if (elapsed < 400) {
      p._swingAngle = ((400 - elapsed) / 200) * Math.PI * 0.9;
    } else {
      p._swingAngle = 0;
      p._swingStart = null;
    }
  } else {
    p._swingAngle = 0;
  }

  c.rotation = facing + (p._swingAngle ?? 0);

  // ── STUN TINT ──
  const stunTint = p.isStunned ? 0xaaaacc : 0xffffff;
  const body = c.getChildByName('body');
  const arm1 = c.getChildByName('arm1');
  const arm2 = c.getChildByName('arm2');
  if (body) body.tint = stunTint;
  if (arm1) arm1.tint = stunTint;
  if (arm2) arm2.tint = stunTint;

  // ── AURA ──
  const aura = c.getChildByName('aura');
  if (aura) {
    aura.clear();
    if (p.heatLevel > 0) {
      const heat = p.heatLevel; // 1-3
      const baseAlpha = 0.12 + heat * 0.1;
      const ringAlpha = 0.25 + heat * 0.15;
      const flareAlpha = 0.55 + heat * 0.15;
      const outerR = 24 + heat * 4;
      const pulse = Math.sin(now / (120 - heat * 25));
      const flickerA = Math.sin(now / 60 + 1.3);
      const flickerB = Math.sin(now / 80 + 2.7);

      // Glow fill
      aura.beginFill(0xff4400, baseAlpha + 0.04 * pulse); aura.drawCircle(0, 0, outerR); aura.endFill();
      aura.beginFill(0xff6600, baseAlpha * 0.5); aura.drawCircle(0, 0, outerR * 0.6); aura.endFill();

      // Pulsing rings
      aura.lineStyle(1.5, 0xff3300, ringAlpha + 0.1 * pulse); aura.drawCircle(0, 0, outerR);
      if (heat >= 2) {
        aura.lineStyle(1, 0xff6600, (ringAlpha - 0.1) + 0.08 * pulse); aura.drawCircle(0, 0, outerR + 5 + heat);
      }

      // Rising flame licks
      const flareCount = 3 + heat * 2;
      for (let i = 0; i < flareCount; i++) {
        const baseAng = (i / flareCount) * Math.PI * 2 + now / (500 - heat * 80);
        const wobble = (i % 2 === 0 ? flickerA : flickerB) * 0.18;
        const ang = baseAng + wobble;
        const inner = outerR - 3;
        const flareLen = (6 + heat * 4) * (0.75 + 0.25 * (i % 2 === 0 ? flickerA : flickerB));
        const col = i % 2 === 0 ? 0xff4400 : 0xff8800;
        aura.lineStyle(1.5 + heat * 0.5, col, flareAlpha);
        aura.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
        aura.lineTo(Math.cos(ang) * (inner + flareLen), Math.sin(ang) * (inner + flareLen));
      }

      // Level 3: extra intense inner core blaze
      if (heat >= 3) {
        aura.beginFill(0xff2200, 0.18 + 0.08 * pulse); aura.drawCircle(0, 0, 18); aura.endFill();
        aura.lineStyle(2, 0xffaa00, 0.6 + 0.2 * pulse); aura.drawCircle(0, 0, outerR + 9);
      }
    }

    if (p.isFrenzy) {
      const r = 42 + Math.sin(now / 130) * 5;
      aura.lineStyle(2, 0xff0033, 0.6); aura.drawCircle(0, 0, r);
      aura.lineStyle(1, 0xff0033, 0.3); aura.drawCircle(0, 0, r + 7);
      aura.beginFill(0xff0033, 0.1); aura.drawCircle(0, 0, r); aura.endFill();
    } else if (p.isLightningSpeed) {
      if (trailLayer) {
        const sparkCount = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < sparkCount; i++) {
          const spark = new PIXI.Graphics();
          const col = Math.random() < 0.5 ? 0xffee22 : 0xffffff;
          spark.lineStyle(1.5, col, 0.8 + Math.random() * 0.2);
          const startAng = Math.random() * Math.PI * 2;
          const dist = 18 + Math.random() * 26;
          let sx = Math.cos(startAng) * dist;
          let sy = Math.sin(startAng) * dist;
          spark.moveTo(sx, sy);
          for (let j = 0; j < 3; j++) {
            const jitAng = startAng + (Math.random() - 0.5) * 1.2;
            const jitDist = 5 + Math.random() * 10;
            sx += Math.cos(jitAng) * jitDist;
            sy += Math.sin(jitAng) * jitDist;
            spark.lineTo(sx, sy);
          }
          spark.x = p.renderX;
          spark.y = p.renderY;
          trailLayer.addChild(spark);
          lightningParticles.push({ g: spark, born: now });
        }
      }
    }
  }

  // ── ARMOR ──
  const armor = c.getChildByName('armor');
  if (armor) {
    armor.clear();
    if (p.isInvincible) {
      const t2 = now / 600;
      armor.lineStyle(3, 0xaaaaaa, 0.7); armor.drawCircle(0, 0, 28);
      armor.lineStyle(2, 0x888888, 0.5); armor.drawCircle(0, 0, 33);
      for (let i = 0; i < 6; i++) {
        const ang = t2 + i * Math.PI / 3;
        armor.lineStyle(0); armor.beginFill(0xbbbbcc, 0.55);
        armor.moveTo(Math.cos(ang) * 22, Math.sin(ang) * 22);
        armor.lineTo(Math.cos(ang + 0.4) * 32, Math.sin(ang + 0.4) * 32);
        armor.lineTo(Math.cos(ang + 0.55) * 32, Math.sin(ang + 0.55) * 32);
        armor.lineTo(Math.cos(ang + 0.15) * 22, Math.sin(ang + 0.15) * 22);
        armor.closePath(); armor.endFill();
      }
    }
  }

  // ── EARTH SHIELDS ──
  const earthShieldCt = c.getChildByName('earthShields');
  if (earthShieldCt) {
    const numRings = Math.min(p.earthShields ?? 0, 3);
    const ROCKS_PER_RING = [5, 10, 15];
    const RING_RADII     = [28, 42, 56];
    const ROCK_PX        = 9; // sprite diameter in px (rock radius ~4.5 world units)
    const ROCK_SCALE     = ROCK_PX / 100; // texCache.rock is 100×100

    // Rebuild sprites only when the ring count changes
    if (earthShieldCt._numRings !== numRings) {
      earthShieldCt.removeChildren().forEach(ch => ch.destroy());
      for (let ring = 0; ring < numRings; ring++) {
        for (let i = 0; i < ROCKS_PER_RING[ring]; i++) {
          const s = new PIXI.Sprite(texCache.rock);
          s.anchor.set(0.5);
          s.scale.set(ROCK_SCALE);
          s._ring = ring;
          s._idx  = i;
          earthShieldCt.addChild(s);
        }
      }
      earthShieldCt._numRings = numRings;
    }

    // Counter-rotate container so rocks orbit in world space
    earthShieldCt.rotation = -c.rotation;

    // Position each rock along its orbit
    for (const s of earthShieldCt.children) {
      const ring  = s._ring;
      const dir   = ring % 2 === 0 ? 1 : -1;
      const speed = 0.001 - ring * 0.0001;
      const ang   = now * speed * dir + (s._idx / ROCKS_PER_RING[ring]) * Math.PI * 2;
      s.x = Math.cos(ang) * RING_RADII[ring];
      s.y = Math.sin(ang) * RING_RADII[ring];
      s.rotation = ang; // face outward (optional, gives slight variance)
    }
  }

  // ── CHARGING WINGS ──
  const pWingL = c.getChildByName('wingL');
  const pWingR = c.getChildByName('wingR');
  const pWingGlow = c.getChildByName('wingGlow');
  if (pWingL && pWingR) {
    const charging = !!p.isCharging;
    pWingL.visible = charging;
    pWingR.visible = charging;
    if (pWingGlow) pWingGlow.visible = charging;
    if (charging) {
      const wScale = 0.28;
      const spread = 60;
      // Container is already rotated to `facing`, so local +x = player forward, local ±y = sides
      pWingL.rotation = Math.PI;
      pWingL.scale.set(wScale, -wScale);
      pWingL.x = -10;
      pWingL.y = -spread;
      pWingR.rotation = Math.PI;
      pWingR.scale.set(wScale, wScale);
      pWingR.x = -10;
      pWingR.y = spread;
      if (pWingGlow) {
        pWingGlow.clear();
        const pulse = 0.08 + 0.04 * Math.sin(now / 200);
        pWingGlow.beginFill(0xffd700, pulse * 0.5); pWingGlow.drawCircle(0, 0, spread * 1.1); pWingGlow.endFill();
        pWingGlow.beginFill(0xffe566, pulse); pWingGlow.drawCircle(0, 0, spread * 0.55); pWingGlow.endFill();
      }
    }
  }

  // ── SWORD + OUTLINE texture swap ──
  const sword = c.getChildByName('sword');
  const swordOutline = c.getChildByName('swordOutline');
  if (sword) {
    const newTex = p.basicEnhanced ? texCache.enhancedSword : texCache.sword;
    sword.texture = newTex;
    if (swordOutline) {
      for (const child of swordOutline.children) child.texture = newTex;
    }
  }

  if (id === myId) killcount = p.killcount ?? 0;
}

function removePlayerSprite(id) {
  if (playerContainers[id]) {
    playerContainers[id].destroy({ children: true });
    playerLayer.removeChild(playerContainers[id]);
    delete playerContainers[id];
  }
  removePlayerUI(id);
}

// ═══════════════════════════════════════════════════
//  PROJECTILE SPRITES
// ═══════════════════════════════════════════════════
function getOrCreateProj(id, type, radius) {
  if (projContainers[id]) return projContainers[id];
  const c = buildProjContainer(type, radius);
  const p = projectiles[id];
  if (p && p.renderX != null) {
    c.x = p.renderX;
    c.y = p.renderY;
  }
  projLayer.addChild(c);
  projContainers[id] = c;
  return c;
}

function buildProjContainer(type, radius) {
  const r = Math.max(5, radius||10);
  const proj = new PIXI.Container();
  switch(type) {
    case 'fireball': case 'chonkyfireball': {
      const base = r;
      const core = new PIXI.Graphics(); core.name='core';
      core.beginFill(0x881100,0.18); core.drawCircle(0,0,base*1.8); core.endFill();
      core.beginFill(0xcc2200,0.32); core.drawCircle(0,0,base*1.3); core.endFill();
      core.beginFill(0xff4400,1);    core.drawCircle(0,0,base);     core.endFill();
      core.beginFill(0xffcc44,0.9);  core.drawCircle(0,0,base*0.45); core.endFill();
      for(let i=0;i<5;i++){const w=new PIXI.Graphics();w.name=`wisp${i}`;proj.addChild(w);}
      proj.addChild(core);
      break;
    }
    case 'clusterfireball': {
      const base = r;
      const core = new PIXI.Graphics(); core.name='core';
      core.beginFill(0x881100,0.18); core.drawCircle(0,0,base*1.8); core.endFill();
      core.beginFill(0xcc2200,0.32); core.drawCircle(0,0,base*1.3); core.endFill();
      core.beginFill(0xff4400,1);    core.drawCircle(0,0,base);     core.endFill();
      core.beginFill(0xffcc44,0.9);  core.drawCircle(0,0,base*0.45); core.endFill();
      proj.addChild(core);
      break;
    }
    case 'blackhole': {
      const baseScale = (r * 2) / 512;

      const center = new PIXI.Graphics();
      center.beginFill(0x000000, 0.85);
      center.drawCircle(0, 0, r * 0.6);
      center.endFill();
      center.name = 'bhCenter';

      const outer = new PIXI.Sprite(texCache.voidOuter);
      outer.anchor.set(0.5); outer.scale.set(baseScale); outer.name = 'voidOuter';
      const middle = new PIXI.Sprite(texCache.voidMiddle);
      middle.anchor.set(0.5); middle.scale.set(baseScale * 1); middle.name = 'voidMiddle';
      const inner = new PIXI.Sprite(texCache.voidInner);
      inner.anchor.set(0.5); inner.scale.set(baseScale * 0.5); inner.name = 'voidInner';
          proj.addChild(center, outer, middle, inner);
      for (let i = 0; i < 5; i++) {
        const dot = new PIXI.Graphics();
        dot.name = `bhDot${i}`;
        dot.beginFill(i % 2 === 0 ? 0x9955cc : 0x1a0a2a, 0.9);
        dot.drawCircle(0, 0, 20 + Math.random() * 4);
        dot.endFill();
        proj.addChild(dot);
      }

      proj._bhParticles = Array.from({ length: 5 }, (_, i) => ({
      angle: (i / 5) * Math.PI * 2,
      radius: r * (1.1 + Math.random() * 0.2),
      speed: 0.02 + Math.random() * 0.02,
      inSpeed: 2.5 + Math.random() * 1.5,
    }));
      break;
    }
    case 'voidpull': {
      // Accretion disk A — wide horizontal
      const diskA = new PIXI.Graphics();
      diskA.name = 'vpDiskA';
      diskA.beginFill(0x7020c0, 0.55);
      diskA.drawEllipse(0, 0, r * 1.9, r * 0.45);
      diskA.endFill();
      diskA.beginFill(0xaa55ff, 0.25);
      diskA.drawEllipse(0, 0, r * 1.55, r * 0.28);
      diskA.endFill();

      // Accretion disk B — tilted at ~60 deg
      const diskB = new PIXI.Graphics();
      diskB.name = 'vpDiskB';
      diskB.beginFill(0x3a10a0, 0.5);
      diskB.drawEllipse(0, 0, r * 1.7, r * 0.38);
      diskB.endFill();
      diskB.beginFill(0x8833ee, 0.2);
      diskB.drawEllipse(0, 0, r * 1.35, r * 0.22);
      diskB.endFill();
      diskB.rotation = Math.PI / 3;

      // Black hole core
      const core = new PIXI.Graphics();
      core.name = 'vpCore';
      // soft purple glow halo
      core.beginFill(0x220044, 0.45);
      core.drawCircle(0, 0, r * 1.05);
      core.endFill();
      // true black center
      core.beginFill(0x000000, 1);
      core.drawCircle(0, 0, r * 0.72);
      core.endFill();

      proj.addChild(diskA, diskB, core);
      break;
    }
    case 'crusadepull': {
      const ring = new PIXI.Graphics();
      ring.name = 'cpRing';
      proj.addChild(ring);

      for (let i = 0; i < 18; i++) {
        const dot = new PIXI.Graphics();
        const isYellow = i % 3 === 0;
        dot.beginFill(isYellow ? 0xffd700 : 0xffffff, 0.9);
        dot.drawCircle(0, 0, 2.5 + Math.random() * 2);
        dot.endFill();
        dot.name = `cpDot${i}`;
        proj.addChild(dot);
      }

      proj._cpParticles = Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
        return {
          angle,
          dist: 0.85 + Math.random() * 0.15,
          speed: 0.018 + Math.random() * 0.012,
        };
      });
      break;
    }
    case 'crusadecharge': {
      const chargeTrail = new PIXI.Graphics();
      chargeTrail.name = 'chargeTrail';
      proj.addChild(chargeTrail);
      proj._trailHistory = [];
      break;
    }
    case 'voidorb': {
      const trail = new PIXI.Graphics();
      trail.name = 'voidOrbTrail';

      const body = new PIXI.Graphics();
      body.beginFill(0x000000, 0.95);
      body.drawCircle(0, 0, r);
      body.endFill();
      body.name = 'voidOrbBody';

      proj.addChild(trail, body);
      proj._orbHistory = [];
      break;
    }
    case 'icicle': {
      const ic=new PIXI.Graphics();
      ic.beginFill(0xeeffff,0.95);
      ic.moveTo(0,-r*1.8);ic.lineTo(r*0.4,0);ic.lineTo(0,r*0.8);ic.lineTo(-r*0.4,0);ic.closePath();ic.endFill();
      ic.beginFill(0xffffff,0.5);
      ic.moveTo(0,-r*1.8);ic.lineTo(r*0.2,-r*0.3);ic.lineTo(0,r*0.8);ic.closePath();ic.endFill();
      ic.beginFill(0x88ddff,0.2);ic.drawCircle(0,0,r*1.5);ic.endFill();
      proj.addChild(ic); break;
    }
    case 'iceblade': {
      const aura2=new PIXI.Graphics();
      aura2.beginFill(0x44aaff,0.3);aura2.drawCircle(0,0,r);aura2.endFill();
      const ring=new PIXI.Graphics();
      ring.lineStyle(1.5,0x88ddff,0.3);ring.drawCircle(0,0,r);
      const blade=new PIXI.Sprite(texCache.iceSword);
      blade.anchor.set(0.5);blade.width=r*3.8;blade.height=r*3.8;
      proj.addChild(aura2,ring,blade); break;
    }
    case 'snowstorm': {
      const bg2=new PIXI.Graphics();
      bg2.beginFill(0xddeeff,0.4);bg2.drawCircle(0,0,r);bg2.endFill();
      bg2.lineStyle(2,0xeef8ff,0.65);bg2.drawCircle(0,0,r);
      proj.addChild(bg2);
      for(let i=0;i<50;i++){
        const d=new PIXI.Graphics();d.beginFill(0xffffff,1.0);d.drawCircle(0,0,i%3===0?3.5:2);d.endFill();
        const spawnAng=Math.random()*Math.PI*2, spawnR=Math.random()*r*0.85;
        d.x=Math.cos(spawnAng)*spawnR; d.y=Math.sin(spawnAng)*spawnR;
        const velAng=Math.random()*Math.PI*2, speed=3+Math.random()*4;
        d._vx=Math.cos(velAng)*speed; d._vy=Math.sin(velAng)*speed;
        d.name=`dot${i}`;proj.addChild(d);
      }
      break;
    }
    case 'bloodblade': {
      for (let i = 0; i < 20; i++) {
        const d = new PIXI.Graphics();
        const pr = i % 4 === 0 ? 4 : 2.5;
        d.beginFill(i % 3 === 0 ? 0xff0033 : 0xcc1122, 1); d.drawCircle(0, 0, pr); d.endFill();
        const spawnAng = Math.random() * Math.PI * 2, spawnR = Math.random() * r * 0.8;
        d.x = Math.cos(spawnAng) * spawnR; d.y = Math.sin(spawnAng) * spawnR;
        const velAng = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 3;
        d._vx = Math.cos(velAng) * speed; d._vy = Math.sin(velAng) * speed;
        d.name = `bdot${i}`; proj.addChild(d);
      }
      break;
    }
    case 'afterimage': {
      const st = CLASS_STYLES.blood;
      const sword = new PIXI.Sprite(texCache.sword);
      sword.anchor.set(0.5); sword.x = 30; sword.y = -30;
      sword.scale.set(0.09, 0.11); sword.rotation = -Math.PI / 2;
      sword.tint = st.bodyHi; proj.addChild(sword);
      const arm1 = new PIXI.Graphics();
      arm1.beginFill(st.arm, 1); arm1.drawCircle(18, -12, 7); arm1.endFill();
      proj.addChild(arm1);
      const arm2 = new PIXI.Graphics();
      arm2.beginFill(st.arm, 1); arm2.drawCircle(18, 12, 7); arm2.endFill();
      proj.addChild(arm2);
      const body = new PIXI.Graphics();
      body.lineStyle(3.5, st.outline, 0.9);
      body.beginFill(st.body, 1); body.drawCircle(0, 0, 20); body.endFill();
      proj.addChild(body);
      proj._born = Date.now();
      break;
    }
    case 'shockwave': {
      const crackPaths = [];
      for (let i = 0; i < 6; i++) {
        const baseAng = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
        const pts = [{x:0,y:0}];
        let ang = baseAng, d = 0.08 + Math.random() * 0.12;
        for (let j = 0; j < 3 + Math.floor(Math.random() * 2); j++) {
          ang += (Math.random() - 0.5) * 0.7;
          d = Math.min(d + 0.18 + Math.random() * 0.14, 1.0);
          pts.push({x: Math.cos(ang) * d, y: Math.sin(ang) * d});
        }
        crackPaths.push(pts);
        if (pts.length >= 2) {
          const mid = pts[1];
          const bPts = [mid];
          let ba = ang + (Math.random() > 0.5 ? 0.6 : -0.6);
          let bd = Math.hypot(mid.x, mid.y);
          for (let j = 0; j < 2; j++) {
            ba += (Math.random() - 0.5) * 0.5;
            bd = Math.min(bd + 0.14 + Math.random() * 0.1, 0.92);
            bPts.push({x: Math.cos(ba) * bd, y: Math.sin(ba) * bd});
          }
          crackPaths.push(bPts);
        }
      }
      const body = new PIXI.Graphics(); body.name = 'body';
      proj._crackPaths = crackPaths;
      proj.addChild(body); break;
    }
    case 'lightningball': {
      for(let i=0;i<4;i++){const arc=new PIXI.Graphics();arc.name=`arc${i}`;proj.addChild(arc);}
      const core=new PIXI.Graphics();core.name='core';proj.addChild(core); break;
    }
    case 'lightningbolt': {
      const glow=new PIXI.Graphics();glow.name='glow';proj.addChild(glow);
      for(let i=0;i<3;i++){const a=new PIXI.Graphics();a.name=`arc${i}`;proj.addChild(a);}
      const core=new PIXI.Graphics();core.name='core';proj.addChild(core);
      const bright=new PIXI.Graphics();bright.name='bright';proj.addChild(bright);
      break;
    }
    case 'lightningspark': {
      const sp=new PIXI.Graphics();
      sp.beginFill(0xffee88,0.25);sp.drawCircle(0,0,r*0.9);sp.endFill();
      sp.beginFill(0xffffff,0.95);sp.drawCircle(0,0,r*0.35);sp.endFill();
      proj.addChild(sp); break;
    }
    default: {
      const def=new PIXI.Graphics();def.beginFill(0x8888ff,0.6);def.drawCircle(0,0,r);def.endFill();proj.addChild(def);
    }
  }
  //const def=new PIXI.Graphics();def.beginFill(0x8888ff,0.7);def.drawCircle(0,0,r);def.endFill();proj.addChild(def);
  return proj;
}

function updateProjSprite(id, p, now) {
  const c = getOrCreateProj(id, p.type, p.radius);
  if (p.type !== 'crusadecharge') {
  c.x = p.renderX;
  c.y = p.renderY;
}
  const r = Math.max(5, p.radius || 10);

  switch (p.type) {
    case 'fireball':
    case 'chonkyfireball': {
      const base = r;
      const dir = p.dir || 0;

      for (let i = 0; i < 5; i++) {
        const w = c.getChildByName(`wisp${i}`);
        if (!w) continue;
        w.clear();

        const pct = i / 4;
        const trailDist = (1 - pct) * base * 3.5;
        const tx = -Math.cos(dir) * trailDist;
        const ty = -Math.sin(dir) * trailDist;

        const wobble = Math.sin(now / 55 + i * 1.2) * base * 0.45;
        const perpX = -Math.sin(dir) * wobble;
        const perpY =  Math.cos(dir) * wobble;

        const alpha = 0.28 + pct * 0.48;
        const wr = base * (0.3 + pct * 0.6);
        const colors = [0x881100, 0xcc2200, 0xff4400, 0xff8800, 0xffcc44];
        w.beginFill(colors[i], alpha);
        w.drawCircle(tx + perpX, ty + perpY, wr);
        w.endFill();
      }
      break;
    }
    case 'clusterfireball': {
      if (trailLayer) {
        const particleColors = [0xff4400, 0xff8800, 0xffcc44, 0xcc2200, 0xff2200];
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * r * 1.4;
          const dot = new PIXI.Graphics();
          const col = particleColors[Math.floor(Math.random() * particleColors.length)];
          const pr = 2 + Math.random() * r * 0.5;
          dot.beginFill(col, 0.7 + Math.random() * 0.3); dot.drawCircle(0, 0, pr); dot.endFill();
          dot.x = p.renderX + Math.cos(angle) * dist;
          dot.y = p.renderY + Math.sin(angle) * dist;
          trailLayer.addChild(dot);
          frenzyTrails.push({ g: dot, born: now });
        }
      }
      break;
    }
    case 'voidorb': {
  if (!c._orbHistory) c._orbHistory = [];
  c._orbHistory.push({ x: p.renderX, y: p.renderY });
  if (c._orbHistory.length > 14) c._orbHistory.shift();

  const trail = c.getChildByName('voidOrbTrail');
  if (trail && c._orbHistory.length > 1) {
    trail.clear();
    const len = c._orbHistory.length;
    for (let i = 0; i < len - 1; i++) {
      const pct = i / len;
      const alpha = pct * 0.55;
      const size = r * (0.3 + pct * 0.6);
      const tx = c._orbHistory[i].x - p.renderX;
      const ty = c._orbHistory[i].y - p.renderY;
      trail.beginFill(0x2a0a3a, alpha);
      trail.drawCircle(tx, ty, size);
      trail.endFill();
    }
  }
  break;
}
case 'crusadepull': {
  const ring = c.getChildByName('cpRing');
  if (ring) {
    ring.clear();
    ring.lineStyle(2.5, 0xffffff, 0.35);
    ring.drawCircle(0, 0, r);
    ring.lineStyle(1, 0xffd700, 0.15);
    ring.drawCircle(0, 0, r - 4);
  }

  if (c._cpParticles) {
    for (let i = 0; i < c._cpParticles.length; i++) {
      const pd = c._cpParticles[i];
      const dot = c.getChildByName(`cpDot${i}`);
      if (!dot) continue;
      pd.dist -= pd.speed;
      if (pd.dist <= 0.04) {
        pd.dist = 0.8 + Math.random() * 0.2;
        pd.angle = Math.random() * Math.PI * 2;
        pd.speed = 0.018 + Math.random() * 0.012;
      }
      dot.x = Math.cos(pd.angle) * pd.dist * r;
      dot.y = Math.sin(pd.angle) * pd.dist * r;
      const pct = pd.dist;
      dot.alpha = 0.3 + pct * 0.7;
      dot.scale.set(0.4 + pct * 0.6);
    }
  }
  break;
}case 'crusadecharge': {
  c.x = lerp(c.x, p.renderX, 0.35);
  c.y = lerp(c.y, p.renderY, 0.35);

  const chargeTrail = c.getChildByName('chargeTrail');
  if (chargeTrail && c._trailHistory != null) {
    const jitter = 18;
    c._trailHistory.push({
      x: p.renderX + (Math.random() - 0.5) * jitter,
      y: p.renderY + (Math.random() - 0.5) * jitter,
      r: 6 + Math.random() * 10,
    });
    if (c._trailHistory.length > 25) c._trailHistory.shift();
    chargeTrail.clear();
    for (let i = 0; i < c._trailHistory.length; i++) {
      const pt = c._trailHistory[i];
      const pct = i / c._trailHistory.length;
      chargeTrail.beginFill(0xffd700, pct * 0.6);
      chargeTrail.drawCircle(pt.x - p.renderX, pt.y - p.renderY, pt.r * pct);
      chargeTrail.endFill();
      chargeTrail.beginFill(0xffffff, pct * 0.4);
      chargeTrail.drawCircle(pt.x - p.renderX, pt.y - p.renderY, pt.r * pct * 0.45);
      chargeTrail.endFill();
    }
  }
  break;
}
    case 'blackhole': {
  const outer  = c.getChildByName('voidOuter');
  const middle = c.getChildByName('voidMiddle');
  const inner  = c.getChildByName('voidInner');
  if (outer)  outer.rotation  -= 0.008;
  if (middle) middle.rotation += 0.014;
  if (inner)  inner.rotation  -= 0.022;

  if (c._bhParticles) {
    for (let i = 0; i < c._bhParticles.length; i++) {
      const pd = c._bhParticles[i];
      const dot = c.getChildByName(`bhDot${i}`);
      if (!dot) continue;

      pd.angle += pd.speed;
      pd.radius -= pd.inSpeed;

      if (pd.radius < r * 0.1) {
  pd.radius = r * (1.1 + Math.random() * 0.2);
  pd.angle = Math.random() * Math.PI * 2;
  pd.speed = 0.02 + Math.random() * 0.02;
  pd.inSpeed = 2.5 + Math.random() * 1.5;
}

      dot.x = Math.cos(pd.angle) * pd.radius;
      dot.y = Math.sin(pd.angle) * pd.radius;
      const pct = pd.radius / (r * 1.4);
      dot.alpha = pct;
      dot.scale.set(0.3 + pct * 0.7);
    }
  }
  break;
}
case 'voidpull': {
  const diskA = c.getChildByName('vpDiskA');
  const diskB = c.getChildByName('vpDiskB');
  if (diskA) diskA.rotation -= 0.04;
  if (diskB) diskB.rotation += 0.065;
  break;
}
    case 'icicle':
      c.rotation = p.dir + Math.PI / 2;
      break;
    case 'iceblade':
      p._spin = (p._spin || 0) + 0.15;
      c.rotation = p._spin;
      break;
    case 'bloodblade': {
      for (let i = 0; i < 20; i++) {
        const d = c.getChildByName(`bdot${i}`);
        if (!d) continue;
        d.x += d._vx; d.y += d._vy;
        if (Math.hypot(d.x, d.y) > r * 0.9) { d.x = -d.x * 0.9; d.y = -d.y * 0.9; }
        if (trailLayer && Math.random() < 0.4) {
          const dot = new PIXI.Graphics();
          dot.beginFill(0x990011, 0.6); dot.drawCircle(0, 0, 3 + Math.random() * 3); dot.endFill();
          dot.x = p.renderX + d.x; dot.y = p.renderY + d.y;
          trailLayer.addChild(dot);
          frenzyTrails.push({ g: dot, born: now });
        }
      }
      break;
    }
    case 'afterimage': {
      const age = now - (c._born || now);
      c.alpha = Math.max(0, 1 - age / 500);
      c.rotation = p.dir;
      break;
    }
    case 'snowstorm': {
      for (let i = 0; i < 50; i++) {
        const d = c.getChildByName(`dot${i}`);
        if (!d) continue;
        d.x += d._vx; d.y += d._vy;
        if (Math.hypot(d.x, d.y) > r) {
          d.x = -d.x; d.y = -d.y;
        }
      }
      break;
    }
    case 'shockwave': {
      const body = c.getChildByName('body');
      if (!body || !c._crackPaths) break;
      body.clear();
      const glow = 0.1 + 0.07 * Math.sin(now / 150);
      body.beginFill(0x5c3d1e, 0.2);
      body.drawCircle(0, 0, r);
      body.endFill();
      body.lineStyle(4, 0x6B4524, glow);
      for (const path of c._crackPaths) {
        body.moveTo(path[0].x * r, path[0].y * r);
        for (let k = 1; k < path.length; k++) body.lineTo(path[k].x * r, path[k].y * r);
      }
      body.lineStyle(1.5, 0x1a0800, 0.3);
      for (const path of c._crackPaths) {
        body.moveTo(path[0].x * r, path[0].y * r);
        for (let k = 1; k < path.length; k++) body.lineTo(path[k].x * r, path[k].y * r);
      }
      body.lineStyle(2, 0x6a4010, 0.3);
      body.drawCircle(0, 0, r);
      break;
    }
    case 'lightningball': {
      const core = c.getChildByName('core');
      if (core) {
        core.clear();
        const pulse = 0.85 + 0.15 * Math.sin(now / 80);
        core.beginFill(0x8888ff, 0.2 * pulse); core.drawCircle(0, 0, r * 2.2 * pulse); core.endFill();
        core.beginFill(0xaaaaff, 0.5 * pulse); core.drawCircle(0, 0, r * 1.3 * pulse); core.endFill();
        core.beginFill(0xffffff, 0.95);         core.drawCircle(0, 0, r * 0.5);          core.endFill();
      }
      for (let i = 0; i < 4; i++) {
        const arc = c.getChildByName(`arc${i}`);
        if (!arc) continue;
        arc.clear();
        arc.lineStyle(1.5, 0xddddff, 0.7);
        const sa = now / 100 + i * Math.PI / 2;
        let x1 = 0, y1 = 0;
        for (let j = 1; j <= 4; j++) {
          const jit = Math.sin(now / 30 + i * 7 + j * 3) * 0.5 * r;
          const x2  = Math.cos(sa + j * 0.4) * r * j * 0.4 + jit;
          const y2  = Math.sin(sa + j * 0.4) * r * j * 0.4 + jit;
          arc.moveTo(x1, y1); arc.lineTo(x2, y2);
          x1 = x2; y1 = y2;
        }
      }
      break;
    }
    case 'lightningbolt': {
      c.rotation = p.dir;
      const len = r * 19, SEGS = 24;
      const pulse = 0.9 + 0.1 * Math.sin(now / 120);

      // Outer glow — two layered tapered auras; tip at x=0, tail at x=-len
      const glow = c.getChildByName('glow');
      if (glow) {
        glow.clear();
        for (const [col, alpha, wMul] of [[0xffee22, 0.13, 1.4], [0xffff88, 0.20, 0.7]]) {
          const mw = r * wMul * pulse;
          glow.beginFill(col, alpha);
          glow.moveTo(-len, 0);
          for (let i = 0; i <= SEGS; i++) { const t=i/SEGS; glow.lineTo((t-1)*len, -mw*Math.sin(t*Math.PI)); }
          for (let i = SEGS; i >= 0; i--) { const t=i/SEGS; glow.lineTo((t-1)*len,  mw*Math.sin(t*Math.PI)); }
          glow.closePath(); glow.endFill();
        }
      }

      // Electric arcs — zigzag lines that animate and taper with the bolt
      for (let ai = 0; ai < 3; ai++) {
        const arc = c.getChildByName(`arc${ai}`);
        if (!arc) continue;
        arc.clear();
        const spread = r * (1.4 - ai * 0.25);
        const spd    = 1 + ai * 0.55;
        arc.lineStyle(3.0 - ai * 0.6, ai === 0 ? 0xffffff : 0xffee88, 1.0 - ai * 0.1);
        arc.moveTo(-len, 0);
        const ARC_SEGS = 16;
        for (let j = 1; j <= ARC_SEGS; j++) {
          const t   = j / ARC_SEGS;
          const x   = (t - 1) * len;
          const env = Math.sin(t * Math.PI);
          const side = (j % 2) * 2 - 1;
          const amp  = 0.3 + 0.2 * Math.abs(Math.sin(now / 50 * spd + ai * 2.3 + j * 1.7));
          arc.lineTo(x, side * spread * env * amp);
        }
      }

      // Core — tapered yellow-white filled shape
      const core = c.getChildByName('core');
      if (core) {
        core.clear();
        const mw = r * 0.38;
        core.beginFill(0xffee44, 0.88);
        core.moveTo(-len, 0);
        for (let i = 0; i <= SEGS; i++) { const t=i/SEGS; core.lineTo((t-1)*len, -mw*Math.sin(t*Math.PI)); }
        for (let i = SEGS; i >= 0; i--) { const t=i/SEGS; core.lineTo((t-1)*len,  mw*Math.sin(t*Math.PI)); }
        core.closePath(); core.endFill();
      }

      // Bright spine — pure white ultra-thin tapering center
      const bright = c.getChildByName('bright');
      if (bright) {
        bright.clear();
        const mw = r * 0.12;
        bright.beginFill(0xffffff, 1.0);
        bright.moveTo(-len, 0);
        for (let i = 0; i <= SEGS; i++) { const t=i/SEGS; bright.lineTo((t-1)*len, -mw*Math.sin(t*Math.PI)); }
        for (let i = SEGS; i >= 0; i--) { const t=i/SEGS; bright.lineTo((t-1)*len,  mw*Math.sin(t*Math.PI)); }
        bright.closePath(); bright.endFill();
      }
      break;
    }
    case 'lightningspark':
      c.rotation = now / 100;
      break;
  }
}

function removeProjSprite(id) {
  if (projContainers[id]) {
    projContainers[id].destroy({ children: true });
    projLayer.removeChild(projContainers[id]);
    delete projContainers[id];
  }
}

// ═══════════════════════════════════════════════════
//  OBSTACLE SPRITES
// ═══════════════════════════════════════════════════
function getOrCreateObstacle(id, ob) {
  if (obstacleSprites[id]) return;
  const s = new PIXI.Sprite(texCache.rock);
  s.anchor.set(0.5); s.width=ob.radius*(100/42); s.height=ob.radius*(100/42);
  s.x=ob.x; s.y=ob.y;
  obstacleLayer.addChild(s);
  obstacleSprites[id]=s;
}

// ═══════════════════════════════════════════════════
//  UI  ── skill bars + mana bar upgraded
// ═══════════════════════════════════════════════════
let _ui = null;

function initUI() {
  const W = app.screen.width, H = app.screen.height;

  // ── Skill bars: slightly taller, cleaner track, key badge above ──
  const sbW = 84, sbH = 16, sbGap = 26, totalW = sbW * 3 + sbGap * 2;
  const startX = W / 2 - totalW / 2, barY = H - 42;

  const lbW = 200, lbX = W - lbW - 10, lbY = 10;
  const mmSize = 180, mmX = 10, mmY = H - mmSize - 10;

  // Key badges (Q / E / F) — small dark pill above each bar
  const skillBadges = [0, 1, 2].map(i => {
    const badge = new PIXI.Graphics();
    badge.lineStyle(1.5, 0x000000, 0.7);
    badge.beginFill(0x111111, 0.88);
    badge.drawRoundedRect(startX + i * (sbW + sbGap) + sbW / 2 - 11, barY - 26, 22, 20, 5);
    badge.endFill();
    uiContainer.addChild(badge);
    return badge;
  });

  const skillLabels = ['Q', 'E', 'F'].map((key, i) => {
    const t = new PIXI.Text(key, { fontSize: 12, fill: 0xcccccc, fontWeight: '700' });
    t.anchor.set(0.5);
    t.x = startX + sbW / 2 + i * (sbW + sbGap);
    t.y = barY - 16;
    uiContainer.addChild(t);
    return t;
  });

  // Bar tracks — dark bg with thin border
  const skillBgs = [0, 1, 2].map(i => {
    const bg = new PIXI.Graphics();
    bg.lineStyle(1.5, 0x000000, 0.9);
    bg.beginFill(0x0d0d0d, 0.82);
    bg.drawRoundedRect(startX + i * (sbW + sbGap), barY, sbW, sbH, 7);
    bg.endFill();
    uiContainer.addChild(bg);
    return bg;
  });

  const skillFills = [0, 1, 2].map(() => {
    const f = new PIXI.Graphics();
    uiContainer.addChild(f);
    return f;
  });

  const skillOutlines = [];

  const miniMap = new PIXI.Graphics();
  miniMap.beginFill(0x324e2a, 0.5);
  miniMap.drawRect(mmX + 1, mmY + 1, mmSize - 2, mmSize - 2);
  miniMap.endFill();
  uiContainer.addChild(miniMap);

  const mmCpDiamond = new PIXI.Graphics();
  uiContainer.addChild(mmCpDiamond);

  const statTextStyle = { fontSize: 14, fill: 0xffffff, fontWeight: '700', dropShadow: true, dropShadowDistance: 1, dropShadowAlpha: 0.8 };
  const mmStatX = mmX + mmSize + 10;
  const hpStatText = new PIXI.Text('', statTextStyle);
  hpStatText.x = mmStatX;
  hpStatText.y = mmY + mmSize - 38;
  uiContainer.addChild(hpStatText);

  const manaStatText = new PIXI.Text('', { ...statTextStyle, fill: 0x66aaff });
  manaStatText.x = mmStatX;
  manaStatText.y = mmY + mmSize - 18;
  uiContainer.addChild(manaStatText);

  const lbBg = new PIXI.Graphics();
  uiContainer.addChild(lbBg);

  const lbTitle = new PIXI.Text('☠  LEADERBOARD', { fontSize: 12, fill: 0x99aa99, fontWeight: '700' });
  lbTitle.x = lbX + 10;
  lbTitle.y = lbY + 8;
  uiContainer.addChild(lbTitle);

  const lbRows = Array.from({ length: 10 }, (_, i) => {
    const row = new PIXI.Text('', { fontSize: 13, fill: 0xddeedd });
    row.x = lbX + 10;
    row.y = lbY + 28 + i * 26;
    row.visible = false;
    uiContainer.addChild(row);
    const kills = new PIXI.Text('', { fontSize: 13, fill: 0xffcc44, fontWeight: 'bold' });
    kills.anchor.set(1, 0);
    kills.x = lbX + lbW - 10;
    kills.y = lbY + 28 + i * 26;
    kills.visible = false;
    uiContainer.addChild(kills);
    return { row, kills };
  });

  const cpBarW = 300, cpBarH = 22, cpBarX = W / 2 - 150, cpBarY = 14;
  const cpBg = new PIXI.Graphics();
  uiContainer.addChild(cpBg);
  const cpFill = new PIXI.Graphics();
  uiContainer.addChild(cpFill);
  const cpText = new PIXI.Text('', { fontSize: 13, fill: 0xffffff, fontWeight: '700' });
  cpText.anchor.set(0.5, 0.5);
  cpText.x = W / 2;
  cpText.y = cpBarY + cpBarH / 2;
  uiContainer.addChild(cpText);

  const tdmScore0 = new PIXI.Text('', { fontSize: 22, fill: 0x4488ff, fontWeight: '700', dropShadow: true, dropShadowDistance: 2, dropShadowAlpha: 0.7 });
  tdmScore0.anchor.set(1, 0);
  tdmScore0.y = 10;
  tdmScore0.visible = false;
  uiContainer.addChild(tdmScore0);
  const tdmSep = new PIXI.Text('  -  ', { fontSize: 22, fill: 0xffffff, fontWeight: '700', dropShadow: true, dropShadowDistance: 2, dropShadowAlpha: 0.7 });
  tdmSep.anchor.set(0.5, 0);
  tdmSep.x = W / 2;
  tdmSep.y = 10;
  tdmSep.visible = false;
  uiContainer.addChild(tdmSep);
  const tdmScore1 = new PIXI.Text('', { fontSize: 22, fill: 0xff3333, fontWeight: '700', dropShadow: true, dropShadowDistance: 2, dropShadowAlpha: 0.7 });
  tdmScore1.anchor.set(0, 0);
  tdmScore1.y = 10;
  tdmScore1.visible = false;
  uiContainer.addChild(tdmScore1);

  const cpScore0 = new PIXI.Text('', { fontSize: 18, fill: 0x4488ff, fontWeight: '700', dropShadow: true, dropShadowDistance: 2, dropShadowAlpha: 0.7 });
  cpScore0.anchor.set(1, 0.5);
  cpScore0.x = cpBarX - 10;
  cpScore0.y = cpBarY + cpBarH / 2;
  cpScore0.visible = false;
  uiContainer.addChild(cpScore0);

  const cpScore1 = new PIXI.Text('', { fontSize: 18, fill: 0xff3333, fontWeight: '700', dropShadow: true, dropShadowDistance: 2, dropShadowAlpha: 0.7 });
  cpScore1.anchor.set(0, 0.5);
  cpScore1.x = cpBarX + cpBarW + 10;
  cpScore1.y = cpBarY + cpBarH / 2;
  cpScore1.visible = false;
  uiContainer.addChild(cpScore1);

  _ui = { skillLabels, skillBadges, skillBgs, skillFills, skillOutlines,
    miniMap, lbBg, lbTitle, lbRows,
    sbW, sbH, sbGap, startX, barY, lbW, lbX, lbY, mmSize, mmX, mmY,
    cpBg, cpFill, cpText, cpBarW, cpBarH, cpBarX, cpBarY, mmCpDiamond,
    tdmScore0, tdmSep, tdmScore1, cpScore0, cpScore1,
    hpStatText, manaStatText };
}

const uiPlayerUI = {};

function getOrCreatePlayerUI(id) {
  if (uiPlayerUI[id]) return uiPlayerUI[id];
  const nt = new PIXI.Text('', {
    fontSize: 16,
    fill: 0xffffff,
    fontWeight: '900',
    stroke: 0x000000,
    strokeThickness: 4,
  });
  nt.anchor.set(0.5);
  uiContainer.addChild(nt);
  const hbg   = new PIXI.Graphics(); uiContainer.addChild(hbg);
  const hfill = new PIXI.Graphics(); uiContainer.addChild(hfill);
  const mbg   = new PIXI.Graphics(); uiContainer.addChild(mbg);
  const mfill = new PIXI.Graphics(); uiContainer.addChild(mfill);
  uiPlayerUI[id] = { nt, hbg, hfill, mbg, mfill };
  return uiPlayerUI[id];
}

function removePlayerUI(id) {
  const ui = uiPlayerUI[id];
  if (!ui) return;
  uiContainer.removeChild(ui.nt);    ui.nt.destroy({ texture: true, baseTexture: true });
  uiContainer.removeChild(ui.hbg);   ui.hbg.destroy();
  uiContainer.removeChild(ui.hfill); ui.hfill.destroy();
  uiContainer.removeChild(ui.mbg);   ui.mbg.destroy();
  uiContainer.removeChild(ui.mfill); ui.mfill.destroy();
  delete uiPlayerUI[id];
  const dot = uiMmDots[id];
  if (dot) { uiContainer.removeChild(dot); dot.destroy(); delete uiMmDots[id]; }
}

const uiMmDots = {};

function drawUI(now, pl) {
  if (!_ui) return;
  dbgSet('dbg-fps', `⬤ FPS: ${Math.round(app.ticker.FPS)}`, app.ticker.FPS > 50 ? 'ok' : app.ticker.FPS > 30 ? 'warn' : 'error');
  const { skillFills, sbW, sbH, sbGap, startX, barY, lbBg, lbRows, lbW, lbX, lbY, mmSize, mmX, mmY,
    cpBg, cpFill, cpText, cpBarW, cpBarH, cpBarX, cpBarY, mmCpDiamond,
    tdmScore0, tdmSep, tdmScore1, cpScore0, cpScore1,
    hpStatText, manaStatText } = _ui;

  const hp = Math.round(pl.renderHealth ?? pl.health ?? 0);
  const mp = Math.round(pl.renderMana ?? pl.mana ?? 0);
  const hpStr = `HP: ${hp}`;
  const mpStr = `MP: ${mp}`;
  if (hpStatText.text !== hpStr) hpStatText.text = hpStr;
  if (manaStatText.text !== mpStr) manaStatText.text = mpStr;
  const hpPct = hp / 100;
  hpStatText.style.fill = hpPct > 0.6 ? 0x44ee66 : hpPct > 0.3 ? 0xffcc22 : 0xff4444;

  // ── Skill cooldown bars ── polished fill with gloss
  const cds = [pl.renderSkill1cd ?? pl.skill1cd, pl.renderSkill2cd ?? pl.skill2cd, pl.renderSkill3cd ?? pl.skill3cd];
  cds.forEach((cd, i) => {
    const f = skillFills[i];
    const x = startX + i * (sbW + sbGap);
    f.clear();

    // Inner track (slightly inset from bg border)
    f.beginFill(0x111111, 0.7);
    f.drawRoundedRect(x + 2, barY + 2, sbW - 4, sbH - 4, 5);
    f.endFill();

    if (cd < 1) {
      const fillW = (sbW - 4) * (1 - cd);
      const isReady = (1 - cd) > 0.98;

      // Main fill — teal when ready, lighter cyan while charging
      f.beginFill(isReady ? 0x00ffcc : 0x00aadd, 0.92);
      f.drawRoundedRect(x + 2, barY + 2, fillW, sbH - 4, 5);
      f.endFill();

      // Gloss highlight strip (top half)
      f.beginFill(0xffffff, 0.18);
      f.drawRoundedRect(x + 2, barY + 2, fillW, (sbH - 4) * 0.45, 5);
      f.endFill();
    }
  });

  const mmScale = mmSize / MAP_DIM;
  for (const [id, p] of Object.entries(players)) {
    if (!uiMmDots[id]) {
      const dot = new PIXI.Graphics();
      uiContainer.addChild(dot);
      uiMmDots[id] = dot;
    }
    const dot = uiMmDots[id];
    dot.clear();
    const mmCx = mmX + p.renderX * mmScale;
    const mmCy = mmY + p.renderY * mmScale;
    const isEnemy = (gamemode === 1 || gamemode === 2) && players[myId] && p.team !== players[myId].team;
    const isAlly  = (gamemode === 1 || gamemode === 2) && players[myId] && p.team === players[myId].team && id !== myId;
    if (id === myId) {
      const st = CLASS_STYLES[p.gameClass] || CLASS_STYLES.fire;
      dot.beginFill(st.body, 0.85); dot.drawCircle(mmCx, mmCy, 4); dot.endFill();
      dot.lineStyle(1.5, 0x44ff44, 1); dot.drawCircle(mmCx, mmCy, 4);
    } else {
      const st = CLASS_STYLES[p.gameClass] || CLASS_STYLES.fire;
      dot.beginFill(st.body, 0.85); dot.drawCircle(mmCx, mmCy, 4); dot.endFill();
      const outlineColor = isEnemy ? 0xff3333 : isAlly ? 0x44aaff : 0xff3333;
      dot.lineStyle(1.5, outlineColor, 1); dot.drawCircle(mmCx, mmCy, 4);
    }
  }

  mmCpDiamond.clear();
  if (gamemode === 2 && capturePoint.radius) {
    const cx = mmX + capturePoint.x * mmScale;
    const cy = mmY + capturePoint.y * mmScale;
    const r = 5;
    mmCpDiamond.lineStyle(1.5, 0xffffff, 1);
    mmCpDiamond.beginFill(0xffffff, 0.85);
    mmCpDiamond.moveTo(cx, cy - r); mmCpDiamond.lineTo(cx + r, cy);
    mmCpDiamond.lineTo(cx, cy + r); mmCpDiamond.lineTo(cx - r, cy);
    mmCpDiamond.closePath(); mmCpDiamond.endFill();
  }

  const sorted = Object.entries(players).sort((a, b) => (b[1].killcount ?? 0) - (a[1].killcount ?? 0)).slice(0, 10);
  lbBg.clear();
  lbBg.beginFill(0x000000, 0.45);
  lbBg.lineStyle(1, 0x335533, 0.5);
  lbBg.drawRoundedRect(lbX, lbY, lbW, 30 + sorted.length * 26, 6);
  lbBg.endFill();
  lbRows.forEach(({ row, kills }, i) => {
    if (i < sorted.length) {
      const [id, p] = sorted[i];
      let name = p.name || '?';
      if (name.length > 14) name = name.substring(0, 14) + '…';
      const rowText = `${i + 1}. ${name}`;
      if (row.text !== rowText) row.text = rowText;
      const isLbEnemy = (gamemode === 1 || gamemode === 2) && players[myId] && p.team !== players[myId].team;
      row.style.fill = id === myId ? 0xaaccff : isLbEnemy ? 0xff4444 : 0xddeedd;
      const killText = `${p.killcount ?? 0}`;
      if (kills.text !== killText) kills.text = killText;
      row.visible = true; kills.visible = true;
    } else {
      row.visible = false; kills.visible = false;
    }
  });

  for (const [id, p] of Object.entries(players)) {
    const sx = p.renderX * zoom + mapContainer.x;
    const sy = p.renderY * zoom + mapContainer.y;
    const { nt, hbg, hfill, mbg, mfill } = getOrCreatePlayerUI(id);

    let name = p.name || '?';
    if (name.length > 18) name = name.substring(0, 18) + '…';
    const nameText = name + (p.killcount > 0 ? ` ☠${p.killcount}` : '');
    if (nt.text !== nameText) nt.text = nameText;
    const isAlly = (gamemode === 1 || gamemode === 2) && players[myId] && p.team === players[myId].team && id !== myId;
    nt.style.fill = id === myId ? 0x44ee66 : isAlly ? 0xaaccff : 0xff4444;
    nt.x = sx;
    nt.y = sy - 42 * zoom;

    // ── Health bar — pill style, gloss highlight ──
    const bw = 54 * zoom, bh = 8 * zoom, bR = 4;
    const bx = sx - bw / 2, by = sy + 26 * zoom;

    hbg.clear();
    // track
    hbg.lineStyle(1.5*zoom, 0x000000, 0.9);
    hbg.beginFill(0x111111, 0.85*zoom);
    hbg.drawRoundedRect(bx, by, bw, bh, bR);
    hbg.endFill();

    const hpct = Math.max(0, Math.min(1, (p.renderHealth ?? p.health) / 100));
    hfill.clear();
    if (hpct > 0) {
      const hColor = hpct > 0.6 ? 0x44ee66 : hpct > 0.3 ? 0xffcc22 : 0xff2233;
      hfill.beginFill(hColor, 0.95);
      hfill.drawRoundedRect(bx + 1, by + 1, (bw - 2) * hpct, bh - 2, bR - 1);
      hfill.endFill();
      // gloss
      hfill.beginFill(0xffffff, 0.18);
      hfill.drawRoundedRect(bx + 1, by + 1, (bw - 2) * hpct, (bh - 2) * 0.45, bR - 1);
      hfill.endFill();
    }

    if (id === myId) {
      // ── Mana bar — thinner, blue, same polish ──
      const mby = by + bh + 3 * zoom, mbh = 8 * zoom, mbR = 3;
      mbg.clear();
      mbg.lineStyle(1.5*zoom, 0x000000, 0.85);
      mbg.beginFill(0x0a0a18, 0.85);
      mbg.drawRoundedRect(bx, mby, bw, mbh, mbR);
      mbg.endFill();
      mbg.visible = true;

      const mpct = Math.max(0, Math.min(1, (p.renderMana ?? p.mana) / 100));
      mfill.clear();
      if (mpct > 0) {
        mfill.beginFill(0x3399ff, 0.92);
        mfill.drawRoundedRect(bx + 1, mby + 1, (bw - 2) * mpct, mbh - 2, mbR - 1);
        mfill.endFill();
        // gloss
        mfill.beginFill(0xffffff, 0.16);
        mfill.drawRoundedRect(bx + 1, mby + 1, (bw - 2) * mpct, (mbh - 2) * 0.45, mbR - 1);
        mfill.endFill();
      }
      mfill.visible = true;
    } else {
      mbg.visible = false;
      mfill.visible = false;
    }
  }

  const myTeam = players[myId]?.team;

  // Gamemode 1: team deathmatch score
  if (gamemode === 1) {
    const s0 = `${team0score}`, s1 = `${team1score}`;
    if (tdmScore0.text !== s0) tdmScore0.text = s0;
    if (tdmScore1.text !== s1) tdmScore1.text = s1;
    tdmScore0.style.fill = myTeam === 0 ? 0x4488ff : 0xff3333;
    tdmScore1.style.fill = myTeam === 1 ? 0x4488ff : 0xff3333;
    const W = app.screen.width;
    tdmSep.x = W / 2;
    tdmScore0.x = W / 2 - tdmSep.width / 2;
    tdmScore1.x = W / 2 + tdmSep.width / 2;
    tdmScore0.visible = true;
    tdmSep.visible = true;
    tdmScore1.visible = true;
  } else {
    tdmScore0.visible = false;
    tdmSep.visible = false;
    tdmScore1.visible = false;
  }

  cpBg.clear();
  cpFill.clear();
  cpText.visible = false;
  cpScore0.visible = false;
  cpScore1.visible = false;
  if (gamemode === 2 && capturePoint.radius) {
    const cs = capturePoint.captureState;
    const targetPct = Math.max(0, Math.min(1, (capturePoint.percentage ?? 0) / 100));
    cpRenderPercent = lerp(cpRenderPercent, targetPct, 0.1);
    const pct = cpRenderPercent;
    let fillColor;
    if (cs === 2) fillColor = 0x888888;
    else if (cs === 0 || cs === 3) fillColor = myTeam === 0 ? 0x4488ff : 0xff3333;
    else fillColor = myTeam === 1 ? 0x4488ff : 0xff3333;

    cpBg.beginFill(0x000000, 0.55);
    cpBg.lineStyle(1, 0x555555, 0.7);
    cpBg.drawRoundedRect(cpBarX, cpBarY, cpBarW, cpBarH, 5);
    cpBg.endFill();
    if (pct > 0) {
      cpFill.beginFill(fillColor, 0.9);
      cpFill.drawRoundedRect(cpBarX, cpBarY, cpBarW * pct, cpBarH, 5);
      cpFill.endFill();
    }
    const label = capturePoint.text || '';
    if (cpText.text !== label) cpText.text = label;
    cpText.visible = true;

    const s0 = `${team0score}`, s1 = `${team1score}`;
    if (cpScore0.text !== s0) cpScore0.text = s0;
    if (cpScore1.text !== s1) cpScore1.text = s1;
    cpScore0.style.fill = myTeam === 0 ? 0x4488ff : 0xff3333;
    cpScore1.style.fill = myTeam === 1 ? 0x4488ff : 0xff3333;
    cpScore0.visible = true;
    cpScore1.visible = true;
  }
}

// ── DEATH ────────────────────────────────────────
function triggerDeath() {
  dead = true;
  document.getElementById('death-msg').textContent =
    `You got ${killcount} kill${killcount!==1?'s':''}.`;
  document.getElementById('deathScreen').style.display = 'flex';
}

// ── BOOT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initJoinScreen();
});
