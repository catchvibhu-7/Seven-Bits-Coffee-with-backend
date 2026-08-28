/**
 * SEVEN BITS COFFEE - 2048 (arcade)
 * Location: /js/ui/2048-game.js
 *
 * Every direction is normalized to "slide left" by rotating the grid,
 * sliding, then rotating back - avoids writing four near-duplicate slide
 * implementations. Pure DOM, tile colors ramp from a dim accent tone up to
 * the full accent and then cyan for the highest tiles.
 */
import { submitScoreWithCelebration } from "../features/game-fx.js";

const SIZE = 4;
const TILE_COLORS = { 2: "#3a2a1a", 4: "#4a3520", 8: "#8a5a20", 16: "#a8691f", 32: "#c77a1f", 64: "#d97706", 128: "#e08a1f", 256: "#e89d2f", 512: "#f0b03f", 1024: "#f8c34f", 2048: "#22d3ee" };

function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function cloneGrid(g) {
    return g.map((row) => [...row]);
}

function gridsEqual(a, b) {
    return a.every((row, y) => row.every((v, x) => v === b[y][x]));
}

function slideRowLeft(row) {
    const nonZero = row.filter((v) => v !== 0);
    const merged = [];
    let gained = 0;
    for (let i = 0; i < nonZero.length; i++) {
        if (nonZero[i] !== undefined && nonZero[i] === nonZero[i + 1]) {
            const value = nonZero[i] * 2;
            merged.push(value);
            gained += value;
            i++; // skip the merged partner
        } else {
            merged.push(nonZero[i]);
        }
    }
    while (merged.length < SIZE) merged.push(0);
    return { row: merged, gained };
}

function rotateClockwise(g) {
    const result = emptyGrid();
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            result[x][SIZE - 1 - y] = g[y][x];
        }
    }
    return result;
}

export const Game2048 = {
    root: null,
    grid: null,
    score: 0,
    gameOver: false,
    keyHandler: null,

    mount(root) {
        this.root = root;
        this.keyHandler = (e) => this.handleKey(e);
        document.addEventListener("keydown", this.keyHandler);
        this.startGame();
    },

    unmount() {
        if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler);
        this.keyHandler = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        this.grid = emptyGrid();
        this.score = 0;
        this.gameOver = false;
        this.spawnTile();
        this.spawnTile();
        this.render();
    },

    spawnTile() {
        const empties = [];
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                if (this.grid[y][x] === 0) empties.push([x, y]);
            }
        }
        if (empties.length === 0) return;
        const [x, y] = empties[Math.floor(Math.random() * empties.length)];
        this.grid[y][x] = Math.random() < 0.9 ? 2 : 4;
    },

    move(direction) {
        if (this.gameOver) return;
        const rotations = { left: 0, up: 3, right: 2, down: 1 }[direction];

        let working = cloneGrid(this.grid);
        for (let i = 0; i < rotations; i++) working = rotateClockwise(working);

        let gained = 0;
        let result = working.map((row) => {
            const { row: newRow, gained: g } = slideRowLeft(row);
            gained += g;
            return newRow;
        });

        for (let i = 0; i < (4 - rotations) % 4; i++) result = rotateClockwise(result);

        if (!gridsEqual(result, this.grid)) {
            this.grid = result;
            this.score += gained;
            this.spawnTile();
            this.render();
            if (this.isGameOver()) this.endGame();
        }
    },

    isGameOver() {
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                if (this.grid[y][x] === 0) return false;
                if (x < SIZE - 1 && this.grid[y][x] === this.grid[y][x + 1]) return false;
                if (y < SIZE - 1 && this.grid[y][x] === this.grid[y + 1][x]) return false;
            }
        }
        return true;
    },

    handleKey(e) {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            this.move(e.key.replace("Arrow", "").toLowerCase());
        }
    },

    tileColor(value) {
        return TILE_COLORS[value] || "#22d3ee";
    },

    render(message = "") {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">2048</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">SCORE: <strong id="g2048-score" style="color:var(--color-accent);">${this.score}</strong></p>
            <div style="display:grid; grid-template-columns:repeat(${SIZE},1fr); gap:6px; max-width:280px; margin:0 auto; background:var(--color-border); padding:6px; border-radius:4px;">
                ${this.grid
                    .flat()
                    .map(
                        (v) => `
                    <div style="aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:${v >= 1000 ? "0.95rem" : "1.3rem"}; font-weight:bold; background:${v ? this.tileColor(v) : "var(--color-bg)"}; color:${v <= 4 ? "var(--color-text-muted)" : "#000"};">${v || ""}</div>
                `
                    )
                    .join("")}
            </div>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; max-width:160px; margin:10px auto 0;">
                <div></div><button id="g2048-up" class="admin-btn">↑</button><div></div>
                <button id="g2048-left" class="admin-btn">←</button><button id="g2048-down" class="admin-btn">↓</button><button id="g2048-right" class="admin-btn">→</button>
            </div>
            <p id="g2048-message" style="text-align:center; font-size:1.05rem; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">${message}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="g2048-again" class="admin-btn-primary" style="display:${this.gameOver ? "" : "none"};">PLAY AGAIN</button>
                <button id="g2048-back" class="admin-btn">BACK</button>
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Arrow keys or buttons to slide tiles.</p>
        `;
        this.root.querySelector("#g2048-up").addEventListener("click", () => this.move("up"));
        this.root.querySelector("#g2048-down").addEventListener("click", () => this.move("down"));
        this.root.querySelector("#g2048-left").addEventListener("click", () => this.move("left"));
        this.root.querySelector("#g2048-right").addEventListener("click", () => this.move("right"));
        this.root.querySelector("#g2048-back").addEventListener("click", () => this.exit());
        this.root.querySelector("#g2048-again")?.addEventListener("click", () => this.startGame());
    },

    async endGame() {
        this.gameOver = true;
        this.render(`GAME OVER - SCORE: ${this.score}`);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "2048", this.score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        if (newHighScore) {
            const msgEl = this.root.querySelector("#g2048-message");
            if (msgEl) msgEl.textContent = `NEW HIGH SCORE! - SCORE: ${this.score}`;
        }
    },

    onExit: () => {},
    onScoreSubmitted: null
};
