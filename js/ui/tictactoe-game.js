/**
 * SEVEN BITS COFFEE - TIC-TAC-TOE (arcade)
 * Location: /js/ui/tictactoe-game.js
 *
 * Two modes:
 *  - BOT: fully client-side, an unbeatable minimax opponent (tic-tac-toe's
 *    search space is tiny - 9! at most - so a full search is instant).
 *  - ONLINE: server-authoritative match against another in-store player.
 *    Moves are POSTed and validated server-side; board state comes back
 *    from the server every time, never computed locally, so two tabs can
 *    never desync. Live updates arrive via the shared arcade SSE event
 *    (see onArcadeChanged), with polling as a fallback while waiting to be
 *    matched (SSE only fires once someone else queues, not for the wait
 *    itself).
 */
import { ArcadeSystem } from "../features/arcade-logic.js";

const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

function checkWinner(board) {
    for (const [a, b, c] of LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return board.every((cell) => cell) ? "draw" : null;
}

function minimax(board, player, bot, human) {
    const winner = checkWinner(board);
    if (winner === bot) return { score: 10 };
    if (winner === human) return { score: -10 };
    if (winner === "draw") return { score: 0 };

    const moves = [];
    for (let i = 0; i < 9; i++) {
        if (!board[i]) {
            board[i] = player;
            const result = minimax(board, player === bot ? human : bot, bot, human);
            moves.push({ index: i, score: result.score });
            board[i] = null;
        }
    }
    return player === bot
        ? moves.reduce((best, m) => (m.score > best.score ? m : best))
        : moves.reduce((best, m) => (m.score < best.score ? m : best));
}

function cellStyle() {
    return "aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:2rem; font-weight:bold; background:var(--color-bg); border:1px solid var(--color-border); cursor:pointer; font-family:'Courier New',monospace;";
}

function gridHtml(board, disabled) {
    return `
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; max-width:280px; margin:0 auto;">
            ${board
                .map(
                    (cell, i) => `
                <div class="ttt-cell" data-cell="${i}" style="${cellStyle()} ${disabled || cell ? "cursor:default;" : ""} color:${cell === "X" ? "var(--color-accent)" : "var(--color-cyan)"};">${cell || ""}</div>
            `
                )
                .join("")}
        </div>
    `;
}

export const TicTacToeGame = {
    root: null,
    mode: null, // "bot" | "online" | null
    board: null,
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
        if (this.matchId) ArcadeSystem.leaveMatch(this.matchId);
        ArcadeSystem.cancelQueue();
        this.matchId = null;
        this.mode = null;
    },

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },

    renderModeSelect() {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:16px;">TIC-TAC-TOE</h3>
            <div style="display:grid; gap:10px; max-width:280px; margin:0 auto;">
                <button id="ttt-vs-bot" class="admin-btn-primary">VS BOT</button>
                <button id="ttt-vs-player" class="admin-btn-primary">VS PLAYER AT THE STORE</button>
                <button id="ttt-exit" class="admin-btn">BACK TO GAMES</button>
            </div>
        `;
        this.root.querySelector("#ttt-vs-bot").addEventListener("click", () => this.startBotGame());
        this.root.querySelector("#ttt-vs-player").addEventListener("click", () => this.startOnlineQueue());
        this.root.querySelector("#ttt-exit").addEventListener("click", () => {
            this.unmount();
            this.onExit();
        });
    },

    onExit: () => {},

    // --------------------------------------------------------------- BOT
    startBotGame() {
        this.mode = "bot";
        this.board = Array(9).fill(null);
        this.botTurn = false;
        this.renderBotBoard();
    },

    renderBotBoard(message = "Your move (X)") {
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">TIC-TAC-TOE - VS BOT</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:16px;">${message}</p>
            ${gridHtml(this.board, this.botTurn)}
            <div style="text-align:center; margin-top:16px;">
                <button id="ttt-back" class="admin-btn">BACK</button>
            </div>
        `;
        this.root.querySelector("#ttt-back").addEventListener("click", () => this.renderModeSelect());
        if (!this.botTurn) {
            this.root.querySelectorAll(".ttt-cell").forEach((el) => {
                el.addEventListener("click", () => this.handleBotCellClick(Number(el.dataset.cell)));
            });
        }
    },

    handleBotCellClick(index) {
        if (this.board[index] || this.botTurn) return;
        this.board[index] = "X";
        const winner = checkWinner(this.board);
        if (winner) return this.finishBotGame(winner);

        this.botTurn = true;
        this.renderBotBoard("Bot is thinking...");
        setTimeout(() => {
            const { index: botMove } = minimax([...this.board], "O", "O", "X");
            this.board[botMove] = "O";
            const winnerAfterBot = checkWinner(this.board);
            if (winnerAfterBot) return this.finishBotGame(winnerAfterBot);
            this.botTurn = false;
            this.renderBotBoard("Your move (X)");
        }, 400);
    },

    async finishBotGame(winner) {
        this.botTurn = false;
        const message = winner === "draw" ? "DRAW!" : winner === "X" ? "YOU WIN!" : "BOT WINS!";
        if (winner === "X") {
            await ArcadeSystem.submitScore("tictactoe", 1);
            if (this.onScoreSubmitted) this.onScoreSubmitted();
        }
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:8px;">TIC-TAC-TOE - VS BOT</h3>
            <p style="text-align:center; font-size:1.1rem; color:var(--color-accent); margin-bottom:16px;">${message}</p>
            ${gridHtml(this.board, true)}
            <div style="display:grid; gap:10px; max-width:280px; margin:16px auto 0;">
                <button id="ttt-again" class="admin-btn-primary">PLAY AGAIN</button>
                <button id="ttt-back" class="admin-btn">BACK</button>
            </div>
        `;
        this.root.querySelector("#ttt-again").addEventListener("click", () => this.startBotGame());
        this.root.querySelector("#ttt-back").addEventListener("click", () => this.renderModeSelect());
    },

    // ------------------------------------------------------------ ONLINE
    async startOnlineQueue() {
        this.mode = "online";
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:16px;">TIC-TAC-TOE - FINDING AN OPPONENT...</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted);">Waiting for another player at the store to queue up.</p>
            <div style="text-align:center; margin-top:20px;">
                <button id="ttt-cancel" class="admin-btn">CANCEL</button>
            </div>
        `;
        this.root.querySelector("#ttt-cancel").addEventListener("click", async () => {
            this.stopPolling();
            await ArcadeSystem.cancelQueue();
            this.renderModeSelect();
        });

        try {
            const result = await ArcadeSystem.queueTicTacToe();
            if (result.status === "matched") {
                this.matchId = result.matchId;
                await this.refreshMatch();
            } else {
                // Poll while waiting - SSE only fires once an opponent shows up
                // and pairs us, there's no event for "still waiting".
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
        // Re-queueing is idempotent server-side (see /api/arcade/tictactoe/queue) -
        // if we're already matched it just returns that match instead of
        // queueing again, which is what makes this a safe way to poll.
        try {
            const result = await ArcadeSystem.queueTicTacToe();
            return result.status === "matched" ? await ArcadeSystem.fetchMatch(result.matchId) : null;
        } catch (e) {
            return null;
        }
    },

    async refreshMatch() {
        const match = await ArcadeSystem.fetchMatch(this.matchId);
        if (match) this.renderMatch(match);
    },

    async onArcadeChanged() {
        if (this.mode === "online" && this.matchId) await this.refreshMatch();
    },

    renderMatch(match) {
        const mySymbol = match.you === 0 ? "X" : "O";
        const isMyTurn = !match.winner && match.turn === match.you;
        const opponentName = match.names[match.you === 0 ? 1 : 0];

        let message;
        if (match.winner === "draw") message = "DRAW!";
        else if (match.winner === mySymbol) message = "YOU WIN!";
        else if (match.winner) message = "YOU LOSE!";
        else message = isMyTurn ? "Your move" : `Waiting for ${opponentName}...`;

        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:4px;">TIC-TAC-TOE - VS ${opponentName.toUpperCase()}</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:16px;">You are ${mySymbol} &middot; ${message}</p>
            ${gridHtml(match.board, !isMyTurn || !!match.winner)}
            <div style="display:grid; gap:10px; max-width:280px; margin:16px auto 0;">
                ${match.winner ? `<button id="ttt-again" class="admin-btn-primary">PLAY AGAIN</button>` : ""}
                <button id="ttt-back" class="admin-btn">${match.winner ? "BACK" : "LEAVE MATCH"}</button>
            </div>
        `;

        if (isMyTurn && !match.winner) {
            this.root.querySelectorAll(".ttt-cell").forEach((el) => {
                el.addEventListener("click", () => this.handleOnlineCellClick(Number(el.dataset.cell)));
            });
        }
        if (match.winner) {
            if (match.winner === mySymbol) {
                ArcadeSystem.submitScore("tictactoe", 1).then(() => {
                    if (this.onScoreSubmitted) this.onScoreSubmitted();
                });
            }
            this.root.querySelector("#ttt-again")?.addEventListener("click", () => {
                this.matchId = null;
                this.startOnlineQueue();
            });
        }
        this.root.querySelector("#ttt-back").addEventListener("click", async () => {
            this.stopPolling();
            const leavingMatchId = this.matchId;
            // Clear matchId before the request, not after - leaveMatch()'s own
            // broadcast can reach this same tab's SSE listener before the
            // fetch resolves, and onArcadeChanged() should see we've already
            // left rather than refetching a match that's about to be deleted.
            this.matchId = null;
            if (leavingMatchId) await ArcadeSystem.leaveMatch(leavingMatchId);
            this.renderModeSelect();
        });
    },

    async handleOnlineCellClick(cell) {
        try {
            const match = await ArcadeSystem.makeMove(this.matchId, cell);
            this.renderMatch(match);
        } catch (e) {
            await this.refreshMatch();
        }
    }
};
