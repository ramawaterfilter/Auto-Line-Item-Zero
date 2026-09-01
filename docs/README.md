# Auto Remove Line Item — Codex Project Specification

This folder contains the implementation specification for a multi-store Shopify app deployed on Cloudflare Workers.

## Files

- `codex-prompt.md` — master prompt to give Codex
- `task.md` — implementation checklist
- `process.md` — business/process workflow
- `architecture.md` — system architecture
- `api-spec.md` — API contract
- `google-sheets.md` — Google Sheets audit design
- `security.md` — security requirements
- `testing.md` — test plan

## Core behavior

Manually select a date range, click Process Orders, discover historical orders, and set quantities to zero for target variants:

- 58780018377088
- 58414723465600

Before Shopify is modified, write the original data to the `BEFORE` Google Sheet tab. After a successful commit, write the result to `AFTER`.

The app is designed for Cloudflare Workers, D1, and Queues and supports multiple Shopify stores.

## Recommended Codex workflow

1. Read `codex-prompt.md`.
2. Read all supporting `.md` files.
3. Implement the project.
4. Run typecheck/lint/tests.
5. Review destructive-operation safety.
6. Deploy only after testing on a development Shopify store.
