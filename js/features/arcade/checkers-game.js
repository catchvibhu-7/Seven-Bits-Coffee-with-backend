/**
 * SEVEN BITS COFFEE - CHECKERS (arcade)
 * Location: /js/features/arcade/checkers-game.js
 *
 * Online-only (vs another in-store player) - no bot mode. Full American
 * checkers rules (forced captures, multi-jump chains, king promotion) live
 * entirely on the server (see server.js's ck* functions); duplicating that
 * correctly in a client-side bot AI wasn't worth the risk of the two
 * rule engines drifting apart, so this module is a thin renderer over
 * whatever the server returns - it never decides what's legal itself.
 * legalMoves comes back with every fetch/move response; a piece is
 * selectable only if it appears as a "from" in that list.
 */
import { ArcadeSystem } from "./arcade-logic.js";
import { submitScoreWithCelebration } from "../game-fx.js";

const SIZE = 8;

function squareColor(r, c) {
    return (r + c) % 2 === 1 ? "var(--color-bg)" : "var(--color-surface)";
}

function pieceHtml(piece) {
    if (!piece) return "";
    const isPlayer0 = piece === "b" || piece === "B";
    const isKing = piece === "B" || piece === "R";
    const color = isPlayer0 ? "var(--color-accent)" : "var(--color-text)";
    return `<div style="width:78%; height:78%; border-radius:50%; background:${color}; display:flex; align-items:center; justify-content:center; font-size:13px; color:var(--color-bg);">${isKing ? "♛" : ""}</div>`;
}

