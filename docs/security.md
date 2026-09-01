# Security Requirements

## Shopify

Required scopes only:

```text
read_orders
write_order_edits
```

Never request:
- write_orders
- read_all_orders
- product write scopes
- customer scopes

unless a future feature explicitly requires them.

## Secrets

Secrets include:
- Shopify API secret
- Shopify Admin access credentials
- Google service-account private key
- Google spreadsheet configuration where appropriate

Never:
- commit secrets
- return secrets in API responses
- log secrets
- put secrets in browser code
- put secrets in Queue messages

## Multi-store isolation

Every D1 query must include the authenticated shop identity.

A job ID alone must not authorize access.

## Destructive action

Before `orderEditBegin`:
- authenticated shop
- authorized user/session
- valid job
- valid job order
- BEFORE audit successful
- not already processed

## Input validation

Validate:
- dates
- date ranges
- job IDs
- route parameters
- pagination/cursors
- configuration

Set a configurable maximum historical date range to prevent accidental huge jobs.

## Shopify API

Handle:
- HTTP errors
- GraphQL errors
- userErrors
- rate limits
- stale/invalid credentials

Do not blindly retry permanent errors.

## Google

Handle:
- expired/invalid service account credentials
- spreadsheet access denied
- missing tabs
- rate limits
- transient server errors

## Logging

Use structured logs.

Allowed examples:

```text
jobId
shopDomain
orderId
operation
attempt
duration
status
```

Never log:
- tokens
- secrets
- private keys
- Authorization headers
