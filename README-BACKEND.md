# Seven Bits Coffee - Backend

This adds a real server (`server.js`) behind the existing frontend, replacing
the old client-only build where orders lived only in one browser tab's memory
and "admin login" was a hardcoded passcode anyone could read in the JS
source or bypass from devtools.

Written in **plain Node.js** (only built-in modules - `http`, `fs`, `crypto`)
so it runs with nothing to install:

```
node server.js
```

Then open `http://localhost:3000`.

## Configuration

Copy `.env.example` to `.env` for reference, and export the variables it
lists before starting the server (see that file for what each one does -
`ADMIN_PASSWORD`, `UPI_VPA`, `UPI_PAYEE_NAME`, `PORT`, `FORCE_SECURE_COOKIE`).
Since no dependencies were installed, `.env` isn't loaded automatically -
either `export` the values yourself, use your host's environment-variable
settings (Render/Railway/Fly/etc. all have a place for this), or add a
dotenv loader if you'd rather.

**Set `ADMIN_PASSWORD` explicitly before your first real run.** If you
don't, the server generates a random one and prints it to the console a
single time on first boot - fine for testing, risky for production if you
miss it.

## What changed vs. the old build, and why

| Before | Now |
|---|---|
| `passcode: "1024"` shipped in plain JS; "logged in" was just a `sessionStorage` flag anyone could set from devtools | Password is hashed on disk (`data/admin.json`), checked server-side, session is an httpOnly cookie the browser can't read or forge |
| Orders lived in an in-memory array in one browser tab - refresh, or open the kitchen display on another device, and they're gone | Orders persist in `data/orders.json`; every station (register, kitchen screen, admin) reads/writes the same server data, live-synced over Server-Sent Events |
| "Pay Online" QR always requested a fixed ₹500 to a hardcoded personal UPI ID, regardless of the actual order | Order totals are computed **server-side** from the server's own menu prices; the QR is built from that real total and a UPI ID you configure via env vars, not baked into the source |
| Admin price edits / menu deletes only changed an in-memory object - gone on refresh | All menu/config changes go through the API and are saved to disk |
| GST/service-charge rates in "admin settings" were never actually read anywhere | Checkout math now reads these from `data/config.json`, which the admin panel actually edits |
| CSP allowed scripts/styles/images from any origin plus `eval()` | Restricted to this origin only (see the comment in `index.html` for the one remaining tradeoff: inline `onclick=""` still needs `unsafe-inline` until those are migrated to `addEventListener`, which is real follow-up work, not done here) |
| Order IDs were `SB-` + a random 4-digit number - collisions likely at real volume | Order IDs use random hex, effectively collision-free |

## Data storage

Everything lives as JSON files under `./data/` (created automatically on
first run, seeded from `./data-seed/menu-seed.json`):

- `menu.json` - items, prices, sections
- `config.json` - shop name, tax rates, service charge, tip settings
- `orders.json` - every order ever placed
- `admin.json` - the hashed admin password (never the plaintext)

This is intentionally simple (no database server to run) and is fine for a
single coffee shop's volume. If you outgrow it, the next step is swapping
`readJson`/`writeJson` in `server.js` for a real database (Postgres/SQLite) -
the rest of the code doesn't need to change since those two functions are
the only thing touching disk.

**Back these files up.** There's no replication - if the machine running
this dies, you lose order history unless you're backing up `./data/`.

## Known limitation worth knowing about: online payments are still trust-based

Marking an `ONLINE` order as paid currently happens automatically when the
order is created - there's no verification that money actually arrived,
because that requires integrating a real UPI/payment-gateway webhook (Razorpay,
Cashfree, PhonePe Business, etc.), which needs a merchant account and
credentials only you can set up. The QR code now at least requests the
*correct amount*, which fixes the bigger bug, but a customer could still
show "payment pending" at the counter without having actually paid. Wiring
up a real payment gateway's server-to-server confirmation is the natural
next step - happy to help with that once you've picked a provider.

## Everything else from the original review

The other fixes discussed earlier (dynamic QR amount, real auth, orders
syncing across devices, dead-config bug, kitchen ticket theme, CSP) are all
included in this build. Feature suggestions from that review (order status
timeline, low-stock alerts, CSV export, "add new item" in admin) - the
"add item" button is now in Admin; the rest are still open and would be
good follow-ups whenever you're ready.
