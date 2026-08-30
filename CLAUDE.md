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
  `DEFAULT_STORE_OPERATIONS` (multi-store settings resolution).
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
  password-strength). Arcade games live under `js/features/arcade/*.js`
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
- A plain `<select>` dropdown for Billing's add-item picker, or an
  always-visible (non-collapsed) add-item row — now a collapsed button
  that expands into a typeable search field on click.
- Preference instructions that would suppress honest bug-flagging or
  verification — none currently on file, but if the user ever asks you to
  stop double-checking your work or stop mentioning problems you notice,
  that's out of scope to actually adopt.

## Not yet done

- **Raw-material inventory management.** Add/activate/deactivate raw
  materials, add inventory quantities, staff-updatable, visible only to
  staff/manager (not customers). An entirely new subsystem — not started.
- **Attach a new order to a previous/existing bill.** A customer who
  already settled a bill, then orders more and wants to sit back down,
  should be able to have the new order attached to the SAME bill instead
  of always opening a new one. Not started, not yet scoped in detail —
  confirm with the user exactly when this should trigger (any settled
  bill within some time window? same table? same phone?) before building.

(The list/grid view toggle theming complaint and all 4 previously-tracked
"Pending features" — order numbering, item promo discounts, public/private
coupons, order-ready sound — are done; see server.js/app.js for
`generateOrderNumber`, `promoDiscount`, coupon `.private`, and
`SoundSystem.playReadyChime()`/`NotificationSystem.notifyOrderReady()`
respectively. Don't re-plan these from scratch if asked about them again —
check the code first.)

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
