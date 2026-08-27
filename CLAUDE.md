# Seven Bits Coffee — Claude Code Handoff

This project was built and iterated on in claude.ai chat across several
sessions. This file exists so Claude Code doesn't need that history
re-explained — read it before making changes.

## Architecture

- `server.js` — entire backend, single file (~2600 lines). No framework;
  hand-rolled `route(method, regex, handler)` router + raw `http` module.
  Search for: `computeOrder` (pricing engine), `COUPONS_FILE`/
  `findValidCoupon` (coupons), `TABLE_SESSIONS_FILE`/
  `computeTableSessionBill` (postpaid tabs), `loyalty` (config key),
  `DEFAULT_BRANDING`/`textStyles` (admin panel text branding).
- `js/app.js` — main frontend controller: cart, menu rendering, checkout
  orchestration, kitchen ticket rendering, table panel, `applyBranding()`
  (sets CSS custom properties from server config on boot + after saving
  Branding).
- `js/ui/*.js` — one file per modal/portal (checkout-modal, admin-portal,
  customize-modal, table-modal, login-modal, account-settings-modal,
  my-orders-modal, combo-modal, item-modal, staff-modal, info-modal).
- `js/features/*.js` — pure logic modules consumed by the UI layer
  (cart-logic, config-logic, auth-logic, customization-logic,
  table-sessions-logic, payroll-logic, favorites-logic,
  password-strength).
- `css/theme.css` — the only stylesheet (~1390 lines), plus `iconsvg.css`
  and `cat.css` for icons/the walking-cat easter egg.
- Data persists to `data/*.json` on disk (gitignored/excluded from
  delivery zips) — always `rm -rf data` before a fresh test run so you're
  not testing against stale state from a previous session.

The app is a single-page app: `index.html` has one `<div class="page">`
per route (`page-home`, `page-menu`, `page-kitchen`, `page-admin`), toggled
by `window.showPage(pageId)` in app.js. There is no `admin.html` — the
admin panel is `page-admin`, navigated to via `window.showPage('admin')`.

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

- Native `prompt()`/`confirm()` for anything staff-facing (table open/
  edit, table close) — always themed modals matching the terminal/
  monospace UI.
- Overwriting the displayed pre-discount "TOTAL CACHE" — it must always
  show the original price; a discount adds a separate "YOU PAY" line
  below, never replaces the total.
- Boxed/bordered pagination buttons — icon-only, and now right-aligned
  (not left-aligned — that was an explicit change this session).
- Preference instructions that would suppress honest bug-flagging or
  verification — none currently on file, but if the user ever asks you to
  stop double-checking your work or stop mentioning problems you notice,
  that's out of scope to actually adopt.

## Not yet done

- **List/grid view toggle buttons** (`.btn-view-toggle` in css/theme.css,
  the hamburger/grid icons next to the menu search bar): currently
  hardcoded to `#1a1a1a` background / `#333` border instead of theme CSS
  vars, and the SVG icons use `filter: invert(0.8)` on a white data-URI
  rather than pulling the accent/theme color directly. User flagged "why
  is it blue/cyan" and asked for it to follow the system theme — not yet
  diagnosed or fixed. Start here: `.btn-view-toggle`,
  `.btn-view-toggle span.icon`, `.icon-ui-list`, `.icon-ui-grid` in
  css/theme.css.

## Pending features (not started)

In priority order as originally given:

1. **Order numbering.** Add a proper internal primary key (sequential int)
   separate from a new customer/staff-facing display format:
   `#SBYYMMDD01` where the last 2 digits are a PER-DAY sequential counter
   (resets at midnight) — e.g. `SB26082401`, `SB26082402`. Currently
   `order.id` is `SB-${randomHex}` and is both the PK and the displayed
   number — these need to split. Must update: order creation (`POST
   /api/orders` in server.js), PATCH lookup route, table-session order
   filtering (`tableSessionId` on order, unaffected — keyed separately),
   ALL places the client displays an order id (payment confirmation
   screen, KOT, bill, on-screen kitchen ticket, Order History grid +
   detail pane, My Orders modal). Recommend: keep `id` as PK for internal
   joins, add `orderNumber` field, display `orderNumber` everywhere
   customer/staff currently see the old `id` string.

2. **Item-level promotional discounts, exclusive of coupons.**
   Admin/manager can put a specific menu item "on promotion" (e.g. 15% off
   a specific drink) without a coupon code — auto-applies when that item
   is in the cart. When any promo-discounted item is in the order, coupon
   code application must be BLOCKED (mutually exclusive). Loyalty points
   redemption was not mentioned as exclusive — only "coupon" — so likely
   loyalty can still stack; confirm with the user if unsure. Needs: menu
   item schema gets `promoDiscount: {type: 'percent'|'flat', value}`
   field (manager/owner editable, probably in the item edit modal),
   `computeOrder` in server.js applies it automatically per line item, and
   rejects/ignores a submitted `couponCode` if any cart item has an active
   promo.

3. **Public vs. private coupon codes.** Add `private: boolean` field to
   coupons (default false = public). Add a "SHOW CODES" button/link on
   checkout or the menu page that lists all ACTIVE, PUBLIC coupons with
   their code + discount, so a customer can self-serve. Private coupons
   never appear in this list. New public endpoint needed (no auth, or same
   level as `/api/coupons/validate`) — do NOT reuse the existing `GET
   /api/coupons` (manager-only, returns everything including private/
   inactive/exhausted ones).

4. **Sound notification when an order is ready.** Mentioned by the user as
   a previously-discussed item that isn't otherwise tracked here — treat
   as new/unscoped. Likely needs: a sound asset, a trigger point when an
   order's status flips to "ready" (check the SSE order-update stream
   already used for kitchen/dashboard live updates — `/api/orders/stream`
   in server.js, `ensureOrdersStream()` in app.js), and probably a
   customer-facing vs. staff-facing distinction (who should hear it, and
   whether it needs a mute/volume control). Scope and confirm exact
   trigger conditions with the user before building — not yet discussed
   in detail.

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
