/* game.js - the block-breaker game logic.
   Read this top to bottom: it sets up the game, runs a loop,
   and draws everything on the screen.

   The game is made of a few moving parts:
     + the PADDLE (your bar at the bottom, you steer it)
     + the BALL  (bounces around, smashes bricks)
     + the BRICKS (the grid you want to destroy)
   We store where each one is, then draw them every frame.
   ============================================================ */

/* ============================================================
   1. THE GAME BOARD (the sizes of everything)
   The canvas is 800 wide and 520 tall. We keep those numbers
   in variables so we can reuse them everywhere.
   ============================================================ */
const W = 800;            // canvas width  (pixels)
const H = 520;            // canvas height (pixels)

const PADDLE_W = 110;     // paddle width
const PADDLE_H = 16;      // paddle thickness
const PADDLE_Y = H - 42;  // paddle's vertical position (near the bottom)

const BALL_R = 8;         // ball radius (the ball is a circle)

const FLOOR_Y = H - 30;   // an invisible danger line near the bottom

/* Brick grid sizes. Bricks are arranged in rows (horizontal)
   and columns (vertical). */
const ROWS     = 6;       // how many rows of bricks
const COLS     = 10;      // how many bricks in each row
const BRICK_W  = 66;      // each brick's width
const BRICK_H  = 24;      // each brick's height
const GAP      = 4;       // small gap between bricks
const BRICK_TOP = 70;     // y position of the very first brick row

/* Brick colours, one per row (top row first).
   The bottom row is worth the most points. */
const BRICK_COLORS = [
  "#ff6b6b", // row 5 (top)
  "#ffa94d",
  "#ffd23e",
  "#6ee7b7",
  "#4dabf7",
  "#b197fc", // row 0 (bottom)
];
/* Points given for each row. Bottom row (index 0) = 60. */
const BRICK_POINTS = [60, 50, 40, 30, 20, 10];

/* ============================================================
   2. THE GAME STATE
   These variables remember what is happening right now.
   We change them as the game runs.
   ============================================================ */
let canvas, ctx;          // the drawing surface (connected in setup)

let paddle = { x: W / 2 }; // the paddle slides left/right, x = its centre

let ball = {
  x: W / 2,               // ball centre x
  y: PADDLE_Y - 30,       // ball centre y (sits just above the paddle)
  dx: 0,                  // sideways speed
  dy: 0,                  // up/down speed
  speed: 6,               // ball speed (goes up every level)
  active: false,          // false = resting on the paddle, not moving
};

let bricks = [];          // the list of bricks still standing
let score = 0;
let best = 0;
let lives = 3;
let level = 1;
let running = false;      // false = game is on a menu / paused
let mouseX = null;        // remember where the mouse is on the canvas

// Load the best score from the browser's memory if we have one.
const savedBest = localStorage.getItem("blockBest");
if (savedBest) best = Number(savedBest);

/* ============================================================
   3. CONNECT TO THE PAGE + WIRE UP THE BUTTONS
   ============================================================ */
const canvasEl  = document.getElementById("gameCanvas");
const scoreEl   = document.getElementById("score");
const bestEl    = document.getElementById("best");
const livesEl   = document.getElementById("lives");
const messageEl = document.getElementById("message");
const h2El      = messageEl.querySelector("h2");
const msgP      = messageEl.querySelector("p");
const startBtn  = document.getElementById("startBtn");

document.getElementById("pauseBtn").addEventListener("click",   pauseGame);
document.getElementById("resumeBtn").addEventListener("click",  resumeGame);
document.getElementById("restartBtn").addEventListener("click", showStart);
startBtn.addEventListener("click", startLevel);

/* Follow the mouse: store where it is on the canvas. */
canvasEl.addEventListener("mousemove", (e) => {
  mouseX = e.offsetX !== undefined ? e.offsetX : e.clientX;
});

/* Track which arrow keys are held down. */
const KEYS = {};
document.addEventListener("keydown", (e) => { KEYS[e.key] = true; });
document.addEventListener("keyup",   (e) => { KEYS[e.key] = false; });

/* ============================================================
   4. SET UP THE DRAWING SURFACE
   ============================================================ */
canvas = canvasEl;
ctx = canvas.getContext("2d");

/* ============================================================
   5. BUILD A LEVEL OF BRICKS
   This fills the `bricks` list with a grid of bricks.
   ============================================================ */
