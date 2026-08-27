/**
 * SEVEN BITS COFFEE - BACKEND SERVER
 * Plain Node.js (no external dependencies) so it runs with just `node server.js`.
 *
 * Auth model:
 *   - Real accounts (username + hashed password) with a role: owner, admin,
 *     employee, or customer. Roles are stored in data/users.json now so
 *     switching this to a real database later just means swapping the
 *     readJson/writeJson calls near USERS_FILE - the rest of the app talks
 *     to "the user store" through a few functions, not raw file access.
 *   - Guests don't need an account: they give a phone number, get a session
 *     scoped to that phone, and can only ever see orders placed under that
 *     phone number - never anyone else's data.
 *   - Session cookies are httpOnly + random tokens, checked server-side on
 *     every protected request. The browser never holds a password or a
 *     forgeable "I'm an admin" flag.
 *
 * Page/route access:
 *   - Kitchen/orders board: employee, admin, owner
 *   - Admin panel (menu/config/staff): admin, owner
 *   - "My order" status: customer, guest (own orders only)
 *
 * Run:
 *   OWNER_USERNAME=owner OWNER_PASSWORD=yourStrongPassword node server.js
 * (see README-BACKEND.md for all options, and start.bat for a Windows helper)
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

// ---------------------------------------------------------------------------
// Config / paths
// ---------------------------------------------------------------------------

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const SEED_DIR = path.join(ROOT_DIR, "data-seed");
const PORT = parseInt(process.env.PORT || "3000", 10);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hour shift
const IS_HTTPS = process.env.FORCE_SECURE_COOKIE === "1";

const UPI_VPA = process.env.UPI_VPA || "";
const UPI_PAYEE_NAME = process.env.UPI_PAYEE_NAME || "";

const STAFF_ROLES = ["employee", "admin", "owner"];
const MENU_ADMIN_ROLES = ["admin", "owner"];
const KITCHEN_ROLES = ["employee", "admin", "owner"];
const TRACKING_ROLES = ["customer", "guest"];

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Tiny JSON file "database" helpers
// ---------------------------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  // Write to a temp file then rename, so a crash mid-write can't corrupt the file.
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const MENU_FILE = path.join(DATA_DIR, "menu.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const AUDIT_LOG_FILE = path.join(DATA_DIR, "audit-log.json");
const BRANDING_PROFILES_FILE = path.join(DATA_DIR, "branding-profiles.json");
const COUPONS_FILE = path.join(DATA_DIR, "coupons.json");

if (!fs.existsSync(AUDIT_LOG_FILE)) writeJson(AUDIT_LOG_FILE, []);
if (!fs.existsSync(BRANDING_PROFILES_FILE)) writeJson(BRANDING_PROFILES_FILE, {});

/**
 * Records sensitive admin actions (currently: password resets and staff
 * removal) so an owner can see what admins have been doing to other
 * accounts - the request that prompted this was explicitly "so admin can't
 * abuse it", so only the owner can read this log (see GET /api/audit-log).
 */
function logAuditEvent(actorSession, action, targetUser) {
  const log = readJson(AUDIT_LOG_FILE, []);
  log.push({
    timestamp: new Date().toISOString(),
    action,
    actorId: actorSession.userId,
    actorName: actorSession.name,
    actorRole: actorSession.role,
    targetId: targetUser ? targetUser.id : null,
    targetUsername: targetUser ? targetUser.username : null
  });
  // Keep this bounded - it's an audit trail, not an infinite log.
  writeJson(AUDIT_LOG_FILE, log.slice(-1000));
}

if (!fs.existsSync(MENU_FILE)) {
  const seed = readJson(path.join(SEED_DIR, "menu-seed.json"), { sections: [], items: [], inventory: {} });
  writeJson(MENU_FILE, seed);
}

if (!fs.existsSync(CONFIG_FILE)) {
  writeJson(CONFIG_FILE, {
    shopName: "SEVEN BITS COFFEE",
    currency: "\u20b9",
    cgstRate: 0.05,
    sgstRate: 0.05,
    serviceChargeRate: 0.02,
    tipEnabled: true,
    tipAmount: 7,
    // Seeded once from env vars if present, then fully admin-editable from
    // here on (Global Settings tab) - env vars are just a convenience for
    // first boot, not the source of truth after that.
    upiVpa: process.env.UPI_VPA || "",
    upiPayeeName: process.env.UPI_PAYEE_NAME || "",
    // Branding - drives CSS custom properties at runtime (see app.js
    // applyBranding()). Defaults match the original hardcoded theme, so
    // nothing changes visually until an admin edits these.
    theme: "dark",
    colors: {
      accent: "#d97706",
      background: "#0a0a0a",
      surface: "#111111",
      text: "#f9fafb",
      textMuted: "#888888",
      secondary: "#22d3ee"
    },
    heroImageUrl: "",
    logoUrl: "",
    // Admin-added icon options beyond the built-in set (see Branding tab).
    // Key -> image URL; menu items reference these by key just like the
    // built-in CSS icon names.
    customIcons: {},
    // Shown in the home page footer - admin-editable from the Branding tab.
    footer: {
      tagline: "",
      address: "",
      phone: "",
      email: "",
      hours: ""
    }
  });
}

const DEFAULT_BRANDING = {
  theme: "dark",
  colors: {
    accent: "#d97706",
    background: "#0a0a0a",
    surface: "#111111",
    text: "#f9fafb",
    textMuted: "#888888",
    secondary: "#22d3ee"
  },
  heroImageUrl: "",
  logoUrl: ""
};

