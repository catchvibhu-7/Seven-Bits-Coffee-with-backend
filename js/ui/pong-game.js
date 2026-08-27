/**
 * SEVEN BITS COFFEE - PONG (arcade)
 * Location: /js/ui/pong-game.js
 *
 * Single-player vs a simple AI paddle (deliberately not real-time online -
 * see Tic-Tac-Toe for why that's the one game here with an online mode;
 * paddle-position sync over the request/SSE stack this server has would
 * feel laggy, and vs-AI is what actually plays well). Score is the length
 * of the current rally (successful player hits), submitted on game over.
 */
import { ArcadeSystem } from "../features/arcade-logic.js";

const WIDTH = 400;
const HEIGHT = 280;
const PADDLE_W = 8;
const PADDLE_H = 60;

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

    mount(root) {
        this.root = root;
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">PONG</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">RALLY: <strong id="pong-score" style="color:var(--color-accent);">0</strong></p>
            <canvas id="pong-canvas" width="${WIDTH}" height="${HEIGHT}" style="display:block; margin:0 auto; background:var(--color-bg); border:1px solid var(--color-border); max-width:100%; height:auto;"></canvas>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; max-width:200px; margin:10px auto 0;">
                <button id="pong-up" class="admin-btn">↑</button>
                <button id="pong-down" class="admin-btn">↓</button>
            </div>
            <div style="text-align:center; margin-top:10px;">
                <button id="pong-back" class="admin-btn">BACK</button>
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Arrow keys (or the buttons) to move your paddle.</p>
        `;
        this.canvas = this.root.querySelector("#pong-canvas");
        this.ctx = this.canvas.getContext("2d");

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
        this.resetBall(1);
        this.updateScore();
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.loop();
    },

    resetBall(direction) {
        this.ballX = WIDTH / 2;
        this.ballY = HEIGHT / 2;
        const speed = 3.5;
        const angle = Math.random() * 0.6 - 0.3;
        this.ballVX = Math.cos(angle) * speed * direction;
        this.ballVY = Math.sin(angle) * speed;
    },

    loop() {
        if (this.gameOver) return;
        this.update();
        this.draw();
        this.rafId = requestAnimationFrame(() => this.loop());
    },

    update() {
        const paddleSpeed = 5;
        if (this.keys.ArrowUp || this.touchUp) this.playerY -= paddleSpeed;
        if (this.keys.ArrowDown || this.touchDown) this.playerY += paddleSpeed;
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
            this.ballVX *= -1.05;
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
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.strokeStyle = "#333";
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(WIDTH / 2, 0);
        ctx.lineTo(WIDTH / 2, HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#d97706";
        ctx.fillRect(16, this.playerY, PADDLE_W, PADDLE_H);
        ctx.fillStyle = "#22d3ee";
        ctx.fillRect(WIDTH - 16 - PADDLE_W, this.aiY, PADDLE_W, PADDLE_H);

        ctx.fillStyle = "#f9fafb";
        ctx.beginPath();
        ctx.arc(this.ballX, this.ballY, 5, 0, Math.PI * 2);
        ctx.fill();
    },

    async endGame() {
        this.gameOver = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        await ArcadeSystem.submitScore("pong", this.score);
        if (this.onScoreSubmitted) this.onScoreSubmitted();
        const overlay = document.createElement("div");
        overlay.style.cssText = "text-align:center; margin-top:16px;";
        overlay.innerHTML = `
            <p style="font-size:1.1rem; color:var(--color-danger); margin-bottom:10px;">GAME OVER - RALLY: ${this.score}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:0 auto;">
                <button id="pong-again" class="admin-btn-primary">PLAY AGAIN</button>
            </div>
        `;
        this.root.querySelector("#pong-back").insertAdjacentElement("beforebegin", overlay);
        overlay.querySelector("#pong-again").addEventListener("click", () => {
            overlay.remove();
            this.startGame();
        });
    },

    onExit: () => {},
    onScoreSubmitted: null
};
