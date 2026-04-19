// ═══════════════════════════════════════════════════
//  ARCNE.IO  —  PixiJS WebGL frontend
//  All sprites drawn in PixiJS — no external images
//  Controls: WASD/arrows=move | Q,E,F=skills | LMB=melee
// ═══════════════════════════════════════════════════

const WS_URL = 'wss://circle-game-nzws.onrender.com';
const WORLD = 4000;
const SERVER_TICK = 100;

// ── CLASS COLORS & STYLES ────────────────────────
const CLASS_STYLES = {
  fire:      { body: 0xd14821, bodyHi: 0xff7744, arm: 0xb03010, outline: 0x661500 },
  ice:       { body: 0x88ddff, bodyHi: 0xccf4ff, arm: 0x44aadd, outline: 0x2266aa },
  earth:     { body: 0x7a6a50, bodyHi: 0xaа9a80, arm: 0x55473a, outline: 0x2a2018 },
  blood:     { body: 0xaa1122, bodyHi: 0xff3355, arm: 0x880011, outline: 0x440008 },
  lightning: { body: 0xffee22, bodyHi: 0xffff99, arm: 0xddcc00, outline: 0x886600 },
};

// ── STATE ────────────────────────────────────────
let ws = null, myId = null, myClass = null, myName = '';
let dead = false, killcount = 0, gameStartTime = 0;
let players = {}, projectiles = {}, obstacles = {};
let zoom = 0.9, direction = 0;
const pressed = {};
let lastMoveSend = 0;

// ── PIXI STATE ───────────────────────────────────
let app, worldContainer, uiContainer;
let playerContainers = {};
let projContainers = {};
let obstacleSprites = {};

// ── TEXTURE CACHE (generated once) ──────────────
let texCache = {};

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let c = b - a;
  while (c < -Math.PI) c += Math.PI * 2;
  while (c >  Math.PI) c -= Math.PI * 2;
  return a + c * t;
}

// ═══════════════════════════════════════════════════
//  TEXTURE GENERATION — draw to RenderTexture once
// ═══════════════════════════════════════════════════

function generateTextures() {
  // ── SWORD ──────────────────────────────────────
  texCache.sword = makeSwordTexture(false);
  texCache.enhancedSword = makeSwordTexture(true);
  texCache.iceSword = makeIceSwordTexture();

  // ── OBSTACLE (mossy rock) ──────────────────────
  texCache.rock = makeRockTexture();
}

function makeRenderTexture(w, h) {
  return PIXI.RenderTexture.create({ width: w, height: h });
}

function bakeGraphic(g, w, h, cx, cy) {
  const rt = makeRenderTexture(w, h);
  g.x = cx; g.y = cy;
  app.renderer.render(g, { renderTexture: rt });
  g.destroy();
  return rt;
}

function makeSwordTexture(enhanced) {
  const g = new PIXI.Graphics();
  // blade
  g.beginFill(enhanced ? 0xffdd66 : 0xddddff, 1);
  g.moveTo(0, -50);
  g.lineTo(5, -10);
  g.lineTo(3, 40);
  g.lineTo(0, 48);
  g.lineTo(-3, 40);
  g.lineTo(-5, -10);
  g.closePath();
  g.endFill();
  // blade edge
  g.lineStyle(1, enhanced ? 0xffaa00 : 0xaaaacc, 0.7);
  g.moveTo(0, -50); g.lineTo(0, 40);
  // guard
  g.lineStyle(0);
  g.beginFill(enhanced ? 0xcc8800 : 0x888899, 1);
  g.drawRoundedRect(-12, -8, 24, 6, 3);
  g.endFill();
  // handle
  g.beginFill(enhanced ? 0x8b4513 : 0x6b3a1f, 1);
  g.drawRoundedRect(-4, 0, 8, 28, 2);
  g.endFill();
  // wrap bands
  g.lineStyle(1.5, enhanced ? 0xffaa44 : 0xaaaaaa, 0.6);
  for (let i = 0; i < 3; i++) { g.moveTo(-4, 6 + i*8); g.lineTo(4, 6 + i*8); }
  // pommel
  g.lineStyle(0);
  g.beginFill(enhanced ? 0xffcc44 : 0x999aaa, 1);
  g.drawCircle(0, 30, 5);
  g.endFill();
  if (enhanced) {
    // glow aura
    g.beginFill(0xffaa00, 0.15);
    g.drawEllipse(0, -10, 18, 60);
    g.endFill();
  }
  return bakeGraphic(g, 40, 110, 20, 58);
}

