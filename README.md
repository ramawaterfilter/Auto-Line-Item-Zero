# Auto Remove Line Item

A multi-store Shopify app for Cloudflare Workers. An authenticated merchant selects an inclusive date range; the app finds orders and sets these variant quantities to zero:

- `58780018377088`
- `58414723465600`

Every destructive edit is gated by a successful `BEFORE` Google Sheets write. A committed edit is persisted in D1 before the `AFTER` write, so reconciliation never repeats the Shopify mutation.

## Architecture

- Cloudflare Worker: standalone Shopify admin UI, OAuth, API, queue consumer
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

For local OAuth, expose the Worker over HTTPS and set that exact origin in `SHOPIFY_APP_URL`, the Shopify app URL, and the allowed callback URL ending in `/auth/callback`.

## Shopify configuration

The repository uses the authorization-code grant with rotating expiring offline tokens for background work and per-user online tokens for Shopify staff login. Both are encrypted with AES-256-GCM. Staff must have all required app permissions; their app session ends after 12 hours at most and is also rejected when Shopify revokes the online token. Configure the app as non-embedded (standalone), copy and adjust `shopify.app.toml`, and use only:

```text
read_orders
read_products
write_order_edits
```

Set the app URL to `https://YOUR_DOMAIN/app` and the redirect URL to `https://YOUR_DOMAIN/auth/callback`. Install with `https://YOUR_DOMAIN/auth?shop=STORE.myshopify.com`. The app registers an `APP_UNINSTALLED` webhook and removes that shop's D1 data after signature verification.

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

- Dates are inclusive and converted from the stored Shopify IANA timezone to UTC before querying.
- Queue payloads contain identifiers only—never Shopify or Google credentials.
- Transient network/429/5xx failures retry with bounded exponential delay.
- Cancellation stops pending work; an already-started mutation finishes its safe audit sequence.
- Fixed audit row reservations make Sheets retries idempotent.
- `AUDIT_AFTER_FAILED` means Shopify committed but the AFTER record still needs reconciliation.

If OAuth reports missing scopes, reinstall after releasing the Shopify app configuration. If Sheets validation fails, verify the service-account share, tab names, and exact headers. Never run destructive smoke tests against a production store without explicit confirmation.

                      
                             
                     
