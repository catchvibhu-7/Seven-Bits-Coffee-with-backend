/**
 * SEVEN BITS COFFEE - SPACE INVADERS (arcade)
 * Location: /js/features/arcade/invaders-game.js
 *
 * Wave-based - clearing a wave starts the next one (more/faster enemies,
 * busier fire) instead of ending the game, and lives refill to a fresh 3
 * each time so an earlier rough wave doesn't permanently cripple a later
 * one; only running out of lives mid-wave ends it. Lives left at the
 * moment a wave clears bank a score bonus first, so not getting hit stays
 * worth playing for even though the refill would otherwise make lives
 * feel disposable. Colors read live from the theme via themeColor()
 * (canvas can't resolve CSS vars itself): player ship = accent, enemies =
 * cyan; player/enemy bullets stay fixed (white/red) since they need to
 * read as distinctly "yours" vs "incoming" at a glance more than they
 * need to be on-brand.
 */
import { themeColor } from "../theme-colors.js";
import { runCountdown, submitScoreWithCelebration } from "../game-fx.js";

const WIDTH = 320;
const HEIGHT = 400;
const PLAYER_W = 30;
const PLAYER_H = 12;
const PLAYER_Y = HEIGHT - 30;
const BULLET_SPEED = 6;
const ENEMY_ROWS = 4;
const ENEMY_COLS = 8;
const ENEMY_W = 24;
const ENEMY_H = 16;
const ENEMY_GAP = 8;
const LIVES_BONUS_PER_LIFE = 100;
const ENEMY_TOP = 30;