if (!fs.existsSync(ORDERS_FILE)) {
  writeJson(ORDERS_FILE, []);
}

// ---------------------------------------------------------------------------
// User accounts (hashed passwords on disk, never plaintext)
// ---------------------------------------------------------------------------

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, hash) {
  const attempt = hashPassword(String(password || ""), salt);
  const a = Buffer.from(attempt, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Minimum password standard, checked server-side regardless of what the
 * client's strength meter shows (that meter is just UX guidance - this is
 * the actual enforced rule). Requires 8+ characters and at least 3 of the 4
 * character classes below.
 */
function passwordIssues(password) {
  const issues = [];
  const pw = String(password || "");
  if (pw.length < 8) issues.push("Password must be at least 8 characters");

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  const classCount = classes.filter((re) => re.test(pw)).length;
  if (classCount < 3) {
    issues.push("Password must include at least 3 of: lowercase, uppercase, numbers, symbols");
  }
  return issues;
}

function bootstrapOwnerAccount() {
  if (fs.existsSync(USERS_FILE)) return;

  const username = process.env.OWNER_USERNAME || "owner";
  // Falls back to the old ADMIN_PASSWORD env var so anyone upgrading from the
  // single-password build doesn't have to change their launch command too.
  let password = process.env.OWNER_PASSWORD || process.env.ADMIN_PASSWORD;
  let generated = false;

  if (!password) {
    password = crypto.randomBytes(6).toString("hex"); // 12-char random password
    generated = true;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const owner = {
    id: 1,
    username,
    salt,
    hash: hashPassword(password, salt),
    role: "owner",
    name: "Owner",
    phone: null,
    mustChangePassword: generated // force a password change if we had to generate one
  };
  writeJson(USERS_FILE, [owner]);

  if (generated) {
    console.log("=".repeat(60));
    console.log("No OWNER_PASSWORD was set - generated one for you:");
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
    console.log("Save this now. Set OWNER_USERNAME / OWNER_PASSWORD env vars");
    console.log("yourself to avoid this message on future first-runs.");
    console.log("=".repeat(60));
  }
}

bootstrapOwnerAccount();

function findUserByUsername(username) {
  const users = readJson(USERS_FILE, []);
  return users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
}

function findUserById(id) {
  const users = readJson(USERS_FILE, []);
  return users.find((u) => u.id === id);
}

function createUser({ username, password, role, name, phone, mustChangePassword = false }) {
  const users = readJson(USERS_FILE, []);
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("That username is already taken");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const nextId = users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1;
  const user = {
    id: nextId,
    username,
    salt,
    hash: hashPassword(password, salt),
    role,
    name: name || username,
    phone: phone || null,
    mustChangePassword
  };
  users.push(user);
  writeJson(USERS_FILE, users);
  usernameBloomFilter.add(username);
  return user;
}

function publicUser(user) {
  if (!user) return null;
  const { salt, hash, ...rest } = user;
  return rest;
}

/** Generates a random, readable temp password like "bx7k-qm2v" (meets the strength rule). */
function generateTempPassword() {
  const part = () => crypto.randomBytes(3).toString("hex");
  return `${part()}-${part()}A9`; // guarantees a digit+letter mix so it always passes passwordIssues()
}

function setUserPassword(userId, newPassword, { mustChangePassword = false } = {}) {
  const users = readJson(USERS_FILE, []);
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  const salt = crypto.randomBytes(16).toString("hex");
  user.salt = salt;
  user.hash = hashPassword(newPassword, salt);
  user.mustChangePassword = mustChangePassword;
  writeJson(USERS_FILE, users);
  invalidateSessionsForUser(userId); // old password, old sessions - both stop working together
  return user;
}

// ---------------------------------------------------------------------------
// Username availability check, backed by a Bloom filter
//
// A Bloom filter answers "is this definitely NOT in the set?" extremely
// cheaply - if it says no, we can skip hitting the user store entirely. If
// it says "maybe" (which includes false positives), we fall back to an
// actual lookup to get a definite answer. For this app's realistic user
// count a plain lookup would honestly be fast enough on its own - this is
// included because it was asked for, and it's a genuinely useful pattern
// once a user store gets large enough that a lookup-per-keystroke matters.
// ---------------------------------------------------------------------------

class BloomFilter {
  constructor(size = 8192, hashCount = 4) {
    this.size = size;
    this.hashCount = hashCount;
    this.bits = new Uint8Array(size);
  }

  _positions(value) {
    const str = String(value).toLowerCase();
    // Two independent-ish hashes combined (Kirsch-Mitzenmacher technique) to
    // cheaply derive `hashCount` bit positions from one pass over the string.
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      h1 = (h1 * 33 + code) >>> 0;
      h2 = (h2 * 31 + code) >>> 0;
    }
    const positions = [];
    for (let i = 0; i < this.hashCount; i++) {
      positions.push((h1 + i * h2) % this.size);
    }
    return positions;
  }

  add(value) {
    this._positions(value).forEach((pos) => {
      this.bits[pos] = 1;
    });
  }

  /** False means "definitely not present". True means "maybe" - verify with a real lookup. */
  mightContain(value) {
    return this._positions(value).every((pos) => this.bits[pos] === 1);
  }
}

const usernameBloomFilter = new BloomFilter();
readJson(USERS_FILE, []).forEach((u) => usernameBloomFilter.add(u.username));

// ---------------------------------------------------------------------------
// Sessions (in-memory) + auth rate limiting
// ---------------------------------------------------------------------------

const sessions = new Map(); // token -> { expiresAt, role, userId, name, phone }
const authAttempts = new Map(); // ip -> { count, lockUntil }

function createSession(payload) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { ...payload, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

/** Invalidates every active session for a user (e.g. after a password reset/change). */
function invalidateSessionsForUser(userId) {
  for (const [token, s] of sessions.entries()) {
    if (s.userId === userId) sessions.delete(token);
  }
}

function checkRateLimit(ip) {
  const entry = authAttempts.get(ip);
  if (!entry) return { allowed: true };
  if (entry.lockUntil && Date.now() < entry.lockUntil) {
    return { allowed: false, retryAfterMs: entry.lockUntil - Date.now() };
  }
  return { allowed: true };
}

function recordAuthFailure(ip) {
  const entry = authAttempts.get(ip) || { count: 0, lockUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockUntil = Date.now() + 60 * 1000; // 60s lockout after 5 failures
    entry.count = 0;
  }
  authAttempts.set(ip, entry);
}

function recordAuthSuccess(ip) {
  authAttempts.delete(ip);
}

// ---------------------------------------------------------------------------
// SSE (Server-Sent Events) so kitchen/admin/status screens update live
// ---------------------------------------------------------------------------

const sseClients = new Set();

function broadcastOrdersChanged() {
  for (const res of sseClients) {
    res.write("event: orders\ndata: changed\n\n");
  }
}

// ---------------------------------------------------------------------------
// Small HTTP helpers
// ---------------------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function setSessionCookie(res, token) {
  const parts = [
    `sb_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (IS_HTTPS) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sb_session=; Path=/; HttpOnly; Max-Age=0");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Returns the session for this request, or null. Never sends a response. */
function currentSession(req) {
  const cookies = parseCookies(req);
  return getSession(cookies.sb_session);
}

/** Requires ANY valid session (any role). Sends 401 and returns null if absent. */
function requireSession(req, res) {
  const session = currentSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Not authenticated" });
    return null;
  }
  return session;
}

/** Requires a session whose role is in allowedRoles. Sends 401/403 as appropriate. */
function requireRole(req, res, allowedRoles) {
  const session = currentSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Not authenticated" });
    return null;
  }
  if (!allowedRoles.includes(session.role)) {
    sendJson(res, 403, { error: "Not allowed for this account type" });
    return null;
  }
  return session;
}

function getClientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

// ---------------------------------------------------------------------------
// Business logic: menu station mapping + order pricing (server-authoritative)
// ---------------------------------------------------------------------------

function getStation(item) {
  if (item.section === "sweets") return "DESSERTS";
  if (["fast-sellers", "limited", "classics"].includes(item.section)) return "BARISTA";
  return "KITCHEN";
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Validates a menu item's promo-discount payload, returning null for "no
// promo" (including invalid input, so a bad request just drops the promo
// rather than saving garbage). percent is capped at 100; flat just needs to
// be a positive rupee amount - computeOrder() clamps the resulting price to
// a floor of 0 regardless.
function sanitizePromoDiscount(input) {
  if (!input) return null;
  const type = input.type === "flat" ? "flat" : input.type === "percent" ? "percent" : null;
  const value = Number(input.value);
  if (!type || !Number.isFinite(value) || value <= 0) return null;
  if (type === "percent" && value > 100) return null;
  return { type, value };
}

// A menu item "on promotion" auto-applies its discount to every line for
// that item - no coupon code needed. (This codebase has no coupon system to
// be mutually exclusive with; if one is added later, block coupon
// application whenever any cart line carries a promoDiscount.)
function promoUnitPrice(product) {
  const promo = product.promoDiscount;
  if (!promo) return product.price;
  const discounted = promo.type === "percent" ? product.price * (1 - promo.value / 100) : product.price - promo.value;
  return round2(Math.max(0, discounted));
}

// Coupons are order-wide (applied to the subtotal) and mutually exclusive
// with per-item promos - a cart with any promo-discounted line can't also
// redeem a coupon code, so the two discount mechanisms never stack.
function findValidCoupon(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!normalized) return null;
  const coupon = readJson(COUPONS_FILE, []).find((c) => c.code === normalized);
  if (!coupon) return null;
  if (!coupon.active) return null;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return null;
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) return null;
  return coupon;
}

function computeCouponDiscount(coupon, subtotal) {
  const raw = coupon.type === "percent" ? subtotal * (coupon.value / 100) : coupon.value;
  return round2(Math.max(0, Math.min(subtotal, raw)));
}

function sanitizeCouponInput(body, existingCoupons, ignoreId = null) {
  const code = String(body.code || "").trim().toUpperCase();
  const type = body.type === "flat" ? "flat" : body.type === "percent" ? "percent" : null;
  const value = Number(body.value);
  if (!code) return { error: "Code is required" };
  if (existingCoupons.some((c) => c.code === code && c.id !== ignoreId)) return { error: "That code is already in use" };
  if (!type || !Number.isFinite(value) || value <= 0) return { error: "Enter a valid discount type and value" };
  if (type === "percent" && value > 100) return { error: "Percent discount can't exceed 100" };
  let maxUses = null;
  if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== "") {
    maxUses = parseInt(body.maxUses, 10);
    if (!Number.isFinite(maxUses) || maxUses <= 0) return { error: "Max uses must be a positive number" };
  }
  let expiresAt = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) return { error: "Invalid expiry date" };
    expiresAt = d.toISOString();
  }
  return { value: { code, type, value, private: !!body.private, maxUses, expiresAt } };
}

// Customer/staff-facing display number, separate from `id` (the internal
// primary key). Format: SB + YYMMDD + a 2-digit per-day counter that resets
// at midnight because it's derived from today's date prefix, e.g. SB26082401,
// SB26082402. Safe without locking: server.js handles one request at a time
// and this runs synchronously between the readJson/writeJson in the order
// creation route, so two orders can never see the same existing count.
function generateOrderNumber(existingOrders) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePrefix = `SB${yy}${mm}${dd}`;
  const todayCount = existingOrders.filter((o) => o.orderNumber && o.orderNumber.startsWith(datePrefix)).length;
  return `${datePrefix}${String(todayCount + 1).padStart(2, "0")}`;
}

function computeOrder(items, method, serviceChargeActive, tipApplied, couponCode) {
  const menu = readJson(MENU_FILE, { items: [] });
  const config = readJson(CONFIG_FILE, {});

  const resolvedItems = [];
  for (const requested of items) {
    const id = Number(requested.id);
    const quantity = Math.max(1, Math.min(50, parseInt(requested.quantity, 10) || 0));
    if (!quantity) continue;
    const product = menu.items.find((i) => i.id === id);
    if (!product) continue; // ignore unknown items rather than trusting the client
    resolvedItems.push({
      id: product.id,
      name: product.name,
      price: promoUnitPrice(product), // authoritative price from server menu (promo applied), never from client
      originalPrice: product.price,
      promoDiscount: product.promoDiscount || null,
      quantity,
      station: getStation(product),
      isDone: false
    });
  }

  if (resolvedItems.length === 0) {
    throw new Error("No valid items in order");
  }

  const subtotal = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const promoDiscountTotal = resolvedItems.reduce((sum, i) => sum + (i.originalPrice - i.price) * i.quantity, 0);

  const hasPromoItem = resolvedItems.some((i) => i.promoDiscount);
  let coupon = null;
  if (couponCode) {
    if (hasPromoItem) {
      throw new Error("Coupon codes can't be combined with promotional items in your cart");
    }
    coupon = findValidCoupon(couponCode);
    if (!coupon) {
      throw new Error("Invalid, expired, or exhausted coupon code");
    }
  }
  const couponDiscount = coupon ? computeCouponDiscount(coupon, subtotal) : 0;
  const taxableAmount = subtotal - couponDiscount;

  const cgst = taxableAmount * (config.cgstRate ?? 0.05);
  const sgst = taxableAmount * (config.sgstRate ?? 0.05);
  const serviceCharge = serviceChargeActive ? taxableAmount * (config.serviceChargeRate ?? 0.02) : 0;
  const tipAmount = config.tipEnabled && tipApplied ? config.tipAmount || 0 : 0;
  const total = taxableAmount + cgst + sgst + serviceCharge + tipAmount;

  let paymentQrUrl = null;
  const upiVpa = config.upiVpa || UPI_VPA; // config is the source of truth; env only matters before first save
  const upiPayeeName = config.upiPayeeName || UPI_PAYEE_NAME;
  if (method === "ONLINE" && upiVpa) {
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(upiPayeeName || config.shopName || "Store")}&am=${round2(total).toFixed(2)}&cu=INR`;
    paymentQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiUrl)}`;
  }

  return {
    items: resolvedItems,
    subtotal: round2(subtotal),
    promoDiscountTotal: round2(promoDiscountTotal),
    couponCode: coupon ? coupon.code : null,
    couponId: coupon ? coupon.id : null,
    couponDiscount: round2(couponDiscount),
    cgst: round2(cgst),
    sgst: round2(sgst),
    serviceCharge: round2(serviceCharge),
    tipAmount: round2(tipAmount),
    total: round2(total),
    paymentQrUrl
  };
}

function orderStatusOf(order) {
  if (!order.items.length) return "RECEIVED";
  return order.items.every((i) => i.isDone) ? "READY" : "PREPARING";
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(pathname);
    if (m) return { handler: r.handler, params: m.groups || {} };
  }
  return null;
}

// --- Auth ---
route("POST", /^\/api\/auth\/register\/?$/, async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` });
  }

  const body = await readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const phone = normalizePhone(body.phone);

  if (username.length < 3) return sendJson(res, 400, { error: "Username must be at least 3 characters" });
  const pwIssues = passwordIssues(password);
  if (pwIssues.length) return sendJson(res, 400, { error: pwIssues[0] });
  if (!phone) return sendJson(res, 400, { error: "A valid phone number is required" });

  try {
    // Public sign-up can only ever create a customer account - staff accounts
    // are created by an admin/owner from the Admin panel (see /api/users),
    // never self-assigned.
    const user = createUser({ username, password, role: "customer", name, phone });
    recordAuthSuccess(ip);
    const token = createSession({ role: "customer", userId: user.id, name: user.name, phone: user.phone });
    setSessionCookie(res, token);
    sendJson(res, 201, { role: "customer", name: user.name, phone: user.phone });
  } catch (e) {
    recordAuthFailure(ip);
    sendJson(res, 400, { error: e.message });
  }
});

