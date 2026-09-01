# Auto Remove Line Item — Beginner's Guide

## What this project does

Imagine you own a Shopify toy shop.

Some old orders contain one of two special products:

- Variant `58780018377088`
- Variant `58414723465600`

This app lets you:

1. Choose some dates.
2. Find orders containing those products.
3. Preview the matching orders.
4. Select which orders you want to change.
5. Change only those special products' quantities to `0`.
6. Record what existed before and after in Google Sheets.

Setting quantity to `0` means: **remove this product from the order**.

The app does **not** cancel the entire order, remove unrelated products, notify the customer, or put removed inventory back into stock.

## The big picture

Think of the application as a careful robot working in a warehouse:

```text
You use the website
        ↓
Cloudflare Worker receives your request
        ↓
D1 database creates a job notebook
        ↓
Cloudflare Queue gives work to background robots
        ↓
Robot reads the order from Shopify
        ↓
Robot writes a BEFORE receipt to Google Sheets
        ↓
Robot changes the Shopify order
        ↓
Robot saves proof of the change in D1
        ↓
Robot writes an AFTER receipt to Google Sheets
        ↓
Website shows the result
```

The main services are:

| Part | Child-friendly meaning | Real job |
|---|---|---|
| Shopify | The shop | Stores products and orders |
| Cloudflare Worker | The manager | Runs the application code |
| Cloudflare D1 | The notebook | Remembers shops, jobs, orders, and results |
| Cloudflare Queue | The job basket | Processes orders in the background |
| Google Sheets | The receipt book | Records before-and-after information |

## 1. Installing the app

The merchant enters a domain such as:

```text
example.myshopify.com
```

The app sends them to Shopify for permission. It asks for:

```text
read_orders
read_products
write_order_edits
```

These permissions let the app read orders, identify product variants, and edit existing orders.

After Shopify approves the app:

1. Shopify gives it an access token, which works like a secret key.
2. The app encrypts the key.
3. It stores the encrypted version in D1.
4. It asks Shopify for the shop's timezone.
5. It creates a signed login cookie lasting 12 hours.
6. It registers an uninstall notification.

The authentication code is in [`src/auth.ts`](../src/auth.ts).

If someone uninstalls the app, Shopify calls the uninstall webhook. After checking Shopify's signature, the application deletes that shop and its related jobs from D1.

## 2. Choosing dates

The merchant chooses a start date and end date. Both days are included.

The app checks that:

- Both values are real dates.
- The start is not after the end.
- The range is not longer than 60 days.
- Dates are understood using the Shopify shop's timezone.

Timezone matters because August 1 starts at a different moment in India than it does in America. The app turns the shop's local beginning and ending times into UTC before asking Shopify.

This logic lives in [`src/core.ts`](../src/core.ts).

## 3. Creating a job

When the merchant clicks **Preview eligible orders**, the browser sends:

```text
POST /api/jobs
```

The application creates a job ID similar to:

```text
job_12345678-1234-1234-1234-123456789abc
```

The new job is stored in the `jobs` database table with status `PENDING`.

Instead of keeping the browser waiting, the app puts a `DISCOVER` message into the Cloudflare Queue. This message means:

> Please find all matching orders for this job.

The browser checks the job's status every two seconds. API handling is in [`src/api.ts`](../src/api.ts).

## 4. Discovering orders

The background worker receives the `DISCOVER` message.

It asks Shopify for up to 50 orders at a time. If Shopify has more, it remembers the page cursor and puts another discovery message into the queue.

For each order, it checks:

- Is the order cancelled? If yes, ignore it.
- Does it contain one of the two target variants?
- Is the target quantity greater than zero?

Only eligible orders are saved as `job_orders` records. Therefore, the UI's **Orders found** number is really the number of eligible matching orders, not every Shopify order inside the date range.

When discovery finishes, the job becomes:

```text
PENDING + selection_ready = 1
```

