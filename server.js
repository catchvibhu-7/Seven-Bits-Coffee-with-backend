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
const https = require("https");
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
const ADDRESSES_FILE = path.join(DATA_DIR, "addresses.json");
const RAW_MATERIALS_FILE = path.join(DATA_DIR, "raw-materials.json");
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
    // Multi-currency - currencySymbol is what every price display in the
    // app uses (menu, cart, checkout, billing, receipts); currencyCode is
    // only used where Razorpay's API actually requires an ISO 4217 code.
    // Both default to what the app always hardcoded (Indian Rupee), so
    // nothing changes until an admin edits these.
    currencySymbol: "₹",
    currencyCode: "INR",
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
    // Real payment verification - off by default, an owner turns it on once
    // they have a Razorpay merchant account (Admin -> Payments & Tax). See
    // createRazorpayOrder()/verifyRazorpaySignature() above. Off/unconfigured
    // keeps the original UPI-QR trust-based flow exactly as it was.
    razorpayEnabled: false,
    razorpayKeyId: "",
    razorpayKeySecret: "",
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
    // A single wide image combining wordmark + mark, shown instead of the
    // separate logo icon + shop-name text in the nav rail/top bar when set -
    // optional, most shops just use logoUrl + the auto-generated name text.
    logoWideUrl: "",
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
    // Label under the home page's storefront photo, before the address
    // (e.g. "The counter · 123 Main St") - was hardcoded as "The counter".
    heroCaptionLabel: "The counter",
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
    // Admin-added fields beyond the fixed set above (Instagram, GST no,
    // WhatsApp, etc.) - see Content -> Store Details -> "+ ADD FIELD".
    customFooterFields: [],
    // "rail" or "topbar" - which staff-shell layout a browser sees the
    // first time it visits with nobody logged in yet, before it has its own
    // saved localStorage preference (see StaffShell in staff-shell.js).
    defaultNavLayout: "rail",
    // Industry-standard "earn on spend, redeem for a discount" loyalty
    // program - both rates admin-editable from Discounts & Loyalty.
    loyalty: {
      enabled: true,
      pointsPerRupeeSpent: 0.1, // e.g. 0.1 = 1 point per Rs.10 spent
      rupeeValuePerPoint: 0.5 // e.g. 0.5 = each point is worth Rs.0.50 off
    }
    // Table count and arcade settings (Operations) used to live here, but
    // are now fully per-store - see DEFAULT_STORE_OPERATIONS and each
    // store's own `operations` field.
  });
}

// One-time boot migration: back-fill storeId:null (franchise-wide) onto any
// coupon created before coupons gained per-store scoping, without touching
// coupons.json at all if it doesn't exist yet or nothing needs changing.
if (fs.existsSync(COUPONS_FILE)) {
  const coupons = readJson(COUPONS_FILE, []);
  let changed = false;
  for (const c of coupons) {
    if (c.storeId === undefined) {
      c.storeId = null;
      changed = true;
    }
  }
  if (changed) writeJson(COUPONS_FILE, coupons);
}

// One-time boot migration: branding is now global-only (Global Admin's
// lane) - a store no longer owns its own theme/colors/logo/hero/shopName,
// only contact info (address/phone/lat/lng), a home-page-picks override,
// a tax/currency override, and its own operations (tables/arcade, now
// fully per-store instead of a single global setting). Back-fills the new
// fields from whatever the store/global config already had, then removes
// the old per-store branding object and the old global tableCount/arcade
// (values are copied as-is, not re-validated - they were already
// clamped/sanitized when originally written under the old code path).
(function migrateStoresToFranchiseModel() {
  const stores = readJson(STORES_FILE, []);
  const config = readJson(CONFIG_FILE, {});
  let storesChanged = false;
  for (const s of stores) {
    if (s.phone === undefined) {
      s.phone = (s.branding && s.branding.footer && s.branding.footer.phone) || "";
      storesChanged = true;
    }
    if (s.operations === undefined) {
      s.operations = {
        tableCount: config.tableCount ?? 10,
        arcade: config.arcade || { enabled: true, sessionHours: 2 }
      };
      storesChanged = true;
    }
    if (s.payments === undefined) {
      s.payments = { cgstRate: null, sgstRate: null, serviceChargeRate: null, tipEnabled: null, tipAmount: null, currencySymbol: null, currencyCode: null };
      storesChanged = true;
    }
    if (s.branding !== undefined) {
      delete s.branding;
      storesChanged = true;
    }
  }
  if (storesChanged) writeJson(STORES_FILE, stores);

  if (config.tableCount !== undefined || config.arcade !== undefined) {
    delete config.tableCount;
    delete config.arcade;
    writeJson(CONFIG_FILE, config);
  }
})();

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
  logoWideUrl: "",
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

// Digits-only comparison so "98765 43210", "+91 9876543210", and
// "9876543210" all match the same stored number regardless of how either
// side happened to be formatted/punctuated.
function findUserByPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const users = readJson(USERS_FILE, []);
  return users.find((u) => u.phone && String(u.phone).replace(/\D/g, "") === digits);
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
  storeAccess = null,
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
    // disabled: blocks login entirely without deleting the account/history
    // (order attribution, payroll, audit log all still reference this id) -
    // set when a store closes and its staff aren't relocated to another
    // store (see DELETE /api/stores/:id), or manually from Staff Accounts.
    disabled: false,
    // storeId: which store this person works at/manages. Owner/admin aren't
    // tied to one store (they see everything), so storeId is mostly
    // meaningful for employee/manager.
    storeId: ["employee", "manager"].includes(role) ? storeId : null,
    // storeAccess: for an admin only - which stores they can see/manage.
    // null/absent means unrestricted (every store) - the default, matching
    // this app's original single-tier admin behavior. Owner sets this
    // explicitly (PATCH /api/users/:id) to scope a specific admin down.
    storeAccess: role === "admin" && Array.isArray(storeAccess) && storeAccess.length ? storeAccess : null,
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

// Reverse proxies/tunnels (e.g. Cloudflare) sitting in front of this server
// can buffer or idle-timeout a long-lived streaming response that goes quiet
// for too long - a real order can easily sit PREPARING for many minutes with
// nothing to broadcast. A small comment-only ping every 20s keeps the
// connection actively flushing so a stall shows up as a fast reconnect
// instead of a silently stuck stream a client only notices once something
// else (a tab switch, a refetch) happens to paper over it.
setInterval(() => {
  for (const res of sseClients) {
    res.write(": ping\n\n");
  }
}, 20000).unref();

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