route("POST", /^\/api\/auth\/login\/?$/, async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` });
  }

  const body = await readBody(req);
  const user = findUserByUsername(body.username);

  if (!user || !verifyPassword(body.password, user.salt, user.hash)) {
    recordAuthFailure(ip);
    return sendJson(res, 401, { error: "Invalid username or password" });
  }

  recordAuthSuccess(ip);
  const token = createSession({ role: user.role, userId: user.id, name: user.name, phone: user.phone });
  setSessionCookie(res, token);
  sendJson(res, 200, { role: user.role, name: user.name, phone: user.phone, mustChangePassword: !!user.mustChangePassword });
});

route("GET", /^\/api\/auth\/check-username\/?$/, async (req, res, params, url) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` });
  }

  const username = (url.searchParams.get("username") || "").trim();
  if (username.length < 3) return sendJson(res, 200, { available: false, reason: "too short" });

  // Bloom filter first: if it says "definitely not present", we know for
  // certain the username is available without touching the user store.
  if (!usernameBloomFilter.mightContain(username)) {
    return sendJson(res, 200, { available: true });
  }
  // Otherwise it's a "maybe" (could be a false positive) - confirm for real.
  const taken = !!findUserByUsername(username);
  sendJson(res, 200, { available: !taken });
});

route("POST", /^\/api\/auth\/change-password\/?$/, async (req, res) => {
  const session = requireSession(req, res);
  if (!session || session.userId == null) {
    if (session) sendJson(res, 400, { error: "Guest sessions have no password to change" });
    return;
  }

  const body = await readBody(req);
  const user = findUserById(session.userId);
  if (!user || !verifyPassword(body.currentPassword, user.salt, user.hash)) {
    return sendJson(res, 401, { error: "Current password is incorrect" });
  }

  const pwIssues = passwordIssues(body.newPassword);
  if (pwIssues.length) return sendJson(res, 400, { error: pwIssues[0] });

  setUserPassword(user.id, body.newPassword, { mustChangePassword: false });
  clearSessionCookie(res);
  const token = createSession({ role: user.role, userId: user.id, name: user.name, phone: user.phone });
  setSessionCookie(res, token);
  sendJson(res, 200, { ok: true });
});

