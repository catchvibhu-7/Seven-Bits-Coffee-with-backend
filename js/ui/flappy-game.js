/**
 * SEVEN BITS COFFEE - FLAPPY BIT (arcade)
 * Location: /js/ui/flappy-game.js
 *
 * Flappy Bird clone: tap/click/Space to flap, score +1 per pipe cleared.
 * Colors read live from the theme via themeColor() (canvas can't resolve
 * CSS vars itself): bird = accent, pipes = cyan.
 */
import { themeColor } from "../features/theme-colors.js";
import { runCountdown, submitScoreWithCelebration } from "../features/game-fx.js";

const WIDTH = 300;
const HEIGHT = 400;
const BIRD_X = 60;
const BIRD_R = 10;
const GRAVITY = 0.4;
const FLAP_VELOCITY = -7;
const PIPE_WIDTH = 40;
const PIPE_GAP = 130;
const PIPE_SPEED = 2.2;
const PIPE_INTERVAL = 90; // frames between spawns

export const FlappyGame = {
    root: null,
    canvas: null,
    ctx: null,
    birdY: 0,
    birdVY: 0,
    pipes: null,
    frame: 0,
    score: 0,
    gameOver: false,
    ready: false,
    rafId: null,
    clickHandler: null,
    touchHandler: null,
    keyHandler: null,
    colors: null,

    mount(root) {
        this.root = root;
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">FLAPPY BIT</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">SCORE: <strong id="flap-score" style="color:var(--color-accent);">0</strong></p>
            <canvas id="flap-canvas" width="${WIDTH}" height="${HEIGHT}" style="display:block; margin:0 auto; background:var(--color-bg); border:1px solid var(--color-border); max-width:100%; height:auto; cursor:pointer;"></canvas>
            <p id="flap-message" style="text-align:center; font-size:1.05rem; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">Click/tap or press Space to flap.</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="flap-again" class="admin-btn-primary" style="display:none;">PLAY AGAIN</button>
                <button id="flap-back" class="admin-btn">BACK</button>
            </div>
        `;
        this.canvas = this.root.querySelector("#flap-canvas");
        this.ctx = this.canvas.getContext("2d");
        this.colors = {
            bg: themeColor("--color-bg", "#0a0a0a"),
            bird: themeColor("--color-accent", "#d97706"),
            pipe: themeColor("--color-cyan", "#22d3ee")
        };
        this.clickHandler = () => this.flap();
        this.touchHandler = (e) => {
            e.preventDefault();
            this.flap();
        };
        this.canvas.addEventListener("mousedown", this.clickHandler);
        this.canvas.addEventListener("touchstart", this.touchHandler);
        this.keyHandler = (e) => {
            if (e.key === " ") {
                e.preventDefault();
                this.flap();
            }
        };
        document.addEventListener("keydown", this.keyHandler);
        this.root.querySelector("#flap-back").addEventListener("click", () => this.exit());
        this.root.querySelector("#flap-again").addEventListener("click", () => this.startGame());

        this.startGame();
    },

    unmount() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler);
        this.keyHandler = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        this.birdY = HEIGHT / 2;
        this.birdVY = 0;
        this.pipes = [];
        this.frame = 0;
        this.score = 0;
        this.gameOver = false;
        this.ready = false;
        this.root.querySelector("#flap-message").textContent = "Click/tap or press Space to flap.";
        this.root.querySelector("#flap-again").style.display = "none";
        this.updateScore();
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.draw();
        runCountdown(this.root, () => {
            this.ready = true;
            this.loop();
        });
    },

    flap() {
        if (this.gameOver || !this.ready) return;
        this.birdVY = FLAP_VELOCITY;
    },

    loop() {
        if (this.gameOver) return;
        this.update();
        this.draw();
        this.rafId = requestAnimationFrame(() => this.loop());
    },

    update() {
        this.frame++;
        this.birdVY += GRAVITY;
        this.birdY += this.birdVY;

        if (this.frame % PIPE_INTERVAL === 0) {
            const gapY = 50 + Math.random() * (HEIGHT - 100 - PIPE_GAP);
            this.pipes.push({ x: WIDTH, gapY, passed: false });
        }
        this.pipes.forEach((pipe) => (pipe.x -= PIPE_SPEED));
        this.pipes = this.pipes.filter((pipe) => pipe.x > -PIPE_WIDTH);

        for (const pipe of this.pipes) {
            if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X) {
                pipe.passed = true;
                this.score++;
                this.updateScore();
            }
            const withinX = BIRD_X + BIRD_R > pipe.x && BIRD_X - BIRD_R < pipe.x + PIPE_WIDTH;
            const withinGap = this.birdY - BIRD_R > pipe.gapY && this.birdY + BIRD_R < pipe.gapY + PIPE_GAP;
            if (withinX && !withinGap) {
                return this.endGame();
            }
        }

        if (this.birdY - BIRD_R < 0 || this.birdY + BIRD_R > HEIGHT) {
            this.endGame();
        }
    },

    updateScore() {
        const el = this.root.querySelector("#flap-score");
        if (el) el.textContent = this.score;
    },

    draw() {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.fillStyle = this.colors.pipe;
        this.pipes.forEach((pipe) => {
            ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);
            ctx.fillRect(pipe.x, pipe.gapY + PIPE_GAP, PIPE_WIDTH, HEIGHT - pipe.gapY - PIPE_GAP);
        });

        ctx.fillStyle = this.colors.bird;
        ctx.beginPath();
        ctx.arc(BIRD_X, this.birdY, BIRD_R, 0, Math.PI * 2);
        ctx.fill();
    },

    async endGame() {
        this.gameOver = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "flappy", this.score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        this.root.querySelector("#flap-message").textContent = newHighScore
            ? `NEW HIGH SCORE! - ${this.score}`
            : `GAME OVER - SCORE: ${this.score}`;
        this.root.querySelector("#flap-again").style.display = "";
    },

    onExit: () => {},
    onScoreSubmitted: null
};