export const InvadersGame = {
    root: null,
    canvas: null,
    ctx: null,
    playerX: 0,
    playerBullets: null,
    enemyBullets: null,
    enemies: null,
    enemyDir: 1,
    enemySpeed: 0.6,
    score: 0,
    lives: 3,
    level: 1,
    gameOver: false,
    ready: false,
    keys: null,
    touchLeft: false,
    touchRight: false,
    rafId: null,
    keyDownHandler: null,
    keyUpHandler: null,
    frame: 0,
    colors: null,

    mount(root) {
        this.root = root;
        this.root.innerHTML = `
            <p style="text-align:center; font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">LIVES: <strong id="inv-lives" style="color:var(--color-accent);">3</strong> &middot; WAVE: <strong id="inv-level" style="color:var(--color-accent);">1</strong></p>
            <div class="arcade-canvas-wrap">
                <canvas id="inv-canvas" width="${WIDTH}" height="${HEIGHT}" style="background:var(--color-bg); border:1px solid var(--color-border);"></canvas>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; max-width:240px; margin:10px auto 0;">
                <button id="inv-left" class="admin-btn">←</button>
                <button id="inv-fire" class="admin-btn-primary">FIRE</button>
                <button id="inv-right" class="admin-btn">→</button>
            </div>
            <p id="inv-message" style="text-align:center; font-size:17px; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;"></p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="inv-again" class="admin-btn-primary" style="display:none;">PLAY AGAIN</button>
            </div>
            <p style="text-align:center; font-size:10px; color:var(--color-text-muted); margin-top:8px;">Arrow keys to move, Space to fire.</p>
        `;
        this.canvas = this.root.querySelector("#inv-canvas");
        this.ctx = this.canvas.getContext("2d");
        this.colors = {
            bg: themeColor("--color-bg", "#0a0a0a"),
            player: themeColor("--color-accent", "#d97706"),
            enemy: themeColor("--color-cyan", "#22d3ee"),
            bullet: themeColor("--color-text", "#f9fafb"),
            enemyBullet: "#ef4444"
        };
        this.keys = {};
        this.keyDownHandler = (e) => {
            if (["ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
            this.keys[e.key] = true;
            if (e.key === " ") this.fire();
        };
        this.keyUpHandler = (e) => {
            this.keys[e.key] = false;
        };
        document.addEventListener("keydown", this.keyDownHandler);
        document.addEventListener("keyup", this.keyUpHandler);

        const leftBtn = this.root.querySelector("#inv-left");
        const rightBtn = this.root.querySelector("#inv-right");
        leftBtn.addEventListener("mousedown", () => (this.touchLeft = true));
        leftBtn.addEventListener("mouseup", () => (this.touchLeft = false));
        leftBtn.addEventListener("mouseleave", () => (this.touchLeft = false));
        leftBtn.addEventListener("touchstart", (e) => {
            e.preventDefault();
            this.touchLeft = true;
        });
        leftBtn.addEventListener("touchend", () => (this.touchLeft = false));
        rightBtn.addEventListener("mousedown", () => (this.touchRight = true));
        rightBtn.addEventListener("mouseup", () => (this.touchRight = false));
        rightBtn.addEventListener("mouseleave", () => (this.touchRight = false));
        rightBtn.addEventListener("touchstart", (e) => {
            e.preventDefault();
            this.touchRight = true;
        });
        rightBtn.addEventListener("touchend", () => (this.touchRight = false));
        this.root.querySelector("#inv-fire").addEventListener("click", () => this.fire());
        this.root.querySelector("#inv-again").addEventListener("click", () => this.startGame());

        this.startGame();
    },

    unmount() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        if (this.keyDownHandler) document.removeEventListener("keydown", this.keyDownHandler);
        if (this.keyUpHandler) document.removeEventListener("keyup", this.keyUpHandler);
        this.keyDownHandler = null;
        this.keyUpHandler = null;
    },

    exit() {
        this.unmount();
        this.onExit();
    },

    startGame() {
        this.playerX = WIDTH / 2 - PLAYER_W / 2;
        this.playerBullets = [];
        this.enemyBullets = [];
        this.frame = 0;
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.gameOver = false;
        this.ready = false;
        this.spawnWave();
        this.root.querySelector("#inv-message").textContent = "";
        this.root.querySelector("#inv-again").style.display = "none";
        this.updateHud();
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.draw();
        runCountdown(this.root, () => {
            this.ready = true;
            this.loop();
        });
    },

    /** Builds this.level's enemy formation - a fresh (denser/faster) wave
     *  on every call, so clearing one wave can roll straight into the next
     *  without resetting score/lives. */
    spawnWave() {
        this.enemies = [];
        for (let r = 0; r < ENEMY_ROWS; r++) {
            for (let c = 0; c < ENEMY_COLS; c++) {
                this.enemies.push({ x: 20 + c * (ENEMY_W + ENEMY_GAP), y: ENEMY_TOP + r * (ENEMY_H + ENEMY_GAP), alive: true });
            }
        }
        this.enemyDir = 1;
        this.enemySpeed = 0.6 + (this.level - 1) * 0.15;
    },

    /** Wave cleared with lives still in hand - advance instead of ending,
     *  same countdown-then-resume flow startGame() uses so the player gets
     *  a beat to reset before the faster wave starts moving. Lives refill
     *  to a full 3 for the new wave (so a rough earlier wave doesn't carry
     *  a permanent handicap into later, harder ones), but banking a bonus
     *  for whatever was left first is what makes NOT losing any worth
     *  playing for instead of just being free insurance. */
    nextLevel() {
        const livesBonus = this.lives * LIVES_BONUS_PER_LIFE;
        this.score += livesBonus;
        this.level++;
        this.lives = 3;
        this.playerBullets = [];
        this.enemyBullets = [];
        this.ready = false;
        this.spawnWave();
        this.updateHud();
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.draw();
        this.root.querySelector("#inv-message").textContent =
            livesBonus > 0 ? `WAVE ${this.level - 1} CLEARED! +${livesBonus} LIVES BONUS` : `WAVE ${this.level - 1} CLEARED!`;
        runCountdown(this.root, () => {
            this.root.querySelector("#inv-message").textContent = "";
            this.ready = true;
            this.loop();
        });
    },

    fire() {
        if (this.gameOver || !this.ready) return;
        if (this.playerBullets.length >= 3) return; // small rate limit
        this.playerBullets.push({ x: this.playerX + PLAYER_W / 2, y: PLAYER_Y });
    },

    loop() {
        if (this.gameOver || !this.ready) return;
        this.update();
        // update() can synchronously call nextLevel() (clears this.ready
        // and cancels rafId, expecting its own countdown to resume the
        // loop later) or endGame() (sets gameOver) - re-check before
        // scheduling another frame so this same call doesn't immediately
        // re-arm a loop that just deliberately stopped itself.
        if (this.gameOver || !this.ready) return;
        this.draw();
        this.rafId = requestAnimationFrame(() => this.loop());
    },

    update() {
        this.frame++;
        const speed = 4;
        if (this.keys.ArrowLeft || this.touchLeft) this.playerX -= speed;
        if (this.keys.ArrowRight || this.touchRight) this.playerX += speed;
        this.playerX = Math.max(0, Math.min(WIDTH - PLAYER_W, this.playerX));

        this.playerBullets.forEach((b) => (b.y -= BULLET_SPEED));
        this.playerBullets = this.playerBullets.filter((b) => b.y > -50);
        // Early waves are gentler to dodge - slower incoming bullets, ramping
        // up toward a cap as the level rises - rather than every wave firing
        // at the same speed the harder later waves need.
        const enemyBulletSpeed = Math.min(6, 2 + (this.level - 1) * 0.4);
        this.enemyBullets.forEach((b) => (b.y += enemyBulletSpeed));
        this.enemyBullets = this.enemyBullets.filter((b) => b.y < HEIGHT + 50);

        const aliveEnemies = this.enemies.filter((e) => e.alive);
        if (aliveEnemies.length === 0) {
            return this.nextLevel();
        }

        let hitEdge = false;
        for (const e of aliveEnemies) {
            e.x += this.enemyDir * this.enemySpeed;
            if (e.x <= 0 || e.x + ENEMY_W >= WIDTH) hitEdge = true;
        }
        if (hitEdge) {
            this.enemyDir *= -1;
            aliveEnemies.forEach((e) => (e.y += 10));
        }

        // Same easing as bullet speed above - early waves fire far less
        // often (a shot every ~85 frames at level 1) than the later, busier
        // ones (floored at every 30 frames so it never becomes unfair).
        const shotInterval = Math.max(30, 85 - (this.level - 1) * 8);
        if (this.frame % shotInterval === 0 && aliveEnemies.length > 0) {
            const shooter = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
            this.enemyBullets.push({ x: shooter.x + ENEMY_W / 2, y: shooter.y + ENEMY_H });
        }

        for (const bullet of this.playerBullets) {
            for (const e of aliveEnemies) {
                if (!e.alive) continue;
                if (bullet.x >= e.x && bullet.x <= e.x + ENEMY_W && bullet.y >= e.y && bullet.y <= e.y + ENEMY_H) {
                    e.alive = false;
                    bullet.y = -100; // mark consumed, filtered next tick
                    this.score += 10;
                    this.updateHud();
                }
            }
        }

        for (const bullet of this.enemyBullets) {
            if (bullet.x >= this.playerX && bullet.x <= this.playerX + PLAYER_W && bullet.y >= PLAYER_Y && bullet.y <= PLAYER_Y + PLAYER_H) {
                bullet.y = HEIGHT + 100;
                this.lives--;
                this.updateHud();
                if (this.lives <= 0) {
                    return this.endGame();
                }
            }
        }

        if (aliveEnemies.some((e) => e.y + ENEMY_H >= PLAYER_Y)) {
            return this.endGame();
        }
    },

    updateHud() {
        const scoreEl = document.getElementById("arcade-current-score");
        const livesEl = this.root.querySelector("#inv-lives");
        const levelEl = this.root.querySelector("#inv-level");
        if (scoreEl) scoreEl.textContent = this.score;
        if (livesEl) livesEl.textContent = this.lives;
        if (levelEl) levelEl.textContent = this.level;
    },

    draw() {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.fillStyle = this.colors.enemy;
        this.enemies.forEach((e) => {
            if (e.alive) ctx.fillRect(e.x, e.y, ENEMY_W, ENEMY_H);
        });

        ctx.fillStyle = this.colors.bullet;
        this.playerBullets.forEach((b) => ctx.fillRect(b.x - 1, b.y - 6, 2, 6));
        ctx.fillStyle = this.colors.enemyBullet;
        this.enemyBullets.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 6));

        ctx.fillStyle = this.colors.player;
        ctx.fillRect(this.playerX, PLAYER_Y, PLAYER_W, PLAYER_H);
    },

    async endGame() {
        this.gameOver = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const { submitted, newHighScore } = await submitScoreWithCelebration(this.root, "invaders", this.score);
        if (submitted && this.onScoreSubmitted) this.onScoreSubmitted();
        const base = `GAME OVER - WAVE ${this.level} - SCORE: ${this.score}`;
        this.root.querySelector("#inv-message").textContent = newHighScore ? `NEW HIGH SCORE! ${base}` : base;
        this.root.querySelector("#inv-again").style.display = "";
    },

    onExit: () => {},
    onScoreSubmitted: null
};
