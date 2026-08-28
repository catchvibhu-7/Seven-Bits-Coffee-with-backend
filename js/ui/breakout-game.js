/**
 * SEVEN BITS COFFEE - BREAKOUT (arcade)
 * Location: /js/ui/breakout-game.js
 *
 * Paddle + ball breaking bricks - a natural sibling to Pong, reusing the
 * same physics style. Colors read live from the theme via themeColor()
 * (canvas can't resolve CSS vars itself): paddle = accent, bricks = cyan.
 */
import { themeColor } from "../features/theme-colors.js";
import { runCountdown, submitScoreWithCelebration, loadDifficulty, saveDifficulty, difficultySelectorHtml, wireDifficultySelector, paintDifficultySelector } from "../features/game-fx.js";

const WIDTH = 320;
const HEIGHT = 400;
const PADDLE_W = 60;
const PADDLE_H = 10;
const BALL_R = 5;
const BRICK_ROWS = 5;
const BRICK_COLS = 8;
const BRICK_H = 16;
const BRICK_GAP = 3;
const BRICK_TOP = 30;
const SENSITIVITY_KEY = "sb-arcade-breakout-sensitivity";
const DIFFICULTY_KEY = "sb-arcade-breakout-difficulty";
const DIFFICULTY_PRESETS = {
    easy: { ballVX: 1.8, ballVY: -2.1, steerMax: 3 },
    normal: { ballVX: 2.2, ballVY: -2.6, steerMax: 3.5 },
    hard: { ballVX: 2.8, ballVY: -3.2, steerMax: 4.5 }
};

function loadSensitivity() {
    try {
        const stored = parseInt(localStorage.getItem(SENSITIVITY_KEY), 10);
        return Number.isFinite(stored) && stored >= 2 && stored <= 10 ? stored : 5;
    } catch (e) {
        return 5;
    }
}

function saveSensitivity(value) {
    try {
        localStorage.setItem(SENSITIVITY_KEY, String(value));
    } catch (e) {
        // Private-browsing/storage-blocked - the slider still works for this session.
    }
}