route("POST", /^\/api\/auth\/forgot-password\/?$/, async (req, res) => {
  // Customer self-service reset: proving you know the account's username AND
  // its phone number is treated as proof of ownership (there's no email/SMS
  // gateway configured to do a "real" verification link/OTP). This mirrors
  // the same trust model guest order-tracking already uses. Staff accounts
  // don't get self-service reset - an owner/admin issues them a temp
  // password instead (see POST /api/users/:id/reset-password).
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` });
  }

  const body = await readBody(req);
  const user = findUserByUsername(body.username);
  const phone = normalizePhone(body.phone);

  if (!user || user.role !== "customer" || !phone || user.phone !== phone) {
    recordAuthFailure(ip);
    // Deliberately vague - doesn't reveal whether the username exists.
    return sendJson(res, 400, { error: "Username and phone number don't match a customer account" });
  }

  const pwIssues = passwordIssues(body.newPassword);
  if (pwIssues.length) return sendJson(res, 400, { error: pwIssues[0] });

  recordAuthSuccess(ip);
  setUserPassword(user.id, body.newPassword, { mustChangePassword: false });
  sendJson(res, 200, { ok: true });
});

route("POST", /^\/api\/auth\/guest\/?$/, async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` });
  }

  const body = await readBody(req);
  const phone = normalizePhone(body.phone);
  if (!phone) {
    recordAuthFailure(ip);
    return sendJson(res, 400, { error: "Enter a valid phone number" });
  }

  recordAuthSuccess(ip);
  const token = createSession({ role: "guest", userId: null, name: "Guest", phone });
  setSessionCookie(res, token);
  sendJson(res, 200, { role: "guest", name: "Guest", phone });
});

