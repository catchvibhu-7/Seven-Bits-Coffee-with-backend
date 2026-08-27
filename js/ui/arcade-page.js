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
import { MemoryGame } from "./memory-game.js";
import { SimonGame } from "./simon-game.js";
import { MinesweeperGame } from "./minesweeper-game.js";
import { Game2048 } from "./2048-game.js";
import { BreakoutGame } from "./breakout-game.js";
import { FlappyGame } from "./flappy-game.js";
import { InvadersGame } from "./invaders-game.js";
import { ConnectFourGame } from "./connectfour-game.js";
import { CheckersGame } from "./checkers-game.js";

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
            <path d="M10 50 L10 30 L30 30 L30 14 L46 14" fill="none" stroke="var(--color-accent)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="50" cy="14" r="7" fill="var(--color-accent)" />
            <circle cx="52" cy="12" r="1.6" fill="#000" />
        </svg>`,
    pong: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <line x1="32" y1="6" x2="32" y2="58" stroke="var(--color-border)" stroke-width="2" stroke-dasharray="4,4" />
            <rect x="6" y="20" width="6" height="20" fill="var(--color-accent)" />
            <rect x="52" y="24" width="6" height="20" fill="var(--color-cyan)" />
            <circle cx="32" cy="32" r="4" fill="var(--color-text)" />
        </svg>`,
    memory: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <rect x="6" y="14" width="22" height="30" rx="3" fill="var(--color-accent)" />
            <rect x="36" y="14" width="22" height="30" rx="3" fill="var(--color-surface)" stroke="var(--color-border)" stroke-width="2" />
            <text x="47" y="34" font-size="16" text-anchor="middle" fill="var(--color-text)">☕</text>
        </svg>`,
    simon: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <path d="M32 32 L32 6 A26 26 0 0 1 55 19 Z" fill="var(--color-accent)" />
            <path d="M32 32 L55 19 A26 26 0 0 1 55 45 Z" fill="var(--color-cyan)" />
            <path d="M32 32 L55 45 A26 26 0 0 1 9 45 Z" fill="#22c55e" />
            <path d="M32 32 L9 45 A26 26 0 0 1 32 6 Z" fill="#a855f7" />
            <circle cx="32" cy="32" r="6" fill="var(--color-bg)" />
        </svg>`,
    minesweeper: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <g stroke="var(--color-border)" stroke-width="1.5">
                <rect x="6" y="6" width="52" height="52" fill="none" />
                <line x1="23" y1="6" x2="23" y2="58" /><line x1="40" y1="6" x2="40" y2="58" />
                <line x1="6" y1="23" x2="58" y2="23" /><line x1="6" y1="40" x2="58" y2="40" />
            </g>
            <text x="14" y="19" font-size="11" fill="#3b82f6">1</text>
            <text x="48" y="53" font-size="14" text-anchor="middle">🚩</text>
            <text x="31" y="36" font-size="14" text-anchor="middle">💣</text>
        </svg>`,
    "2048": `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <rect x="6" y="6" width="24" height="24" rx="3" fill="#4a3520" />
            <rect x="34" y="6" width="24" height="24" rx="3" fill="var(--color-accent)" />
            <rect x="6" y="34" width="24" height="24" rx="3" fill="var(--color-cyan)" />
            <rect x="34" y="34" width="24" height="24" rx="3" fill="#8a5a20" />
            <text x="18" y="22" font-size="10" text-anchor="middle" fill="var(--color-text-muted)">2</text>
            <text x="46" y="22" font-size="10" text-anchor="middle" fill="#000">64</text>
            <text x="18" y="50" font-size="10" text-anchor="middle" fill="#000">2048</text>
            <text x="46" y="50" font-size="10" text-anchor="middle" fill="var(--color-text-muted)">8</text>
        </svg>`,
    breakout: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <rect x="6" y="8" width="12" height="7" fill="var(--color-cyan)" /><rect x="20" y="8" width="12" height="7" fill="var(--color-cyan)" /><rect x="34" y="8" width="12" height="7" fill="var(--color-cyan)" /><rect x="48" y="8" width="10" height="7" fill="var(--color-cyan)" />
            <rect x="6" y="17" width="12" height="7" fill="var(--color-cyan)" opacity="0.7" /><rect x="20" y="17" width="12" height="7" fill="var(--color-cyan)" opacity="0.7" /><rect x="34" y="17" width="12" height="7" fill="var(--color-cyan)" opacity="0.7" /><rect x="48" y="17" width="10" height="7" fill="var(--color-cyan)" opacity="0.7" />
            <circle cx="32" cy="40" r="4" fill="var(--color-text)" />
            <rect x="22" y="52" width="20" height="6" rx="2" fill="var(--color-accent)" />
        </svg>`,
    flappy: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <rect x="4" y="4" width="10" height="24" fill="var(--color-cyan)" />
            <rect x="4" y="40" width="10" height="20" fill="var(--color-cyan)" />
            <rect x="50" y="4" width="10" height="14" fill="var(--color-cyan)" />
            <rect x="50" y="30" width="10" height="30" fill="var(--color-cyan)" />
            <circle cx="32" cy="30" r="8" fill="var(--color-accent)" />
        </svg>`,
    invaders: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <g fill="var(--color-cyan)">
                <rect x="8" y="10" width="10" height="8" /><rect x="22" y="10" width="10" height="8" /><rect x="36" y="10" width="10" height="8" />
                <rect x="15" y="20" width="10" height="8" /><rect x="29" y="20" width="10" height="8" />
            </g>
            <rect x="26" y="44" width="12" height="6" fill="var(--color-accent)" />
            <rect x="30" y="38" width="4" height="8" fill="var(--color-accent)" />
        </svg>`,
    connectfour: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <rect x="4" y="4" width="56" height="48" rx="4" fill="var(--color-cyan)" />
            <circle cx="16" cy="16" r="6" fill="var(--color-bg)" /><circle cx="32" cy="16" r="6" fill="var(--color-accent)" /><circle cx="48" cy="16" r="6" fill="var(--color-bg)" />
            <circle cx="16" cy="32" r="6" fill="var(--color-accent)" /><circle cx="32" cy="32" r="6" fill="var(--color-text)" /><circle cx="48" cy="32" r="6" fill="var(--color-bg)" />
            <circle cx="16" cy="44" r="6" fill="var(--color-text)" /><circle cx="32" cy="44" r="6" fill="var(--color-accent)" /><circle cx="48" cy="44" r="6" fill="var(--color-text)" />
        </svg>`,
    checkers: `
        <svg viewBox="0 0 64 64" class="arcade-thumb">
            <g>
                <rect x="4" y="4" width="14" height="14" fill="var(--color-surface)" /><rect x="18" y="4" width="14" height="14" fill="var(--color-bg)" /><rect x="32" y="4" width="14" height="14" fill="var(--color-surface)" /><rect x="46" y="4" width="14" height="14" fill="var(--color-bg)" />
                <rect x="4" y="18" width="14" height="14" fill="var(--color-bg)" /><rect x="18" y="18" width="14" height="14" fill="var(--color-surface)" /><rect x="32" y="18" width="14" height="14" fill="var(--color-bg)" /><rect x="46" y="18" width="14" height="14" fill="var(--color-surface)" />
                <rect x="4" y="32" width="14" height="14" fill="var(--color-surface)" /><rect x="18" y="32" width="14" height="14" fill="var(--color-bg)" /><rect x="32" y="32" width="14" height="14" fill="var(--color-surface)" /><rect x="46" y="32" width="14" height="14" fill="var(--color-bg)" />
            </g>
            <circle cx="11" cy="11" r="5" fill="var(--color-accent)" /><circle cx="39" cy="11" r="5" fill="var(--color-accent)" />
            <circle cx="25" cy="39" r="5" fill="var(--color-text)" /><circle cx="53" cy="39" r="5" fill="var(--color-text)" />
        </svg>`
};

const TIPS = {
    tictactoe: "The bot isn't unbeatable - watch for a chance to set up two winning lines at once (a fork) so it can't block both.",
    tetris: "Space bar hard-drops the current piece instantly for a small score bonus.",
    snake: "Speed ramps up the more you eat. Try EASY mode below the board if HARD feels unfair.",
    pong: "Drag the paddle-speed slider to match your own reflexes - there's no shame in turning it down.",
    memory: "Fewer moves means a higher score - try to lock in a pair's position in your head as you flip it.",
    simon: "Watch the whole sequence before tapping anything back - rushing is what causes most mistakes.",
    minesweeper: "A revealed number tells you exactly how many mines touch that cell - use it to rule out safe neighbors.",
    "2048": "Pick one corner to favor and keep pushing tiles toward it - mixing directions scatters your big numbers.",
    breakout: "Where the ball hits your paddle changes its bounce angle - aim for the edges to steer around bricks.",
    flappy: "Small, steady taps beat one big flap - find a rhythm instead of reacting to each pipe.",
    invaders: "Keep moving sideways while you shoot - a still target is an easy one.",
    connectfour: "Controlling the center column gives you the most ways to eventually connect four.",
    checkers: "Captures are forced - if one's available on your turn, you have to take it."
};

const GAME_DEFS = {
    tictactoe: { name: "TIC-TAC-TOE", module: TicTacToeGame, scoreLabel: "BEST WIN STREAK" },
    tetris: { name: "TETRIS", module: TetrisGame, scoreLabel: "HIGH SCORES" },
    snake: { name: "SNAKE", module: SnakeGame, scoreLabel: "HIGH SCORES" },
    pong: { name: "PONG", module: PongGame, scoreLabel: "HIGH SCORES" },
    memory: { name: "MEMORY MATCH", module: MemoryGame, scoreLabel: "HIGH SCORES" },
    simon: { name: "SIMON SAYS", module: SimonGame, scoreLabel: "ROUNDS REACHED" },
    minesweeper: { name: "MINESWEEPER", module: MinesweeperGame, scoreLabel: "HIGH SCORES" },
    "2048": { name: "2048", module: Game2048, scoreLabel: "HIGH SCORES" },
    breakout: { name: "BREAKOUT", module: BreakoutGame, scoreLabel: "HIGH SCORES" },
    flappy: { name: "FLAPPY BIT", module: FlappyGame, scoreLabel: "HIGH SCORES" },
    invaders: { name: "SPACE INVADERS", module: InvadersGame, scoreLabel: "HIGH SCORES" },
    connectfour: { name: "CONNECT FOUR", module: ConnectFourGame, scoreLabel: "BEST WIN STREAK" },
    checkers: { name: "CHECKERS", module: CheckersGame, scoreLabel: "BEST WIN STREAK" }
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
        // The switcher panel can call this while a different game is already
        // mounted (jumping straight from one game to another) - unmount it
        // first so its timers/rAF loop/document key listeners don't keep
        // running in the background, and so an online match gets left
        // properly instead of orphaned.
        if (this.activeGame && this.activeGame !== gameKey && GAME_DEFS[this.activeGame]) {
            GAME_DEFS[this.activeGame].module.unmount();
        }
        this.activeGame = gameKey;
        this.root.innerHTML = `
            <div class="arcade-play-layout">
                <div class="arcade-switcher" id="arcade-switcher"></div>
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

        this.renderSwitcher(gameKey);
        this.renderSidebar(gameKey);
        def.module.mount(gameArea);
    },

    /** Desktop-only panel (hidden on narrow screens, see .arcade-switcher in
     *  theme.css) - a quick way to jump straight to another game without
     *  backing out to the card grid, plus a short tip for whatever's active. */
    renderSwitcher(gameKey) {
        const switcher = this.root.querySelector("#arcade-switcher");
        if (!switcher) return;
        const others = Object.entries(GAME_DEFS).filter(([key]) => key !== gameKey);
        switcher.innerHTML = `
            <div class="arcade-switcher-games">
                ${others
                    .map(
                        ([key, def]) => `
                    <button class="arcade-switch-btn" data-game="${key}">
                        ${THUMBS[key]}
                        <span>${def.name}</span>
                    </button>
                `
                    )
                    .join("")}
            </div>
            ${
                TIPS[gameKey]
                    ? `<div class="arcade-tip-box">
                        <div class="arcade-tip-label">TIP</div>
                        <div class="arcade-tip-text">${escapeHtml(TIPS[gameKey])}</div>
                    </div>`
                    : ""
            }
        `;
        switcher.querySelectorAll(".arcade-switch-btn").forEach((btn) => {
            btn.addEventListener("click", () => this.launchGame(btn.dataset.game));
        });
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

    /** Called by app.js's SSE handler when the "arcade" event fires (an
     *  online match was created or a move was made in one of the
     *  matchmade games). */
    onArcadeChanged() {
        if (this.activeGame === "tictactoe") TicTacToeGame.onArcadeChanged();
        else if (this.activeGame === "connectfour") ConnectFourGame.onArcadeChanged();
        else if (this.activeGame === "checkers") CheckersGame.onArcadeChanged();
    }
};
