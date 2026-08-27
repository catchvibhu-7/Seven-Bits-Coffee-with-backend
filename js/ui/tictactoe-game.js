/**
 * SEVEN BITS COFFEE - TIC-TAC-TOE (arcade)
 * Location: /js/ui/tictactoe-game.js
 *
 * Two modes:
 *  - BOT: fully client-side. Never misses a free win or a block (see
 *    pickBotMove), but otherwise plays a random legal move most of the time
 *    instead of full minimax - a pure minimax bot is unbeatable, which makes
 *    "vs bot" pointless to actually play.
 *  - ONLINE: server-authoritative match against another in-store player.
 *    Moves are POSTed and validated server-side; board state comes back
 *    from the server every time, never computed locally, so two tabs can
 *    never desync. Live updates arrive via the shared arcade SSE event
 *    (see onArcadeChanged), with polling as a fallback while waiting to be
 *    matched (SSE only fires once someone else queues, not for the wait
 *    itself).
 */
import { ArcadeSystem } from "../features/arcade-logic.js";
import { submitScoreWithCelebration } from "../features/game-fx.js";

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

function emptyCells(board) {
    const cells = [];
    for (let i = 0; i < 9; i++) if (!board[i]) cells.push(i);
    return cells;
}

// A move that would immediately win FOR `player` if played right now, or
// null - used so the bot never misses a free win/block even on the moves
// where it's about to play randomly instead of optimally.
function findImmediateWin(board, player) {
    for (const i of emptyCells(board)) {
        board[i] = player;
        const win = checkWinner(board) === player;
        board[i] = null;
        if (win) return i;
    }
    return null;
}

// A pure minimax bot is unbeatable (best case for a human is a draw), which
// makes the "vs bot" mode pointless to actually play. So: always take a free
// win or block a losing threat (a bot that misses those looks broken, not
// beatable), but otherwise play a random legal move most of the time instead
// of the optimal one - only occasionally falling back to full minimax. That
// keeps it a real opponent while leaving enough gaps for a decent player to
// win some of the time.
function pickBotMove(board) {
    const winNow = findImmediateWin(board, "O");
    if (winNow !== null) return winNow;
    const blockNow = findImmediateWin(board, "X");
    if (blockNow !== null) return blockNow;
    if (Math.random() < 0.7) {
        const cells = emptyCells(board);
        return cells[Math.floor(Math.random() * cells.length)];
    }
    return minimax([...board], "O", "O", "X").index;
}

function cellStyle() {
    return "aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:2rem; font-weight:bold; background:var(--color-bg); border:1px solid var(--color-border); cursor:pointer; font-family:'Courier New',monospace;";
}

function gridHtml(board, disabled) {
    return `
        <div class="arcade-board" style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">
            ${board
                .map(
                    (cell, i) => `
                <div class="ttt-cell" data-cell="${i}" style="${cellStyle()} ${disabled || cell ? "cursor:default;" : ""} color:${cell === "X" ? "var(--color-accent)" : "var(--color-text)"};">${cell || ""}</div>
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
    // Tic-Tac-Toe's leaderboard tracks longest win streak, not a per-game
    // score (every game here is worth exactly 1 win, so "high score" would
    // just mean "played the most games") - streak persists across bot AND
    // online games within the same arcade visit, resets on a loss or draw.
    winStreak: 0,
    processedResultFor: null,

    mount(root) {
        this.root = root;
        this.mode = null;
        this.matchId = null;
        this.renderModeSelect();
    },

    unmount() {
        this.stopPolling();
        if (this.matchId) ArcadeSystem.leaveMatch("tictactoe", this.matchId);
        ArcadeSystem.cancelQueue("tictactoe");
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
            const botMove = pickBotMove(this.board);
            this.board[botMove] = "O";
            const winnerAfterBot = checkWinner(this.board);
            if (winnerAfterBot) return this.finishBotGame(winnerAfterBot);
            this.botTurn = false;
            this.renderBotBoard("Your move (X)");
        }, 400);
    },

    async finishBotGame(winner) {
        this.botTurn = false;
        let message;
        let endingStreak = 0;
        if (winner === "X") {
            this.winStreak++;
            message = `YOU WIN! - WIN STREAK: ${this.winStreak}`;
        } else {
            endingStreak = this.winStreak;
            this.winStreak = 0;
            message = winner === "draw" ? "DRAW!" : endingStreak > 0 ? `BOT WINS! - STREAK ENDED AT ${endingStreak}` : "BOT WINS!";
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

        if (endingStreak > 0) {
            const { submitted } = await submitScoreWithCelebration(this.root, "tictactoe", endingStreak);
            if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        }
    },

    // ------------------------------------------------------------ ONLINE
    async startOnlineQueue() {
        this.mode = "online";
        this.processedResultFor = null;
        this.root.innerHTML = `
            <h3 style="text-align:center; margin-bottom:16px;">TIC-TAC-TOE - FINDING AN OPPONENT...</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted);">Waiting for another player at the store to queue up.</p>
            <div style="text-align:center; margin-top:20px;">
                <button id="ttt-cancel" class="admin-btn">CANCEL</button>
            </div>
        `;
        this.root.querySelector("#ttt-cancel").addEventListener("click", async () => {
            this.stopPolling();
            await ArcadeSystem.cancelQueue("tictactoe");
            this.renderModeSelect();
        });

        try {
            const result = await ArcadeSystem.queueMatch("tictactoe");
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
            const result = await ArcadeSystem.queueMatch("tictactoe");
            return result.status === "matched" ? await ArcadeSystem.fetchMatch("tictactoe", result.matchId) : null;
        } catch (e) {
            return null;
        }
    },

    async refreshMatch() {
        const match = await ArcadeSystem.fetchMatch("tictactoe", this.matchId);
        if (match) this.renderMatch(match);
    },

    async onArcadeChanged() {
        if (this.mode === "online" && this.matchId) await this.refreshMatch();
    },

    renderMatch(match) {
        const mySymbol = match.you === 0 ? "X" : "O";
        const isMyTurn = !match.winner && match.turn === match.you;
        const opponentName = match.names[match.you === 0 ? 1 : 0];
        // A win/loss/draw only changes the streak the FIRST time this match's
        // result is rendered - onArcadeChanged() can call renderMatch() again
        // for the same finished match (e.g. another arcade event fires while
        // this tab is still sitting on the game-over screen).
        const isFreshResult = !!match.winner && this.processedResultFor !== match.id;
        if (isFreshResult) this.processedResultFor = match.id;

        let endingStreak = 0;
        if (isFreshResult) {
            if (match.winner === mySymbol) this.winStreak++;
            else {
                endingStreak = this.winStreak;
                this.winStreak = 0;
            }
        }

        let message;
        if (match.winner === "draw") message = "DRAW!";
        else if (match.winner === mySymbol) message = `YOU WIN! - WIN STREAK: ${this.winStreak}`;
        else if (match.winner) message = endingStreak > 0 ? `YOU LOSE! - STREAK ENDED AT ${endingStreak}` : "YOU LOSE!";
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
            if (isFreshResult && endingStreak > 0) {
                submitScoreWithCelebration(this.root, "tictactoe", endingStreak).then(({ submitted }) => {
                    if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
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
            if (leavingMatchId) await ArcadeSystem.leaveMatch("tictactoe", leavingMatchId);
            this.renderModeSelect();
        });
    },

    async handleOnlineCellClick(cell) {
        try {
            const match = await ArcadeSystem.makeMove("tictactoe", this.matchId, { cell });
            this.renderMatch(match);
        } catch (e) {
            await this.refreshMatch();
        }
    }
};