This means the search is finished and the merchant can choose orders. The discovery logic is in [`src/processor.ts`](../src/processor.ts).

## 5. Previewing and selecting orders

The browser requests:

```text
GET /api/jobs/:jobId/orders
```

For every eligible order, it displays:

- Order name
- Creation date
- Product name
- Variant name
- Current quantity
- Current total

The merchant can select individual orders or use **Select all**. Nothing has been changed yet.

When the merchant clicks **Execute selected orders**, the browser shows another confirmation message. The application then validates that:

- At least one order was selected.
- Every selected ID is correctly formed.
- Every selected order belongs to this job.
- The job belongs to the logged-in shop.
- Every selected order is still available.
- The Google spreadsheet exists.
- It contains tabs named exactly `BEFORE` and `AFTER`.
- Both tabs have the required headers.

Unselected order records are removed from the job. The UI is generated by [`src/ui.ts`](../src/ui.ts).

## The most important safety sequence

Every selected order follows this exact sequence:

```text
1. Read the latest Shopify order
2. Write BEFORE record
3. Change Shopify
4. Save committed result in D1
5. Write AFTER record
```

The small function that enforces this order is [`src/safety.ts`](../src/safety.ts).

### Step 1: Read the order again

Even though the order was read during preview, it is fetched again before editing. Someone might have changed or cancelled it while the merchant was choosing orders.

The app checks again whether the order is cancelled, whether target products still exist, and whether their quantities remain greater than zero. If nothing needs changing, the order is safely skipped.

### Step 2: Write the BEFORE receipt

Before touching Shopify, the app writes this information to the `BEFORE` Google Sheet:

- Time
- Shop domain
- Job ID
- Order ID and name
- Customer email
- Product and variant information
- SKU
- Quantity before
- Unit price
- Line-item ID
- Order total before

If this Google Sheets write fails, Shopify is **not changed**. This is the app's most important safety rule.

### Step 3: Edit Shopify

The app asks Shopify to begin an order edit. Shopify creates a temporary calculated order, and the app searches its line items again.

For each matching target, it calls:

```text
orderEditSetQuantity(quantity: 0, restock: false)
```

It then commits the edit with:

```text
notifyCustomer: false
```

The staff note is:

```text
Auto-removed KokoCarb Cartridges-Subscription plan
```

Shopify communication is in [`src/shopify.ts`](../src/shopify.ts).

### Step 4: Save proof in D1

Immediately after Shopify commits, the app saves:

- The Shopify edit ID
- The new order total
- A result showing that the change happened

This happens before writing the `AFTER` Google Sheet receipt.

Suppose Shopify changes the order successfully but Google Sheets temporarily stops working. Without this D1 result, a retry might try to change Shopify again. The saved result tells the retrying worker:

> Shopify was already changed. Only repair the missing AFTER receipt.

### Step 5: Write the AFTER receipt

The app writes the following to the `AFTER` tab:

- Order and product details
- Quantity after: `0`
- Order total after
- Shopify edit ID
- Success status

Once this succeeds, the order becomes `SUCCESS`.

Google authentication, sheet validation, and sheet writing are in [`src/sheets.ts`](../src/sheets.ts).

## What happens when something goes wrong?

Each order can have one of these statuses:

| Status | Meaning |
|---|---|
| `PENDING` | Waiting for its turn |
| `PROCESSING` | A worker is handling it |
| `SUCCESS` | Shopify changed and both receipts are complete |
| `SKIPPED` | Nothing needed changing |
| `FAILED` | Failed before a confirmed Shopify commit |
| `AUDIT_AFTER_FAILED` | Shopify changed, but the AFTER receipt failed |
| `CANCELLED` | Stopped before processing |

Temporary failures include network problems, HTTP `429` rate limits, and Shopify or Google `5xx` errors. These may retry up to five queue deliveries. The waiting time grows after each failure, up to one hour.