function makeIceSwordTexture() {
  const g = new PIXI.Graphics();
  // crystal blade
  g.beginFill(0x88eeff, 0.9);
  g.moveTo(0, -55);
  g.lineTo(7, -15);
  g.lineTo(10, 30);
  g.lineTo(0, 45);
  g.lineTo(-10, 30);
  g.lineTo(-7, -15);
  g.closePath();
  g.endFill();
  // facets
  g.lineStyle(1, 0xffffff, 0.5);
  g.moveTo(0, -55); g.lineTo(7, -15);
  g.moveTo(0, -55); g.lineTo(-7, -15);
  g.moveTo(-7, -15); g.lineTo(10, 30);
  // guard
  g.lineStyle(0);
  g.beginFill(0x44aacc, 1);
  g.moveTo(-15, -10); g.lineTo(15, -10); g.lineTo(10, -2); g.lineTo(-10, -2); g.closePath();
  g.endFill();
  // handle
  g.beginFill(0x336688, 1);
  g.drawRoundedRect(-4, 0, 8, 26, 2);
  g.endFill();
  g.beginFill(0x88ccee, 1);
  g.drawCircle(0, 28, 5);
  g.endFill();
  // inner glow
  g.beginFill(0xffffff, 0.2);
  g.moveTo(0, -55); g.lineTo(3, -15); g.lineTo(2, 20); g.lineTo(0, 30); g.lineTo(-2, 20); g.lineTo(-3, -15); g.closePath();
  g.endFill();
  return bakeGraphic(g, 44, 112, 22, 60);
}

function makeRockTexture() {
  const g = new PIXI.Graphics();
  // shadow
  g.beginFill(0x000000, 0.2);
  g.drawEllipse(52, 90, 40, 12);
  g.endFill();
  // base rock
  g.beginFill(0x556644, 1);
  g.moveTo(50, 5);
  g.lineTo(82, 18);
  g.lineTo(95, 45);
  g.lineTo(88, 72);
  g.lineTo(65, 85);
  g.lineTo(30, 82);
  g.lineTo(10, 62);
  g.lineTo(12, 32);
  g.lineTo(28, 12);
  g.closePath();
  g.endFill();
  // highlight face
  g.beginFill(0x7a8a66, 1);
  g.moveTo(50, 10);
  g.lineTo(75, 22);
  g.lineTo(70, 50);
  g.lineTo(50, 55);
  g.lineTo(28, 45);
  g.lineTo(25, 25);
  g.closePath();
  g.endFill();
  // moss patches
  g.beginFill(0x4a7a3a, 0.8);
  g.drawEllipse(40, 30, 14, 8);
  g.drawEllipse(62, 55, 10, 6);
  g.endFill();
  // cracks
  g.lineStyle(1.5, 0x334433, 0.7);
  g.moveTo(50, 20); g.lineTo(45, 40); g.lineTo(52, 55);
  g.moveTo(65, 30); g.lineTo(70, 48);
  // dark outline
  g.lineStyle(2, 0x223322, 0.8);
  g.moveTo(50, 5);
  g.lineTo(82, 18); g.lineTo(95, 45); g.lineTo(88, 72);
  g.lineTo(65, 85); g.lineTo(30, 82); g.lineTo(10, 62);
  g.lineTo(12, 32); g.lineTo(28, 12); g.lineTo(50, 5);
  return bakeGraphic(g, 100, 100, 0, 0);
}

// ═══════════════════════════════════════════════════
//  PLAYER DRAWING
// ═══════════════════════════════════════════════════

function drawPlayerBody(container, gameClass, isMe) {
  const st = CLASS_STYLES[gameClass] || CLASS_STYLES.fire;

  // ── SHADOW ──
  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x000000, 0.25);
  shadow.drawEllipse(4, 26, 18, 6);
  shadow.endFill();
  shadow.name = 'shadow';
  container.addChild(shadow);

  // ── BODY ──
  const body = new PIXI.Graphics();
  body.name = 'body';
  // outer ring
  body.lineStyle(3, st.outline, 1);
  body.beginFill(st.body, 1);
  body.drawCircle(0, 0, 20);
  body.endFill();
  // inner highlight
  body.lineStyle(0);
  body.beginFill(st.bodyHi, 0.45);
  body.drawEllipse(-5, -7, 9, 6);
  body.endFill();
  // class marking — small inner ring
  body.lineStyle(1.5, st.outline, 0.4);
  body.drawCircle(0, 0, 13);
  container.addChild(body);

  // ── ARMS (drawn dynamically in update) ──
  const arm1 = new PIXI.Graphics(); arm1.name = 'arm1';
  const arm2 = new PIXI.Graphics(); arm2.name = 'arm2';
  container.addChild(arm1, arm2);

  // ── SWORD ──
  let swordTex = gameClass === 'ice' ? texCache.iceSword : texCache.sword;
  const sword = new PIXI.Sprite(swordTex);
  sword.anchor.set(0.5, 0.88);
  sword.name = 'sword';
  container.addChild(sword);

  // ── AURA ──
  const aura = new PIXI.Graphics(); aura.name = 'aura';
  container.addChildAt(aura, 0); // behind everything

  // ── ARMOR OVERLAY (invincibility) ──
  const armor = new PIXI.Graphics(); armor.name = 'armor';
  container.addChild(armor);

  // ── NAMETAG ──
  const nt = new PIXI.Text('', {
    fontSize: 14, fill: 0xffffff, fontWeight: '700',
    dropShadow: true, dropShadowBlur: 5,
    dropShadowColor: 0x000000, dropShadowDistance: 0,
  });
  nt.anchor.set(0.5); nt.y = -40; nt.name = 'nametag';
  container.addChild(nt);

  // ── HP BAR ──
  const hpBg = new PIXI.Graphics();
  hpBg.beginFill(0x000000, 0.55);
  hpBg.drawRoundedRect(-30, 27, 60, 7, 3);
  hpBg.endFill();
  const hpBar = new PIXI.Graphics(); hpBar.name = 'hpbar';
  container.addChild(hpBg, hpBar);

  // ── MP BAR ──
  const mpBg = new PIXI.Graphics();
  mpBg.beginFill(0x000000, 0.55);
  mpBg.drawRoundedRect(-30, 36, 60, 5, 3);
  mpBg.endFill();
  const mpBar = new PIXI.Graphics(); mpBar.name = 'mpbar';
  container.addChild(mpBg, mpBar);
}