function buildBricks() {
  bricks = [];
  // How wide the whole grid of bricks is (all columns + gaps).
  const gridW = COLS * BRICK_W + (COLS - 1) * GAP;
  const startX = (W - gridW) / 2;  // centre the grid on the screen

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

/* ============================================================
   6. DRAW THE GAME ON THE SCREEN
   This is called every frame and redraws everything you see.
   ============================================================ */
function draw() {
  // 1. Clear the canvas with a dark blue background.
  ctx.fillStyle = "#1a1f38";
  ctx.fillRect(0, 0, W, H);

  // 2. A faint dashed line showing the danger zone.
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y);
  ctx.lineTo(W, FLOOR_Y);
  ctx.stroke();
  ctx.setLineDash([]);

  // 3. Draw every alive brick (with a darker border).
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.fillStyle = BRICK_COLORS[b.row];
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }

  // 4. Draw the ball as a glowing white circle.
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffe66c";
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 5. Draw the paddle as a rounded blue bar.
  ctx.fillStyle = "#4dabf7";
  roundRect(paddle.x - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, 8);
}

/* Helper: draws a rectangle with rounded corners.
   (Canvas has no built-in rounded rectangle, so we draw one.) */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/* ============================================================
   7. THE MAIN GAME LOOP - runs roughly 60 times per second
   Every frame: move things, then draw them, then repeat.
   ============================================================ */
function frame() {
  if (!running) return;        // game paused/menu? stop here.

  movePaddle();               // follow the mouse / arrow keys
  if (ball.active) moveBall();// only move the ball if it's flying
  checkBrickCollisions();     // did the ball hit a brick?
  checkFloor();               // did the ball fall past the paddle?
  draw();                     // redraw everything
  updateHUD();                // refresh the score / best / lives

  setTimeout(frame, 16);      // ask to run again in ~16ms (60fps)
}

/* ============================================================
   8. MOVE THE PADDLE
   ============================================================ */
function movePaddle() {
  // Follow the mouse if it's over (or was over) the canvas.
  if (mouseX !== null) paddle.x = mouseX;

  // Arrow keys also steer it.
  if (KEYS["ArrowLeft"])  paddle.x -= 14;
  if (KEYS["ArrowRight"]) paddle.x += 14;

  // Keep the paddle from going off the edges.
  paddle.x = clamp(paddle.x, PADDLE_W / 2, W - PADDLE_W / 2);

  // If the ball is resting (not launched), let it ride on the paddle.
  if (!ball.active) {
    ball.x = paddle.x;
  }
}

/* ============================================================
   9. MOVE THE BALL + BOUNCE IT
   ============================================================ */
function moveBall() {
  ball.x += ball.dx;
  ball.y += ball.dy;

  // Bounce off the left wall.
  if (ball.x - BALL_R < 0)        { ball.x = BALL_R;    ball.dx = Math.abs(ball.dx); }
  // Bounce off the right wall.
  if (ball.x + BALL_R > W)        { ball.x = W - BALL_R; ball.dx = -Math.abs(ball.dx); }
  // Bounce off the ceiling.
  if (ball.y - BALL_R < 0)        { ball.y = BALL_R;    ball.dy = Math.abs(ball.dy); }

  // Bounce off the paddle: only when the ball is coming DOWN and
  // its bottom edge touches the top of the paddle while its sides overlap.
  const ballBottom = ball.y + BALL_R;
  const overPaddle = Math.abs(ball.x - paddle.x) < PADDLE_W / 2 + BALL_R;
  if (overPaddle && ball.dy > 0 && ballBottomTouchesPaddle()) {
    // Where on the paddle did it land? -1 (left edge) .. +1 (right edge)
    const hit = (ball.x - paddle.x) / (PADDLE_W / 2);
    ball.dx = hit * 4;          // push left/right depending on the hit spot
    ball.dy = -Math.abs(ball.dy); // always bounce back up
    ball.y = PADDLE_Y - BALL_R;   // sit it on top of the paddle
  }
}

function ballBottomTouchesPaddle() {
  return ball.y + BALL_R >= PADDLE_Y && ball.y + BALL_R <= PADDLE_Y + PADDLE_H + 10;
}

/* ============================================================
   10. CHECK BRICK COLLISIONS
   When the ball overlaps a brick, we smash it and bounce back.
   ============================================================ */
