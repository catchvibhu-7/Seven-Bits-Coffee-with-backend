/**
 * SEVEN BITS COFFEE - CONNECT FOUR (arcade)
 * Location: /js/ui/connectfour-game.js
 *
 * Two modes, same split as Tic-Tac-Toe:
 *  - BOT: client-side heuristic (win if possible, else block the
 *    opponent's win, else prefer center columns, else random) - not a
 *    full solver, but a genuinely competent casual opponent.
 *  - ONLINE: server-authoritative match against another in-store player,
 *    same shared-arcade-SSE pattern as Tic-Tac-Toe.
 */
import { ArcadeSystem } from "../features/arcade-logic.js";

const ROWS = 6;
const COLS = 7;

function emptyBoard() {
    return Array(ROWS * COLS).fill(null);
}

function checkWinner(board) {
    const get = (r, c) => board[r * COLS + c];
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = get(r, c);
            if (!cell) continue;
            for (const [dr, dc] of dirs) {
                let count = 1;
                for (let k = 1; k < 4; k++) {
                    const nr = r + dr * k;
                    const nc = c + dc * k;
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || get(nr, nc) !== cell) break;
                    count++;
                }
                if (count >= 4) return cell;
            }
        }
    }
    return board.every((c) => c) ? "draw" : null;
}

function findDropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) {
        if (!board[r * COLS + col]) return r;
    }
    return -1;
}

function dropPiece(board, col, symbol) {
    const row = findDropRow(board, col);
    if (row === -1) return null;
    const newBoard = [...board];
    newBoard[row * COLS + col] = symbol;
    return newBoard;
}

function validColumns(board) {
    const cols = [];
    for (let c = 0; c < COLS; c++) {
        if (findDropRow(board, c) !== -1) cols.push(c);
    }
    return cols;
}

function pickBotColumn(board, botSymbol, humanSymbol) {
    const cols = validColumns(board);
    for (const c of cols) {
        if (checkWinner(dropPiece(board, c, botSymbol)) === botSymbol) return c;
    }
    for (const c of cols) {
        if (checkWinner(dropPiece(board, c, humanSymbol)) === humanSymbol) return c;
    }
    const centerOrder = [3, 2, 4, 1, 5, 0, 6];
    for (const c of centerOrder) {
        if (cols.includes(c)) return c;
    }
    return cols[Math.floor(Math.random() * cols.length)];
}

function gridHtml(board) {
    return `
        <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:4px; max-width:280px; margin:0 auto; background:var(--color-border); padding:6px; border-radius:4px;">
            ${board
                .map((cell, i) => {
                    const col = i % COLS;
                    const bg = cell === "R" ? "var(--color-accent)" : cell === "Y" ? "var(--color-text)" : "var(--color-bg)";
                    return `<div class="c4-cell" data-col="${col}" style="aspect-ratio:1; border-radius:50%; background:${bg}; cursor:pointer;"></div>`;
                })
                .join("")}
        </div>
    `;
}