function updatePlayerSprite(id, p, now) {
  if (!playerContainers[id]) {
    const c = new PIXI.Container();
    drawPlayerBody(c, p.gameClass, id === myId);
    worldContainer.addChild(c);
    playerContainers[id] = c;
  }
  const c = playerContainers[id];
  const st = CLASS_STYLES[p.gameClass] || CLASS_STYLES.fire;

  c.x = p.renderX;
  c.y = p.renderY;

  // ── SWING ANGLE ──
  let a = p.renderDir ?? p.dir;
  if (p.isHitting) {
    const swingElapsed = now - p.timeFromLastHit;
    const swingProgress = Math.min(swingElapsed / 400, 1);
    a += Math.sin(swingProgress * Math.PI) * (Math.PI / 2) * 1.7;
  }

  // ── ARMS ──
  const armAngle = Math.PI / 4, armOffset = 21;
  ['arm1','arm2'].forEach((name, idx) => {
    const arm = c.getChildByName(name);
    if (!arm) return;
    arm.clear();
    const angle = a + (idx === 0 ? -1 : 1) * armAngle;
    const ax = Math.cos(angle) * armOffset;
    const ay = Math.sin(angle) * armOffset;
    // arm shadow
    arm.beginFill(0x000000, 0.2);
    arm.drawCircle(ax + 1.5, ay + 2, 8.5);
    arm.endFill();
    // arm body
    arm.lineStyle(2, st.outline, 0.8);
    arm.beginFill(st.arm, 1);
    arm.drawCircle(ax, ay, 8);
    arm.endFill();
    arm.lineStyle(0);
    arm.beginFill(st.bodyHi, 0.3);
    arm.drawEllipse(ax - 2, ay - 2, 4, 3);
    arm.endFill();
  });

  // ── SWORD ──
  const sword = c.getChildByName('sword');
  if (sword) {
    const isEnhanced = p.basicEnhanced;
    if (isEnhanced && sword.texture !== texCache.enhancedSword) {
      sword.texture = texCache.enhancedSword;
    } else if (!isEnhanced && p.gameClass !== 'ice' && sword.texture !== texCache.sword) {
      sword.texture = texCache.sword;
    }
    const ox = Math.cos(a) * 20, oy = Math.sin(a) * 20;
    sword.x = ox; sword.y = oy;
    sword.rotation = a + Math.PI;
    sword.scale.set(p.basicEnhanced ? 1.15 : 1.0);
  }

  // ── AURA ──
  const aura = c.getChildByName('aura');
  if (aura) {
    aura.clear();
    if (p.isFrenzy) {
      const r = 42 + Math.sin(now / 130) * 5;
      // pulsing red rings
      aura.lineStyle(2, 0xff0033, 0.6);
      aura.drawCircle(0, 0, r);
      aura.lineStyle(1, 0xff0033, 0.3);
      aura.drawCircle(0, 0, r + 7);
      aura.beginFill(0xff0033, 0.1);
      aura.drawCircle(0, 0, r);
      aura.endFill();
    } else if (p.isLightningSpeed) {
      const r = 42 + Math.sin(now / 130) * 5;
      aura.lineStyle(2, 0xffee22, 0.7);
      aura.drawCircle(0, 0, r);
      aura.lineStyle(1, 0xffffff, 0.3);
      aura.drawCircle(0, 0, r + 5);
      aura.beginFill(0xffee22, 0.12);
      aura.drawCircle(0, 0, r);
      aura.endFill();
      // spark dashes
      aura.lineStyle(1.5, 0xffffff, 0.5);
      for (let i = 0; i < 6; i++) {
        const ang = now / 200 + i * Math.PI / 3;
        aura.moveTo(Math.cos(ang) * (r-4), Math.sin(ang) * (r-4));
        aura.lineTo(Math.cos(ang) * (r+6), Math.sin(ang) * (r+6));
      }
    }
  }

  // ── ARMOR (invincible) ──
  const armor = c.getChildByName('armor');
  if (armor) {
    armor.clear();
    if (p.isInvincible) {
      // stone shield rings
      const t2 = now / 600;
      armor.lineStyle(3, 0xaaaaaa, 0.7);
      armor.drawCircle(0, 0, 28);
      armor.lineStyle(2, 0x888888, 0.5);
      armor.drawCircle(0, 0, 33);
      // rotating shield segments
      for (let i = 0; i < 6; i++) {
        const ang = t2 + i * Math.PI / 3;
        armor.lineStyle(0);
        armor.beginFill(0xbbbbcc, 0.55);
        armor.moveTo(Math.cos(ang) * 22, Math.sin(ang) * 22);
        armor.lineTo(Math.cos(ang + 0.4) * 32, Math.sin(ang + 0.4) * 32);
        armor.lineTo(Math.cos(ang + 0.55) * 32, Math.sin(ang + 0.55) * 32);
        armor.lineTo(Math.cos(ang + 0.15) * 22, Math.sin(ang + 0.15) * 22);
        armor.closePath();
        armor.endFill();
      }
    }
  }

  // ── BODY TINT ──
  const body = c.getChildByName('body');
  if (body) {
    body.tint = p.isInvincible ? 0xffffff : 0xffffff; // tint handled by aura
  }

  // ── NAMETAG ──
  const nt = c.getChildByName('nametag');
  if (nt) {
    let name = p.name || 'unnamed';
    if (name.length > 18) name = name.substring(0, 18) + '…';
    nt.text = name + (p.killcount > 0 ? ` ☠${p.killcount}` : '');
    nt.style.fill = id === myId ? 0xaaccff : 0xffffff;
  }

  // ── HP BAR ──
  const hpBar = c.getChildByName('hpbar');
  if (hpBar) {
    hpBar.clear();
    const pct = Math.max(0, Math.min(1, (p.renderHealth ?? p.health) / 100));
    const col = pct > 0.6 ? 0x44ee66 : pct > 0.3 ? 0xffcc22 : 0xff2233;
    hpBar.beginFill(col, 0.95);
    hpBar.drawRoundedRect(-30, 27, 60 * pct, 7, 3);
    hpBar.endFill();
    // shine
    hpBar.beginFill(0xffffff, 0.25);
    hpBar.drawRoundedRect(-30, 27, 60 * pct, 3, 2);
    hpBar.endFill();
  }

  // ── MP BAR ──
  const mpBar = c.getChildByName('mpbar');
  if (mpBar) {
    mpBar.clear();
    if (id === myId) {
      const pct = Math.max(0, Math.min(1, (p.renderMana ?? p.mana) / 100));
      mpBar.beginFill(0x4488ff, 0.9);
      mpBar.drawRoundedRect(-30, 36, 60 * pct, 5, 3);
      mpBar.endFill();
    }
  }

  if (id === myId) killcount = p.killcount ?? 0;
}

