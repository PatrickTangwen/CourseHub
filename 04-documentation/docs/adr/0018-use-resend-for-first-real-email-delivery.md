# Use Resend For First Real Email Delivery

Status: accepted. Implements the provider choice for ADR 0016 and ADR 0017.

The first hosted UCSD verification-code email rollout should use Resend as the
transactional email provider. Resend fits the staging-first rollout because the
integration is small for the current Node/TypeScript App Backend, the required
manual setup is limited to account creation, sending-domain DNS verification,
and API-key secret configuration, and the provider can be replaced later if
volume, cost, or deliverability requirements change.

**Considered Options**

- Use AWS SES first. Rejected for now because it is cheaper at scale but adds
  more AWS account, sandbox, IAM, and operational setup than the staging login
  rollout needs.
- Use Postmark first. Rejected for now because it is a strong transactional
  provider but has less useful free-room for small staging/beta validation.
- Use SendGrid first. Rejected for now because it does not reduce setup
  complexity for this project compared with Resend.

**Consequences**

- Hosted email-login implementation should introduce a Resend-backed sender
  behind a small App Backend interface, not scatter Resend calls through auth
  route code.
- Manual setup must create the Resend project/API key, verify the sending
  domain, and configure the staging/production secrets before hosted smoke tests.
- Email templates and failure handling should remain provider-neutral enough
  that a later SES/Postmark migration does not change the UCSD login domain
  model.
