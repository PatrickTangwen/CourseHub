# Beta-1 Saved Worksheet Acceptance

Status: acceptance record for issue #26.

Date: 2026-06-21

## Scope

- Parent PRD: [#24](https://github.com/PatrickTangwen/coursetable-ucsd/issues/24)
- Acceptance issue:
  [#26](https://github.com/PatrickTangwen/coursetable-ucsd/issues/26)
- Planning doc:
  `docs/planning/archive/beta-1-save-anonymous-worksheet-to-account-2026-06-21.md`
- Baseline commit before this acceptance note: `4201c38`

This record validates the saved worksheet save and restore slices implemented
by #27 and #25. It does not expand the product scope beyond explicit save,
minimal restore, missing Section ID warning, and account-private ownership.

## Commands

Passed:

```bash
bun run --cwd api test savedWorksheets.routes.test.ts
bun run --cwd frontend test savedWorksheet.test.ts
bun run typecheck
FRONTEND_ENDPOINT=http://127.0.0.1:4178 VITE_API_ENDPOINT=http://127.0.0.1:3011 bun run --cwd frontend build
bun run checks
```

The browser smoke also exercised the running local Compose API stack at
`https://localhost:3010`.

## Browser Smoke

Browser automation used system Google Chrome through Playwright. Playwright was
available in the Codex runtime, so no project dependency was added.

The current dev frontend still serves a self-signed HTTPS certificate that the
browser rejects. For this acceptance run, the smoke used the fallback allowed
by #26:

- Built frontend served over `http://127.0.0.1:4178`.
- Local HTTP API proxy at `http://127.0.0.1:3011`.
- Proxy target: `https://localhost:3010`.
- The proxy rewrote the dev API `Secure; SameSite=None` session cookie to an
  HTTP-local `SameSite=Lax` cookie for this smoke only.

Raw screenshots, the downloaded ICS file, and the machine-readable summary were
stored under this gitignored path:

```text
artifacts/saved-worksheet-acceptance/issue26-2026-06-21T20-26-56-984Z/
```

## Evidence Summary

Validated:

- `/worksheet` loaded from the HTTP fallback origin without certificate errors.
- Anonymous Worksheet was created from a share URL with two valid Section IDs:
  `S126:259244` and `S126:260254`.
- A stale Section ID, `S126:STALE-404`, produced the expected missing-section
  warning.
- ICS export downloaded an `.ics` file containing the expected CSE 8A and
  MATH 20A events.
- Share URL export copied a URL containing the expected Section IDs.
- Verified UCSD Email sign-in did not automatically save the Anonymous
  Worksheet; the saved worksheet list was empty immediately after login.
- Explicit Save created a Saved Worksheet owned by the signed-in App User ID.
- Logout plus a fresh browser context could sign in as the same user and
  restore the Saved Worksheet.
- Restored local worksheet state preserved `S126:259244`, `S126:260254`, and
  `S126:STALE-404`.
- The restored worksheet showed the two available course cards plus the
  missing-section warning.
- A different signed-in test user had an empty saved worksheet list and a
  direct read of the first user's worksheet returned
  `404 SAVED_WORKSHEET_NOT_FOUND`.

Expected local-smoke noise:

- The cross-user isolation check intentionally produced one HTTP 404 for the
  protected Saved Worksheet detail route.
- The production frontend build attempted Sentry ingest requests during the
  headless run; local smoke ignored those network aborts because they were not
  app-route failures and no Sentry credentials are part of local validation.

## Outcome

#26 passed. Parent #24 can be closed after #26 is closed with this evidence
linked.
