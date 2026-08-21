/* game.js - the Block Break game logic.
   Upgrade: full screen, better graphics, arrow keys that work,
   and the ball smashes exactly ONE brick per hit.

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
const WALL = 12;          // visible wall bar thickness (game units)

/* Brick grid. Bottom rows are worth more points. */
const ROWS     = 6;
const COLS     = 12;
const BRICK_W  = 110;
const BRICK_H  = 24;
const GAP      = 5;
const BRICK_TOP = 60;

/* One pretty colour per row (top row first). */
const BRICK_COLORS = [
  ["#ff5f6e", "#ff8fa3"], // row 5 (top)    - base + highlight
  ["#ffa14a", "#ffc27a"],
  ["#ffd23e", "#ffe993"],
  ["#6ee7b7", "#a8f5d4"],
  ["#4dabf7", "#8fd0ff"],
  ["#b197fc", "#d4bcff"],  // row 0 (bottom)
];
/* Points per row (top row is worth least). */
const BRICK_POINTS = [10, 20, 30, 40, 50, 60];

/* ============================================================
   2. GAME STATE
   ============================================================ */
let canvas, ctx;          // drawing surface

let paddle = { x: W / 2 };

let ball = {
  x: W / 2,
  y: PADDLE_Y - 40,
  dx: 0,
  dy: 0,
  speed: 7,
  active: false,          // false = resting on the paddle
};

let bricks = [];
let particles = [];       // little burst squares when a brick breaks
let trail = [];           // the ball's fading after-image
let stars = [];           // background twinkles

let score = 0;
let best = 0;
let lives = 3;
let level = 1;
let running = false;
let mouseX = null;        // last known mouse x (logical units)

let scale = 1;            // stretches logical units to screen
let drawnLevel = 0;       // to show "Level N" briefly at level start

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

document.getElementById("pauseBtn").addEventListener("click",      pauseGame);
document.getElementById("resumeBtn").addEventListener("click",     resumeGame);
document.getElementById("restartBtn").addEventListener("click",    showStart);
document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);
startBtn.addEventListener("click", startLevel);

/* Track arrow keys held down. */
const KEYS = {};
document.addEventListener("keydown", (e) => {
  KEYS[e.key] = true;
  // Prevent arrow keys from scrolling the page
  if (["ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
});
document.addEventListener("keyup", (e) => { KEYS[e.key] = false; });

/* Follow the mouse, converting screen pixels back into logical units. */
canvasEl.addEventListener("mousemove", (e) => {
  const rect = canvasEl.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) / scale;
});

/* ============================================================
   4. FILL THE SCREEN
   Looks at the window size and works out how much to stretch
   the game so it fits, keeping the right shape (aspect ratio).
   ============================================================ */
function resizeToScreen() {
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  // Smallest stretch keeps the whole game visible with room around.
  scale = Math.min(winW / W, winH / H);

  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);

  // Make the canvas that many real pixels, so it stays crisp.
  canvasEl.style.width  = cw + "px";
  canvasEl.style.height = ch + "px";
  canvas.width  = cw;
  canvas.height = ch;

  // Centre it on the screen.
  canvasEl.style.left = Math.round((winW - cw) / 2) + "px";
  canvasEl.style.top  = Math.round((winH - ch) / 2) + "px";
}

canvas = canvasEl;
ctx = canvas.getContext("2d");
resizeToScreen();
window.addEventListener("resize", resizeToScreen);

/* ============================================================
   5. BUILD A LEVEL OF BRICKS
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

/* Make the background stars once (tiny twinkles behind the action). */
function makeStars() {
  stars = [];
  for (let i = 0; i < 56; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.6 + 0.4,
      tw: Math.random() * Math.PI * 2,
    });
  }
}

/* ============================================================
   6. DRAW THE GAME
   ============================================================ */
function draw() {
  // Start a new frame using the current screen scale.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Fill in the canvas background as a deep space gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#161a3e");
  bg.addColorStop(1, "#0a0d24");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Twinkle the stars.
  const t = Date.now() / 400;
  for (const s of stars) {
    ctx.fillStyle = "rgba(255,255,255," + (0.3 + 0.5 * Math.abs(Math.sin(s.tw + t))) + ")";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Faint danger line near the floor.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();
  ctx.setLineDash([]);

  drawWalls();
  drawBricks();
  updateTrail();
  drawParticles();
  drawBall();
  drawPaddle();

  // "Level N" toast that fades out.
  if (drawnLevel > 0 && level > 1) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 42px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Level " + level, W / 2, H / 2 - 60);
    ctx.globalAlpha = 1;
  }
}

