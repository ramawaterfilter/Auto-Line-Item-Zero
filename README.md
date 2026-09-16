# Auto Remove Line Item

A multi-store Shopify app for Cloudflare Workers. An authenticated merchant selects an inclusive date range; the app finds orders and sets these variant quantities to zero:

- `58780018377088`
- `58414723465600`

Every destructive edit is gated by a successful `BEFORE` Google Sheets write. A committed edit is persisted in D1 before the `AFTER` write, so reconciliation never repeats the Shopify mutation.

## Architecture

- Cloudflare Worker: embedded Shopify Admin UI, authentication, API, queue consumer
- D1: installations, jobs, order idempotency, progress, audit row reservations
- Cloudflare Queue: paginated discovery and independently retryable order work
- Shopify GraphQL Admin API `2026-07`: `orderEditBegin` → `orderEditSetQuantity(quantity: 0)` → `orderEditCommit`
- Google Sheets API: fixed-row, retry-safe writes to `BEFORE` and `AFTER`

The application requests only `read_orders,read_products,write_order_edits`. `read_products` is required to identify target variants on order line items. Shopify limits `read_orders` to orders created within the last 60 days. Processing older orders requires Shopify approval for `read_all_orders`; add that scope only after approval and deliberately raise `MAX_DATE_RANGE_DAYS`.

## Google Sheet setup

Create one spreadsheet, delete unused tabs, and create `BEFORE` and `AFTER`. Row 1 must exactly match these columns.

`BEFORE`:

```text
Timestamp | Shop Domain | Job ID | Order ID | Order Name | Order Created At | Customer Email | Variant ID | Product Title | Variant Title | SKU | Quantity Before | Unit Price | Line Item ID | Order Total Before | Processing Status
```

`AFTER`:

```text
Timestamp | Shop Domain | Job ID | Order ID | Order Name | Variant ID | Product Title | Variant Title | SKU | Quantity After | Order Total After | Shopify Order Edit ID | Processing Status | Error
```

Create a Google Cloud service account, enable the Google Sheets API, and share the spreadsheet with the service-account email as Editor. Customer email is stored only in `BEFORE` because it is part of the required audit trail; restrict spreadsheet access accordingly.

## Local setup

Requirements: Node.js 22+, a Shopify Partner/Dev Dashboard app, a Cloudflare account, and a development Shopify store.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 create auto-line-item-zero
npx wrangler queues create auto-line-item-zero
npx wrangler queues create auto-line-item-zero-dlq
```

Put the returned D1 ID in `wrangler.jsonc`. Fill `.dev.vars` with development credentials and generate the token-encryption secret, for example:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Apply the schema and start the Worker:

```powershell
npm run db:migrate:local
npm run dev
```

`npm run dev` also builds and mounts the Agentation annotation toolbar at the bottom-right of the app page. Open the app through Shopify Admin as usual. The toolbar uses a small React root alongside the existing HTML interface; `npm run deploy` uses the production entry point and excludes Agentation. Restart the dev command after editing `dev/agentation.jsx`.

For local OAuth, expose the Worker over HTTPS and set that exact origin in `SHOPIFY_APP_URL`, the Shopify app URL, and the allowed callback URL ending in `/auth/callback`.

## Shopify configuration

The repository uses App Bridge ID tokens for embedded access. It uses rotating expiring offline tokens for background work and per-user online tokens for Shopify staff authorization. Stored tokens are encrypted with AES-256-GCM. Copy and adjust `shopify.app.toml`, and use only:

```text
read_orders
read_products
write_order_edits
```

Set the app URL to `https://YOUR_DOMAIN/app` and the redirect URL to `https://YOUR_DOMAIN/auth/callback`. Open the app from Shopify Admin; direct browser visits to the app UI return `404`. The app registers an `APP_UNINSTALLED` webhook and removes that shop's D1 data after signature verification.

### Access control

- `/` and direct browser visits to `/app` return `404 Not Found`.
- The app UI renders only when Shopify Admin loads `/app` in its iframe with the required `shop` and `host` context.
- Every `/api/*` request requires a valid Shopify-signed App Bridge ID token. URL parameters and cookies alone cannot authorize access.
- OAuth callbacks and signed Shopify webhooks remain reachable because Shopify requires those endpoints.

