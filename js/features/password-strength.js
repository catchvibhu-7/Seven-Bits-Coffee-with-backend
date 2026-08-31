/**
 * SEVEN BITS COFFEE - PASSWORD STRENGTH METER
 * Location: /js/features/password-strength.js
 *
 * This is UX guidance only - the server enforces the actual minimum
 * standard (8+ chars, 3 of 4 character classes) independently in
 * server.js's passwordIssues(), so a tampered/bypassed client can't
 * weaken what's actually accepted.
 */
export function scorePassword(password) {
    const pw = String(password || "");
    if (!pw) return { score: 0, label: "", color: "#333" };

    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;

    const levels = [
        { max: 1, label: "WEAK", color: "#f87171" },
        { max: 2, label: "WEAK", color: "#f87171" },
        { max: 3, label: "FAIR", color: "#facc15" },
        { max: 4, label: "GOOD", color: "#4ade80" },
        { max: 5, label: "STRONG", color: "#22d3ee" }
    ];
    const level = levels.find((l) => score <= l.max) || levels[levels.length - 1];
    return { score, label: level.label, color: level.color };
}

/** Renders a small meter bar + label into the given container element. */
export function renderPasswordStrengthMeter(container, password) {
    const { score, label, color } = scorePassword(password);
    const pct = Math.min(100, (score / 5) * 100);

    container.innerHTML = password
        ? `
        <div style="margin: 6px 0 10px; font-family: 'Courier New', monospace;">
            <div style="height: 4px; background: #222; border-radius: 2px; overflow: hidden;">
                <div style="height: 100%; width: ${pct}%; background: ${color}; transition: width 0.2s;"></div>
            </div>
            <div style="font-size: 10px; color: ${color}; margin-top: 3px;">${label}</div>
        </div>
    `
        : "";
}