function drawBricks() {
  for (const b of bricks) {
    if (!b.alive) continue;
    const [base, hi] = BRICK_COLORS[b.row];
    // Rounded brick outline.
    roundRect(b.x, b.y, b.w, b.h, 6);
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, hi);
    g.addColorStop(1, base);
    ctx.fillStyle = g;
    ctx.fill();
    // A bright "shine" strip on top so they look glossy.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    roundRect(b.x + 8, b.y + 3, b.w - 16, 4, 2);
    ctx.fill();
  }
}

function drawPaddle() {
  const px = paddle.x - PADDLE_W / 2;
  const g = ctx.createLinearGradient(px, PADDLE_Y, px, PADDLE_Y + PADDLE_H);
  g.addColorStop(0, "#8fd0ff");
  g.addColorStop(0.4, "#4dabf7");
  g.addColorStop(1, "#2b6bd8");
  ctx.fillStyle = g;
  roundRect(px, PADDLE_Y, PADDLE_W, PADDLE_H, 9);
  ctx.fill();
  // A bright shine line along the top edge.
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  roundRect(px + 6, PADDLE_Y + 2, PADDLE_W - 12, 3, 2);
  ctx.fill();
}

/* Draw the frame (walls) the ball bounces off: top, left, right.
   The ball bounces off the INNER face of these, so a wall bar
   makes the boundary clear instead of blank space. */
function drawWalls() {
  // A thin glowing outline around the whole play area.
  ctx.strokeStyle = "rgba(90,130,220,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(WALL / 2, WALL / 2, W - WALL, H - WALL);   // inner frame line

  // A soft glowing bar on each bouncing edge (top, left, right).
  ctx.fillStyle = "rgba(120,160,255,0.22)";
  // Top wall
  ctx.fillRect(0, 0, W, WALL);
  // Left wall
  ctx.fillRect(0, 0, WALL, H);
  // Right wall
  ctx.fillRect(W - WALL, 0, WALL, H);

  ctx.lineWidth = 1;
}