function removePlayerSprite(id) {
  if (playerContainers[id]) {
    worldContainer.removeChild(playerContainers[id]);
    delete playerContainers[id];
  }
}

// ═══════════════════════════════════════════════════
//  PROJECTILE DRAWING
// ═══════════════════════════════════════════════════

function getOrCreateProj(id, type, radius) {
  if (projContainers[id]) return projContainers[id];
  const c = drawProjectile(type, radius);
  worldContainer.addChild(c);
  projContainers[id] = c;
  return c;
}

function drawProjectile(type, radius) {
  const r = Math.max(5, radius || 10);
  const g = new PIXI.Container();

  switch (type) {

    case 'fireball':
    case 'chonkyfireball':
    case 'clusterfireball': {
      const scale = type === 'fireball' ? 1 : type === 'chonkyfireball' ? 1.5 : 2.2;
      const base = r * scale;
      // outer glow
      const glow = new PIXI.Graphics();
      glow.beginFill(0xff6600, 0.2);
      glow.drawCircle(0, 0, base * 1.8);
      glow.endFill();
      // mid glow
      glow.beginFill(0xff4400, 0.35);
      glow.drawCircle(0, 0, base * 1.3);
      glow.endFill();
      // core
      glow.beginFill(0xff2200, 1);
      glow.drawCircle(0, 0, base);
      glow.endFill();
      // hot center
      glow.beginFill(0xffdd88, 0.9);
      glow.drawCircle(0, 0, base * 0.45);
      glow.endFill();
      // flame wisps
      glow.name = 'core';
      g.addChild(glow);
      // animated flame particles added in update
      for (let i = 0; i < 5; i++) {
        const wisp = new PIXI.Graphics();
        wisp.name = `wisp${i}`;
        g.addChild(wisp);
      }
      break;
    }

    case 'icicle': {
      // shards flying forward
      const ic = new PIXI.Graphics();
      // main shard
      ic.beginFill(0xeeffff, 0.95);
      ic.moveTo(0, -r * 1.8);
      ic.lineTo(r * 0.4, 0);
      ic.lineTo(0, r * 0.8);
      ic.lineTo(-r * 0.4, 0);
      ic.closePath();
      ic.endFill();
      // inner face
      ic.beginFill(0xffffff, 0.5);
      ic.moveTo(0, -r * 1.8);
      ic.lineTo(r * 0.2, -r * 0.3);
      ic.lineTo(0, r * 0.8);
      ic.closePath();
      ic.endFill();
      // glow
      ic.beginFill(0x88ddff, 0.2);
      ic.drawCircle(0, 0, r * 1.5);
      ic.endFill();
      g.addChild(ic);
      break;
    }

    case 'iceblade': {
      // orbiting ice sword
      const orb = new PIXI.Container();
      // orbit ring
      const ring = new PIXI.Graphics();
      ring.lineStyle(1.5, 0x88ddff, 0.3);
      ring.drawCircle(0, 0, r);
      ring.endFill();
      // the blade itself
      const blade = new PIXI.Sprite(texCache.iceSword);
      blade.anchor.set(0.5);
      blade.width = r * 2; blade.height = r * 2;
      blade.name = 'blade';
      // aura
      const aura = new PIXI.Graphics();
      aura.beginFill(0x44aaff, 0.15);
      aura.drawCircle(0, 0, r * 1.2);
      aura.endFill();
      orb.addChild(aura, ring, blade);
      g.addChild(orb);
      g.name = 'orb';
      break;
    }

    case 'snowstorm': {
      // large swirling storm
      const bg2 = new PIXI.Graphics();
      bg2.beginFill(0xbbddff, 0.12);
      bg2.drawCircle(0, 0, r);
      bg2.endFill();
      bg2.lineStyle(2, 0xaaddff, 0.35);
      bg2.drawCircle(0, 0, r * 0.8);
      g.addChild(bg2);
      // snowflake dots
      for (let i = 0; i < 18; i++) {
        const dot = new PIXI.Graphics();
        dot.beginFill(0xeef8ff, 0.9);
        dot.drawCircle(0, 0, i % 3 === 0 ? 3 : 2);
        dot.endFill();
        dot.name = `dot${i}`;
        g.addChild(dot);
      }
      // inner snowflake
      const flake = new PIXI.Graphics();
      flake.lineStyle(2, 0xffffff, 0.7);
      for (let i = 0; i < 6; i++) {
        const ang = i * Math.PI / 3;
        flake.moveTo(0, 0); flake.lineTo(Math.cos(ang)*12, Math.sin(ang)*12);
        flake.moveTo(Math.cos(ang)*6, Math.sin(ang)*6);
        flake.lineTo(Math.cos(ang + Math.PI/6)*10, Math.sin(ang + Math.PI/6)*10);
      }
      flake.name = 'flake';
      g.addChild(flake);
      break;
    }

    case 'bloodblade': {
      // spinning blood dagger
      const dagger = new PIXI.Graphics();
      // blade
      dagger.beginFill(0xcc1122, 1);
      dagger.moveTo(0, -r * 2.2);
      dagger.lineTo(r * 0.35, -r * 0.5);
      dagger.lineTo(r * 0.25, r * 1.0);
      dagger.lineTo(0, r * 1.3);
      dagger.lineTo(-r * 0.25, r * 1.0);
      dagger.lineTo(-r * 0.35, -r * 0.5);
      dagger.closePath();
      dagger.endFill();
      // blood edge
      dagger.lineStyle(1, 0xff3344, 0.8);
      dagger.moveTo(0, -r * 2.2); dagger.lineTo(r * 0.35, -r * 0.5);
      // guard
      dagger.lineStyle(0);
      dagger.beginFill(0x880011, 1);
      dagger.drawRoundedRect(-r * 0.6, -r * 0.5, r * 1.2, r * 0.35, 2);
      dagger.endFill();
      // handle
      dagger.beginFill(0x4a1010, 1);
      dagger.drawRoundedRect(-r * 0.2, -r * 0.1, r * 0.4, r * 1.1, 2);
      dagger.endFill();
      // blood drip glow
      dagger.beginFill(0xff0033, 0.2);
      dagger.drawEllipse(0, -r, r * 0.8, r * 2);
      dagger.endFill();
      g.addChild(dagger);
      break;
    }

    case 'shockwave': {
      // expanding earth ring
      const sw = new PIXI.Graphics();
      sw.name = 'ring';
      // dirt particles
      for (let i = 0; i < 8; i++) {
        const chunk = new PIXI.Graphics();
        chunk.name = `chunk${i}`;
        chunk.beginFill(0x6a5a3a, 0.8);
        chunk.drawRoundedRect(-3, -5, 6, 10, 2);
        chunk.endFill();
        g.addChild(chunk);
      }
      g.addChild(sw);
      break;
    }

    case 'lightningball': {
      // pulsing electric orb
      const lb = new PIXI.Graphics();
      lb.name = 'core';
      // arcs — redrawn each frame
      for (let i = 0; i < 4; i++) {
        const arc = new PIXI.Graphics();
        arc.name = `arc${i}`;
        g.addChild(arc);
      }
      g.addChild(lb);
      break;
    }

    case 'lightningbolt': {
      // long jagged bolt
      const bolt = new PIXI.Graphics();
      bolt.beginFill(0xffffff, 0.9);
      // main bolt shape
      bolt.moveTo(0, -r * 0.5);
      bolt.lineTo(r * 6, -r * 0.3);
      bolt.lineTo(r * 5, 0);
      bolt.lineTo(r * 10, r * 0.3);
      bolt.lineTo(r * 9.5, -r * 0.1);
      bolt.lineTo(r * 14, 0);
      bolt.lineTo(r * 13.5, r * 0.5);
      bolt.lineTo(r * 8, r * 0.3);
      bolt.lineTo(r * 8.5, -r * 0.1);
      bolt.lineTo(r * 4.5, r * 0.3);
      bolt.lineTo(r * 5.5, -r * 0.3);
      bolt.lineTo(0, r * 0.5);
      bolt.closePath();
      bolt.endFill();
      // glow
      bolt.beginFill(0xffee88, 0.3);
      bolt.drawRoundedRect(-r * 0.5, -r * 0.7, r * 15, r * 1.4, r * 0.7);
      bolt.endFill();
      // bright core
      bolt.beginFill(0xffffff, 0.7);
      bolt.drawRoundedRect(0, -r * 0.15, r * 14, r * 0.3, r * 0.15);
      bolt.endFill();
      g.addChild(bolt);
      break;
    }

    case 'lightningspark': {
      // small electric spark
      const spark = new PIXI.Graphics();
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        const len = r * (1.5 + Math.random());
        spark.lineStyle(1.5, i % 2 === 0 ? 0xffee22 : 0xffffff, 0.8);
        spark.moveTo(0, 0);
        spark.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
      }
      spark.beginFill(0xffffff, 0.9);
      spark.drawCircle(0, 0, r * 0.5);
      spark.endFill();
      spark.beginFill(0xffee88, 0.4);
      spark.drawCircle(0, 0, r * 1.5);
      spark.endFill();
      g.addChild(spark);
      break;
    }

    default: {
      const def = new PIXI.Graphics();
      def.beginFill(0x8888ff, 0.6);
      def.drawCircle(0, 0, r);
      def.endFill();
      g.addChild(def);
    }
  }
  return g;
}

