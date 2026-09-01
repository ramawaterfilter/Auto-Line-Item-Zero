# Testing Strategy

## Unit tests

### Variant matching

Case 1:
No target variants -> no edit.

Case 2:
Variant `58780018377088` -> quantity 0.

Case 3:
Variant `58414723465600` -> quantity 0.

Case 4:
Both variants -> both quantity 0.

### Already processed

Target line item quantity 0 -> `SKIPPED — Already processed`.

Target line item absent from editable order -> skip safely.

### Order status

Cancelled order -> skip.

Uneditable order -> safe failure/skip according to Shopify response.

### Audit safety

Google BEFORE fails:

```text
Shopify edit must not execute.
```

Google AFTER fails:

```text
Shopify must not be edited a second time automatically.
```

### Shopify errors

- GraphQL HTTP error
- GraphQL top-level errors
- mutation userErrors
- 429
- 500/502/503

Verify retry classification.

### Idempotency

Run same order twice.

Expected:
- only one destructive processing
- no duplicate successful audit
- second attempt safely skips/already processed

### Multi-store

Store A cannot access:
- Store B jobs
- Store B orders
- Store B credentials

### ETA

Verify:
- no completed orders => ETA null
- stable processing => estimated time decreases
- rolling average prevents one slow order dominating estimate

## Integration tests

Mock:
- Shopify GraphQL
- Google Sheets API
- D1
- Queue

Test complete successful flow:

```text
create job
 -> discover orders
 -> queue
 -> BEFORE
 -> orderEditBegin
 -> set quantity 0
 -> commit
 -> AFTER
 -> success
```

## Deployment smoke test

Use a development/test Shopify store and a test order containing:
- only variant 1
- only variant 2
- both

Verify:
- quantities become zero
- unrelated items remain
- BEFORE tab has original values
- AFTER tab has resulting values
- UI progress is accurate
- retry works

Never run destructive tests against production without explicit confirmation.
