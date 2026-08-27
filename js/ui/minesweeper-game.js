/**
 * SEVEN BITS COFFEE - MINESWEEPER (arcade)
 * Location: /js/ui/minesweeper-game.js
 *
 * Classic 9x9 / 10-mine board. Pure DOM. Score is only submitted on a win
 * (a loss doesn't post to the leaderboard - it's not a meaningful "score"),
 * rewarding speed: 500 minus 5 per second elapsed, floored at 10.
 */
import { ArcadeSystem } from "../features/arcade-logic.js";

const COLS = 9;
const ROWS = 9;
const MINES = 10;
const NUMBER_COLORS = ["", "#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#f97316", "#22d3ee", "#f9fafb", "#888888"];

export const MinesweeperGame = {
    root: null,
    board: null,
    gameOver: false,
    won: false,
    startTime: 0,
    elapsed: 0,
    timerInterval: null,

    mount(root) {
        this.root = root;
        this.startGame();
    },

    unmount() {
        this.stopTimer();
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        this.board = this.buildBoard();
        this.gameOver = false;
        this.won = false;
        this.startTime = Date.now();
        this.elapsed = 0;
        this.render();
        this.startTimer();
    },

    buildBoard() {
        const cells = Array.from({ length: ROWS * COLS }, () => ({ mine: false, revealed: false, flagged: false, adjacent: 0 }));
        let placed = 0;
        while (placed < MINES) {
            const i = Math.floor(Math.random() * cells.length);
            if (!cells[i].mine) {
                cells[i].mine = true;
                placed++;
            }
        }
        const idx = (x, y) => y * COLS + x;
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (cells[idx(x, y)].mine) continue;
                let count = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && cells[idx(nx, ny)].mine) count++;
                    }
                }
                cells[idx(x, y)].adjacent = count;
            }
        }
        return cells;
    },

    startTimer() {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            this.elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const el = this.root.querySelector("#mine-timer");
            if (el) el.textContent = this.elapsed;
        }, 1000);
    },

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    },

    render(message = "") {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">MINESWEEPER</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">TIME: <strong id="mine-timer" style="color:var(--color-accent);">${this.elapsed}</strong>s &middot; MINES: ${MINES}</p>
            <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:2px; max-width:270px; margin:0 auto; background:var(--color-border);">
                ${this.board
                    .map((c, i) => {
                        let content = "";
                        let bg = "var(--color-surface)";
                        let color = "var(--color-text)";
                        if (c.flagged && !c.revealed) {
                            content = "🚩";
                        } else if (c.revealed) {
                            bg = "var(--color-bg)";
                            if (c.mine) {
                                content = "💣";
                            } else if (c.adjacent > 0) {
                                content = c.adjacent;
                                color = NUMBER_COLORS[c.adjacent];
                            }
                        }
                        return `<div class="mine-cell" data-i="${i}" style="aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:bold; background:${bg}; color:${color}; cursor:${c.revealed ? "default" : "pointer"};">${content}</div>`;
                    })
                    .join("")}
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Click to reveal &middot; long-press / right-click to flag.</p>
            <p id="mine-message" style="text-align:center; font-size:1.05rem; color:var(--color-danger); margin:10px 0 0; min-height:1.4em;">${message}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="mine-again" class="admin-btn-primary" style="display:${this.gameOver ? "" : "none"};">PLAY AGAIN</button>
                <button id="mine-back" class="admin-btn">BACK</button>
            </div>
        `;
        this.root.querySelectorAll(".mine-cell").forEach((el) => {
            const i = Number(el.dataset.i);
            el.addEventListener("click", () => this.reveal(i));
            el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                this.toggleFlag(i);
            });
            let pressTimer;
            el.addEventListener("touchstart", () => {
                pressTimer = setTimeout(() => this.toggleFlag(i), 500);
            });
            el.addEventListener("touchend", () => clearTimeout(pressTimer));
        });
        this.root.querySelector("#mine-back").addEventListener("click", () => this.exit());
        this.root.querySelector("#mine-again")?.addEventListener("click", () => this.startGame());
    },

    toggleFlag(i) {
        if (this.gameOver || this.board[i].revealed) return;
        this.board[i].flagged = !this.board[i].flagged;
        this.render();
    },

    reveal(i) {
        if (this.gameOver || this.board[i].revealed || this.board[i].flagged) return;
        this.board[i].revealed = true;
        if (this.board[i].mine) {
            return this.endGame(false);
        }
        if (this.board[i].adjacent === 0) {
            this.floodFill(i);
        }
        if (this.checkWin()) {
            return this.endGame(true);
        }
        this.render();
    },

    floodFill(i) {
        const x = i % COLS;
        const y = Math.floor(i / COLS);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                const ni = ny * COLS + nx;
                if (!this.board[ni].revealed && !this.board[ni].mine) {
                    this.board[ni].revealed = true;
                    if (this.board[ni].adjacent === 0) this.floodFill(ni);
                }
            }
        }
    },

    checkWin() {
        return this.board.every((c) => c.mine || c.revealed);
    },

    async endGame(won) {
        this.gameOver = true;
        this.won = won;
        this.stopTimer();
        this.board.forEach((c) => {
            if (c.mine) c.revealed = true;
        });
        if (won) {
            const score = Math.max(10, 500 - this.elapsed * 5);
            await ArcadeSystem.submitScore("minesweeper", score);
            if (this.onScoreSubmitted) this.onScoreSubmitted();
            this.render(`YOU WIN! - SCORE: ${score}`);
        } else {
            this.render("BOOM! GAME OVER");
        }
    },

    onExit: () => {},
    onScoreSubmitted: null
};
