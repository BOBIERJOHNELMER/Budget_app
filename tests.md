# Manual Test Checklist

## Required validation

- [ ] Launch the app for the first time and confirm the onboarding screen appears.
- [ ] Try submitting empty profile data and confirm name, age, and salary validation errors show.
- [ ] Enter age below 1 or above 120 and confirm rejection.
- [ ] Enter a negative salary and confirm rejection.

## Shop flow

- [ ] Add a product from the Shop screen with a valid photo, name, price, store, and type.
- [ ] Confirm Save is disabled until all required fields are valid.
- [ ] Attempt to add a duplicate name + store combination and confirm the warning message.
- [ ] Confirm product cards update the add-to-cart / quantity control correctly.
- [ ] Verify the Shop add-product floating button is square with its plus centered, red in light mode and purple in dark mode. Verify the Shop cart control uses a simple icon and its count fits without clipping.
- [ ] In dark mode, verify active/highlight/focus accents use purple rather than red.
- [ ] Long-press or tap the edit icon on a product and confirm edit/delete works with confirmation prompts.

## Insufficient balance

- [ ] Add products to the cart that exceed the current balance.
- [ ] Confirm the cart shows a red banner and the Checkout button is disabled.
- [ ] Confirm a warning modal says how much more is required and checkout is blocked.

## Successful checkout

- [ ] Add affordable items to the cart and confirm the checkout confirmation flow works.
- [ ] Verify salary balance decreases by the exact total in centavos.
- [ ] Confirm a transaction record is saved and the cart clears after checkout.
- [ ] Verify the app navigates back to Dashboard and shows the updated totals.

## Receipt download

- [ ] Complete a purchase and confirm the PDF receipt saves to a device storage location.
- [ ] Confirm the file opens with the system viewer when the open prompt is accepted.
- [ ] If PDF generation fails in a test environment, confirm the fallback `.txt` receipt still creates successfully.

## Revert refund accuracy

- [ ] Open Profile > Transaction Logs and expand a past transaction.
- [ ] Add enough transactions to overflow the logs area and verify the transaction list scrolls independently without making the entire Profile page excessively long.
- [ ] Tap Revert and confirm the modal text and total refund amount.
- [ ] Verify the exact stored total is added back to the salary balance and the entry is removed from logs.
- [ ] Tap Revert again on the same row and confirm it cannot be double-reverted.

## Scan flow

- [ ] Open the Scan page and choose Take Photo or Import from Gallery.
- [ ] Cancel the camera or gallery selection and confirm the app shows a friendly message instead of crashing.
- [ ] Enter a valid price, name, store, type, and quantity and add the item to the cart.
- [ ] Verify the scanned item is marked as Scanned and appears in the cart and transaction log.
- [ ] Confirm the scanned item is not added to the catalog unless the checkbox is enabled.

## Salary portions and manual spending

- [ ] Confirm Dashboard shows Emergency Funds, Savings, a User Spending button beside the salary balance, and a Create fund action.
- [ ] Confirm Move money opens a popup from a fund page and the popup can be cancelled without changing either balance.
- [ ] Confirm User Spending opens a popup from the salary balance card and cancelling does not change the balance.
- [ ] Move an amount from salary into Emergency Funds or Savings and confirm only the salary balance and fund balance change; monthly spending and transaction logs do not.
- [ ] Try moving more than the available salary balance and confirm the transfer is blocked.
- [ ] Record a reason and amount spent from a fund; confirm the fund decreases, salary does not, and the reason appears in Profile transaction logs.
- [ ] Revert a fund expense and confirm the amount returns to that fund, not the salary balance.
- [ ] Record User Spending with a reason and amount; confirm salary decreases and the transaction appears in Profile logs.
- [ ] Try recording more than the available balance and confirm it is blocked; revert a valid spending record and confirm salary is restored.
- [ ] Create a custom fund and confirm it can receive transfers, record spending, and retain its balance after restarting the app.
- [ ] Transfer money from a portion to the salary balance and to another portion; verify internal transfers appear in logs without increasing monthly spending totals.
- [ ] Remove a portion, confirm the prompt names the portion, then verify its balance returns to salary and it stays removed after restarting.

## Additional charges and AI budgeting

