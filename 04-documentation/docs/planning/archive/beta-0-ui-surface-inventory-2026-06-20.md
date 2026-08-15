# Beta-0 UI Surface Inventory - 2026-06-20

This document is the dated inventory artifact for `Beta-0 UI Surface Cleanup`.
It records exact file paths, retained dormant source surfaces, and observed
browser-smoke evidence from the per-surface slices and final acceptance pass.

2026-06-21 update: subsequent Grade Archive UI work renamed the user-facing GPA
summary to `Average GPA`, moved raw Grade Archive Records into the course modal
`Past Grades` tab, removed the modal `Record Count` summary card, and changed
the GPA summary calculation to use the most recent archive term with data. The
6/20 smoke evidence below is preserved as historical acceptance evidence; use
`docs/planning/archive/grade-archive-ui-update-2026-06-21.md` for the current UI contract.

## Scope

Primary paths:

- `/catalog`
- `/worksheet`
- Course modal opened from catalog, such as `/catalog?course-modal=...`
- Shared chrome visible on those paths

Non-primary static or historical pages remain inventory-only unless linked from
primary paths in a misleading way.

## Hidden From Primary Paths

These inherited surfaces should not appear in primary UCSD public paths:

- Rating, workload, professor-quality, OCE, SET/CAPE, and evaluation UI
- Friends dropdown, friend worksheet viewing, friend counts, and social wording
- Map view and walking-time display/settings
- Google Calendar direct export
- PNG export
- Availability, open seats, enrollment, waitlist, capacity, and demand controls
- Random course affordances
- OCE/evaluation Challenge links
- Public GraphQL playground links
- Original CourseTable external brand links when shown in shared chrome

## Intentionally Retained For Later Adaptation

These inherited surfaces may remain in code if they are not reachable from
primary public paths:

- Saved Search backend/schema/API path, guarded by auth state in the UI
- Auth/session scaffolding that can support later Beta-1 App DB/Auth work
- Worksheet persistence schema/API structures that can be adapted for Saved
  Worksheet work
- Backend/schema/GraphQL/generated-code surfaces that are dormant and do not
  leak unsupported UCSD UI

## Inventory-Only Static Or Historical Pages

These pages are not required to be fully rewritten in Beta-0:

- FAQ
- About
- Privacy
- Release notes
- Profile
- Login
- Challenge
- GraphiQL

If any of these pages are linked from `/catalog`, `/worksheet`, course modal, or
shared chrome with labels that imply currently supported UCSD capabilities, the
link or label should be cleaned up in Beta-0.

## Implementation Evidence

The following sections preserve the per-surface implementation evidence and end
with the final cross-surface #19 acceptance pass.

### Agent 1 / #15 Catalog Discovery Surface Cleanup

- Browser smoke URL(s): `http://127.0.0.1:3025/catalog` from the Agent 1 clean
  verification worktree, using a production frontend build, local anonymous
  API shim, and tracer Published Snapshot; screenshot:
  `/tmp/coursetable-ucsd-issue15-catalog-smoke.png`.
- Browser smoke confirms absent unsupported wording: real Chromium text check
  found no `workload`, `professor quality`, `rating`, `OCE`, `evaluation`,
  `friends`, `social`, `open seats`, `waitlist`, `enrollment`, `demand`,
  `random course`, or `I'm feeling lucky` wording on `/catalog`.
- Browser smoke confirms present supported UCSD concepts: `/catalog` showed
  keyword search, subject/area filters, season, advanced supported filters,
  `Archive Avg GPA`, `Record Count`, instructors, meeting/location columns,
  snapshot freshness, and result rows from the tracer UCSD snapshot. Opening
  Saved Search as an anonymous user showed `Sign in required.` and the smoke
  API recorded no `/api/savedSearches` requests.
