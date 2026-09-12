/**
 * SEVEN BITS COFFEE - WORDLE (arcade)
 * Location: /js/features/arcade/wordle-game.js
 *
 * Fully offline - no dictionary API, no daily-puzzle server call. The
 * answer AND the "is this even a word" guess check both come from the same
 * bundled common-word list below, rather than shipping a second, much
 * larger "valid guesses" dictionary just to reject gibberish - a
 * simplification worth making for a casual arcade round, not a strict
 * Wordle clone. A fresh random answer every round (PLAY AGAIN), not a
 * shared daily word, matching how every other arcade game here restarts.
 */
import { submitScoreWithCelebration } from "../game-fx.js";

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const KEYBOARD_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const STATUS_RANK = { correct: 3, present: 2, absent: 1 };
const STATUS_COLOR = { correct: "#22c55e", present: "#eab308", absent: "var(--color-border)" };

// prettier-ignore
const WORDS = [
    "ABOUT","ABOVE","ABUSE","ACTOR","ACUTE","ADMIT","ADOPT","ADULT","AFTER","AGAIN","AGENT","AGREE","AHEAD","ALARM","ALBUM",
    "ALERT","ALIEN","ALIGN","ALIKE","ALIVE","ALLOW","ALONE","ALONG","ALTER","AMONG","ANGER","ANGLE","ANGRY","APART","APPLE",
    "APPLY","ARENA","ARGUE","ARISE","ARRAY","ASIDE","ASSET","AUDIO","AUDIT","AVOID","AWAKE","AWARD","AWARE","BADLY","BAKER",
    "BASIC","BEACH","BEGAN","BEGIN","BEING","BELOW","BENCH","BIRTH","BLACK","BLAME","BLANK","BLAST","BLEND","BLESS","BLIND",
    "BLOCK","BLOOD","BOARD","BOAST","BONUS","BOOST","BOOTH","BOUND","BRAIN","BRAND","BRAVE","BREAD","BREAK","BREED","BRIEF",
    "BRING","BROAD","BROKE","BROWN","BUILD","BUILT","BUNCH","BURST","BUYER","CABLE","CANDY","CARGO","CARRY","CARVE","CATCH",
    "CAUSE","CHAIN","CHAIR","CHALK","CHAOS","CHARM","CHART","CHASE","CHEAP","CHECK","CHEST","CHIEF","CHILD","CHOSE","CIVIL",
    "CLAIM","CLASS","CLEAN","CLEAR","CLICK","CLIFF","CLIMB","CLOCK","CLOSE","CLOTH","CLOUD","COACH","COAST","COULD","COUNT",
    "COURT","COVER","CRAFT","CRANE","CRASH","CRAZY","CREAM","CRIME","CROSS","CROWD","CROWN","CRUDE","CURVE","CYCLE","DAILY","DANCE",
    "DEALT","DEATH","DEBUT","DELAY","DEPTH","DOING","DOUBT","DOZEN","DRAFT","DRAMA","DRANK","DRAWN","DREAM","DRESS","DRIED",
    "DRILL","DRINK","DRIVE","DROVE","DYING","EAGER","EARLY","EARTH","EIGHT","ELITE","EMPTY","ENEMY","ENJOY","ENTER","ENTRY",
    "EQUAL","ERROR","EVENT","EVERY","EXACT","EXIST","EXTRA","FAITH","FALSE","FAULT","FIBER","FIELD","FIFTH","FIFTY","FIGHT",
    "FINAL","FIRST","FIXED","FLAME","FLASH","FLEET","FLOOR","FLUID","FOCUS","FORCE","FORTH","FORTY","FORUM","FOUND","FRAME",
    "FRANK","FRESH","FRONT","FROST","FRUIT","FULLY","FUNNY","GHOST","GIANT","GIVEN","GLASS","GLOBE","GLORY","GOING","GRACE",
    "GRADE","GRAND","GRANT","GRASS","GREAT","GREEN","GREET","GRIEF","GROUP","GROWN","GUARD","GUESS","GUEST","GUIDE","HAPPY",
    "HARSH","HEART","HEAVY","HELLO","HENCE","HORSE","HOTEL","HOUSE","HUMAN","IDEAL","IMAGE","IMPLY","INDEX","INNER","INPUT",
    "ISSUE","JOINT","JUDGE","JUICE","JUMPY","KNIFE","KNOWN","LABEL","LARGE","LASER","LATER","LAUGH","LAYER","LEARN","LEASE",
    "LEAST","LEAVE","LEGAL","LEMON","LEVEL","LIGHT","LIMIT","LOCAL","LOOSE","LOWER","LOYAL","LUCKY","LUNCH","LYING","MAGIC",
    "MAJOR","MAKER","MARCH","MATCH","MAYBE","MAYOR","MEANT","MEDAL","MEDIA","MERGE","MERIT","METAL","MIGHT","MINOR","MINUS",
    "MODEL","MONTH","MORAL","MOTOR","MOUNT","MOUSE","MOUTH","MOVIE","MUSIC","NAKED","NEEDY","NERVE","NEVER","NEWLY","NIGHT",
    "NOBLE","NOISE","NORTH","NOTED","NOVEL","NURSE","OCCUR","OCEAN","OFFER","OFTEN","ORDER","OTHER","OUGHT","OUTER","OWNER",
    "PAINT","PANEL","PANIC","PAPER","PARTY","PATCH","PAUSE","PEACE","PHASE","PHONE","PHOTO","PIANO","PIECE","PILOT","PITCH",
    "PIZZA","PLACE","PLAIN","PLANE","PLANT","PLATE","POINT","POUND","POWER","PRESS","PRICE","PRIDE","PRIME","PRINT","PRIOR",
    "PRIZE","PROOF","PROUD","PROVE","QUEEN","QUERY","QUICK","QUIET","QUITE","QUOTE","RADIO","RAISE","RANGE","RAPID","RATIO",
    "REACH","READY","REALM","REBEL","REFER","RELAX","REPLY","RIDER","RIDGE","RIGHT","RIVAL","RIVER","ROBOT","ROMAN","ROUGH",
    "ROUND","ROUTE","ROYAL","RURAL","SAUCE","SCALE","SCARE","SCENE","SCOPE","SCORE","SENSE","SERVE","SEVEN","SHADE","SHAKE",
    "SHALL","SHAPE","SHARE","SHARP","SHEEP","SHEET","SHELF","SHELL","SHIFT","SHINE","SHIRT","SHOCK","SHOOT","SHORT","SHOWN",
    "SIGHT","SILLY","SINCE","SIXTH","SIXTY","SIZED","SKILL","SLATE","SLEEP","SLICE","SLIDE","SMALL","SMART","SMILE","SMOKE","SNAKE",
    "SOLID","SOLVE","SORRY","SOUND","SOUTH","SPACE","SPARE","SPEAK","SPEED","SPEND","SPENT","SPLIT","SPOKE","SPORT","STAFF",
    "STAGE","STAKE","STAND","START","STATE","STEAM","STEEL","STEEP","STEER","STERN","STICK","STILL","STOCK","STONE","STOOD",
    "STORE","STORM","STORY","STRIP","STUCK","STUDY","STUFF","STYLE","SUGAR","SUPER","SWEET","TABLE","TAKEN","TASTE","TAXES",
    "TEACH","THANK","THEFT","THEIR","THEME","THERE","THESE","THICK","THING","THINK","THIRD","THOSE","THREE","THREW","THROW",
    "TIGHT","TIMER","TITLE","TODAY","TOKEN","TOPIC","TOTAL","TOUCH","TOUGH","TOWER","TRACK","TRADE","TRAIL","TRAIN","TREAT",
    "TREND","TRIAL","TRIBE","TRICK","TRIED","TRUCK","TRULY","TRUNK","TRUST","TRUTH","TWICE","UNCLE","UNDER","UNDUE","UNION",
    "UNITY","UNTIL","UPPER","UPSET","URBAN","USAGE","USUAL","VALID","VALUE","VIDEO","VIRUS","VISIT","VITAL","VOCAL","VOICE",
    "WASTE","WATCH","WATER","WHEEL","WHERE","WHICH","WHILE","WHITE","WHOLE","WHOSE","WOMAN","WOMEN","WORLD","WORRY","WORSE",
    "WORST","WORTH","WOULD","WOUND","WRITE","WRONG","WROTE","YIELD","YOUNG","YOUTH"
];

