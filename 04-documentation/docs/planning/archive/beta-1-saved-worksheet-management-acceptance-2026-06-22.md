# Beta-1 Saved Worksheet Management Acceptance

Status: acceptance record for issue #34.

Date: 2026-06-22

## Scope

- Parent PRD: [#28](https://github.com/PatrickTangwen/coursetable-ucsd/issues/28)
- Acceptance issue:
  [#34](https://github.com/PatrickTangwen/coursetable-ucsd/issues/34)
- Planning doc:
  `docs/planning/archive/beta-1-saved-worksheet-management-2026-06-22.md`
- Baseline commit before this acceptance note: `e2ad522`
- Final interaction-alignment commit: `ddf597a`

This record validates the integrated Beta-1 Saved Worksheet Management flow
after #29 through #33. It does not expand scope into multi-term support,
automatic Local Worksheet merge, sharing controls, friends, demand,
availability data, or worksheet-level GPA aggregation.

Post-acceptance correction: initial #34 acceptance included a separate Local
Worksheet import prompt. Follow-up review aligned the UX with the original
CourseTable interaction model: signed-out and signed-in users share the same
visible worksheet flow, and sign-in changes the persistence backend rather than
showing a parallel Local Worksheet save/import prompt.

## Commands

Passed:

```bash
bun run --cwd frontend test src/components/Worksheet/WorksheetStats.test.tsx
bun run --cwd frontend test src/components/Worksheet/WorksheetStats.test.tsx src/components/Worksheet/NavbarWorksheetSearch.test.tsx src/slices/WorksheetSlice.savedWorksheets.test.ts src/utilities/anonymousWorksheet.test.ts src/utilities/course.test.ts src/utilities/calendar.test.ts
bun run typecheck
bun run --cwd frontend test
bun run checks
API_PORT=3014 api/compose/local-validation-up.sh
API_PORT=3014 api/compose/local-validation-schema.sh
curl -ksS https://localhost:3014/api/ping
curl -fsS http://localhost:8085/healthz
FRONTEND_ENDPOINT=http://127.0.0.1:4179 VITE_API_ENDPOINT=http://127.0.0.1:3015 bun run --cwd frontend build
```

Expected local-smoke notes:

- `API_PORT=3010 api/compose/local-validation-up.sh` was attempted first, but
  the host port was already allocated. The validation stack was then started on
  `API_PORT=3014`.
- `local-validation-schema.sh` printed the existing
  `Failed to find Response internal state key` drizzle-kit message before
  reporting `[✓] Changes applied`.
- The frontend build reported existing warnings for `gapi-script` eval usage,
  missing Sentry auth token, and large chunks.

## Browser Smoke

Browser automation used the in-app browser against the local validation stack.
The current local frontend preview path still uses self-signed HTTPS, so this
smoke used the same HTTP fallback pattern as earlier Beta-1 acceptance:

- Built frontend served over `http://127.0.0.1:4179`.
- Local HTTP API proxy at `http://127.0.0.1:3015`.
- Proxy target: `https://localhost:3014`.
- The proxy added the local CORS header for the smoke origin and rewrote the
  dev API `Secure; SameSite=None` session cookie to an HTTP-local
  `SameSite=Lax` cookie for this smoke only.

No screenshots, traces, cookies, verification codes, or raw local artifacts are
committed with this note.

## Evidence Summary

Validated:

- Signed-in `/worksheet` loaded with a real account Main Worksheet for active
  term `S126`.
- Header selector showed Main Worksheet, existing extra Saved Worksheets, and
  the blank `New Worksheet` create action.
- Creating a blank Saved Worksheet made it active immediately.
- Adding CSE 8A from Catalog targeted the active Saved Worksheet and persisted
  after reloading `/worksheet`.
- Summary kept the compact card layout and showed `Total courses`,
  `Total credits`, and `Skills & Areas`.
- Summary did not show CourseTable workload, rating, friends, demand, or
  worksheet-level Average GPA metrics.
- Renaming the extra Saved Worksheet updated the active header and selector.
- Deleting the active extra Saved Worksheet returned the page to Main Worksheet
  and preserved a valid account worksheet.
- Signed-out Catalog add still wrote to the browser-local worksheet path.
- After the interaction-alignment follow-up, signed-in `/worksheet` opens the
  active account worksheet, normally Main Worksheet, without displaying a
  separate `Local Worksheet`, `Save Local Worksheet`, or
  `sections in this browser` prompt.
- Browser-local worksheet state is not automatically merged, synced, or cleared
  when the signed-in account worksheet opens.
- At a 390px-wide viewport, worksheet header controls remained usable and
  button text did not overflow. The page still had a small horizontal scroll
  width from the calendar grid, which is outside the header-control scope.
- Existing share URL, conflict detection, and ICS export behavior are covered
  by the targeted regression suite listed above.

## Outcome

#34 passes with the follow-up interaction alignment in `ddf597a`. Parent #28
should be read with the updated PRD and ADR 0010 interaction-alignment note.
