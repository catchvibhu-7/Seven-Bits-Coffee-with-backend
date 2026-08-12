# Seven Bits Coffee — Project Documentation

This document explains how the Seven Bits Coffee ordering system works, from
the ground up. It's written to be read by a person, not just a programmer —
if you're new to this codebase (or to web development in general), start at
the top and read straight through. Programmers can jump straight to the
[Function Reference](#function-reference) or [API Reference](#api-reference).

---

## Table of Contents

1. [What This Project Is](#1-what-this-project-is)
2. [The Big Picture: How the Pieces Fit Together](#2-the-big-picture-how-the-pieces-fit-together)
3. [Project Structure](#3-project-structure)
4. [Roles: Who Can Do What](#4-roles-who-can-do-what)
5. [The Pages, Explained](#5-the-pages-explained)
6. [The Popups (Modals)](#6-the-popups-modals)
7. [Function Reference](#7-function-reference)
8. [API Reference](#8-api-reference)
9. [Data Storage](#9-data-storage)
10. [Glossary](#10-glossary)

---

## 1. What This Project Is

Seven Bits Coffee is a working order-and-payment system for a coffee shop:
customers browse a menu and place orders, kitchen staff see those orders
come in live and mark them done, and an owner/admin manages the menu,
pricing, staff accounts, and the look of the site — all from a browser.

It has two halves:

- **The frontend** — what you see in the browser. Built with plain HTML,
  CSS, and JavaScript (no frameworks like React). Lives in `index.html`,
  `css/`, and `js/`.
- **The backend** — a small server that stores data and enforces the rules
  (who's allowed to do what, what things actually cost). Lives entirely in
  one file, `server.js`, using nothing but Node.js's built-in tools.

The frontend never trusts itself for anything that matters (prices, who's
logged in, who's allowed to see what) — it always asks the backend, and the
backend is the one place all of that is actually decided.

---

## 2. The Big Picture: How the Pieces Fit Together

Think of it like a restaurant:

- **The browser (frontend)** is the dining room — it's what the customer or
  staff member actually sees and touches: menus, buttons, forms.
- **The server (backend)** is the kitchen and the cash register — it's where
  the real prices are kept, where orders are actually recorded, and where ID
  is checked before anyone's allowed behind the counter.
- **The data files** (`data/*.json`) are like a filing cabinet — plain text
  files on disk that remember the menu, the orders, the staff accounts, and
  the settings, so nothing is lost when the server restarts.

Every time the frontend needs something — "show me the menu", "log this
person in", "place this order" — it sends a small request to the backend
(this is called an **API call**), the backend checks it's allowed, does the
work, and sends back an answer. The frontend then updates what's on screen.

```
 Browser (index.html + js/)  <-- API calls -->  Server (server.js)  <-->  data/*.json files
     "what you see"                                "the real rules"           "the memory"
```

---

## 3. Project Structure

```
├── index.html                  The single HTML page - all 4 "pages" live inside it
├── server.js                   The entire backend - one file, no dependencies
├── data-seed/menu-seed.json    Starting menu, copied into data/menu.json on first run
├── data/                       Created automatically - the shop's actual saved data
│   ├── menu.json                 Items, prices, sections
│   ├── config.json               Shop settings, branding, footer
│   ├── users.json                Accounts (hashed passwords only)
│   ├── orders.json               Every order ever placed
│   ├── audit-log.json            Owner-only record of password resets/removals
│   └── branding-profiles.json    Saved "look" presets (e.g. holiday themes)
├── css/
│   ├── theme.css                 All the site's visual styling
│   └── iconsvg.css               The built-in icon set (cups, pastries, etc.)
├── js/
│   ├── app.js                    The "conductor" - wires pages, nav, and events together
│   ├── features/                 Logic that isn't tied to any one screen
│   │   ├── auth-logic.js           Talks to the server about login/accounts
│   │   ├── kitchen-logic.js        Talks to the server about orders
│   │   ├── config-logic.js         Talks to the server about shop settings
│   │   ├── cart-logic.js           Calculates a cart's subtotal/tax/total
│   │   └── password-strength.js    Scores a password as weak/fair/good/strong
│   └── ui/                       Each file builds one popup or screen
│       ├── login-modal.js          Login / guest / sign-up / forgot-password popup
│       ├── checkout-modal.js       Cart summary + payment popup
│       ├── admin-portal.js         Everything inside the Admin page
│       ├── staff-modal.js          "Add staff account" popup
│       ├── item-modal.js           "Add/edit menu item" popup
│       ├── info-modal.js           Generic confirm/info popup (reused everywhere)
│       └── account-settings-modal.js  "Change my password" popup
├── start.bat                   Double-click-to-run helper for Windows
├── .env.example                 Example settings for first-time setup
└── README-BACKEND.md            Setup instructions (how to install and run it)
```

**Why one `server.js` file?** So the whole backend runs with just
`node server.js` — no install step, nothing to go wrong. It's organized
internally with clear section headers (search for `====` inside the file)
covering: data storage helpers, accounts/passwords, sessions, live updates,
and then all the API routes grouped by topic.

**Why is `index.html` one file with four pages inside it?** Rather than
navigating to four separate HTML files, all four "pages" (Home, Menu,
Orders, Admin) are `<div>` sections that already exist in the page — the
site just shows one and hides the rest. This is called a
**single-page app**. `window.showPage('menu')`, for example, hides every
`.page` div and shows `#page-menu`. See [`showPage`](#showpagepageid).

---

## 4. Roles: Who Can Do What

Every visitor falls into one of five roles. The server checks the role on
every single request that matters — the buttons you see in the browser are
just a convenience; the real gate is on the backend.

| Role | Can see | How they get this role |
|---|---|---|
| **Guest** | Only the order tied to a phone number they typed in | No account — just enters a phone number |
| **Customer** | Their own order history/status | Signs themselves up (username, password, name, phone) |
| **Employee** | The Kitchen/Orders board | Created by an admin or owner |
| **Admin** | Kitchen board + the full Admin panel (menu, settings, staff — but can only create Employee accounts) | Created by the owner (or another admin) |
| **Owner** | Everything, including managing admins and reading the activity log | One is created automatically the first time the server ever runs |

---

## 5. The Pages, Explained

The site has four pages, plus popups that appear over them. Every page
follows the same basic pattern: **HTML lays out empty containers, and a
JavaScript function fills them in with real data fetched from the server.**

### 5.1 Home Page (`#page-home`)

**What's on it:** the hero banner (shop name, tagline, "Order Now" button),
a row of "Popular Picks" (a few clickable menu items), a "Your Order" status
card (only shown if there's an order in progress), and the footer (store
address/contact/hours).

**How it's built:**

| What you see | Built by | Data comes from |
|---|---|---|
| Hero banner | Static HTML, styled by `applyBranding()` | Admin's Branding settings |
| Popular Picks row | [`renderPopularPicks()`](#renderpopularpicks) | `GET /api/menu` |
| "Your Order" card | [`refreshOrderStatusWidget()`](#refreshorderstatuswidget) | `GET /api/orders/mine` |
| Footer | [`renderFooter()`](#renderfooterconfig) | Admin's footer settings, via `GET /api/config` |

The "Your Order" card also stays live — if a customer is logged in,
[`ensureOrdersStream()`](#ensureordersstream) opens a permanent connection
to the server so the card updates the instant kitchen staff mark the order
ready, with no refresh needed.

### 5.2 Menu Page (`#page-menu`)

**What's on it:** a searchable, filterable list of everything for sale,
grouped into sections (e.g. "High Bandwidth", "Beta Mode"), with a
list/grid view toggle and a running cart total at the bottom.

**How it's built:**

- [`renderMenu()`](#rendermenufilterquery) draws every section and item
  currently in `menuData` (loaded once at startup by
  [`loadMenu()`](#loadmenu), and re-used from memory after that — no server
  call happens on every keystroke).
- Typing in the search box calls `renderMenu()` again with the typed text,
  but only after you pause typing for a moment
  ([`initSearchBar()`](#initsearchbar) debounces this on purpose, so it
  doesn't re-draw the whole menu on every single keystroke).
- Clicking **ADD BIT** calls [`addToCart()`](#addtocartid), which just
  updates an in-memory `cart` array and re-draws the menu (no server call —
  the cart isn't "real" until checkout).
- Clicking the cart bar calls
  [`handleCartStatusClick()`](#handlecartstatusclick), which opens the
  [checkout popup](#62-checkout--payment-modal-checkout-modaljs).

### 5.3 Orders Page — the Kitchen Display (`#page-kitchen`)

**Who can see it:** employees, admins, and owners only — the nav tab is
hidden for everyone else, and the server double-checks the role on every
request even if someone bypasses the hidden tab.

**What's on it:** every order as a printed-ticket-style card, with tabs to
filter by station (Barista / Kitchen / Desserts) and by status
(Active / History / Show All), plus a newest/oldest sort.

**How it's built:**

- [`renderKitchen()`](#renderkitchen) is the single function that draws
  every visible ticket — it re-runs any time a filter or sort changes, or
  any time a live update arrives.
- Orders are fetched once via
  [`KitchenSystem.fetchOrders()`](#kitchensystemfetchorders) and kept in
  memory; clicking a filter tab doesn't re-fetch from the server, it just
  re-draws from what's already loaded.
- Clicking **MARK DONE** calls
  [`markCompleted()`](#markcompletedorderid), which tells the server, then
  re-draws.
- Because [`ensureOrdersStream()`](#ensureordersstream) is open, if a
  *different* device (say, the register up front) places a new order, this
  screen updates on its own.

### 5.4 Admin Page (`#page-admin`)

**Who can see it:** admins and owners only.

The Admin page is really five separate screens sharing one wrapper —
clicking a tab swaps which one is visible. This is handled entirely inside
[`js/ui/admin-portal.js`](#adminportaljs), by the `AdminPortal` object.

| Tab | What it's for | Key function |
|---|---|---|
| **Global Settings** | Shop name, tax/tip rates, and UPI payment ID | `renderGlobalSettings()` |
| **Menu Items** | Add/edit/delete menu items | `renderMenuItems()`, `openItemModal()` |
| **Order History** | Browse every order ever placed, filterable and sortable | `renderOrderHistory()` |
| **User Management** | Staff accounts, password resets, and (owner-only) the activity log | `renderStaffManagement()` |
| **Branding** | Colors, theme, logo, hero image, custom icons, saved "look" profiles, footer content | `renderBranding()` |

Every one of these follows the same shape: fetch the current data from the
server, build an HTML string with it, drop that HTML into the page, then
attach click handlers to the buttons inside it.

---

## 6. The Popups (Modals)

A "modal" is a popup box that sits on top of the page. This project uses
custom-built ones everywhere instead of the browser's built-in
`alert()`/`prompt()`/`confirm()` boxes, so they can match the site's look
and support things like dropdowns and live validation that plain browser
popups can't.

### 6.1 Login / Sign-up / Guest / Forgot-password (`login-modal.js`)

One popup, four modes, switched with tabs:

- **Login** — username + password, for any account type
- **Guest** — just a phone number, no account created
- **Sign Up** — creates a new *customer* account (staff accounts can only
  be created by an admin, never through this form)
- **Forgot Password** — a customer can reset their own password by proving
  they know the phone number on the account

There's also a separate, simpler popup —
[`renderForceChangePasswordModal()`](#renderforcechangepasswordmodalonsuccess-onlogout)
— shown automatically right after logging in with a temporary password. It
can't be dismissed except by logging out, because a temp password is only
meant to work once.

### 6.2 Checkout / Payment Modal (`checkout-modal.js`)

Two-step: [`renderCheckoutModal()`](#rendercheckoutmodalcartitems-servicechargeactive-tipapplied)
shows the cart, tax breakdown, and a phone number field, then either "Pay
Cash" or "Pay Online" button calls
[`startCheckout()`](#startcheckoutmethod) in `app.js`, which sends the
order to the server. Only once the server responds with the *real*,
recalculated total does
[`renderPaymentConfirmation()`](#renderpaymentconfirmationorder-method) show
the payment QR code — the amount on that QR always matches what the server
actually charged, never a number the browser made up.

### 6.3 Admin Popups

- **`staff-modal.js`** — add a new staff account, with a role dropdown (only
  showing roles you're allowed to grant) and a live "is this username
  available" check.
- **`item-modal.js`** — add or edit a menu item, with section and icon as
  dropdowns instead of typed text.
- **`account-settings-modal.js`** — change your own password, from
  anywhere in the app.
- **`info-modal.js`** — a general-purpose "are you sure?" or "here's a
  message" popup, reused by many different actions (deleting a staff
  account, resetting a password, resetting branding, etc.) so there's only
  one popup style to maintain.

---

## 7. Function Reference

Organized by file. Every entry explains **what it does**, **when it runs**,
and **what it touches** (server calls, other functions, on-screen elements).

### `js/app.js`

This file is the "conductor" — almost nothing in it is about *drawing*
things by itself; it's about deciding *when* other things should draw, and
wiring buttons to actions.

#### `loadMenu()`
Fetches the whole menu (`GET /api/menu`) once and stores it in the
in-memory `menuData` variable. Every other function that needs menu data
(the Menu page, Popular Picks, printing a receipt) reads from that same
variable rather than fetching again.

#### `refreshSession()`
Asks the server "who am I logged in as right now?"
(`GET /api/auth/session`), stores the answer in the `session` variable, and
updates the nav bar to match (showing/hiding the Orders and Admin tabs).
Called at startup and after every login/logout.

#### `updateNavForSession()`
Pure display logic — no server call. Looks at the already-loaded `session`
variable and shows or hides the Orders/Admin nav buttons, and updates the
account button's label (e.g. "→ OWNER").

#### `afterLoginSuccess(loginResult, proceed)`
A safety step that runs after every login. If the account just logged in
with a temporary password, it shows the forced password-change popup
*before* letting anything else happen. Otherwise it just refreshes the
session and continues on to whatever was supposed to happen next (opening
a page, opening checkout, etc.) — that "whatever's next" is passed in as
the `proceed` function.

#### `applyBranding(config)`
Takes the shop's branding settings and applies them live, without
reloading the page: sets the site's color variables, switches the
light/dark theme class, and swaps in a custom hero image/logo if the admin
set one. Called at startup and immediately after saving Branding settings.

#### `handleAccountClick()`
What happens when you click your name in the top-right. If you're not
logged in, opens the login popup. If you are, opens the small
Account Settings / Log Out dropdown ([`renderAccountMenu()`](#renderaccountmenu)).

#### `renderAccountMenu()`
Draws the small two-option dropdown (Account Settings, Log Out) under the
account button, and closes itself if you click elsewhere.

#### `doLogout()`
Tells the server to end the session (`POST /api/auth/logout`), then
refreshes and goes back to the Home page.

#### `showToast(message, tone)`
Shows the small "✓ Saved" (or "✗ error") notification in the bottom-right
corner for about two seconds. Used after almost every save action across
the whole app so the person always gets confirmation something happened.

#### `showPage(pageId)`
The core page-switcher. If the requested page needs a role you don't have,
it shows the login popup (or a plain "not allowed" message if you're
already logged in as the wrong role) instead of switching. Otherwise, it
hides every page, shows the requested one, and — depending on which page —
kicks off that page's data loading (menu, kitchen orders, admin data, etc).

#### `refreshOrderStatusWidget()`
Decides whether to show the "Your Order" card on the Home page at all, and
if so, fills it in. Only shows for a logged-in customer/guest with an order
that's still active (or was marked ready less than an hour ago) —
everyone else sees nothing, not even an empty placeholder.

#### `ensureOrdersStream()`
Opens one persistent connection to the server (`GET /api/orders/stream`)
so this browser tab gets pushed a signal the instant *any* order changes
anywhere — this is what makes the Kitchen board and the "Your Order" card
update live without refreshing. Only opens once per visit, even if called
multiple times.

#### `addToCart(id)` / `removeFromCart(id)`
Add or remove one of an item from the in-memory `cart` array (not the
server — the cart doesn't exist server-side until checkout), then re-draw
the cart count and the menu.

#### `printBill(order)` / `printKOT(order)`
Open a new browser window formatted for a receipt printer and trigger the
print dialog. Both print **exactly what the server confirmed** — the
numbers come from the `order` object the server returned, never
recalculated in the browser, so what's printed can't drift from what was
actually charged.

#### `startCheckout(method)`
Sends the cart to the server (`POST /api/orders`) with `"COUNTER"` or
`"ONLINE"` as the method, and shows the payment confirmation popup once
the server responds with the real total.

#### `finalizeAndPrint()`
Runs after the person taps "Print & Done" on the payment popup: clears the
cart, closes the popups, refreshes the order status widget, and triggers
the bill + kitchen ticket printing.

#### `initSearchBar()`
Wires up the Menu page's search box. Waits for a brief pause in typing
before re-drawing results, so the whole menu isn't rebuilt on every
keystroke.

#### `toggleJumpMenu()` / `jumpTo(sectionId)`
Power the small "jump to a section" popup on the Menu page — lets you skip
straight to a category instead of scrolling.

#### `iconMarkup(iconKey)`
Given an icon's key (like `"espresso"`), returns the right HTML — either
the built-in CSS icon, or an admin-uploaded custom icon image if one was
added under that key in Branding settings.

#### `renderMenu(filterQuery)`
Rebuilds the entire visible menu list/grid from the in-memory `menuData`
and `cart`, filtered by whatever's typed in the search box. This is the
single function responsible for everything you see on the Menu page.

#### `handleCartStatusClick()`
What happens when you tap the cart bar. Makes sure you're logged in or
continuing as a guest first (since every order needs a phone number to
track it), then opens the checkout popup.

#### `filterKitchen(station)` / `setKitchenStatusFilter(filter)` / `setKitchenSort(sort)`
Change which station tab, active/history filter, and sort order are
currently selected on the Kitchen page, then re-draw.

#### `renderKitchen()`
Draws every visible order ticket on the Kitchen page, respecting whichever
station/status/sort filters are currently selected.

#### `markPaid(orderId)` / `markCompleted(orderId)`
Tell the server an order's been paid or finished
(`PATCH /api/orders/:id`), then re-draw the Kitchen board. `markCompleted`
also triggers the small sliding notification confirming what got marked
done.

#### `closeModal()` / `toggleTip(check)` / `removeServiceCharge()`
Small helpers for the checkout popup — closing it, and toggling the tip or
service charge, which then re-opens the popup with updated totals.

#### `triggerGingerAnimation(message)`
The small orange notification that slides in from the left when an order
status changes in the kitchen.

#### `renderFooter(config)`
Builds the Home page footer's HTML from the admin's saved store details
(tagline, address, contact, hours). If none of those are filled in, the
footer section just stays hidden rather than showing empty labels.

#### `renderPopularPicks()`
Builds the row of clickable item cards near the top of the Home page, using
the first few items from the first menu section.

#### `pickFromHome(itemId)`
What happens when a Popular Pick card is clicked — adds that item to the
cart and jumps straight to the Menu page.

---

### `js/features/auth-logic.js` — `AuthSystem`

Every method here is a thin wrapper around one server call — this file's
whole job is "translate a login/account action into the right API request."

| Method | What it does |
|---|---|
| `getSession()` | Asks "am I logged in, and as what role?" |
| `login(username, password)` | Logs in with an existing account |
| `registerCustomer({...})` | Creates a new customer account and logs in as them |
| `continueAsGuest(phone)` | Starts a guest session tied to a phone number |
| `logout()` | Ends the current session |
| `checkUsernameAvailable(username)` | Fast "is this username taken?" check (see [Bloom filter](#a-note-on-the-username-check)) |
| `changePassword(currentPassword, newPassword)` | Changes your own password while logged in |
| `forgotPassword({username, phone, newPassword})` | Customer self-service password reset |

### `js/features/kitchen-logic.js` — `KitchenSystem`

Everything about fetching and updating orders.

| Method | What it does |
|---|---|
| `fetchOrders()` | Loads every order (staff-only) |
| `fetchMine()` | Loads just the logged-in customer's/guest's own orders |
| `pushOrder(cartItems, method, options)` | Places a new order |
| `markPaid(orderId)` | Marks an order as paid |
| `markDone(orderId, station)` | Marks a station's items on an order as done |
| `connectLiveUpdates(onChange)` | Opens the live-update connection described above |
| `getStation(item)` | Works out which station (Barista/Kitchen/Desserts) an item belongs to |

### `js/features/config-logic.js` — `AdminConfig`

| Method | What it does |
|---|---|
| `loadSettings()` | Fetches the shop's current settings |
| `saveSettings(newSettings)` | Saves changed settings (admin/owner only — the server checks) |

### `js/features/cart-logic.js` — `CartSystem`

| Method | What it does |
|---|---|
| `calculateBreakdown(items, config)` | Works out subtotal/tax/service charge for the **preview** shown in the checkout popup. This is only ever a preview — the server independently recalculates the real total when the order is actually placed, so a tampered browser can't change what gets charged. |

### `js/features/password-strength.js`

| Function | What it does |
|---|---|
| `scorePassword(password)` | Rates a password weak/fair/good/strong, for on-screen feedback only |
| `renderPasswordStrengthMeter(container, password)` | Draws the little colored strength bar |

This is guidance only — the server enforces the *actual* minimum password
rules independently (see [Data Storage](#9-data-storage)), so this file
being bypassed doesn't weaken what's really accepted.

### `js/ui/admin-portal.js` — `AdminPortal`

The largest single file — it runs the entire Admin page. Rather than list
every internal method, here's what each of the five tabs' main function is
responsible for:

| Function | Tab | Responsible for |
|---|---|---|
| `renderGlobalSettings()` | Global Settings | Shop name, tax/tip rates, UPI payment ID |
| `renderMenuItems()` / `openItemModal()` / `deleteItem()` | Menu Items | Listing, adding, editing, deleting menu items |
| `renderOrderHistory()` | Order History | The filterable/sortable grid of past orders |
| `renderStaffManagement()` / `resetStaffPassword()` / `removeStaff()` | User Management | Staff accounts, password resets, and the owner-only activity log |
| `renderBranding()` | Branding | Colors, theme, images, custom icons, saved profiles, footer |

### `js/ui/*.js` — the popups

| File | Exports | Purpose |
|---|---|---|
| `login-modal.js` | `renderLoginModal()`, `renderForceChangePasswordModal()` | Described in [6.1](#61-login--sign-up--guest--forgot-password-login-modaljs) |
| `checkout-modal.js` | `renderCheckoutModal()`, `renderPaymentConfirmation()` | Described in [6.2](#62-checkout--payment-modal-checkout-modaljs) |
| `staff-modal.js` | `renderAddStaffModal(currentRole, onCreated)` | Add-staff popup |
| `item-modal.js` | `renderItemModal({sections, customIcons, item, onSave})` | Add/edit menu item popup |
| `info-modal.js` | `renderInfoModal({title, message, ...})` | Reusable confirm/info popup |
| `account-settings-modal.js` | `renderAccountSettingsModal(session)` | Change-my-password popup |

---

## 8. API Reference

Every request the browser can make to the server. "Auth required" means the
server will reject the request outright (before doing anything) if you're
not logged in with an allowed role — this is checked on the server no
matter what the browser's UI shows or hides.

### Accounts & Login

| Method & Path | Auth required | What it does |
|---|---|---|
| `POST /api/auth/register` | none | Creates a new **customer** account (never staff) |
| `POST /api/auth/login` | none | Logs in; sets the session cookie |
| `POST /api/auth/guest` | none | Starts a guest session tied to a phone number |
| `POST /api/auth/logout` | any | Ends the session |
| `GET /api/auth/session` | none | "Who am I logged in as?" |
| `GET /api/auth/check-username` | none | Fast username-availability check |
| `POST /api/auth/change-password` | any (with an account) | Change your own password |
| `POST /api/auth/forgot-password` | none | Customer self-service reset (proves identity via phone number) |

### Staff Accounts

| Method & Path | Auth required | What it does |
|---|---|---|
| `GET /api/users` | admin/owner | List staff accounts |
| `POST /api/users` | admin/owner | Create a staff account (admins can only create employees) |
| `POST /api/users/:id/reset-password` | admin/owner | Generate a one-time temporary password for someone else |
| `DELETE /api/users/:id` | admin/owner | Remove a staff account |
| `GET /api/audit-log` | **owner only** | See every password reset/removal an admin has performed |

### Menu

| Method & Path | Auth required | What it does |
|---|---|---|
| `GET /api/menu` | none | Get the full menu |
| `POST /api/menu` | admin/owner | Add a menu item |
| `PATCH /api/menu/:id` | admin/owner | Edit a menu item (any field) |
| `DELETE /api/menu/:id` | admin/owner | Remove a menu item |

### Shop Settings & Branding

| Method & Path | Auth required | What it does |
|---|---|---|
| `GET /api/config` | none | Get current shop settings |
| `PATCH /api/config` | admin/owner | Update settings (rates, UPI ID, branding, footer, etc.) |
| `DELETE /api/config/custom-icons/:key` | admin/owner | Remove a custom icon |
| `POST /api/config/reset-branding` | admin/owner | Reset colors/theme/images back to default |
| `GET /api/branding-profiles` | admin/owner | List saved "look" profiles |
| `POST /api/branding-profiles` | admin/owner | Save current branding as a new named profile |
| `POST /api/branding-profiles/:name/activate` | admin/owner | Switch to a saved profile |
| `DELETE /api/branding-profiles/:name` | admin/owner | Delete a saved profile |

### Orders

| Method & Path | Auth required | What it does |
|---|---|---|
| `GET /api/orders` | employee/admin/owner | Every order (for the Kitchen board and Order History) |
| `GET /api/orders/mine` | customer/guest | Only the logged-in person's own orders |
| `POST /api/orders` | any (with an account or guest phone) | Place an order — **the server calculates the real price here**, never trusting a number from the browser |
| `PATCH /api/orders/:id` | employee/admin/owner | Mark an order paid or done |
| `GET /api/orders/stream` | any | The live-update connection described in [`ensureOrdersStream()`](#ensureordersstream) |

---

## 9. Data Storage

The server stores everything as plain JSON files under `data/`. There's no
database — just files, read and re-written as needed. This keeps setup to
"just run `node server.js`," at the cost of not scaling to a huge number of
orders (fine for a single coffee shop).

| File | Holds |
|---|---|
| `users.json` | Accounts. Passwords are **never** stored as plain text — only a scrambled ("hashed") version that can be checked but not reversed. |
| `menu.json` | Every menu item, section, and the item's price/icon/description. |
| `config.json` | Shop name, tax rates, UPI payment ID, branding colors/theme, footer content. |
| `orders.json` | Every order, with its items, prices, and status. |
| `audit-log.json` | Owner-only record of password resets/removals. |
| `branding-profiles.json` | Saved "look" presets an admin can switch between. |

### A note on the username check

The "is this username available?" check uses something called a
**Bloom filter** — a small, very fast structure that can say "definitely
not taken" instantly without checking every account, and falls back to a
real check only when it says "maybe taken." For this app's realistic
number of users, a plain check would honestly be fast enough on its own —
this exists because it's a genuinely useful pattern once an account list
gets very large, and demonstrates the idea.

### A note on passwords

The server requires at least 8 characters and at least 3 of: lowercase
letters, uppercase letters, numbers, symbols. This is checked on the
server independently of the on-screen strength meter, so the real rule
can't be bypassed by tampering with the browser.

---

## 10. Glossary

**API (Application Programming Interface)** — the set of specific requests
the browser is allowed to send to the server, like "get the menu" or "log
in." Each one has a method (see below) and a path (like `/api/menu`).

**API call / request** — one specific instance of the browser asking the
server to do something and waiting for an answer.

**Method (GET / POST / PATCH / DELETE)** — what *kind* of request it is.
`GET` reads data without changing anything. `POST` creates something new.
`PATCH` changes part of something that already exists. `DELETE` removes
something.

**Session / session cookie** — a small token the server gives your browser
after you log in, which your browser then sends back with every request so
the server knows who you are without you having to type your password
again on every single click.

**Role** — which of the five account types (Guest, Customer, Employee,
Admin, Owner) decides what you're allowed to see and do.

**Modal** — a popup box that appears on top of the page.

**Endpoint** — another word for one specific API path, like
`GET /api/orders`.

**Hashing** — a one-way scramble applied to passwords before they're saved,
so even if someone read the data file directly, they couldn't recover the
actual password.

**Live update / Server-Sent Events (SSE)** — the technology behind
`ensureOrdersStream()` that lets the server push a message to the browser
the instant something changes, instead of the browser having to keep
asking "anything new yet?" over and over.
