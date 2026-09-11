# Codex Build Prompt — Auto Remove Line Item Shopify App

## Role

Act as a senior full-stack engineer specializing in Shopify apps, Cloudflare Workers, TypeScript, GraphQL, Google APIs, security, and production reliability.

Build the complete application described below. Do not merely provide snippets. Create a runnable repository with source code, tests, configuration, documentation, and deployment instructions.

## Goal

Build a multi-store Shopify app that lets an authenticated store admin manually select an order date range and start a batch process.

For every eligible order in the selected date range:
1. Find line items belonging to either target variant:
   - `58780018377088`
   - `58414723465600`
2. If either or both are present and quantity > 0, record the original line-item/order data to the BEFORE Google Sheet tab.
3. Use Shopify Admin GraphQL Order Editing API to set every matching target line item's quantity to 0.
4. Commit the order edit with `notifyCustomer: false`.
5. Record the resulting data to the AFTER Google Sheet tab.
6. Show progress and estimated remaining time in the UI.
7. Mark already-zero/already-removed items as `SKIPPED — Already processed`.
8. Retry transient/failed orders safely and expose failed orders with a Retry Failed Orders action.

## Critical clarification

This is now a MANUAL batch-processing app. Do NOT implement `orders/create` as the primary processing trigger.

The user clicks a button after selecting a date range. The app processes historical orders in that range.

Design the code so a webhook can be added later without rewriting the core processing service, but do not require a webhook for the current feature.

## Platform constraints

Deployment target: Cloudflare Workers.

Use a Cloudflare-native architecture. Do not require a continuously running Node.js server, VPS, Docker, Nginx, or a long-lived process.

Recommended stack:
- TypeScript
- Cloudflare Workers
- Hono for HTTP routing if useful
- Cloudflare D1 for persistent application/job state
- Cloudflare Queues for batch work if available/appropriate
- Cloudflare Workers Static Assets for the UI, or a simple frontend framework that works well on Workers
- Shopify Admin GraphQL API
- Google Sheets API via a Google service account
- Web Crypto / Workers-compatible crypto
- Wrangler

Do not add dependencies that require unsupported Node-only APIs unless Node compatibility is explicitly configured and verified.

## Shopify app requirements

The app must support multiple Shopify stores.

Implement proper Shopify app installation/OAuth rather than hard-coding one shop or one access token.

Required Shopify scopes:
- `read_orders`
- `write_order_edits`

Do not request unnecessary scopes.

Persist per-shop installation information securely. Never expose Admin API access tokens to the browser.

Use Shopify GraphQL Admin API with a configurable API version.

The app must:
- install on multiple shops
- identify the current shop/session
- store installation/access credentials server-side
- support uninstall cleanup if possible
- handle token/auth errors clearly

## Target variants

Use configuration/constants:

```text
58780018377088
58414723465600
```

These are VARIANT IDs, not product IDs.

Normalize Shopify GraphQL GIDs to numeric IDs when comparing:

`gid://shopify/ProductVariant/58780018377088`

An order can contain:
- neither target variant
- only variant 58780018377088
- only variant 58414723465600
- both

If both exist, set BOTH matching quantities to 0.

Do not remove unrelated line items.

## Date selection

The UI must provide:
- Start date calendar
- End date calendar
- timezone/store context clearly displayed
- Process Orders button

Define and document the date boundary behavior. Prefer an inclusive start and inclusive end date in the shop's timezone.

Before processing, show a confirmation:
- date range
- estimated number of eligible orders if available
- target variants
- warning that matching line items will be removed from orders

## Order discovery

Use Shopify Admin GraphQL pagination correctly.

Query orders within the selected date range. Prefer server-side filtering by `created_at`/Shopify search query rather than fetching all historical orders.

Process pages incrementally.

Never load an unbounded number of orders into one Worker invocation.

Only process orders that contain one of the target variants. If practical, filter/query by variant IDs server-side; otherwise fetch required line-item data and filter in application code.

Use GraphQL pagination cursors and persist job cursor/progress in D1.

## Order edit flow

For each eligible order:

1. Verify order is editable/appropriate to process.
2. Call `orderEditBegin`.
3. From the calculated order, locate calculated line items corresponding to the two target variants.
4. For each matching target line item whose current quantity > 0, call `orderEditSetQuantity` with `quantity: 0`.
5. If no editable target item remains, mark appropriately and do not commit an empty edit.
6. Commit using `orderEditCommit` with:
   - `notifyCustomer: false`
   - staff note: `Auto-removed KokoCarb Cartridges-Subscription plan`