route("POST", /^\/api\/auth\/logout\/?$/, async (req, res) => {
  const cookies = parseCookies(req);
  destroySession(cookies.sb_session);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

route("GET", /^\/api\/auth\/session\/?$/, async (req, res) => {
  const session = currentSession(req);
  if (!session) return sendJson(res, 200, { authenticated: false });
  const user = session.userId != null ? findUserById(session.userId) : null;
  sendJson(res, 200, {
    authenticated: true,
    role: session.role,
    name: session.name,
    phone: session.phone,
    userId: session.userId,
    mustChangePassword: !!(user && user.mustChangePassword)
  });
});

// --- Staff accounts (created by admin/owner only - no public sign-up for these roles) ---
route("GET", /^\/api\/users\/?$/, async (req, res) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const users = readJson(USERS_FILE, []).filter((u) => STAFF_ROLES.includes(u.role));
  sendJson(res, 200, users.map(publicUser));
});

route("POST", /^\/api\/users\/?$/, async (req, res) => {
  const session = requireRole(req, res, MENU_ADMIN_ROLES);
  if (!session) return;

  const body = await readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const role = String(body.role || "");

  if (username.length < 3) return sendJson(res, 400, { error: "Username must be at least 3 characters" });
  const pwIssues = passwordIssues(password);
  if (pwIssues.length) return sendJson(res, 400, { error: pwIssues[0] });

  // An admin can only create employees. Only the owner can create admins or
  // other owners - this stops an admin account from elevating itself/others.
  const allowedToCreate = session.role === "owner" ? ["employee", "admin", "owner"] : ["employee"];
  if (!allowedToCreate.includes(role)) {
    return sendJson(res, 403, { error: `Your account can't create a "${role}" account` });
  }

  try {
    // Staff accounts start with mustChangePassword so the temp password an
    // admin hands over only works once before the new hire sets their own.
    const user = createUser({ username, password, role, name, mustChangePassword: true });
    sendJson(res, 201, publicUser(user));
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

function canManageTarget(session, targetUser) {
  if (!targetUser) return false;
  if (session.role === "owner") return true;
  if (session.role === "admin") return targetUser.role === "employee";
  return false;
}

route("POST", /^\/api\/users\/(?<id>\d+)\/reset-password\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MENU_ADMIN_ROLES);
  if (!session) return;

  const targetUser = findUserById(Number(params.id));
  if (targetUser && targetUser.id === session.userId) {
    // Resetting your own password here would invalidate your own session
    // mid-action and hand you a temp password you'd have to dig out of the
    // response - use POST /api/auth/change-password for your own account.
    return sendJson(res, 400, { error: "Use your account settings to change your own password" });
  }
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't reset that person's password" });
  }

  const tempPassword = generateTempPassword();
  setUserPassword(targetUser.id, tempPassword, { mustChangePassword: true });
  logAuditEvent(session, "reset_password", targetUser);
  // The plaintext temp password is returned exactly once, here, for the
  // admin to hand to the staff member - it's never stored or logged anywhere.
  sendJson(res, 200, { tempPassword });
});

route("DELETE", /^\/api\/users\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MENU_ADMIN_ROLES);
  if (!session) return;

  const targetUser = findUserById(Number(params.id));
  if (targetUser && targetUser.id === session.userId) {
    return sendJson(res, 400, { error: "You can't remove your own account" });
  }
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't remove that person" });
  }

  const users = readJson(USERS_FILE, []).filter((u) => u.id !== targetUser.id);
  writeJson(USERS_FILE, users);
  invalidateSessionsForUser(targetUser.id);
  logAuditEvent(session, "remove_account", targetUser);
  sendJson(res, 200, { ok: true });
});