- Hidden/retained source inventory:
  - `frontend/src/pages/Search.tsx` resets hidden inherited catalog filters and
    unsupported sort state on `/catalog`, so stale URLs or older saved searches
    cannot silently keep applying rating, workload, professor-rating,
    enrollment, or Quist filters after those controls are hidden.
  - `frontend/src/components/Search/ResultsHeaders.tsx`, `ResultsItem.tsx`,
    `ResultsGridItem.tsx`, `ResultsCols.module.css`, and `Results.module.css`
    hide inherited rating, workload, professor-quality, enrollment, friends,
    and catalog grid-toggle affordances from the catalog results surface while
    showing UCSD `Archive Avg GPA`, `Record Count`, instructors, meeting time,
    location, and snapshot-added date.
  - `frontend/src/components/Search/NavbarCatalogSearch.tsx`,
    `MobileSearchForm.tsx`, and `AdvancedPanel.tsx` hide inherited rating,
    workload, professor-rating, enrollment, and Quist controls while preserving
    keyword search, subject/area filters, season, days/time, course number,
    course attributes/meeting-type filters, building, and hide-conflicts.
  - `frontend/src/components/Search/Results.tsx` disables catalog grid
    switching while retaining worksheet reuse of the shared results component.
    `frontend/src/components/Search/RandomButton.tsx` hard-disables the
    inherited random-course affordance wherever shared chrome mounts it on
    `/catalog`.
  - `frontend/src/components/Search/SavedSearchesDropdown.tsx` keeps the Saved
    Search dropdown visible as later signed-in capability, renders a non-error
    sign-in-required state for anonymous users, and guards protected
    saved-search fetch/create/delete calls so they do not fire unless the store
    auth state is authenticated. Saved-search query strings are sanitized to
    supported catalog filters and supported sort fields before apply/save.
  - Backend, schema, GraphQL, generated code, and saved-search API endpoints
    remain in source for later App DB/Auth adaptation.
- Focused frontend test command(s): `bun run --cwd frontend test` passed in
  the Agent 1 clean verification worktree: 9 test files, 44 tests.
- Typecheck/check command(s): `bun run typecheck` passed; `git diff --check`
  passed. Production build for smoke also passed with
  `VITE_API_ENDPOINT=http://127.0.0.1:3025 bun run --cwd frontend build`.
- Remaining follow-up cleanup: the saved-search backend/schema/API path remains
  intentionally retained for later Beta-1 App DB/Auth adaptation; cross-surface
  acceptance remains with #19 after the parallel Beta-0 surface branches merge.

### Agent 2 / #16 Course Modal Surface Cleanup

- Browser smoke URL(s): `https://127.0.0.1:3000/catalog` to
  `https://127.0.0.1:3000/catalog?course-modal=S126-3612034979`
  using a local static catalog API shim at `http://127.0.0.1:4177`;
  screenshot: `/tmp/coursetable-ucsd-issue16-course-modal-smoke.png`.
- Browser smoke confirms absent unsupported wording: modal text check found no
  `rating`, `workload`, `professor quality`, `evaluation`, `OCE`,
  `SET-CAPE`, `CAPE`, or `friends` wording.
- Browser smoke confirms present supported UCSD concepts: modal showed
  `Archive Avg GPA`, `Record Count`, `Grade Archive Records`, UCSD catalog
  description, section, units, prerequisites, catalog source, meetings, and
  instructor rows.