function updateProjSprite(id, p, now) {
  const c = getOrCreateProj(id, p.type, p.radius);
  c.x = p.renderX;
  c.y = p.renderY;
  const r = Math.max(5, p.radius || 10);

  switch (p.type) {
    case 'fireball':
    case 'chonkyfireball':
    case 'clusterfireball': {
      c.rotation = p.dir;
      const scale = p.type === 'fireball' ? 1 : p.type === 'chonkyfireball' ? 1.5 : 2.2;
      const base = r * scale;
      for (let i = 0; i < 5; i++) {
        const wisp = c.getChildByName(`wisp${i}`);
        if (!wisp) continue;
        wisp.clear();
        const ang = now / 80 + i * Math.PI * 2 / 5;
        const wr = base * (0.5 + 0.5 * Math.sin(now / 60 + i));
        const wx = Math.cos(ang) * base * 0.7;
        const wy = Math.sin(ang) * base * 0.4;
        wisp.beginFill(0xff8800, 0.55);
        wisp.drawEllipse(wx, wy, wr * 0.5, wr * 0.8);
        wisp.endFill();
      }
      break;
    }
    case 'icicle':
      c.rotation = p.dir + Math.PI / 2;
      break;
    case 'iceblade': {
      p._spin = (p._spin || 0) + 0.06;
      c.rotation = p._spin;
      break;
    }
    case 'bloodblade':
      p._spin = (p._spin || 0) + 0.1;
      c.rotation = p._spin;
      break;
    case 'snowstorm': {
      const flake = c.getChildByName('flake');
      if (flake) flake.rotation = now / 800;
      for (let i = 0; i < 18; i++) {
        const dot = c.getChildByName(`dot${i}`);
        if (!dot) continue;
        const ang = now / 300 + i * (Math.PI * 2 / 18);
        const dr = r * (0.5 + 0.45 * ((i % 3) / 2));
        dot.x = Math.cos(ang) * dr;
        dot.y = Math.sin(ang) * dr;
      }
      break;
    }
    case 'shockwave': {
      const ring = c.getChildByName('ring');
      if (ring) {
        ring.clear();
        ring.lineStyle(4, 0x8a6a3a, 0.7);
        ring.drawCircle(0, 0, r);
        ring.lineStyle(2, 0x6a5030, 0.4);
        ring.drawCircle(0, 0, r * 1.4);
        ring.beginFill(0x7a6040, 0.12);
        ring.drawCircle(0, 0, r * 1.4);
        ring.endFill();
      }
      for (let i = 0; i < 8; i++) {
        const chunk = c.getChildByName(`chunk${i}`);
        if (!chunk) continue;
        const ang = (i / 8) * Math.PI * 2 + now / 400;
        chunk.x = Math.cos(ang) * r * 1.1;
        chunk.y = Math.sin(ang) * r * 1.1;
        chunk.rotation = ang;
      }
      break;
    }
    case 'lightningball': {
      const core = c.getChildByName('core');
      if (core) {
        core.clear();
        const pulse = 0.85 + 0.15 * Math.sin(now / 80);
        core.beginFill(0x8888ff, 0.2 * pulse);
        core.drawCircle(0, 0, r * 2.2 * pulse);
        core.endFill();
        core.beginFill(0xaaaaff, 0.5 * pulse);
        core.drawCircle(0, 0, r * 1.3 * pulse);
        core.endFill();
        core.beginFill(0xffffff, 0.95);
        core.drawCircle(0, 0, r * 0.5);
        core.endFill();
      }
      for (let i = 0; i < 4; i++) {
        const arc = c.getChildByName(`arc${i}`);
        if (!arc) continue;
        arc.clear();
        arc.lineStyle(1.5, 0xddddff, 0.7);
        const startAng = now / 100 + i * Math.PI / 2;
        let x1 = 0, y1 = 0;
        for (let j = 1; j <= 4; j++) {
          const jitter = (Math.sin(now/30 + i*7 + j*3) * 0.5) * r;
          const x2 = Math.cos(startAng + j * 0.4) * r * j * 0.4 + jitter;
          const y2 = Math.sin(startAng + j * 0.4) * r * j * 0.4 + jitter;
          arc.moveTo(x1, y1); arc.lineTo(x2, y2);
          x1 = x2; y1 = y2;
        }
      }
      break;
    }
    case 'lightningbolt':
      c.rotation = p.dir;
      break;
    case 'lightningspark':
      c.rotation = now / 100;
      break;
  }
}

