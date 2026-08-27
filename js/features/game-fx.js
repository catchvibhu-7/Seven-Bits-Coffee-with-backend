/**
 * SEVEN BITS COFFEE - ARCADE SHARED FX
 * Location: /js/features/game-fx.js
 *
 * Things every single-player arcade game reuses:
 *  - runCountdown(): a 3-2-1-GO overlay before play actually starts, so a
 *    reflex game doesn't cost a life while the player is still finding the
 *    tab. It only delays the caller's own start function - state resets
 *    still happen immediately so the frozen board is visible underneath.
 *  - submitScoreWithCelebration(): the single place that decides whether a
 *    score is worth submitting (never 0 - a non-score shouldn't get a
 *    leaderboard row) and whether it beat the current #1 (in which case it
 *    fires confetti). Every game routes its game-over submission through
 *    this instead of calling ArcadeSystem.submitScore directly.
 *  - loadDifficulty()/saveDifficulty()/difficultySelectorHtml()/
 *    wireDifficultySelector(): an EASY/NORMAL/HARD control, persisted
 *    per-browser in localStorage, for the games where speed/gravity/etc.
 *    genuinely change the difficulty curve.
 */
import { ArcadeSystem } from "./arcade-logic.js";

export function runCountdown(root, onDone) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position:absolute; inset:0; z-index:30; display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,0.6); font-family:'Courier New',monospace; font-weight:bold;
        font-size:4rem; color:var(--color-accent);
    `;
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    root.appendChild(overlay);

    let n = 3;
    overlay.textContent = String(n);
    const step = () => {
        n--;
        if (n > 0) {
            overlay.textContent = String(n);
            setTimeout(step, 700);
        } else {
            overlay.textContent = "GO!";
            overlay.style.color = "var(--color-cyan)";
            setTimeout(() => {
                overlay.remove();
                onDone();
            }, 450);
        }
    };
    setTimeout(step, 700);
}

const CONFETTI_TOKENS = ["--color-accent", "--color-cyan", "#22c55e", "#a855f7", "#f9fafb"];

function resolveConfettiColor(token) {
    if (!token.startsWith("--")) return token;
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#d97706";
}

if (!document.getElementById("sb-confetti-keyframes")) {
    const style = document.createElement("style");
    style.id = "sb-confetti-keyframes";
    style.textContent = `
        @keyframes sb-confetti-fall {
            0% { transform: translate(0, 0) rotate(0deg); opacity: 0.9; }
            100% { transform: translate(var(--sb-drift), 360px) rotate(560deg); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

export function fireConfetti(root) {
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute; inset:0; z-index:40; overflow:hidden; pointer-events:none;";
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    root.appendChild(layer);

    const colors = CONFETTI_TOKENS.map(resolveConfettiColor);
    for (let i = 0; i < 60; i++) {
        const piece = document.createElement("div");
        const size = 5 + Math.random() * 5;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const left = Math.random() * 100;
        const delay = (Math.random() * 0.4).toFixed(2);
        const duration = (1.6 + Math.random()).toFixed(2);
        const rotation = Math.floor(Math.random() * 360);
        const drift = Math.round((Math.random() - 0.5) * 120);
        piece.style.cssText = `
            position:absolute; top:-10px; left:${left}%; width:${size}px; height:${size * (Math.random() > 0.5 ? 1 : 2.2)}px;
            background:${color}; opacity:0.9; transform:rotate(${rotation}deg); --sb-drift:${drift}px;
            animation: sb-confetti-fall ${duration}s ${delay}s ease-in forwards;
        `;
        layer.appendChild(piece);
    }
    setTimeout(() => layer.remove(), 3200);
}

const DIFFICULTIES = ["easy", "normal", "hard"];

export function loadDifficulty(storageKey) {
    try {
        const v = localStorage.getItem(storageKey);
        return DIFFICULTIES.includes(v) ? v : "normal";
    } catch (e) {
        return "normal";
    }
}

export function saveDifficulty(storageKey, value) {
    try {
        localStorage.setItem(storageKey, value);
    } catch (e) {
        // Private-browsing/storage-blocked - the buttons still work for this session.
    }
}

/** A row of EASY/NORMAL/HARD buttons. `idPrefix` must be unique per game
 *  (e.g. "snake-diff") since the caller wires click handlers by that id. */
export function difficultySelectorHtml(idPrefix, current) {
    return `
        <div style="display:flex; gap:6px; max-width:280px; margin:10px auto 0;">
            ${DIFFICULTIES.map((d) => {
                const active = d === current;
                return `<button type="button" id="${idPrefix}-${d}" class="admin-btn" style="flex:1; margin-right:0; ${active ? "background:var(--color-accent); color:var(--color-accent-contrast); border-color:var(--color-accent);" : ""}">${d.toUpperCase()}</button>`;
            }).join("")}
        </div>
    `;
}

/** Wires the buttons from difficultySelectorHtml(). onSelect is called with
 *  the chosen difficulty; the caller decides what that means (usually:
 *  persist it and restart the round with new parameters). */
export function wireDifficultySelector(root, idPrefix, onSelect) {
    DIFFICULTIES.forEach((d) => {
        root.querySelector(`#${idPrefix}-${d}`)?.addEventListener("click", () => onSelect(d));
    });
}

/** Re-highlights the active button in place - cheaper than re-rendering the
 *  whole selector, and it survives a startGame() that doesn't touch this
 *  part of the DOM. */
export function paintDifficultySelector(root, idPrefix, current) {
    DIFFICULTIES.forEach((d) => {
        const btn = root.querySelector(`#${idPrefix}-${d}`);
        if (!btn) return;
        const active = d === current;
        btn.style.background = active ? "var(--color-accent)" : "";
        btn.style.color = active ? "var(--color-accent-contrast)" : "";
        btn.style.borderColor = active ? "var(--color-accent)" : "";
    });
}

/** Submits a score only if it's > 0, comparing against the leaderboard's
 *  current #1 (fetched BEFORE submitting, so the just-submitted score can't
 *  skew its own comparison) to decide whether to celebrate. */
export async function submitScoreWithCelebration(root, game, score) {
    if (!score || score <= 0) return { submitted: false, newHighScore: false };
    let currentBest = 0;
    try {
        const scores = await ArcadeSystem.fetchScores(game);
        currentBest = scores.length ? scores[0].score : 0;
    } catch (e) {
        currentBest = 0;
    }
    const beatsBest = score > currentBest;
    const ok = await ArcadeSystem.submitScore(game, score);
    if (ok && beatsBest) fireConfetti(root);
    return { submitted: ok, newHighScore: ok && beatsBest };
}