export const ConnectFourGame = {
    root: null,
    mode: null, // "bot" | "online" | null
    board: null,
    botTurn: false,
    matchId: null,
    pollTimer: null,
    onScoreSubmitted: null,

    mount(root) {
        this.root = root;
        this.mode = null;
        this.matchId = null;
        this.renderModeSelect();
    },

    unmount() {
        this.stopPolling();
        if (this.matchId) ArcadeSystem.leaveMatch("connectfour", this.matchId);
        ArcadeSystem.cancelQueue("connectfour");
        this.matchId = null;
        this.mode = null;
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

    renderModeSelect() {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:16px;">CONNECT FOUR</h3>
            <div style="display:grid; gap:10px; max-width:280px; margin:0 auto;">
                <button id="c4-vs-bot" class="admin-btn-primary">VS BOT</button>
                <button id="c4-vs-player" class="admin-btn-primary">VS PLAYER AT THE STORE</button>
                <button id="c4-exit" class="admin-btn">BACK TO GAMES</button>
            </div>
        `;
        this.root.querySelector("#c4-vs-bot").addEventListener("click", () => this.startBotGame());
        this.root.querySelector("#c4-vs-player").addEventListener("click", () => this.startOnlineQueue());
        this.root.querySelector("#c4-exit").addEventListener("click", () => this.exit());
    },

    // --------------------------------------------------------------- BOT
    startBotGame() {
        this.mode = "bot";
        this.board = emptyBoard();
        this.botTurn = false;
        this.renderBotBoard();
    },

    renderBotBoard(message = "Your move (orange)") {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">CONNECT FOUR - VS BOT</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:16px;">${message}</p>
            ${gridHtml(this.board)}
            <div style="text-align:center; margin-top:16px;">
                <button id="c4-back" class="admin-btn">BACK</button>
            </div>
        `;
        this.root.querySelector("#c4-back").addEventListener("click", () => this.renderModeSelect());
        if (!this.botTurn) {
            this.root.querySelectorAll(".c4-cell").forEach((el) => {
                el.addEventListener("click", () => this.handleBotColumnClick(Number(el.dataset.col)));
            });
        }
    },

    handleBotColumnClick(col) {
        if (this.botTurn) return;
        const newBoard = dropPiece(this.board, col, "R");
        if (!newBoard) return; // column full
        this.board = newBoard;
        const winner = checkWinner(this.board);
        if (winner) return this.finishBotGame(winner);

        this.botTurn = true;
        this.renderBotBoard("Bot is thinking...");
        setTimeout(() => {
            const botCol = pickBotColumn(this.board, "Y", "R");
            this.board = dropPiece(this.board, botCol, "Y");
            const winnerAfterBot = checkWinner(this.board);
            if (winnerAfterBot) return this.finishBotGame(winnerAfterBot);
            this.botTurn = false;
            this.renderBotBoard("Your move (orange)");
        }, 500);
    },

    async finishBotGame(winner) {
        this.botTurn = false;
        const message = winner === "draw" ? "DRAW!" : winner === "R" ? "YOU WIN!" : "BOT WINS!";
        if (winner === "R") {
            await ArcadeSystem.submitScore("connectfour", 1);
            if (this.onScoreSubmitted) this.onScoreSubmitted();
        }
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">CONNECT FOUR - VS BOT</h3>
            <p style="text-align:center; font-size:1.1rem; color:var(--color-accent); margin-bottom:16px;">${message}</p>
            ${gridHtml(this.board)}
            <div style="display:grid; gap:10px; max-width:280px; margin:16px auto 0;">
                <button id="c4-again" class="admin-btn-primary">PLAY AGAIN</button>
                <button id="c4-back" class="admin-btn">BACK</button>
            </div>
        `;
        this.root.querySelector("#c4-again").addEventListener("click", () => this.startBotGame());
        this.root.querySelector("#c4-back").addEventListener("click", () => this.renderModeSelect());
    },

    // ------------------------------------------------------------ ONLINE
    async startOnlineQueue() {
        this.mode = "online";
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:16px;">CONNECT FOUR - FINDING AN OPPONENT...</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted);">Waiting for another player at the store to queue up.</p>
            <div style="text-align:center; margin-top:20px;">
                <button id="c4-cancel" class="admin-btn">CANCEL</button>
            </div>
        `;
        this.root.querySelector("#c4-cancel").addEventListener("click", async () => {
            this.stopPolling();
            await ArcadeSystem.cancelQueue("connectfour");
            this.renderModeSelect();
        });

        try {
            const result = await ArcadeSystem.queueMatch("connectfour");
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
            const result = await ArcadeSystem.queueMatch("connectfour");
            return result.status === "matched" ? await ArcadeSystem.fetchMatch("connectfour", result.matchId) : null;
        } catch (e) {
            return null;
        }
    },

    async refreshMatch() {
        const match = await ArcadeSystem.fetchMatch("connectfour", this.matchId);
        if (match) this.renderMatch(match);
    },

    async onArcadeChanged() {
        if (this.mode === "online" && this.matchId) await this.refreshMatch();
    },

    renderMatch(match) {
        const mySymbol = match.you === 0 ? "R" : "Y";
        const isMyTurn = !match.winner && match.turn === match.you;
        const opponentName = match.names[match.you === 0 ? 1 : 0];

        let message;
        if (match.winner === "draw") message = "DRAW!";
        else if (match.winner === mySymbol) message = "YOU WIN!";
        else if (match.winner) message = "YOU LOSE!";
        else message = isMyTurn ? "Your move" : `Waiting for ${opponentName}...`;

        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:4px;">CONNECT FOUR - VS ${opponentName.toUpperCase()}</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:16px;">You are ${mySymbol === "R" ? "orange" : "white"} &middot; ${message}</p>
            ${gridHtml(match.board)}
            <div style="display:grid; gap:10px; max-width:280px; margin:16px auto 0;">
                ${match.winner ? `<button id="c4-again" class="admin-btn-primary">PLAY AGAIN</button>` : ""}
                <button id="c4-back" class="admin-btn">${match.winner ? "BACK" : "LEAVE MATCH"}</button>
            </div>
        `;

        if (isMyTurn && !match.winner) {
            this.root.querySelectorAll(".c4-cell").forEach((el) => {
                el.addEventListener("click", () => this.handleOnlineColumnClick(Number(el.dataset.col)));
            });
        }
        if (match.winner) {
            if (match.winner === mySymbol) {
                ArcadeSystem.submitScore("connectfour", 1).then(() => {
                    if (this.onScoreSubmitted) this.onScoreSubmitted();
                });
            }
            this.root.querySelector("#c4-again")?.addEventListener("click", () => {
                this.matchId = null;
                this.startOnlineQueue();
            });
        }
        this.root.querySelector("#c4-back").addEventListener("click", async () => {
            this.stopPolling();
            const leavingMatchId = this.matchId;
            this.matchId = null;
            if (leavingMatchId) await ArcadeSystem.leaveMatch("connectfour", leavingMatchId);
            this.renderModeSelect();
        });
    },

    async handleOnlineColumnClick(column) {
        try {
            const match = await ArcadeSystem.makeMove("connectfour", this.matchId, { column });
            this.renderMatch(match);
        } catch (e) {
            await this.refreshMatch();
        }
    }
};
