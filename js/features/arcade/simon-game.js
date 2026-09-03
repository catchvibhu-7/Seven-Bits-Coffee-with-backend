/**
 * SEVEN BITS COFFEE - SIMON SAYS (arcade)
 * Location: /js/features/arcade/simon-game.js
 *
 * Watch the growing color sequence, repeat it. Score = rounds correctly
 * reached. Pure DOM, colors via CSS vars directly (accent + cyan + two
 * fixed hues, since a memory game needs 4 clearly distinct pads more than
 * it needs full theme purity).
 */
import { submitScoreWithCelebration } from "../game-fx.js";

const PADS = [
    { key: 0, bg: "var(--color-accent)" },
    { key: 1, bg: "var(--color-cyan)" },
    { key: 2, bg: "#22c55e" },
    { key: 3, bg: "#a855f7" }
];

export const SimonGame = {
    root: null,
    sequence: [],
    playerStep: 0,
    accepting: false,

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
        this.sequence = [];
        this.playerStep = 0;
        this.accepting = false;
        this.render();
        this.nextRound();
    },

    render(message = "") {
        this.root.innerHTML = `
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">ROUND: <strong id="simon-round" style="color:var(--color-accent);">${this.sequence.length}</strong></p>
            <div class="arcade-board" style="display:grid; grid-template-columns:1fr 1fr; gap:8px; max-width:min(94vw, 320px);">
                ${PADS.map((c) => `<div class="simon-pad" data-key="${c.key}" style="aspect-ratio:1; background:${c.bg}; border-radius:6px; cursor:pointer; opacity:0.55; transition:opacity 0.1s;"></div>`).join("")}
            </div>
            <p id="simon-message" style="text-align:center; font-size:17px; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">${message}</p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="simon-again" class="admin-btn-primary" style="display:none;">PLAY AGAIN</button>
            </div>
        `;
        this.root.querySelectorAll(".simon-pad").forEach((el) => {
            el.addEventListener("click", () => this.handlePadClick(Number(el.dataset.key)));
        });
        this.root.querySelector("#simon-again").addEventListener("click", () => this.startGame());
    },

    flashPad(key, duration = 400) {
        const pad = this.root.querySelector(`.simon-pad[data-key="${key}"]`);
        if (!pad) return Promise.resolve();
        pad.style.opacity = "1";
        return new Promise((resolve) =>
            setTimeout(() => {
                pad.style.opacity = "0.55";
                resolve();
            }, duration)
        );
    },

    async nextRound() {
        this.sequence.push(Math.floor(Math.random() * PADS.length));
        this.playerStep = 0;
        this.accepting = false;
        this.render();
        await new Promise((r) => setTimeout(r, 500));
        for (const key of this.sequence) {
            await this.flashPad(key, 400);
            await new Promise((r) => setTimeout(r, 200));
        }
        this.accepting = true;
    },

    async handlePadClick(key) {
        if (!this.accepting) return;
        this.accepting = false; // ignore taps until we've judged this one
        await this.flashPad(key, 200);
        if (key !== this.sequence[this.playerStep]) {
            return this.endGame();
        }
        this.playerStep++;
        if (this.playerStep === this.sequence.length) {
            setTimeout(() => this.nextRound(), 600);
        } else {
            this.accepting = true;
        }
    },

    async endGame() {
        this.accepting = false;
        const roundsCompleted = this.sequence.length - 1;
        this.render(`GAME OVER - REACHED ROUND ${this.sequence.length}`);
        this.root.querySelector("#simon-again").style.display = "";
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "simon", roundsCompleted);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        if (newHighScore) {
            const msgEl = this.root.querySelector("#simon-message");
            if (msgEl) msgEl.textContent = `NEW HIGH SCORE! - REACHED ROUND ${this.sequence.length}`;
        }
    },

    onExit: () => {},
    onScoreSubmitted: null
};
