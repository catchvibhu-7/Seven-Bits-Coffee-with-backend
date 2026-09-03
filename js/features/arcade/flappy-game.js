/**
 * SEVEN BITS COFFEE - FLAPPY BIT (arcade)
 * Location: /js/features/arcade/flappy-game.js
 *
 * Flappy Bird clone: tap/click/Space to flap, score +1 per pipe cleared.
 * Colors read live from the theme via themeColor() (canvas can't resolve
 * CSS vars itself): bird = accent, pipes = cyan.
 */
import { themeColor } from "../theme-colors.js";
import { runCountdown, submitScoreWithCelebration, loadDifficulty, saveDifficulty, difficultySelectorHtml, wireDifficultySelector, paintDifficultySelector } from "../game-fx.js";

const WIDTH = 300;
const HEIGHT = 400;
const BIRD_X = 60;
const BIRD_R = 10;
const PIPE_WIDTH = 40;
const DIFFICULTY_KEY = "sb-arcade-flappy-difficulty";
// The original fixed values (gravity 0.4, flap -7, gap 130) made the bird
// drop hard and fast with very little room to correct - "unable to play"
// territory for anyone but a very practiced player. NORMAL is a noticeably
// gentler fall with a wider gap; HARD is close to the old defaults.
const DIFFICULTY_PRESETS = {
    easy: { gravity: 0.22, flap: -5.2, gap: 175, pipeSpeed: 1.6, pipeInterval: 100 },
    normal: { gravity: 0.28, flap: -5.8, gap: 155, pipeSpeed: 1.9, pipeInterval: 95 },
    hard: { gravity: 0.38, flap: -6.8, gap: 130, pipeSpeed: 2.3, pipeInterval: 88 }
};

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
    difficulty: "normal",
    preset: null,

    mount(root) {
        this.root = root;
        this.difficulty = loadDifficulty(DIFFICULTY_KEY);
        this.root.innerHTML = `
            <div class="arcade-canvas-wrap">
                <canvas id="flap-canvas" width="${WIDTH}" height="${HEIGHT}" style="background:var(--color-bg); border:1px solid var(--color-border); cursor:pointer;"></canvas>
            </div>
            ${difficultySelectorHtml("flap-diff", this.difficulty)}
            <p id="flap-message" style="text-align:center; font-size:17px; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">Click/tap or press Space to flap.</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="flap-again" class="admin-btn-primary" style="display:none;">PLAY AGAIN</button>
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
        this.root.querySelector("#flap-again").addEventListener("click", () => this.startGame());
        wireDifficultySelector(this.root, "flap-diff", (d) => {
            this.difficulty = d;
            saveDifficulty(DIFFICULTY_KEY, d);
            paintDifficultySelector(this.root, "flap-diff", d);
            this.startGame();
        });

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
        this.preset = DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS.normal;
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
        this.birdVY = this.preset.flap;
    },

    loop() {
        if (this.gameOver) return;
        this.update();
        this.draw();
        this.rafId = requestAnimationFrame(() => this.loop());
    },

    update() {
        this.frame++;
        this.birdVY += this.preset.gravity;
        this.birdY += this.birdVY;

        if (this.frame % this.preset.pipeInterval === 0) {
            const gapY = 50 + Math.random() * (HEIGHT - 100 - this.preset.gap);
            this.pipes.push({ x: WIDTH, gapY, passed: false });
        }
        this.pipes.forEach((pipe) => (pipe.x -= this.preset.pipeSpeed));
        this.pipes = this.pipes.filter((pipe) => pipe.x > -PIPE_WIDTH);

        for (const pipe of this.pipes) {
            if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X) {
                pipe.passed = true;
                this.score++;
                this.updateScore();
            }
            const withinX = BIRD_X + BIRD_R > pipe.x && BIRD_X - BIRD_R < pipe.x + PIPE_WIDTH;
            const withinGap = this.birdY - BIRD_R > pipe.gapY && this.birdY + BIRD_R < pipe.gapY + this.preset.gap;
            if (withinX && !withinGap) {
                return this.endGame();
            }
        }

        if (this.birdY - BIRD_R < 0 || this.birdY + BIRD_R > HEIGHT) {
            this.endGame();
        }
    },

    updateScore() {
        const el = document.getElementById("arcade-current-score");
        if (el) el.textContent = this.score;
    },

    draw() {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.fillStyle = this.colors.pipe;
        this.pipes.forEach((pipe) => {
            ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);
            ctx.fillRect(pipe.x, pipe.gapY + this.preset.gap, PIPE_WIDTH, HEIGHT - pipe.gapY - this.preset.gap);
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
