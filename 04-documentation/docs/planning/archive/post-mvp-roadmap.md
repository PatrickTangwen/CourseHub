# Post-MVP Roadmap

最后更新：2026-06-20

本文定义 MVP-1 完成后的详细后续工作。它不是 MVP-1 的验收范围。MVP-1 的当前执行规格见 `docs/planning/archive/mvp-1-spec.md`。

## 1. Guiding Principles

Post-MVP work should only start after MVP-1 proves:

- CSE/MATH Catalog Snapshot generation works.
- CourseTable fork can consume UCSD Course/Section/Meeting data.
- Anonymous worksheet, conflict detection, share URL, and ICS export are stable.

Do not add accounts, databases, GE, or SET/CAPE before the file-first data contract is stable.

Never add:

- open seats / seats available filter
- seat availability history
- waitlist availability
- enrollment tracker
- real-time WebReg availability
- worksheet demand / “in main worksheets”
- friends taking course

Those are intentionally excluded product directions, not deferred MVP features.

## 2. Beta-1: App DB And Auth

Goal:

Add user persistence without changing Catalog Snapshot as the course-data read contract.

### 2.1 App DB

Purpose:

- users
- saved worksheets
- saved searches
- wishlist
- privacy settings
- optional share records

Candidate tables:

- `users`
- `worksheets`
- `worksheet_sections`
- `wishlist_courses`
- `saved_searches`
- `shared_worksheets`

Acceptance:

- User can save an Anonymous Worksheet into their account.
- User can load saved worksheets on another browser.
- Saved worksheet stores Section IDs, not title/professor/time.
- Missing Section IDs after snapshot changes produce warnings.
- Account data is isolated per user.

### 2.2 Auth

Recommended first implementation:

- Google OAuth restricted to `ucsd.edu`
- or email magic link / verification code

Do not implement:

- unofficial UCSD SSO scraping
- personal UCSD account dependency
- SET/CAPE login coupling

Acceptance:

- Non-UCSD email is rejected or limited, depending on product policy.
- Login/logout works in dev and deployed environments.
- Session persistence is documented.
- Local dev auth setup is documented.

### 2.3 Saved Searches

Purpose:

- Save catalog filter/sort/search state.
- Restore saved search as URL/filter state.

Acceptance:

- User can save current catalog search.
- User can rename/delete saved search.
- Saved search does not include availability filters.
- Saved search remains valid across snapshot refresh where possible.

### 2.4 Wishlist

Purpose:

- Track courses the user is interested in independent of a specific section.

Use Course IDs, not Section IDs.

Acceptance:

- User can wishlist a Course.
- Wishlist survives browser/device changes.
- Course missing from active snapshot shows stale/unavailable warning.

## 3. Beta-2: Multi-Term Support

Goal:

Support multiple schedule snapshots while preserving clear term identity.

Scope:

- multiple active/public terms
- term selector
- multiple Catalog Snapshots
- worksheet tied to one term
- share URL includes term

Acceptance:

- User can select among supported terms.
- Catalog Snapshot exists per supported term.
- Worksheet cannot mix Sections from different terms unless explicitly designed later.
- Share URL restores correct term.
- GPA Historical Data remains cross-term archive data and is not confused with schedule term.

Implementation notes:

- Treat `Active Planning Term` as MVP-1 term only.
- Introduce `Supported Term` after MVP-1.
- Keep Term Date Range configured per term.

## 4. Beta-3: Course Data Store

Goal:

Introduce a normalized source of truth for source records, import audit, and multi-term query support.

This is separate from App DB.

### 4.1 Course Data Store Responsibilities

Potential responsibilities:

- raw source snapshots registry
- import runs
- normalized courses
- normalized sections
- normalized meetings
- normalized grade archive records
- normalized catalog metadata
- snapshot generation source
- parser quality reports

Candidate tables:

- `import_runs`
- `source_snapshots`
- `subjects`
- `terms`
- `courses`
- `sections`
- `meetings`
- `instructors`
- `section_instructors`
- `catalog_course_metadata`
- `grade_archive_records`
- `course_gpa_summaries`

Acceptance:

- Import run history is queryable.
- Failed runs preserve error details.
- Snapshot generation can read from the store.
- Re-running import is idempotent for the same source snapshot/run.
- Course/Section IDs remain stable.

### 4.2 Hasura Decision Point

Hasura is optional.

Use Hasura if it clearly helps with:

- GraphQL compatibility with CourseTable patterns
- generated query types
- admin inspection
- rich query needs

Avoid Hasura if:

- static snapshot remains enough
- it adds schema/codegen complexity without user benefit
- it makes local dev harder

Acceptance for adopting Hasura:

- An ADR explains why Hasura was chosen.
- Local setup is documented.
- Snapshot generation does not require frontend user path to make live GraphQL calls unless explicitly redesigned.

## 5. Beta-4: UCSD College GE Mapping

Goal:

Add advisory UCSD college GE metadata.

This is a separate data product, not a simple filter.

### 5.1 Initial Scope

Start with 1-2 colleges, not all colleges.

For each rule store:

- college
- requirement group
- requirement name
- course subject
- course number
- effective academic year
- source URL
- source checked date
- status: confirmed / needs review / deprecated

Acceptance:

- Source URL exists for every GE match.
- Academic year is explicit.
- UI says advisory only.
- Course detail shows GE badges.
- Catalog can filter by selected college GE requirement.
- No degree-audit claim is made.

### 5.2 Explicit Non-Scope

Do not build in this phase:

- full degree audit
- major planning
- “requirement completed” tracking
- transfer credit logic
- eligibility logic

## 6. Beta-5: Google Calendar Direct Export

Goal:

Add direct Google Calendar export after auth is stable.

Prerequisites:

- Auth exists.
- Google OAuth/Calendar API credentials exist.
- ICS export behavior is stable.

Acceptance:

- User can authorize calendar write permission.
- User can export selected worksheet.
- TBA/arranged Meetings are skipped with warning.
- Conflicts do not block export.
- Permission failures are recoverable.
- ICS export remains available as the non-OAuth fallback.

## 7. Beta Optional: PNG Export

Goal:

Export worksheet calendar as image.

Acceptance:

- Calendar grid renders correctly.
- Long course titles do not overflow.
- Desktop and mobile behavior is defined.
- Dark/light mode behavior is defined.
- Exported image is readable.
- Visual tests or screenshot checks cover common cases.

Do not include this in core Beta unless there is clear user demand.

## 8. Later: SET/CAPE Evaluation Data

Goal:

Potentially add course/professor evaluation data without risking a personal UCSD account or violating access expectations.

Rules:

- Do not use a personal UCSD account as production infrastructure.
- Do not fetch SET/CAPE live during user browsing.
- Prefer official export/API/permission.
- If manual snapshots are used, keep them low-frequency and policy-reviewed.
- Evaluation pipeline must be separate from schedule/catalog/GPA pipeline.

Acceptance before implementation:

- Legal/policy boundary documented.
- Data access method documented.
- Request budget documented.
- Cache/update strategy documented.
- Source/update date visible in UI.

Possible outputs:

- evaluation summary
- professor/course evaluation fields
- AI summaries only if source data is permitted and cached

Do not mix evaluation data with GPA naming. GPA remains historical grading outcome, not rating/workload.

## 9. Later: Production Deployment And Automation

Goal:

Turn MVP/Beta into a maintained service.

Work items:

- frontend hosting
- backend hosting if App DB/auth exists
- scheduled snapshot generation
- import failure alerts
- source change alerts
- Published Snapshot rollback story
- privacy/data disclaimer pages
- Sentry or equivalent monitoring

Acceptance:

- Scheduled generation runs successfully.
- Failure does not publish partial snapshot.
- Alert includes failed source/subject/reason.
- User-facing site still serves last Published Snapshot after failed run.
- Deployment runbook exists.

## 10. Later: Expand Subject Coverage

Goal:

Expand beyond CSE/MATH through configuration.

Acceptance:

- Adding a subject only requires config.
- Parser reports subject-level row counts and errors.
- New subject has Schedule, Catalog, and Grade Archive fixture coverage.
- Snapshot validation rejects a configured subject with missing source data.

Recommended expansion:

1. CSE + MATH
2. Add high-demand STEM subjects
3. Add writing/GE-heavy subjects after GE strategy is mature

## 11. Later: Search Improvements

Possible additions:

- units filter, if catalog units parsing is stable
- department/school grouping, if data source is reliable
- advanced instructor filter
- saved search sharing
- query suggestions
- typo-tolerant search

Do not add:

- availability filters
- enrollment sort
- demand sort

Acceptance:

- Search improvements remain snapshot-backed.
- URL state remains shareable.
- Filter semantics are documented.

## 12. Later: Prerequisite Graph And Eligibility Research

Goal:

Evaluate whether structured UCSD prerequisite parsing is worth adding after the Catalog Snapshot and Course Data Store are stable.

Reference:

