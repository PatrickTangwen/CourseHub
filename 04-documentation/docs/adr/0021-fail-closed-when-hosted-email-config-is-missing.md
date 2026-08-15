# Fail Closed When Hosted Email Config Is Missing

Status: accepted. Follows ADR 0016 through ADR 0020.

Hosted UCSD email login must fail closed when required email-delivery
configuration is missing. Staging and production should not silently fall back
to the development verification-code seam or expose `devCode`; missing Resend
API key, sender address, or related hosted email configuration should block the
real-email login path and surface an operational error instead.

**Consequences**

- Development and tests may use an in-memory/test sender or explicit dev-code
  seam.
- Staging and production require complete email-delivery configuration before
  real-email login can pass acceptance.
- Auth code should make the environment boundary explicit instead of hiding
  provider failures behind successful verification responses.