Permanent problems, such as missing permissions, bad configuration, invalid order state, or a malformed Google Sheet, are not endlessly retried.

The special `AUDIT_AFTER_FAILED` status means:

> Do not edit Shopify again. Only finish writing the AFTER receipt.

## Cancelling a job

When the merchant clicks **Cancel**:

- Waiting orders become `CANCELLED`.
- New work stops wherever possible.
- An order already in the middle of a Shopify change is allowed to finish its safety sequence.

Stopping halfway through a committed Shopify edit could leave audit records incorrect, so cancellation does not violently interrupt active work.

## Progress and ETA

The application counts total, processed, successful, skipped, failed, and remaining orders.

After every completed order, it updates a rolling average:

```text
80% old average + 20% newest processing time
```

It estimates the time left using:

```text
ETA = remaining orders × average time per order
```

Before it has enough information, the UI says `Calculating…` instead of inventing a number.

## The database

The database schema is in [`migrations/0001_initial.sql`](../migrations/0001_initial.sql) and [`migrations/0002_order_selection.sql`](../migrations/0002_order_selection.sql).

### `shops`

One row for each installed Shopify shop. It stores the domain, encrypted Shopify tokens, permissions, timezone, and installation status.

### `jobs`

One row for each date-range operation. It stores dates, status, progress counts, ETA information, and discovery position.

### `job_orders`

One row for every eligible order in a job. It stores processing status, retry count, audit locations, the before snapshot, the committed result, and a safe error message.

### `audit_counters`

This remembers the next unused row in the `BEFORE` and `AFTER` sheets. Rows are reserved before writing so a retry uses the same rows instead of creating duplicate receipts.

## Security protections

The app includes these protections:

- Shopify domains must end in `.myshopify.com`.
- OAuth callbacks have signed state, expiration, and HMAC checks.
- Login cookies are signed, HTTP-only, secure, and time-limited.
- Shopify tokens are encrypted with AES-256-GCM before database storage.
- Google private keys and Shopify secrets remain on the server.
- Queue messages contain IDs only, never credentials.
- Every job query includes the shop ID.
- One shop cannot read or process another shop's jobs.
- Non-GET API requests must come from the configured application origin.
- Shopify uninstall webhooks must have a valid Shopify signature.
- Browser security headers restrict scripts, framing, cameras, microphones, and location access.

The cryptographic helpers are in [`src/crypto.ts`](../src/crypto.ts).

## What each source file does

- [`src/index.ts`](../src/index.ts) — Main entrance for web requests and queue messages.
- [`src/ui.ts`](../src/ui.ts) — Creates the website.
- [`src/api.ts`](../src/api.ts) — Creates jobs, reports progress, and handles selection, retries, and cancellation.
- [`src/auth.ts`](../src/auth.ts) — Handles Shopify installation, login, token refresh, and uninstall.
- [`src/processor.ts`](../src/processor.ts) — Finds and processes orders.
- [`src/shopify.ts`](../src/shopify.ts) — Talks to Shopify.
- [`src/sheets.ts`](../src/sheets.ts) — Talks to Google Sheets.
- [`src/safety.ts`](../src/safety.ts) — Enforces the safe operation order.
- [`src/core.ts`](../src/core.ts) — Handles dates, target IDs, ETA, and retry calculations.
- [`src/crypto.ts`](../src/crypto.ts) — Handles encryption, signatures, and cookies.
- [`src/types.ts`](../src/types.ts) — Describes the shapes of data used by TypeScript.

## Is it currently working?

The local checks pass:

- TypeScript type-check: passed
- Test files: 2 passed
- Automated tests: 25 passed

The tests cover target matching, dates, timezones, retries, the critical BEFORE safety gate, session tampering, Shopify signatures, permission checks, order selection, and shop isolation.

This confirms that the code is internally consistent. It does not prove that live Shopify, Google Sheets, and Cloudflare credentials are configured correctly; that requires a real test using a development Shopify store.
