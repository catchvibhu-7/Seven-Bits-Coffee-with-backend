/**
 * SEVEN BITS COFFEE - BACKEND SERVER
 * Plain Node.js (no external dependencies) so it runs with just `node server.js`.
 *
 * Responsibilities this server takes over from the old client-only app:
 *   - Menu, config and orders are stored on disk (./data/*.json), not in a
 *     browser tab's memory - refreshing a page, or opening the kitchen
 *     display on a different device, no longer loses/hides data.
 *   - Admin/staff login is verified server-side against a hashed password,
 *     with a session cookie - the old build shipped the passcode in plain
 *     JS ("1024") and anyone could fake auth from devtools.
 *   - Order totals (and the UPI QR amount) are calculated HERE from the
 *     server's own menu prices, never trusted from the browser. The old
 *     app also hardcoded a fixed am=500 UPI amount regardless of order size.
 *   - Live updates: kitchen/admin clients get pushed order changes over
 *     Server-Sent Events, so multiple stations (register, kitchen screen,
 *     admin laptop) all stay in sync.
 *
 * Run:
 *   ADMIN_PASSWORD=yourStrongPassword node server.js
 * (see README-BACKEND.md for all options)
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
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");

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
    tipAmount: 7
  });
}

if (!fs.existsSync(ORDERS_FILE)) {
  writeJson(ORDERS_FILE, []);
}

// ---------------------------------------------------------------------------
// Admin password (hashed on disk, never stored/shipped in plaintext)
// ---------------------------------------------------------------------------

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function bootstrapAdminAccount() {
  if (fs.existsSync(ADMIN_FILE)) return;

  const salt = crypto.randomBytes(16).toString("hex");
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;

  if (!password) {
    password = crypto.randomBytes(6).toString("hex"); // 12-char random password
    generated = true;
  }

  writeJson(ADMIN_FILE, { salt, hash: hashPassword(password, salt) });

  if (generated) {
    console.log("=".repeat(60));
    console.log("No ADMIN_PASSWORD was set - generated one for you:");
    console.log(`  Admin password: ${password}`);
    console.log("Save this now. Set ADMIN_PASSWORD env var to control it");
    console.log("yourself and avoid this message on future first-runs.");
    console.log("=".repeat(60));
  }
}

bootstrapAdminAccount();

function verifyAdminPassword(password) {
  const admin = readJson(ADMIN_FILE, null);
  if (!admin) return false;
  const attemptHash = hashPassword(String(password || ""), admin.salt);
  // Constant-time comparison to avoid leaking hash info via timing.
  const a = Buffer.from(attemptHash, "hex");
  const b = Buffer.from(admin.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Sessions (in-memory) + login rate limiting
// ---------------------------------------------------------------------------

const sessions = new Map(); // token -> expiresAt
const loginAttempts = new Map(); // ip -> { count, lockUntil }

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isSessionValid(token) {
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (Date.now() > expires) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

function checkRateLimit(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return { allowed: true };
  if (entry.lockUntil && Date.now() < entry.lockUntil) {
    return { allowed: false, retryAfterMs: entry.lockUntil - Date.now() };
  }
  return { allowed: true };
}

function recordLoginFailure(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, lockUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockUntil = Date.now() + 60 * 1000; // 60s lockout after 5 failures
    entry.count = 0;
  }
  loginAttempts.set(ip, entry);
}

function recordLoginSuccess(ip) {
  loginAttempts.delete(ip);
}

// ---------------------------------------------------------------------------
// SSE (Server-Sent Events) so kitchen/admin screens update live
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

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  if (!isSessionValid(cookies.sb_session)) {
    sendJson(res, 401, { error: "Not authenticated" });
    return false;
  }
  return true;
}

function getClientIp(req) {
  return req.socket.remoteAddress || "unknown";
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

function computeOrder(items, method, serviceChargeActive, tipApplied) {
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
      price: product.price, // authoritative price from server menu, never from client
      quantity,
      station: getStation(product),
      isDone: false
    });
  }

  if (resolvedItems.length === 0) {
    throw new Error("No valid items in order");
  }

  const subtotal = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cgst = subtotal * (config.cgstRate ?? 0.05);
  const sgst = subtotal * (config.sgstRate ?? 0.05);
  const serviceCharge = serviceChargeActive ? subtotal * (config.serviceChargeRate ?? 0.02) : 0;
  const tipAmount = config.tipEnabled && tipApplied ? config.tipAmount || 0 : 0;
  const total = subtotal + cgst + sgst + serviceCharge + tipAmount;

  let paymentQrUrl = null;
  if (method === "ONLINE" && UPI_VPA) {
    const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_VPA)}&pn=${encodeURIComponent(UPI_PAYEE_NAME || config.shopName || "Store")}&am=${round2(total).toFixed(2)}&cu=INR`;
    paymentQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiUrl)}`;
  }

  return {
    items: resolvedItems,
    subtotal: round2(subtotal),
    cgst: round2(cgst),
    sgst: round2(sgst),
    serviceCharge: round2(serviceCharge),
    tipAmount: round2(tipAmount),
    total: round2(total),
    paymentQrUrl
  };
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

// --- Menu ---
route("GET", /^\/api\/menu\/?$/, async (req, res) => {
  sendJson(res, 200, readJson(MENU_FILE, { sections: [], items: [] }));
});

route("POST", /^\/api\/menu\/?$/, async (req, res) => {
  if (!requireAuth(req, res)) return;
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

  const nextId = menu.items.length ? Math.max(...menu.items.map((i) => i.id)) + 1 : 1;
  const item = { id: nextId, section, name, price, icon: body.icon || "espresso", story: body.story || "" };
  menu.items.push(item);
  writeJson(MENU_FILE, menu);
  sendJson(res, 201, item);
});

route("PATCH", /^\/api\/menu\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireAuth(req, res)) return;
  const body = await readBody(req);
  const menu = readJson(MENU_FILE, { sections: [], items: [] });
  const item = menu.items.find((i) => i.id === Number(params.id));
  if (!item) return sendJson(res, 404, { error: "Item not found" });

  if (body.name !== undefined) item.name = String(body.name).trim();
  if (body.story !== undefined) item.story = String(body.story);
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) return sendJson(res, 400, { error: "Invalid price" });
    item.price = price;
  }
  writeJson(MENU_FILE, menu);
  sendJson(res, 200, item);
});

route("DELETE", /^\/api\/menu\/(?<id>\d+)\/?$/, async (req, res, params) => {
  if (!requireAuth(req, res)) return;
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
  if (!requireAuth(req, res)) return;
  const body = await readBody(req);
  const config = readJson(CONFIG_FILE, {});
  const allowed = ["shopName", "tipEnabled", "tipAmount", "cgstRate", "sgstRate", "serviceChargeRate", "currency"];
  for (const key of allowed) {
    if (body[key] !== undefined) config[key] = body[key];
  }
  writeJson(CONFIG_FILE, config);
  sendJson(res, 200, config);
});

// --- Orders ---
route("GET", /^\/api\/orders\/?$/, async (req, res) => {
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, readJson(ORDERS_FILE, []));
});

route("POST", /^\/api\/orders\/?$/, async (req, res) => {
  // Placing an order is customer-facing (kiosk/counter), so it's intentionally
  // not behind admin auth - but every price in it comes from the server menu.
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const method = body.method === "ONLINE" ? "ONLINE" : "COUNTER";
  const serviceChargeActive = body.serviceChargeActive !== false;
  const tipApplied = !!body.tipApplied;

  let computed;
  try {
    computed = computeOrder(Array.isArray(body.items) ? body.items : [], method, serviceChargeActive, tipApplied);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const orders = readJson(ORDERS_FILE, []);
  const order = {
    id: `SB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    createdAt: new Date().toISOString(),
    method,
    isPaid: method === "ONLINE", // still trust-based until a real payment webhook is wired up - see README
    tipApplied,
    serviceChargeActive,
    ...computed
  };
  orders.push(order);
  writeJson(ORDERS_FILE, orders);
  broadcastOrdersChanged();
  sendJson(res, 201, order);
});

route("PATCH", /^\/api\/orders\/(?<id>[\w-]+)\/?$/, async (req, res, params) => {
  if (!requireAuth(req, res)) return;
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
  const cookies = parseCookies(req);
  if (!isSessionValid(cookies.sb_session)) {
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

// --- Admin auth ---
route("POST", /^\/api\/admin\/login\/?$/, async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` });
  }

  const body = await readBody(req);
  if (verifyAdminPassword(body.password)) {
    recordLoginSuccess(ip);
    const token = createSession();
    setSessionCookie(res, token);
    sendJson(res, 200, { ok: true });
  } else {
    recordLoginFailure(ip);
    sendJson(res, 401, { error: "Invalid password" });
  }
});

route("POST", /^\/api\/admin\/logout\/?$/, async (req, res) => {
  const cookies = parseCookies(req);
  destroySession(cookies.sb_session);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

route("GET", /^\/api\/admin\/session\/?$/, async (req, res) => {
  const cookies = parseCookies(req);
  sendJson(res, 200, { authenticated: isSessionValid(cookies.sb_session) });
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
      await match.handler(req, res, match.params);
    } catch (e) {
      sendJson(res, 500, { error: "Server error" });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Seven Bits Coffee server running at http://localhost:${PORT}`);
  if (!UPI_VPA) {
    console.log("Note: UPI_VPA is not set, so 'Pay Online' orders won't show a QR code.");
    console.log("Set UPI_VPA and UPI_PAYEE_NAME env vars to enable it.");
  }
});
