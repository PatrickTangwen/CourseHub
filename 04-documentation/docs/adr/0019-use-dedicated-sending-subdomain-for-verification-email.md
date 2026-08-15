# Use Dedicated Sending Subdomain For Verification Email

Status: accepted. Complements ADR 0018 (Resend for first real email delivery).

UCSD verification-code email should be sent from a dedicated sending subdomain
under the product domain, such as `mail.<product-domain>` or
`auth.<product-domain>`, rather than directly from the root product domain. This
keeps Resend DNS records, deliverability reputation, and future email-provider
migration isolated from the main site domain while still presenting a
product-owned sender to users.

**Considered Options**

- Send directly from the root product domain. Rejected because SPF, DKIM, DMARC,
  provider verification, and reputation changes would be coupled to the primary
  web domain.
- Use the provider's shared development sender in hosted staging. Rejected
  because staging is meant to prove production-like delivery and sender trust,
  not only API connectivity.

**Consequences**

- Manual setup must create and verify a sending subdomain in Resend before the
  hosted real-email smoke.
- Staging and production may share the verified sending subdomain, but they
  should use separate API keys and environment-specific sender configuration.
- If the product domain is not final yet, implementation should treat the
  sending domain as configuration rather than hard-coding it into auth logic.
