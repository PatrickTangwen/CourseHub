# Hard-Disable Inherited UI Before Deleting Backend Surfaces

Beta-0 UI Surface Cleanup should hard-disable or hide unsupported inherited CourseTable/Yale features from public UCSD user paths before physically deleting backend, schema, GraphQL, or generated-code surfaces. This keeps `/catalog`, `/worksheet`, course modal, and public copy truthful for UCSD users while preserving inherited backend structures that may be adapted for later App DB/Auth work.

Physical deletion is required only when an inherited feature remains reachable, leaks misleading UI/copy, or blocks UCSD behavior. Otherwise, dormant inherited code should be inventoried as follow-up cleanup or later beta adaptation scope.

Saved Search is the catalog exception: the existing dropdown may remain visible during Beta-0 because saved searches are a planned Beta-1 App DB/Auth capability and the inherited backend/schema/API path can plausibly be adapted. The UI must still avoid presenting Saved Search as an anonymous capability or as an availability/enrollment alert. Anonymous users should see a non-error sign-in-required state instead of triggering saved-search API requests that require authentication.

UCSD public primary paths must not fall back to inherited rating, workload, professor-quality, OCE, SET/CAPE, or evaluation UI. If a UCSD snapshot course lacks Historical GPA Data or archive metadata, the UI should show a UCSD-specific missing-data state rather than CourseTable rating surfaces.