7. Record result.

Handle Shopify `userErrors` at every mutation.

Do not assume the original webhook line-item ID is the calculated line-item ID.

Use current Shopify GraphQL schema/API documentation and make mutation fields configurable where practical.

## Order status / edge cases

Skip orders that cannot/should not be edited, including cancelled orders.

Handle archived/unavailable orders safely. Do not claim an order is editable merely because it was returned by the order query.

If a target line item is already quantity 0 or no longer present:
- status: `SKIPPED — Already processed`
- do not create a new order edit unnecessarily.

If the order contains both variants:
- process both independently in the same order edit where possible.

If one target variant succeeds but another mutation fails, do not silently mark the order successful. Handle the calculated order session consistently and record the failure. Avoid leaving abandoned edit sessions where Shopify provides a safe cancellation mechanism.

## Idempotency

This is mandatory.npm run db:migrate:local

A batch may be retried, the browser may refresh, a Worker may retry, or a job may be delivered twice.

Use a deterministic per-shop/per-order processing key, e.g.:

`shopId + orderId + target-processing-version`

Store processing state in D1.

States should include at least:
- PENDING
- PROCESSING
- SUCCESS
- SKIPPED
- FAILED

Do not duplicate BEFORE/AFTER audit rows when the same processing attempt has already been recorded.

Use Shopify order IDs and webhook/job IDs where applicable.

## Retry policy

Implement retries for transient failures:
- network failures
- Shopify 429
- suitable 5xx responses
- Cloudflare queue retryable failures

Use exponential backoff with jitter and a bounded maximum attempt count.

Do not retry permanent validation/user errors indefinitely.

Expose failed orders in the UI.

Provide:
`Retry Failed Orders`

A retry must be idempotent.

## Google Sheets audit log

Use one Google Spreadsheet with TWO tabs:

- `BEFORE`
- `AFTER`

The spreadsheet ID must be provided as configuration/secret.

Google authentication:
- service account
- credentials supplied by the user/deployment
- never expose private key in frontend
- store credentials as Cloudflare secrets or another secure server-side mechanism

Do not hard-code Google credentials.

Suggested BEFORE columns:

```text
Timestamp
Shop Domain
Job ID
Order ID
Order Name
Order Created At
Customer Email
Variant ID
Product Title
Variant Title
SKU
Quantity Before
Unit Price
Line Item ID
Order Total Before
Processing Status
```

Suggested AFTER columns:

```text
Timestamp
Shop Domain
Job ID
Order ID
Order Name
Variant ID
Product Title
Variant Title
SKU
Quantity After
Order Total After
Shopify Order Edit ID
Processing Status
Error
```

Use a stable column order and document it.

The BEFORE record must be written successfully BEFORE attempting the destructive order edit.

If BEFORE logging fails:
- do NOT modify the Shopify order
- mark the order failed
- make the reason visible

After commit, write AFTER records.

If AFTER logging fails after Shopify commit:
- do not roll back blindly
- mark `AUDIT_AFTER_FAILED`
- make it visible and retryable
- preserve enough Shopify identifiers to reconcile later

Google Sheets writes should be batched where possible.

Handle Google API rate limits and transient errors.

Customer PII:
- include customer email as requested in BEFORE
- minimize PII
- document why it is stored
- never expose Google credentials or raw credentials in UI/logs

## UI requirements

Create a simple, professional admin UI.

Main screen:
- current shop
- date range selectors
- Start Date
- End Date
- `Process Orders` button
- target variants display
- job status/progress

During processing display:

```text
Orders found: 1,248
Processed: 423
Successful: 410
Skipped: 8
Failed: 5
Remaining: 825

Progress: 33.9%

Estimated time remaining: ~18 minutes
```

Use an ETA calculated from actual completed work, preferably a rolling average to avoid wildly unstable estimates.

Also show:
- job started time
- elapsed time
- current status
- current/last order
- retry count
- errors

Allow the user to leave/refresh the page and recover job state by polling the server.

Do not keep a single HTTP request open for the entire batch.

Use a job-based architecture.

## Job architecture

Preferred:

```text
Browser
  |
  | POST start job
  v
Cloudflare Worker API
  |
  +--> D1 job record
  |
  +--> Cloudflare Queue
           |
           +--> process order
           +--> update D1
           +--> Google Sheets
```

The browser polls:

`GET /api/jobs/:jobId`

and receives progress.

If Cloudflare Queues are unavailable in the selected deployment setup, implement a Cloudflare-compatible alternative using scheduled/background execution and D1, but never process thousands of orders inside one request.

