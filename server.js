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
// Deliberately its own top-level directory, not data/uploads - uploaded
// images are the only user-generated files ever meant to be servable by
// path with no auth (see STATIC_ROOTS below), so keeping them out of data/
// entirely means a future change to data/'s own handling can't accidentally
// re-expose it alongside them.
const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");
const PORT = parseInt(process.env.PORT || "3000", 10);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hour shift
const IS_HTTPS = process.env.FORCE_SECURE_COOKIE === "1";

const UPI_VPA = process.env.UPI_VPA || "";
const UPI_PAYEE_NAME = process.env.UPI_PAYEE_NAME || "";

const STAFF_ROLES = ["employee", "manager", "admin", "owner"];
const MENU_ADMIN_ROLES = ["admin", "owner"]; // full Admin panel (branding, all staff, cross-store)
const MANAGER_UP_ROLES = ["manager", "admin", "owner"]; // Manager Dashboard + everything above it
const KITCHEN_ROLES = ["employee", "manager", "admin", "owner"];
const TRACKING_ROLES = ["customer", "guest"];
const PAYROLL_ROLES = ["employee", "manager"]; // who payroll/timeclock applies to
const PAYMENT_METHODS = ["UPI", "Card", "Cash", "Wallet"]; // recorded on an order/table session once it's actually settled

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
const STORES_FILE = path.join(DATA_DIR, "stores.json");
const TIMECLOCK_FILE = path.join(DATA_DIR, "timeclock.json");
const PAYROLL_FILE = path.join(DATA_DIR, "payroll.json");
const ATTENDANCE_FILE = path.join(DATA_DIR, "attendance.json");
const OVERTIME_APPROVALS_FILE = path.join(DATA_DIR, "overtime-approvals.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const COMBOS_FILE = path.join(DATA_DIR, "combos.json");
const TABLE_SESSIONS_FILE = path.join(DATA_DIR, "table-sessions.json");
const COUPONS_FILE = path.join(DATA_DIR, "coupons.json");
const ARCADE_SCORES_FILE = path.join(DATA_DIR, "arcade-scores.json");
// Per-user settings that aren't tied to any one feature enough to live on the
// user record itself (users.json) - starts with just the staff nav layout
// choice (rail/top-bar), keyed by userId so it follows a person across
// devices/browsers instead of being stuck in one browser's localStorage.
const USER_PREFERENCES_FILE = path.join(DATA_DIR, "user-preferences.json");
// Metadata for files actually stored under UPLOADS_DIR - the images
// themselves are plain files on disk (served statically, see STATIC_ROOTS);
// this just tracks what's there for the admin image picker (id, original
// name, size, who/when) and to resolve an id back to a filename on delete.
const UPLOADS_MANIFEST_FILE = path.join(DATA_DIR, "uploads.json");

if (!fs.existsSync(AUDIT_LOG_FILE)) writeJson(AUDIT_LOG_FILE, []);
if (!fs.existsSync(BRANDING_PROFILES_FILE)) writeJson(BRANDING_PROFILES_FILE, {});
if (!fs.existsSync(TIMECLOCK_FILE)) writeJson(TIMECLOCK_FILE, []);
if (!fs.existsSync(PAYROLL_FILE)) writeJson(PAYROLL_FILE, []);
if (!fs.existsSync(ATTENDANCE_FILE)) writeJson(ATTENDANCE_FILE, []);
if (!fs.existsSync(OVERTIME_APPROVALS_FILE)) writeJson(OVERTIME_APPROVALS_FILE, []);
// Multi-store groundwork: everything (users, and later menu/orders) can carry
// a storeId, but with a single store seeded there's no behavior change yet -
// this just means a real second store later doesn't need a data migration.
if (!fs.existsSync(STORES_FILE)) writeJson(STORES_FILE, [{ id: 1, name: "Main Store", address: "" }]);
if (!fs.existsSync(UPLOADS_MANIFEST_FILE)) writeJson(UPLOADS_MANIFEST_FILE, []);
if (!fs.existsSync(USER_PREFERENCES_FILE)) writeJson(USER_PREFERENCES_FILE, {});

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
    // GST registration number (India) - printed on bills when set (see
    // window.printBill in app.js); blank means "not GST-registered", not an
    // error, so it's simply omitted from the printout.
    gstNumber: "",
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
    // Font size (pt) + color for the admin sub-tab nav row and the muted
    // helper/description paragraphs in the admin panel - see Branding tab
    // "ADMIN PANEL TEXT" section, and DEFAULT_BRANDING.textStyles below.
    textStyles: {
      adminTabs: { fontSize: 9, color: "#888888" },
      adminHelp: { fontSize: 7.5, color: "#888888" },
      adminLabels: { fontSize: 8, color: "#888888" }
    },
    // Home page hero copy - was hardcoded in index.html, now admin-editable
    // from Global Settings so a shop can rebrand without touching code.
    heroTagline:
      "Born from love for Physics, Coffee, a cat named Ginger and an obssesion with the number seven. We don't just brew; we process flavor with low-latency precision.",
    // Small badge line above the hero heading (e.g. "Est. 2019 - 8-bit
    // roastery") - was hardcoded in index.html, same reasoning as heroTagline.
    heroBadgeText: "Est. 2019 · 8-bit roastery",
    // Printed at the bottom of the customer bill (window.printBill, app.js) -
    // was a hardcoded "- G=7 | Processed with precision -" signature.
    receiptFooterText: "Thank you for visiting!",
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
    },
    // Number of physical tables the shop has. Table 0 is a reserved label
    // for "Online / Counter" (no physical table), never an openable tab -
    // real tabs are numbered 1..tableCount. See /api/table-sessions.
    tableCount: 10,
    // Industry-standard "earn on spend, redeem for a discount" loyalty
    // program - both rates admin-editable from Discounts & Loyalty.
    loyalty: {
      enabled: true,
      pointsPerRupeeSpent: 0.1, // e.g. 0.1 = 1 point per Rs.10 spent
      rupeeValuePerPoint: 0.5 // e.g. 0.5 = each point is worth Rs.0.50 off
    },
    // In-store arcade (ARCADE tab) - a customer/guest unlocks it for
    // sessionHours after placing an order, admin-editable from Global
    // Settings. This is deliberately in-store only: there's no reason to
    // let someone play from home just because they ordered once.
    arcade: {
      enabled: true,
      sessionHours: 2
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
  logoUrl: "",
  // Font size (pt) + color for two specific text categories in the admin
  // panel: the sub-tab navigation row (Dashboard/Menu Items/.../Branding),
  // and the small muted helper/description paragraphs under section
  // headings (e.g. "Applies only to drink items..."). Separate from the
  // main color palette above since these are admin-only UI text, not
  // customer-facing branding.
  textStyles: {
    adminTabs: { fontSize: 9, color: "#888888" },
    adminHelp: { fontSize: 7.5, color: "#888888" },
    adminLabels: { fontSize: 8, color: "#888888" }
  }
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

function createUser({
  username,
  password,
  role,
  name,
  phone,
  mustChangePassword = false,
  storeId = 1,
  tag = "",
  payRateType = null,
  payRate = null
}) {
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
    mustChangePassword,
    // storeId: which store this person works at/manages. Owner/admin aren't
    // tied to one store (they see everything), so storeId is mostly
    // meaningful for employee/manager.
    storeId: ["employee", "manager"].includes(role) ? storeId : null,
    // tag: free-text responsibility label an admin/manager sets, e.g.
    // "Barista", "Cashier" - shown in the staff table, not used for
    // permissions (that's what role is for).
    tag: ["employee", "manager"].includes(role) ? tag : "",
    payRateType: ["employee", "manager"].includes(role) ? payRateType : null,
    payRate: ["employee", "manager"].includes(role) ? payRate : null
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

/** Stable per-person key for favorites - a signed-in customer keeps favorites
 *  across devices (keyed by account), a guest's favorites are scoped to the
 *  phone number they're currently using, same privacy boundary as /orders/mine. */
function favoritesOwnerKey(session) {
  return session.role === "customer" ? `customer:${session.userId}` : `guest:${session.phone}`;
}

// ---------------------------------------------------------------------------
// Business logic: menu station mapping + order pricing (server-authoritative)
// ---------------------------------------------------------------------------

const DRINK_SECTIONS = ["fast-sellers", "limited", "classics"];

function getStation(item) {
  if (item.section === "sweets") return "DESSERTS";
  if (DRINK_SECTIONS.includes(item.section)) return "BARISTA";
  return "KITCHEN";
}

function isDrinkItem(item) {
  return DRINK_SECTIONS.includes(item.section);
}

function round2(n) {
  return Math.round(n * 100) / 100;
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

// Validates a menu item's promo-discount payload, returning null for "no
// promo" (including invalid input, so a bad request just drops the promo
// rather than saving garbage). percent is capped at 100; flat just needs to
// be a positive rupee amount - the price is clamped to a floor of 0
// wherever promoUnitPrice() is used regardless.
function sanitizePromoDiscount(input) {
  if (!input) return null;
  const type = input.type === "flat" ? "flat" : input.type === "percent" ? "percent" : null;
  const value = Number(input.value);
  if (!type || !Number.isFinite(value) || value <= 0) return null;
  if (type === "percent" && value > 100) return null;
  return { type, value };
}

// A menu item "on promotion" auto-applies its discount to the item's base
// price for every line ordering it - no coupon code needed, and mutually
// exclusive with coupons (enforced in computeOrder). Customization price
// deltas (size/milk/extras) are added on top of the discounted base, not
// discounted themselves.
function promoUnitPrice(product) {
  const promo = product.promoDiscount;
  if (!promo) return product.price;
  const discounted = promo.type === "percent" ? product.price * (1 - promo.value / 100) : product.price - promo.value;
  return round2(Math.max(0, discounted));
}

// ---------------------------------------------------------------------------
// Order customization catalog (server-authoritative - client only picks keys,
// every price delta and label comes from here so a tampered client can't
// change what gets charged). Persisted so a manager/owner can edit prices
// from Admin > Customization Pricing; DEFAULT_CUSTOMIZATION_OPTIONS seeds a
// fresh install and is also the fallback if the data file is ever missing.
// ---------------------------------------------------------------------------

const CUSTOMIZATION_FILE = path.join(DATA_DIR, "customization-options.json");

const DEFAULT_CUSTOMIZATION_OPTIONS = {
  sizeOptions: [
    { key: "regular", label: "Regular", priceDelta: 0 },
    { key: "large", label: "Large", priceDelta: 40 }
  ],
  milkOptions: [
    { key: "regular", label: "Regular Milk", priceDelta: 0 },
    { key: "oat", label: "Oat Milk", priceDelta: 30 },
    { key: "almond", label: "Almond Milk", priceDelta: 30 },
    { key: "soy", label: "Soy Milk", priceDelta: 30 },
    { key: "none", label: "No Milk / Black", priceDelta: 0 }
  ],
  extraOptions: [
    { key: "extra-shot", label: "Extra Espresso Shot", priceDelta: 40 },
    { key: "whipped-cream", label: "Whipped Cream", priceDelta: 20 },
    { key: "extra-syrup", label: "Extra Flavor Syrup", priceDelta: 20 },
    { key: "extra-cheese", label: "Extra Cheese", priceDelta: 30 },
    { key: "extra-butter", label: "Extra Butter", priceDelta: 15 }
  ]
};

function getCustomizationOptions() {
  return readJson(CUSTOMIZATION_FILE, DEFAULT_CUSTOMIZATION_OPTIONS);
}

const MAX_NOTES_LENGTH = 140;
const MAX_EXTRAS_PER_LINE = 6;

function sanitizeNotes(raw) {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NOTES_LENGTH);
}

/**
 * Resolves a client-submitted customization (just keys) against the server
 * catalog, dropping anything that doesn't exist and computing the real
 * price delta. Size/milk only apply to drink-section items.
 */
function resolveCustomization(requested, product) {
  const drink = isDrinkItem(product);
  const options = getCustomizationOptions();
  requested = requested || {};

  let size = null;
  if (drink) {
    size = options.sizeOptions.find((s) => s.key === requested.size) || options.sizeOptions[0];
  }

  let milk = null;
  if (drink) {
    milk = options.milkOptions.find((m) => m.key === requested.milk) || options.milkOptions[0];
  }

  const requestedExtraKeys = Array.isArray(requested.extras) ? requested.extras : [];
  const extras = [];
  const seen = new Set();
  for (const key of requestedExtraKeys) {
    if (extras.length >= MAX_EXTRAS_PER_LINE) break;
    if (seen.has(key)) continue;
    const found = options.extraOptions.find((e) => e.key === key);
    if (found) {
      extras.push(found);
      seen.add(key);
    }
  }

  const notes = sanitizeNotes(requested.notes);
  const priceDelta = (size ? size.priceDelta : 0) + (milk ? milk.priceDelta : 0) + extras.reduce((s, e) => s + e.priceDelta, 0);

  return { size, milk, extras, notes, priceDelta };
}

/**
 * Expands one combo cart line into its component menu items, priced by
 * splitting the admin-set combo price proportionally across each
 * component's normal price - so a combo's line items still route to the
 * right kitchen stations and show individually on the KOT, but the
 * customer is charged the discounted bundle price, not the sum of retail
 * prices. The combo's price and component list both come from the server's
 * own combo catalog, never trusted from the client - only the combo id and
 * how many bundles were ordered are.
 */
function resolveComboLine(requested, menu, combos) {
  const combo = combos.find((c) => c.id === requested.comboId && c.active !== false);
  if (!combo) return [];
  const quantity = Math.max(1, Math.min(50, parseInt(requested.quantity, 10) || 0));
  if (!quantity) return [];

  const components = combo.items
    .map((c) => ({ product: menu.items.find((i) => i.id === c.id), qty: c.quantity }))
    .filter((c) => c.product && c.product.available !== false && !(c.product.stockCount != null && c.product.stockCount <= 0));
  if (components.length === 0) return [];

  const baseUnitSum = components.reduce((sum, c) => sum + c.product.price * c.qty, 0);
  let allocatedSoFar = 0;
  const lines = [];
  components.forEach((c, idx) => {
    const isLast = idx === components.length - 1;
    const share = baseUnitSum > 0 ? (c.product.price * c.qty) / baseUnitSum : 1 / components.length;
    const allocatedUnitTotal = isLast ? round2(combo.price - allocatedSoFar) : round2(combo.price * share);
    allocatedSoFar += allocatedUnitTotal;

    const comboUnitPrice = round2(allocatedUnitTotal / c.qty);
    lines.push({
      id: c.product.id,
      name: c.product.name,
      basePrice: c.product.price,
      price: comboUnitPrice, // per-unit price after combo discount, never client-supplied
      originalPrice: comboUnitPrice, // combos aren't eligible for item-level promos, so there's no separate "original"
      promoDiscount: null,
      quantity: c.qty * quantity,
      station: getStation(c.product),
      isDone: false,
      size: null,
      sizeLabel: null,
      milk: null,
      milkLabel: null,
      extras: [],
      notes: "",
      comboId: combo.id,
      comboName: combo.name
    });
  });
  return lines;
}

function computeOrder(items, method, serviceChargeActive, tipApplied, { couponCode = null, redeemPoints = 0, customerId = null } = {}) {
  const menu = readJson(MENU_FILE, { items: [] });
  const config = readJson(CONFIG_FILE, {});
  const combos = readJson(COMBOS_FILE, []);

  const resolvedItems = [];
  for (const requested of items) {
    if (requested.type === "combo") {
      resolvedItems.push(...resolveComboLine(requested, menu, combos));
      continue;
    }

    const id = Number(requested.id);
    const quantity = Math.max(1, Math.min(50, parseInt(requested.quantity, 10) || 0));
    if (!quantity) continue;
    const product = menu.items.find((i) => i.id === id);
    if (!product) continue; // ignore unknown items rather than trusting the client
    if (product.available === false) continue; // item was taken off the menu - never trust client to skip it itself
    if (product.stockCount != null && product.stockCount <= 0) continue; // sold out - dropped silently, same as unavailable
    if (product.stockCount != null && quantity > product.stockCount) {
      throw new Error(`${product.name} only has ${product.stockCount} left in stock`);
    }

    const custom = resolveCustomization(requested.customization, product);
    // authoritative: promo-discounted base price (or plain base price if no
    // promo) + server-priced customizations - customization deltas are
    // added on top of the discount, not discounted themselves.
    const unitPrice = promoUnitPrice(product) + custom.priceDelta;
    const originalUnitPrice = product.price + custom.priceDelta;

    resolvedItems.push({
      id: product.id,
      name: product.name,
      basePrice: product.price,
      price: round2(unitPrice), // unit price including customization, never trusted from client
      originalPrice: round2(originalUnitPrice), // pre-promo unit price, for showing the discount in the UI
      promoDiscount: product.promoDiscount || null,
      quantity,
      station: getStation(product),
      isDone: false,
      size: custom.size ? custom.size.key : null,
      sizeLabel: custom.size ? custom.size.label : null,
      milk: custom.milk ? custom.milk.key : null,
      milkLabel: custom.milk ? custom.milk.label : null,
      extras: custom.extras.map((e) => ({ key: e.key, label: e.label, priceDelta: e.priceDelta })),
      notes: custom.notes
    });
  }

  if (resolvedItems.length === 0) {
    throw new Error("No valid items in order");
  }

  const subtotal = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const promoDiscountTotal = round2(resolvedItems.reduce((sum, i) => sum + ((i.originalPrice ?? i.price) - i.price) * i.quantity, 0));

  // Coupon discount - server re-validates the code against the live catalog
  // and current subtotal; a client can never dictate the discount amount.
  // Mutually exclusive with item-level promos: a cart with any
  // promo-discounted line can't also redeem a coupon, so the two discount
  // mechanisms never stack.
  const hasPromoItem = resolvedItems.some((i) => i.promoDiscount);
  if (couponCode && hasPromoItem) {
    throw new Error("Coupon codes can't be combined with promotional items in your cart");
  }
  const coupons = readJson(COUPONS_FILE, []);
  const coupon = couponCode ? findValidCoupon(couponCode, coupons) : null;
  const couponDiscount = coupon ? computeCouponDiscount(coupon, subtotal) : 0;

  // Loyalty points redemption - capped at the customer's real balance and at
  // whatever's left of the subtotal after the coupon, so stacking never
  // discounts below zero. Only signed-in "customer" accounts have a balance
  // (guests aren't persistent identities to track points against).
  const loyaltyConfig = config.loyalty || {};
  let loyaltyPointsRedeemed = 0;
  let loyaltyDiscount = 0;
  if (customerId && redeemPoints > 0 && loyaltyConfig.enabled) {
    const users = readJson(USERS_FILE, []);
    const user = users.find((u) => u.id === customerId);
    const available = user ? user.loyaltyPoints || 0 : 0;
    const requested = Math.min(Math.max(0, Math.floor(redeemPoints)), available);
    const rupeeValuePerPoint = loyaltyConfig.rupeeValuePerPoint ?? 0.5;
    const remaining = Math.max(0, subtotal - couponDiscount);
    const candidateDiscount = round2(requested * rupeeValuePerPoint);
    if (candidateDiscount > remaining && rupeeValuePerPoint > 0) {
      loyaltyPointsRedeemed = Math.floor(remaining / rupeeValuePerPoint);
      loyaltyDiscount = round2(loyaltyPointsRedeemed * rupeeValuePerPoint);
    } else {
      loyaltyPointsRedeemed = requested;
      loyaltyDiscount = candidateDiscount;
    }
  }

  const discountAmount = round2(couponDiscount + loyaltyDiscount);
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  // New points are earned on what the customer actually pays, i.e. after
  // discounts - computed here (pure), credited to the account by the caller
  // only once the order is confirmed to have been created successfully.
  const loyaltyPointsEarned =
    customerId && loyaltyConfig.enabled ? Math.floor(taxableAmount * (loyaltyConfig.pointsPerRupeeSpent ?? 0.1)) : 0;

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
    promoDiscountTotal,
    couponCode: coupon ? coupon.code : null,
    couponId: coupon ? coupon.id : null,
    discountAmount,
    loyaltyPointsRedeemed,
    loyaltyDiscount,
    loyaltyPointsEarned,
    cgst: round2(cgst),
    sgst: round2(sgst),
    serviceCharge: round2(serviceCharge),
    tipAmount: round2(tipAmount),
    total: round2(total),
    paymentQrUrl
  };
}

function orderStatusOf(order) {
  if (order.servedAt) return "SERVED";
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
  const token = createSession({ role: user.role, userId: user.id, name: user.name, phone: user.phone, storeId: user.storeId });
  setSessionCookie(res, token);
  sendJson(res, 200, { role: user.role, name: user.name, phone: user.phone, storeId: user.storeId, mustChangePassword: !!user.mustChangePassword });
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
  const token = createSession({ role: user.role, userId: user.id, name: user.name, phone: user.phone, storeId: user.storeId });
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
    storeId: session.storeId,
    mustChangePassword: !!(user && user.mustChangePassword),
    loyaltyPoints: user ? user.loyaltyPoints || 0 : 0
  });
});

