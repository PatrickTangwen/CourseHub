# Roll Out Merged Scheduled Refreshes Through Protected Environments

Status: accepted. Supersedes ADR 0042 only for post-merge deployment dispatch.

## Decision

Keep the Monday/Thursday Scheduled Refresh review PR and human merge decision.
After a `data-refresh/*` PR is merged into `main` and the resulting `main` CI
run succeeds, automatically enter the existing protected deployment sequence:

1. run the complete Staging preflight and request approval for the `Staging`
   Environment;
2. deploy, smoke, and record durable Staging acceptance after that approval;
3. only after Staging succeeds, run the complete Production preflight and
   request approval for the `Production` Environment;
4. deploy Production with public login forced off after Production approval.

The chain reuses the existing deployment workflows. It passes the exact green
`main` commit from Staging into Production, so Production does not depend on a
maintainer racing to update `STAGING_ACCEPTED_COMMIT`. Manual dispatch remains
available and continues to use the durable environment variable when no commit
is supplied by the protected chain.

## Why

ADR 0042 removed the work of running and opening refresh PRs but left every
post-merge workflow dispatch manual. That duplicated deterministic routing and
made a reviewed data refresh easy to leave undeployed. Environment reviewers,
smoke tests, durable accepted evidence, and automatic rollback already own the
important release judgment and safety boundaries.

## Consequences

- Data review and merge are still human decisions; this does not auto-merge a
  refresh PR.
- Failed PR CI or failed `main` CI cannot enter Staging.
- Non-refresh commits cannot enter this automatic chain.
- Staging and Production Environment protections remain authoritative. The
  workflow queues at each required-reviewer gate and cannot access that
  environment's secrets before approval.
- Production public login remains disabled. The separate audited login-toggle
  workflow is not part of this chain.
- Recovery flags remain off; a stranded unaccepted first deployment still
  requires separate explicit authorization.

## Implementation Correction (2026-08-10)

Reusable workflow calls must declare `secrets: inherit`. Without that caller
contract, GitHub resolves the called deployment workflow's secret references to
empty values even after the called job passes its Environment approval gate.
Both the Staging and Production calls declare inheritance; their respective
Environment protections still control when each called job can access its own
secrets.

## Single-Approval Automation Correction (2026-08-10)

The accepted Monday/Thursday operating contract now treats the repository
owner's merge of a generated `data-refresh/*` PR as the only human release
gate. The automatic chain additionally rejects refresh PRs that contain files
outside the generated catalog artifact allowlist, then requires green `main`
CI, Staging smoke and durable acceptance before Production can start.

The `Staging` and `Production` GitHub Environments retain their branch policies
and environment-scoped credentials, but no longer require separate reviewer
clicks for this chain. This setting also means a manually dispatched deployment
does not pause for an Environment reviewer; its exact-main-SHA, Staging
acceptance, recovery, smoke, rollback, and evidence checks remain in force.

The reusable Production workflow still defaults to public login disabled for
manual dispatch. Only the qualified scheduled-refresh caller passes the
login-enabled input, so routine catalog publication preserves the live site's
login state without requiring a second login-toggle approval.

## Large-Refresh Qualification Correction (2026-08-14)

The commit-associated Pull Requests endpoint is used only to identify the
candidate `data-refresh/*` PR. Its abbreviated response may omit the merge
actor, so the qualifier fetches the complete PR resource before requiring the
repository owner as `merged_by`.

File qualification no longer depends on GitHub's Pull Request files endpoint,
which can return HTTP 422 while generating large catalog diffs. The workflow
checks out trusted tooling from `main` with commit history and validates the
merged commit against its first parent using local Git paths. The generated
artifact allowlist and all subsequent Staging and Production gates are
unchanged.

## Scheduled Login Authorization Correction (2026-08-15)

The reusable Production contract requires a separate authorization signal
whenever public login is enabled. The qualified scheduled-refresh caller now
passes an explicit, default-off `workflow_call` input, and the reusable
workflow maps it to the contract only for a `workflow_run` event. Manual
Production dispatch still exposes no login-enablement input and defaults to
public login disabled.

This signal does not replace refresh qualification, green CI, the exact
Staging-accepted commit check, hosted smoke, or durable accepted evidence. It
only carries the repository owner's already-established scheduled-refresh
authorization across the reusable workflow boundary.
