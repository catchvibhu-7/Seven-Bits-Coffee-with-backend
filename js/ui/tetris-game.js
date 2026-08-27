/**
 * SEVEN BITS COFFEE - TETRIS (arcade)
 * Location: /js/ui/tetris-game.js
 *
 * Single-player, fully client-side (score is only submitted to the server
 * on game over, via ArcadeSystem.submitScore - the server sanity-caps it
 * but doesn't recompute it, same trust level as the rest of this "fun while
 * you wait" feature). Canvas-rendered 10x20 well; simple rotation (no SRS
 * wall-kicks) since that's plenty for a casual arcade game.
 */
import { ArcadeSystem } from "../features/arcade-logic.js";

const COLS = 10;
const ROWS = 20;
const CELL = 24;

const PIECES = {
    I: { shape: [[1, 1, 1, 1]], color: "#22d3ee" },
    O: { shape: [[1, 1], [1, 1]], color: "#d97706" },
    T: { shape: [[0, 1, 0], [1, 1, 1]], color: "#a855f7" },
    S: { shape: [[0, 1, 1], [1, 1, 0]], color: "#22c55e" },
    Z: { shape: [[1, 1, 0], [0, 1, 1]], color: "#ef4444" },
    J: { shape: [[1, 0, 0], [1, 1, 1]], color: "#3b82f6" },
    L: { shape: [[0, 0, 1], [1, 1, 1]], color: "#f97316" }
};
const PIECE_KEYS = Object.keys(PIECES);

function rotateClockwise(shape) {
    return shape[0].map((_, col) => shape.map((row) => row[col]).reverse());
}

function randomPiece() {
    const key = PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
    return { shape: PIECES[key].shape.map((r) => [...r]), color: PIECES[key].color };
}

