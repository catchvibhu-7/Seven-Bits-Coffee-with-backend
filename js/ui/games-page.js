/**
 * SEVEN BITS COFFEE - GAMES PAGE (in-store arcade)
 * Location: /js/ui/games-page.js
 *
 * Gate + menu for the arcade. Access is server-checked every time this page
 * is opened (ArcadeSystem.checkAccess) - never assumed client-side, since
 * the whole point is that it expires a fixed time after an order.
 */
import { ArcadeSystem } from "../features/arcade-logic.js";
import { TicTacToeGame } from "./tictactoe-game.js";
import { TetrisGame } from "./tetris-game.js";

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const GamesPage = {
    root: null,
    activeGame: null, // "tictactoe" | "tetris" | null

    async init() {
        this.root = document.getElementById("games-root");
        if (!this.root) return;
        this.activeGame = null;
        await this.renderGate();
    },

    async renderGate() {
        this.root.innerHTML = `<p style="text-align:center; color:var(--color-text-muted);">Checking access...</p>`;
        const access = await ArcadeSystem.checkAccess();
        if (!access.allowed) {
            this.root.innerHTML = `
                <div style="text-align:center; padding:40px 20px;">
                    <h2 style="margin-bottom:10px;">GAMES</h2>
                    <p style="color:var(--color-text-muted); font-size:9pt;">${escapeHtml(access.reason || "Place an order to unlock the arcade.")}</p>
                </div>
            `;
            return;
        }
        this.renderMenu(access);
    },

    renderMenu(access) {
        const expiresLabel = access.expiresAt
            ? new Date(access.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : null;
        this.root.innerHTML = `
            <h2 style="text-align:center; margin-bottom:4px;">GAMES</h2>
            ${expiresLabel ? `<p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-bottom:20px;">Arcade access until ${expiresLabel}</p>` : ""}
            <div style="display:grid; gap:10px; max-width:280px; margin:0 auto 24px;">
                <button id="games-tictactoe" class="admin-btn-primary">TIC-TAC-TOE</button>
                <button id="games-tetris" class="admin-btn-primary">TETRIS</button>
            </div>
            <div id="games-leaderboard"></div>
        `;
        this.root.querySelector("#games-tictactoe").addEventListener("click", () => this.launchGame("tictactoe"));
        this.root.querySelector("#games-tetris").addEventListener("click", () => this.launchGame("tetris"));
        this.renderLeaderboards();
    },

    async renderLeaderboards() {
        const el = this.root.querySelector("#games-leaderboard");
        if (!el) return;
        const [tttScores, tetrisScores] = await Promise.all([
            ArcadeSystem.fetchScores("tictactoe"),
            ArcadeSystem.fetchScores("tetris")
        ]);
        el.innerHTML = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                ${this.leaderboardHtml("TIC-TAC-TOE WINS", tttScores)}
                ${this.leaderboardHtml("TETRIS HIGH SCORES", tetrisScores)}
            </div>
        `;
    },

    leaderboardHtml(title, scores) {
        return `
            <div>
                <h4 style="font-size:8pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:8px;">${title}</h4>
                ${
                    scores.length === 0
                        ? `<p style="font-size:7pt; color:var(--color-text-muted);">No scores yet.</p>`
                        : scores
                              .map(
                                  (s, i) =>
                                      `<div style="display:flex; justify-content:space-between; font-size:8pt; padding:2px 0;"><span>${i + 1}. ${escapeHtml(s.name)}</span><span>${s.score}</span></div>`
                              )
                              .join("")
                }
            </div>
        `;
    },

    launchGame(game) {
        this.activeGame = game;
        if (game === "tictactoe") {
            TicTacToeGame.onExit = () => {
                this.activeGame = null;
                this.renderGate();
            };
            TicTacToeGame.mount(this.root);
        } else if (game === "tetris") {
            TetrisGame.onExit = () => {
                this.activeGame = null;
                this.renderGate();
            };
            TetrisGame.mount(this.root);
        }
    },

    /** Called by app.js's SSE handler when the "arcade" event fires (a
     *  Tic-Tac-Toe match was created or a move was made) - only relevant
     *  while that game is the one currently mounted. */
    onArcadeChanged() {
        if (this.activeGame === "tictactoe") TicTacToeGame.onArcadeChanged();
    }
};