function checkBrickCollisions() {
  // The ball's four edges (a box around the circle).
  const left   = ball.x - BALL_R;
  const right  = ball.x + BALL_R;
  const top    = ball.y - BALL_R;
  const bottom = ball.y + BALL_R;

  for (const b of bricks) {
    if (!b.alive) continue;

    // Does the ball's box overlap this brick's box at all?
    const overlap = !(right <= b.x || left >= b.x + b.w ||
                      bottom <= b.y || top >= b.y + b.h);
    if (!overlap) continue;

    // Work out how deep the ball pokes into each side of the brick.
    const pLeft   = right  - b.x;
    const pRight  = b.x + b.w - left;
    const pTop    = bottom - b.y;
    const pBottom = b.y + b.h - top;
    const minP = Math.min(pLeft, pRight, pTop, pBottom);

    // Flip the ball in the direction we hit from, and push it back out.
    if (minP === pTop)    { ball.dy =  Math.abs(ball.dy); ball.y = b.y - BALL_R; }
    else if (minP === pBottom) { ball.dy = -Math.abs(ball.dy); ball.y = b.y + b.h + BALL_R; }
    else if (minP === pLeft)   { ball.dx = -Math.abs(ball.dx); ball.x = b.x - BALL_R; }
    else                        { ball.dx =  Math.abs(ball.dx); ball.x = b.x + b.w + BALL_R; }

    // Smash the brick and add points.
    b.alive = false;
    score += BRICK_POINTS[b.row] * level;   // higher levels = more points
    best = Math.max(best, score);
    break;   // only smash one brick per frame to keep it clean
  }

  // Give the ball a touch of upward bias so it doesn't get stuck
  // rolling sideways along a row.
  if (Math.abs(ball.dx) > Math.abs(ball.dy) * 2.2) {
    ball.dy = ball.dy < 0 ? -4 : 4;
  }
}

/* ============================================================
   11. WINNING / LOSING
   ============================================================ */
function checkWin() {
  // Count bricks still standing.
  const aliveCount = bricks.filter((b) => b.alive).length;
  if (aliveCount > 0) return;

  // All bricks gone -> move to the next level.
  level++;
  lives = Math.min(lives + 1, 5);       // reward: an extra life each level
  ball.speed = Math.min(6 + (level - 1) * 0.5, 12);  // a little faster
  buildBricks();
  respawnBall();
  updateHUD();
  showMessage("Level " + level + " clear!",
              "You earned an extra life. Click to keep going.",
              "▶ Continue");
}

function checkFloor() {
  // Only a "miss" when the ball passes the paddle.
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
  ball.y = PADDLE_Y - 30;
  ball.dx = 0;
  ball.dy = ball.speed;
  ball.active = false;   // resting again, waiting to be launched
}

/* ============================================================
   12. MENUS: START / PAUSE / RESUME
   ============================================================ */
function showStart() {
  // Fresh setup for a brand new run (or a restart).
  score = 0; lives = 3; level = 1;
  ball.speed = 6;
  buildBricks();
  respawnBall();
  updateHUD();
  showMessage("Ready?",
              "Move the paddle with your mouse or arrow keys.\nDon't let the ball touch the floor!",
              "▶ Start Game");
}

function startLevel() {
  messageEl.style.visibility = "hidden";
  running = true;
  ball.active = true;                 // launch the ball upward
  ball.dy = -ball.speed;              // up is negative y
  frame();
}

function pauseGame()  { running = false; }
function resumeGame() { if (!running) { running = true; frame(); } }

/* A helper that shows the floating box with a title, a sentence,
   and a button - then waits for the button to be clicked. */
function showMessage(title, text, btnText) {
  h2El.textContent = title;
  msgP.textContent = text;
  startBtn.textContent = btnText;
  messageEl.style.visibility = "visible";
  running = false;
}

function showWin() {
  localStorage.setItem("blockBest", String(best));
  showMessage("🎉 You cleared it!", "Final score " + score + ". Nice work!",
              "▶ Play Again");
}

function showLose() {
  running = false;
  localStorage.setItem("blockBest", String(best));
  showMessage("💥 Game over", "You scored " + score +
              ".\nYour best this session is " + best + ".", "▶ Try Again");
}

/* ============================================================
   13. UPDATE THE NUMBERS ON THE PAGE
   ============================================================ */
function updateHUD() {
  scoreEl.textContent = score;
  bestEl.textContent = Math.max(best, score);

  // Hearts for lives: a filled heart per life, empty for lost ones.
  let hearts = "";
  for (let i = 0; i < 3; i++) hearts += i < lives ? "&#9829;" : "&#9825;";
  livesEl.innerHTML = hearts;
}

/* ============================================================
   14. STARTUP - this runs once when the page loads
   ============================================================ */
function init() {
  buildBricks();
  respawnBall();
  updateHUD();
  showStart();
}

init();  // get everything going

/* A small helper: keep a number inside a range. */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }