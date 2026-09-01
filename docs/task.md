# Task Plan — Auto Remove Line Item App

## Objective

Build and deploy a multi-store Shopify app on Cloudflare Workers that manually processes historical orders in a selected date range and sets quantities of two target variants to zero.

Target variants:
- 58780018377088
- 58414723465600

Required Shopify scopes:
- read_orders
- write_order_edits

## Phase 0 — Decisions / Constraints

- [x] Cloudflare Workers deployment
- [x] Manual processing only
- [x] Date-range selection
- [x] Historical orders supported
- [x] Both target variants can exist in one order
- [x] Both are set to quantity 0 when present
- [x] One Google Spreadsheet
- [x] BEFORE and AFTER tabs
- [x] Retry failed orders
- [x] Already-zero/already-removed => SKIPPED
- [x] Multi-store Shopify support
- [x] Google service-account credentials supplied during deployment

## Phase 1 — Repository

- [ ] Initialize TypeScript project
- [ ] Configure Wrangler
- [ ] Configure strict TypeScript
- [ ] Configure lint/format/test
- [ ] Create source directories
- [ ] Create `.dev.vars.example`
- [ ] Create `.gitignore`

## Phase 2 — Cloudflare Foundation

- [ ] Configure Worker
- [ ] Create D1 schema
- [ ] Create migrations
- [ ] Configure Queue
- [ ] Add environment/bindings types
- [ ] Add structured logging
- [ ] Add local development setup

## Phase 3 — Shopify Authentication

- [ ] Configure Shopify Partner app
- [ ] Implement OAuth/install flow
- [ ] Implement callback
- [ ] Validate state/session
- [ ] Persist shop installation
- [ ] Secure access token storage
- [ ] Add uninstall handling
- [ ] Implement multi-store isolation
- [ ] Verify scopes

## Phase 4 — Shopify API Client

- [ ] Build GraphQL client
- [ ] Configurable API version
- [ ] Handle HTTP errors
- [ ] Handle GraphQL errors
- [ ] Handle userErrors
- [ ] Handle rate limits
- [ ] Add retry/backoff
- [ ] Add pagination helpers

## Phase 5 — Order Discovery

- [ ] Validate start/end dates
- [ ] Apply shop timezone
- [ ] Build Shopify order search query
- [ ] Paginate orders
- [ ] Identify target variants
- [ ] Persist job/order records
- [ ] Avoid unbounded memory usage

## Phase 6 — Order Processing

For each order:

- [ ] Verify order is eligible
- [ ] Detect target variant 1
- [ ] Detect target variant 2
- [ ] Detect already-zero items
- [ ] Write BEFORE audit
- [ ] Begin order edit
- [ ] Find calculated line items
- [ ] Set matching quantities to 0
- [ ] Handle both variants
- [ ] Commit order edit
- [ ] Write AFTER audit
- [ ] Update D1 state
- [ ] Handle errors
- [ ] Retry transient errors
- [ ] Prevent duplicate processing

## Phase 7 — Google Sheets

- [ ] Create Google service-account auth
- [ ] Implement Sheets API client
- [ ] Validate spreadsheet ID
- [ ] Validate BEFORE/AFTER tabs
- [ ] Define headers
- [ ] Append BEFORE rows
- [ ] Append AFTER rows
- [ ] Batch writes where practical
- [ ] Handle rate limits
- [ ] Handle partial audit failure
- [ ] Add reconciliation state

## Phase 8 — Job System

- [ ] Create job
- [ ] Queue order work
- [ ] Persist progress
- [ ] Process retries
- [ ] Mark success
- [ ] Mark skipped
- [ ] Mark failed
- [ ] Calculate progress
- [ ] Calculate ETA
- [ ] Retry failed orders
- [ ] Cancel job safely if implemented
- [ ] Recover from Worker/browser restarts

## Phase 9 — UI

- [ ] Shopify embedded/app UI
- [ ] Date calendar
- [ ] Date validation
- [ ] Confirmation dialog
- [ ] Start processing button
- [ ] Job progress
- [ ] Counts
- [ ] ETA
- [ ] Current order
- [ ] Errors
- [ ] Retry failed button
- [ ] Job history if practical
- [ ] Refresh/reconnect to running job

## Phase 10 — Testing

- [ ] Unit tests
- [ ] Shopify API mocks
- [ ] Google API mocks
- [ ] Variant matching tests
- [ ] Both variants test
- [ ] Already processed test
- [ ] Cancelled order test
- [ ] Retry test
- [ ] Idempotency test
- [ ] BEFORE failure test
- [ ] AFTER failure test
- [ ] Multi-store isolation test
- [ ] ETA test
- [ ] Date range test
- [ ] Typecheck
- [ ] Lint
- [ ] Full test suite

## Phase 11 — Deployment

- [ ] Create Cloudflare D1
- [ ] Create Cloudflare Queue
- [ ] Configure production secrets
- [ ] Deploy Worker
- [ ] Configure custom domain if desired
- [ ] Configure Shopify app URLs
- [ ] Configure allowed redirect URLs
- [ ] Install on test store
- [ ] Test with safe test orders
- [ ] Verify BEFORE sheet
- [ ] Verify quantity changes
- [ ] Verify AFTER sheet
- [ ] Test retry
- [ ] Test multi-store installation

## Definition of Done

- [ ] No core TODOs
- [ ] No hard-coded secrets
- [ ] No Admin API token in frontend
- [ ] Both target variants supported
- [ ] Date-range manual processing works
- [ ] BEFORE audit occurs before destructive mutation
- [ ] AFTER audit occurs after commit
- [ ] Failed jobs can be retried
- [ ] Duplicate processing is safe
- [ ] ETA/progress works
- [ ] Tests pass
- [ ] Documentation complete
- [ ] Cloudflare deployment documented
