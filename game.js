/* game.js - the Block Break game logic.
   THEME UPGRADE: slick 3D neon (cyan / electric violet, no rainbow).
   + ball speeds up a little more every stage you clear.

   Big idea of THIS version: the game world lives in a fixed
   "logical" space of 960 x 600 units, but the canvas stretches to
   fill your screen. We draw everything in logical units and let a
   "scale" factor stretch it up. That way the game looks big on any
   screen without the collision math breaking.
   ============================================================ */

/* ============================================================
   1. LOGICAL GAME-BOARD SIZES
   These are in "game units", not screen pixels.
   ============================================================ */
const W = 960;            // logical width
const H = 600;            // logical height

const PADDLE_W = 130;     // paddle width
const PADDLE_H = 18;      // paddle thickness
const PADDLE_Y = H - 64;  // paddle's position (near the bottom)

const BALL_R = 9;         // ball radius

const FLOOR_Y = H - 40;   // danger line near the bottom

/* Wall thickness. These draw the frame the ball bounces off.
   The ball already collides at the canvas edges (0 and W, top = 0);
   drawing walls right there makes the boundary visible. */
const WALL = 12;

/* Brick grid. Bottom rows are worth more points. */
const ROWS     = 6;
const COLS     = 12;
const BRICK_W  = 73;
const BRICK_H  = 24;
const GAP      = 5;
const BRICK_TOP = 60;

/* One sleek electric colour per row (top row first).
   A cool ramp: deep blue-violet at the top -> bright electric cyan
   at the bottom. We shade each into a 3D bevel when drawing. */
const BRICK_COLORS = [
  "#4d7cff", // row 5 (top)   deep blue-violet
  "#3f8eff", // row 4
  "#31a2ff", // row 3
  "#24b6ff", // row 2
  "#18caff", // row 1
  "#0be6ff", // row 0 (bottom) electric cyan (worth most)
];
/* Points per row (top row is worth least). */
const BRICK_POINTS = [10, 20, 30, 40, 50, 60];

/* ============================================================
   2. GAME STATE
   ============================================================ */
let canvas, ctx;

let paddle = { x: W / 2 };

let ball = {
  x: W / 2,
  y: PADDLE_Y - 40,
  dx: 0,
  dy: 0,
  speed: 8,
  active: false,          // false = resting on the paddle
};

let bricks = [];
let particles = [];
let trail = [];           // the ball's fading after-image
let stars = [];
let gridX = [];           // pre-made floor-grid vertical lines
let gridY = [];           // pre-made floor-grid horizontal lines

let score = 0;
let best = 0;
let lives = 3;
let level = 1;
let running = false;
let mouseX = null;

let scale = 1;
let drawnLevel = 0;

const savedBest = localStorage.getItem("blockBest");
if (savedBest) best = Number(savedBest);

/* ============================================================
   3. CONNECT TO THE PAGE
   ============================================================ */
const canvasEl  = document.getElementById("gameCanvas");
const scoreEl   = document.getElementById("score");
const bestEl    = document.getElementById("best");
const livesEl   = document.getElementById("lives");
const messageEl = document.getElementById("message");
const msgTitle  = document.getElementById("msgTitle");
const msgText   = document.getElementById("msgText");
const startBtn  = document.getElementById("startBtn");
const scoreEntry = document.getElementById("scoreEntry");
const nameInput  = document.getElementById("nameInput");
const saveScoreBtn = document.getElementById("saveScoreBtn");
const leaderboardList = document.getElementById("leaderboardList");

/* The big start button does different things depending on the game state:
   - on the menu             -> start a new game
   - "Try Again" (game over) -> reset AND start a new game
   - "Continue" (stage clear)-> carry on to the next stage
   We track that with pendingRestart so "Try Again" properly resets. */
let pendingRestart = false;