route("GET", /^\/api\/audit-log\/?$/, async (req, res) => {
  // Owner-only, intentionally - this exists specifically so an owner can
  // see what admins have been doing to other accounts (password resets,
  // removals). An admin being able to read/clear their own trail would
  // defeat the point.
  if (!requireRole(req, res, ["owner"])) return;
  const log = readJson(AUDIT_LOG_FILE, []).slice().reverse();
  sendJson(res, 200, log);
});

// --- Menu ---
route("GET", /^\/api\/menu\/?$/, async (req, res) => {
  sendJson(res, 200, readJson(MENU_FILE, { sections: [], items: [] }));
});

route("POST", /^\/api\/menu\/?$/, async (req, res) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const name = String(body.name || "").trim();
  const price = Number(body.price);
  const section = String(body.section || "").trim();

  if (!name || !section || !Number.isFinite(price) || price <= 0) {
    return sendJson(res, 400, { error: "name, section and a positive price are required" });
  }
  if (!menu.sections.some((s) => s.id === section)) {
    return sendJson(res, 400, { error: "Unknown section" });
  }
  if (body.promoDiscount && !sanitizePromoDiscount(body.promoDiscount)) {
    return sendJson(res, 400, { error: "Invalid promo discount" });
  }

  const nextId = menu.items.length ? Math.max(...menu.items.map((i) => i.id)) + 1 : 1;
  const item = {
    id: nextId,
    section,
    name,
    price,
    icon: body.icon || "espresso",
    story: body.story || "",
    promoDiscount: sanitizePromoDiscount(body.promoDiscount)
  };
  menu.items.push(item);
  writeJson(MENU_FILE, menu);
  sendJson(res, 201, item);
});

route("PATCH", /^\/api\/menu\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const item = menu.items.find((i) => i.id === Number(params.id));
  if (!item) return sendJson(res, 404, { error: "Item not found" });

  if (body.name !== undefined) item.name = String(body.name).trim();
  if (body.story !== undefined) item.story = String(body.story);
  if (body.icon !== undefined) item.icon = String(body.icon);
  if (body.section !== undefined) {
    if (!menu.sections.some((s) => s.id === body.section)) {
      return sendJson(res, 400, { error: "Unknown section" });
    }
    item.section = body.section;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) return sendJson(res, 400, { error: "Invalid price" });
    item.price = price;
  }
  if (body.promoDiscount !== undefined) {
    if (body.promoDiscount === null) {
      item.promoDiscount = null;
    } else {
      const sanitized = sanitizePromoDiscount(body.promoDiscount);
      if (!sanitized) return sendJson(res, 400, { error: "Invalid promo discount" });
      item.promoDiscount = sanitized;
    }
  }
  writeJson(MENU_FILE, menu);
  sendJson(res, 200, item);
});

route("DELETE", /^\/api\/menu\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const idx = menu.items.findIndex((i) => i.id === Number(params.id));
  if (idx === -1) return sendJson(res, 404, { error: "Item not found" });
  menu.items.splice(idx, 1);
  writeJson(MENU_FILE, menu);
  sendJson(res, 200, { ok: true });
});

// --- Config ---
route("GET", /^\/api\/config\/?$/, async (req, res) => {
  sendJson(res, 200, readJson(CONFIG_FILE, {}));
});