function removeProjSprite(id) {
  if (projContainers[id]) {
    worldContainer.removeChild(projContainers[id]);
    delete projContainers[id];
  }
}

// ═══════════════════════════════════════════════════
//  OBSTACLE DRAWING
// ═══════════════════════════════════════════════════

function getOrCreateObstacle(id, ob) {
  if (obstacleSprites[id]) return obstacleSprites[id];
  const s = new PIXI.Sprite(texCache.rock);
  s.anchor.set(0.5);
  s.width = ob.radius * 2;
  s.height = ob.radius * 2;
  s.x = ob.x; s.y = ob.y;
  worldContainer.addChild(s);
  obstacleSprites[id] = s;
  return s;
}

// ═══════════════════════════════════════════════════
//  UI
// ═══════════════════════════════════════════════════
function drawUI(now, pl) {
  uiContainer.removeChildren();
  const W = app.screen.width, H = app.screen.height;

  // ── SKILL BARS ──
  const skillBarW = 80, skillBarH = 12, skillSpacing = 28;
  const totalW = skillBarW * 3 + skillSpacing * 2;
  const startX = W / 2 - totalW / 2;
  const barY = H - 35;

  ['Q','E','F'].forEach((key, i) => {
    const t = new PIXI.Text(key, { fontSize: 15, fill: 0xcccccc, fontWeight: '600' });
    t.anchor.set(0.5);
    t.x = startX + skillBarW / 2 + i * (skillBarW + skillSpacing);
    t.y = barY - 18;
    uiContainer.addChild(t);
  });

  [[pl.renderSkill1cd ?? pl.skill1cd, 0],
   [pl.renderSkill2cd ?? pl.skill2cd, 1],
   [pl.renderSkill3cd ?? pl.skill3cd, 2]].forEach(([cd, i]) => {
    const x = startX + i * (skillBarW + skillSpacing);
    // bg
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.65);
    bg.drawRoundedRect(x, barY, skillBarW, skillBarH, 5);
    bg.endFill();
    uiContainer.addChild(bg);
    // fill (inverse of cd)
    if (cd < 1) {
      const fill = new PIXI.Graphics();
      fill.beginFill(0x00ccff, 0.85);
      fill.drawRoundedRect(x, barY, skillBarW * (1 - cd), skillBarH, 5);
      fill.endFill();
      // shine
      fill.beginFill(0xffffff, 0.2);
      fill.drawRoundedRect(x, barY, skillBarW * (1 - cd), skillBarH / 2, 5);
      fill.endFill();
      uiContainer.addChild(fill);
    }
    // outline
    const outline = new PIXI.Graphics();
    outline.lineStyle(1, 0x446688, 0.6);
    outline.drawRoundedRect(x, barY, skillBarW, skillBarH, 5);
    uiContainer.addChild(outline);
  });

  // ── MINIMAP ──
  const mmSize = 180, mmX = 10, mmY = H - mmSize - 10;
  const mmBg = new PIXI.Graphics();
  mmBg.beginFill(0x000000, 0.4);
  mmBg.lineStyle(1, 0x446644, 0.6);
  mmBg.drawRect(mmX, mmY, mmSize, mmSize);
  mmBg.endFill();
  uiContainer.addChild(mmBg);

  // green fill
  const mmWorld = new PIXI.Graphics();
  mmWorld.beginFill(0x2a5a2a, 0.5);
  mmWorld.drawRect(mmX + 1, mmY + 1, mmSize - 2, mmSize - 2);
  mmWorld.endFill();
  uiContainer.addChild(mmWorld);

  const mmScale = mmSize / WORLD;
  for (const [id, p] of Object.entries(players)) {
    const dot = new PIXI.Graphics();
    const st = CLASS_STYLES[p.gameClass] || CLASS_STYLES.fire;
    if (id === myId) {
      dot.beginFill(0x88aaff, 1);
      dot.drawCircle(mmX + p.renderX * mmScale, mmY + p.renderY * mmScale, 4);
      dot.endFill();
      dot.lineStyle(1, 0xffffff, 0.7);
      dot.drawCircle(mmX + p.renderX * mmScale, mmY + p.renderY * mmScale, 4);
    } else {
      dot.beginFill(st.body, 0.85);
      dot.drawCircle(mmX + p.renderX * mmScale, mmY + p.renderY * mmScale, 3);
      dot.endFill();
    }
    uiContainer.addChild(dot);
  }

  // ── LEADERBOARD ──
  const lbW = 200, lbX = W - lbW - 10, lbY = 10;
  const lbBg = new PIXI.Graphics();
  lbBg.beginFill(0x000000, 0.45);
  lbBg.lineStyle(1, 0x335533, 0.5);
  lbBg.drawRoundedRect(lbX, lbY, lbW, 28 + Math.min(Object.keys(players).length, 10) * 26, 6);
  lbBg.endFill();
  uiContainer.addChild(lbBg);

  const lbTitle = new PIXI.Text('☠  LEADERBOARD', { fontSize: 12, fill: 0x99aa99, fontWeight: '700', letterSpacing: 1 });
  lbTitle.x = lbX + 10; lbTitle.y = lbY + 8;
  uiContainer.addChild(lbTitle);

  const sorted = Object.entries(players)
    .sort((a, b) => (b[1].killcount ?? 0) - (a[1].killcount ?? 0))
    .slice(0, 10);

  sorted.forEach(([id, p], i) => {
    let name = p.name || '?';
    if (name.length > 14) name = name.substring(0, 14) + '…';
    const isMe = id === myId;
    const row = new PIXI.Text(`${i + 1}. ${name}`, {
      fontSize: 13, fill: isMe ? 0xaaccff : 0xddeedd,
    });
    row.x = lbX + 10; row.y = lbY + 28 + i * 26;
    uiContainer.addChild(row);
    const kills = new PIXI.Text(`${p.killcount ?? 0}`, {
      fontSize: 13, fill: 0xffcc44, fontWeight: 'bold',
    });
    kills.anchor.set(1, 0);
    kills.x = lbX + lbW - 10; kills.y = lbY + 28 + i * 26;
    uiContainer.addChild(kills);
  });
}

