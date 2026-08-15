# Documentation Index

Status: top-level navigation for stable project documentation.

## Current SunGrid References

- `app_db_migrations.md`: versioned App DB migration generation and shared
  staging/production rollout.
- `app_db_backup_recovery-2026-07-11.md`: forward migration, private App DB
  backup retention, disposable restore proof, and the current Production
  backup-schedule constraint.
- `core_app_backend.md`: Core App Backend composition boundary, optional legacy
  modules, and disposable validation path.
- `course_data_store.md`: shadow Course Data Store ownership, migrations,
  importer, Hasura metadata, and tracer validation.
- `grade_archive.md`: current Instructor Grade Archive matching, explicit
  cross-listed inheritance, provenance, and Past Grades display contract.
- `worksheet_section_id_compatibility.md`: unique package-ID migration for
  persisted worksheet Sections, including ambiguity and warning behavior.
- `local_server.md`: local frontend/backend/auth startup and login smoke
  runbook.
- `local_server_endpoints.md`: current local frontend/backend URLs, Docker
  containers, HTTPS certificates, and `mkcert` notes.
- `local_course_data_platform.md`: complete disposable App Backend + Course Data
  Platform operator workflow and staging-readiness contract.
- `public_pages.md`: landing-page, external FAQ, Privacy Policy, shared footer,
  and public navigation ownership and verification.
- `hosted-auth-security-2026-07-10.md`: hosted verification proxy trust,
  abuse-control budgets, and ambiguous-delivery behavior.
- `email_delivery_audit_privacy-2026-07-11.md`: maintainer-only delivery audit,
  seven-day cleanup, and hosted telemetry/evidence privacy rules.
- `hosted-like-auth-validation-2026-07-10.md`: fake-sender, production-mode
  acceptance path for hosted login.
- `hosted_failure_cost_safety-2026-07-12.md`: hosted provider-failure
  boundary, Application Safety Budget, usage signals with 70/90 percent
  thresholds, and failure/rollback evidence.
- `cloudflare_staging_deployment-2026-07-12.md`: manual, protected staging
  deployment workflow, rollback behavior, and non-sensitive evidence contract.
- `cloudflare_production_operations-2026-07-14.md`: current deployed Production
  state, accepted evidence, release/login/backup workflows, rollback semantics,
  and open operations work.
- `dependency_security_operations-2026-07-17.md`: accepted dependency security,
  Bun lockfile, CI, and Dependabot changes; audit-count interpretation,
  validation evidence, and ongoing dependency review policy.
- `worker_catalog.md`: local single-origin Worker Catalog, private R2
  publication integrity, and disposable acceptance workflow.
- `worker_login.md`: Hyperdrive, Upstash REST, fixed hosted sessions, and
  direct Neon migration separation.
- `worker_planning_data.md`: Worker Saved Search and Saved Worksheet ownership,
  shared HTTP contract, and account-service failure isolation.
- `etl_refresh.md`: one-command ETL refresh runbook (`bun run etl:refresh`),
  source-conflict rules, refresh-report contract, telemetry notes, and the
  launchd-scheduled review-PR flow.
- `snapshot_pipe.md`: catalog snapshot pipeline notes, including the Class
  Planner API schedule source and booking-choice reconstruction, General
  Catalog enrichment, FA26 TSS metadata and Import Manifest publication,
  Schedule parser edge cases, and raw HTML replay rules.
- `tritongpt_schedule_csv.md`: TritonGPT schedule CSV column, row,
  package-grouping, and integrity contract; fallback import path behind the
  Class Planner API scraper since 2026-08-03.
- `styling.md`: styling conventions.

## Historical SunGrid Records

These documents retain accepted constraints or pre-launch evidence, but they are
not the current operating source of truth.

- `cloudflare_hosted_staging.md`: accepted first-hosted-staging boundary,
  external state services, security, and cost policies.
- `cloudflare_production_readiness-2026-07-13.md`: code-only Production contract
  and pre-launch provisioning gates; superseded for deployed state and current
  operations by `cloudflare_production_operations-2026-07-14.md`.

## Inherited CourseTable References

These documents are retained for historical comparison and audit. They describe
upstream CourseTable systems and are not current SunGrid operating runbooks.

- `api.md`: inherited CourseTable API reference, including legacy challenge and
  evaluation-access endpoints; do not treat it as the hosted SunGrid API
  contract.
- `containers.md`: inherited CourseTable container and database architecture.
  The SunGrid boundary and UCSD adaptation are tracked by GitHub issues #87 and
  #88-#96.
- `graphql.md`: inherited Ferry/Hasura GraphQL integration. The planned UCSD
  Course Data Platform remains a shadow data path until its parity work is
  complete.
- `deployment.md`: inherited `coursetable.com`, Doppler, and self-hosted runner
  deployment notes; do not use it to deploy SunGrid.
- `maintenance.md`: inherited CourseTable/Ferry season-maintenance steps; do not
  use it as the SunGrid Production runbook.
- `challenge.md`: inherited CourseTable challenge/context notes.
- `locations.md`: inherited Yale building-coordinate and walking-time workflow.

## Planning And Decisions

- `planning/README.md`: planning archive index and guidance for where current
  planning work now lives.
- `adr/README.md`: decision-record index and ADR editing rules.