- [`wllmwu/course-grapher`](https://github.com/wllmwu/course-grapher): UCSD course planning tool that parses the UCSD online course catalog and builds a prerequisite relationship graph.

Possible outputs:

- structured prerequisite graph
- prerequisite visualization on course detail
- advisory prerequisite path exploration
- parser quality report for prerequisite text patterns

Do not implement until:

- raw `prerequisites_text` display is stable
- Course Data Store design exists
- stale or ambiguous catalog language can be represented without false eligibility claims

Do not claim:

- degree audit accuracy
- major completion status
- guaranteed enrollment eligibility
- transfer credit reasoning

Acceptance before implementation:

- An ADR defines graph semantics, source freshness, uncertainty handling, and UI wording.
- Parser fixtures cover ambiguous prerequisite text, alternatives, consent-of-instructor clauses, and concurrent enrollment language.
- UI labels the result as advisory.

## 13. Later: Data Quality Tooling

Goal:

Make parser/source drift visible.

Work items:

- import quality dashboard
- unmatched schedule/catalog/grade archive report
- raw source diff report
- parser warning taxonomy
- fixture refresh workflow

Acceptance:

- Import report shows fetched/parsed/error counts by subject/source.
- Warnings are categorized.
- Known source format drift is visible before it reaches users.

## 14. Post-MVP Issue Order

Recommended order after MVP-1:

1. App DB schema and local dev setup
2. Auth
3. Save Anonymous Worksheet to account
4. Saved worksheets list/detail
5. Wishlist
6. Saved searches
7. Multi-term snapshots
8. Course Data Store design ADR
9. Course Data Store implementation
10. Hasura decision, only if justified
11. GE mapping pilot
12. Prerequisite graph research ADR
13. Google Calendar direct export
14. Deployment automation
15. Subject expansion
16. SET/CAPE evaluation access review

## 15. Post-MVP Non-Negotiables

Keep these constraints unless explicitly revisited with a new ADR:

- Availability Data is excluded.
- GPA is not rating/workload/professor quality.
- Section ID remains worksheet/share identity.
- SET/CAPE is never fetched live in user browsing.
- Hasura is optional, not assumed.
- GE metadata is advisory, not degree audit.

## 16. 2026-06-20 Change Note: External Plus/Minus Grade Distribution Reference

Post-MVP course detail can add a small external reference near the Past Grades
raw Grade Archive Records table:

- Reference URL: [MyClassGrades UCSD](https://myclassgrades.com/school/ucsd)
- Placement: near the raw Grade Archive Records table in the Past Grades tab or near the Historical GPA Data explanation in the course detail modal.
- Suggested UI wording: "UCSD's Instructor Grade Archive reports A/B/C/D/F/W/P/NP buckets. For a third-party view of more detailed plus/minus grade distribution, see MyClassGrades UCSD."

This should remain an outbound reference, not a new MVP-1 source of truth.

Rules:

- Do not import, scrape, or normalize MyClassGrades data without a separate source/legal/policy review.
- Do not merge MyClassGrades values into Average GPA, Record Count, or Grade Archive Records.
- Do not present the link as official UCSD data unless the source relationship is verified.
- Keep the UI wording clear that Instructor Grade Archive remains the platform's primary Historical GPA Data source.

Acceptance before implementation:

- Course detail shows the link only as a contextual external reference.
- Link opens in a new tab and is labeled as third-party.
- The Grade Archive Records table remains understandable without visiting the external site.
- A short product note explains that MyClassGrades may expose more detailed plus/minus buckets than UCSD's Instructor Grade Archive table.

## 17. 2026-06-20 Change Note: Beta-0 UI Surface Cleanup Before App DB/Auth

The first post-MVP implementation slice should be `Beta-0 UI Surface Cleanup`.
This slice exists to make the public UCSD catalog and Anonymous Worksheet surfaces
truthful before adding signed-in persistence.

Scope:

- Remove or hide inherited CourseTable/Yale wording that appears in public MVP
  paths, especially `Workload`, ratings, professor-quality, OCE/evaluation, and
  social/friends language.
- Remove or hide public-path affordances for features that are not currently
  supported UCSD product capabilities, including friends, wishlist,
  Google Calendar direct export, map/walking-time views, and
  profile/login flows when they imply completed saved-user functionality.
- Saved Search is the catalog exception: the existing saved searches dropdown
  may remain visible because it is a planned Beta-1 App DB/Auth capability and
  the inherited backend/schema/API path can plausibly be adapted.
- Anonymous users opening Saved Search should see a non-error sign-in-required
  state, not a failed API request toast.
- Preserve Average GPA, catalog `Record Count`, raw Grade Archive Records,
  Catalog Snapshot loading, Anonymous Worksheet behavior, share URL restore,
  conflict detection, and ICS export.
- If a UCSD snapshot course lacks Historical GPA Data or archive metadata, show
  a UCSD-specific missing-data state rather than falling back to inherited
  CourseTable rating/workload/evaluation UI.
- Do not add App DB, Auth, Course Data Store, Hasura, GE mapping, SET/CAPE,
  Google Calendar API integration, or new persistence behavior in this slice.

Primary page coverage:

- `/catalog`
- `/worksheet`
- Course modal opened from catalog, such as `/catalog?course-modal=...`
- Shared chrome that appears on those paths, including navbar, footer, global
  notices, and route-level loading/error states

Non-primary static or historical pages such as FAQ, About, Privacy, release
notes, Challenge, GraphiQL, Profile, and Login are inventory-only in this slice
unless they are linked from the primary paths in a way that misleads users about
currently supported UCSD capabilities.

Catalog cleanup boundary:

- Keep keyword search, subject filter, course-level filter, days/time filtering,
  meeting-type filter, hide-conflicts, course modal entry, snapshot freshness,
  Average GPA, catalog `Record Count`, and the Saved Search dropdown exception.
- Hide inherited rating, workload, professor-quality, evaluation, social,
  availability, enrollment, waitlist, demand, random-course, and unsupported
  grid/map-style affordances from the UCSD catalog path.
- Do not redesign the catalog UI in this slice; prefer scoped cleanup of
  misleading inherited affordances.

Worksheet cleanup boundary:

- Keep calendar view, list view, add/remove Section, hide/show course, clear
  worksheet, share URL export, ICS download, conflict visibility, and calendar
  lock/time-range controls.
- Hide map view, walking-time display/settings, friends dropdown, friend
  worksheet viewing, Google Calendar direct export, PNG export, public/private
  worksheet settings for the anonymous worksheet path, and rating/workload stats
  in worksheet summary.
- PNG export remains optional later scope; hiding it in Beta-0 does not reject
  future implementation after visual export requirements are defined.

Shared chrome cleanup boundary:

- Update global title and metadata away from Yale/CourseTable evaluation/demand
  wording and toward UCSD public catalog plus Anonymous Worksheet wording.
- Hide `RandomButton`, OCE/evaluation `Challenge`, and public links to GraphQL
  playground from primary UCSD paths.
- Keep future sign-in/profile entry points only if their labels do not imply
  completed saved worksheet or full account persistence behavior.
- Hide or replace inherited CourseTable external brand links, including
  original CourseTable GitHub, LinkedIn, and donation links, when they appear in
  shared chrome on primary paths.
- Keep FAQ, About, Privacy, release notes, Profile, Login, Challenge, and
  GraphiQL as inventory-only pages unless primary-path links or labels mislead
  users about currently supported UCSD capabilities.

Issue slicing:

- Implement Beta-0 as one GitHub issue with an internal checklist, rather than
  splitting catalog, course modal, worksheet, and shared chrome into separate
  issues at the start.
- The issue checklist should cover catalog cleanup, course modal cleanup,
  worksheet cleanup, shared chrome cleanup, the Saved Search auth-guard
  exception, source inventory updates, focused tests, and browser smoke.
- If implementation proves too large, split follow-up issues from this parent
  issue after the first pass exposes the remaining work.

Implementation boundary:

- Prefer hard-disabling or hiding unsupported inherited UI surfaces over
  physically deleting backend, schema, GraphQL, or generated-code surfaces.
- Keep inherited backend/schema/GraphQL code only when it is not reachable from
  public UCSD user paths and can plausibly be adapted for later App DB/Auth work.
- Preserve the existing Saved Search backend/schema/API path for later
  adaptation, but do not present Saved Search as anonymous persistence or as an
  availability/enrollment alert.
- Guard Saved Search API calls behind auth state. Anonymous users can see the
  dropdown entry point but should not call `/api/savedSearches`.
- Keep inherited rating/workload/evaluation components dormant; do not use them
  as fallback UI for UCSD public catalog or course modal paths.
- Physically delete or refactor inherited code only when it still leaks
  misleading UI/copy, remains user-reachable, or blocks UCSD behavior.
- Record any retained inherited surfaces in a source inventory so future work can
  distinguish intentionally dormant code from forgotten cleanup.

Acceptance:

- Browser smoke over `/catalog`, `/worksheet`, and a course modal shows no
  user-facing `Workload`, rating, professor-quality, OCE/evaluation,
  friends/social, open seats, waitlist, enrollment, demand, or Google Calendar
  direct-export wording.
- Browser smoke confirms the primary paths still expose supported UCSD concepts:
  Average GPA, catalog `Record Count`, Past Grades raw Grade Archive Records,
  ICS download, and worksheet share/export behavior.
- A dated source inventory document records inherited surfaces hidden from
  primary paths, inherited surfaces intentionally retained for later adaptation,
  and non-primary static/history pages left as inventory-only scope.
- Source inventory identifies any remaining inherited code paths as intentionally
  dormant, follow-up cleanup, or later beta scope.
- Existing Catalog Snapshot, Anonymous Worksheet, and calendar/export behavior
  still pass focused frontend tests.
- `bun run typecheck`, focused frontend tests, `git diff --check`, and browser
  smoke pass before the slice is considered complete.

Rationale:

Beta-1 App DB/Auth will be easier to design safely after public product surfaces
use UCSD terms consistently. Adding persistence before cleanup risks attaching
new saved-user behavior to inherited Yale/CourseTable concepts that the UCSD
product does not intend to keep.

## 18. 2026-06-20 Change Note: Beta-1 Starts With Auth Foundation

After Beta-0, the first Beta-1 implementation slice should be `Auth Foundation
And UCSD User Identity`, not Saved Worksheet persistence.

First auth method:

- Use email verification code or magic-link login for `@ucsd.edu` addresses.
- Reject non-`@ucsd.edu` email addresses in the first auth version instead of
  creating limited accounts.
- Keep anonymous catalog and Anonymous Worksheet use available without login.
- Use an internal `user_id` for App DB ownership and treat normalized verified
  email as the login identifier.
- Do not make the UCSD email local-part a Yale-style `netId` primary identity.
- Existing `netId`-named inherited code may remain temporarily behind adapters,
  but new UCSD App DB design should not expand that terminology.
- Do not use Google OAuth as the first auth method.
- Do not couple first auth to Google Calendar scopes, SET/CAPE access, or a
  personal UCSD account.
- Google OAuth can be reconsidered later for Google Calendar direct export.

Recommended Beta-1 order:

1. Auth foundation and UCSD User Identity
2. App DB schema cleanup/adaptation
3. Save Anonymous Worksheet into account
4. Saved worksheets list/detail
5. Saved Search persistence cleanup
6. Wishlist

Rationale:

Saved worksheets, Saved Search, wishlist, and privacy settings all depend on a
stable signed-in identity. Starting with saved worksheet persistence would force
the implementation to settle session behavior, email/domain policy, user record
shape, and ownership rules inside a larger worksheet feature. Auth foundation
should establish the minimal identity contract first, while preserving the
Catalog Snapshot as the course-data read contract.

Beta-1 Auth Foundation acceptance:

- `@ucsd.edu` email verification code or magic-link login works.
- Non-`@ucsd.edu` email addresses are rejected with a clear message.
- Session cookie is created, restored, and cleared on logout.
- `/api/me` returns `user_id` and normalized verified email.
- Anonymous catalog and Anonymous Worksheet continue to work without login.
- Saved Search dropdown shows a non-error sign-in-required state when anonymous
  and can use the real saved-search path after login.
- This issue does not save Anonymous Worksheet to an account, implement saved
  worksheet list/detail, implement wishlist, add privacy settings, add Google
  OAuth, add Google Calendar export, add Course Data Store, or add Hasura.

## 19. 2026-06-20 Change Note: Real Backend Validation Before Saved Worksheet Persistence

`Beta-1: Real Backend Auth Validation` should be treated as the validation and
runbook slice after `Auth Foundation And UCSD User Identity`, not as a new PRD
or a Saved Worksheet product feature. Detailed scope, pass/fail criteria,
artifact strategy, and non-goals live in
`docs/planning/archive/beta-1-real-backend-auth-validation-2026-06-20.md`.

This roadmap intentionally keeps only the ordering and product-scope summary:

- Run #20 after #14.
- Validate the full local CourseTable Compose backend path before hosted
  staging/production and before real email delivery.
- Keep Saved Worksheet persistence out of #20.
- Continue to require an explicit later action to save an Anonymous Worksheet
  into an account.

Follow-up product slices:

1. `Beta-1: Save Anonymous Worksheet To Account`
2. `Beta-1: Saved Worksheets List/Detail`

The first follow-up should let a signed-in user explicitly turn the current
Anonymous Worksheet into a Saved Worksheet. It should decide naming, term
conflict behavior, privacy defaults, and cross-browser restore behavior instead
of inheriting those decisions from login.