function setSessionCookie(res, token, req) {
  const parts = [
    `sb_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  // IS_HTTPS covers a direct HTTPS deployment; X-Forwarded-Proto covers the
  // normal case here - the Cloudflare tunnel terminates TLS and talks plain
  // HTTP to localhost, so the socket itself is never "https" even though the
  // real client connection is. Without this, the Secure flag silently never
  // gets set through the tunnel no matter how IS_HTTPS is configured.
  if (IS_HTTPS || req?.headers["x-forwarded-proto"] === "https") parts.push("Secure");
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

/** First 4 digits visible, everything after masked (e.g. 9876543210 ->
 *  9876XXXXXX) - enough for staff to recognize a regular, not enough to
 *  read/dial the full number. Too short to usefully mask (<=4 digits) is
 *  returned as-is rather than fully starred out. */
function maskPhone(phone) {
  const digits = String(phone);
  if (digits.length <= 4) return digits;
  return digits.slice(0, 4) + "X".repeat(digits.length - 4);
}

/** Recursively masks every `customerPhone` field in a JSON response body -
 *  a customer's own `phone` on their own session/order-tracking response is
 *  a DIFFERENT field name and untouched. Used only for an employee-role
 *  session (see the server dispatcher below) - manager and up still get the
 *  real number, same as an employee did before this restriction. */
function redactCustomerPhones(bodyString) {
  let data;
  try {
    data = JSON.parse(bodyString);
  } catch (e) {
    return bodyString;
  }
  const walk = (val) => {
    if (Array.isArray(val)) {
      val.forEach(walk);
      return;
    }
    if (val && typeof val === "object") {
      for (const key of Object.keys(val)) {
        if (key === "customerPhone" && typeof val[key] === "string") {
          val[key] = maskPhone(val[key]);
        } else {
          walk(val[key]);
        }
      }
    }
  };
  walk(data);
  return JSON.stringify(data);
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
  const session = getSession(cookies.sb_session);
  if (!session) return null;
  // A staff account disabled mid-session (store closed, manually
  // deactivated) is cut off immediately, not just blocked from a future
  // login - the existing session token stops working right away.
  if (session.userId != null) {
    const user = findUserById(session.userId);
    if (!user || user.disabled) {
      destroySession(cookies.sb_session);
      return null;
    }
  }
  return session;
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

/** Franchise-wide settings (branding, menu catalog, global policy) are a
 *  Global Admin's job specifically - not owner (read-only outside adding
 *  Global Admins) and not a Local Admin (scoped to their own store's
 *  settings instead). Only role:"admin" with no storeAccess restriction
 *  qualifies - see accessibleStoreIds()/allowedRolesToCreate() above for
 *  the same Global-vs-Local distinction used everywhere else. */
function requireGlobalAdmin(req, res) {
  const session = requireRole(req, res, MENU_ADMIN_ROLES);
  if (!session) return null;
  if (session.role !== "admin" || accessibleStoreIds(session) !== null) {
    sendJson(res, 403, { error: "Only a Global Admin can edit franchise-wide settings" });
    return null;
  }
  return session;
}

// Trusts X-Forwarded-For's first hop, since this app is only ever reached
// through a fixed reverse proxy (the Cloudflare tunnel) - without this,
// req.socket.remoteAddress is just the tunnel's own local address for every
// request, making IP-based login-attempt rate limiting a no-op (every real
// client collapses onto one "IP"). If this server is ever exposed directly
// to the internet without a trusted proxy in front, this header becomes
// spoofable and should be gated behind a TRUST_PROXY env check instead.
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/** Stable per-person owner for favorites - a signed-in customer keeps
 *  favorites across devices (keyed by account), a guest's favorites are
 *  scoped to the phone number they're currently using, same privacy
 *  boundary as /orders/mine. Two real fields (not one polymorphic string)
 *  so a customer's favorites can be queried by a plain ownerId match. */
function favoritesOwner(session) {
  return session.role === "customer" ? { ownerType: "customer", ownerId: session.userId } : { ownerType: "guest", ownerId: session.phone };
}
function favoritesMatch(f, owner) {
  return f.ownerType === owner.ownerType && f.ownerId === owner.ownerId;
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

function sanitizePrepTimeMins(value) {
  if (value === undefined || value === null || value === "") return null; // unset - falls back to DEFAULT_PREP_TIME_MINS at calculation time
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 60) : null;
}

// Wait-time estimate constants (see computeWaitTimeMins() below) - a drink
// with no prepTimeMins set falls back to this; pre-ready (DESSERTS station)
// items always contribute this flat amount instead, regardless of their
// own prepTimeMins or quantity; PARALLEL_DRINK_SLOTS models "2 drinks can
// be prepared in parallel" as a shared pool the whole backlog draws from,
// not a per-order allowance.
const DEFAULT_PREP_TIME_MINS = 3;
const PRE_READY_FLAT_MINS = 1;
const PARALLEL_DRINK_SLOTS = 2;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Razorpay (real payment verification) - optional, off by default. Wiring
// this up needs a merchant account + API keys only the shop owner can get
// (Admin -> Payments & Tax -> Razorpay); with it off (or unconfigured), an
// ONLINE order falls back to the original UPI-QR trust-based flow exactly
// as before - nothing here changes behavior until an owner turns it on.
// No SDK/npm dependency - both calls are plain HTTPS requests, consistent
// with this app's "no external dependencies" approach everywhere else.
// ---------------------------------------------------------------------------

/** POST to Razorpay's REST API with HTTP Basic Auth (key_id:key_secret) -
 *  the standard server-to-server auth their API docs specify. */
function razorpayApiRequest(path, body, keyId, keySecret) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "api.razorpay.com",
        path,
        method: "POST",
        auth: `${keyId}:${keySecret}`,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 10000
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            return reject(new Error("Razorpay returned an unexpected response"));
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
          reject(new Error((parsed.error && parsed.error.description) || "Razorpay request failed"));
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Razorpay request timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Creates a real Razorpay order for the given rupee amount - called once
 *  computeOrder() has the authoritative, server-priced total, same as the
 *  existing UPI QR (never a client-supplied amount). Returns null (falls
 *  back to the UPI QR) on any failure - a misconfigured/unreachable gateway
 *  should never block someone from placing an order. */
async function createRazorpayOrder(amountRupees, receipt, config) {
  if (!config.razorpayEnabled || !config.razorpayKeyId || !config.razorpayKeySecret) return null;
  try {
    const order = await razorpayApiRequest(
      "/v1/orders",
      { amount: Math.round(amountRupees * 100), currency: config.currencyCode || "INR", receipt: String(receipt).slice(0, 40) },
      config.razorpayKeyId,
      config.razorpayKeySecret
    );
    return { razorpayOrderId: order.id, razorpayKeyId: config.razorpayKeyId, razorpayCurrency: config.currencyCode || "INR" };
  } catch (e) {
    console.error("Razorpay order creation failed:", e.message);
    return null;
  }
}

/** Verifies the signature Razorpay's checkout widget hands back after a
 *  payment completes - HMAC-SHA256 of "order_id|payment_id" using the key
 *  secret, exactly as Razorpay's own docs specify. This is what actually
 *  closes the "online payments are still trust-based" gap: an order is
 *  only marked paid once this passes, not just because the client claims it. */
function verifyRazorpaySignature(orderId, paymentId, signature, keySecret) {
  const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature || "")));
  } catch (e) {
    return false; // length mismatch etc. - never a match
  }
}

// Customer/staff-facing display number, separate from `id` (the internal
// primary key). Format: SB + YYMMDD + a 2-digit per-day counter that resets
// at midnight because it's derived from today's date prefix, e.g. SB26082401,
// SB26082402. Safe without locking: server.js handles one request at a time
// and this runs synchronously between the readJson/writeJson in the order
// creation route, so two orders can never see the same existing count.
// storeId/multiStore only change the format once a second store actually
// exists - a single-store deployment keeps the plain "SB..." numbers it
// always had, so this is invisible unless someone actually expands.
function generateOrderNumber(existingOrders, storeId, multiStore) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const storePrefix = multiStore && storeId != null ? `SB${storeId}_` : "SB";
  const datePrefix = `${storePrefix}${yy}${mm}${dd}`;
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
      prepTimeMins: c.product.prepTimeMins ?? DEFAULT_PREP_TIME_MINS,
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

function computeOrder(items, method, serviceChargeActive, tipApplied, { couponCode = null, redeemPoints = 0, customerId = null, storeId = null } = {}) {
  const menu = readJson(MENU_FILE, { items: [] });
  // Tax/currency resolved through the store's own override (if any) on top
  // of the franchise-wide default - never trust a raw global read here,
  // this is real money math (see mergeStoreOverrides()).
  const config = mergeStoreOverrides(readJson(CONFIG_FILE, {}), storeId != null ? readJson(STORES_FILE, []).find((s) => s.id === storeId) : null);
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
    if (storeId != null && (product.disabledStores || []).includes(storeId)) continue; // out of stock at this store specifically
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
      // Frozen at order time, same reasoning as basePrice - a later change
      // to the item's own prepTimeMins (or the item being deleted) should
      // never retroactively change how long an already-placed order's
      // backlog contribution is treated as (see computeWaitTimeMins()).
      prepTimeMins: product.prepTimeMins ?? DEFAULT_PREP_TIME_MINS,
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
  const coupon = couponCode ? findValidCoupon(couponCode, coupons, storeId) : null;
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
    setSessionCookie(res, token, req);
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
  // The login field accepts either a username or a phone number,
  // auto-detected by trying username first (usernames and phone numbers
  // can never collide - phone lookup only ever matches digits) rather than
  // guessing from the input's shape, which would misfire on an all-numeric
  // username.
  const user = findUserByUsername(body.username) || findUserByPhone(body.username);

  if (!user || !verifyPassword(body.password, user.salt, user.hash)) {
    recordAuthFailure(ip);
    return sendJson(res, 401, { error: "Invalid username or password" });
  }
  if (user.disabled) {
    recordAuthFailure(ip);
    return sendJson(res, 401, { error: "This account has been deactivated. Contact your manager or the owner." });
  }
  if (user.accountDeleted) {
    recordAuthFailure(ip);
    return sendJson(res, 401, { error: "This account has been deleted." });
  }

  recordAuthSuccess(ip);
  const token = createSession({ role: user.role, userId: user.id, name: user.name, phone: user.phone, storeId: user.storeId, storeAccess: user.storeAccess || null });
  setSessionCookie(res, token, req);
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
  const token = createSession({ role: user.role, userId: user.id, name: user.name, phone: user.phone, storeId: user.storeId, storeAccess: user.storeAccess || null });
  setSessionCookie(res, token, req);
  sendJson(res, 200, { ok: true });
});

/** Self-service account deletion (right-to-erasure): a customer scrubs their
 *  own PII and permanently loses the ability to log in. The record itself is
 *  never removed - orders already froze their own copy of customerId/
 *  customerName/customerPhone at checkout time (see computeOrder's
 *  snapshotting) and don't read this record live, so order history/reports
 *  are completely unaffected. accountDeleted is checked at login (blocks
 *  the account outright) and re-enforced after a whole-instance restore (see
 *  POST /api/admin/restore) so restoring an older backup can never quietly
 *  bring a deleted account back to a usable state. */
route("POST", /^\/api\/account\/delete\/?$/, async (req, res) => {
  const session = requireRole(req, res, ["customer"]);
  if (!session) return;
  const body = await readBody(req);
  const users = readJson(USERS_FILE, []);
  const user = users.find((u) => u.id === session.userId);
  if (!user) return sendJson(res, 404, { error: "Account not found" });
  if (!verifyPassword(body.password, user.salt, user.hash)) {
    return sendJson(res, 401, { error: "Password is incorrect" });
  }

  user.name = "Deleted User";
  user.phone = null;
  user.salt = crypto.randomBytes(16).toString("hex");
  user.hash = crypto.randomBytes(64).toString("hex"); // unguessable - not derived from any real password
  user.accountDeleted = true;
  user.deletedAt = new Date().toISOString();
  user.loyaltyPoints = 0;
  writeJson(USERS_FILE, users);

  const favorites = readJson(FAVORITES_FILE, []);
  const owner = favoritesOwner(session);
  writeJson(
    FAVORITES_FILE,
    favorites.filter((f) => !favoritesMatch(f, owner))
  );

  // Saved delivery addresses: an address a past order actually points to
  // (order.addressId) is now that order's own business record of where it
  // went - same reasoning as customerName/customerPhone surviving on old
  // orders, so it's left alone rather than deleted out from under them. Any
  // OTHER address of this customer's has no order pointing at it and is
  // real PII with no remaining purpose, so those are removed outright.
  const referencedAddressIds = new Set(readJson(ORDERS_FILE, []).map((o) => o.addressId).filter((id) => id != null));
  writeJson(
    ADDRESSES_FILE,
    readJson(ADDRESSES_FILE, []).filter((a) => a.customerId !== user.id || referencedAddressIds.has(a.id))
  );

  // Arcade leaderboard entries store their own snapshot of the player's
  // name (like orders do) - unlike orders, this one's just a public
  // high-score board with no business-record reason to keep the real name
  // attached once the account is gone.
  const arcadeScores = readJson(ARCADE_SCORES_FILE, []);
  let arcadeChanged = false;
  arcadeScores.forEach((s) => {
    if (s.customerId === user.id) {
      s.name = "Deleted User";
      arcadeChanged = true;
    }
  });
  if (arcadeChanged) writeJson(ARCADE_SCORES_FILE, arcadeScores);

  invalidateSessionsForUser(user.id);
  clearSessionCookie(res);
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
  setSessionCookie(res, token, req);
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
    storeAccess: session.storeAccess || null,
    mustChangePassword: !!(user && user.mustChangePassword),
    loyaltyPoints: user ? user.loyaltyPoints || 0 : 0
  });
});

/** Which roles a given session is allowed to hand out when creating a new account. */
/** Franchise governance model: owner's only write action is creating a
 *  Global Admin - everything else about the franchise is a Global Admin's
 *  job (branding/menu/policy) or a Local Admin/manager's job (their own
 *  store). "Global Admin" / "Local Admin" aren't separate role values -
 *  they're role:"admin" with accessibleStoreIds(session) either null
 *  (unrestricted = Global) or a concrete array (scoped = Local). */
function allowedRolesToCreate(session) {
  if (session.role === "owner") return ["admin"];
  if (session.role === "admin") return accessibleStoreIds(session) === null ? ["employee", "manager", "admin"] : ["employee", "manager"];
  if (session.role === "manager") return ["employee"];
  return [];
}

/** Which stores a session may see/act on - null means "unrestricted" (owner,
 *  or an admin nobody has scoped down yet, which is today's existing
 *  behavior preserved as the default). Everyone else gets a concrete list:
 *  a scoped admin's storeAccess, or a manager/employee's own single store. */
function accessibleStoreIds(session) {
  if (session.role === "owner") return null;
  if (session.role === "admin") return Array.isArray(session.storeAccess) && session.storeAccess.length ? session.storeAccess : null;
  if (session.role === "manager" || session.role === "employee") return session.storeId != null ? [session.storeId] : null;
  return null;
}

/** Whether this session may edit a given store's own record (address,
 *  branding override) - distinct from accessibleStoreIds()'s "can see"
 *  since a manager should be able to fix their own store's details even
 *  though most of the app already scopes them to it implicitly. */
function canManageStore(session, storeId) {
  if (session.role === "owner") return true;
  if (session.role === "admin") {
    const allowed = accessibleStoreIds(session);
    return !allowed || allowed.includes(storeId);
  }
  if (session.role === "manager") return session.storeId === storeId;
  return false;
}

function canManageTarget(session, targetUser) {
  if (!targetUser) return false;
  if (session.role === "owner") return true;
  if (session.role === "admin") {
    if (targetUser.role === "admin") {
      // Only a Global Admin manages admin-tier accounts, and only Local
      // Admins (scoped) - Global Admins don't manage each other, that
      // stays owner's lane (the one account type owner still writes).
      return accessibleStoreIds(session) === null && Array.isArray(targetUser.storeAccess) && targetUser.storeAccess.length > 0;
    }
    if (!["employee", "manager"].includes(targetUser.role)) return false;
    const allowed = accessibleStoreIds(session);
    return !allowed || allowed.includes(targetUser.storeId);
  }
  if (session.role === "manager") return targetUser.role === "employee" && targetUser.storeId === session.storeId;
  return false;
}

// ---------------------------------------------------------------------------
// Customer accounts (admin view) - staff-facing search/profile/order-history/
// loyalty lookup, separate from /api/users (staff accounts only). Read-only:
// there's no edit-customer-from-admin action here, just visibility.
// ---------------------------------------------------------------------------
route("GET", /^\/api\/admin\/customers\/?$/, async (req, res, params, url) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const orders = readJson(ORDERS_FILE, []);
  let customers = readJson(USERS_FILE, []).filter((u) => u.role === "customer");
  if (search) {
    const searchDigits = search.replace(/\D/g, "");
    customers = customers.filter((u) => {
      const nameMatch = (u.name || "").toLowerCase().includes(search);
      const usernameMatch = (u.username || "").toLowerCase().includes(search);
      const phoneMatch = searchDigits && (u.phone || "").replace(/\D/g, "").includes(searchDigits);
      return nameMatch || usernameMatch || phoneMatch;
    });
  }
  sendJson(
    res,
    200,
    customers.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      phone: u.phone,
      loyaltyPoints: u.loyaltyPoints || 0,
      orderCount: orders.filter((o) => o.customerId === u.id).length
    }))
  );
});

route("GET", /^\/api\/admin\/customers\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const user = readJson(USERS_FILE, []).find((u) => u.id === Number(params.id) && u.role === "customer");
  if (!user) return sendJson(res, 404, { error: "Customer not found" });
  const allowedStores = accessibleStoreIds(session);
  const orders = readJson(ORDERS_FILE, [])
    .filter((o) => o.customerId === user.id && (!allowedStores || o.storeId == null || allowedStores.includes(o.storeId)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sendJson(res, 200, {
    profile: publicUser(user),
    orders,
    totalSpent: round2(orders.reduce((sum, o) => sum + (o.isPaid ? o.total : 0), 0))
  });
});

route("GET", /^\/api\/users\/?$/, async (req, res) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  let users = readJson(USERS_FILE, []).filter((u) => STAFF_ROLES.includes(u.role));
  // A manager only sees their own store's staff (plus themselves), never
  // other stores' employees or the admin/owner accounts.
  if (session.role === "manager") {
    users = users.filter((u) => u.id === session.userId || (u.role === "employee" && u.storeId === session.storeId));
  }
  // A scoped admin (storeAccess set) only sees employee/manager accounts at
  // their accessible stores - other admin/owner accounts stay visible
  // regardless, since those aren't "at" any one store.
  const allowed = accessibleStoreIds(session);
  if (session.role === "admin" && allowed) {
    users = users.filter((u) => !["employee", "manager"].includes(u.role) || allowed.includes(u.storeId));
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
  // A scoped admin can only place a new employee/manager at a store they
  // themselves can access - an unrestricted admin (or owner) can pick any.
  const allowedStores = accessibleStoreIds(session);
  if (session.role === "admin" && allowedStores && !allowedStores.includes(storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store" });
  }
  // storeAccess: only owner or a Global Admin may set this (matches
  // allowedRolesToCreate - those are the only two tiers that can create an
  // "admin" account in the first place), and only applies when the new
  // account's role is actually admin.
  const canGrantStoreAccess = session.role === "owner" || (session.role === "admin" && accessibleStoreIds(session) === null);
  const storeAccess = canGrantStoreAccess && role === "admin" && Array.isArray(body.storeAccess) ? body.storeAccess.map(Number).filter(Number.isFinite) : null;

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
    const user = createUser({ username, password, role, name, mustChangePassword: true, storeId, storeAccess, tag, payRateType, payRate });
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
  // Moving an employee/manager to a different store - admin/owner only. A
  // manager never gets this: canManageTarget() already limits them to their
  // own store's employees, so "move to a different store" doesn't fit their
  // permission model (they'd be handing someone off to a store they can't
  // themselves manage).
  if (body.storeId !== undefined && ["employee", "manager"].includes(user.role)) {
    if (session.role === "manager") {
      return sendJson(res, 403, { error: "Only an admin/owner can move someone to a different store" });
    }
    const requestedStoreId = Number(body.storeId);
    if (!readJson(STORES_FILE, []).some((s) => s.id === requestedStoreId)) {
      return sendJson(res, 400, { error: "That store doesn't exist" });
    }
    const allowedStores = accessibleStoreIds(session);
    if (allowedStores && !allowedStores.includes(requestedStoreId)) {
      return sendJson(res, 403, { error: "You don't have access to that store" });
    }
    user.storeId = requestedStoreId;
  }
  // disabled: blocks login (see currentSession()) without deleting the
  // account - anyone who could otherwise manage this person can toggle it
  // (same gate as tag/pay rate above), matching reset-password's model of
  // "no extra confirmation beyond canManageTarget".
  if (body.disabled !== undefined) user.disabled = !!body.disabled;
  // storeAccess: which stores an admin can see/manage - only the owner or a
  // Global Admin may grant/restrict this (canManageTarget already limits a
  // Global Admin to acting on Local Admin targets, never another Global
  // Admin), and only for an admin account. An empty array or omitting the
  // field entirely both mean "unrestricted" going forward.
  if (body.storeAccess !== undefined && user.role === "admin") {
    if (session.role !== "owner" && !(session.role === "admin" && accessibleStoreIds(session) === null)) {
      return sendJson(res, 403, { error: "Only the owner or a Global Admin can change an admin's store access" });
    }
    const storeAccess = Array.isArray(body.storeAccess) ? body.storeAccess.map(Number).filter(Number.isFinite) : [];
    user.storeAccess = storeAccess.length ? storeAccess : null;
  }
  writeJson(USERS_FILE, users);
  sendJson(res, 200, publicUser(user));
});

/** Changing someone's role is more sensitive than tag/pay rate/store, so it
 *  gets its own route rather than living in the general PATCH above -
 *  gated by allowedRolesToCreate() (the same tiers that govern who may
 *  CREATE a given role also govern who may PROMOTE/DEMOTE into it), on
 *  top of the usual canManageTarget() check for the account being edited. */
route("PATCH", /^\/api\/users\/(?<id>\d+)\/role\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;

  const targetUser = findUserById(Number(params.id));
  if (!canManageTarget(session, targetUser)) {
    return sendJson(res, 403, { error: "Your account can't edit that person" });
  }
  if (targetUser.id === session.userId) {
    return sendJson(res, 400, { error: "You can't change your own role" });
  }

  const body = await readBody(req);
  const newRole = String(body.role || "");
  if (!allowedRolesToCreate(session).includes(newRole)) {
    return sendJson(res, 403, { error: `Your account can't assign the "${newRole}" role` });
  }

  const users = readJson(USERS_FILE, []);
  const user = users.find((u) => u.id === targetUser.id);
  user.role = newRole;
  // storeId/storeAccess/tag/payRate are each only meaningful for certain
  // roles (see createUser()) - moving between tiers clears whichever no
  // longer applies rather than leaving stale values behind.
  user.storeId = ["employee", "manager"].includes(newRole) ? (user.storeId ?? 1) : null;
  user.storeAccess = newRole === "admin" ? user.storeAccess : null;
  if (!["employee", "manager"].includes(newRole)) {
    user.tag = "";
    user.payRateType = null;
    user.payRate = null;
  }
  writeJson(USERS_FILE, users);
  logAuditEvent(session, "change_role", targetUser);
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

/** Lets a customer/guest (or a fully anonymous visitor, before any session
 *  exists) pick which physical location they're ordering from - no login
 *  required. Deliberately minimal (id/name/address only, no branding
 *  overrides) - do NOT reuse the staff-only GET /api/stores above. */
route("GET", /^\/api\/stores\/public\/?$/, async (req, res) => {
  const stores = readJson(STORES_FILE, []).map((s) => ({ id: s.id, name: s.name, address: s.address || "", lat: s.lat ?? null, lng: s.lng ?? null }));
  sendJson(res, 200, stores);
});

route("POST", /^\/api\/stores\/?$/, async (req, res) => {
  // Opening a new store is franchise structure, a Global Admin's lane - not
  // owner (read-only outside adding Global Admins).
  if (!requireGlobalAdmin(req, res)) return;
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "Store name is required" });
  const stores = readJson(STORES_FILE, []);
  const nextId = stores.length ? Math.max(...stores.map((s) => s.id)) + 1 : 1;
  const store = {
    id: nextId,
    name,
    address: String(body.address || "").trim(),
    phone: "",
    operations: { ...DEFAULT_STORE_OPERATIONS },
    payments: { cgstRate: null, sgstRate: null, serviceChargeRate: null, tipEnabled: null, tipAmount: null, currencySymbol: null, currencyCode: null }
  };
  stores.push(store);
  writeJson(STORES_FILE, stores);
  sendJson(res, 201, store);
});