- [ ] Set additional charges in Shop Cart and Scan Cart; verify expected deduction, affordability checks, post-checkout balance, transaction log, and receipt include the charge.
- [ ] Complete checkout and verify the corresponding additional-charge input resets to zero rather than recurring.
- [ ] Open Profile > AI Budgeting Agent and confirm it remains unavailable until AI is configured and enabled.
- [ ] Run `npm run test:ai-proxy`; confirm health and provider status, fixed upstream routing with `nvidia/nemotron-3-ultra-550b-a55b:free`, unconfigured-provider handling, provider model-error reporting, malformed-request rejection, Cordova/HTTPS origin handling, optional proxy-token enforcement, and origin checks pass.
- [ ] Copy `.env.example` to `.env`, configure a rotated provider key, and start `npm run ai-proxy`; confirm the settings page reports provider availability without exposing the key.
- [ ] Open Profile > Settings > AI Privileges, verify the local password gate, choose a provider/model, enter an HTTPS proxy URL and optional proxy access token for a non-local device, and review the data-sharing consent before enabling. Saving model/provider settings must succeed when the proxy is offline; its status should report the connection issue without disabling the saved setting.
- [ ] Ask for a budget suggestion and confirm financial context is sent only after consent through the local proxy; verify provider keys are absent from browser requests and AI cannot change balances or budget until each action is explicitly approved.
- [ ] Verify the AI response appears above the prompt textbox. The data-sharing explanation is normal muted text at the bottom of the page, not a red warning banner. Use “Let AI agent budget your salary for you” and confirm a complete salary-portion and Shop-limit plan is shown for review; cancel it and confirm no balances or limits change, then approve a valid plan and confirm all transfers, transaction records, and the Shop limit update together.
- [ ] Confirm AI suggestions cannot transfer more than the current source balance or set an enabled Shop budget below the amount already spent.
- [ ] In AI privileges, verify the model dropdown is visually attached to the editable model textbox, its options expand in a scrollable list inside the dialog, choosing a listed model fills the textbox, and a custom model ID can be typed directly. Verify changing providers updates the dropdown options and audio-only, safeguard/prompt-guard, and reranking models are not offered.
- [ ] In Profile > Settings, verify Salary balance, Automatic monthly cash-in, and Markets each open their own popup without a password prompt; confirm salary updates are logged, cash-in settings persist, and markets in use by products cannot be removed.
- [ ] On each app launch, verify the wider welcome notification slides down above the app and disappears after 1.5 seconds; if salary is low, a wider red low-balance notification follows it and also disappears after 1.5 seconds. Changing routes must not show either notification again. Verify the dashboard balance card has AI Budgeting Agent and User Spending buttons and no Active badge or permanent welcome/name header.
- [ ] On the AI Budgeting Agent page, enter a prompt and get a response, then navigate to another page and return. Verify the prompt, response, and any review/apply action remain available for the current app session.
- [ ] Check Dashboard, Shop, Cart, Scan, Profile, and AI Budgeting Agent at 320px, 375px, 768px, and 1280px CSS viewport widths. Confirm no page-level horizontal overflow, narrow-screen summary cards resize without clipping, and the AI model dropdown stays about one quarter of its textbox group.
- [ ] Simulate rate-limit, provider timeout, provider outage, empty-response, and malformed-JSON errors; verify fallback time is shared so the other configured provider still gets attempts, the original request plus failure context is preserved, the final response identifies its provider/model, and balances remain unchanged until plan approval.
- [ ] Verify local browser development defaults to `http://127.0.0.1:8002`, while Android requires a shared HTTPS proxy URL; confirm proxy requests include the optional access token and the server rejects missing/invalid tokens when configured.
- [ ] Verify advice and full salary plans express user-facing amounts as Philippine pesos (₱ with two decimals), while proposed transfer and limit values match exact centavo arithmetic.

## Persistence

### Verification sequence (must pass in order)

- [ ] **Step 1 — Onboarding.** Launch the app for the first time (or after a full reset). Confirm the onboarding modal appears. Enter name, age, and a salary balance of ₱10,000. Submit. Confirm the dashboard shows ₱10,000.00.
- [ ] **Step 2 — Add product with photo.** Go to Shop, tap ＋, take or import a photo, fill in name/price/store/type, and save. Confirm the product card appears with the photo.
- [ ] **Step 3 — Checkout.** Add the new product to the cart and complete checkout. Confirm the balance drops by the product price and a transaction entry appears in Profile.
- [ ] **Step 4 — Restart.** Fully close and reopen the app (Android: swipe away from recents; browser: hard-refresh on the same fixed origin, e.g. `http://localhost:8000`). Confirm:
  - The balance is still reduced (not reset to ₱10,000).
  - The transaction log entry is still present.
  - The new product is still in the Shop catalog with its photo.
  - The cart is empty (was cleared by checkout).
- [ ] **Step 5 — Revert.** In Profile, expand the transaction and tap Revert. Confirm the balance is restored and the log entry is deleted.
- [ ] **Step 6 — Restart after revert.** Fully close and reopen again. Confirm:
  - The refunded balance persisted.
  - The transaction log entry is gone.
- [ ] **Step 7 — Debug panel.** Tap the version label (v1.0.0) in Profile five times. Confirm the persistence debug panel opens and shows: `schemaVersion`, `seeded: true`, record counts per store, and the last ≤5 write timestamps.
- [ ] **Step 8 — No re-seed.** Confirm that after any restart (including hard-refresh), the demo products (Rice, Banana, etc.) are NOT re-added if the user already has their own product list.
- [ ] **Step 9 — Private/incognito note (browser only).** Opening the app in a private/incognito window will show a fresh state because the browser isolates storage. This is expected. Always use a normal window with a fixed port (`cordova run browser --port=8000`).

### Root-cause regression checks

- [ ] Confirm `seedInitialData()` is never called when `loadState()` returns a non-null value (user or products exist).
- [ ] Confirm `persistState()` is NOT called unconditionally after `loadState()` returns existing data.
- [ ] Confirm `onupgradeneeded` only creates missing object stores and never clears or deletes existing ones.
- [ ] Confirm `state.stores` starts as `[]` at module load and is only populated by `loadState()` or `seedInitialData()`.
