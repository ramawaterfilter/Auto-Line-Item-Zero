# API Specification

## Authentication

All app API endpoints require an authenticated Shopify app session and must enforce shop isolation.

## GET /api/session

Returns safe session information.

Example:

```json
{
  "shop": "example.myshopify.com",
  "scopes": ["read_orders", "write_order_edits"]
}
```

Never return access tokens.

## POST /api/jobs

Starts a processing job.

Request:

```json
{
  "startDate": "2026-08-01",
  "endDate": "2026-08-31"
}
```

Validation:
- valid ISO dates
- start <= end
- configured maximum date range
- authenticated shop

Response:

```json
{
  "jobId": "job_xxx",
  "status": "PENDING"
}
```

## GET /api/jobs/:jobId

Returns job status.

Example:

```json
{
  "jobId": "job_xxx",
  "status": "PROCESSING",
  "totalOrders": 1248,
  "eligibleOrders": 1000,
  "processedOrders": 423,
  "successCount": 410,
  "skippedCount": 8,
  "failedCount": 5,
  "remaining": 825,
  "progressPercent": 33.9,
  "etaSeconds": 1080,
  "startedAt": "2026-08-31T10:00:00Z"
}
```

When ETA is not reliable:

```json
{
  "etaSeconds": null
}
```

UI should show `Calculating...`.

## POST /api/jobs/:jobId/retry-failed

Requeues failed orders for the authenticated shop/job.

Response:

```json
{
  "jobId": "job_xxx",
  "requeued": 5
}
```

## POST /api/jobs/:jobId/cancel

Requests cancellation.

Cancellation must not interrupt an in-progress Shopify mutation in an unsafe way.

New queued work should stop when possible.

## GET /api/jobs/:jobId/errors

Returns safe error information.

Do not return:
- access tokens
- Google credentials
- secrets
- internal stack traces in production

## Internal processing

Queue messages should contain only identifiers needed to retrieve state:

```json
{
  "jobId": "job_xxx",
  "jobOrderId": "job_order_xxx"
}
```

Do not put Shopify access tokens or Google private keys into queue messages.