// ═══════════════════════════════════════════════════
//  MAIN GAME LOOP
// ═══════════════════════════════════════════════════
function gameLoop() {
  const now = Date.now();
  if (!myId) return;
  if (now - 2000 > gameStartTime && !players[myId] && !dead) { triggerDeath(); return; }

  // movement
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

  // camera
  worldContainer.scale.set(zoom);
  worldContainer.x = app.screen.width  / 2 - pl.renderX * zoom;
  worldContainer.y = app.screen.height / 2 - pl.renderY * zoom;

  // obstacles
  for (const [id, ob] of Object.entries(obstacles)) getOrCreateObstacle(id, ob);

  // projectiles
  for (const [id, p] of Object.entries(projectiles)) updateProjSprite(id, p, now);
  for (const id of Object.keys(projContainers)) { if (!projectiles[id]) removeProjSprite(id); }

  // players
  for (const [id, p] of Object.entries(players)) updatePlayerSprite(id, p, now);
  for (const id of Object.keys(playerContainers)) { if (!players[id]) removePlayerSprite(id); }

  // UI
  drawUI(now, pl);
}

// ═══════════════════════════════════════════════════
//  WS
// ═══════════════════════════════════════════════════
function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', name: myName, class: myClass }));
  ws.onmessage = e => handleMessage(JSON.parse(e.data));
  ws.onerror = () => {};
  ws.onclose = () => {};
}

