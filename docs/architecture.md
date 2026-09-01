# Architecture

## Goal

Small, reliable, multi-store Shopify app deployed on Cloudflare.

## Architecture

```text
                         Shopify Admin
                              |
                              v
                    +--------------------+
                    | Cloudflare Worker  |
                    | App/API + Auth     |
                    +---------+----------+
                              |
               +--------------+--------------+
               |                             |
               v                             v
          Cloudflare D1                Cloudflare Queue
          jobs/state                         |
               |                             v
               |                     Order Processor
               |                             |
               |                +------------+------------+
               |                |                         |
               v                v                         v
          Progress API     Shopify GraphQL           Google Sheets
               ^           Admin API                  BEFORE/AFTER
               |
               |
            Browser UI
```

## Components

### Cloudflare Worker

Responsibilities:
- Shopify OAuth
- session/auth
- API routes
- UI/static assets
- job creation
- job status
- authorization
- validation

### D1

Responsibilities:
- Shopify installations
- jobs
- job orders
- idempotency
- progress
- retry state
- audit state

### Cloudflare Queue

Responsibilities:
- distribute order processing
- avoid long-running HTTP requests
- retry transient work
- smooth large historical batches

### Shopify Admin GraphQL

Responsibilities:
- query historical orders
- inspect line items
- begin order edits
- set matching line-item quantity to 0
- commit edits

### Google Sheets

One spreadsheet:

```text
BEFORE
AFTER
```

Used as an external audit trail.

## Why no traditional VPS?

The application does not require:
- persistent Node process
- Express server
- Docker
- Nginx

It is request-driven and job-driven, which fits Workers.

## Why D1?

The app needs durable state:
- job status
- per-order status
- retries
- multi-store isolation
- idempotency

D1 is appropriate for this lightweight state.

## Why Queue?

A date range may contain thousands of orders. Do not hold one HTTP request open while processing them.

Queue messages allow:
- independent order processing
- retries
- scalable batch processing
- UI polling

## Security boundary

```text
Browser
  |
  | no Shopify Admin token
  | no Google private key
  v
Worker
  |
  +-- secure Shopify credentials
  |
  +-- secure Google credentials
  |
  +-- D1
  |
  +-- Queue
```

## Destructive-operation safety

The critical invariant is:

```text
BEFORE audit success
        AND
authorized job
        AND
not already processed
        |
        v
Shopify edit
```

This minimizes accidental data changes.

## Future extension

The core order processor should be independent of the trigger.

Future triggers can include:
- Shopify webhook
- scheduled job
- manual single-order processing

without duplicating order-edit logic.
