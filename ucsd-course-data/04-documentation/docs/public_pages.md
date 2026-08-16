# Public Pages And External Help Links

Status: stable implementation reference for SunGrid's public landing, FAQ, and
privacy surfaces.

This document records where these public surfaces are implemented and how their
navigation is expected to behave. It is not legal approval of the Privacy
Policy. Policy wording and provider disclosures still require review whenever
SunGrid's data handling or infrastructure changes.

## Public Routes And Destinations

| Surface        | Destination                        | Expected behavior                                    |
| -------------- | ---------------------------------- | ---------------------------------------------------- |
| Landing page   | `/`                                | Public SunGrid product introduction and entry point. |
| FAQ            | `https://tally.so/r/q47EA8`        | Opens Tally in a new browser tab.                    |
| Privacy Policy | `/privacypolicy`                   | Public in-app page; no account required.             |
| Support        | `https://buymeacoffee.com/sungrid` | Opens SunGrid's Buy Me a Coffee page in a new tab.   |

The FAQ is intentionally an external destination rather than an in-app route.
FAQ links must use `target="_blank"` with `rel="noopener noreferrer"` so the
current SunGrid page stays open.

The “Buy me sushi” footer button is a direct external link styled by SunGrid.
Do not replace it with Buy Me a Coffee's embedded script unless the additional
third-party runtime, privacy, security-policy, and failure implications have
been reviewed. The direct link keeps the current page open and contacts Buy Me
a Coffee only after the user clicks.

## Navigation Ownership

- `frontend/src/components/landing/links.ts` owns the shared external FAQ URL.
- The same links module owns the Buy Me a Coffee support destination.
- `frontend/src/components/landing/LandingFooter.tsx` owns the footer used by
  both the landing page and Privacy Policy page.
- `frontend/src/pages/Home.tsx` owns the landing-page desktop and mobile FAQ
  entries and renders the shared footer.
- `frontend/src/App.tsx` assigns the shared landing footer to
  `/privacypolicy`.
- `frontend/src/components/Navbar/TopNav.tsx` keeps the Privacy Policy navbar
  logo aligned with the shared footer without changing the compact Catalog and
  Worksheet navbar treatment.

Because the landing and Privacy Policy pages share `LandingFooter`, update its
links and styling once rather than maintaining route-specific footer copies.
Section links use `#worksheet` and `#how` on the landing page and return to
`/#worksheet` and `/#how` from the Privacy Policy page.

## Privacy Policy Ownership

- `frontend/src/pages/Privacy.mdx` is the publishable policy content and table
  of contents.
- `frontend/src/pages/Privacy.module.css` owns policy typography, spacing,
  responsive layout, and the independent-service disclosure treatment.
- `frontend/src/pages/Privacy.test.tsx` checks the complete rendered policy,
  provider disclosures, section anchors, and absence of template placeholders
  or horizontal-rule separators.

The policy currently identifies Cloudflare, Neon, Resend, Tally, and Sentry.
Review the page whenever a provider, authentication flow, analytics practice,
retention rule, account-deletion process, contact address, or public product
domain changes. Do not silently leave stale provider or data-handling claims in
the policy.

## Local Verification

With the frontend running at `https://localhost:3001`, verify:

1. `/` shows FAQ in the desktop header, mobile navigation, and shared footer.
2. Every FAQ entry opens the configured Tally destination in a new tab.
3. `/privacypolicy` loads without authentication.
4. The Privacy Policy footer matches the landing-page footer.
5. The Privacy Policy navbar and footer SunGrid logos share the same size and
   horizontal alignment at desktop and mobile widths.
6. The table of contents reaches every numbered policy section.
7. “Buy me sushi” opens the configured Buy Me a Coffee page in a new tab and no
   Buy Me a Coffee embed script is present in the page.
8. The support button shares the navigation row on desktop and the SunGrid logo
   row on mobile; the footer logo remains black on hover.

Relevant focused tests:

```bash
bun run --cwd frontend test -- \
  src/pages/Home.publicLogin.test.tsx \
  src/components/landing/LandingFooter.test.tsx \
  src/pages/Privacy.test.tsx
```
