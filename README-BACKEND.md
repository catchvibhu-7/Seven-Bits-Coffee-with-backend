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

- Real payment verification - on hold for now
- Move to a real database (SQLite) instead of JSON files - to be discussed
  before starting, since it's a bigger structural change
- A full multi-store experience: per-store menus, a store switcher, KPIs
  split by store (today, everything is shop-wide except staff assignment)
- Migrate the remaining `onclick=""` handlers to `addEventListener` so the
  Content-Security-Policy can drop `unsafe-inline` entirely
- Low-stock alerts, CSV export of sales - from the original feature list
- Order customization (size, milk type, extras), loyalty points, promo
  codes, SMS/notification when an order is ready - from the ideas list

## Roles, Manager Dashboard, and Payroll

- **Manager** is a new role between Employee and Admin. A manager gets a
  scoped version of the Admin page (the nav button reads "DASHBOARD"
  instead of "ADMIN"): Dashboard (KPIs), Menu Items, Order History,
  Payroll, and User Management (their own store's employees only) -
  **not** Global Settings or Branding, and they can't create or manage
  other managers/admins. All of this is enforced server-side, not just
  hidden in the UI - a manager calling the API directly still gets a 403
  on anything outside what they're allowed to do.
- **Staff tags**: a free-text "responsibility" label (e.g. "Barista",
  "Cashier") settable when creating or editing a staff account - shown in
  the staff table, purely informational (doesn't affect permissions).
- **Pay rate & payroll**: each employee/manager can have a pay rate
  (hourly/weekly/monthly). Pay periods are fixed calendar cycles -
  hourly/weekly staff are paid Monday-Sunday, monthly staff on the
  calendar month - auto-calculated, not something an admin picks each
  time. Hourly pay is computed from real clock-in/clock-out time (see
  below); weekly/monthly is a flat rate per period. "Mark Paid" snapshots
  that period's amount so it can't change after the fact and can't be
  marked paid twice.
- **Clock in/out**: employees and managers get a Clock In/Out button in
  the nav bar. This is what makes hourly pay real rather than a guess -
  worked hours are summed from actual shift timestamps.
- **8-hour daily cap, with manual overtime approval**: no single calendar
  day ever counts for more than 8 hours toward pay - whether the hours
  came from self clock-in/out or a manager marking attendance directly -
  unless a manager explicitly approves overtime for that specific person
  and date. This is a deliberate two-step design: entering/marking hours
  and approving overtime are always separate actions, so the cap can't be
  bypassed just by how a number gets entered.
- **Manager-marked attendance**: for staff who never log into the system
  themselves (e.g. table-service staff with no real need for an account -
  see below), a manager records their hours directly from the Payroll
  tab, subject to the same 8-hour cap and overtime approval as everyone
  else.
- **Staff without their own login**: nothing requires a staff member to
  actually use an account. A manager can create an `employee` account
  purely as a payroll record (tag it, e.g., "Server"), never hand out the
  username/password, and mark that person's attendance manually each pay
  period. If that person ever needs their own access later, the account
  is already there - just hand over the credentials.
- **Multi-store groundwork**: a `stores` concept now exists (an owner can
  add a new store from Branding), and staff accounts carry a `storeId`.
  With one store this changes nothing day-to-day - it means adding a
  real second location later is "create a store, assign people to it,"
  not a data migration. The rest of the multi-store experience (a menu
  per store, a store switcher, KPIs split by store) isn't built yet.

## KPI Dashboard

The Admin/Manager Dashboard tab shows: today/week/month/all-time revenue
and order counts, a 7-day revenue bar chart, and a top-5 best-sellers list
- all computed live from `data/orders.json`, no separate analytics store.
Charts are plain CSS (no charting library), keeping the zero-dependency
philosophy.



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