function evaluateGuess(guess, answer) {
    const result = Array(WORD_LENGTH).fill("absent");
    const remaining = {};
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (guess[i] === answer[i]) {
            result[i] = "correct";
        } else {
            remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
        }
    }
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (result[i] === "correct") continue;
        const letter = guess[i];
        if (remaining[letter] > 0) {
            result[i] = "present";
            remaining[letter]--;
        }
    }
    return result;
}

export const WordleGame = {
    root: null,
    answer: "",
    guesses: null,
    results: null,
    current: "",
    keyStatus: null,
    gameOver: false,
    keyHandler: null,

    mount(root) {
        this.root = root;
        this.keyHandler = (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === "Enter" || e.key === "Backspace" || /^[a-zA-Z]$/.test(e.key)) e.preventDefault();
            this.handleKey(e.key);
        };
        document.addEventListener("keydown", this.keyHandler);
        this.startGame();
    },

    unmount() {
        if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler);
        this.keyHandler = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        this.answer = WORDS[Math.floor(Math.random() * WORDS.length)];
        this.guesses = [];
        this.results = [];
        this.current = "";
        this.keyStatus = {};
        this.gameOver = false;
        this.render();
    },

    handleKey(key) {
        if (this.gameOver) return;
        if (key === "Enter") return this.submitGuess();
        if (key === "Backspace") {
            this.current = this.current.slice(0, -1);
            return this.render();
        }
        if (/^[a-zA-Z]$/.test(key) && this.current.length < WORD_LENGTH) {
            this.current += key.toUpperCase();
            this.render();
        }
    },

    submitGuess() {
        if (this.current.length !== WORD_LENGTH) {
            return this.flashMessage("NOT ENOUGH LETTERS");
        }
        if (!WORDS.includes(this.current)) {
            return this.flashMessage("NOT IN WORD LIST");
        }
        const result = evaluateGuess(this.current, this.answer);
        this.guesses.push(this.current);
        this.results.push(result);
        this.current.split("").forEach((letter, i) => {
            const rank = STATUS_RANK[result[i]];
            if (!this.keyStatus[letter] || STATUS_RANK[this.keyStatus[letter]] < rank) {
                this.keyStatus[letter] = result[i];
            }
        });
        const won = result.every((r) => r === "correct");
        this.current = "";
        if (won || this.guesses.length >= MAX_GUESSES) {
            this.gameOver = true;
            return this.finishGame(won);
        }
        this.render();
    },

    /** Shows a message without consuming a guess (bad length / not a known
     *  word), then clears it after a beat - unless the round ended in the
     *  meantime, in which case the end-state message stays put. */
    flashMessage(text) {
        this.render(text);
        setTimeout(() => {
            if (!this.gameOver) this.render();
        }, 1000);
    },

    render(message = "") {
        const rowsHtml = Array.from({ length: MAX_GUESSES }, (_, r) => {
            const isCurrentRow = r === this.guesses.length;
            const letters = r < this.guesses.length ? this.guesses[r].split("") : isCurrentRow ? this.current.split("") : [];
            const statuses = r < this.guesses.length ? this.results[r] : [];
            const cellsHtml = Array.from({ length: WORD_LENGTH }, (_, c) => {
                const letter = letters[c] || "";
                const status = statuses[c];
                const bg = status ? STATUS_COLOR[status] : "transparent";
                const border = letter && !status ? "var(--color-text)" : "var(--color-border)";
                const color = status ? "#0a0a0a" : "var(--color-text)";
                return `<div style="aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:bold; background:${bg}; color:${color}; border:2px solid ${border}; border-radius:3px;">${letter}</div>`;
            }).join("");
            return `<div style="display:grid; grid-template-columns:repeat(${WORD_LENGTH},1fr); gap:6px;">${cellsHtml}</div>`;
        }).join("");

        const keyboardHtml = KEYBOARD_ROWS.map((row, i) => {
            const keysHtml = row
                .split("")
                .map((letter) => {
                    const status = this.keyStatus[letter];
                    const bg = status ? STATUS_COLOR[status] : "var(--color-surface)";
                    const color = status ? "#0a0a0a" : "var(--color-text)";
                    return `<button type="button" class="wordle-key" data-key="${letter}" style="flex:1; min-width:0; padding:12px 0; font-size:12px; font-weight:bold; background:${bg}; color:${color}; border:1px solid var(--color-border); border-radius:4px; cursor:pointer;">${letter}</button>`;
                })
                .join("");
            if (i === 2) {
                return `<div style="display:flex; gap:4px; margin-top:4px;">
                    <button type="button" class="wordle-key" data-key="Enter" style="flex:1.6; padding:12px 0; font-size:10px; font-weight:bold; background:var(--color-surface); color:var(--color-text); border:1px solid var(--color-border); border-radius:4px; cursor:pointer;">ENTER</button>
                    ${keysHtml}
                    <button type="button" class="wordle-key" data-key="Backspace" style="flex:1.6; padding:12px 0; font-size:14px; font-weight:bold; background:var(--color-surface); color:var(--color-text); border:1px solid var(--color-border); border-radius:4px; cursor:pointer;">&larr;</button>
                </div>`;
            }
            return `<div style="display:flex; gap:4px; margin-top:4px;">${keysHtml}</div>`;
        }).join("");

        this.root.innerHTML = `
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">GUESS: <strong style="color:var(--color-accent);">${this.guesses.length}</strong>/${MAX_GUESSES}</p>
            <div style="display:grid; gap:6px; max-width:280px; margin:0 auto;">${rowsHtml}</div>
            <p id="wordle-message" style="text-align:center; font-size:14px; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;">${message}</p>
            <div style="max-width:420px; margin:8px auto 0;">${keyboardHtml}</div>
            <div style="display:grid; gap:10px; max-width:200px; margin:14px auto 0;">
                <button id="wordle-again" class="admin-btn-primary" style="display:${this.gameOver ? "" : "none"};">PLAY AGAIN</button>
            </div>
        `;

        this.root.querySelectorAll(".wordle-key").forEach((btn) => {
            btn.addEventListener("click", () => this.handleKey(btn.dataset.key));
        });
        this.root.querySelector("#wordle-again")?.addEventListener("click", () => this.startGame());
    },

    async finishGame(won) {
        if (won) {
            const score = Math.max(100, (MAX_GUESSES + 1 - this.guesses.length) * 150);
            // Render first (full innerHTML rebuild), THEN submit/celebrate -
            // fireConfetti appends an overlay to this.root, and a later
            // render() would wipe it out (same ordering minesweeper-game.js
            // uses).
            this.render(`YOU WIN! - ${this.answer} - SCORE: ${score}`);
            const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "wordle", score);
            if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
            if (newHighScore) {
                const msgEl = this.root.querySelector("#wordle-message");
                if (msgEl) msgEl.textContent = `NEW HIGH SCORE! - ${this.answer} - SCORE: ${score}`;
            }
        } else {
            this.render(`OUT OF GUESSES - THE WORD WAS ${this.answer}`);
        }
    },

    onExit: () => {},
    onScoreSubmitted: null
};