/** Which roles a given session is allowed to hand out when creating a new account. */
function allowedRolesToCreate(session) {
  if (session.role === "owner") return ["employee", "manager", "admin", "owner"];
  if (session.role === "admin") return ["employee", "manager"];
  if (session.role === "manager") return ["employee"];
  return [];
}

function canManageTarget(session, targetUser) {
  if (!targetUser) return false;
  if (session.role === "owner") return true;
  if (session.role === "admin") return ["employee", "manager"].includes(targetUser.role);
  if (session.role === "manager") return targetUser.role === "employee" && targetUser.storeId === session.storeId;
  return false;
}

route("GET", /^\/api\/users\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  let users = readJson(USERS_FILE, []).filter((u) => STAFF_ROLES.includes(u.role));
  // A manager only sees their own store's staff (plus themselves), never
  // other stores' employees or the admin/owner accounts.
  if (session.role === "manager") {
    users = users.filter((u) => u.id === session.userId || (u.role === "employee" && u.storeId === session.storeId));
  }
  sendJson(res, 200, users.map(publicUser));
});

route("POST", /^\/api\/users\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;

  const body = await readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const role = String(body.role || "");
  const tag = String(body.tag || "").trim();
  const payRateType = ["hourly", "weekly", "monthly"].includes(body.payRateType) ? body.payRateType : null;
  const payRate = Number.isFinite(Number(body.payRate)) && Number(body.payRate) >= 0 ? Number(body.payRate) : null;
  // A manager can only create employees for their OWN store - they can't
  // even choose a different store id.
  const storeId = session.role === "manager" ? session.storeId : Number(body.storeId) || 1;

  if (username.length < 3) return sendJson(res, 400, { error: "Username must be at least 3 characters" });
  const pwIssues = passwordIssues(password);
  if (pwIssues.length) return sendJson(res, 400, { error: pwIssues[0] });

  const allowedToCreate = allowedRolesToCreate(session);
  if (!allowedToCreate.includes(role)) {
    return sendJson(res, 403, { error: `Your account can't create a "${role}" account` });
  }

  try {
    // Staff accounts start with mustChangePassword so the temp password an
    // admin hands over only works once before the new hire sets their own.
    const user = createUser({ username, password, role, name, mustChangePassword: true, storeId, tag, payRateType, payRate });
    sendJson(res, 201, publicUser(user));
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

route("PATCH", /^\/api\/users\/(?<id>\d+)\/?$/, async (req, res, params) => {
  // Editing tag/pay rate/store for an EXISTING staff member (not role or
  // password - those have their own, more tightly-guarded routes).
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;

  const targetUser = findUserById(Number(params.id));
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't edit that person" });
  }

  const body = await readBody(req);
  const users = readJson(USERS_FILE, []);
  const user = users.find((u) => u.id === targetUser.id);
  if (body.name !== undefined) user.name = String(body.name).trim() || user.name;
  if (body.tag !== undefined) user.tag = String(body.tag).trim();
  if (body.payRateType !== undefined) {
    user.payRateType = ["hourly", "weekly", "monthly"].includes(body.payRateType) ? body.payRateType : null;
  }
  if (body.payRate !== undefined) {
    const rate = Number(body.payRate);
    user.payRate = Number.isFinite(rate) && rate >= 0 ? rate : null;
  }
  writeJson(USERS_FILE, users);
  sendJson(res, 200, publicUser(user));
});

route("POST", /^\/api\/users\/(?<id>\d+)\/reset-password\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
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
  const session = requireRole(req, res, MANAGER_UP_ROLES);
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

// ---------------------------------------------------------------------------
// Stores (multi-store groundwork)
//
// With one store, none of this changes daily behavior - it exists so that
// adding a second physical location later is "create a store, assign staff
// to it" instead of a data migration.
// ---------------------------------------------------------------------------

route("GET", /^\/api\/stores\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  sendJson(res, 200, readJson(STORES_FILE, []));
});

route("POST", /^\/api\/stores\/?$/, async (req, res) => {
  if (!requireRole(req, res, ["owner"])) return; // only the owner opens a new store
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "Store name is required" });
  const stores = readJson(STORES_FILE, []);
  const nextId = stores.length ? Math.max(...stores.map((s) => s.id)) + 1 : 1;
  const store = { id: nextId, name, address: String(body.address || "").trim() };
  stores.push(store);
  writeJson(STORES_FILE, stores);
  sendJson(res, 201, store);
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

// ---------------------------------------------------------------------------
// Time clock + payroll
//
// Pay periods are fixed calendar windows, not custom ranges an admin picks
// each time: monthly-rate staff are paid on a calendar-month cycle,
// hourly/weekly-rate staff on a Monday-Sunday weekly cycle. "Marking paid"
// snapshots that period's amount into payroll.json so it can't silently
// change later (e.g. if a shift gets edited after the fact) and so the
// period can't accidentally be marked paid twice.
// ---------------------------------------------------------------------------

function computePayPeriod(payRateType, referenceDate = new Date()) {
  if (payRateType === "monthly") {
    const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999);
    return { periodType: "monthly", start, end };
  }
  // hourly and weekly both run on a Monday-Sunday cycle.
  const day = referenceDate.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(referenceDate);
  start.setDate(referenceDate.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { periodType: "weekly", start, end };
}

const DAILY_HOUR_CAP = 8;

function dateKeyOf(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Raw (uncapped) clocked hours for one user on one calendar day. */
function clockedHoursOnDay(userId, dateStr) {
  const shifts = readJson(TIMECLOCK_FILE, []);
  let ms = 0;
  for (const s of shifts) {
    if (s.userId !== userId || !s.clockOut) continue;
    if (dateKeyOf(s.clockIn) === dateStr) {
      ms += new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime();
    }
  }
  return round2(ms / (1000 * 60 * 60));
}

/** Raw (uncapped) manager-marked attendance hours for one user on one day. */
function attendanceHoursOnDay(userId, dateStr) {
  const entries = readJson(ATTENDANCE_FILE, []);
  return round2(entries.filter((a) => a.userId === userId && a.date === dateStr).reduce((sum, a) => sum + a.hours, 0));
}

function isOvertimeApproved(userId, dateStr) {
  const approvals = readJson(OVERTIME_APPROVALS_FILE, []);
  return approvals.some((a) => a.userId === userId && a.date === dateStr);
}

/**
 * Every date between start/end (inclusive) that has EITHER clocked shifts
 * or manager-marked attendance for this user.
 */
function datesWithActivity(userId, start, end) {
  const dates = new Set();
  readJson(TIMECLOCK_FILE, []).forEach((s) => {
    if (s.userId === userId && s.clockOut) {
      const d = new Date(s.clockIn);
      if (d >= start && d <= end) dates.add(dateKeyOf(d));
    }
  });
  readJson(ATTENDANCE_FILE, []).forEach((a) => {
    if (a.userId === userId) {
      const d = new Date(a.date);
      if (d >= start && d <= end) dates.add(a.date);
    }
  });
  return [...dates];
}

/**
 * Total hours counted toward pay for a period: each individual DAY is
 * capped at 8 hours (DAILY_HOUR_CAP) - whether the hours came from
 * self clock-in/out or a manager marking attendance directly - unless a
 * manager has explicitly approved overtime for that specific user+date.
 * The cap is per-day, not per-period, so a 12-hour day and two 6-hour days
 * are treated differently even if the period total is the same.
 */
function hoursWorkedInPeriod(userId, start, end) {
  let total = 0;
  let rawTotal = 0;
  let hasUnapprovedOvertime = false;

  for (const dateStr of datesWithActivity(userId, start, end)) {
    const raw = round2(clockedHoursOnDay(userId, dateStr) + attendanceHoursOnDay(userId, dateStr));
    rawTotal += raw;
    if (raw > DAILY_HOUR_CAP && !isOvertimeApproved(userId, dateStr)) {
      hasUnapprovedOvertime = true;
      total += DAILY_HOUR_CAP;
    } else {
      total += raw;
    }
  }

  return { hours: round2(total), rawHours: round2(rawTotal), hasUnapprovedOvertime };
}

function computeEarnings(user, period, hoursWorked) {
  if (user.payRateType === "hourly") return round2((user.payRate || 0) * hoursWorked);
  if (user.payRateType === "weekly" || user.payRateType === "monthly") return round2(user.payRate || 0);
  return 0;
}

function periodKey(period) {
  return `${period.start.toISOString().slice(0, 10)}_${period.end.toISOString().slice(0, 10)}`;
}

/** Staff a manager/admin/owner session is allowed to see for payroll/timeclock purposes. */
function visibleStaffFor(session) {
  const users = readJson(USERS_FILE, []).filter((u) => PAYROLL_ROLES.includes(u.role));
  if (session.role === "manager") return users.filter((u) => u.storeId === session.storeId);
  return users; // admin/owner see everyone
}

route("POST", /^\/api\/timeclock\/clock-in\/?$/, async (req, res) => {
  const session = requireRole(req, res, PAYROLL_ROLES);
  if (!session) return;
  const shifts = readJson(TIMECLOCK_FILE, []);
  if (shifts.some((s) => s.userId === session.userId && !s.clockOut)) {
    return sendJson(res, 400, { error: "Already clocked in" });
  }
  const shift = { id: shifts.length ? Math.max(...shifts.map((s) => s.id)) + 1 : 1, userId: session.userId, storeId: session.storeId, clockIn: new Date().toISOString(), clockOut: null };
  shifts.push(shift);
  writeJson(TIMECLOCK_FILE, shifts);
  sendJson(res, 201, shift);
});

route("POST", /^\/api\/timeclock\/clock-out\/?$/, async (req, res) => {
  const session = requireRole(req, res, PAYROLL_ROLES);
  if (!session) return;
  const shifts = readJson(TIMECLOCK_FILE, []);
  const open = shifts.find((s) => s.userId === session.userId && !s.clockOut);
  if (!open) return sendJson(res, 400, { error: "Not currently clocked in" });
  open.clockOut = new Date().toISOString();
  writeJson(TIMECLOCK_FILE, shifts);
  sendJson(res, 200, open);
});

route("GET", /^\/api\/timeclock\/status\/?$/, async (req, res) => {
  const session = requireRole(req, res, PAYROLL_ROLES);
  if (!session) return;
  const shifts = readJson(TIMECLOCK_FILE, []);
  const open = shifts.find((s) => s.userId === session.userId && !s.clockOut);
  sendJson(res, 200, { clockedIn: !!open, since: open ? open.clockIn : null });
});

/** Live "who's clocked in right now" for the Admin dashboard's Crew widget -
 *  distinct from /api/payroll, which is period earnings, not live status. */
route("GET", /^\/api\/timeclock\/roster\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const staff = visibleStaffFor(session);
  const shifts = readJson(TIMECLOCK_FILE, []);
  const roster = staff.map((u) => ({
    userId: u.id,
    name: u.name,
    role: u.role,
    tag: u.tag || null,
    clockedIn: shifts.some((s) => s.userId === u.id && !s.clockOut)
  }));
  sendJson(res, 200, roster);
});

route("GET", /^\/api\/payroll\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;

  const staff = visibleStaffFor(session).filter((u) => u.payRateType);
  const paidRecords = readJson(PAYROLL_FILE, []);

  const result = staff.map((u) => {
    const period = computePayPeriod(u.payRateType);
    const hoursInfo = u.payRateType === "hourly" ? hoursWorkedInPeriod(u.id, period.start, period.end) : null;
    const hours = hoursInfo ? hoursInfo.hours : null;
    const amount = computeEarnings(u, period, hours || 0);
    const key = periodKey(period);
    const paidRecord = paidRecords.find((p) => p.userId === u.id && p.periodKey === key);
    return {
      userId: u.id,
      name: u.name,
      username: u.username,
      tag: u.tag,
      storeId: u.storeId,
      payRateType: u.payRateType,
      payRate: u.payRate,
      periodType: period.periodType,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      hoursWorked: hours,
      rawHours: hoursInfo ? hoursInfo.rawHours : null,
      hasUnapprovedOvertime: hoursInfo ? hoursInfo.hasUnapprovedOvertime : false,
      amount,
      isPaid: !!paidRecord,
      paidAt: paidRecord ? paidRecord.paidAt : null
    };
  });
  sendJson(res, 200, result);
});

