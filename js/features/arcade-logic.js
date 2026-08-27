/**
 * SEVEN BITS COFFEE - ARCADE TAB LOGIC
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

    /** Generic across every online-match game (tictactoe, connectfour,
     *  checkers) - each shares the same queue/match/move/leave shape
     *  server-side, just under /api/arcade/<game>/... */
    async queueMatch(game) {
        const res = await fetch(`/api/arcade/${game}/queue`, { method: "POST", credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not join the queue");
        return data;
    },

    async cancelQueue(game) {
        await fetch(`/api/arcade/${game}/cancel`, { method: "POST", credentials: "include" });
    },

    async fetchMatch(game, matchId) {
        const res = await fetch(`/api/arcade/${game}/${encodeURIComponent(matchId)}`, { credentials: "include" });
        if (!res.ok) return null;
        return res.json();
    },

    async makeMove(game, matchId, movePayload) {
        const res = await fetch(`/api/arcade/${game}/${encodeURIComponent(matchId)}/move`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(movePayload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invalid move");
        return data;
    },

    async leaveMatch(game, matchId) {
        await fetch(`/api/arcade/${game}/${encodeURIComponent(matchId)}/leave`, { method: "POST", credentials: "include" });
    }
};
