/**
 * SEVEN BITS COFFEE - ARCADE (GAMES tab) LOGIC
 * Location: /js/features/arcade-logic.js
 *
 * In-store only: access is unlocked for a limited window after placing an
 * order (server-enforced in arcadeAccessInfo(), server.js - config.arcade.
 * sessionHours, admin-editable). This module is a thin fetch wrapper; the
 * server is the source of truth for both access and match state.
 */
export const ArcadeSystem = {
    async checkAccess() {
        const res = await fetch("/api/arcade/access", { credentials: "include" });
        if (!res.ok) return { allowed: false, reason: "Sign in to use the arcade." };
        return res.json();
    },

    async fetchScores(game) {
        const res = await fetch(`/api/arcade/scores?game=${encodeURIComponent(game)}`, { credentials: "include" });
        return res.ok ? res.json() : [];
    },

    async submitScore(game, score) {
        const res = await fetch("/api/arcade/scores", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ game, score })
        });
        return res.ok;
    },

    async queueTicTacToe() {
        const res = await fetch("/api/arcade/tictactoe/queue", { method: "POST", credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not join the queue");
        return data;
    },

    async cancelQueue() {
        await fetch("/api/arcade/tictactoe/cancel", { method: "POST", credentials: "include" });
    },

    async fetchMatch(matchId) {
        const res = await fetch(`/api/arcade/tictactoe/${encodeURIComponent(matchId)}`, { credentials: "include" });
        if (!res.ok) return null;
        return res.json();
    },

    async makeMove(matchId, cell) {
        const res = await fetch(`/api/arcade/tictactoe/${encodeURIComponent(matchId)}/move`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cell })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invalid move");
        return data;
    },

    async leaveMatch(matchId) {
        await fetch(`/api/arcade/tictactoe/${encodeURIComponent(matchId)}/leave`, { method: "POST", credentials: "include" });
    }
};
