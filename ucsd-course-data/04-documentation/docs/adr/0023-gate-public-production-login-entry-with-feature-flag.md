# Gate Public Production Login Entry With Feature Flag

Status: accepted. Complements ADR 0016 and ADR 0021.

Production may deploy App Backend support for UCSD email login before the public
login entry point is enabled, but user-visible production login navigation and
the public login flow must be gated by an environment-controlled feature flag.
Staging should enable the flag for real-email validation; production should keep
it disabled until email delivery, HTTPS cookies, Redis session restore, App DB
ownership, versioned migrations, and browser smoke acceptance are complete.

**Consequences**

- Implementation should separate deployed backend capability from public product
  availability.
- Production users should not accidentally reach a half-configured login path.
- The flag should control visible entry points and public route behavior; it
  must not be used to bypass hosted email configuration failures.
