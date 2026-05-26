// ═══════════════════════════════════════════════════
//  ARCNE.IO  —  PixiJS WebGL frontend
//  Controls: WASD/arrows=move | Q,E,F=skills | LMB=melee
// ═══════════════════════════════════════════════════

const WS_URL = "https://circle-game-5y2k.onrender.com"; // ← CHANGE THIS TO YOUR SERVER ADDRESS
let MAP_DIM = 4000;
const SERVER_TICK = 100;
const BASE_VIEW_WIDTH  = 4800;
const BASE_VIEW_HEIGHT = 2700;

const CLASS_STYLES = {
  fire:      { body: 0xd14821, bodyHi: 0xff7744, arm: 0xb03010, outline: 0x661500 },
  ice:       { body: 0x88ddff, bodyHi: 0xccf4ff, arm: 0x44aadd, outline: 0x2266aa },
  earth:     { body: 0x7a6a50, bodyHi: 0x9a8a70, arm: 0x55473a, outline: 0x2a2018 },
  blood:     { body: 0xaa1122, bodyHi: 0xff3355, arm: 0x880011, outline: 0x440008 },
  lightning: { body: 0xffee22, bodyHi: 0xffff99, arm: 0xddcc00, outline: 0x886600 },
  void:      { body: 0x48315c, bodyHi: 0x7f6890, arm: 0x3a2e48, outline: 0x1a1220 },
  crusader:    { body: 0xffffff, bodyHi: 0xeeeeee, arm: 0xcccccc, outline: 0x444444 },
  blademaster: { body: 0xcccccc, bodyHi: 0xe8e8e8, arm: 0xaaaaaa, outline: 0x555555 },
};

// ── STATE ────────────────────────────────────────
let ws = null, myId = null, myClass = null, myName = '';
let dead = false, killcount = 0, gameStartTime = 0;
let pingIntervalId = null;
let players = {}, projectiles = {}, obstacles = {}, npcs = {};
let capturePoint = {}, cpRenderPercent = 0;
let zoom = 1.1, direction = 0;
const pressed = {};
let lastMoveSend = 0;
// ── PIXI OBJECTS ─────────────────────────────────
let app, mapContainer, uiContainer;
let obstacleLayer, projLayer, aboveObstacleLayer, playerLayer, trailLayer, bushLayer, highPlayerLayer, damageTextLayer;
let frenzyTrails = [];
let lightningParticles = [];
let mapBg = null;
let capturePointGraphic = null;
let playerContainers = {}, projContainers = {}, obstacleSprites = {}, npcContainers = {};
let texCache = {};
let pixiReady = false;
// –– GAME DATA ───────────────────────────────────────
let sessionId = 0;
let gamemode = 0;
let teamSelect = null;
let myCode = '';
let team0score = 0, team1score = 0;

// ── DAMAGE TEXT STATE ─────────────────────────────
let damageTexts = [];