route("POST", /^\/api\/payroll\/(?<userId>\d+)\/mark-paid\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;

  const targetUser = findUserById(Number(params.userId));
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't manage payroll for that person" });
  }
  if (!targetUser.payRateType) return sendJson(res, 400, { error: "This person has no pay rate set" });

  const period = computePayPeriod(targetUser.payRateType);
  const hoursInfo = targetUser.payRateType === "hourly" ? hoursWorkedInPeriod(targetUser.id, period.start, period.end) : null;
  const hours = hoursInfo ? hoursInfo.hours : null;
  const amount = computeEarnings(targetUser, period, hours || 0);
  const key = periodKey(period);

  const records = readJson(PAYROLL_FILE, []);
  if (records.some((p) => p.userId === targetUser.id && p.periodKey === key)) {
    return sendJson(res, 400, { error: "This period is already marked paid" });
  }
  records.push({
    id: records.length ? Math.max(...records.map((r) => r.id)) + 1 : 1,
    userId: targetUser.id,
    periodKey: key,
    periodType: period.periodType,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    hoursWorked: hours,
    amountPaid: amount,
    paidAt: new Date().toISOString(),
    paidBy: session.name
  });
  writeJson(PAYROLL_FILE, records);
  logAuditEvent(session, "payroll_paid", targetUser);
  sendJson(res, 200, { ok: true, amount });
});

route("GET", /^\/api\/payroll\/history\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const visibleIds = new Set(visibleStaffFor(session).map((u) => u.id));
  const records = readJson(PAYROLL_FILE, [])
    .filter((r) => visibleIds.has(r.userId))
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
  const users = readJson(USERS_FILE, []);
  sendJson(
    res,
    200,
    records.map((r) => ({ ...r, name: users.find((u) => u.id === r.userId)?.name || "Unknown" }))
  );
});

// ---------------------------------------------------------------------------
// Manager-marked attendance
//
// For staff who never log in themselves (e.g. table service staff who don't
// need the system at all) - a manager records their hours directly. Subject
// to the same 8-hour daily cap as self clock-in/out (see hoursWorkedInPeriod);
// a manager can flag an entry as overtime-approved to let it count in full.
// ---------------------------------------------------------------------------

route("GET", /^\/api\/attendance\/?$/, async (req, res, params, url) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const visibleIds = new Set(visibleStaffFor(session).map((u) => u.id));
  let entries = readJson(ATTENDANCE_FILE, []).filter((a) => visibleIds.has(a.userId));
  const userId = url.searchParams.get("userId");
  if (userId) entries = entries.filter((a) => a.userId === Number(userId));
  entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  const users = readJson(USERS_FILE, []);
  sendJson(
    res,
    200,
    entries.map((a) => ({ ...a, name: users.find((u) => u.id === a.userId)?.name || "Unknown" }))
  );
});

route("POST", /^\/api\/attendance\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;

  const body = await readBody(req);
  const targetUser = findUserById(Number(body.userId));
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't mark attendance for that person" });
  }
  const date = String(body.date || "").slice(0, 10);
  const hours = Number(body.hours);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: "Invalid date" });
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return sendJson(res, 400, { error: "Enter hours between 0 and 24" });

  const entries = readJson(ATTENDANCE_FILE, []);
  const entry = {
    id: entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1,
    userId: targetUser.id,
    storeId: targetUser.storeId,
    date,
    hours: round2(hours),
    markedBy: session.name,
    markedAt: new Date().toISOString()
  };
  entries.push(entry);
  writeJson(ATTENDANCE_FILE, entries);

  // Deliberately NOT auto-approving overtime here even if this pushes the
  // day over 8 hours - "marking hours" and "approving overtime" need to
  // stay two distinct actions, or the daily cap would mean nothing for
  // manually-entered attendance (a manager could always just type a bigger
  // number). Overtime still needs the separate POST /api/overtime-approvals
  // confirmation, exactly like a self-clocked day that runs over.
  sendJson(res, 201, entry);
});

route("DELETE", /^\/api\/attendance\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const entries = readJson(ATTENDANCE_FILE, []);
  const entry = entries.find((e) => e.id === Number(params.id));
  if (!entry) return sendJson(res, 404, { error: "Entry not found" });
  const targetUser = findUserById(entry.userId);
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't edit that entry" });
  }
  writeJson(ATTENDANCE_FILE, entries.filter((e) => e.id !== entry.id));
  sendJson(res, 200, { ok: true });
});

/**
 * Explicitly approves overtime for a self-clocked day that went over 8
 * hours (manually-entered attendance over 8h is auto-approved at entry
 * time instead - see POST /api/attendance above).
 */
