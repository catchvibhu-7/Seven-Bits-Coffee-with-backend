/**
 * SEVEN BITS COFFEE - MEMORY MATCH (arcade)
 * Location: /js/features/arcade/memory-game.js
 *
 * Flip two cards a turn; a match stays face up, a miss flips back after a
 * beat. Pure DOM (no canvas), so colors just use CSS vars directly. Score
 * rewards fewer moves: 300 minus 10 per move, floored at 10.
 */
import { submitScoreWithCelebration } from "../game-fx.js";

const SYMBOLS = ["☕", "🍩", "🥐", "🍪", "🧁", "🍰"]; // 6 pairs = 12 cards

export const MemoryGame = {
    root: null,
    cards: null,
    flippedIndices: [],
    moves: 0,
    matchesFound: 0,
    busy: false,

    mount(root) {
        this.root = root;
        this.startGame();
    },

    unmount() {},

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        const pairSymbols = [...SYMBOLS, ...SYMBOLS];
        this.cards = pairSymbols.map((symbol) => ({ symbol, matched: false })).sort(() => Math.random() - 0.5);
        this.flippedIndices = [];
        this.moves = 0;
        this.matchesFound = 0;
        this.busy = false;
        this.render();
    },

    render(message = "") {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">MEMORY MATCH</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">MOVES: <strong id="mm-moves" style="color:var(--color-accent);">${this.moves}</strong></p>
            <div class="arcade-board" style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px;">
                ${this.cards
                    .map((c, i) => {
                        const shown = c.matched || this.flippedIndices.includes(i);
                        return `
                    <div class="mm-card" data-i="${i}" style="aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:1.6rem; background:${shown ? "var(--color-surface)" : "var(--color-accent)"}; border:1px solid var(--color-border); border-radius:4px; cursor:${c.matched ? "default" : "pointer"};">
                        ${shown ? c.symbol : ""}
                    </div>
                `;
                    })
                    .join("")}
            </div>
            <p id="mm-message" style="text-align:center; font-size:1.05rem; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">${message}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="mm-again" class="admin-btn-primary" style="display:${this.matchesFound === SYMBOLS.length ? "" : "none"};">PLAY AGAIN</button>
                <button id="mm-back" class="admin-btn">BACK</button>
            </div>
        `;
        this.root.querySelectorAll(".mm-card").forEach((el) => {
            el.addEventListener("click", () => this.flip(Number(el.dataset.i)));
        });
        this.root.querySelector("#mm-back").addEventListener("click", () => this.exit());
        this.root.querySelector("#mm-again")?.addEventListener("click", () => this.startGame());
    },

    flip(i) {
        if (this.busy || this.cards[i].matched || this.flippedIndices.includes(i)) return;
        this.flippedIndices.push(i);
        this.render();
        if (this.flippedIndices.length !== 2) return;

        this.moves++;
        this.busy = true;
        const [a, b] = this.flippedIndices;
        if (this.cards[a].symbol === this.cards[b].symbol) {
            this.cards[a].matched = true;
            this.cards[b].matched = true;
            this.matchesFound++;
            this.flippedIndices = [];
            this.busy = false;
            if (this.matchesFound === SYMBOLS.length) {
                this.finishGame();
            } else {
                this.render();
            }
        } else {
            setTimeout(() => {
                this.flippedIndices = [];
                this.busy = false;
                this.render();
            }, 700);
        }
    },

    async finishGame() {
        const score = Math.max(10, 300 - this.moves * 10);
        // Render first (full innerHTML rebuild), THEN submit/celebrate - fireConfetti
        // appends an overlay to this.root, and a later render() would wipe it out.
        this.render(`SOLVED IN ${this.moves} MOVES - SCORE: ${score}`);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "memory", score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        if (newHighScore) {
            const msgEl = this.root.querySelector("#mm-message");
            if (msgEl) msgEl.textContent = `NEW HIGH SCORE! - SOLVED IN ${this.moves} MOVES - SCORE: ${score}`;
        }
    },

    onExit: () => {},
    onScoreSubmitted: null
};
