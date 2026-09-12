/**
 * SEVEN BITS COFFEE - MEWDOKU (arcade)
 * Location: /js/features/arcade/mewdoku-game.js
 *
 * A grid of colored regions, one cat per region - and, same as a row/column
 * of digits in Sudoku, no two cats may share a row or a column either. The
 * EASY/NORMAL/HARD selector (game-fx.js, same control Snake/Sudoku use)
 * picks the board size: 4x4, 8x8, 16x16.
 *
 * Generation: pick a random row/column permutation (one cat per row, one
 * per column - trivially satisfies the row/column rule), then grow that
 * many colored regions outward from each cat by repeatedly claiming a
 * random unclaimed neighbor cell, one cell per region per pass, until the
 * whole board is tiled. That's what gives the regions their organic,
 * jigsaw-piece shapes instead of a plain checkerboard. One region is
 * deliberately left out of the growth entirely, staying at its single
 * seed cell - a free, certain starting point (that region's cat can only
 * ever go in its one cell) instead of every region being equally
 * ambiguous on the very first move.
 */
import { submitScoreWithCelebration, loadDifficulty, saveDifficulty, difficultySelectorHtml, wireDifficultySelector } from "../game-fx.js";

const DIFFICULTY_KEY = "sb-arcade-mewdoku-difficulty";
const BOARD_SIZE = { easy: 4, normal: 8, hard: 16 };
const SCORE_BASE = { easy: 400, normal: 1200, hard: 3000 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function shuffled(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function generateRegions(n) {
    const cols = shuffled([...Array(n).keys()]); // cols[r] = seed column for row r
    const regionOf = Array.from({ length: n }, () => Array(n).fill(-1));
    const regionCells = Array.from({ length: n }, () => []);
    for (let r = 0; r < n; r++) {
        regionOf[r][cols[r]] = r;
        regionCells[r].push([r, cols[r]]);
    }
    const frozenRegion = Math.floor(Math.random() * n);
    let unclaimed = n * n - n;
    while (unclaimed > 0) {
        let grew = false;
        for (const regionId of shuffled([...Array(n).keys()].filter((id) => id !== frozenRegion))) {
            if (unclaimed === 0) break;
            const frontier = [];
            for (const [r, c] of regionCells[regionId]) {
                for (const [dr, dc] of DIRS) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionOf[nr][nc] === -1) frontier.push([nr, nc]);
                }
            }
            if (frontier.length === 0) continue;
            const [nr, nc] = frontier[Math.floor(Math.random() * frontier.length)];
            regionOf[nr][nc] = regionId;
            regionCells[regionId].push([nr, nc]);
            unclaimed--;
            grew = true;
        }
        // Rare fallback (a cell fully boxed in by other regions before its
        // own region's frontier could reach it) - hand it to any claimed
        // neighbor rather than looping forever. Never the frozen region -
        // that one's single-cell guarantee has to hold no matter what.
        if (!grew && unclaimed > 0) {
            outer: for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (regionOf[r][c] !== -1) continue;
                    for (const [dr, dc] of DIRS) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionOf[nr][nc] !== -1 && regionOf[nr][nc] !== frozenRegion) {
                            regionOf[r][c] = regionOf[nr][nc];
                            regionCells[regionOf[nr][nc]].push([r, c]);
                            unclaimed--;
                            break outer;
                        }
                    }
                }
            }
        }
    }
    return { regionOf, frozenRegion };
}

function regionColor(id, n) {
    const hue = Math.round((id * 360) / n);
    return `hsl(${hue}, 55%, 32%)`;
}