// ── CHAT STATE ────────────────────────────────────
let chatContainer = null;
const chatLines = [];

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let c = b - a;
  while (c < -Math.PI) c += Math.PI * 2;
  while (c >  Math.PI) c -= Math.PI * 2;
  return a + c * t;
}
function getMinZoom() {
  if (!app) return 0.4;
  return Math.max(app.screen.width / BASE_VIEW_WIDTH, app.screen.height / BASE_VIEW_HEIGHT);
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
    document.getElementById('team-select').style.display = (val === 1 || val === 2 || val === 3) ? 'block' : 'none';
  });

  document.getElementById('join-btn').addEventListener('click', () => {
    myName = document.getElementById('name-input').value.trim();
    myClass = selectedClass;
    sessionId = parseInt(document.getElementById('session-select').value, 10);
    teamSelect = (sessionId === 1 || sessionId === 2 || sessionId === 3)
      ? parseInt(document.getElementById('team-select').value, 10)
      : null;
    myCode = document.getElementById('code-input').value.trim();
    if (!myName || !myClass) return;
    document.getElementById('joinScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    document.getElementById('chatBox').style.display = 'flex';
    gameStartTime = Date.now();
    dead = false; killcount = 0;
    players = {}; projectiles = {}; obstacles = {};
    clearScene();
    if (!pixiReady) initPixi();
    connectWS();
  });

  document.getElementById('spectate-btn').addEventListener('click', () => {
    const spectatorName = document.getElementById('name-input').value.trim();
    if (!spectatorName) return;
    myName = spectatorName;
    myClass = "fire";
    sessionId = parseInt(document.getElementById('session-select').value, 10);
    teamSelect = null;
    myCode = 'spectator';
    document.getElementById('joinScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    document.getElementById('chatBox').style.display = 'flex';
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
    document.getElementById('chatBox').style.display = 'none';
    hideDebug();
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
  aboveObstacleLayer = new PIXI.Container();
  trailLayer = new PIXI.Container();
  damageTextLayer = new PIXI.Container();
  playerLayer = new PIXI.Container();
  bushLayer = new PIXI.Container();
  highPlayerLayer = new PIXI.Container();
  capturePointGraphic = new PIXI.Graphics();
  mapContainer.addChild(capturePointGraphic, projLayer, trailLayer, obstacleLayer, damageTextLayer, playerLayer, bushLayer, aboveObstacleLayer,highPlayerLayer);

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
  aboveObstacleLayer = new PIXI.Container();
  trailLayer = new PIXI.Container();
  damageTextLayer = new PIXI.Container();
  playerLayer = new PIXI.Container();
  bushLayer = new PIXI.Container();
  highPlayerLayer = new PIXI.Container();
  capturePointGraphic = new PIXI.Graphics();
  mapContainer.addChild(projLayer, obstacleLayer, aboveObstacleLayer, trailLayer, damageTextLayer, playerLayer, bushLayer, highPlayerLayer, capturePointGraphic);
  playerContainers = {}; projContainers = {}; obstacleSprites = {}; npcContainers = {};
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
  for (const id of Object.keys(uiMmNpcDots)) {
    uiContainer.removeChild(uiMmNpcDots[id]);
    uiMmNpcDots[id].destroy();
    delete uiMmNpcDots[id];
  }
  if (chatContainer) { chatContainer.removeChildren().forEach(lc => lc.destroy({ children: true })); }
  chatLines.length = 0;
}

// ═══════════════════════════════════════════════════
//  TEXTURE GENERATION
// ═══════════════════════════════════════════════════
function generateTextures() {
  texCache.sword         = PIXI.Texture.from('assets/swordSprite.png');
  texCache.enhancedSword = PIXI.Texture.from('assets/stone_club.webp');
  texCache.voidOuter  = PIXI.Texture.from('assets/voidOuterRingClean.png');
  texCache.voidMiddle = PIXI.Texture.from('assets/voidMiddleRingClean.png');
  texCache.voidInner  = PIXI.Texture.from('assets/voidInnerRingClean.png');
  texCache.crusadeWing = PIXI.Texture.from('assets/CrusadeWingClean.png');
  texCache.holySword = PIXI.Texture.from('assets/holy_sword.webp');
  texCache.earthWave = PIXI.Texture.from('assets/earth_wave.webp');
  texCache.iceSword      = PIXI.Texture.from('assets/iceblade.webp');
  texCache.rock          = makeRockTexture();
  texCache.bush          = PIXI.Texture.from('assets/bush.webp');
  texCache.rockfist      = PIXI.Texture.from('assets/rockfist.webp');
  texCache.lavabug       = PIXI.Texture.from('assets/lavabug.webp');
  texCache.goldenhelm    = PIXI.Texture.from('assets/goldenhelm.webp');
  texCache.wingedhelm    = PIXI.Texture.from('assets/wingedhelm.webp');
  texCache.shockwaveFrames = Array.from({length: 8}, (_, i) =>
    PIXI.Texture.from(`assets/shockwave/Quake${i + 1}.PNG`)
  );
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
    joinMsg.code = myCode;
    const _gl = document.createElement('canvas').getContext('webgl');
    const _glExt = _gl?.getExtension('WEBGL_debug_renderer_info');
    const _c = document.createElement('canvas');
    const _ctx = _c.getContext('2d');
    _ctx.fillText('fp', 10, 10);
    const _ac = new AudioContext();
    joinMsg.device = JSON.stringify({
      sw: screen.width,
      sh: screen.height,
      dpr: window.devicePixelRatio,
      colorDepth: screen.colorDepth,
      ua: navigator.userAgent,
      platform: navigator.platform,
      lang: navigator.language,
      langs: navigator.languages?.join(',') ?? null,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      touch: navigator.maxTouchPoints > 0,
      cpu: navigator.hardwareConcurrency,
      mem: navigator.deviceMemory ?? null,
      cookieEnabled: navigator.cookieEnabled,
      online: navigator.onLine,
      connType: navigator.connection?.effectiveType ?? null,
      webglVendor: _glExt ? _gl.getParameter(_glExt.UNMASKED_VENDOR_WEBGL) : null,
      webglRenderer: _glExt ? _gl.getParameter(_glExt.UNMASKED_RENDERER_WEBGL) : null,
      canvasFp: _c.toDataURL(),
      audioSR: _ac.sampleRate,
    });
    _ac.close();
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

  if (msg.type === 'npcs') {
    msg.npcs.forEach(p => {
      if (!npcs[p.id]) {
        npcs[p.id] = { ...p, renderX: p.x, renderY: p.y, renderDir: p.dir,
          renderHealth: p.health, lastUpdateTime: now };
      } else {
        const prev = npcs[p.id];
        const prevHealth = prev.health ?? p.health;
        const prevdir = prev.renderDir;
        Object.assign(prev, p, { lastUpdateTime: now });

        // Spawn damage text if this npc took damage
        const dmg = Math.round(prevHealth - p.health);
        if (dmg > 0 || dmg < -1) {
          spawnDamageText(p.x, p.y - 24, dmg, dmg >= 20);
        }
      }
    });
    for (const id in npcs) {
      if (npcs[id].lastUpdateTime !== now) { removeNPCSprite(id); delete npcs[id]; }
    }
  }

  if (msg.type === 'projectiles') {
    msg.projectiles.forEach(p => {
      if (!projectiles[p.id]) {
        projectiles[p.id] = { ...p, renderX: p.x, renderY: p.y, lastUpdateTime: now };
      } else {
        const prev = projectiles[p.id];
        Object.assign(prev, p, { lastUpdateTime: now });
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

  if (msg.type === 'chatMessage') {
    addChatMessage(msg.sender, msg.message, msg.class, msg.fromSpectator);
  }
}

function addChatMessage(sender, text, playerClass, fromSpectator) {
  if (!chatContainer || !app) return;

  const W = app.screen.width, H = app.screen.height;
  const chatW = 300, padX = 8, padY = 3, margin = 16, bottomOffset = 60;

  const CHAT_COLOR_OVERRIDE = { void: 0x9b6dcc };
  const nameColorNum = fromSpectator ? 0xaaaaaa : (CHAT_COLOR_OVERRIDE[playerClass] ?? (CLASS_STYLES[playerClass] ? CLASS_STYLES[playerClass].body : 0xffffff));
  const nameColorHex = '#' + nameColorNum.toString(16).padStart(6, '0');
  const msgColorHex = fromSpectator ? '#aaaaaa' : '#dddddd';

  const classTag = fromSpectator ? '[spectator]' : (playerClass ? `[${playerClass}]` : '');
  const label = sender ? `${classTag} ${sender}: ` : '';
  const htmlContent = sender
    ? `<span style="color:${nameColorHex};font-weight:700;">${label}</span><span style="color:${msgColorHex};">${text}</span>`
    : `<span style="color:${msgColorHex};">${text}</span>`;

  const msgT = new PIXI.HTMLText(htmlContent, {
    fontSize: 12, fontFamily: 'monospace',
    wordWrap: true, wordWrapWidth: chatW - padX * 2,
    dropShadow: true, dropShadowDistance: 1, dropShadowAlpha: 0.9,
  });

  const lineH = msgT.height + padY * 2;

  const bg = new PIXI.Graphics();
  bg.beginFill(0x000000, 0.55);
  bg.lineStyle(1, 0xffffff, 0.08);
  bg.drawRoundedRect(0, 0, chatW, lineH, 4);
  bg.endFill();

  const lc = new PIXI.Container();
  lc.addChild(bg);
  msgT.x = padX; msgT.y = padY;
  lc.addChild(msgT);

  chatContainer.addChild(lc);
  chatLines.push(lc);

  while (chatLines.length > 10) {
    const old = chatLines.shift();
    chatContainer.removeChild(old);
    old.destroy({ children: true });
  }

  let y = H - bottomOffset;
  for (let i = chatLines.length - 1; i >= 0; i--) {
    y -= chatLines[i].height + 2;
    chatLines[i].x = W - chatW - margin;
    chatLines[i].y = y;
  }
}

// ═══════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!e.key) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const chatInput = document.getElementById('chatInput');
  const isChatOpen = document.activeElement === chatInput;

  if (isChatOpen) {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text && ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'chatMessage', message: text }));
      chatInput.value = '';
      chatInput.style.display = 'none';
      chatInput.blur();
      if (chatContainer) chatContainer.alpha = 0.5;
    } else if (e.key === 'Escape') {
      chatInput.value = '';
      chatInput.style.display = 'none';
      chatInput.blur();
      if (chatContainer) chatContainer.alpha = 0.5;
    }
    return;
  }

  pressed[key] = true;
  if ((e.key === 'Delete' || e.key === 'Backspace') && document.getElementById('gameScreen').style.display === 'block') {
    if (ws) { ws.close(); ws = null; }
    myId = null; dead = false; killcount = 0;
    players = {}; projectiles = {}; obstacles = {};
    clearScene();
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('deathScreen').style.display = 'none';
    document.getElementById('joinScreen').style.display = 'flex';
    document.getElementById('chatBox').style.display = 'none';
    hideDebug();
    return;
  }
  if (e.key === 'Enter' && myId && document.getElementById('gameScreen').style.display === 'block') {
    chatInput.style.display = 'block';
    chatInput.focus();
    if (chatContainer) chatContainer.alpha = 1;
    e.preventDefault();
    return;
  }
  if (!myId || dead) return;
  if (key === 'q') sendAttack('skill1');
  if (key === 'e') sendAttack('skill2');
  if (key === 'f') sendAttack('skill3');
  if (key === 't' && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'switchMode' }));
});
document.addEventListener('keyup', e => {
  if (!e.key) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  pressed[key] = false;
});
document.addEventListener('mousemove', e => {
  if (!app) return;
  const pl = players[myId];
  if (!pl) return;
  const ez = Math.max(zoom, getMinZoom());
  const wx = (e.clientX - app.screen.width  / 2) / ez + pl.renderX;
  const wy = (e.clientY - app.screen.height / 2) / ez + pl.renderY;
  direction = Math.atan2(wy - pl.renderY, wx - pl.renderX);
  pl.renderDir = direction;
});
document.addEventListener('mousedown', e => {
  if (myId && !dead && document.getElementById('gameScreen').style.display === 'block')
    sendAttack('basicMelee');
});
document.addEventListener('wheel', e => {
  zoom = e.deltaY > 0 ? Math.min(4.0, zoom + 0.03) : Math.max(getMinZoom(), zoom - 0.03);
});
window.addEventListener('resize', () => {
  const min = getMinZoom();
  if (zoom < min) zoom = min;
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
  damageTextLayer.addChild(text);
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
      damageTextLayer.removeChild(d.obj);
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
    const ttl = t.ttl || DURATION;
    if (age >= ttl) {
      trailLayer.removeChild(t.g);
      t.g.destroy();
      frenzyTrails.splice(i, 1);
    } else {
      const p = 1 - age / ttl;
      if (t.isHsParticle) {
        // velocity-driven burst particle
        t.g.x += t.g._vx * (1 / 60);
        t.g.y += t.g._vy * (1 / 60);
        t.g._vx *= 0.88; t.g._vy *= 0.88;
        t.g.alpha = p < 0.25 ? p / 0.25 : 1; // stay solid, sharp drop at end
      } else if (t.fadeOnly) {
        t.g.alpha = p;
      } else if (t.scaleEnd) {
        // expanding ring
        const s = 1 + (1 - p) * (t.scaleEnd - 1);
        t.g.scale.set(s);
        t.g.alpha = p * 0.9;
      } else {
        t.g.alpha = p * 0.7;
        t.g.scale.set(0.3 + p * 0.7);
      }
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
  if (now - lastFrameTime < FRAME_MIN_MS) {return;}
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
  for (const p of Object.values(npcs)) {
    const t = Math.min((now - p.lastUpdateTime) / SERVER_TICK, 1);
    p.renderX = lerp(p.last_x ?? p.x, p.x, t);
    p.renderY = lerp(p.last_y ?? p.y, p.y, t);
    p.renderHealth = lerp(p.renderHealth ?? p.health, p.health, 0.12);
    p.renderDir = lerpAngle(p.renderDir ?? p.dir, p.dir, 0.18);
  }

  const effectiveZoom = Math.max(zoom, getMinZoom());
  mapContainer.scale.set(effectiveZoom);
  mapContainer.x = app.screen.width  / 2 - pl.renderX * effectiveZoom;
  mapContainer.y = app.screen.height / 2 - pl.renderY * effectiveZoom;

  for (const [id, ob] of Object.entries(obstacles)) getOrCreateObstacle(id, ob);
  for (const [id, p]  of Object.entries(projectiles)) updateProjSprite(id, p, now);
  for (const id of Object.keys(projContainers))    { if (!projectiles[id]) removeProjSprite(id); }
  for (const [id, p]  of Object.entries(players))  updatePlayerSprite(id, p, now);
  for (const id of Object.keys(playerContainers))  { if (!players[id]) removePlayerSprite(id); }
  for (const [id, npc] of Object.entries(npcs)) updateNPCSprite(id, npc, now);
  for (const id of Object.keys(npcContainers)) { if (!npcs[id]) removeNPCSprite(id); }

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
  const swordScaleX = gameClass === 'blademaster' ? 0.135 : 0.09;
  const swordScaleY = gameClass === 'blademaster' ? 0.165 : 0.11;
  const swordOutline = buildSpriteOutline(
    texCache.sword,
    swordScaleX, swordScaleY,
    -Math.PI / 2,
    0x000000,
    1.5
  );
  const swordY = gameClass === 'blademaster' ? -45 : -30;
  swordOutline.x = 30; swordOutline.y = swordY;
  swordOutline.name = 'swordOutline';
  c.addChild(swordOutline);

  // Sword sprite — on top of outline
  const sword = new PIXI.Sprite(texCache.sword);
  sword.anchor.set(0.5, 0.5);
  sword.x = 30; sword.y = swordY;
  sword.scale.set(swordScaleX, swordScaleY);
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

  // Golden helm cosmetic — group ensures outline always renders behind sprite
  const goldenhelmGroup = new PIXI.Container();
  goldenhelmGroup.name = 'goldenhelmGroup'; goldenhelmGroup.visible = false; goldenhelmGroup.x = -37;
  const goldenhelmOutline = buildSpriteOutline(texCache.goldenhelm, 0.12, 0.12 * 0.87, -Math.PI / 2, 0x000000, 1);
  goldenhelmGroup.addChild(goldenhelmOutline);
  const goldenhelm = new PIXI.Sprite(texCache.goldenhelm);
  goldenhelm.anchor.set(0.5, 0.5);
  goldenhelm.scale.set(0.12);
  goldenhelm.height *= 0.87;
  goldenhelm.rotation = -Math.PI / 2;
  goldenhelm.name = 'goldenhelm';
  goldenhelmGroup.addChild(goldenhelm);
  c.addChild(goldenhelmGroup);

  // Winged helm cosmetic
  const wingedhelmGroup = new PIXI.Container();
  wingedhelmGroup.name = 'wingedhelmGroup'; wingedhelmGroup.visible = false; wingedhelmGroup.x = -40;
  const wingedhelmOutline = buildSpriteOutline(texCache.wingedhelm, 0.125, 0.125 * 0.95, -Math.PI / 2, 0x000000, 1);
  wingedhelmGroup.addChild(wingedhelmOutline);
  const wingedhelm = new PIXI.Sprite(texCache.wingedhelm);
  wingedhelm.anchor.set(0.5, 0.5);
  wingedhelm.scale.set(0.125);
  wingedhelm.height *= 0.95;
  wingedhelm.rotation = -Math.PI / 2;
  wingedhelm.name = 'wingedhelm';
  wingedhelmGroup.addChild(wingedhelm);
  c.addChild(wingedhelmGroup);

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
    (p.isHigh ? highPlayerLayer : playerLayer).addChild(c);
    playerContainers[id] = c;
  }
  const c = playerContainers[id];

  const viewerIsSpectator = !!players[myId]?.isSpectator;
  if (p.isSpectator || p.isInvisible) {
    c.visible = false;
    return;
  }
  c.visible = true;
  c.alpha = (!viewerIsSpectator && p.isHidden) ? 0.5 : 1;

  const targetLayer = p.isHigh ? highPlayerLayer : playerLayer;
  if (c.parent !== targetLayer) {
    c.parent.removeChild(c);
    targetLayer.addChild(c);
  }

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

  if (p.isHitting && (!p._swingStart || now - p._swingStart > p.basicMeleeMaxCD * 100 - 1)) {
p._swingStart = now;
  }
  const elapsed = now - p._swingStart;
  if (p._swingStart) {
    if (elapsed < 200) {
      p._swingAngle = (elapsed / 200) * Math.PI * 0.9;
    } else if (elapsed < 400) {
      p._swingAngle = ((400 - elapsed) / 200) * Math.PI * 0.9;
    } else {
      p._swingAngle = 0;
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
      const outerR = 32 + heat * 5;
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
    const ROCK_PX        = 12; // sprite diameter in px (rock radius ~4.5 world units)
    const ROCK_SCALE     = ROCK_PX / 100; // texCache.rock is 100×100

    // Rebuild sprites only when the ring count changes
    if (earthShieldCt._numRings !== numRings) {
      earthShieldCt.removeChildren().forEach(ch => ch.destroy());
      for (let ring = 0; ring < numRings; ring++) {
        for (let i = 0; i < ROCKS_PER_RING[ring]; i++) {
          const s = new PIXI.Sprite(texCache.rock);
          s.anchor.set(0.5);
          s.scale.set(ROCK_SCALE);
          s.tint = 0x888070;
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
        pWingGlow.beginFill(0xffd700, pulse * 1.5); pWingGlow.drawCircle(0, 0, Math.min(spread * 1.1, 55)); pWingGlow.endFill();
        pWingGlow.beginFill(0xffe566, pulse); pWingGlow.drawCircle(0, 0, Math.min(spread * 0.55, 55)); pWingGlow.endFill();
      }
    }
  }

  // ── SWORD + OUTLINE texture swap ──
  const sword = c.getChildByName('sword');
  const swordOutline = c.getChildByName('swordOutline');
  if (sword && !(p._swingStart && elapsed < 300)) {
    const newTex = p.basicEnhanced ? texCache.enhancedSword : texCache.sword;
    const newRot = p.basicEnhanced ? 0 : -Math.PI / 2;
    sword.texture = newTex;
    sword.rotation = newRot;
    if (p.basicEnhanced) {
      sword.x = 20; sword.y = -40;
    } else {
      sword.x = 30; sword.y = p.gameClass === 'blademaster' ? -45 : -30;
    }
    if (swordOutline) {
      swordOutline.x = sword.x; swordOutline.y = sword.y;
      for (const child of swordOutline.children) {
        child.texture = newTex;
        child.rotation = newRot;
      }
    }
  }

  // ── GOLDEN HELM COSMETIC ──
  const goldenhelmGroup = c.getChildByName('goldenhelmGroup');
  if (goldenhelmGroup) goldenhelmGroup.visible = p.cosmetic === 'goldenhelm';

  // ── WINGED HELM COSMETIC ──
  const wingedhelmGroup = c.getChildByName('wingedhelmGroup');
  if (wingedhelmGroup) wingedhelmGroup.visible = p.cosmetic === 'wingedhelm';

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
//  NPC SPRITES
// ═══════════════════════════════════════════════════

function getOrCreateNPC(id, type, radius, name) {
  if (npcContainers[id]) return npcContainers[id];
  const c = buildNPCContainer(type, radius, name);
  const p = npcs[id];
  if (p && p.renderX != null) {
    c.x = p.renderX;
    c.y = p.renderY;
  }
  playerLayer.addChild(c);
  npcContainers[id] = c;
  return c;
}

function buildNPCContainer(type, radius, name) {
  const c = new PIXI.Container();
  if (name === 'lavabug') {
    const w = radius * 4.5, h = radius * 3.5, thickness = 2;
    const outline = new PIXI.Container(); outline.name = 'lavabugOutline';
    for (const [ox, oy] of [[-thickness,0],[thickness,0],[0,-thickness],[0,thickness],[-thickness,-thickness],[thickness,-thickness],[-thickness,thickness],[thickness,thickness]]) {
      const sh = new PIXI.Sprite(texCache.lavabug);
      sh.anchor.set(0.5); sh.width = w; sh.height = h;
      sh.tint = 0x000000; sh.x = ox; sh.y = oy;
      outline.addChild(sh);
    }
    const rangeCircle = new PIXI.Graphics(); rangeCircle.name = 'rangeCircle'; c.addChild(rangeCircle);
    c.addChild(outline);
    const spr = new PIXI.Sprite(texCache.lavabug);
    spr.anchor.set(0.5);
    spr.width = w;
    spr.height = h;
    spr.name = 'lavabugSpr';
    c.addChild(spr);
  } else {
    const def = new PIXI.Graphics(); def.name = 'defHitbox'; def.beginFill(0x8888ff, 0.9); def.drawCircle(0, 0, radius); def.endFill(); c.addChild(def);
  }
  //const def = new PIXI.Graphics(); def.name = 'defHitbox'; def.beginFill(0x8888ff, 0.9); def.drawCircle(0, 0, radius); def.endFill(); c.addChild(def);
  const hbg = new PIXI.Graphics(); hbg.name = 'hbg'; c.addChild(hbg);
  const hfill = new PIXI.Graphics(); hfill.name = 'hfill'; c.addChild(hfill);
  if (name === 'trainingdummy') {
    const dbgBg = new PIXI.Graphics(); dbgBg.name = 'debugBg'; c.addChild(dbgBg);
    const dbgText = new PIXI.Text('', { fontFamily: 'monospace', fontSize: 11, fill: 0xffffff, align: 'left' });
    dbgText.name = 'debugText'; c.addChild(dbgText);
  }
  return c;
}

function updateNPCSprite(id, npc, now) {
  const c = getOrCreateNPC(id, npc.type, npc.radius, npc.name);
  c.x = npc.renderX;
  c.y = npc.renderY;

  const lavabugSpr = c.getChildByName('lavabugSpr');
  const lavabugOutline = c.getChildByName('lavabugOutline');
  if (npc.renderDir != null) {
    const rot = npc.renderDir - Math.PI / 2;
    if (lavabugSpr) lavabugSpr.rotation = rot;
    if (lavabugOutline) lavabugOutline.rotation = rot;
  }

  const rangeCircle = c.getChildByName('rangeCircle');
  if (rangeCircle) {
    rangeCircle.clear();
    rangeCircle.beginFill(0xff0000, 0.1);
    rangeCircle.drawCircle(0, 0, npc.targeting_range);
    rangeCircle.endFill();
  }

  const dbgBg = c.getChildByName('debugBg');
  const dbgText = c.getChildByName('debugText');
  if (dbgBg && dbgText) {
    const maxHp = npc.maxHealth ?? 100;
    const dmg = Math.round(maxHp - (npc.health ?? maxHp));
    dbgText.text = `dmg: ${dmg}\nstun_time: ${(npc.stun_time ?? 0).toFixed(2)}\nslow: ${npc.slow ?? 0}\nslow_time: ${(npc.slow_time ?? 0).toFixed(2)}\nbleed: ${npc.bleed ?? 0}\nmode: ${npc.mode ?? '—'}`;
    const pad = 4;
    const bw = dbgText.width + pad * 2;
    const bh = dbgText.height + pad * 2;
    const bx = -bw / 2;
    const by = -(npc.radius + bh + 6);
    dbgBg.clear();
    dbgBg.beginFill(0x000000, 0.45);
    dbgBg.drawRect(bx, by, bw, bh);
    dbgBg.endFill();
    dbgText.x = bx + pad;
    dbgText.y = by + pad;
  }

  const hbg = c.getChildByName('hbg');
  const hfill = c.getChildByName('hfill');
  if (hbg && hfill) {
    const bw = 54, bh = 8, bR = 4;
    const bx = -bw / 2, by = npc.radius + 6;
    hbg.clear();
    hbg.lineStyle(1.5, 0x000000, 0.9);
    hbg.beginFill(0x111111, 0.85);
    hbg.drawRoundedRect(bx, by, bw, bh, bR);
    hbg.endFill();

    const maxHp = npc.maxHealth ?? 100;
    const hpct = Math.max(0, Math.min(1, (npc.renderHealth ?? npc.health) / maxHp));
    hfill.clear();
    if (hpct > 0) {
      const hColor = hpct > 0.6 ? 0x44ee66 : hpct > 0.3 ? 0xffcc22 : 0xff2233;
      hfill.beginFill(hColor, 0.95);
      hfill.drawRoundedRect(bx + 1, by + 1, (bw - 2) * hpct, bh - 2, bR - 1);
      hfill.endFill();
      hfill.beginFill(0xffffff, 0.18);
      hfill.drawRoundedRect(bx + 1, by + 1, (bw - 2) * hpct, (bh - 2) * 0.45, bR - 1);
      hfill.endFill();
    }
  }
}

function removeNPCSprite(id) {
  if (npcContainers[id]) {
    npcContainers[id].destroy({ children: true });
    playerLayer.removeChild(npcContainers[id]);
    delete npcContainers[id];
  }
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
  (type === 'earthwave' ? aboveObstacleLayer : projLayer).addChild(c);
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

      for (let i = 0; i < 40; i++) {
        const dot = new PIXI.Graphics();
        const isYellow = i % 3 === 0;
        dot.beginFill(isYellow ? 0xffd700 : 0xffffff, 0.9);
        dot.drawCircle(0, 0, 2.5 + Math.random() * 2);
        dot.endFill();
        dot.name = `cpDot${i}`;
        proj.addChild(dot);
      }

      proj._cpParticles = Array.from({ length: 40 }, (_, i) => {
        const angle = (i / 40) * Math.PI * 2 + Math.random() * 0.3;
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
      const tex=texCache.iceSword;
      const sx=(r*2.118*1.5)/tex.width, sy=(r*1.572*1.5)/tex.height;
      const bladeOutline=buildSpriteOutline(tex,sx,sy,0,0x2266aa,2);
      const blade=new PIXI.Sprite(tex);
      blade.anchor.set(0.5);blade.width=r*2.118*1.5;blade.height=r*1.572*1.5;
      proj.addChild(aura2,ring,bladeOutline,blade); break;
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
      const anim = new PIXI.AnimatedSprite(texCache.shockwaveFrames);
      anim.anchor.set(0.5);
      anim.loop = false;
      anim.autoUpdate = false;
      anim.gotoAndStop(0);
      proj.addChild(anim);
      proj._shockAnim = anim;
      proj._shockBorn = Date.now();
      break;
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
    case 'holysmite': {
      const ringRadius = r;
      const glow = new PIXI.Graphics();
      glow.beginFill(0xffd700, 0.12);
      glow.drawCircle(0, 0, ringRadius);
      glow.endFill();
      glow.lineStyle(1.5, 0xffd700, 0.28);
      glow.drawCircle(0, 0, ringRadius);
      glow.name = 'hsGlow';
      proj.addChild(glow);
      for (let i = 0; i < 12; i++) {
        const sw = new PIXI.Sprite(texCache.holySword);
        sw.anchor.set(0.5);
        sw.width = r*0.8;
        sw.height = r*0.6;
        sw._bsx = sw.scale.x;
        sw._bsy = sw.scale.y;
        sw.x = ringRadius/2;
        sw.y = 0;
        sw.rotation = Math.PI / 2;
        sw.name = `hsword${i}`;
        proj.addChild(sw);
      }
      proj._born = Date.now();
      break;
    }
    case 'rockpush': {
      const fistSize = r * 2.4;
      const outline = new PIXI.Container(); outline.name = 'rfOutline';
      const thick = 3;
      for (const [ox, oy] of [[-thick,0],[thick,0],[0,-thick],[0,thick],[-thick,-thick],[thick,-thick],[-thick,thick],[thick,thick]]) {
        const sh = new PIXI.Sprite(texCache.rockfist);
        sh.anchor.set(0.5); sh.width = fistSize*2; sh.height = fistSize*1.5;
        sh.tint = 0x2a1800; sh.x = ox; sh.y = oy;
        outline.addChild(sh);
      }
      proj.addChild(outline);
      const spr = new PIXI.Sprite(texCache.rockfist);
      spr.anchor.set(0.5);
      spr.width = fistSize*2; spr.height = fistSize*1.5;
      spr.name = 'rfSprite';
      proj.addChild(spr);
      proj._born = Date.now();
      break;
    }
    case 'earthwave': {
      const ewW = r * 5, ewH = r * 3.5, ewThick = 1;
      const shadow = new PIXI.Sprite(texCache.earthWave); shadow.name = 'ewShadow';
      shadow.anchor.set(0.5);
      shadow.width = ewW * 1.05; shadow.height = ewH * 1.05;
      shadow.tint = 0x000000; shadow.alpha = 0.35;
      shadow.x = 5; shadow.y = 15;
      proj.addChild(shadow);
      const outline = new PIXI.Container(); outline.name = 'ewOutline';
      for (const [ox, oy] of [[-ewThick,0],[ewThick,0],[0,-ewThick],[0,ewThick],[-ewThick,-ewThick],[ewThick,-ewThick],[-ewThick,ewThick],[ewThick,ewThick]]) {
        const sh = new PIXI.Sprite(texCache.earthWave);
        sh.anchor.set(0.5); sh.width = ewW; sh.height = ewH;
        sh.tint = 0x000000; sh.x = ox; sh.y = oy;
        outline.addChild(sh);
      }
      proj.addChild(outline);
      const spr = new PIXI.Sprite(texCache.earthWave);
      spr.anchor.set(0.5);
      spr.width = ewW;
      spr.height = ewH;
      spr.name = 'ewSprite';
      proj.addChild(spr);
      const trail = new PIXI.Graphics();
      trail.name = 'ewTrail';
      proj.addChild(trail);
      break;
    }
    case 'lavapool': {
      const g = new PIXI.Graphics(); g.name = 'lavapoolCircle';
      g.beginFill(0xff0000, 0.5); g.drawCircle(0, 0, r); g.endFill();
      g.lineStyle(2, 0xff0000, 1); g.drawCircle(0, 0, r);
      proj.addChild(g);
      proj._born = Date.now();
      break;
    }
    case 'minilavapool': {
      const g = new PIXI.Graphics(); g.name = 'lavapoolCircle';
      g.beginFill(0xff0000, 0.5); g.drawCircle(0, 0, r); g.endFill();
      g.lineStyle(2, 0xff0000, 1); g.drawCircle(0, 0, r);
      proj.addChild(g);
      proj._born = Date.now();
      break;
    }
    case 'lavarock': {
      const g = new PIXI.Graphics(); g.name = 'lavarockCircle';
      g.beginFill(0xff4400, 1); g.drawCircle(0, 0, r); g.endFill();
      proj.addChild(g);
      break;
    }
    case 'lavaball': {
      const g = new PIXI.Graphics(); g.name = 'lavaballCircle';
      g.beginFill(0xff4400, 1); g.drawCircle(0, 0, r); g.endFill();
      proj.addChild(g);
      break;
    }
    default: {
      const def=new PIXI.Graphics();def.name='defCircle';def.beginFill(0x8888ff,0.4);def.drawCircle(0,0,r);def.endFill();proj.addChild(def);
    }
  }
  //const def=new PIXI.Graphics();def.name='defCircle';def.beginFill(0x8888ff,0.4);def.drawCircle(0,0,r);def.endFill();proj.addChild(def);
  return proj;
}

function updateProjSprite(id, p, now) {
  const c = getOrCreateProj(id, p.type, p.radius);
  if (p.type !== 'crusadecharge') {
    c.x = p.renderX;
    c.y = p.renderY;
  }
  const r = Math.max(5, p.radius || 10);

  const def = c.getChildByName('defHitbox');
  if (def) { def.clear(); def.beginFill(0x8888ff, 0.7); def.drawCircle(0, 0, r); def.endFill(); }

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
      if (c._shockAnim) {
        const frameCount = texCache.shockwaveFrames.length;
        const raw = (now - c._shockBorn) / 40 - 6;
        const frame = Math.min(Math.floor(Math.max(0, raw)), frameCount - 1);
        c._shockAnim.gotoAndStop(frame);
        c._shockAnim.width  = r * 2.9;
        c._shockAnim.height = r * 3.3;
        const FADE_MS = 500;
        const fadeStart = raw - (frameCount - 1);
        c._shockAnim.alpha = fadeStart > 0 ? Math.max(0, 1 - fadeStart * 40 / FADE_MS) : 1;
      }
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
    case 'holysmite': {
      const ringRadius = r * 0.3;
      const elapsed = now - c._born;
      const t = Math.min(elapsed / 1000, 1);
      const et = 1 - Math.pow(1 - t, 3); // ease-out cubic

      // Phase 2: jut outward after 1 second
      const jutElapsed = Math.max(0, elapsed - 1000);
      const jutT = Math.min(jutElapsed / 120, 1); // 80ms jut duration
      const jutDist = jutT * r * 0.4;

      // Fire explosion burst on the first frame t hits 1
      if (elapsed >= 1000 && !c._exploded) {
        c._exploded = true;
        const cx = c.x, cy = c.y;
        // Golden shockwave ring
        const ring = new PIXI.Graphics();
        ring.lineStyle(3, 0xffd700, 0.9);
        ring.drawCircle(0, 0, ringRadius);
        ring.x = cx; ring.y = cy;
        trailLayer.addChild(ring);
        frenzyTrails.push({ g: ring, born: now, ttl: 350, scaleEnd: 3.5, fadeOnly: false });
        // Burst particles
        for (let i = 0; i < 20; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = r * (1.5 + Math.random() * 2.5);
          const dot = new PIXI.Graphics();
          const col = [0xffd700, 0xfff8a0, 0xffffff, 0xffe066][Math.floor(Math.random() * 4)];
          dot.beginFill(col, 1.0); dot.drawCircle(0, 0, 2 + Math.random() * 2.5); dot.endFill();
          dot.x = cx + Math.cos(angle) * ringRadius * 0.5;
          dot.y = cy + Math.sin(angle) * ringRadius * 0.5;
          dot._vx = Math.cos(angle) * speed; dot._vy = Math.sin(angle) * speed;
          trailLayer.addChild(dot);
          frenzyTrails.push({ g: dot, born: now, ttl: 400 + Math.random() * 200, isHsParticle: true });
        }
        // Central flash
        const flash = new PIXI.Graphics();
        flash.beginFill(0xffffff, 0.9); flash.drawCircle(0, 0, r * 0.8); flash.endFill();
        flash.x = cx; flash.y = cy;
        trailLayer.addChild(flash);
        frenzyTrails.push({ g: flash, born: now, ttl: 150, fadeOnly: true });
      }

      for (let i = 0; i < 12; i++) {
        const sw = c.getChildByName(`hsword${i}`);
        if (!sw) continue;
        const targetAngle = (i / 12) * Math.PI * 2;
        const angle = t < 1 ? et * targetAngle : targetAngle;
        const rad = t < 1 ? ringRadius : ringRadius + jutDist;
        const swordScale = t < 1 ? 1 : 1 + jutT*0.5;
        sw.x = Math.cos(angle) * rad;
        sw.y = Math.sin(angle) * rad;
        sw.rotation = angle + Math.PI / 2;
        sw.scale.set(sw._bsx * swordScale, sw._bsy * swordScale);
      }
      break;
    }
    case 'rockpush': {
      const dir = p.dir || 0;
      const age = now - (c._born || now);
      c.alpha = age < 200 ? 1 : Math.max(0, 1 - (age - 200) / 500);
      const spr = c.getChildByName('rfSprite');
      if (spr) spr.rotation = dir;
      const outline = c.getChildByName('rfOutline');
      if (outline) {
        outline.rotation = dir;
        for (const ch of outline.children) ch.alpha = age < 200 ? 1 : Math.max(0, 1 - (age - 200) / 500);
      }
      if (trailLayer) {
        const ROCK_COLORS = [0x8b5a2b, 0x7a4a20, 0xa0622a, 0x6b3d18, 0xb87840, 0x5c3010];
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const spread = r * 1.0;
          const bx = p.renderX - Math.cos(dir) * r * 1.2 + (Math.random() - 0.5) * spread;
          const by = p.renderY - Math.sin(dir) * r * 1.2 + (Math.random() - 0.5) * spread;
          const dot = new PIXI.Graphics();
          const col = ROCK_COLORS[Math.floor(Math.random() * ROCK_COLORS.length)];
          const pr = 3 + Math.random() * 6;
          dot.beginFill(col, 1); dot.drawCircle(0, 0, pr); dot.endFill();
          dot.lineStyle(1, 0x2a2018, 0.5); dot.drawCircle(0, 0, pr);
          dot.x = bx; dot.y = by;
          trailLayer.addChild(dot);
          frenzyTrails.push({ g: dot, born: now, ttl: 300 + Math.random() * 200, fadeOnly: true });
        }
      }
      break;
    }
    case 'earthwave': {
      const dir = p.dir || 0;
      const spr = c.getChildByName('ewSprite');
      if (spr) spr.rotation = dir;
      const outline = c.getChildByName('ewOutline');
      if (outline) outline.rotation = dir;
      const shadow = c.getChildByName('ewShadow');
      if (shadow) shadow.rotation = dir;

      // shed rock chunks into the trail layer
      if (trailLayer) {
        const ROCK_COLORS = [0x7a6a50, 0x6b5c45, 0x8a7a66, 0x9a8a78, 0x55473a, 0xb0a090];
        const count = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
          const spread = r * 1.4;
          const bx = p.renderX - Math.cos(dir) * r * 0.5 + (Math.random() - 0.5) * spread;
          const by = p.renderY - Math.sin(dir) * r * 0.5 + (Math.random() - 0.5) * spread;
          const dot = new PIXI.Graphics();
          const col = ROCK_COLORS[Math.floor(Math.random() * ROCK_COLORS.length)];
          const pr = 5 + Math.random() * 9;
          dot.beginFill(col, 1);
          dot.drawCircle(0, 0, pr);
          dot.endFill();
          dot.lineStyle(1, 0x2a2018, 0.5);
          dot.drawCircle(0, 0, pr);
          dot.x = bx;
          dot.y = by;
          trailLayer.addChild(dot);
          frenzyTrails.push({ g: dot, born: now, ttl: 400 + Math.random() * 300, fadeOnly: true });
        }
      }
      break;
    }
    case 'minilavapool': {
      if (!c._born) c._born = now;
      const elapsed = now - c._born;
      if (elapsed >= 500 && !c._exploded) {
        c._exploded = true;
        const cx = c.x, cy = c.y;
        const ring = new PIXI.Graphics();
        ring.lineStyle(4, 0xff4400, 0.9);
        ring.drawCircle(0, 0, r);
        ring.x = cx; ring.y = cy;
        trailLayer.addChild(ring);
        frenzyTrails.push({ g: ring, born: now, ttl: 400, scaleEnd: 4, fadeOnly: false });
        for (let i = 0; i < 20; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = r * (1.5 + Math.random() * 2.5);
          const dot = new PIXI.Graphics();
          const col = [0xff4400, 0xff8800, 0xffcc44, 0xcc2200, 0xff2200][Math.floor(Math.random() * 5)];
          dot.beginFill(col, 1.0); dot.drawCircle(0, 0, 2 + Math.random() * 3); dot.endFill();
          dot.x = cx + Math.cos(angle) * r * 0.5;
          dot.y = cy + Math.sin(angle) * r * 0.5;
          dot._vx = Math.cos(angle) * speed; dot._vy = Math.sin(angle) * speed;
          trailLayer.addChild(dot);
          frenzyTrails.push({ g: dot, born: now, ttl: 450 + Math.random() * 200, isHsParticle: true });
        }
        const flash = new PIXI.Graphics();
        flash.beginFill(0xff6600, 0.85); flash.drawCircle(0, 0, r * 1.5); flash.endFill();
        flash.x = cx; flash.y = cy;
        trailLayer.addChild(flash);
        frenzyTrails.push({ g: flash, born: now, ttl: 200, fadeOnly: true });
      }
      break;
    }
    case 'lavapool': {
      if (!c._born) c._born = now;
      const elapsed = now - c._born;
      if (elapsed >= 1000 && !c._exploded) {
        c._exploded = true;
        const cx = c.x, cy = c.y;
        const ring = new PIXI.Graphics();
        ring.lineStyle(4, 0xff4400, 0.9);
        ring.drawCircle(0, 0, r);
        ring.x = cx; ring.y = cy;
        trailLayer.addChild(ring);
        frenzyTrails.push({ g: ring, born: now, ttl: 400, scaleEnd: 4, fadeOnly: false });
        for (let i = 0; i < 20; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = r * (1.5 + Math.random() * 2.5);
          const dot = new PIXI.Graphics();
          const col = [0xff4400, 0xff8800, 0xffcc44, 0xcc2200, 0xff2200][Math.floor(Math.random() * 5)];
          dot.beginFill(col, 1.0); dot.drawCircle(0, 0, 2 + Math.random() * 3); dot.endFill();
          dot.x = cx + Math.cos(angle) * r * 0.5;
          dot.y = cy + Math.sin(angle) * r * 0.5;
          dot._vx = Math.cos(angle) * speed; dot._vy = Math.sin(angle) * speed;
          trailLayer.addChild(dot);
          frenzyTrails.push({ g: dot, born: now, ttl: 450 + Math.random() * 200, isHsParticle: true });
        }
        const flash = new PIXI.Graphics();
        flash.beginFill(0xff6600, 0.85); flash.drawCircle(0, 0, r * 1.5); flash.endFill();
        flash.x = cx; flash.y = cy;
        trailLayer.addChild(flash);
        frenzyTrails.push({ g: flash, born: now, ttl: 200, fadeOnly: true });
      }
      break;
    }
  }
  const defCircle = c.getChildByName('defCircle');
  if (defCircle) { defCircle.clear(); defCircle.beginFill(0x8888ff, 0.6); defCircle.drawCircle(0, 0, r); defCircle.endFill(); }
  const lavarockCircle = c.getChildByName('lavarockCircle');
  if (lavarockCircle) { lavarockCircle.clear(); lavarockCircle.beginFill(0xff4400, 1); lavarockCircle.drawCircle(0, 0, r); lavarockCircle.endFill(); }
  const lavaballCircle = c.getChildByName('lavaballCircle');
  if (lavaballCircle) { lavaballCircle.clear(); lavaballCircle.beginFill(0xff4400, 1); lavaballCircle.drawCircle(0, 0, r); lavaballCircle.endFill(); }
  const lavapoolCircle = c.getChildByName('lavapoolCircle');
  if (lavapoolCircle) {
    lavapoolCircle.clear();
    if (c._exploded) {
      lavapoolCircle.beginFill(0xff4400, 1); lavapoolCircle.drawCircle(0, 0, r); lavapoolCircle.endFill();
    } else {
      lavapoolCircle.beginFill(0xff0000, 0.5); lavapoolCircle.drawCircle(0, 0, r); lavapoolCircle.endFill(); lavapoolCircle.lineStyle(2, 0xff0000, 1); lavapoolCircle.drawCircle(0, 0, r);
    }
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
  let display;
  if (ob.type === 'bush') {
    const c = new PIXI.Container();
    const s = new PIXI.Sprite(texCache.bush);
    s.anchor.set(0.5);
    const r = ob.radius;
    s.width = r*6; s.height = r*4;
    c.addChild(s);
    display = c;
  } else {
    const s = new PIXI.Sprite(texCache.rock);
    s.anchor.set(0.5); s.width = ob.radius * (100/42); s.height = ob.radius * (100/42);
    display = s;
  }
  display.x = ob.x; display.y = ob.y;
  (ob.type === 'bush' ? bushLayer : obstacleLayer).addChild(display);
  obstacleSprites[id] = display;
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

  const mmViewRect = new PIXI.Graphics();
  uiContainer.addChild(mmViewRect);

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
    cpBg, cpFill, cpText, cpBarW, cpBarH, cpBarX, cpBarY, mmCpDiamond, mmViewRect,
    tdmScore0, tdmSep, tdmScore1, cpScore0, cpScore1,
    hpStatText, manaStatText };

  chatContainer = new PIXI.Container();
  chatContainer.alpha = 0.5;
  uiContainer.addChild(chatContainer);
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
const uiMmNpcDots = {};

function drawUI(now, pl) {
  if (!_ui) return;
  dbgSet('dbg-fps', `⬤ FPS: ${Math.round(app.ticker.FPS)}`, app.ticker.FPS > 50 ? 'ok' : app.ticker.FPS > 30 ? 'warn' : 'error');
  const { skillFills, skillBadges, skillLabels, skillBgs, lbBg, lbTitle, lbRows,
    cpBg, cpFill, cpText, mmCpDiamond, mmViewRect, miniMap,
    tdmScore0, tdmSep, tdmScore1, cpScore0, cpScore1,
    hpStatText, manaStatText,
    sbW, sbH, sbGap, mmSize, lbW, cpBarW, cpBarH } = _ui;

  const W = app.screen.width, H = app.screen.height;
  const totalW = sbW * 3 + sbGap * 2;
  const startX = W / 2 - totalW / 2, barY = H - 42;
  const mmX = 10, mmY = H - mmSize - 10;
  const lbX = W - lbW - 10, lbY = 10;
  const cpBarX = W / 2 - cpBarW / 2, cpBarY = 14;
  const mmStatX = mmX + mmSize + 10;

  skillBadges.forEach((badge, i) => {
    badge.clear();
    badge.lineStyle(1.5, 0x000000, 0.7);
    badge.beginFill(0x111111, 0.88);
    badge.drawRoundedRect(startX + i * (sbW + sbGap) + sbW / 2 - 11, barY - 26, 22, 20, 5);
    badge.endFill();
  });
  skillLabels.forEach((t, i) => {
    t.x = startX + sbW / 2 + i * (sbW + sbGap);
    t.y = barY - 16;
  });
  skillBgs.forEach((bg, i) => {
    bg.clear();
    bg.lineStyle(1.5, 0x000000, 0.9);
    bg.beginFill(0x0d0d0d, 0.82);
    bg.drawRoundedRect(startX + i * (sbW + sbGap), barY, sbW, sbH, 7);
    bg.endFill();
  });
  miniMap.clear();
  miniMap.beginFill(0x324e2a, 0.5);
  miniMap.drawRect(mmX + 1, mmY + 1, mmSize - 2, mmSize - 2);
  miniMap.endFill();
  hpStatText.x = mmStatX;
  hpStatText.y = mmY + mmSize - 38;
  manaStatText.x = mmStatX;
  manaStatText.y = mmY + mmSize - 18;
  lbTitle.x = lbX + 10;
  lbTitle.y = lbY + 8;
  lbRows.forEach(({ row, kills }, i) => {
    row.x = lbX + 10;
    row.y = lbY + 28 + i * 26;
    kills.x = lbX + lbW - 10;
    kills.y = lbY + 28 + i * 26;
  });
  cpText.x = W / 2;
  cpText.y = cpBarY + cpBarH / 2;
  cpScore0.x = cpBarX - 10;
  cpScore0.y = cpBarY + cpBarH / 2;
  cpScore1.x = cpBarX + cpBarW + 10;
  cpScore1.y = cpBarY + cpBarH / 2;

  const isMySpectator = !!pl.isSpectator;
  hpStatText.visible = !isMySpectator;
  manaStatText.visible = !isMySpectator;
  skillBadges.forEach(b => { b.visible = !isMySpectator; });
  skillLabels.forEach(l => { l.visible = !isMySpectator; });
  skillBgs.forEach(b => { b.visible = !isMySpectator; });
  skillFills.forEach(f => { if (isMySpectator) f.clear(); });

  if (!isMySpectator) {
    const hp = Math.round(pl.renderHealth ?? pl.health ?? 0);
    const mp = Math.round(pl.renderMana ?? pl.mana ?? 0);
    const hpStr = `HP: ${hp}`;
    const mpStr = `MP: ${mp}`;
    if (hpStatText.text !== hpStr) hpStatText.text = hpStr;
    if (manaStatText.text !== mpStr) manaStatText.text = mpStr;
    const hpPct = hp / 100;
    hpStatText.style.fill = hpPct > 0.6 ? 0x44ee66 : hpPct > 0.3 ? 0xffcc22 : 0xff4444;
  }

  // ── Skill cooldown bars ── polished fill with gloss
  const cds = [pl.renderSkill1cd ?? pl.skill1cd, pl.renderSkill2cd ?? pl.skill2cd, pl.renderSkill3cd ?? pl.skill3cd];
  if (!isMySpectator) cds.forEach((cd, i) => {
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
    if (p.isSpectator) continue;
    const isEnemy = (gamemode === 1 || gamemode === 2) && players[myId] && p.team !== players[myId].team;
    const isAlly  = (gamemode === 1 || gamemode === 2) && players[myId] && p.team === players[myId].team && id !== myId;
    const mmViewerIsSpectator = !!players[myId]?.isSpectator;
    if (!mmViewerIsSpectator && p.isHidden && id !== myId && !isAlly) continue;
    const mmCx = mmX + p.renderX * mmScale;
    const mmCy = mmY + p.renderY * mmScale;
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

  for (const id of Object.keys(uiMmNpcDots)) {
    if (!npcs[id]) { uiContainer.removeChild(uiMmNpcDots[id]); uiMmNpcDots[id].destroy(); delete uiMmNpcDots[id]; }
  }
  for (const [id, npc] of Object.entries(npcs)) {
    if (npc.name !== 'lavabug') continue;
    if (!uiMmNpcDots[id]) {
      const g = new PIXI.Graphics();
      uiContainer.addChild(g);
      uiMmNpcDots[id] = g;
    }
    const g = uiMmNpcDots[id];
    const dx = mmX + npc.renderX * mmScale;
    const dy = mmY + npc.renderY * mmScale;
    const r = 5;
    g.clear();
    g.beginFill(0xff0000, 1);
    g.moveTo(dx, dy - r); g.lineTo(dx + r, dy);
    g.lineTo(dx, dy + r); g.lineTo(dx - r, dy);
    g.closePath(); g.endFill();
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

  mmViewRect.clear();
  const mmViewerPl = players[myId];
  if (mmViewerPl) {
    const mmZoom = Math.max(zoom, getMinZoom());
    const vpW = (app.screen.width / mmZoom) * mmScale;
    const vpH = (app.screen.height / mmZoom) * mmScale;
    const vpX = mmX + (mmViewerPl.renderX - app.screen.width / 2 / mmZoom) * mmScale;
    const vpY = mmY + (mmViewerPl.renderY - app.screen.height / 2 / mmZoom) * mmScale;
    mmViewRect.lineStyle(1, 0xffffff, 0.8);
    mmViewRect.beginFill(0xffffff, 0.15);
    mmViewRect.drawRect(vpX, vpY, vpW, vpH);
    mmViewRect.endFill();
  }

  const sorted = Object.entries(players).filter(([, p]) => !p.isSpectator).sort((a, b) => (b[1].killcount ?? 0) - (a[1].killcount ?? 0)).slice(0, 10);
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

  const uiZoom = Math.max(zoom, getMinZoom());
  for (const [id, p] of Object.entries(players)) {
    const sx = p.renderX * uiZoom + mapContainer.x;
    const sy = p.renderY * uiZoom + mapContainer.y;
    const { nt, hbg, hfill, mbg, mfill } = getOrCreatePlayerUI(id);

    const isAlly = (gamemode === 1 || gamemode === 2) && players[myId] && p.team === players[myId].team && id !== myId;
    const uiViewerIsSpectator = !!players[myId]?.isSpectator;
    if (p.isSpectator || (!uiViewerIsSpectator && p.isHidden && id !== myId && !isAlly)) {
      nt.visible = false; hbg.visible = false; hfill.visible = false;
      mbg.visible = false; mfill.visible = false;
      continue;
    }
    nt.visible = true; hbg.visible = true; hfill.visible = true;

    let name = p.name || '?';
    if (name.length > 18) name = name.substring(0, 18) + '…';
    const nameText = name + (p.killcount > 0 ? ` ☠${p.killcount}` : '');
    if (nt.text !== nameText) nt.text = nameText;
    nt.style.fill = id === myId ? 0x44ee66 : isAlly ? 0xaaccff : 0xff4444;
    nt.x = sx;
    nt.y = sy - 42 * uiZoom;

    // ── Health bar — pill style, gloss highlight ──
    const bw = 54 * uiZoom, bh = 8 * uiZoom, bR = 4;
    const bx = sx - bw / 2, by = sy + 26 * uiZoom;

    hbg.clear();
    // track
    hbg.lineStyle(1.5*uiZoom, 0x000000, 0.9);
    hbg.beginFill(0x111111, 0.85);
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
      const mby = by + bh + 3 * uiZoom, mbh = 8 * uiZoom, mbR = 3;
      mbg.clear();
      mbg.lineStyle(1.5*uiZoom, 0x000000, 0.85);
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