export const CheckersGame = {
    root: null,
    matchId: null,
    pollTimer: null,
    selected: null,
    lastMatch: null,
    onScoreSubmitted: null,
    // Same "longest win streak" scoring as Tic-Tac-Toe/Connect Four.
    winStreak: 0,
    processedResultFor: null,

    mount(root) {
        this.root = root;
        this.matchId = null;
        this.selected = null;
        this.renderIntro();
    },

    unmount() {
        this.stopPolling();
        if (this.matchId) ArcadeSystem.leaveMatch("checkers", this.matchId);
        ArcadeSystem.cancelQueue("checkers");
        this.matchId = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    onExit: () => {},

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },

    renderIntro() {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:16px;">CHECKERS</h3>
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted); margin-bottom:16px;">Online vs another player at the store only - no bot mode for this one.</p>
            <div style="display:grid; gap:10px; max-width:280px; margin:0 auto;">
                <button id="ck-vs-player" class="admin-btn-primary">FIND AN OPPONENT</button>
                <button id="ck-exit" class="admin-btn">BACK TO GAMES</button>
            </div>
        `;
        this.root.querySelector("#ck-vs-player").addEventListener("click", () => this.startQueue());
        this.root.querySelector("#ck-exit").addEventListener("click", () => this.exit());
    },

    async startQueue() {
        this.processedResultFor = null;
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:16px;">CHECKERS - FINDING AN OPPONENT...</h3>
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted);">Waiting for another player at the store to queue up.</p>
            <div style="text-align:center; margin-top:20px;">
                <button id="ck-cancel" class="admin-btn">CANCEL</button>
            </div>
        `;
        this.root.querySelector("#ck-cancel").addEventListener("click", async () => {
            this.stopPolling();
            await ArcadeSystem.cancelQueue("checkers");
            this.renderIntro();
        });

        try {
            const result = await ArcadeSystem.queueMatch("checkers");
            if (result.status === "matched") {
                this.matchId = result.matchId;
                await this.refreshMatch();
            } else {
                this.pollTimer = setInterval(async () => {
                    const match = await this.findOwnMatch();
                    if (match) {
                        this.stopPolling();
                        this.matchId = match.id;
                        this.renderMatch(match);
                    }
                }, 2000);
            }
        } catch (e) {
            this.root.innerHTML = `<p style="text-align:center; color:var(--color-danger);">${e.message}</p>`;
        }
    },

    async findOwnMatch() {
        try {
            const result = await ArcadeSystem.queueMatch("checkers");
            return result.status === "matched" ? await ArcadeSystem.fetchMatch("checkers", result.matchId) : null;
        } catch (e) {
            return null;
        }
    },

    async refreshMatch() {
        const match = await ArcadeSystem.fetchMatch("checkers", this.matchId);
        if (match) this.renderMatch(match);
    },

    async onArcadeChanged() {
        if (this.matchId) await this.refreshMatch();
    },

    renderMatch(match) {
        this.lastMatch = match;
        const myIndex = match.you;
        const isMyTurn = !match.winner && match.turn === myIndex;
        const opponentName = match.names[myIndex === 0 ? 1 : 0];
        const myColorLabel = myIndex === 0 ? "orange" : "white";
        const isFreshResult = !!match.winner && this.processedResultFor !== match.id;
        if (isFreshResult) this.processedResultFor = match.id;

        const iWon = match.winner === String(myIndex);
        let endingStreak = 0;
        if (isFreshResult) {
            if (iWon) this.winStreak++;
            else {
                endingStreak = this.winStreak;
                this.winStreak = 0;
            }
        }

        let message;
        if (match.winner) {
            message = iWon ? `YOU WIN! - WIN STREAK: ${this.winStreak}` : endingStreak > 0 ? `YOU LOSE! - STREAK ENDED AT ${endingStreak}` : "YOU LOSE!";
        } else {
            message = isMyTurn ? "Your move" : `Waiting for ${opponentName}...`;
        }

        const legalFroms = new Set((match.legalMoves || []).map((m) => `${m.from[0]},${m.from[1]}`));
        const legalTosForSelected = this.selected
            ? (match.legalMoves || []).filter((m) => m.from[0] === this.selected[0] && m.from[1] === this.selected[1])
            : [];
        const legalToSet = new Set(legalTosForSelected.map((m) => `${m.to[0]},${m.to[1]}`));

        let cellsHtml = "";
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const piece = match.board[r * SIZE + c];
                const key = `${r},${c}`;
                const isSelected = this.selected && this.selected[0] === r && this.selected[1] === c;
                const isSelectable = isMyTurn && legalFroms.has(key);
                const isDest = isMyTurn && legalToSet.has(key);
                let bg = squareColor(r, c);
                if (isSelected) bg = "var(--color-cyan)";
                else if (isDest) bg = "#22c55e";
                cellsHtml += `<div class="ck-cell" data-r="${r}" data-c="${c}" style="aspect-ratio:1; background:${bg}; display:flex; align-items:center; justify-content:center; cursor:${isSelectable || isDest ? "pointer" : "default"};">${pieceHtml(piece)}</div>`;
            }
        }

        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:4px;">CHECKERS - VS ${opponentName.toUpperCase()}</h3>
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted); margin-bottom:12px;">You are ${myColorLabel} &middot; ${message}</p>
            <div class="arcade-board" style="display:grid; grid-template-columns:repeat(${SIZE},1fr); border:1px solid var(--color-border);">
                ${cellsHtml}
            </div>
            <div style="display:grid; gap:10px; max-width:280px; margin:16px auto 0;">
                <button id="ck-back" class="admin-btn">${match.winner ? "BACK" : "LEAVE MATCH"}</button>
            </div>
        `;

        this.root.querySelectorAll(".ck-cell").forEach((el) => {
            const r = Number(el.dataset.r);
            const c = Number(el.dataset.c);
            const key = `${r},${c}`;
            if (isMyTurn && legalFroms.has(key)) {
                el.addEventListener("click", () => {
                    this.selected = [r, c];
                    this.renderMatch(this.lastMatch);
                });
            } else if (isMyTurn && legalToSet.has(key)) {
                el.addEventListener("click", () => this.handleMove(this.selected, [r, c]));
            }
        });

        this.root.querySelector("#ck-back").addEventListener("click", async () => {
            this.stopPolling();
            const leavingMatchId = this.matchId;
            this.matchId = null;
            this.selected = null;
            if (leavingMatchId) await ArcadeSystem.leaveMatch("checkers", leavingMatchId);
            this.renderIntro();
        });

        if (isFreshResult && endingStreak > 0) {
            submitScoreWithCelebration(this.root, "checkers", endingStreak).then(({ submitted }) => {
                if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
            });
        }
    },

    async handleMove(from, to) {
        this.selected = null;
        try {
            const match = await ArcadeSystem.makeMove("checkers", this.matchId, { from, to });
            this.renderMatch(match);
        } catch (e) {
            await this.refreshMatch();
        }
    }
};