document.getElementById("pauseBtn").addEventListener("click",      pauseGame);
document.getElementById("resumeBtn").addEventListener("click",     resumeGame);
document.getElementById("restartBtn").addEventListener("click",    showStart);
document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);
document.getElementById("musicBtn").addEventListener("click",      toggleMusic);

startBtn.addEventListener("click", () => {
  if (pendingRestart) showStart();   // full reset first
  startLevel();
});
saveScoreBtn.addEventListener("click", saveScoreByName);

/* Track key held-down state (the combined keydown handler below
   also adds Space to launch). */
const KEYS = {};
document.addEventListener("keyup", (e) => { KEYS[e.key] = false; });

/* Follow the mouse, converting screen pixels back into logical units. */
canvasEl.addEventListener("mousemove", (e) => {
  const rect = canvasEl.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) / scale;
});

/* Click on the canvas to launch the ball when it's resting on the paddle
   (e.g. after you lose a life). */
canvasEl.addEventListener("mousedown", () => { launchIfResting(); });
document.addEventListener("keydown", (e) => {
  KEYS[e.key] = true;
  if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); launchIfResting(); }
  if (["ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
});

/* ============================================================
   4. FILL THE SCREEN
   ============================================================ */
function resizeToScreen() {
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  scale = Math.min(winW / W, winH / H);

  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);

  canvasEl.style.width  = cw + "px";
  canvasEl.style.height = ch + "px";
  canvas.width  = cw;
  canvas.height = ch;

  canvasEl.style.left = Math.round((winW - cw) / 2) + "px";
  canvasEl.style.top  = Math.round((winH - ch) / 2) + "px";
}

canvas = canvasEl;
ctx = canvas.getContext("2d");
resizeToScreen();
window.addEventListener("resize", resizeToScreen);

/* ============================================================
   5. BUILD A LEVEL + BACKGROUND EFFECTS
   ============================================================ */
function buildBricks() {
  bricks = [];
  const gridW = COLS * BRICK_W + (COLS - 1) * GAP;
  const startX = (W - gridW) / 2;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      bricks.push({
        x: startX + c * (BRICK_W + GAP),
        y: BRICK_TOP + r * (BRICK_H + GAP),
        w: BRICK_W,
        h: BRICK_H,
        alive: true,
        row: r,
      });
    }
  }
}

/* Build the fake 3D floor grid (a few horizontal + vertical neon lines). */
function makeGrid() {
  gridX = [];
  gridY = [];
  const innerLeft = WALL, innerRight = W - WALL, innerTop = WALL, innerBottom = FLOOR_Y;
  const step = 40;
  for (let x = innerLeft; x <= innerRight; x += step) gridX.push(x);
  for (let y = innerTop; y <= innerBottom; y += step * 0.8) gridY.push(y);
}

function makeStars() {
  stars = [];
  for (let i = 0; i < 70; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.5 + 0.4,
      tw: Math.random() * Math.PI * 2,
    });
  }
}

/* ============================================================
   6. DRAW THE GAME
   ============================================================ */
function draw() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  drawBackground();
  drawWallAura();      // breathing aurora that frames the arena
  drawWalls();
  drawBricks();
  updateTrail();
  drawTrail();
  drawParticles();
  drawBall();
  drawPaddle();

  if (drawnLevel > 0 && level > 1) {
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#7ae9ff";
    ctx.font = "bold 46px Segoe UI";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,220,255,0.9)";
    ctx.shadowBlur = 18;
    ctx.fillText("STAGE " + level, W / 2, H / 2 - 70);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