export const BreakoutGame = {
    root: null,
    canvas: null,
    ctx: null,
    paddleX: 0,
    ballX: 0,
    ballY: 0,
    ballVX: 0,
    ballVY: 0,
    bricks: null,
    score: 0,
    gameOver: false,
    keys: null,
    touchLeft: false,
    touchRight: false,
    rafId: null,
    keyDownHandler: null,
    keyUpHandler: null,
    colors: null,
    paddleSpeed: 5,
    difficulty: "normal",

    mount(root) {
        this.root = root;
        this.paddleSpeed = loadSensitivity();
        this.difficulty = loadDifficulty(DIFFICULTY_KEY);
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">BREAKOUT</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">SCORE: <strong id="brk-score" style="color:var(--color-accent);">0</strong></p>
            <div class="arcade-canvas-wrap">
                <canvas id="brk-canvas" width="${WIDTH}" height="${HEIGHT}" style="background:var(--color-bg); border:1px solid var(--color-border);"></canvas>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; max-width:200px; margin:10px auto 0;">
                <button id="brk-left" class="admin-btn">←</button>
                <button id="brk-right" class="admin-btn">→</button>
            </div>
            <div style="max-width:280px; margin:14px auto 0; display:flex; align-items:center; gap:8px; font-size:8pt; color:var(--color-text-muted);">
                <span>PADDLE SPEED</span>
                <input type="range" id="brk-sensitivity" min="2" max="10" step="1" value="${this.paddleSpeed}" style="flex:1;">
                <strong id="brk-sensitivity-val" style="color:var(--color-accent); min-width:1.4em; text-align:right;">${this.paddleSpeed}</strong>
            </div>
            ${difficultySelectorHtml("brk-diff", this.difficulty)}
            <p id="brk-message" style="text-align:center; font-size:1.05rem; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;"></p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="brk-again" class="admin-btn-primary" style="display:none;">PLAY AGAIN</button>
                <button id="brk-back" class="admin-btn">BACK</button>
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Arrow keys (or the buttons) to move the paddle.</p>
        `;
        this.canvas = this.root.querySelector("#brk-canvas");
        this.ctx = this.canvas.getContext("2d");
        this.root.querySelector("#brk-sensitivity").addEventListener("input", (e) => {
            this.paddleSpeed = parseInt(e.target.value, 10);
            this.root.querySelector("#brk-sensitivity-val").textContent = this.paddleSpeed;
            saveSensitivity(this.paddleSpeed);
        });
        wireDifficultySelector(this.root, "brk-diff", (d) => {
            this.difficulty = d;
            saveDifficulty(DIFFICULTY_KEY, d);
            paintDifficultySelector(this.root, "brk-diff", d);
            this.startGame();
        });
        this.colors = {
            bg: themeColor("--color-bg", "#0a0a0a"),
            paddle: themeColor("--color-accent", "#d97706"),
            ball: themeColor("--color-text", "#f9fafb"),
            brick: themeColor("--color-cyan", "#22d3ee")
        };
        this.keys = {};
        this.keyDownHandler = (e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
            this.keys[e.key] = true;
        };
        this.keyUpHandler = (e) => {
            this.keys[e.key] = false;
        };
        document.addEventListener("keydown", this.keyDownHandler);
        document.addEventListener("keyup", this.keyUpHandler);

        const leftBtn = this.root.querySelector("#brk-left");
        const rightBtn = this.root.querySelector("#brk-right");
        leftBtn.addEventListener("mousedown", () => (this.touchLeft = true));
        leftBtn.addEventListener("mouseup", () => (this.touchLeft = false));
        leftBtn.addEventListener("mouseleave", () => (this.touchLeft = false));
        leftBtn.addEventListener("touchstart", (e) => {
            e.preventDefault();
            this.touchLeft = true;
        });
        leftBtn.addEventListener("touchend", () => (this.touchLeft = false));
        rightBtn.addEventListener("mousedown", () => (this.touchRight = true));
        rightBtn.addEventListener("mouseup", () => (this.touchRight = false));
        rightBtn.addEventListener("mouseleave", () => (this.touchRight = false));
        rightBtn.addEventListener("touchstart", (e) => {
            e.preventDefault();
            this.touchRight = true;
        });
        rightBtn.addEventListener("touchend", () => (this.touchRight = false));

        this.root.querySelector("#brk-back").addEventListener("click", () => this.exit());
        this.root.querySelector("#brk-again").addEventListener("click", () => this.startGame());

        this.startGame();
    },

    unmount() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        if (this.keyDownHandler) document.removeEventListener("keydown", this.keyDownHandler);
        if (this.keyUpHandler) document.removeEventListener("keyup", this.keyUpHandler);
        this.keyDownHandler = null;
        this.keyUpHandler = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        const preset = DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS.normal;
        this.paddleX = WIDTH / 2 - PADDLE_W / 2;
        this.ballX = WIDTH / 2;
        this.ballY = HEIGHT - 40;
        this.ballVX = preset.ballVX;
        this.ballVY = preset.ballVY;
        this.score = 0;
        this.gameOver = false;
        this.bricks = Array.from({ length: BRICK_ROWS * BRICK_COLS }, () => ({ alive: true }));
        this.root.querySelector("#brk-message").textContent = "";
        this.root.querySelector("#brk-again").style.display = "none";
        this.updateScore();
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.draw();
        runCountdown(this.root, () => this.loop());
    },

    brickWidth() {
        return (WIDTH - BRICK_GAP * (BRICK_COLS + 1)) / BRICK_COLS;
    },

    loop() {
        if (this.gameOver) return;
        this.update();
        this.draw();
        this.rafId = requestAnimationFrame(() => this.loop());
    },

    update() {
        if (this.keys.ArrowLeft || this.touchLeft) this.paddleX -= this.paddleSpeed;
        if (this.keys.ArrowRight || this.touchRight) this.paddleX += this.paddleSpeed;
        this.paddleX = Math.max(0, Math.min(WIDTH - PADDLE_W, this.paddleX));

        this.ballX += this.ballVX;
        this.ballY += this.ballVY;

        if (this.ballX <= BALL_R || this.ballX >= WIDTH - BALL_R) this.ballVX *= -1;
        if (this.ballY <= BALL_R) this.ballVY *= -1;

        const paddleY = HEIGHT - 20;
        if (
            this.ballVY > 0 &&
            this.ballY + BALL_R >= paddleY &&
            this.ballY + BALL_R <= paddleY + PADDLE_H &&
            this.ballX >= this.paddleX &&
            this.ballX <= this.paddleX + PADDLE_W
        ) {
            this.ballVY *= -1;
            // Steer based on where it hit the paddle, like a real Breakout.
            const preset = DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS.normal;
            const hitPos = (this.ballX - (this.paddleX + PADDLE_W / 2)) / (PADDLE_W / 2);
            this.ballVX = hitPos * preset.steerMax;
        }

        const bw = this.brickWidth();
        for (let i = 0; i < this.bricks.length; i++) {
            const brick = this.bricks[i];
            if (!brick.alive) continue;
            const r = Math.floor(i / BRICK_COLS);
            const c = i % BRICK_COLS;
            const bx = BRICK_GAP + c * (bw + BRICK_GAP);
            const by = BRICK_TOP + r * (BRICK_H + BRICK_GAP);
            if (this.ballX + BALL_R >= bx && this.ballX - BALL_R <= bx + bw && this.ballY + BALL_R >= by && this.ballY - BALL_R <= by + BRICK_H) {
                brick.alive = false;
                this.ballVY *= -1;
                this.score += 10;
                this.updateScore();
                break;
            }
        }

        if (this.bricks.every((b) => !b.alive)) {
            this.endGame(true);
        } else if (this.ballY > HEIGHT) {
            this.endGame(false);
        }
    },

    updateScore() {
        const el = this.root.querySelector("#brk-score");
        if (el) el.textContent = this.score;
    },

    draw() {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        const bw = this.brickWidth();
        this.bricks.forEach((brick, i) => {
            if (!brick.alive) return;
            const r = Math.floor(i / BRICK_COLS);
            const c = i % BRICK_COLS;
            ctx.fillStyle = this.colors.brick;
            ctx.globalAlpha = 1 - r * 0.12;
            ctx.fillRect(BRICK_GAP + c * (bw + BRICK_GAP), BRICK_TOP + r * (BRICK_H + BRICK_GAP), bw, BRICK_H);
        });
        ctx.globalAlpha = 1;

        ctx.fillStyle = this.colors.paddle;
        ctx.fillRect(this.paddleX, HEIGHT - 20, PADDLE_W, PADDLE_H);

        ctx.fillStyle = this.colors.ball;
        ctx.beginPath();
        ctx.arc(this.ballX, this.ballY, BALL_R, 0, Math.PI * 2);
        ctx.fill();
    },

    async endGame(won) {
        this.gameOver = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "breakout", this.score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        const base = won ? `YOU CLEARED THE BOARD! - SCORE: ${this.score}` : `GAME OVER - SCORE: ${this.score}`;
        this.root.querySelector("#brk-message").textContent = newHighScore ? `NEW HIGH SCORE! ${base}` : base;
        this.root.querySelector("#brk-again").style.display = "";
    },

    onExit: () => {},
    onScoreSubmitted: null
};