export const TetrisGame = {
    root: null,
    canvas: null,
    ctx: null,
    board: null,
    piece: null,
    px: 0,
    py: 0,
    score: 0,
    lines: 0,
    level: 1,
    dropTimer: null,
    gameOver: false,
    keyHandler: null,

    mount(root) {
        this.root = root;
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">TETRIS</h3>
            <div style="display:flex; justify-content:space-between; max-width:${COLS * CELL}px; margin:0 auto 8px; font-size:9pt; color:var(--color-text-muted);">
                <span>SCORE: <strong id="tetris-score" style="color:var(--color-accent);">0</strong></span>
                <span>LEVEL: <strong id="tetris-level" style="color:var(--color-accent);">1</strong></span>
            </div>
            <canvas id="tetris-canvas" width="${COLS * CELL}" height="${ROWS * CELL}" style="display:block; margin:0 auto; background:var(--color-bg); border:1px solid var(--color-border); max-width:100%; height:auto;"></canvas>
            <div id="tetris-touch-controls" style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px; max-width:${COLS * CELL}px; margin:10px auto 0;">
                <button id="tt-left" class="admin-btn">←</button>
                <button id="tt-rotate" class="admin-btn">↻</button>
                <button id="tt-right" class="admin-btn">→</button>
                <button id="tt-down" class="admin-btn">↓</button>
            </div>
            <div style="text-align:center; margin-top:10px;">
                <button id="tetris-back" class="admin-btn">BACK</button>
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Arrow keys to move/rotate, Space to hard-drop.</p>
        `;
        this.canvas = this.root.querySelector("#tetris-canvas");
        this.ctx = this.canvas.getContext("2d");
        this.root.querySelector("#tt-left").addEventListener("click", () => this.tryMove(-1, 0));
        this.root.querySelector("#tt-right").addEventListener("click", () => this.tryMove(1, 0));
        this.root.querySelector("#tt-down").addEventListener("click", () => this.softDrop());
        this.root.querySelector("#tt-rotate").addEventListener("click", () => this.rotate());
        this.root.querySelector("#tetris-back").addEventListener("click", () => this.exit());

        this.keyHandler = (e) => this.handleKey(e);
        document.addEventListener("keydown", this.keyHandler);

        this.startGame();
    },

    unmount() {
        this.stopDropTimer();
        if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler);
        this.keyHandler = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.gameOver = false;
        this.spawnPiece();
        this.updateStats();
        this.draw();
        this.startDropTimer();
    },

    startDropTimer() {
        this.stopDropTimer();
        const speed = Math.max(120, 800 - (this.level - 1) * 70);
        this.dropTimer = setInterval(() => this.tick(), speed);
    },

    stopDropTimer() {
        if (this.dropTimer) {
            clearInterval(this.dropTimer);
            this.dropTimer = null;
        }
    },

    spawnPiece() {
        this.piece = randomPiece();
        this.px = Math.floor((COLS - this.piece.shape[0].length) / 2);
        this.py = 0;
        if (this.collides(this.piece.shape, this.px, this.py)) {
            this.endGame();
        }
    },

    collides(shape, px, py) {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) continue;
                const boardX = px + x;
                const boardY = py + y;
                if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true;
                if (boardY >= 0 && this.board[boardY][boardX]) return true;
            }
        }
        return false;
    },

    tick() {
        if (this.gameOver) return;
        if (!this.collides(this.piece.shape, this.px, this.py + 1)) {
            this.py++;
        } else {
            this.lockPiece();
        }
        this.draw();
    },

    lockPiece() {
        this.piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell && this.py + y >= 0) this.board[this.py + y][this.px + x] = this.piece.color;
            });
        });
        this.clearLines();
        this.spawnPiece();
    },

    clearLines() {
        let cleared = 0;
        for (let y = ROWS - 1; y >= 0; y--) {
            if (this.board[y].every((cell) => cell)) {
                this.board.splice(y, 1);
                this.board.unshift(Array(COLS).fill(null));
                cleared++;
                y++; // recheck same index after the shift
            }
        }
        if (cleared > 0) {
            const points = [0, 40, 100, 300, 1200][cleared] * this.level;
            this.score += points;
            this.lines += cleared;
            this.level = Math.floor(this.lines / 10) + 1;
            this.updateStats();
            this.startDropTimer(); // speed may have changed with the new level
        }
    },

    tryMove(dx, dy) {
        if (this.gameOver) return;
        if (!this.collides(this.piece.shape, this.px + dx, this.py + dy)) {
            this.px += dx;
            this.py += dy;
            this.draw();
        }
    },

    softDrop() {
        if (this.gameOver) return;
        if (!this.collides(this.piece.shape, this.px, this.py + 1)) {
            this.py++;
            this.score += 1;
            this.updateStats();
        } else {
            this.lockPiece();
        }
        this.draw();
    },

    hardDrop() {
        if (this.gameOver) return;
        let dropped = 0;
        while (!this.collides(this.piece.shape, this.px, this.py + 1)) {
            this.py++;
            dropped++;
        }
        this.score += dropped * 2;
        this.lockPiece();
        this.updateStats();
        this.draw();
    },

    rotate() {
        if (this.gameOver) return;
        const rotated = rotateClockwise(this.piece.shape);
        // Naive wall-kick: try the rotation as-is, then nudged left/right by
        // up to 2 cells - covers the common cases without full SRS.
        for (const kick of [0, -1, 1, -2, 2]) {
            if (!this.collides(rotated, this.px + kick, this.py)) {
                this.piece.shape = rotated;
                this.px += kick;
                this.draw();
                return;
            }
        }
    },

    handleKey(e) {
        if (this.gameOver) return;
        if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(e.key)) e.preventDefault();
        if (e.key === "ArrowLeft") this.tryMove(-1, 0);
        else if (e.key === "ArrowRight") this.tryMove(1, 0);
        else if (e.key === "ArrowDown") this.softDrop();
        else if (e.key === "ArrowUp") this.rotate();
        else if (e.key === " ") this.hardDrop();
    },

    updateStats() {
        const scoreEl = this.root.querySelector("#tetris-score");
        const levelEl = this.root.querySelector("#tetris-level");
        if (scoreEl) scoreEl.textContent = this.score;
        if (levelEl) levelEl.textContent = this.level;
    },

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (this.board[y][x]) this.drawCell(x, y, this.board[y][x]);
            }
        }
        if (this.piece) {
            this.piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell) this.drawCell(this.px + x, this.py + y, this.piece.color);
                });
            });
        }
    },

    drawCell(x, y, color) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    },

    async endGame() {
        this.gameOver = true;
        this.stopDropTimer();
        await ArcadeSystem.submitScore("tetris", this.score);
        const overlay = document.createElement("div");
        overlay.style.cssText = "text-align:center; margin-top:16px;";
        overlay.innerHTML = `
            <p style="font-size:1.1rem; color:var(--color-danger); margin-bottom:10px;">GAME OVER - SCORE: ${this.score}</p>
            <div style="display:grid; gap:10px; max-width:${COLS * CELL}px; margin:0 auto;">
                <button id="tetris-again" class="admin-btn-primary">PLAY AGAIN</button>
            </div>
        `;
        this.root.querySelector("#tetris-back").insertAdjacentElement("beforebegin", overlay);
        overlay.querySelector("#tetris-again").addEventListener("click", () => {
            overlay.remove();
            this.startGame();
        });
    },

    onExit: () => {}
};