// A store's own record: contact info (address/phone/lat/lng), an optional
// homePicks override, a tax/currency override, and its own operations
// (tables/arcade) - NOT branding/theme (that's global-only now, see
// mergeStoreOverrides()). Renaming/franchise-structure stays Global-Admin
// territory (matches POST/DELETE /api/stores); day-to-day contact/
// picks/payments-override/operations are editable by whoever actually
// runs that store (canManageStore()) - a manager fixing their own
// location's address/hours shouldn't need to go through a Global Admin.
// Owner never writes here at all (read-only outside adding Global Admins).
route("PATCH", /^\/api\/stores\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  if (session.role === "owner") {
    return sendJson(res, 403, { error: "Owner has read-only access to store settings" });
  }
  const stores = readJson(STORES_FILE, []);
  const store = stores.find((s) => s.id === Number(params.id));
  if (!store) return sendJson(res, 404, { error: "Store not found" });
  if (!canManageStore(session, store.id)) {
    return sendJson(res, 403, { error: "You don't have access to that store" });
  }
  const isGlobalAdmin = session.role === "admin" && accessibleStoreIds(session) === null;
  const body = await readBody(req);
  if (typeof body.name === "string") {
    if (!isGlobalAdmin) return sendJson(res, 403, { error: "Only a Global Admin can rename a store" });
    const name = body.name.trim();
    if (!name) return sendJson(res, 400, { error: "Store name is required" });
    store.name = name.slice(0, 60);
  }
  if (typeof body.address === "string") store.address = body.address.trim().slice(0, 200);
  if (typeof body.phone === "string") store.phone = body.phone.trim().slice(0, 20);
  // lat/lng: optional coordinates for the store picker's geolocation
  // sort/"X km away" display (see GET /api/stores/public) - not required,
  // the picker falls back to a plain list for any store without them.
  // null/empty explicitly CLEARS the coordinate - Number(null) is 0, which
  // is a real (equatorial) coordinate, not "unset", so that case has to be
  // checked before coercing to a number.
  const parseCoord = (value, min, max) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  if (body.lat !== undefined) store.lat = parseCoord(body.lat, -90, 90);
  if (body.lng !== undefined) store.lng = parseCoord(body.lng, -180, 180);
  // homePicks: this store's own "This week's picks" override - undefined
  // input leaves it untouched, an explicit null/empty array clears the
  // override back to inheriting the franchise-wide default.
  if (body.homePicks !== undefined) {
    store.homePicks = body.homePicks === null ? undefined : sanitizeHomePicks(body.homePicks) || [];
  }
  // payments: per-field nullable override on top of the franchise-wide
  // tax/currency defaults (UPI/Razorpay stay global-only, never here).
  if (body.payments && typeof body.payments === "object") {
    const p = body.payments;
    const existing = store.payments || {};
    const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    store.payments = {
      cgstRate: "cgstRate" in p ? num(p.cgstRate) : existing.cgstRate ?? null,
      sgstRate: "sgstRate" in p ? num(p.sgstRate) : existing.sgstRate ?? null,
      serviceChargeRate: "serviceChargeRate" in p ? num(p.serviceChargeRate) : existing.serviceChargeRate ?? null,
      tipAmount: "tipAmount" in p ? num(p.tipAmount) : existing.tipAmount ?? null,
      tipEnabled: "tipEnabled" in p ? (p.tipEnabled === null ? null : Boolean(p.tipEnabled)) : existing.tipEnabled ?? null,
      currencySymbol: "currencySymbol" in p ? (p.currencySymbol ? String(p.currencySymbol).trim().slice(0, 3) : null) : existing.currencySymbol ?? null,
      currencyCode: "currencyCode" in p ? (p.currencyCode ? String(p.currencyCode).trim().toUpperCase().slice(0, 3) : null) : existing.currencyCode ?? null
    };
  }
  // operations: fully store-owned (tables/arcade) - no franchise fallback
  // once a store has this field at all (every store gets one at creation/
  // migration - see migrateStoresToFranchiseModel() and POST /api/stores).
  if (body.operations && typeof body.operations === "object") {
    const existingOps = store.operations || DEFAULT_STORE_OPERATIONS;
    store.operations = {
      tableCount: body.operations.tableCount !== undefined ? sanitizeTableCount(body.operations.tableCount, existingOps.tableCount) : existingOps.tableCount,
      arcade: body.operations.arcade !== undefined ? sanitizeArcade(body.operations.arcade, existingOps.arcade) : existingOps.arcade,
      waitTime:
        body.operations.waitTime !== undefined
          ? sanitizeWaitTime(body.operations.waitTime, existingOps.waitTime || DEFAULT_STORE_OPERATIONS.waitTime)
          : existingOps.waitTime || DEFAULT_STORE_OPERATIONS.waitTime,
      // sanitizeDelivery is called even when body.operations.delivery is
      // undefined - unlike the other operations fields, it's not a plain
      // "pass through unchanged" no-op, since a Global-Admin lock (see its
      // own comment) needs enforcing on every write, not just ones that
      // explicitly try to touch delivery.
      delivery: sanitizeDelivery(body.operations.delivery, existingOps.delivery || DEFAULT_STORE_OPERATIONS.delivery, isGlobalAdmin)
    };
  }
  writeJson(STORES_FILE, stores);
  sendJson(res, 200, store);
});

/** Closing a store, owner-only (same tier as opening one). Its employees/
 *  managers can't be left pointing at a store that no longer exists, so
 *  the caller must say what happens to them: reassign everyone to another
 *  store (`reassignToStoreId`), or deactivate their accounts (default,
 *  matching "deactivated or relocated") - a disabled account can't log in
 *  (see currentSession()) but its order/payroll history is untouched. Any
 *  admin scoped to this store also has it quietly dropped from their
 *  storeAccess so they're never left "restricted to a store that doesn't
 *  exist" (which would otherwise look identical to "unrestricted"). */
