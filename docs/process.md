# Processing Workflow

## High-level flow

```text
Shopify Admin opens app
        |
        v
Select Start Date + End Date
        |
        v
Click "Process Orders"
        |
        v
Create Job
        |
        v
Discover orders in date range
        |
        v
Create job_order records
        |
        v
Queue order processing
        |
        +------------------------------+
        |                              |
        v                              v
Process Order A                  Process Order B
        |                              |
        v                              v
Find target variants             Find target variants
        |                              |
        v                              v
No targets? -----------------> SKIPPED / continue
        |
        v
Already quantity 0?
        |
        +---- yes ----> SKIPPED — Already processed
        |
        no
        |
        v
Write BEFORE audit
        |
        +---- failure ----> FAILED / DO NOT EDIT
        |
        v
orderEditBegin
        |
        v
Find CalculatedLineItems
        |
        v
Set matching target variant quantities to 0
        |
        +---- failure ----> retry/FAILED
        |
        v
orderEditCommit
        |
        +---- failure ----> retry/FAILED
        |
        v
Write AFTER audit
        |
        +---- failure ----> AUDIT_AFTER_FAILED / reconcile
        |
        v
SUCCESS
```

## Target matching

Only these variant IDs are destructive targets:

```text
58780018377088
58414723465600
```

If neither exists: no order edit.

If one exists: set that line item's quantity to 0.

If both exist: set both quantities to 0.

Never alter unrelated variants.

## Date range

The UI provides:
- start date
- end date

The application converts these into the Shopify shop's timezone and uses a well-defined inclusive range.

Document the exact timezone behavior and avoid interpreting browser-local dates as shop dates without conversion.

## BEFORE audit requirement

The BEFORE audit is a safety gate.

Required sequence:

```text
Read current data
      |
      v
Write BEFORE Google Sheet
      |
      v
Confirm successful write
      |
      v
Only then modify Shopify
```

If Google BEFORE logging fails:

```text
Do not call orderEditBegin
Mark order FAILED
Show failure
Allow retry
```

## Shopify edit

```text
orderEditBegin(orderId)
       |
       v
calculatedOrder
       |
       v
find calculated line items
       |
       v
orderEditSetQuantity(..., quantity: 0)
       |
       v
orderEditCommit(
  notifyCustomer: false,
  staffNote: "Auto-removed KokoCarb Cartridges-Subscription plan"
)
```

Use calculated line-item IDs returned by Shopify.

## Already processed

If the target line item is:
- quantity 0, or
- no longer present in the current editable order,

then:

```text
SKIPPED — Already processed
```

Do not create a pointless edit.

## Retry behavior

Retry:
- network errors
- 429
- temporary 5xx
- temporary Google API failures

Do not endlessly retry:
- invalid scopes
- invalid order IDs
- Shopify userErrors caused by invalid business state
- malformed configuration

Use exponential backoff with jitter.

## Job progress

Track:

```text
totalOrders
eligibleOrders
processedOrders
successCount
skippedCount
failedCount
```

Recommended progress:

```text
processedOrders / totalOrders * 100
```

ETA:

```text
average processing duration
× remaining orders
```

Use a rolling average so early slow orders do not permanently distort ETA.

Display:

```text
Orders found: 1,248
Processed: 423
Successful: 410
Skipped: 8
Failed: 5
Remaining: 825

Progress: 33.9%
ETA: ~18 minutes
```

If insufficient data exists, show:

```text
ETA: Calculating...
```

rather than inventing a number.

## Failure reconciliation

### BEFORE failure

Safe state:

```text
Shopify unchanged
D1 = FAILED
```

Retry is safe.

### Shopify edit failure

Record:
- Shopify order ID
- operation
- error
- attempt
- calculated order/session ID if available

Retry only if classified as retryable.

### AFTER audit failure

The Shopify order may already be changed.

Do NOT automatically perform the destructive action again.

Mark:

```text
AUDIT_AFTER_FAILED
```

Store enough information to reconcile the AFTER audit.

## Idempotency

Every order processing operation must have a unique identity based on:

```text
shop + job + order
```

Additionally protect against a repeated retry of the same logical processing action.

Before processing:

```text
SUCCESS -> do not process again
SKIPPED -> do not process again unless explicitly forced
PROCESSING + stale lock -> recover safely
FAILED -> retry according to retry policy
PENDING -> process
```

## Multi-store isolation

Every job belongs to exactly one Shopify shop.

Every query must scope by shop ID.

A shop must never be able to:
- read another shop's jobs
- read another shop's order data
- trigger another shop's job
- access another shop's Google audit context

## Future webhook support

The core service should expose a reusable function conceptually like:

```text
processOrder(shopContext, orderId, jobContext)
```

The current UI invokes it through the batch job.

A future webhook can invoke the same service.

Do not couple business logic to the UI.
