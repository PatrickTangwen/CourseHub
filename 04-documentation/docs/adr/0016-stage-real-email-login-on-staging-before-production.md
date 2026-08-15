# Stage Real Email Login On Staging Before Production

Status: accepted. Extends ADR 0007 (UCSD email verification) and ADR 0009
(real backend auth validation before email delivery).

UCSD login rollout should first expose production-like email delivery on the
staging deployment, while keeping the production login entry point hidden from
public users until staging proves email deliverability, HTTPS cookies, Redis
session restore, App DB ownership, and user-facing failure behavior. This keeps
the Catalog Snapshot user path stable while the App Backend is hardened for real
accounts, and it avoids coupling login rollout to a Course Data Store, Ferry, or
Hasura migration.

**Considered Options**

- Open production login as soon as an email provider is wired. Rejected because
  provider reputation, sender-domain DNS, cross-origin cookies, and session
  restore need real-host validation before public users depend on them.
- Keep using only the local development verification-code seam. Rejected because
  it does not test deliverability, DNS, hosted HTTPS cookies, or production-like
  secret boundaries.
- Migrate catalog data to the upstream CourseTable Course Data Store before
  login rollout. Rejected because login only needs the App Backend and App DB;
  catalog GraphQL adoption is a separate future decision point.

**Consequences**

- The first hosted login acceptance target is staging, not production.
- Production may deploy backend support and hidden routes, but should not expose
  login as a public user path until staging passes a real-email smoke.
- Detailed provider setup, DNS, rate limits, and failure-copy acceptance should
  live in implementation issues or runbooks, not in this ADR.