- Hidden/retained source inventory:
  - `frontend/src/components/CourseModal/ucsdSnapshotCourse.ts` centralizes
    UCSD snapshot-course detection so missing or malformed archive metadata
    does not fall through to inherited CourseTable modal paths.
  - `frontend/src/components/CourseModal/CourseModal.tsx`,
    `Header/InfoRow.tsx`, `Header/ControlsRow.tsx`, and
    `OverviewPanel/OverviewPanel.tsx` use that detection to skip inherited
    GraphQL overview queries, evaluation tabs, OCE/demand/Yale external links,
    and evaluation-panel navigation for UCSD snapshot courses. The merged
    Beta-0 review also updates the UCSD snapshot-course browser title to use
    `UCSD Course Planner` instead of inherited `CourseTable` branding.
  - `frontend/src/components/CourseModal/OverviewPanel/UcsdSnapshotOverview.tsx`
    keeps UCSD catalog metadata, `Archive Avg GPA`, `Record Count`, and
    `Grade Archive Records`, and now renders a UCSD-specific missing
    Historical GPA Data/archive-metadata state instead of falling back to
    rating/workload/evaluation UI.
  - Inherited `EvaluationsPanel/*`, `OverviewRatings.tsx`, and
    `OverviewInfo.tsx` remain in code for dormant/inherited non-UCSD paths;
    backend, schema, GraphQL, and generated code were not deleted.
- Focused frontend test command(s): `bun run --cwd frontend test -- CourseModal
ModalHistoryBridge modalHistoryUrl`; full frontend test command:
  `bun run --cwd frontend test`.
- Typecheck/check command(s): `bun run typecheck`; `git diff --check`.
- Remaining follow-up cleanup: no CourseModal follow-up for #16. Cross-surface
  acceptance remains with #19 after the parallel Beta-0 surface branches merge.

### Agent 3 / #17 Anonymous Worksheet Surface Cleanup

- Browser smoke URL(s): `https://127.0.0.1:3003/worksheet?t=S126&sections=S126:259244,S126:260254`
  with Vite pointed at a local HTTPS static API shim
  (`VITE_API_ENDPOINT=https://127.0.0.1:8086`); the app consumed the share
  parameters and cleaned the visible URL to `https://127.0.0.1:3003/worksheet`.
  Final screenshot: `/tmp/coursetable-beta0c-worksheet-smoke-final.png`.
- Browser smoke confirms absent unsupported wording: headless Chrome DOM checks
  found no visible `Map`, walking-time, friends/social, `Google Calendar`,
  `PNG`, `workload`, `rating`, public/private worksheet, or demand wording in
  calendar view, list view, export menu, or worksheet settings modal.
- Browser smoke confirms present supported UCSD concepts: `Calendar` and `List`
  view controls remained visible to anonymous users; calendar view showed the
  shared `Anonymous Worksheet`, schedule conflict visibility, lock control, and
  calendar time-range settings; list view showed the S126 `CSE 8A` and
  `MATH 20A` sections with two anonymous remove buttons; export menu showed
  `Download as ICS` and `Export worksheet as URL`; Chrome downloaded
  `/tmp/coursetable-beta0c-downloads/S126_worksheet.ics`; share URL export
  produced the `Anonymous worksheet URL copied to clipboard` success toast;
  worksheet settings showed `Clear All Classes`.
- Hidden/retained source inventory:
  - `frontend/src/pages/Worksheet.tsx` no longer renders `WorksheetMap` from
    the public worksheet route, no longer renders mobile friends dropdowns, and
    passes walking-time display off for the calendar/sidebar path.
  - `frontend/src/components/Worksheet/NavbarWorksheetSearch.tsx` and
    `NavbarWorksheetSearch.module.css` keep anonymous `Calendar`/`List` view
    switching while hiding the inherited map toggle, friends dropdown, add
    friend dropdown, and saved worksheet selectors unless the user is
    authenticated.
  - `frontend/src/components/Worksheet/WorksheetList.tsx` now uses the
    worksheet-native stats and course list controls instead of the shared
    catalog results table, preventing worksheet list view from exposing
    inherited rating, workload, enrollment, and friends columns.
  - `frontend/src/components/Worksheet/WorksheetCalendarList.tsx` keeps
    hide/show, clear worksheet, ICS download, and share URL export while hiding
    direct Google Calendar export, PNG export, walking-time settings, and
    anonymous public/private worksheet controls.
  - `frontend/src/components/Worksheet/WorksheetCalendar.tsx` defaults
    walking-time computation/display off unless a future caller explicitly
    opts in.
  - `frontend/src/components/Worksheet/WorksheetStats.tsx` keeps anonymous
    worksheet identity, conflict summary, total courses, total credits, and
    skills/areas while removing inherited workload/rating summary stats.
  - `WorksheetMap.tsx`, `GoogleCalendarButton.tsx`, `PNGExportButton.tsx`,
    `AddFriendDropdown.tsx`, `FriendsDropdown.tsx`, worksheet persistence
    schema/API structures, backend/schema/GraphQL/generated code, and
    `useWorksheetDemand.ts` remain in source but are not reachable from the
    anonymous `/worksheet` path in this slice.
- Focused frontend test command(s):
  `bun run --cwd frontend test src/utilities/anonymousWorksheet.test.ts src/utilities/calendar.test.ts`.
- Typecheck/check command(s): `bun run typecheck`; `git diff --check`;
  `bun run --cwd frontend test`.
- Remaining follow-up cleanup: cross-surface #19 should rerun full gates after
  the parallel Beta-0 branches are merged into one worktree.

### Agent 4 / #18 Shared Chrome And Global Metadata Cleanup

- Browser smoke URL(s): `https://127.0.0.1:3019/catalog` and
  `https://127.0.0.1:3019/worksheet` from the main checkout on
  `beta0d-chrome-cleanup`.
- Browser smoke confirms absent unsupported wording: navbar, footer, and
  hydrated browser title did not contain `CourseTable`, `Yale`, `OCE`,
  `Challenge`, `GraphQL playground`, `GraphiQL`, `demand statistics`, or
  `student evaluations` on `/catalog` or `/worksheet`. The catalog navbar also
  did not show the inherited `I'm feeling lucky` random-course affordance.
- Browser smoke confirms present supported UCSD concepts: both paths showed
  `UCSD Course Planner`; navigation to `Catalog` and `Worksheet` remained; the
  footer showed `Anonymous Worksheet`; the hydrated title was
  `UCSD Catalog & Anonymous Worksheet`.
- Hidden/retained source inventory: `frontend/src/components/Navbar/Navbar.tsx`
  hides the Challenge link and inherited mobile static/support links from
  primary chrome and removes the random-course affordance from catalog chrome;
  `frontend/src/components/Navbar/MeDropdown.tsx` retains only
  beta-labeled sign-in/profile actions in the desktop account menu;
  `frontend/src/components/Footer.tsx` hides GraphQL playground, original
  CourseTable feedback/status/GitHub/LinkedIn/support links, and the inherited
  donation badge from primary footer chrome; `frontend/index.html` and
  `frontend/src/App.tsx` now use UCSD public catalog plus Anonymous Worksheet
  metadata; `frontend/src/utilities/constants.ts` replaces inherited
  Yale-campus search-speed phrases that can render inside catalog navbar chrome.
  Dormant `/challenge` and `/graphiql` routes/pages remain in source for
  inventory-only follow-up and are not linked from navbar/footer primary chrome.
- Focused frontend test command(s): `bun run --cwd frontend test` passed in the
  main checkout: 11 test files, 49 tests. The same command also passed earlier
  in an isolated Agent 4 worktree with 9 test files and 44 tests.
- Typecheck/check command(s): `bun run typecheck` and `git diff --check` passed
  in the main checkout. Both commands also passed earlier in an isolated Agent 4
  worktree with only the shared-chrome/global-metadata diff applied.
- Remaining follow-up cleanup: static/historical pages such as Challenge,
  GraphiQL, FAQ, About, Privacy, Release notes, Profile, and Login still need
  later inventory/adaptation before they are re-linked as current UCSD product
  surfaces.

### Agent 5 / #19 Beta-0 Final Cross-Surface Acceptance

- Browser smoke URL(s): `https://127.0.0.1:3031/catalog`,
  `https://127.0.0.1:3031/catalog?course-modal=S126-3171542616`, and
  `https://127.0.0.1:3031/worksheet?t=S126&sections=S126%3ACSE-TRACER-3%2CS126%3AMATH-TRACER-2`.
  The worksheet route consumed the anonymous share parameters and rendered at
  `https://127.0.0.1:3031/worksheet`. Smoke used Google Chrome via the Chrome
  DevTools Protocol with a temporary headed profile. The frontend pointed to a
  local static API shim at `http://127.0.0.1:4199` serving the tracked
  `api/static/catalogs/public/S126.json`, `api/static/metadata.json`, and an
  anonymous `/api/auth/check` response.
- Browser smoke confirms absent unsupported wording: full visible text checks
  on `/catalog`, course modal, `/worksheet`, and the worksheet export menu found
  no `workload`, `professor quality`, `rating`, `OCE`, `evaluation`, `friends`,
  `social`, `open seats`, `waitlist`, `enrollment`, `demand`,
  `Google Calendar`, `PNG`, `GraphQL playground`, `GraphiQL`,
  `I'm feeling lucky`, `CourseTable`, or `Yale` wording.
- Browser smoke confirms present supported UCSD concepts: `/catalog` showed
  `UCSD Course Planner`, `Archive Avg GPA`, and `Record Count`; opening Saved
  Search as an anonymous user showed `Sign in required.` and the smoke API
  recorded zero `/api/savedSearches` requests. The course modal showed
  `Grade Archive Records`, `Archive Avg GPA`, and `Record Count`. The worksheet
  showed `Anonymous Worksheet`, `Calendar`, `List`, `CSE 3`, and `MATH 2`.
  The export menu showed `Download as ICS` and `Export worksheet as URL`.
  Share export produced the `Anonymous worksheet URL copied to clipboard` toast
  and wrote
  `https://127.0.0.1:3031/worksheet?t=S126&sections=S126%3ACSE-TRACER-3%2CS126%3AMATH-TRACER-2`
  to the browser clipboard. The tracked tracer snapshot contains only TBA
  meetings, so the final smoke verified the ICS click path and TBA warning
  rather than producing a timed `.ics` file; timed ICS content remains covered
  by `frontend/src/utilities/calendar.test.ts`, and #17 previously verified a
  browser `.ics` download with timed worksheet data.
- Hidden/retained source inventory: primary shared chrome now links only
  `Catalog`, `Worksheet`, and beta sign-in/profile actions from
  `frontend/src/components/Navbar/Navbar.tsx`; primary footer links only
  `Catalog` and `Anonymous Worksheet` from `frontend/src/components/Footer.tsx`.
  FAQ, About, Privacy, release notes, Profile, Login, Challenge, and GraphiQL
  remain inventory-only static/history pages because they are not linked from
  `/catalog`, `/worksheet`, course modal, navbar, or footer with labels that
  imply currently supported UCSD capabilities. Dormant Saved Search
  backend/schema/API, auth/session scaffolding, worksheet persistence
  structures, backend/schema/GraphQL/generated code, map/walking-time files,
  Google Calendar export, PNG export, friends/social components, and worksheet
  demand code remain retained only where they are unreachable from the primary
  public UCSD paths.
- Focused frontend test command(s):
  `bun run --cwd frontend test src/queries/ucsdCatalogSnapshot.test.ts src/utilities/anonymousWorksheet.test.ts src/utilities/calendar.test.ts`
  passed with 3 test files and 10 tests.
- Typecheck/check command(s): `bun run typecheck` passed; `git diff --check`
  passed before this inventory update. Final #19 closeout reran the repository
  gates after this documentation change.
- Remaining follow-up cleanup: no Beta-0 primary-path blocker remains. The
  retained dormant source surfaces are intentionally available for later
  Beta-1 App DB/Auth and saved-data adaptation; static/history pages should
  stay inventory-only until a later slice rewrites and re-links them as current
  UCSD product surfaces.
