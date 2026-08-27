/**
 * SEVEN BITS COFFEE - ORDER-READY SOUND
 * Location: /js/features/sound-logic.js
 *
 * A synthesized two-note chime (no external audio file to host/ship) that
 * plays for the customer/guest tracking their order when it flips to READY.
 * Browsers block audio until a real user gesture unlocks the page's
 * AudioContext, so unlock() is wired to the first click anywhere in
 * app.js - after that, later poll-triggered chimes (which have no gesture
 * of their own) can still play for the rest of the session.
 */
const MUTE_KEY = "sbc-order-sound-muted";
let audioCtx = null;

export const SoundSystem = {
    isMuted() {
        return localStorage.getItem(MUTE_KEY) === "1";
    },
    setMuted(muted) {
        localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    },
    unlock() {
        if (!audioCtx) {
            const AudioCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtor) return;
            audioCtx = new AudioCtor();
        }
        if (audioCtx.state === "suspended") audioCtx.resume();
    },
    playReadyChime() {
        if (this.isMuted() || !audioCtx) return;
        const now = audioCtx.currentTime;
        [880, 1175].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            const start = now + i * 0.15;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(start);
            osc.stop(start + 0.3);
        });
    }
};
