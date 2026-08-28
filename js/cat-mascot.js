/**
 * SEVEN BITS COFFEE - WALKING CAT MASCOT
 * Location: /js/cat-mascot.js
 *
 * A plain non-module script (not import/export based, no dependency on
 * app.js) - loaded directly via <script src> right after the
 * pixel-kitty-container markup in index.html, which it needs already
 * present in the DOM (getElementById('held-item') etc.) - always runs
 * synchronously as the parser reaches it, so no DOMContentLoaded wrapper
 * is needed.
 */
const itemClasses = [
    'icon-americano',
    'icon-matcha-drink',
    'icon-cookie',
    'icon-ice-cream',
    'icon-ice-latte',
    'icon-latte-svg'
];
const heldItem = document.getElementById('held-item');
const mover = document.querySelector('.kitty-mover');
const biped = document.querySelector('.kitty-biped');
const quad = document.querySelector('.kitty-quad');
const kittyStage = document.querySelector('.pixel-kitty-container');

function randomizeItem() {
    heldItem.classList.remove(...itemClasses);
    const randomClass = itemClasses[Math.floor(Math.random() * itemClasses.length)];
    heldItem.classList.add(randomClass);
}

randomizeItem(); // give the cat a random item immediately on page load

mover.addEventListener('animationiteration', (event) => {
    // .kitty-mover actually runs several looping animations (opacity
    // toggles, flip physics) that also fire 'animationiteration' -
    // only re-randomize on the one that represents a full walk cycle.
    if (event.animationName === 'move-and-tumble') {
        randomizeItem();
    }
});

// cat.css's move-and-tumble keyframes cover the walk-right leg
// (0%-35% of the loop) over a distance of (stage width - 50px) -
// see .kitty-mover's left:-70px -> left:calc(100% - 120px). With
// a single fixed 15s loop duration, that same 35%-of-15s time
// budget has to cover far more ground on a wide desktop hero
// than on a phone, so the cat visibly sprints on big screens.
// Scaling the loop duration by the stage's actual width keeps
// the walking speed - not the loop's wall-clock length -
// constant, so it reads as the same casual pace everywhere.
const CASUAL_WALK_PX_PER_SEC = 80;
const WALK_RIGHT_FRACTION = 0.35; // matches the 0%-35% keyframe span
const MIN_LOOP_SECONDS = 8; // guards against a near-zero duration on a tiny/hidden stage

function applyCasualWalkPace() {
    const stageWidth = kittyStage.getBoundingClientRect().width;
    if (!stageWidth) return; // page not visible right now (e.g. display:none) - keep the last-known pace
    const walkDistance = Math.max(stageWidth - 50, 50);
    const loopSeconds = Math.max(walkDistance / (CASUAL_WALK_PX_PER_SEC * WALK_RIGHT_FRACTION), MIN_LOOP_SECONDS);
    const loop = `${loopSeconds}s`;
    // Only move-and-tumble/toggle-*/item-fly (the loop-position and
    // sync animations) scale with the stage - walk-biped/walk-quad
    // (the 1.4s leg-frame cycle) stay fixed so the actual stride
    // cadence still looks like a normal walk, just covering more
    // steps over the now-longer loop instead of shuffling faster.
    mover.style.animationDuration = loop;
    heldItem.style.animationDuration = loop;
    biped.style.animationDuration = `1.4s, ${loop}`;
    quad.style.animationDuration = `1.4s, ${loop}`;
}

applyCasualWalkPace();
let resizePaceTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizePaceTimer);
    resizePaceTimer = setTimeout(applyCasualWalkPace, 200);
});