/* A 3D-ish backdrop: dark space + neon glow + perspective floor grid. */
function drawBackground() {
  // Deep radial space glow.
  const bg = ctx.createRadialGradient(W / 2, H * 0.25, 10, W / 2, H / 2, W * 0.75);
  bg.addColorStop(0, "#10173c");
  bg.addColorStop(0.55, "#0a0e22");
  bg.addColorStop(1, "#04060d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle drifting colour blobs (deep cyan + violet nebula feel).
  const t = Date.now() / 900;
  ctx.fillStyle = "rgba(20,40,90,0.20)";
  ctx.beginPath();
  ctx.arc(W / 2 + Math.sin(t) * 140, H * 0.28 + Math.cos(t * 0.8) * 60, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(60,20,110,0.14)";
  ctx.beginPath();
  ctx.arc(W / 2 - Math.cos(t) * 150, H * 0.7, 200, 0, Math.PI * 2);
  ctx.fill();

  // Perspective floor grid (only in the lower play area).
  ctx.strokeStyle = "rgba(30,120,220,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of gridX) { ctx.moveTo(x, WALL); ctx.lineTo(x, FLOOR_Y); }
  for (const y of gridY) { ctx.moveTo(WALL, y); ctx.lineTo(W - WALL, y); }
  ctx.stroke();

  // Twinkle the stars.
  const tt = Date.now() / 400;
  for (const s of stars) {
    ctx.fillStyle = "rgba(190,220,255," + (0.25 + 0.55 * Math.abs(Math.sin(s.tw + tt))) + ")";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Neon danger line near the floor (pulses with the aura).
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
  ctx.strokeStyle = "rgba(0,220,255," + (0.25 + pulse * 0.35) + ")";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(0,220,255,0.9)";
  ctx.shadowBlur = 14 + pulse * 12;
  ctx.beginPath(); ctx.moveTo(WALL, FLOOR_Y); ctx.lineTo(W - WALL, FLOOR_Y); ctx.stroke();
  ctx.lineWidth = 1; ctx.shadowBlur = 0;
}

/* Breathing aurora: a soft glowing halo that pulses around the arena. */
function drawWallAura() {
  const t = Date.now() / 400;
  const pulse = 0.5 + 0.5 * Math.sin(t);   // 0..1, slow breathing

  // A wide soft glow that hugs the play area and breathes.
  const r = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.85);
  r.addColorStop(0, "rgba(0,150,255," + (0.10 + pulse * 0.10) + ")");
  r.addColorStop(0.6, "rgba(120,80,255," + (0.06 + pulse * 0.06) + ")");
  r.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);

  // A glowing pulsing outline right on the inner frame.
  ctx.strokeStyle = "rgba(90,220,255," + (0.25 + pulse * 0.45) + ")";
  ctx.lineWidth = 6;
  ctx.shadowColor = "rgba(60,180,255,0.9)";
  ctx.shadowBlur = 26 + pulse * 18;
  ctx.strokeRect(WALL, WALL, W - WALL * 2, H - WALL * 2);
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
}

/* A glowing 3D frame. The ball bounces off these edges. */
function drawWalls() {
  // Soft outer glow ring around the whole arena.
  ctx.strokeStyle = "rgba(0,180,255,0.18)";
  ctx.lineWidth = 4;
  ctx.strokeRect(WALL - 6, WALL - 6, W - WALL * 2 + 12, H - WALL * 2 + 12);

  // Inner bright neon frame line.
  ctx.strokeStyle = "rgba(140,235,255,0.7)";
  ctx.lineWidth = 2;
  ctx.strokeRect(WALL, WALL, W - WALL * 2, H - WALL * 2);

  // Shiny gradient bars on each bouncing side.
  const gT = ctx.createLinearGradient(0, 0, W, 0);
  gT.addColorStop(0, "rgba(0,200,255,0.28)");
  gT.addColorStop(0.5, "rgba(150,130,255,0.30)");
  gT.addColorStop(1, "rgba(0,90,200,0.22)");

  const gV = ctx.createLinearGradient(0, 0, 0, H);
  gV.addColorStop(0, "rgba(0,200,255,0.22)");
  gV.addColorStop(1, "rgba(60,30,160,0.18)");

  ctx.fillStyle = gT;
  ctx.fillRect(WALL, 0, W - WALL * 2, WALL);       // top bar
  ctx.fillStyle = gV;
  ctx.fillRect(0, 0, WALL, H);                    // left bar
  ctx.fillRect(W - WALL, 0, WALL, H);             // right bar
}

/* Draw every brick as a glossy 3D bevel block. */
function drawBricks() {
  for (const b of bricks) {
    if (!b.alive) continue;
    const base = BRICK_COLORS[b.row];

    // 1. Drop shadow under the brick.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(b.x + 2, b.y + 6, b.w, b.h, 6);
    ctx.fill();

    // 2. A darker slab below + right = fake extrusion (3D depth).
    ctx.fillStyle = shade(base, -0.55);
    ctx.beginPath(); ctx.roundRect(b.x + 2, b.y + b.h - 5, b.w, 5, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(b.x + b.w - 4, b.y + 2, 4, b.h - 4, 2); ctx.fill();

    // 3. The main glossy face (lighter on top, darker below).
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0,   shade(base, 0.45));
    g.addColorStop(0.55, base);
    g.addColorStop(1,   shade(base, -0.18));
    ctx.fillStyle = g;
    roundRect(b.x, b.y, b.w, b.h, 6);
    ctx.fill();

    // 4. Bright "shine" strip near the top edge.
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    roundRect(b.x + 6, b.y + 2, b.w - 12, 3, 2);
    ctx.fill();

    // 5. A soft neon under-glow near the brick's bottom inner edge.
    ctx.shadowColor = base;
    ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    roundRect(b.x + 8, b.y + b.h - 5, b.w - 16, 3, 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/* The paddle: a hovering 3D bar with glowing rails. */
function drawPaddle() {
  const px = paddle.x - PADDLE_W / 2;
  const py = PADDLE_Y;

  // Halo under the paddle.
  ctx.shadowColor = "rgba(0,229,255,0.9)";
  ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(px, py, px, py + PADDLE_H);
  g.addColorStop(0,   "#eafaff");
  g.addColorStop(0.25, "#7adfff");
  g.addColorStop(1,   "#0b2f6e");
  ctx.fillStyle = g;
  roundRect(px + 2, py, PADDLE_W - 4, PADDLE_H, 8);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Magenta thruster rails on either side.
  ctx.fillStyle = "#ff2d7a";
  roundRect(px + 1, py + 3, 4, PADDLE_H - 4, 2);  ctx.fill();
  roundRect(px + PADDLE_W - 5, py + 3, 4, PADDLE_H - 4, 2); ctx.fill();

  // Bright top gloss + centre core line.
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  roundRect(px + 8, py + 1, PADDLE_W - 16, 2, 1); ctx.fill();
  ctx.fillStyle = "rgba(0,229,255,0.45)";
  roundRect(px + PADDLE_W / 2, py + 4, 2, PADDLE_H - 8, 1); ctx.fill();
}

/* The ball: a glowing energy orb with a comet trail. */
function drawTrail() {
  for (const t of trail) {
    ctx.globalAlpha = t.a;
    ctx.shadowColor = "rgba(40,220,255,0.8)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#6fe9ff";
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r * t.a + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawBall() {
  // Pulsing aura halo around the ball.
  const ap = 0.5 + 0.5 * Math.sin(Date.now() / 250);
  ctx.fillStyle = "rgba(0,200,255," + (0.10 + ap * 0.12) + ")";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R * 2.6 + ap * 3, 0, Math.PI * 2);
  ctx.fill();

  // Soft outer glow + layered energy core.
  ctx.shadowColor = "rgba(60,230,255,0.9)";
  ctx.shadowBlur = 26 + ap * 8;
  const g = ctx.createRadialGradient(
    ball.x - BALL_R * 0.35, ball.y - BALL_R * 0.35, 1,
    ball.x, ball.y, BALL_R
  );
  g.addColorStop(0,   "#ffffff");
  g.addColorStop(0.35, "#c9fbff");
  g.addColorStop(0.7,  "#3ceaff");
  g.addColorStop(1,   "#1a7fe0");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Bright hot core towards the top-left (so it looks lit).
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(ball.x - 1.6, ball.y - 1.6, BALL_R * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

/* Particles: update position + gravity, draw as tiny glowing squares. */
function drawParticles() {
  for (const p of particles) {
    p.vx *= 0.94; p.vy = p.vy * 0.94 + 0.25;
    p.x += p.vx; p.y += p.vy;
    p.life -= 0.05;
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  particles = particles.filter(p => p.life > 0);
}

/* Fade the ball's after-images so the trail melts away. */
function updateTrail() {
  for (const t of trail) t.a *= 0.82;
  trail = trail.filter((t) => t.a > 0.05);
  while (trail.length > 9) trail.shift();
}

/* ============================================================
   7. THE MAIN LOOP - about 60 times a second
   ============================================================ */
function frame() {
  if (!running) return;
  movePaddle();
  if (ball.active) moveBall();
  checkBrickCollisions();
  checkPaddleHit();
  checkFloor();
  checkWin();
  draw();
  updateHUD();

  setTimeout(frame, 16);
}

/* ============================================================
   8. MOVE THE PADDLE (keys beat the mouse)
   ============================================================ */
function movePaddle() {
  const left  = KEYS["ArrowLeft"];
  const right = KEYS["ArrowRight"];

  if (left)  paddle.x -= 15;
  if (right) paddle.x += 15;

  // Only use the mouse when no arrow key is held.
  if (!left && !right && mouseX !== null) paddle.x = mouseX;

  paddle.x = clamp(paddle.x, WALL + PADDLE_W / 2, W - WALL - PADDLE_W / 2);

  if (!ball.active) ball.x = paddle.x;
}

/* ============================================================
   9. MOVE THE BALL (with bouncing)
   ============================================================ */
function moveBall() {
  trail.push({ x: ball.x, y: ball.y, r: BALL_R * 0.85, a: 0.4 });
  if (trail.length > 9) trail.shift();

  ball.x += ball.dx;
  ball.y += ball.dy;

  if (ball.x - BALL_R < WALL)     { ball.x = WALL + BALL_R;      ball.dx = Math.abs(ball.dx); }
  if (ball.x + BALL_R > W - WALL) { ball.x = W - WALL - BALL_R;  ball.dx = -Math.abs(ball.dx); }
  if (ball.y - BALL_R < WALL)     { ball.y = WALL + BALL_R;      ball.dy = Math.abs(ball.dy); }
}

function checkPaddleHit() {
  const over = Math.abs(ball.x - paddle.x) < PADDLE_W / 2 + BALL_R;
  const near = ball.y + BALL_R >= PADDLE_Y && ball.y + BALL_R <= PADDLE_Y + PADDLE_H + 12;
  if (over && ball.dy > 0 && near) {
    const hit = (ball.x - paddle.x) / (PADDLE_W / 2);
    ball.dx = hit * 5;
    ball.dy = -Math.abs(ball.dy);
    if (Math.abs(ball.dy) < 3) ball.dy = ball.dy < 0 ? -3 : 3;
    ball.y = PADDLE_Y - BALL_R;
  }
}

/* ============================================================
   10. CHECK BRICK COLLISIONS - smash exactly ONE brick per hit
   ============================================================ */
function checkBrickCollisions() {
  if (!ball.active) return;
  const left   = ball.x - BALL_R;
  const right  = ball.x + BALL_R;
  const top    = ball.y - BALL_R;
  const bottom = ball.y + BALL_R;

  let bestB = null, bestDepth = 0;
  for (const b of bricks) {
    if (!b.alive) continue;
    if (right <= b.x || left >= b.x + b.w || bottom <= b.y || top >= b.y + b.h) continue;
    const d = Math.min(right - b.x, b.x + b.w - left, bottom - b.y, b.y + b.h - top);
    if (d > bestDepth) { bestDepth = d; bestB = b; }
  }
  if (!bestB) return;

  const b = bestB;
  const pLeft = right - b.x, pRight = b.x + b.w - left;
  const pTop = bottom - b.y, pBottom = b.y + b.h - top;
  const minP = Math.min(pLeft, pRight, pTop, pBottom);
  if (pTop === minP)       { ball.dy = Math.abs(ball.dy);  ball.y = b.y - BALL_R; }
  else if (pBottom === minP) { ball.dy = -Math.abs(ball.dy); ball.y = b.y + b.h + BALL_R; }
  else if (pLeft === minP)  { ball.dx = -Math.abs(ball.dx); ball.x = b.x - BALL_R; }
  else                      { ball.dx = Math.abs(ball.dx);  ball.x = b.x + b.w + BALL_R; }

  b.alive = false;
  score += BRICK_POINTS[b.row] * level;
  best = Math.max(best, score);
  burst(b.x + b.w / 2, b.y + b.h / 2, BRICK_COLORS[b.row]);
}

/* A little explosion of glowing neon squares. */
function burst(x, y, color) {
  for (let i = 0; i < 20; i++) {
    particles.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 9,
      vy: (Math.random() - 0.85) * 9,
      life: 1,
      color: color,
    });
  }
}

/* ============================================================
   11. WINNING / LOSING
   ============================================================ */
function checkWin() {
  const alive = bricks.filter(b => b.alive).length;
  if (alive > 0) return;

  level++;
  lives = Math.min(lives + 1, 5);
  /* THE SPEED UP: each cleared stage is 10% faster than the last.
     Starts around 8, keeps multiplying until it hits a fast cap. */
  ball.speed = Math.min(8 * Math.pow(1.1, level - 1), 22);
  buildBricks();
  respawnBall();
  updateHUD();
  showMessage("STAGE " + level + " clear!",
              "The ball got faster. You earned an extra life.\nClick to continue.",
              "▶ Continue");
}

function checkFloor() {
  if (ball.y - BALL_R < FLOOR_Y) return;
  loseBall();
}

function loseBall() {
  lives--;
  if (lives <= 0) { showLose(); return; }
  respawnBall();
  updateHUD();
}

function respawnBall() {
  ball.x = W / 2;
  ball.y = PADDLE_Y - 40;
  ball.dx = 0;
  ball.dy = ball.speed;
  ball.active = false;
}

/* ============================================================
   12. MENUS: START / PAUSE / RESUME
   ============================================================ */
function showStart() {
  score = 0; lives = 3; level = 1;
  ball.speed = 8;
  pendingRestart = false;             // not a restart, hide the name entry
  hideScoreEntry();
  buildBricks();
  respawnBall();
  updateHUD();
  showMessage("READY?",
              "Move the paddle with your mouse or the arrow keys.\nDon't let the ball touch the floor!",
              "▶ Start Game");
}

function startLevel() {
  messageEl.style.visibility = "hidden";
  running = true;
  launchBall();
  frame();
}

/* Launch the ball when it's resting on the paddle (a small sideways
   nudge so it doesn't always go perfectly straight up). */
function launchBall() {
  if (ball.active) return;
  ball.active = true;
  ball.dx = (Math.random() - 0.5) * 3;
  ball.dy = -ball.speed;
}

/* Click / Space: if the ball is resting mid-game (after losing a life),
   launch it. The big Start button handles the menu. */
function launchIfResting() {
  if (!running || ball.active) return;
  launchBall();
}

function pauseGame()  { running = false; }
function resumeGame() { if (!running) { running = true; frame(); } }

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else {
    document.documentElement.requestFullscreen().catch(() => {});
    setTimeout(resizeToScreen, 60);
  }
}

/* Go fullscreen (used automatically when the page opens). */
function enterFullscreen() {
  if (document.fullscreenElement) return;
  document.documentElement.requestFullscreen().catch(() => {});
  setTimeout(resizeToScreen, 60);
}

function showMessage(title, text, btnText) {
  msgTitle.textContent = title;
  msgText.textContent = text;
  startBtn.textContent = btnText;
  messageEl.style.visibility = "visible";
  running = false;
  hideScoreEntry();
}

function showLose() {
  localStorage.setItem("blockBest", String(best));
  // "Try Again" must fully reset the game, so flag it.
  pendingRestart = true;
  showMessage("GAME OVER",
              "You scored " + score + " reaching stage " + level +
              ".\nYour best this session is " + best + ".",
              "▶ Try Again");
  // Let the player type their name to save the score.
  if (score > 0) showScoreEntry();
}

/* ============================================================
   LEADERBOARD - saves scores to the browser so they survive a
   close-and-reopen. Stored under "blockLeaderboard".
   ============================================================ */
function loadLeaderboard() {
  try {
    const raw = localStorage.getItem("blockLeaderboard");
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function saveLeaderboard(list) {
  localStorage.setItem("blockLeaderboard", JSON.stringify(list.slice(0, 8)));
}

function renderLeaderboard() {
  const list = loadLeaderboard();
  leaderboardList.innerHTML = "";
  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No scores yet. Go smash some bricks!";
    leaderboardList.appendChild(li);
    return;
  }
  list.forEach((entry, i) => {
    const li = document.createElement("li");
    if (i === 0) li.className = "top";
    const name = document.createElement("span");
    name.className = "lname";
    name.textContent = (i + 1) + ". " + entry.name;
    const sc = document.createElement("span");
    sc.className = "lscore";
    sc.textContent = entry.score;
    li.appendChild(name);
    li.appendChild(sc);
    leaderboardList.appendChild(li);
  });
}

function showScoreEntry() {
  scoreEntry.style.display = "flex";
  nameInput.value = "";
  nameInput.focus();
}

function hideScoreEntry() {
  scoreEntry.style.display = "none";
}

function saveScoreByName() {
  const name = ((nameInput.value || "").trim() || "Player").slice(0, 12);
  const list = loadLeaderboard();
  list.push({ name: name, score: score, stage: level });
  list.sort((a, b) => b.score - a.score);   // best score first
  saveLeaderboard(list);
  renderLeaderboard();
  hideScoreEntry();
}

/* ============================================================
   13. UPDATE THE NUMBERS AT THE TOP
   ============================================================ */
function updateHUD() {
  scoreEl.textContent = score;
  bestEl.textContent = Math.max(best, score);
  let hearts = "";
  for (let i = 0; i < lives; i++) hearts += "&#9829;";
  if (lives <= 0) hearts = "&#9760;";
  livesEl.innerHTML = hearts;
}

/* ============================================================
   13b. CHILL MUSIC (generated with the Web Audio API)
   No audio files needed - we build a soft, dreamy lo-fi loop
   from scratch: mellow pad chords + a sparkly little melody.
   It starts on the first click (browsers block sound until
   you interact with the page), and you can mute it anytime.
   ============================================================ */
const musicBtn = document.getElementById("musicBtn");

let audioCtx = null;        // the audio engine (made on first click)
let musicOn = true;         // is the music allowed to play?
let musicTimer = null;      // timer that schedules the notes
let chordIndex = 0;         // where we are in the chord loop
let nextNoteTime = 0;       // when the next note should start

/* A gentle loop of chords. Each entry is an array of MIDI notes
   (60 = middle C). These are calm, jazzy "7th" chords. */
const CHORDS = [
  [60, 64, 67, 71],   // Cmaj7  (C E G B)
  [57, 60, 64, 67],   // Am7    (A C E G)
  [53, 57, 60, 64],   // Fmaj7  (F A C E)
  [55, 59, 62, 65],   // G7     (G B D F)
];
/* The pretty melody line on top (MIDI notes, rests = null). */
const MELODY = [72, null, 76, 74, 72, null, 67, 69, 71, null, 72, 74, 76, 74, 72, null];

/* Turn a MIDI note number into a real frequency (Hz). */
function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

/* Play one soft pad note (used for the chords). */
function playPad(freq, start, dur) {
  if (!audioCtx || !musicOn) return;
  const osc = audioCtx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(0.06, start + 0.4);  // fade in
  g.gain.linearRampToValueAtTime(0, start + dur);     // fade out
  osc.connect(g);
  g.connect(audioCtx.masterNode);
  osc.start(start);
  osc.stop(start + dur + 0.1);
}

/* Play one bright melody note. */
function playMelody(freq, start) {
  if (!audioCtx || !musicOn) return;
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(0.09, start + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
  osc.connect(g);
  g.connect(audioCtx.masterNode);
  osc.start(start);
  osc.stop(start + 1.2);
}

/* Schedule the next few seconds of chill music. */
function scheduleNotes() {
  if (!audioCtx) return;
  const step = 0.5;    // each note/beat is half a second

  while (nextNoteTime < audioCtx.currentTime + 1.5) {
    const chord = CHORDS[chordIndex];
    // Play the whole chord as a soft pad.
    for (const midi of chord) {
      playPad(midiToFreq(midi), nextNoteTime, step * 4);
    }
    // Play the melody note sitting on this beat.
    const mel = MELODY[chordIndex % MELODY.length];
    if (mel !== null) playMelody(midiToFreq(mel), nextNoteTime);
    nextNoteTime += step;
    chordIndex++;
  }
}

/* Turn the music on / off from the 🎵 button. */
function toggleMusic() {
  if (!audioCtx) return;   // nothing to mute yet
  musicOn = !musicOn;
  musicBtn.textContent = "🎵 Music: " + (musicOn ? "On" : "Off");
}

/* Start (or restart) the chill music. Call this on the first click. */
function startMusic() {
  if (!musicOn || audioCtx) return;   // already going, or muted
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const master = audioCtx.createGain();
  master.gain.value = 0.5;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  master.connect(filter);
  filter.connect(audioCtx.destination);
  audioCtx.masterNode = master;   // so playPad/playMelody can reach it
  nextNoteTime = audioCtx.currentTime + 0.1;
  scheduleNotes();
  musicTimer = setInterval(scheduleNotes, 500);
}

/* ============================================================
   14. STARTUP
   ============================================================ */
function init() {
  makeStars();
  makeGrid();
  buildBricks();
  respawnBall();
  updateHUD();
  renderLeaderboard();   // show saved scores when the page opens
  showStart();

  // Browsers won't let sound play until the user clicks/taps once,
  // so wait for the first interaction, then start the chill music.
  const kickOff = () => {
    startMusic();
    document.removeEventListener("pointerdown", kickOff);
    document.removeEventListener("keydown", kickOff);
    document.removeEventListener("mousedown", kickOff);
  };
  document.addEventListener("pointerdown", kickOff);
  document.addEventListener("keydown", kickOff);
  document.addEventListener("mousedown", kickOff);
  // Go fullscreen automatically the moment the page opens.
  setTimeout(enterFullscreen, 300);
}

init();

/* Helpers */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/* Lighten (frac > 0) or darken (frac < 0) a hex colour. */
function shade(hex, frac) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (frac >= 0) {
    r = Math.round(r + (255 - r) * frac);
    g = Math.round(g + (255 - g) * frac);
    b = Math.round(b + (255 - b) * frac);
  } else {
    const t = 1 + frac;
    r = Math.round(r * t);
    g = Math.round(g * t);
    b = Math.round(b * t);
  }
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }