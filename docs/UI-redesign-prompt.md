# Codex Task — Redesign Order Operations UI

## Objective

Redesign the existing "Order Operations" web app to look like a polished, modern SaaS/admin dashboard.

The existing application is already functional. **Do NOT rewrite or break the existing business logic, Shopify API integration, order processing logic, authentication, date filtering, audit workflow, or job execution logic.**

This task is primarily a **frontend/UI/UX redesign**.

The application should use **Dark Mode as the default theme**, with an option for the user to switch between Dark Mode and Light Mode.

---

# 1. IMPORTANT RULES

Before making changes:

1. Inspect the existing project structure.
2. Understand the current components, API calls, state management, and business logic.
3. Preserve all existing functionality.
4. Do not mock Shopify data.
5. Do not replace real API calls with dummy/static data.
6. Do not change existing API contracts unless absolutely necessary.
7. Do not change authentication behavior.
8. Do not change the order-processing algorithm.
9. Do not change the audit-before-destructive-operation safety mechanism.
10. Do not change the target variant logic.
11. Do not remove any existing functionality just to simplify the UI.

The result should be a **visual and UX upgrade of the existing application**, not a rewrite of the application.

---

# 2. DESIGN DIRECTION

Create a premium internal operations dashboard.

Design characteristics:

- Dark mode by default
- Modern SaaS dashboard aesthetic
- Minimal
- Professional
- Clean
- Spacious
- High readability
- Subtle borders
- Soft shadows/glows
- Rounded cards
- Emerald/green primary accent
- Red only for destructive actions/warnings
- Avoid excessive colors
- Avoid gradients unless very subtle
- Strong typography hierarchy
- Excellent spacing
- Responsive on desktop, tablet, and mobile

Think:

"Linear + Vercel + modern Shopify admin tool"

rather than a traditional form/dashboard.

---

# 3. COLOR SYSTEM

### Dark Mode — DEFAULT

Use a dark neutral palette.

Example:

Background:
#0B0F0E

Secondary background:
#101614

Card:
#121918

Card hover:
#17201E

Border:
#26332F

Primary:
Emerald / Green

Primary hover:
Darker/brighter emerald depending on contrast

Main text:
Near white

Secondary text:
Muted gray-green

Success:
Green

Warning:
Amber

Danger:
Red

Info:
Blue

Do not use pure black everywhere.

The interface should have subtle depth between:

- page background
- cards
- inputs
- list items
- hover states

---

# 4. LIGHT MODE

Add a Light/Dark mode toggle.

Light mode should use:

- white/off-white background
- white cards
- subtle gray/green borders
- dark text
- emerald primary actions

The Light mode should be a proper theme, not simply an inverted version of Dark Mode.

Persist the user's theme preference using localStorage.

Behavior:

- First visit → Dark Mode
- If user changes theme → remember preference
- On future visits → restore selected theme

Avoid a flash of Light Mode before Dark Mode loads.

---

# 5. TOP NAVIGATION

Create a sticky top navigation bar.

Desktop layout:

LEFT:

[App Icon] Order Operations

RIGHT:

User information:

Nice Pal
nicepal.m@ramawaterfilter.com

[Store badge]
2myshopify.com

[Theme toggle]

[Log out]

The navigation should remain visible while scrolling.

Use subtle backdrop blur/transparency if appropriate.

On mobile:

- Keep logo/title visible
- Collapse secondary information
- Keep theme toggle and logout accessible
- Avoid horizontal overflow

---

# 6. PAGE HEADER

Below the navigation:

Small eyebrow:

ORDER OPERATIONS

Main heading:

Remove target variants

Next to heading add a small badge:

Destructive operation

Use a red/pink subtle badge with an appropriate alert/shield icon.

Description:

Matching line items will be set to quantity 0.
A BEFORE audit must succeed first.

Make:

"BEFORE audit"

visually emphasized in red.

The page header should feel much more polished than the current implementation.

---

# 7. OVERALL PAGE STRUCTURE

Use a centered responsive content container.

Suggested max width:

1200–1400px

Structure:

Page Header

↓

Step 1 — Configure Operation

↓

Step 2 — Choose Orders to Process

↓

Step 3 — Current Job

Use generous spacing between sections.

Each section should be a premium card.

---

# 8. STEP INDICATORS

Each major section should have a step indicator.

Example:

[1] Configure operation

[2] Choose orders to process

[3] Current job

Use a circular green step number.

Example:

● 1
Configure operation

The number should be visually prominent but not oversized.

---

# 9. CARD DESIGN

All major cards should have:

- rounded corners
- subtle border
- subtle shadow
- dark surface
- generous padding
- consistent spacing

Suggested:

border-radius: 16–20px

Cards should not look like floating white boxes.

Create a consistent reusable Card component if the current architecture allows it.

---

# 10. STEP 1 — CONFIGURE OPERATION

Title:

Configure operation

Inside:

## Date Selection

Desktop:

Start date                     End date

[ Calendar icon + date ]       [ Calendar icon + date ]

Use modern date inputs.

Make the entire input clickable.

Add a small helper row:

🌐 Dates are inclusive in Europe/London.

Use muted secondary text.

---

## Target Variants

Label:

Target variants

Display variant IDs as modern pills/chips.

Example:

[ 58780018377088 ]

[ 58414723465600 ]

The pills should work well in Dark Mode.

If the IDs are copied from existing state/configuration, keep the existing behavior.

---

## Primary Action

Bottom/right:

[ Preview eligible orders ]

Use:

- emerald button
- eye icon
- hover animation
- disabled/loading state

When clicked, preserve the existing functionality.

---

# 11. STEP 2 — CHOOSE ORDERS TO PROCESS

Card title:

Choose orders to process

Top right:

0 selected

This number should update dynamically based on actual selection.

---

## Select All

Add:

☐ Select all eligible orders

Use a custom modern checkbox if appropriate.

Make the entire label clickable.

---

# 12. ORDER LIST

Create a modern scrollable order list.

Each order should be a row/card.

Example:

┌──────────────────────────────────────────────┐
│ ☐  🛍   #8433 · Aug 30, 2026 23:57:26Z      │
│          POSTreat FluoRid Refill Media...    │
│          KokoCarb Cartridges...              │
└──────────────────────────────────────────────┘

Requirements:

- Checkbox on left
- Shopify/order icon
- Order number
- Order date/time
- Product/line item summary
- Hover state
- Selected state
- Keyboard accessibility
- Smooth transitions

Do NOT truncate important information excessively.

Use line clamping where necessary.

---

# 13. ORDER LIST SCROLL AREA

The order list should have a controlled maximum height.

Use a modern scrollbar.

The scrollbar should visually fit the Dark Mode theme.

Do not let a large number of orders make the entire page excessively tall.

---

# 14. SELECTION STATES

When an order is selected:

- subtle emerald border
- slightly different background
- checkbox becomes clearly selected
- maintain good contrast

When hovering:

- subtle surface change

Do not use aggressive animations.

---

# 15. INFORMATION MESSAGE

Below the order list:

Use an information callout:

ⓘ Both target variants will be set to 0 when both exist in a selected order.

Use a subtle blue/green/neutral information treatment.

Do not make it look like an error.

---

# 16. EXECUTE BUTTON

Bottom-right:

[ ▶ Execute selected orders ]

The button should:

- use primary emerald styling
- have play/execute icon
- show disabled state when no orders are selected
- show loading state while execution is starting
- preserve all existing execution behavior

Do not allow the UI to imply execution happened before the backend confirms it.

---

# 17. DESTRUCTIVE ACTION SAFETY

This is extremely important.

The current application performs a destructive Shopify operation.

Preserve the existing safety rule:

BEFORE audit must succeed before Shopify orders are modified.

The UI should communicate this clearly.

Never change this behavior during the redesign.

If the current application has an audit confirmation/result state, make that state visually clear.

Examples:

Audit successful → green success state

Audit failed → red error state

Audit running → spinner/progress state

---

# 18. STEP 3 — CURRENT JOB

Title:

Current job

Status:

Ready for selection

Show progress percentage on the right:

0.0%

Add a thin progress bar underneath.

Example:

Ready for selection                         0.0%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use an animated progress bar only when a real job is running.

Do not fake progress.

---

# 19. JOB STATISTICS

Create a responsive statistics grid.

Desktop:

3 columns × 2 rows

Statistics:

Orders found
Processed
Successful

Skipped
Failed
Remaining

Example:

┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ 📄 13           │ │ ◌ 0            │ │ ✓ 0            │
│ Orders found    │ │ Processed      │ │ Successful     │
└────────────────┘ └────────────────┘ └────────────────┘

┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ » 0             │ │ ! 0            │ │ ◷ 13           │
│ Skipped         │ │ Failed        │ │ Remaining      │
└────────────────┘ └────────────────┘ └────────────────┘

Use subtle semantic colors for icons:

Orders found → green/neutral
Processed → blue
Successful → green
Skipped → amber
Failed → red
Remaining → purple/blue

Do not make the entire card brightly colored.

Only icons/accent borders should use semantic colors.

---

# 20. JOB INFORMATION

Bottom area:

Left:

ETA: Calculating...

Right:

Last order: —

Use muted text.

These values must continue to come from the existing job state.

Do not hardcode them.

---

# 21. CANCEL BUTTON

Bottom-left:

[ ✕ Cancel operation ]

Use a danger/red button.

It should be visually distinct but not oversized.

Preserve the existing cancellation behavior.

If cancellation requires confirmation, use a modern confirmation dialog.

---

# 22. RESPONSIVE DESIGN

The application must work properly at:

Desktop:
1440px+

Laptop:
1024–1439px

Tablet:
768–1023px

Mobile:
320–767px

On mobile:

- Cards stack vertically
- Date inputs become one column
- Statistics become 1 or 2 columns depending on width
- Order rows remain readable
- Buttons become full-width where appropriate
- Header information can collapse
- No horizontal scrolling

---

# 23. COMPONENT ARCHITECTURE

If the existing application uses React, create/reuse reusable components such as:

- AppShell
- Navbar
- ThemeToggle
- PageHeader
- StepCard
- DateRangePicker
- VariantBadge
- OrderList
- OrderRow
- SelectionCheckbox
- InfoCallout
- ProgressBar
- JobStatsGrid
- JobStatCard
- StatusBadge
- Button
- ConfirmationDialog

Do not create unnecessary abstraction if the existing codebase has a different sensible architecture.

Prefer maintainable components over one huge page component.

---

# 24. ICONS

Use Lucide React or the icon library already installed in the project.

Suggested icons:

- Shield
- Trash2
- Calendar
- Globe
- Eye
- ShoppingBag
- Play
- Check
- X
- AlertTriangle
- Info
- Clock
- Loader
- LogOut
- Sun
- Moon

Do not use random Unicode emojis for the production UI.

---

# 25. TYPOGRAPHY

Use a modern sans-serif font.

Prefer:

Inter

or the font already used by the application if it is already configured.

Typography hierarchy:

Page title → large/bold

Section title → medium/bold

Labels → medium

Body → regular

Metadata → smaller/muted

Avoid excessive font sizes.

---

# 26. MICRO INTERACTIONS

Add subtle interactions:

Buttons:

- hover
- active
- disabled
- loading

Cards:

- subtle hover where appropriate

Checkboxes:

- smooth checked transition

Theme toggle:

- smooth transition

Order selection:

- subtle background/border transition

Do not over-animate the interface.

Keep animations around 150–250ms.

Respect:

prefers-reduced-motion

---

# 27. LOADING STATES

All asynchronous operations must have clear loading states.

Examples:

Preview eligible orders:

[ spinner ] Loading orders...

Execution:

[ spinner ] Starting operation...

Order processing:

Show real job progress.

Do not freeze the UI.

Prevent duplicate submissions while an operation is starting.

---

# 28. ERROR STATES

Create polished error UI.

Examples:

API error
Audit failure
Order processing failure
Network failure
Authentication/session issue

Use a clear:

- icon
- title
- human-readable message
- optional retry action

Do not expose raw stack traces to users.

Keep detailed errors available in console/logging where appropriate.

---

# 29. ACCESSIBILITY

Follow accessibility best practices:

- semantic HTML
- keyboard navigation
- visible focus states
- proper labels
- aria-label where needed
- sufficient color contrast
- buttons must have meaningful labels
- checkboxes must be accessible
- dialogs must trap focus appropriately

Dark Mode must maintain good contrast.

---

# 30. THEME IMPLEMENTATION

Use a proper theme system.

Preferred approach if Tailwind is used:

dark mode via class strategy.

The root application should default to:

dark

Example concept:

<html class="dark">

The theme toggle should switch:

dark ↔ light

Persist preference in:

localStorage

Key example:

theme

Possible values:

dark
light

Default:

dark

---

# 31. IMPORTANT DATA BEHAVIOR

The following must continue working exactly as before:

- Shopify authentication
- Store identification
- Logout
- Date range selection
- Europe/London date interpretation
- Target variant configuration
- Preview eligible orders
- Eligible order retrieval
- Select individual orders
- Select all orders
- Selected order count
- BEFORE audit
- Destructive execution
- Setting matching target line items to quantity 0
- Job progress
- Orders found
- Processed
- Successful
- Skipped
- Failed
- Remaining
- ETA
- Last processed order
- Cancellation
- Error handling

Do not modify these unless required for UI integration.

---

# 32. VISUAL REFERENCE

Use the provided redesign screenshot as visual inspiration.

The target style should have:

- large clean cards
- step-based workflow
- emerald accents
- modern order rows
- clean statistics
- generous whitespace
- premium SaaS appearance

However, adapt the design specifically for **Dark Mode as the default**.

Do not blindly copy the screenshot's light theme.

---

# 33. CODE QUALITY

After implementing:

1. Remove unused CSS/classes/components.
2. Remove unnecessary duplicate styles.
3. Ensure no console errors.
4. Ensure no React warnings.
5. Ensure no hydration issues.
6. Ensure responsive behavior.
7. Ensure theme persistence works.
8. Ensure existing API functionality still works.
9. Ensure destructive operation safeguards are untouched.
10. Run the project's existing lint/typecheck/build commands.

Fix any errors introduced by the redesign.

---

# 34. FINAL ACCEPTANCE CRITERIA

The redesign is complete only when:

- Dark Mode is the default.
- Light Mode works.
- Theme preference persists.
- UI looks like a professional SaaS admin application.
- Existing functionality remains intact.
- No fake data has been introduced.
- No Shopify business logic has been changed.
- BEFORE audit protection remains intact.
- Order selection works.
- Select-all works.
- Preview works.
- Execute works.
- Job progress works.
- Cancel works.
- Error states work.
- Mobile layout works.
- Keyboard accessibility works.
- No horizontal overflow.
- No console errors.
- Production build succeeds.

At the end, provide a concise summary of:

1. Files changed
2. UI improvements
3. Theme implementation
4. Any technical decisions
5. Tests/build commands executed
6. Any remaining issues