## API routes

Implement at least:

```text
GET  /
GET  /app
GET  /api/session
POST /api/jobs
GET  /api/jobs/:jobId
POST /api/jobs/:jobId/retry-failed
POST /api/jobs/:jobId/cancel
GET  /api/jobs/:jobId/errors
```

Names can be changed if justified.

Protect all app routes with proper Shopify app authentication/session validation.

Do not trust shop/date range/order IDs supplied by the browser without validation.

## Security

Implement:
- Shopify OAuth/session security
- HMAC verification where Shopify signs requests
- CSRF protection appropriate to the auth flow
- secure cookies/session handling
- no Admin API tokens in frontend
- no Google credentials in frontend
- input validation
- date range validation
- maximum allowed date range configurable
- structured logging without secrets
- authorization checks for every job
- each job tied to a shop
- prevent one shop from accessing another shop's jobs
- rate limiting where practical

Never log:
- Shopify access tokens
- Google private keys
- client secrets
- full Authorization headers

## Configuration

Use environment variables/secrets. Include `.dev.vars.example` with placeholders only.

Expected configuration should include conceptually:

```env
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=
SHOPIFY_SCOPES=read_orders,write_order_edits

GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SPREADSHEET_ID=

TARGET_VARIANT_ID_1=58780018377088
TARGET_VARIANT_ID_2=58414723465600

ORDER_EDIT_STAFF_NOTE=Auto-removed KokoCarb Cartridges-Subscription plan
```

Use Cloudflare bindings for D1 and Queue.

Never commit secrets.

## Data model

Create a D1 schema for at least:

### shops/installations
- id
- shop_domain
- access token/credential reference
- scopes
- installed_at
- updated_at
- status

### jobs
- id
- shop_id
- start_date
- end_date
- timezone
- status
- total_orders
- eligible_orders
- processed_orders
- success_count
- skipped_count
- failed_count
- started_at
- completed_at
- created_at
- updated_at

### job_orders
- id
- job_id
- shop_id
- shopify_order_id
- order_name
- status
- attempts
- before_audit_status
- after_audit_status
- error_message
- started_at
- completed_at
- updated_at

Add indexes/unique constraints needed for idempotency.

Do not store unnecessary order data in D1 if it is already safely represented in Sheets.

## Error handling

Create typed/application errors where useful:
- ShopifyAuthError
- ShopifyRateLimitError
- ShopifyUserError
- GoogleSheetsError
- ValidationError
- AlreadyProcessedError
- RetryableError

Return clean user-facing messages while keeping detailed diagnostic information server-side.

## Testing

Include tests for at least:

1. Both target variants absent.
2. Only variant 1 present.
3. Only variant 2 present.
4. Both variants present.
5. Target quantity already 0.
6. Cancelled order.
7. Shopify HMAC valid/invalid if signed endpoints are used.
8. Shopify GraphQL userErrors.
9. Shopify 429 retry.
10. Google BEFORE write failure prevents order edit.
11. Google AFTER write failure is recorded without pretending Shopify was rolled back.
12. Duplicate job/order processing is idempotent.
13. Retry failed order.
14. Date range validation.
15. Multi-store isolation.
16. ETA calculation.

Mock external Shopify and Google APIs in unit tests. Do not make real destructive API calls from tests.

## Developer experience

Create:
- README.md
- task.md
- process.md
- architecture.md
- api-spec.md
- google-sheets.md
- security.md
- testing.md
- .dev.vars.example
- wrangler configuration
- D1 migrations
- source code
- tests

Use TypeScript and strict typing.

Run formatting/lint/typecheck/tests before considering the implementation complete.

Do not leave TODO placeholders for core functionality.

## Documentation expectations

README must explain:
- local setup
- Shopify Partner app configuration
- OAuth configuration
- scopes
- Cloudflare D1 creation
- Queue creation
- Google Cloud service account creation
- Google Sheet sharing with service account
- Cloudflare secret setup
- local development
- deployment
- multi-store installation
- troubleshooting

## Important implementation principle

The destructive action is:

`orderEditSetQuantity(quantity: 0)` followed by `orderEditCommit`.

Therefore the system must prioritize:
1. authorization
2. idempotency
3. BEFORE audit persistence
4. safe Shopify edit
5. AFTER audit persistence
6. reconciliation of partial failures

Build the project so a developer can clone it, configure secrets, run tests, deploy to Cloudflare, install the Shopify app, and use the date-range UI.