route("PATCH", /^\/api\/config\/?$/, async (req, res) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const body = await readBody(req);
  const config = readJson(CONFIG_FILE, {});
  const allowed = [
    "shopName",
    "tipEnabled",
    "tipAmount",
    "cgstRate",
    "sgstRate",
    "serviceChargeRate",
    "currency",
    "theme",
    "heroImageUrl",
    "logoUrl",
    "upiVpa",
    "upiPayeeName"
  ];
  for (const key of allowed) {
    if (body[key] !== undefined) config[key] = body[key];
  }
  // Colors, footer, and customIcons are objects - merge individual keys
  // instead of replacing the whole thing, so a partial update (e.g. just
  // "accent", or just one new icon) doesn't wipe out the rest.
  if (body.colors && typeof body.colors === "object") {
    config.colors = { ...config.colors, ...body.colors };
  }
  if (body.footer && typeof body.footer === "object") {
    config.footer = { ...config.footer, ...body.footer };
  }
  if (body.customIcons && typeof body.customIcons === "object") {
    config.customIcons = { ...config.customIcons, ...body.customIcons };
  }
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, config);
});

route("DELETE", /^\/api\/config\/custom-icons\/(?<key>[\w-]+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const config = readJson(CONFIG_FILE, {});
  if (config.customIcons) delete config.customIcons[params.key];
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, config);
});

route("POST", /^\/api\/config\/reset-branding\/?$/, async (req, res) => {
  // Resets ONLY the visual branding fields back to the original hardcoded
  // look - shop name, tax rates, and footer/store-details are untouched.
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const config = readJson(CONFIG_FILE, {});
  config.theme = DEFAULT_BRANDING.theme;
  config.colors = { ...DEFAULT_BRANDING.colors };
  config.heroImageUrl = DEFAULT_BRANDING.heroImageUrl;
  config.logoUrl = DEFAULT_BRANDING.logoUrl;
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, config);
});

// --- Branding profiles ("holiday themes" the admin can save and switch between) ---
route("GET", /^\/api\/branding-profiles\/?$/, async (req, res) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  sendJson(res, 200, readJson(BRANDING_PROFILES_FILE, {}));
});

route("POST", /^\/api\/branding-profiles\/?$/, async (req, res) => {
  // Saves the CURRENT live branding (theme/colors/hero/logo) as a named,
  // reusable profile - e.g. "Diwali", "Christmas" - to switch to later.
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "Profile name is required" });

  const config = readJson(CONFIG_FILE, {});
  const profiles = readJson(BRANDING_PROFILES_FILE, {});
  profiles[name] = {
    theme: config.theme,
    colors: config.colors,
    heroImageUrl: config.heroImageUrl,
    logoUrl: config.logoUrl
  };
  writeJson(BRANDING_PROFILES_FILE, profiles);
  sendJson(res, 201, profiles);
});

route("POST", /^\/api\/branding-profiles\/(?<name>[^/]+)\/activate\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const profiles = readJson(BRANDING_PROFILES_FILE, {});
  const name = decodeURIComponent(params.name);
  const profile = profiles[name];
  if (!profile) return sendJson(res, 404, { error: "Profile not found" });

  const config = readJson(CONFIG_FILE, {});
  config.theme = profile.theme;
  config.colors = profile.colors;
  config.heroImageUrl = profile.heroImageUrl;
  config.logoUrl = profile.logoUrl;
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, config);
});

route("DELETE", /^\/api\/branding-profiles\/(?<name>[^/]+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const profiles = readJson(BRANDING_PROFILES_FILE, {});
  const name = decodeURIComponent(params.name);
  delete profiles[name];
  writeJson(BRANDING_PROFILES_FILE, profiles);
  sendJson(res, 200, profiles);
});

// --- Coupons ---
route("GET", /^\/api\/coupons\/?$/, async (req, res) => {
  // Manager/owner only - returns everything, including private/inactive/
  // exhausted codes. The public listing below is a separate, filtered route.
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  sendJson(res, 200, readJson(COUPONS_FILE, []));
});

route("GET", /^\/api\/coupons\/public\/?$/, async (req, res) => {
  // No auth beyond a session (same level as coupon validation) - lets a
  // customer self-serve the list of codes worth trying. Private coupons and
  // anything inactive/expired/exhausted never appear here.
  const session = currentSession(req);
  if (!session) return sendJson(res, 401, { error: "Not signed in" });
  const now = Date.now();
  const coupons = readJson(COUPONS_FILE, [])
    .filter((c) => c.active && !c.private)
    .filter((c) => !c.expiresAt || new Date(c.expiresAt).getTime() >= now)
    .filter((c) => c.maxUses == null || c.usedCount < c.maxUses)
    .map((c) => ({ code: c.code, type: c.type, value: c.value, expiresAt: c.expiresAt }));
  sendJson(res, 200, coupons);
});

route("POST", /^\/api\/coupons\/validate\/?$/, async (req, res) => {
  const session = currentSession(req);
  if (!session) return sendJson(res, 401, { error: "Not signed in" });
  const body = await readBody(req);
  const coupon = findValidCoupon(body.code);
  if (!coupon) return sendJson(res, 404, { error: "Invalid, expired, or exhausted coupon code" });
  sendJson(res, 200, { code: coupon.code, type: coupon.type, value: coupon.value });
});

route("POST", /^\/api\/coupons\/?$/, async (req, res) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const body = await readBody(req);
  const coupons = readJson(COUPONS_FILE, []);
  const result = sanitizeCouponInput(body, coupons);
  if (result.error) return sendJson(res, 400, { error: result.error });

  const nextId = coupons.length ? Math.max(...coupons.map((c) => c.id)) + 1 : 1;
  const coupon = { id: nextId, ...result.value, active: true, usedCount: 0, createdAt: new Date().toISOString() };
  coupons.push(coupon);
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 201, coupon);
});

