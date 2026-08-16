# Keep Email Domain Configurable Until Product Domain Is Final

Status: accepted. Follows ADR 0018 and ADR 0019.

The SunGrid product domain is not final yet, so hosted email-login work should
not bind Resend to an inherited CourseTable domain or a temporary product
domain. The App Backend should treat the verification-email sender domain and
from address as environment configuration, and formal real-email staging
acceptance should wait until the final product domain can verify a dedicated
sending subdomain.

**Consequences**

- Implementation may add the Resend integration and sender abstraction before
  the final domain exists, but it must not hard-code the sender domain.
- Temporary sandbox/test sending can support development, but it is not the
  hosted staging acceptance signal from ADR 0016.
- Manual setup remains blocked on choosing the final product domain, then
  verifying `mail.<product-domain>` or `auth.<product-domain>` in Resend.