function drawBall() {
  // Fading trail.
  for (const t of trail) {
    ctx.globalAlpha = t.a;
    ctx.fillStyle = "#ffe66c";
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Soft outer glow.
  ctx.shadowColor = "#ffe66c";
  ctx.shadowBlur = 18;
  const g = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 2, ball.x, ball.y, BALL_R);
  g.addColorStop(0, "#fffbe8");
  g.addColorStop(0.6, "#ffd23e");
  g.addColorStop(1, "#ff8c00");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/* Particles: update their position and draw them. */
function drawParticles() {
  for (const p of particles) {
    p.vx *= 0.94; p.vy = p.vy * 0.94 + 0.25;  // slow down + gravity
    p.x += p.vx; p.y += p.vy;
    p.life -= 0.06;
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;
  particles = particles.filter(p => p.life > 0);
}

/* Fade the ball's after-images so the trail melts away smoothly. */
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
  if (ball.active) moveBall();          // move the ball + bounce off walls
  checkBrickCollisions();               // smash bricks (one per hit)
  checkPaddleHit();
  checkFloor();
  checkWin();
  draw();
  updateHUD();

  setTimeout(frame, 16);
}

/* ============================================================
   8. MOVE THE PADDLE (keys beat the mouse)
   THE FIX: the mouse used to override the keys every single
   frame. Now, keys are checked FIRST - if you're holding an
   arrow key, that wins; otherwise the mouse steers.
   ============================================================ */
function movePaddle() {
  const left  = KEYS["ArrowLeft"];
  const right = KEYS["ArrowRight"];

  if (left)  paddle.x -= 15;
  if (right) paddle.x += 15;

  // Only use the mouse when no arrow key is held.
  if (!left && !right && mouseX !== null) paddle.x = mouseX;

  // Keep the paddle inside the play area (the walls).
  paddle.x = clamp(paddle.x, WALL + PADDLE_W / 2, W - WALL - PADDLE_W / 2);

  // If the ball is still resting, it rides along on the paddle.
  if (!ball.active) ball.x = paddle.x;
}

/* ============================================================
   9. MOVE THE BALL (with bouncing)
   ============================================================ */
function moveBall() {
  // Save a trail dot each frame.
  trail.push({ x: ball.x, y: ball.y, r: BALL_R * 0.85, a: 0.35 });
  if (trail.length > 9) trail.shift();

  ball.x += ball.dx;
  ball.y += ball.dy;

  if (ball.x - BALL_R < WALL)     { ball.x = WALL + BALL_R;      ball.dx = Math.abs(ball.dx); }
  if (ball.x + BALL_R > W - WALL) { ball.x = W - WALL - BALL_R;  ball.dx = -Math.abs(ball.dx); }
  if (ball.y - BALL_R < WALL)     { ball.y = WALL + BALL_R;      ball.dy = Math.abs(ball.dy); }
}

function checkPaddleHit() {
  // Only bounce when the ball is moving DOWN and touches the paddle top.
  const over = Math.abs(ball.x - paddle.x) < PADDLE_W / 2 + BALL_R;
  const near = ball.y + BALL_R >= PADDLE_Y && ball.y + BALL_R <= PADDLE_Y + PADDLE_H + 12;
  if (over && ball.dy > 0 && near) {
    const hit = (ball.x - paddle.x) / (PADDLE_W / 2);    // -1 .. +1
    ball.dx = hit * 5;
    ball.dy = -Math.abs(ball.dy);
    // Guard so the ball can never slide flat along the paddle.
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

  // Which brick overlaps the most right now? Break only that one.
  let bestB = null, bestDepth = 0;
  for (const b of bricks) {
    if (!b.alive) continue;
    if (right <= b.x || left >= b.x + b.w || bottom <= b.y || top >= b.y + b.h) continue;
    const d = Math.min(right - b.x, b.x + b.w - left, bottom - b.y, b.y + b.h - top);
    if (d > bestDepth) { bestDepth = d; bestB = b; }
  }
  if (!bestB) return;

  const b = bestB;
  // Work out which side we came from and flop the ball that way.
  const pLeft = right - b.x, pRight = b.x + b.w - left;
  const pTop = bottom - b.y, pBottom = b.y + b.h - top;
  const minP = Math.min(pLeft, pRight, pTop, pBottom);
  if (pTop === minP)      { ball.dy = Math.abs(ball.dy);  ball.y = b.y - BALL_R; }
  else if (pBottom === minP){ ball.dy = -Math.abs(ball.dy); ball.y = b.y + b.h + BALL_R; }
  else if (pLeft === minP)  { ball.dx = -Math.abs(ball.dx); ball.x = b.x - BALL_R; }
  else                      { ball.dx = Math.abs(ball.dx);  ball.x = b.x + b.w + BALL_R; }

  // Boom - this one brick breaks (the ONLY one this hit).
  b.alive = false;
  score += BRICK_POINTS[b.row] * level;
  best = Math.max(best, score);
  burst(b.x + b.w / 2, b.y + b.h / 2, BRICK_COLORS[b.row][0]);
}

/* A little explosion of coloured squares. */
function burst(x, y, color) {
  for (let i = 0; i < 14; i++) {
    particles.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.8) * 8,
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
  ball.speed = Math.min(7 + (level - 1) * 0.5, 14);
  buildBricks();
  respawnBall();
  updateHUD();
  showMessage("Level " + level + " clear!",
              "You earned an extra life. Click to continue.", "▶ Continue");
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
  ball.speed = 7;
  buildBricks();
  respawnBall();
  updateHUD();
  showMessage("Ready?",
              "Move the paddle with your mouse or the arrow keys.\nDon't let the ball touch the floor!",
              "▶ Start Game");
}

function startLevel() {
  messageEl.style.visibility = "hidden";
  running = true;
  ball.active = true;
  ball.dy = -ball.speed;
  frame();
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

function showMessage(title, text, btnText) {
  msgTitle.textContent = title;
  msgText.textContent = text;
  startBtn.textContent = btnText;
  messageEl.style.visibility = "visible";
  running = false;
}

function showLose() {
  localStorage.setItem("blockBest", String(best));
  showMessage("💥 Game over", "You scored " + score +
              ".\nYour best this session is " + best + ".", "▶ Try Again");
}

/* ============================================================
   13. UPDATE THE NUMBERS AT THE TOP
   ============================================================ */
function updateHUD() {
  scoreEl.textContent = score;
  bestEl.textContent = Math.max(best, score);
  let hearts = "";
  for (let i = 0; i < 5; i++) hearts += i < lives ? "&#9829;" : "&#9825;";
  livesEl.innerHTML = hearts;
}

/* ============================================================
   14. STARTUP
   ============================================================ */
function init() {
  makeStars();
  buildBricks();
  respawnBall();
  updateHUD();
  showStart();
}

init();

/* Helpers */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }