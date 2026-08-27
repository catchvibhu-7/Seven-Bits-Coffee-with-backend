/**
 * SEVEN BITS COFFEE - SNAKE (arcade)
 * Location: /js/ui/snake-game.js
 *
 * Single-player, canvas-rendered. Speed ramps up as the score grows (every
 * 5 points shaves 10ms off the tick interval, floored at 70ms) so it stays
 * a quick, casual round rather than dragging on.
 */
import { ArcadeSystem } from "../features/arcade-logic.js";

const COLS = 18;
const ROWS = 18;
const CELL = 20;

export const SnakeGame = {
    root: null,
    canvas: null,
    ctx: null,
    snake: null,
    direction: null,
    nextDirection: null,
    food: null,
    score: 0,
    tickTimer: null,
    gameOver: false,
    keyHandler: null,

    mount(root) {
        this.root = root;
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">SNAKE</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">SCORE: <strong id="snake-score" style="color:var(--color-accent);">0</strong></p>
            <canvas id="snake-canvas" width="${COLS * CELL}" height="${ROWS * CELL}" style="display:block; margin:0 auto; background:var(--color-bg); border:1px solid var(--color-border); max-width:100%; height:auto;"></canvas>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; max-width:160px; margin:10px auto 0;">
                <div></div><button id="sn-up" class="admin-btn">↑</button><div></div>
                <button id="sn-left" class="admin-btn">←</button><button id="sn-down" class="admin-btn">↓</button><button id="sn-right" class="admin-btn">→</button>
            </div>
            <div style="text-align:center; margin-top:10px;">
                <button id="snake-back" class="admin-btn">BACK</button>
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Arrow keys to steer.</p>
        `;
        this.canvas = this.root.querySelector("#snake-canvas");
        this.ctx = this.canvas.getContext("2d");
        this.root.querySelector("#sn-up").addEventListener("click", () => this.setDirection(0, -1));
        this.root.querySelector("#sn-down").addEventListener("click", () => this.setDirection(0, 1));
        this.root.querySelector("#sn-left").addEventListener("click", () => this.setDirection(-1, 0));
        this.root.querySelector("#sn-right").addEventListener("click", () => this.setDirection(1, 0));
        this.root.querySelector("#snake-back").addEventListener("click", () => this.exit());

        this.keyHandler = (e) => this.handleKey(e);
        document.addEventListener("keydown", this.keyHandler);

        this.startGame();
    },

    unmount() {
        this.stopTimer();
        if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler);
        this.keyHandler = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        this.snake = [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }];
        this.direction = { x: 1, y: 0 };
        this.nextDirection = { x: 1, y: 0 };
        this.score = 0;
        this.gameOver = false;
        this.placeFood();
        this.updateScore();
        this.draw();
        this.startTimer();
    },

    startTimer() {
        this.stopTimer();
        const speed = Math.max(70, 140 - Math.floor(this.score / 5) * 10);
        this.tickTimer = setInterval(() => this.tick(), speed);
    },

    stopTimer() {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
    },

    placeFood() {
        let pos;
        do {
            pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
        } while (this.snake.some((s) => s.x === pos.x && s.y === pos.y));
        this.food = pos;
    },

    setDirection(dx, dy) {
        // Disallow reversing straight into your own neck.
        if (this.direction.x === -dx && this.direction.y === -dy) return;
        this.nextDirection = { x: dx, y: dy };
    },

    handleKey(e) {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
        if (e.key === "ArrowUp") this.setDirection(0, -1);
        else if (e.key === "ArrowDown") this.setDirection(0, 1);
        else if (e.key === "ArrowLeft") this.setDirection(-1, 0);
        else if (e.key === "ArrowRight") this.setDirection(1, 0);
    },

    tick() {
        if (this.gameOver) return;
        this.direction = this.nextDirection;
        const head = { x: this.snake[0].x + this.direction.x, y: this.snake[0].y + this.direction.y };

        if (
            head.x < 0 ||
            head.x >= COLS ||
            head.y < 0 ||
            head.y >= ROWS ||
            this.snake.some((s) => s.x === head.x && s.y === head.y)
        ) {
            return this.endGame();
        }

        this.snake.unshift(head);
        if (head.x === this.food.x && head.y === this.food.y) {
            this.score += 10;
            this.updateScore();
            this.placeFood();
            this.startTimer(); // speed ramps up as the score grows
        } else {
            this.snake.pop();
        }
        this.draw();
    },

    updateScore() {
        const el = this.root.querySelector("#snake-score");
        if (el) el.textContent = this.score;
    },

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(this.food.x * CELL + 2, this.food.y * CELL + 2, CELL - 4, CELL - 4);
        this.snake.forEach((seg, i) => {
            ctx.fillStyle = i === 0 ? "#22c55e" : "#16a34a";
            ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
        });
    },

    async endGame() {
        this.gameOver = true;
        this.stopTimer();
        await ArcadeSystem.submitScore("snake", this.score);
        if (this.onScoreSubmitted) this.onScoreSubmitted();
        const overlay = document.createElement("div");
        overlay.style.cssText = "text-align:center; margin-top:16px;";
        overlay.innerHTML = `
            <p style="font-size:1.1rem; color:var(--color-danger); margin-bottom:10px;">GAME OVER - SCORE: ${this.score}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:0 auto;">
                <button id="snake-again" class="admin-btn-primary">PLAY AGAIN</button>
            </div>
        `;
        this.root.querySelector("#snake-back").insertAdjacentElement("beforebegin", overlay);
        overlay.querySelector("#snake-again").addEventListener("click", () => {
            overlay.remove();
            this.startGame();
        });
    },

    onExit: () => {},
    onScoreSubmitted: null
};
