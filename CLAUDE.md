# Seven Bits Coffee — Claude Code Handoff

This project was built and iterated on in claude.ai chat across several
sessions. This file exists so Claude Code doesn't need that history
re-explained — read it before making changes.

## Architecture

- `server.js` — entire backend, single file (~5300 lines now, was ~2600 —
  has grown a lot across sessions, don't trust old line-number references).
  No framework; hand-rolled `route(method, regex, handler)` router + raw
  `http` module. Search for: `computeOrder` (pricing engine — also handles
  promo discounts and prep-time freezing), `COUPONS_FILE`/`findValidCoupon`
  (coupons, now with `private` public/private split), `TABLE_SESSIONS_FILE`/
  `computeTableSessionBill` (postpaid tabs), `loyalty` (config key),
  `DEFAULT_BRANDING`/`textStyles` (admin panel text branding),
  `generateOrderNumber` (the `SBYYMMDD01`-style display number, separate
  from `order.id`'s internal PK), `computeWaitTimeMins` (backlog +
  parallelism wait estimate), `mergeStoreOverrides`/
  `DEFAULT_STORE_OPERATIONS` (multi-store settings resolution),
  `computeOrderGroupBill`/`attachedToOrderId` (staff-attached follow-up
  orders billed together with a root order, same merge shape as
  `computeTableSessionBill`).
- `js/app.js` — main frontend controller (~2700 lines): cart, menu
  rendering, checkout orchestration, kitchen ticket rendering, table panel,
  `applyBranding()` (sets CSS custom properties from server config on boot +
  after saving Branding), `window.printBill`/`window.showBillPreview`
  (shared `billReceiptBodyHtml()` — the same receipt markup either prints
  or shows on-screen).
- `js/ui/*.js` — one file per modal/portal (checkout-modal, admin-portal,
  customize-modal, table-modal, login-modal, account-settings-modal,
  my-orders-modal, combo-modal, item-modal, staff-modal, info-modal,
  billing-page, staff-shell, arcade-page, admin-section).
- `js/features/*.js` — pure logic modules consumed by the UI layer
  (cart-logic, config-logic, auth-logic, customization-logic,
  table-sessions-logic, payroll-logic, favorites-logic, store-logic,
  password-strength, address-logic). `html-utils.js` exports the one
  shared `escapeHtml()` — every `js/ui/*.js` file and app.js import it
  rather than redefining it locally (consolidated from 15 copies). Arcade
  games live under `js/features/arcade/*.js`
  (one file per game, e.g. `snake-game.js`, `tetris-game.js`, plus
  `arcade-logic.js`/`arcade-page.js`) — this was reorganized out of
  `js/ui/*-game.js`; if you ever see stray files at the old path, they're
  leftover cruft from an unmerged branch, not a second copy to keep in sync.
- `css/theme.css` — the only stylesheet (~3150 lines now, was ~1390), plus
  `iconsvg.css` and `cat.css` for icons/the walking-cat easter egg.
- Data persists to `data/*.json` on disk. Whether it's gitignored depends
  on the branch/commit you're on — it has been committed directly at least
  once (`main`'s "mergeing claude branch" commit tracks it). Always
  `rm -rf data` before a fresh test run in a throwaway/scratch copy so
  you're not testing against stale state — but think twice before doing
  that inside a worktree that shares real accumulated data with a server
  the user is actively using (see "Working across worktrees" below).

The app is a single-page app: `index.html` has one `<div class="page">`
per route (`page-home`, `page-menu`, `page-kitchen`, `page-admin`), toggled
by `window.showPage(pageId)` in app.js. There is no `admin.html` — the
admin panel is `page-admin`, navigated to via `window.showPage('admin')`.

## Working across worktrees / branches

- This repo is frequently worked in as a **git worktree**, separate from
  the user's primary checkout. Never `cd` out of your assigned worktree
  directory. The primary checkout and any worktree cannot have the same
  branch checked out simultaneously — if your worktree's branch appears to
  have silently changed, the user (or their tooling) likely checked that
  branch out elsewhere; create a new branch off the old tip rather than
  fighting over it.
- `git push` has been blocked by an "auto mode classifier" in some
  sessions but not others — don't assume either way; just try it, and if
  it's blocked, tell the user plainly that they need to push from their
  own primary checkout.
- Merging a long-lived feature branch into `main` can produce real
  conflicts, not just adjacent-line noise — read each hunk before
  resolving, verify with `node --check` file-by-file, and boot-test the
  fully merged result before considering it done. When one side is empty
  and the other has content that's identical to text already elsewhere in
  the file, that's a diff-algorithm artifact (not a real conflict) —
  resolve by taking the side that avoids duplicating the text, not by
  reflexively picking "ours" or "theirs".
- A "scratch" test server copy (a full copy of the app outside git,
  launched via `.claude/launch.json`) may be the thing an active Cloudflare
  tunnel is actually pointing at — check the tunnel's own log for
  `url:http://localhost:<port>` before assuming a bug report is against a
  different, separately-run server. If a user reports a bug that a code fix
  should have already resolved, the most likely explanation is a stale
  browser tab (their page loaded the old `app.js` before your fix landed) —
  ask for a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) before re-diagnosing
  from scratch.
- **`main` and `pos-redesign-mobile` have diverged again as of this
  session's end**: the font-size sweep and the attach-to-bill feature (see
  "Recent work") are committed on `pos-redesign-mobile` but the user
  explicitly said not to merge them into `main` yet ("not for now") — don't
  merge on your own initiative; ask first. Everything from earlier sessions
  IS already merged into `main` (see the older "Merged `pos-redesign-
  mobile` into `main`" entry below) — only these two newest commits are
  pending.

## Testing conventions

- Use Playwright for anything UI-related. Pattern that works:
  ```
  fuser -k 3000/tcp 2>/dev/null; sleep 1
  cd <project-root> && rm -rf data && \
    (env OWNER_USERNAME=owner OWNER_PASSWORD=TestPass123 node server.js > /tmp/server.log 2>&1 &)
  sleep 2
  node test_x.js
  ```
- Owner login for tests: username `owner`, password `TestPass123` (set via
  `OWNER_USERNAME`/`OWNER_PASSWORD` env vars at boot).
- Login modal field IDs: `#nav-account` (opens it), `#lf-username`,
  `#lf-password`, `#login-submit` — not `#login-username`/`#login-password`.
- To reach the admin panel in a test: `page.evaluate(() =>
  window.showPage('admin'))`, then click `[data-tab="menu"]` etc. Re-run
  this after every `page.reload()` since it's not a separate URL.
- `POST /api/menu` body field for the section is `section` (not
  `sectionId`); `icon` should be a real icon key (e.g. `espresso`).
- Before calling something done: full regression across every admin tab
  (kpi/global/menu/combos/customization/discounts/orders/payroll/staff/
  branding) checking for zero console/page errors, then a clean-extract
  boot test (unzip to a temp dir, boot, curl root) before packaging.
- If running in a sandboxed/ephemeral shell environment, background
  `node server.js` processes may not survive between separate tool calls —
  always start the server and run the test in the *same* shell invocation
  rather than assuming a previously-started server is still up. (This may
  not apply to a persistent local machine, but if you see intermittent
  `ERR_CONNECTION_REFUSED`, this is why.)

## Recent work (most recent session)

- **Codebase redundancy cleanup** (repo-wide audit + fix, not a rewrite):
  ran a ponytail-style over-engineering audit across the whole tree (server.js,
  app.js, every js/ui and js/features file, theme.css) and fixed every
  verified, low-risk finding — nothing behavioral, no framework/dependency
  changes. Deleted: `data/orders.json.bak-pre-id-migration` (CLAUDE.md
  itself said safe to delete), dead `window.removeCartLine` (app.js, zero
  call sites), dead `.home-widget-btn` CSS rule (zero references). New
  `js/features/html-utils.js` exports one `escapeHtml()` — was copy-pasted
  as a private function in 15 separate files (app.js + 14 js/ui files);
  every copy now imports the shared one. Three new shared CSS classes in
  theme.css replace verbatim-duplicated inline `style="..."` attributes:
  `.modal-title-header` (18 call sites), `.field-hint` (55 call sites),
  `.modal-btn-primary`/`.modal-btn-secondary` (10 + 9 call sites) — all
  swapped mechanically (`style="..."` → `class="..."`), zero visual change.
  Verified with `node --check` on every touched file plus a full live
  regression on the scratch server: customer flow (menu → customize →
  cart → checkout → store-picker gating → cash order placement → My
  Orders), address book (search → autofill → save), and staff/admin flow
  (Kitchen board, Billing, every Admin tab including Menu Items/Combos/Raw
  Materials/Staff/Sales/Discounts/Branding/Operations/Store Setup, plus
  the Add Combo/Add Staff/Open Table/Customize/Coupon-usage modals) — zero
  new console errors, zero regressions found. One unrelated environment
  quirk noted during testing: this browser pane's screenshot capture can
  go stale/black after several modal transitions in the same tab (a
  compositor issue, confirmed via DOM/network inspection, not an app bug)
  — reload the tab if it happens, don't mistake it for a rendering defect.
- **Raw material inventory** (was in "Not yet done", now built): a new
  Admin > Menu > Raw Materials tab, manager+ only to view/add/rename/
  deactivate (`GET`/`POST`/`PATCH /api/raw-materials`, MANAGER_UP_ROLES),
  but any `KITCHEN_ROLES` staff can PATCH just the `quantity` field even
  though they can't reach the Admin panel to use it through this UI yet -
  confirmed live: an employee session gets a 403 on `GET` but a 200 on a
  quantity-only `PATCH`, with a `name`/`unit`/`active` change in that same
  request silently ignored rather than erroring. Deliberately just a flat
  name/quantity/unit/active list, same soft-delete convention menu items
  already use (`SHOW INACTIVE` checkbox) - no recipe/BOM link to menu items
  and no auto-deduction on order placement, neither was asked for.
- **Server-side pagination for order history** (was in "Not yet done", now
  built): `GET /api/orders` gained `?page=`/`?limit=` (returns `{items,
  total}` instead of a bare array) plus `?from=`/`?to=`/`?status=`/`?sort=`
  so filtering/sorting happens server-side too - all backward compatible,
  a request with no page/limit still gets the plain full array exactly as
  before (Kitchen board and Billing are untouched, they still want the
  whole scoped set for their own client-side grouping). Only Admin Order
  History was migrated to actually request pages (`loadPage()` replacing
  the old fetch-everything-then-filter-locally `renderList()`) - it's the
  one place that already had its own page-based browsing UI and no natural
  upper bound on total orders, unlike Kitchen/Billing which are inherently
  bounded to "active + recent" or "currently open bills." Kitchen's own
  HISTORY/SHOW ALL tabs have the identical fetch-everything scaling
  concern and could be migrated the same way later if it becomes a problem.
- **Addresses are now versioned, not mutated** - editing a saved address
  (`PATCH /api/addresses/:id`) never rewrites the row: it sets the old
  row's `active: false` and inserts a brand new row with a new id, which is
  what the customer sees going forward and what any NEW order will
  reference. `DELETE` does the same (deactivate, never remove). This is
  what let `order.deliveryAddress` (a duplicated snapshot blob) become
  `order.addressId` (a real reference) - the address row itself now plays
  the "frozen at order time" role, so nothing is stored twice. Account
  deletion's address cleanup changed to match: an address a past order's
  `addressId` still points to is left alone (same reasoning as
  `customerName`/`customerPhone` surviving on old orders); anything else of
  that customer's, referenced by nothing, is removed outright.
- **Fixed the three flagged spots from the data-fabric write-up**:
  `favorites.json`'s polymorphic `ownerKey` string (`"customer:17"`) split
  into real `ownerType`/`ownerId` fields (`favoritesOwner()`/
  `favoritesMatch()` in server.js); `GET /api/orders` gained a `?couponId=`
  filter so "which orders used this code" is a live query instead of a
  stored reverse-index on the coupon (which would've just duplicated the
  relationship a second way) - wired into a clickable usedCount in Admin >
  Discounts; `DELETE /api/uploads/:id` now 409s with exactly what's still
  using it (`findUploadUsage()`, checks menu item photos + the three
  branding image fields + customIcons) unless `?force=true` is passed.
  Found in passing while touching uploads: the client's accepted-file-types
  list still allowed SVG after server.js dropped it for the stored-XSS fix
  earlier this session - a real client/server mismatch, fixed in both
  `uploads-logic.js` and the file-picker's `accept` attribute.
- **Fixed a real bug while wiring the delivery map**: this app's global
  `Referrer-Policy: no-referrer` (set for privacy on API responses) was
  ALSO suppressing the referer on the page's own resource loads, including
  Leaflet's OpenStreetMap tile requests - OSM's tile servers now reject
  referrer-less requests outright ("Access blocked" hazard-stripe page,
  not a CSP or network issue). Changed to `strict-origin-when-cross-origin`
  (the browser's own default) - sends the bare origin cross-origin, full
  URL same-origin, which satisfies OSM without leaking any path/query to
  third parties. Addresses also gained `landmark`/`pincode` as plain
  staff-facing reference text (not used for geocoding - no such API/vendor
  decision has been made) plus a "use my current location" button
  (`navigator.geolocation`, free, native) as the actual "narrow down the
  search" mechanism instead.
- **Order IDs migrated to plain incrementing integers** (`order.id`, was a
  random `SB-XXXXXX` string). `order.orderNumber` (the customer-facing bill
  number, `SB26090205`-style) is completely untouched - the two fields are,
  and always were, fully independent. `POST /api/orders` now generates
  `orderId` the same way users/stores/menu items already do
  (`Math.max(...orders.map(o=>o.id))+1`). A one-time migration script
  (`migrate_order_ids.js`, not checked in - ran once from the scratchpad)
  renumbered every existing order sorted by `createdAt` and rewrote
  `attachedToOrderId` pointers (the one real internal foreign key) through
  an old-id→new-id map; the real `data/orders.json` has a
  `data/orders.json.bak-pre-id-migration` sitting next to it as a safety net
  - safe to delete once you've confirmed everything looks right, not
    needed for the app to run.
  **Fixed as part of this** (every spot a `.dataset.*` DOM attribute - always
  a string - got compared against `order.id` with `===`, which would
  otherwise silently break the instant `id` became a number): Admin Order
  History's row-selection (`admin-portal.js`), My Orders' bill-preview/
  reorder buttons (`my-orders-modal.js`), checkout's attach-to-bill picker
  AND the `attachToOrderId` it sends server-side (`checkout-modal.js` +
  server.js), and **Billing's own bill-selection** (`billing-page.js` -
  found live during verification, not by the earlier static-code scoping
  pass, since it stores order ids under a generic `data-id`/`kind` pair
  rather than anything named `orderId`; masked in first-pass testing
  because Billing's auto-select-first-bill path happens to stay type-safe,
  it only broke once you actually clicked a specific bill row). Also fixed:
  backup/restore's collision-regeneration map
  (`reassignStoreScopedIds`/`idStyles`, server.js) used to hardcode
  `"orders.json": "SB-"`, now `"numeric"` - left as `"SB-"` it would have
  silently started minting old-format string ids again after any restore
  that hit a collision. Verified end-to-end after migrating the scratch
  copy's 62 orders: new order creation, every `PATCH`/settle-group/feedback/
  verify-payment route, Admin Order History selection, My Orders bill-
  preview + reorder, checkout attach-to-bill (search → pick → complete →
  confirmed `attachedToOrderId` linked correctly), and Billing's single-
  order AND merged-group detail views all confirmed working against real
  integer ids with zero new console errors.
- **Address editor: search + City/State fields** (`js/ui/address-modal.js`,
  requested to match a pasted Amazon/Myntra-style screenshot). Added
  `city`/`state` fields alongside the existing `landmark`/`pincode` (same
  pattern, both server routes + `address-logic.js`'s `add()`). New debounced
  search box queries `https://nominatim.openstreetmap.org/search` (OSM's
  free address-search endpoint - added to CSP `connect-src`; distinct from
  the tile-serving endpoint already allowed) and shows a mousedown-select
  dropdown (same pattern as Billing's item-search); picking a result
  auto-fills address/city/state/pincode AND moves the map pin - manual
  pin-drop and "use my location" both still work as fallbacks. This is a
  deliberate reversal of the earlier "manual pin-drop only, no geocoding
  API" decision - justified by the user's explicit ask for searchable
  address entry, kept within the "free OSM infra, no paid vendor" spirit of
  the original choice. Verified live: search → pick → fields + pin
  auto-fill → save → `GET /api/addresses` confirms city/state/pincode/
  lat/lng all persisted correctly.
- **New delivery order type**, end-to-end: a customer (never guest, never
  staff-placed) can now check out with `orderType: "delivery"`, which
  requires online payment, a saved address, and a store within 5km of that
  address. Address location on an OpenStreetMap map (Leaflet, vendored under
  `js/vendor/leaflet.js` + `css/vendor/leaflet.css` + `css/vendor/images/`,
  no CDN, since the CSP's `script-src` only allows `'self'` plus the two
  Razorpay domains) - originally manual-pin-drop-only, later extended (see
  "Address search" below) with free Nominatim text search as well; either
  way we only ever read `lat`/`lng` off the result, never a paid geocoding
  vendor.
  - **Data model**: `data/addresses.json` (`{id, customerId, label,
    addressText, landmark, city, state, pincode, lat, lng, isDefault,
    active, createdAt}`, customer-owned, capped at 10/customer). Addresses
    are **versioned, not mutated** (see "Address editing redesigned" below)
    - orders reference `addressId`, not a frozen snapshot, since a
    versioned address never goes stale. Stores' `operations` object (same place
    `tableCount`/`arcade`/`waitTime` already live) gained `delivery: {
    enabled, lockedBy, message: {preset, customText} }`.
  - **Server**: new `haversineKm()` distance helper (pure math, no
    dependency) and `sanitizeDelivery()` (enforces the lock - see below).
    New customer-only `/api/addresses` CRUD routes. `POST /api/orders`
    validates all of the above (role/payment-method/address-ownership/
    store-enabled/distance) BEFORE `computeOrder` runs, so a doomed
    delivery order never prices out a cart for nothing.
  - **Hierarchical enable/disable lock** (new pattern, nothing like it
    existed before this): a manager/Local Admin can toggle their own
    store's delivery on/off with a message (two presets - "too many
    orders, queue full" / "no delivery partner available" - or custom
    text) via the existing Operations edit modal
    (`renderStoreSettingsPanel`, admin-portal.js). A Global Admin can force
    it off and **lock** it via a new "FORCE DISABLE & LOCK" button on the
    cross-store Operations summary (`renderOperations`, Global-Admin-only
    tab) - while locked, the store's own toggle is rejected **server-side**
    (not just hidden client-side), and only a Global Admin can clear the
    lock; clearing it does NOT auto-re-enable delivery, that's a separate
    subsequent action. Verified live: manager toggle works, Global Admin
    lock blocks the manager's own PATCH attempt outright, unlock restores
    the manager's control.
  - **Client**: cart panel gained a third order-type button ("Delivery",
    customer-role + store-delivery-enabled only, never shown to
    guests/staff at all); checkout modal shows an address picker and hides
    "PAY CASH" entirely when delivery is selected (previously both payment
    buttons were always shown to every customer with no gating concept at
    all); a new home-page scrolling ticker
    (`renderHomeDeliveryTicker()`/`.home-delivery-ticker` in theme.css - a
    brand new UI element, no prior marquee/ticker precedent existed
    anywhere in the app) shows the store's message whenever delivery is
    disabled, refreshing on page-show and on store switch. Checkout also
    now blocks (and opens the store picker) if a multi-store deployment's
    customer/guest tries to check out with no store picked at all -
    previously that order landed with `storeId: null`, which the server's
    "unscoped orders stay visible everywhere" fallback then showed (and
    counted toward the active-orders badge) at EVERY store's board, not
    just the one the customer meant - this was the actual "interstore
    order counting" bug.
- **Multi-store staff switcher** for Orders/Kitchen and Billing: an owner/
  unrestricted-Global-Admin/multi-store-Local-Admin now gets a store
  picker on both pages (`ensureKitchenStoreSwitcher()` app.js /
  `buildStoreSwitcherHtml()` billing-page.js), sharing one value
  (`StoreSystem.getStaffSelectedStoreId()`/`setStaffSelectedStoreId()`,
  store-logic.js - a separate localStorage key from the customer-facing
  store picker) so picking a store on either page carries to the other.
  Picking a specific store does a **strict** id match server-side
  (`GET /api/orders`'s existing `?storeId=` drill-down), which is what
  actually fixes "interstore" counting - the default unscoped view
  intentionally still shows storeId-less orders everywhere, which is
  correct for a single-store shop but was the root cause of the counting
  bug in a multi-store one. `GET /api/table-sessions` gained the same
  `?storeId=` param to match. **Known quirk, not fixed**: this and the
  rail/topbar layout choice are both plain `localStorage`, not tied to the
  logged-in account, so switching accounts on the same browser inherits
  the previous account's store filter - not a security issue (server-side
  scoping still applies regardless), just a UX surprise worth deciding on
  later (namespace per-account? clear on logout?).
- **Kitchen board ticket-grid overflow, actually root-caused**: an earlier
  session's Explore-agent code read concluded the grid CSS was already
  correct and couldn't reproduce the reported horizontal-overflow bug -
  wrong conclusion, because the bug is a RUNTIME override, not a CSS issue.
  `window.filterKitchen()` (app.js) was setting `kitchen-orders-root`'s
  inline `style.display = "flex"` on every station switch, clobbering the
  CSS grid rule that actually wraps tickets into rows. Fixed by clearing
  the inline override (`""`, deferring to the stylesheet) instead of
  hardcoding `"flex"`. **Lesson for next time**: a "the CSS already looks
  right" conclusion from reading source alone doesn't rule out a runtime
  inline-style override elsewhere - check computed style / take a live
  screenshot before trusting a static read on a visual bug report.
- **Orders nav badge refresh bug**: marking an order done/served called
  `renderKitchen()` immediately but never updated the staff rail's "Orders"
  badge - it only got a fresh count later, whenever the SSE broadcast
  round-tripped back to that same tab. Added `refreshOrdersBadge()` called
  right after both actions. Separately: if the badge shows a nonzero count
  when you expect zero, that's not necessarily a bug - it counts EVERY
  not-fully-done order regardless of date, so a stray old order the
  kitchen never closed out keeps counting forever. Admin Order History's
  detail view now has a **MARK AS DONE** button (forces every line Done via
  `station: "MASTER"`) for exactly this - an escape hatch, not a substitute
  for the real per-station workflow. Also added: the Razorpay payment ID
  (already being stored on successful verification, but never shown
  anywhere) now displays in that same detail view for staff reconciliation.
- **Date range filters** added to both Admin Order History and the Kitchen
  HISTORY/SHOW ALL views (From/To, inclusive, either side alone is an
  open-ended range, both set to the same day filters just that day) - the
  Kitchen page's date inputs are injected dynamically and hidden entirely
  for the ACTIVE filter (a date range doesn't mean anything for "right
  now"). Pagination labels across every paginated view (menu items, kitchen
  tickets, billing, admin order history) now bold+accent-color just the
  numeric range (`1-10`), leaving "of N" muted - was one uniform style
  before. Admin Order History's selected-row highlight was a per-`<td>`
  `border-left`, which under `border-collapse:collapse` drew a vertical
  accent line at the LEFT edge of every cell (an odd-looking divider
  between every column, not an outline around the row) - fixed to
  top/bottom on every cell + left/right only on the first/last cell, so it
  reads as one clean box around the row.
- **Fake-order / impersonation prevention, Tier 0**: `POST /api/orders`
  used to accept `body.phone` over `session.phone` for ANY role, meaning a
  logged-in customer (or an active guest session) could put a stranger's
  real phone number on their own order. Fixed: a customer/guest's own
  order always uses their own session's phone now, never a client-supplied
  override; only staff (taking a counter order on someone's behalf) can
  still type an arbitrary phone. The remaining half of this problem - guest
  login/forgot-password treating "knows the phone number" as full identity
  proof - needs SMS OTP and is tracked in "Not yet done" below (infra/cost
  decision, not started).
- **Security + privacy pass**: ran a full security audit and a follow-up
  customer-data-privacy audit (both via background agents), then fixed the
  concrete findings live-verified on the scratch server:
  - Removed SVG from allowed image uploads (`UPLOAD_MIME_EXT`, server.js) —
    stored-XSS vector, since an uploaded SVG can carry `<script>`/event-
    handler payloads that fire if a browser ever opens the file's URL
    directly.
  - `getClientIp()` now trusts `X-Forwarded-For` — without this, every
    request behind the Cloudflare tunnel looked like the same IP, making
    the existing login rate-limiting (`checkRateLimit`) a no-op in the
    actual deployed configuration.
  - Added missing store-scoping (`accessibleStoreIds`) checks to
    `PATCH /api/orders/:id`, `POST /api/orders/:id/settle-group`, all four
    single-table-session routes, and `GET /api/admin/customers/:id` — all
    previously let a store-scoped manager/Local Admin act on or view
    another store's orders/tables/customer history.
  - Secure-cookie flag and HSTS now auto-detect via `X-Forwarded-Proto`
    (`setSessionCookie`, main dispatcher) instead of only the
    `FORCE_SECURE_COOKIE` env var, which is easy to forget behind a tunnel.
  - **Self-service account deletion** (`POST /api/account/delete`,
    customer-only, re-enter password): scrubs name/phone/password hash,
    clears favorites, kills sessions — but **never touches orders**, since
    orders already freeze their own name/phone snapshot at checkout time
    (`computeOrder`). Also reaches the arcade leaderboard now (scores
    gained a `customerId` field at submission time so deletion can find
    and anonymize a player's name there too — `ARCADE_SCORES_FILE`).
    Deletion is sticky across a whole-instance restore
    (`POST /api/admin/restore`): restoring an OLDER backup that predates
    someone's deletion re-scrubs that account/those scores immediately
    rather than quietly resurrecting them — verified live by restoring a
    synthetic pre-deletion backup and confirming re-scrub.
  - UI entry point: Account Settings modal (customer role only) has a
    collapsed "Delete my account" section, two-click arm/confirm, password
    required.
  - **Flagged, not fixed** (needs a decision, not code): `data/*.json`
    (real customer/staff PII, password hashes) is git-tracked with **no
    `.gitignore` anywhere in the repo** — confirmed real data already
    committed, not just a theoretical risk. Fixing the historical exposure
    means rewriting git history (destructive, needs explicit sign-off) —
    don't do this without being asked. Also unfixed: guest login/forgot-
    password treat "knows the phone number" as full proof of identity (see
    the new SMS OTP "Not yet done" item below) — anyone who knows a
    customer's number gets read access to their order history or can reset
    their password.
- **Fake-order / impersonation prevention, Tier 0**: `POST /api/orders`
  used to accept `body.phone` over `session.phone` for ANY role, meaning a
  logged-in customer (or an active guest session) could put a stranger's
  real phone number on their own order — that number then becomes "the
  customer" staff call back, who never placed the order and never
  consented. Fixed: a customer/guest's own order always uses their own
  session's phone now, never a client-supplied override; only staff
  (`KITCHEN_ROLES`, taking a counter order on someone's behalf) can still
  type an arbitrary phone. See the new SMS OTP "Not yet done" item for the
  remaining (infra-blocked) half of this problem.
- **Multi-store staff switcher for Orders + Billing**: a multi-store
  account (owner, unrestricted/Global Admin, or a Local Admin whose
  `storeAccess` spans more than one store) now gets a store picker on both
  the Orders/Kitchen page (`ensureKitchenStoreSwitcher()`, app.js) and
  Billing (`buildStoreSwitcherHtml()`, billing-page.js) — picking one
  narrows both pages to just that store (shared via
  `StoreSystem.getStaffSelectedStoreId()`/`setStaffSelectedStoreId()`,
  store-logic.js, a separate localStorage key from the customer-facing
  store picker). A single-store manager/employee never sees it. Selecting
  a specific store also fixes "interstore" counting: `GET /api/orders`'s
  existing `?storeId=` drill-down does a **strict** match
  (`o.storeId === requestedStoreId`), which excludes storeId-less orders
  that the "unscoped" default view intentionally still shows everywhere.
  `GET /api/table-sessions` gained the same `?storeId=` param to match.
  Also added: checkout now blocks (and opens the store picker) if a
  customer/guest tries to check out with no store picked at all in a
  multi-store deployment — previously that order landed with `storeId:
  null` and showed up (and counted toward the active-orders badge) at
  EVERY store's board, not just one.
- **Kitchen board ticket-grid overflow, actually root-caused**: an earlier
  session's Explore-agent code read concluded the grid CSS was already
  correct and couldn't reproduce the reported horizontal-overflow bug —
  wrong conclusion, because the bug is a RUNTIME override, not a CSS issue.
  `window.filterKitchen()` (app.js) was setting `kitchen-orders-root`'s
  inline `style.display = "flex"` on every station switch, which clobbers
  the CSS grid rule that actually wraps tickets into rows
  (`#kitchen-orders-root { display: grid; ... }` in theme.css) with a
  non-wrapping flex row instead. Fixed by clearing the inline override
  (`""`, deferring to the stylesheet) instead of hardcoding `"flex"`.
  Confirmed fixed for BARISTA/KITCHEN/DESSERTS/ALL STATIONS, both in
  ACTIVE and HISTORY views. **Lesson for next time**: a "the CSS already
  looks right" conclusion from reading source alone doesn't rule out a
  runtime inline-style override elsewhere — check computed style / take a
  live screenshot before trusting a static read on a visual bug report.
- **Orders nav badge (staff rail) refresh bug**: marking an order
  done/served (`window.markCompleted`/`window.markServed`, app.js) called
  `renderKitchen()` immediately but never updated the "Orders" nav badge —
  it only got a fresh count later, whenever the SSE broadcast
  (`ensureOrdersStream`) round-tripped back to that same tab. Added a
  `refreshOrdersBadge()` helper called right after both actions so the
  badge updates instantly instead of depending on that echo. (Separately:
  if the badge shows a nonzero count when you expect zero, that's not
  necessarily a bug — it counts EVERY not-fully-done order regardless of
  date, so a stray old order the kitchen never closed out will keep
  counting forever. Admin Order History's detail view now has a **MARK AS
  DONE** button for exactly this — see next bullet.)
- **Admin Order History detail additions**: a **MARK AS DONE** button
  (only shown for an incomplete order) force-completes every line via the
  existing `markDone` action with `station: "MASTER"` — an escape hatch
  for a stray order the kitchen forgot to close out, not a substitute for
  the real per-station workflow. Also now shows the **Razorpay payment
  ID** (`order.razorpayPaymentId`) when present — that field was already
  being stored on successful payment verification but was never surfaced
  anywhere in the UI, so staff had no way to actually use it for
  reconciliation. (Not added to Billing's bill-detail view — Billing only
  ever lists still-unpaid bills, so a settled Razorpay order isn't
  reachable there in the first place.)
- **Setup wizard fixed**: `PATCH /api/config` is deliberately Global-Admin-
  only (owner is read-only there by design — see the franchise-governance
  model below), but the wizard had no error handling around its save call,
  so a rejected save (e.g. an owner session hitting that same 403) just
  silently hung with no error shown and no advance to the next step. Fixed
  the unhandled-rejection bug (`saveStep()` now surfaces the real error in
  `#sw-error`), gated the wizard's entry point to Global Admin only on
  BOTH the Dashboard and a new entry in Store Setup > Locations (owner no
  longer sees either), and added a close/cancel button to every step (was
  previously only on the final "Done" step).
- **Attach a new order to an existing bill** (was in "Not yet done", now
  built): two ways to keep a customer's new order counting toward a bill
  they already have.
  - **Same table, still occupied**: `POST /api/table-sessions/:id/settle-
    round` marks the table's currently-unpaid orders paid WITHOUT closing
    the session (unlike `/close`, which always ends it) — the table stays
    open for more rounds. `computeTableSessionBill` now returns
    `dueTotal`/`settledTotal`/`dueOrderCount` alongside the existing
    combined `total`, so the UI can show "Already Settled" vs "Due Now"
    instead of one number. `table-modal.js` gained a "SETTLE ROUND (KEEP
    TABLE OPEN)" button with an inline payment-method picker (reuses
    `PAYMENT_METHODS`, now exported from `billing-page.js`). Also fixed
    `/close`'s `markPaid` branch, which used to overwrite EVERY order's
    `paymentMethod` unconditionally — now only touches still-unpaid ones,
    so an earlier round's real payment method survives a later close.
  - **Staff picks manually**: new `attachedToOrderId` field on order
    records (parallel to `tableSessionId`, mutually exclusive with it) +
    `GET /api/orders/search` (typeahead by order #/phone/table, root bills
    only — no attach chains) + `POST /api/orders/:id/settle-group` (settles
    a root and everything attached to it in one payment). Wired into
    `checkout-modal.js` (a new "ATTACH TO EXISTING BILL" search picker) and
    `billing-page.js` (a "+ NEW ORDER FOR THIS BILL" shortcut that stores
    `KitchenSystem.pendingAttachTarget` and jumps to the menu — the mirror
    image of the existing `selectBillForOrder()`, which does the reverse).
    **Important constraint driving this whole design**: `editItems`
    hardcodes `isDone:false` on every line `computeOrder` builds, so
    mutating an EXISTING order's items to "attach" more would silently
    un-prepare anything the kitchen already marked done. Attaching is
    therefore always a NEW, fully independent order (own KOT, own
    `isDone`/`servedAt`) linked by a pointer — never edit an existing
    order's `items` to attach something to it. `billing-page.js`'s bill
    detail renders a merged view when a root has attachments
    (`computeOrderGroupBill`, same shape as the table-session merge), with
    per-line edits routed to the correct underlying order via each line's
    `orderId` tag (same pattern `table-modal.js`'s `editLine()` already
    used for table bills).
  - Real bugs found only by testing live, not by reading the code: a root
    order that's personally paid but has an unpaid attachment didn't show
    up in Billing's Open Bills list at all (the filter checked the root's
    own `isPaid`, not the group's) — fixed. The search endpoint's
    `hasAttachments` flag was computed against an already-filtered
    roots-only array, so it always read `false` — fixed to check the full
    order list. A table bill in Billing (which has never supported item
    editing) crashed on a null `order` reference once the item-row
    edit-check was generalized for groups — fixed by guarding `order`
    before touching `.isPaid`.
- **App-wide blurry/tiny text, fixed everywhere**: a test user reported the
  customize modal looked blurry. Root cause, and it was systemic: font
  sizes across the ENTIRE app were set in `pt` (423 instances, 34 files) —
  `pt` converts to `px` at a 4:3 ratio, so `7pt`/`8pt` land on fractional
  pixels (`9.33px`/`10.67px`), which forces the browser into sub-pixel
  anti-aliasing — reads as soft/blurry, especially under non-integer OS
  display scaling (125%/150%, common on Windows). Swept every `pt` value to
  the nearest whole pixel, rounding UP (`Math.ceil(pt * 4/3)`) so nothing
  ever got smaller, only crisper. Found the identical bug expressed two
  other ways while verifying and fixed those too: fractional `rem` (e.g.
  `0.85rem` = `13.6px` at the default 16px root) and hand-picked
  half-pixel `px` literals (`9.5px`, `10.5px`, ...) already in the
  codebase — same rendering defect, different unit. **Zero fractional
  font-sizes remain anywhere in the app** (verified by grep across every
  unit) — if you ever add a new inline `font-size`, use a whole `px` value,
  never `pt`, and check any new `rem`/`em` value against the 16px root
  before assuming it's clean.
- **Wait-time estimates**: `computeWaitTimeMins(cartItems, storeId)` in
  server.js — sums the live backlog (every not-done BARISTA/KITCHEN line
  across every non-served order) plus the prospective cart's own drink
  lines, divides by `PARALLEL_DRINK_SLOTS` (2, since two drinks can be
  worked in parallel), floors at the store's configured minimum, and adds
  a flat `PRE_READY_FLAT_MINS` (1 min) if the order has any dessert/
  pre-ready item (never per-unit, never using the dessert's own prep time).
  Menu items gained a `prepTimeMins` field (admin-editable in item-modal.js,
  frozen onto order lines the same way `basePrice` already was). Exposed
  via `GET`/`POST /api/wait-time` (store-scoped the same way `/api/menu`
  is). Shown on the Home page fact strip and in the post-checkout
  confirmation — explicitly NOT on the Menu page (removed after the user
  asked for it back off, keep it that way unless told otherwise). Per-store
  enable/minimum-wait toggle lives in Admin > Store Setup > Operations.
- **Bill preview on click**: clicking an order/bill number in My Orders now
  opens `window.showBillPreview(order)` — the exact same receipt markup
  `window.printBill()` sends to the printer (both now share
  `billReceiptBodyHtml()` in app.js), just shown on-screen with PRINT/CLOSE
  buttons instead of immediately opening a print dialog. If you add another
  "show me the bill" entry point (e.g. Order History), reuse this function
  rather than re-deriving the receipt layout.
- **Billing page "+ ADD ITEM" is collapsed by default**: starts as a single
  right-aligned button; clicking it expands into a typeable search field
  (filters the live menu by name as you type, dropdown of matches) + qty +
  Add/Cancel — replacing an always-visible `<select>` dropdown. Search
  selection uses a `mousedown` handler (not `click`) so it fires before the
  input's `blur` closes the dropdown out from under it.
- **Menu category/diet-filter sticky-header bug** (real, easy to
  reintroduce): switching category or the ALL/VEG/NON-VEG filter used to
  call `scrollIntoView()` on `#menu-root` to reset scroll position — but
  `#menu-root` sits directly below a `position:sticky` header, so aligning
  its top edge to the viewport top puts it exactly where the sticky header
  then pins itself, hiding the section heading and first row of items
  behind that opaque bar (looked like "items disappeared" / "filters are
  clipping"). Fixed with a plain `window.scrollTo({top:0})` instead — if
  you ever need to scroll the menu column to a specific spot again, do NOT
  use `scrollIntoView` on anything that sits adjacent to the sticky header.
- **Veg/non-veg diet icons**: rewritten from `position:absolute` +
  `translate(-50%,-50%)` centering (which let the non-veg triangle's
  border-generated shape overflow past its own bordered square and land
  visibly off-center) to flexbox centering (`.diet-icon` in theme.css). If
  you touch `dietIconHtml()` in app.js again, keep the flexbox approach —
  the absolute-position version reappearing is a regression, not a style
  choice.
- **Merged `pos-redesign-mobile` into `main`** (38 conflicts across 10
  files, mostly this branch's newer work landing on an older `main`) —
  see "Working across worktrees" above for the general lesson. `main` is
  now current with everything through this session.
- **Pagination** (Menu Items per-section + Order History) is right-aligned
  (`justify-content:flex-end`) — was left-aligned, changed on explicit
  screenshot feedback. Icon-only style (`« ‹ range › »`), no boxed/bordered
  buttons — don't reintroduce boxes.
- **Admin panel text branding**: Branding tab has an "ADMIN PANEL TEXT"
  section with three font-size+color pairs, all admin-only (never shown to
  customers):
  - `adminTabs` → `.admin-tab-btn` (the Dashboard/Menu Items/... row)
  - `adminHelp` → `.admin-help-text` (muted description/instruction
    paragraphs — NOT inline data like tags/timestamps/amounts, which stay
    on plain `--color-text-muted`)
  - `adminLabels` → `.control-group label` / `.admin-field-label` (form
    field labels like ACCENT COLOR, STAFF, DATE)
  Config shape: `config.textStyles = { adminTabs: {fontSize,color},
  adminHelp: {...}, adminLabels: {...} }`. Server-side: `DEFAULT_BRANDING.
  textStyles`, merged/clamped (fontSize 5–24) in `PATCH /api/config`, reset
  alongside colors in `POST /api/config/reset-branding`. Client:
  `window.applyBranding()` sets the 6 CSS vars live, no reload needed.
- **Grouped admin tabs**: sub-nav is now clustered into OVERVIEW / MENU /
  SALES / STAFF / STORE SETUP (see `tabGroupsForRole()` in
  admin-portal.js), each with a small uppercase label above its buttons.
  STORE SETUP (Global Settings + Branding) disappears entirely for a
  manager role. Scoped to `#admin-tabs` only — the flat kitchen station
  tabs (`.kitchen-tabs.admin-tabs`) reuse the button styling but are NOT
  grouped, don't accidentally group those too.
- **Combo add button**: now shows the identical `- qty +` stepper as
  regular items' ADD BIT once one is in the cart (was previously "ADD
  COMBO (N in cart)" as a static label). Added `window.comboRemove()`
  mirroring `window.quickRemove()`.
- **Nav-account (LOGIN/OWNER button)**: right-aligned via
  `margin-left:auto` on `#nav-account`, on both desktop and mobile (removed
  a mobile media-query override that had been cancelling it).
- **Admin wrapper boxed-panel look removed**: `.config-controls` no longer
  has a background tint + left accent border (was a leftover "cyan left
  border" look) — Global Settings/Discounts/Branding now sit flush like
  every other admin tab.
- **Menu Items "SHOW INACTIVE" toggle**: checkbox in the admin toolbar
  (`this.showDeletedMenuItems`, default OFF). OFF = soft-deleted items are
  excluded entirely (don't count toward pagination). ON = shown, but
  active items always sort before deleted ones within a section (deleted
  items land on the last page(s), never interleaved).
- **Checkout modal item rows rewritten** (`cartRowHtml()` in
  checkout-modal.js): line 1 is `name @unit price`; line 2 is
  `TOTAL  [CUSTOMIZED tag]` on the left and the qty stepper right-aligned +
  vertically centered on the same line (was stacked below before).
  Clicking "CUSTOMIZED" expands a breakdown showing each customization
  with its own price contribution (e.g. "Large  +₹40.00", "Oat Milk
  +₹30.00") — powered by `CustomizationSystem.describeLineWithAmounts()`,
  which needs `sizePriceDelta`/`milkPriceDelta` stored on the cart line at
  `addCartLine()` time (added this session — previously only labels were
  stored, not the per-option price deltas).
- **Fixed a real cross-cutting bug**: `.cart-row` and `.calc-row` shared
  one CSS rule (`display:flex; justify-content:space-between`). `.cart-row`
  is used for multi-line stacked content (name / total+stepper / optional
  breakdown) in BOTH the checkout modal and the My Orders modal, so forcing
  flex-row on it squished those stacked children sideways instead of
  stacking them. Split into two separate rules — `.cart-row` is now plain
  block, `.calc-row` (genuine single-level label+value rows like SUBTOTAL/
  CGST/SGST) keeps the flex behavior.
- **Fixed the "ginger tip checkbox flashes the screen" bug**:
  `window.toggleTip()` and `window.removeServiceCharge()` used to
  `closeModal()` (removes the overlay) then re-trigger the cart bar's
  click handler, which itself `await`s `refreshSession()` before
  re-rendering — that gap was long enough for the browser to paint the
  no-overlay frame, causing a visible flash. Both now call
  `renderCheckoutModal(...)` directly (single remove-then-insert, no async
  gap) instead.
- **Added `Cache-Control: no-cache` to static file serving** (`serveStatic`
  in server.js) — there were no cache headers at all before, which could
  let a browser hold onto a stale `theme.css` after a redeploy while
  `app.js`/`index.html` updated, looking like a real layout bug. If you
  ever see "the JS behaves like the new version but the CSS looks like the
  old version" after shipping a change, tell the user to hard-refresh
  once; this header should prevent it going forward.
- **Investigated but did NOT change**: an empty blue-bordered box reported
  above the username/current-password field in the Login and Account
  Settings modals. Confirmed via a clean Playwright screenshot (no saved
  credentials) that our own DOM/CSS renders no such element — our
  `:focus-visible` ring is orange (`--color-accent`), not blue. This is
  almost certainly the browser's own saved-password autofill suggestion
  UI, not part of the page. Don't "fix" this by setting
  `autocomplete="off"` without the user explicitly asking for that
  trade-off — it would hurt normal password-manager usability.

## Explicitly rejected / do not reintroduce

- Mutating an address record in place on `PATCH /api/addresses/:id`, or
  hard-deleting one on `DELETE`. Orders reference an address by id
  (`order.addressId`) instead of snapshotting its fields - editing/deleting
  in place would silently rewrite what a past delivery order shows it went
  to. Always deactivate the old row (`active: false`) and insert a new one.
- Generating `order.id` as a random string (`SB-XXXXXX`, `crypto.randomBytes`)
  — migrated to a plain incrementing integer this session (see "Recent
  work"). Don't revert to a random string id; if you touch order creation,
  keep the `Math.max(...orders.map(o=>o.id))+1` pattern that matches every
  other entity in this app. `order.orderNumber` (the customer-facing
  `SB26090205`-style bill number) is the unrelated field that's actually
  meant to look like that — never confuse the two.
- Native `prompt()`/`confirm()` for anything staff-facing (table open/
  edit, table close) — always themed modals matching the terminal/
  monospace UI.
- Overwriting the displayed pre-discount "TOTAL CACHE" — it must always
  show the original price; a discount adds a separate "YOU PAY" line
  below, never replaces the total.
- Boxed/bordered pagination buttons — icon-only, and now right-aligned
  (not left-aligned — that was an explicit change this session).
- Wait-time estimate shown on the Menu page — explicitly asked to be
  removed; still fine on the Home page and post-checkout confirmation.
- `scrollIntoView()` targeting `#menu-root` (or anything else adjacent to
  the sticky menu header) to reset scroll position — use
  `window.scrollTo({top:0})` instead; see "Recent work" above for why.
- Hardcoding `kitchen-orders-root`'s inline `style.display` to `"flex"` in
  `window.filterKitchen()` (app.js) — this element's real layout is the CSS
  grid in theme.css that wraps tickets into rows; an inline "flex" silently
  overrides it with a non-wrapping row, which is exactly the horizontal-
  overflow bug this session root-caused and fixed. Use `""` (clear the
  inline override, defer to the stylesheet) to show it, `"none"` to hide it
  — never a hardcoded display value other than `"none"`.
- A customer/guest's own order (`POST /api/orders`) trusting a client-
  supplied `body.phone` over their own `session.phone` — that's the exact
  impersonation hole this session's Tier 0 fix closed. Only a staff session
  taking a counter order on someone else's behalf should ever set a phone
  the way body.phone allows.
- A plain `<select>` dropdown for Billing's add-item picker, or an
  always-visible (non-collapsed) add-item row — now a collapsed button
  that expands into a typeable search field on click.
- `pt` units (or an unchecked `rem`/`em`/half-pixel `px` value) for any
  inline `font-size` — causes the fractional-pixel blur bug described in
  "Recent work" above. Always use a whole `px` value.
- Mutating an existing order's `items` array to "attach" more to it (e.g.
  reusing `editItems` on an order the kitchen already touched) — resets
  every line's `isDone` back to pending, including ones already prepared.
  A staff-attached follow-up is always a NEW order linked by
  `attachedToOrderId`, never an edit to the original.
- Preference instructions that would suppress honest bug-flagging or
  verification — none currently on file, but if the user ever asks you to
  stop double-checking your work or stop mentioning problems you notice,
  that's out of scope to actually adopt.

## Not yet done

- **Database migration off JSON files.** Discussed with the user (SQLite
  recommended as the lowest-friction next step given the single-process
  setup; Supabase/Neon Postgres as the alternative if remote/multi-device
  access is ever needed) — no decision made, no code started. User said to
  hold off for now; don't start this without them asking again.
- **SMS OTP verification** at customer registration and guest-checkout
  entry (`POST /api/auth/guest`). Root problem: today, "knows a phone
  number" is treated as full proof of ownership everywhere a phone is
  entered — guest login, forgot-password, and (before this session's Tier 0
  fix) even a logged-in customer's own order. Real fix needs a third-party
  SMS gateway (Twilio/MSG91/Fast2SMS/etc.), which is a cost + vendor
  decision the user hasn't made yet — this app has zero npm dependencies by
  design, so adding one is itself a small decision. Related, already fixed
  this session: a customer/guest can no longer put a phone number other
  than their own session's on their own order (`POST /api/orders`,
  server.js) — that was the cheap, no-infra half of the fix; OTP is the
  remaining half that actually verifies phone *ownership* at signup/guest
  entry, not just consistency at order time.
- **Bank POS / card-reader integration for Billing.** Goal: selecting
  "Card" as a payment method should actually drive a physical card-reader/
  EDC device instead of just recording "Card" as a label with no real
  transaction behind it (unlike Razorpay, which already has a real
  verify-payment flow — see `razorpayPaymentId`/`verify-payment` in
  server.js as the pattern to mirror). **Blocked on a vendor/bank decision
  before any code can be written** — there is no generic "bank POS" API;
  Pine Labs, Razorpay POS, Ezetap, PayTM, and individual banks' own EDC
  machines each have their own SDK/webhook shape, usually paired over LAN
  to the till device or confirmed via a cloud webhook. Once a vendor is
  picked, the shape to build is the same one Razorpay already uses: a
  `cardTransactionId`-style field on the order, an API call to the vendor
  to initiate a charge for the order's exact total, then a webhook/polling
  confirmation route (mirroring `POST /api/orders/:id/verify-payment`)
  that flips `isPaid` only after a real confirmed charge — never on the
  client's say-so, same principle the Razorpay integration already
  enforces.
(The list/grid view toggle theming complaint, all 4 previously-tracked
"Pending features" — order numbering, item promo discounts, public/private
coupons, order-ready sound — "attach a new order to an existing bill", and
the "data fabric" entity-relationship write-up are all done now; see
server.js/app.js for `generateOrderNumber`, `promoDiscount`, coupon
`.private`, `SoundSystem.playReadyChime()`/`NotificationSystem.notifyOrderReady()`,
`attachedToOrderId`/`computeOrderGroupBill`, and the published "The Ledger"
artifact respectively. Don't re-plan these from scratch if asked about them
again — check the code first.)

## User preferences (carry forward)

- Wants concise replies — minimize token spend, avoid restating context
  back at them.
- Wants every fix actually verified (curl for backend logic, Playwright
  for UI), not just claimed. Don't say something works without having
  tested it.
- Reviews screenshots closely and catches real bugs from them — take
  screenshot feedback literally and precisely, and look for the general
  pattern behind a specific circled example rather than just patching the
  one instance (e.g. the muted-label fix ended up covering 7+ inline
  occurrences plus a shared CSS rule, not just the one field circled).
- Only write/update a handoff doc when explicitly asked, not proactively.