route("DELETE", /^\/api\/stores\/(?<id>\d+)\/?$/, async (req, res, params) => {
  // Closing a store is franchise structure too - Global Admin's lane, same
  // as opening one.
  if (!requireGlobalAdmin(req, res)) return;
  const storeId = Number(params.id);
  const stores = readJson(STORES_FILE, []);
  const store = stores.find((s) => s.id === storeId);
  if (!store) return sendJson(res, 404, { error: "Store not found" });
  if (stores.length <= 1) return sendJson(res, 400, { error: "Can't remove the only store" });

  const body = await readBody(req);
  const reassignToStoreId = Number(body.reassignToStoreId);
  const willReassign = Number.isFinite(reassignToStoreId) && stores.some((s) => s.id === reassignToStoreId && s.id !== storeId);
  if (body.reassignToStoreId != null && !willReassign) {
    return sendJson(res, 400, { error: "Pick a valid store to move staff to, or leave it blank to deactivate them" });
  }

  const users = readJson(USERS_FILE, []);
  const affected = users.filter((u) => ["employee", "manager"].includes(u.role) && u.storeId === storeId);
  affected.forEach((u) => {
    if (willReassign) {
      u.storeId = reassignToStoreId;
    } else {
      u.disabled = true;
    }
  });
  users.forEach((u) => {
    if (u.role === "admin" && Array.isArray(u.storeAccess)) {
      const filtered = u.storeAccess.filter((id) => id !== storeId);
      u.storeAccess = filtered.length ? filtered : null;
    }
  });
  writeJson(USERS_FILE, users);

  writeJson(STORES_FILE, stores.filter((s) => s.id !== storeId));
  sendJson(res, 200, { ok: true, affectedStaff: affected.length, reassigned: willReassign });
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
  if (session.role === "admin") {
    const allowed = accessibleStoreIds(session);
    return allowed ? users.filter((u) => allowed.includes(u.storeId)) : users;
  }
  return users; // owner sees everyone
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

// "Making payments" (marking a period paid) is a manager's own operational
// duty specifically - a Local Admin/Global Admin sets pay RATES (via
// PATCH /api/users/:id) but doesn't execute the payout.
route("POST", /^\/api\/payroll\/(?<userId>\d+)\/mark-paid\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  if (session.role !== "manager") {
    return sendJson(res, 403, { error: "Only a manager can mark a pay period paid" });
  }

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
  if (session.role !== "manager") {
    return sendJson(res, 403, { error: "Only a manager can approve overtime" });
  }
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
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  let orders = readJson(ORDERS_FILE, []);
  // Scoped to whichever stores this session can see (null = unrestricted -
  // owner, or an admin nobody has scoped down). An order with no storeId at
  // all (e.g. a customer order placed before store selection existed, or in
  // a still-single-store deployment) isn't hidden from anyone by this -
  // only orders explicitly tagged to a DIFFERENT store are filtered out.
  // An admin/owner can drill into one specific store with ?storeId=;
  // ignored for manager/employee, who are already locked to their own
  // single store.
  const allowed = accessibleStoreIds(session);
  if (allowed) orders = orders.filter((o) => o.storeId == null || allowed.includes(o.storeId));
  if (url.searchParams.has("storeId")) {
    const requestedStoreId = Number(url.searchParams.get("storeId"));
    if (Number.isFinite(requestedStoreId) && (!allowed || allowed.includes(requestedStoreId))) {
      orders = orders.filter((o) => o.storeId === requestedStoreId);
    }
  }
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

  // Cross-store comparison for the Franchise Dashboard - only meaningful
  // (and only ever requested) when this session can see more than one
  // store; still computed from the same already-scoped `orders` array, so
  // a restricted admin never sees a store outside their storeAccess here
  // either. Orders with no storeId (see the comment above) aren't
  // attributed to any one store, so they're left out of this breakdown
  // rather than muddying a specific store's numbers.
  const storeIdsInView = allowed || readJson(STORES_FILE, []).map((s) => s.id);
  const storeNames = Object.fromEntries(readJson(STORES_FILE, []).map((s) => [s.id, s.name]));
  const byStore = storeIdsInView.map((id) => {
    const storeOrders = orders.filter((o) => o.storeId === id);
    return {
      storeId: id,
      storeName: storeNames[id] || `Store ${id}`,
      today: { orders: storeOrders.filter((o) => inRange(o, startOfToday)).length, revenue: sumRevenue(storeOrders.filter((o) => inRange(o, startOfToday))) },
      allTime: { orders: storeOrders.length, revenue: sumRevenue(storeOrders) }
    };
  });

  sendJson(res, 200, {
    today: { orders: todayOrders.length, revenue: sumRevenue(todayOrders) },
    week: { orders: weekOrders.length, revenue: sumRevenue(weekOrders) },
    month: { orders: monthOrders.length, revenue: sumRevenue(monthOrders) },
    allTime: { orders: orders.length, revenue: sumRevenue(orders) },
    range,
    chart,
    bestSellers,
    byStore
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
  let items = includeDeleted ? menu.items : menu.items.filter((i) => !i.deleted);
  // The menu itself is shared across every store (per the "branding-only"
  // multi-store decision - see configForSession()), but a store can still
  // be out of stock on a shared item without affecting other locations.
  // Staff (assigned to one store) get this from their own session; a
  // customer/guest isn't tied to a store (they can walk into any location),
  // so their chosen store comes from ?storeId= instead (see js/app.js's
  // menu loader) - with no store picked yet, they see plain global
  // availability, same as before this existed.
  const session = currentSession(req);
  let effectiveStoreId = session && session.storeId != null ? session.storeId : null;
  // ?storeId= only ever comes from a customer/guest/anonymous visitor's own
  // chosen store - NOT honored for owner/admin (their storeId is also null,
  // but because they're unrestricted, not because they're a customer
  // picking a location; without this check, a customer's local store pick
  // on the same browser would leak into their own admin view).
  const isTrackingOrAnonymous = !session || TRACKING_ROLES.includes(session.role);
  if (effectiveStoreId == null && isTrackingOrAnonymous && url.searchParams.has("storeId")) {
    const requestedStoreId = Number(url.searchParams.get("storeId"));
    if (Number.isFinite(requestedStoreId)) effectiveStoreId = requestedStoreId;
  }
  if (effectiveStoreId != null) {
    items = items.map((i) =>
      (i.disabledStores || []).includes(effectiveStoreId) ? { ...i, available: false, disabledAtThisStore: true } : i
    );
  }
  sendJson(res, 200, { ...menu, items });
});

/** Resolves the same "?storeId= only for a customer/guest, session storeId
 *  otherwise" rule /api/menu's handler above uses - kept in sync with it
 *  rather than re-derived per caller. */
function resolveEffectiveStoreId(req, url) {
  const session = currentSession(req);
  let effectiveStoreId = session && session.storeId != null ? session.storeId : null;
  const isTrackingOrAnonymous = !session || TRACKING_ROLES.includes(session.role);
  if (effectiveStoreId == null && isTrackingOrAnonymous && url.searchParams.has("storeId")) {
    const requestedStoreId = Number(url.searchParams.get("storeId"));
    if (Number.isFinite(requestedStoreId)) effectiveStoreId = requestedStoreId;
  }
  return effectiveStoreId;
}

// Ambient "how long right now" reading - no specific cart in mind (Home page,
// Menu page while just browsing).
route("GET", /^\/api\/wait-time\/?$/, async (req, res, params, url) => {
  const waitMins = computeWaitTimeMins([], resolveEffectiveStoreId(req, url));
  sendJson(res, 200, { waitMins });
});

// Cart-aware reading (checkout) - body items are the same {id, quantity}
// shape as POST /api/orders' own cart payload.
route("POST", /^\/api\/wait-time\/?$/, async (req, res, params, url) => {
  const body = await readBody(req);
  const items = Array.isArray(body.items) ? body.items : [];
  const waitMins = computeWaitTimeMins(items, resolveEffectiveStoreId(req, url));
  sendJson(res, 200, { waitMins });
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
    stockCount,
    isVeg: body.isVeg !== false, // defaults veg unless explicitly marked non-veg
    allergens: body.allergens ? String(body.allergens).trim().slice(0, 200) : null,
    prepTimeMins: sanitizePrepTimeMins(body.prepTimeMins)
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
  if (body.disabledStores !== undefined) {
    const validIds = new Set(readJson(STORES_FILE, []).map((s) => s.id));
    const disabledStores = (Array.isArray(body.disabledStores) ? body.disabledStores : [])
      .map((id) => Number(id))
      .filter((id) => validIds.has(id));
    item.disabledStores = [...new Set(disabledStores)];
  }
  if (body.isVeg !== undefined) item.isVeg = body.isVeg !== false;
  if (body.allergens !== undefined) {
    item.allergens = body.allergens ? String(body.allergens).trim().slice(0, 200) || null : null;
  }
  if (body.prepTimeMins !== undefined) item.prepTimeMins = sanitizePrepTimeMins(body.prepTimeMins);
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
// Franchise governance: branding/theme/shop-identity/loyalty/footer are all
// global-only now (Global Admin's lane, consistent everywhere) - a store
// only owns its own contact info, home-page picks override, tax/currency
// override, and operations. These three helpers validate/clamp those
// per-store fields the exact same way the (now-removed) global-only
// versions used to, shared by PATCH /api/config's franchise-wide defaults
// and PATCH /api/stores/:id's per-store overrides so the two never drift.

/** Validates a homePicks array against the live menu catalog - shared by
 *  the franchise-wide default (PATCH /api/config) and a store's own
 *  override (PATCH /api/stores/:id). Returns undefined (meaning "don't
 *  touch this field") when the input isn't an array at all. */
function sanitizeHomePicks(rawPicks) {
  if (!Array.isArray(rawPicks)) return undefined;
  const menu = readJson(MENU_FILE, { items: [] });
  const validItemIds = new Set(menu.items.map((i) => i.id));
  return rawPicks
    .filter((p) => p && validItemIds.has(Number(p.itemId)))
    .slice(0, 3)
    .map((p) => ({
      itemId: Number(p.itemId),
      tag: String(p.tag || "").replace(/[\r\n\t]/g, " ").trim().slice(0, 40)
    }));
}

function sanitizeTableCount(value, fallback = 10) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 200) : fallback;
}

function sanitizeArcade(rawArcade, existing) {
  const merged = { ...existing, ...(rawArcade && typeof rawArcade === "object" ? rawArcade : {}) };
  merged.enabled = merged.enabled !== false;
  const hours = Number(merged.sessionHours);
  merged.sessionHours = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24) : 2;
  return merged;
}

function sanitizeWaitTime(rawWaitTime, existing) {
  const merged = { ...existing, ...(rawWaitTime && typeof rawWaitTime === "object" ? rawWaitTime : {}) };
  merged.enabled = merged.enabled !== false;
  const minMins = Number(merged.minMins);
  merged.minMins = Number.isFinite(minMins) && minMins >= 0 ? Math.min(minMins, 60) : 5;
  return merged;
}

const DELIVERY_MESSAGE_PRESETS = {
  queueFull: "Too many orders right now - delivery is paused, we'll be back shortly.",
  noPartner: "No delivery partner available at the moment."
};

/** Merges a delivery-settings patch onto the existing value, enforcing the
 *  two-tier lock: a manager/Local Admin can flip `enabled`/`message`
 *  freely UNLESS `lockedBy === "globalAdmin"`, in which case those two
 *  fields are held at their current value no matter what the caller sent -
 *  only a Global Admin can touch `lockedBy` itself (to set OR clear it),
 *  and setting it to "globalAdmin" always forces `enabled: false` in that
 *  same write, so a lock can never be applied without actually disabling
 *  delivery. This is the one place in the app where a lower role's write to
 *  a field can be silently overridden by a standing lock from a higher
 *  one - every other per-store setting is plain "whoever can manage this
 *  store can change it," see PATCH /api/stores/:id's operations block. */
function sanitizeDelivery(raw, existing, isGlobalAdmin) {
  const current = existing || DEFAULT_STORE_OPERATIONS.delivery;
  const input = raw && typeof raw === "object" ? raw : {};

  let lockedBy = current.lockedBy || null;
  let justLocked = false;
  if ("lockedBy" in input && isGlobalAdmin) {
    lockedBy = input.lockedBy === "globalAdmin" ? "globalAdmin" : null;
    justLocked = lockedBy === "globalAdmin";
  }

  const canEditEnabledAndMessage = isGlobalAdmin || lockedBy !== "globalAdmin";

  let enabled = current.enabled !== false;
  if (justLocked) {
    enabled = false;
  } else if ("enabled" in input && canEditEnabledAndMessage) {
    enabled = input.enabled !== false;
  }

  let message = current.message || { preset: null, customText: "" };
  if ("message" in input && canEditEnabledAndMessage && input.message && typeof input.message === "object") {
    const preset = typeof input.message.preset === "string" && DELIVERY_MESSAGE_PRESETS[input.message.preset] ? input.message.preset : null;
    const customText = typeof input.message.customText === "string" ? input.message.customText.trim().slice(0, 200) : "";
    message = { preset, customText };
  }

  return { enabled, lockedBy, message };
}

const DEFAULT_STORE_OPERATIONS = {
  tableCount: 10,
  arcade: { enabled: true, sessionHours: 2 },
  waitTime: { enabled: true, minMins: 5 },
  delivery: { enabled: true, lockedBy: null, message: { preset: null, customText: "" } }
};

/** Great-circle distance in km between two lat/lng points (spherical Earth
 *  approximation) - accurate enough for a same-city delivery-radius check,
 *  no external service/dependency needed. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Resolves a store's own settings on top of the franchise-wide config:
 *  payments/tax fields fall back to the franchise default when the store
 *  hasn't overridden them (nullable per field); operations (tables/arcade)
 *  is fully store-owned with no franchise fallback once migrated; homePicks
 *  falls back to the franchise-wide picks when the store hasn't curated its
 *  own; contact (address/phone) always wins over the franchise default the
 *  same way address already did. Shared by configForSession() (client-
 *  facing reads) and everywhere tax/table-count is actually used for real
 *  money/logic (computeOrder, billing-settle, table-session routes) so
 *  those two can never disagree about what a store's effective settings are. */
// A missing `store` (no store context at all - an owner/Global Admin's own
// view, or an order/session that was never tied to a store) is NOT the same
// as "use plain global config" - tableCount/arcade were removed from global
// config entirely in the franchise-governance redesign (they're fully
// per-store now, see DEFAULT_STORE_OPERATIONS), so a naive `if (!store)
// return config` leaves config.tableCount/config.arcade undefined and
// crashes the first caller that reads `.arcade.enabled` (confirmed via
// GET /api/arcade/access on a storeless guest order). Every field below is
// therefore resolved with `store &&` guards instead of short-circuiting on
// the whole function, so the DEFAULT_STORE_OPERATIONS fallback always
// applies even with no store at all.
function mergeStoreOverrides(config, store) {
  const payments = (store && store.payments) || {};
  const operations = (store && store.operations) || DEFAULT_STORE_OPERATIONS;
  return {
    ...config,
    cgstRate: payments.cgstRate ?? config.cgstRate,
    sgstRate: payments.sgstRate ?? config.sgstRate,
    serviceChargeRate: payments.serviceChargeRate ?? config.serviceChargeRate,
    tipEnabled: payments.tipEnabled ?? config.tipEnabled,
    tipAmount: payments.tipAmount ?? config.tipAmount,
    currencySymbol: payments.currencySymbol ?? config.currencySymbol,
    currencyCode: payments.currencyCode ?? config.currencyCode,
    tableCount: operations.tableCount ?? DEFAULT_STORE_OPERATIONS.tableCount,
    arcade: operations.arcade || DEFAULT_STORE_OPERATIONS.arcade,
    waitTime: operations.waitTime || DEFAULT_STORE_OPERATIONS.waitTime,
    delivery: operations.delivery || DEFAULT_STORE_OPERATIONS.delivery,
    homePicks: store && store.homePicks !== undefined ? store.homePicks : config.homePicks,
    footer: {
      ...config.footer,
      ...(store && store.address ? { address: store.address } : {}),
      ...(store && store.phone ? { phone: store.phone } : {})
    }
  };
}

/** Backlog-and-parallelism-aware wait estimate. Drinks (BARISTA/KITCHEN
 *  stations) draw from a shared pool of PARALLEL_DRINK_SLOTS "slots"
 *  rather than being timed strictly one-after-another - the whole backlog
 *  (every not-yet-done drink line across every order still in progress,
 *  frozen prepTimeMins and all - see computeOrder()) plus this prospective
 *  order's own drink lines are summed into one queue of slot-minutes, then
 *  divided by the slot count. Pre-ready items (DESSERTS) add one flat
 *  minute total if the order has any, never per-unit and never using
 *  their own prepTimeMins - they're not sitting in the same queue at all.
 *  `cartItems` is the same raw {id, quantity} shape used everywhere else
 *  (POST /api/orders) - pass [] for an "ambient current wait" reading with
 *  no specific order in mind (see GET /api/wait-time). Returns null when
 *  the store has this turned off (Admin > Store Setup > Operations). */
function computeWaitTimeMins(cartItems, storeId) {
  const allStores = readJson(STORES_FILE, []);
  const store = storeId != null ? allStores.find((s) => s.id === storeId) : null;
  const waitConfig = mergeStoreOverrides(readJson(CONFIG_FILE, {}), store).waitTime;
  if (!waitConfig.enabled) return null;

  const orders = readJson(ORDERS_FILE, []);
  let backlogSlotMinutes = 0;
  for (const order of orders) {
    if (storeId != null && order.storeId !== storeId) continue;
    if (order.servedAt) continue; // fully handed off - nothing left queued
    for (const line of order.items) {
      if (line.isDone) continue;
      if (line.station !== "BARISTA" && line.station !== "KITCHEN") continue;
      backlogSlotMinutes += (line.prepTimeMins ?? DEFAULT_PREP_TIME_MINS) * line.quantity;
    }
  }

  const menu = readJson(MENU_FILE, { items: [] });
  let thisOrderSlotMinutes = 0;
  let hasPreReady = false;
  for (const requested of cartItems) {
    const product = menu.items.find((i) => i.id === Number(requested.id));
    if (!product) continue;
    const quantity = Math.max(1, Math.min(50, parseInt(requested.quantity, 10) || 0));
    if (getStation(product) === "DESSERTS") {
      hasPreReady = true;
    } else {
      thisOrderSlotMinutes += (product.prepTimeMins ?? DEFAULT_PREP_TIME_MINS) * quantity;
    }
  }

  const queuedMinutes = Math.ceil((backlogSlotMinutes + thisOrderSlotMinutes) / PARALLEL_DRINK_SLOTS);
  return Math.max(waitConfig.minMins, queuedMinutes) + (hasPreReady ? PRE_READY_FLAT_MINS : 0);
}

// A customer/guest session has no storeId of its own (they can walk into
// any location), so `explicitStoreId` lets one be passed in from the
// client's own chosen store instead (see GET /api/config below) - this
// keeps the merge entirely server-side either way: the client's existing
// applyBranding()/AdminConfig flow doesn't need to know stores exist at
// all, it just receives whatever's already effective.
function configForSession(session, explicitStoreId = null) {
  const config = readJson(CONFIG_FILE, {});
  const storeId = session && session.storeId != null ? session.storeId : explicitStoreId;
  if (storeId == null) return config;
  const store = readJson(STORES_FILE, []).find((s) => s.id === storeId);
  return mergeStoreOverrides(config, store);
}

// Never send the raw Razorpay key secret to the client - only whether it's
// configured (for the admin UI's own display) and the public key id (safe,
// it's meant for the client-side checkout widget). The secret only ever
// needs to leave this process when calling Razorpay's API server-to-server.
function maskSecrets(config) {
  const { razorpayKeySecret, ...rest } = config;
  return { ...rest, razorpaySecretConfigured: !!razorpayKeySecret };
}

route("GET", /^\/api\/config\/?$/, async (req, res, params, url) => {
  const session = currentSession(req);
  // A session already tied to a store (staff) always wins - the ?storeId=
  // param only matters for a customer/guest/anonymous visitor picking their
  // own store client-side. NOT honored for owner/admin: their storeId is
  // also null, but because they're unrestricted, not because they're a
  // customer - without this role check, a customer's local store pick on
  // the same browser would leak into their own admin view.
  const isTrackingOrAnonymous = !session || TRACKING_ROLES.includes(session.role);
  let explicitStoreId = null;
  if (session?.storeId == null && isTrackingOrAnonymous && url.searchParams.has("storeId")) {
    const requestedStoreId = Number(url.searchParams.get("storeId"));
    if (Number.isFinite(requestedStoreId)) explicitStoreId = requestedStoreId;
  }
  sendJson(res, 200, maskSecrets(configForSession(session, explicitStoreId)));
});

route("PATCH", /^\/api\/config\/?$/, async (req, res) => {
  if (!requireGlobalAdmin(req, res)) return;
  const body = await readBody(req);
  const config = readJson(CONFIG_FILE, {});
  const allowed = [
    "shopName",
    "currencySymbol",
    "currencyCode",
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
    "logoWideUrl",
    "upiVpa",
    "upiPayeeName",
    "defaultNavLayout",
    "heroCaptionLabel",
    "razorpayEnabled",
    "razorpayKeyId"
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
  if (config.defaultNavLayout !== undefined && config.defaultNavLayout !== "rail" && config.defaultNavLayout !== "topbar") {
    config.defaultNavLayout = "rail";
  }
  if (config.razorpayEnabled !== undefined) config.razorpayEnabled = Boolean(config.razorpayEnabled);
  if (typeof config.razorpayKeyId === "string") config.razorpayKeyId = config.razorpayKeyId.trim().slice(0, 100);
  // Never echoed back by GET /api/config (see maskSecrets()) - only ever
  // updated when a real new value is actually typed, so re-saving the rest
  // of this form (which never receives the real secret to redisplay) can't
  // accidentally wipe it with an empty string.
  if (typeof body.razorpayKeySecret === "string" && body.razorpayKeySecret.trim()) {
    config.razorpayKeySecret = body.razorpayKeySecret.trim().slice(0, 200);
  }
  // shopName/heroTagline are rendered directly into the home page - cap
  // length and strip control chars so a bad paste can't break layout.
  if (typeof config.shopName === "string") config.shopName = config.shopName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  if (typeof config.currencySymbol === "string") {
    const trimmed = Array.from(config.currencySymbol).filter(function (ch) { return ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127; }).join("").trim().slice(0, 3);
    config.currencySymbol = trimmed || "₹";
  }
  if (typeof config.currencyCode === "string") {
    const code = config.currencyCode.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
    config.currencyCode = code.length === 3 ? code : "INR";
  }
  if (typeof config.gstNumber === "string") config.gstNumber = Array.from(config.gstNumber).filter(function (ch) { return ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127; }).join("").trim().toUpperCase().slice(0, 20);
  if (typeof config.receiptFooterText === "string") config.receiptFooterText = config.receiptFooterText.trim().slice(0, 120);
  if (typeof config.heroCaptionLabel === "string") {
    config.heroCaptionLabel = Array.from(config.heroCaptionLabel)
      .filter(function (ch) { return ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127; })
      .join("")
      .trim()
      .slice(0, 40);
  }
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
  // Admin-defined extra footer/"Find us" fields (Instagram, GST no,
  // WhatsApp, whatever a given shop wants) beyond the fixed
  // tagline/address/phone/email/hours set - replaced wholesale like
  // homePicks/roastSteps, since it's an ordered custom list, not independent keys.
  if (Array.isArray(body.customFooterFields)) {
    config.customFooterFields = body.customFooterFields
      .filter((f) => f && (f.label || f.value))
      .slice(0, 6)
      .map((f) => {
        // url: only accepted as an actual http(s) link - anything else
        // (javascript:, empty, malformed) just renders as plain text
        // instead, same as before this field existed.
        const rawUrl = String(f.url || "").trim();
        let url = "";
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") url = rawUrl.slice(0, 300);
        } catch (e) {
          // not a valid absolute URL - leave url blank
        }
        return {
          label: String(f.label || "").trim().slice(0, 30),
          value: String(f.value || "").trim().slice(0, 100),
          url,
          type: ["social", "career"].includes(f.type) ? f.type : "other"
        };
      });
  }
  if (body.customIcons && typeof body.customIcons === "object") {
    config.customIcons = { ...config.customIcons, ...body.customIcons };
  }
  // Home page "This week's picks" - which items feature there and what tag
  // each shows (e.g. "House favourite"). Replaced wholesale (not merged like
  // colors/footer above) since it's an ordered, curated list, not a bag of
  // independent keys - a partial update wouldn't make sense here. This is
  // the franchise-wide DEFAULT - a store overrides it via its own
  // PATCH /api/stores/:id body.homePicks (see mergeStoreOverrides()).
  const sanitizedHomePicks = sanitizeHomePicks(body.homePicks);
  if (sanitizedHomePicks !== undefined) config.homePicks = sanitizedHomePicks;
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
  sendJson(res, 200, maskSecrets(config));
});

route("DELETE", /^\/api\/config\/custom-icons\/(?<key>[\w-]+)\/?$/, async (req, res, params) => {
  if (!requireGlobalAdmin(req, res)) return;
  const config = readJson(CONFIG_FILE, {});
  if (config.customIcons) delete config.customIcons[params.key];
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, maskSecrets(config));
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

// SVG deliberately excluded: an uploaded SVG can carry <script>/event-handler
// XSS that fires if a browser ever opens the uploaded file's URL directly
// (not just when it's used as an <img src>) - not worth it without a
// sanitizer library, which this hand-rolled server has none of.
const UPLOAD_MIME_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp"
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
  if (!ext) return sendJson(res, 400, { error: "Unsupported image type - use PNG, JPEG, GIF, or WEBP" });
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

// An upload is referenced by embedding its URL string wherever it's picked
// (menu item photos, branding images) rather than by the upload's own id -
// so "is this still used" has to check those URL fields directly, not a
// foreign key. Checked live at delete time instead of maintaining a stored
// reverse-index (which would just be the same relationship duplicated).
function findUploadUsage(url) {
  const usedIn = [];
  const menu = readJson(MENU_FILE, { items: [] });
  menu.items.forEach((i) => {
    if (i.imageUrl === url) usedIn.push(`menu item "${i.name}"`);
  });
  const config = readJson(CONFIG_FILE, {});
  if (config.heroImageUrl === url) usedIn.push("home page hero image");
  if (config.logoUrl === url) usedIn.push("logo");
  if (config.logoWideUrl === url) usedIn.push("wide logo");
  Object.entries(config.customIcons || {}).forEach(([key, iconUrl]) => {
    if (iconUrl === url) usedIn.push(`custom icon "${key}"`);
  });
  return usedIn;
}

route("DELETE", /^\/api\/uploads\/(?<id>[\w-]+)\/?$/, async (req, res, params, url) => {
  if (!requireRole(req, res, KITCHEN_ROLES)) return;
  const uploads = readJson(UPLOADS_MANIFEST_FILE, []);
  const entry = uploads.find((u) => u.id === params.id);
  if (!entry) return sendJson(res, 404, { error: "Upload not found" });
  const usedIn = findUploadUsage(`/uploads/${entry.filename}`);
  if (usedIn.length && url.searchParams.get("force") !== "true") {
    return sendJson(res, 409, { error: `Still used by: ${usedIn.join(", ")}`, usedIn });
  }
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
  "addresses.json": ADDRESSES_FILE,
  "raw-materials.json": RAW_MATERIALS_FILE,
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

// Whole-instance restore is the single most destructive route in the app -
// tightened to Global Admin only (owner keeps read/download above, but
// never writes here, matching read-only-outside-adding-Global-Admins).
route("POST", /^\/api\/admin\/restore\/?$/, async (req, res) => {
  if (!requireGlobalAdmin(req, res)) return;
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
  // A backup taken before someone deleted their account would otherwise
  // resurrect that account's real login credentials the moment it's
  // restored - capture who's currently deleted BEFORE users.json gets
  // overwritten below, then re-scrub those same accounts in the restored
  // data. Deletion is meant to be permanent from the user's perspective, not
  // undoable by rolling back to an older snapshot.
  const previouslyDeleted = readJson(USERS_FILE, []).filter((u) => u.accountDeleted);

  let restoredCount = 0;
  for (const [name, filePath] of Object.entries(BACKUP_FILES)) {
    if (body.files[name] !== undefined && body.files[name] !== null) {
      writeJson(filePath, body.files[name]);
      restoredCount++;
    }
  }

  if (previouslyDeleted.length && body.files["users.json"] !== undefined) {
    const restoredUsers = readJson(USERS_FILE, []);
    let resealed = false;
    previouslyDeleted.forEach((deletedUser) => {
      const match = restoredUsers.find((u) => u.id === deletedUser.id || u.username === deletedUser.username);
      if (match && !match.accountDeleted) {
        match.name = "Deleted User";
        match.phone = null;
        match.salt = crypto.randomBytes(16).toString("hex");
        match.hash = crypto.randomBytes(64).toString("hex");
        match.accountDeleted = true;
        match.deletedAt = deletedUser.deletedAt || new Date().toISOString();
        resealed = true;
      }
    });
    if (resealed) writeJson(USERS_FILE, restoredUsers);

    if (body.files["arcade-scores.json"] !== undefined) {
      const restoredScores = readJson(ARCADE_SCORES_FILE, []);
      const deletedIds = new Set(previouslyDeleted.map((u) => u.id));
      let scoresResealed = false;
      restoredScores.forEach((s) => {
        if (deletedIds.has(s.customerId) && s.name !== "Deleted User") {
          s.name = "Deleted User";
          scoresResealed = true;
        }
      });
      if (scoresResealed) writeJson(ARCADE_SCORES_FILE, restoredScores);
    }
  }

  sendJson(res, 200, { ok: true, restoredCount });
});

// ---------------------------------------------------------------------------
// Per-store backup/restore - same flat JSON files as the whole-instance
// backup above (no physical per-store split, see the Phase 6 design notes),
// filtered/restored to just one store's own records via each entity's own
// storeId (or, for payroll/attendance/overtime which don't carry storeId
// directly, a join on the record's userId -> users.json[].storeId).
// ---------------------------------------------------------------------------

// Entities that carry their own storeId field directly.
const STORE_SCOPED_DIRECT_FILES = {
  "orders.json": ORDERS_FILE,
  "table-sessions.json": TABLE_SESSIONS_FILE,
  "timeclock.json": TIMECLOCK_FILE
};

// Entities scoped via a join on userId (they predate storeId entirely, and
// adding it retroactively would mean re-attributing history no differently
// than this join already does).
const STORE_SCOPED_VIA_USER_FILES = {
  "payroll.json": PAYROLL_FILE,
  "attendance.json": ATTENDANCE_FILE,
  "overtime-approvals.json": OVERTIME_APPROVALS_FILE
};

function scopedBackupForStore(storeId) {
  const stores = readJson(STORES_FILE, []);
  const store = stores.find((s) => s.id === storeId);
  if (!store) return null;

  const files = {};
  for (const [name, filePath] of Object.entries(STORE_SCOPED_DIRECT_FILES)) {
    files[name] = readJson(filePath, []).filter((r) => r.storeId === storeId);
  }
  // Only this store's own local discounts - a franchise-wide coupon
  // (storeId null) belongs to the whole-instance backup, not here.
  files["coupons.json"] = readJson(COUPONS_FILE, []).filter((c) => c.storeId === storeId);

  const users = readJson(USERS_FILE, []);
  const staffIdsAtStore = new Set(users.filter((u) => u.storeId === storeId).map((u) => u.id));
  for (const [name, filePath] of Object.entries(STORE_SCOPED_VIA_USER_FILES)) {
    files[name] = readJson(filePath, []).filter((r) => staffIdsAtStore.has(r.userId));
  }

  return {
    exportedAt: new Date().toISOString(),
    storeId,
    storeName: store.name,
    store: {
      address: store.address || "",
      phone: store.phone || "",
      lat: store.lat ?? null,
      lng: store.lng ?? null,
      homePicks: store.homePicks,
      payments: store.payments || null,
      operations: store.operations || null
    },
    files
  };
}

/** Reassigns any incoming record's id that collides with a record already
 *  belonging to a DIFFERENT store (ids are shared global counters/random
 *  strings today, not per-store) - and force-stamps storeId on every
 *  incoming record regardless of what the file itself claims, so a doctored
 *  backup can never restore itself into a different store than the URL
 *  says. idStyle picks the right id shape to generate on collision: this
 *  app's own id formats (see POST /api/orders, /api/table-sessions,
 *  /api/coupons, timeclock's clock-in handler). */
function reassignStoreScopedIds(otherStoreRecords, incomingRecords, storeId, idStyle) {
  const usedIds = new Set(otherStoreRecords.map((r) => r.id));
  let nextNumericId = usedIds.size ? Math.max(0, ...[...usedIds].filter((id) => typeof id === "number")) + 1 : 1;
  const genId = () => (idStyle === "numeric" ? nextNumericId++ : `${idStyle}${crypto.randomBytes(3).toString("hex").toUpperCase()}`);
  return incomingRecords.map((r) => {
    let id = r.id;
    if (id === undefined || usedIds.has(id)) id = genId();
    usedIds.add(id);
    return { ...r, id, storeId };
  });
}

route("GET", /^\/api\/admin\/backup\/store\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const storeId = Number(params.id);
  if (!canManageStore(session, storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store" });
  }
  const backup = scopedBackupForStore(storeId);
  if (!backup) return sendJson(res, 404, { error: "Store not found" });
  const body = JSON.stringify(backup, null, 2);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="backup-store-${storeId}-${new Date().toISOString().slice(0, 10)}.json"`
  });
  res.end(body);
});

route("POST", /^\/api\/admin\/restore\/store\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  if (session.role === "owner") {
    return sendJson(res, 403, { error: "Owner has read-only access to store data" });
  }
  const storeId = Number(params.id);
  if (!canManageStore(session, storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store" });
  }
  const stores = readJson(STORES_FILE, []);
  const store = stores.find((s) => s.id === storeId);
  if (!store) return sendJson(res, 404, { error: "Store not found" });

  let body;
  try {
    body = await readBody(req, 20 * 1024 * 1024);
  } catch (e) {
    return sendJson(res, 413, { error: "Backup file too large" });
  }
  if (!body.confirmYes) return sendJson(res, 400, { error: "Missing confirmation" });
  if (!body.files || typeof body.files !== "object") {
    return sendJson(res, 400, { error: "That doesn't look like a store backup file" });
  }

  const users = readJson(USERS_FILE, []);
  const staffIdsAtStore = new Set(users.filter((u) => u.storeId === storeId).map((u) => u.id));
  const warnings = [];
  let restoredCount = 0;

  // "orders.json" changed from "SB-" (random hex string) to "numeric" -
  // order.id is a plain incrementing integer now (see POST /api/orders),
  // never touch this back to "SB-" or a restore collision would silently
  // start minting old-format string ids again.
  const idStyles = { "orders.json": "numeric", "table-sessions.json": "TBL-", "timeclock.json": "numeric" };
  for (const [name, filePath] of Object.entries(STORE_SCOPED_DIRECT_FILES)) {
    if (!Array.isArray(body.files[name])) continue;
    const existing = readJson(filePath, []);
    const otherStoreRecords = existing.filter((r) => r.storeId !== storeId);
    const incoming = reassignStoreScopedIds(otherStoreRecords, body.files[name], storeId, idStyles[name]);
    writeJson(filePath, [...otherStoreRecords, ...incoming]);
    restoredCount += incoming.length;
  }

  if (Array.isArray(body.files["coupons.json"])) {
    const existingCoupons = readJson(COUPONS_FILE, []);
    const otherCoupons = existingCoupons.filter((c) => c.storeId !== storeId);
    const incoming = reassignStoreScopedIds(otherCoupons, body.files["coupons.json"], storeId, "numeric");
    writeJson(COUPONS_FILE, [...otherCoupons, ...incoming]);
    restoredCount += incoming.length;
  }

  // Payroll/attendance/overtime: a record whose user no longer exists (or
  // has since moved to a different store) can't be safely re-attributed -
  // dropped with a warning rather than guessed at, since this can only ever
  // be restored correctly onto the same users.json state it was backed up
  // against.
  for (const [name, filePath] of Object.entries(STORE_SCOPED_VIA_USER_FILES)) {
    if (!Array.isArray(body.files[name])) continue;
    const existing = readJson(filePath, []);
    const keep = existing.filter((r) => !staffIdsAtStore.has(r.userId));
    const incoming = [];
    for (const r of body.files[name]) {
      if (!staffIdsAtStore.has(r.userId)) {
        warnings.push(`${name}: skipped a record for a user no longer at this store (userId ${r.userId})`);
        continue;
      }
      incoming.push(r);
    }
    writeJson(filePath, [...keep, ...incoming]);
    restoredCount += incoming.length;
  }

  if (body.store && typeof body.store === "object") {
    const s = body.store;
    if (typeof s.address === "string") store.address = s.address.slice(0, 200);
    if (typeof s.phone === "string") store.phone = s.phone.slice(0, 20);
    if (s.lat !== undefined) store.lat = s.lat;
    if (s.lng !== undefined) store.lng = s.lng;
    if (s.homePicks !== undefined) store.homePicks = sanitizeHomePicks(s.homePicks);
    if (s.payments && typeof s.payments === "object") store.payments = { ...store.payments, ...s.payments };
    if (s.operations && typeof s.operations === "object") store.operations = { ...store.operations, ...s.operations };
    writeJson(STORES_FILE, stores);
  }

  sendJson(res, 200, { ok: true, restoredCount, warnings });
});

route("POST", /^\/api\/config\/reset-branding\/?$/, async (req, res) => {
  // Resets ONLY the visual branding fields back to the original hardcoded
  // look - shop name, tax rates, and footer/store-details are untouched.
  if (!requireGlobalAdmin(req, res)) return;
  const config = readJson(CONFIG_FILE, {});
  config.theme = DEFAULT_BRANDING.theme;
  config.colors = { ...DEFAULT_BRANDING.colors };
  config.heroImageUrl = DEFAULT_BRANDING.heroImageUrl;
  config.logoUrl = DEFAULT_BRANDING.logoUrl;
  config.logoWideUrl = DEFAULT_BRANDING.logoWideUrl;
  config.textStyles = {
    adminTabs: { ...DEFAULT_BRANDING.textStyles.adminTabs },
    adminHelp: { ...DEFAULT_BRANDING.textStyles.adminHelp },
    adminLabels: { ...DEFAULT_BRANDING.textStyles.adminLabels }
  };
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, maskSecrets(config));
});

// --- Branding profiles ("holiday themes" the admin can save and switch between) ---
// Viewing the saved-profiles list is not itself a franchise-wide-settings
// WRITE - anyone reaching the admin panel can see what's saved (matches
// GET /api/config, already universally readable); only activating/saving/
// deleting a profile is Global-Admin-only (see below).
route("GET", /^\/api\/branding-profiles\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  sendJson(res, 200, readJson(BRANDING_PROFILES_FILE, {}));
});

route("POST", /^\/api\/branding-profiles\/?$/, async (req, res) => {
  // Saves the CURRENT live branding (theme/colors/hero/logo) as a named,
  // reusable profile - e.g. "Diwali", "Christmas" - to switch to later.
  if (!requireGlobalAdmin(req, res)) return;
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "Profile name is required" });

  const config = readJson(CONFIG_FILE, {});
  const profiles = readJson(BRANDING_PROFILES_FILE, {});
  profiles[name] = {
    theme: config.theme,
    colors: config.colors,
    heroImageUrl: config.heroImageUrl,
    logoUrl: config.logoUrl,
    logoWideUrl: config.logoWideUrl
  };
  writeJson(BRANDING_PROFILES_FILE, profiles);
  sendJson(res, 201, profiles);
});

route("POST", /^\/api\/branding-profiles\/(?<name>[^/]+)\/activate\/?$/, async (req, res, params) => {
  if (!requireGlobalAdmin(req, res)) return;
  const profiles = readJson(BRANDING_PROFILES_FILE, {});
  const name = decodeURIComponent(params.name);
  const profile = profiles[name];
  if (!profile) return sendJson(res, 404, { error: "Profile not found" });

  const config = readJson(CONFIG_FILE, {});
  config.theme = profile.theme;
  config.colors = profile.colors;
  config.heroImageUrl = profile.heroImageUrl;
  config.logoUrl = profile.logoUrl;
  config.logoWideUrl = profile.logoWideUrl;
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, maskSecrets(config));
});

route("DELETE", /^\/api\/branding-profiles\/(?<name>[^/]+)\/?$/, async (req, res, params) => {
  if (!requireGlobalAdmin(req, res)) return;
  const profiles = readJson(BRANDING_PROFILES_FILE, {});
  const name = decodeURIComponent(params.name);
  delete profiles[name];
  writeJson(BRANDING_PROFILES_FILE, profiles);
  sendJson(res, 200, profiles);
});

// --- Orders ---
route("GET", /^\/api\/orders\/?$/, async (req, res, params, url) => {
  // Full order list is for staff running the register/kitchen/admin views
  // (this one endpoint backs both the live Kitchen board and the admin
  // Order History screen) - scoped to whichever stores this session can
  // see (accessibleStoreIds() - null means unrestricted, e.g. owner). A
  // customer isn't tied to one store (they can walk into any location), so
  // customer/guest orders commonly have no storeId until Phase 2's store
  // picker sets one - those stay visible everywhere rather than nowhere.
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  let orders = readJson(ORDERS_FILE, []);
  const allowed = accessibleStoreIds(session);
  if (allowed) orders = orders.filter((o) => o.storeId == null || allowed.includes(o.storeId));
  // Order History's optional store drill-down (?storeId=) for an
  // admin/owner who can see more than one store - ignored (has no further
  // effect) for a manager/employee, whose `allowed` above is already just
  // their own single store.
  if (url.searchParams.has("storeId")) {
    const requestedStoreId = Number(url.searchParams.get("storeId"));
    if (Number.isFinite(requestedStoreId) && (!allowed || allowed.includes(requestedStoreId))) {
      orders = orders.filter((o) => o.storeId === requestedStoreId);
    }
  }
  // Coupon audit ("which orders used code X"): a live filter on the same
  // couponId every order already stores, not a stored reverse-index on the
  // coupon itself - a coupon has no business reason to know its own usage
  // list, that would just be the same relationship duplicated a second way.
  if (url.searchParams.has("couponId")) {
    const requestedCouponId = Number(url.searchParams.get("couponId"));
    if (Number.isFinite(requestedCouponId)) orders = orders.filter((o) => o.couponId === requestedCouponId);
  }
  // Same inclusive from/to-day semantics as the client-side date filters
  // (Admin Order History, Kitchen HISTORY) - either bound alone is an
  // open-ended range, both set (even to the same day) filters just that day.
  const fromDate = url.searchParams.get("from");
  const toDate = url.searchParams.get("to");
  if (fromDate) {
    const fromTs = new Date(fromDate + "T00:00:00").getTime();
    orders = orders.filter((o) => new Date(o.createdAt).getTime() >= fromTs);
  }
  if (toDate) {
    const toTs = new Date(toDate + "T23:59:59.999").getTime();
    orders = orders.filter((o) => new Date(o.createdAt).getTime() <= toTs);
  }
  const statusFilter = url.searchParams.get("status");
  if (statusFilter === "active" || statusFilter === "completed") {
    orders = orders.filter((o) => {
      const complete = o.items.every((i) => i.isDone);
      return statusFilter === "active" ? !complete : complete;
    });
  }
  orders.sort((a, b) => (url.searchParams.get("sort") === "oldest" ? 1 : -1) * (new Date(a.createdAt) - new Date(b.createdAt)));

  // Only paginates when asked - Kitchen/Billing still want the full
  // (already store/date/status-scoped) array to do their own client-side
  // grouping, only Admin Order History's browse-everything view actually
  // needs a bounded page + total at real scale.
  if (url.searchParams.has("page") || url.searchParams.has("limit")) {
    const total = orders.length;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 10, 1), 100);
    const page = Math.max(parseInt(url.searchParams.get("page"), 10) || 1, 1);
    const items = orders.slice((page - 1) * limit, page * limit);
    return sendJson(res, 200, { items, total });
  }
  sendJson(res, 200, orders);
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

// No login required - the token itself (from the QR code shown at checkout,
// see trackingToken above) is the credential, same trust model as a
// password-reset link. Returns only what a customer needs to see their own
// order's progress, never the full order record (no phone/customer id/
// internal ids beyond the display number).
route("GET", /^\/api\/orders\/track\/(?<token>[a-f0-9]+)\/?$/, async (req, res, params) => {
  const orders = readJson(ORDERS_FILE, []);
  const order = orders.find((o) => o.trackingToken === params.token);
  if (!order) return sendJson(res, 404, { error: "Order not found" });
  sendJson(res, 200, {
    orderNumber: order.orderNumber || order.id,
    status: orderStatusOf(order),
    isPaid: order.isPaid,
    total: order.total,
    orderType: order.orderType,
    tableNumber: order.tableNumber,
    createdAt: order.createdAt,
    items: order.items.map((i) => ({ name: i.name, quantity: i.quantity }))
  });
});

// Staff-only lookup for the "attach to existing bill" picker (checkout-
// modal.js / billing-page.js). A short, capped, server-filtered result list
// since this fires on every keystroke - deliberately NOT reusing GET
// /api/orders (the full unpaginated Order History list, which only ever
// grows) for a typed-as-you-go autocomplete. No route-ordering conflict:
// there's no GET /api/orders/:id today (only /mine and /track/:token) - but
// keep this registered before any such route is ever added.
route("GET", /^\/api\/orders\/search\/?$/, async (req, res, params, url) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (!q) return sendJson(res, 200, []);
  const qDigits = q.replace(/\D/g, "");
  let allOrders = readJson(ORDERS_FILE, []);
  const allowed = accessibleStoreIds(session);
  if (allowed) allOrders = allOrders.filter((o) => o.storeId == null || allowed.includes(o.storeId));
  const roots = allOrders.filter((o) => !o.attachedToOrderId); // root bills only - no attach chains
  const matches = roots.filter(
    (o) =>
      String(o.orderNumber || o.id).toLowerCase().includes(q) ||
      (o.customerName || "").toLowerCase().includes(q) ||
      (qDigits && (o.customerPhone || "").replace(/\D/g, "").includes(qDigits)) ||
      (o.tableNumber != null && String(o.tableNumber).toLowerCase().includes(q))
  );
  matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sendJson(
    res,
    200,
    matches.slice(0, 15).map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      tableNumber: o.tableNumber,
      total: o.total,
      isPaid: o.isPaid,
      // Checked against the FULL order list, not the roots-only one above -
      // an attachment's own attachedToOrderId would never survive that
      // filter, so this would silently always be false otherwise.
      hasAttachments: allOrders.some((x) => x.attachedToOrderId === o.id)
    }))
  );
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

  // Staff taking a counter order can mark it explicitly as a walk-in guest
  // who doesn't want to give a number - only staff get this bypass, since a
  // self-checkout customer/guest session always has some identity already
  // (a login, or the guest session's own phone). A guest order like this
  // can never be tracked/looked-up afterward (no phone, no account) - an
  // accepted trade-off for someone who declines to give a number.
  const isGuestOrder = KITCHEN_ROLES.includes(session.role) && body.guestOrder === true;
  // Staff placing a counter order may type whichever phone the customer in
  // front of them gives - but a customer/guest placing their OWN order can
  // never substitute a different number than the one their own session is
  // already tied to. Without this, a logged-in customer (or an active guest
  // session) could put a stranger's real phone number on their own order,
  // which then shows up as "the customer" for staff to call back - that
  // stranger never placed the order and never consented to being contacted
  // about it.
  const phone = isGuestOrder ? null : KITCHEN_ROLES.includes(session.role) ? normalizePhone(body.phone) : session.phone;
  if (!isGuestOrder && !phone) {
    return sendJson(res, 400, { error: "A valid phone number is required to place an order" });
  }

  const method = body.method === "ONLINE" ? "ONLINE" : "COUNTER";
  const serviceChargeActive = body.serviceChargeActive !== false;
  const tipApplied = !!body.tipApplied;
  const orderType = body.orderType === "dine-in" ? "dine-in" : body.orderType === "delivery" ? "delivery" : "takeaway";

  // Staff placing an order on someone's behalf: if the phone they typed
  // matches a registered customer account, attribute the order to that
  // account (loyalty points, "My Orders" history) instead of leaving it a
  // phone-only record only that customer's own guest-lookup could ever see.
  // A customer/guest session placing their own order already has the
  // correct identity from the session itself.
  let matchedCustomer = null;
  if (KITCHEN_ROLES.includes(session.role) && phone) {
    const staffEnteredUser = findUserByPhone(phone);
    if (staffEnteredUser && staffEnteredUser.role === "customer") matchedCustomer = staffEnteredUser;
  }

  // A customer/guest isn't tied to one store (they can walk into any
  // location) - their chosen store comes from the request body instead,
  // validated against real stores so an arbitrary/stale id can't sneak
  // in. Staff always keep their own session's storeId, unchanged.
  const allStores = readJson(STORES_FILE, []);
  let effectiveStoreId = session.storeId != null ? session.storeId : null;
  if (effectiveStoreId == null && body.storeId != null) {
    const requestedStoreId = Number(body.storeId);
    if (allStores.some((s) => s.id === requestedStoreId)) effectiveStoreId = requestedStoreId;
  }

  // Delivery has real-world guardrails a customer choosing takeaway/dine-in
  // never needs: a real account (never a guest, never staff placing it on
  // someone's behalf), online payment only (no cash-on-delivery), a saved
  // address the customer actually owns, and that address has to be within
  // reach of the store fulfilling it - checked here, BEFORE computeOrder
  // runs, so a doomed delivery order never prices out a cart for nothing.
  let deliveryAddressId = null;
  if (orderType === "delivery") {
    if (session.role !== "customer") {
      return sendJson(res, 403, { error: "Sign in with an account to order delivery" });
    }
    if (method !== "ONLINE") {
      return sendJson(res, 400, { error: "Delivery orders must be paid online" });
    }
    const addresses = readJson(ADDRESSES_FILE, []);
    const address = addresses.find((a) => a.id === Number(body.addressId) && a.customerId === session.userId && a.active !== false);
    if (!address) {
      return sendJson(res, 400, { error: "Select a delivery address" });
    }
    const deliveryStore = allStores.find((s) => s.id === effectiveStoreId);
    const deliveryOps = deliveryStore && deliveryStore.operations && deliveryStore.operations.delivery ? deliveryStore.operations.delivery : DEFAULT_STORE_OPERATIONS.delivery;
    if (!deliveryStore || !deliveryOps.enabled) {
      const msg = deliveryOps.message?.customText || (deliveryOps.message?.preset && DELIVERY_MESSAGE_PRESETS[deliveryOps.message.preset]) || "Delivery isn't available at this store right now";
      return sendJson(res, 400, { error: msg });
    }
    if (deliveryStore.lat == null || deliveryStore.lng == null) {
      return sendJson(res, 400, { error: "This store hasn't set up delivery coordinates yet" });
    }
    if (haversineKm(address.lat, address.lng, deliveryStore.lat, deliveryStore.lng) > 5) {
      return sendJson(res, 400, { error: "This address is outside our 5km delivery range for the selected store" });
    }
    deliveryAddressId = address.id;
  }

  let computed;
  try {
    const customerId = session.role === "customer" ? session.userId : matchedCustomer ? matchedCustomer.id : null;
    computed = computeOrder(Array.isArray(body.items) ? body.items : [], method, serviceChargeActive, tipApplied, {
      couponCode: body.couponCode || null,
      redeemPoints: parseInt(body.redeemPoints, 10) || 0,
      customerId,
      storeId: effectiveStoreId
    });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const orders = readJson(ORDERS_FILE, []);
  const multiStore = allStores.length > 1;
  // Staff placing an order at the counter on a customer's behalf can mark it
  // paid immediately (cash already collected) instead of having to find it
  // in Order History afterwards - customers/guests can never self-mark paid.
  const staffMarkedPaid = KITCHEN_ROLES.includes(session.role) && body.markPaidNow === true;

  // Plain incrementing integer, same pattern as users/stores/menu items -
  // this is only ever the internal primary key. The customer-facing bill
  // number (SB26090205-style, generateOrderNumber() below) is a completely
  // separate field and is untouched by this - order.id used to be a random
  // SB-XXXXXX string, migrated to integers because a database-style
  // auto-increment id makes an eventual real-database migration trivial
  // (see the "data fabric" note elsewhere) and is easier to type/reference
  // by hand than a random hex string.
  const orderId = orders.length ? Math.max(...orders.map((o) => o.id)) + 1 : 1;
  const orderNumber = generateOrderNumber(orders, effectiveStoreId, multiStore);
  // Lets a customer track this one order (GET /api/orders/track/:token,
  // no login needed) by scanning a QR code - an alternative to the
  // phone-based guest lookup for someone who doesn't want to type a phone
  // number back in later or is on a different device. Long and random
  // enough that guessing another order's token isn't practical.
  const trackingToken = crypto.randomBytes(12).toString("hex");

  // Real payment verification (Razorpay) - only attempted when an owner has
  // actually enabled it and saved both keys (Admin -> Payments & Tax). Off
  // or unconfigured, this is a no-op and behavior is exactly what it always
  // was: an ONLINE order is trust-based paid immediately, same as the UPI
  // QR flow below. createRazorpayOrder() itself also falls back to null on
  // any API failure, so a misconfigured/unreachable gateway never blocks
  // someone from placing an order.
  const razorpay = method === "ONLINE" && !staffMarkedPaid ? await createRazorpayOrder(computed.total, orderId, readJson(CONFIG_FILE, {})) : null;

  const order = {
    id: orderId,
    orderNumber,
    trackingToken,
    storeId: effectiveStoreId,
    createdAt: new Date().toISOString(),
    method,
    // Real verification (see POST .../verify-payment below) gates isPaid
    // when Razorpay actually created an order - still trust-based only in
    // the fallback case, same as before.
    isPaid: razorpay ? false : method === "ONLINE" || staffMarkedPaid,
    paymentMethod: razorpay ? null : method === "ONLINE" ? "UPI" : staffMarkedPaid ? "Cash" : null,
    razorpayOrderId: razorpay ? razorpay.razorpayOrderId : null,
    razorpayKeyId: razorpay ? razorpay.razorpayKeyId : null,
    razorpayCurrency: razorpay ? razorpay.razorpayCurrency : null,
    tipApplied,
    serviceChargeActive,
    orderType,
    // Frozen snapshot, same reasoning as customerName/customerPhone below -
    // Real reference, not a snapshot - editing an address never mutates the
    // old row (see PATCH /api/addresses/:id), it deactivates it and inserts
    // a new one, so this id always resolves to exactly what the address
    // looked like at order time without duplicating any of its fields here.
    addressId: deliveryAddressId,
    // Set later from Billing (see PATCH .../tagInfo below) - staff tag which
    // physical table a dine-in order belongs to once seated, rather than
    // asking for it at the moment of ordering.
    tableNumber: null,
    // Was `session.name || null`, which for a staff-placed order recorded
    // the STAFF MEMBER's own name as the "customer" - placedByStaff already
    // covers who took the order; this should be who it's actually for.
    customerId: session.role === "customer" ? session.userId : matchedCustomer ? matchedCustomer.id : null,
    customerName: session.role === "customer" ? session.name : matchedCustomer ? matchedCustomer.name : isGuestOrder ? "Guest" : null,
    customerPhone: phone,
    placedByStaff: KITCHEN_ROLES.includes(session.role) ? session.name : null,
    // Only staff can tag an order to an open table tab, and only if that
    // table is actually still open - never trust an arbitrary id from the client.
    tableSessionId: null,
    // Staff-manual "attach to existing bill" (see GET /api/orders/search) -
    // an alternative to tableSessionId for a customer who isn't at a table
    // but wants a new order to count toward a bill they already have. Set
    // below, validated after the order object exists.
    attachedToOrderId: null,
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

  // Staff manually attaching this new order to a previous bill - independent
  // of tableSessionId above; a staff order uses one or the other, never
  // both. Only a ROOT order (no attachedToOrderId of its own) is a valid
  // target - no attach chains, so a search picker can never surface an
  // already-attached order as something else could attach to.
  if (KITCHEN_ROLES.includes(session.role) && body.attachToOrderId && !order.tableSessionId) {
    // body.attachToOrderId comes from the client's dataset attribute (always
    // a string, even though order.id is a real number now) - coerce before
    // comparing, same reasoning as params.id below.
    const targetOrder = orders.find((o) => o.id === Number(body.attachToOrderId) && !o.attachedToOrderId);
    if (targetOrder) order.attachedToOrderId = targetOrder.id;
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
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const orders = readJson(ORDERS_FILE, []);
  // params.id is always a string (regex capture from the URL) - order.id is
  // a real number now, so this needs an explicit coercion or it never matches.
  const order = orders.find((o) => o.id === Number(params.id));
  if (!order) return sendJson(res, 404, { error: "Order not found" });
  const allowedStores = accessibleStoreIds(session);
  if (allowedStores && order.storeId != null && !allowedStores.includes(order.storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's order" });
  }

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
  } else if (body.action === "tagInfo") {
    // Staff filling in/correcting who a bill is for and (for a dine-in
    // order) which table, from the Billing page - a phone typed at order
    // time may have been skipped (guest order) or wrong, and the table
    // usually isn't known until the customer is actually seated. One
    // combined field auto-detects phone vs. username, same as the login
    // field - whichever it looks like gets updated, the other is left as-is.
    if (typeof body.contact === "string") {
      const trimmed = body.contact.trim();
      if (!trimmed) {
        order.customerPhone = null;
        order.customerName = null;
      } else if (/^[\d\s()+-]{7,20}$/.test(trimmed) && trimmed.replace(/\D/g, "").length >= 7) {
        order.customerPhone = normalizePhone(trimmed) || trimmed.slice(0, 20);
      } else {
        order.customerName = trimmed.slice(0, 60);
      }
    }
    if (typeof body.tableNumber === "string") {
      order.tableNumber = body.tableNumber.trim().slice(0, 20) || null;
    }
  } else if (body.action === "editItems") {
    // Lets staff add/remove lines or change quantities on an order that
    // hasn't been paid yet - from the Billing page (fixing a discrepancy
    // before settling) or a table's bill (adding another round mid-meal).
    // Reuses computeOrder()'s own pricing/tax engine rather than
    // hand-rolling the math again here, so an edited order is priced
    // exactly the way a fresh one would be - server-authoritative prices,
    // live stock checks, the same promo/coupon rules - never trusting
    // whatever price the client thinks a line costs.
    if (order.isPaid) return sendJson(res, 400, { error: "This bill is already settled" });
    if (!Array.isArray(body.items)) return sendJson(res, 400, { error: "items must be an array" });

    // Undo this order's CURRENT coupon/loyalty side effects first (same
    // reasoning as adjustBill below) - computeOrder() re-validates the
    // coupon/loyalty balance fresh, which would otherwise double-count
    // against a balance this order had already debited.
    if (order.couponId) {
      const coupons = readJson(COUPONS_FILE, []);
      const c = coupons.find((x) => x.id === order.couponId);
      if (c) {
        c.usedCount = Math.max(0, (c.usedCount || 0) - 1);
        writeJson(COUPONS_FILE, coupons);
      }
    }
    if (order.customerId && (order.loyaltyPointsRedeemed > 0 || order.loyaltyPointsEarned > 0)) {
      const users = readJson(USERS_FILE, []);
      const user = users.find((u) => u.id === order.customerId);
      if (user) {
        user.loyaltyPoints = Math.max(0, (user.loyaltyPoints || 0) + (order.loyaltyPointsRedeemed || 0) - (order.loyaltyPointsEarned || 0));
        writeJson(USERS_FILE, users);
      }
    }

    let priced;
    try {
      priced = computeOrder(body.items, order.method, order.serviceChargeActive, order.tipApplied, {
        couponCode: order.couponCode,
        redeemPoints: order.loyaltyPointsRedeemed,
        customerId: order.customerId,
        storeId: order.storeId
      });
    } catch (e) {
      // Re-apply the OLD side effects before failing, since the undo above
      // already happened - otherwise a rejected edit (bad item, out of
      // stock) would leave the coupon/loyalty balance permanently wrong.
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
      return sendJson(res, 400, { error: e.message });
    }

    // Every line resets to isDone:false - an edited check genuinely needs
    // the kitchen/counter to reconcile against it, the same way an amended
    // physical KOT would get re-fired rather than assumed still correct.
    Object.assign(order, priced);

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
  } else if (body.action === "adjustBill") {
    // Staff toggling service charge/tip and applying a coupon/loyalty
    // redemption from the Billing page, for an order that reached billing
    // without them (a guest checkout, or one staff placed without asking).
    // Recomputed the same way computeOrder() prices a fresh cart - just
    // starting from this order's already-locked subtotal/items instead of a
    // live cart, so re-adjusting (or clearing) it repeatedly is always safe.
    if (order.isPaid) return sendJson(res, 400, { error: "This bill is already settled" });
    const config = mergeStoreOverrides(
      readJson(CONFIG_FILE, {}),
      order.storeId != null ? readJson(STORES_FILE, []).find((s) => s.id === order.storeId) : null
    );

    // Undo this order's CURRENT coupon/loyalty side effects first, so a
    // second adjustment (or removing what was just applied) never double-
    // counts against the coupon's usage limit or the customer's balance.
    if (order.couponId) {
      const coupons = readJson(COUPONS_FILE, []);
      const c = coupons.find((x) => x.id === order.couponId);
      if (c) {
        c.usedCount = Math.max(0, (c.usedCount || 0) - 1);
        writeJson(COUPONS_FILE, coupons);
      }
    }
    if (order.customerId && (order.loyaltyPointsRedeemed > 0 || order.loyaltyPointsEarned > 0)) {
      const users = readJson(USERS_FILE, []);
      const user = users.find((u) => u.id === order.customerId);
      if (user) {
        user.loyaltyPoints = Math.max(0, (user.loyaltyPoints || 0) + (order.loyaltyPointsRedeemed || 0) - (order.loyaltyPointsEarned || 0));
        writeJson(USERS_FILE, users);
      }
    }

    const serviceChargeActive = body.serviceChargeActive !== false;
    const tipApplied = !!body.tipApplied;
    const couponCodeInput = typeof body.couponCode === "string" ? body.couponCode.trim() : "";
    const redeemPointsInput = parseInt(body.redeemPoints, 10) || 0;

    const hasPromoItem = order.items.some((i) => i.promoDiscount);
    let coupon = null;
    if (couponCodeInput) {
      if (hasPromoItem) return sendJson(res, 400, { error: "Coupon codes can't be combined with promotional items" });
      const coupons = readJson(COUPONS_FILE, []);
      coupon = findValidCoupon(couponCodeInput, coupons, order.storeId ?? null);
      if (!coupon) return sendJson(res, 400, { error: "Invalid or expired code" });
    }
    const couponDiscount = coupon ? computeCouponDiscount(coupon, order.subtotal) : 0;

    const loyaltyConfig = config.loyalty || {};
    let loyaltyPointsRedeemed = 0;
    let loyaltyDiscount = 0;
    if (order.customerId && redeemPointsInput > 0 && loyaltyConfig.enabled) {
      const users = readJson(USERS_FILE, []);
      const user = users.find((u) => u.id === order.customerId);
      const available = user ? user.loyaltyPoints || 0 : 0;
      const requested = Math.min(Math.max(0, redeemPointsInput), available);
      const rupeeValuePerPoint = loyaltyConfig.rupeeValuePerPoint ?? 0.5;
      const remaining = Math.max(0, order.subtotal - couponDiscount);
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
    const taxableAmount = Math.max(0, order.subtotal - discountAmount);
    const loyaltyPointsEarned = order.customerId && loyaltyConfig.enabled ? Math.floor(taxableAmount * (loyaltyConfig.pointsPerRupeeSpent ?? 0.1)) : 0;

    const cgst = taxableAmount * (config.cgstRate ?? 0.05);
    const sgst = taxableAmount * (config.sgstRate ?? 0.05);
    const serviceCharge = serviceChargeActive ? taxableAmount * (config.serviceChargeRate ?? 0.02) : 0;
    const tipAmount = config.tipEnabled && tipApplied ? config.tipAmount || 0 : 0;
    const total = taxableAmount + cgst + sgst + serviceCharge + tipAmount;

    order.serviceChargeActive = serviceChargeActive;
    order.tipApplied = tipApplied;
    order.couponCode = coupon ? coupon.code : null;
    order.couponId = coupon ? coupon.id : null;
    order.discountAmount = discountAmount;
    order.loyaltyPointsRedeemed = loyaltyPointsRedeemed;
    order.loyaltyDiscount = loyaltyDiscount;
    order.loyaltyPointsEarned = loyaltyPointsEarned;
    order.cgst = round2(cgst);
    order.sgst = round2(sgst);
    order.serviceCharge = round2(serviceCharge);
    order.tipAmount = round2(tipAmount);
    order.total = round2(total);

    // Re-apply the new side effects with the freshly recomputed numbers.
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
  } else {
    return sendJson(res, 400, { error: "Unknown action" });
  }

  writeJson(ORDERS_FILE, orders);
  broadcastOrdersChanged();
  sendJson(res, 200, order);
});

// Settles a root order AND everything staff have attached to it (see
// attachedToOrderId above / GET /api/orders/search) in one shared payment
// event - the combined-bill counterpart to /table-sessions/:id/settle-round.
// Each attached order still keeps its own id/items/isDone/servedAt
// untouched; only isPaid/paymentMethod change here.
route("POST", /^\/api\/orders\/(?<id>[\w-]+)\/settle-group\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const orders = readJson(ORDERS_FILE, []);
  const rootOrder = orders.find((o) => o.id === Number(params.id) && !o.attachedToOrderId);
  if (!rootOrder) return sendJson(res, 404, { error: "Bill not found" });
  const allowedStores = accessibleStoreIds(session);
  if (allowedStores && rootOrder.storeId != null && !allowedStores.includes(rootOrder.storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's order" });
  }

  const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : "Cash";
  const group = [rootOrder, ...orders.filter((o) => o.attachedToOrderId === rootOrder.id)];
  const dueOrders = group.filter((o) => !o.isPaid);
  if (dueOrders.length === 0) return sendJson(res, 400, { error: "This bill is already fully settled" });

  dueOrders.forEach((o) => {
    o.isPaid = true;
    o.paymentMethod = paymentMethod;
  });
  writeJson(ORDERS_FILE, orders);
  broadcastOrdersChanged();
  sendJson(res, 200, computeOrderGroupBill(rootOrder, orders));
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
  const order = orders.find((o) => o.id === Number(params.id));
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

/** Called by the client once Razorpay's checkout widget reports a completed
 *  payment - verifies the signature server-side before trusting it (the
 *  actual fix for "online payments are still trust-based", see README).
 *  Anyone who placed the order (staff or the customer/guest themselves) can
 *  complete this - it only ever flips isPaid true after a real signature
 *  check, never on the client's say-so. */
route("POST", /^\/api\/orders\/(?<id>[\w-]+)\/verify-payment\/?$/, async (req, res, params) => {
  const session = requireSession(req, res);
  if (!session) return;
  const body = await readBody(req);
  const orders = readJson(ORDERS_FILE, []);
  const order = orders.find((o) => o.id === Number(params.id));
  if (!order) return sendJson(res, 404, { error: "Order not found" });
  if (!order.razorpayOrderId) return sendJson(res, 400, { error: "This order isn't a Razorpay payment" });
  if (order.isPaid) return sendJson(res, 200, order); // already verified - idempotent

  const config = readJson(CONFIG_FILE, {});
  if (!config.razorpayKeySecret) return sendJson(res, 400, { error: "Razorpay isn't configured" });

  const { razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (!paymentId || !signature) return sendJson(res, 400, { error: "Missing payment verification fields" });

  const verified = verifyRazorpaySignature(order.razorpayOrderId, paymentId, signature, config.razorpayKeySecret);
  if (!verified) return sendJson(res, 400, { error: "Payment could not be verified" });

  order.isPaid = true;
  order.paymentMethod = "Razorpay";
  order.razorpayPaymentId = paymentId;
  writeJson(ORDERS_FILE, orders);
  broadcastOrdersChanged();
  sendJson(res, 200, order);
});

route("GET", /^\/api\/favorites\/?$/, async (req, res) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const favorites = readJson(FAVORITES_FILE, []);
  const owner = favoritesOwner(session);
  const itemIds = favorites.filter((f) => favoritesMatch(f, owner)).map((f) => f.itemId);
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
  const owner = favoritesOwner(session);
  if (!favorites.find((f) => favoritesMatch(f, owner) && f.itemId === itemId)) {
    favorites.push({ ownerType: owner.ownerType, ownerId: owner.ownerId, itemId });
    writeJson(FAVORITES_FILE, favorites);
  }
  sendJson(res, 200, { ok: true });
});

route("DELETE", /^\/api\/favorites\/(?<itemId>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, TRACKING_ROLES);
  if (!session) return;
  const itemId = Number(params.itemId);
  const favorites = readJson(FAVORITES_FILE, []);
  const owner = favoritesOwner(session);
  writeJson(
    FAVORITES_FILE,
    favorites.filter((f) => !(favoritesMatch(f, owner) && f.itemId === itemId))
  );
  sendJson(res, 200, { ok: true });
});

// Saved delivery addresses - customer-only (a guest has no persistent
// account to attach one to, and staff never place delivery orders on a
// customer's behalf). Always scoped to session.userId, same ownership
// pattern favorites use via ownerKey.
function parseAddressCoord(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

route("GET", /^\/api\/addresses\/?$/, async (req, res) => {
  const session = requireRole(req, res, ["customer"]);
  if (!session) return;
  // Inactive addresses (superseded by an edit - see PATCH below) stay in the
  // file forever so a past order's addressId still resolves, but are never
  // offered to the customer again here.
  const addresses = readJson(ADDRESSES_FILE, []).filter((a) => a.customerId === session.userId && a.active !== false);
  sendJson(res, 200, addresses);
});

route("POST", /^\/api\/addresses\/?$/, async (req, res) => {
  const session = requireRole(req, res, ["customer"]);
  if (!session) return;
  const body = await readBody(req);
  const label = String(body.label || "").trim().slice(0, 40);
  const addressText = String(body.addressText || "").trim().slice(0, 200);
  const landmark = String(body.landmark || "").trim().slice(0, 100);
  const city = String(body.city || "").trim().slice(0, 60);
  const state = String(body.state || "").trim().slice(0, 60);
  const pincode = String(body.pincode || "").trim().slice(0, 12);
  const lat = parseAddressCoord(body.lat, -90, 90);
  const lng = parseAddressCoord(body.lng, -180, 180);
  if (!label) return sendJson(res, 400, { error: "Give this address a short label" });
  if (lat === null || lng === null) return sendJson(res, 400, { error: "Drop a pin on the map to set a location" });

  const addresses = readJson(ADDRESSES_FILE, []);
  const mine = addresses.filter((a) => a.customerId === session.userId && a.active !== false);
  if (mine.length >= 10) return sendJson(res, 400, { error: "You can save up to 10 addresses" });

  const isDefault = mine.length === 0 || !!body.isDefault;
  if (isDefault) mine.forEach((a) => (a.isDefault = false));

  const address = {
    id: addresses.length ? Math.max(...addresses.map((a) => a.id)) + 1 : 1,
    customerId: session.userId,
    label,
    addressText,
    landmark,
    city,
    state,
    pincode,
    lat,
    lng,
    isDefault,
    active: true,
    createdAt: new Date().toISOString()
  };
  addresses.push(address);
  writeJson(ADDRESSES_FILE, addresses);
  sendJson(res, 201, address);
});

// Editing an address never mutates it in place - past orders reference an
// address by id (order.addressId), so changing that same record would
// silently rewrite what an old order's delivery address looked like. Instead
// this deactivates the old row (kept forever so old orders still resolve)
// and inserts a new one with a new id, which is what the customer sees and
// what any NEW order will point to. One row, one real value, ever - no
// field is ever duplicated onto the order itself.
route("PATCH", /^\/api\/addresses\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, ["customer"]);
  if (!session) return;
  const addresses = readJson(ADDRESSES_FILE, []);
  const old = addresses.find((a) => a.id === Number(params.id) && a.customerId === session.userId && a.active !== false);
  if (!old) return sendJson(res, 404, { error: "Address not found" });

  const body = await readBody(req);
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 40) : old.label;
  if (!label) return sendJson(res, 400, { error: "Give this address a short label" });
  const addressText = typeof body.addressText === "string" ? body.addressText.trim().slice(0, 200) : old.addressText;
  const landmark = typeof body.landmark === "string" ? body.landmark.trim().slice(0, 100) : old.landmark;
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 60) : old.city;
  const state = typeof body.state === "string" ? body.state.trim().slice(0, 60) : old.state;
  const pincode = typeof body.pincode === "string" ? body.pincode.trim().slice(0, 12) : old.pincode;
  let lat = old.lat;
  let lng = old.lng;
  if (body.lat !== undefined || body.lng !== undefined) {
    lat = parseAddressCoord(body.lat, -90, 90);
    lng = parseAddressCoord(body.lng, -180, 180);
    if (lat === null || lng === null) return sendJson(res, 400, { error: "Drop a pin on the map to set a location" });
  }
  const isDefault = body.isDefault === true || old.isDefault;

  old.active = false;
  old.isDefault = false;
  if (isDefault) {
    addresses.forEach((a) => {
      if (a.customerId === session.userId && a.active !== false) a.isDefault = false;
    });
  }
  const updated = {
    id: addresses.length ? Math.max(...addresses.map((a) => a.id)) + 1 : 1,
    customerId: session.userId,
    label,
    addressText,
    landmark,
    city,
    state,
    pincode,
    lat,
    lng,
    isDefault,
    active: true,
    createdAt: new Date().toISOString()
  };
  addresses.push(updated);
  writeJson(ADDRESSES_FILE, addresses);
  sendJson(res, 200, updated);
});

// Deactivates rather than removes - same reasoning as PATCH above, a past
// order's addressId must keep resolving to something.
route("DELETE", /^\/api\/addresses\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, ["customer"]);
  if (!session) return;
  const addresses = readJson(ADDRESSES_FILE, []);
  const address = addresses.find((a) => a.id === Number(params.id) && a.customerId === session.userId && a.active !== false);
  if (!address) return sendJson(res, 404, { error: "Address not found" });
  address.active = false;
  address.isDefault = false;
  // If the default address was removed and others remain, promote the
  // customer's next-most-recent one so "isDefault" always has exactly one
  // holder whenever the customer has any active addresses at all.
  const mine = addresses.filter((a) => a.customerId === session.userId && a.active !== false).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (mine.length && !mine.some((a) => a.isDefault)) mine[0].isDefault = true;
  writeJson(ADDRESSES_FILE, addresses);
  sendJson(res, 200, { ok: true });
});

// Raw material inventory - staff/manager only, never customer-facing.
// Deliberately just a flat name/quantity/unit list with an active flag
// (same soft-delete convention menu items already use) - no recipe/BOM
// link to menu items and no auto-deduction on order placement, since
// neither was asked for and both would be a much bigger feature.
route("GET", /^\/api\/raw-materials\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  sendJson(res, 200, readJson(RAW_MATERIALS_FILE, []));
});

route("POST", /^\/api\/raw-materials\/?$/, async (req, res) => {
  if (!requireRole(req, res, MANAGER_UP_ROLES)) return;
  const body = await readBody(req);
  const name = String(body.name || "").trim().slice(0, 60);
  const unit = String(body.unit || "").trim().slice(0, 20);
  const quantity = Number(body.quantity);
  if (!name) return sendJson(res, 400, { error: "Give this material a name" });
  if (!Number.isFinite(quantity) || quantity < 0) return sendJson(res, 400, { error: "Quantity must be zero or a positive number" });

  const materials = readJson(RAW_MATERIALS_FILE, []);
  const material = {
    id: materials.length ? Math.max(...materials.map((m) => m.id)) + 1 : 1,
    name,
    quantity,
    unit,
    active: true,
    updatedAt: new Date().toISOString()
  };
  materials.push(material);
  writeJson(RAW_MATERIALS_FILE, materials);
  sendJson(res, 201, material);
});

route("PATCH", /^\/api\/raw-materials\/(?<id>\d+)\/?$/, async (req, res, params) => {
  // Any staff can restock (quantity); only a manager+ can rename, change
  // the unit, or activate/deactivate a material - same two-tier split
  // reasoning as the delivery lock earlier, just simpler since there's no
  // separate "locked" state to enforce here.
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const materials = readJson(RAW_MATERIALS_FILE, []);
  const material = materials.find((m) => m.id === Number(params.id));
  if (!material) return sendJson(res, 404, { error: "Material not found" });

  const body = await readBody(req);
  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) return sendJson(res, 400, { error: "Quantity must be zero or a positive number" });
    material.quantity = quantity;
  }
  const isManager = MANAGER_UP_ROLES.includes(session.role);
  if (isManager) {
    if (typeof body.name === "string") {
      const name = body.name.trim().slice(0, 60);
      if (!name) return sendJson(res, 400, { error: "Give this material a name" });
      material.name = name;
    }
    if (typeof body.unit === "string") material.unit = body.unit.trim().slice(0, 20);
    if (typeof body.active === "boolean") material.active = body.active;
  }
  material.updatedAt = new Date().toISOString();
  writeJson(RAW_MATERIALS_FILE, materials);
  sendJson(res, 200, material);
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

/** storeId is the order's own store (null for a customer/guest with no
 *  store chosen). A franchise-wide coupon (coupon.storeId == null) redeems
 *  anywhere; a Local Admin/manager's local discount (coupon.storeId set)
 *  only redeems at that one store - so a discount created for Store 2
 *  can't be used at Store 1's checkout. */
function findValidCoupon(code, coupons, storeId = null) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  const coupon = coupons.find((c) => c.code === normalized);
  if (!coupon || !coupon.active) return null;
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return null;
  if (coupon.storeId != null && coupon.storeId !== storeId) return null;
  return coupon;
}

function computeCouponDiscount(coupon, subtotal) {
  if (!coupon) return 0;
  const raw = coupon.type === "percent" ? subtotal * (coupon.value / 100) : coupon.value;
  return round2(Math.min(raw, subtotal)); // never discount below zero
}

route("GET", /^\/api\/coupons\/?$/, async (req, res) => {
  // Everything including private/stopped/exhausted codes, but scoped like
  // orders/KPI: a Local Admin/manager only sees franchise-wide coupons
  // (storeId null) plus their own store's local discounts, never another
  // store's. The public listing below is a separate, filtered route.
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const allowed = accessibleStoreIds(session);
  let coupons = readJson(COUPONS_FILE, []);
  if (allowed) coupons = coupons.filter((c) => c.storeId == null || allowed.includes(c.storeId));
  sendJson(res, 200, coupons);
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
  if (session.role === "owner") {
    return sendJson(res, 403, { error: "Owner has read-only access to discounts" });
  }
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

  // storeId: null = franchise-wide coupon (Global Admin's lane). A manager
  // always creates a local discount for their own store; a Local Admin
  // must say which of their accessible stores it's for; a Global Admin/
  // owner may target one store too, or omit it for franchise-wide.
  let storeId = null;
  if (session.role === "manager") {
    storeId = session.storeId;
  } else if (body.storeId !== undefined && body.storeId !== null && body.storeId !== "") {
    const requested = Number(body.storeId);
    if (!Number.isFinite(requested) || !canManageStore(session, requested)) {
      return sendJson(res, 403, { error: "You don't have access to that store" });
    }
    storeId = requested;
  } else if (session.role === "admin" && accessibleStoreIds(session) !== null) {
    return sendJson(res, 400, { error: "Pick which store this local discount is for" });
  }

  const coupon = {
    id: coupons.length ? Math.max(...coupons.map((c) => c.id)) + 1 : 1,
    code,
    type,
    value,
    usageLimit,
    usedCount: 0,
    active: true,
    private: !!body.private, // default false = public, listed in GET /api/coupons/public
    storeId,
    createdBy: session.name,
    createdAt: new Date().toISOString()
  };
  coupons.push(coupon);
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 201, coupon);
});

route("PATCH", /^\/api\/coupons\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const coupons = readJson(COUPONS_FILE, []);
  const coupon = coupons.find((c) => c.id === Number(params.id));
  if (!coupon) return sendJson(res, 404, { error: "Coupon not found" });
  // Franchise-wide (storeId null) is Global Admin's lane, same as Loyalty -
  // canManageStore() only gates LOCAL discounts, so a franchise-wide one
  // needs its own check here.
  if (coupon.storeId == null) {
    if (session.role !== "admin" || accessibleStoreIds(session) !== null) {
      return sendJson(res, 403, { error: "Only a Global Admin can manage a franchise-wide discount" });
    }
  } else if (session.role === "owner" || !canManageStore(session, coupon.storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's discount" });
  }

  if (body.active !== undefined) coupon.active = Boolean(body.active);
  if (body.private !== undefined) coupon.private = Boolean(body.private);
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 200, coupon);
});

route("DELETE", /^\/api\/coupons\/(?<id>\d+)\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, MANAGER_UP_ROLES);
  if (!session) return;
  const coupons = readJson(COUPONS_FILE, []);
  const idx = coupons.findIndex((c) => c.id === Number(params.id));
  if (idx === -1) return sendJson(res, 404, { error: "Coupon not found" });
  if (coupons[idx].storeId == null) {
    if (session.role !== "admin" || accessibleStoreIds(session) !== null) {
      return sendJson(res, 403, { error: "Only a Global Admin can manage a franchise-wide discount" });
    }
  } else if (session.role === "owner" || !canManageStore(session, coupons[idx].storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's discount" });
  }
  coupons.splice(idx, 1);
  writeJson(COUPONS_FILE, coupons);
  sendJson(res, 200, { ok: true });
});

/** Checkout-time preview - any signed-in role can check a code's validity
 *  and discount amount without redeeming it (redemption/usedCount happens
 *  only at real order creation, so previewing never burns a use). */
route("POST", /^\/api\/coupons\/validate\/?$/, async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const body = await readBody(req);
  const coupons = readJson(COUPONS_FILE, []);
  // storeId: the session's own store for staff, or the customer/guest's
  // chosen store passed in the body (mirrors how POST /api/orders resolves
  // effectiveStoreId) - a preview must apply the same store-scoping rule
  // real redemption does, or it'd show a discount that then fails at
  // checkout for a store-scoped local discount.
  const previewStoreId = session.storeId != null ? session.storeId : Number.isFinite(Number(body.storeId)) ? Number(body.storeId) : null;
  const coupon = findValidCoupon(body.code, coupons, previewStoreId);
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
  const orders = readJson(ORDERS_FILE, []);
  let mine = [];
  if (session.role === "customer") mine = orders.filter((o) => o.customerId === session.userId);
  else if (session.role === "guest") mine = orders.filter((o) => o.customerPhone === session.phone);
  if (mine.length === 0) {
    return { allowed: false, reason: "Place an order to unlock the arcade." };
  }
  const latest = mine.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b));
  // Arcade is per-store now (see mergeStoreOverrides()) - eligibility is
  // gated by the arcade settings of the store the qualifying order was
  // actually placed at, not a franchise-wide default.
  const store = latest.storeId != null ? readJson(STORES_FILE, []).find((s) => s.id === latest.storeId) : null;
  const arcadeConfig = mergeStoreOverrides(readJson(CONFIG_FILE, {}), store).arcade;
  if (!arcadeConfig.enabled) {
    return { allowed: false, reason: "The arcade isn't available right now." };
  }
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
    // Lets account deletion (POST /api/account/delete) find and anonymize
    // this leaderboard entry later - the name alone isn't a safe match key
    // (two different players can share a display name).
    customerId: session.role === "customer" ? session.userId : null,
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

// Splits the merged bill into "already settled" vs "still due" on top of the
// existing combined total - lets a table (or an attached-order group, see
// computeOrderGroupBill below) settle one round of orders while leaving
// others still outstanding, without losing the single "one running tab"
// view. `total`/`items`/etc. keep their original combined shape so every
// existing caller (PATCH /api/table-sessions/:id, the close route, KPI-
// adjacent code) keeps working unchanged - dueTotal/settledTotal are purely
// additive.
function splitDueSettled(orders) {
  const dueOrders = orders.filter((o) => !o.isPaid);
  const paidOrders = orders.filter((o) => o.isPaid);
  const mergedItems = [];
  orders.forEach((o) => o.items.forEach((i) => mergedItems.push({ ...i, orderId: o.id, isPaid: o.isPaid })));
  const sum = (list, f) => round2(list.reduce((s, o) => s + (o[f] || 0), 0));
  return {
    orderCount: orders.length,
    items: mergedItems,
    subtotal: sum(orders, "subtotal"),
    cgst: sum(orders, "cgst"),
    sgst: sum(orders, "sgst"),
    serviceCharge: sum(orders, "serviceCharge"),
    tipAmount: sum(orders, "tipAmount"),
    total: sum(orders, "total"),
    dueTotal: sum(dueOrders, "total"),
    settledTotal: sum(paidOrders, "total"),
    dueOrderCount: dueOrders.length
  };
}

function computeTableSessionBill(session, allOrders) {
  const orders = allOrders.filter((o) => o.tableSessionId === session.id);
  return { ...session, ...splitDueSettled(orders) };
}

/** Same shape as computeTableSessionBill, keyed by a root order's
 *  attachedToOrderId chain instead of a tableSessionId - lets a staff-
 *  manual "attach to existing bill" order (see POST /api/orders'
 *  attachToOrderId handling) be billed/settled together with its root,
 *  the same way a table's multiple orders already are. `rootOrder` must
 *  itself have no attachedToOrderId (enforced by callers). */
function computeOrderGroupBill(rootOrder, allOrders) {
  const attached = allOrders.filter((o) => o.attachedToOrderId === rootOrder.id);
  const orders = [rootOrder, ...attached];
  return { ...rootOrder, ...splitDueSettled(orders) };
}

// Table count is now fully per-store (see mergeStoreOverrides()), so table
// sessions need a storeId to know whose table-count limit and "already
// open" check applies - previously missing entirely, which meant two
// stores couldn't both have a "Table 1" open at once.
route("POST", /^\/api\/table-sessions\/?$/, async (req, res) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const allStores = readJson(STORES_FILE, []);
  let effectiveStoreId = session.storeId != null ? session.storeId : null;
  if (effectiveStoreId == null && body.storeId != null) {
    const requestedStoreId = Number(body.storeId);
    if (allStores.some((s) => s.id === requestedStoreId)) effectiveStoreId = requestedStoreId;
  }
  const config = mergeStoreOverrides(readJson(CONFIG_FILE, {}), allStores.find((s) => s.id === effectiveStoreId));
  const tableNumber = parseInt(body.tableNumber, 10);
  const tableCount = config.tableCount ?? 10;
  if (!Number.isFinite(tableNumber) || tableNumber < 1 || tableNumber > tableCount) {
    return sendJson(res, 400, { error: `Table number must be between 1 and ${tableCount}` });
  }

  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  if (sessions.some((s) => s.tableNumber === tableNumber && s.status === "open" && s.storeId === effectiveStoreId)) {
    return sendJson(res, 400, { error: `Table ${tableNumber} already has an open tab` });
  }

  const tableSession = {
    id: `TBL-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    storeId: effectiveStoreId,
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
  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  const tableSession = sessions.find((s) => s.id === params.id);
  if (!tableSession) return sendJson(res, 404, { error: "Table session not found" });
  const allowedStores = accessibleStoreIds(session);
  if (allowedStores && tableSession.storeId != null && !allowedStores.includes(tableSession.storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's table" });
  }
  if (tableSession.status !== "open") return sendJson(res, 400, { error: "Table is already closed" });
  const config = mergeStoreOverrides(readJson(CONFIG_FILE, {}), readJson(STORES_FILE, []).find((s) => s.id === tableSession.storeId));
  const tableCount = config.tableCount ?? 10;

  if (body.tableNumber !== undefined) {
    const newNumber = parseInt(body.tableNumber, 10);
    if (!Number.isFinite(newNumber) || newNumber < 1 || newNumber > tableCount) {
      return sendJson(res, 400, { error: `Table number must be between 1 and ${tableCount}` });
    }
    if (
      newNumber !== tableSession.tableNumber &&
      sessions.some((s) => s.tableNumber === newNumber && s.status === "open" && s.storeId === tableSession.storeId)
    ) {
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
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const allowed = accessibleStoreIds(session);
  let sessions = readJson(TABLE_SESSIONS_FILE, []);
  // Older sessions predating this field (storeId undefined) stay visible to
  // everyone, same "unscoped means visible" fallback orders/KPI already use.
  if (allowed) sessions = sessions.filter((s) => s.storeId == null || allowed.includes(s.storeId));
  // Same optional single-store drill-down as GET /api/orders?storeId= - for
  // a multi-store account (owner/Global Admin/multi-store Local Admin) that
  // wants Billing/Orders narrowed to just one of their several stores at a
  // time instead of always seeing them all merged.
  if (url.searchParams.has("storeId")) {
    const requestedStoreId = Number(url.searchParams.get("storeId"));
    if (Number.isFinite(requestedStoreId) && (!allowed || allowed.includes(requestedStoreId))) {
      sessions = sessions.filter((s) => s.storeId === requestedStoreId);
    }
  }
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
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  const tableSession = sessions.find((s) => s.id === params.id);
  if (!tableSession) return sendJson(res, 404, { error: "Table session not found" });
  const allowedStores = accessibleStoreIds(session);
  if (allowedStores && tableSession.storeId != null && !allowedStores.includes(tableSession.storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's table" });
  }
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
  const allowedStores = accessibleStoreIds(session);
  if (allowedStores && tableSession.storeId != null && !allowedStores.includes(tableSession.storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's table" });
  }
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
      // Only touch orders still due - an earlier round already settled via
      // /settle-round (possibly by a different payment method) keeps its
      // own record intact instead of being silently overwritten to match
      // whatever method closes the table.
      if (o.tableSessionId === tableSession.id && !o.isPaid) {
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

// Settles whatever's currently due on an open table WITHOUT closing it - the
// customer can keep ordering under the same tab afterward (new orders still
// attach via tableSessionId exactly as they do today; nothing about that
// path changes). Mirrors /close's markPaid branch above, minus the status
// flip - same reasoning, deliberately not a new pattern.
route("POST", /^\/api\/table-sessions\/(?<id>[\w-]+)\/settle-round\/?$/, async (req, res, params) => {
  const session = requireRole(req, res, KITCHEN_ROLES);
  if (!session) return;
  const body = await readBody(req);
  const sessions = readJson(TABLE_SESSIONS_FILE, []);
  const tableSession = sessions.find((s) => s.id === params.id);
  if (!tableSession) return sendJson(res, 404, { error: "Table session not found" });
  const allowedStores = accessibleStoreIds(session);
  if (allowedStores && tableSession.storeId != null && !allowedStores.includes(tableSession.storeId)) {
    return sendJson(res, 403, { error: "You don't have access to that store's table" });
  }
  if (tableSession.status !== "open") return sendJson(res, 400, { error: "Table is already closed" });

  const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : "Cash";
  const orders = readJson(ORDERS_FILE, []);
  const dueOrders = orders.filter((o) => o.tableSessionId === tableSession.id && !o.isPaid);
  if (dueOrders.length === 0) return sendJson(res, 400, { error: "Nothing due on this table right now" });

  dueOrders.forEach((o) => {
    o.isPaid = true;
    o.paymentMethod = paymentMethod;
  });
  writeJson(ORDERS_FILE, orders);
  tableSession.lastSettledAt = new Date().toISOString();
  tableSession.lastSettledBy = session.name;
  writeJson(TABLE_SESSIONS_FILE, sessions);
  broadcastOrdersChanged();
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
    Connection: "keep-alive",
    // Tells nginx-style reverse proxies not to buffer this streaming
    // response; Cloudflare's tunnel/edge honors the same signal. Without it
    // a proxy can hold the whole connection's output until its own buffer
    // fills or the connection closes, which for a low-traffic SSE stream can
    // mean "never" in practice.
    "X-Accel-Buffering": "no"
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
  // strict-origin-when-cross-origin (browser default): full URL as referer
  // same-origin, bare origin cross-origin. "no-referrer" broke Leaflet's
  // OSM tile loads - their tile servers reject requests with no referer at
  // all, and no-referrer suppressed it even for our own page's own tile
  // fetches. Bare origin is still no path/query leakage to Razorpay/OSM.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Only advertise HSTS when this particular request actually arrived over
  // HTTPS (checked the same way the Secure cookie flag is, via
  // X-Forwarded-Proto behind the Cloudflare tunnel) - sending it
  // unconditionally would tell a browser to force HTTPS for this host even
  // while it's being reached over plain HTTP on a LAN/dev box, locking
  // people out.
  if (IS_HTTPS || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    // A customer's full phone number is only for manager and up - enforced
    // HERE, once, for every route's response, rather than per-handler (a
    // route that forgot its own redaction would otherwise leak the number
    // in plain JSON regardless of what the UI shows - visible in the
    // Network tab even if hidden on screen). Buffers writeHead/end so the
    // redacted body's real byte length can replace whatever Content-Length
    // the handler's own sendJson() already computed against the original.
    const maskingSession = currentSession(req);
    if (maskingSession && maskingSession.role === "employee") {
      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let pending = null;
      res.writeHead = (status, headers) => {
        pending = { status, headers };
        return res;
      };
      res.end = (body) => {
        let finalBody = body;
        if (typeof body === "string" && pending?.headers?.["Content-Type"]?.includes("application/json")) {
          finalBody = redactCustomerPhones(body);
        }
        const headers = pending ? { ...pending.headers } : {};
        if (typeof finalBody === "string" && headers["Content-Length"] !== undefined) {
          headers["Content-Length"] = Buffer.byteLength(finalBody);
        }
        originalWriteHead(pending ? pending.status : 200, headers);
        return originalEnd(finalBody);
      };
    }

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
