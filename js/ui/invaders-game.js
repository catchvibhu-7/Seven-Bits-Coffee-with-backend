/**
 * SEVEN BITS COFFEE - SPACE INVADERS (arcade)
 * Location: /js/ui/invaders-game.js
 *
 * Single wave, 3 lives. Colors read live from the theme via themeColor()
 * (canvas can't resolve CSS vars itself): player ship = accent, enemies =
 * cyan; player/enemy bullets stay fixed (white/red) since they need to
 * read as distinctly "yours" vs "incoming" at a glance more than they
 * need to be on-brand.
 */
import { ArcadeSystem } from "../features/arcade-logic.js";
import { themeColor } from "../features/theme-colors.js";

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
    gameOver: false,
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
            <h3 style="text-align:center; margin-bottom:8px;">SPACE INVADERS</h3>
            <p style="text-align:center; font-size:9pt; color:var(--color-text-muted); margin-bottom:8px;">SCORE: <strong id="inv-score" style="color:var(--color-accent);">0</strong> &middot; LIVES: <strong id="inv-lives" style="color:var(--color-accent);">3</strong></p>
            <canvas id="inv-canvas" width="${WIDTH}" height="${HEIGHT}" style="display:block; margin:0 auto; background:var(--color-bg); border:1px solid var(--color-border); max-width:100%; height:auto;"></canvas>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; max-width:240px; margin:10px auto 0;">
                <button id="inv-left" class="admin-btn">←</button>
                <button id="inv-fire" class="admin-btn-primary">FIRE</button>
                <button id="inv-right" class="admin-btn">→</button>
            </div>
            <p id="inv-message" style="text-align:center; font-size:1.05rem; color:var(--color-danger); margin:14px 0 0; min-height:1.4em;"></p>
            <div style="display:grid; gap:10px; max-width:200px; margin:8px auto 0;">
                <button id="inv-again" class="admin-btn-primary" style="display:none;">PLAY AGAIN</button>
                <button id="inv-back" class="admin-btn">BACK</button>
            </div>
            <p style="text-align:center; font-size:7pt; color:var(--color-text-muted); margin-top:8px;">Arrow keys to move, Space to fire.</p>
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
        this.root.querySelector("#inv-back").addEventListener("click", () => this.exit());
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
        this.enemyDir = 1;
        this.enemySpeed = 0.6;
        this.frame = 0;
        this.score = 0;
        this.lives = 3;
        this.gameOver = false;
        this.enemies = [];
        for (let r = 0; r < ENEMY_ROWS; r++) {
            for (let c = 0; c < ENEMY_COLS; c++) {
                this.enemies.push({ x: 20 + c * (ENEMY_W + ENEMY_GAP), y: ENEMY_TOP + r * (ENEMY_H + ENEMY_GAP), alive: true });
            }
        }
        this.root.querySelector("#inv-message").textContent = "";
        this.root.querySelector("#inv-again").style.display = "none";
        this.updateHud();
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.loop();
    },

    fire() {
        if (this.gameOver) return;
        if (this.playerBullets.length >= 3) return; // small rate limit
        this.playerBullets.push({ x: this.playerX + PLAYER_W / 2, y: PLAYER_Y });
    },

    loop() {
        if (this.gameOver) return;
        this.update();
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
        this.enemyBullets.forEach((b) => (b.y += 4));
        this.enemyBullets = this.enemyBullets.filter((b) => b.y < HEIGHT + 50);

        const aliveEnemies = this.enemies.filter((e) => e.alive);
        if (aliveEnemies.length === 0) {
            return this.endGame(true);
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

        if (this.frame % 45 === 0 && aliveEnemies.length > 0) {
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
                    return this.endGame(false);
                }
            }
        }

        if (aliveEnemies.some((e) => e.y + ENEMY_H >= PLAYER_Y)) {
            return this.endGame(false);
        }
    },

    updateHud() {
        const scoreEl = this.root.querySelector("#inv-score");
        const livesEl = this.root.querySelector("#inv-lives");
        if (scoreEl) scoreEl.textContent = this.score;
        if (livesEl) livesEl.textContent = this.lives;
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

    async endGame(won) {
        this.gameOver = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        await ArcadeSystem.submitScore("invaders", this.score);
        if (this.onScoreSubmitted) this.onScoreSubmitted();
        this.root.querySelector("#inv-message").textContent = won ? `WAVE CLEARED! - SCORE: ${this.score}` : `GAME OVER - SCORE: ${this.score}`;
        this.root.querySelector("#inv-again").style.display = "";
    },

    onExit: () => {},
    onScoreSubmitted: null
};
