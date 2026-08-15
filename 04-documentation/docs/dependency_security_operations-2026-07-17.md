# Dependency security operations (2026-07-17)

Status: dated record of accepted dependency and repository-automation changes
on `main`. This is not a claim that the complete dependency graph is
vulnerability-free.

## Scope and documentation boundary

This record covers dependency selection, lockfile ownership, automated security
updates, audit interpretation, and repository validation. It intentionally does
not duplicate environment-specific deployment procedures or current hosted
state. Current Production evidence and operating procedures belong in
[`cloudflare_production_operations-2026-07-14.md`](cloudflare_production_operations-2026-07-14.md).

Repository acceptance, hosted deployment, and database mutation are separate
events. A merged dependency change proves only the repository state described
by its validation evidence. Any hosted release must use the established
environment workflow, and an ORM tooling upgrade must not be described as a
database schema change unless it produces and applies a reviewed migration.

## Accepted repository changes

Pull request
[#145](https://github.com/PatrickTangwen/coursetable-ucsd/pull/145)
made the controlled dependency and package-manager changes:

- `drizzle-orm` `0.30.10` to `0.45.2` in the root and API workspaces;
- `drizzle-kit` `0.20.18` to `0.31.10`;
- `passport` `0.5.0` to `0.6.0`;
- direct and transitive `uuid` resolution to `11.1.1`;
- Drizzle Kit configuration and migration snapshot metadata upgraded to the
  current format;
- the root `bun.lock` made authoritative for the workspace;
- the stale `frontend/pnpm-lock.yaml` removed and ignored;
- repository CI changed from the inherited `master` trigger to `main`.

`bun run --cwd api db:generate` reported no schema changes after the Drizzle
metadata upgrade. No new SQL migration was generated, and the Production App DB
was not touched by the repository-only change.

Pull request
[#156](https://github.com/PatrickTangwen/coursetable-ucsd/pull/156)
changed Dependabot to security-only operation for Bun and GitHub Actions:

- routine version-update pull requests are disabled;
- security update pull requests remain enabled;
- security updates are grouped per package ecosystem to reduce review noise.

## Alert accounting

The original GitHub view showed five open Dependabot alerts: two manifest
locations for the Drizzle advisory, two UUID locations, and one Passport
location. Those five GitHub alerts are closed after #145; the repository showed
zero open Dependabot alerts when this record was written.

The five-alert GitHub view was not a complete count of every advisory reachable
from every workspace dependency. A same-tool comparison with `bun audit` gives
the broader dated snapshot:

| Snapshot          | Packages with findings | Advisory records | Unique GHSA URLs | Critical | High | Moderate | Low |
| ----------------- | ---------------------: | ---------------: | ---------------: | -------: | ---: | -------: | --: |
| Before, `3af0f31` |                     31 |               75 |               68 |        1 |   22 |       47 |   5 |
| After, `f7d011b`  |                     26 |               50 |               43 |        1 |   20 |       25 |   4 |

This maintenance reduced the broader Bun audit by 25 advisory records. It did
not turn five findings into fifty new findings. The remaining records include
transitive dependencies, developer/build tooling, and inherited modules as well
as possible runtime dependencies. An audit match alone does not prove that its
vulnerable function is reachable from the public Production Worker.

The remaining findings require a separate reachability and upgrade review. At
minimum, that review must distinguish:

1. code bundled into the public Production Worker or static application;
2. API or legacy modules that are disabled in the hosted Worker composition;
3. build, test, code-generation, lint, and local-development tooling;
4. duplicate advisory records and multiple dependency paths to one package.

Do not close that future review merely because GitHub currently shows zero open
alerts, and do not treat all fifty records as fifty independently exploitable
Production vulnerabilities.

## Validation evidence

The accepted dependency change passed:

- frozen Bun installation, formatting, lint, type checking, API tests, frontend
  tests, Worker tests, snapshot tests, and Worker dry-run build;
- hosted failure-safety and disposable Core App Backend validation;
- forward migration replay and compatibility with the previous Worker;
- App DB backup and disposable restore verification;
- Drizzle generation with no schema change;
- pull-request and post-merge `main` CI.

Relevant hosted CI evidence:

- [dependency merge `main` CI](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29559270230);
- [security-only configuration `main` CI](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29559679297).

These checks validate the repository and disposable boundaries. They do not
replace a hosted Staging deployment or prove that Production is already running
the new bundle.

## Ongoing review policy

Use the following method for future dependency-security maintenance:

1. Record the audit tool, lockfile, commit, and command used for the baseline.
   Compare before and after with the same tool so that count changes are
   meaningful.
2. Report packages with findings, advisory records, unique advisory IDs, and
   severities separately. Do not compare one of these values directly with a
   different metric from a provider UI.
3. Trace each important advisory through the dependency graph and classify it
   as hosted runtime, disabled or legacy runtime, or development/build tooling.
4. Prioritize reachable Critical and High findings. Confirm that the fixed
   release is compatible instead of forcing an override that only hides the
   vulnerable version from the top-level manifest.
5. Validate with a frozen install, formatting, lint, type checks, relevant test
   suites, and production-target build. For ORM upgrades, also run migration
   generation and inspect any generated SQL and metadata changes.
6. Record what was fixed, what remains, why remaining findings are or are not
   reachable, and who owns the next review. Zero alerts in one scanner must not
   be presented as proof that every dependency is clean.
7. Keep repository evidence separate from hosted release evidence. Record
   deployed commits, environment smokes, rollback events, and backup state in
   the environment operations document rather than this dependency record.

Historical readiness documents should remain unchanged. Create an ADR only
when dependency work introduces a durable architectural decision, not for a
routine compatible upgrade.