For local testing, run `npm run db:migrate:local` and `npm run dev`, then expose port 8787 through a public HTTPS tunnel. Set the tunnel origin in `SHOPIFY_APP_URL`, `application_url`, and the callback URL before opening the app from the development store's Shopify Admin. Opening the localhost or tunnel URL directly will return `404` by design. Keep local D1 enabled while testing; no Worker deployment is required.

## Production deployment

Create production D1 and Queues as above, replace the binding IDs/names in `wrangler.jsonc`, then apply migrations:

```powershell
npx wrangler d1 migrations apply auto-line-item-zero --remote
```

Set secrets without putting values in source control:

```powershell
npx wrangler secret put SHOPIFY_API_KEY
npx wrangler secret put SHOPIFY_API_SECRET
npx wrangler secret put SHOPIFY_APP_URL
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put GOOGLE_SPREADSHEET_ID
npm run deploy
```

Update and release the matching app URL, redirect URL, scopes, and API version in Shopify. Install on a development store first.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npx wrangler deploy --dry-run
```

Smoke-test development orders containing variant 1, variant 2, both, neither, and an already-zero target. Confirm unrelated items remain unchanged, audit rows are correct, failed retries reconcile without a second edit, and one shop cannot retrieve another shop's job ID.

## Operational behavior

### Automatic processing

The `orders/create` webhook queues new orders immediately. A Cloudflare Cron Trigger also checks enabled stores every five minutes and queues orders missed by webhooks. It revisits the last 15 minutes to allow for Shopify search indexing delay. The last completed backup check appears in the app. If a check fails, its checkpoint remains unchanged so the next run retries. Both paths use the same unique automatic job per order.

The **Automatic processing** setting is saved separately for each store and defaults to off. Change the checkbox, then click **Apply** to enable or disable automation. The checkbox alone does not change the live setting. Applying an enabled setting first validates the Google Sheets audit setup. Only orders created strictly after the saved enable time are accepted; enabling again after switching off establishes a new cutoff. Manual date-range previews and selected-order processing remain available.

Shopify's signed `orders/create` webhook queues each new order immediately on receipt, without requiring the app to stay open or a merchant to approve each order. Delivery and queue latency mean completion is not instantaneous. The processor fetches the current order, skips cancelled orders and orders without positive target quantities, and uses the same BEFORE → edit → AFTER flow. Duplicate deliveries reuse one automatic job per store/order. Failed queue sends return an error for Shopify to retry.

Turning automation off skips waiting automatic work. Work already started, including audit reconciliation, finishes safely. **Recent automatic jobs** shows the latest 20 jobs; selecting one opens progress, errors, and the existing retry controls. Retries of unstarted work from a disabled or previous automation period are skipped; use manual processing if needed.

To activate this feature in an environment:

1. Apply migrations (`npm run db:migrate:local` for development, `npm run db:migrate:remote` for production), including the automation check checkpoint.
2. Deploy the updated Worker to the app's configured HTTPS origin.
3. Validate and release `shopify.app.toml` with Shopify CLI (`shopify app config validate --json`, then `shopify app deploy`) so the `orders/create` subscription reaches `/webhooks/orders-create`. Replace temporary tunnel URLs before a production release.
4. Open the app, check **Automatically process new orders** for the desired store, and click **Apply**.

Webhook verification follows [Shopify's delivery verification guidance](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries). Existing stores receive the app-config subscription when the app version is released. No additional order-edit scopes are introduced.

- Dates are inclusive and converted from the stored Shopify IANA timezone to UTC before querying.
- Queue payloads contain identifiers only—never Shopify or Google credentials.
- Transient network/429/5xx failures retry with bounded exponential delay.
- Cancellation stops pending work; an already-started mutation finishes its safe audit sequence.
- Fixed audit row reservations make Sheets retries idempotent.
- `AUDIT_AFTER_FAILED` means Shopify committed but the AFTER record still needs reconciliation.

If OAuth reports missing scopes, reinstall after releasing the Shopify app configuration. If Sheets validation fails, verify the service-account share, tab names, and exact headers. Never run destructive smoke tests against a production store without explicit confirmation.

                      
                             
                     