route("POST", /^\/api\/overtime-approvals\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const targetUser = findUserById(Number(body.userId));
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't approve overtime for that person" });
  }
  const date = String(body.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: "Invalid date" });

  const approvals = readJson(OVERTIME_APPROVALS_FILE, []);
  if (!approvals.some((a) => a.userId === targetUser.id && a.date === date)) {
    approvals.push({ userId: targetUser.id, date, approvedBy: session.name, approvedAt: new Date().toISOString(), reason: "clocked_overtime" });
    writeJson(OVERTIME_APPROVALS_FILE, approvals);
  }
  sendJson(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// KPI dashboard
// ---------------------------------------------------------------------------

route("GET", /^\/api\/stats\/public\/?$/, async (req, res) => {
  // Deliberately minimal and public - no revenue, no names, nothing
  // sensitive. Just enough for a fun "live" counter on the home page.
  const orders = readJson(ORDERS_FILE, []);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayOrders = orders.filter((o) => new Date(o.createdAt) >= startOfToday);
  const itemsServedToday = todayOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  sendJson(res, 200, { ordersToday: todayOrders.length, itemsServedToday });
});

route("GET", /^\/api\/kpi\/?$/, async (req, res, params, url) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const orders = readJson(ORDERS_FILE, []);
  const requestedRange = url.searchParams.get("range");
  const range = ["7d", "1m", "1y"].includes(requestedRange) ? requestedRange : "7d";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = (() => {
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const d = new Date(now);
    d.setDate(now.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const inRange = (order, from) => new Date(order.createdAt) >= from;
  const sumRevenue = (list) => round2(list.reduce((acc, o) => acc + o.total, 0));

  const todayOrders = orders.filter((o) => inRange(o, startOfToday));
  const weekOrders = orders.filter((o) => inRange(o, startOfWeek));
  const monthOrders = orders.filter((o) => inRange(o, startOfMonth));

  // Chart buckets depend on the requested range: daily for 7 days/1 month,
  // monthly for 1 year (otherwise a year of daily bars would be unreadable).
  const chart = [];
  let chartRangeStart;
  if (range === "1y") {
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthOrdersForChart = orders.filter((o) => new Date(o.createdAt) >= monthStart && new Date(o.createdAt) < monthEnd);
      chart.push({ label: monthStart.toISOString().slice(0, 7), revenue: sumRevenue(monthOrdersForChart), count: monthOrdersForChart.length });
    }
    chartRangeStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  } else {
    const days = range === "1m" ? 29 : 6;
    for (let i = days; i >= 0; i--) {
      const dayStart = new Date(startOfToday);
      dayStart.setDate(startOfToday.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const dayOrders = orders.filter((o) => new Date(o.createdAt) >= dayStart && new Date(o.createdAt) <= dayEnd);
      chart.push({ label: dayStart.toISOString().slice(0, 10), revenue: sumRevenue(dayOrders), count: dayOrders.length });
    }
    chartRangeStart = new Date(startOfToday);
    chartRangeStart.setDate(startOfToday.getDate() - days);
  }

  // Best sellers scoped to the same range as the chart, so switching the
  // filter gives a consistent picture rather than mixing an all-time list
  // with a windowed chart.
  const rangeOrders = orders.filter((o) => new Date(o.createdAt) >= chartRangeStart);
  const itemCounts = {};
  rangeOrders.forEach((o) =>
    o.items.forEach((i) => {
      itemCounts[i.name] = (itemCounts[i.name] || 0) + i.quantity;
    })
  );
  const bestSellers = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  sendJson(res, 200, {
    today: { orders: todayOrders.length, revenue: sumRevenue(todayOrders) },
    week: { orders: weekOrders.length, revenue: sumRevenue(weekOrders) },
    month: { orders: monthOrders.length, revenue: sumRevenue(monthOrders) },
    allTime: { orders: orders.length, revenue: sumRevenue(orders) },
    range,
    chart,
    bestSellers
  });
});

// --- Menu ---
route("GET", /^\/api\/customization-options\/?$/, async (req, res) => {
  // Public - the menu page needs this to render the customize modal, no auth required.
  const options = getCustomizationOptions();
  sendJson(res, 200, {
    sizeOptions: options.sizeOptions,
    milkOptions: options.milkOptions,
    extraOptions: options.extraOptions,
    drinkSections: DRINK_SECTIONS,
    maxNotesLength: MAX_NOTES_LENGTH
  });
});

/** Validates and normalizes one edited option list (sizes/milks/extras) coming
 *  from the admin pricing grid: unique non-empty keys, finite non-negative
 *  prices, at least one entry left with a zero delta so a "no charge" pick
 *  always exists for that group. */
function validateOptionList(list, groupName) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${groupName} needs at least one option`);
  }
  const seenKeys = new Set();
  const cleaned = list.map((raw, idx) => {
    const key = String(raw.key || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const label = String(raw.label || "").trim();
    const priceDelta = Number(raw.priceDelta);
    if (!key) throw new Error(`${groupName} option ${idx + 1} needs a key`);
    if (seenKeys.has(key)) throw new Error(`${groupName} has a duplicate key: ${key}`);
    if (!label) throw new Error(`${groupName} option "${key}" needs a label`);
    if (!Number.isFinite(priceDelta) || priceDelta < 0) throw new Error(`${groupName} option "${key}" needs a valid non-negative price`);
    seenKeys.add(key);
    return { key, label, priceDelta: round2(priceDelta) };
  });
  return cleaned;
}

route("PATCH", /^\/api\/customization-options\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const body = await readBody(req);
  const current = getCustomizationOptions();

  try {
    const updated = {
      sizeOptions: body.sizeOptions !== undefined ? validateOptionList(body.sizeOptions, "Sizes") : current.sizeOptions,
      milkOptions: body.milkOptions !== undefined ? validateOptionList(body.milkOptions, "Milks") : current.milkOptions,
      extraOptions: body.extraOptions !== undefined ? validateOptionList(body.extraOptions, "Extras") : current.extraOptions
    };
    writeJson(CUSTOMIZATION_FILE, updated);
    sendJson(res, 200, updated);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

route("GET", /^\/api\/menu\/?$/, async (req, res, params, url) => {
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  // Soft-deleted items are hidden from the public/customer menu by default -
  // only the admin Menu Items screen passes includeDeleted to manage/restore them.
  const includeDeleted = url.searchParams.get("includeDeleted") === "true";
  const items = includeDeleted ? menu.items : menu.items.filter((i) => !i.deleted);
  sendJson(res, 200, { ...menu, items });
});

route("POST", /^\/api\/menu\/sections\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const title = String(body.title || "").trim();
  if (!title) return sendJson(res, 400, { error: "Section title is required" });

  // Slug the id from the title (lowercase, hyphenated), de-duplicated if it collides.
  let id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
  let suffix = 1;
  const baseId = id;
  while (menu.sections.some((s) => s.id === id)) {
    id = `${baseId}-${++suffix}`;
  }

  const section = { id, title };
  menu.sections.push(section);
  writeJson(MENU_FILE, menu);
  sendJson(res, 201, section);
});

route("DELETE", /^\/api\/menu\/sections\/(?<id>[\w-]+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const idx = menu.sections.findIndex((s) => s.id === params.id);
  if (idx === -1) return sendJson(res, 404, { error: "Section not found" });
  if (menu.items.some((i) => i.section === params.id)) {
    return sendJson(res, 400, { error: "Move or delete this section's items first" });
  }
  menu.sections.splice(idx, 1);
  writeJson(MENU_FILE, menu);
  sendJson(res, 200, { ok: true });
});

route("POST", /^\/api\/menu\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
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
  if (body.imageUrl && String(body.imageUrl).length > 8000) {
    return sendJson(res, 400, { error: "Image URL is too long" });
  }
  let stockCount = null;
  if (body.stockCount !== undefined && body.stockCount !== null && body.stockCount !== "") {
    stockCount = parseInt(body.stockCount, 10);
    if (!Number.isFinite(stockCount) || stockCount < 0) {
      return sendJson(res, 400, { error: "Stock count must be zero or a positive number, or left blank to not track stock" });
    }
  }

  const nextId = menu.items.length ? Math.max(...menu.items.map((i) => i.id)) + 1 : 1;
  const item = {
    id: nextId,
    section,
    name,
    price,
    icon: body.icon || "espresso",
    imageUrl: body.imageUrl ? String(body.imageUrl).trim() : null,
    story: body.story || "",
    promoDiscount: sanitizePromoDiscount(body.promoDiscount),
    stockCount
  };
  menu.items.push(item);
  writeJson(MENU_FILE, menu);
  sendJson(res, 201, item);
});

route("PATCH", /^\/api\/menu\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const item = menu.items.find((i) => i.id === Number(params.id));
  if (!item) return sendJson(res, 404, { error: "Item not found" });

  if (body.name !== undefined) item.name = String(body.name).trim();
  if (body.story !== undefined) item.story = String(body.story);
  if (body.icon !== undefined) item.icon = String(body.icon);
  if (body.imageUrl !== undefined) {
    if (body.imageUrl && String(body.imageUrl).length > 8000) {
      return sendJson(res, 400, { error: "Image URL is too long" });
    }
    item.imageUrl = body.imageUrl ? String(body.imageUrl).trim() : null;
  }
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
  if (body.available !== undefined) {
    item.available = Boolean(body.available);
    if (item.available) item.disableRequests = []; // re-enabling clears any pending requests
  }
  if (body.deleted !== undefined) {
    item.deleted = Boolean(body.deleted); // restoring a soft-deleted item
  }
  if (body.stockCount !== undefined) {
    if (body.stockCount === null || body.stockCount === "") {
      item.stockCount = null; // stop tracking stock for this item
    } else {
      const stockCount = parseInt(body.stockCount, 10);
      if (!Number.isFinite(stockCount) || stockCount < 0) {
        return sendJson(res, 400, { error: "Stock count must be zero or a positive number, or left blank to not track stock" });
      }
      item.stockCount = stockCount;
      if (stockCount > 0 && item.available === false) item.available = true; // restocking implicitly makes it orderable again
    }
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

/** Staff (any signed-in kitchen role) can flag an item as needing to come off
 *  the menu - e.g. ran out of stock - without themselves having permission
 *  to take it down. A manager/owner reviews and acts on it from Menu Items. */
route("POST", /^\/api\/menu\/(?<id>\d+)\/disable-request\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const item = menu.items.find((i) => i.id === Number(params.id));
  if (!item) return sendJson(res, 404, { error: "Item not found" });

  const note = sanitizeNotes(body.note || "");
  item.disableRequests = item.disableRequests || [];
  item.disableRequests.push({ by: session.name || session.username, role: session.role, note, at: new Date().toISOString() });
  writeJson(MENU_FILE, menu);
  sendJson(res, 200, item);
});

/** A manager/owner dismisses a pending disable request without taking the
 *  item down (e.g. stock is back) - separate from PATCH available:true,
 *  which also clears requests but additionally re-enables an already-off item. */
route("DELETE", /^\/api\/menu\/(?<id>\d+)\/disable-request\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const item = menu.items.find((i) => i.id === Number(params.id));
  if (!item) return sendJson(res, 404, { error: "Item not found" });
  item.disableRequests = [];
  writeJson(MENU_FILE, menu);
  sendJson(res, 200, item);
});


/** Soft-delete: never actually removes the item (order history references it
 *  by id/name, and staff may want to bring it back later) - just hides it
 *  from the customer-facing menu and disables ordering, same as "available:
 *  false" but permanent-looking rather than a temporary 86. */
route("DELETE", /^\/api\/menu\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const item = menu.items.find((i) => i.id === Number(params.id));
  if (!item) return sendJson(res, 404, { error: "Item not found" });
  item.deleted = true;
  item.available = false;
  writeJson(MENU_FILE, menu);
  sendJson(res, 200, { ok: true });
});

// --- Combos (bundled deals sold at a discount vs buying items separately) ---
route("GET", /^\/api\/combos\/?$/, async (req, res) => {
  // Public - the menu page needs this to show combo deals to anyone browsing.
  const combos = readJson(COMBOS_FILE, []);
  sendJson(res, 200, combos.filter((c) => c.active !== false));
});

route("POST", /^\/api\/combos\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const combos = readJson(COMBOS_FILE, []);

  const name = String(body.name || "").trim();
  const price = Number(body.price);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((i) => ({ id: Number(i.id), quantity: Math.max(1, Math.min(20, parseInt(i.quantity, 10) || 1)) }))
    .filter((i) => menu.items.some((m) => m.id === i.id));

  if (!name || !Number.isFinite(price) || price <= 0) {
    return sendJson(res, 400, { error: "name and a positive price are required" });
  }
  if (items.length < 2) {
    return sendJson(res, 400, { error: "A combo needs at least 2 valid menu items" });
  }

  const nextId = combos.length ? Math.max(...combos.map((c) => c.id)) + 1 : 1;
  const combo = { id: nextId, name, description: String(body.description || ""), items, price, active: true };
  combos.push(combo);
  writeJson(COMBOS_FILE, combos);
  sendJson(res, 201, combo);
});

route("PATCH", /^\/api\/combos\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const combos = readJson(COMBOS_FILE, []);
  const combo = combos.find((c) => c.id === Number(params.id));
  if (!combo) return sendJson(res, 404, { error: "Combo not found" });

  if (body.name !== undefined) combo.name = String(body.name).trim();
  if (body.description !== undefined) combo.description = String(body.description);
  if (body.active !== undefined) combo.active = Boolean(body.active);
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) return sendJson(res, 400, { error: "Invalid price" });
    combo.price = price;
  }
  if (body.items !== undefined) {
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i) => ({ id: Number(i.id), quantity: Math.max(1, Math.min(20, parseInt(i.quantity, 10) || 1)) }))
      .filter((i) => menu.items.some((m) => m.id === i.id));
    if (items.length < 2) return sendJson(res, 400, { error: "A combo needs at least 2 valid menu items" });
    combo.items = items;
  }

  writeJson(COMBOS_FILE, combos);
  sendJson(res, 200, combo);
});

route("DELETE", /^\/api\/combos\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const combos = readJson(COMBOS_FILE, []);
  const idx = combos.findIndex((c) => c.id === Number(params.id));
  if (idx === -1) return sendJson(res, 404, { error: "Combo not found" });
  combos.splice(idx, 1);
  writeJson(COMBOS_FILE, combos);
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
    "gstNumber",
    "heroTagline",
    "heroBadgeText",
    "receiptFooterText",
    "tipEnabled",
    "tipAmount",
    "cgstRate",
    "sgstRate",
    "serviceChargeRate",
    "theme",
    "heroImageUrl",
    "logoUrl",
    "upiVpa",
    "upiPayeeName",
    "tableCount"
  ];
  for (const key of allowed) {
    if (body[key] !== undefined) config[key] = body[key];
  }
  if (body.loyalty && typeof body.loyalty === "object") {
    config.loyalty = { ...config.loyalty, ...body.loyalty };
    config.loyalty.enabled = Boolean(config.loyalty.enabled);
    const per = Number(config.loyalty.pointsPerRupeeSpent);
    const val = Number(config.loyalty.rupeeValuePerPoint);
    config.loyalty.pointsPerRupeeSpent = Number.isFinite(per) && per >= 0 ? per : 0.1;
    config.loyalty.rupeeValuePerPoint = Number.isFinite(val) && val >= 0 ? val : 0.5;
  }
  if (config.tableCount !== undefined) {
    const n = parseInt(config.tableCount, 10);
    config.tableCount = Number.isFinite(n) && n >= 0 ? Math.min(n, 200) : 10;
  }
  // shopName/heroTagline are rendered directly into the home page - cap
  // length and strip control chars so a bad paste can't break layout.
  if (typeof config.shopName === "string") config.shopName = config.shopName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  if (typeof config.gstNumber === "string") config.gstNumber = Array.from(config.gstNumber).filter(function (ch) { return ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127; }).join("").trim().toUpperCase().slice(0, 20);
  if (typeof config.receiptFooterText === "string") config.receiptFooterText = config.receiptFooterText.trim().slice(0, 120);
  if (typeof config.heroTagline === "string") config.heroTagline = config.heroTagline.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 400);
  if (typeof config.heroBadgeText === "string") {
    config.heroBadgeText = Array.from(config.heroBadgeText)
      .filter(function (ch) { return ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127; })
      .join("")
      .trim()
      .slice(0, 80);
  }
  // Colors, footer, and customIcons are objects - merge individual keys
  // instead of replacing the whole thing, so a partial update (e.g. just
  // "accent", or just one new icon) doesn't wipe out the rest.
  if (body.colors && typeof body.colors === "object") {
    config.colors = { ...config.colors, ...body.colors };
  }
  // textStyles: font size (pt) + color for the admin tab-nav row and the
  // muted helper/description paragraphs - merge per sub-key like colors,
  // and clamp fontSize to a sane range so a bad value can't make the admin
  // panel unreadably tiny/huge or break layout.
  if (body.textStyles && typeof body.textStyles === "object") {
    config.textStyles = config.textStyles || { ...DEFAULT_BRANDING.textStyles };
    for (const key of ["adminTabs", "adminHelp", "adminLabels"]) {
      if (body.textStyles[key] && typeof body.textStyles[key] === "object") {
        const existing = config.textStyles[key] || DEFAULT_BRANDING.textStyles[key];
        const merged = { ...existing, ...body.textStyles[key] };
        const size = Number(merged.fontSize);
        merged.fontSize = Number.isFinite(size) ? Math.min(24, Math.max(5, size)) : existing.fontSize;
        config.textStyles[key] = merged;
      }
    }
  }
  if (body.footer && typeof body.footer === "object") {
    config.footer = { ...config.footer, ...body.footer };
  }
  if (body.customIcons && typeof body.customIcons === "object") {
    config.customIcons = { ...config.customIcons, ...body.customIcons };
  }
  if (body.arcade && typeof body.arcade === "object") {
    config.arcade = { ...config.arcade, ...body.arcade };
    config.arcade.enabled = config.arcade.enabled !== false;
    const hours = Number(config.arcade.sessionHours);
    config.arcade.sessionHours = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24) : 2;
  }
  // Home page "This week's picks" - which items feature there and what tag
  // each shows (e.g. "House favourite"). Replaced wholesale (not merged like
  // colors/footer above) since it's an ordered, curated list, not a bag of
  // independent keys - a partial update wouldn't make sense here. Falls back
  // to the original auto-picked-from-first-section behavior on the client
  // (see renderPopularPicks() in app.js) whenever this is empty/unset, so a
  // fresh install with no curation yet still shows something.
  if (Array.isArray(body.homePicks)) {
    const menu = readJson(MENU_FILE, { items: [] });
    const validItemIds = new Set(menu.items.map((i) => i.id));
    config.homePicks = body.homePicks
      .filter((p) => p && validItemIds.has(Number(p.itemId)))
      .slice(0, 12)
      .map((p) => ({
        itemId: Number(p.itemId),
        tag: String(p.tag || "")
          .replace(/[\r\n\t]/g, " ")
          .trim()
          .slice(0, 40)
      }));
  }
  // Home page "How we roast" story steps - was a hardcoded array in app.js
  // (renderHomeRoastSteps), same reasoning as homePicks: replaced wholesale
  // since it's an ordered story, not independent keys. Empty/unset falls
  // back to the original hardcoded steps client-side.
  if (Array.isArray(body.roastSteps)) {
    config.roastSteps = body.roastSteps
      .filter((s) => s && (s.name || s.detail))
      .slice(0, 6)
      .map((s) => ({
        name: String(s.name || "").trim().slice(0, 40),
        detail: String(s.detail || "").trim().slice(0, 160)
      }));
  }
  // The three home page section headings ("This week's picks"/"How we
  // roast"/"Find us") - were hardcoded text in index.html.
  if (body.homeHeadings && typeof body.homeHeadings === "object") {
    config.homeHeadings = { ...config.homeHeadings };
    for (const key of ["picks", "roast", "findUs"]) {
      if (typeof body.homeHeadings[key] === "string") {
        config.homeHeadings[key] = body.homeHeadings[key].trim().slice(0, 60);
      }
    }
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

// ---------------------------------------------------------------------------
// Image uploads (menu item photos, hero/storefront image, logo) - a plain
// on-disk bucket under UPLOADS_DIR rather than an external object-storage
// service, consistent with this app's whole "no external dependencies, just
// JSON files on disk" approach. Uploaded as a base64 data URL in a JSON body
// rather than multipart/form-data, since the raw http module here has no
// multipart parser and adding one just for this felt like more risk than a
// same-style JSON endpoint. Staff-only (KITCHEN_ROLES) - customers never
// upload anything.
// ---------------------------------------------------------------------------

const UPLOAD_MIME_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg"
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB decoded

route("GET", /^\/api\/uploads\/?$/, async (req, res) => {
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  const uploads = readJson(UPLOADS_MANIFEST_FILE, []);
  sendJson(
    res,
    200,
    uploads.map((u) => ({ ...u, url: `/uploads/${u.filename}` })).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
  );
});

route("POST", /^\/api\/uploads\/?$/, async (req, res) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  // Base64 inflates size by ~33% - allow enough body room for a 5MB image
  // plus JSON overhead, then re-check the actual decoded size below.
  let body;
  try {
    body = await readBody(req, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096);
  } catch (e) {
    return sendJson(res, 413, { error: "Image too large (max 5MB)" });
  }
  const mimeType = String(body.mimeType || "");
  const ext = UPLOAD_MIME_EXT[mimeType];
  if (!ext) return sendJson(res, 400, { error: "Unsupported image type - use PNG, JPEG, GIF, WEBP, or SVG" });
  const dataUrlPrefix = /^data:[^;]+;base64,/;
  const base64 = String(body.dataBase64 || "").replace(dataUrlPrefix, "");
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch (e) {
    return sendJson(res, 400, { error: "Invalid image data" });
  }
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    return sendJson(res, 413, { error: "Image too large (max 5MB)" });
  }
  const id = crypto.randomBytes(8).toString("hex");
  const filename = `${id}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

  const uploads = readJson(UPLOADS_MANIFEST_FILE, []);
  const entry = {
    id,
    filename,
    // Original filename is only ever displayed as text in the admin picker,
    // never used to build a path - stripped/capped so a weird paste can't
    // break that list's layout.
    originalName: Array.from(String(body.originalName || filename))
      .filter(function (ch) { return ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127; })
      .join("")
      .slice(0, 120),
    mimeType,
    sizeBytes: buffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: session.name || session.role
  };
  uploads.push(entry);
  writeJson(UPLOADS_MANIFEST_FILE, uploads);
  sendJson(res, 201, { ...entry, url: `/uploads/${filename}` });
});

route("DELETE", /^\/api\/uploads\/(?<id>[\w-]+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  const uploads = readJson(UPLOADS_MANIFEST_FILE, []);
  const entry = uploads.find((u) => u.id === params.id);
  if (!entry) return sendJson(res, 404, { error: "Upload not found" });
  try {
    fs.unlinkSync(path.join(UPLOADS_DIR, entry.filename));
  } catch (e) {
    // Already gone from disk somehow - still clean up the manifest entry below.
  }
  writeJson(
    UPLOADS_MANIFEST_FILE,
    uploads.filter((u) => u.id !== params.id)
  );
  sendJson(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// Data backup/restore - since this whole app is just JSON files on disk with
// no real database, a full backup is just bundling those files into one
// downloadable JSON. Restoring is the risky direction (silently overwrites
// live data), so it's owner-only and requires the same "confirmYes"-style
// explicit body flag the client's confirm dialog sets, not just a valid
// file upload - a stray automated retry can't wipe live data by accident.
// Uploaded images themselves (uploads/*.svg etc.) are NOT included - only
// their metadata (uploads.json) is, same as everything else here being
// metadata/records rather than binary blobs.
// ---------------------------------------------------------------------------
const BACKUP_FILES = {
  "config.json": CONFIG_FILE,
  "menu.json": MENU_FILE,
  "users.json": USERS_FILE,
  "orders.json": ORDERS_FILE,
  "combos.json": COMBOS_FILE,
  "coupons.json": COUPONS_FILE,
  "table-sessions.json": TABLE_SESSIONS_FILE,
  "favorites.json": FAVORITES_FILE,
  "arcade-scores.json": ARCADE_SCORES_FILE,
  "stores.json": STORES_FILE,
  "timeclock.json": TIMECLOCK_FILE,
  "payroll.json": PAYROLL_FILE,
  "attendance.json": ATTENDANCE_FILE,
  "overtime-approvals.json": OVERTIME_APPROVALS_FILE,
  "uploads.json": UPLOADS_MANIFEST_FILE,
  "branding-profiles.json": BRANDING_PROFILES_FILE
};

route("GET", /^\/api\/admin\/backup\/?$/, async (req, res) => {
  const session = requireRole(req, res, ["owner"]);
  if (!session) return;
  const files = {};
  for (const [name, filePath] of Object.entries(BACKUP_FILES)) {
    files[name] = readJson(filePath, null);
  }
  const backup = { exportedAt: new Date().toISOString(), files };
  const body = JSON.stringify(backup, null, 2);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"`
  });
  res.end(body);
});

route("POST", /^\/api\/admin\/restore\/?$/, async (req, res) => {
  const session = requireRole(req, res, ["owner"]);
  if (!session) return;
  let body;
  try {
    body = await readBody(req, 20 * 1024 * 1024); // backups can be a few MB with enough order history
  } catch (e) {
    return sendJson(res, 413, { error: "Backup file too large" });
  }
  if (!body.confirmYes) {
    return sendJson(res, 400, { error: "Missing confirmation" });
  }
  if (!body.files || typeof body.files !== "object") {
    return sendJson(res, 400, { error: "That doesn't look like a backup file" });
  }
  let restoredCount = 0;
  for (const [name, filePath] of Object.entries(BACKUP_FILES)) {
    if (body.files[name] !== undefined && body.files[name] !== null) {
      writeJson(filePath, body.files[name]);
      restoredCount++;
    }
  }
  sendJson(res, 200, { ok: true, restoredCount });
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
  config.textStyles = {
    adminTabs: { ...DEFAULT_BRANDING.textStyles.adminTabs },
    adminHelp: { ...DEFAULT_BRANDING.textStyles.adminHelp },
    adminLabels: { ...DEFAULT_BRANDING.textStyles.adminLabels }
  };
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

// --- Orders ---
route("GET", /^\/api\/orders\/?$/, async (req, res) => {
  // Full order list is for staff running the register/kitchen/admin views only.
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  sendJson(res, 200, readJson(ORDERS_FILE, []));
});

route("GET", /^\/api\/orders\/mine\/?$/, async (req, res) => {
  // A customer sees only orders tied to their account; a guest sees only
  // orders tied to the phone number they logged in with - never anyone
  // else's. Staff roles (owner/admin/manager/employee) don't place orders
  // as a customer, so they simply get an empty list rather than a 403 -
  // "My Orders" should be usable by anyone signed in, not just customers.
  const session = requireSession(req, res);
  if (!session) return;

  const orders = readJson(ORDERS_FILE, []);
  let mine = [];
  if (session.role === "customer") {
    mine = orders.filter((o) => o.customerId === session.userId);
  } else if (session.role === "guest") {
    mine = orders.filter((o) => o.customerPhone === session.phone);
  }
  mine = mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10).map((o) => ({ ...o, status: orderStatusOf(o) }));

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
    const customerId = session.role === "customer" ? session.userId : null;
    computed = computeOrder(Array.isArray(body.items) ? body.items : [], method, serviceChargeActive, tipApplied, {
      couponCode: body.couponCode || null,
      redeemPoints: parseInt(body.redeemPoints, 10) || 0,
      customerId
    });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const orders = readJson(ORDERS_FILE, []);
  // Staff placing an order at the counter on a customer's behalf can mark it
  // paid immediately (cash already collected) instead of having to find it
  // in Order History afterwards - customers/guests can never self-mark paid.
  const staffMarkedPaid = KITCHEN_ROLES.includes(session.role) && body.markPaidNow === true;
  const order = {
    id: `SB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    orderNumber: generateOrderNumber(orders),
    createdAt: new Date().toISOString(),
    method,
    isPaid: method === "ONLINE" || staffMarkedPaid, // still trust-based until a real payment webhook is wired up - see README
    paymentMethod: method === "ONLINE" ? "UPI" : staffMarkedPaid ? "Cash" : null,
    tipApplied,
    serviceChargeActive,
    customerId: session.role === "customer" ? session.userId : null,
    customerName: session.name || null,
    customerPhone: phone,
    placedByStaff: KITCHEN_ROLES.includes(session.role) ? session.name : null,
    // Only staff can tag an order to an open table tab, and only if that
    // table is actually still open - never trust an arbitrary id from the client.
    tableSessionId: null,
    ...computed
  };
  orders.push(order);

  // Validate the requested table tag AFTER building the order object, since
  // it needs to override the tableSessionId:null default above.
  if (KITCHEN_ROLES.includes(session.role) && body.tableSessionId) {
    const tableSessions = readJson(TABLE_SESSIONS_FILE, []);
    const targetTable = tableSessions.find((t) => t.id === body.tableSessionId && t.status === "open");
    if (targetTable) {
      order.tableSessionId = targetTable.id;
      order.tableNumber = targetTable.tableNumber; // denormalized for KOT/Bill display even after the table later closes
    }
  }

  writeJson(ORDERS_FILE, orders);

  // Side effects that only happen once the order is confirmed real: burn a
  // coupon use, debit redeemed loyalty points, credit newly-earned ones.
  if (order.couponId) {
    const coupons = readJson(COUPONS_FILE, []);
    const c = coupons.find((x) => x.id === order.couponId);
    if (c) {
      c.usedCount = (c.usedCount || 0) + 1;
      writeJson(COUPONS_FILE, coupons);
    }
  }
  if (order.customerId && (order.loyaltyPointsRedeemed > 0 || order.loyaltyPointsEarned > 0)) {
    const users = readJson(USERS_FILE, []);
    const user = users.find((u) => u.id === order.customerId);
    if (user) {
      user.loyaltyPoints = Math.max(0, (user.loyaltyPoints || 0) - order.loyaltyPointsRedeemed + order.loyaltyPointsEarned);
      writeJson(USERS_FILE, users);
    }
  }
  // Decrement stock for any tracked item (combo lines included - they carry
  // the component's own menu id, so a combo purchase draws down its
  // components' stock too). Items with stockCount === null are untracked
  // and never touched here.
  {
    const menuForStock = readJson(MENU_FILE, { sections: [], items: [] });
    let stockChanged = false;
    for (const line of order.items) {
      if (line.id == null) continue;
      const product = menuForStock.items.find((i) => i.id === line.id);
      if (!product || product.stockCount == null) continue;
      product.stockCount = Math.max(0, product.stockCount - line.quantity);
      if (product.stockCount === 0) product.available = false;
      stockChanged = true;
    }
    if (stockChanged) writeJson(MENU_FILE, menuForStock);
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
    order.paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : "Cash";
  } else if (body.action === "markDone") {
    const station = body.station;
    order.items.forEach((i) => {
      if (!station || station === "MASTER" || i.station === station) i.isDone = true;
    });
  } else if (body.action === "markServed") {
    // Only meaningful once every item is actually ready - staff hand off a
    // partially-made order to nobody. Idempotent (re-marking an already-
    // served order just no-ops) rather than erroring, since a double-tap
    // shouldn't need special handling on the client.
    if (!order.items.length || !order.items.every((i) => i.isDone)) {
      return sendJson(res, 400, { error: "Order isn't ready yet" });
    }
    if (!order.servedAt) order.servedAt = new Date().toISOString();
  } else {
    return sendJson(res, 400, { error: "Unknown action" });
  }

  writeJson(ORDERS_FILE, orders);
  broadcastOrdersChanged();
  sendJson(res, 200, order);
});

/** The customer/guest who placed the order rates it, once - same ownership
 *  check as GET /api/orders/mine (never trust an id alone; a guest/customer
 *  could otherwise rate any order by guessing its id). Re-submitting
 *  overwrites the previous rating rather than erroring, so someone can
 *  correct a misclick. */
route("POST", /^\/api\/orders\/(?<id>[\w-]+)\/feedback\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const orders = readJson(ORDERS_FILE, []);
  const order = orders.find((o) => o.id === params.id);
  if (!order) return sendJson(res, 404, { error: "Order not found" });

  const owns =
    (session.role === "customer" && order.customerId === session.userId) ||
    (session.role === "guest" && order.customerPhone === session.phone);
  if (!owns) return sendJson(res, 403, { error: "This isn't your order" });

  const rating = parseInt(body.rating, 10);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return sendJson(res, 400, { error: "Rating must be between 1 and 5" });
  }
  const comment = String(body.comment || "").trim().slice(0, 500);

  order.rating = rating;
  order.feedbackComment = comment;
  order.feedbackAt = new Date().toISOString();
  writeJson(ORDERS_FILE, orders);
  sendJson(res, 200, { rating: order.rating, comment: order.feedbackComment });
});

route("GET", /^\/api\/favorites\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const favorites = readJson(FAVORITES_FILE, []);
  const key = favoritesOwnerKey(session);
  const itemIds = favorites.filter((f) => f.ownerKey === key).map((f) => f.itemId);
  sendJson(res, 200, itemIds);
});

route("POST", /^\/api\/favorites\/(?<itemId>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const itemId = Number(params.itemId);
  const menu = readJson(MENU_FILE, { items: [] });
  if (!menu.items.find((i) => i.id === itemId)) {
    return sendJson(res, 404, { error: "Menu item not found" });
  }
  const favorites = readJson(FAVORITES_FILE, []);
  const key = favoritesOwnerKey(session);
  if (!favorites.find((f) => f.ownerKey === key && f.itemId === itemId)) {
    favorites.push({ ownerKey: key, itemId });
    writeJson(FAVORITES_FILE, favorites);
  }
  sendJson(res, 200, { ok: true });
});

route("DELETE", /^\/api\/favorites\/(?<itemId>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const itemId = Number(params.itemId);
  const favorites = readJson(FAVORITES_FILE, []);
  const key = favoritesOwnerKey(session);
  writeJson(
    FAVORITES_FILE,
    favorites.filter((f) => !(f.ownerKey === key && f.itemId === itemId))
  );
  sendJson(res, 200, { ok: true });
});

// Per-user preferences (currently just the staff rail/top-bar layout choice)
// - one object keyed by userId, {} until someone has actually set anything.
route("GET", /^\/api\/user-preferences\/?$/, async (req, res) => {
  const session = currentSession(req);
  if (!session || session.userId == null) return sendJson(res, 200, {});
  const all = readJson(USER_PREFERENCES_FILE, {});
  sendJson(res, 200, all[session.userId] || {});
});

route("PATCH", /^\/api\/user-preferences\/?$/, async (req, res) => {
  const session = currentSession(req);
  if (!session || session.userId == null) return sendJson(res, 401, { error: "Not authenticated" });
  const body = await readBody(req);
  if (body.layout && !["rail", "topbar"].includes(body.layout)) {
    return sendJson(res, 400, { error: "Invalid layout" });
  }
  const all = readJson(USER_PREFERENCES_FILE, {});
  all[session.userId] = { ...all[session.userId], ...(body.layout ? { layout: body.layout } : {}) };
  writeJson(USER_PREFERENCES_FILE, all);
  sendJson(res, 200, all[session.userId]);
});

// ---------------------------------------------------------------------------
// Coupons (discount codes) - created by manager/admin/owner. A usageLimit of
// null means "usable until stopped" (manually deactivated), rather than a
// fixed number of redemptions.
// ---------------------------------------------------------------------------

function findValidCoupon(code, coupons) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  const coupon = coupons.find((c) => c.code === normalized);
  if (!coupon || !coupon.active) return null;
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return null;
  return coupon;
}

function computeCouponDiscount(coupon, subtotal) {
  if (!coupon) return 0;
  const raw = coupon.type === "percent" ? subtotal * (coupon.value / 100) : coupon.value;
  return round2(Math.min(raw, subtotal)); // never discount below zero
}

route("GET", /^\/api\/coupons\/?$/, async (req, res) => {
  // Manager/owner only - returns everything, including private/stopped/
  // exhausted codes. The public listing below is a separate, filtered route.
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  sendJson(res, 200, readJson(COUPONS_FILE, []));
});

/** Lets a customer self-serve the list of codes worth trying at checkout.
 *  Private coupons and anything inactive/exhausted never appear here - do
 *  NOT reuse the manager-only GET /api/coupons above for this. */
route("GET", /^\/api\/coupons\/public\/?$/, async (req, res) => {
  if (!requireSession(req, res)) return;
  const coupons = readJson(COUPONS_FILE, [])
    .filter((c) => c.active && !c.private)
    .filter((c) => c.usageLimit === null || c.usedCount < c.usageLimit)
    .map((c) => ({ code: c.code, type: c.type, value: c.value }));
  sendJson(res, 200, coupons);
});

route("POST", /^\/api\/coupons\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const coupons = readJson(COUPONS_FILE, []);

  const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const type = body.type === "flat" ? "flat" : "percent";
  const value = Number(body.value);
  const usageLimit = body.usageLimit === null || body.usageLimit === "" || body.usageLimit === undefined ? null : parseInt(body.usageLimit, 10);

  if (!code) return sendJson(res, 400, { error: "Coupon code is required" });
  if (coupons.some((c) => c.code === code)) return sendJson(res, 400, { error: "A coupon with this code already exists" });
  if (!Number.isFinite(value) || value <= 0) return sendJson(res, 400, { error: "Enter a valid discount value" });
  if (type === "percent" && value > 100) return sendJson(res, 400, { error: "Percent discount can't exceed 100" });
  if (usageLimit !== null && (!Number.isFinite(usageLimit) || usageLimit <= 0)) return sendJson(res, 400, { error: "Usage limit must be a positive number, or left blank for unlimited" });

  const coupon = {
    id: coupons.length ? Math.max(...coupons.map((c) => c.id)) + 1 : 1,
    code,
    type,
    value,
    usageLimit,
    usedCount: 0,
    active: true,
    private: !!body.private, // default false = public, listed in GET /api/coupons/public
    createdBy: session.name,
    createdAt: new Date().toISOString()
  };
  coupons.push(coupon);
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 201, coupon);
});

route("PATCH", /^\/api\/coupons\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const body = await readBody(req);
  const coupons = readJson(COUPONS_FILE, []);
  const coupon = coupons.find((c) => c.id === Number(params.id));
  if (!coupon) return sendJson(res, 404, { error: "Coupon not found" });

  if (body.active !== undefined) coupon.active = Boolean(body.active);
  if (body.private !== undefined) coupon.private = Boolean(body.private);
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 200, coupon);
});

route("DELETE", /^\/api\/coupons\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const coupons = readJson(COUPONS_FILE, []);
  const idx = coupons.findIndex((c) => c.id === Number(params.id));
  if (idx === -1) return sendJson(res, 404, { error: "Coupon not found" });
  coupons.splice(idx, 1);
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 200, { ok: true });
});

/** Checkout-time preview - any signed-in role can check a code's validity
 *  and discount amount without redeeming it (redemption/usedCount happens
 *  only at real order creation, so previewing never burns a use). */
route("POST", /^\/api\/coupons\/validate\/?$/, async (req, res) => {
  if (!requireSession(req, res)) return;
  const body = await readBody(req);
  const coupons = readJson(COUPONS_FILE, []);
  const coupon = findValidCoupon(body.code, coupons);
  if (!coupon) return sendJson(res, 404, { error: "Invalid or expired coupon code" });
  const subtotal = Number(body.subtotal) || 0;
  sendJson(res, 200, { code: coupon.code, type: coupon.type, value: coupon.value, discountAmount: computeCouponDiscount(coupon, subtotal) });
});

// ---------------------------------------------------------------------------
// Arcade (ARCADE nav tab) - in-store only. A customer/guest unlocks it for
// config.arcade.sessionHours after placing an order (see arcadeAccessInfo).
// Tic-Tac-Toe match state is in-memory, not persisted - a server restart
// mid-match just ends it, an acceptable trade for a "something to do while
// you wait" feature rather than anything stakes-bearing. High scores ARE
// persisted (ARCADE_SCORES_FILE) since there's no ongoing state to lose.
// ---------------------------------------------------------------------------

function arcadeOwnerKey(session) {
  return session.role === "customer" ? `customer:${session.userId}` : `guest:${session.phone}`;
}

function arcadeAccessInfo(session) {
  const config = readJson(CONFIG_FILE, {});
  const arcadeConfig = config.arcade || { enabled: true, sessionHours: 2 };
  if (!arcadeConfig.enabled) {
    return { allowed: false, reason: "The arcade isn't available right now." };
  }
  const orders = readJson(ORDERS_FILE, []);
  let mine = [];
  if (session.role === "customer") mine = orders.filter((o) => o.customerId === session.userId);
  else if (session.role === "guest") mine = orders.filter((o) => o.customerPhone === session.phone);
  if (mine.length === 0) {
    return { allowed: false, reason: "Place an order to unlock the arcade." };
  }
  const latest = mine.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b));
  const expiresAt = new Date(new Date(latest.createdAt).getTime() + arcadeConfig.sessionHours * 3600000);
  const allowed = expiresAt.getTime() > Date.now();
  return {
    allowed,
    expiresAt: expiresAt.toISOString(),
    reason: allowed ? null : "Your arcade session has expired - place a new order to keep playing."
  };
}

route("GET", /^\/api\/arcade\/access\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  sendJson(res, 200, arcadeAccessInfo(session));
});

route("GET", /^\/api\/arcade\/scores\/?$/, async (req, res, params, url) => {
  const session = requireSession(req, res);
  if (!session) return;
  const game = url.searchParams.get("game");
  if (!game) return sendJson(res, 400, { error: "game is required" });
  const scores = readJson(ARCADE_SCORES_FILE, [])
    .filter((s) => s.game === game)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  sendJson(res, 200, scores);
});

route("POST", /^\/api\/arcade\/scores\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const access = arcadeAccessInfo(session);
  if (!access.allowed) return sendJson(res, 403, { error: access.reason });
  const body = await readBody(req);
  const game = String(body.game || "");
  const KNOWN_GAMES = ["tetris", "tictactoe", "snake", "pong", "memory", "simon", "minesweeper", "2048", "breakout", "flappy", "invaders", "connectfour", "checkers"];
  if (!KNOWN_GAMES.includes(game)) return sendJson(res, 400, { error: "Unknown game" });
  const score = parseInt(body.score, 10);
  if (!Number.isFinite(score) || score <= 0 || score > 1000000) {
    return sendJson(res, 400, { error: "Invalid score" });
  }
  const scores = readJson(ARCADE_SCORES_FILE, []);
  scores.push({
    id: scores.length ? Math.max(...scores.map((s) => s.id)) + 1 : 1,
    game,
    name: session.name || "Player",
    score,
    achievedAt: new Date().toISOString()
  });
  writeJson(ARCADE_SCORES_FILE, scores);
  sendJson(res, 201, { ok: true });
});

// --- Tic-Tac-Toe vs another in-store player ---
// A single waiting slot (not a full queue - this is a small in-store
// arcade, not a matchmaking platform) pairs the next two players who ask.
// Broadcasts on the same SSE channel orders use (see broadcastOrdersChanged/
// sseClients) rather than opening a second stream - clients already
// listening for "orders" events also listen for "arcade" ones and re-fetch
// match state through the endpoints below.
let arcadeWaitingPlayer = null; // { key, name } | null
const arcadeMatches = new Map(); // matchId -> match
let nextArcadeMatchId = 1;

function broadcastArcadeChanged() {
  for (const res of sseClients) {
    res.write("event: arcade\ndata: changed\n\n");
  }
}

function findArcadeMatchForPlayer(key) {
  for (const match of arcadeMatches.values()) {
    if (match.players.includes(key)) return match;
  }
  return null;
}

function checkTicTacToeWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every((cell) => cell) ? "draw" : null;
}

route("POST", /^\/api\/arcade\/tictactoe\/queue\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const access = arcadeAccessInfo(session);
  if (!access.allowed) return sendJson(res, 403, { error: access.reason });

  const key = arcadeOwnerKey(session);
  const existingMatch = findArcadeMatchForPlayer(key);
  if (existingMatch) return sendJson(res, 200, { status: "matched", matchId: existingMatch.id });

  if (arcadeWaitingPlayer && arcadeWaitingPlayer.key !== key) {
    const match = {
      id: nextArcadeMatchId++,
      players: [arcadeWaitingPlayer.key, key],
      names: [arcadeWaitingPlayer.name, session.name || "Player"],
      board: Array(9).fill(null),
      turn: 0,
      winner: null,
      createdAt: new Date().toISOString()
    };
    arcadeMatches.set(match.id, match);
    arcadeWaitingPlayer = null;
    broadcastArcadeChanged();
    return sendJson(res, 200, { status: "matched", matchId: match.id });
  }

  arcadeWaitingPlayer = { key, name: session.name || "Player" };
  sendJson(res, 200, { status: "waiting" });
});

route("POST", /^\/api\/arcade\/tictactoe\/cancel\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const key = arcadeOwnerKey(session);
  if (arcadeWaitingPlayer && arcadeWaitingPlayer.key === key) arcadeWaitingPlayer = null;
  sendJson(res, 200, { ok: true });
});

route("GET", /^\/api\/arcade\/tictactoe\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const match = arcadeMatches.get(Number(params.id));
  if (!match) return sendJson(res, 404, { error: "Match not found" });
  const key = arcadeOwnerKey(session);
  const you = match.players.indexOf(key);
  if (you === -1) return sendJson(res, 403, { error: "Not your match" });
  sendJson(res, 200, { ...match, you });
});

route("POST", /^\/api\/arcade\/tictactoe\/(?<id>\d+)\/move\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const match = arcadeMatches.get(Number(params.id));
  if (!match) return sendJson(res, 404, { error: "Match not found" });
  const key = arcadeOwnerKey(session);
  const playerIndex = match.players.indexOf(key);
  if (playerIndex === -1) return sendJson(res, 403, { error: "Not your match" });
  if (match.winner) return sendJson(res, 400, { error: "Game already over" });
  if (match.turn !== playerIndex) return sendJson(res, 400, { error: "Not your turn" });

  const body = await readBody(req);
  const cell = parseInt(body.cell, 10);
  if (!Number.isFinite(cell) || cell < 0 || cell > 8 || match.board[cell]) {
    return sendJson(res, 400, { error: "Invalid move" });
  }

  match.board[cell] = playerIndex === 0 ? "X" : "O";
  match.winner = checkTicTacToeWinner(match.board);
  match.turn = playerIndex === 0 ? 1 : 0;
  broadcastArcadeChanged();
  sendJson(res, 200, { ...match, you: playerIndex });
});

route("POST", /^\/api\/arcade\/tictactoe\/(?<id>\d+)\/leave\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  arcadeMatches.delete(Number(params.id));
  broadcastArcadeChanged();
  sendJson(res, 200, { ok: true });
});

// --- Connect Four vs another in-store player ---
// Same single-waiting-slot pairing as Tic-Tac-Toe, separate queue/match
// pools so the two games don't cross-pair players.
let connectFourWaitingPlayer = null;
const connectFourMatches = new Map();
let nextConnectFourMatchId = 1;
const C4_ROWS = 6;
const C4_COLS = 7;

function findConnectFourMatchForPlayer(key) {
  for (const match of connectFourMatches.values()) {
    if (match.players.includes(key)) return match;
  }
  return null;
}

function checkConnectFourWinner(board) {
  const get = (r, c) => board[r * C4_COLS + c];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const cell = get(r, c);
      if (!cell) continue;
      for (const [dr, dc] of dirs) {
        let count = 1;
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= C4_ROWS || nc < 0 || nc >= C4_COLS || get(nr, nc) !== cell) break;
          count++;
        }
        if (count >= 4) return cell;
      }
    }
  }
  return board.every((c) => c) ? "draw" : null;
}

route("POST", /^\/api\/arcade\/connectfour\/queue\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const access = arcadeAccessInfo(session);
  if (!access.allowed) return sendJson(res, 403, { error: access.reason });

  const key = arcadeOwnerKey(session);
  const existingMatch = findConnectFourMatchForPlayer(key);
  if (existingMatch) return sendJson(res, 200, { status: "matched", matchId: existingMatch.id });

  if (connectFourWaitingPlayer && connectFourWaitingPlayer.key !== key) {
    const match = {
      id: nextConnectFourMatchId++,
      players: [connectFourWaitingPlayer.key, key],
      names: [connectFourWaitingPlayer.name, session.name || "Player"],
      board: Array(C4_ROWS * C4_COLS).fill(null),
      turn: 0,
      winner: null,
      createdAt: new Date().toISOString()
    };
    connectFourMatches.set(match.id, match);
    connectFourWaitingPlayer = null;
    broadcastArcadeChanged();
    return sendJson(res, 200, { status: "matched", matchId: match.id });
  }

  connectFourWaitingPlayer = { key, name: session.name || "Player" };
  sendJson(res, 200, { status: "waiting" });
});

route("POST", /^\/api\/arcade\/connectfour\/cancel\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const key = arcadeOwnerKey(session);
  if (connectFourWaitingPlayer && connectFourWaitingPlayer.key === key) connectFourWaitingPlayer = null;
  sendJson(res, 200, { ok: true });
});

route("GET", /^\/api\/arcade\/connectfour\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const match = connectFourMatches.get(Number(params.id));
  if (!match) return sendJson(res, 404, { error: "Match not found" });
  const key = arcadeOwnerKey(session);
  const you = match.players.indexOf(key);
  if (you === -1) return sendJson(res, 403, { error: "Not your match" });
  sendJson(res, 200, { ...match, you });
});

route("POST", /^\/api\/arcade\/connectfour\/(?<id>\d+)\/move\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const match = connectFourMatches.get(Number(params.id));
  if (!match) return sendJson(res, 404, { error: "Match not found" });
  const key = arcadeOwnerKey(session);
  const playerIndex = match.players.indexOf(key);
  if (playerIndex === -1) return sendJson(res, 403, { error: "Not your match" });
  if (match.winner) return sendJson(res, 400, { error: "Game already over" });
  if (match.turn !== playerIndex) return sendJson(res, 400, { error: "Not your turn" });

  const body = await readBody(req);
  const column = parseInt(body.column, 10);
  if (!Number.isFinite(column) || column < 0 || column >= C4_COLS) {
    return sendJson(res, 400, { error: "Invalid column" });
  }
  let targetRow = -1;
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (!match.board[r * C4_COLS + column]) {
      targetRow = r;
      break;
    }
  }
  if (targetRow === -1) return sendJson(res, 400, { error: "That column is full" });

  const symbol = playerIndex === 0 ? "R" : "Y";
  match.board[targetRow * C4_COLS + column] = symbol;
  match.winner = checkConnectFourWinner(match.board);
  match.turn = playerIndex === 0 ? 1 : 0;
  broadcastArcadeChanged();
  sendJson(res, 200, { ...match, you: playerIndex });
});

route("POST", /^\/api\/arcade\/connectfour\/(?<id>\d+)\/leave\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  connectFourMatches.delete(Number(params.id));
  broadcastArcadeChanged();
  sendJson(res, 200, { ok: true });
});

// --- Checkers vs another in-store player (online only - no bot mode: full
// American-checkers rules, including forced captures and multi-jump
// chains, are complex enough that duplicating them correctly in a
// client-side bot AI wasn't worth the risk of the two implementations
// drifting apart; the server is the single source of truth here). ---
let checkersWaitingPlayer = null;
const checkersMatches = new Map();
let nextCheckersMatchId = 1;
const CK_SIZE = 8;

function ckIdx(r, c) {
  return r * CK_SIZE + c;
}

function ckInBounds(r, c) {
  return r >= 0 && r < CK_SIZE && c >= 0 && c < CK_SIZE;
}

function initialCheckersBoard() {
  const board = Array(64).fill(null);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < CK_SIZE; c++) {
      if ((r + c) % 2 === 1) board[ckIdx(r, c)] = "b"; // player 0 (black), starts top, moves down
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < CK_SIZE; c++) {
      if ((r + c) % 2 === 1) board[ckIdx(r, c)] = "r"; // player 1 (red), starts bottom, moves up
    }
  }
  return board;
}

function ckIsPlayerPiece(piece, playerIndex) {
  if (!piece) return false;
  return playerIndex === 0 ? piece === "b" || piece === "B" : piece === "r" || piece === "R";
}

function ckForwardDirs(piece, playerIndex) {
  const isKing = piece === "B" || piece === "R";
  if (isKing) return [-1, 1];
  return playerIndex === 0 ? [1] : [-1]; // player 0 moves down (+row), player 1 moves up (-row)
}

/** Every legal capture-jump for one piece, single hop (chain continuation
 *  is handled by calling this again from the landing square). */
function ckCapturesForPiece(board, r, c, playerIndex) {
  const piece = board[ckIdx(r, c)];
  const moves = [];
  for (const dr of ckForwardDirs(piece, playerIndex)) {
    for (const dc of [-1, 1]) {
      const midR = r + dr;
      const midC = c + dc;
      const landR = r + dr * 2;
      const landC = c + dc * 2;
      if (!ckInBounds(landR, landC)) continue;
      const midPiece = board[ckIdx(midR, midC)];
      if (midPiece && !ckIsPlayerPiece(midPiece, playerIndex) && !board[ckIdx(landR, landC)]) {
        moves.push({ from: [r, c], to: [landR, landC], captured: [midR, midC] });
      }
    }
  }
  return moves;
}

function ckSimpleMovesForPiece(board, r, c, playerIndex) {
  const piece = board[ckIdx(r, c)];
  const moves = [];
  for (const dr of ckForwardDirs(piece, playerIndex)) {
    for (const dc of [-1, 1]) {
      const nr = r + dr;
      const nc = c + dc;
      if (ckInBounds(nr, nc) && !board[ckIdx(nr, nc)]) {
        moves.push({ from: [r, c], to: [nr, nc] });
      }
    }
  }
  return moves;
}

/** All legal moves for a player, applying the standard forced-capture rule:
 *  if any capture exists anywhere on the board for this player, only
 *  capture moves are legal this turn. */
function ckLegalMoves(board, playerIndex) {
  const captures = [];
  const simples = [];
  for (let r = 0; r < CK_SIZE; r++) {
    for (let c = 0; c < CK_SIZE; c++) {
      if (!ckIsPlayerPiece(board[ckIdx(r, c)], playerIndex)) continue;
      captures.push(...ckCapturesForPiece(board, r, c, playerIndex));
      simples.push(...ckSimpleMovesForPiece(board, r, c, playerIndex));
    }
  }
  return captures.length > 0 ? captures : simples;
}

function ckMaybePromote(board, r, c) {
  const piece = board[ckIdx(r, c)];
  if (piece === "b" && r === CK_SIZE - 1) board[ckIdx(r, c)] = "B";
  if (piece === "r" && r === 0) board[ckIdx(r, c)] = "R";
}

function ckWinner(board, nextPlayerIndex) {
  const nextPlayerHasPieces = board.some((p) => ckIsPlayerPiece(p, nextPlayerIndex));
  if (!nextPlayerHasPieces) return nextPlayerIndex === 0 ? "1" : "0"; // the OTHER player wins
  if (ckLegalMoves(board, nextPlayerIndex).length === 0) return nextPlayerIndex === 0 ? "1" : "0";
  return null;
}

function findCheckersMatchForPlayer(key) {
  for (const match of checkersMatches.values()) {
    if (match.players.includes(key)) return match;
  }
  return null;
}

route("POST", /^\/api\/arcade\/checkers\/queue\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const access = arcadeAccessInfo(session);
  if (!access.allowed) return sendJson(res, 403, { error: access.reason });

  const key = arcadeOwnerKey(session);
  const existingMatch = findCheckersMatchForPlayer(key);
  if (existingMatch) return sendJson(res, 200, { status: "matched", matchId: existingMatch.id });

  if (checkersWaitingPlayer && checkersWaitingPlayer.key !== key) {
    const match = {
      id: nextCheckersMatchId++,
      players: [checkersWaitingPlayer.key, key],
      names: [checkersWaitingPlayer.name, session.name || "Player"],
      board: initialCheckersBoard(),
      turn: 0,
      winner: null,
      mustContinueFrom: null, // [r, c] mid-chain-capture, or null
      createdAt: new Date().toISOString()
    };
    checkersMatches.set(match.id, match);
    checkersWaitingPlayer = null;
    broadcastArcadeChanged();
    return sendJson(res, 200, { status: "matched", matchId: match.id });
  }

  checkersWaitingPlayer = { key, name: session.name || "Player" };
  sendJson(res, 200, { status: "waiting" });
});

route("POST", /^\/api\/arcade\/checkers\/cancel\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const key = arcadeOwnerKey(session);
  if (checkersWaitingPlayer && checkersWaitingPlayer.key === key) checkersWaitingPlayer = null;
  sendJson(res, 200, { ok: true });
});

route("GET", /^\/api\/arcade\/checkers\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const match = checkersMatches.get(Number(params.id));
  if (!match) return sendJson(res, 404, { error: "Match not found" });
  const key = arcadeOwnerKey(session);
  const you = match.players.indexOf(key);
  if (you === -1) return sendJson(res, 403, { error: "Not your match" });
  sendJson(res, 200, { ...match, you, legalMoves: match.winner ? [] : ckLegalMoves(match.board, match.turn) });
});

route("POST", /^\/api\/arcade\/checkers\/(?<id>\d+)\/move\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const match = checkersMatches.get(Number(params.id));
  if (!match) return sendJson(res, 404, { error: "Match not found" });
  const key = arcadeOwnerKey(session);
  const playerIndex = match.players.indexOf(key);
  if (playerIndex === -1) return sendJson(res, 403, { error: "Not your match" });
  if (match.winner) return sendJson(res, 400, { error: "Game already over" });
  if (match.turn !== playerIndex) return sendJson(res, 400, { error: "Not your turn" });

  const body = await readBody(req);
  const from = Array.isArray(body.from) ? body.from.map(Number) : null;
  const to = Array.isArray(body.to) ? body.to.map(Number) : null;
  if (!from || !to || from.length !== 2 || to.length !== 2) {
    return sendJson(res, 400, { error: "Invalid move" });
  }

  // If mid-chain-capture, the same piece must keep moving from where it is.
  if (match.mustContinueFrom && (from[0] !== match.mustContinueFrom[0] || from[1] !== match.mustContinueFrom[1])) {
    return sendJson(res, 400, { error: "You must continue capturing with the same piece" });
  }

  const legalFromHere = match.mustContinueFrom
    ? ckCapturesForPiece(match.board, from[0], from[1], playerIndex)
    : ckLegalMoves(match.board, playerIndex);
  const chosen = legalFromHere.find((m) => m.from[0] === from[0] && m.from[1] === from[1] && m.to[0] === to[0] && m.to[1] === to[1]);
  if (!chosen) return sendJson(res, 400, { error: "Illegal move" });

  match.board[ckIdx(to[0], to[1])] = match.board[ckIdx(from[0], from[1])];
  match.board[ckIdx(from[0], from[1])] = null;
  if (chosen.captured) {
    match.board[ckIdx(chosen.captured[0], chosen.captured[1])] = null;
  }
  ckMaybePromote(match.board, to[0], to[1]);

  const canContinueCapture = chosen.captured && ckCapturesForPiece(match.board, to[0], to[1], playerIndex).length > 0;
  if (canContinueCapture) {
    match.mustContinueFrom = to;
  } else {
    match.mustContinueFrom = null;
    match.turn = playerIndex === 0 ? 1 : 0;
    match.winner = ckWinner(match.board, match.turn);
  }

  broadcastArcadeChanged();
  sendJson(res, 200, { ...match, you: playerIndex, legalMoves: match.winner ? [] : ckLegalMoves(match.board, match.turn) });
});

route("POST", /^\/api\/arcade\/checkers\/(?<id>\d+)\/leave\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  checkersMatches.delete(Number(params.id));
  broadcastArcadeChanged();
  sendJson(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// Table sessions (postpaid tabs) - staff opens a table when a group starts
// running a tab, tags orders to it as they come in, then closes it to get
// one combined bill instead of billing each order separately. Entirely a
// staff-side concept; customers never see or interact with this.
// ---------------------------------------------------------------------------

function computeTableSessionBill(session, allOrders) {
  const orders = allOrders.filter((o) => o.tableSessionId === session.id);
  const mergedItems = [];
  orders.forEach((o) =>
    o.items.forEach((i) => {
      mergedItems.push({ ...i, orderId: o.id });
    })
  );
  const subtotal = round2(orders.reduce((sum, o) => sum + o.subtotal, 0));
  const cgst = round2(orders.reduce((sum, o) => sum + o.cgst, 0));
  const sgst = round2(orders.reduce((sum, o) => sum + o.sgst, 0));
  const serviceCharge = round2(orders.reduce((sum, o) => sum + (o.serviceCharge || 0), 0));
  const tipAmount = round2(orders.reduce((sum, o) => sum + (o.tipAmount || 0), 0));
  const total = round2(orders.reduce((sum, o) => sum + o.total, 0));
  return { ...session, orderCount: orders.length, items: mergedItems, subtotal, cgst, sgst, serviceCharge, tipAmount, total };
}

route("POST", /^\/api\/table-sessions\/?$/, async (req, res) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const config = readJson(CONFIG_FILE, {});
  const tableNumber = parseInt(body.tableNumber, 10);
  const tableCount = config.tableCount ?? 10;
  if (!Number.isFinite(tableNumber) || tableNumber < 1 || tableNumber > tableCount) {
    return sendJson(res, 400, { error: `Table number must be between 1 and ${tableCount}` });
  }

  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  if (sessions.some((s) => s.tableNumber === tableNumber && s.status === "open")) {
    return sendJson(res, 400, { error: `Table ${tableNumber} already has an open tab` });
  }

  const tableSession = {
    id: `TBL-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    tableNumber,
    note: sanitizeNotes(body.note || ""),
    // Optional - lets staff identify a repeat/known customer for discounts,
    // without requiring the customer to log in themselves.
    customerName: sanitizeNotes(body.customerName || "").slice(0, 60),
    customerPhone: normalizePhone(body.customerPhone) || "",
    openedBy: session.name,
    openedAt: new Date().toISOString(),
    status: "open",
    closedAt: null,
    closedBy: null,
    isPaid: false
  };
  sessions.push(tableSession);
  writeJson(TABLE_SESSIONS_FILE, sessions);
  sendJson(res, 201, tableSession);
});

/** Lets staff change a table's seat number (customer asked to move) or
 *  update the customer name/phone on an already-open tab. */
route("PATCH", /^\/api\/table-sessions\/(?<id>[\w-]+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const config = readJson(CONFIG_FILE, {});
  const tableCount = config.tableCount ?? 10;
  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  const tableSession = sessions.find((s) => s.id === params.id);
  if (!tableSession) return sendJson(res, 404, { error: "Table session not found" });
  if (tableSession.status !== "open") return sendJson(res, 400, { error: "Table is already closed" });

  if (body.tableNumber !== undefined) {
    const newNumber = parseInt(body.tableNumber, 10);
    if (!Number.isFinite(newNumber) || newNumber < 1 || newNumber > tableCount) {
      return sendJson(res, 400, { error: `Table number must be between 1 and ${tableCount}` });
    }
    if (newNumber !== tableSession.tableNumber && sessions.some((s) => s.tableNumber === newNumber && s.status === "open")) {
      return sendJson(res, 400, { error: `Table ${newNumber} already has an open tab` });
    }
    tableSession.tableNumber = newNumber;
  }
  if (body.customerName !== undefined) tableSession.customerName = sanitizeNotes(body.customerName).slice(0, 60);
  if (body.customerPhone !== undefined) tableSession.customerPhone = normalizePhone(body.customerPhone) || "";

  writeJson(TABLE_SESSIONS_FILE, sessions);
  const orders = readJson(ORDERS_FILE, []);
  sendJson(res, 200, computeTableSessionBill(tableSession, orders));
});

route("GET", /^\/api\/table-sessions\/?$/, async (req, res, params, url) => {
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  const orders = readJson(ORDERS_FILE, []);
  const statusFilter = url.searchParams.get("status");
  const filtered = statusFilter ? sessions.filter((s) => s.status === statusFilter) : sessions;
  sendJson(
    res,
    200,
    filtered.map((s) => computeTableSessionBill(s, orders)).sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))
  );
});

route("GET", /^\/api\/table-sessions\/(?<id>[\w-]+)\/?$/, async (req, res, params) => {
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  const tableSession = sessions.find((s) => s.id === params.id);
  if (!tableSession) return sendJson(res, 404, { error: "Table session not found" });
  const orders = readJson(ORDERS_FILE, []);
  sendJson(res, 200, computeTableSessionBill(tableSession, orders));
});

route("POST", /^\/api\/table-sessions\/(?<id>[\w-]+)\/close\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  const tableSession = sessions.find((s) => s.id === params.id);
  if (!tableSession) return sendJson(res, 404, { error: "Table session not found" });
  if (tableSession.status === "closed") return sendJson(res, 400, { error: "Table is already closed" });

  tableSession.status = "closed";
  tableSession.closedAt = new Date().toISOString();
  tableSession.closedBy = session.name;

  if (body.markPaid === true) {
    const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : "Cash";
    tableSession.isPaid = true;
    tableSession.paymentMethod = paymentMethod;
    const orders = readJson(ORDERS_FILE, []);
    orders.forEach((o) => {
      if (o.tableSessionId === tableSession.id) {
        o.isPaid = true;
        o.paymentMethod = paymentMethod;
      }
    });
    writeJson(ORDERS_FILE, orders);
    broadcastOrdersChanged();
  }

  writeJson(TABLE_SESSIONS_FILE, sessions);
  const orders = readJson(ORDERS_FILE, []);
  sendJson(res, 200, computeTableSessionBill(tableSession, orders));
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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

// Explicit allowlist of servable directories, each scoped to its own root -
// anything not under one of these (data/, data-seed/, server.js, the .md/
// .bat files at the project root, etc.) 404s instead of being served.
// Serving the WHOLE project root used to mean any GET request for
// /data/users.json (password hashes+salts) or /data/orders.json (customer
// names/phones) succeeded with zero auth - a real, live data exposure bug,
// not just a defense-in-depth nicety. UPLOADS_DIR sits at the project root
// (not under data/) specifically so that mistake can't recur even if a
// future change re-widens data/'s own exposure - uploaded images are the
// only files anyone unauthenticated should ever be able to fetch by path.
const STATIC_ROOTS = [
  { prefix: "/css/", dir: path.join(ROOT_DIR, "css") },
  { prefix: "/js/", dir: path.join(ROOT_DIR, "js") },
  { prefix: "/uploads/", dir: UPLOADS_DIR }
];

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      // No cache headers were set at all before, which lets some browsers
      // hold onto an old cached copy of e.g. theme.css after a redeploy -
      // JS/HTML changes show up but stale CSS keeps rendering, which looks
      // like a real layout bug even though the shipped files are correct.
      // no-cache (not no-store) still lets the browser cache the file, but
      // forces a revalidation request each time instead of trusting a
      // stale copy blindly.
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === "/" || pathname === "/index.html") {
    return serveFile(res, path.join(ROOT_DIR, "index.html"));
  }

  const root = STATIC_ROOTS.find((r) => pathname.startsWith(r.prefix));
  if (!root) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }

  const rel = pathname.slice(root.prefix.length);
  const filePath = path.normalize(path.join(root.dir, rel));

  // Prevent path traversal (e.g. /css/../server.js) escaping this root.
  if (!filePath.startsWith(root.dir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  serveFile(res, filePath);
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
