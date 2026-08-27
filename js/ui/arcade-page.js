/**
 * SEVEN BITS COFFEE - ARCADE PAGE (in-store games)
 * Location: /js/ui/arcade-page.js
 *
 * Gate + card-grid menu for the arcade. Access is server-checked every time
 * this page is opened (ArcadeSystem.checkAccess) - never assumed
 * client-side, since the whole point is that it expires a fixed time after
 * an order. Once a game is opened, its leaderboard sits alongside it
 * (.arcade-play-layout in theme.css handles the side-by-side-on-wide,
 * stacked-on-narrow responsive split).
 */
import { ArcadeSystem } from "../features/arcade-logic.js";
import { TicTacToeGame } from "./tictactoe-game.js";
import { TetrisGame } from "./tetris-game.js";
import { SnakeGame } from "./snake-game.js";
import { PongGame } from "./pong-game.js";

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Inline SVG (not CSS background-images) so thumbnails can reference the
// live theme/accent color vars directly, same as the rest of the app.
const THUMBS = {
    tictactoe: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <g stroke="var(--color-text-muted)" stroke-width="2">
                <line x1="22" y1="6" x2="22" y2="58" />
                <line x1="42" y1="6" x2="42" y2="58" />
                <line x1="6" y1="22" x2="58" y2="22" />
                <line x1="6" y1="42" x2="58" y2="42" />
            </g>
            <g stroke="var(--color-accent)" stroke-width="3" stroke-linecap="round">
                <line x1="10" y1="10" x2="18" y2="18" />
                <line x1="18" y1="10" x2="10" y2="18" />
            </g>
            <circle cx="32" cy="32" r="6" fill="none" stroke="var(--color-cyan)" stroke-width="3" />
        </svg>`,
    tetris: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <rect x="8" y="8" width="14" height="14" fill="#22d3ee" />
            <rect x="22" y="8" width="14" height="14" fill="#22d3ee" />
            <rect x="8" y="22" width="14" height="14" fill="#22d3ee" />
            <rect x="36" y="22" width="14" height="14" fill="#f97316" />
            <rect x="36" y="36" width="14" height="14" fill="#f97316" />
            <rect x="50" y="36" width="14" height="14" fill="#f97316" />
            <rect x="8" y="42" width="14" height="14" fill="#a855f7" />
            <rect x="22" y="42" width="14" height="14" fill="#a855f7" />
        </svg>`,
    snake: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <path d="M10 50 L10 30 L30 30 L30 14 L46 14" fill="none" stroke="#22c55e" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="50" cy="14" r="7" fill="#22c55e" />
            <circle cx="52" cy="12" r="1.6" fill="#052e14" />
        </svg>`,
    pong: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <line x1="32" y1="6" x2="32" y2="58" stroke="var(--color-border)" stroke-width="2" stroke-dasharray="4,4" />
            <rect x="6" y="20" width="6" height="20" fill="var(--color-accent)" />
            <rect x="52" y="24" width="6" height="20" fill="var(--color-cyan)" />
            <circle cx="32" cy="32" r="4" fill="var(--color-text)" />
        </svg>`
};

const GAME_DEFS = {
    tictactoe: { name: "TIC-TAC-TOE", module: TicTacToeGame, scoreLabel: "WINS" },
    tetris: { name: "TETRIS", module: TetrisGame, scoreLabel: "HIGH SCORES" },
    snake: { name: "SNAKE", module: SnakeGame, scoreLabel: "HIGH SCORES" },
    pong: { name: "PONG", module: PongGame, scoreLabel: "HIGH SCORES" }
};

export const ArcadePage = {
    root: null,
    activeGame: null, // one of GAME_DEFS's keys, or null

    async init() {
        this.root = document.getElementById("arcade-root");
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
                    <h2 style="margin-bottom:10px;">ARCADE</h2>
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
            <h2 style="text-align:center; margin-bottom:4px;">ARCADE</h2>
            ${expiresLabel ? `<p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-bottom:10px;">Access until ${expiresLabel}</p>` : ""}
            <div class="arcade-grid">
                ${Object.entries(GAME_DEFS)
                    .map(
                        ([key, def]) => `
                    <div class="arcade-card" data-game="${key}">
                        ${THUMBS[key]}
                        <div class="arcade-card-name">${def.name}</div>
                    </div>
                `
                    )
                    .join("")}
            </div>
        `;
        this.root.querySelectorAll(".arcade-card").forEach((card) => {
            card.addEventListener("click", () => this.launchGame(card.dataset.game));
        });
    },

    launchGame(gameKey) {
        const def = GAME_DEFS[gameKey];
        if (!def) return;
        this.activeGame = gameKey;
        this.root.innerHTML = `
            <div class="arcade-play-layout">
                <div class="arcade-game-area" id="arcade-game-area"></div>
                <div class="arcade-sidebar" id="arcade-sidebar"></div>
            </div>
        `;
        const gameArea = this.root.querySelector("#arcade-game-area");

        def.module.onExit = () => {
            this.activeGame = null;
            this.renderGate();
        };
        def.module.onScoreSubmitted = () => this.renderSidebar(gameKey);

        this.renderSidebar(gameKey);
        def.module.mount(gameArea);
    },

    async renderSidebar(gameKey) {
        const sidebar = this.root.querySelector("#arcade-sidebar");
        if (!sidebar) return;
        const def = GAME_DEFS[gameKey];
        const scores = await ArcadeSystem.fetchScores(gameKey);
        sidebar.innerHTML = `
            <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:4px; padding:16px;">
                <h4 style="font-size:9pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">${def.scoreLabel}</h4>
                ${
                    scores.length === 0
                        ? `<p style="font-size:8pt; color:var(--color-text-muted);">No scores yet - be the first!</p>`
                        : scores
                              .map(
                                  (s, i) => `
                        <div style="display:flex; justify-content:space-between; font-size:8.5pt; padding:5px 0; ${i < scores.length - 1 ? "border-bottom:1px dashed var(--color-border);" : ""}">
                            <span>${i + 1}. ${escapeHtml(s.name)}</span>
                            <span style="color:var(--color-accent); font-weight:bold;">${s.score}</span>
                        </div>
                    `
                              )
                              .join("")
                }
            </div>
        `;
    },

    /** Called by app.js's SSE handler when the "arcade" event fires (a
     *  Tic-Tac-Toe match was created or a move was made). */
    onArcadeChanged() {
        if (this.activeGame === "tictactoe") TicTacToeGame.onArcadeChanged();
    }
};
