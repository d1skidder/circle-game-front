// ═══════════════════════════════════════════════════
//  ARCNE.IO  —  PixiJS WebGL frontend
//  Controls: WASD/arrows=move | Q,E,F=skills | LMB=melee
// ═══════════════════════════════════════════════════

const WS_URL = 'wss://circle-game-nzws.onrender.com';
const WORLD = 4000;
const SERVER_TICK = 100;

const CLASS_STYLES = {
  fire:      { body: 0xd14821, bodyHi: 0xff7744, arm: 0xb03010, outline: 0x661500 },
  ice:       { body: 0x88ddff, bodyHi: 0xccf4ff, arm: 0x44aadd, outline: 0x2266aa },
  earth:     { body: 0x7a6a50, bodyHi: 0x9a8a70, arm: 0x55473a, outline: 0x2a2018 },
  blood:     { body: 0xaa1122, bodyHi: 0xff3355, arm: 0x880011, outline: 0x440008 },
  lightning: { body: 0xffee22, bodyHi: 0xffff99, arm: 0xddcc00, outline: 0x886600 },
};

// ── STATE ────────────────────────────────────────
let ws = null, myId = null, myClass = null, myName = '';
let dead = false, killcount = 0, gameStartTime = 0;
let players = {}, projectiles = {}, obstacles = {};
let zoom = 1.1, direction = 0;
const pressed = {};
let lastMoveSend = 0;
let app, worldContainer, uiContainer;
let playerContainers = {}, projContainers = {}, obstacleSprites = {};
let texCache = {};
let pixiReady = false;

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

  document.getElementById('join-btn').addEventListener('click', () => {
    myName = document.getElementById('name-input').value.trim();
    myClass = selectedClass;
    if (!myName || !myClass) return;
    document.getElementById('joinScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    gameStartTime = Date.now();
    dead = false; killcount = 0;
    players = {}; projectiles = {}; obstacles = {};
    clearScene();
    // init pixi now if not done yet
    if (!pixiReady) initPixi();
    connectWS();
  });

  document.getElementById('respawn-btn').addEventListener('click', () => {
    document.getElementById('deathScreen').style.display = 'none';
    document.getElementById('joinScreen').style.display = 'flex';
    document.getElementById('gameScreen').style.display = 'none';
    if (ws) { ws.close(); ws = null; }
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
function initPixi() {
  pixiReady = true;
  app = new PIXI.Application({
    resizeTo: document.getElementById('gameScreen'),
    backgroundColor: 0x3a8a3a,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  document.getElementById('gameScreen').appendChild(app.view);

  worldContainer = new PIXI.Container();
  uiContainer    = new PIXI.Container();
  app.stage.addChild(worldContainer, uiContainer);

  // world background
  const bg = new PIXI.Graphics();
  bg.beginFill(0x3a8a3a);
  bg.drawRect(0, 0, WORLD, WORLD);
  bg.endFill();
  bg.lineStyle(1, 0x2a7020, 0.4);
  for (let x = 0; x <= WORLD; x += 100) { bg.moveTo(x,0); bg.lineTo(x,WORLD); }
  for (let y = 0; y <= WORLD; y += 100) { bg.moveTo(0,y); bg.lineTo(WORLD,y); }
  bg.lineStyle(5, 0x1a4a1a, 1);
  bg.drawRect(0, 0, WORLD, WORLD);
  worldContainer.addChild(bg);

  generateTextures();
  app.ticker.add(gameLoop);
}

function clearScene() {
  if (!worldContainer) return;
  while (worldContainer.children.length > 1) worldContainer.removeChildAt(1);
  playerContainers = {}; projContainers = {}; obstacleSprites = {};
}

// ═══════════════════════════════════════════════════
//  TEXTURE GENERATION
// ═══════════════════════════════════════════════════
function generateTextures() {
  texCache.sword         = makeSwordTexture(false);
  texCache.enhancedSword = makeSwordTexture(true);
  texCache.iceSword      = makeIceSwordTexture();
  texCache.rock          = makeRockTexture();
}

function bakeGraphic(g, w, h, cx, cy) {
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  g.x = cx; g.y = cy;
  app.renderer.render(g, { renderTexture: rt });
  g.destroy();
  return rt;
}

function makeSwordTexture(enhanced) {
  // Super simple: rounded-tip rectangle blade + short handle
  const g = new PIXI.Graphics();
  const bladeCol  = enhanced ? 0xffe07a : 0xccccdd;
  const guardCol  = enhanced ? 0xbb8800 : 0x666677;
  const handleCol = enhanced ? 0x7a3a00 : 0x2a1a0e;

  // blade — thin rectangle, rounded top
  g.lineStyle(1.5, 0x000000, 0.35);
  g.beginFill(bladeCol, 1);
  g.drawRoundedRect(-5, -52, 10, 56, 5);
  g.endFill();
  // guard — wider flat bar
  g.lineStyle(1.5, 0x000000, 0.35);
  g.beginFill(guardCol, 1);
  g.drawRoundedRect(-11, 4, 22, 6, 2);
  g.endFill();
  // handle
  g.lineStyle(1, 0x000000, 0.25);
  g.beginFill(handleCol, 1);
  g.drawRoundedRect(-4, 10, 8, 20, 2);
  g.endFill();
  // pommel
  g.beginFill(guardCol, 1);
  g.drawCircle(0, 32, 5);
  g.endFill();

  return bakeGraphic(g, 40, 100, 20, 60);
}

function makeIceSwordTexture() {
  const g = new PIXI.Graphics();
  g.lineStyle(1.5, 0x000000, 0.35);
  g.beginFill(0xaaddff, 1);
  g.drawRoundedRect(-5, -52, 10, 56, 5);
  g.endFill();
  g.lineStyle(1.5, 0x000000, 0.35);
  g.beginFill(0x5599bb, 1);
  g.drawRoundedRect(-11, 4, 22, 6, 2);
  g.endFill();
  g.lineStyle(1, 0x000000, 0.25);
  g.beginFill(0x224466, 1);
  g.drawRoundedRect(-4, 10, 8, 20, 2);
  g.endFill();
  g.beginFill(0x5599bb, 1);
  g.drawCircle(0, 32, 5);
  g.endFill();
  return bakeGraphic(g, 40, 100, 20, 60);
}

function makeRockTexture() {
  const g = new PIXI.Graphics();
  const r = 46;
  // shadow
  g.beginFill(0x000000, 0.18);
  g.drawEllipse(52, 96, r*0.9, r*0.25);
  g.endFill();
  // octagon
  g.lineStyle(2.5, 0x223322, 0.9);
  g.beginFill(0x556644, 1);
  const sides = 8;
  g.moveTo(52 + r * Math.cos(-Math.PI/2), 50 + r * Math.sin(-Math.PI/2));
  for (let i = 1; i <= sides; i++) {
    const ang = -Math.PI/2 + (i / sides) * Math.PI * 2;
    g.lineTo(52 + r * Math.cos(ang), 50 + r * Math.sin(ang));
  }
  g.endFill();
  return bakeGraphic(g, 104, 104, 0, 0);
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
    dbgSet('dbg-id', '⬤ Player ID: joining...', 'warn');
    ws.send(JSON.stringify({ type: 'join', name: myName, class: myClass }));
    setInterval(() => {
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
    dbgSet('dbg-id', '⬤ Player ID: failed', 'error');
  };

  ws.onclose = () => {
    dbgSet('dbg-ws', '⬤ WebSocket: disconnected', 'error');
  };
}

function handleMessage(msg) {
  const now = Date.now();
  if (msg.type === 'init') {
    myId = msg.id;
    dbgSet('dbg-id', `⬤ Player ID: ${msg.id.substring(0,8)}...`, 'ok');
  }

  if (msg.type === 'players') {
    msg.players.forEach(p => {
      if (!players[p.id]) {
        players[p.id] = { ...p, renderX: p.x, renderY: p.y, renderDir: p.dir,
          renderHealth: p.health, renderMana: p.mana,
          renderSkill1cd: p.skill1cd, renderSkill2cd: p.skill2cd, renderSkill3cd: p.skill3cd,
          lastUpdateTime: now };
      } else {
        Object.assign(players[p.id], p, { lastUpdateTime: now });
      }
    });
    for (const id in players) {
      if (players[id].lastUpdateTime !== now) {
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
        Object.assign(projectiles[p.id], p, { lastUpdateTime: now });
      }
    });
    for (const id in projectiles) {
      if (projectiles[id].lastUpdateTime !== now) { removeProjSprite(id); delete projectiles[id]; }
    }
  }

  if (msg.type === 'obstacles') {
    msg.obstacles.forEach(p => { if (!obstacles[p.id]) obstacles[p.id] = { ...p }; });
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
});
document.addEventListener('mousedown', e => {
  // only send attack when game is running, not on lobby clicks
  if (myId && !dead && document.getElementById('gameScreen').style.display === 'block')
    sendAttack('basicMelee');
});
document.addEventListener('wheel', e => {
  zoom = e.deltaY > 0 ? Math.min(2.0, zoom + 0.05) : Math.max(0.3, zoom - 0.05);
});
function sendAttack(move) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: 'attack', move, dir: direction }));
}

// ═══════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════
function gameLoop() {
  const now = Date.now();
  if (!myId) return;
  if (now - 2000 > gameStartTime && !players[myId] && !dead) { triggerDeath(); return; }

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

  // lerp
  for (const p of Object.values(players)) {
    const t = Math.min((now - p.lastUpdateTime) / SERVER_TICK, 1);
    p.renderX = lerp(p.last_x ?? p.x, p.x, t);
    p.renderY = lerp(p.last_y ?? p.y, p.y, t);
    p.renderDir = lerpAngle(p.last_dir ?? p.dir, p.dir, t);
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

  worldContainer.scale.set(zoom);
  worldContainer.x = app.screen.width  / 2 - pl.renderX * zoom;
  worldContainer.y = app.screen.height / 2 - pl.renderY * zoom;

  for (const [id, ob] of Object.entries(obstacles)) getOrCreateObstacle(id, ob);
  for (const [id, p]  of Object.entries(projectiles)) updateProjSprite(id, p, now);
  for (const id of Object.keys(projContainers))    { if (!projectiles[id]) removeProjSprite(id); }
  for (const [id, p]  of Object.entries(players))  updatePlayerSprite(id, p, now);
  for (const id of Object.keys(playerContainers))  { if (!players[id]) removePlayerSprite(id); }

  drawUI(now, pl);
}

// ═══════════════════════════════════════════════════
//  PLAYER SPRITES
// ═══════════════════════════════════════════════════
function updatePlayerSprite(id, p, now) {
  if (!playerContainers[id]) {
    const c = new PIXI.Container();
    buildPlayerContainer(c, p.gameClass);
    worldContainer.addChild(c);
    playerContainers[id] = c;
  }
  const c = playerContainers[id];
  const st = CLASS_STYLES[p.gameClass] || CLASS_STYLES.fire;
  c.x = p.renderX; c.y = p.renderY;

  const facing = p.renderDir ?? p.dir;
  // Sword swing: starts offset -PI*0.7 from facing, sweeps forward to +PI*0.3
  // giving a clean side-to-side slash arc
  let swingOffset = -Math.PI * 0.7; // resting position (sword held back-right)
  if (p.isHitting) {
    const elapsed = now - p.timeFromLastHit;
    const progress = Math.min(elapsed / 400, 1);
    // easeOut swing: fast start, slow end
    const eased = 1 - Math.pow(1 - progress, 2);
    swingOffset = -Math.PI * 0.7 + eased * Math.PI * 1.0;
  }
  const a = facing + swingOffset;

  // Sword held with both hands, perpendicular to facing direction
  // Both arms reach forward toward the hilt
  const sword = c.getChildByName('sword');
  if (sword) {
    if (p.basicEnhanced) sword.texture = texCache.enhancedSword;
    else if (p.gameClass === 'ice') sword.texture = texCache.iceSword;
    else sword.texture = texCache.sword;
    // sword sits in front of player, blade perpendicular to facing
    const handDist = 26;
    sword.x = Math.cos(a) * handDist;
    sword.y = Math.sin(a) * handDist;
    // blade is perpendicular: rotate 90 degrees from facing
    sword.rotation = a; // blade runs left-right across facing direction
    sword.scale.set(p.basicEnhanced ? 1.2 : 1.0);
  }

  // arms — both reach forward toward the sword hilt
  ['arm1','arm2'].forEach((name, idx) => {
    const arm = c.getChildByName(name);
    if (!arm) return;
    arm.clear();
    // both arms angle forward, slightly apart (one slightly left, one slightly right of center)
    const spread = (idx === 0 ? -0.18 : 0.18);
    const armDist = 20;
    const ax = Math.cos(a + spread) * armDist;
    const ay = Math.sin(a + spread) * armDist;
    arm.lineStyle(2, 0x000000, 0.55);
    arm.beginFill(st.arm, 1);
    arm.drawCircle(ax, ay, 7);
    arm.endFill();
  });

  // aura
  const aura = c.getChildByName('aura');
  if (aura) {
    aura.clear();
    if (p.isFrenzy) {
      const r = 42 + Math.sin(now/130)*5;
      aura.lineStyle(2,0xff0033,0.6); aura.drawCircle(0,0,r);
      aura.lineStyle(1,0xff0033,0.3); aura.drawCircle(0,0,r+7);
      aura.beginFill(0xff0033,0.1); aura.drawCircle(0,0,r); aura.endFill();
    } else if (p.isLightningSpeed) {
      const r = 42 + Math.sin(now/130)*5;
      aura.lineStyle(2,0xffee22,0.7); aura.drawCircle(0,0,r);
      aura.lineStyle(1,0xffffff,0.3); aura.drawCircle(0,0,r+5);
      aura.beginFill(0xffee22,0.12); aura.drawCircle(0,0,r); aura.endFill();
      aura.lineStyle(1.5,0xffffff,0.5);
      for (let i=0;i<6;i++){const ang=now/200+i*Math.PI/3;aura.moveTo(Math.cos(ang)*(r-4),Math.sin(ang)*(r-4));aura.lineTo(Math.cos(ang)*(r+6),Math.sin(ang)*(r+6));}
    }
  }

  // armor
  const armor = c.getChildByName('armor');
  if (armor) {
    armor.clear();
    if (p.isInvincible) {
      const t2 = now/600;
      armor.lineStyle(3,0xaaaaaa,0.7); armor.drawCircle(0,0,28);
      armor.lineStyle(2,0x888888,0.5); armor.drawCircle(0,0,33);
      for (let i=0;i<6;i++){
        const ang=t2+i*Math.PI/3;
        armor.lineStyle(0); armor.beginFill(0xbbbbcc,0.55);
        armor.moveTo(Math.cos(ang)*22,Math.sin(ang)*22);
        armor.lineTo(Math.cos(ang+0.4)*32,Math.sin(ang+0.4)*32);
        armor.lineTo(Math.cos(ang+0.55)*32,Math.sin(ang+0.55)*32);
        armor.lineTo(Math.cos(ang+0.15)*22,Math.sin(ang+0.15)*22);
        armor.closePath(); armor.endFill();
      }
    }
  }

  // nametag
  const nt = c.getChildByName('nametag');
  if (nt) {
    let name = p.name||'?'; if(name.length>18) name=name.substring(0,18)+'…';
    nt.text = name+(p.killcount>0?` ☠${p.killcount}`:'');
    nt.style.fill = id===myId ? 0xaaccff : 0xffffff;
  }

  // hp bar
  const hpBar = c.getChildByName('hpbar');
  if (hpBar) {
    hpBar.clear();
    const pct = Math.max(0,Math.min(1,(p.renderHealth??p.health)/100));
    const col = pct>0.6?0x44ee66:pct>0.3?0xffcc22:0xff2233;
    hpBar.beginFill(col,0.95); hpBar.drawRoundedRect(-26,26,52*pct,6,3); hpBar.endFill();
  }

  // mp bar (local only)
  const mpBar = c.getChildByName('mpbar');
  if (mpBar) {
    mpBar.clear();
    if (id===myId) {
      const pct=Math.max(0,Math.min(1,(p.renderMana??p.mana)/100));
      mpBar.beginFill(0x4488ff,0.9); mpBar.drawRoundedRect(-26,34,52*pct,5,3); mpBar.endFill();
    }
  }

  if (id===myId) killcount = p.killcount??0;
}

function buildPlayerContainer(c, gameClass) {
  const st = CLASS_STYLES[gameClass]||CLASS_STYLES.fire;
  // aura behind everything
  const aura = new PIXI.Graphics(); aura.name='aura'; c.addChild(aura);
  // arms (drawn dynamically)
  const arm1 = new PIXI.Graphics(); arm1.name='arm1'; c.addChild(arm1);
  const arm2 = new PIXI.Graphics(); arm2.name='arm2'; c.addChild(arm2);
  // sword — anchor at handle bottom so it sits in hand correctly
  const sword = new PIXI.Sprite(gameClass==='ice'?texCache.iceSword:texCache.sword);
  sword.anchor.set(0.5, 1.0); sword.name='sword'; c.addChild(sword);
  // armor overlay
  const armor = new PIXI.Graphics(); armor.name='armor'; c.addChild(armor);
  // body — flat single class color, black outline only
  const body = new PIXI.Graphics();
  body.lineStyle(2.5, 0x000000, 0.7);
  body.beginFill(st.body, 1);
  body.drawCircle(0, 0, 20);
  body.endFill();
  body.name='body'; c.addChild(body);
  // nametag
  const nt = new PIXI.Text('',{fontSize:14,fill:0xffffff,fontWeight:'700',dropShadow:true,dropShadowBlur:4,dropShadowColor:0x000000,dropShadowDistance:0});
  nt.anchor.set(0.5); nt.y=-38; nt.name='nametag'; c.addChild(nt);
  // hp bg + bar
  const hpBg = new PIXI.Graphics();
  hpBg.beginFill(0x000000,0.5); hpBg.drawRoundedRect(-26,26,52,6,3); hpBg.endFill(); c.addChild(hpBg);
  const hpBar = new PIXI.Graphics(); hpBar.name='hpbar'; c.addChild(hpBar);
  // mp bg + bar
  const mpBg = new PIXI.Graphics();
  mpBg.beginFill(0x000000,0.5); mpBg.drawRoundedRect(-26,34,52,5,3); mpBg.endFill(); c.addChild(mpBg);
  const mpBar = new PIXI.Graphics(); mpBar.name='mpbar'; c.addChild(mpBar);
}

function removePlayerSprite(id) {
  if (playerContainers[id]) { worldContainer.removeChild(playerContainers[id]); delete playerContainers[id]; }
}

// ═══════════════════════════════════════════════════
//  PROJECTILE SPRITES
// ═══════════════════════════════════════════════════
function getOrCreateProj(id, type, radius) {
  if (projContainers[id]) return projContainers[id];
  const c = buildProjContainer(type, radius);
  worldContainer.addChild(c);
  projContainers[id] = c;
  return c;
}

function buildProjContainer(type, radius) {
  const r = Math.max(5, radius||10);
  const g = new PIXI.Container();
  switch(type) {
    case 'fireball': case 'chonkyfireball': case 'clusterfireball': {
      const sc = type==='fireball'?1:type==='chonkyfireball'?1.5:2.2;
      const base = r*sc;
      const core = new PIXI.Graphics(); core.name='core';
      core.beginFill(0xff6600,0.2); core.drawCircle(0,0,base*1.8); core.endFill();
      core.beginFill(0xff4400,0.35); core.drawCircle(0,0,base*1.3); core.endFill();
      core.beginFill(0xff2200,1); core.drawCircle(0,0,base); core.endFill();
      core.beginFill(0xffdd88,0.9); core.drawCircle(0,0,base*0.45); core.endFill();
      g.addChild(core);
      for(let i=0;i<5;i++){const w=new PIXI.Graphics();w.name=`wisp${i}`;g.addChild(w);}
      break;
    }
    case 'icicle': {
      const ic=new PIXI.Graphics();
      ic.beginFill(0xeeffff,0.95);
      ic.moveTo(0,-r*1.8);ic.lineTo(r*0.4,0);ic.lineTo(0,r*0.8);ic.lineTo(-r*0.4,0);ic.closePath();ic.endFill();
      ic.beginFill(0xffffff,0.5);
      ic.moveTo(0,-r*1.8);ic.lineTo(r*0.2,-r*0.3);ic.lineTo(0,r*0.8);ic.closePath();ic.endFill();
      ic.beginFill(0x88ddff,0.2);ic.drawCircle(0,0,r*1.5);ic.endFill();
      g.addChild(ic); break;
    }
    case 'iceblade': {
      const aura2=new PIXI.Graphics();
      aura2.beginFill(0x44aaff,0.15);aura2.drawCircle(0,0,r*1.2);aura2.endFill();
      const ring=new PIXI.Graphics();
      ring.lineStyle(1.5,0x88ddff,0.3);ring.drawCircle(0,0,r);
      const blade=new PIXI.Sprite(texCache.iceSword);
      blade.anchor.set(0.5);blade.width=r*2;blade.height=r*2;
      g.addChild(aura2,ring,blade); break;
    }
    case 'snowstorm': {
      const bg2=new PIXI.Graphics();
      bg2.beginFill(0xbbddff,0.12);bg2.drawCircle(0,0,r);bg2.endFill();
      bg2.lineStyle(2,0xaaddff,0.35);bg2.drawCircle(0,0,r*0.8);
      g.addChild(bg2);
      for(let i=0;i<18;i++){const d=new PIXI.Graphics();d.beginFill(0xeef8ff,0.9);d.drawCircle(0,0,i%3===0?3:2);d.endFill();d.name=`dot${i}`;g.addChild(d);}
      const flake=new PIXI.Graphics();flake.lineStyle(2,0xffffff,0.7);
      for(let i=0;i<6;i++){const ang=i*Math.PI/3;flake.moveTo(0,0);flake.lineTo(Math.cos(ang)*12,Math.sin(ang)*12);}
      flake.name='flake';g.addChild(flake); break;
    }
    case 'bloodblade': {
      const d=new PIXI.Graphics();
      d.beginFill(0xcc1122,1);
      d.moveTo(0,-r*2.2);d.lineTo(r*0.35,-r*0.5);d.lineTo(r*0.25,r);d.lineTo(0,r*1.3);d.lineTo(-r*0.25,r);d.lineTo(-r*0.35,-r*0.5);d.closePath();d.endFill();
      d.lineStyle(0);d.beginFill(0x880011,1);d.drawRoundedRect(-r*0.6,-r*0.5,r*1.2,r*0.35,2);d.endFill();
      d.beginFill(0x4a1010,1);d.drawRoundedRect(-r*0.2,-r*0.1,r*0.4,r*1.1,2);d.endFill();
      d.beginFill(0xff0033,0.2);d.drawEllipse(0,-r,r*0.8,r*2);d.endFill();
      g.addChild(d); break;
    }
    case 'shockwave': {
      for(let i=0;i<8;i++){const ch=new PIXI.Graphics();ch.name=`chunk${i}`;ch.beginFill(0x6a5a3a,0.8);ch.drawRoundedRect(-3,-5,6,10,2);ch.endFill();g.addChild(ch);}
      const ring=new PIXI.Graphics();ring.name='ring';g.addChild(ring); break;
    }
    case 'lightningball': {
      for(let i=0;i<4;i++){const arc=new PIXI.Graphics();arc.name=`arc${i}`;g.addChild(arc);}
      const core=new PIXI.Graphics();core.name='core';g.addChild(core); break;
    }
    case 'lightningbolt': {
      const bolt=new PIXI.Graphics();
      bolt.beginFill(0xffffff,0.9);
      bolt.moveTo(0,-r*0.5);bolt.lineTo(r*6,-r*0.3);bolt.lineTo(r*5,0);bolt.lineTo(r*10,r*0.3);
      bolt.lineTo(r*9.5,-r*0.1);bolt.lineTo(r*14,0);bolt.lineTo(r*13.5,r*0.5);
      bolt.lineTo(r*8,r*0.3);bolt.lineTo(r*8.5,-r*0.1);bolt.lineTo(r*4.5,r*0.3);
      bolt.lineTo(r*5.5,-r*0.3);bolt.lineTo(0,r*0.5);bolt.closePath();bolt.endFill();
      bolt.beginFill(0xffee88,0.3);bolt.drawRoundedRect(-r*0.5,-r*0.7,r*15,r*1.4,r*0.7);bolt.endFill();
      bolt.beginFill(0xffffff,0.7);bolt.drawRoundedRect(0,-r*0.15,r*14,r*0.3,r*0.15);bolt.endFill();
      g.addChild(bolt); break;
    }
    case 'lightningspark': {
      const sp=new PIXI.Graphics();
      for(let i=0;i<5;i++){const ang=(i/5)*Math.PI*2;sp.lineStyle(1.5,i%2===0?0xffee22:0xffffff,0.8);sp.moveTo(0,0);sp.lineTo(Math.cos(ang)*r*2,Math.sin(ang)*r*2);}
      sp.beginFill(0xffffff,0.9);sp.drawCircle(0,0,r*0.5);sp.endFill();
      sp.beginFill(0xffee88,0.4);sp.drawCircle(0,0,r*1.5);sp.endFill();
      g.addChild(sp); break;
    }
    default: {
      const def=new PIXI.Graphics();def.beginFill(0x8888ff,0.6);def.drawCircle(0,0,r);def.endFill();g.addChild(def);
    }
  }
  return g;
}

function updateProjSprite(id, p, now) {
  const c = getOrCreateProj(id, p.type, p.radius);
  c.x = p.renderX; c.y = p.renderY;
  const r = Math.max(5, p.radius||10);
  switch(p.type) {
    case 'fireball': case 'chonkyfireball': case 'clusterfireball': {
      c.rotation = p.dir;
      const sc = p.type==='fireball'?1:p.type==='chonkyfireball'?1.5:2.2;
      const base=r*sc;
      for(let i=0;i<5;i++){
        const w=c.getChildByName(`wisp${i}`);if(!w)continue;
        w.clear();
        const ang=now/80+i*Math.PI*2/5;
        const wr=base*(0.5+0.5*Math.sin(now/60+i));
        w.beginFill(0xff8800,0.55);w.drawEllipse(Math.cos(ang)*base*0.7,Math.sin(ang)*base*0.4,wr*0.5,wr*0.8);w.endFill();
      }
      break;
    }
    case 'icicle': c.rotation=p.dir+Math.PI/2; break;
    case 'iceblade': p._spin=(p._spin||0)+0.06; c.rotation=p._spin; break;
    case 'bloodblade': p._spin=(p._spin||0)+0.1; c.rotation=p._spin; break;
    case 'snowstorm': {
      const flake=c.getChildByName('flake');if(flake)flake.rotation=now/800;
      for(let i=0;i<18;i++){const d=c.getChildByName(`dot${i}`);if(!d)continue;const ang=now/300+i*(Math.PI*2/18);const dr=r*(0.5+0.45*((i%3)/2));d.x=Math.cos(ang)*dr;d.y=Math.sin(ang)*dr;}
      break;
    }
    case 'shockwave': {
      const ring=c.getChildByName('ring');
      if(ring){ring.clear();ring.lineStyle(4,0x8a6a3a,0.7);ring.drawCircle(0,0,r);ring.lineStyle(2,0x6a5030,0.4);ring.drawCircle(0,0,r*1.4);ring.beginFill(0x7a6040,0.12);ring.drawCircle(0,0,r*1.4);ring.endFill();}
      for(let i=0;i<8;i++){const ch=c.getChildByName(`chunk${i}`);if(!ch)continue;const ang=(i/8)*Math.PI*2+now/400;ch.x=Math.cos(ang)*r*1.1;ch.y=Math.sin(ang)*r*1.1;ch.rotation=ang;}
      break;
    }
    case 'lightningball': {
      const core=c.getChildByName('core');
      if(core){core.clear();const pulse=0.85+0.15*Math.sin(now/80);core.beginFill(0x8888ff,0.2*pulse);core.drawCircle(0,0,r*2.2*pulse);core.endFill();core.beginFill(0xaaaaff,0.5*pulse);core.drawCircle(0,0,r*1.3*pulse);core.endFill();core.beginFill(0xffffff,0.95);core.drawCircle(0,0,r*0.5);core.endFill();}
      for(let i=0;i<4;i++){const arc=c.getChildByName(`arc${i}`);if(!arc)continue;arc.clear();arc.lineStyle(1.5,0xddddff,0.7);const sa=now/100+i*Math.PI/2;let x1=0,y1=0;for(let j=1;j<=4;j++){const jit=Math.sin(now/30+i*7+j*3)*0.5*r;const x2=Math.cos(sa+j*0.4)*r*j*0.4+jit;const y2=Math.sin(sa+j*0.4)*r*j*0.4+jit;arc.moveTo(x1,y1);arc.lineTo(x2,y2);x1=x2;y1=y2;}}
      break;
    }
    case 'lightningbolt': c.rotation=p.dir; break;
    case 'lightningspark': c.rotation=now/100; break;
  }
}

function removeProjSprite(id) {
  if (projContainers[id]) { worldContainer.removeChild(projContainers[id]); delete projContainers[id]; }
}

// ═══════════════════════════════════════════════════
//  OBSTACLE SPRITES
// ═══════════════════════════════════════════════════
function getOrCreateObstacle(id, ob) {
  if (obstacleSprites[id]) return;
  const s = new PIXI.Sprite(texCache.rock);
  s.anchor.set(0.5); s.width=ob.radius*2; s.height=ob.radius*2;
  s.x=ob.x; s.y=ob.y;
  worldContainer.addChild(s);
  obstacleSprites[id]=s;
}

// ═══════════════════════════════════════════════════
//  UI
// ═══════════════════════════════════════════════════
function drawUI(now, pl) {
  uiContainer.removeChildren();
  const W=app.screen.width, H=app.screen.height;

  // skill bars
  const sbW=80,sbH=12,sbGap=28,totalW=sbW*3+sbGap*2;
  const startX=W/2-totalW/2, barY=H-35;
  ['Q','E','F'].forEach((key,i)=>{
    const t=new PIXI.Text(key,{fontSize:15,fill:0xcccccc,fontWeight:'600'});
    t.anchor.set(0.5);t.x=startX+sbW/2+i*(sbW+sbGap);t.y=barY-18;uiContainer.addChild(t);
  });
  [[pl.renderSkill1cd??pl.skill1cd,0],[pl.renderSkill2cd??pl.skill2cd,1],[pl.renderSkill3cd??pl.skill3cd,2]].forEach(([cd,i])=>{
    const x=startX+i*(sbW+sbGap);
    const bg=new PIXI.Graphics();bg.beginFill(0x000000,0.65);bg.drawRoundedRect(x,barY,sbW,sbH,5);bg.endFill();uiContainer.addChild(bg);
    if(cd<1){const f=new PIXI.Graphics();f.beginFill(0x00ccff,0.85);f.drawRoundedRect(x,barY,sbW*(1-cd),sbH,5);f.endFill();f.beginFill(0xffffff,0.2);f.drawRoundedRect(x,barY,sbW*(1-cd),sbH/2,5);f.endFill();uiContainer.addChild(f);}
    const ol=new PIXI.Graphics();ol.lineStyle(1,0x446688,0.6);ol.drawRoundedRect(x,barY,sbW,sbH,5);uiContainer.addChild(ol);
  });

  // minimap
  const mmSize=180,mmX=10,mmY=H-mmSize-10;
  const mmBg=new PIXI.Graphics();mmBg.beginFill(0x000000,0.4);mmBg.lineStyle(1,0x446644,0.6);mmBg.drawRect(mmX,mmY,mmSize,mmSize);mmBg.endFill();uiContainer.addChild(mmBg);
  const mmW=new PIXI.Graphics();mmW.beginFill(0x2a5a2a,0.5);mmW.drawRect(mmX+1,mmY+1,mmSize-2,mmSize-2);mmW.endFill();uiContainer.addChild(mmW);
  const mmScale=mmSize/WORLD;
  for(const [id,p] of Object.entries(players)){
    const st=CLASS_STYLES[p.gameClass]||CLASS_STYLES.fire;
    const dot=new PIXI.Graphics();
    if(id===myId){dot.beginFill(0x88aaff,1);dot.drawCircle(mmX+p.renderX*mmScale,mmY+p.renderY*mmScale,4);dot.endFill();dot.lineStyle(1,0xffffff,0.7);dot.drawCircle(mmX+p.renderX*mmScale,mmY+p.renderY*mmScale,4);}
    else{dot.beginFill(st.body,0.85);dot.drawCircle(mmX+p.renderX*mmScale,mmY+p.renderY*mmScale,3);dot.endFill();}
    uiContainer.addChild(dot);
  }

  // leaderboard
  const lbW=200,lbX=W-lbW-10,lbY=10;
  const sorted=Object.entries(players).sort((a,b)=>(b[1].killcount??0)-(a[1].killcount??0)).slice(0,10);
  const lbBg=new PIXI.Graphics();lbBg.beginFill(0x000000,0.45);lbBg.lineStyle(1,0x335533,0.5);lbBg.drawRoundedRect(lbX,lbY,lbW,30+sorted.length*26,6);lbBg.endFill();uiContainer.addChild(lbBg);
  const lbTitle=new PIXI.Text('☠  LEADERBOARD',{fontSize:12,fill:0x99aa99,fontWeight:'700'});lbTitle.x=lbX+10;lbTitle.y=lbY+8;uiContainer.addChild(lbTitle);
  sorted.forEach(([id,p],i)=>{
    let name=p.name||'?';if(name.length>14)name=name.substring(0,14)+'…';
    const row=new PIXI.Text(`${i+1}. ${name}`,{fontSize:13,fill:id===myId?0xaaccff:0xddeedd});
    row.x=lbX+10;row.y=lbY+28+i*26;uiContainer.addChild(row);
    const kills=new PIXI.Text(`${p.killcount??0}`,{fontSize:13,fill:0xffcc44,fontWeight:'bold'});
    kills.anchor.set(1,0);kills.x=lbX+lbW-10;kills.y=lbY+28+i*26;uiContainer.addChild(kills);
  });
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