function handleMessage(msg) {
  const now = Date.now();
  if (msg.type === 'init') myId = msg.id;
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

// ── INPUT ────────────────────────────────────────
document.addEventListener('keydown', e => {
  pressed[e.key] = true;
  if (!myId || dead) return;
  if (e.key === 'q') sendAttack('skill1');
  if (e.key === 'e') sendAttack('skill2');
  if (e.key === 'f') sendAttack('skill3');
});
document.addEventListener('keyup', e => { pressed[e.key] = false; });
document.addEventListener('mousemove', e => {
  const pl = players[myId];
  if (!pl) return;
  const wx = (e.clientX - app.screen.width  / 2) / zoom + pl.renderX;
  const wy = (e.clientY - app.screen.height / 2) / zoom + pl.renderY;
  direction = Math.atan2(wy - pl.renderY, wx - pl.renderX);
});
document.addEventListener('mousedown', () => { if (myId && !dead) sendAttack('basicMelee'); });
document.addEventListener('wheel', e => {
  zoom = e.deltaY > 0 ? Math.min(2.0, zoom + 0.05) : Math.max(0.3, zoom - 0.05);
});
function sendAttack(move) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: 'attack', move, dir: direction }));
}

// ── DEATH ────────────────────────────────────────
function triggerDeath() {
  dead = true;
  document.getElementById('death-msg').textContent =
    `You got ${killcount} kill${killcount !== 1 ? 's' : ''}.`;
  document.getElementById('deathScreen').style.display = 'flex';
}

// ── JOIN SCREEN ──────────────────────────────────
let selectedClass = null;
document.querySelectorAll('.class-icon').forEach(icon => {
  icon.addEventListener('click', () => {
    document.querySelectorAll('.class-icon').forEach(i => i.classList.remove('selected'));
    icon.classList.add('selected');
    selectedClass = icon.dataset.class;
    checkReady();
  });
});
document.getElementById('name-input').addEventListener('input', checkReady);
function checkReady() {
  const name = document.getElementById('name-input').value.trim();
  document.getElementById('join-btn').disabled = !(name.length > 0 && selectedClass);
}
document.getElementById('join-btn').addEventListener('click', () => {
  myName = document.getElementById('name-input').value.trim();
  myClass = selectedClass;
  if (!myName || !myClass) return;
  document.getElementById('joinScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
  gameStartTime = Date.now(); dead = false; killcount = 0;
  players = {}; projectiles = {}; obstacles = {};
  clearScene();
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

function clearScene() {
  if (!worldContainer) return;
  while (worldContainer.children.length > 1) worldContainer.removeChildAt(1);
  playerContainers = {}; projContainers = {}; obstacleSprites = {};
}

// ── INIT ─────────────────────────────────────────
function initPixi() {
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

initPixi();
