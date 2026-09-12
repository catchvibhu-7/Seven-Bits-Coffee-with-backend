/**
 * SEVEN BITS COFFEE - SUDOKU (arcade)
 * Location: /js/features/arcade/sudoku-game.js
 *
 * Classic 9x9, three difficulty tiers (EASY/NORMAL/HARD = how many givens
 * are left on the board, see game-fx.js's difficulty selector - same
 * control Snake already uses). Pure DOM, no canvas.
 *
 * Generation: fill a full valid grid via randomized backtracking, then dig
 * holes down to the difficulty's given count.
 * ponytail: no uniqueness solver pass on the dug-out puzzle - that needs a
 * full solve attempt per candidate removal, overkill for a casual arcade
 * round. Keeping 28+ givens makes an ambiguous puzzle rare in practice, and
 * a win is judged by "board full, zero rule conflicts" rather than matching
 * the one solution that was originally generated.
 */
import { submitScoreWithCelebration, loadDifficulty, saveDifficulty, difficultySelectorHtml, wireDifficultySelector } from "../game-fx.js";

const SIZE = 9;
const BOX = 3;
const DIFFICULTY_KEY = "sb-arcade-sudoku-difficulty";
const GIVENS = { easy: 46, normal: 36, hard: 28 };
const SCORE_MULTIPLIER = { easy: 1, normal: 1.5, hard: 2 };