export const MewdokuGame = {
    root: null,
    n: 4,
    regionOf: null,
    frozenRegion: null,
    cats: null, // n x n booleans
    difficulty: "normal",
    startTime: 0,
    elapsed: 0,
    timerInterval: null,
    gameOver: false,

    mount(root) {
        this.root = root;
        this.difficulty = loadDifficulty(DIFFICULTY_KEY);
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
        this.n = BOARD_SIZE[this.difficulty] || BOARD_SIZE.normal;
        const { regionOf, frozenRegion } = generateRegions(this.n);
        this.regionOf = regionOf;
        this.frozenRegion = frozenRegion;
        this.cats = Array.from({ length: this.n }, () => Array(this.n).fill(false));
        this.startTime = Date.now();
        this.elapsed = 0;
        this.gameOver = false;
        this.render();
        this.startTimer();
    },

    startTimer() {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            this.elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const el = this.root.querySelector("#mewdoku-timer");
            if (el) el.textContent = this.elapsed;
        }, 1000);
    },

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    },

    /** Whether the cat at (r,c) shares a row, column or region with another
     *  placed cat - used both to highlight conflicts live and to judge a
     *  win (see isSolved()). */
    conflictsAt(r, c) {
        const n = this.n;
        const region = this.regionOf[r][c];
        for (let i = 0; i < n; i++) {
            if (i !== c && this.cats[r][i]) return true;
            if (i !== r && this.cats[i][c]) return true;
        }
        for (let rr = 0; rr < n; rr++) {
            for (let cc = 0; cc < n; cc++) {
                if ((rr !== r || cc !== c) && this.cats[rr][cc] && this.regionOf[rr][cc] === region) return true;
            }
        }
        return false;
    },

    countCats() {
        return this.cats.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    },

    isSolved() {
        if (this.countCats() !== this.n) return false;
        for (let r = 0; r < this.n; r++) {
            for (let c = 0; c < this.n; c++) {
                if (this.cats[r][c] && this.conflictsAt(r, c)) return false;
            }
        }
        return true;
    },

    render(message = "") {
        const n = this.n;
        const cellFont = n <= 4 ? 22 : n <= 8 ? 15 : 9;
        // Cells sharing a row/column with an already-placed cat get dimmed -
        // a plain visual hint, not a hard rule (two cats can still land in
        // the same row mid-solve; conflictsAt()'s red border is what
        // actually flags that once it happens).
        const blockedRows = new Set();
        const blockedCols = new Set();
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (this.cats[r][c]) {
                    blockedRows.add(r);
                    blockedCols.add(c);
                }
            }
        }
        const cellsHtml = this.regionOf
            .map((row, r) =>
                row
                    .map((regionId, c) => {
                        const hasCat = this.cats[r][c];
                        const conflict = hasCat && this.conflictsAt(r, c);
                        const dimmed = !hasCat && (blockedRows.has(r) || blockedCols.has(c));
                        const isFreebie = regionId === this.frozenRegion;
                        const outline = isFreebie && !hasCat ? "outline:2px dashed rgba(255,255,255,0.7); outline-offset:-2px;" : "";
                        return `<div class="mewdoku-cell" data-r="${r}" data-c="${c}" style="aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:${cellFont}px; background:${regionColor(regionId, n)}; border:1px solid var(--color-bg); box-shadow:${conflict ? "inset 0 0 0 2px var(--color-danger)" : "none"}; ${outline} filter:${dimmed ? "brightness(0.45)" : "none"}; cursor:pointer;">${hasCat ? "🐱" : ""}</div>`;
                    })
                    .join("")
            )
            .join("");

        this.root.innerHTML = `
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">TIME: <strong id="mewdoku-timer" style="color:var(--color-accent);">${this.elapsed}</strong>s &middot; CATS: ${this.countCats()}/${n}</p>
            <div class="arcade-board" style="display:grid; grid-template-columns:repeat(${n},1fr); gap:0;">${cellsHtml}</div>
            <p style="text-align:center; font-size:10px; color:var(--color-text-muted); margin-top:8px;">One cat per row, column and color. The dashed cell only fits one color - start there. Click a cell to place or remove a cat.</p>
            ${difficultySelectorHtml("mewdoku-diff", this.difficulty)}
            <p id="mewdoku-message" style="text-align:center; font-size:17px; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">${message}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="mewdoku-again" class="admin-btn-primary" style="display:${this.gameOver ? "" : "none"};">PLAY AGAIN</button>
            </div>
        `;

        this.root.querySelectorAll(".mewdoku-cell").forEach((el) => {
            el.addEventListener("click", () => this.toggleCat(Number(el.dataset.r), Number(el.dataset.c)));
        });
        this.root.querySelector("#mewdoku-again")?.addEventListener("click", () => this.startGame());
        wireDifficultySelector(this.root, "mewdoku-diff", (d) => {
            this.difficulty = d;
            saveDifficulty(DIFFICULTY_KEY, d);
            this.startGame();
        });
    },

    toggleCat(r, c) {
        if (this.gameOver) return;
        this.cats[r][c] = !this.cats[r][c];
        this.render();
        if (this.isSolved()) this.finishGame();
    },

    async finishGame() {
        this.gameOver = true;
        this.stopTimer();
        const base = SCORE_BASE[this.difficulty] || SCORE_BASE.normal;
        const score = Math.round(Math.max(50, base - this.elapsed * 4));
        // Render first (full innerHTML rebuild), THEN submit/celebrate -
        // fireConfetti appends an overlay to this.root, and a later render()
        // would wipe it out (same ordering minesweeper-game.js uses).
        this.render(`ALL CATS HAPPY! - TIME: ${this.elapsed}s - SCORE: ${score}`);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "mewdoku", score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        if (newHighScore) {
            const msgEl = this.root.querySelector("#mewdoku-message");
            if (msgEl) msgEl.textContent = `NEW HIGH SCORE! - TIME: ${this.elapsed}s - SCORE: ${score}`;
        }
    },

    onExit: () => {},
    onScoreSubmitted: null
};
