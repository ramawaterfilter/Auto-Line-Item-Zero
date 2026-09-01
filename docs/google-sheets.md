# Google Sheets Integration

## Spreadsheet structure

One Google Spreadsheet with exactly two audit tabs:

```text
BEFORE
AFTER
```

## Authentication

Use a Google Cloud service account.

The user will provide:
- service account email
- private key
- spreadsheet ID

Store credentials as Cloudflare secrets.

Never expose credentials to the browser.

## Spreadsheet permission

The service account must be granted access to the spreadsheet with sufficient permission to append/update rows.

## BEFORE columns

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

## AFTER columns

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

## Safety invariant

BEFORE rows must be successfully persisted before Shopify quantity changes.

If BEFORE write fails:

```text
Do not edit Shopify.
```

## AFTER failure

If Shopify commit succeeds but AFTER write fails:

```text
Do not run the destructive order edit again.
```

Mark:

```text
AUDIT_AFTER_FAILED
```

and provide reconciliation/retry.

## Google API

Implement:
- JWT service-account authentication
- Sheets API append
- batching where practical
- retries for 429/5xx
- clear permanent error handling

Keep Google API code behind an interface so it can be mocked in tests.

## PII

Customer email is stored because it is part of the agreed audit data.

Do not add additional customer PII unless required.

Avoid logging email in application logs unless necessary.