route("PATCH", /^\/api\/coupons\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const body = await readBody(req);
  const coupons = readJson(COUPONS_FILE, []);
  const coupon = coupons.find((c) => c.id === Number(params.id));
  if (!coupon) return sendJson(res, 404, { error: "Coupon not found" });

  if (body.active !== undefined) {
    coupon.active = !!body.active;
  } else {
    const result = sanitizeCouponInput(body, coupons, coupon.id);
    if (result.error) return sendJson(res, 400, { error: result.error });
    Object.assign(coupon, result.value);
  }
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 200, coupon);
});

route("DELETE", /^\/api\/coupons\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MENU_ADMIN_ROLES)) return;
  const coupons = readJson(COUPONS_FILE, []).filter((c) => c.id !== Number(params.id));
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 200, { ok: true });
});

// --- Orders ---
route("GET", /^\/api\/orders\/?$/, async (req, res) => {
  // Full order list is for staff running the register/kitchen/admin views only.
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  sendJson(res, 200, readJson(ORDERS_FILE, []));
});

route("GET", /^\/api\/orders\/mine\/?$/, async (req, res) => {
  // A customer sees only orders tied to their account; a guest sees only
  // orders tied to the phone number they logged in with - never anyone else's.
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;

  const orders = readJson(ORDERS_FILE, []);
  const mine = orders
    .filter((o) => (session.role === "customer" ? o.customerId === session.userId : o.customerPhone === session.phone))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map((o) => ({ ...o, status: orderStatusOf(o) }));

  sendJson(res, 200, mine);
});

route("POST", /^\/api\/orders\/?$/, async (req, res) => {
  // Placing an order needs SOME identity (customer login or guest phone) so
  // it can be tracked afterwards - but no staff-only permissions are needed,
  // so any logged-in role (including guest) may place one.
  const session = requireSession(req, res);
  if (!session) return;

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const phone = normalizePhone(body.phone || session.phone);
  if (!phone) {
    return sendJson(res, 400, { error: "A valid phone number is required to place an order" });
  }

  const method = body.method === "ONLINE" ? "ONLINE" : "COUNTER";
  const serviceChargeActive = body.serviceChargeActive !== false;
  const tipApplied = !!body.tipApplied;

  let computed;
  try {
    computed = computeOrder(Array.isArray(body.items) ? body.items : [], method, serviceChargeActive, tipApplied, body.couponCode);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const orders = readJson(ORDERS_FILE, []);
  const order = {
    id: `SB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    orderNumber: generateOrderNumber(orders),
    createdAt: new Date().toISOString(),
    method,
    isPaid: method === "ONLINE", // still trust-based until a real payment webhook is wired up - see README
    tipApplied,
    serviceChargeActive,
    customerId: session.role === "customer" ? session.userId : null,
    customerPhone: phone,
    ...computed
  };
  orders.push(order);
  writeJson(ORDERS_FILE, orders);

  if (computed.couponId != null) {
    const coupons = readJson(COUPONS_FILE, []);
    const coupon = coupons.find((c) => c.id === computed.couponId);
    if (coupon) {
      coupon.usedCount = (coupon.usedCount || 0) + 1;
      writeJson(COUPONS_FILE, coupons);
    }
  }
  broadcastOrdersChanged();
  sendJson(res, 201, order);
});

route("PATCH", /^\/api\/orders\/(?<id>[\w-]+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  const body = await readBody(req);
  const orders = readJson(ORDERS_FILE, []);
  const order = orders.find((o) => o.id === params.id);
  if (!order) return sendJson(res, 404, { error: "Order not found" });

  if (body.action === "markPaid") {
    order.isPaid = true;
  } else if (body.action === "markDone") {
    const station = body.station;
    order.items.forEach((i) => {
      if (!station || station === "MASTER" || i.station === station) i.isDone = true;
    });
  } else {
    return sendJson(res, 400, { error: "Unknown action" });
  }

  writeJson(ORDERS_FILE, orders);
  broadcastOrdersChanged();
  sendJson(res, 200, order);
});

route("GET", /^\/api\/orders\/stream\/?$/, async (req, res) => {
  // Any signed-in role can listen (it only signals "something changed" -
  // each client still fetches through the role-filtered endpoints above).
  const session = currentSession(req);
  if (!session) {
    res.writeHead(401);
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write("retry: 3000\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ---------------------------------------------------------------------------
// Static file serving (the frontend)
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT_DIR, rel));

  // Prevent path traversal outside the project root.
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    const match = matchRoute(req.method, pathname);
    if (!match) return sendJson(res, 404, { error: "Not found" });
    try {
      await match.handler(req, res, match.params, url);
    } catch (e) {
      sendJson(res, 500, { error: "Server error" });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Seven Bits Coffee server running at http://localhost:${PORT}`);
  const savedConfig = readJson(CONFIG_FILE, {});
  if (!UPI_VPA && !savedConfig.upiVpa) {
    console.log("Note: no UPI ID is set yet, so 'Pay Online' orders won't show a QR code.");
    console.log("Set it from Admin > Global Settings > Payment Settings once logged in,");
    console.log("or via the UPI_VPA/UPI_PAYEE_NAME env vars before first boot.");
  }
});