function shuffled(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function isValidPlacement(grid, r, c, n) {
    for (let i = 0; i < SIZE; i++) {
        if (grid[r][i] === n || grid[i][c] === n) return false;
    }
    const br = Math.floor(r / BOX) * BOX;
    const bc = Math.floor(c / BOX) * BOX;
    for (let dr = 0; dr < BOX; dr++) {
        for (let dc = 0; dc < BOX; dc++) {
            if (grid[br + dr][bc + dc] === n) return false;
        }
    }
    return true;
}

function fillGrid(grid, pos = 0) {
    if (pos === SIZE * SIZE) return true;
    const r = Math.floor(pos / SIZE);
    const c = pos % SIZE;
    for (const n of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
        if (isValidPlacement(grid, r, c, n)) {
            grid[r][c] = n;
            if (fillGrid(grid, pos + 1)) return true;
            grid[r][c] = 0;
        }
    }
    return false;
}

function generatePuzzle(givens) {
    const solution = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    fillGrid(solution);
    const puzzle = solution.map((row) => [...row]);
    const cellOrder = shuffled([...Array(SIZE * SIZE).keys()]);
    for (let i = 0; i < SIZE * SIZE - givens; i++) {
        const idx = cellOrder[i];
        puzzle[Math.floor(idx / SIZE)][idx % SIZE] = 0;
    }
    return puzzle;
}

export const SudokuGame = {
    root: null,
    board: null,
    givenMask: null,
    selected: null,
    difficulty: "normal",
    startTime: 0,
    elapsed: 0,
    timerInterval: null,
    gameOver: false,
    keyHandler: null,

    mount(root) {
        this.root = root;
        this.difficulty = loadDifficulty(DIFFICULTY_KEY);
        // Physical keyboard: 1-9 fills the selected cell, Backspace/Delete/0
        // clears it. Skipped entirely while the hidden mobile input (below)
        // has focus - typing there already reaches inputNumber() via its own
        // 'input' listener, so handling it here too would double-count
        // every digit.
        this.keyHandler = (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.target && e.target.id === "sudoku-mobile-input") return;
            if (/^[1-9]$/.test(e.key)) {
                e.preventDefault();
                this.inputNumber(Number(e.key));
            } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
                e.preventDefault();
                this.inputNumber(0);
            }
        };
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
        const puzzle = generatePuzzle(GIVENS[this.difficulty] || GIVENS.normal);
        this.board = puzzle.map((row) => [...row]);
        this.givenMask = puzzle.map((row) => row.map((v) => v !== 0));
        this.selected = null;
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
            const el = this.root.querySelector("#sudoku-timer");
            if (el) el.textContent = this.elapsed;
        }, 1000);
    },

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    },

    conflictsAt(r, c) {
        const v = this.board[r][c];
        if (!v) return false;
        for (let i = 0; i < SIZE; i++) {
            if (i !== c && this.board[r][i] === v) return true;
            if (i !== r && this.board[i][c] === v) return true;
        }
        const br = Math.floor(r / BOX) * BOX;
        const bc = Math.floor(c / BOX) * BOX;
        for (let dr = 0; dr < BOX; dr++) {
            for (let dc = 0; dc < BOX; dc++) {
                const rr = br + dr;
                const cc = bc + dc;
                if ((rr !== r || cc !== c) && this.board[rr][cc] === v) return true;
            }
        }
        return false;
    },

    render(message = "") {
        const cellsHtml = this.board
            .map((row, r) =>
                row
                    .map((v, c) => {
                        const given = this.givenMask[r][c];
                        const isSelected = this.selected && this.selected.r === r && this.selected.c === c;
                        const conflict = v && this.conflictsAt(r, c);
                        const borderRight = c % BOX === BOX - 1 && c !== SIZE - 1 ? "border-right:2px solid var(--color-text);" : "";
                        const borderBottom = r % BOX === BOX - 1 && r !== SIZE - 1 ? "border-bottom:2px solid var(--color-text);" : "";
                        let bg = "var(--color-bg)";
                        if (isSelected) bg = "var(--color-accent)";
                        else if (given) bg = "var(--color-surface)";
                        let color = given ? "var(--color-text-muted)" : "var(--color-accent)";
                        if (isSelected) color = "var(--color-accent-contrast)";
                        if (conflict) color = "var(--color-danger)";
                        return `<div class="sudoku-cell" data-r="${r}" data-c="${c}" style="aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:${given ? "normal" : "bold"}; background:${bg}; color:${color}; border:1px solid var(--color-border); ${borderRight} ${borderBottom} cursor:${given ? "default" : "pointer"};">${v || ""}</div>`;
                    })
                    .join("")
            )
            .join("");

        this.root.innerHTML = `
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">TIME: <strong id="sudoku-timer" style="color:var(--color-accent);">${this.elapsed}</strong>s</p>
            <div class="arcade-board" style="display:grid; grid-template-columns:repeat(${SIZE},1fr); background:var(--color-border); gap:0;">${cellsHtml}</div>
            <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:6px; max-width:320px; margin:10px auto 0;">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="admin-btn sudoku-num" data-n="${n}">${n}</button>`).join("")}
                <button class="admin-btn" id="sudoku-erase">&times;</button>
            </div>
            ${difficultySelectorHtml("sudoku-diff", this.difficulty)}
            <p id="sudoku-message" style="text-align:center; font-size:17px; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">${message}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="sudoku-again" class="admin-btn-primary" style="display:${this.gameOver ? "" : "none"};">PLAY AGAIN</button>
            </div>
            <input id="sudoku-mobile-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" aria-hidden="true" style="opacity:0; width:1px; height:1px; border:none; padding:0;" />
        `;

        this.root.querySelectorAll(".sudoku-cell").forEach((el) => {
            el.addEventListener("click", () => this.selectCell(Number(el.dataset.r), Number(el.dataset.c)));
        });
        this.root.querySelectorAll(".sudoku-num").forEach((el) => {
            el.addEventListener("click", () => this.inputNumber(Number(el.dataset.n)));
        });
        this.root.querySelector("#sudoku-erase").addEventListener("click", () => this.inputNumber(0));
        this.root.querySelector("#sudoku-again")?.addEventListener("click", () => this.startGame());
        wireDifficultySelector(this.root, "sudoku-diff", (d) => {
            this.difficulty = d;
            saveDifficulty(DIFFICULTY_KEY, d);
            this.startGame();
        });

        // Invisible text input, focused whenever a cell is selected - its
        // only job is to make a touch device pop up its native numeric
        // keypad (a bare div can't do that, only a real input can). Reads
        // via 'input' rather than keydown since that's what actually fires
        // from a software keyboard tap.
        const mobileInput = this.root.querySelector("#sudoku-mobile-input");
        mobileInput.addEventListener("input", (e) => {
            const digit = e.target.value.replace(/[^1-9]/g, "").slice(-1);
            e.target.value = "";
            if (digit) this.inputNumber(Number(digit));
        });
        mobileInput.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                this.inputNumber(0);
            }
        });
        // Re-focus after every render (render() rebuilds this element from
        // scratch each time, which would otherwise close the keyboard after
        // every single digit typed) - done synchronously so there's no
        // visible close/reopen flicker.
        if (this.selected && !this.gameOver) mobileInput.focus({ preventScroll: true });
    },

    selectCell(r, c) {
        if (this.gameOver || this.givenMask[r][c]) return;
        this.selected = { r, c };
        this.render();
    },

    inputNumber(n) {
        if (this.gameOver || !this.selected) return;
        const { r, c } = this.selected;
        if (this.givenMask[r][c]) return;
        this.board[r][c] = n;
        this.render();
        if (this.isComplete()) this.finishGame();
    },

    isComplete() {
        return this.board.every((row, r) => row.every((v, c) => v !== 0 && !this.conflictsAt(r, c)));
    },

    async finishGame() {
        this.gameOver = true;
        this.stopTimer();
        const multiplier = SCORE_MULTIPLIER[this.difficulty] || 1;
        const score = Math.round(Math.max(50, 2000 - this.elapsed * 3) * multiplier);
        // Render first (full innerHTML rebuild), THEN submit/celebrate -
        // fireConfetti appends an overlay to this.root, and a later render()
        // would wipe it out (same ordering minesweeper-game.js uses).
        this.render(`SOLVED! - TIME: ${this.elapsed}s - SCORE: ${score}`);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "sudoku", score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        if (newHighScore) {
            const msgEl = this.root.querySelector("#sudoku-message");
            if (msgEl) msgEl.textContent = `NEW HIGH SCORE! - TIME: ${this.elapsed}s - SCORE: ${score}`;
        }
    },

    onExit: () => {},
    onScoreSubmitted: null
};
