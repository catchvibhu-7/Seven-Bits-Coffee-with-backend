/**
 * SEVEN BITS COFFEE - PONG (arcade)
 * Location: /js/ui/pong-game.js
 *
 * Single-player vs a simple AI paddle (deliberately not real-time online -
 * see Tic-Tac-Toe for why that's the one game here with an online mode;
 * paddle-position sync over the request/SSE stack this server has would
 * feel laggy, and vs-AI is what actually plays well). Score is the length
 * of the current rally (successful player hits), submitted on game over.
 * Colors are read live from the theme (themeColor(), since canvas can't
 * resolve CSS vars itself): player paddle = accent, AI paddle = cyan.
 */
import { themeColor } from "../features/theme-colors.js";
import { runCountdown, submitScoreWithCelebration, loadDifficulty, saveDifficulty, difficultySelectorHtml, wireDifficultySelector, paintDifficultySelector } from "../features/game-fx.js";

const WIDTH = 400;
const HEIGHT = 280;
const PADDLE_W = 8;
const PADDLE_H = 60;
const SENSITIVITY_KEY = "sb-arcade-pong-sensitivity";
const DIFFICULTY_KEY = "sb-arcade-pong-difficulty";
// Ball speed grows `growth`x on every player hit (uncapped growth is what
// made this "increase way too fast" before - a few good rallies compounded
// into an unplayable speed) but is clamped to `max` so a long rally plateaus
// instead of spiraling.
const DIFFICULTY_PRESETS = {
    easy: { initial: 3.0, growth: 1.02, max: 6.0 },
    normal: { initial: 3.5, growth: 1.03, max: 7.5 },
    hard: { initial: 4.2, growth: 1.05, max: 10 }
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

export const PongGame = {
    root: null,
    canvas: null,
    ctx: null,
    playerY: 0,
    aiY: 0,
    ballX: 0,
    ballY: 0,
    ballVX: 0,
    ballVY: 0,
    score: 0,
    gameOver: false,
    keys: null,
    touchUp: false,
    touchDown: false,
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
            <h3 style="text-align:center; margin-bottom:8px;">PONG</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">RALLY: <strong id="pong-score" style="color:var(--color-accent);">0</strong></p>
            <canvas id="pong-canvas" width="${WIDTH}" height="${HEIGHT}" style="display:block; margin:0 auto; background:var(--color-bg); border:1px solid var(--color-border); max-width:100%; height:auto;"></canvas>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; max-width:200px; margin:10px auto 0;">
                <button id="pong-up" class="admin-btn">↑</button>
                <button id="pong-down" class="admin-btn">↓</button>
            </div>
            <div style="max-width:280px; margin:14px auto 0; display:flex; align-items:center; gap:8px; font-size:8pt; color:var(--color-text-muted);">
                <span>PADDLE SPEED</span>
                <input type="range" id="pong-sensitivity" min="2" max="10" step="1" value="${this.paddleSpeed}" style="flex:1;">
                <strong id="pong-sensitivity-val" style="color:var(--color-accent); min-width:1.4em; text-align:right;">${this.paddleSpeed}</strong>
            </div>
            ${difficultySelectorHtml("pong-diff", this.difficulty)}
            <p id="pong-message" style="text-align:center; font-size:1.05rem; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;"></p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="pong-again" class="admin-btn-primary" style="display:none;">PLAY AGAIN</button>
                <button id="pong-back" class="admin-btn">BACK</button>
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Arrow keys (or the buttons) to move your paddle.</p>
        `;
        this.canvas = this.root.querySelector("#pong-canvas");
        this.ctx = this.canvas.getContext("2d");
        this.root.querySelector("#pong-sensitivity").addEventListener("input", (e) => {
            this.paddleSpeed = parseInt(e.target.value, 10);
            this.root.querySelector("#pong-sensitivity-val").textContent = this.paddleSpeed;
            saveSensitivity(this.paddleSpeed);
        });
        wireDifficultySelector(this.root, "pong-diff", (d) => {
            this.difficulty = d;
            saveDifficulty(DIFFICULTY_KEY, d);
            paintDifficultySelector(this.root, "pong-diff", d);
            this.startGame();
        });
        this.colors = {
            bg: themeColor("--color-bg", "#0a0a0a"),
            border: themeColor("--color-border", "#333333"),
            player: themeColor("--color-accent", "#d97706"),
            ai: themeColor("--color-cyan", "#22d3ee"),
            ball: themeColor("--color-text", "#f9fafb")
        };

        this.keys = {};
        this.keyDownHandler = (e) => {
            if (["ArrowUp", "ArrowDown"].includes(e.key)) e.preventDefault();
            this.keys[e.key] = true;
        };
        this.keyUpHandler = (e) => {
            this.keys[e.key] = false;
        };
        document.addEventListener("keydown", this.keyDownHandler);
        document.addEventListener("keyup", this.keyUpHandler);

        const upBtn = this.root.querySelector("#pong-up");
        const downBtn = this.root.querySelector("#pong-down");
        upBtn.addEventListener("mousedown", () => (this.touchUp = true));
        upBtn.addEventListener("mouseup", () => (this.touchUp = false));
        upBtn.addEventListener("mouseleave", () => (this.touchUp = false));
        upBtn.addEventListener("touchstart", (e) => {
            e.preventDefault();
            this.touchUp = true;
        });
        upBtn.addEventListener("touchend", () => (this.touchUp = false));
        downBtn.addEventListener("mousedown", () => (this.touchDown = true));
        downBtn.addEventListener("mouseup", () => (this.touchDown = false));
        downBtn.addEventListener("mouseleave", () => (this.touchDown = false));
        downBtn.addEventListener("touchstart", (e) => {
            e.preventDefault();
            this.touchDown = true;
        });
        downBtn.addEventListener("touchend", () => (this.touchDown = false));

        this.root.querySelector("#pong-back").addEventListener("click", () => this.exit());
        this.root.querySelector("#pong-again").addEventListener("click", () => this.startGame());

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
        this.playerY = HEIGHT / 2 - PADDLE_H / 2;
        this.aiY = HEIGHT / 2 - PADDLE_H / 2;
        this.score = 0;
        this.gameOver = false;
        this.root.querySelector("#pong-message").textContent = "";
        this.root.querySelector("#pong-again").style.display = "none";
        this.resetBall(1);
        this.updateScore();
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.draw();
        runCountdown(this.root, () => this.loop());
    },

    resetBall(direction) {
        this.ballX = WIDTH / 2;
        this.ballY = HEIGHT / 2;
        const preset = DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS.normal;
        const angle = Math.random() * 0.6 - 0.3;
        this.ballVX = Math.cos(angle) * preset.initial * direction;
        this.ballVY = Math.sin(angle) * preset.initial;
    },

    // Scales vx/vy together so the ball's trajectory angle is preserved -
    // only its speed is capped.
    clampBallSpeed() {
        const preset = DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS.normal;
        const speed = Math.hypot(this.ballVX, this.ballVY);
        if (speed > preset.max) {
            const scale = preset.max / speed;
            this.ballVX *= scale;
            this.ballVY *= scale;
        }
    },

    loop() {
        if (this.gameOver) return;
        this.update();
        this.draw();
        this.rafId = requestAnimationFrame(() => this.loop());
    },

    update() {
        if (this.keys.ArrowUp || this.touchUp) this.playerY -= this.paddleSpeed;
        if (this.keys.ArrowDown || this.touchDown) this.playerY += this.paddleSpeed;
        this.playerY = Math.max(0, Math.min(HEIGHT - PADDLE_H, this.playerY));

        // Simple AI: chase the ball's y at a capped speed - fast enough to
        // be a real opponent, slow enough to actually lose rallies.
        const aiCenter = this.aiY + PADDLE_H / 2;
        const aiSpeed = 3.2;
        if (aiCenter < this.ballY - 10) this.aiY += aiSpeed;
        else if (aiCenter > this.ballY + 10) this.aiY -= aiSpeed;
        this.aiY = Math.max(0, Math.min(HEIGHT - PADDLE_H, this.aiY));

        this.ballX += this.ballVX;
        this.ballY += this.ballVY;

        if (this.ballY <= 0 || this.ballY >= HEIGHT) this.ballVY *= -1;

        if (
            this.ballVX < 0 &&
            this.ballX - 4 <= 16 + PADDLE_W &&
            this.ballX - 4 >= 16 &&
            this.ballY >= this.playerY &&
            this.ballY <= this.playerY + PADDLE_H
        ) {
            const preset = DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS.normal;
            this.ballVX *= -preset.growth;
            this.clampBallSpeed();
            this.score += 1;
            this.updateScore();
        }
        if (
            this.ballVX > 0 &&
            this.ballX + 4 >= WIDTH - 16 - PADDLE_W &&
            this.ballX + 4 <= WIDTH - 16 &&
            this.ballY >= this.aiY &&
            this.ballY <= this.aiY + PADDLE_H
        ) {
            this.ballVX *= -1.05;
        }

        if (this.ballX < 0) {
            this.endGame();
        } else if (this.ballX > WIDTH) {
            // The AI missed - send the ball back rather than ending the
            // round, since the rally count only tracks the player's hits.
            this.resetBall(-1);
        }
    },

    updateScore() {
        const el = this.root.querySelector("#pong-score");
        if (el) el.textContent = this.score;
    },

    draw() {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.strokeStyle = this.colors.border;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(WIDTH / 2, 0);
        ctx.lineTo(WIDTH / 2, HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = this.colors.player;
        ctx.fillRect(16, this.playerY, PADDLE_W, PADDLE_H);
        ctx.fillStyle = this.colors.ai;
        ctx.fillRect(WIDTH - 16 - PADDLE_W, this.aiY, PADDLE_W, PADDLE_H);

        ctx.fillStyle = this.colors.ball;
        ctx.beginPath();
        ctx.arc(this.ballX, this.ballY, 5, 0, Math.PI * 2);
        ctx.fill();
    },

    async endGame() {
        this.gameOver = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "pong", this.score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        this.root.querySelector("#pong-message").textContent = newHighScore
            ? `NEW HIGH SCORE! - RALLY: ${this.score}`
            : `GAME OVER - RALLY: ${this.score}`;
        this.root.querySelector("#pong-again").style.display = "";
    },

    onExit: () => {},
    onScoreSubmitted: null
};
