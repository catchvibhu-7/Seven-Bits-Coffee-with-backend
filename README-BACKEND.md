# Seven Bits Coffee - Backend

A real server (`server.js`) behind the frontend, with actual user accounts
and roles - replacing the old client-only build where orders lived only in
one browser tab's memory and "admin login" was a hardcoded passcode anyone
could read in the JS source or bypass from devtools.

Written in **plain Node.js** (only built-in modules - `http`, `fs`,
`crypto`) so it runs with nothing to install:

```
node server.js
```

**Windows:** just double-click `start.bat` instead - it checks Node.js is
installed, creates a `server-settings.bat` file for your password/settings
on first run, and keeps the window open if something goes wrong so you can
read the error.

Then open `http://localhost:3000`.

## Accounts & roles

There are five kinds of access:

| Role | Can see | How the account is made |
|---|---|---|
| **Owner** | Everything: Admin panel (menu, pricing, settings, staff accounts) + Kitchen/Orders board | One owner account is auto-created the first time you run the server, from `OWNER_USERNAME` / `OWNER_PASSWORD` |
| **Admin** | Admin panel + Kitchen/Orders board. Can create **employee** accounts only | Created by the owner (or another admin) from the Admin panel's "Staff Accounts" section |
| **Employee** | Kitchen/Orders board only (not Admin) | Created by an owner or admin |
| **Customer** | Their own order status on the home page | Self-registers with the "SIGN UP" tab on the login screen (username, password, name, phone) |
| **Guest** | The order status tied to whichever phone number they enter - nothing else | No account needed - "GUEST" tab on the login screen, just enter a phone number |

Staff roles (owner/admin/employee) are never available to the public
sign-up form - only an existing owner/admin can hand those out, and the
server enforces who's allowed to create which role even if someone calls
the API directly (an admin trying to create another admin gets rejected).

**Set `OWNER_PASSWORD` explicitly before your first real run.** If you
don't, the server generates a random one and prints it to the console a
single time on first boot - fine for testing, risky for production if you
miss it.

## How order tracking works

Every order needs a phone number attached (typed in at checkout, or
pre-filled and locked if you're logged in as a customer). That phone number
is what "Guest" login uses to find your order afterwards - a guest can only
ever see orders placed under the exact phone number they typed in, nothing
else. A logged-in customer sees orders tied to their account instead.

This was designed so it drops into a real database later with no rework:
every place that reads/writes users, menu items, config, or orders goes
through a small set of functions (`readJson`/`writeJson`, `findUserById`,
etc.) in `server.js` - swapping those for real database calls is the only
change needed; none of the route logic, the role checks, or the frontend
would need to change.

## Configuration

Copy `.env.example` to `.env` for reference and export those variables
yourself (see that file for what each one does), or on Windows just edit
`server-settings.bat` (created automatically by `start.bat`). Since no
dependencies were installed, `.env` isn't loaded automatically outside of
that.

## What changed vs. the single-password build

| Before | Now |
|---|---|
| One hardcoded passcode (`"1024"`), same access for everyone who had it | Real accounts with 5 distinct roles, each seeing only what they're supposed to |
| Orders lived in one browser tab's memory | Orders persist in `data/orders.json`, synced live across every device via Server-Sent Events |
| No way for a customer to check on their order | Home page shows the signed-in customer's/guest's latest order and live status (Preparing/Ready) |
| Anyone could open Kitchen or Admin from the nav | Kitchen requires employee/admin/owner; Admin requires admin/owner; the nav itself hides tabs you can't use, and the server double-checks on every request regardless of what the nav shows |
| "Pay Online" QR always requested a fixed ₹500 to a hardcoded personal UPI ID | Server computes the real total from its own menu prices and builds the QR from that |

(See the git history / earlier conversation for the full list of fixes from
the original client-only build - QR bug, dead config settings, kitchen
ticket theme, CSP, etc. - all still included here.)

## Data storage

Everything lives as JSON files under `./data/` (created automatically on
first run, seeded from `./data-seed/menu-seed.json`):

- `users.json` - accounts (hashed passwords, never plaintext) with role, name, phone
- `menu.json` - items, prices, sections
- `config.json` - shop name, tax rates, service charge, tip settings
- `orders.json` - every order ever placed, with the phone/customer it's linked to

This is intentionally simple (no database server to run) and is fine for a
single coffee shop's volume. **Back these files up** - there's no
replication, so if the machine running this dies, you lose order and
account history unless you're backing up `./data/`.

## Known limitation worth knowing about: online payments are still trust-based

Marking an `ONLINE` order as paid currently happens automatically when the
order is created - there's no verification that money actually arrived,
because that requires integrating a real UPI/payment-gateway webhook
(Razorpay, Cashfree, PhonePe Business, etc.), which needs a merchant
account and credentials only you can set up. The QR code requests the
*correct amount* (fixed from the original build), but a customer could
still show "payment pending" at the counter without having actually paid.
Wiring up a real payment gateway's server-to-server confirmation is the
natural next step - happy to help with that once you've picked a provider.

## Good next steps (not done yet)

- Real payment verification (see above) - Razorpay is the target gateway
  once you have a merchant account and API keys
- Migrate the remaining `onclick=""` handlers to `addEventListener` so the
  Content-Security-Policy can drop `unsafe-inline` entirely
- Real multi-currency - the currency symbol is stored in config but not
  actually threaded through every price display; today it's really
  "configurable symbol, hardcoded formatting"
- QR-code order tracking - a customer scans a code at checkout to watch
  their own order status without logging in, instead of the phone-based
  guest flow that exists today
- **SMS/WhatsApp order-ready and low-stock alerts** - currently these only
  show in-app (staff dashboard, order status widget). Wiring up a real
  provider (Twilio, MSG91, or Meta's WhatsApp Business API) needs an
  account/API key only you can set up - happy to help once you've picked one.

## Admin panel tour (Global Settings / Menu Items / Order History / User Management / Branding)

- **Menu Items**: add/edit items through a form (not a browser prompt) -
  section and icon are dropdowns, and edits cover every field, not just price.
- **Order History**: a filterable (All/Active/Completed), sortable
  (newest/oldest) grid of every order ever placed - separate from the live
  Kitchen board, meant for looking back rather than working an order queue.
- **User Management**: staff accounts, password resets/removal, and - owner
  only - an **account activity log** showing every password reset or
  removal an admin has performed on another account, so an owner can catch
  misuse. Admins can't see or clear this log.
- **Branding**: theme presets (DARK/LIGHT fill in that theme's standard
  colors; CUSTOM leaves your colors alone), a **Reset to Default** button,
  **custom icons** (add your own by image URL, usable in the menu item
  editor alongside the built-in set), and **saved branding profiles** - e.g.
  a "Diwali" or "Christmas" look you can save once and switch back to
  instantly later.
- Every logged-in account (not just staff) can reach **Account Settings**
  from the nav button in the top right, to change their own password.

Note on image URLs: the CSP's `img-src` allows any `https://` source (not
just specific hosts) because Branding lets an admin point the hero image,
logo, and custom icons at any URL - that's admin-configured content, not
something a random visitor can inject.
